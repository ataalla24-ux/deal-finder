import assert from 'node:assert/strict';
import { isCommunitySubmission, normalizeDeal, revalidateRecentPostedQueue,
  buildPendingDealMessage, pendingSlackPayload, pendingDealGroups, postSlackMessage,
  deliverySummary } from '../scraper/slack-notify.js';
import { extractSlackMessageText, extractDealsFromThreadMessages } from '../scraper/slack-digest-utils.js';

const submission = normalizeDeal({
  id: 'community:test', submissionId: 'test', originSource: 'community-submission',
  source: 'Community Submission', title: 'Community-Deal prüfen',
  url: 'https://www.instagram.com/reel/test/',
}, 'community');
assert.equal(isCommunitySubmission(submission), true);
assert.equal(isCommunitySubmission({ ...submission, submissionId: '' }), false);
assert.equal(isCommunitySubmission({ ...submission, originSource: 'instagram' }), false);
assert.equal(isCommunitySubmission({ ...submission, id: 'scraped:test' }), false);
const result = await revalidateRecentPostedQueue([{ ...submission, slackTs: '123.456' }]);
assert.equal(result.validation, null);
assert.equal(result.changed, false);
assert.equal(result.deals.length, 1);
console.log('Community manual-review regression checks passed');

const previousFetch = globalThis.fetch;
const previousSecret = process.env.DEAL_REMOVE_LINK_SECRET;
process.env.DEAL_REMOVE_LINK_SECRET = 'test-only';
try {
  const deal = { ...submission, title: 'Gratis Matcha Latte', brand: 'Café Fixture',
    description: 'Ein Matcha Latte gratis, nur einmal pro Person.', category: 'kaffee', type: 'gratis',
    distance: 'Wollzeile 29, 1010 Wien', expires: '2099-12-31',
    submittedAt: '2026-11-27T12:00:00Z' };
  const text = buildPendingDealMessage(deal, 1);
  const payload = pendingSlackPayload(text, 'root-ts', deal);
  assert.equal(payload.thread_ts, 'root-ts');
  assert.equal(payload.text, text, 'accessibility fallback retains the complete deal');
  assert.equal(payload.blocks, undefined);
  const attachment = payload.attachments[0];
  assert.equal(attachment.color, '#EAB308');
  assert.equal(attachment.fallback, text);
  assert.equal(attachment.blocks[0].text.text, 'COMMUNITY-EINSENDUNG');
  const sections = attachment.blocks.filter(block => block.type === 'section').map(block => block.text.text).join('');
  assert.doesNotMatch(sections, /\*COMMUNITY-EINSENDUNG\*/, 'visible heading is not duplicated');
  assert.match(sections, /Status: Neu – manuell prüfen/);
  assert.match(sections, /Gratis Matcha Latte/);
  assert.match(sections, /Café Fixture/);
  assert.match(sections, /Wollzeile 29/);
  const button = attachment.blocks.at(-1).elements[0];
  assert.equal(button.action_id, 'freefinder_edit_pending');
  const signed = JSON.parse(Buffer.from(new URL(button.url).searchParams.get('payload'), 'base64url'));
  assert.deepEqual(signed, { dealId: deal.id, scope: 'pending-edit' });

  for (const fallback of [text, text.replace(/\n/g, ' '), 'Community-Einsendung']) {
    const message = { ...payload, text: fallback, ts: '1795771201.000001', thread_ts: 'root-ts' };
    assert.match(extractSlackMessageText(message), /Deal-ID: community:test/);
    const parsed = extractDealsFromThreadMessages([message], { pendingQueue: [deal] });
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].id, deal.id);
    assert.equal(parsed[0].title, deal.title);
    assert.equal(parsed[0].brand, deal.brand);
    assert.equal(parsed[0].url, deal.url);
    assert.equal(parsed[0].order, 1);
    assert.equal(parsed[0].slackThreadTs, 'root-ts');
    assert.equal(parsed[0].submissionId, deal.submissionId);
    assert.equal(parsed[0].pipelineLifecycle?.manualDecision, undefined, 'formatting does not approve a deal');
  }
  const ordinary = { ...deal, id: 'scraped:test', submissionId: '', originSource: 'instagram' };
  const normalText = buildPendingDealMessage(ordinary, 1);
  const normalPayload = pendingSlackPayload(normalText, null, ordinary);
  assert.equal(normalPayload.attachments, undefined, 'automated discoveries are not marked as community');
  assert.doesNotMatch(normalText, /COMMUNITY-EINSENDUNG/);
  assert.equal(normalPayload.blocks.at(-1).elements[0].action_id, 'freefinder_edit_pending');
  assert.deepEqual(pendingDealGroups([ordinary, deal]).map(group => [group.kind, group.deals.map(row => row.id)]),
    [['community', [deal.id]], ['', [ordinary.id]]], 'submissions have their own priority thread');
  assert.deepEqual(pendingDealGroups([]), []);
  assert.equal(pendingDealGroups([ordinary]).length, 1, 'do not send empty submission headers');

  const summary = pendingSlackPayload(deliverySummary('Community-Einsendungen', 1, 2), null, undefined, 'community');
  assert.equal(summary.attachments[0].color, '#EAB308', 'root remains yellow after the delivery-count update');
  assert.equal(summary.attachments[0].blocks[0].text.text, 'COMMUNITY-EINSENDUNGEN');
  assert.match(summary.text, /1 von 2/);
  assert.match(summary.text, /erneuten Versand/);

  const requests = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://slack.com/api/chat.postMessage');
    requests.push(JSON.parse(init.body));
    return requests.length === 1
      ? Response.json({ ok: false, error: 'ratelimited' }, { status: 429, headers: { 'retry-after': '1' } })
      : Response.json({ ok: true, ts: 'sent-ts' });
  };
  assert.equal(await postSlackMessage(text, 'root-ts', 0, deal), 'sent-ts');
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1], requests[0], 'retry preserves color, thread, fields and edit link');

  delete process.env.DEAL_REMOVE_LINK_SECRET;
  const withoutEditor = pendingSlackPayload(text, null, deal);
  assert.equal(withoutEditor.attachments[0].color, '#EAB308');
  assert.match(JSON.stringify(withoutEditor.attachments[0].blocks), /Deal-ID: community:test/);
  const long = pendingSlackPayload('a'.repeat(2899) + '🎉'.repeat(4) + '\nDeal-ID: community:test', null, deal);
  for (const block of long.attachments[0].blocks.filter(block => block.type === 'section')) {
    assert.ok(block.text.text.isWellFormed());
    assert.ok(Array.from(block.text.text).length <= 2900);
  }
  console.log('Yellow Community attachments: separation, fields, editor, parser, counts, retries and Unicode passed (mock Slack only)');
} finally {
  globalThis.fetch = previousFetch;
  if (previousSecret === undefined) delete process.env.DEAL_REMOVE_LINK_SECRET;
  else process.env.DEAL_REMOVE_LINK_SECRET = previousSecret;
}

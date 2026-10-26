import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canonicalInstagramPostKey } from '../scraper/deal-evidence-utils.js';
import { enrichCommunityCard, prepareCommunityCardRefresh, refreshQueuedCommunityCards,
  untouchedCommunityThread, postedCommunitySubmissionIds } from '../scraper/community-card-enrichment.js';
import { normalizeDealRecord } from '../scraper/deal-normalization-utils.js';
import { extractCommunityDeal } from '../scraper/community-extraction.js';

const url = 'https://www.instagram.com/p/TestPost123/';
const caption = 'DEIN WRAP-DEAL IST DA! Ciğköfte Wrap für nur 1 €! Freitag, 30.10.2026. Heinestraße 32, 1020 Wien. Nur an diesem Tag und solange der Vorrat reicht!';
const graph = new Map([[canonicalInstagramPostKey(url), { url, caption, graphAccepted: true }]]);
const input = { id: 'community:first', submissionId: 'first', originSource: 'community-submission',
  url: `${url}?share=one`, title: 'Instagram-Deal geteilt', brand: 'Instagram', description: url,
  distance: 'Wien', submittedAt: '2026-10-24T14:08:16Z',
  communityExtraction: { status: 'needs-review', checkedAt: '2026-10-26T09:00:00Z', key: 'paid-cache' } };
const queued = { ...input, slackTs: '2', slackThreadTs: '1', order: 4,
  submittedContent: { title: input.title, brand: input.brand, description: input.description },
  pipelineLifecycle: { slackSentAt: '2026-10-24T14:16:52Z' }, votes: 7 };
const manual = { ...input, category: 'essen', id: 'community:second', submissionId: 'second', url: `${url}?share=two`,
  title: 'Ciğköfte Wrap für 1 €', brand: 'Rhulo', description: 'Nur am 30.10.2026, solange der Vorrat reicht.',
  distance: 'Heinestraße 32, 1020 Wien', expires: '2026-10-30', validOn: '2026-10-30' };
function deps(overrides = {}) {
  const events = [];
  return { events, graphEvidence: graph, isUntouched: async () => true,
    updateMessage: async deal => { events.push(['update', deal]); return true; },
    persist: async deals => events.push(['persist', deals]), ...overrides };
}

test('readable exact-post evidence fills title and all original conditions without paid calls', async () => {
  const result = enrichCommunityCard(input, graph);
  assert.equal(result.title, 'Ciğköfte Wrap für nur 1 €');
  assert.equal(result.description, caption);
  assert.equal(result.brand, 'Instagram', 'do not invent a merchant from an account or address');
  assert.equal(result.expires, undefined, 'do not turn a caption/post date into a guessed expiry');
  assert.equal(result.communityExtraction.requiresReview, true);
  assert.equal(result.communityExtraction.key, 'paid-cache');
  assert.equal(result.communityExtraction.checkedAt, input.communityExtraction.checkedAt);
  const fallback = await extractCommunityDeal(input, input, { graphEvidence: graph, apiKey: '', crawlerKey: '',
    fetch: () => assert.fail('offline fallback must not request any service') });
  assert.equal(fallback.title, result.title);
  assert.equal(fallback.description, caption);
  assert.deepEqual(enrichCommunityCard(result, graph), result);
});
test('missing, wrong-post, denied and oversized evidence never manufactures information', () => {
  for (const entries of [new Map(), new Map([[canonicalInstagramPostKey(url), { url: url.replace('TestPost123', 'other'), caption }]]),
    new Map([[canonicalInstagramPostKey(url), { url, caption, graphAccepted: false }]]),
    new Map([[canonicalInstagramPostKey(url), { url, caption, blockingReason: 'outside-vienna' }]]),
    new Map([[canonicalInstagramPostKey(url), { url, caption: 'a'.repeat(5001) }]])]) {
    assert.equal(enrichCommunityCard(input, entries), input);
  }
  assert.equal(enrichCommunityCard({ ...input, id: 'scraper:x' }, graph).title, input.title);
});
test('manual content and complete source conditions survive enrichment', () => {
  const result = enrichCommunityCard(manual, graph);
  assert.equal(result.title, manual.title);
  assert.equal(result.expires, manual.expires);
  assert.ok(result.description.startsWith(manual.description));
  assert.ok(result.description.includes(caption));
  assert.deepEqual(enrichCommunityCard(result, graph), result);
});
test('placeholder normalization cannot replace Instagram with the source address or corrupt its URL', () => {
  const normalized = normalizeDealRecord({ ...input, metaGraphCaption: caption, viennaEvidence: { detail: 'Heinestraße 32' } });
  assert.equal(normalized.brand, 'Instagram');
  assert.equal(normalized.description, url);
});
test('second submission fills the existing card with stable ID, metadata and acknowledgement aliases', async () => {
  const old = { ...queued, title: 'Heinestraße 32-Deal geteilt', brand: 'Heinestraße 32',
    description: 'https://www.Heinestraße 32.com/p/TestPost123/' };
  const d = deps();
  const result = await refreshQueuedCommunityCards([old], [manual], d);
  assert.equal(result.updated, 1);
  const card = result.deals[0];
  assert.equal(card.title, manual.title);
  assert.equal(card.brand, 'Rhulo');
  assert.equal(card.distance, manual.distance);
  assert.equal(card.validOn, manual.validOn);
  assert.equal(card.category, 'essen');
  assert.ok(card.description.includes(caption));
  assert.ok(card.description.includes(manual.description));
  assert.ok(!card.description.includes('www.Heinestraße'));
  for (const field of ['id', 'submissionId', 'slackTs', 'slackThreadTs', 'submittedAt', 'order', 'votes', 'submittedContent', 'pipelineLifecycle']) {
    assert.deepEqual(card[field], old[field], field);
  }
  assert.deepEqual(postedCommunitySubmissionIds([card]), ['first', 'second']);
  assert.deepEqual(d.events.map(event => event[0]), ['update', 'persist']);
  assert.deepEqual(old, { ...queued, title: 'Heinestraße 32-Deal geteilt', brand: 'Heinestraße 32', description: 'https://www.Heinestraße 32.com/p/TestPost123/' });
  const rerun = await refreshQueuedCommunityCards(result.deals, [manual], deps());
  assert.equal(rerun.updated, 0);
});
test('only matching community data can improve a card; filled facts and different posts stay unchanged', () => {
  assert.equal(prepareCommunityCardRefresh(queued, [{ ...manual, url: url.replace('TestPost123', 'Other') }]), null);
  assert.equal(prepareCommunityCardRefresh(queued, [{ ...manual, id: 'meta:wrong-origin' }]), null);
  const complete = { ...queued, ...manual, id: queued.id, submissionId: queued.submissionId };
  assert.equal(prepareCommunityCardRefresh(complete, [{ ...manual, title: 'Wrap für 9 €', expires: '2027-01-01' }]), null);
});
test('human decisions, moderation blocks and live exact-post duplicates are protected', async () => {
  for (const patch of [{ editedInSlack: true }, { slackEditedAt: 'today' }, { slackFormEditTs: '123' },
    { slackEditedFields: ['title'] }, { liveEditedAt: 'today' }, { approvedAt: 'today' },
    { pipelineLifecycle: { manualDecision: 'rejected' } }, { pipelineLifecycle: { publishedAt: 'today' } },
    { approvalBlock: 'manual' }, { metaGraphBlockingReason: 'outside-vienna' }, { validity: { status: 'blocked' } }, { slackTs: '' }]) {
    const d = deps({ isUntouched: () => assert.fail('protected card must not be queried') });
    const value = { ...queued, ...patch };
    assert.deepEqual((await refreshQueuedCommunityCards([value], [manual], d)).deals, [value]);
  }
  for (const live of [{ id: queued.id }, { id: 'other', url: `${url}?different=query` }]) {
    const d = deps({ liveDeals: [live], isUntouched: () => assert.fail('published card must not be changed') });
    assert.equal((await refreshQueuedCommunityCards([queued], [manual], d)).updated, 0);
  }
});
test('thread checks fail closed for reactions, humans, pagination, API errors and wrong IDs', () => {
  const messages = [{ ts: '1', bot_id: 'bot', text: 'header' }, { ts: '2', bot_id: 'bot', text: `Deal-ID: ${queued.id}\n${queued.title}` }];
  assert.equal(untouchedCommunityThread({ ok: true, messages }, queued, manual), true);
  for (const result of [{ ok: false, messages }, { ok: true, messages, has_more: true },
    { ok: true, messages, response_metadata: { next_cursor: 'next' } },
    { ok: true, messages: [...messages, { ts: '3', user: 'owner', text: 'edit' }] },
    { ok: true, messages: messages.map(m => ({ ...m, reactions: [{ name: 'white_check_mark' }] })) },
    { ok: true, messages: messages.map(m => ({ ...m, text: 'wrong card' })) }]) {
    assert.equal(untouchedCommunityThread(result, queued, manual), false);
  }
});
test('Slack failures never mutate or acknowledge the replacement; persistence errors remain failures', async () => {
  for (const override of [{ isUntouched: async () => false }, { isUntouched: async () => { throw Error('timeout'); } },
    { updateMessage: async () => false }, { updateMessage: async () => { throw Error('429'); } }]) {
    const d = deps(override);
    const result = await refreshQueuedCommunityCards([queued], [manual], d);
    assert.deepEqual(result.deals, [queued]);
    assert.deepEqual(postedCommunitySubmissionIds(result.deals), ['first']);
    assert.ok(!d.events.some(event => event[0] === 'persist'));
  }
  await assert.rejects(refreshQueuedCommunityCards([queued], [manual], deps({ persist: () => { throw Error('disk'); } })), /disk/);
  assert.deepEqual(postedCommunitySubmissionIds([{ ...manual, slackTs: '' }]), []);
});
test('alcohol and rejected-source content cannot bypass the discovery policy through a card update', async () => {
  const alcohol = new Map([[canonicalInstagramPostKey(url), { url, graphAccepted: true, caption: 'Wrap für 1 € und Bier gratis.' }]]);
  const d = deps({ graphEvidence: alcohol, isUntouched: () => assert.fail('excluded source must not update Slack') });
  assert.equal((await refreshQueuedCommunityCards([queued], [], d)).updated, 0);
});
test('refresh requests are bounded; integration precedes both duplicate filters and paid editor remains off', async () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ ...queued, id: `community:${i}`, submissionId: String(i) }));
  let checks = 0;
  const d = deps({ maxChecks: 3, isUntouched: async () => { checks++; return false; } });
  await refreshQueuedCommunityCards(many, [manual], d);
  assert.equal(checks, 3);
  assert.equal((await refreshQueuedCommunityCards(many, [manual], deps({ maxUpdates: 2 }))).updated, 2);
  const source = readFileSync(new URL('../scraper/slack-notify.js', import.meta.url), 'utf8');
  const main = source.slice(source.indexOf('async function main'));
  assert.ok(main.indexOf('await refreshQueuedCommunityCards(') < main.indexOf('filterRecentlySeenDeals('));
  assert.ok(main.indexOf('await refreshQueuedCommunityCards(') < main.indexOf('filterAlreadyQueuedDeals('));
  assert.ok(main.includes('persist: writePendingAll'));
  const workflow = readFileSync(new URL('../.github/workflows/daily-digest.yml', import.meta.url), 'utf8');
  assert.match(workflow, /DEAL_CARD_EDITOR_ENABLED: '0'/);
});

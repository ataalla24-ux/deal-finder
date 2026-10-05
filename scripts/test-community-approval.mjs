import assert from 'node:assert/strict';
import { advanceDealLifecycle } from '../scraper/deal-lifecycle.js';
import { prepareCommunityApproval } from '../scraper/community-review-utils.js';
import { validateDealsForSlack } from '../scraper/deal-validity-agent.js';
import { normalizeDealExpiry } from '../scraper/expiry-utils.js';
import { normalizeDealRecord } from '../scraper/deal-normalization-utils.js';
import { normalizeSocialDeal, buildStructuredSocialTitle } from '../scraper/normalize-live-deals.js';
import { validateApprovalCandidates, recoverTargetedCommunityDeal, retainBlockedApproval, prunePendingQueue } from '../scraper/slack-approve.js';
import { buildSlackMessage, mergePendingQueue, pruneStaleQueueDeals, revalidateRecentPostedQueue, filterDuplicateDealsInRun } from '../scraper/slack-notify.js';

const now = new Date('2026-10-05T12:46:00Z');
const source = {
  id: 'community:rando', submissionId: 'rando', originSource: 'community-submission', source: 'Community Submission',
  brand: 'Pizza Rando', title: '3 Döner zum Preis von 2', type: 'rabatt',
  description: 'Am 09.10 und 10.10 bei Kauf von 2 Dönern den 3. Döner gratis.',
  distance: 'Dresdnerstraße 115, 1200 Wien', address: 'Dresdnerstraße 115, 1200 Wien',
  url: 'https://www.tiktok.com/@pizzarando', expiresOriginal: '09.10 und 10.10',
  submittedAt: '2026-10-05T11:01:08Z', slackTs: '1791203010.645859', slackThreadTs: '1791203007.871219',
  missingFields: ['Ablauf', 'Aktionsdatum bestätigen'],
};
const approved = advanceDealLifecycle(source, 'manually-approved', { at: now, user: 'U_REVIEWER' });
const options = { now, concurrency: 1, inspectDealUrlHealth: async url => ({
  status: 403, transientError: true, reason: 'social-login', finalUrl: url, dateHints: {}, contentHints: {},
}) };
const prepared = prepareCommunityApproval(approved, now);
assert.equal(prepared.validFrom, '2026-10-09');
assert.equal(prepared.validUntil, '2026-10-10');
assert.equal(prepared.pubDate, undefined, 'human review must never invent a platform publication date');
assert.equal(prepared.communityDateReview.yearAnchoredToSubmission, true);
assert.deepEqual(prepared.missingFields, []);
assert.deepEqual(await normalizeDealExpiry(structuredClone(prepared), { now, allowUrlLookup: false }), prepared);
const validation = await validateApprovalCandidates([approved], options);
assert.equal(validation.allowedDeals.length, 1);
const normalizedValidated = await normalizeDealExpiry(structuredClone(validation.allowedDeals[0]), { now, allowUrlLookup: false });
assert.equal(normalizedValidated.validFrom, '2026-10-09');
assert.equal(normalizedValidated.validUntil, '2026-10-10', 'the later publication normalizer must preserve both reviewed days');
assert.equal((await validateDealsForSlack([prepared], options)).blockedDeals.length, 1, 'scraper validation does not inherit the approval exception');
assert.equal((await validateApprovalCandidates([source], options)).blockedDeals.length, 1, 'an unreviewed community submission cannot bypass freshness');

for (const patch of [
  { submittedAt: '2025-10-05T11:01:08Z' },
  { expiresOriginal: '09.10 und 20.10' },
  { expiresOriginal: '31.02.2026' },
  { expiresOriginal: 'ab 09.10.2026' },
  { expiresOriginal: 'heute' },
  { expiresOriginal: '09.01 und 10.01' },
  { expiresOriginal: '' },
]) {
  const result = await validateApprovalCandidates([{ ...approved, ...patch }], options);
  assert.equal(result.blockedDeals.length, 1, JSON.stringify(patch));
  assert.match(result.results[0].decision.reasons.join(' '), /Community-Aktionszeitraum unklar/);
}
for (const patch of [
  { validUntil: '2026-10-04', expires: '2026-10-04' },
  { originSource: 'instagram-scraper' },
  { url: 'https://www.thefork.at/restaurant/test' },
  { address: 'Berlin', distance: 'Berlin', description: 'Gratis Döner in Berlin' },
  { sourcePublishedAt: '2025-10-05T11:00:00Z', sourcePublishedAtSource: 'post.timestamp' },
]) assert.equal((await validateApprovalCandidates([{ ...approved, ...patch }], options)).blockedDeals.length, 1, JSON.stringify(patch));
const invalid = await validateApprovalCandidates([approved], { ...options, inspectDealUrlHealth: async () => ({ invalid: true, reason: 'HTTP 404' }) });
assert.match(invalid.results[0].decision.reasons.join(' '), /URL ungültig/);

const second = { ...source, id: 'community:rando-2', submissionId: 'rando-2', slackTs: '1791203011.645859' };
assert.equal(mergePendingQueue([source], [second]).length, 2);
assert.equal(mergePendingQueue([source], [source]).length, 1);
assert.equal(filterDuplicateDealsInRun([source, second]).deals.length, 1, 'avoid duplicate sends before they have Slack identities');
const event = { dealId: source.id, slackTs: source.slackTs, slackThreadTs: source.slackThreadTs };
const message = { ts: source.slackTs, thread_ts: source.slackThreadTs, user: 'BOT',
  text: '*Community-Einreichung – noch nicht geprüft*\n' + buildSlackMessage(source, 1) };
const recovered = recoverTargetedCommunityDeal(message, event, [source], 'BOT');
assert.equal(recovered.title, source.title, 'community heading is not the deal title');
assert.equal(recovered.expiresOriginal, source.expiresOriginal);
assert.equal(recovered.pubDate, '', 'Slack timestamps cannot masquerade as post timestamps');
const slackApiMessage = { ...message,
  text: message.text.replace(/\n/g, ' '),
  blocks: [{ type: 'section', text: { type: 'mrkdwn', text: message.text } }],
};
const recoveredBlocks = recoverTargetedCommunityDeal(slackApiMessage, event, [source], 'BOT');
assert.equal(recoveredBlocks.id, source.id, 'recover from Block Kit when Slack flattens the fallback text');
assert.equal(recoveredBlocks.url, source.url, 'preserve Slack angle-bracket links in blocks');
assert.equal(recoveredBlocks.type, 'bogo', 'a conditional free third item is not a fully free offer');
let polished = recoveredBlocks;
for (let i = 0; i < 3; i++) polished = normalizeDealRecord(normalizeSocialDeal(polished));
assert.equal(polished.title, source.title, 'publication polishing must not turn three-for-two into 1+1');
assert.equal(buildStructuredSocialTitle({ brand: 'Testcafe', type: 'bogo',
  title: '1+1 Kaffee zum kleinen Preis', description: 'Kaffee vor Ort' }), '1+1 Kaffee bei Testcafe', 'Preis must not be recognized as Eis');
assert.equal(recoverTargetedCommunityDeal({ ...message, user: 'USER' }, event, [source], 'BOT'), null);
assert.equal(recoverTargetedCommunityDeal(message, { ...event, dealId: 'wrong' }, [source], 'BOT'), null);

const fetchBefore = globalThis.fetch;
const calls = [];
try {
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return Response.json({ ok: true, ts: 'notice' });
  };
  const blocked = await retainBlockedApproval(approved, ['Aktionsdatum fehlt']);
  assert.equal(blocked.approvedAt, '');
  assert.equal(blocked.approvalBlock.noticeTs, 'notice');
  assert.equal(calls[0].body.thread_ts, source.slackThreadTs);
  assert.equal(calls[0].body.mrkdwn, false);
  await retainBlockedApproval(blocked, ['Aktionsdatum fehlt']);
  assert.equal(calls.length, 1, 'same failure does not spam the Slack thread');
  await retainBlockedApproval(blocked, ['Adresse fehlt']);
  assert.match(calls[1].url, /chat.update$/);
  const future = new Date('2027-01-01T00:00:00Z');
  assert.equal(prunePendingQueue([{ ...blocked, expires: '2020-01-01' }], future.getTime()).length, 1);
  assert.equal(pruneStaleQueueDeals([blocked], { now: future }).deals.length, 1);
  assert.equal((await revalidateRecentPostedQueue([blocked], options)).deals.length, 1);
  globalThis.fetch = async () => Response.json({ ok: false, error: 'ratelimited' });
  const retry = await retainBlockedApproval(approved, ['Test']);
  assert.equal(retry.approvalBlock.notifiedSignature, undefined, 'failed notices can be retried');
} finally { globalThis.fetch = fetchBefore; }
console.log('Community approval, date boundaries, recovery, queue retention and Slack feedback passed');

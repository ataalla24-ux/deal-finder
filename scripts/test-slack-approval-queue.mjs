import assert from 'node:assert/strict';
import { mergeDuplicateDealRecords } from '../scraper/deal-evidence-utils.js';
import { validateDealsForSlack } from '../scraper/deal-validity-agent.js';

const {
  normalizeDeal,
  pendingApprovalKey,
  prunePendingQueue,
  uniqueDealsByApprovalKey,
} = await import('../scraper/slack-approve.js');
const { normalizeDeal: normalizeForSlackNotify } = await import('../scraper/slack-notify.js');

const pending = normalizeDeal({
  id: 'pending-1',
  title: '20 % Pizza-Rabatt',
  url: 'https://www.instagram.com/p/AbC123/?utm_source=test',
  slackTs: '1784275200.000001',
}, { pending: true });
assert.equal(pending.pubDate, '');
assert.equal(pending.approvedAt, '');
assert.equal(pending.distance, '');
assert.deepEqual(pending.missingFields.sort(), ['Ablauf', 'Ort', 'Quelle'].sort());

const evidencePreserved = normalizeDeal({
  id: 'meta-evidence',
  title: 'Kaffee gratis',
  url: 'https://www.instagram.com/p/Evidence123/',
  source: 'Instagram',
  ownerUsername: 'testcafe',
  instagramHandle: 'testcafe',
  address: 'Neubaugasse 12, 1070 Wien',
  city: 'Wien',
  postalCode: '1070',
  viennaVerified: true,
  viennaEvidence: { verified: true, source: 'apify-location', detail: 'Neubaugasse 12, 1070 Wien' },
  validFrom: '2026-07-17',
  validUntil: '2026-07-20',
  expires: '2026-07-20',
  expirySource: 'apify-post-caption',
  dateConfidence: 'high',
}, { pending: false });
assert.equal(evidencePreserved.ownerUsername, 'testcafe');
assert.equal(evidencePreserved.address, 'Neubaugasse 12, 1070 Wien');
assert.equal(evidencePreserved.validUntil, '2026-07-20');
assert.equal(evidencePreserved.dateConfidence, 'high');
assert.deepEqual(evidencePreserved.viennaEvidence, { verified: true, source: 'apify-location', detail: 'Neubaugasse 12, 1070 Wien' });

const firecrawlNormalized = normalizeForSlackNotify({
  title: '20 % Rabatt – Firecrawl deal',
  url: 'https://www.instagram.com/p/FirecrawlCompat/',
  source: 'Firecrawl Instagram Gastro #5',
  pubDate: '2026-07-17T08:00:00.000Z',
  pubDateSource: 'firecrawlAgentRun',
  expires: '2026-07-17',
  distance: 'Wien',
}, 'firecrawl5');
assert.equal(firecrawlNormalized.pubDate, '2026-07-17T08:00:00.000Z', 'Slack normalization preserves Firecrawl publication compatibility');
assert.equal(firecrawlNormalized.expires, '2026-07-17', 'date-only expiries must not become midnight timestamps');

const duplicateFirecrawl = mergeDuplicateDealRecords([
  firecrawlNormalized,
  {
    ...firecrawlNormalized,
    id: 'firecrawl-second-source',
    source: 'Firecrawl Instagram Direct #4',
    originSource: 'Firecrawl Instagram Direct #4',
    description: 'Richer duplicate description: 20 % Rabatt in Wien.',
  },
]).deals[0];
assert.equal(duplicateFirecrawl.pubDate, '2026-07-17T08:00:00.000Z', 'cross-Firecrawl dedupe preserves the legacy publication date');
const duplicateFirecrawlValidation = await validateDealsForSlack([duplicateFirecrawl], {
  now: new Date('2026-07-17T12:00:00.000Z'),
  maxAgeDays: 7,
  inspectDealUrlHealth: async (url) => ({ status: 200, finalUrl: url, dateHints: {}, contentHints: {} }),
});
assert.equal(duplicateFirecrawlValidation.summary.allowed, 1, 'dedupe must not make a Firecrawl deal fail its compatibility path');

const weakDailySyncDuplicate = normalizeForSlackNotify({
  ...firecrawlNormalized,
  id: 'daily-sync-overlap',
  source: 'Instagram Web',
  originSource: 'instagram-daily-sync',
  pubDateSource: 'profileTimeline',
}, 'instagram-web');
const mixedFirecrawlDuplicate = mergeDuplicateDealRecords([
  firecrawlNormalized,
  weakDailySyncDuplicate,
]).deals[0];
assert.match(mixedFirecrawlDuplicate.sourceKeys.join(' '), /firecrawl/i);
assert.equal(mixedFirecrawlDuplicate.pubDate, '2026-07-17T08:00:00.000Z');
const mixedFirecrawlValidation = await validateDealsForSlack([mixedFirecrawlDuplicate], {
  now: new Date('2026-07-17T12:00:00.000Z'),
  maxAgeDays: 7,
  inspectDealUrlHealth: async (url) => ({ status: 200, finalUrl: url, dateHints: {}, contentHints: {} }),
});
assert.equal(mixedFirecrawlValidation.summary.allowed, 1, 'a weak daily-sync duplicate must not disable Firecrawl compatibility');

const duplicateA = normalizeDeal({
  id: 'source-a',
  title: 'Pizza Deal',
  description: '20 % Rabatt',
  url: 'https://www.instagram.com/p/AbC123/?igsh=test',
  pubDate: '2026-07-17T08:00:00.000Z',
  pubDateSource: 'instagramGraphTimestamp',
  expires: '2026-07-20T23:59:59.999Z',
  qualityScore: 90,
  slackTs: '1784275200.000002',
}, { pending: true });
const duplicateB = normalizeDeal({
  id: 'source-b',
  title: 'Pizza Deal Wien',
  description: '20 % Rabatt auf alle Pizzen in 1070 Wien',
  url: 'https://instagram.com/reel/AbC123/',
  sourcePublishedAt: '2026-07-17T08:00:00.000Z',
  sourcePublishedAtSource: 'apifyPostMetadata',
  validUntil: '2026-07-25T23:59:59.999Z',
  expires: '2026-07-25T23:59:59.999Z',
  postalCode: '1070',
  qualityScore: 95,
  slackTs: '1784275200.000003',
}, { pending: true });
assert.equal(pendingApprovalKey(duplicateA), 'slack:1784275200.000002');
assert.equal(pendingApprovalKey(duplicateB), 'slack:1784275200.000003');
const merged = uniqueDealsByApprovalKey([duplicateA, duplicateB]);
assert.equal(merged.length, 2, 'each posted Slack message must remain addressable for reactions');

const unpostedMerged = uniqueDealsByApprovalKey([
  { ...duplicateA, slackTs: '' },
  { ...duplicateB, slackTs: '' },
]);
assert.equal(unpostedMerged.length, 1, 'unposted source duplicates still merge by canonical post');
assert.equal(unpostedMerged[0].expires, '2026-07-25T23:59:59.999Z');

const now = Date.parse('2026-07-17T12:00:00.000Z');
const freshSlackTs = String(now / 1000);
const secondFreshSlackTs = String(now / 1000 + 0.001);
const thirdFreshSlackTs = String(now / 1000 + 0.002);
const fourthFreshSlackTs = String(now / 1000 + 0.003);
const staleSlackTs = String((now - 20 * 24 * 60 * 60 * 1000) / 1000);
const pruned = prunePendingQueue([
  { id: 'fresh', title: 'Fresh', url: 'https://example.com/fresh', slackTs: freshSlackTs, expires: '2026-07-18T23:59:59.999Z' },
  { id: 'expired', title: 'Expired', url: 'https://example.com/expired', slackTs: secondFreshSlackTs, expires: '2026-07-16T23:59:59.999Z' },
  { id: 'stale', title: 'Stale', url: 'https://example.com/stale', slackTs: staleSlackTs, expires: '2026-08-01T23:59:59.999Z' },
  { id: 'same-day', title: 'Same day', url: 'https://example.com/same-day', slackTs: thirdFreshSlackTs, expires: '2026-07-17' },
  { id: 'same-day-midnight', title: 'Same day midnight', url: 'https://example.com/same-day-midnight', slackTs: fourthFreshSlackTs, expires: '2026-07-17T00:00:00.000Z' },
], now);
assert.deepEqual(pruned.map((deal) => deal.id), ['fresh', 'same-day', 'same-day-midnight']);

console.log('slack approval queue tests passed');

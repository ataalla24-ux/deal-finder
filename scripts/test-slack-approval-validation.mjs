import assert from 'node:assert/strict';

import {
  applySlackEdits,
  dedupeApprovedDeals,
  filterAlreadyLiveFallbackDeals,
  mergeParsedDealsWithQueue,
  normalizeDeal as normalizeApprovalDeal,
  normalizePendingDeal,
  validateApprovalCandidates,
} from '../scraper/slack-approve.js';
import { extractDealsFromThreadMessages, parseDigestDealMessage } from '../scraper/slack-digest-utils.js';
import { buildSlackMessage } from '../scraper/slack-notify.js';

const now = new Date('2026-07-20T12:00:00.000Z');

const roundTripMessage = buildSlackMessage({
  id: 'future-social-roundtrip',
  brand: 'Example Pop-up',
  title: 'Gratis Drink beim Pop-up',
  description: 'Gratis Drink am Rathausplatz, 1010 Wien, solange der Vorrat reicht.',
  url: 'https://www.tiktok.com/@example/video/7678002441849425155',
  category: 'kaffee',
  type: 'gratis',
  distance: 'Rathausplatz, 1010 Wien',
  originSource: 'tiktok-deals-scanner',
  pubDate: '2026-07-20T08:00:00.000Z',
  validFrom: '2026-07-24',
  validUntil: '2026-07-27',
}, 1);
const parsedRoundTrip = parseDigestDealMessage({
  text: roundTripMessage,
  ts: '1784550000.100',
  thread_ts: '1784550000.000',
});
assert.match(parsedRoundTrip.description, /Gratis Drink am Rathausplatz/);
assert.match(parsedRoundTrip.validFrom, /^2026-07-24/);
assert.match(parsedRoundTrip.validUntil, /^2026-07-27/);
assert.equal(parsedRoundTrip.url, 'https://www.tiktok.com/@example/video/7678002441849425155');
assert.equal(parsedRoundTrip.postalCode, '1010');
assert.equal(parsedRoundTrip.sourcePublishedAtSource, 'slack.digest-validated-source-date');

const ambiguousDmyRoundTrip = parseDigestDealMessage({
  text: buildSlackMessage({
    ...parsedRoundTrip,
    id: 'ambiguous-dmy-roundtrip',
    validFrom: '2026-09-11',
    validUntil: '2026-09-11',
  }, 1),
  ts: '1784550000.200',
  thread_ts: '1784550000.000',
});
assert.match(ambiguousDmyRoundTrip.validFrom, /^2026-09-11/, '11.09 must remain 11 September after Slack parsing');
assert.match(ambiguousDmyRoundTrip.validUntil, /^2026-09-11/, 'an ambiguous DMY end date must not become November 9');

const legacyMessageWithoutLink = roundTripMessage
  .split('\n')
  .filter((line) => !line.includes('Direktlink:') && !line.startsWith('📝'))
  .join('\n');
const [legacyRecoveredFromQueue] = extractDealsFromThreadMessages([{
  text: legacyMessageWithoutLink,
  ts: '1784550000.300',
  thread_ts: '1784550000.000',
}], {
  pendingQueue: [{
    ...parsedRoundTrip,
    description: 'Vollständige Beschreibung aus der Queue.',
    distance: 'Rathausplatz, 1010 Wien',
    slackTs: '1784550000.300',
  }],
});
assert.equal(legacyRecoveredFromQueue.url, parsedRoundTrip.url, 'legacy Slack messages recover their target URL from the queue');
assert.equal(legacyRecoveredFromQueue.description, 'Vollständige Beschreibung aus der Queue.');
assert.equal(legacyRecoveredFromQueue.distance, 'Rathausplatz, 1010 Wien');

const [metadataPreserved] = mergeParsedDealsWithQueue([
  { ...parsedRoundTrip, title: 'Vom Slack-Text korrigierter Titel', slackTs: '1784550000.100' },
], [{
  ...parsedRoundTrip,
  slackTs: '1784550000.100',
  socialFoodReview: true,
  sourceAccountType: 'creator',
  scoutUsername: 'foodiewien',
  merchantUsername: 'testcafe',
  pipelineLifecycle: { version: 1, stage: 'slack-sent', slackSentAt: now.toISOString() },
}]);
assert.equal(metadataPreserved.title, 'Vom Slack-Text korrigierter Titel');
assert.equal(metadataPreserved.socialFoodReview, true);
assert.equal(metadataPreserved.scoutUsername, 'foodiewien');
assert.equal(metadataPreserved.merchantUsername, 'testcafe');
assert.equal(metadataPreserved.pipelineLifecycle.stage, 'slack-sent');

const alreadyLiveFallback = filterAlreadyLiveFallbackDeals([
  { ...parsedRoundTrip, slackTs: '1784550000.100' },
  { ...parsedRoundTrip, slackTs: '1784550000.200' },
  {
    ...parsedRoundTrip,
    slackTs: '1784550000.300',
    title: 'Gratis Drink plus Snack beim Pop-up',
    editedInSlack: true,
    slackEditedFields: ['title'],
  },
  {
    id: 'new-campaign-on-shared-page',
    brand: 'Cafe Example',
    title: '20% Rabatt auf das Abendessen',
    url: 'https://cafe.example/angebote',
    slackTs: '1784550000.400',
  },
  {
    id: 'cross-posted-live-promotion',
    brand: 'Example Pop-up',
    title: 'Gratis Drink beim Pop-up',
    url: 'https://www.instagram.com/reel/CROSSPOSTED/',
    slackTs: '1784550000.500',
  },
], [
  { ...parsedRoundTrip, slackTs: '1784550000.200' },
  { ...parsedRoundTrip, slackTs: '1784550000.300', editedInSlack: true, slackEditedFields: ['title'] },
  {
    id: 'new-campaign-on-shared-page',
    brand: 'Cafe Example',
    title: '20% Rabatt auf das Abendessen',
    url: 'https://cafe.example/angebote',
    slackTs: '1784550000.400',
  },
  {
    id: 'cross-posted-live-promotion',
    brand: 'Example Pop-up',
    title: 'Gratis Drink beim Pop-up',
    url: 'https://www.instagram.com/reel/CROSSPOSTED/',
    slackTs: '1784550000.500',
  },
], [
  { ...parsedRoundTrip, slackTs: '1784540000.100', approvedAt: now.toISOString() },
  {
    id: 'old-campaign-on-shared-page',
    brand: 'Cafe Example',
    title: '10% Rabatt auf das Frühstück',
    url: 'https://cafe.example/angebote',
    approvedAt: now.toISOString(),
  },
]);
assert.deepEqual(
  alreadyLiveFallback.deals.map((deal) => deal.slackTs),
  ['1784550000.300', '1784550000.400'],
  'exact duplicates are skipped, while explicit edits and genuinely changed campaigns remain eligible',
);
assert.equal(alreadyLiveFallback.removed.length, 3, 'an identical cross-platform title and merchant is already live');

const [preferredCrossPost] = dedupeApprovedDeals([
  {
    ...parsedRoundTrip,
    id: 'complete-existing-post',
    description: 'Gratis Drink am Rathausplatz, 1010 Wien.',
    distance: 'Rathausplatz, 1010 Wien',
    validUntil: '2026-07-27',
    missingFields: [],
    approvedAt: '2026-07-20T09:00:00.000Z',
    viennaVerified: true,
  },
  {
    ...parsedRoundTrip,
    id: 'newer-incomplete-cross-post',
    description: 'Gratis Drink in Wien.',
    distance: 'Wien',
    url: 'https://www.instagram.com/reel/CROSSPOSTED/',
    missingFields: ['Ort'],
    approvedAt: '2026-07-20T11:00:00.000Z',
    viennaVerified: true,
  },
]);
assert.equal(
  preferredCrossPost.id,
  'complete-existing-post',
  'semantic cross-post dedupe must preserve stronger evidence instead of blindly preferring a newer approval',
);

const normalizedPending = normalizeApprovalDeal({
  id: 'pending-without-approval',
  brand: 'Wien Café',
  title: '1+1 Kaffee gratis',
  description: '1+1 Kaffee gratis in 1070 Wien.',
  url: 'https://example.com/pending',
  source: 'Instagram AI',
  originSource: 'instagram-ai-agent',
  distance: '1070 Wien',
  slackTs: '1784550000.123',
  sourcePublishedAt: '2026-07-20T08:00:00.000Z',
  sourcePublishedAtSource: 'post.timestamp',
  validUntil: '2026-07-31',
  dateConfidence: 'high',
  viennaEvidence: { verified: true, type: 'address' },
});

assert.equal(normalizedPending.approvedAt, '', 'loading a pending deal must not invent approvedAt');
assert.equal(normalizedPending.sourcePublishedAt, '2026-07-20T08:00:00.000Z');
assert.equal(normalizedPending.sourcePublishedAtSource, 'post.timestamp');
assert.equal(normalizedPending.validUntil, '2026-07-31');
assert.deepEqual(normalizedPending.viennaEvidence, { verified: true, type: 'address' });
assert.ok(!normalizedPending.missingFields.includes('Ablauf'));

const normalizedResolvedEvidence = normalizeApprovalDeal({
  ...normalizedPending,
  missingFields: ['Ablauf', 'Ort', 'Manuelle Preisprüfung'],
});
assert.deepEqual(
  normalizedResolvedEvidence.missingFields,
  ['Manuelle Preisprüfung'],
  'resolved standard fields must not keep stale warnings, while custom review notes survive',
);

const normalizedMissingEvidence = normalizeApprovalDeal({
  id: 'pending-without-date-or-place',
  brand: 'Example Café',
  title: '1+1 Kaffee gratis',
  description: '1+1 Kaffee gratis.',
  url: 'https://example.com/missing-evidence',
  source: 'Official',
  slackTs: '1784550001.123',
});
assert.equal(normalizedMissingEvidence.pubDate, '', 'approval normalization must not invent a fresh publication date');
assert.equal(normalizedMissingEvidence.distance, '', 'approval normalization must not invent Vienna as the location');
assert.ok(normalizedMissingEvidence.missingFields.includes('Ort'));

const reviewedFirecrawlEdit = applySlackEdits([
  {
    id: 'manual-firecrawl-review',
    order: 1,
    brand: 'Wien Café',
    title: '1+1 Kaffee gratis',
    description: '1+1 Kaffee gratis nach manueller Prüfung.',
    url: 'https://www.instagram.com/wiencafe/',
    source: 'Firecrawl Food #2',
    originSource: 'Firecrawl Food #2',
    distance: 'Wien',
    firecrawlReview: true,
  },
], [{
  ts: '1784550002.123',
  text: 'edit 1 datum: 20.07.2026 | ablauf: 31.07.2026 | ort: 1070 Wien',
}]);
assert.equal(reviewedFirecrawlEdit.appliedCount, 1, 'plain Slack edit replies must be applied');
const reviewedFirecrawlDeal = reviewedFirecrawlEdit.deals[0];
assert.match(reviewedFirecrawlDeal.pubDate, /^2026-07-20/);
assert.equal(reviewedFirecrawlDeal.sourcePublishedAt, reviewedFirecrawlDeal.pubDate);
assert.equal(reviewedFirecrawlDeal.sourcePublishedAtSource, 'slack.human-review');
assert.equal(reviewedFirecrawlDeal.pubDateSource, 'slack.human-review');
assert.match(reviewedFirecrawlDeal.expires, /^2026-07-31/);
assert.match(reviewedFirecrawlDeal.validUntil, /^2026-07-31/);
assert.equal(reviewedFirecrawlDeal.expirySource, 'slack.human-review');
assert.equal(reviewedFirecrawlDeal.distance, '1070 Wien');

const reviewedFirecrawlValidation = await validateApprovalCandidates([reviewedFirecrawlDeal], {
  now,
  concurrency: 1,
  inspectDealUrlHealth: async (url) => ({
    status: 200,
    finalUrl: url,
    dateHints: {},
    contentHints: {},
  }),
});
assert.deepEqual(
  reviewedFirecrawlValidation.allowedDeals.map((deal) => deal.id),
  ['manual-firecrawl-review'],
  'a human-reviewed Firecrawl candidate must become approvable after factual edits',
);

const cleanedPollutedPending = normalizePendingDeal({
  ...normalizedPending,
  approvedAt: '2026-07-20T10:00:00.000Z',
});
assert.equal(cleanedPollutedPending.approvedAt, '', 'pending queue membership must clear legacy false approvals');

const validation = await validateApprovalCandidates([
  {
    ...normalizedPending,
    id: 'expired-before-approval',
    url: 'https://example.com/expired-before-approval',
    validUntil: '2026-07-18',
    expires: '2026-07-18',
  },
  {
    ...normalizedPending,
    id: 'active-at-approval',
    url: 'https://example.com/active-at-approval',
    validUntil: '2026-07-31',
    expires: '2026-07-31',
  },
  {
    ...normalizedPending,
    id: 'social-without-real-post-date',
    brand: 'Wien Café',
    title: '1+1 Kaffee gratis',
    description: '1+1 Kaffee gratis in 1070 Wien.',
    url: 'https://www.instagram.com/wiencafe/',
    source: 'Slack Digest',
    originSource: 'Firecrawl Social',
    sourcePublishedAt: '',
    sourcePublishedAtSource: '',
    pubDate: '2026-07-20T08:00:00.000Z',
    pubDateSource: 'firecrawlAgentRun',
    expires: '',
    expiresOriginal: '',
    expiryDisplayText: '',
    validOn: '',
    validFrom: '',
    validUntil: '',
  },
  {
    ...normalizedPending,
    ...normalizedMissingEvidence,
    id: 'deal-without-vienna-evidence',
    pubDate: '2026-07-20T08:00:00.000Z',
    pubDateSource: 'time.datetime',
    validUntil: '2026-07-31',
    expires: '2026-07-31',
  },
], {
  now,
  concurrency: 1,
  inspectDealUrlHealth: async (url) => ({
    status: 200,
    finalUrl: url,
    dateHints: {},
    contentHints: {},
  }),
});

assert.deepEqual(validation.blockedDeals.map((deal) => deal.id), [
  'expired-before-approval',
  'social-without-real-post-date',
  'deal-without-vienna-evidence',
]);
assert.deepEqual(validation.allowedDeals.map((deal) => deal.id), ['active-at-approval']);
assert.match(validation.results[0].decision.reasons.join(' | '), /abgelaufen \(2026-07-18\)/);
assert.match(validation.results[2].decision.reasons.join(' | '), /kein echtes Social-Post-Datum/);
assert.match(validation.results[3].decision.reasons.join(' | '), /nicht eindeutig in Wien/);

console.log('slack approval validation ok');

import assert from 'node:assert/strict';

import {
  normalizeDeal as normalizeApprovalDeal,
  normalizePendingDeal,
  validateApprovalCandidates,
} from '../scraper/slack-approve.js';

const now = new Date('2026-07-20T12:00:00.000Z');

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

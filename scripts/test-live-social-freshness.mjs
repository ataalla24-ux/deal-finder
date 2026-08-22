import assert from 'node:assert/strict';

import { getSocialPostFreshnessRemovalReason } from '../scraper/normalize-live-deals.js';

const now = new Date('2026-08-22T12:00:00.000Z');
const oldWithFutureOffer = {
  id: 'old-social-with-future-offer',
  url: 'https://www.instagram.com/reel/OldButActive123/',
  pubDate: '2026-08-10T12:00:00.000Z',
  pubDateSource: 'instagram-graph-timestamp',
  sourcePublishedAt: '2026-08-10T12:00:00.000Z',
  sourcePublishedAtSource: 'instagram-graph-timestamp',
  validFrom: '2026-08-25T00:00:00.000Z',
  validUntil: '2026-09-15T23:59:59.999Z',
  expires: '2026-09-15T23:59:59.999Z',
};

assert.match(
  getSocialPostFreshnessRemovalReason(oldWithFutureOffer, now),
  /Social-Post älter als 7 Tage/,
  'future validity must not rescue an old social post in the live feed',
);

assert.equal(getSocialPostFreshnessRemovalReason({
  ...oldWithFutureOffer,
  id: 'fresh-social-with-future-offer',
  pubDate: '2026-08-20T12:00:00.000Z',
  sourcePublishedAt: '2026-08-20T12:00:00.000Z',
}, now), '', 'a fresh post announcing a future offer remains valid');

assert.equal(getSocialPostFreshnessRemovalReason({
  ...oldWithFutureOffer,
  id: 'synthetic-firecrawl-date',
  pubDateSource: 'firecrawlAgentRun',
  sourcePublishedAtSource: 'firecrawlAgentRun',
  source: 'Firecrawl Instagram',
}, now), '', 'a synthetic crawler run time must not masquerade as a reliable social publication date');

console.log('live social freshness tests passed');

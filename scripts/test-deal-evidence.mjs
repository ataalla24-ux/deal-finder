import assert from 'node:assert/strict';

import {
  canonicalDealUrl,
  canonicalInstagramPostKey,
  extractInstagramProfileUsername,
  extractStructuredOwnerUsername,
  getPublicationEvidence,
  getViennaEvidence,
  mergeDuplicateDealRecords,
} from '../scraper/deal-evidence-utils.js';
import { getIndependentViennaEvidence } from '../scraper/build-instagram-merchant-registry.js';

const shortcode = 'ABC_123-xY';
assert.equal(
  canonicalInstagramPostKey(`https://www.instagram.com/p/${shortcode}/?igsh=tracking`),
  'instagram:ABC_123-xY'
);
assert.equal(
  canonicalInstagramPostKey(`https://m.instagram.com/reel/${shortcode}?utm_source=test`),
  'instagram:ABC_123-xY',
  'post and reel variants of the same shortcode share one identity'
);
assert.equal(
  canonicalInstagramPostKey(`https://www.instagram.com/accounts/login/?next=%2Freels%2F${shortcode}%2F`),
  'instagram:ABC_123-xY',
  'login redirect URLs resolve to their underlying post'
);
assert.notEqual(
  canonicalInstagramPostKey('https://instagram.com/p/ABC/'),
  canonicalInstagramPostKey('https://instagram.com/p/abc/'),
  'case-sensitive Instagram shortcodes must not collide'
);
assert.equal(
  canonicalDealUrl('https://www.facebook.com/ads/library/?id=998877&access_token=secret&utm_source=test'),
  'meta-ad:998877',
);
assert.equal(
  canonicalDealUrl('https://facebook.com/ads/archive/render_ad/?id=998877&tracking=other'),
  'meta-ad:998877',
);
assert.notEqual(
  canonicalDealUrl('https://www.facebook.com/ads/library/?id=998877'),
  canonicalDealUrl('https://www.facebook.com/ads/library/?id=112233'),
  'different Meta ads must never collapse to one seen key',
);

assert.equal(extractInstagramProfileUsername('https://instagram.com/cafe_wien/'), 'cafe_wien');
assert.equal(extractInstagramProfileUsername(`https://instagram.com/p/${shortcode}/`), '', 'post paths never become merchant usernames');
assert.equal(extractStructuredOwnerUsername({ owner: { username: '@Cafe_Wien' } }), 'cafe_wien');
assert.equal(extractStructuredOwnerUsername({ instagramHandle: '@Cafe_Wien' }), 'cafe_wien');

const crawlerTimestamp = getPublicationEvidence({
  pubDate: '2026-07-17T08:00:00.000Z',
  pubDateSource: 'firecrawlAgentRun',
});
assert.equal(crawlerTimestamp.sourcePublishedAt, '', 'crawler run time is not a source publication time');
assert.equal(crawlerTimestamp.discoveredAt, '2026-07-17T08:00:00.000Z', 'crawler run time remains available as discovery evidence');

const copiedCrawlerTimestamp = getPublicationEvidence({
  sourcePublishedAt: '2026-07-17T08:00:00.000Z',
  sourcePublishedAtSource: 'firecrawlAgentRun',
});
assert.equal(copiedCrawlerTimestamp.sourcePublishedAt, '', 'copying a crawler run time into a stronger field must not launder it');
assert.equal(copiedCrawlerTimestamp.discoveredAt, '2026-07-17T08:00:00.000Z');

const normalizedSocialTimestamp = getPublicationEvidence({
  pubDate: '2026-07-16T11:30:00.000Z',
  pubDateSource: 'socialPostDate',
});
assert.equal(normalizedSocialTimestamp.publicationEvidenceRank, 2, 'a generic normalized social date stays weak evidence');

const metaBusinessTimestamp = getPublicationEvidence({
  sourcePublishedAt: '2026-07-16T11:30:00.000Z',
  sourcePublishedAtSource: 'meta-business-discovery-timestamp',
});
assert.ok(metaBusinessTimestamp.publicationEvidenceRank >= 4, 'Meta Business Discovery timestamps are trusted source evidence');

const strongerPostTimestamp = getPublicationEvidence({
  sourcePublishedAt: '2026-07-17T08:00:00.000Z',
  sourcePublishedAtSource: 'socialPostDate',
  postTimestamp: '2026-07-16T11:30:00.000Z',
  postTimestampSource: 'apify-post-timestamp',
});
assert.equal(strongerPostTimestamp.sourcePublishedAt, '2026-07-16T11:30:00.000Z');
assert.ok(strongerPostTimestamp.publicationEvidenceRank >= 4, 'the strongest timestamp wins regardless of field order');

const sourceTimestamp = getPublicationEvidence({
  timestamp: '2026-07-16T11:30:00.000Z',
  discoveredAt: '2026-07-17T08:00:00.000Z',
});
assert.equal(sourceTimestamp.sourcePublishedAt, '2026-07-16T11:30:00.000Z');
assert.equal(sourceTimestamp.discoveredAt, '2026-07-17T08:00:00.000Z');

assert.equal(getViennaEvidence({ distance: 'Wien' }).hasViennaEvidence, false, 'generic distance defaults are not Vienna proof');
assert.equal(getViennaEvidence({ address: 'Neubaugasse 12, 1070 Wien' }).hasViennaEvidence, true);
assert.equal(getViennaEvidence({
  viennaEvidence: { verified: true, source: 'meta-target-location', detail: 'Vienna' },
}).hasViennaEvidence, true, 'verified Meta targeting is accepted as structured Vienna evidence');
assert.equal(
  getViennaEvidence({ ownerUsername: 'cafe_wien' }, { registryUsernames: new Set(['cafe_wien']) }).type,
  'verified-registry'
);
assert.equal(getIndependentViennaEvidence({
  city: 'Wien',
  distance: 'Wien',
  viennaVerified: true,
  viennaEvidence: { verified: true, source: 'verified-account-handle', detail: '@cafe_wien' },
  evidence: {
    viennaEvidence: { verified: true, source: 'verified-account-handle', detail: '@cafe_wien' },
  },
}).hasViennaEvidence, false, 'account-derived synthetic location cannot verify its own registry entry');

const duplicates = mergeDuplicateDealRecords([
  {
    title: 'Gratis Kaffee',
    url: `https://instagram.com/p/${shortcode}/?igsh=old`,
    pubDate: '2026-07-17T08:00:00.000Z',
    pubDateSource: 'firecrawlAgentRun',
    discoveredAt: '2026-07-17T08:00:00.000Z',
    qualityScore: 95,
    source: 'discovery',
  },
  {
    title: 'Gratis Kaffee bis Monatsende',
    description: 'Ein zweiter Kaffee ist gratis.',
    url: `https://instagram.com/reel/${shortcode}/`,
    ownerUsername: 'cafe_wien',
    sourcePublishedAt: '2026-07-16T11:30:00.000Z',
    address: 'Neubaugasse 12, 1070 Wien',
    expires: '2026-07-31T23:59:59.999Z',
    qualityScore: 80,
    source: 'meta-instagram',
  },
], { now: new Date('2026-07-17T12:00:00.000Z') });

assert.equal(duplicates.duplicateCount, 1);
assert.equal(duplicates.deals.length, 1);
assert.equal(duplicates.deals[0].sourcePublishedAt, '2026-07-16T11:30:00.000Z', 'real source date beats higher-scored discovery time');
assert.equal(duplicates.deals[0].discoveredAt, '2026-07-17T08:00:00.000Z');
assert.equal(duplicates.deals[0].expires, '2026-07-31T23:59:59.999Z');
assert.equal(duplicates.deals[0].viennaVerified, true);
assert.deepEqual(new Set(duplicates.deals[0].evidenceSources), new Set(['discovery', 'meta-instagram']));

const conflictingExpiry = mergeDuplicateDealRecords([
  {
    title: 'Gratis Kaffee',
    url: 'https://instagram.com/p/EXPIRY_CONFLICT/',
    sourcePublishedAt: '2026-07-16T11:30:00.000Z',
    sourcePublishedAtSource: 'instagram-graph-timestamp',
    expires: '2026-07-10T23:59:59.999Z',
    expiresSource: 'weak-import',
  },
  {
    title: 'Gratis Kaffee bis Monatsende',
    url: 'https://instagram.com/reel/EXPIRY_CONFLICT/',
    expires: '2026-07-10T23:59:59.999Z',
    expiresSource: 'weak-import',
    validUntil: '2026-07-31T23:59:59.999Z',
    expirySource: 'meta-business-discovery',
  },
], { now: new Date('2026-07-17T12:00:00.000Z') }).deals[0];
assert.equal(conflictingExpiry.validUntil, '2026-07-31T23:59:59.999Z');
assert.equal(conflictingExpiry.expires, '2026-07-31T23:59:59.999Z');
assert.notEqual(conflictingExpiry.expires, '2026-07-10T23:59:59.999Z', 'stale conflicting expiry fields must be cleared');

const explicitExpiredBeatsFallback = mergeDuplicateDealRecords([
  {
    title: 'Gratis Kaffee',
    url: 'https://instagram.com/p/EXPIRED_EXPLICIT/',
    validUntil: '2026-07-10T23:59:59.999Z',
    expirySource: 'meta-business-discovery',
    dateConfidence: 'high',
  },
  {
    title: 'Gratis Kaffee',
    url: 'https://instagram.com/reel/EXPIRED_EXPLICIT/',
    expires: '2026-12-31T23:59:59.999Z',
    expiresSource: 'fallback',
    dateConfidence: 'low',
  },
], { now: new Date('2026-07-17T12:00:00.000Z') }).deals[0];
assert.equal(explicitExpiredBeatsFallback.expires, '2026-07-10T23:59:59.999Z', 'strong expired evidence must not be revived by a weak future fallback');

const explicitExpiredBeatsReviewTtl = mergeDuplicateDealRecords([
  {
    title: 'Gratis Kaffee',
    url: 'https://instagram.com/p/EXPIRED_TTL/',
    validUntil: '2026-07-10T23:59:59.999Z',
    expirySource: 'content-date',
    dateConfidence: 'high',
  },
  {
    title: 'Gratis Kaffee',
    url: 'https://instagram.com/reel/EXPIRED_TTL/',
    validUntil: '2026-07-20T23:59:59.999Z',
    expirySource: 'short-review-ttl',
    expiryKind: 'review-ttl',
    dateConfidence: 'low',
  },
], { now: new Date('2026-07-17T12:00:00.000Z') }).deals[0];
assert.equal(explicitExpiredBeatsReviewTtl.expires, '2026-07-10T23:59:59.999Z', 'a low-confidence review TTL must not override an explicit expired caption date');

console.log('Deal evidence regression tests passed.');

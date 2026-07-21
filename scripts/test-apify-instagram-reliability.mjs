import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildShardedActorInput,
  classifyApifyRunHealth,
  normalizeApifyItem,
  selectAccountShard,
  toIso,
} from '../scraper/import-apify-instagram-deals.js';
import {
  calendarDateKeyInVienna,
  extractCaptionDateRange,
  inferCaptionDateYear,
  isCalendarDateAfter,
  relativeCaptionValidity,
  stripInstagramMetaDescriptionPrefix,
} from '../apify/instagram-vienna-food-offers/src/validity-utils.js';

const now = new Date('2026-07-17T12:00:00.000Z');
const testDir = path.dirname(fileURLToPath(import.meta.url));
const actorSource = fs.readFileSync(path.join(testDir, '..', 'apify', 'instagram-vienna-food-offers', 'src', 'main.js'), 'utf8');

assert.doesNotMatch(actorSource, /postPublishedAt\s*:\s*new Date\s*\(/, 'actor must never manufacture a publication timestamp');
assert.match(actorSource, /missingRealPostTimestamp/, 'actor must reject records without real Instagram timestamps');
const captionCandidateBlock = actorSource.match(/const captionCandidates\s*=\s*\[[\s\S]*?\.filter\(Boolean\);/)?.[0] || '';
assert.ok(captionCandidateBlock, 'caption candidate block must remain inspectable');
assert.doesNotMatch(captionCandidateBlock, /snapshot\.bodyText/, 'generic Instagram page chrome/body text must not become deal-classification caption evidence');
assert.equal(
  stripInstagramMetaDescriptionPrefix('123 likes, 4 comments - vienna.coffee on Instagram: Heute 20 % Rabatt auf Pizza'),
  'Heute 20 % Rabatt auf Pizza',
  'Instagram metadata/byline must not leak a Vienna-like username into location evidence',
);

const oldToday = relativeCaptionValidity(
  'Nur heute: Burger 1+1',
  now,
  '2026-07-12T08:00:00.000Z',
);
assert.equal(oldToday.validUntil, '2026-07-12T23:59:59.999Z', 'relative validity is anchored to the post day, not each crawl');
assert.ok(Date.parse(oldToday.validUntil) < now.getTime());
const oldTomorrow = relativeCaptionValidity(
  'Nur morgen: Burger 1+1',
  now,
  '2026-07-12T08:00:00.000Z',
);
assert.equal(oldTomorrow.validUntil, '2026-07-13T23:59:59.999Z');
assert.equal(inferCaptionDateYear(0, 5, new Date('2026-07-17T12:00:00.000Z')), 2026, 'old January dates stay expired in summer');
assert.equal(inferCaptionDateYear(0, 5, new Date('2026-12-17T12:00:00.000Z')), 2027, 'nearby New-Year dates may roll forward');
assert.equal(calendarDateKeyInVienna(new Date('2026-07-16T22:30:00.000Z')), '2026-07-17');
assert.equal(
  isCalendarDateAfter('2026-07-17T12:00:00.000Z', new Date('2026-07-17T07:00:00.000Z')),
  false,
  'a calendar-day offer is active from the start of that Vienna day, not only from its parsed clock time',
);
assert.deepEqual(
  extractCaptionDateRange('Wien: gültig 20.07.–25.07.2026', now, 120),
  {
    explicit: true,
    validFrom: '2026-07-20T00:00:00.000Z',
    validUntil: '2026-07-25T23:59:59.999Z',
    isFuture: true,
  },
  'unprefixed fully written ranges remain explicit',
);
assert.deepEqual(
  extractCaptionDateRange('Wien: 20.–25.07.', now, 120),
  {
    explicit: true,
    validFrom: '2026-07-20T00:00:00.000Z',
    validUntil: '2026-07-25T23:59:59.999Z',
    isFuture: true,
  },
  'compact social-caption ranges retain both dates',
);
assert.deepEqual(
  extractCaptionDateRange('Wien: 28.12.–05.01.', new Date('2027-01-02T12:00:00.000Z'), 120),
  {
    explicit: true,
    validFrom: '2026-12-28T00:00:00.000Z',
    validUntil: '2027-01-05T23:59:59.999Z',
    isFuture: false,
  },
  'an active Dec-Jan range stays active just after New Year',
);
assert.deepEqual(
  extractCaptionDateRange(
    'Wien: 28.12.–31.12.',
    new Date('2027-01-02T12:00:00.000Z'),
    120,
    new Date('2026-12-30T10:00:00.000Z'),
  ),
  {
    explicit: true,
    validFrom: '2026-12-28T00:00:00.000Z',
    validUntil: '2026-12-31T23:59:59.999Z',
    isFuture: false,
  },
  'yearless non-crossing ranges use the post year instead of a later crawl year',
);

assert.equal(toIso(1_752_750_000), '2025-07-17T11:00:00.000Z', 'Unix seconds must not be treated as milliseconds');

const currentItem = {
  accepted: true,
  postUrl: 'https://www.instagram.com/p/Current123/?utm_source=test',
  venueName: 'Test Cafe',
  instagramHandle: '@test.cafe',
  description: 'Heute in Wien ein Kaffee gratis',
  offerKind: 'free',
  isVienna: true,
  stillValid: true,
  postPublishedAt: '2026-07-16T12:00:00.000Z',
  matchedKeywords: { vienna: ['wien'] },
};

const current = normalizeApifyItem(currentItem, { now, maxPostAgeDays: 7 });
assert.equal(current.rejectReason, '');
assert.equal(current.deal.url, 'https://www.instagram.com/p/Current123/');
assert.equal(current.deal.pubDate, currentItem.postPublishedAt);
assert.equal(current.deal.sourcePublishedAt, currentItem.postPublishedAt);
assert.equal(current.deal.instagramHandle, 'test.cafe');
assert.equal(current.deal.distance, '', 'missing location must not be replaced with synthetic Wien');
assert.equal(current.deal.viennaEvidence.verified, false, 'a plain text keyword must not masquerade as verified location evidence');

const trustedAccount = normalizeApifyItem({
  ...currentItem,
  description: 'Heute ein Kaffee gratis',
  viennaEvidence: { type: 'trustedSeedAccount', values: ['test.cafe'] },
}, { now });
assert.equal(trustedAccount.deal.viennaEvidence.verified, true);
assert.equal(trustedAccount.deal.viennaEvidence.source, 'verified-account');

const selfCertifiedViennaHandle = normalizeApifyItem({
  ...currentItem,
  venueName: 'vienna.coffee',
  instagramHandle: 'vienna.coffee',
  description: '123 likes - vienna.coffee on Instagram: Heute 20 % Rabatt auf Pizza',
  isVienna: true,
  matchedKeywords: { vienna: ['vienna'] },
}, { now });
assert.equal(selfCertifiedViennaHandle.deal, null);
assert.equal(selfCertifiedViennaHandle.rejectReason, 'missingViennaEvidence', 'merchant handles and actor booleans cannot self-certify Vienna');

const geotagged = normalizeApifyItem({
  ...currentItem,
  locationText: '1010 Wien, Stephansplatz',
}, { now });
assert.equal(geotagged.deal.viennaVerified, true);
assert.equal(geotagged.deal.viennaEvidence.source, 'apify-location');
assert.equal(geotagged.deal.city, 'Wien');
assert.equal(geotagged.deal.postalCode, '1010');

const missingTimestamp = normalizeApifyItem({ ...currentItem, postPublishedAt: '' }, { now });
assert.equal(missingTimestamp.deal, null);
assert.equal(missingTimestamp.rejectReason, 'missingRealPostTimestamp');

const oldButExplicitlyValid = normalizeApifyItem({
  ...currentItem,
  postPublishedAt: '2026-06-01T12:00:00.000Z',
  validUntil: '2026-07-31T23:59:59.000Z',
  explicitValidityDetected: true,
}, { now, maxPostAgeDays: 7 });
assert.equal(oldButExplicitlyValid.deal, null);
assert.equal(oldButExplicitlyValid.rejectReason, 'postTooOld');

const watchlist = {
  accounts: Array.from({ length: 14 }, (_, index) => ({
    username: `account_${String(index).padStart(2, '0')}`,
    priority: 100 - index,
    viennaVerified: index < 2,
  })),
};
const shardZero = selectAccountShard({ watchlist, shardCount: 2, shardIndex: 0, hotAccountCount: 2, maxAccounts: 20 });
const shardOne = selectAccountShard({ watchlist, shardCount: 2, shardIndex: 1, hotAccountCount: 2, maxAccounts: 20 });
assert.deepEqual(shardZero.hotAccounts, shardOne.hotAccounts, 'hot accounts must be scanned in every shard');
assert.deepEqual(
  new Set([...shardZero.verifiedAccounts, ...shardOne.verifiedAccounts]),
  new Set(['account_00', 'account_01']),
  'only explicitly verified watchlist accounts may become Vienna evidence',
);
const rotatingZero = shardZero.accounts.filter((account) => !shardZero.hotAccounts.includes(account));
const rotatingOne = shardOne.accounts.filter((account) => !shardOne.hotAccounts.includes(account));
assert.equal(rotatingZero.some((account) => rotatingOne.includes(account)), false, 'rotating shards must not overlap');
assert.equal(new Set([...shardZero.accounts, ...shardOne.accounts]).size, 14, 'all accounts must be covered by a complete shard cycle');

const built = buildShardedActorInput({
  seedAccounts: [],
  seedHashtags: ['gratiswien', 'wiengastro', 'wienessen', 'wienkaffee'],
}, {
  now,
  watchlist,
  shardCount: 2,
  shardIndex: 1,
  maxPostsPerSource: 6,
  maxPostAgeDays: 7,
});
assert.equal(built.input.maxPostsPerSource, 6);
assert.equal(built.input.maxPostAgeDays, 7);
assert.equal(built.input.maxAgeDaysWithoutExplicitValidity, 3);
assert.ok(built.input.seedAccounts.length > 0);
assert.ok(built.input.verifiedViennaAccounts.every((account) => built.input.seedAccounts.includes(account)));

assert.deepEqual(
  classifyApifyRunHealth({ summary: { inspectedPosts: 0, sources: { a: { state: 'loginWall' } } }, rawDatasetItems: 0, acceptedDeals: 0 }),
  { usable: false, operationalStatus: 'source-unusable', reason: 'no-usable-source-data', inspectedPosts: 0, sourceStates: { loginWall: 1 } },
);
assert.equal(
  classifyApifyRunHealth({ summary: { inspectedPosts: 3, sources: {} }, rawDatasetItems: 0, acceptedDeals: 0 }).operationalStatus,
  'source-unusable',
);

assert.deepEqual(
  classifyApifyRunHealth({
    summary: { inspectedPosts: 2, acceptedDeals: 2, sources: { a: { state: 'ok' } } },
    rawDatasetItems: 2,
    acceptedDeals: 0,
  }),
  {
    usable: false,
    operationalStatus: 'source-unusable',
    reason: 'accepted-dataset-missing',
    inspectedPosts: 2,
    sourceStates: { ok: 1 },
  },
  'actor/importer schema mismatches must preserve the last-good output instead of writing an empty success',
);

assert.deepEqual(
  classifyApifyRunHealth({
    summary: {
      inspectedPosts: 3,
      acceptedDeals: 0,
      sources: { a: { state: 'ok' } },
      rejectReasons: { missingRealPostTimestamp: 3 },
    },
    rawDatasetItems: 0,
    acceptedDeals: 0,
  }),
  {
    usable: false,
    operationalStatus: 'source-unusable',
    reason: 'all-posts-missing-source-timestamps',
    inspectedPosts: 3,
    sourceStates: { ok: 1 },
  },
  'a markup failure must not erase the last healthy output',
);

assert.deepEqual(
  classifyApifyRunHealth({
    summary: {
      inspectedPosts: 3,
      acceptedDeals: 0,
      sources: { a: { state: 'ok' } },
      rejectReasons: { noConcreteOffer: 3 },
    },
    rawDatasetItems: 0,
    acceptedDeals: 0,
  }),
  {
    usable: true,
    operationalStatus: 'healthy-no-verified-deals',
    inspectedPosts: 3,
    sourceStates: { ok: 1 },
  },
  'a healthy source may legitimately yield zero verified deals',
);

const quantifiedDiscount = normalizeApifyItem({
  ...currentItem,
  offerKind: 'discount',
  description: 'Wien: 20 % Rabatt auf alle Burger',
  postPublishedAt: '2026-07-17T08:00:00.000Z',
}, { now });
assert.equal(quantifiedDiscount.deal.type, 'rabatt');
assert.equal(quantifiedDiscount.deal.expiresSource, 'short-review-ttl');
assert.equal(quantifiedDiscount.deal.expires, '2026-07-20T12:00:00.000Z');

const fourDaysOldWithoutEnd = normalizeApifyItem({
  ...currentItem,
  postPublishedAt: '2026-07-13T12:00:00.000Z',
}, { now, maxPostAgeDays: 7, maxAgeWithoutExplicitValidityDays: 3 });
assert.equal(fourDaysOldWithoutEnd.rejectReason, 'postTooOldWithoutExplicitValidity');

const fourDaysOldWithEnd = normalizeApifyItem({
  ...currentItem,
  postPublishedAt: '2026-07-13T12:00:00.000Z',
  validUntil: '2026-07-25T23:59:59.000Z',
}, { now, maxPostAgeDays: 7, maxAgeWithoutExplicitValidityDays: 3 });
assert.ok(fourDaysOldWithEnd.deal);

const futureApifyRange = normalizeApifyItem({
  ...currentItem,
  postPublishedAt: '2026-07-17T08:00:00.000Z',
  validFrom: '2026-07-20T00:00:00.000Z',
  validUntil: '2026-07-25T23:59:59.999Z',
  stillValid: true,
}, { now });
assert.equal(futureApifyRange.deal, null);
assert.equal(futureApifyRange.rejectReason, 'offerNotStarted', 'importer independently blocks future ranges even if actor stillValid is inconsistent');

const genericDiscoveryDate = normalizeApifyItem({
  ...currentItem,
  postPublishedAt: '',
  date: '2026-07-17T08:00:00.000Z',
}, { now });
assert.equal(genericDiscoveryDate.rejectReason, 'missingRealPostTimestamp');

console.log('apify instagram reliability tests passed');

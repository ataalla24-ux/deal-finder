import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  canonicalDealUrl,
  canonicalInstagramPostKey,
  decodeInstagramShortcodeDate,
  extractInstagramProfileUsername,
  extractStructuredOwnerUsername,
  getPublicationEvidence,
  getViennaEvidence,
  mergeDuplicateDealRecords,
  semanticCrossPlatformOfferKey,
  semanticSocialOfferKey,
} from '../scraper/deal-evidence-utils.js';
import {
  buildInstagramMerchantRegistry,
  getIndependentViennaEvidence,
  parseHistoricalProfileEvidence,
} from '../scraper/build-instagram-merchant-registry.js';

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

const cryoOfferA = semanticSocialOfferKey({
  ownerUsername: 'longevitycenter.vienna',
  title: 'All you can Cryo um 200 Euro',
  description: 'Eine Studie berichtet von 58 % Verbesserung.',
  promotionEvidence: 'All you can Cryo Aktion um 200 €',
  url: 'https://www.instagram.com/p/CRYOPOSTA/',
});
const cryoOfferB = semanticSocialOfferKey({
  ownerUsername: 'longevitycenter.vienna',
  title: 'All-you-can Kältekammer',
  description: 'Andere Messwerte lagen bei 47 % und 56 %.',
  promotionEvidence: 'All you can Cryo Aktion um 200 Euro',
  url: 'https://www.instagram.com/reel/CRYOPOSTB/',
});
assert.ok(cryoOfferA, 'a concrete social promotion gets a semantic fingerprint');
assert.equal(cryoOfferA, cryoOfferB, 'unrelated caption percentages must not split one repeated promotion');

const merchantOfferA = semanticSocialOfferKey({
  ownerUsername: 'cafe_wien',
  title: '20 % auf Pizza',
  url: 'https://www.instagram.com/p/CAFEPOSTA/',
});
const merchantOfferB = semanticSocialOfferKey({
  ownerUsername: 'cafe_wien',
  title: '1+1 Kaffee gratis',
  url: 'https://www.instagram.com/p/CAFEPOSTB/',
});
assert.ok(merchantOfferA && merchantOfferB);
assert.notEqual(merchantOfferA, merchantOfferB, 'different offers by one merchant remain separate');
assert.notEqual(
  semanticSocialOfferKey({
    ownerUsername: 'wien.uncovered',
    brand: 'Cafe Alpha',
    title: '20 % auf Pizza',
    url: 'https://www.instagram.com/p/PUBLISHERPOSTA/',
  }),
  semanticSocialOfferKey({
    ownerUsername: 'wien.uncovered',
    brand: 'Cafe Beta',
    title: '20 % auf Pizza',
    url: 'https://www.instagram.com/p/PUBLISHERPOSTB/',
  }),
  'one discovery publisher must not merge matching discounts from different merchants',
);
assert.equal(semanticSocialOfferKey({
  ownerUsername: 'cafe_wien',
  title: 'Unser neues Sommermenü',
  url: 'https://www.instagram.com/p/NODEALPOST/',
}), '', 'ordinary merchant posts never receive an offer fingerprint');

const crossPlatformInstagram = semanticCrossPlatformOfferKey({
  brand: 'Cafe Milano Wien',
  ownerUsername: 'cafe.milano.at',
  title: 'Zweiter Kaffee gratis',
  validUntil: '2026-08-30',
  url: 'https://www.instagram.com/p/CAFEBOGOIG/',
});
const crossPlatformTikTok = semanticCrossPlatformOfferKey({
  brand: '@cafe.milano.at',
  ownerUsername: 'cafe.milano.at',
  promotionEvidence: '2. Kaffee kostenlos',
  validUntil: '2026-08-30',
  url: 'https://www.tiktok.com/@cafe.milano.at/video/7678002441849425200',
});
const crossPlatformWebsite = semanticCrossPlatformOfferKey({
  brand: 'Cafe Milano',
  title: 'Den zweiten Kaffee gibt es gratis',
  validUntil: '2026-08-30',
  url: 'https://cafemilano.example/aktionen/zweiter-kaffee-gratis',
});
assert.ok(crossPlatformInstagram);
assert.equal(crossPlatformInstagram, crossPlatformTikTok);
assert.equal(crossPlatformInstagram, crossPlatformWebsite, 'one campaign matches across Instagram, TikTok and its direct page');

const descriptiveDysonCrosspost = semanticCrossPlatformOfferKey({
  brand: 'Dyson',
  title: 'Gratis Haarstyling und Drinks beim Dyson Pop-up',
  description: 'Vienna Dyson Styling Tour with free styling, goodies and drinks at Rathausplatz.',
  validFrom: '2026-08-26T12:00:00.000Z',
  validUntil: '2026-08-29T12:00:00.000Z',
  url: 'https://www.tiktok.com/@kseniainvienna/video/7678002441849425155',
});
const genericDysonCrosspost = semanticCrossPlatformOfferKey({
  brand: 'Dyson',
  title: 'Dyson Angebot',
  description: 'Vienna Dyson Styling Tour: Haare gratis stylen lassen am Rathausplatz.',
  validFrom: '2026-08-26',
  validUntil: '2026-08-29',
  url: 'https://www.tiktok.com/@johannasteachervibes/video/7678693667174878486',
});
assert.ok(descriptiveDysonCrosspost);
assert.equal(
  genericDysonCrosspost,
  descriptiveDysonCrosspost,
  'concrete offer evidence in a caption deduplicates an older generic title',
);

assert.notEqual(crossPlatformWebsite, semanticCrossPlatformOfferKey({
  brand: 'Cafe Roma',
  title: 'Zweiter Kaffee gratis',
  validUntil: '2026-08-30',
  url: 'https://caferoma.example/aktionen/zweiter-kaffee-gratis',
}), 'matching copy from another merchant remains a separate deal');
assert.equal(semanticCrossPlatformOfferKey({
  brand: 'Wien Uncovered',
  ownerUsername: 'wien.uncovered',
  title: 'All you can eat um 19 Euro',
  url: 'https://wienuncovered.example/all-you-can-eat-wien',
}), '', 'a discovery publisher is never treated as the merchant fingerprint');

assert.equal(extractInstagramProfileUsername('https://instagram.com/cafe_wien/'), 'cafe_wien');
assert.equal(extractInstagramProfileUsername(`https://instagram.com/p/${shortcode}/`), '', 'post paths never become merchant usernames');
assert.equal(extractStructuredOwnerUsername({ owner: { username: '@Cafe_Wien' } }), 'cafe_wien');
assert.equal(extractStructuredOwnerUsername({ instagramHandle: '@Cafe_Wien' }), 'cafe_wien');
assert.match(
  decodeInstagramShortcodeDate('https://www.instagram.com/p/DbDbw1Glw4Q/').toISOString(),
  /^2026-07-21T/,
  'Instagram shortcodes expose the original platform publication time',
);

const historicalMerchantEvidence = parseHistoricalProfileEvidence(
  'sig:www.instagram.com/ciosgrill|Cio’s Grill|Gratis Premium Döner|gratis|Franz-Josefs-Kai 15, 1010 Wien',
  Date.parse('2026-07-01T10:00:00.000Z'),
);
assert.equal(historicalMerchantEvidence.username, 'ciosgrill');
assert.equal(historicalMerchantEvidence.hasStreetAddress, true);
assert.match(historicalMerchantEvidence.viennaEvidence, /1010/);

const merchantRegistry = buildInstagramMerchantRegistry({
  now: new Date('2026-07-23T12:00:00.000Z'),
  write: false,
});
const verifiedMerchant = merchantRegistry.accounts.find((entry) => entry.username === 'ciosgrill');
assert.equal(verifiedMerchant.accountType, 'merchant');
assert.equal(verifiedMerchant.viennaVerified, true, 'watchlisted merchants with historical Vienna address evidence are verified');
const discoveryAccount = merchantRegistry.accounts.find((entry) => entry.username === 'viennaeats');
assert.equal(discoveryAccount.accountType, 'discovery');
assert.equal(discoveryAccount.viennaVerified, false, 'discovery publishers never become trusted merchant locations');

const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'instagram-registry-feedback-'));
const feedbackDocsDir = path.join(feedbackDir, 'docs');
fs.mkdirSync(feedbackDocsDir);
fs.writeFileSync(path.join(feedbackDocsDir, 'deals.json'), JSON.stringify({
  deals: [
    {
      id: 'approved-post',
      ownerUsername: 'approved.cafe',
      url: 'https://www.instagram.com/p/APPROVEDPOST/',
      title: '1+1 Burger gratis',
      description: '1+1 Burger gratis in 1070 Wien',
      city: 'Wien',
      category: 'essen',
      sourcePublishedAt: '2026-07-22T08:00:00.000Z',
      sourcePublishedAtSource: 'instagram-graph-timestamp',
    },
    {
      id: 'website-only-owner',
      ownerUsername: 'website.provider',
      url: 'https://example.com/deal',
      title: '20 % Rabatt',
      description: '20 % Rabatt in Wien',
      city: 'Wien',
      category: 'shopping',
      sourcePublishedAt: '2026-07-22T08:00:00.000Z',
      sourcePublishedAtSource: 'website-published-at',
    },
  ],
}));
fs.writeFileSync(path.join(feedbackDocsDir, 'deals-pending-all.json'), JSON.stringify({
  deals: [{
    id: 'posted-post',
    ownerUsername: 'approved.cafe',
    url: 'https://www.instagram.com/p/POSTEDPOST/',
    title: '20 % Rabatt auf Kaffee',
    description: '20 % Rabatt auf Kaffee in 1070 Wien',
    city: 'Wien',
    category: 'kaffee',
    sourcePublishedAt: '2026-07-22T09:00:00.000Z',
    sourcePublishedAtSource: 'instagram-graph-timestamp',
    slackTs: '123.456',
  }],
}));
fs.writeFileSync(path.join(feedbackDocsDir, 'instagram-watchlist.json'), JSON.stringify({
  accounts: [
    { username: 'expired.cafe', category: 'merchant' },
    { username: 'neotaste.wien', category: 'merchant' },
  ],
}));
fs.writeFileSync(path.join(feedbackDocsDir, 'instagram-graph-post-evidence.json'), JSON.stringify({
  posts: [{
    url: 'https://www.instagram.com/reel/REJECTEDPOST/',
    ownerUsername: 'rejected.cafe',
  }],
}));
fs.writeFileSync(path.join(feedbackDocsDir, 'deal-moderation.json'), JSON.stringify({
  blockedProviders: ['neotaste'],
  hiddenDeals: [
    {
      url: 'deal_url: https://www.instagram.com/reel/REJECTEDPOST/?igsh=noise',
      reason: 'kein echter Deal',
      removedAt: '2026-07-23T08:00:00.000Z',
    },
    {
      url: 'https://www.instagram.com/reel/EXPIREDPOST/',
      ownerUsername: 'expired.cafe',
      reason: 'abgelaufen',
      removedAt: '2026-07-23T08:00:00.000Z',
    },
  ],
}));
fs.writeFileSync(path.join(feedbackDocsDir, 'sent-deal-ids.json'), '{}');
fs.writeFileSync(path.join(feedbackDocsDir, 'deal-review-feedback.json'), JSON.stringify({
  events: [
    {
      key: 'instagram:CREATORAPPROVED',
      url: 'https://www.instagram.com/reel/CREATORAPPROVED/',
      ownerUsername: 'lisa.maria.b',
      sourceAccountType: 'creator',
      scoutUsername: 'lisa.maria.b',
      merchantUsername: 'tennosushiofficial',
      slackSentAt: '2026-07-23T08:00:00.000Z',
      decision: 'approved',
    },
    {
      key: 'instagram:CREATORREJECTED',
      url: 'https://www.instagram.com/reel/CREATORREJECTED/',
      ownerUsername: 'lisa.maria.b',
      sourceAccountType: 'creator',
      scoutUsername: 'lisa.maria.b',
      merchantUsername: 'otherrestaurant',
      slackSentAt: '2026-07-23T09:00:00.000Z',
      decision: 'rejected',
    },
  ],
}));
const feedbackRegistry = buildInstagramMerchantRegistry({
  docsDir: feedbackDocsDir,
  inputFiles: ['deals.json', 'deals-pending-all.json'],
  watchlistPath: path.join(feedbackDocsDir, 'instagram-watchlist.json'),
  historicalSentPath: path.join(feedbackDocsDir, 'sent-deal-ids.json'),
  graphEvidencePath: path.join(feedbackDocsDir, 'instagram-graph-post-evidence.json'),
  moderationPath: path.join(feedbackDocsDir, 'deal-moderation.json'),
  now: new Date('2026-07-23T12:00:00.000Z'),
  write: false,
});
const approvedFeedback = feedbackRegistry.accounts.find((entry) => entry.username === 'approved.cafe');
const rejectedFeedback = feedbackRegistry.accounts.find((entry) => entry.username === 'rejected.cafe');
const expiredFeedback = feedbackRegistry.accounts.find((entry) => entry.username === 'expired.cafe');
const blockedFeedback = feedbackRegistry.accounts.find((entry) => entry.username === 'neotaste.wien');
assert.equal(approvedFeedback.approvedDeals, 1);
assert.equal(approvedFeedback.postedDeals, 1);
assert.equal(approvedFeedback.approvalRate, 1);
assert.equal(rejectedFeedback.rejectedDeals, 1, 'quality moderation maps an exact post back to its account');
assert.equal(expiredFeedback.rejectedDeals, 0, 'normal expiry is not negative account feedback');
assert.equal(blockedFeedback.blockedByModeration, true);
assert.equal(feedbackRegistry.accounts.some((entry) => entry.username === 'website.provider'), false, 'generic website owners do not become Instagram targets');
const creatorFeedback = feedbackRegistry.accounts.find((entry) => entry.username === 'lisa.maria.b');
const merchantManualFeedback = feedbackRegistry.accounts.find((entry) => entry.username === 'tennosushiofficial');
assert.equal(creatorFeedback.accountType, 'creator');
assert.equal(creatorFeedback.scoutApprovedDeals, 1);
assert.equal(creatorFeedback.scoutRejectedDeals, 1);
assert.equal(creatorFeedback.approvedDeals, 0, 'creator approvals are not merchant quality feedback');
assert.equal(merchantManualFeedback.accountType, 'merchant');
assert.equal(merchantManualFeedback.manualApprovedDeals, 1);

const previousRegistryPath = path.join(feedbackDocsDir, 'previous-registry.json');
fs.writeFileSync(previousRegistryPath, JSON.stringify(feedbackRegistry));
fs.writeFileSync(path.join(feedbackDocsDir, 'deals.json'), JSON.stringify({ deals: [] }));
fs.writeFileSync(path.join(feedbackDocsDir, 'deals-pending-all.json'), JSON.stringify({ deals: [] }));
const persistedFeedbackRegistry = buildInstagramMerchantRegistry({
  docsDir: feedbackDocsDir,
  inputFiles: ['deals.json', 'deals-pending-all.json'],
  previousRegistryPath,
  watchlistPath: path.join(feedbackDocsDir, 'instagram-watchlist.json'),
  historicalSentPath: path.join(feedbackDocsDir, 'sent-deal-ids.json'),
  graphEvidencePath: path.join(feedbackDocsDir, 'instagram-graph-post-evidence.json'),
  moderationPath: path.join(feedbackDocsDir, 'deal-moderation.json'),
  now: new Date('2026-07-24T12:00:00.000Z'),
  write: false,
});
assert.equal(
  persistedFeedbackRegistry.accounts.find((entry) => entry.username === 'approved.cafe')?.approvedDeals,
  1,
  'final account approvals persist after the deal leaves the live snapshot',
);
fs.rmSync(feedbackDir, { recursive: true, force: true });

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

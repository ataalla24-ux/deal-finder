import assert from 'node:assert/strict';

import { validateDealsForSlack } from '../scraper/deal-validity-agent.js';

const now = new Date('2026-07-17T12:00:00.000Z');

const baseSocialDeal = {
  id: 'instagram-validity-evidence',
  brand: 'Test Cafe',
  title: 'Zweiter Kaffee gratis',
  description: 'Heute gibt es einen zweiten Kaffee kostenlos.',
  category: 'kaffee',
  type: 'gratis',
  source: 'Instagram',
  originSource: 'instagram-test',
  url: 'https://www.instagram.com/p/VALIDITY_EVIDENCE/',
  distance: 'Wien',
  expires: '2026-07-31',
};

const inspectDealUrlHealth = async (url) => ({
  status: 200,
  finalUrl: url,
  dateHints: {},
  contentHints: {},
});

async function validate(deal, extraOptions = {}) {
  const result = await validateDealsForSlack([deal], {
    now,
    maxAgeDays: 7,
    concurrency: 1,
    inspectDealUrlHealth,
    ...extraOptions,
  });
  return result.results[0];
}

const discoveryOnly = await validate({
  ...baseSocialDeal,
  discoveredAt: '2026-07-17T11:00:00.000Z',
});
assert.equal(discoveryOnly.decision.allowed, false);
assert.match(discoveryOnly.decision.reasons.join(' '), /kein echtes Social-Post-Datum/);
assert.match(discoveryOnly.decision.reasons.join(' '), /nicht eindeutig in Wien/);

const urlInspectionDateOnly = await validate({
  ...baseSocialDeal,
  title: 'Zweiter Kaffee gratis in Wien',
  discoveredAt: '2026-07-17T11:00:00.000Z',
}, {
  inspectDealUrlHealth: async (url) => ({
    status: 200,
    finalUrl: url,
    dateHints: { publicationDate: '2026-07-17T10:00:00.000Z' },
    contentHints: {},
  }),
});
assert.equal(urlInspectionDateOnly.decision.allowed, false);
assert.match(urlInspectionDateOnly.decision.reasons.join(' '), /kein echtes Social-Post-Datum/);

const unmarkedPubDate = await validate({
  ...baseSocialDeal,
  title: 'Zweiter Kaffee gratis in Wien',
  pubDate: '2026-07-17T11:00:00.000Z',
});
assert.equal(unmarkedPubDate.decision.allowed, false);
assert.match(unmarkedPubDate.decision.reasons.join(' '), /kein echtes Social-Post-Datum/);

const syntheticCrawlerDate = await validate({
  ...baseSocialDeal,
  title: 'Zweiter Kaffee gratis in Wien',
  pubDate: '2026-07-17T11:00:00.000Z',
  pubDateSource: 'firecrawlAgentRun',
  discoveredAt: '2026-07-17T11:00:00.000Z',
});
assert.equal(syntheticCrawlerDate.decision.allowed, false);
assert.match(syntheticCrawlerDate.decision.reasons.join(' '), /kein echtes Social-Post-Datum/);
assert.equal(syntheticCrawlerDate.decision.sourceDate, '');

const copiedCrawlerDate = await validate({
  ...baseSocialDeal,
  title: 'Zweiter Kaffee gratis in Wien',
  sourcePublishedAt: '2026-07-17T11:00:00.000Z',
  sourcePublishedAtSource: 'firecrawlAgentRun',
  pubDate: '2026-07-17T11:00:00.000Z',
  pubDateSource: 'firecrawlAgentRun',
});
assert.equal(copiedCrawlerDate.decision.allowed, false);
assert.match(copiedCrawlerDate.decision.reasons.join(' '), /kein echtes Social-Post-Datum/);

const trustedButSyntheticVienna = await validate({
  ...baseSocialDeal,
  sourcePublishedAt: '2026-07-16T11:00:00.000Z',
  sourcePublishedAtSource: 'instagram-graph-timestamp',
});
assert.equal(trustedButSyntheticVienna.decision.allowed, false);
assert.match(trustedButSyntheticVienna.decision.reasons.join(' '), /nicht eindeutig in Wien/);

const titleEvidence = await validate({
  ...baseSocialDeal,
  title: 'Zweiter Kaffee gratis in Wien',
  description: 'Zweiter Kaffee gratis in Wien.',
  sourcePublishedAt: '2026-07-16T11:00:00.000Z',
  sourcePublishedAtSource: 'instagram-graph-timestamp',
});
assert.equal(titleEvidence.decision.allowed, true);
assert.equal(titleEvidence.decision.sourceDate, '2026-07-16T11:00:00.000Z');

const handleOnlyVienna = await validate({
  ...baseSocialDeal,
  brand: 'vienna.coffee',
  title: 'vienna.coffee: 20 % Rabatt auf Pizza',
  description: 'Heute 20 % Rabatt auf Pizza.',
  sourcePublishedAt: '2026-07-16T11:00:00.000Z',
  sourcePublishedAtSource: 'instagram-graph-timestamp',
});
assert.equal(handleOnlyVienna.decision.allowed, false, 'a Vienna-like merchant handle/title is not offer-location evidence');
assert.match(handleOnlyVienna.decision.reasons.join(' '), /nicht eindeutig in Wien/);

const postcodeEvidence = await validate({
  ...baseSocialDeal,
  description: 'Nur in unserer Filiale in 1070, solange der Vorrat reicht.',
  postTimestamp: '2026-07-16T10:00:00.000Z',
});
assert.equal(postcodeEvidence.decision.allowed, true);

const metaEvidence = await validate({
  ...baseSocialDeal,
  sourcePublishedAt: '2026-07-16T09:00:00.000Z',
  sourcePublishedAtSource: 'meta-business-discovery-timestamp',
  viennaEvidence: {
    verified: true,
    source: 'meta-target-location',
    detail: 'Vienna, Austria',
  },
});
assert.equal(metaEvidence.decision.allowed, true);

const apifyEvidence = await validate({
  ...baseSocialDeal,
  sourcePublishedAt: '2026-07-16T08:00:00.000Z',
  sourcePublishedAtSource: 'apify-post-timestamp',
  viennaEvidence: {
    verified: true,
    source: 'apify-location',
    detail: 'Neubaugasse 12, 1070 Wien',
  },
});
assert.equal(apifyEvidence.decision.allowed, true);

const apifyStructuredFields = await validate({
  ...baseSocialDeal,
  postTimestamp: '2026-07-16T07:00:00.000Z',
  locationVerified: true,
  city: 'Wien',
});
assert.equal(apifyStructuredFields.decision.allowed, true);

const strongerFutureExpiry = await validate({
  ...baseSocialDeal,
  sourcePublishedAt: '2026-07-16T08:00:00.000Z',
  sourcePublishedAtSource: 'apify-post-timestamp',
  viennaEvidence: {
    verified: true,
    source: 'apify-location',
    detail: 'Neubaugasse 12, 1070 Wien',
  },
  expires: '2026-07-10',
  expiresSource: 'weak-import',
  validUntil: '2026-07-31',
  expirySource: 'apify-post-caption',
});
assert.equal(strongerFutureExpiry.decision.allowed, true, 'strong structured future validity beats a stale weak expiry field');
assert.equal(strongerFutureExpiry.decision.expiryDate, '2026-07-31');
assert.equal(strongerFutureExpiry.deal.validUntil, '2026-07-31');
assert.equal(strongerFutureExpiry.deal.expires, '2026-07-31');

const explicitExpiredVsFallback = await validate({
  ...baseSocialDeal,
  sourcePublishedAt: '2026-07-16T08:00:00.000Z',
  sourcePublishedAtSource: 'apify-post-timestamp',
  viennaEvidence: {
    verified: true,
    source: 'apify-location',
    detail: 'Neubaugasse 12, 1070 Wien',
  },
  expires: '2026-12-31',
  expiresSource: 'fallback',
  validUntil: '2026-07-10',
  expirySource: 'content-date',
  dateConfidence: 'high',
});
assert.equal(explicitExpiredVsFallback.decision.allowed, false, 'strong expired validity must beat a weak future fallback');
assert.match(explicitExpiredVsFallback.decision.reasons.join(' '), /abgelaufen/);

const futureRange = await validate({
  ...baseSocialDeal,
  sourcePublishedAt: '2026-07-16T08:00:00.000Z',
  sourcePublishedAtSource: 'apify-post-timestamp',
  viennaEvidence: {
    verified: true,
    source: 'apify-location',
    detail: 'Neubaugasse 12, 1070 Wien',
  },
  validFrom: '2026-07-20',
  validUntil: '2026-07-25',
  expirySource: 'content-date',
  dateConfidence: 'high',
});
assert.equal(futureRange.decision.allowed, false, 'deals must not be released before an explicit start date');
assert.match(futureRange.decision.reasons.join(' '), /noch nicht gestartet/);

const futureSingleDay = await validate({
  ...baseSocialDeal,
  sourcePublishedAt: '2026-07-16T08:00:00.000Z',
  sourcePublishedAtSource: 'instagram-graph-timestamp',
  viennaEvidence: {
    verified: true,
    source: 'meta-target-location',
    detail: 'Vienna',
  },
  validOn: '2026-07-20',
  expires: '2026-07-20',
  expirySource: 'content-date',
  dateConfidence: 'high',
});
assert.equal(futureSingleDay.decision.allowed, false, 'a future single-day offer must stay blocked until validOn');
assert.match(futureSingleDay.decision.reasons.join(' '), /noch nicht gestartet/);

const liveUrlExpired = await validate({
  ...baseSocialDeal,
  sourcePublishedAt: '2026-07-16T08:00:00.000Z',
  sourcePublishedAtSource: 'instagram-graph-timestamp',
  title: 'Zweiter Kaffee gratis in Wien',
  validUntil: '2026-07-31',
  expirySource: 'content-date',
  dateConfidence: 'high',
}, {
  inspectDealUrlHealth: async (url) => ({
    status: 200,
    finalUrl: url,
    dateHints: {
      targetDateKind: 'end',
      targetDateRaw: 'Aktion beendet am 10.07.2026',
      validUntil: '2026-07-10',
    },
    contentHints: {},
  }),
});
assert.equal(liveUrlExpired.decision.allowed, false, 'fresh live URL expiry evidence must beat a stale stored future date');
assert.match(liveUrlExpired.decision.reasons.join(' '), /abgelaufen/);

const futurePublication = await validate({
  ...baseSocialDeal,
  title: 'Zweiter Kaffee gratis in Wien',
  sourcePublishedAt: '2027-07-16T08:00:00.000Z',
  sourcePublishedAtSource: 'instagram-graph-timestamp',
});
assert.equal(futurePublication.decision.allowed, false);
assert.match(futurePublication.decision.reasons.join(' '), /Zukunft/);

const expiredIsoStructured = await validate({
  ...baseSocialDeal,
  sourcePublishedAt: '2026-07-16T08:00:00.000Z',
  sourcePublishedAtSource: 'instagram-graph-timestamp',
  title: 'Zweiter Kaffee gratis in Wien',
  expires: '2026-07-10T23:59:59.999Z',
  validUntil: '2026-07-10T23:59:59.999Z',
});
assert.equal(expiredIsoStructured.decision.allowed, false);
assert.match(expiredIsoStructured.decision.reasons.join(' '), /abgelaufen/);

const legacyFirecrawlCompatibility = await validate({
  ...baseSocialDeal,
  id: 'firecrawl-compatibility',
  title: 'Zweiter Kaffee gratis',
  source: 'Firecrawl Instagram Gastro #5',
  originSource: 'Firecrawl Instagram Gastro #5',
  pubDate: '2026-07-17T08:00:00.000Z',
  pubDateSource: 'socialPostDate',
  distance: 'Wien',
});
assert.equal(
  legacyFirecrawlCompatibility.decision.allowed,
  true,
  'Firecrawl keeps its pre-existing publication and Vienna compatibility path',
);

const unverifiedDeclaredEvidence = await validate({
  ...baseSocialDeal,
  sourcePublishedAt: '2026-07-16T06:00:00.000Z',
  sourcePublishedAtSource: 'apify-post-timestamp',
  viennaEvidence: {
    verified: false,
    source: 'post-text',
    detail: 'Wien keyword supplied outside the actual title/description',
  },
});
assert.equal(unverifiedDeclaredEvidence.decision.allowed, false);
assert.match(unverifiedDeclaredEvidence.decision.reasons.join(' '), /nicht eindeutig in Wien/);

const nonSocialCompatibility = await validate({
  ...baseSocialDeal,
  id: 'website-validity-compatibility',
  source: 'Merchant website',
  originSource: 'merchant-website',
  url: 'https://example.com/angebot',
  pubDate: '',
  discoveredAt: '2026-07-16T06:00:00.000Z',
});
assert.equal(nonSocialCompatibility.decision.allowed, true, 'non-social discovery timestamps and distance keep their prior behavior');

console.log('Deal validity evidence tests passed.');

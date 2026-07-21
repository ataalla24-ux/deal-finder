import assert from 'node:assert/strict';

import {
  buildHeuristicDeal,
  explicitOfferEnd,
  explicitOfferWindow,
  filterDealsRejectedByCandidates,
  freshnessRejectionReason,
  makeCandidate,
  mergeAiDeal,
  parsePubDate,
  rankCandidatesForScan,
  resolveViennaEvidence,
  isTerminalRejection,
} from '../scraper/instagram-ai-agent.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

assert.equal(isTerminalRejection('LLM hat Kandidat abgelehnt'), false, 'LLM judgment is retryable when better evidence appears');

function isoAgo(milliseconds) {
  return new Date(Date.now() - milliseconds).toISOString();
}

function dateText(date) {
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`;
}

function candidate({
  shortcode,
  description,
  ageMs = HOUR_MS,
  source = 'duckduckgo',
  sourceDeal = { ownerUsername: 'ugisvienna' },
}) {
  const row = makeCandidate({
    url: `https://www.instagram.com/reel/${shortcode}/`,
    source,
    sourceDeal,
  });
  row.preview = {
    status: 200,
    title: description,
    description,
    pubDate: isoAgo(ageMs),
    pubDateSource: 'instagram-rendered-time-datetime',
  };
  return row;
}

const handleContext = candidate({
  shortcode: 'ViennaHandle1',
  description: '@ugisvienna: Nur heute gibt es in 1070 Wien zu jedem Burger einen Kaffee gratis.',
});
const viennaEvidence = resolveViennaEvidence(handleContext);
assert.equal(viennaEvidence?.source, 'instagram-post');
const handleDeal = buildHeuristicDeal(handleContext);
assert.ok(handleDeal, 'a fresh deal from an explicitly Vienna account should be accepted');
assert.match(handleDeal.distance, /Wien/);
assert.equal(handleDeal.pubDate, handleDeal.sourcePublishedAt);
assert.ok(handleDeal.evidence.viennaEvidence);
assert.equal(handleDeal.viennaEvidence.verified, true);
assert.equal(handleDeal.sourcePublishedAtSource, handleDeal.pubDateSource);

const unrelatedMention = candidate({
  shortcode: 'UnrelatedViennaMention1',
  description: 'Nur heute in München: Burger gratis. Danke @ugisvienna!',
  sourceDeal: { ownerUsername: 'muenchenburger' },
});
assert.equal(resolveViennaEvidence(unrelatedMention), null, 'an unrelated @Vienna mention is not location evidence');
assert.equal(buildHeuristicDeal(unrelatedMention), null);

const misleadingHandle = candidate({
  shortcode: 'MisleadingViennaHandle1',
  description: 'Nur heute in München: Burger gratis.',
  sourceDeal: { ownerUsername: 'cheapviennaonline' },
});
assert.equal(resolveViennaEvidence(misleadingHandle), null, 'Vienna-like text in an unverified owner handle is not location proof');
assert.equal(buildHeuristicDeal(misleadingHandle), null);

const freeAttributeNotOffer = candidate({
  shortcode: 'GlutenFreeNotDeal1',
  description: '@ugisvienna: Unsere neue gluten-free Pizza ist da.',
});
assert.equal(buildHeuristicDeal(freeAttributeNotOffer), null, 'gluten-free is a product attribute, not a free deal');

const discoveryAccountLocation = candidate({
  shortcode: 'DiscoveryAccountMunich1',
  description: 'Nur heute in München: Burger gratis.',
  sourceDeal: { ownerUsername: 'viennaeats', sourceCategory: 'discovery' },
});
assert.equal(
  resolveViennaEvidence(discoveryAccountLocation),
  null,
  'a Vienna discovery account name does not prove that the advertised venue is in Vienna',
);

const structuredApify = makeCandidate({
  url: 'https://www.instagram.com/reel/StructuredApify1/',
  source: 'instagram-apify',
  sourceDeal: {
    brand: 'Test Café',
    title: 'Kaffee gratis zum Frühstück',
    description: 'Zu jedem Frühstück gibt es einen Kaffee gratis.',
    originSource: 'Apify Instagram Vienna Food Offers',
    sourcePublishedAt: isoAgo(HOUR_MS),
    pubDateSource: 'apifyPostMetadata',
    instagramHandle: 'testcafe',
    address: 'Taborstraße 1, 1020 Wien',
    distance: 'Taborstraße 1, 1020 Wien',
    viennaVerified: true,
    viennaEvidence: { verified: true, source: 'apify-location', detail: 'Taborstraße 1, 1020 Wien' },
  },
});
assert.equal(resolveViennaEvidence(structuredApify)?.source, 'structured-location');
assert.ok(buildHeuristicDeal(structuredApify), 'trusted structured Apify post metadata should remain usable without synthetic fields');

const syntheticDate = candidate({
  shortcode: 'SyntheticDate1',
  description: '@ugisvienna: Burger gratis.',
});
syntheticDate.preview.pubDateSource = 'firecrawlAgentRun';
syntheticDate.discoveredAt = syntheticDate.preview.pubDate;
assert.equal(parsePubDate(syntheticDate), null, 'a crawler/discovery timestamp must not become the Instagram post date');

const missingDateProvenance = makeCandidate({
  url: 'https://www.instagram.com/reel/MissingDateProvenance1/',
  source: 'instagram-apify',
  sourceDeal: {
    brand: 'Test Café',
    caption: 'In 1070 Wien gibt es einen Kaffee gratis.',
    sourcePublishedAt: isoAgo(HOUR_MS),
  },
});
assert.equal(parsePubDate(missingDateProvenance), null, 'sourcePublishedAt without a declared source is not trusted');
assert.equal(buildHeuristicDeal(missingDateProvenance), null);

const syntheticAiDate = candidate({
  shortcode: 'SyntheticAiDate1',
  description: 'In 1070 Wien gibt es einen Burger gratis.',
});
syntheticAiDate.preview.pubDateSource = 'instagram-ai-agent';
assert.equal(parsePubDate(syntheticAiDate), null, 'the AI agent name is not post timestamp provenance');

const giveaway = candidate({
  shortcode: 'Giveaway1',
  description: '@ugisvienna: Gewinnspiel – gewinne einen Burger gratis.',
});
assert.equal(buildHeuristicDeal(giveaway), null);
assert.match(giveaway.rejectionReason, /Gewinnspiel/i);

const staleWithoutEnd = candidate({
  shortcode: 'StaleNoEnd1',
  ageMs: 4 * DAY_MS,
  description: '@ugisvienna: Zu jedem Burger gibt es einen Kaffee gratis.',
});
assert.equal(freshnessRejectionReason(staleWithoutEnd), '');
assert.ok(buildHeuristicDeal(staleWithoutEnd), 'a four-day-old post remains inside the current seven-day freshness window');

const summerNow = new Date('2026-08-17T12:00:00.000Z');
assert.equal(
  explicitOfferEnd('Gratis-Kaffee, gültig bis 05.01.', summerNow)?.date.getFullYear(),
  2026,
  'an old yearless January date must not be revived as next year in summer',
);
const decemberNow = new Date('2026-12-17T12:00:00.000Z');
assert.equal(explicitOfferEnd('Gratis-Kaffee, gültig bis 05.01.', decemberNow)?.date.getFullYear(), 2027);

const futureEnd = new Date(Date.now() + 2 * DAY_MS);
const staleWithEnd = candidate({
  shortcode: 'StaleFutureEnd1',
  ageMs: 4 * DAY_MS,
  description: `@ugisvienna: In 1070 Wien gibt es zu jedem Burger einen Kaffee gratis, gültig bis ${dateText(futureEnd)}.`,
});
assert.equal(freshnessRejectionReason(staleWithEnd), '');
assert.ok(buildHeuristicDeal(staleWithEnd), 'a post aged 3–7 days needs and has a future explicit offer end');

const rangeEnd = explicitOfferEnd('Aktion vom 12. Juli bis 25. Juli 2026');
assert.equal(rangeEnd?.date.getFullYear(), 2026);
assert.equal(rangeEnd?.date.getMonth(), 6);
assert.equal(rangeEnd?.date.getDate(), 25);
assert.equal(explicitOfferEnd('12.-25.07.2026')?.date.getDate(), 25);

const vetoCandidate = candidate({
  shortcode: 'LlmVeto1',
  description: '@ugisvienna: Nur heute gibt es in 1070 Wien einen Burger gratis.',
});
const heuristicBeforeVeto = buildHeuristicDeal(vetoCandidate);
assert.ok(heuristicBeforeVeto);
const aiDeal = mergeAiDeal(vetoCandidate, {
  accept: false,
  confidence: 0.92,
  reason: 'Vage oder irreführende Aktion',
});
assert.equal(aiDeal, null);
assert.match(vetoCandidate.rejectionReason, /^LLM hat Kandidat abgelehnt/);
assert.deepEqual(
  filterDealsRejectedByCandidates([heuristicBeforeVeto], [vetoCandidate]),
  [],
  'an LLM rejection must veto a heuristic deal for the same post',
);

const freshRanked = makeCandidate({
  url: 'https://www.instagram.com/reel/FreshRank1/',
  source: 'existing-instagram',
  sourceDeal: {
    sourcePublishedAt: isoAgo(2 * HOUR_MS),
    pubDateSource: 'instagram-graph-post-timestamp',
    title: 'fresh',
  },
});
const oldRanked = makeCandidate({
  url: 'https://www.instagram.com/reel/OldRank1/',
  source: 'existing-instagram',
  sourceDeal: {
    sourcePublishedAt: isoAgo(6 * DAY_MS),
    pubDateSource: 'instagram-graph-post-timestamp',
    title: 'old',
  },
});
assert.equal(rankCandidatesForScan([oldRanked, freshRanked])[0].url, freshRanked.url);

const explicitlyNotVienna = candidate({
  shortcode: 'ExplicitlyNotVienna1',
  description: 'Nur in München, nicht in Wien: Burger gratis.',
  sourceDeal: { ownerUsername: 'muenchenburger', brand: 'München Burger' },
});
assert.equal(resolveViennaEvidence(explicitlyNotVienna), null, 'a negated Vienna mention is not positive evidence');
assert.equal(buildHeuristicDeal(explicitlyNotVienna), null);

const selfCertifiedVienna = makeCandidate({
  url: 'https://www.instagram.com/reel/SelfCertifiedVienna1/',
  source: 'instagram-apify',
  sourceDeal: {
    brand: 'München Burger',
    caption: 'Nur in München: Burger gratis.',
    description: 'Nur in München: Burger gratis.',
    originSource: 'Apify Instagram Vienna Food Offers',
    sourcePublishedAt: isoAgo(HOUR_MS),
    sourcePublishedAtSource: 'apify-postPublishedAt',
    viennaVerified: true,
    distance: 'Wien',
  },
});
assert.equal(resolveViennaEvidence(selfCertifiedVienna), null, 'a boolean plus default distance cannot certify Vienna');
assert.equal(buildHeuristicDeal(selfCertifiedVienna), null);

const futureStartDate = new Date(Date.now() + 2 * DAY_MS);
const futureEndDate = new Date(Date.now() + 4 * DAY_MS);
const futureRange = candidate({
  shortcode: 'FutureRange1',
  description: `Test Café: Aktion ${dateText(futureStartDate)}–${dateText(futureEndDate)} in 1070 Wien: Burger gratis.`,
  sourceDeal: { ownerUsername: 'testcafe', brand: 'Test Café' },
});
assert.equal(explicitOfferWindow(futureRange.preview.description).validFrom, dateText(futureStartDate).split('.').reverse().join('-'));
assert.equal(buildHeuristicDeal(futureRange), null, 'a future validity range must not surface before validFrom');
assert.match(futureRange.rejectionReason, /noch nicht (?:gestartet|begonnen)/i);

const authoritativeOldDate = isoAgo(30 * DAY_MS);
const freshPreviewCannotOverride = makeCandidate({
  url: 'https://www.instagram.com/reel/AuthoritativeOldDate1/',
  source: 'instagram-apify',
  sourceDeal: {
    brand: 'Test Café',
    caption: 'In 1070 Wien gibt es einen Kaffee gratis.',
    description: 'In 1070 Wien gibt es einen Kaffee gratis.',
    originSource: 'Apify Instagram Vienna Food Offers',
    sourcePublishedAt: authoritativeOldDate,
    sourcePublishedAtSource: 'apify-postPublishedAt',
    viennaVerified: true,
    viennaEvidence: { verified: true, source: 'apify-location', detail: 'Taborstraße 1, 1020 Wien' },
  },
});
freshPreviewCannotOverride.preview = {
  title: 'In 1070 Wien gibt es einen Kaffee gratis.',
  description: 'In 1070 Wien gibt es einen Kaffee gratis.',
  pubDate: isoAgo(HOUR_MS),
  pubDateSource: 'instagram-rendered-time-datetime',
};
assert.equal(parsePubDate(freshPreviewCannotOverride)?.date.toISOString(), authoritativeOldDate);
assert.equal(buildHeuristicDeal(freshPreviewCannotOverride), null, 'a fresh preview cannot override an old authoritative Apify timestamp');
assert.match(freshPreviewCannotOverride.rejectionReason, /aelter als 7 Tage/i);

const everyMorning = candidate({
  shortcode: 'EveryMorning1',
  ageMs: 2 * DAY_MS,
  description: 'Morning Café: Jeden Morgen in 1070 Wien gibt es einen Kaffee gratis zum Frühstück.',
  sourceDeal: { ownerUsername: 'morningcafe', brand: 'Morning Café' },
});
assert.ok(buildHeuristicDeal(everyMorning), 'Jeden Morgen is recurring morning language, not relative tomorrow');

const openedYesterday = candidate({
  shortcode: 'OpenedYesterday1',
  description: 'Test Café: Gestern eröffnet, ab heute in 1070 Wien: 20% Rabatt auf Burger.',
  sourceDeal: { ownerUsername: 'testcafe', brand: 'Test Café' },
});
assert.ok(buildHeuristicDeal(openedYesterday), 'Gestern eröffnet does not mean the current promotion expired yesterday');

const withinClockSkew = candidate({
  shortcode: 'ClockSkew9m1',
  description: 'Test Café: In 1070 Wien gibt es einen Kaffee gratis.',
  sourceDeal: { ownerUsername: 'testcafe', brand: 'Test Café' },
});
withinClockSkew.preview.pubDate = new Date(Date.now() + 9 * 60 * 1000).toISOString();
assert.ok(parsePubDate(withinClockSkew));
const beyondClockSkew = candidate({
  shortcode: 'ClockSkew11m1',
  description: 'Test Café: In 1070 Wien gibt es einen Kaffee gratis.',
  sourceDeal: { ownerUsername: 'testcafe', brand: 'Test Café' },
});
beyondClockSkew.preview.pubDate = new Date(Date.now() + 11 * 60 * 1000).toISOString();
assert.equal(parsePubDate(beyondClockSkew), null, 'agent and validator both enforce a ten-minute clock skew');

assert.equal(process.env.TZ, 'Europe/Vienna', 'relative Instagram language is evaluated on Vienna calendar days');

console.log('Instagram AI agent invariants: ok');

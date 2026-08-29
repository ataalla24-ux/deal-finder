import assert from 'node:assert/strict';

import { validateDealsForSlack } from '../scraper/deal-validity-agent.js';
import {
  moderationReasonForDeal,
  normalizeUrl,
  splitModerationTargets,
} from '../scraper/deal-moderation-utils.js';
import {
  addSeenDealsFromThread,
  buildFirecrawlReviewMessage,
  buildSlackMessage,
  combineFirecrawlReviewSelections,
  filterAlreadyQueuedDeals,
  filterDuplicateDealsInRun,
  loadLiveDealDuplicateKeys,
  loadQueuedDealDuplicateKeys,
  mergePendingQueue,
  normalizeSeenPostCache,
  normalizeDeal,
  prepareKey4ReviewDeals,
  pruneStaleQueueDeals,
  revalidateRecentPostedQueue,
  selectFirecrawlReviewDeals,
  validateAndDedupeDealsForSlack,
} from '../scraper/slack-notify.js';

const now = new Date('2026-07-20T12:00:00.000Z');

assert.deepEqual(
  splitModerationTargets('deal-a, deal-b\ndeal-a'),
  ['deal-a', 'deal-b'],
  'manual moderation accepts unique comma- or newline-separated targets',
);

const postedSeenKeys = new Set();
assert.equal(addSeenDealsFromThread(postedSeenKeys, [{
  url: 'https://www.instagram.com/reel/JustPosted/?utm_source=ig_web_copy_link',
}]), 1);
assert.deepEqual([...postedSeenKeys], ['instagram:reel:JustPosted']);
assert.equal(addSeenDealsFromThread(postedSeenKeys, [{
  url: 'https://www.instagram.com/reel/JustPosted/',
}]), 0, 'a confirmed Slack post must enter the seen cache only once');

const mergedSocialQueue = mergePendingQueue([
  { slackTs: '1.001', url: 'https://www.instagram.com/reel/DupPost/' },
], [
  { slackTs: '2.002', url: 'https://instagram.com/reel/DupPost/?utm_source=ig_web_copy_link', title: 'newer presentation' },
]);
assert.equal(mergedSocialQueue.length, 1, 'the same Instagram post must occupy one queue row even with different Slack timestamps');
assert.equal(mergedSocialQueue[0].slackTs, '1.001', 'the existing Slack timestamp remains addressable after the merge');

const freshSeenCache = normalizeSeenPostCache({
  generatedAt: '2026-07-20T11:55:00.000Z',
  suppressionDays: 7,
  seenPostKeys: ['instagram:reel:FreshOne', '', 'x'.repeat(1001)],
}, { now, maxAgeMinutes: 10, suppressionDays: 7 });
assert.equal(freshSeenCache.fresh, true);
assert.deepEqual([...freshSeenCache.keys], ['instagram:reel:FreshOne']);
assert.equal(normalizeSeenPostCache({
  generatedAt: '2026-07-20T11:40:00.000Z',
  suppressionDays: 7,
  seenPostKeys: ['instagram:reel:OlderOne'],
}, { now, maxAgeMinutes: 10, suppressionDays: 7 }).fresh, false);

const removedFlightUrl = 'https://www.ryanair.com/gb/en/trip/flights/select?originIata=VIE&destinationIata=IBZ&dateOut=2026-06-28&dateIn=2026-07-03&isReturn=true';
const freshFlightUrl = 'https://www.ryanair.com/gb/en/trip/flights/select?adults=1&originIata=VIE&destinationIata=PMI&dateOut=2026-09-28&dateIn=2026-10-02&isReturn=true';
const flightModeration = {
  hiddenDeals: [{ url: removedFlightUrl, reason: 'old itinerary removed' }],
};
assert.notEqual(normalizeUrl(removedFlightUrl), normalizeUrl(freshFlightUrl));
assert.equal(moderationReasonForDeal({ url: removedFlightUrl }, flightModeration), 'old itinerary removed');
assert.equal(
  moderationReasonForDeal({ url: freshFlightUrl }, flightModeration),
  '',
  'removing one itinerary must not suppress every flight from the provider',
);

const instagramPostUrl = 'https://www.instagram.com/p/DcQ1U7ENZAY/';
const instagramReelUrl = 'https://instagram.com/reel/DcQ1U7ENZAY/?utm_source=ig_web_copy_link';
const instagramModeration = {
  hiddenDeals: [{ url: instagramPostUrl, reason: 'expired Instagram post' }],
};
assert.equal(
  normalizeUrl(instagramPostUrl),
  normalizeUrl(instagramReelUrl),
  'Instagram p/reel URL variants must share one moderation identity',
);
assert.equal(
  moderationReasonForDeal({ url: instagramReelUrl }, instagramModeration),
  'expired Instagram post',
  'moderation must block every URL variant of the same Instagram shortcode',
);

function healthyUrl(url, overrides = {}) {
  return {
    status: 200,
    finalUrl: url,
    dateHints: {},
    contentHints: {},
    ...overrides,
  };
}

async function validateOne(deal, healthOverrides = {}, optionOverrides = {}) {
  const result = await validateDealsForSlack([deal], {
    now,
    maxAgeDays: 7,
    extendedMaxAgeDays: 45,
    concurrency: 1,
    inspectDealUrlHealth: async (url) => healthyUrl(url, healthOverrides),
    ...optionOverrides,
  });
  return result.results[0];
}

function reasonText(result) {
  return result.decision.reasons.join(' | ');
}

const sourceSummaryValidation = await validateDealsForSlack([
  { id: 'source-a-1', source: 'Scraper A', title: 'Sommermenü', url: 'https://example.com/a' },
  { id: 'source-b-1', source: 'Scraper B', title: 'Sommermenü', url: 'https://example.com/b' },
], {
  now,
  concurrency: 1,
  inspectDealUrlHealth: async (url) => healthyUrl(url),
});
assert.equal(sourceSummaryValidation.summary.sourceCounts['Scraper A'].total, 1);
assert.equal(sourceSummaryValidation.summary.sourceCounts['Scraper B'].blocked, 1);

const missingLocation = normalizeDeal({
  id: 'missing-location',
  title: '50% Rabatt auf Kaffee',
  url: 'https://example.com/coffee',
  source: 'Test',
  validUntil: '2026-07-31',
}, 'test');
assert.equal(missingLocation.distance, '', 'missing locations must not be defaulted to Wien');
assert.ok(missingLocation.missingFields.includes('Ort'));

const resolvedMissingEvidence = normalizeDeal({
  id: 'resolved-missing-evidence',
  title: 'Gratis Kaffee',
  url: 'https://example.com/resolved',
  source: 'Test',
  distance: '1070 Wien',
  validUntil: '2026-07-31',
  missingFields: ['Ziel-URL', 'Ort', 'Ablauf', 'Quelle', 'Manuelle Preisprüfung'],
}, 'test');
assert.deepEqual(
  resolvedMissingEvidence.missingFields,
  ['Manuelle Preisprüfung'],
  'resolved standard fields must clear stale Slack warnings without deleting custom review notes',
);

const structuredLocation = { address: 'Museumsplatz 1', city: 'Wien', postalCode: '1070' };
const normalizedStructured = normalizeDeal({
  id: 'structured',
  title: '1+1 Ticket gratis',
  url: 'https://example.com/tickets',
  source: 'Test',
  location: structuredLocation,
  sourcePublishedAt: '2026-07-20T08:00:00.000Z',
  sourcePublishedAtSource: 'post.timestamp',
  validFrom: '2026-07-01',
  validUntil: '2026-07-31',
  expiryKind: 'range',
  dateConfidence: 'high',
  viennaEvidence: { verified: true, type: 'address' },
  evidence: { textSample: '1+1 Ticket gratis, Museumsplatz 1, 1070 Wien' },
}, 'test');
assert.deepEqual(normalizedStructured.location, structuredLocation);
assert.equal(normalizedStructured.distance, 'Museumsplatz 1');
assert.equal(normalizedStructured.sourcePublishedAt, '2026-07-20T08:00:00.000Z');
assert.equal(normalizedStructured.sourcePublishedAtSource, 'post.timestamp');
assert.equal(normalizedStructured.validFrom, '2026-07-01');
assert.equal(normalizedStructured.validUntil, '2026-07-31');
assert.equal(normalizedStructured.expiryKind, 'range');
assert.deepEqual(normalizedStructured.viennaEvidence, { verified: true, type: 'address' });
assert.deepEqual(normalizedStructured.evidence, { textSample: '1+1 Ticket gratis, Museumsplatz 1, 1070 Wien' });

for (const rawExpiry of ['4.9.2026', '04.09.2026', '4/9/2026']) {
  const normalizedAidsDate = normalizeDeal({
    id: `normalized-aids-${rawExpiry}`,
    brand: 'Aids Hilfe Wien',
    title: 'Am 4. September 2026: 6. Straßenfest',
    description: 'Gratis Kinderbetreuung beim Straßenfest in Wien.',
    url: 'https://example.com/aids-date',
    source: 'Instagram AI',
    distance: 'Wien',
    expires: rawExpiry,
  }, 'instagram-ai');
  assert.equal(normalizedAidsDate.expires, '2026-09-04', `${rawExpiry} must be parsed as de-AT day/month`);
}

const normalizedYearlessKebab = normalizeDeal({
  id: 'g2-1t6vl5f',
  brand: 'Kebab Lokal',
  title: 'Gratis Kebab (100 Stück)',
  description: '100 Stück Kebab gratis in Wien.',
  url: 'https://www.instagram.com/kebab_lokal_wien/',
  source: 'Slack Digest',
  originSource: 'Firecrawl Gastro #2',
  distance: 'Wien',
  expires: '01.10 13:00 bis 15:00 Uhr',
  pubDate: now.toISOString(),
  pubDateSource: 'firecrawlAgentRun',
}, 'gastro2');
assert.equal(normalizedYearlessKebab.expires, '01.10 13:00 bis 15:00 Uhr');
const yearlessKebabResult = await validateOne(normalizedYearlessKebab);
assert.equal(yearlessKebabResult.decision.allowed, false);
assert.match(reasonText(yearlessKebabResult), /kein echtes Social-Post-Datum/);

const crawlerDuplicateResult = filterDuplicateDealsInRun([
  normalizeDeal({
    id: 'mr-noodle-1',
    brand: 'Mr. Noodle Chen Wien',
    title: 'Kostenloser Nudel-Nachschlag',
    url: 'https://goodnight.at/magazin/freizeit/neue-lokale-juli-2026',
    source: 'Firecrawl Gastro #2',
    distance: '1070 Wien',
  }, 'gastro2'),
  normalizeDeal({
    id: 'mr-noodle-2',
    brand: 'Mr. Noodle Chen Vienna',
    title: 'Gratis Noodle-Nachschlag (Free refills)',
    url: 'https://goodnight.at/magazin/freizeit/neue-lokale-juli-2026',
    source: 'Firecrawl Gastro #2',
    distance: '1070 Wien',
  }, 'gastro2'),
]);
assert.equal(crawlerDuplicateResult.deals.length, 1, 'crawler variants of one brand on one page must collapse');

const repairedWatertuin = normalizeDeal({
  id: 'g2-2cotm',
  brand: 'TUI',
  title: 'Free All-You-Can-Eat & Drink on your birthday (with paying c',
  url: 'https://www.watertuin.at/',
  source: 'Slack Digest',
  originSource: 'Firecrawl Gastro #2',
  distance: 'Etrichstraße 23, 1110 Wien',
  logo: '✈️',
  logoUrl: 'https://www.google.com/s2/favicons?sz=256&domain_url=https://tui.at',
}, 'gastro2');
assert.equal(repairedWatertuin.brand, 'Watertuin');
assert.equal(repairedWatertuin.title, 'Gratis All-you-can-eat & Drinks am Geburtstag');
assert.equal(repairedWatertuin.logo, '🍽️');
assert.match(repairedWatertuin.logoUrl, /watertuin\.at/);

const repairedMcDonalds = normalizeDeal({
  id: 'mcd-title',
  brand: "McDonald's",
  title: '1+1 gratis Burger (McChicken, Hamburger Royal TS, Filet-o-Fi',
  url: 'https://www.foodora.at/contents/mcdonalds',
  source: 'Firecrawl',
  distance: 'Wien',
}, 'gastro2');
assert.equal(repairedMcDonalds.title, "1+1 gratis Burger bei McDonald's");

const repairedBurgerKing = normalizeDeal({
  id: 'bk-title',
  brand: 'Burger King',
  title: 'Verschiedene Coupons und 1+1 Aktionen in der',
  url: 'https://www.burgerking.at/en/',
  source: 'Firecrawl',
  distance: 'Wien',
}, 'gastro2');
assert.equal(repairedBurgerKing.title, 'Verschiedene Burger-King-Coupons und 1+1-Aktionen');

const repairedLovingHut = normalizeDeal({
  id: 'lovinghut-title',
  brand: '@lovinghut.neubau',
  title: 'strawberry: Unser Community-Special bis Monatsende',
  url: 'https://www.tiktok.com/@lovinghut.neubau/video/7663835517779266836',
  source: 'TikTok Scanner',
  distance: 'Wien',
}, 'tiktok');
assert.equal(repairedLovingHut.title, 'Unser Community-Special bis Monatsende');

const crossUrlCrawlerDuplicate = filterDuplicateDealsInRun([
  { brand: 'Cafe Wien', title: 'Gratis Frühstück am Montag', url: 'https://cafe.example/fruehstueck', source: 'Firecrawl' },
  { brand: 'Cafe Wien', title: '1+1 Kaffee am Freitag', url: 'https://cafe.example/kaffee', source: 'Firecrawl' },
]);
assert.equal(
  crossUrlCrawlerDuplicate.deals.length,
  2,
  'different Firecrawl offers from one brand must both reach Slack',
);

const repeatedSocialPromotion = filterDuplicateDealsInRun([
  {
    id: 'cryo-post-a',
    ownerUsername: 'longevitycenter.vienna',
    brand: 'Longevity Center Vienna',
    title: 'All you can Cryo um 200 Euro',
    description: 'Eine Studie berichtet von 58 % Verbesserung.',
    promotionEvidence: 'All you can Cryo Aktion um 200 €',
    url: 'https://www.instagram.com/p/CRYOPOSTA/',
    source: 'Meta Instagram',
  },
  {
    id: 'cryo-post-b',
    ownerUsername: 'longevitycenter.vienna',
    brand: 'Longevity Center Vienna',
    title: 'All-you-can Kältekammer',
    description: 'Andere Messwerte lagen bei 47 % und 56 %.',
    promotionEvidence: 'All you can Cryo Aktion um 200 Euro',
    url: 'https://www.instagram.com/reel/CRYOPOSTB/',
    source: 'Meta Instagram',
  },
]);
assert.equal(repeatedSocialPromotion.deals.length, 1, 'repeated social posts for one promotion collapse before Slack');

const crossPlatformPromotion = filterDuplicateDealsInRun([
  {
    id: 'milano-instagram',
    ownerUsername: 'cafe.milano.at',
    brand: 'Cafe Milano Wien',
    title: 'Zweiter Kaffee gratis',
    promotionEvidence: 'Zweiter Kaffee gratis',
    validUntil: '2026-08-30',
    pubDate: '2026-07-19T08:00:00.000Z',
    pubDateSource: 'instagram-graph-timestamp',
    url: 'https://www.instagram.com/p/CAFEBOGOIG/',
    source: 'Meta Instagram',
    qualityScore: 82,
  },
  {
    id: 'milano-tiktok',
    ownerUsername: 'cafe.milano.at',
    brand: '@cafe.milano.at',
    title: '2. Kaffee kostenlos',
    promotionEvidence: '2. Kaffee kostenlos',
    validUntil: '2026-08-30',
    pubDate: '2026-07-19T09:00:00.000Z',
    pubDateSource: 'tiktok-create-time',
    url: 'https://www.tiktok.com/@cafe.milano.at/video/7678002441849425200',
    source: 'TikTok Scanner',
    qualityScore: 88,
  },
  {
    id: 'milano-website',
    brand: 'Cafe Milano',
    title: 'Den zweiten Kaffee gibt es gratis',
    validUntil: '2026-08-30',
    url: 'https://cafemilano.example/aktionen/zweiter-kaffee-gratis',
    source: 'Official',
    qualityScore: 90,
  },
]);
assert.equal(crossPlatformPromotion.deals.length, 1, 'one campaign reaches Slack only once across Instagram, TikTok and website');
assert.equal(crossPlatformPromotion.removed, 2);
assert.deepEqual(
  new Set(crossPlatformPromotion.deals[0].evidenceSources),
  new Set(['Meta Instagram', 'TikTok Scanner', 'Official']),
  'the surviving record preserves all evidence sources',
);

const crossPlatformLiveKeys = loadLiveDealDuplicateKeys([{
  id: 'milano-live',
  brand: 'Cafe Milano',
  title: 'Den zweiten Kaffee gibt es gratis',
  validUntil: '2026-08-30',
  url: 'https://cafemilano.example/aktionen/zweiter-kaffee-gratis',
  source: 'Official',
}]);
const crossPlatformLiveFilter = filterAlreadyQueuedDeals([{
  id: 'milano-new-social-post',
  brand: '@cafe.milano.at',
  ownerUsername: 'cafe.milano.at',
  title: '2. Kaffee kostenlos',
  promotionEvidence: '2. Kaffee kostenlos',
  validUntil: '2026-08-30',
  url: 'https://www.instagram.com/p/CAFEBOGONEW/',
  source: 'Meta Instagram',
}], crossPlatformLiveKeys);
assert.equal(crossPlatformLiveFilter.removed, 1, 'a live website campaign suppresses its later social cross-post');

const liveDealKeys = loadLiveDealDuplicateKeys([
  {
    id: 'live-social-one',
    title: 'Alter redaktioneller Titel',
    url: 'https://www.instagram.com/reel/LIVEPOSTONE/?utm_source=instagram',
    source: 'Slack Digest',
  },
  {
    id: 'flight-existing-dates',
    title: 'Hin & zurück nach Palma ab €45.98',
    url: 'https://www.ryanair.com/gb/en/trip/flights/select?originIata=VIE&destinationIata=PMI&dateOut=2026-10-20&dateIn=2026-10-22&isReturn=true&utm_source=slack',
    source: 'Slack Digest',
  },
  {
    id: 'live-voucher',
    title: '15% Gutschein bei Matratzen Discount',
    url: 'https://www.gutscheine.at/matratzen-discount?utm_campaign=summer',
    source: 'Slack Digest',
  },
  {
    id: 'live-official-offer',
    title: '15% Rabatt auf Frühstück',
    url: 'https://cafe.example/angebote?utm_source=newsletter',
    source: 'Official',
  },
]);
const liveDealFilter = filterAlreadyQueuedDeals([
  {
    id: 'fresh-social-id',
    title: 'Verbesserter Titel desselben Posts',
    url: 'https://instagram.com/p/LIVEPOSTONE/',
    source: 'Meta Instagram',
  },
  {
    id: 'flight-same-dates',
    title: 'Hin & zurück nach Palma ab €45.98',
    url: 'https://www.ryanair.com/gb/en/trip/flights/select?dateIn=2026-10-22&isReturn=true&destinationIata=PMI&dateOut=2026-10-20&originIata=VIE',
    source: 'Flights Vienna',
  },
  {
    id: 'flight-new-dates',
    title: 'Hin & zurück nach Palma ab €45.98',
    url: 'https://www.ryanair.com/gb/en/trip/flights/select?originIata=VIE&destinationIata=PMI&dateOut=2026-11-03&dateIn=2026-11-06&isReturn=true',
    source: 'Flights Vienna',
  },
  {
    id: 'voucher-same-campaign',
    title: '15% Gutschein bei Matratzen Discount',
    url: 'https://www.gutscheine.at/matratzen-discount',
    source: 'Gutscheine.at',
  },
  {
    id: 'official-new-campaign',
    title: '20% Rabatt auf Abendessen',
    url: 'https://cafe.example/angebote',
    source: 'Official',
  },
], liveDealKeys);
assert.equal(liveDealFilter.removed, 3, 'exact live social posts, flight itineraries and vouchers must not return to Slack');
assert.deepEqual(
  liveDealFilter.deals.map((deal) => deal.id),
  ['flight-new-dates', 'official-new-campaign'],
  'new flight dates and a genuinely changed offer on the same landing page must remain eligible',
);

const premiumKebap = await validateOne({
  id: 'premium-kebap',
  brand: 'Nefis Kebap',
  title: 'Premium Kebap (location mentioned)',
  description: '',
  url: 'https://www.instagram.com/nefis_kebap_wien/',
  source: 'Slack Digest',
  originSource: 'Firecrawl Gastro #2',
  distance: 'Kürschnergasse 9, 1210 Wien',
  pubDate: now.toISOString(),
});
assert.equal(premiumKebap.decision.allowed, false);
assert.match(reasonText(premiumKebap), /kein konkretes Angebot/);

const streetFoodTacos = await validateOne({
  id: 'street-food-tacos',
  brand: 'Casa Schuk',
  title: 'Street Food Tacos am Donaukanal',
  description: 'Obere Donaustraße 63, 1020 Wien',
  url: 'https://www.tiktok.com/@viennaintouch/video/7658744501372062998',
  source: 'Slack Digest',
  originSource: 'Firecrawl Gastro #2',
  distance: 'Obere Donaustraße 63, 1020 Wien',
  pubDate: now.toISOString(),
  pubDateSource: '',
});
assert.equal(streetFoodTacos.decision.allowed, false);
assert.match(reasonText(streetFoodTacos), /kein konkretes Angebot/);

const liebherrListing = await validateOne({
  id: 'liebherr-listing',
  brand: '@herr.wien',
  title: 'Zwei Profi Liebherr Kühlvitrinen – wie NEU',
  description: 'Preis: 425 € pro Stück. Gratis Lieferung in ganz Wien (Erdgeschoss). Zustand top.',
  url: 'https://www.tiktok.com/@herr.wien/video/7663527075298446614',
  source: 'TikTok Scanner',
  originSource: 'tiktok-deals-scanner',
  distance: 'Geblergasse 60, 1170 Wien',
  pubDate: '2026-07-17T12:00:00.000Z',
  pubDateSource: 'time.datetime',
});
assert.equal(liebherrListing.decision.allowed, false);
assert.match(reasonText(liebherrListing), /nur Gratis-Lieferung\/Versand/);

const agaveGiveaway = await validateOne({
  id: 'agave-giveaway',
  brand: 'Agave',
  title: 'Agave: Free meal',
  description: 'GIVEAWAY: Folge uns, tagge zwei Freunde und gewinne ein free meal.',
  url: 'https://www.instagram.com/reel/Da-pFh9tzty/',
  source: 'Slack Digest',
  originSource: 'Firecrawl Food #2',
  distance: 'Not specified (suggests Austria)',
  pubDate: now.toISOString(),
  pubDateSource: 'firecrawlAgentRun',
});
assert.equal(agaveGiveaway.decision.allowed, false);
assert.match(reasonText(agaveGiveaway), /Gewinnspiel\/Verlosung/);
assert.match(reasonText(agaveGiveaway), /nicht eindeutig in Wien/);

const queueStyleGiveaway = await validateOne({
  id: 'queue-style-giveaway',
  brand: 'Agave',
  title: 'Agave: Free meal',
  description: '',
  url: 'https://www.instagram.com/reel/Da-pFh9tzty/',
  source: 'Slack Digest',
  originSource: 'Firecrawl Food #2',
  distance: 'Wien',
}, {
  contentHints: {
    title: 'Agave Free Meal Giveaway',
    description: 'Follow and tag friends to win a free meal.',
  },
});
assert.equal(queueStyleGiveaway.decision.allowed, false);
assert.match(reasonText(queueStyleGiveaway), /Gewinnspiel\/Verlosung/);

const limitedTicketAllocation = await validateOne({
  id: 'limited-ticket-allocation',
  brand: '@jaycatchme',
  title: 'Gratis Ticket bei @jaycatchme',
  description: 'Holt euch 2x Free Tickets für ein Konzert in Wien.',
  url: 'https://www.tiktok.com/@jaycatchme/video/7678374897038527766',
  source: 'TikTok Scanner',
  originSource: 'tiktok-deals-scanner',
  distance: 'Wien',
  pubDate: now.toISOString(),
  pubDateSource: 'time.datetime',
});
assert.equal(limitedTicketAllocation.decision.allowed, false);
assert.match(reasonText(limitedTicketAllocation), /Begrenzte Gratis-Vergabe/);

const yoriWinnerOnlyChallenge = await validateOne({
  id: 'yori-winner-only-challenge',
  brand: 'Yori 2',
  title: 'Ein Monat täglich gratis K-Chicken',
  description: 'K-Chicken Challenge in 1060 Wien. Wer am Ende die meisten Teller stapelt, gewinnt den Hauptpreis.',
  url: 'https://www.instagram.com/p/YORIWINNERONLY/',
  source: 'Meta Instagram',
  originSource: 'Meta Instagram Hashtag Search',
  distance: '1060 Wien',
  pubDate: now.toISOString(),
  pubDateSource: 'instagram-graph-timestamp',
  viennaVerified: true,
});
assert.equal(yoriWinnerOnlyChallenge.decision.allowed, false);
assert.match(reasonText(yoriWinnerOnlyChallenge), /Gewinnspiel\/Verlosung/);

const contentbudeEngagementGiveaway = await validateOne({
  id: 'contentbude-engagement-giveaway',
  brand: 'Contentbude Studio Wien',
  title: '1 Like = 1 Minute kostenlose Studiozeit',
  description: '',
  metaGraphCaption: 'Like das Reel und markier einen Artist, der Studiozeit gebrauchen könnte. Jede Minute, die ihr sammelt, wird verschenkt.',
  url: 'https://www.instagram.com/reel/CONTENTBUDEGIVEAWAY/',
  source: 'Meta Instagram',
  originSource: 'Meta Instagram Business Discovery',
  distance: 'Wien',
  pubDate: now.toISOString(),
  pubDateSource: 'instagram-graph-timestamp',
  viennaVerified: true,
});
assert.equal(contentbudeEngagementGiveaway.decision.allowed, false);
assert.match(reasonText(contentbudeEngagementGiveaway), /Engagement-Aktion ohne garantierte Gegenleistung/);

const selfSyndicatedInstagram = await validateOne({
  id: 'freefinder-feedback-loop',
  brand: 'freefinder.at',
  title: 'Gratis Coconut Strawberry Sunset testen',
  description: 'Teilnehmende Standorte in Wien prüfen.',
  url: 'https://www.instagram.com/reel/DcUFijTz9lX/',
  source: 'Instagram AI Agent',
  originSource: 'instagram-ai-agent',
  distance: 'Wien',
  pubDate: now.toISOString(),
  pubDateSource: 'instagram-rendered-time-datetime',
  evidence: {
    textSample: 'Alle aktuellen Bedingungen und den Original-Link findest du direkt in FreeFinder.',
  },
});
assert.equal(selfSyndicatedInstagram.decision.allowed, false);
assert.match(reasonText(selfSyndicatedInstagram), /selbst syndizierter FreeFinder-Post/);

const foreignViennaHandle = await validateOne({
  id: 'foreign-vienna-handle',
  brand: '@twofatpanda.vienna',
  title: 'Weekend Free Treats',
  description: 'Free treats every weekend at Two Fat Panda Vienna, Gading Serpong, Indonesia.',
  url: 'https://www.tiktok.com/@twofatpanda.vienna/video/7676699636131761415',
  source: 'TikTok Scanner',
  originSource: 'tiktok-deals-scanner',
  distance: 'Wien',
  pubDate: now.toISOString(),
  pubDateSource: 'time.datetime',
});
assert.equal(foreignViennaHandle.decision.allowed, false);
assert.match(reasonText(foreignViennaHandle), /nicht eindeutig in Wien/);

const losAngelesSearchLeak = await validateOne({
  id: 'los-angeles-search-leak',
  brand: '@weimpactla',
  title: 'Free food giveaway',
  description: 'Free food distribution at 1010 E. 10th Street, Los Angeles, CA. Open to the community.',
  url: 'https://www.tiktok.com/@weimpactla/video/7676331690842705183',
  source: 'TikTok Scanner',
  originSource: 'tiktok-deals-scanner',
  distance: 'Wien',
  pubDate: now.toISOString(),
  pubDateSource: 'time.datetime',
});
assert.equal(losAngelesSearchLeak.decision.allowed, false);
assert.match(reasonText(losAngelesSearchLeak), /nicht eindeutig in Wien/);

const genericFreeEvents = await validateOne({
  id: 'generic-free-events',
  brand: '@vienna.creator',
  title: '@vienna.creator Angebot',
  description: 'I love the amount of free events happening all the time in Vienna: concerts, festivals and activities.',
  url: 'https://www.tiktok.com/@vienna.creator/video/7674945375526030624',
  source: 'TikTok Scanner',
  originSource: 'tiktok-deals-scanner',
  distance: 'Wien',
  pubDate: now.toISOString(),
  pubDateSource: 'time.datetime',
});
assert.equal(genericFreeEvents.decision.allowed, false);
assert.match(reasonText(genericFreeEvents), /allgemeine Empfehlung\/Gratis-Event/);

const favouriteRestaurantComparison = await validateOne({
  id: 'favourite-restaurant-comparison',
  brand: '#wienessen',
  title: 'Lieblingsrestaurant in Wien?',
  description: 'Die Burger sind gut und es gibt gratis Saucen und Nachfüllungen.',
  url: 'https://www.instagram.com/reel/RECOMMENDATION/',
  source: 'Instagram',
  originSource: 'Meta Instagram Hashtag API',
  distance: 'Wien',
  pubDate: now.toISOString(),
  pubDateSource: 'instagram-graph-timestamp',
});
assert.equal(favouriteRestaurantComparison.decision.allowed, false);
assert.match(reasonText(favouriteRestaurantComparison), /allgemeine Empfehlung\/Gratis-Event/);

const favouriteRestaurantWithPrice = await validateOne({
  ...favouriteRestaurantComparison.deal,
  id: 'favourite-restaurant-price-deal',
  title: 'Lieblingsrestaurant in Wien: Burger nur 1€',
  description: 'Nur heute gibt es den Burger für 1€ in 1070 Wien.',
});
assert.equal(favouriteRestaurantWithPrice.decision.allowed, true, 'an explicit promotional price must survive recommendation filtering');

const syntheticTripAdvisor = await validateOne({
  id: 'tripadvisor-firecrawl',
  brand: 'Example Restaurant',
  title: '20% Rabatt auf alle Hauptspeisen',
  description: 'Heute 20% Rabatt in 1010 Wien.',
  url: 'https://www.tripadvisor.at/Restaurant_Review-example',
  source: 'Firecrawl',
  originSource: 'Firecrawl Gastro #2',
  distance: '1010 Wien',
  pubDate: now.toISOString(),
  pubDateSource: 'firecrawlAgentRun',
  discoveredAt: now.toISOString(),
});
assert.equal(syntheticTripAdvisor.decision.allowed, false);
assert.match(reasonText(syntheticTripAdvisor), /ausgeschlossene Quelle \(Tripadvisor\)/);

const officialOngoingFirecrawlOffer = await validateOne({
  id: 'official-ongoing-firecrawl-offer',
  brand: 'Mr. Noodle Chen',
  title: 'Kostenloser Nudel-Nachschlag',
  description: 'Kostenloser Nudel-Nachschlag in der Kirchengasse 3, 1070 Wien.',
  url: 'https://mrnoodlechen.at/de/home-de/',
  source: 'Firecrawl',
  originSource: 'Firecrawl Gastro #2',
  distance: 'Kirchengasse 3, 1070 Wien',
  pubDate: now.toISOString(),
  pubDateSource: 'firecrawlAgentRun',
});
assert.equal(officialOngoingFirecrawlOffer.decision.allowed, true);
assert.match(officialOngoingFirecrawlOffer.decision.warnings.join(' '), /kein Quell-\/Post-Datum/);

const recurringAustriaDeals = [
  {
    id: 'nordsee-austria',
    brand: 'Nordsee',
    title: '1+1 Wrap gratis bei Nordsee',
    description: '1+1 gratis Wrap, regelmäßig eine andere Sorte. Exklusiv für Drei Kund:innen.',
    url: 'https://www.drei.at/de/dreiplus/ersparnisse/nordsee/',
    expires: 'regelmäßig / laut Quelle',
    distance: 'Österreich',
  },
  {
    id: 'pizza-mann-austria',
    brand: 'Pizzamann',
    title: 'Gratis Extra-Pizza jeden Donnerstag bei Pizzamann',
    description: 'Deine gratis Extra-Pizza jeden Donnerstag. Exklusiv für Drei Kund:innen.',
    url: 'https://www.drei.at/de/dreiplus/ersparnisse/pizza-mann/',
    expires: 'regelmäßig / laut Quelle',
    distance: 'Österreich',
  },
  {
    id: 'leopold-austria',
    brand: 'Leopold Museum',
    title: '1+1 Ticket gratis bei Leopold Museum',
    description: '1+1 Ticket gratis jeden Donnerstag. Exklusiv für Drei Kund:innen.',
    url: 'https://www.drei.at/de/dreiplus/ersparnisse/leopold-museum/',
    expires: 'regelmäßig / laut Quelle',
    distance: 'Österreich',
  },
  {
    id: 'kinodonnerstag-austria',
    brand: 'KinoDonnerstag',
    title: '1+1 Kinoticket gratis bei KinoDonnerstag',
    description: "Jeden Donnerstag gibt's 1+1 Kinoticket gratis. Exklusiv für Drei Kund:innen.",
    url: 'https://www.drei.at/de/dreiplus/ersparnisse/kinodonnerstag/',
    expires: 'regelmäßig / laut Quelle',
    distance: 'Österreich',
  },
  {
    id: 'belvedere-austria',
    brand: 'Belvedere',
    title: '1+1 Ticket gratis bei Belvedere',
    description: '1+1 Ticket gratis jeden Mittwoch. Exklusiv für Drei Kund:innen.',
    url: 'https://www.drei.at/de/dreiplus/ersparnisse/belvedere/',
    expires: 'regelmäßig / laut Quelle',
    distance: 'Österreich',
  },
].map((deal) => ({
  ...deal,
  source: 'Drei Plus',
  originSource: 'member-benefits-scraper',
  pubDate: now.toISOString(),
  pubDateSource: 'sourcePage',
}));

for (const deal of recurringAustriaDeals) {
  const result = await validateOne(deal);
  assert.equal(result.decision.allowed, true, `${deal.brand} should be usable in Vienna`);
  assert.match(result.decision.warnings.join(' '), /kein Quell-\/Post-Datum|wiederkehrender Zeitplan/);
}

for (const currentWienMobilBenefit of [
  {
    id: 'benefit-wienmobil-vorteilswelt-f5601v',
    brand: 'DDSG: 1+1 gratis',
    title: 'Die DDSG lädt bei DDSG: 1+1 gratis',
    description: 'Die DDSG lädt. Exklusiv für Wiener Linien Stammkund:innen.',
  },
  {
    id: 'benefit-wienmobil-vorteilswelt-m19yzv',
    brand: '2 Euro Rabatt auf Ihr Riesenrad-Ticket',
    title: '2 Euro Rabatt auf Ihr Wiener Riesenrad-Ticket',
    description: 'Mit der WienMobil Vorteilswelt sparen Sie 2 Euro auf das Erwachsenenticket.',
  },
  {
    id: 'benefit-wienmobil-vorteilswelt-dnu78n',
    brand: '22% Rabatt auf Wiener Unterwelt Tour',
    title: '22% Rabatt auf Wiener Unterwelt Tour',
    description: '22% Rabatt für Wiener Linien Stammkund:innen.',
  },
]) {
  const result = await validateOne({
    ...currentWienMobilBenefit,
    url: 'https://www.wienerlinien.at/wienmobil-vorteilswelt',
    source: 'WienMobil Vorteilswelt',
    originSource: 'member-benefits-scraper',
    distance: 'Wien',
    expires: 'laut Quelle',
    pubDate: now.toISOString(),
    pubDateSource: 'sourcePage',
  }, {
    dateHints: { publicationDate: '2026-06-22T08:00:00.000Z' },
  });
  assert.equal(result.decision.allowed, true, `${currentWienMobilBenefit.id} is present on the current shared benefit page`);
  assert.notEqual(result.decision.sourceDateSource, 'url.publicationDate');
}

const currentViennaOffer = await validateOne({
  id: 'current-vienna-offer',
  brand: 'Vienna Coffee',
  title: 'Heute 50% Rabatt auf alle Kaffees',
  description: '50% Rabatt in der Neubaugasse 10, 1070 Wien.',
  url: 'https://www.instagram.com/reel/DbAYf0BMaIn/',
  source: 'Firecrawl',
  originSource: 'Firecrawl Gastro #2',
  distance: 'Neubaugasse 10, 1070 Wien',
  pubDate: now.toISOString(),
  pubDateSource: 'firecrawlAgentRun',
}, {
  dateHints: { publicationDate: '2025-01-01T08:00:00.000Z' },
});
assert.equal(currentViennaOffer.decision.allowed, true);
assert.equal(currentViennaOffer.decision.sourceDateSource, 'url.instagramShortcode');
assert.equal(currentViennaOffer.deal.pubDateSource, 'url.instagramShortcode');

const oldPostWithFutureValidity = await validateOne({
  id: 'old-post-future-validity',
  brand: 'Efsane',
  title: '0,99 € Döner Deal',
  description: '0,99 € Döner Deal in 1100 Wien, gültig bis Ende August.',
  url: 'https://www.tiktok.com/@viennaintouch/video/7658744501372062998',
  source: 'Firecrawl',
  originSource: 'Firecrawl Gastro #2',
  distance: '1100 Wien',
  expires: '2026-01-01',
  validUntil: '2026-08-31',
  expiryKind: 'end',
  dateConfidence: 'high',
});
assert.equal(oldPostWithFutureValidity.decision.allowed, false);
assert.equal(oldPostWithFutureValidity.decision.expiryDate, '2026-08-31');
assert.match(reasonText(oldPostWithFutureValidity), /älter als 7 Tage/);

const rawFirecrawlValidityRescue = await validateOne({
  id: 'raw-firecrawl-validity',
  brand: 'Ernesto',
  title: '2 für 1 Pizza Deal',
  description: '2 für 1 Pizza Deal in 1050 Wien.',
  url: 'https://www.instagram.com/ernesto_wien/',
  source: 'Firecrawl',
  originSource: 'Firecrawl Gastro #2',
  distance: '1050 Wien',
  pubDate: now.toISOString(),
  pubDateSource: 'firecrawlAgentRun',
  expires: '2026-08-15',
});
assert.equal(rawFirecrawlValidityRescue.decision.allowed, false);
assert.match(reasonText(rawFirecrawlValidityRescue), /kein echtes Social-Post-Datum/);

const spelunkeRecurring = await validateOne({
  id: 'spelunke-recurring',
  brand: 'Spelunke',
  title: '17-Uhr-Deal: Gratis Spritzer oder Bier zum Hauptgang',
  description: 'Mo-Fr zwischen 17 und 18 Uhr, Spelunke in 1020 Wien.',
  url: 'https://www.instagram.com/reel/DadWi5hMflt/',
  source: 'Instagram AI',
  originSource: 'instagram-ai-agent',
  distance: '1020 Wien',
  expires: 'Mo-Fr 17:00-18:00',
});
assert.equal(spelunkeRecurring.decision.allowed, false);
assert.match(reasonText(spelunkeRecurring), /älter als 7 Tage/);

const tokkiRecurring = await validateOne({
  id: 'tokki-recurring',
  brand: 'Tokki',
  title: 'All You Can Eat + Free Drink bei Tokki',
  description: 'Mo-Fr 12-17 Uhr, Mariahilfer Straße 112, 1070 Wien.',
  url: 'https://www.instagram.com/reel/DZMxfDsif1b/',
  source: 'Firecrawl',
  originSource: 'Firecrawl Gastro #2',
  distance: 'Mariahilfer Straße 112, 1070 Wien',
  expires: 'Mo-Fr 12:00-17:00',
});
assert.equal(tokkiRecurring.decision.allowed, false);
assert.match(reasonText(tokkiRecurring), /älter als 7 Tage/);

const freshSocialFutureOffer = await validateOne({
  id: 'fresh-social-future-offer',
  brand: 'Vienna Coffee',
  title: '50% Opening Deal',
  description: '50% Rabatt ab nächster Woche in 1070 Wien.',
  url: 'https://www.instagram.com/reel/DbAYf0BMaIn/',
  source: 'Instagram',
  distance: '1070 Wien',
  sourcePublishedAt: '2026-07-20T07:16:23.734Z',
  sourcePublishedAtSource: 'instagram-graph-timestamp',
  validFrom: '2026-07-25',
  validUntil: '2026-07-31',
  expiryKind: 'range',
  dateConfidence: 'high',
});
assert.equal(freshSocialFutureOffer.decision.allowed, true);
assert.match(freshSocialFutureOffer.decision.warnings.join(' '), /startet am 2026-07-25/);

const authoritativeUrlDate = await validateOne({
  id: 'authoritative-url-date',
  brand: 'Test',
  title: '30% Rabatt in Wien',
  description: '30% Rabatt in 1060 Wien.',
  url: 'https://example.com/current-deal',
  source: 'Firecrawl',
  distance: '1060 Wien',
  pubDate: '2025-01-01T08:00:00.000Z',
  pubDateSource: 'time.datetime',
}, {
  dateHints: { publicationDate: '2026-07-19T08:00:00.000Z' },
});
assert.equal(authoritativeUrlDate.decision.allowed, true);
assert.equal(authoritativeUrlDate.decision.sourceDateSource, 'url.publicationDate');

const futureValidFrom = await validateOne({
  id: 'future-valid-from',
  brand: 'Test',
  title: '50% Rabatt in Wien',
  description: '50% Rabatt in 1010 Wien.',
  url: 'https://example.com/future-offer',
  source: 'Official',
  distance: '1010 Wien',
  pubDate: '2026-07-20T08:00:00.000Z',
  validFrom: '2026-07-21',
  validUntil: '2026-07-31',
  expiryKind: 'range',
  dateConfidence: 'high',
});
assert.equal(futureValidFrom.decision.allowed, true);
assert.match(futureValidFrom.decision.warnings.join(' '), /startet am 2026-07-21/);

const futurePublication = await validateOne({
  id: 'future-publication',
  brand: 'Test',
  title: '50% Rabatt in Wien',
  description: '50% Rabatt in 1010 Wien.',
  url: 'https://www.instagram.com/test/',
  source: 'Instagram',
  distance: '1010 Wien',
  pubDate: '2026-07-21T12:00:00.000Z',
  pubDateSource: 'time.datetime',
});
assert.equal(futurePublication.decision.allowed, false);
assert.match(reasonText(futurePublication), /liegt in der Zukunft/);

const onlineButGrazOnly = await validateOne({
  id: 'online-graz-only',
  brand: 'Test',
  title: '20% Online-Rabatt',
  description: '20% Rabatt online, nur am Standort Graz.',
  url: 'https://example.com/graz-only',
  source: 'Official',
  city: 'Graz',
  distance: 'Graz',
  pubDate: '2026-07-20T08:00:00.000Z',
});
assert.equal(onlineButGrazOnly.decision.allowed, false);
assert.match(reasonText(onlineButGrazOnly), /nicht eindeutig in Wien/);

for (const [brand, place] of [
  ['Ars Electronica Center', 'Linz'],
  ['Joanneum', 'Graz'],
]) {
  const nationalButConflicting = await validateOne({
    id: `national-${place.toLowerCase()}`,
    brand,
    title: `${brand} – 1+1 Ticket gratis in ${place}`,
    description: `1+1 Ticket gratis, einlösbar in ${place}.`,
    url: `https://example.com/${place.toLowerCase()}`,
    source: 'Official',
    distance: 'Österreich',
    pubDate: '2026-07-20T08:00:00.000Z',
  });
  assert.equal(nationalButConflicting.decision.allowed, false);
  assert.match(reasonText(nationalButConflicting), /nicht eindeutig in Wien/);
}

const nationalPlaceWithoutCityMetadata = await validateOne({
  id: 'ars-electronica-no-city',
  brand: 'Ars Electronica',
  title: '1+1 Ticket gratis bei Ars Electronica',
  description: '1+1 Ticket gratis jeden Sonntag.',
  url: 'https://example.com/ars-electronica',
  source: 'Drei Plus',
  distance: 'Österreich',
  expires: 'regelmäßig / laut Quelle',
});
assert.equal(nationalPlaceWithoutCityMetadata.decision.allowed, false);
assert.match(reasonText(nationalPlaceWithoutCityMetadata), /nicht eindeutig in Wien/);

const outsideViennaDespiteDistance = await validateOne({
  id: 'outside-vienna-despite-distance',
  brand: 'Oper im Steinbruch',
  title: '18% Rabatt auf Tickets',
  description: 'Nur rund eine Stunde von Wien entfernt liegt der Steinbruch St. Margarethen.',
  url: 'https://example.com/steinbruch',
  source: 'Official',
  distance: 'Wien',
  pubDate: '2026-07-20T08:00:00.000Z',
});
assert.equal(outsideViennaDespiteDistance.decision.allowed, false);
assert.match(reasonText(outsideViennaDespiteDistance), /nicht eindeutig in Wien/);

const eventWithOnlineBookingOnly = await validateOne({
  id: 'event-online-booking-only',
  brand: 'DJ ÖTZI',
  title: '1+1 Konzertticket gratis',
  description: 'Tickets können online gebucht werden.',
  url: 'https://example.com/dj-oetzi',
  source: 'Official',
  distance: 'Österreich',
  pubDate: '2026-07-20T08:00:00.000Z',
});
assert.equal(eventWithOnlineBookingOnly.decision.allowed, false);
assert.match(reasonText(eventWithOnlineBookingOnly), /nicht eindeutig in Wien/);

const inboundViennaPackage = await validateOne({
  id: 'inbound-vienna-package',
  brand: 'Foreign Travel',
  title: 'Vienna trip from 13 to 15 October for €199',
  description: 'Vienna ti aspetta per un viaggio da sogno. #Viaggiare',
  url: 'https://www.instagram.com/reel/InboundViennaPackage/',
  source: 'Instagram',
  originSource: 'Wien Deals Combined Graph',
  distance: 'Wien',
  pubDate: '2026-07-20T08:00:00.000Z',
  pubDateSource: 'instagram-graph-timestamp',
  validFrom: '2026-10-13',
  validUntil: '2026-10-15',
});
assert.equal(inboundViennaPackage.decision.allowed, false);
assert.match(reasonText(inboundViennaPackage), /Reisepaket nach Wien/);

const onlineAustriaOffer = await validateOne({
  id: 'online-austria',
  brand: 'Webshop',
  title: '25% Online-Rabatt',
  description: '25% Rabatt im Online-Shop, in ganz Österreich einlösbar.',
  url: 'https://example.com/online-austria',
  source: 'Official',
  distance: 'Online',
  pubDate: '2026-07-20T08:00:00.000Z',
});
assert.equal(onlineAustriaOffer.decision.allowed, true);

const genericAllYouCanEat = await validateOne({
  id: 'generic-ayce',
  brand: 'Buffet',
  title: 'All You Can Eat um 24,90 €',
  description: 'Täglich All You Can Eat in 1100 Wien.',
  url: 'https://example.com/ayce',
  source: 'Official',
  distance: '1100 Wien',
  pubDate: '2026-07-20T08:00:00.000Z',
  expires: 'täglich',
});
assert.equal(genericAllYouCanEat.decision.allowed, false);
assert.match(reasonText(genericAllYouCanEat), /kein konkretes Angebot/);

const apifyCustomerParking = await validateOne({
  id: 'igap-customer-parking',
  brand: 'Pizzeria Dolce Vita 1020 Wien on Instagram',
  title: 'Parkplatzsuche in Wien? Wer bei uns essen geht, parkt 2 Stunden',
  description: 'Gratis-Angebot bei Pizzeria Dolce Vita 1020 Wien on Instagram in Locations',
  url: 'https://www.instagram.com/reel/CustomerParking123/',
  source: 'Instagram',
  originSource: 'Apify Instagram Vienna Food Offers',
  distance: 'Locations',
  pubDate: '2026-07-20T08:00:00.000Z',
  pubDateSource: 'apify-postPublishedAt',
  sourcePublishedAt: '2026-07-20T08:00:00.000Z',
  sourcePublishedAtSource: 'apify-postPublishedAt',
}, {
  contentHints: {
    title: 'Parkplatzsuche in Wien? Wer bei uns essen geht, parkt 2 Stunden gratis direkt im Haus.',
  },
});
assert.equal(apifyCustomerParking.decision.allowed, false);
assert.match(reasonText(apifyCustomerParking), /Infrastruktur/);

const discountWithFreeParking = await validateOne({
  id: 'discount-with-free-parking',
  brand: 'Test Lokal',
  title: '20 % Rabatt auf alle Pizzen',
  description: '20 % Rabatt auf alle Pizzen und 2 Stunden gratis Kundenparkplatz in 1020 Wien.',
  url: 'https://example.com/discount-with-parking',
  source: 'Official',
  distance: '1020 Wien',
  pubDate: '2026-07-20T08:00:00.000Z',
});
assert.equal(discountWithFreeParking.decision.allowed, true);

const freeMembershipOnly = await validateOne({
  id: 'free-membership-only',
  brand: 'FOODPOINT',
  title: 'Mitgliedschaft kostenlos',
  description: 'Die Mitgliedschaft ist kostenlos und unverbindlich. Folge uns für Lieferungen und Neuigkeiten in 1100 Wien.',
  url: 'https://example.com/free-membership',
  source: 'Instagram',
  distance: '1100 Wien',
  pubDate: '2026-07-20T08:00:00.000Z',
});
assert.equal(freeMembershipOnly.decision.allowed, false);
assert.match(reasonText(freeMembershipOnly), /Mitgliedschaft/);

const freeMembershipWithDiscount = await validateOne({
  id: 'free-membership-with-discount',
  brand: 'Vorteilsclub',
  title: '20 % Rabatt für Mitglieder',
  description: 'Die Mitgliedschaft ist kostenlos und bringt 20 % Rabatt auf alle Tickets in 1010 Wien.',
  url: 'https://example.com/free-membership-discount',
  source: 'Official',
  distance: '1010 Wien',
  pubDate: '2026-07-20T08:00:00.000Z',
});
assert.equal(freeMembershipWithDiscount.decision.allowed, true);

const veganMarketing = await validateOne({
  id: 'vegan-marketing',
  brand: 'Vegan Bistro',
  title: '100% vegan und bio',
  description: '100% vegan und bio in 1070 Wien.',
  url: 'https://example.com/vegan',
  source: 'Official',
  distance: '1070 Wien',
  pubDate: '2026-07-20T08:00:00.000Z',
});
assert.equal(veganMarketing.decision.allowed, false);
assert.match(reasonText(veganMarketing), /kein konkretes Angebot/);

for (const title of ['Pizza um 3€', 'Döner um 1€', '3€ Matcha']) {
  const lowPriceOffer = await validateOne({
    id: `low-price-${title}`,
    brand: 'Test Lokal',
    title,
    description: `${title} in 1070 Wien.`,
    url: `https://example.com/${encodeURIComponent(title)}`,
    source: 'Official',
    distance: '1070 Wien',
    pubDate: '2026-07-20T08:00:00.000Z',
  });
  assert.equal(lowPriceOffer.decision.allowed, true, `${title} should count as a concrete low-price offer`);
}

const sameDayValidFrom = await validateOne({
  id: 'same-day-valid-from',
  brand: 'Test',
  title: '40% Rabatt in Wien',
  description: '40% Rabatt in 1010 Wien.',
  url: 'https://example.com/same-day',
  source: 'Official',
  distance: '1010 Wien',
  pubDate: '2026-07-20T08:00:00.000Z',
  validFrom: '2026-07-20T23:00:00.000Z',
  validUntil: '2026-07-31',
  expiryKind: 'range',
  dateConfidence: 'high',
});
assert.equal(sameDayValidFrom.decision.allowed, true);

const instagramAiErnesto = normalizeDeal({
  id: 'instagram-ai-ernesto',
  brand: 'Ernesto Osteria',
  title: '2. Illy Caffè GRATIS zu jedem Frühstück',
  description: 'Dienstag bis Freitag bei Ernesto Osteria in Wien.',
  url: 'https://www.instagram.com/p/Das-rG-kVlD/',
  source: 'Instagram AI Agent',
  originSource: 'instagram-ai-agent',
  distance: 'Wien',
  pubDate: '2026-07-12T18:25:13.000Z',
  pubDateSource: 'instagram-rendered-time-datetime',
  expires: '2026-07-31T23:59:59.999Z',
  expiryKind: 'range',
  validFrom: '2026-07-01',
  validUntil: '2026-07-31',
  dateConfidence: 'high',
  evidence: {
    offerDateSignal: 'Vom 1. bis 31. Juli 2026 gibt es den 2. Illy Caffè gratis.',
    offerTiming: {
      kind: 'range',
      matchedText: '1. bis 31. Juli 2026',
      validFrom: '2026-07-01T23:59:59.999Z',
      validUntil: '2026-07-31T23:59:59.999Z',
      recurring: false,
    },
  },
}, 'instagram-ai');
const instagramAiErnestoResult = await validateOne(instagramAiErnesto);
assert.equal(instagramAiErnestoResult.decision.allowed, false);
assert.match(reasonText(instagramAiErnestoResult), /älter als 7 Tage/);

const apronActiveMonthRange = await validateOne({
  id: 'apron-active-month-range',
  brand: 'Restaurant APRON',
  title: '5-Gänge-Menü für unter 30: € 130 statt € 166',
  description: 'Von Juli bis August 2026 dienstags, mittwochs und donnerstags in Wien.',
  url: 'https://www.instagram.com/p/Daia5aCFi-M/',
  source: 'Firecrawl Gastro #2',
  originSource: 'Firecrawl Gastro #2',
  distance: 'Wien',
  expires: 'Juli - August 2026 Dienstags, Mittwochs, Donnerstags',
});
assert.equal(apronActiveMonthRange.decision.allowed, false);
assert.equal(apronActiveMonthRange.decision.expiryDate, '2026-08-31');
assert.match(reasonText(apronActiveMonthRange), /älter als 7 Tage/);

const lovingHutFollowerDeal = await validateOne({
  id: 'loving-hut-follower-deal',
  brand: '@lovinghut.neubau',
  title: 'Unser Community-Special bis Monatsende',
  description: 'Sichere dir eine Erdbeerschnitte gratis zu deinem Hauptgericht. Folge uns auf TikTok oder Instagram, bestelle ein Hauptgericht und zeige uns, dass du uns folgst. Gültig bis Monatsende in Wien.',
  url: 'https://www.tiktok.com/@lovinghut.neubau/video/7663835517779266836',
  source: 'TikTok Scanner',
  originSource: 'tiktok-deals-scanner',
  distance: 'Wien',
  pubDate: '2026-07-18T11:56:00.000Z',
  pubDateSource: 'time.datetime',
});
assert.equal(lovingHutFollowerDeal.decision.allowed, true, 'following as a redemption condition is not a giveaway');

const expiredHeartbreakToday = await validateOne({
  id: 'heartbreak-today',
  brand: '@heartbreakhotelvienna',
  title: 'Gratis Eintritt bei @heartbreakhotelvienna',
  description: 'Wir feiern heute Geburtstag. Alle TikTok Follower genießen bis 00:30 Free Entry! Bis später an der Bar.',
  url: 'https://www.tiktok.com/@heartbreakhotelvienna/video/7663105811840847126',
  source: 'TikTok Scanner',
  originSource: 'tiktok-deals-scanner',
  distance: 'Wien',
  pubDate: '2026-07-16T12:44:25.000Z',
  pubDateSource: 'time.datetime',
});
assert.equal(expiredHeartbreakToday.decision.allowed, false);
assert.match(reasonText(expiredHeartbreakToday), /relative Kurz-Aktion abgelaufen/);

const weakKultursommerFallback = await validateOne({
  id: 'kultursommer-fallback',
  brand: '@kultursommerwien',
  title: '@kultursommerwien Angebot',
  description: 'Wholesome Festivalstart. Heute geht es weiter, wir sehen euch an den Bühnen.',
  url: 'https://www.tiktok.com/@kultursommerwien/video/7663069042604920086',
  source: 'TikTok Scanner',
  originSource: 'tiktok-deals-scanner',
  distance: 'Wien',
  pubDate: '2026-07-16T10:21:48.000Z',
  pubDateSource: 'time.datetime',
});
assert.equal(weakKultursommerFallback.decision.allowed, false);
assert.match(reasonText(weakKultursommerFallback), /kein konkretes Angebot/);

const genericFreeFestivalTip = await validateOne({
  id: 'generic-free-festival-tip',
  brand: '@yyennaying',
  title: 'One of my favorite summer spots in Vienna',
  description: 'The Film Festival at Rathausplatz is FREE and the vibe is incredible. Save and send this to your summer date.',
  url: 'https://www.tiktok.com/@yyennaying/video/7664231061349469462',
  source: 'TikTok Scanner',
  originSource: 'tiktok-deals-scanner',
  distance: 'Wien',
  pubDate: '2026-07-19T13:30:58.000Z',
  pubDateSource: 'time.datetime',
});
assert.equal(genericFreeFestivalTip.decision.allowed, false);
assert.match(reasonText(genericFreeFestivalTip), /allgemeine Empfehlung/);

const wienUncoveredRegularPrice = await validateOne({
  id: 'wien-uncovered-regular-price',
  brand: 'Sukiyaki',
  title: 'All You Can Eat Sushi Buffet ab nur 11,90 €',
  description: 'All You Can Eat Sushi Buffet in Wien Mitte für 11,90 €.',
  url: 'https://wienuncovered.com/all-you-can-eat-sushi-buffet-wien-sukiyaki/',
  source: 'Firecrawl',
  originSource: 'Wien Uncovered',
  distance: '1030 Wien',
});
assert.equal(wienUncoveredRegularPrice.decision.allowed, false);
assert.match(reasonText(wienUncoveredRegularPrice), /redaktioneller Preis-\/Restauranttipp/);

const wienUncoveredRealPromotion = await validateOne({
  ...wienUncoveredRegularPrice.deal,
  id: 'wien-uncovered-real-promotion',
  title: '1+1 gratis Sushi Buffet bis Monatsende',
  description: '1+1 gratis auf das Sushi Buffet in 1030 Wien.',
});
assert.equal(wienUncoveredRealPromotion.decision.allowed, true);

const ancientRecurring = await validateOne({
  id: 'ancient-recurring',
  brand: 'Test',
  title: 'Jeden Freitag 1+1 gratis',
  description: 'Jeden Freitag 1+1 gratis in 1010 Wien.',
  url: 'https://www.instagram.com/test/',
  source: 'Instagram',
  distance: '1010 Wien',
  pubDate: '2024-01-01T08:00:00.000Z',
  pubDateSource: 'time.datetime',
  expires: 'jeden Freitag',
});
assert.equal(ancientRecurring.decision.allowed, false);
assert.match(reasonText(ancientRecurring), /älter als 7 Tage/);

const defaultViennaButSalzburg = await validateOne({
  id: 'default-vienna-but-salzburg',
  brand: 'Test Café',
  title: 'Kaffee gratis in Salzburg',
  description: 'Heute gibt es in Salzburg einen Kaffee gratis.',
  url: 'https://example.com/salzburg-offer',
  source: 'Crawler',
  distance: 'Wien',
  pubDate: now.toISOString(),
  pubDateSource: 'time.datetime',
});
assert.equal(defaultViennaButSalzburg.decision.allowed, false);
assert.match(reasonText(defaultViennaButSalzburg), /nicht eindeutig in Wien/);

const yearIsNotPostalCode = await validateOne({
  id: 'year-is-not-postal-code',
  brand: 'Online Shop',
  title: '20% Rabatt auf Kaffee',
  description: '20% Rabatt auf Kaffee, in ganz Österreich online einlösbar. Gültig bis 30.9.2026.',
  url: 'https://example.com/online-2026',
  source: 'Official',
  distance: 'Online',
  pubDate: now.toISOString(),
  pubDateSource: 'time.datetime',
});
assert.equal(yearIsNotPostalCode.decision.allowed, true, 'the year 2026 must not be treated as a non-Vienna postal code');

for (const title of ['Döner für 2,50€', 'Pizza für €1', 'Espresso um 1€', 'Espresso und Cannoli für je 1€']) {
  const lowPriceWithoutDuplicateDescription = await validateOne({
    id: `single-low-price-${title}`,
    brand: 'Test Lokal',
    title,
    description: 'Neubaugasse 1, 1070 Wien.',
    url: `https://example.com/single-${encodeURIComponent(title)}`,
    source: 'Official',
    distance: '1070 Wien',
    pubDate: now.toISOString(),
    pubDateSource: 'time.datetime',
  });
  assert.equal(lowPriceWithoutDuplicateDescription.decision.allowed, true, `${title} must work without duplicated title text`);
}

const glutenFreeClaim = await validateOne({
  id: 'gluten-free-claim',
  brand: 'Pizza Test',
  title: '50% gluten-free Pizza',
  description: 'Sugar-free Drinks und gluten-free Pizza in 1070 Wien.',
  url: 'https://example.com/gluten-free',
  source: 'Official',
  distance: '1070 Wien',
  pubDate: now.toISOString(),
  pubDateSource: 'time.datetime',
});
assert.equal(glutenFreeClaim.decision.allowed, false);
assert.match(reasonText(glutenFreeClaim), /kein konkretes Angebot/);

const payWhatYouWant = await validateOne({
  id: 'pay-what-you-want',
  brand: 'Wien Lokal',
  title: 'Pakistanisch/Indisch – zahle was du willst',
  description: 'Zahle was du willst für das Mittagsbuffet in 1090 Wien.',
  url: 'https://example.com/pay-what-you-want',
  source: 'Official',
  distance: '1090 Wien',
  pubDate: now.toISOString(),
  pubDateSource: 'time.datetime',
});
assert.equal(payWhatYouWant.decision.allowed, true);

const percentOnTop = await validateOne({
  id: 'percent-on-top',
  brand: 'Sport Shop',
  title: 'Final Sale: 15% on top auf Bestseller',
  description: 'Zusätzlich 15% on top im österreichweiten Onlineshop.',
  url: 'https://example.com/final-sale',
  source: 'Official',
  distance: 'Österreichweit',
});
assert.equal(percentOnTop.decision.allowed, true);

const blockedPageCannotInventOffer = await validateOne({
  id: 'blocked-page-content',
  brand: 'Restaurant',
  title: 'Pakistanisch/Indisch in Wien',
  description: '',
  url: 'https://example.com/protected-listing',
  source: 'Firecrawl',
  distance: 'Wien',
}, {
  status: 403,
  transientError: true,
  reason: 'HTTP 403',
  contentHints: {
    title: 'Free restaurant listings',
    description: 'Free recommendations and deals',
  },
});
assert.equal(blockedPageCannotInventOffer.decision.allowed, false);
assert.match(reasonText(blockedPageCannotInventOffer), /kein konkretes Angebot/);

const yelpSearchListing = await validateOne({
  id: 'deewan-yelp-search',
  brand: 'Der Wiener Deewan',
  title: 'Pakistanisch/Indisch – zahle was du willst',
  description: 'Zahle was du willst in Wien.',
  url: 'https://www.yelp.com/search?cflt=indpak&find_loc=Wien',
  source: 'Firecrawl',
  distance: 'Wien',
});
assert.equal(yelpSearchListing.decision.allowed, false);
assert.match(reasonText(yelpSearchListing), /ausgeschlossene Quelle \(Yelp\)/);

const genericFestivalAdmission = await validateOne({
  id: 'generic-festival-admission',
  brand: 'Film Festival Rathausplatz',
  title: 'Gratis Eintritt zum Festival',
  description: 'Gratis Eintritt zum Film Festival am Rathausplatz in Wien.',
  url: 'https://example.com/film-festival',
  source: 'Firecrawl',
  distance: 'Wien',
  validUntil: '2026-08-31',
  expiryKind: 'end',
  dateConfidence: 'high',
});
assert.equal(genericFestivalAdmission.decision.allowed, false);
assert.match(reasonText(genericFestivalAdmission), /Gratis-Event/);

for (const socialFallback of [
  {
    id: 'iamlicette-fallback',
    brand: '@iamlicette',
    title: 'Gratis Eintritt bei @iamlicette',
    url: 'https://www.tiktok.com/@iamlicette/video/7663053432189668630',
  },
  {
    id: 'frish-fallback',
    brand: '@frishwienxtra',
    title: 'Gratis Eintritt bei @frishwienxtra',
    url: 'https://www.tiktok.com/@frishwienxtra/video/7663417749497974038',
  },
  {
    id: 'garbled-fallback',
    brand: 'Vorreservierung 20',
    title: '20 % auf deine Einzelrechnung und wenn du der Nase',
    url: 'https://www.tiktok.com/@vorteilsclub.wien/video/7663512387806432545',
  },
]) {
  const result = await validateOne({
    ...socialFallback,
    description: '',
    source: 'Slack Digest',
    originSource: 'tiktok-deals-scanner',
    distance: 'Wien',
    pubDate: '2026-07-17T12:00:00.000Z',
    pubDateSource: 'time.datetime',
  });
  assert.equal(result.decision.allowed, false, `${socialFallback.id} must not pass on a generated title alone`);
  assert.match(reasonText(result), /Social-Scanner-Titel/);
}

const viennaFlight = await validateOne({
  id: 'flight-vienna-pula',
  brand: 'Ryanair',
  title: 'Hin & zurück nach Pula ab €39.98',
  description: 'Ryanair: Roundtrip Wien -> Pula, Croatia · 4 Tage · 2026-09-15 → 2026-09-19',
  url: 'https://www.ryanair.com/gb/en/trip/flights/select?originIata=VIE&destinationIata=PUY&dateOut=2026-09-15&dateIn=2026-09-19',
  source: 'Flights Vienna',
  originSource: 'flights-vienna-scraper',
  distance: 'Pula, Croatia',
  expires: 'Abflug 2026-09-15',
  flight: { provider: 'Ryanair' },
});
assert.equal(viennaFlight.decision.allowed, true, 'a currently bookable fare with VIE origin is a Vienna deal');
assert.doesNotMatch(reasonText(viennaFlight), /noch nicht gestartet/);

const starbucksUsRewards = await validateOne({
  id: 'g2-17qosg3',
  brand: 'Starbucks',
  title: 'Gratis Getränk am Geburtstag für Rewards Members',
  description: '',
  url: 'https://www.starbucks.com/rewards',
  source: 'Slack Digest',
  originSource: 'Firecrawl Gastro #2',
  distance: 'Wien (alle Filialen)',
  expires: 'Öffnungszeiten',
}, {
  contentHints: {
    title: 'Starbucks Rewards',
    description: 'Rewards terms for participating stores in the United States.',
  },
});
assert.equal(starbucksUsRewards.decision.allowed, false);
assert.match(reasonText(starbucksUsRewards), /Starbucks US Rewards|nicht eindeutig in Wien/);

const googleNewsWithoutTrustedDate = await validateOne({
  id: 'vpr-1ldrttb',
  brand: 'Wien • MSN',
  title: 'GRATIS: Gratis-Cevapi in Lokal, wenn Bosnien oder ÖFB siegen',
  description: '',
  url: 'https://news.google.com/rss/articles/example?oc=5',
  source: 'Slack Digest',
  originSource: 'Google News RSS',
  distance: 'Wien • MSN',
  pubDate: '2026-07-19T12:00:00.000Z',
  pubDateSource: '',
});
assert.equal(googleNewsWithoutTrustedDate.decision.allowed, false);
assert.match(reasonText(googleNewsWithoutTrustedDate), /kein verlässliches Quell-\/Post-Datum/);

const facebookWithoutPostDate = await validateOne({
  id: 'facebook-recurring-without-date',
  brand: 'SPAR Wien',
  title: 'Jeden Freitag 1+1 gratis',
  description: 'Jeden Freitag 1+1 gratis in Wien.',
  url: 'https://www.facebook.com/spar/posts/1234567890',
  source: 'Firecrawl',
  originSource: 'Firecrawl Social',
  distance: 'Wien',
  pubDate: now.toISOString(),
  pubDateSource: 'firecrawlAgentRun',
  expires: 'jeden Freitag',
});
assert.equal(facebookWithoutPostDate.decision.allowed, false);
assert.match(reasonText(facebookWithoutPostDate), /kein echtes Social-Post-Datum/);

const facebookWithActiveEnd = await validateOne({
  id: 'facebook-active-validity',
  brand: 'Wien Lokal',
  title: '1+1 Kaffee gratis',
  description: '1+1 Kaffee gratis in Wien, gültig bis Ende August.',
  url: 'https://www.facebook.com/wienlokal/posts/1234567891',
  source: 'Firecrawl',
  originSource: 'Firecrawl Social',
  distance: 'Wien',
  validUntil: '2026-08-31',
  expiryKind: 'end',
  dateConfidence: 'high',
});
assert.equal(facebookWithActiveEnd.decision.allowed, false);
assert.match(reasonText(facebookWithActiveEnd), /kein echtes Social-Post-Datum/);

const unrelatedUrlDate = await validateOne({
  id: 'unrelated-url-date',
  brand: 'Belvedere Wien',
  title: '1+1 Ticket gratis jeden Mittwoch',
  description: 'Jeden Mittwoch 1+1 Ticket gratis in Wien.',
  url: 'https://example.com/belvedere-benefit',
  source: 'Drei Plus',
  originSource: 'member-benefits-scraper',
  distance: 'Wien',
  expires: 'regelmäßig / laut Quelle',
}, {
  dateHints: {
    targetDateRaw: '3. Juli 2026',
    targetDateKind: 'end',
    targetDateEvidence: 'broad-token',
    validUntil: '2026-07-03',
  },
});
assert.equal(unrelatedUrlDate.decision.allowed, true, 'an unrelated bare page date must not expire a recurring deal');
assert.notEqual(unrelatedUrlDate.decision.expirySource, 'url.dateHints');

const explicitUrlEnd = await validateOne({
  id: 'explicit-url-end',
  brand: 'Wien Café',
  title: '20% Rabatt auf Kaffee',
  description: '20% Rabatt auf Kaffee in 1070 Wien.',
  url: 'https://example.com/explicit-end',
  source: 'Official',
  distance: '1070 Wien',
  pubDate: now.toISOString(),
  pubDateSource: 'time.datetime',
}, {
  dateHints: {
    targetDateRaw: 'Gültig bis 30.9.2026',
    targetDateKind: 'end',
    targetDateEvidence: 'explicit-phrase',
    validUntil: '2026-09-30',
  },
});
assert.equal(explicitUrlEnd.decision.allowed, true);
assert.equal(explicitUrlEnd.decision.expiryDate, '2026-09-30');
assert.equal(explicitUrlEnd.decision.expirySource, 'url.dateHints');

const futureAidsQueueDeal = await validateOne({
  id: 'future-aids-event',
  brand: 'Aids Hilfe Wien',
  title: 'Am 4. September 2026: 6. Straßenfest',
  description: 'Gratis Kinderbetreuung beim Straßenfest in Wien.',
  url: 'https://example.com/aids-strassenfest',
  source: 'Instagram AI',
  distance: 'Wien',
  pubDate: '2026-07-18T08:00:00.000Z',
  pubDateSource: 'time.datetime',
  expires: '4.9.2026',
});
assert.equal(futureAidsQueueDeal.decision.allowed, true);
assert.match(futureAidsQueueDeal.decision.warnings.join(' '), /startet am 2026-09-04/);

for (const [id, expires] of [
  ['le-pho-range', '2026-06-01 bis 2026-08-31'],
  ['le-pho-ongoing', '2026-07-01 bis auf Weiteres'],
]) {
  const lePho = await validateOne({
    id,
    brand: 'Le Pho',
    title: '1+1 Pho gratis',
    description: '1+1 Pho gratis in 1070 Wien.',
    url: `https://example.com/${id}`,
    source: 'Firecrawl',
    originSource: 'Firecrawl Gastro #2',
    distance: '1070 Wien',
    pubDate: '2026-07-05T08:00:00.000Z',
    pubDateSource: 'time.datetime',
    expires,
    dateConfidence: 'high',
  });
  assert.equal(lePho.decision.allowed, true, `${expires} must not be parsed as an expired start date`);
}

const structuredOngoingSocial = await validateOne({
  id: 'structured-ongoing-social',
  brand: 'Le Pho',
  title: '1+1 Pho gratis',
  description: 'Seit 1. Juli bis auf Weiteres 1+1 Pho gratis in 1070 Wien.',
  url: 'https://www.instagram.com/p/Das-rG-kVlD/',
  source: 'Instagram AI',
  originSource: 'instagram-ai-agent',
  distance: '1070 Wien',
  pubDate: '2026-07-10T08:00:00.000Z',
  pubDateSource: 'time.datetime',
  expires: '2026-07-01 bis auf Weiteres',
  expiryKind: 'ongoing',
  validFrom: '2026-07-01',
  dateConfidence: 'high',
});
assert.equal(structuredOngoingSocial.decision.allowed, false);
assert.match(reasonText(structuredOngoingSocial), /älter als 7 Tage/);

for (const malformedVoucher of [
  {
    id: 'bad-voucher-brand',
    brand: 'Rabatt auf alles exklusiv Wolt',
    title: '20€ Gutschein bei Rabatt auf alles exklusiv Wolt',
    description: '20€ Gutschein',
    url: 'https://www.gutscheine.at/rabatt-auf-alles-exklusiv-wolt',
  },
  {
    id: 'mixed-wolt-dyson',
    brand: 'Wolt',
    title: '4€ Gutschein bei Wolt – Dyson Spot+Scrub™',
    description: 'Wolt: 4€ Gutschein – Dyson Spot+Scrub™',
    url: 'https://www.gutscheine.at/wolt',
  },
]) {
  const result = await validateOne({
    ...malformedVoucher,
    source: 'Gutscheine.at',
    originSource: 'gutscheine-scraper',
    distance: 'Online / Österreich',
    pubDate: now.toISOString(),
    pubDateSource: 'sourcePage',
  });
  assert.equal(result.decision.allowed, false);
  assert.match(reasonText(result), /Gutscheine\.at/);
}

const voucherPipeline = await validateAndDedupeDealsForSlack([
  {
    id: 'wolt-generic',
    brand: 'Wolt',
    title: '4€ Gutschein bei Wolt',
    description: 'Wolt: 4€ Gutschein',
    url: 'https://www.gutscheine.at/wolt',
    source: 'Gutscheine.at',
    originSource: 'gutscheine-scraper',
    distance: 'Online / Österreich',
    expires: 'Siehe Website',
  },
  {
    id: 'wolt-dated',
    brand: 'Wolt',
    title: '4€ Gutschein bei Wolt – Neukunden',
    description: '4€ Gutschein für Neukunden, bis zu 3x einlösbar.',
    url: 'https://www.gutscheine.at/wolt',
    source: 'Gutscheine.at',
    originSource: 'gutscheine-scraper',
    distance: 'Online / Österreich',
    expires: 'Bis 26.07.2026',
  },
], {
  now,
  inspectDealUrlHealth: async (url) => healthyUrl(url),
  concurrency: 1,
});
assert.equal(voucherPipeline.allowedDeals.length, 1);
assert.equal(voucherPipeline.allowedDeals[0].id, 'wolt-dated');

const focacceriaPipeline = await validateAndDedupeDealsForSlack([
  {
    id: 'focacceria-expired-first',
    brand: 'Focacceria il Rione',
    title: 'Espresso um 1€',
    description: 'Espresso um 1€ in 1070 Wien.',
    url: 'https://goodnight.at/magazin/freizeit/neue-lokale-juli-2026',
    source: 'Firecrawl Gastro #2',
    originSource: 'Firecrawl Gastro #2',
    distance: '1070 Wien',
    expires: '2026-07-01',
    dateConfidence: 'high',
  },
  {
    id: 'focacceria-current-second',
    brand: 'Focacceria il Rione',
    title: 'Espresso und Cannoli je 1€',
    description: 'Espresso und Cannoli je 1€ in 1070 Wien.',
    url: 'https://goodnight.at/magazin/freizeit/neue-lokale-juli-2026',
    source: 'Firecrawl Gastro #2',
    originSource: 'Firecrawl Gastro #2',
    distance: '1070 Wien',
    expires: '2026-08-31',
    dateConfidence: 'high',
    qualityScore: 80,
  },
], {
  now,
  inspectDealUrlHealth: async (url) => healthyUrl(url),
  concurrency: 1,
});
assert.equal(focacceriaPipeline.validation.blockedDeals.length, 1);
assert.equal(focacceriaPipeline.allowedDeals.length, 1);
assert.equal(focacceriaPipeline.allowedDeals[0].id, 'focacceria-current-second');

const firecrawlReviewSelection = selectFirecrawlReviewDeals([
  {
    deal: {
      id: 'review-food-recent',
      brand: 'Wien Food Deal',
      title: '1+1 Mittagessen',
      url: 'https://example.com/review-food-recent',
      source: 'Firecrawl Food #2',
      originSource: 'Firecrawl Food #2',
      distance: '1070 Wien',
      validity: {},
    },
    decision: { allowed: false, reasons: ['älter als 7 Tage (2026-07-10)'], sourceAgeDays: 10 },
  },
  {
    deal: {
      id: 'review-food-second',
      brand: 'Wien Food Deal 2',
      title: 'Gratis Dessert',
      url: 'https://example.com/review-food-second',
      source: 'Firecrawl Food #2',
      originSource: 'Firecrawl Food #2',
      distance: '1020 Wien',
      validity: {},
    },
    decision: { allowed: false, reasons: ['älter als 7 Tage (2026-07-08)'], sourceAgeDays: 12 },
  },
  {
    deal: {
      id: 'review-food-over-source-limit',
      brand: 'Wien Food Deal 3',
      title: 'Kaffee-Aktion',
      url: 'https://example.com/review-food-third',
      source: 'Firecrawl Food #2',
      originSource: 'Firecrawl Food #2',
      distance: '1030 Wien',
      validity: {},
    },
    decision: { allowed: false, reasons: ['kein konkretes Angebot erkennbar'], sourceAgeDays: null },
  },
  {
    deal: {
      id: 'review-consumables-unclear',
      brand: 'Wien Shop',
      title: 'Sommeraktion',
      url: 'https://example.com/review-consumables',
      source: 'Firecrawl Key 3 - Consumables',
      originSource: 'Firecrawl Key 3 - Consumables',
      distance: 'Wien',
      validity: {},
    },
    decision: { allowed: false, reasons: ['kein konkretes Angebot erkennbar'], sourceAgeDays: null },
  },
  {
    deal: {
      id: 'review-expired-hard-block',
      title: 'Gratis Getränk',
      url: 'https://example.com/review-expired',
      source: 'Firecrawl Instagram Gastro #5',
    },
    decision: { allowed: false, reasons: ['abgelaufen (2026-07-18)'], sourceAgeDays: 4 },
  },
  {
    deal: {
      id: 'review-not-vienna-hard-block',
      title: '1+1 Burger',
      url: 'https://example.com/review-graz',
      source: 'Firecrawl Gastro #2',
    },
    decision: { allowed: false, reasons: ['nicht eindeutig in Wien'], sourceAgeDays: 2 },
  },
  {
    deal: {
      id: 'review-too-old',
      title: 'Gratis Kaffee',
      url: 'https://example.com/review-too-old',
      source: 'Firecrawl Gastro #2',
    },
    decision: { allowed: false, reasons: ['älter als 7 Tage (2026-05-01)'], sourceAgeDays: 80 },
  },
  {
    deal: {
      id: 'review-non-firecrawl',
      title: 'Gratis Kaffee',
      url: 'https://example.com/review-official',
      source: 'Official',
    },
    decision: { allowed: false, reasons: ['kein konkretes Angebot erkennbar'], sourceAgeDays: null },
  },
], {
  maxPerSource: 2,
  maxTotal: 3,
  maxAgeDays: 45,
});
assert.deepEqual(
  firecrawlReviewSelection.deals.map((deal) => deal.id),
  ['review-food-recent', 'review-food-second', 'review-consumables-unclear'],
  'review lane must keep only capped soft Firecrawl failures',
);
assert.equal(firecrawlReviewSelection.eligible, 4);
assert.equal(firecrawlReviewSelection.sourceLimitRemoved, 1);
assert.deepEqual(firecrawlReviewSelection.sourceCounts, {
  'Firecrawl Key 2 - Food': 2,
  'Firecrawl Key 3 - Consumables': 1,
});
assert.equal(firecrawlReviewSelection.deals[0].firecrawlReview, true);

const key4ReviewSelection = prepareKey4ReviewDeals([
  normalizeDeal({
    id: 'key4-chance-review',
    brand: '@bigbox_fastfood',
    title: 'Mit Würfelglück gratis essen',
    description: 'Jeden Mittwoch besteht die Chance auf ein kostenloses Essen.',
    url: 'https://www.instagram.com/reel/Key4ChanceOne/',
    source: 'Firecrawl Instagram Direct #4',
    originSource: 'firecrawl4',
    pubDate: '2026-07-19T08:00:00.000Z',
    postAgeDays: 1,
    key4Decision: { status: 'review', reasons: ['chance-based-offer'] },
  }, 'firecrawl4-review'),
  normalizeDeal({
    id: 'key4-vienna-review',
    brand: '@wien_food',
    title: '1+1 Burger',
    description: 'Direkter Originalpost ohne eindeutige Adresse.',
    url: 'https://www.instagram.com/p/Key4ViennaTwo/',
    source: 'Firecrawl Instagram Direct #4',
    originSource: 'firecrawl4',
    pubDate: '2026-07-18T08:00:00.000Z',
    postAgeDays: 2,
    key4Decision: { status: 'review', reasons: ['not-verified-vienna'] },
  }, 'firecrawl4-review'),
  normalizeDeal({
    id: 'key4-rejected-row',
    url: 'https://www.instagram.com/p/Key4Rejected/',
    source: 'Firecrawl Instagram Direct #4',
    originSource: 'firecrawl4',
    key4Decision: { status: 'rejected', reasons: ['giveaway'] },
  }, 'firecrawl4-review'),
], { maxAgeDays: 45 });
assert.deepEqual(
  key4ReviewSelection.deals.map((deal) => deal.id),
  ['key4-chance-review', 'key4-vienna-review'],
  'only explicit Key4 review decisions on direct Instagram posts enter the dedicated Slack lane',
);
assert.match(key4ReviewSelection.deals[0].firecrawlReviewReasons[0], /glücksabhängig/);

const combinedReviewSelection = combineFirecrawlReviewSelections(
  key4ReviewSelection,
  firecrawlReviewSelection,
  [{ url: 'https://example.com/review-food-recent' }],
);
assert.equal(combinedReviewSelection.key4Eligible, 2);
assert.deepEqual(
  combinedReviewSelection.deals.map((deal) => deal.id),
  [
    'key4-chance-review',
    'key4-vienna-review',
    'review-food-second',
    'review-consumables-unclear',
  ],
  'all dedicated Key4 reviews survive while review duplicates of accepted deals are removed',
);
assert.equal(combinedReviewSelection.sourceCounts['Firecrawl Key 4 - Instagram Direct'], 2);

const firecrawlReviewDisplay = buildFirecrawlReviewMessage(firecrawlReviewSelection.deals[0], 1);
assert.match(firecrawlReviewDisplay, /Automatisch blockiert: älter als 7 Tage/);
assert.match(firecrawlReviewDisplay, /Link prüfen/);
assert.doesNotMatch(firecrawlReviewDisplay, /_Mit ✅ freigeben_/);

const recentSlackTs = String(Math.floor(new Date('2026-07-19T12:00:00.000Z').getTime() / 1000));
const queueRevalidation = await revalidateRecentPostedQueue([
  {
    id: 'recent-giveaway',
    brand: 'Agave',
    title: 'Free meal Giveaway',
    description: 'Folge uns und gewinne ein free meal.',
    url: 'https://example.com/recent-giveaway',
    source: 'Firecrawl',
    distance: 'Wien',
    slackTs: `${recentSlackTs}.1`,
  },
  {
    id: 'recent-good',
    brand: 'Wien Café',
    title: 'Kaffee um 1€',
    description: 'Kaffee um 1€ in 1070 Wien.',
    url: 'https://example.com/recent-good',
    source: 'Official',
    distance: '1070 Wien',
    slackTs: `${recentSlackTs}.2`,
    pubDate: '2026-07-19T08:00:00.000Z',
    pubDateSource: 'time.datetime',
  },
  {
    id: 'recent-firecrawl-review',
    brand: 'Wien Review Deal',
    title: 'Unklare Gratis-Aktion',
    description: 'Muss von einem Menschen geprüft werden.',
    url: 'https://example.com/recent-firecrawl-review',
    source: 'Firecrawl Food #2',
    originSource: 'Firecrawl Food #2',
    distance: 'Wien',
    slackTs: `${recentSlackTs}.3`,
    firecrawlReview: true,
    firecrawlReviewReasons: ['kein konkretes Angebot erkennbar'],
  },
], {
  now,
  revalidationDays: 7,
  inspectDealUrlHealth: async (url) => healthyUrl(url),
  concurrency: 1,
});
assert.equal(queueRevalidation.removed, 0);
assert.equal(queueRevalidation.blocked, 1);
assert.deepEqual(
  queueRevalidation.deals.map((deal) => deal.id),
  ['recent-giveaway', 'recent-good', 'recent-firecrawl-review'],
  'blocked and manual-review rows must stay in the recent-post ledger until naturally pruned',
);
assert.equal(queueRevalidation.deals[0].queueValidationBlocked, true);
assert.equal(queueRevalidation.deals[0].queueValidationCheckedAt, now.toISOString());
assert.match(queueRevalidation.deals[0].queueValidationReasons.join(' | '), /Gewinnspiel/i);
assert.equal(queueRevalidation.validation?.summary?.total, 2, 'review rows must not be auto-revalidated away');

const queueRevalidationCacheHit = await revalidateRecentPostedQueue(queueRevalidation.deals, {
  now: new Date('2026-07-20T12:30:00.000Z'),
  revalidationIntervalHours: 6,
  inspectDealUrlHealth: async () => { throw new Error('cached queue rows must not be revalidated'); },
  concurrency: 1,
});
assert.equal(queueRevalidationCacheHit.validation, null, 'fresh queue validation timestamps avoid repeated URL checks');
assert.deepEqual(queueRevalidationCacheHit.deals, queueRevalidation.deals);

const flappingRepostFilter = filterAlreadyQueuedDeals([
  {
    ...queueRevalidation.deals[0],
    queueValidationBlocked: false,
    queueValidationReasons: [],
  },
], loadQueuedDealDuplicateKeys(queueRevalidation.deals));
assert.equal(flappingRepostFilter.removed, 1);
assert.deepEqual(
  flappingRepostFilter.deals,
  [],
  'a temporarily blocked posted deal must remain suppressed when a later run allows it again',
);

const pollutedPendingRevalidation = await revalidateRecentPostedQueue([
  {
    id: 'pending-with-false-approved-at',
    brand: 'Wien Café',
    title: '1+1 Kaffee gratis',
    description: '1+1 Kaffee gratis in 1070 Wien.',
    url: 'https://example.com/expired-pending',
    source: 'Official',
    distance: '1070 Wien',
    slackTs: `${recentSlackTs}.3`,
    approvedAt: '2026-07-20T10:00:00.000Z',
    pubDate: '2026-07-19T08:00:00.000Z',
    pubDateSource: 'time.datetime',
    validUntil: '2026-07-18',
    dateConfidence: 'high',
  },
], {
  now,
  revalidationDays: 7,
  inspectDealUrlHealth: async (url) => healthyUrl(url),
  concurrency: 1,
});
assert.equal(pollutedPendingRevalidation.removed, 0);
assert.equal(pollutedPendingRevalidation.blocked, 1, 'pending deals must be revalidated even with a polluted approvedAt');
assert.equal(pollutedPendingRevalidation.deals[0].queueValidationBlocked, true);
assert.equal(pollutedPendingRevalidation.validation?.summary?.blocked, 1);

const oldSlackTs = String(Math.floor(new Date('2026-07-10T12:00:00.000Z').getTime() / 1000));
const staleQueuePrune = pruneStaleQueueDeals([
  { id: 'old-non-social', url: 'https://example.com/old', slackTs: `${oldSlackTs}.1` },
  { id: 'recent-non-social', url: 'https://example.com/recent', slackTs: `${recentSlackTs}.1` },
], { now, maxAgeDays: 7 });
assert.equal(staleQueuePrune.removed, 1);
assert.deepEqual(staleQueuePrune.deals.map((deal) => deal.id), ['recent-non-social']);

const slackDisplay = buildSlackMessage({
  id: 'display-validity',
  brand: 'Wien Café',
  title: '1+1 Kaffee gratis',
  description: '',
  url: 'https://example.com/display',
  category: 'essen',
  type: 'gratis',
  source: 'Firecrawl',
  originSource: 'Firecrawl',
  distance: 'Wien',
  pubDate: '2026-07-20T08:00:00.000Z',
  expires: '2026-07-01',
  validity: {
    status: 'warning',
    sourceDate: '',
    expiryDate: '2026-08-31',
    warnings: ['kein Quell-/Post-Datum gefunden'],
  },
}, 1);
assert.match(slackDisplay, /Angebotsdatum: k\.A\./);
assert.match(slackDisplay, /Gültig bis: 31\.8\.2026/);
assert.doesNotMatch(slackDisplay, /Gültig bis: 1\.7\.2026/);

console.log('slack deal quality ok');

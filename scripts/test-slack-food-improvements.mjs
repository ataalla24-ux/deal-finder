import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { locationConflictReason, normalizeDealFacts, materialOfferConditions } from '../scraper/deal-factual-guards.js';
import { inferPreferredBrand } from '../scraper/deal-normalization-utils.js';
import { semanticCrossPlatformOfferKey, getViennaEvidence } from '../scraper/deal-evidence-utils.js';
import { getNonOfferContentReason, getEditorialRoundupPromotionReason } from '../scraper/promotion-quality-utils.js';
import { normalizeDeal, filterDuplicateDealsInRun, buildSlackMessage } from '../scraper/slack-notify.js';
import { validateDealsForSlack } from '../scraper/deal-validity-agent.js';
import { scanAdLibraryCoverage } from '../scraper/meta-ad-library-coverage.js';
import { buildConfig, collectAdLibrary, classifyPromotion, findViennaEvidence } from '../scraper/meta-instagram-deals.js';
import { discoveryRejection } from '../scraper/deal-discovery-policy.js';
import { runWienDealsCombined } from '../scraper/wien-deals-combined.js';
import { enrichInstagramGraphMedia } from '../scraper/instagram-media-evidence.js';
import { recentFeedbackMetrics } from '../scraper/social-food-audit.js';
import { buildShardedActorInput, collectDirectPostSeedUrls } from '../scraper/import-apify-instagram-deals.js';

const now = new Date('2026-10-16T08:00:00Z');
// Actual October 29 Slack false positives, with positive controls for real offers.
const dubaiCaption = 'Spend AED 70 or more at Kaiser’s Vienna and enjoy a FREE matcha from Rhea Matcha. 📍 Kaiser’s Vienna, Market Island, Dubai Festival City Mall.';
const foreignOffer = { title: 'SPECIAL OFFER AT MARKET ISLAND!', description: dubaiCaption,
  metaGraphCaption: dubaiCaption, city: 'Wien', viennaVerified: true };
assert(locationConflictReason(foreignOffer), 'Vienna in a foreign merchant name is not a Vienna branch');
assert.equal(findViennaEvidence({ caption: dubaiCaption }, { verifiedVienna: true }).verified, false, 'reject before registry/default Vienna evidence');
assert(locationConflictReason({ ...foreignOffer, description: 'Gratis Matcha in 1010 Wien' }), 'inferred display location cannot override the original venue');
assert.equal(locationConflictReason({ title: 'Gratis Matcha', description: 'Dubai-Style Matcha gratis in unserer Filiale, 1010 Wien.' }), '');
assert.equal(locationConflictReason({ title: 'Gratis Kaffee', description: 'In Dubai und auch in Wien bei unserer Filiale.' }), '');
assert.equal(locationConflictReason({ title: 'Flug nach Dubai', flight: { origin: 'VIE' }, description: 'Reise nach Dubai' }), '');
for (const description of ['20% Rabatt in Graz und Wien', 'Gratis Kaffee in Wien, Graz und Linz', '20% Rabatt in Berlin & Vienna']) {
  assert.equal(locationConflictReason({ title: description, description }), '', 'explicit Vienna branches stay eligible');
}
assert(locationConflictReason({ description: '20% Rabatt in Graz. Liebe Gruesse aus Wien! #vienna' }), 'unrelated Vienna mentions are not a participating branch');
assert(locationConflictReason({ description: 'Gratis Drink in Dubai, Kaiser’s Vienna im Market Island.' }), 'Vienna inside the foreign brand is not a city list');
const priceMap = 'A free map of real prices in Vienna, added by guests. Coffee, Schnitzel: 230+ places, from cheap to pricey. HOW MUCH ist eine kostenlose Karte mit echten Preisen in Wien.';
assert(getNonOfferContentReason(priceMap), 'a free price directory is not a merchant benefit');
assert.equal(discoveryRejection({ title: priceMap, socialFoodReview: true }), 'non-offer-content', 'social review uses the same non-offer guard');
assert.equal(classifyPromotion(priceMap).accepted, false, 'reject before retaining a Meta candidate');
assert.equal(getNonOfferContentReason(`${priceMap} Heute gibt es bei Cafe Test einen gratis Kaffee.`), '', 'keep independently promised consumer benefits');
const roundup = '10 things happening in Vienna this Halloween weekend and 4 are free to enter. Friday: harvest fest, free entry; food costs extra. Saturday: Halloween at the cemetery.';
assert(getEditorialRoundupPromotionReason(roundup));
assert.equal(classifyPromotion(roundup).accepted, false);
assert.equal(getEditorialRoundupPromotionReason('10 Burger zum halben Preis in Wien am Freitag, nur solange der Vorrat reicht.'), '');
assert.equal(getEditorialRoundupPromotionReason('Halloween in Wien: Gratis Kaffee am 31.10. in 1070 Wien.'), '');
for (const candidate of [foreignOffer, { title: 'Gratis Preisvergleichskarte', description: priceMap }, { title: 'Gratis-Eintritt zum Event', description: roundup }]) {
  const checked = await validateDealsForSlack([{ ...candidate, id: 'regression', url: 'https://example.com/offer',
    city: 'Wien', viennaVerified: true, type: 'gratis', pubDate: now.toISOString(), validUntil: '2026-10-30' }],
  { now, inspectDealUrlHealth: async () => ({ status: 200, contentHints: {}, dateHints: {} }) });
  assert.equal(checked.allowedDeals.length, 0, 'central validation must also reject retained false positives');
  assert(checked.results[0].decision.reasons.some(r => /Ortswiderspruch|Preisverzeichnis|Mehrfach-Roundup/.test(r)));
}
const grazing = { title: 'Gratis Döner mit Ayran', brand: 'Best Food Grill', city: 'Wien', viennaVerified: true,
  description: 'Am 17.10.2026 von 12:00-15:00 bei bestfoodgrillgraz in der Wienerstraße.',
  url: 'https://www.instagram.com/reel/DeR5j2sM8S0/', type: 'gratis', pubDate: '2026-10-15T10:00:00Z', pubDateSource: 'instagram-graph-timestamp' };
assert(locationConflictReason(grazing));
assert.equal(getViennaEvidence(grazing).hasViennaEvidence, false);
assert(locationConflictReason({ title: 'Gratis Eintritt bei Salzburg', description: 'Unser Reiseplan Wien und Salzburg', city: 'Wien' }));
const checked = await validateDealsForSlack([grazing], { now, inspectDealUrlHealth: async () => ({ ok: true, status: 200, contentHints: {}, dateHints: {} }) });
assert.equal(checked.allowedDeals.length, 0);
assert(checked.results[0].decision.reasons.some(reason => /Ortswiderspruch/.test(reason)));
assert.equal(locationConflictReason({ title: 'Kaffee in Wien', description: 'Aktion in Graz und auch in Wien bei unserer Filiale.' }), '');
assert.equal(locationConflictReason({ title: 'Flug nach Berlin', flight: { origin: 'VIE' } }), '');
assert.equal(locationConflictReason({ title: '20% online', description: 'Hergestellt in Graz, im Onlineshop österreichweit bestellen.' }), '');
const preserved = await validateDealsForSlack([
  { ...grazing, id: 'cheap', title: 'Kebab um 2 €', brand: 'Test Kebap', description: 'Dauerhaft Kebab um 2 € bei Test Kebap, 1070 Wien.', city: 'Wien', type: 'rabatt' },
  { ...grazing, id: 'future', title: 'Gratis Kaffee zur Eröffnung', description: 'Gratis Kaffee in 1070 Wien am 20.10.2026.', validOn: '2026-10-20' },
], { now, inspectDealUrlHealth: async () => ({ status: 200, contentHints: {}, dateHints: {} }) });
assert.equal(preserved.allowedDeals.length, 2, 'strong permanent prices and evidenced future offers stay eligible');

const pizza = { brand: 'dm', title: 'Zweite Pizza gratis', description: 'Kommentiere PIZZA und folge uns. Gutschein direkt per DM. 📍 Trattoria Margareta • Margaretenplatz 2, 1050 Wien. Die günstigere Pizza ist gratis. Gültig bis 31.10.2026.', validUntil: '2026-10-31' };
assert.equal(normalizeDeal(pizza, 'meta-instagram').brand, 'Trattoria Margareta');
assert.equal(inferPreferredBrand({ ...pizza, brand: '@foodblog' }), 'Trattoria Margareta');
assert.equal(inferPreferredBrand({ brand: 'dm', description: '20% auf Pflege bei dm Drogerie.' }), 'dm');
assert.equal(normalizeDealFacts({ type: 'gratis', title: 'Mittagessen unter 12 €', description: 'Naschmarkt Wien' }).type, 'rabatt');
assert.equal(normalizeDealFacts({ type: 'gratis', title: 'Gratis Getränk bei Menü um 5 €' }).type, 'gratis');
assert(getNonOfferContentReason('FREE TRADE AS A DRIVER FOR AFRICA ECONOMIC INTEGRATION?'));
assert.equal(getNonOfferContentReason('Free trade discussion with free coffee in Wien today.'), '');
assert(getNonOfferContentReason('24 hours in Vienna itinerary. Mittagessen am Naschmarkt unter 12 €'));
const conditions = { ...pizza, title: '20% Rabatt', brand: 'Fleischer', description: 'Bei einem Einkauf über 100 € erhältst du 20% Rabatt beim nächsten Einkauf.' };
assert.match(materialOfferConditions(conditions), /100.*nächsten/);
assert.match(buildSlackMessage(conditions, 1, {}), /Wichtige Bedingungen:.*100/);

const mabels = ['Happy Hour täglich 18–20 Uhr Cocktails −4 € Mocktails −2 €', 'Cocktails 4 € und Mocktails 2 € günstiger',
  'Happy Hour daily 6–8 PM cocktails −€4 Mocktails −€2', 'Cocktails 4 € günstiger, Mocktails 2 € günstiger'].map((title, i) => ({
    id: `power-food-${String(i).padStart(12, '0')}`, originSource: 'power-official-food', brand: "MABEL'S No90", title,
    description: title, url: `https://mabels.at/cocktails${i > 1 ? '-en' : ''}.html`,
    evidence: { source: 'official-merchant-page', merchantSourceKey: "MABEL'S No90" },
  }));
assert.equal(filterDuplicateDealsInRun(mabels).deals.length, 1, 'four translated/rewritten cards are one offer');
const identifiedPizza = normalizeDealFacts(pizza);
assert.notEqual(semanticCrossPlatformOfferKey(identifiedPizza), semanticCrossPlatformOfferKey({ ...identifiedPizza, validUntil: '2026-11-30' }));
assert.notEqual(semanticCrossPlatformOfferKey({ ...identifiedPizza, description: 'Nur für Neukunden' }), semanticCrossPlatformOfferKey(identifiedPizza));
assert.notEqual(semanticCrossPlatformOfferKey({ ...identifiedPizza, title: 'Pizza für 5 €' }), semanticCrossPlatformOfferKey({ ...identifiedPizza, title: 'Pizza für 7 €' }));
assert.notEqual(semanticCrossPlatformOfferKey({ ...identifiedPizza, description: 'Ab 50 € Einkauf' }), semanticCrossPlatformOfferKey({ ...identifiedPizza, description: 'Ab 100 € Einkauf' }));

const large = () => Object.assign(new Error('Please reduce the amount of data'), { status: 500, code: 1 });
const sizes = [];
const adaptive = await scanAdLibraryCoverage({ terms: ['heavy', 'healthy'], scope: 'test', now, pageSize: 5000, maxRequests: 8,
  fetchPage: async (term, after, size) => { sizes.push([term, size]); if (term === 'heavy' && size > 250) throw large(); return { payload: { data: [{ id: term }] } }; } });
assert.deepEqual(sizes, [['heavy', 5000], ['heavy', 1000], ['heavy', 250], ['healthy', 5000]]);
assert.equal(adaptive.failure, null);
assert.equal(adaptive.requests, 4);
assert.equal(adaptive.state.queries.heavy.pageSize, 250);
const isolated = await scanAdLibraryCoverage({ terms: ['broken', 'healthy'], scope: 'test', now, pageSize: 25,
  fetchPage: async term => { if (term === 'broken') throw large(); return { payload: { data: [{ id: 'kept' }] } }; } });
assert.equal(isolated.failure, null);
assert.equal(isolated.raw[0].id, 'kept');
assert(isolated.state.queries.broken.retryAt);
const bounded = await scanAdLibraryCoverage({ terms: ['heavy'], scope: 'test', now, pageSize: 5000, maxRequests: 2, fetchPage: async () => { throw large(); } });
assert.equal(bounded.requests, 2);
const config = buildConfig({ META_AD_LIBRARY_ACCESS_TOKEN: 'fixture', META_AD_LIBRARY_MAX_COVERAGE: '1', META_INSTAGRAM_MAX_RETRIES: '0' }, now);
const migrated = await collectAdLibrary({ ...config, adSearchTerms: ['food'] }, now, async () => Response.json({ data: [] }),
  { code: 1, message: 'Please reduce the amount of data', retryAt: new Date(+now + 3600000).toISOString() });
assert.equal(migrated.cooldown, undefined, 'old payload error cannot keep all searches locked out');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'food-quality-'));
const originalFetch = globalThis.fetch;
try {
  let state = { version: 1, reservations: [], pausedUntil: 0 };
  globalThis.fetch = async (url, init) => {
    assert(String(url).startsWith('https://api.github.com/'));
    if (String(url).includes('/git/ref/')) return Response.json({});
    if (init.method === 'PUT') { state = JSON.parse(Buffer.from(JSON.parse(init.body).content, 'base64').toString()); return Response.json({}, { status: 200 }); }
    return Response.json({ content: Buffer.from(JSON.stringify(state)).toString('base64'), sha: 'fixture' });
  };
  let graphCalls = 0;
  const wien = await runWienDealsCombined({ now, write: false, scanState: {}, mediaCache: {},
    scanStatePath: path.join(tmp, 'scan.json'), peerScanStatePath: path.join(tmp, 'peer.json'),
    env: { INSTAGRAM_ACCESS_TOKEN: 'fixture', INSTAGRAM_USER_ID: '123', INSTAGRAM_SHARED_QUOTA_ENABLED: '1', GH_TOKEN: 'fixture', GITHUB_REPOSITORY: 'fixture/repo', WIEN_COMBINED_GRAPH_HASHTAGS: 'wienergastro' },
    fetchImpl: async url => { assert(url instanceof URL); graphCalls++; return Response.json({ data: String(url).includes('ig_hashtag_search') ? [{ id: '456' }] : [] }); },
  });
  assert.equal(graphCalls, 2, 'actual Wien URL objects traverse the production quota wrapper');
  assert.equal(wien.report.sources[0].status, 'ok');
  assert.equal(wien.report.status, 'degraded', 'empty successful API response is not advertised as productive');
} finally { globalThis.fetch = originalFetch; fs.rmSync(tmp, { recursive: true, force: true }); }

const entry = (id, caption, queued = now.toISOString()) => ({ item: { id, caption, media_type: 'IMAGE', media_url: 'https://scontent.cdninstagram.com/old.jpg', timestamp: now.toISOString() }, context: { account: { category: 'food', verifiedVienna: true } }, mediaQueuedAt: queued });
const selected = [];
const media = await enrichInstagramGraphMedia([entry('fresh', 'Gratis Kebab Aktion Wien'), entry('old', 'Unser Restaurant in Wien', '2026-10-09T09:00:00Z')],
  { ...config, mediaMaxPostsPerRun: 1, mediaOcrEnabled: true, mediaLlmEnabled: false, mediaCacheTtlDays: 7 }, now, {
    tools: { tesseract: true }, analyzeItem: async item => { selected.push(item.id); return { errors: /old.jpg/.test(item.media_url) ? ['media HTTP 403'] : [], ocrText: 'Gratis Kebab', imageCount: 1 }; },
    refreshMediaItem: async entry => ({ id: entry.item.id, media_url: 'https://scontent.cdninstagram.com/fresh.jpg' }),
  });
assert.deepEqual(selected, ['fresh', 'fresh']);
assert.equal(media.report.mediaRefreshRecovered, 1);
assert.equal(media.report.aiCalls, 0);
const stats = recentFeedbackMetrics([
  { category: 'trinken', decision: 'approved', offerKey: 'same', decidedAt: now.toISOString(), slackSentAt: new Date(+now - 3600000).toISOString() },
  { category: 'trinken', decision: 'approved', offerKey: 'same', decidedAt: now.toISOString() },
  { category: 'essen', decision: '', slackSentAt: now.toISOString() },
], now);
assert.equal(stats.uniqueApprovedOffers, 1);
assert.equal(stats.unreviewed, 1);
assert.equal(stats.manuallyRejected, 0);
assert.equal(stats.qualityRate, null);
assert.equal(stats.averageReviewMinutesPerApproval, null);
const targeted = buildShardedActorInput({ seedAccounts: ['cafe'], seedHashtags: ['wien'], seedPostUrls: ['https://www.instagram.com/p/food/'] }, { directOnly: true });
assert.deepEqual(targeted.input.seedAccounts, []);
assert.deepEqual(targeted.input.seedHashtags, []);
assert.equal(targeted.input.seedPostUrls.length, 1);
const seeds = collectDirectPostSeedUrls({ targeted: true, now, output: { deals: [
  { url: 'https://www.instagram.com/p/food/', title: 'Gratis Kaffee', pubDate: now.toISOString() },
  { url: 'https://www.instagram.com/p/old/', title: 'Gratis Kaffee', pubDate: '2025-10-15' },
  { url: 'https://www.instagram.com/p/shop/', title: 'Modeaktion', pubDate: now.toISOString() },
] } });
assert.deepEqual(seeds, ['https://www.instagram.com/p/food/']);
console.log('Slack food improvements: real regressions, quota integration, bounded recovery, semantic deduplication, media priority, feedback and targeted Apify passed.');

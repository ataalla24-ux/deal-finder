import assert from 'node:assert/strict';
import { canonicalOfferUrl, selectMerchantOfferPages, extractMerchantOfferCandidates, currentMerchantCandidates, isMerchantWebsiteReview } from '../scraper/merchant-offer-discovery.js';
import { currentOriginalOffer, graphOriginalRecord } from '../scraper/current-original-offer.js';
import { discoveryAvailability } from '../scraper/discovery-availability.js';
import { buildConfig, normalizeGraphMediaItem, retainMetaOutbox } from '../scraper/meta-instagram-deals.js';
import { graphPostEvidenceFromEntry, buildInstagramGraphEvidencePayload, enrichDealWithInstagramGraphEvidence } from '../scraper/instagram-graph-evidence.js';
import { validateDealsForSlack } from '../scraper/deal-validity-agent.js';
import { selectFirecrawlReviewDeals, combineFirecrawlReviewSelections, filterDuplicateDealsInRun, buildFirecrawlReviewMessage } from '../scraper/slack-notify.js';
import { mediaContentKey, reusableOcrEvidence, enrichInstagramGraphMedia } from '../scraper/instagram-media-evidence.js';
import { runDiscovery, fetchMerchantPage } from './discover-vienna-merchants.mjs';

const now = new Date('2026-11-11T12:00:00Z');
const website = 'https://cafe.example/';
const merchant = { name: 'Test Cafe', website, address: 'Testgasse 1, 1070 Wien',
  sourceUrl: 'https://www.openstreetmap.org/node/1', observedAt: now.toISOString() };
const task = { url: `${website}angebote`, merchant };
assert.equal(canonicalOfferUrl(`${task.url}?utm_source=ig#coffee`, website), task.url);
for (const value of ['/jobangebote', '/catering-angebote', '/angebote/login', '/speisekarte', '/B2B-Angebote',
  '/redaktionelle-grundsatze', '/attraktionen/', '/ch/aktionen/', '/Specials.pdf', '/angebot.jpg', '/veranstaltungen/special-guest']) {
  assert.equal(canonicalOfferUrl(new URL(value, website).href, website), '');
}
for (const url of ['https://evil.example/angebote', 'https://127.0.0.1/angebote', 'https://user:pass@cafe.example/angebote']) assert.equal(canonicalOfferUrl(url, website), '');
await assert.rejects(fetchMerchantPage('https://evil.example/angebote', 0, new URL(website).origin), /Cross-origin/);
await assert.rejects(fetchMerchantPage(task.url, 0, new URL(website).origin, () => false), /Robots redirect/);
const sites = { [website]: { status: 'ok', checkedAt: now.toISOString(), offerUrls: [task.url, `${task.url}#top`, `${website}special`] } };
assert.equal(selectMerchantOfferPages({ merchants: [merchant, merchant] }, sites, {}, now, 200).length, 1);
assert.equal(selectMerchantOfferPages({ merchants: [merchant] }, sites, {}, now, 0).length, 0);
assert.equal(selectMerchantOfferPages({ merchants: [merchant] }, sites, { [task.url]: { checkedAt: now.toISOString(), status: 'deferred' }, [`${website}special`]: { checkedAt: now.toISOString(), status: 'ok' } }, now, 200).length, 0);
const manyMerchants = Array.from({ length: 300 }, (_, i) => ({ ...merchant, website: `https://cafe${i}.example/` }));
const manySites = Object.fromEntries(manyMerchants.map(m => [m.website, { status: 'ok', checkedAt: now.toISOString(), offerUrls: [`${m.website}angebote`] }]));
assert.equal(selectMerchantOfferPages({ merchants: manyMerchants }, manySites, {}, now, 200).length, 40);
assert.equal(selectMerchantOfferPages({ merchants: [merchant] }, sites, {}, now, 200, { sources: [{ url: website,
  cooldown: { reason: 'access-denied', nextRetryAt: '2026-11-15' } }] }).length, 0, 'respect Power host restriction');
assert.equal(selectMerchantOfferPages({ merchants: [merchant] }, sites, { [task.url]: { status: 'deferred', checkedAt: '2026-10-01', retryAt: '2026-12-01' } }, now, 200)[0].url, `${website}special`, 'respect longer Retry-After');

const html = '<article><h2>20 % Rabatt auf Pizza</h2><p>In 1070 Wien, gültig bis 30.11.2026. Nur Abholung.</p></article><article><h2>Zweiter Kaffee gratis</h2><p>In 1070 Wien, gültig bis 30.11.2026.</p></article>';
const deals = extractMerchantOfferCandidates(html, task, now);
assert.equal(deals.length, 2, JSON.stringify(deals));
assert.equal(filterDuplicateDealsInRun(deals).deals.length, 2, 'two offers on one merchant page must survive');
assert.equal(combineFirecrawlReviewSelections({}, { deals }, []).deals.length, 2);
assert.deepEqual(combineFirecrawlReviewSelections({}, { deals }, [deals[0]]).deals.map(d => d.id), [deals[1].id]);
assert.ok(deals.every(d => isMerchantWebsiteReview(d, now)));
assert.ok(deals[0].description.includes('Abholung'));
assert.equal(currentMerchantCandidates({ [task.url]: { status: 'ok', checkedAt: now.toISOString(), deals } }, now).length, 2);
assert.equal(currentMerchantCandidates({ x: { status: 'deferred', checkedAt: now.toISOString(), deals } }, now).length, 0);
const endDayState = { x: { status: 'ok', checkedAt: '2026-11-30T10:00:00Z', deals } };
assert.equal(currentMerchantCandidates(endDayState, new Date('2026-11-30T22:59:00Z')).length, 2, 'date-only offer lasts through its Vienna end day');
assert.equal(currentMerchantCandidates(endDayState, new Date('2026-11-30T23:00:00Z')).length, 0);
assert.equal(currentMerchantCandidates({ x: { status: 'ok', checkedAt: '2026-12-01', deals } }, now).length, 0);
for (const body of ['<h2>Pizza 12 Euro</h2>', '<h2>1+1 Bier gratis</h2>', '<h2>20 % Rabatt auf Pizza</h2><p>Nur in Graz bis 30.11.2026</p>', '<h2>Pizza gratis bis 01.11.2026 in Wien</h2>']) {
  assert.equal(extractMerchantOfferCandidates(body, task, now).length, 0, body);
}
const unresolved = extractMerchantOfferCandidates('<article><h2>20 % Rabatt auf Pizza</h2><p>Nur Abholung.</p></article>', task, now)[0];
assert.ok(unresolved);
assert.notEqual(unresolved.distance, merchant.address, 'directory address is not campaign evidence');
const websiteResult = await validateDealsForSlack([unresolved], { now, inspectDealUrlHealth: async url => ({ status: 200, finalUrl: url, dateHints: {} }) });
assert.equal(websiteResult.allowedDeals.length, 0);
const review = selectFirecrawlReviewDeals(websiteResult.results, { now });
assert.equal(review.deals.length, 1, JSON.stringify(websiteResult.results));
assert.match(buildFirecrawlReviewMessage(review.deals[0], 1), /Prüfkandidat/);
assert.equal(selectFirecrawlReviewDeals([{ deal: unresolved, decision: { allowed: false, reasons: ['abgelaufen'] } }], { now }).deals.length, 0);
assert.equal(selectFirecrawlReviewDeals(websiteResult.results, { now: new Date('2026-11-21') }).deals.length, 0);

let mediaBits = (BigInt(Date.parse('2026-10-15T09:00:00Z')) - 1314220021300n) << 23n;
let shortcode = '';
while (mediaBits) { shortcode = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[Number(mediaBits % 64n)] + shortcode; mediaBits /= 64n; }
const item = { id: '123456', permalink: `https://www.instagram.com/p/${shortcode}/`, timestamp: '2026-10-15T09:00:00Z',
  caption: '20 % Rabatt auf Pizza in 1070 Wien. Gültig bis 30.11.2026. Nur Abholung.', username: 'testcafe' };
const context = { sourceType: 'account', sourceName: 'testcafe', account: { username: 'testcafe', accountType: 'merchant', verifiedVienna: true, category: 'food' } };
const original = graphOriginalRecord(item, context, now);
assert.ok(currentOriginalOffer(original, now));
for (const patch of [
  { metaGraphVerified: false }, { sourceAccountType: 'creator' }, { metaGraphCaption: 'Pizza gratis bis 30.11.' },
  { metaGraphCaption: 'Pizza gratis jeden Mittwoch' }, { metaGraphCaption: 'Repost: ' + item.caption },
  { metaGraphCaption: 'Pizza gratis bis 01.11.2026' }, { metaGraphCaption: 'Pizza gratis ab 20.11.2026 bis 30.11.2026' },
  { metaGraphVerifiedAt: '2026-11-08T12:00:00Z' }, { sourcePublishedAt: '2025-10-15' },
  { validUntil: '2026-12-31' }, { metaGraphBlockingReason: 'non-vienna-location' },
]) assert.equal(currentOriginalOffer({ ...original, ...patch }, now), null, JSON.stringify(patch));
assert.ok(currentOriginalOffer({ ...original, sourcePublishedAt: '2026-12-20', metaGraphVerifiedAt: '2027-01-02T10:00:00Z', metaGraphCaption: 'Pizza gratis bis 05.01.2027' }, new Date('2027-01-02T12:00:00Z')));
assert.equal(currentOriginalOffer({ ...original, metaGraphVerifiedAt: '2026-11-30T22:30:00Z' }, new Date('2026-11-30T23:05:00Z')), null, 'Vienna midnight ends the offer');
const config = buildConfig({}, now);
const outcome = normalizeGraphMediaItem(item, context, config, now);
assert.ok(outcome.deal, JSON.stringify(outcome));
const record = graphPostEvidenceFromEntry({ item, context }, outcome, now);
const evidence = buildInstagramGraphEvidencePayload([record], { now });
assert.equal(evidence.posts.length, 1, 'old yet current original is retained with fresh proof');
const cleared = { ...record, caption: '', verifiedAt: new Date(+now + 1000).toISOString() };
const withdrawalTime = new Date(+now + 1000);
const withdrawn = buildInstagramGraphEvidencePayload([cleared], { now: withdrawalTime, previous: evidence });
assert.equal(withdrawn.posts[0].caption, '');
assert.equal(withdrawn.posts[0].blockingReason, 'current-original-offer-unconfirmed');
assert.equal(buildInstagramGraphEvidencePayload([], { now: new Date(+now + 2000), previous: withdrawn }).posts.length, 1);
assert.equal(buildInstagramGraphEvidencePayload([], { now: new Date(+now + 37 * 3600000), previous: withdrawn }).posts.length, 0);
const withdrawnDeal = enrichDealWithInstagramGraphEvidence(outcome.deal, new Map([[record.postKey, withdrawn.posts[0]]]), { now: withdrawalTime }).deal;
assert.equal(currentOriginalOffer(withdrawnDeal, withdrawalTime), null);
const revoked = await validateDealsForSlack([withdrawnDeal], { now: withdrawalTime, inspectDealUrlHealth: async url => ({ status: 200, finalUrl: url, dateHints: {} }) });
assert.equal(revoked.allowedDeals.length, 0);
const enriched = enrichDealWithInstagramGraphEvidence(outcome.deal, new Map([[record.postKey, record]]), { now }).deal;
const validated = await validateDealsForSlack([enriched], { now, inspectDealUrlHealth: async url => ({ status: 200, finalUrl: url, dateHints: {} }) });
assert.equal(validated.allowedDeals.length, 1, JSON.stringify(validated.results));
assert.equal(retainMetaOutbox([], [enriched], now).length, 1);
assert.equal(retainMetaOutbox([], [enriched], new Date('2026-11-14T12:00:00Z')).length, 0, 'proof is not refreshed by retaining an outbox');

const mediaItem = { id: 'ocr-retry', caption: 'Unser Pizza-Wochenplan in Wien', timestamp: '2026-11-11T08:00:00Z', media_type: 'IMAGE', media_url: 'https://cdn.example/one.jpg' };
const saved = { analyzedAt: '2026-11-11T10:00:00Z', contentKey: mediaContentKey(mediaItem), ocrText: 'Zweite Pizza gratis in 1070 Wien bis 30.11.2026', visionImageCount: 0, errors: [], warnings: [], aiPending: true };
assert.ok(reusableOcrEvidence(saved, mediaItem, now));
assert.equal(reusableOcrEvidence(saved, { ...mediaItem, caption: 'Updated' }, now), false);
assert.equal(reusableOcrEvidence({ ...saved, visionImageCount: 1 }, mediaItem, now), false);
assert.equal(reusableOcrEvidence(saved, { ...mediaItem, media_url: mediaItem.media_url + '?variant=2' }, now), false);
assert.equal(reusableOcrEvidence({ ...saved, ocrAnalyzedAt: '2026-11-09T10:00:00Z' }, mediaItem, now), false);
let analyses = 0, calls = 0;
const media = await enrichInstagramGraphMedia([{ item: mediaItem, context }], buildConfig({
  OPENAI_API_KEY: 'offline-fixture', META_INSTAGRAM_MEDIA_OCR_ENABLED: '1', META_INSTAGRAM_MEDIA_LLM_ENABLED: '1', META_INSTAGRAM_MEDIA_LLM_MAX_CALLS_PER_RUN: '1',
  META_INSTAGRAM_MEDIA_VISION_ENABLED: '0',
}, now), now, { tools: { tesseract: true, ffmpeg: true }, cache: { [mediaItem.id]: saved },
  analyzeItem: async () => { analyses++; throw new Error('must reuse OCR'); },
  classifyOcr: async () => { calls++; return { isDeal: true, confidence: 0.99, offerText: saved.ocrText, exclusion: 'none' }; } });
assert.equal(analyses, 0);
assert.equal(calls, 1);
assert.equal(media.report.ocrReused, 1);
assert.equal(media.cache[mediaItem.id].ocrAnalyzedAt, saved.analyzedAt, 'reuse cannot renew OCR freshness');
const vision = await enrichInstagramGraphMedia([{ item: { ...mediaItem }, context }], buildConfig({
  OPENAI_API_KEY: 'offline-fixture', META_INSTAGRAM_MEDIA_OCR_ENABLED: '1', META_INSTAGRAM_MEDIA_LLM_ENABLED: '1', META_INSTAGRAM_MEDIA_VISION_ENABLED: '1',
}, now), now, { tools: { tesseract: true }, cache: { [mediaItem.id]: saved },
  analyzeItem: async () => { analyses++; return { ocrText: '', visionImages: [], errors: [], warnings: [] }; },
  classifyOcr: async () => { throw new Error('no evidence'); } });
assert.equal(analyses, 1, 'enabling vision must not reuse incomplete OCR-only input');
assert.equal(vision.report.ocrReused, 0);
const deferred = await enrichInstagramGraphMedia([{ item: { ...mediaItem }, context }], {
  ...buildConfig({ OPENAI_API_KEY: 'offline-fixture', META_INSTAGRAM_MEDIA_VISION_ENABLED: '1' }, now),
  mediaLlmMaxCallsPerRun: 0,
}, now, { tools: { tesseract: true }, cache: { [mediaItem.id]: { ...saved, visionImageCount: 1 } },
  analyzeItem: async () => { throw new Error('no repeated OCR while AI budget is exhausted'); },
  classifyOcr: async () => { throw new Error('no paid call'); } });
assert.equal(deferred.report.aiRetryBudgetDeferred, 1);
assert.equal(deferred.report.analyzed, 0);
assert.equal(deferred.report.aiCalls, 0);
assert.equal(deferred.cache[mediaItem.id].analyzedAt, saved.analyzedAt);
const availability = discoveryAvailability({ lastUpdated: now.toISOString(), search: { stoppedReason: 'search-unavailable', nextRetryAt: '2026-11-12' } }, {}, now);
assert.equal(availability.lanes[0].status, 'paused');
assert.equal(availability.lanes[3].status, 'unknown-stale-report');
assert.equal(availability.lanes[1].status, 'unknown-missing-lane');
assert.ok(availability.lanes.every(l => l.deliveredToSlack === null));

const files = {
  'reviews/vienna-merchant-directory.json': { generatedAt: now.toISOString(), merchants: [merchant] },
  'reviews/vienna-merchant-website-state.json': sites,
};
const requests = [];
const report = await runDiscovery({ now, read: (name, fallback) => files[name] || fallback,
  save: (name, value) => { files[name] = value; }, wait: async () => {}, log: () => {},
  fetchImpl: async () => { throw new Error('cached directory must not trigger Overpass'); },
  fetchPage: async (url, hops, origin, allowedPath) => {
    requests.push(url);
    if (url.endsWith('/robots.txt')) return { status: 200, body: 'User-agent: *\nDisallow: /private', headers: {} };
    assert.equal(origin, new URL(website).origin);
    assert.equal(allowedPath(`${website}private`), false);
    return { status: 200, body: html, headers: { 'content-type': 'text/html' }, url };
  },
});
assert.equal(report.totalPageSlotsUsed, 1);
assert.equal(report.offerPagesAttemptedThisRun, 1);
assert.equal(report.sitesAttemptedThisRun, 0, 'an offer slot replaces its domain homepage slot');
assert.equal(requests.length, 2, 'one robots check and one offer page; no paid or media requests');
assert.equal(files['docs/deals-pending-vienna-websites.json'].deals.length, 2);
assert.ok(!files['docs/deals.json'], 'collector never publishes to the live app');
const pausedReport = await runDiscovery({ now: new Date(+now + 8 * 86400000),
  read: (name, fallback) => name.endsWith('directory.json') ? { ...files[name], generatedAt: new Date(+now + 8 * 86400000).toISOString() } : files[name] || fallback,
  save: (name, value) => { files[name] = value; }, wait: async () => {}, log: () => {},
  fetchPage: async url => ({ status: 429, body: '', headers: { 'retry-after': '172800' }, url }),
});
assert.equal(pausedReport.offerPagesDeferredThisRun, 1);
const pausedRow = Object.values(files['reviews/vienna-merchant-offer-state.json']).find(row => row.status === 'deferred');
assert.equal(pausedRow.httpStatus, 429);
assert.ok(pausedRow.retryAt);
assert.equal(selectMerchantOfferPages({ merchants: [merchant] }, sites, files['reviews/vienna-merchant-offer-state.json'], new Date(+now + 9 * 86400000), 200).length, 0, 'host restriction also blocks other offer paths');
console.log('Discovery recall: website budget, source isolation, review lane, expiry, Graph-to-validator, OCR reuse and transport evidence PASS (offline).');

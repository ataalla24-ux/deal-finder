import assert from 'node:assert/strict';
import { FOOD_PRODUCT } from '../scraper/power-food-extraction.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildMerchantDirectory, discoveryAccounts, extractMerchantLinks, instagramHandle, merchantWebsite, selectDiscoveryAccounts } from '../scraper/vienna-merchant-discovery.js';
import { publicIPv4, robotsAllowsDiscovery, runDiscovery } from './discover-vienna-merchants.mjs';
import { curatedMerchantTask, canonicalHomepageUrl, currentMerchantCandidates, extractMerchantOfferCandidates, isMerchantWebsiteReview } from '../scraper/merchant-offer-discovery.js';
import { buildConfig, loadAccountCatalog } from '../scraper/meta-instagram-deals.js';

const now = new Date();
for (const value of ['http://127.0.0.1/', 'https://user:pass@cafe.at', 'https://thefork.at/', 'https://localhost/', 'https://[::1]/', 'https://cafe.at:8443/']) assert.equal(merchantWebsite(value), '', value);
assert.equal(merchantWebsite('www.cafe.at/'), 'https://www.cafe.at/');
for (const ip of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.0.1', '172.16.0.1', '100.64.0.1', '224.1.1.1', '0.0.0.0', '::1']) assert.equal(publicIPv4(ip), false);
assert.equal(publicIPv4('93.184.216.34'), true);
assert.equal(robotsAllowsDiscovery('User-agent: *\nDisallow: /'), false);
assert.equal(robotsAllowsDiscovery('User-agent: *\nDisallow:'), true);
assert.equal(robotsAllowsDiscovery('User-agent: *\nDisallow: /wp-admin/'), true);
assert.equal(robotsAllowsDiscovery('User-agent: *\nDisallow: /private/', 'https://example.com/private/menu'), false);
assert.equal(instagramHandle('https://instagram.com/p/test/'), '');
assert.equal(instagramHandle('https://instagram.com.evil.test/cafe'), '');
assert.equal(instagramHandle('@Cafe.Wien'), 'cafe.wien');
assert.throws(() => buildMerchantDirectory({ elements: [], remark: 'timeout' }), /Incomplete/);
const directory = buildMerchantDirectory({ elements: [
  { type: 'node', id: 1, tags: { name: 'Cafe', amenity: 'cafe', website: 'https://cafe.at/', 'contact:instagram': '@cafe.wien' } },
  { type: 'node', id: 2, tags: { name: 'Closed', amenity: 'cafe', disused: 'yes' } },
  { type: 'node', id: 3, tags: { name: 'Other', amenity: 'bank' } },
] }, now);
assert.equal(directory.merchants.length, 1);
assert.equal(directory.merchants[0].address, '', 'no invented address');
const links = extractMerchantLinks('<a href="https://instagram.com/cafe.wien/">IG</a><a href="https://instagram.com/cafe.wien/">again</a><a href="/angebote">Offers</a><a href="https://evil.test/angebote">bad</a>', 'https://cafe.at/');
assert.deepEqual(links, { handles: ['cafe.wien'], offerUrls: ['https://cafe.at/angebote'] });
const accounts = discoveryAccounts(directory, {}, now);
assert.equal(accounts.length, 1);
assert.equal(accounts[0].verifiedVienna, false);
const bulk = { generatedAt: now.toISOString(), accounts: Array.from({ length: 1000 }, (_, i) => ({ username: `cafe${i}`, verifiedVienna: true, priority: 999 })) };
const first = selectDiscoveryAccounts(bulk, now);
assert.equal(first.length, 200);
assert.ok(first.every(a => !a.verifiedVienna && a.priority === 25));
assert.notDeepEqual(first, selectDiscoveryAccounts(bulk, new Date(+now + 86400000)));
assert.equal(selectDiscoveryAccounts({ ...bulk, generatedAt: '2000-01-01' }, now).length, 0);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-discovery-test-'));
try {
  const write = (name, data) => { const p = path.join(dir, name); fs.writeFileSync(p, JSON.stringify(data)); return p; };
  const config = buildConfig({}, now);
  const catalog = loadAccountCatalog(config, {
    watchlistPath: write('watch.json', { accounts: [{ username: 'cafe.wien', category: 'discovery', priority: 100 }] }),
    registryPath: write('registry.json', { accounts: [{ username: 'blocked.cafe', blockedByModeration: true }] }),
    discoveryPath: write('discovery.json', { generatedAt: now.toISOString(), accounts: [...accounts, { username: 'blocked.cafe' }, { username: 'new.cafe' }] }),
    candidatePaths: [],
  });
  assert.equal(catalog.find(a => a.username === 'cafe.wien').priority, 100);
  assert.notEqual(catalog.find(a => a.username === 'cafe.wien').accountType, 'merchant');
  assert.ok(!catalog.some(a => a.username === 'blocked.cafe'));
  assert.equal(catalog.find(a => a.username === 'new.cafe').verifiedVienna, false);
} finally { fs.rmSync(dir, { recursive: true, force: true }); }

// Homepage offer discovery must reuse the existing page response, not spend an
// extra source/media/model request or turn directory addresses into evidence.
const homeNow = new Date('2026-11-13T12:00:00Z');
const homeUrl = 'https://homepage-cafe.example/';
const homeMerchant = { name: 'Homepage Cafe', website: homeUrl, observedAt: homeNow.toISOString(),
  address: 'Verzeichnisgasse 1, 1070 Wien', sourceUrl: 'https://www.openstreetmap.org/node/9' };
const homeFiles = {
  'reviews/vienna-merchant-directory.json': { generatedAt: homeNow.toISOString(), merchants: [homeMerchant] },
};
const homeRequests = [];
const homeReport = await runDiscovery({ curatedPages: [], now: homeNow, read: (file, fallback) => homeFiles[file] || fallback,
  save: (file, data) => { homeFiles[file] = data; }, wait: async () => {}, log: () => {},
  fetchImpl: async () => { throw new Error('No directory refresh in homepage fixture'); },
  fetchPage: async url => {
    homeRequests.push(url);
    if (url.endsWith('/robots.txt')) return { status: 200, body: 'User-agent: *\nDisallow: /private', headers: {} };
    return { status: 200, url, headers: { 'content-type': 'text/html' }, body:
      '<article><h2>20 % Rabatt auf Pizza</h2><p>In Wien, bis 30.11.2026. Nur bei Abholung.</p></article>' +
      '<article><h2>Zweiter Kaffee gratis</h2><p>Mit jeder Bestellung einer Mehlspeise.</p></article>' +
      '<article><h2>Mittagsmenü</h2><p>Pizza und Salat 12 Euro.</p></article>' +
      // Source text from the captured MABELS homepage: "Special" and meat
      // percentage describe a regular burger, not a monetary benefit.
      '<article><h4>MABEL’S Special Burger</h4><p>100 % Rindfleisch, Speck und Käse – mit Pommes und Saucen.</p><div>17,90 €</div></article>' +
      '<article><h2>1+1 Bier gratis</h2><p>In Wien bis 30.11.2026.</p></article>' +
      '<article><h2>20 % Rabatt auf Pizza</h2><p>Nur in Graz bis 30.11.2026.</p></article>' +
      '<article><h2>Pizza gratis</h2><p>In Wien bis 01.11.2026.</p></article>' };
  },
});
const homeDeals = homeFiles['docs/deals-pending-vienna-websites.json'].deals;
assert.equal(homeDeals.length, 2, 'reuse homepage HTML for concrete current food offers only');
assert.deepEqual(homeRequests, [new URL('/robots.txt', homeUrl).href, homeUrl], 'no additional request for homepage offers');
assert.equal(homeReport.totalPageSlotsUsed, 1);
assert.equal(homeReport.offerPagesAttemptedThisRun, 0, 'homepage extraction does not allocate an offer-page slot');
assert.ok(homeDeals.every(deal => deal.reviewRequired && isMerchantWebsiteReview(deal, homeNow)));
const unresolvedHome = homeDeals.find(deal => /Kaffee/.test(deal.title));
assert.equal(unresolvedHome.distance, 'Ort prüfen');
assert.equal(unresolvedHome.address, undefined);
assert.ok(unresolvedHome.missingFields.includes('Ort') && unresolvedHome.missingFields.includes('Ablauf'));
assert.ok(!homeFiles['docs/deals.json'], 'homepage discovery never publishes live');
assert.equal(homeReport.homepageCandidatesThisRun, 2);
assert.deepEqual(homeReport.homepageCandidateIdsThisRun, homeDeals.map(deal => deal.id));
assert.equal(homeReport.offerPageCandidatesThisRun, 0);
assert.equal(homeReport.retainedCandidateCount, 0);
for (const url of ['https://other.example/', `${homeUrl}andere-seite`, `${homeUrl}?account=1`, 'https://user:pass@homepage-cafe.example/'])
  assert.equal(canonicalHomepageUrl(url, homeUrl), '', url);
assert.equal(canonicalHomepageUrl(`${homeUrl}?utm_source=ig#top`, homeUrl), homeUrl);
for (const path of ['login', 'checkout', 'angebote.pdf', 'catering', 'b2b'])
  assert.equal(canonicalHomepageUrl(homeUrl + path, homeUrl + path), '', path);
assert.equal(isMerchantWebsiteReview({ ...homeDeals[0], url: `${homeUrl}other`,
  evidence: { ...homeDeals[0].evidence, sourceUrl: `${homeUrl}other` } }, homeNow), false);
assert.equal(isMerchantWebsiteReview({ ...homeDeals[0], evidence: { ...homeDeals[0].evidence, discoveryPageKind: undefined } }, homeNow), false,
  'a homepage requires explicit homepage provenance');

async function revisitHomepage({ at, body = '', responseStatus = 200, finalUrl = homeUrl, robotsBody = 'User-agent: *\nDisallow:', powerReport, directoryMerchants } = {}) {
  const files = structuredClone(homeFiles), requests = [];
  const visitTime = at || new Date(+homeNow + 31 * 86400000);
  files['reviews/vienna-merchant-directory.json'] = { generatedAt: visitTime.toISOString(),
    merchants: directoryMerchants || [{ ...homeMerchant, observedAt: visitTime.toISOString() }] };
  if (powerReport) files['docs/power-scraper-report.json'] = powerReport;
  const report = await runDiscovery({ curatedPages: [], now: visitTime, read: (file, fallback) => files[file] || fallback,
    save: (file, data) => { files[file] = data; }, wait: async () => {}, log: () => {},
    fetchImpl: async () => { throw new Error('No external request'); },
    fetchPage: async url => {
      requests.push(url);
      if (url.endsWith('/robots.txt')) return { status: 200, body: robotsBody, headers: {} };
      return { status: responseStatus, url: finalUrl, body, headers: { 'content-type': 'text/html', 'retry-after': '172800' } };
    },
  });
  return { files, requests, report, deals: files['docs/deals-pending-vienna-websites.json'].deals };
}
const retainedHome = await revisitHomepage({ at: new Date(+homeNow + 86400000) });
assert.equal(retainedHome.requests.length, 0, 'the 30-day homepage policy remains unchanged');
assert.equal(retainedHome.report.homepageCandidatesThisRun, 0);
assert.equal(retainedHome.report.retainedCandidateCount, 2);
assert.equal(retainedHome.deals[0].evidence.checkedAt, homeNow.toISOString(), 'retaining output never refreshes source evidence');
const staleHome = await revisitHomepage({ at: new Date(+homeNow + 9 * 86400000) });
assert.equal(staleHome.requests.length, 0);
assert.equal(staleHome.deals.length, 0, 'homepage proof expires before the next scheduled homepage revisit');
for (const fixture of [
  { body: '<h2>Unsere Pizza und Pasta</h2><p>Mittagsmenü 12 Euro.</p>' },
  { body: '<h2>20 % Rabatt auf Pizza</h2><p>In Wien bis 30.12.2026.</p>', finalUrl: 'https://other.example/' },
  { responseStatus: 429 },
  { robotsBody: 'User-agent: *\nDisallow: /' },
]) {
  const cleared = await revisitHomepage(fixture);
  assert.equal(cleared.deals.length, 0, JSON.stringify(fixture));
  assert.equal(cleared.report.homepageCandidatesThisRun, 0);
  assert.ok(!cleared.files['reviews/vienna-merchant-website-state.json'][homeUrl].homepageDeals?.length,
    'empty, refused or foreign pages cannot refresh the old homepage offer');
}
const powerPausedHome = await revisitHomepage({ powerReport: { sources: [{ url: homeUrl,
  cooldown: { reason: 'access-denied', nextRetryAt: '2027-01-01T00:00:00Z' } }] } });
assert.equal(powerPausedHome.requests.length, 0, 'the homepage must respect the active Power host pause');
const ambiguousHome = await revisitHomepage({ body: '<h2>20 % Rabatt auf Pizza</h2><p>In Wien bis 30.12.2026.</p>',
  directoryMerchants: [homeMerchant, { ...homeMerchant, name: 'Different Mall Restaurant' }] });
assert.equal(ambiguousHome.deals.length, 0, 'a shared domain does not establish which restaurant offers the benefit');

// Real examples from the merchant outbox, checked at intake and on cache replay.
const offerTask = { url: homeUrl + 'angebote', merchant: homeMerchant };
const merchantRows = text => extractMerchantOfferCandidates('<article><p>' + text + '</p></article>', offerTask, homeNow);
for (const text of [
  'Zu eurem Kaffee oder Kuchen gibt es bei uns immer ein fröhliches Lächeln und ein paar nette Worte gratis dazu!',
  'Von Hand gemacht. Von Herzen geschenkt. Honiglebkuchen und Schokolade aus unserem Familienbetrieb.',
  'Bis zu 15 % Rabatt, Early Check-in und Late Check-out. Im Café & Restaurant gibt es Kaffee.',
  'Burger für 12 Euro. Kostenloser Newsletter und aktuelle Angebote per E-Mail.',
  'Gratis WLAN beim Kauf von Kaffee und Croissants.',
  'Der zweite Kaffee ist nicht gratis, auch beim Kauf von Mehlspeisen.',
]) {
  assert.equal(merchantRows(text).length, 0, text);
  const cached = { ...homeDeals[0], title: text, description: text,
    evidence: { ...homeDeals[0].evidence, textSample: text } };
  assert.equal(isMerchantWebsiteReview(cached, homeNow), false, text);
  assert.equal(currentMerchantCandidates({ old: { status: 'ok', checkedAt: homeNow.toISOString(),
    deals: [cached] } }, homeNow).length, 0, text);
}
const omnom = 'Genieße eine besondere Aktion im Restaurant: Bei jeder Bestellung eines Burgers oder einer Bowl zusammen mit einer Beilage gibt es ein 0,3l Omnom Lager oder eine 0,3l Kräuterlimonade gratis dazu.';
const omnomRows = merchantRows(omnom);
assert.equal(omnomRows.length, 1);
assert.doesNotMatch(omnomRows[0].title, /Details ansehen/);
assert.match(omnomRows[0].title, /Beilage.*Kräuterlimonade gratis/);
assert.equal(omnomRows[0].evidence.textSample, omnom);
assert.equal(merchantRows('Jeden Sonntag gibt es unser Kindermenü für nur 5,90 statt 10,90.').length, 1);
assert.equal(FOOD_PRODUCT.test('Winter Specials Coladas'), false);
assert.equal(FOOD_PRODUCT.test('0,33 l Cola'), true);
assert.equal(merchantRows('Jede Pizza/Pasta NUR € 9,50 + 0,33L Dose Cola GRATIS').length, 1);

const sweetsUrl = 'https://viennasweets.com/de/offers';
const sweetsTask = curatedMerchantTask(sweetsUrl);
assert.equal(curatedMerchantTask(sweetsUrl + '?other'), null);
assert.equal(curatedMerchantTask(sweetsUrl.replace('viennasweets.com', 'other.example')), null);
const sweetsPage = '<main><section class="v_intro"><span class="v_eyebrow">Aktuelle Angebote</span></section>' +
  '<section class="v_offers"><article><span>3+1</span><h2>3+1 Gratis Aktion</h2><p>Gönnen Sie sich eine Auszeit im Herzen von Wien!</p>' +
  '<p>Genießen Sie handgemachte Mozartkugeln, Trüffel, karamellisierte Mandeln, fruchtige Gelees und Salzkaramell — und erhalten Sie 3+1 GRATIS auf ausgewählte Produkte.</p>' +
  '<p>* Nur solange der Vorrat reicht!</p></article><ul><li><h2>Kostenlose Verkostung täglich</h2><p>Kostenlose Verkostungen täglich</p>' +
  '<p>Entdecken Sie österreichische Süßwaren, Schokoladen und Geschenke – und genießen Sie kostenlose Kostproben bei Ihrem Besuch in unserem Geschäft.</p></li></ul></section>' +
  '<section><h2>Unser Geschäft am Neuer Markt</h2></section></main><footer><address>Neuer Markt 8a, 1010 Wien</address></footer>';
const sweetsOffers = extractMerchantOfferCandidates(sweetsPage, sweetsTask, homeNow);
assert.equal(sweetsOffers.length, 2, 'independent tasting and conditional purchase');
assert.equal(sweetsOffers[0].title, '3+1 gratis auf ausgewählte Süßwaren');
assert.match(sweetsOffers[0].description, /ausgewählte Produkte.*solange der Vorrat reicht/);
assert.deepEqual(sweetsOffers.map(o => [o.type, o.evidence.contentHash]), [
  ['bogo', '5b474e48aca956cecff534fdc0c03c6d96d67195ab2a970e3d3bee8eb5946de0'],
  ['gratis', '3ad9e85f81c65081761bc2530481cace39936d737e7687d1361a5e3a9b0445eb'],
]);
assert.ok(sweetsOffers.every(o => o.address === 'Neuer Markt 8a, 1010 Wien' && o.evidence.locationEvidenceUrl === sweetsUrl
  && o.evidence.sourceUrl === sweetsUrl && !o.validUntil && o.reviewRequired && isMerchantWebsiteReview(o, homeNow)));
for (const [before, after, count] of [
  ['<article>', '<article hidden>', 1], ['<article>', '<article style="display: none">', 1],
  ['<li>', '<li aria-hidden="true">', 1], ['<li>', '<li class="expired">', 1],
  ['3+1 Gratis Aktion', '3+1 Gratis Aktion – vergriffen', 1],
  ['3+1 Gratis Aktion', '3+1 Gratis Aktion bis 01.11.2026', 1],
  ['class="v_offers"', 'class="v_offers" hidden', 0], ['Aktuelle Angebote', 'Archiv', 0],
  ['<article>', '<p>Derzeit keine aktuellen Angebote</p><article>', 0],
  ['<main>', '<main><p>Die Aktion wurde abgesagt.</p>', 0],
  ['Neuer Markt 8a, 1010 Wien', 'Anderer Standort in Wien', 0],
]) assert.equal(extractMerchantOfferCandidates(sweetsPage.replace(before, after), sweetsTask, homeNow).length, count, after);
assert.equal(extractMerchantOfferCandidates(sweetsPage, { ...sweetsTask, url: 'https://viennasweets.com/de/andere-angebote' }, homeNow).length, 0);
const curatedFiles = { 'reviews/vienna-merchant-directory.json': { generatedAt: homeNow.toISOString(), merchants: [{...homeMerchant, website: ''}] } };
async function runCurated() {
  const requests = [];
  const report = await runDiscovery({ now: homeNow, read: (f, fallback) => curatedFiles[f] || fallback, save: (f,v) => { curatedFiles[f] = v; },
    wait: async () => {}, log: () => {}, fetchImpl: async () => { throw new Error('Unexpected Overpass request'); },
    fetchPage: async (url, _hops, origin) => {
      requests.push(url);
      if (url.endsWith('/robots.txt')) return { status: 200, body: 'User-agent: *\nAllow: /', headers: {} };
      assert.equal(origin, 'https://viennasweets.com');
      return { url, status: 200, body: sweetsPage, headers: { 'content-type': 'text/html' } };
    } });
  return {requests, report};
}
const firstCurated = await runCurated();
assert.deepEqual(firstCurated.requests, ['https://viennasweets.com/robots.txt', sweetsUrl]);
assert.equal(firstCurated.report.totalPageSlotsUsed, 1);
assert.equal(firstCurated.report.offerPageCandidatesThisRun, 2);
assert.equal((await runCurated()).requests.length, 0, 'honour existing seven-day cooldown and reuse unchanged cards');
delete curatedFiles['reviews/vienna-merchant-offer-state.json'][sweetsUrl];
curatedFiles['reviews/vienna-merchant-website-state.json'] = { [sweetsTask.merchant.website]: {
  status: 'deferred', httpStatus: 429, checkedAt: homeNow.toISOString() } };
assert.equal((await runCurated()).requests.length, 0, 'curated pages honour host restrictions');
console.log('Vienna merchant discovery: directory safety, product evidence, legacy replay and curated offer checks passed');

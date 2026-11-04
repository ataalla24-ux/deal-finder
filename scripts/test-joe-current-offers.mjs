import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { collectOmvPromotions, parseOmvPromotion, discoverOmvPromotionLinks, omvPromotionUrl, retainActiveOmvPromotions } from '../scraper/omv-promotion-discovery.js';
import { assessJoeAuthPage } from '../scraper/joe-auth-health.js';
import { extractLoggedInJoeBenefitsPage, runJoeScraper } from '../scraper/joe-scraper.js';
import { normalizeDeal, filterDuplicateDealsInRun, buildSlackMessage, addSeenDealsFromThread, filterRecentlySeenDeals, filterAlreadyQueuedDeals, loadQueuedDealDuplicateKeys, loadLiveDealDuplicateKeys } from '../scraper/slack-notify.js';
import { dedupeApprovedDeals } from '../scraper/slack-approve.js';
import { extractDealsFromThreadMessages } from '../scraper/slack-digest-utils.js';
import { officialOmvVariantKey } from '../scraper/deal-evidence-utils.js';
import { normalizeDealRecord } from '../scraper/deal-normalization-utils.js';
import { validateDealsForSlack } from '../scraper/deal-validity-agent.js';

const now = new Date('2026-11-04T17:00:00Z');
const url = 'https://presse.ikp.at/news-omv-viva-winterkaffee?id=251130&menueid=33632&l=deutsch';
// Minimal source-shaped fixture; product names and period are source facts.
const html = '<h1>OMV VIVA: Neue Winterdrinks</h1><time datetime="2026-11-02"></time><div class="detail text-long">'
  + '<p>Entdecke <strong>Cherry Cream Latte,</strong>, <strong>Ube Coconut Latte</strong> und <strong>Double Caramel Latte</strong>.</p>'
  + '<p>Mit der jö App können jö-Mitglieder von 2. November 2026 bis 31. Jänner 2027 alle drei Winterdrinks je einmal gratis testen.</p></div>';

test('independently redeemable drinks produce three complete cards through send and approval dedupe', async () => {
  const parsed = parseOmvPromotion(html, url, now);
  assert.equal(parsed.deals.length, 3);
  const deal = parsed.deals[0];
  assert.equal(deal.validFrom, '2026-11-02');
  assert.equal(deal.validUntil, '2027-01-31');
  assert.equal(deal.sourcePublishedAt, '2026-11-02T00:00:00.000Z');
  assert.equal(deal.promotionProducts.length, 1);
  assert.equal(deal.promotionCampaignProducts.length, 3);
  assert.match(deal.description, /jö-Mitglieder.*je einmal gratis/);
  assert.match(deal.description, /Station.*App prüfen/);
  const normalized = normalizeDeal(deal, 'joe');
  const checked = await validateDealsForSlack([normalized], { now, inspectDealUrlHealth: async () => ({ ok: true, status: 200, contentHints: {}, dateHints: {} }) });
  assert.equal(checked.allowedDeals.length, 1, JSON.stringify(checked.report));
  const stillActive = await validateDealsForSlack([normalized], { now: new Date('2026-11-20T12:00:00Z'), inspectDealUrlHealth: async () => ({ ok: true, status: 200, contentHints: {}, dateHints: {} }) });
  assert.equal(stillActive.allowedDeals.length, 1, 'explicit active validity survives the ordinary seven-day freshness window');
  assert.equal(filterDuplicateDealsInRun([normalized, normalized]).deals.length, 1);
  assert.match(buildSlackMessage(normalized, 1), /Cherry Cream Latte/);
  const variants = parsed.deals.map(d => normalizeDeal(d, 'joe'));
  assert.equal(new Set(variants.map(d => d.id)).size, 3);
  assert.equal(new Set(variants.map(d => d.url)).size, 1, 'real source URL is not faked with fragments');
  for (const variant of variants) {
    assert(variant.title.includes(variant.promotionProducts[0]));
    assert(normalizeDealRecord(variant).title.includes(variant.promotionProducts[0]), 'public feed normalization preserves the named product');
  }
  assert.equal(filterDuplicateDealsInRun([...variants, ...variants]).deals.length, 3);
  const merchantCopies = variants.map(d => ({ ...d, id: d.id.replace('5044fa7c7e98', '000000000000'), url: 'https://www.omv.at/de/viva/viva-kaffee' }));
  assert.equal(filterDuplicateDealsInRun([...variants, ...merchantCopies]).deals.length, 3, 'the same products repeated on two official pages must not make six cards');
  assert.equal(dedupeApprovedDeals([...variants, ...variants]).length, 3);
  const allChecked = await validateDealsForSlack(variants, { now, inspectDealUrlHealth: async () => ({ ok: true, status: 200, contentHints: {}, dateHints: {} }) });
  assert.equal(allChecked.allowedDeals.length, 3);
  const seen = new Set();
  const roundTrip = extractDealsFromThreadMessages([{ ts: '100.001', text: buildSlackMessage(variants[0], 1) }]);
  addSeenDealsFromThread(seen, roundTrip);
  assert.equal(seen.size, 1);
  assert.equal(filterRecentlySeenDeals(variants, seen).deals.length, 2, 'sending one variety must not suppress its siblings');
  assert.equal(filterAlreadyQueuedDeals(variants, loadQueuedDealDuplicateKeys([{ ...variants[0], slackTs: '100.001' }])).deals.length, 2);
  assert.equal(filterAlreadyQueuedDeals(variants, loadLiveDealDuplicateKeys([variants[0]])).deals.length, 2);
  assert.equal(officialOmvVariantKey({ ...variants[0], url: 'https://evil.test/coffee' }), '');
  assert.equal(filterDuplicateDealsInRun(variants.map((d, i) => ({ ...d, id: `ordinary-coffee-${i}` }))).deals.length, 1, 'ordinary same-campaign coffee duplicates remain suppressed');
});

test('a choice of one drink does not become three independently redeemable offers', () => {
  const choice = html.replace('alle drei Winterdrinks je einmal gratis', 'einen der drei Winterdrinks einmal gratis');
  const result = parseOmvPromotion(choice, url, now);
  assert.equal(result.deals.length, 1);
  assert.equal(officialOmvVariantKey(result.deals[0]), '');
});

test('old campaign years, missing dates, conflicting dates and negated offers fail closed', () => {
  for (const input of [
    html.replaceAll('2026', '2025').replaceAll('2027', '2026'),
    html.replace('von 2. November 2026 bis 31. Jänner 2027', 'ab sofort'),
    html.replace('gratis testen', 'nicht gratis testen'),
    html.replace('je einmal gratis testen.', 'je einmal gratis testen. Nur in Tschechien.'),
    html.replace('</div>', '<p>jö Mitglieder erhalten bis 20. Dezember 2026 gratis Kaffee.</p></div>'),
  ]) assert.equal(parseOmvPromotion(input, url, now).deals.length, 0);
  assert.equal(parseOmvPromotion(html, url, new Date('2027-02-01T10:00:00Z')).deals.length, 0);
});

test('future campaigns derive new products and years without a fixed seasonal list', () => {
  const later = html.replaceAll('2026', '2027')
    .replace('31. Jänner 2027', '31. Jänner 2028').replaceAll('Cherry Cream Latte', 'Hazelnut Spice Latte');
  const next = parseOmvPromotion(later, url.replace('251130', '999999'), new Date('2027-11-03T12:00:00Z')).deals[0];
  assert.equal(next.validUntil, '2028-01-31');
  assert(next.promotionProducts.includes('Hazelnut Spice Latte'));
  assert.notEqual(next.id, parseOmvPromotion(html, url, now).deals[0].id);
  const futureStart = html.replace('2. November 2026', '20. Dezember 2026');
  assert.equal(parseOmvPromotion(futureStart, url, now).deals[0].validFrom, '2026-12-20');
});

test('only the OMV issuer section and allowed merchant paths are followed', () => {
  const links = `<a href="${url}">Kaffee</a><a href="${url}&imageid=1">Bild</a><a href="https://evil.test/omv-kaffee">Gratis Kaffee</a><a href="https://presse.ikp.at/news-other-coffee?id=1&menueid=2182">VIVA</a>`;
  assert.deepEqual(discoverOmvPromotionLinks(links, 'https://presse.ikp.at/News.aspx?menueid=33632'), [url]);
  for (const bad of ['http://www.omv.at/de/viva/viva-kaffee', 'https://www.omv.at.evil.test/de/viva/viva-kaffee', 'https://user:secret@www.omv.at/de/viva/viva-kaffee', 'https://www.omv.at/de/free-coffee-sk']) assert.equal(omvPromotionUrl(bad), '');
});

test('bounded discovery finds a new article from the issuer listing and stops denied hosts', async () => {
  const calls = [];
  const fetchImpl = async value => { calls.push(value); return new URL(value).hostname === 'www.omv.at' ? new Response('', { status: 403, headers: { 'retry-after': '172800' } }) : new Response(value.includes('/News.aspx') ? `<a href="${url}">OMV VIVA Kaffee</a>` : html); };
  const first = await collectOmvPromotions({ fetchImpl, now });
  assert.equal(first.deals.length, 3);
  assert.equal(calls.filter(u => new URL(u).hostname === 'www.omv.at').length, 1);
  assert.equal(first.report.pausesByHost['www.omv.at'].nextRetryAt, '2026-11-06T17:00:00.000Z');
  calls.length = 0;
  await collectOmvPromotions({ fetchImpl, now: new Date('2026-11-05T17:00:00Z'), previous: first.report });
  assert.equal(calls.filter(u => new URL(u).hostname === 'www.omv.at').length, 0);
});

test('hostile redirects and page budgets never trigger outside requests', async () => {
  let calls = 0;
  const result = await collectOmvPromotions({ now, maxRequests: 2, fetchImpl: async () => { calls++; return new Response('', { status: 302, headers: { location: 'https://evil.test/coffee' } }); } });
  assert.equal(calls, 2);
  assert.equal(result.deals.length, 0);
  assert(result.report.pages.every(p => p.error === 'untrusted-or-excessive-redirect'));
  calls = 0;
  const paused = await collectOmvPromotions({ now, previous: { pausesByHost: { 'www.omv.at': { nextRetryAt: '2026-11-06T17:00:00Z' } } }, fetchImpl: async value => {
    calls++;
    assert.equal(new URL(value).hostname, 'presse.ikp.at');
    return new Response('', { status: 302, headers: { location: 'https://www.omv.at/de/viva/viva-kaffee' } });
  } });
  assert.equal(calls, 1, 'redirect cannot bypass the target host cooldown');
  assert(paused.report.pages.some(p => p.error === 'redirect-target-host-paused'));
});

test('last-good campaigns keep original dates during failures; expired and invented old rows do not return', () => {
  const deal = parseOmvPromotion(html, url, now).deals[0];
  const snapshot = structuredClone(deal);
  assert.deepEqual(retainActiveOmvPromotions([], [deal], now), [snapshot]);
  assert.equal(retainActiveOmvPromotions([], [{ ...deal, id: 'joe-omv-viva-free-taste-old' }], now).length, 0);
  assert.equal(retainActiveOmvPromotions([], [deal], new Date('2027-02-01T10:00:00Z')).length, 0);
  assert.deepEqual(deal, snapshot);
  const aggregate = { ...deal, id: deal.promotionCampaignId };
  assert.equal(retainActiveOmvPromotions(parseOmvPromotion(html, url, now).deals, [aggregate], now).length, 3, 'current variants replace the old aggregate outbox row');
});

test('no offers or absence of login text never proves a usable account session', async () => {
  assert.equal(assessJoeAuthPage({ url: 'https://www.joe-club.at/vorteile' }).status, 'unverified-session');
  assert.equal(assessJoeAuthPage({ url: 'https://www.joe-club.at/login', authenticatedControls: true }).status, 'login-required');
  assert.equal(assessJoeAuthPage({ requiresLogin: true }).authenticated, false);
  assert.equal(assessJoeAuthPage({ authenticatedControls: true }).status, 'authenticated-no-readable-offers');
  assert.equal(assessJoeAuthPage({ authenticatedControls: true }, 2).status, 'authenticated-offers-read');
  const result = await extractLoggedInJoeBenefitsPage({ waitForLoadState: async () => {}, waitForTimeout: async () => {}, evaluate: async () => ({ url: 'https://www.joe-club.at/vorteile', bodyText: 'OMV VIVA Kaffee', candidates: [], authenticatedControls: false }) });
  assert.equal(result.deals.length, 0, 'no old summer fallback even when OMV is mentioned');
  assert.equal(result.health.status, 'unverified-session');
});

test('scraper writes visible partial coverage, complete candidate and pipeline report without auth claims', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'joe-omv-test-'));
  try {
    const result = await runJoeScraper({ now, outputDir: dir, sources: [], storageStatePath: path.join(dir, 'absent.json'), browserType: { launch: async () => ({ close: async () => {} }) }, collectPublic: async () => ({ deals: parseOmvPromotion(html, url, now).deals, report: { pages: [{ status: 'ok', url }], rejected: [], requests: 1, pausesByHost: {} } }) });
    assert.equal(result.payload.deals.length, 3);
    assert.equal(result.report.status, 'degraded');
    assert.equal(result.report.authenticatedCoverage.status, 'not-configured');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'deal-pipeline-last-run-joe.json'))).status, 'completed-with-errors');
    execFileSync(process.execPath, ['scraper/build-deal-source-health.js'], { cwd: path.resolve('.'), env: { ...process.env, DEAL_HEALTH_DOCS_DIR: dir, SENTRY_DISABLED: '1' }, stdio: 'pipe' });
    const health = JSON.parse(fs.readFileSync(path.join(dir, 'deal-source-health.json')));
    assert(health.summary.pipelineRuns.completedWithErrors.includes('joe'));
    const source = health.sources.find(s => s.sourceKey === 'joe');
    assert(source.healthScore <= 50);
    assert(source.issues.some(issue => /jö-Zugriff/.test(issue)));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

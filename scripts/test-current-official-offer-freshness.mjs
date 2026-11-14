import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { POWER_FOOD_SOURCES } from '../scraper/power-food-sources.js';
import { extractFoodOffers } from '../scraper/power-food-extraction.js';
import { verifyOfficialFoodDeal } from '../scraper/power-food-verification.js';

process.env.SENTRY_DISABLED = '1';
const { validateDealsForSlack } = await import('../scraper/deal-validity-agent.js');
const now = new Date('2026-11-14T10:35:33.625Z');
const oldDate = '2026-10-20T12:00:00.000Z';
const kfc = POWER_FOOD_SOURCES.find(row => row.name === 'KFC');
const html = readFileSync(new URL('./fixtures/kfc-preiskracher-20261113.html', import.meta.url), 'utf8');
const original = extractFoodOffers(html, kfc, { now, pageUrl: kfc.url }).deals[0];
const dated = deal => ({ ...deal, sourcePublishedAt: oldDate, pubDate: oldDate,
  sourcePublishedAtSource: 'slack.digest-validated-source-date', pubDateSource: 'slack.digest-validated-source-date',
  pipelineLifecycle: { manualDecision: 'approved' } });
const candidate = dated({ ...original, title: 'Crispy Cheese Burger für 1,70 Euro' });
const response = (body = html, finalUrl = kfc.url, status = 200) => ({ html: body, finalUrl, status });
const verify = (deal = candidate, page = response(), extra = {}) => verifyOfficialFoodDeal(deal, {
  now, fetchPage: async () => page, ...extra,
});
const validate = (deal = candidate, page = response(), extra = {}) => validateDealsForSlack([structuredClone(deal)], {
  now, requireVienna: false, inspectDealUrlHealth: async url => ({ status: 200, finalUrl: url, dateHints: {}, contentHints: {} }),
  fetchOfficialFoodPage: async () => page, ...extra,
});
const ageBlocked = result => result.results[0].decision.reasons.some(reason => /älter als/.test(reason));

test('fresh exact current landing page replaces only age evidence and preserves the original date', async () => {
  const proof = await verify();
  assert.deepEqual(proof.currentOfferVerification, { method: 'current-official-landing-page-v1',
    checkedAt: now.toISOString(), sourceUrl: kfc.url, finalUrl: kfc.url, offerId: candidate.id,
    contentHash: candidate.evidence.contentHash });
  const result = await validate();
  assert.equal(ageBlocked(result), false);
  assert.equal(result.allowedDeals.length, 1, JSON.stringify(result.results[0].decision.reasons));
  const row = result.results[0];
  assert.equal(row.decision.sourceDate, oldDate);
  assert.equal(row.deal.sourcePublishedAt, oldDate);
  assert.equal(row.deal.pubDate, oldDate);
  assert.equal(row.deal.evidence.checkedAt, candidate.evidence.checkedAt);
  assert.equal(row.deal.validUntil, undefined);
  assert.equal(row.deal.expires, 'Siehe Originalangebot');
  assert.ok(row.decision.warnings.some(text => /identisches Angebot auf aktueller offizieller Angebotsseite/.test(text)));
  assert.equal((await validate(candidate, response(), { requireVienna: true })).allowedDeals.length, 0,
    'same source excerpt supplies no Vienna participation proof');
});

test('a second registered current landing page works beyond 45 days without inventing expiry', async () => {
  const source = POWER_FOOD_SOURCES.find(row => row.name === 'IKEA Food');
  const body = '<div class="legal__accordion__item__text__fixture"><h2>Kaffeejause</h2><p>Kaffee und Kuchen um 2,90 Euro in Wien.</p></div>';
  const deal = { ...dated(extractFoodOffers(body, source, { now, pageUrl: source.url }).deals[0]),
    sourcePublishedAt: '2026-08-01T12:00:00.000Z', pubDate: '2026-08-01T12:00:00.000Z' };
  const result = await validate(deal, response(body, source.url));
  assert.equal(ageBlocked(result), false);
  assert.equal(result.allowedDeals.length, 1);
  assert.equal(result.results[0].deal.sourcePublishedAt, deal.sourcePublishedAt);
  assert.equal(result.results[0].deal.validUntil, undefined);
});

test('ordinary transport supplies HTTP provenance and one run shares exactly one existing page GET', async () => {
  const previous = globalThis.fetch;
  let reads = 0;
  globalThis.fetch = async (url, init) => { reads++; assert.equal(url, kfc.url); assert.equal(init.redirect, 'manual');
    return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }); };
  try {
    const cache = new Map();
    const first = await verifyOfficialFoodDeal(candidate, { now, cache });
    const second = await verifyOfficialFoodDeal(candidate, { now, cache });
    assert.ok(first.currentOfferVerification);
    assert.deepEqual(second.currentOfferVerification, first.currentOfferVerification);
    assert.equal(reads, 1);
    const later = await verifyOfficialFoodDeal(candidate, { now: new Date(+now + 60000), cache });
    assert.equal(later.currentOfferVerification, undefined, 'a different attempt cannot reuse old transport provenance');
    assert.equal(reads, 1);
  } finally { globalThis.fetch = previous; }
});

test('preloaded captured HTML and forged stored metadata never create fresh transport provenance', async () => {
  const key = `${kfc.name}|${kfc.url}`;
  const cached = { ...response(), checkedAt: now.toISOString(), currentOfferVerification: { checkedAt: now.toISOString() } };
  const cache = new Map([[key, Promise.resolve(cached)]]);
  const proof = await verify(candidate, cached, { cache, fetchPage: async () => { throw Error('No new read permitted'); } });
  assert.equal(proof.ok, true);
  assert.equal(proof.currentOfferVerification, undefined);
  const forged = { ...candidate, currentOfferVerification: { checkedAt: now.toISOString() },
    officialFoodReverifiedAt: now.toISOString(), currentOffers: true, current: true };
  assert.equal(ageBlocked(await validate(forged, { html, finalUrl: kfc.url })), true);
  for (const status of [403, 429, 302, 204]) assert.equal((await verify(forged, response(html, kfc.url, status))).currentOfferVerification, undefined);
  assert.equal(ageBlocked(await validate(forged, response(), { fetchOfficialFoodPage: async () => { throw Error('HTTP 403'); } })), true);
  const previous = globalThis.fetch;
  try {
    for (const status of [403, 429]) {
      let calls = 0;
      globalThis.fetch = async () => { calls++; return new Response('Access refused', { status }); };
      const rejected = await verifyOfficialFoodDeal(forged, { now });
      assert.equal(calls, 1);
      assert.equal(rejected.ok, false);
      assert.equal(rejected.currentOfferVerification, undefined);
    }
  } finally { globalThis.fetch = previous; }
});

test('archive/detail/query URLs and a redirect away from the registered landing page gain no age exception', async () => {
  for (const url of [kfc.url + 'archiv', kfc.url + '?archive=2020', kfc.url + '#old']) {
    const input = dated(extractFoodOffers(html, kfc, { now, pageUrl: url }).deals[0]);
    input.url = url;
    const proof = await verify(input, response(html, url));
    assert.equal(proof.currentOfferVerification, undefined, url);
    assert.equal(ageBlocked(await validate(input, response(html, url))), true, url);
  }
  for (const finalUrl of [kfc.url + 'archiv', 'https://www.kfc.co.at/', 'https://example.com/']) {
    assert.equal((await verify(dated(original), response(html, finalUrl))).currentOfferVerification, undefined, finalUrl);
    assert.equal(ageBlocked(await validate(dated(original), response(html, finalUrl))), true, finalUrl);
  }
});

test('hidden/removed/changed blocks or mismatched IDs cannot be fresh offer evidence', async () => {
  for (const body of [html.replace('<section>', '<section hidden>'), html.replace('<section>', '<section aria-hidden="true">'),
    html.replace('<section>', '<section style="display:none">'), html.replace('<section>', '<section style="visibility:hidden">'),
    '<main></main>', html.replace('1,70 Euro', '2,70 Euro')]) {
    assert.equal((await verify(candidate, response(body))).currentOfferVerification, undefined);
    assert.equal(ageBlocked(await validate(candidate, response(body))), true);
  }
  assert.equal((await verify({ ...dated(original), id: 'power-food-forged' })).currentOfferVerification, undefined);
});

test('calendar expiry, relative one-day terms, date conflicts and future source dates retain their own holds', async () => {
  const expiredBody = html.replace('um 1,70 Euro', 'um 1,70 Euro, gültig bis 13.11.2026');
  const expired = dated(extractFoodOffers(expiredBody, kfc, { now: new Date('2026-11-12'), pageUrl: kfc.url }).deals[0]);
  assert.ok(expired.id);
  assert.equal((await verify(expired, response(expiredBody))).ok, false);
  assert.equal((await validate(expired, response(expiredBody))).allowedDeals.length, 0);
  const relativeBody = html.replace('Unser Preiskracher:', 'Heute Aktion:');
  const relative = dated(extractFoodOffers(relativeBody, kfc, { now, pageUrl: kfc.url }).deals[0]);
  const relativeResult = await validate(relative, response(relativeBody));
  assert.equal(ageBlocked(relativeResult), false);
  assert.ok(relativeResult.results[0].decision.reasons.some(reason => reason.includes('relative Kurz-Aktion abgelaufen')));
  for (const patch of [{ validUntil: '2026-11-01' }, { expires: '2026-11-01' },
    { expiresOriginal: 'Gültig bis 01.11.2026' }, { end_date: '2026-11-01' }, { validUntil: '2030-01-01' },
    { validUntil: '2026-11-14T12:00:00Z' }, { expires: '2026-11-14T12:00:00Z' },
    { evidence: { ...candidate.evidence, offerTiming: { ...candidate.evidence.offerTiming, validUntil: '2026-11-01' } } }]) {
    assert.equal((await verify({ ...candidate, ...patch })).currentOfferVerification, undefined);
    assert.equal(ageBlocked(await validate({ ...candidate, ...patch })), true);
  }
  const future = { ...candidate, sourcePublishedAt: '2026-11-20T12:00:00Z', pubDate: '2026-11-20T12:00:00Z' };
  assert.ok((await validate(future)).results[0].decision.reasons.some(reason => reason.includes('liegt in der Zukunft')));
});

test('social posts and non-current-offer sources keep their previous freshness rules', async () => {
  const social = { ...candidate, id: 'social-old', originSource: 'Meta Graph API', source: 'Instagram',
    url: 'https://www.instagram.com/p/Example/', currentOfferVerification: { checkedAt: now.toISOString() } };
  const result = await validate(social);
  assert.equal(result.allowedDeals.length, 0);
  assert.ok(result.results[0].decision.reasons.some(reason => /älter als|Social-Post-Datum/.test(reason)));
  const source = POWER_FOOD_SOURCES.find(row => row.name === 'Gasthaus Maria');
  const body = '<div id="m3402"><p>Aktion: Kaffee und Kuchen um 2,90 Euro in Wien.</p></div>';
  const deal = dated(extractFoodOffers(body, source, { now, pageUrl: source.url }).deals[0]);
  assert.ok(deal.id);
  assert.equal((await verify(deal, response(body, source.url))).currentOfferVerification, undefined);
  assert.equal(ageBlocked(await validate(deal, response(body, source.url))), true);
});

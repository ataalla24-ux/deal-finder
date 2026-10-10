import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import https from 'node:https';
import dns from 'node:dns/promises';
import { enrichSourceAddresses, inspectSourceAddressPage } from './deal-map-source-addresses.mjs';
import { locationFingerprint } from './deal-map-enrichment.mjs';

// Fixtures must never fall through to a real network transport, including DNS.
const original = { fetch: globalThis.fetch, get: https.get, resolve4: dns.resolve4 };
let networkAttempts = 0;
const noNetwork = () => { networkAttempts++; throw new Error('Live network forbidden in fixture tests'); };
globalThis.fetch = noNetwork;
https.get = noNetwork;
dns.resolve4 = noNetwork;
syncBuiltinESMExports();
after(() => {
  globalThis.fetch = original.fetch;
  https.get = original.get;
  dns.resolve4 = original.resolve4;
  syncBuiltinESMExports();
  assert.equal(networkAttempts, 0);
});

const now = new Date('2026-10-10T10:00:00Z');
const map = { schemaVersion: 1, locations: [] };
const deal = { id: 'cafe-offer', brand: 'Cafe Morgen', title: 'Gratis Kaffee zum Fruehstueck', description: 'Fruehstuecksaktion in Wien',
  distance: 'Wien', url: 'https://cafemorgen.at/angebote/kaffee', validUntil: '2026-10-31' };
const address = { street: 'Wollzeile', number: '29', postalCode: '1010' };
const postal = { '@type': 'PostalAddress', streetAddress: 'Wollzeile 29', postalCode: '1010', addressLocality: 'Wien', addressCountry: 'AT' };
const business = { '@type': 'Restaurant', name: deal.brand, address: postal };
const event = { '@type': 'Event', name: deal.title, url: deal.url, startDate: '2026-10-01', endDate: '2026-10-31', location: business };
const visible = 'Cafe Morgen, Wollzeile 29, 1010 Wien';
const membership = 'Dieses Angebot gilt bei Cafe Morgen, Wollzeile 29, 1010 Wien.';
const script = value => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
function page({ graph = event, text = visible, title = deal.title, extra = '', head = '', region = 'main' } = {}) {
  return `<html><head><title>${title}</title>${head}${graph ? script(graph) : ''}</head><body><${region}><h1>${title}</h1><p>${text}</p>${extra}</${region}></body></html>`;
}
const inspect = (options = {}, target = deal) => inspectSourceAddressPage({ deal: target, html: page(options), now });
const row = result => result.report.deals[0];
const cacheEntry = result => Object.values(result.cache)[0];
function fixtures({ target = deal, html = page(), robots = 'User-agent: *\nAllow: /', robotsStatus = 200,
  pageStatus = 200, contentType = 'text/html; charset=utf-8', error = '', finalUrl, robotsFinalUrl } = {}) {
  const calls = [];
  const robotsUrl = new URL('/robots.txt', target.url).href;
  return { calls, fetchPage: async (url, hops) => {
    calls.push({ url, hops });
    assert.equal(hops, 3, 'The shared pinned-DNS helper must refuse redirect targets');
    assert.ok([robotsUrl, target.url].includes(url), `Unexpected fixture request: ${url}`);
    if (error) throw new Error(error);
    const isRobots = url === robotsUrl;
    return { status: isRobots ? robotsStatus : pageStatus,
      headers: { 'content-type': isRobots ? 'text/plain' : contentType },
      url: (isRobots ? robotsFinalUrl : finalUrl) || url, body: isRobots ? robots : html };
  } };
}
const run = (fixture, options = {}) => enrichSourceAddresses({ deals: [deal], map, now, fetchPage: fixture.fetchPage, ...options });
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

test('Event.location gives one explicit, visible, exact-brand Vienna address', async () => {
  const result = await inspect();
  assert.equal(result.outcome, 'positive');
  assert.equal(result.evidenceKind, 'jsonld-event-location');
  assert.deepEqual(result.locations, [{ ...address, validFrom: '2026-10-01', validUntil: '2026-10-31' }]);
  const linked = { '@graph': [{ ...event, location: { '@id': '#venue' } }, { ...business, '@id': '#venue', address: { '@id': '#address' } }, { ...postal, '@id': '#address' }] };
  assert.equal((await inspect({ graph: linked })).outcome, 'positive');
  assert.equal((await inspect({ graph: { ...event, '@type': 'https://schema.org/Event' } })).outcome, 'positive');
});

test('LocalBusiness requires an explicit offer-membership sentence, not generic contact details', async () => {
  assert.equal((await inspect({ graph: business })).reason, 'membership-unproven');
  assert.equal((await inspect({ graph: business, text: membership })).outcome, 'positive');
  assert.equal((await inspect({ graph: { ...business, '@type': 'LocalBusiness' }, text: membership })).evidenceKind, 'jsonld-business-explicit-offer');
  assert.equal((await inspect({ graph: { ...business, '@type': 'Organization' }, text: membership })).outcome, 'negative');
  assert.equal((await inspect({ graph: null, text: membership })).reason, 'membership-unproven');
});

test('Footer, hidden or unrelated addresses cannot establish offer membership', async () => {
  for (const extra of [`<footer><p>${visible}</p></footer>`, `<aside>${visible}</aside>`, `<div hidden>${visible}</div>`,
    `<div class="site-footer">${visible}</div>`, `<div style="display:none">${visible}</div>`]) {
    assert.equal((await inspect({ text: 'Cafe Morgen', extra })).outcome, 'negative');
  }
  assert.equal((await inspect({ extra: '<footer>Zentrale: Hauptstrasse 15, 8010 Graz</footer>' })).outcome, 'positive');
  assert.equal((await inspect({ title: 'Unsere Filiale in Wien' })).reason, 'offer-heading-mismatch');
  assert.equal((await inspect({ region: 'div' })).reason, 'missing-offer-region');
  assert.equal((await inspect({ extra: `<h2>${deal.title}</h2>` })).reason, 'offer-heading-mismatch');
  assert.equal((await inspect({ text: 'Other Cafe, Wollzeile 29, 1010 Wien' })).reason, 'brand-not-corroborated');
});

test('Exact brand, structured offer identity and page relation are mandatory', async () => {
  for (const graph of [
    { ...event, location: { ...business, name: 'Cafe Morgen GmbH' } },
    { ...event, location: { ...business, name: 'Cafe Abend' } },
    { ...event, name: 'Andere Aktion' },
    { ...event, url: 'https://cafemorgen.at/' },
    { ...event, mainEntityOfPage: 'https://cafemorgen.at/anderes-angebot' },
    { ...event, eventStatus: 'https://schema.org/EventCancelled' },
    { ...event, eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode' },
    { ...event, location: [business] },
  ]) assert.equal((await inspect({ graph })).outcome, 'negative');
  assert.equal((await inspect({ head: '<link rel="canonical" href="https://cafemorgen.at/">' })).reason, 'canonical-source-mismatch');
});

test('Conflicting branches, exclusions and ambiguous dates never select a convenient branch', async () => {
  for (const text of [`${visible}. Auch am Graben 10, 1010 Wien.`, `${visible}. In allen Filialen.`,
    `${visible}. Ausgenommen dieses Angebot.`, `${visible}. Nur online.`, `${visible}. Wollzeile 29, 1020 Wien.`]) {
    assert.equal((await inspect({ text })).outcome, 'negative');
  }
  const second = { ...business, address: { ...postal, streetAddress: 'Graben 10' } };
  assert.equal((await inspect({ graph: [event, second] })).reason, 'multiple-structured-addresses');
  assert.equal((await inspect({ graph: [event, { ...event, endDate: '2026-10-30' }] })).reason, 'multiple-offer-proofs');
});

test('A full single house, Vienna locality and district postcode must agree with visible content', async () => {
  for (const change of [{ streetAddress: 'Wollzeile' }, { streetAddress: 'Wollzeile 29-31' }, { streetAddress: 'Wollzeile 29/1' },
    { streetAddress: 'Postfach 29' }, { streetAddress: 'Wollzeile 30' }, { postalCode: '1011' }, { postalCode: '1240' },
    { postalCode: '' }, { addressLocality: 'Graz' }, { addressLocality: '' }, { addressCountry: 'DE' }]) {
    assert.equal((await inspect({ graph: { ...event, location: { ...business, address: { ...postal, ...change } } } })).outcome, 'negative', JSON.stringify(change));
  }
  assert.equal((await inspect({ text: 'Cafe Morgen, Wollzeile 29' })).outcome, 'negative');
  assert.equal((await inspect({ text: 'Cafe Morgen, Wollzeile 29, 8010 Graz' })).outcome, 'negative');
});

test('Expired, future and invalid source validity is rejected, including time-of-day expiry', async () => {
  for (const change of [{ endDate: '2026-10-09' }, { endDate: '2026-10-10T09:00:00Z' }, { startDate: '2026-10-11' },
    { startDate: '2026-02-31' }, { startDate: 20261010 }, { endDate: 'tomorrow' }, { endDate: undefined }]) {
    assert.equal((await inspect({ graph: { ...event, ...change } })).outcome, 'negative', JSON.stringify(change));
  }
});

test('Malformed and restricted pages produce no accepted evidence', async () => {
  assert.equal((await inspect({ extra: '<input type="password">' })).reason, 'restricted-page');
  assert.equal((await inspect({ head: '<title>Access denied</title>' })).reason, 'restricted-page');
  assert.equal((await inspect({ head: '<script type="application/ld+json">{broken</script>' })).reason, 'invalid-structured-data');
  assert.equal((await inspect({ graph: { '@graph': [{ ...event, '@id': '#event' }, { ...event, '@id': '#event', name: 'Different' }] } })).reason, 'invalid-structured-data');
  assert.equal((await inspectSourceAddressPage({ deal, html: 'x'.repeat(2500001), now })).reason, 'invalid-html');
});

test('Only needs-review/missing-exact-address deals fetch; manual reviews and optional catalog take priority', async () => {
  const location = { id: 'known', name: 'Cafe Morgen Zentrum', address: 'Wollzeile 29, 1010 Wien', latitude: 48.208, longitude: 16.378,
    confidence: 1, source: 'fixture', dealIds: [deal.id] };
  const scenarios = [
    { map: { locations: [location] } },
    { deals: [{ ...deal, address: 'Wollzeile 29, 1010 Wien' }] },
    { deals: [{ ...deal, distance: 'Online' }] },
    { deals: [{ ...deal, description: 'Nur Graben 10 und Wollzeile 29, 1010 Wien' }] },
    { reviewed: { [deal.id]: { evidenceUrl: 'manual', locations: [{ ...address, validUntil: '2026-10-09' }] } } },
    { reviewed: { [deal.id]: { evidenceUrl: 'manual', locations: [address] } } },
    { catalog: { locations: [location] }, deals: [{ ...deal, distance: 'Cafe Morgen Zentrum, Wien' }] },
  ];
  for (const scenario of scenarios) {
    const fixture = fixtures();
    const result = await run(fixture, scenario);
    assert.equal(result.requests, 0);
    assert.equal(fixture.calls.length, 0);
    if (scenario.reviewed) assert.deepEqual(result.reviewed, scenario.reviewed);
  }
});

test('Unsafe, authenticated, social, aggregator and non-original URLs never reach the transport', async () => {
  const urls = ['http://cafemorgen.at/offer', 'file:///etc/passwd', '//cafemorgen.at/offer', 'https://user:password@cafemorgen.at/offer',
    'https://cafemorgen.at:8443/offer', 'https://127.0.0.1/offer', 'https://0x7f000001/offer', 'https://[::1]/offer', 'https://localhost/offer',
    'https://cafe.local/offer', 'https://cafe.internal/offer', 'https://cafemorgen.at./offer', 'https://cafemorgen.at/login',
    'https://cafemorgen.at/%6cogin/offer', 'https://cafemorgen.at/login.php', 'https://cafemorgen.at/sign_in',
    'https://cafemorgen.at/%5clogin', 'https://cafemorgen.at/account/offer', 'https://cafemorgen.at/offer?token=private',
    'https://cafemorgen.at/impressum', 'https://www.instagram.com/p/offer', 'https://www.facebook.com/offer', 'https://www.tiktok.com/offer',
    'https://www.gutscheine.at/offer', 'https://marktguru.at/offer', 'https://thefork.at/offer', 'https://www.tripadvisor.at/offer',
    'https://bit.ly/offer', 'https://linktr.ee/cafemorgen'];
  for (const url of urls) {
    const fixture = fixtures();
    const result = await run(fixture, { deals: [{ ...deal, url }] });
    assert.equal(result.requests, 0, url);
    assert.equal(fixture.calls.length, 0, url);
  }
  const fixture = fixtures();
  assert.equal(row(await run(fixture, { deals: [{ ...deal, originalUrl: 'https://www.instagram.com/p/original' }] })).reason, 'original-source-mismatch');
  assert.equal(fixture.calls.length, 0);
});

test('Positive evidence is in-memory, immutable and cache-only reusable for seven days', async () => {
  const fixture = fixtures();
  const inputs = freeze({ deals: [structuredClone(deal)], map: structuredClone(map), reviewed: { manual: { locations: [address] } }, cache: {} });
  const before = JSON.stringify(inputs);
  const first = await enrichSourceAddresses({ ...inputs, now, fetchPage: fixture.fetchPage });
  assert.equal(first.requests, 2);
  assert.equal(row(first).status, 'address-ready');
  assert.equal(first.reviewed[deal.id].fingerprint, locationFingerprint(deal));
  assert.equal(first.reviewed[deal.id].evidenceUrl, deal.url);
  assert.match(first.reviewed[deal.id].contentFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(inputs), before);
  assert.deepEqual(first.reviewed.manual, inputs.reviewed.manual);
  const cached = await run(fixture, { cache: first.cache, reviewed: first.reviewed, maxRequests: 0, now: new Date('2026-10-17T09:59:59Z') });
  assert.equal(cached.requests, 0);
  assert.equal(row(cached).cacheHit, true);
  assert.deepEqual(cached.reviewed[deal.id], first.reviewed[deal.id]);
  const expired = await run(fixture, { cache: first.cache, reviewed: first.reviewed, maxRequests: 0, now: new Date('2026-10-17T10:00:00Z') });
  assert.equal(expired.reviewed[deal.id], undefined);
  assert.equal(row(expired).reason, 'request-budget');
  assert.equal(fixture.calls.length, 2);
});

test('Every relevant deal edit invalidates cached evidence even with zero budget and former auto-reviewed output', async () => {
  const fixture = fixtures();
  const first = await run(fixture);
  for (const change of [{ title: 'Zwei Kaffee zum Fruehstueck' }, { brand: 'Cafe Abend' }, { description: 'Geaendertes Angebot in Wien' },
    { distance: 'Vienna' }, { url: 'https://cafemorgen.at/angebote/neues' }, { validUntil: '2026-10-30' },
    { expires: '2026-10-20' }, { validFrom: '2026-10-02' }, { metaGraphCaption: 'Anderes Angebot' }]) {
    const result = await run(fixture, { deals: [{ ...deal, ...change }], reviewed: first.reviewed, cache: first.cache, maxRequests: 0 });
    assert.equal(result.reviewed[deal.id], undefined, JSON.stringify(change));
    assert.equal(row(result).cacheHit, false, JSON.stringify(change));
    assert.equal(result.requests, 0);
  }
  assert.equal(fixture.calls.length, 2);
});

test('Evidence expiry takes precedence over seven-day positive TTL, including exact Event end times', async () => {
  const fixture = fixtures({ html: page({ graph: { ...event, endDate: '2026-10-10T10:30:00Z' } }) });
  const first = await run(fixture);
  assert.equal(row(first).status, 'address-ready');
  const result = await run(fixture, { cache: first.cache, reviewed: first.reviewed, maxRequests: 0, now: new Date('2026-10-10T10:30:00Z') });
  assert.equal(result.reviewed[deal.id], undefined);
  assert.equal(row(result).cacheHit, false);
  const dateFixture = fixtures({ html: page({ graph: { ...event, endDate: '2026-10-10' } }) });
  const daily = await run(dateFixture);
  const tomorrow = await run(dateFixture, { cache: daily.cache, maxRequests: 0, now: new Date('2026-10-10T22:00:00Z') });
  assert.equal(tomorrow.reviewed[deal.id], undefined, 'Vienna date, not UTC date, governs end-of-day expiry');
});

test('Negative cache lasts one day; transient errors last fifteen minutes', async () => {
  const negative = fixtures({ html: page({ graph: null }) });
  const first = await run(negative);
  assert.equal(row(first).status, 'candidates-only');
  assert.equal(first.reviewed[deal.id], undefined);
  assert.equal(row(await run(negative, { cache: first.cache, maxRequests: 0, now: new Date('2026-10-11T09:59:59Z') })).cacheHit, true);
  assert.equal(row(await run(negative, { cache: first.cache, maxRequests: 0, now: new Date('2026-10-11T10:00:00Z') })).cacheHit, false);
  const outage = fixtures({ error: 'DNS timeout with private diagnostic details' });
  const failed = await run(outage);
  assert.equal(cacheEntry(failed).outcome, 'error');
  assert.equal(row(failed).reason, 'source-fetch-error');
  assert.equal(row(await run(outage, { cache: failed.cache, maxRequests: 0, now: new Date('2026-10-10T10:14:59Z') })).cacheHit, true);
  assert.equal(row(await run(outage, { cache: failed.cache, maxRequests: 0, now: new Date('2026-10-10T10:15:00Z') })).cacheHit, false);
  assert.equal(outage.calls.length, 1);
});

test('An outage or changed HTML never resurrects stale positive evidence', async () => {
  const first = await run(fixtures());
  const old = structuredClone(first.cache);
  Object.values(old)[0].checkedAt = '2026-10-01T10:00:00Z';
  const failed = await run(fixtures({ error: 'offline' }), { cache: old, reviewed: first.reviewed });
  assert.equal(failed.reviewed[deal.id], undefined);
  assert.equal(cacheEntry(failed).outcome, 'error');
  const replacement = await run(fixtures({ html: page({ graph: null }) }), { cache: old });
  assert.equal(replacement.reviewed[deal.id], undefined);
  assert.notEqual(cacheEntry(replacement).contentFingerprint, cacheEntry(first).contentFingerprint);
  assert.equal(cacheEntry(first).outcome, 'positive', 'Input cache must remain unchanged');
});

test('Hourly budget-eight cycles reach later healthy sources despite persistent failures and intervening cache-only runs', async () => {
  const deals = freeze(Array.from({ length: 8 }, (_, index) => ({ ...deal, id: `source-${index}`,
    url: `https://merchant${index}.at/angebote/kaffee` })));
  const before = JSON.stringify(deals);
  const origins = new Map(deals.map((target, index) => [new URL(target.url).origin,
    fixtures({ target, pageStatus: index < 4 ? 500 : 200, html: page({ graph: { ...event, url: target.url } }) })]));
  const calls = [];
  const fetchPage = async (url, hops) => {
    calls.push(url);
    const fixture = origins.get(new URL(url).origin);
    assert.ok(fixture, `Unexpected origin: ${url}`);
    return fixture.fetchPage(url, hops);
  };
  const cycle = options => enrichSourceAddresses({ deals, map, now, maxRequests: 8, fetchPage, ...options });
  const first = await cycle();
  assert.equal(first.requests, 8);
  assert.deepEqual(calls.filter(url => !url.endsWith('/robots.txt')), deals.slice(0, 4).map(target => target.url));
  assert.deepEqual(first.report.deals.slice(0, 4).map(item => item.reason), Array(4).fill('source-http-error'));
  assert.deepEqual(first.report.deals.slice(4).map(item => item.reason), Array(4).fill('request-budget'));

  const nextHour = new Date('2026-10-10T11:00:00Z');
  const inputCache = freeze(structuredClone(first.cache));
  const cacheOnly = await cycle({ cache: inputCache, maxRequests: 0, now: nextHour });
  assert.equal(cacheOnly.requests, 0);
  assert.deepEqual(cacheOnly.reviewed, {});
  assert.equal(Object.values(cacheOnly.cache).length, 4);
  for (const entry of Object.values(cacheOnly.cache)) {
    assert.deepEqual(Object.keys(entry).sort(), ['lastAttemptAt', 'sourceUrl']);
    assert.equal(entry.lastAttemptAt, now.toISOString());
  }
  assert.deepEqual(inputCache, first.cache);
  calls.length = 0;
  const second = await cycle({ cache: cacheOnly.cache, now: nextHour });
  assert.equal(second.requests, 8);
  assert.deepEqual(calls.filter(url => !url.endsWith('/robots.txt')), deals.slice(4).map(target => target.url));
  assert.deepEqual(Object.keys(second.reviewed).sort(), deals.slice(4).map(target => target.id));
  assert.equal(second.report.enrichedDeals, 4);

  calls.length = 0;
  const third = await cycle({ cache: second.cache, now: new Date('2026-10-10T12:00:00Z') });
  assert.equal(third.requests, 8);
  assert.deepEqual(calls.filter(url => !url.endsWith('/robots.txt')), deals.slice(0, 4).map(target => target.url));
  assert.equal(third.report.cacheHits, 4);
  for (const result of [first, cacheOnly, second, third]) {
    assert.deepEqual(result.report.deals.map(item => item.id), deals.map(target => target.id));
  }
  assert.equal(JSON.stringify(deals), before);
});

test('Expired retries are oldest-first, including legacy checkedAt history, with stable report order', async () => {
  const deals = freeze(Array.from({ length: 3 }, (_, index) => ({ ...deal, id: `retry-${index}`,
    url: `https://retry${index}.at/angebote/kaffee` })));
  const calls = [];
  const fetchPage = async url => { calls.push(url); throw new Error('fixture offline'); };
  const first = await enrichSourceAddresses({ deals, map, now, maxRequests: 3, fetchPage });
  const cache = structuredClone(first.cache);
  for (const entry of Object.values(cache)) {
    const index = deals.findIndex(target => target.url === entry.sourceUrl);
    entry.checkedAt = new Date(now.getTime() - index * 3600000).toISOString();
    delete entry.lastAttemptAt;
  }
  calls.length = 0;
  const second = await enrichSourceAddresses({ deals, map, cache, now: new Date('2026-10-10T11:00:00Z'), maxRequests: 1, fetchPage });
  assert.deepEqual(calls, ['https://retry2.at/robots.txt']);
  assert.equal(second.requests, 1);
  assert.deepEqual(second.report.deals.map(item => item.id), deals.map(target => target.id));
  calls.length = 0;
  const third = await enrichSourceAddresses({ deals, map, cache: second.cache, now: new Date('2026-10-10T12:00:00Z'), maxRequests: 1, fetchPage });
  assert.deepEqual(calls, ['https://retry1.at/robots.txt']);
  assert.equal(third.requests, 1);
});

test('Robots disallow, errors, unreadable policies and crawl delays fail closed', async () => {
  const scenarios = [
    { robots: 'User-agent: *\nDisallow: /', reason: 'robots-disallowed' },
    { robots: 'User-agent: FreeFinder-source-discovery\nDisallow: /angebote', reason: 'robots-disallowed' },
    { robotsStatus: 403, reason: 'robots-unavailable' },
    { robotsStatus: 429, reason: 'robots-unavailable' },
    { robotsStatus: 503, reason: 'robots-unavailable' },
    { robots: '<html>Login required</html>', reason: 'robots-unreadable' },
    { robots: 'User-agent: *\nCrawl-delay: 10\nAllow: /', reason: 'robots-crawl-delay-deferred' },
  ];
  for (const scenario of scenarios) {
    const fixture = fixtures(scenario);
    const result = await run(fixture);
    assert.equal(row(result).reason, scenario.reason);
    assert.equal(result.requests, 1);
    assert.equal(fixture.calls.length, 1);
    assert.equal(result.reviewed[deal.id], undefined);
  }
  assert.equal(row(await run(fixtures({ robotsStatus: 404 }))).status, 'address-ready');
});

test('Request budget includes robots; redirects and time budgets cannot open an extra destination', async () => {
  for (const maxRequests of [0, -1, NaN, Infinity, 0.9]) {
    const fixture = fixtures();
    assert.equal((await run(fixture, { maxRequests })).requests, 0);
    assert.equal(fixture.calls.length, 0);
  }
  const limited = fixtures();
  const one = await run(limited, { maxRequests: 1 });
  assert.equal(one.requests, 1);
  assert.equal(row(one).reason, 'request-budget');
  assert.deepEqual(cacheEntry(one), { sourceUrl: deal.url, lastAttemptAt: now.toISOString() },
    'An incomplete attempt retains only scheduling history, not negative evidence');
  assert.equal((await run(fixtures(), { maxDurationMs: 0 })).requests, 0);
  const final = fixtures({ finalUrl: 'https://cafemorgen.at/login' });
  assert.equal(row(await run(final)).reason, 'redirect-deferred');
  assert.equal(final.calls.length, 2);
  const redirectedRobots = fixtures({ robotsFinalUrl: 'https://other-merchant.at/robots.txt' });
  assert.equal(row(await run(redirectedRobots)).reason, 'redirect-deferred');
  assert.equal(redirectedRobots.calls.length, 1);
});

test('Origin robots are reused in a run, but policy is checked against each original page path', async () => {
  const second = { ...deal, id: 'second', url: 'https://cafemorgen.at/private/kaffee' };
  const fixture = fixtures({ robots: 'User-agent: *\nDisallow: /private' });
  const result = await run(fixture, { deals: [deal, second] });
  assert.equal(result.requests, 2);
  assert.equal(result.report.deals[1].reason, 'robots-disallowed');
  assert.equal(result.reviewed.second, undefined);
});

test('The actual shared helper pins public DNS, rejects mixed/private DNS and never follows redirects', async () => {
  const dnsCalls = [];
  const httpCalls = [];
  let privateDns = false;
  dns.resolve4 = async host => {
    dnsCalls.push(host);
    assert.equal(host, 'cafemorgen.at');
    return privateDns ? ['93.184.216.34', '10.0.0.1'] : ['93.184.216.34'];
  };
  https.get = (url, options, callback) => {
    httpCalls.push(url.href);
    options.lookup(url.hostname, {}, (error, ip, family) => {
      assert.equal(error, null);
      assert.equal(ip, '93.184.216.34');
      assert.equal(family, 4);
    });
    const request = new EventEmitter();
    request.destroy = error => { request.emit('error', error); request.emit('close'); };
    queueMicrotask(() => {
      const response = new EventEmitter();
      const isRobots = url.pathname === '/robots.txt';
      response.statusCode = isRobots ? 200 : 302;
      response.headers = isRobots ? { 'content-type': 'text/plain' } : { location: 'https://other-merchant.at/unapproved' };
      callback(response);
      response.emit('data', Buffer.from(isRobots ? 'User-agent: *\nAllow: /' : ''));
      response.emit('end');
      request.emit('close');
    });
    return request;
  };
  syncBuiltinESMExports();
  try {
    const redirected = await enrichSourceAddresses({ deals: [deal], map, now });
    assert.equal(redirected.reviewed[deal.id], undefined);
    assert.equal(redirected.requests, 2);
    assert.deepEqual(httpCalls, ['https://cafemorgen.at/robots.txt', deal.url]);
    assert.deepEqual(dnsCalls, ['cafemorgen.at', 'cafemorgen.at']);
    privateDns = true;
    httpCalls.length = 0;
    const privateResult = await enrichSourceAddresses({ deals: [deal], map, now });
    assert.equal(privateResult.reviewed[deal.id], undefined);
    assert.equal(privateResult.requests, 1);
    assert.equal(httpCalls.length, 0);
    assert.equal(row(privateResult).reason, 'source-fetch-error');
  } finally {
    dns.resolve4 = noNetwork;
    https.get = noNetwork;
    syncBuiltinESMExports();
  }
});

test('Non-HTML, blocked or missing offers are not evidence and expose no raw errors or HTML', async () => {
  for (const scenario of [{ pageStatus: 403 }, { pageStatus: 429 }, { pageStatus: 500 }, { pageStatus: 404 },
    { pageStatus: 410 }, { contentType: 'application/json' }]) {
    const result = await run(fixtures(scenario));
    assert.equal(result.reviewed[deal.id], undefined);
    assert.equal(row(result).status, 'needs-review');
    assert.equal(JSON.stringify(result).includes('<html>'), false);
  }
});

test('Future or malformed cache records do not grant evidence', async () => {
  const first = await run(fixtures());
  for (const change of [{ checkedAt: '2026-10-11T10:00:00Z' }, { checkedAt: 'invalid' }, { policyVersion: 0 },
    { inputFingerprint: 'changed' }, { sourceUrl: 'https://other.at/offer' }, { contentFingerprint: '' },
    { locations: [] }, { locations: [{ ...address, number: '29-31' }] }, { evidenceExpiresAt: 'invalid' }]) {
    const cache = structuredClone(first.cache);
    Object.assign(Object.values(cache)[0], change);
    const result = await run(fixtures(), { cache, reviewed: first.reviewed, maxRequests: 0 });
    assert.equal(result.reviewed[deal.id], undefined, JSON.stringify(change));
    assert.equal(row(result).cacheHit, false);
  }
});

test('Zero-budget import and eligible-cache reuse require no npm dependencies', async () => {
  const first = await run(fixtures());
  const loader = `export async function resolve(specifier, context, next) {
    if (['cheerio', 'robots-parser'].includes(specifier) || specifier.endsWith('/discover-vienna-merchants.mjs')) throw new Error('Unexpected dependency: ' + specifier);
    return next(specifier, context);
  }`;
  const code = `import assert from 'node:assert/strict';
    import { enrichSourceAddresses } from ${JSON.stringify(new URL('./deal-map-source-addresses.mjs', import.meta.url).href)};
    const options = ${JSON.stringify({ deals: [deal], map, cache: first.cache, maxRequests: 0 })};
    const result = await enrichSourceAddresses({ ...options, now: new Date(${JSON.stringify(now.toISOString())}) });
    assert.equal(result.requests, 0); assert.equal(result.report.deals[0].cacheHit, true);
    assert.equal(result.reviewed['cafe-offer'].locations.length, 1);
    const uncached = await enrichSourceAddresses({ ...options, cache: {}, now: new Date(${JSON.stringify(now.toISOString())}) });
    assert.equal(uncached.requests, 0); assert.equal(uncached.reviewed['cafe-offer'], undefined);
    console.log('dependency-light cache path passed');`;
  const stdout = execFileSync(process.execPath, ['--no-warnings', '--experimental-loader', `data:text/javascript,${encodeURIComponent(loader)}`, '--input-type=module', '-e', code], { encoding: 'utf8' });
  assert.match(stdout, /dependency-light cache path passed/);
});

import assert from 'node:assert/strict';
import { runScheduledPowerSource, prioritizePowerSources } from '../scraper/power-source-scheduling.js';
import { retryAfterAt, sourceHttpError } from '../scraper/source-http-policy.js';
import { crawlFoodSource } from '../scraper/power-food-crawler.js';
import { fetchHTML, ACTIVE_SOURCES } from '../scraper/power-scraper.js';
import { fetchOfficialFoodPage } from '../scraper/power-food-verification.js';

const now = new Date('2026-10-20T12:00:00Z');
const hour = 3600000;
assert.equal(retryAfterAt('3600', now), '2026-10-20T13:00:00.000Z');
assert.equal(retryAfterAt('Thu, 22 Oct 2026 12:00:00 GMT', now), '2026-10-22T12:00:00.000Z');
for (const value of ['', null, '-1', '1.5', 'later', 'Infinity', '9'.repeat(400), 'Mon, 19 Oct 2026 12:00:00 GMT']) {
  assert.equal(retryAfterAt(value, now), '');
}
const source = { name: 'Cafe', url: 'https://example.test/', allowedHosts: ['example.test'], category: 'essen', officialFood: true };
const report = (row, time = now) => ({ finishedAt: time.toISOString(), sources: [row] });
const fail = async () => ({ source: source.name, url: source.url, status: 'error', error: 'HTTP 429', rows: [], deals: 0 });
const first = await runScheduledPowerSource(source, {}, fail, now);
assert.equal(first.cooldown.consecutiveFailures, 1);
assert.equal(first.cooldown.nextRetryAt, '2026-10-21T12:00:00.000Z');
const neverFetch = () => assert.fail('cooldown must not make any network request');
const held = await runScheduledPowerSource(source, report(first), neverFetch, new Date(+now + hour));
assert.equal(held.status, 'deferred');
assert.deepEqual(held.cooldown, first.cooldown, 'skipping must not extend the deadline');
assert.deepEqual(held.rows, [], 'a paused source must not create fresh-looking deals');
const heldAgain = await runScheduledPowerSource(source, report(held), neverFetch, new Date(+now + 2 * hour));
assert.deepEqual(heldAgain.cooldown, first.cooldown, 'survives consecutive persisted reports');
const second = await runScheduledPowerSource(source, report(held), fail, new Date(+now + 24 * hour));
assert.equal(second.cooldown.consecutiveFailures, 2);
assert.equal(second.cooldown.nextRetryAt, '2026-10-23T12:00:00.000Z');
const recovered = await runScheduledPowerSource(source, report(second), async () => ({
  source: source.name, url: source.url, status: 'ok', rows: [], deals: 0,
}), new Date('2026-10-23T12:00:00Z'));
assert.equal(recovered.cooldown, null, 'success resets the failure count, even with no offer');
const partialMissing = { source: source.name, url: source.url, status: 'ok', deals: 0, rows: [],
  error: 'HTTP 404', pages: [{ url: source.url, status: 'ok' },
    { url: 'https://example.test/old-offer', status: 'error', error: 'HTTP 404', httpStatus: 404 }] };
const partialSource = await runScheduledPowerSource(source, {}, async () => partialMissing, now);
assert.equal(partialSource.cooldown, null, 'a dead optional offer page must not pause the healthy merchant');
assert(partialSource.pageCooldowns['https://example.test/old-offer'].nextRetryAt);
const pageRequests = [];
const partialRetry = await runScheduledPowerSource(source, report(partialSource), async configured =>
  crawlFoodSource({ ...configured, seeds: ['https://example.test/old-offer'] }, {
    now: new Date(+now + hour), fetchPage: async url => { pageRequests.push(url); return { html: '<body>No offers</body>' }; },
    pageCooldowns: configured.pageCooldowns,
  }), new Date(+now + hour));
assert.deepEqual(pageRequests, [source.url], 'retry the healthy root but not a quarantined optional page');
assert(partialRetry.pageCooldowns['https://example.test/old-offer'].nextRetryAt);
const longRetry = await runScheduledPowerSource(source, {}, async () => ({
  ...await fail(), retryAt: '2026-11-20T12:00:00.000Z',
}), now);
assert.equal(longRetry.cooldown.nextRetryAt, '2026-11-20T12:00:00.000Z', 'never shorten server Retry-After');
const legacy = await runScheduledPowerSource(source, report(await fail()), neverFetch, new Date(+now + hour));
assert.equal(legacy.status, 'deferred', 'adopts failures already in the saved report');
let partialCalls = 0;
await runScheduledPowerSource(source, report({ ...await fail(), status: 'ok', error: 'Not HTML' }), async () => {
  partialCalls++;
  return { status: 'ok' };
}, now);
assert.equal(partialCalls, 1, 'legacy optional-page errors do not pause a reachable source');
let correctedCalls = 0;
const changedBlocked = await runScheduledPowerSource({ ...source, url: 'https://example.test/new' }, report(first), async () => {
  correctedCalls++;
  return { status: 'ok' };
}, now);
assert.equal(correctedCalls, 0, 'an alternate endpoint must not bypass a merchant-wide throttle');
assert.equal(changedBlocked.status, 'deferred');
await runScheduledPowerSource({ ...source, url: 'https://example.test/new' },
  report({ ...first, error: 'HTTP 404', cooldown: { ...first.cooldown, reason: 'missing-endpoint' } }), async () => {
    correctedCalls++;
    return { status: 'ok' };
  }, now);
assert.equal(correctedCalls, 1, 'an explicitly corrected missing endpoint can be tried, unlike an access denial');
for (const status of [401, 403, 404, 410, 500, 521]) {
  const row = await runScheduledPowerSource(source, {}, async () => ({ ...await fail(), error: `HTTP ${status}` }), now);
  assert.ok(Date.parse(row.cooldown.nextRetryAt) > +now);
}
const sorted = prioritizePowerSources([{ name: 'retail', category: 'shopping' }, source, { name: 'Coffee', category: 'kaffee' }]);
assert.deepEqual(sorted.map(s => s.name), ['Cafe', 'Coffee', 'retail']);
assert.equal(ACTIVE_SOURCES[0].category, 'essen');
assert.equal(new Set(ACTIVE_SOURCES.map(s => s.url)).size, ACTIVE_SOURCES.length, 'no duplicate entry URLs');

for (const status of [403, 429]) {
  let calls = 0;
  const row = await crawlFoodSource({ ...source, render: true, seeds: ['https://example.test/angebote'] }, {
    now, fetchPage: async () => { calls++; throw sourceHttpError(status, '172800', now); },
    renderPage: neverFetch,
  });
  assert.equal(calls, 1, 'neither another page nor browser is tried after blocking');
  assert.equal(row.pages[0].httpStatus, status);
  const scheduled = await runScheduledPowerSource(source, {}, async () => row, now);
  assert.ok(Date.parse(scheduled.cooldown.nextRetryAt) >= +now + 48 * hour);
}
let rendered = 0;
const jsSource = { ...source, render: true };
const jsPage = await crawlFoodSource(jsSource, {
  now, maxPages: 1, fetchPage: async () => ({ html: '<html><body><div id="root"></div></body></html>' }),
  renderPage: async () => { rendered++; return { html: '<html><body>No offers today</body></html>', finalUrl: source.url }; },
});
assert.equal(rendered, 1, 'explicit JavaScript source must render even without a noscript warning');
assert.equal(jsPage.status, 'ok');
const noBrowser = await crawlFoodSource(jsSource, { now, maxPages: 1,
  fetchPage: async () => ({ html: '<html><body><div id="root"></div></body></html>' }) });
assert.equal(noBrowser.pages[0].status, 'needs-browser');
assert.equal(noBrowser.status, 'error', 'an unrendered shell is not a healthy no-offers result');
const noBrowserScheduled = await runScheduledPowerSource(jsSource, {}, async () => noBrowser, now);
assert.equal(noBrowserScheduled.cooldown.reason, 'source-error', 'missing browser errors still pause repeated failed work');
let aliasCalls = 0;
await crawlFoodSource({ ...source, seeds: ['https://example.test/angebote'] }, {
  now, fetchPage: async () => {
    aliasCalls++;
    return { html: '<body>No offer</body>', finalUrl: 'https://example.test/angebote' };
  },
});
assert.equal(aliasCalls, 1, 'redirect destination is not fetched again as a seed');

const originalFetch = globalThis.fetch;
try {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response('rate limited', { status: 429, headers: { 'retry-after': '172800' } });
  };
  for (const fetcher of [() => fetchHTML(source.url), () => fetchOfficialFoodPage(source.url, source)]) {
    await assert.rejects(fetcher, error => error.httpStatus === 429 && Date.parse(error.retryAt) > Date.now() + 47 * hour);
  }
  assert.equal(calls, 2, 'HTTP wrappers do not retry');
} finally {
  globalThis.fetch = originalFetch;
}
console.log('power source scheduling tests passed');

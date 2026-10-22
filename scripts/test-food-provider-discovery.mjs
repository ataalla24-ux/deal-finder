import test from 'node:test';
import assert from 'node:assert/strict';
import { FoodProviderClient, usageSummary } from '../scraper/food-provider-client.js';
import { freeBudget, planRequests, sourceAvailable, DAY } from '../scraper/food-provider-policy.js';
import { collectPlan, applyYieldCooldown, mergeProviderPending } from '../scraper/food-provider-discovery.js';
import { POWER_FOOD_SOURCES } from '../scraper/power-food-sources.js';
const now = new Date('2026-10-22T21:00:00Z');
const empty = () => ({ version: 1, reservations: [], sources: {}, providerPauses: {} });
const usages = {
  scraperapi: { status: 'authenticated', maximum: 5000, used: 0, concurrency: 0, payAsYouGoEnabled: false, autoUpgradeEnabled: false },
  scrapingbee: { status: 'authenticated', maximum: 1000, used: 0, concurrency: 0 },
  zyte: { credentialPresent: true },
};
const power = () => ({ finishedAt: now.toISOString(), sources: POWER_FOOD_SOURCES.map(s => ({ source: s.name, url: s.url, status: 'ok' })) });
const source = POWER_FOOD_SOURCES.find(s => s.name === 'KFC');

test('usage summary never includes keys, email or unrecognized values', () => {
  const value = usageSummary('scraperapi', { requestCount: 0, requestLimit: 1000,
    apiKey: 'private-value', email: 'private-address', plan: { name: 'free', credits: 1000, apiKey: 'hidden' } });
  assert.equal(value.maximum, 1000);
  assert.equal(value.used, 0);
  assert.doesNotMatch(JSON.stringify(value), /private|hidden|apiKey|email/);
  assert.equal(usageSummary('scrapingbee', {}).maximum, null);
});
test('audit is read-only, fixed host, no redirects and sanitized errors', async () => {
  let calls = 0;
  const client = new FoodProviderClient('scrapingbee', { env: { SCRAPINGBEE: 'private-value' },
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url.href, 'https://app.scrapingbee.com/api/v1/usage');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, 'Bearer private-value');
      throw new Error('private-value');
    } });
  await assert.rejects(client.usage(), /^Error: provider-network-error$/);
  assert.equal(calls, 1);
});
test('missing key cannot make a request; Zyte audit does not pretend extraction key is stats key', async () => {
  const fetchImpl = () => { throw new Error('unexpected-fetch'); };
  await assert.rejects(new FoodProviderClient('scraperapi', { env: {}, fetchImpl }).usage(), /missing-credential/);
  assert.equal((await new FoodProviderClient('zyte', { env: { ZYSTE: 'private' }, fetchImpl }).usage()).status,
    'dashboard-trial-check-required');
});
test('all three adapters send fixed bounded options without paid extras', async () => {
  for (const provider of ['scraperapi', 'scrapingbee', 'zyte']) {
    const client = new FoodProviderClient(provider, { env: { SCRAPINGAPI: 'private', SCRAPINGBEE: 'private', ZYSTE: 'private' },
      fetchImpl: async (input, options) => {
        const url = new URL(input);
        assert.equal(options.redirect, 'error');
        if (provider === 'scraperapi') {
          assert.equal(url.hostname, 'api.scraperapi.com');
          assert.equal(url.searchParams.get('max_cost'), '10');
          assert.equal(url.searchParams.has('premium'), false);
        } else if (provider === 'scrapingbee') {
          assert.equal(url.hostname, 'app.scrapingbee.com');
          assert.equal(url.searchParams.get('premium_proxy'), 'false');
          assert.equal(url.searchParams.get('stealth_proxy'), 'false');
          assert.equal(url.searchParams.has('ai_query'), false);
        } else {
          assert.equal(url.href, 'https://api.zyte.com/v1/extract');
          assert.deepEqual(JSON.parse(options.body), { url: source.url, browserHtml: true });
          return new Response(JSON.stringify({ statusCode: 200, url: source.url, browserHtml: '<html><body>food</body></html>' }));
        }
        return new Response('<html><body>food</body></html>', { headers: {
          'sa-final-url': source.url, 'sa-credit-cost': '10', 'spb-resolved-url': source.url, 'spb-cost': '5' } });
      } });
    assert.equal((await client.scrape(source)).finalUrl, source.url);
    await assert.rejects(client.scrape(source, 'https://untrusted.invalid/'), /untrusted-target/);
  }
});
test('redirects and unexpected costs fail closed', async () => {
  for (const headers of [{ 'sa-final-url': 'https://evil.invalid/', 'sa-credit-cost': '10' },
    { 'sa-final-url': source.url, 'sa-credit-cost': '75' }, { 'sa-credit-cost': '10' }]) {
    const client = new FoodProviderClient('scraperapi', { env: { SCRAPINGAPI: 'private' },
      fetchImpl: async () => new Response('<html></html>', { headers }) });
    await assert.rejects(client.scrape(source), /untrusted-or-missing-final-url|unexpected-provider-cost/);
  }
});
test('no paid plan, overage, missing usage or concurrency accepted', () => {
  for (const change of [{ maximum: 100000 }, { autoUpgradeEnabled: true }, { payAsYouGoEnabled: true },
    { payAsYouGoEnabled: null }, { used: 4990 }, { used: null }, { concurrency: 1 }])
    assert.notEqual(freeBudget('scraperapi', { ...usages.scraperapi, ...change }, empty(), 10, now), '');
  assert.equal(freeBudget('scraperapi', usages.scraperapi, empty(), 20, now), '');
  assert.equal(freeBudget('scraperapi', { ...usages.scraperapi, maximum: 1000 }, empty(), 20, now), '');
});
test('trial services never enter unattended scan and expire closed', () => {
  for (const provider of ['scrapingbee', 'zyte']) {
    assert.notEqual(freeBudget(provider, usages[provider], empty(), 5, now), '');
    assert.notEqual(freeBudget(provider, usages[provider], empty(), .05, new Date('2026-12-01'), 'benchmark'), '');
  }
  assert.equal(freeBudget('zyte', usages.zyte, empty(), .1, now, 'benchmark'), '');
});
test('daily and rolling caps count failed/uncertain reservations and reject corrupt ledger', () => {
  const state = empty();
  state.reservations.push({ runId: '1', at: now.toISOString(), mode: 'scan', tasks: [{ provider: 'scraperapi', source: 'KFC', cap: 10 }] });
  assert.notEqual(freeBudget('scraperapi', usages.scraperapi, state, 20, now), '');
  assert.equal(freeBudget('scraperapi', usages.scraperapi, state, 20, new Date('2026-10-23T08:00:00Z')), '');
  state.reservations = Array.from({ length: 90 }, (_, i) => ({ runId: String(i), at: new Date(+now - 2 * DAY).toISOString(),
    mode: 'scan', tasks: [{ provider: 'scraperapi', source: 'KFC', cap: 10 }] }));
  assert.notEqual(freeBudget('scraperapi', usages.scraperapi, state, 10, now), '');
  assert.throws(() => freeBudget('scraperapi', usages.scraperapi, {}, 10, now), /invalid-food-provider-ledger/);
});
test('benchmark max six calls once; scan two calls without trial services', () => {
  const state = empty();
  const plan = planRequests(state, power(), usages, 'benchmark', now, '123');
  assert.equal(plan.tasks.length, 6);
  state.reservations.push({ runId: '123', mode: 'benchmark', at: now.toISOString(), tasks: plan.tasks });
  assert.equal(planRequests(state, power(), usages, 'benchmark', now, '124').tasks.length, 0);
  const scan = planRequests(empty(), power(), usages, 'scan', now, '124');
  assert.equal(scan.tasks.length, 2);
  assert.ok(scan.tasks.every(t => t.provider === 'scraperapi'));
});
test('known cooldown, failed source or stale Power report never triggers a proxy', () => {
  const report = power();
  report.sources.find(s => s.source === source.name).status = 'deferred';
  assert.equal(sourceAvailable(source, report, empty(), now), false);
  assert.equal(sourceAvailable(source, { ...power(), finishedAt: new Date(+now - 3 * DAY).toISOString() }, empty(), now), false);
});
test('direct access denial stops all provider rotation and keeps Retry-After', async () => {
  const state = empty();
  const tasks = ['scraperapi', 'scrapingbee', 'zyte'].map(provider => ({ provider, source: source.name, cap: { scraperapi: 10, scrapingbee: 5, zyte: .05 }[provider] }));
  state.reservations.push({ runId: '123', mode: 'benchmark', at: now.toISOString(), tasks });
  const retryAt = new Date(+now + 10 * DAY).toISOString();
  const output = await collectPlan({ runId: '123', mode: 'benchmark', tasks }, state, power(), { now,
    fetchPage: async () => { throw Object.assign(new Error('HTTP 429'), { httpStatus: 429, retryAt }); },
    clientFor: () => { throw new Error('no-provider-allowed'); } });
  assert.deepEqual(output.results.map(r => r.status), ['failed', 'source-paused', 'source-paused']);
  assert.equal(state.sources.KFC.retryAt, retryAt);
  assert.equal(output.candidates.length, 0);
});
test('reservation saved before request; no replay or unverified candidate enters queue', async () => {
  const state = empty(), tasks = [{ provider: 'scraperapi', source: source.name, cap: 10 }];
  state.reservations.push({ runId: '123', mode: 'benchmark', at: now.toISOString(), tasks });
  let saved = false, requested = 0;
  const options = { now, save: async () => { saved = true; },
    fetchPage: async () => ({ html: '<html><body>Welcome</body></html>', finalUrl: source.url }),
    verify: async () => ({ ok: false, reason: 'offer-not-on-current-page' }),
    clientFor: () => ({ usage: async () => usages.scraperapi, scrape: async () => {
      assert.equal(saved, true); requested++;
      return { html: '<html><body><main><section><img alt="Aktion: Burger um 1 Euro in Wien" /></section></main></body></html>', finalUrl: source.url, cost: 10 };
    } }) };
  const plan = { runId: '123', mode: 'benchmark', tasks };
  const output = await collectPlan(plan, state, power(), options);
  assert.equal(requested, 1);
  assert.equal(output.candidates.length, 0);
  assert.equal(output.results[0].unverifiedCandidates, 1);
  await assert.rejects(collectPlan(plan, state, power(), options), /reservation-mismatch-or-started/);
});
test('empty or duplicate pages pause for 7/14/28 days, verified incremental offers reset', () => {
  const state = empty();
  const rows = [{ source: 'KFC', status: 'fetched', verifiedIncrementalCandidates: 0 }];
  for (const days of [7, 14, 28]) {
    applyYieldCooldown(state, rows, now);
    assert.equal(Date.parse(state.sources.KFC.retryAt), +now + days * DAY);
  }
  const before = JSON.stringify(state);
  applyYieldCooldown(state, [{ source: 'KFC', status: 'source-paused' }], now);
  assert.equal(JSON.stringify(state), before, 'skips cannot extend cooldowns');
  applyYieldCooldown(state, [{ source: 'KFC', status: 'fetched', verifiedIncrementalCandidates: 1 }], now);
  assert.equal(state.sources.KFC.noGainCount, 0);
  assert.equal(state.sources.KFC.retryAt, undefined);
});
test('rotating sources cannot erase fresh unsent pending offers or replay old offers', () => {
  const d = (id, age = 0) => ({ id, providerDiscovery: { checkedAt: new Date(+now - age * DAY).toISOString() } });
  const merged = mergeProviderPending([d('keep'), d('old', 3), d('sent')], [d('new'), d('keep')], new Set(['sent']), now);
  assert.deepEqual(merged.map(d => d.id), ['keep', 'new']);
});
test('JavaScript sources wait for content, preserving the same fixed price cap', async () => {
  const s = POWER_FOOD_SOURCES.find(s => s.name === 'Burger King');
  for (const provider of ['scraperapi', 'scrapingbee']) {
    const client = new FoodProviderClient(provider, { env: { SCRAPINGAPI: 'private', SCRAPINGBEE: 'private' },
      fetchImpl: async (input) => {
        const url = new URL(input);
        assert.equal(url.searchParams.get(provider === 'scraperapi' ? 'wait_for_selector' : 'wait_for'), 'h1,h2,h3');
        return new Response('<html><h1>Coupons</h1></html>', { headers: { 'sa-final-url': s.url, 'spb-resolved-url': s.url,
          'sa-credit-cost': '10', 'spb-cost': '5' } });
      } });
    await client.scrape(s);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { FoodProviderClient, usageSummary } from '../scraper/food-provider-client.js';
import { freeBudget, planRequests, sourceAvailable, DAY, ZYTE_TRIAL_CHECK, BEE_TRIAL_END, SCRAPER_TRIAL_END, CAPS, MAX_SCAN_TASKS, scanTargets, taskKey, validateLedger } from '../scraper/food-provider-policy.js';
import { collectPlan, applyYieldCooldown, mergeProviderPending, rememberLinks, summarizeProviderResults } from '../scraper/food-provider-discovery.js';
import { POWER_FOOD_SOURCES } from '../scraper/power-food-sources.js';
const now = new Date('2026-10-22T21:00:00Z');
const empty = () => ({ version: 1, reservations: [], sources: {}, providerPauses: {} });
const usages = {
  scraperapi: { status: 'authenticated', maximum: 5000, used: 0, concurrency: 0, payAsYouGoEnabled: false, autoUpgradeEnabled: false },
  scrapingbee: { status: 'authenticated', maximum: 1000, used: 0, concurrency: 0 },
  zyte: { credentialPresent: true, trialKeyBound: true, status: 'provider-blocking-limit-not-live-usage' },
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
  const value = await new FoodProviderClient('zyte', { env: { ZYSTE: 'private' }, fetchImpl }).usage();
  assert.equal(value.status, 'provider-blocking-limit-not-live-usage');
  assert.equal(value.trialKeyBound, false);
  assert.doesNotMatch(JSON.stringify(value), /private/);
  assert.match(value.credentialFingerprint, /^[a-f0-9]{64}$/);
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
test('recurring trials require verified guards and expire without renewal', () => {
  for (const provider of ['scrapingbee', 'zyte']) {
    const amount = provider === 'zyte' ? .1 : 10;
    assert.equal(freeBudget(provider, usages[provider], empty(), amount, now), '');
    assert.notEqual(freeBudget(provider, usages[provider], empty(), .05, new Date('2026-12-01'), 'benchmark'), '');
  }
  assert.equal(freeBudget('zyte', usages.zyte, empty(), .1, now, 'benchmark'), '');
  assert.notEqual(freeBudget('zyte', usages.zyte, empty(), .05, new Date(ZYTE_TRIAL_CHECK.validUntil)), '');
  assert.notEqual(freeBudget('zyte', usages.zyte, empty(), .05, new Date(+new Date(ZYTE_TRIAL_CHECK.checkedAt) - 1)), '');
  assert.notEqual(freeBudget('scrapingbee', usages.scrapingbee, empty(), 5, new Date(BEE_TRIAL_END)), '');
  for (const change of [{ trialKeyBound: false }, { credentialPresent: false }, { status: 'unknown' }])
    assert.notEqual(freeBudget('zyte', { ...usages.zyte, ...change }, empty(), .05, now), '');
  for (const change of [{ maximum: 100000 }, { used: 900 }, { status: 'unavailable' }, { concurrency: 1 }])
    assert.notEqual(freeBudget('scrapingbee', { ...usages.scrapingbee, ...change }, empty(), 5, now), '');
});
test('Zyte pin is bound to the reviewed extraction credential; rotation stops calls', async () => {
  const fingerprint = createHash('sha256').update('reviewed-key').digest('hex');
  for (const key of ['reviewed-key', 'replacement-key', undefined]) {
    const usage = await new FoodProviderClient('zyte', { env: { ZYSTE: key, ZYTE_FREE_TRIAL_KEY_SHA256: fingerprint },
      fetchImpl: () => { throw new Error('audit-is-not-a-cost-call'); } }).usage();
    assert.equal(usage.trialKeyBound, key === 'reviewed-key');
  }
});
test('trial lifetime ceilings do not reset the next day or month; daily two-page cap removed', () => {
  for (const [provider, cap, lifetime] of [['scrapingbee', 5, 900], ['zyte', .05, 3.9]]) {
    const state = empty();
    const r = (id, date) => ({ runId: String(id), mode: 'scan', at: date.toISOString(),
      tasks: [{ provider, source: 'KFC', cap }, { provider, source: 'Burger King', cap }] });
    state.reservations.push(r(1, now));
    assert.equal(freeBudget(provider, usages[provider], state, 10 * cap, now), '');
    assert.equal(freeBudget(provider, usages[provider], state, 2 * cap, new Date(+now + DAY)), '');
    state.reservations = Array.from({ length: Math.round(lifetime / (2 * cap)) }, (_, i) => r(i + 2, new Date(+now - (i + 1) * DAY)));
    assert.notEqual(freeBudget(provider, usages[provider], state, cap, now), '');
  }
});
test('signup trial and later free caps count uncertain reservations and reject corrupt ledgers', () => {
  const state = empty();
  state.reservations.push({ runId: '1', at: now.toISOString(), mode: 'scan', tasks: [{ provider: 'scraperapi', source: 'KFC', cap: 10 }] });
  assert.equal(freeBudget('scraperapi', usages.scraperapi, state, 1000, now), '');
  assert.equal(freeBudget('scraperapi', usages.scraperapi, state, 20, new Date('2026-10-23T08:00:00Z')), '');
  state.reservations = Array.from({ length: 90 }, (_, i) => ({ runId: String(i), at: new Date(+now - 2 * DAY).toISOString(),
    mode: 'scan', tasks: [{ provider: 'scraperapi', source: 'KFC', cap: 10 }] }));
  assert.equal(freeBudget('scraperapi', usages.scraperapi, state, 10, now), '');
  assert.notEqual(freeBudget('scraperapi', { ...usages.scraperapi, maximum: 1000 }, state, 10, now), '');
  state.reservations[0].tasks.push(...Array.from({ length: 400 }, () => ({ provider: 'scraperapi', source: 'KFC', cap: 10 })));
  assert.notEqual(freeBudget('scraperapi', usages.scraperapi, state, 10, now), '');
  assert.throws(() => freeBudget('scraperapi', usages.scraperapi, {}, 10, now), /invalid-food-provider-ledger/);
});
test('benchmark stays one-shot; scans expand to distinct allowlisted food pages across all providers', () => {
  const state = empty();
  const plan = planRequests(state, power(), usages, 'benchmark', now, '123');
  assert.equal(plan.tasks.length, 6);
  state.reservations.push({ runId: '123', mode: 'benchmark', at: now.toISOString(), tasks: plan.tasks });
  assert.equal(planRequests(state, power(), usages, 'benchmark', now, '124').tasks.length, 0);
  const scan = planRequests(empty(), power(), usages, 'scan', now, '124');
  assert.equal(scan.tasks.length, 16, '15 official food roots plus one current seed; exclude obsolete/alcohol-only Vapiano seeds');
  assert.equal(new Set(scan.tasks.map(taskKey)).size, 16);
  for (const [p, expected] of Object.entries({ scrapingbee: 6, zyte: 5, scraperapi: 5 }))
    assert.equal(scan.tasks.filter(t => t.provider === p).length, expected);
  assert(!scan.tasks.some(t => /vapiano-happy-hour|aufgepassta-jeder-tag-ist-pasta-tag/.test(t.url)));
  assert.deepEqual(scan.tasks.slice(0, 3).map(t => t.provider), ['scrapingbee', 'zyte', 'scraperapi']);
  assert.ok(scan.tasks.every(t => ['essen', 'kaffee'].includes(POWER_FOOD_SOURCES.find(s => s.name === t.source).category)));
});
test('expired trial services leave normal free discovery running; missing guard does not claim success', () => {
  const later = new Date('2026-11-22T10:00:00Z');
  const report = { ...power(), finishedAt: later.toISOString() };
  const scan = planRequests(empty(), report, { ...usages, scraperapi: { ...usages.scraperapi, maximum: 1000 } }, 'scan', later, '999');
  assert.equal(scan.tasks.length, 16);
  assert.ok(scan.tasks.every(t => t.provider === 'scraperapi'));
  assert.ok(scan.skipped.find(row => row.provider === 'scrapingbee' && /expired/.test(row.reason)));
  assert.ok(scan.skipped.find(row => row.provider === 'zyte' && /expired/.test(row.reason)));
  const unbound = planRequests(empty(), power(), { ...usages, zyte: { ...usages.zyte, trialKeyBound: false } }, 'scan', now, '1000');
  assert.equal(unbound.tasks.length, 16);
  assert.ok(unbound.tasks.every(t => t.provider !== 'zyte'));
});
test('source cooldowns remain shared across every provider and rotation favors oldest attempts', () => {
  const state = empty(), report = power();
  state.sources['Cafe Hummel'] = { retryAt: new Date(+now + DAY).toISOString() };
  state.pages = { 'IKEA Food|https://www.ikea.com/at/de/food/': { attemptedAt: now.toISOString() } };
  report.sources.find(s => s.source === 'Ströck').status = 'deferred';
  const plan = planRequests(state, report, usages, 'scan', now, '999');
  assert.ok(plan.tasks.every(t => !['Cafe Hummel', 'Ströck'].includes(t.source)));
  const firstPerSource = plan.tasks.filter((t, i, all) => all.findIndex(other => other.source === t.source) === i);
  assert.equal(firstPerSource.at(-1).source, 'IKEA Food');
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
test('both trial services use the recurring collector and preserve independent verification and review', async () => {
  for (const [provider, cap] of [['scrapingbee', 5], ['zyte', .05]]) {
    const state = empty(), tasks = [{ provider, source: source.name, cap }];
    state.reservations.push({ runId: '123', mode: 'scan', at: now.toISOString(), tasks });
    let saved = false, checked = 0, requested = 0;
    const output = await collectPlan({ runId: '123', mode: 'scan', tasks }, state, power(), { now,
      save: async () => { saved = true; },
      fetchPage: async () => ({ html: '<html><body>Welcome</body></html>', finalUrl: source.url }),
      clientFor: () => ({ usage: async () => usages[provider], scrape: async () => {
        assert.equal(saved, true); requested++;
        return { html: '<html><body><main><section><img alt="Aktion: Burger um 1 Euro in Wien" /></section></main></body></html>',
          finalUrl: source.url, cost: provider === 'zyte' ? null : 5 };
      } }),
      verify: async deal => { checked++; return { ok: true, deal }; },
    });
    assert.equal(requested, 1);
    assert.equal(checked, 1);
    assert.equal(output.candidates.length, 1);
    assert.equal(output.candidates[0].approved, false);
    assert.equal(output.candidates[0].reviewRequired, true);
    assert.equal(output.candidates[0].votes, 0);
    assert.equal(state.pages[taskKey(tasks[0])].noGainCount, 0);
  }
});
test('fresh low credit or missing Zyte pin stops the reserved request without any scrape', async () => {
  for (const [provider, cap] of [['scrapingbee', 5], ['zyte', .05]]) {
    const state = empty(), tasks = [{ provider, source: source.name, cap }];
    state.reservations.push({ runId: '123', mode: 'scan', at: now.toISOString(), tasks });
    const output = await collectPlan({ runId: '123', mode: 'scan', tasks }, state, power(), { now,
      fetchPage: async () => ({ html: '<html><body>Welcome</body></html>', finalUrl: source.url }),
      clientFor: () => ({ usage: async () => ({ ...usages[provider], used: 999, trialKeyBound: false }),
        scrape: () => { throw new Error('must-not-scrape'); } }),
    });
    assert.equal(output.results[0].status, 'budget-stopped');
    assert.equal(output.candidates.length, 0);
    assert.equal(state.reservations[0].tasks.length, 1, 'uncertain reservations are never refunded');
  }
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
  assert.equal(Date.parse(state.sources.KFC.retryAt), +now + DAY);
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

test('credit-shaped allocation fills 32 slots without duplicates or exceeding live available credit', () => {
  const state = empty();
  for (const s of POWER_FOOD_SOURCES.filter(s => ['essen', 'kaffee'].includes(s.category))) {
    const links = Array.from({ length: 40 }, (_, i) => new URL(`aktion/${i}`, s.url).href);
    rememberLinks(state, s, links, now);
  }
  const scan = planRequests(state, power(), { ...usages, scrapingbee: { ...usages.scrapingbee, used: 890 } }, 'scan', now, '701');
  assert.equal(scan.tasks.length, MAX_SCAN_TASKS);
  assert.equal(scan.tasks.filter(t => t.provider === 'scrapingbee').length, 2);
  assert.ok(scan.tasks.filter(t => t.provider === 'scraperapi').length > 2);
  assert.ok(scan.tasks.filter(t => t.provider === 'zyte').length > 2);
  assert.equal(new Set(scan.tasks.map(taskKey)).size, MAX_SCAN_TASKS);
  for (const provider of Object.keys(CAPS)) {
    const amount = scan.tasks.filter(t => t.provider === provider).reduce((sum, t) => sum + t.cap, 0);
    assert.equal(freeBudget(provider, provider === 'scrapingbee' ? { ...usages[provider], used: 890 } : usages[provider], state, amount, now), '');
  }
});

test('one merchant archive cannot dominate a run; stale generic news are filtered', () => {
  const state = empty();
  const backwerk = POWER_FOOD_SOURCES.find(s => s.name === 'BackWerk');
  rememberLinks(state, backwerk, ['https://www.back-werk.at/de/news/die-grosse-backwerk-kaffee-wiki-585',
    'https://www.back-werk.at/de/news/zweiter-backwerk-store-in-salzburg-1564',
    'https://www.back-werk.at/de/news/detail.php',
    ...Array.from({ length: 40 }, (_, i) => `https://www.back-werk.at/de/news/aktion-${i}`)], now);
  const plan = planRequests(state, power(), usages, 'scan', now, '990');
  assert.ok(plan.tasks.filter(t => t.source === 'BackWerk').length <= 4);
  assert.ok(plan.tasks.some(t => t.source === 'Cafe Hummel'));
  assert.ok(!plan.tasks.some(t => /wiki|salzburg|detail.php/.test(t.url)));
  const firstSources = plan.tasks.slice(0, new Set(plan.tasks.map(t => t.source)).size).map(t => t.source);
  assert.equal(new Set(firstSources).size, firstSources.length);
});

test('readable no-offer page reports its outcome without consuming API credit', async () => {
  const state = empty(), tasks = [{ provider: 'scrapingbee', source: source.name, url: source.url, cap: 5 }];
  state.reservations.push({ runId: '991', mode: 'scan', at: now.toISOString(), tasks });
  const output = await collectPlan({ runId: '991', mode: 'scan', tasks }, state, power(), { now,
    fetchPage: async () => ({ html: `<body><main><h1>Unsere Geschichte</h1><p>${'Wir stellen unser Unternehmen vor. '.repeat(30)}</p></main></body>`, finalUrl: source.url }),
    clientFor: () => { throw new Error('no-credit-for-readable-non-offer'); },
  });
  assert.equal(output.results[0].status, 'direct-no-offer');
  assert.equal(output.results[0].reason, 'readable-page-without-extractable-offer');
  assert.deepEqual(state.reservations[0].unspent, [0]);
  assert.ok(state.pages[taskKey(tasks[0])].retryAt);
});

test('report separates source concentration, extraction rejection and missing independent proof', () => {
  const summary = summarizeProviderResults([
    { source: 'BackWerk', status: 'direct-no-offer', directRejected: [{ reason: 'outside-vienna' }] },
    { source: 'BackWerk', status: 'direct-no-offer', directCandidates: 0 },
    { source: 'KFC', status: 'fetched', extractedCandidates: 1, verifiedCandidates: 0,
      candidates: [{ confirmed: false, reason: 'offer-not-on-current-page' }] },
  ]);
  assert.equal(summary.pagesBySource.BackWerk, 2);
  assert.equal(summary.statuses['direct-no-offer'], 2);
  assert.equal(summary.rejectionReasons['outside-vienna'], 1);
  assert.equal(summary.verificationReasons['offer-not-on-current-page'], 1);
  assert.equal(summary.renderedCandidates, 1);
  assert.equal(summary.verifiedCandidates, 0);
});

test('trial expiry is not a renewable credit grant; later verified free account keeps 100 credits in reserve', () => {
  const expiry = new Date(SCRAPER_TRIAL_END), state = empty();
  state.reservations.push({ runId: '1', mode: 'scan', at: now.toISOString(),
    tasks: Array.from({ length: 490 }, () => ({ provider: 'scraperapi', source: 'KFC', cap: 10 })) });
  assert.notEqual(freeBudget('scraperapi', usages.scraperapi, state, 10, expiry), '');
  const free = { ...usages.scraperapi, maximum: 1000 };
  assert.equal(freeBudget('scraperapi', free, state, 900, expiry), '');
  assert.notEqual(freeBudget('scraperapi', free, state, 910, expiry), '');
  state.reservations.push({ runId: '2', mode: 'scan', at: expiry.toISOString(),
    tasks: Array.from({ length: 90 }, () => ({ provider: 'scraperapi', source: 'KFC', cap: 10 })) });
  assert.notEqual(freeBudget('scraperapi', free, state, 10, new Date(+expiry + DAY)), '');
  assert.notEqual(freeBudget('scraperapi', { ...free, used: 990 }, empty(), 10, expiry), '');
});

test('legacy Zyte reservations retain .05 cost while new .02 allocations stop below blocking limit', () => {
  const state = empty();
  state.reservations.push({ runId: '1', mode: 'benchmark', at: now.toISOString(),
    tasks: [{ provider: 'zyte', source: 'KFC', cap: .05 }, { provider: 'zyte', source: 'Burger King', cap: .05 }] });
  assert.equal(freeBudget('zyte', usages.zyte, state, 3.8, now), '');
  assert.notEqual(freeBudget('zyte', usages.zyte, state, 3.82, now), '');
  assert.equal(CAPS.zyte, .02);
  state.reservations[0].tasks[0].cap = .001;
  assert.throws(() => validateLedger(state), /invalid-food-provider-task/);
});

test('only fresh allowlisted pages qualify; failed child, external, PDF and old links are excluded', () => {
  const state = empty(), report = power();
  rememberLinks(state, source, [`${source.url}aktion/a?utm_source=x#top`, `${source.url}aktion/a`,
    'https://outside.invalid/aktion', `${source.url}coupons.pdf`, `${source.url}aktion/blocked`], now);
  report.sources.find(s => s.source === source.name).pages = [{ url: `${source.url}aktion/blocked`, status: 'error' },
    { url: `${source.url}aktion/good`, finalUrl: `${source.url}aktion/good`, status: 'ok' }];
  state.discoveredPages.KFC.push({ url: `${source.url}aktion/stale`, seenAt: new Date(+now - 15 * DAY).toISOString() });
  const targets = scanTargets(state, report, now).filter(t => t.source === source.name);
  assert.deepEqual(targets.map(t => t.url), [source.url, `${source.url}aktion/good`, `${source.url}aktion/a`]);
  state.sources.KFC = { retryAt: new Date(+now + DAY).toISOString() };
  assert.equal(scanTargets(state, report, now).filter(t => t.source === source.name).length, 0);
});

test('empty-page cooldown does not hide a different promotion at the same merchant', () => {
  const state = empty(), a = `${source.url}aktion/a`, b = `${source.url}aktion/b`;
  rememberLinks(state, source, [a, b], now);
  applyYieldCooldown(state, [{ source: source.name, url: a, status: 'fetched', verifiedIncrementalCandidates: 0 }], now);
  const targets = scanTargets(state, power(), now).filter(t => t.source === source.name);
  assert.ok(!targets.some(t => t.url === a));
  assert.ok(targets.some(t => t.url === b));
  assert.equal(state.sources.KFC, undefined);
});

test('direct offers keep review evidence, discover child links, and do not consume reserved credits', async () => {
  const state = empty(), tasks = [{ provider: 'scrapingbee', source: source.name, url: source.url, cap: 5 }];
  state.reservations.push({ runId: '801', mode: 'scan', at: now.toISOString(), tasks });
  const output = await collectPlan({ runId: '801', mode: 'scan', tasks }, state, power(), { now,
    fetchPage: async () => ({ html: `<html><body><main><section><img alt="Aktion: Burger um 1 Euro in Wien" /></section></main><a href="${source.url}aktion/new">Aktion</a></body></html>`, finalUrl: source.url }),
    clientFor: () => { throw new Error('must-not-charge-for-direct-html'); }, verify: async deal => ({ ok: true, deal }),
  });
  assert.equal(output.results[0].status, 'direct-sufficient');
  assert.equal(output.candidates.length, 1);
  assert.equal(output.candidates[0].providerDiscovery.provider, 'direct');
  assert.equal(output.candidates[0].reviewRequired, true);
  assert.equal(output.candidates[0].approved, false);
  assert.deepEqual(state.reservations[0].unspent, [0]);
  assert.ok(state.discoveredPages.KFC.some(p => p.url === `${source.url}aktion/new`));
  assert.equal(freeBudget('scrapingbee', usages.scrapingbee, state, 900, now), '');
});

test('multi-page same-provider reservation never excludes a sibling allocation from cost checks', async () => {
  const state = empty(), tasks = [1, 2].map(n => ({ provider: 'scrapingbee', source: source.name, url: `${source.url}aktion/${n}`, cap: 5 }));
  state.reservations.push({ runId: '1', mode: 'scan', at: now.toISOString(),
    tasks: Array.from({ length: 179 }, () => ({ provider: 'scrapingbee', source: 'Burger King', cap: 5 })) });
  state.reservations.push({ runId: '802', mode: 'scan', at: now.toISOString(), tasks });
  let calls = 0;
  const output = await collectPlan({ runId: '802', mode: 'scan', tasks }, state, power(), { now,
    fetchPage: async url => ({ html: '<html><body>Welcome</body></html>', finalUrl: url }),
    clientFor: () => ({ usage: async () => usages.scrapingbee, scrape: async (_s, url) => { calls++; return { html: '<html><body>Welcome</body></html>', finalUrl: url, cost: 5 }; } }),
  });
  assert.equal(output.results[0].status, 'budget-stopped');
  assert.equal(calls, 1);
  assert.deepEqual(state.reservations.at(-1).unspent, [0]);
});

test('timeouts retain full allocation; runtime-stopped untouched tasks are released', async () => {
  const state = empty(), tasks = [{ provider: 'scrapingbee', source: source.name, cap: 5 }];
  state.reservations.push({ runId: '803', mode: 'scan', at: now.toISOString(), tasks });
  await collectPlan({ runId: '803', mode: 'scan', tasks }, state, power(), { now,
    fetchPage: async () => ({ html: '<html><body>Welcome</body></html>', finalUrl: source.url }),
    clientFor: () => ({ usage: async () => usages.scrapingbee, scrape: async () => { throw new Error('timeout'); } }),
  });
  assert.equal(state.reservations[0].unspent, undefined);
  assert.notEqual(freeBudget('scrapingbee', usages.scrapingbee, state, 900, now), '');
  const stopped = empty(); stopped.reservations.push({ runId: '804', mode: 'scan', at: now.toISOString(), tasks });
  const output = await collectPlan({ runId: '804', mode: 'scan', tasks }, stopped, power(), { now, maxRuntimeMs: 0,
    clientFor: () => { throw new Error('runtime-must-stop'); }, fetchPage: () => { throw new Error('runtime-must-stop'); } });
  assert.equal(output.results[0].status, 'runtime-stopped');
  assert.deepEqual(stopped.reservations[0].unspent, [0]);
  stopped.reservations[0].unspent.push(0);
  assert.throws(() => validateLedger(stopped), /invalid-unspent-allocation/);
});

test('real elapsed time crossing trial expiry stops before a charged request', async () => {
  const start = new Date(Date.parse(BEE_TRIAL_END) - 5000), state = empty();
  const tasks = [{ provider: 'scrapingbee', source: source.name, cap: 5 }];
  state.reservations.push({ runId: '805', mode: 'scan', at: start.toISOString(), tasks });
  let elapsed = 0;
  const output = await collectPlan({ runId: '805', mode: 'scan', tasks }, state,
    { ...power(), finishedAt: start.toISOString() }, { now: start, clock: () => elapsed,
      fetchPage: async () => ({ html: '<html><body>Welcome</body></html>', finalUrl: source.url }),
      clientFor: () => ({ usage: async () => { elapsed += 6000; return usages.scrapingbee; }, scrape: () => { throw new Error('expired'); } }),
    });
  assert.equal(output.results[0].status, 'budget-stopped');
});

test('usage checks respect Bee rate limits and ScraperAPI delayed credit accounting', async () => {
  for (const provider of ['scrapingbee', 'scraperapi']) {
    let time = 0; const waits = [], callTimes = [];
    const client = new FoodProviderClient(provider, { env: { SCRAPINGBEE: 'private', SCRAPINGAPI: 'private' },
      clock: () => time, sleep: async ms => { waits.push(ms); time += ms; },
      fetchImpl: async url => {
        if (String(url).includes('/usage') || String(url).includes('/account')) {
          callTimes.push(time); return new Response('{}');
        }
        return new Response('<html><body>Welcome</body></html>', { headers: { 'sa-final-url': source.url, 'sa-credit-cost': '10' } });
      } });
    if (provider === 'scrapingbee') {
      for (let i = 0; i < 8; i++) await client.usage();
      assert.equal(waits.length, 7);
      assert.ok(callTimes.slice(1).every((t, i) => t - callTimes[i] >= 13000));
    } else {
      await client.scrape(source); await client.usage(); assert.deepEqual(waits, [16000]);
    }
  }
});

test('canonical redirects do not spend a second provider allocation on the same page', async () => {
  const state = empty(), tasks = ['scrapingbee', 'scraperapi'].map((provider, i) => ({ provider,
    source: source.name, url: `${source.url}aktion/${i}`, cap: CAPS[provider] }));
  state.reservations.push({ runId: '806', mode: 'scan', at: now.toISOString(), tasks });
  let charged = 0;
  const page = { html: '<html><body>Welcome</body></html>', finalUrl: source.url, cost: 5 };
  const output = await collectPlan({ runId: '806', mode: 'scan', tasks }, state, power(), { now,
    fetchPage: async () => page,
    clientFor: provider => ({ usage: async () => usages[provider], scrape: async () => { charged++; return page; } }),
  });
  assert.equal(charged, 1);
  assert.equal(output.results[1].status, 'duplicate-final-url');
  assert.deepEqual(state.reservations[0].unspent, [1]);
});

test('documented cost refusal pauses its source, not the healthy provider; unknown 403 still stops globally', async () => {
  for (const message of ['This request exceeds your max_cost. secret-value', 'Forbidden secret-value']) {
    const client = new FoodProviderClient('scraperapi', { env: { SCRAPINGAPI: 'private' },
      fetchImpl: async () => new Response(message, { status: 403 }) });
    const state = empty(), tasks = [{ provider: 'scraperapi', source: source.name, cap: 10 }];
    state.reservations.push({ runId: '807', mode: 'scan', at: now.toISOString(), tasks });
    const output = await collectPlan({ runId: '807', mode: 'scan', tasks }, state, power(), { now,
      fetchPage: async () => ({ html: '<html><body>Welcome</body></html>', finalUrl: source.url }),
      clientFor: () => ({ usage: async () => usages.scraperapi, scrape: (...args) => client.scrape(...args) }),
    });
    assert.doesNotMatch(JSON.stringify(output), /secret-value|private/);
    assert.ok(state.sources.KFC.retryAt);
    assert.equal(Boolean(state.providerPauses.scraperapi), message.startsWith('Forbidden'));
    assert.equal(output.results[0].reason, message.startsWith('Forbidden') ? 'provider-http-403' : 'provider-cost-limit');
    assert.equal(state.reservations[0].unspent, undefined, 'failed requests remain conservatively charged');
  }
});

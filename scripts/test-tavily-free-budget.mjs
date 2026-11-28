import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverTikTokLinksViaTavily } from '../scraper/tiktok-public-index.js';
import { buildTavilyTikTokQueries } from '../scraper/tiktok-public-index-queries.js';
import {
  buildInstagramTavilyQuery, selectInstagramTavilyProductionQuery, updateInstagramTavilyCache,
} from '../scraper/instagram-tavily-index.js';

const apiKey = 'tvly-offline-budget-fixture';
const firstNovemberScan = new Date('2026-11-01T05:15:00Z');
const video = 'https://www.tiktok.com/@food.wien/video/7711008298236988694';
const otherVideo = 'https://www.tiktok.com/@food.wien/video/7709134021703339286';
const instagramPost = 'https://www.instagram.com/p/CafeWien123/';

function usage(account = {}, key = {}) {
  return { account: { current_plan: 'Researcher', plan_limit: 1000, plan_usage: 0,
    paygo_usage: 0, paygo_limit: null, ...account }, key: { usage: 0, limit: null, ...key } };
}

function fixture({
  now = firstNovemberScan, accountUsage = usage(), previous = {}, instagramIndex,
  getUsage = () => Response.json(accountUsage),
  search = () => Response.json({ results: [], usage: { credits: 1 } }),
} = {}) {
  const requests = [];
  const waits = [];
  const run = () => discoverTikTokLinksViaTavily({
    enabled: true, freePlanConfirmed: true, apiKey, previous, instagramIndex, clock: () => now,
    sleep: async ms => { waits.push(ms); },
    fetcher: async (url, options) => {
      assert.equal(options.redirect, 'error');
      assert.equal(options.credentials, 'omit');
      assert.equal(options.headers.Authorization, `Bearer ${apiKey}`);
      assert.ok(!Object.hasOwn(options.headers, 'X-Tavily-Access-Mode'));
      if (url === 'https://api.tavily.com/usage') {
        assert.equal(options.method, 'GET');
        requests.push({ url });
        return getUsage();
      }
      assert.equal(url, 'https://api.tavily.com/search');
      assert.equal(options.method, 'POST');
      const body = JSON.parse(options.body);
      assert.equal(body.search_depth, 'basic');
      assert.equal(body.max_age_hours, -1);
      assert.equal(body.auto_parameters, false);
      assert.equal(body.include_usage, true);
      assert.ok(!options.body.includes(apiKey));
      requests.push({ url, query: body.query, domains: body.include_domains });
      return search(requests.length - 1, body);
    },
  });
  return { requests, waits, run };
}

test('a Researcher plan spreads its free allowance across the current and remaining UTC scan slots', async () => {
  const queries = buildTavilyTikTokQueries(firstNovemberScan);
  const previous = { nextQueryIndex: queries.length - 1 };
  const f = fixture({ previous, search: attempt => Response.json({
    results: [{ url: attempt === 1 ? video : video.replace('@food.wien', '@alias.wien'), title: apiKey },
      { url: otherVideo + '?ref=test' }, { url: 'https://www.tiktok.com.invalid/@food.wien/video/7711008298236988694' }],
    usage: { credits: 1 },
  }) });
  const result = await f.run();
  assert.deepEqual(result.budget, { remainingCredits: 1000, remainingRunSlots: 60, plannedQueries: 17 });
  assert.equal(result.usageChecks, 1);
  assert.equal(result.attemptedQueries, 17);
  assert.equal(result.completedQueries, 17);
  assert.equal(result.reportedSearchCredits, 17);
  assert.equal(result.queriesWithCreditUsage, 17);
  assert.equal(result.indexRows, 51);
  assert.deepEqual(result.links, [video, otherVideo]);
  assert.equal(result.nextQueryIndex, 16);
  assert.deepEqual(f.requests.slice(1).map(row => row.query), [queries.at(-1), ...queries.slice(0, 16)]);
  assert.deepEqual(f.waits, Array(16).fill(1000));
  assert.equal(f.requests.length, 18);
  assert.ok(!JSON.stringify(result).includes(apiKey));
});

test('the smaller credit cap limits the scan, including the final slot of a UTC month', async () => {
  const accountUsage = usage({ current_plan: 'Free', plan_usage: 995, paygo_limit: 0 }, { usage: 17, limit: 20 });
  const early = fixture({ now: new Date('2026-11-30T17:14:00Z'), accountUsage });
  const final = fixture({ now: new Date('2026-11-30T17:15:00Z'), accountUsage });
  assert.deepEqual((await early.run()).budget, { remainingCredits: 3, remainingRunSlots: 2, plannedQueries: 2 });
  assert.deepEqual((await final.run()).budget, { remainingCredits: 3, remainingRunSlots: 1, plannedQueries: 3 });
  const exhausted = fixture({ accountUsage: usage({}, { usage: 20, limit: 20 }) });
  assert.equal((await exhausted.run()).status, 'free-credits-exhausted');
  assert.equal(exhausted.requests.length, 1);
});

test('a large remaining budget never sends more than the distinct current query plan', async () => {
  const now = new Date('2026-11-30T17:15:00Z');
  const uniqueQueries = [...new Set(buildTavilyTikTokQueries(now))];
  const f = fixture({ now });
  const result = await f.run();
  assert.equal(result.attemptedQueries, uniqueQueries.length);
  assert.deepEqual(f.requests.slice(1).map(row => row.query), uniqueQueries);
  assert.equal(result.nextQueryIndex, 0);
});

test('Instagram replaces one existing keyed slot and never enters the TikTok result set or cursor', async () => {
  const f = fixture({ instagramIndex: { enabled: true, previous: {} }, search: (index, body) =>
    Response.json({ results: body.include_domains[0] === 'instagram.com'
      ? [{ url: instagramPost + '?igsh=fixture', content: apiKey }, { url: video }, { url: 'https://instagram.com/tv/CafeWien123/' }]
      : index === 1 ? [{ url: video }, { url: instagramPost }] : [], usage: { credits: 1 } }),
  });
  const result = await f.run();
  assert.equal(result.budget.plannedQueries, 17);
  assert.equal(result.usageChecks, 1);
  assert.equal(result.attemptedQueries, 17);
  assert.equal(result.reportedSearchCredits, 17);
  assert.deepEqual(result.links, [video]);
  assert.equal(result.indexRows, 2);
  assert.equal(result.nextQueryIndex, 16);
  assert.deepEqual(f.requests.slice(1, -1).map(req => req.domains), Array(16).fill(['tiktok.com']));
  assert.deepEqual(f.requests.at(-1).domains, ['instagram.com']);
  assert.deepEqual(result.instagramIndex.links, [instagramPost]);
  assert.equal(result.instagramIndex.attemptedQueries, 1);
  assert.ok(!JSON.stringify(result).includes(apiKey));
  const narrow = fixture({ accountUsage: usage({ plan_usage: 999 }), instagramIndex: { enabled: true, previous: {} } });
  assert.equal((await narrow.run()).attemptedQueries, 1);
  assert.deepEqual(narrow.requests.at(-1).domains, ['tiktok.com']);
});

test('two successful ordinary Instagram slots on the same UTC day advance a separate persistent plan', async () => {
  const accountUsage = usage({ plan_usage: 900 });
  const ordinary = (previous, now = firstNovemberScan) => fixture({ now, accountUsage,
    previous: { nextQueryIndex: 7 }, instagramIndex: { enabled: true, previous } });
  const initial = { version: 1, nextRetryAt: '', lastProbeAt: '2026-10-30T13:50:00.000Z', links: [] };
  const first = ordinary(initial);
  const firstResult = await first.run();
  const firstState = updateInstagramTavilyCache(initial, firstResult, { now: firstNovemberScan });
  const evening = new Date('2026-11-01T17:15:00Z');
  const second = ordinary(firstState, evening);
  const secondResult = await second.run();
  const secondState = updateInstagramTavilyCache(firstState, secondResult, { now: evening });
  assert.equal(first.requests.at(-1).query, 'Wien Instagram öffentliche Beiträge oder Reels 1+1 Rabatt Restaurant Kaffee');
  assert.equal(second.requests.at(-1).query, 'Wien Instagram öffentliche Beiträge oder Reels gratis Essen und Getränke Neueröffnung');
  assert.equal(firstResult.instagramIndex.productionQueryId, 'vienna-bogo-restaurant-coffee');
  assert.equal(secondResult.instagramIndex.productionQueryId, 'vienna-opening-benefits');
  assert.equal(firstResult.instagramIndex.productionQueryPlanVersion, 1);
  assert.deepEqual(firstResult.instagramIndex.nextProductionQueryCursor, firstState.productionQueryCursor);
  assert.deepEqual(secondState.productionQueryCursor, { version: 1, nextTopicId: 'vienna-bogo-restaurant-coffee' });
  assert.equal(selectInstagramTavilyProductionQuery(secondState).query, first.requests.at(-1).query);
  assert.equal(secondState.lastProbeAt, initial.lastProbeAt);
  for (const [f, result] of [[first, firstResult], [second, secondResult]]) {
    assert.equal(f.requests.filter(row => row.domains?.[0] === 'instagram.com').length, 1);
    assert.equal(result.attemptedQueries, result.budget.plannedQueries);
    assert.equal(f.requests.length, 1 + result.budget.plannedQueries);
    assert.equal(result.reportedSearchCredits, result.budget.plannedQueries);
    assert.equal(result.nextQueryIndex, 7 + result.budget.plannedQueries - 1);
    assert.equal(result.instagramIndex.indexRows, 0);
  }
  assert.deepEqual(first.requests.slice(1, -1), second.requests.slice(1, -1), 'only the Instagram query rotates');
});

test('ordinary refusal, missing receipt, exhausted slot and legacy probe do not advance the Instagram plan', async () => {
  const cached = { version: 1, links: [], nextRetryAt: '', productionQueryCursor: { version: 1, nextTopicId: 'vienna-opening-benefits' } };
  for (const response of [
    () => new Response(null, { status: 429, headers: { 'Retry-After': '300' } }),
    () => Response.json({ results: [] }),
    () => Response.json({ results: [], usage: { credits: '1' } }),
    () => Response.json({ results: [], usage: { credits: 0 } }),
    () => Response.json({ results: [], usage: { credits: 2 } }),
  ]) {
    const f = fixture({ accountUsage: usage({ plan_usage: 900 }), instagramIndex: { enabled: true, previous: cached },
      search: (_, body) => body.include_domains[0] === 'instagram.com' ? response() : Response.json({ results: [], usage: { credits: 1 } }) });
    const outcome = await f.run();
    assert.equal(outcome.instagramIndex.productionQueryId, 'vienna-opening-benefits');
    assert.equal(outcome.instagramIndex.nextProductionQueryCursor, undefined);
    assert.equal(f.requests.filter(row => row.domains?.[0] === 'instagram.com').length, 1);
    assert.deepEqual(updateInstagramTavilyCache(cached, outcome, { now: firstNovemberScan }).productionQueryCursor,
      cached.productionQueryCursor);
  }
  const narrow = fixture({ accountUsage: usage({ plan_usage: 999 }), instagramIndex: { enabled: true, previous: cached } });
  const narrowResult = await narrow.run();
  assert.equal(narrowResult.instagramIndex, undefined);
  assert.equal(updateInstagramTavilyCache(cached, narrowResult, { now: firstNovemberScan }), null);
  const probe = fixture({ instagramIndex: { probe: true, previous: cached } });
  const probeResult = await probe.run();
  assert.equal(probe.requests[1].query, buildInstagramTavilyQuery(firstNovemberScan));
  assert.equal(probeResult.instagramIndex.productionQueryId, undefined);
  const probeState = updateInstagramTavilyCache(cached, probeResult, { now: firstNovemberScan, probe: true });
  assert.deepEqual(probeState.productionQueryCursor, cached.productionQueryCursor);
  assert.equal(probeState.lastProbeAt, firstNovemberScan.toISOString());
  const malformed = fixture({ instagramIndex: { enabled: true, previous: null } });
  assert.equal((await malformed.run()).status, 'shared-index-state-invalid');
  assert.equal(malformed.requests.length, 0);
});

test('Instagram diagnostics makes exactly one guarded query and shares provider holds', async () => {
  const instagramIndex = { probe: true, previous: {} };
  const f = fixture({ previous: { nextQueryIndex: 7 }, instagramIndex,
    search: () => Response.json({ class: 'throttle' }, { status: 429, headers: { 'Retry-After': '7200' } }) });
  const result = await f.run();
  assert.equal(result.budget.remainingCredits, 1000);
  assert.equal(result.attemptedQueries, 1);
  assert.equal(result.instagramIndex.attemptedQueries, 1);
  assert.equal(result.nextQueryIndex, 7);
  assert.deepEqual(f.requests[1].domains, ['instagram.com']);
  assert.equal(f.requests.length, 2);
  assert.equal(result.nextRetryAt, '2026-11-01T07:15:00.000Z');
  const held = fixture({ instagramIndex: { enabled: true, previous: { nextRetryAt: result.nextRetryAt } } });
  assert.equal((await held.run()).status, 'cooldown');
  assert.equal(held.requests.length, 0);
  const replay = fixture({ instagramIndex: { probe: true, previous: { lastProbeAt: firstNovemberScan.toISOString() } } });
  assert.equal((await replay.run()).status, 'probe-already-attempted');
  assert.equal(replay.requests.length, 0);
  const invalid = fixture({ instagramIndex, accountUsage: usage({ paygo_limit: 1 }) });
  assert.equal((await invalid.run()).status, 'free-plan-unverified');
  assert.equal(invalid.requests.length, 1);
  assert.equal((await discoverTikTokLinksViaTavily({ enabled: true, instagramIndex,
    fetcher: async () => assert.fail('diagnostics cannot fall back to keyless') })).status, 'key-missing');
});

test('a refused Instagram slot retains completed TikTok results and a shared provider deadline', async () => {
  const f = fixture({ accountUsage: usage({ plan_usage: 900 }), instagramIndex: { enabled: true, previous: {} },
    search: (_, body) => body.include_domains[0] === 'instagram.com'
      ? new Response(null, { status: 429, headers: { 'Retry-After': '300' } })
      : Response.json({ results: [{ url: video }], usage: { credits: 1 } }),
  });
  const result = await f.run();
  assert.equal(result.status, 'rate-limited');
  assert.equal(result.tikTokStatus, 'completed');
  assert.equal(result.nextRetryAt, '2026-11-01T05:20:00.000Z');
  assert.deepEqual(result.links, [video]);
  assert.equal(result.nextQueryIndex, 1);
});

test('a paid, overage-enabled or unverifiable usage response cannot start a search', async () => {
  const invalidUsage = [
    [usage({ current_plan: 'Project' }), 'account-plan-unrecognized'],
    [usage({ plan_limit: 4000 }), 'account-limit-unconfirmed'],
    [usage({ plan_usage: '25' }), 'account-usage-invalid'],
    [usage({ paygo_usage: 1 }), 'paygo-not-confirmed-off'],
    [usage({ paygo_limit: 50 }), 'paygo-not-confirmed-off'],
    [usage({ paygo_limit: undefined }), 'paygo-not-confirmed-off'],
    [usage({}, { limit: '1000' }), 'key-usage-invalid'],
    [{ account: { current_plan: apiKey } }, 'account-plan-unrecognized'],
  ];
  for (const [accountUsage, reason] of invalidUsage) {
    const f = fixture({ accountUsage });
    const result = await f.run();
    assert.equal(result.status, 'free-plan-unverified');
    assert.equal(result.budgetRefusalReason, reason);
    assert.equal(result.attemptedQueries, 0);
    assert.equal(f.requests.length, 1);
    assert.ok(!JSON.stringify(result).includes(apiKey));
  }
});

test('a partial search refusal preserves links and resumes the same failed query after the hold', async () => {
  const f = fixture({ previous: { nextQueryIndex: 7 }, search: attempt => attempt === 3
    ? Response.json({ error: apiKey }, { status: 429, headers: { 'Retry-After': '7200' } })
    : Response.json({ results: [{ url: attempt === 1 ? video : otherVideo }], usage: { credits: 1 } }),
  });
  const result = await f.run();
  assert.equal(result.status, 'rate-limited');
  assert.equal(result.attemptedQueries, 3);
  assert.equal(result.completedQueries, 2);
  assert.equal(result.reportedSearchCredits, 2);
  assert.equal(result.nextRetryAt, '2026-11-01T07:15:00.000Z');
  assert.equal(result.nextQueryIndex, 9);
  assert.deepEqual(result.links, [video, otherVideo]);
  assert.equal(f.requests.length, 4);
  assert.ok(!JSON.stringify(result).includes(apiKey));
  const held = fixture({ previous: result });
  assert.equal((await held.run()).status, 'cooldown');
  assert.equal(held.requests.length, 0);
  const resumed = fixture({ previous: result, now: new Date(result.nextRetryAt) });
  assert.equal((await resumed.run()).queryIndex, 9);
});

test('usage rate limits and unexpectedly expensive Basic searches terminate the keyed execution', async () => {
  const usageLimited = fixture({
    getUsage: () => Response.json({ error: apiKey }, { status: 429, headers: { 'Retry-After': '300' } }),
  });
  const held = await usageLimited.run();
  assert.equal(held.nextRetryAt, '2026-11-01T05:20:00.000Z');
  assert.equal(held.usageHttpStatus, 429);
  assert.equal(held.attemptedQueries, 0);
  assert.equal(usageLimited.requests.length, 1);
  const expensive = fixture({ search: () => Response.json({ results: [{ url: video }], usage: { credits: 2 } }) });
  const result = await expensive.run();
  assert.equal(result.status, 'unexpected-search-credit-cost');
  assert.equal(result.reportedSearchCredits, 2);
  assert.equal(result.attemptedQueries, 1);
  assert.equal(expensive.requests.length, 2);
  assert.deepEqual(result.links, [video]);
});

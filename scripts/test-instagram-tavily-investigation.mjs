import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { investigateInstagramTavily, INSTAGRAM_TAVILY_INVESTIGATION,
  INSTAGRAM_TAVILY_INVESTIGATION_STATE } from '../scraper/instagram-tavily-investigation.js';
import { INSTAGRAM_TAVILY_SOURCE, updateInstagramTavilyCache } from '../scraper/instagram-tavily-index.js';
import { discoverTikTokLinksViaTavily } from '../scraper/tiktok-public-index.js';

const now = new Date('2026-11-27T23:15:00Z');
const lastProbeAt = '2026-11-27T22:38:00.124Z';
const apiKey = 'tvly-offline-credential-never-log';
const privateText = 'provider result snippet and untrusted metadata';
const firstPost = 'https://www.instagram.com/p/CafeWien123/';
const secondPost = 'https://www.instagram.com/reel/BarWien123/';
const previous = Object.freeze({ nextQueryIndex: 47, nextRetryAt: '' });
const cache = Object.freeze({ version: 1, nextRetryAt: '', lastProbeAt, links: Object.freeze([]) });
const service = 'https://api.tavily.com';

function usage(account = {}, key = {}) {
  return { account: { current_plan: 'Researcher', plan_limit: 1000, plan_usage: 0,
    paygo_usage: 0, paygo_limit: null, ...account }, key: { usage: 0, limit: null, ...key } };
}

function search(results = [], credits = 1) {
  return Response.json({ results, usage: { credits } });
}

function fixture({
  clock = () => now,
  getUsage = () => Response.json(usage()),
  getSearch = () => search(),
  ...options
} = {}) {
  const requests = [];
  const waits = [];
  const run = () => investigateInstagramTavily({
    freePlanConfirmed: true, apiKey, previous, cache, clock,
    sleep: async ms => { waits.push(ms); },
    fetcher: async (url, request) => {
      const body = request.body && JSON.parse(request.body);
      requests.push({ url, request, body });
      return url === service + '/usage' ? getUsage() : getSearch(requests.length - 1);
    },
    ...options,
  });
  return { run, requests, waits };
}

test('a single live usage check admits at most four paced Basic variants with fixed domains', async () => {
  const f = fixture({
    getSearch: attempt => {
      const row = { url: firstPost + '?private=' + apiKey, title: privateText,
        content: apiKey, raw_content: privateText, published_date: privateText };
      if (attempt === 1) return search([row, { ...row, url: firstPost }, { ...row, url: 'https://www.instagram.com/merchant/' }]);
      if (attempt === 3) return search([{ ...row, url: 'https://instagram.com.evil.invalid/p/CafeWien123/' }]);
      return search(attempt === 4 ? [{ ...row, url: secondPost }] : []);
    },
  });
  const result = await f.run();
  assert.equal(result.status, 'completed');
  assert.equal(result.usageChecks, 1);
  assert.equal(result.usageHttpStatus, 200);
  assert.equal(result.attemptedQueries, 4);
  assert.equal(result.reportedSearchCredits, 4);
  assert.deepEqual(f.waits, [1000, 1000, 1000]);
  assert.deepEqual(f.requests.map(row => [row.request.method, row.url]),
    [['GET', service + '/usage'], ...Array.from({ length: 4 }, () => ['POST', service + '/search'])]);
  for (const { request } of f.requests) {
    assert.equal(request.redirect, 'error');
    assert.equal(request.credentials, 'omit');
    assert.equal(request.headers.Authorization, 'Bearer ' + apiKey);
    assert.ok(request.signal instanceof AbortSignal);
    assert.ok(!request.body?.includes(apiKey));
  }
  const [baseline, short, allDates, providerDefault] = f.requests.slice(1).map(row => row.body);
  const { query: baselineQuery, ...baselineControls } = baseline;
  const { query: shortQuery, ...shortControls } = short;
  const { time_range: dateWindow, ...shortWithoutDates } = short;
  const { max_age_hours: ageHours, ...allDatesWithoutCacheOverride } = allDates;
  assert.equal(baselineQuery, 'Wien Instagram öffentliche Beiträge oder Reels gratis Essen und Getränke Neueröffnung');
  assert.equal(shortQuery, 'Wien gratis Essen');
  assert.deepEqual(baselineControls, shortControls);
  assert.equal(dateWindow, 'week');
  assert.deepEqual(allDates, shortWithoutDates);
  assert.equal(ageHours, -1);
  assert.deepEqual(providerDefault, allDatesWithoutCacheOverride);
  for (const body of [baseline, short, allDates, providerDefault]) {
    assert.equal(body.search_depth, 'basic');
    assert.equal(body.country, 'austria');
    assert.equal(body.max_results, 20);
    assert.deepEqual(body.include_domains, ['instagram.com']);
    assert.equal(body.include_answer, false);
    assert.equal(body.include_raw_content, false);
    assert.equal(body.auto_parameters, false);
    assert.equal(body.include_usage, true);
  }
  assert.deepEqual(result.comparisons.map(row => [row.id, row.indexRows, row.canonicalPublicLinks, row.excludedRows]),
    [['production-baseline', 3, 1, 1], ['short-query', 0, 0, 0], ['short-query-all-dates', 1, 0, 1],
      ['short-query-provider-default-cache', 1, 1, 0]]);
  assert.deepEqual(result.links, [firstPost, secondPost]);
  assert.ok(!JSON.stringify(result).includes(apiKey));
  assert.ok(!JSON.stringify(result).includes(privateText));
  assert.equal(previous.nextQueryIndex, 47);
  assert.equal(cache.lastProbeAt, lastProbeAt);
  assert.deepEqual(cache.links, []);
  const nextUtcDay = fixture({ clock: () => new Date('2026-11-28T00:01:00Z') });
  await nextUtcDay.run();
  assert.equal(nextUtcDay.requests[1].body.query, baselineQuery);
});

test('the live account, key and ordinary remaining-slot budgets can each curtail the comparison', async () => {
  const cases = [
    { account: { plan_usage: 1000 }, key: {}, status: 'free-credits-exhausted', searches: 0 },
    { account: { plan_usage: 987 }, key: { usage: 99, limit: 100 }, status: 'budget-limited', searches: 1 },
    { account: { plan_usage: 987 }, key: {}, status: 'budget-limited', searches: 2 },
  ];
  for (const { account, key, status, searches } of cases) {
    const f = fixture({ getUsage: () => Response.json(usage(account, key)) });
    const result = await f.run();
    assert.equal(result.status, status);
    assert.equal(result.attemptedQueries, searches);
    assert.equal(f.requests.length, searches + 1);
    assert.equal(f.requests[0].request.method, 'GET');
    assert.equal(f.waits.length, Math.max(0, searches - 1));
  }
});

test('requires confirmed keyed Researcher or Free access without activated overage', async () => {
  const notConfirmed = fixture({ freePlanConfirmed: false });
  assert.equal((await notConfirmed.run()).status, 'free-plan-unconfirmed');
  assert.deepEqual(notConfirmed.requests, []);
  const noKey = fixture({ apiKey: '' });
  assert.equal((await noKey.run()).status, 'key-missing');
  assert.deepEqual(noKey.requests, []);
  for (const [account, key, reason] of [
    [{ current_plan: 'Project' }, {}, 'account-plan-unrecognized'],
    [{ plan_limit: 4000 }, {}, 'account-limit-unconfirmed'],
    [{ paygo_limit: 1 }, {}, 'paygo-not-confirmed-off'],
    [{ paygo_usage: 1 }, {}, 'paygo-not-confirmed-off'],
    [{}, { usage: '0' }, 'key-usage-invalid'],
  ]) {
    const f = fixture({ getUsage: () => Response.json(usage(account, key)) });
    const result = await f.run();
    assert.equal(result.status, 'free-plan-unverified');
    assert.equal(result.budgetRefusalReason, reason);
    assert.equal(result.attemptedQueries, 0);
    assert.deepEqual(f.requests.map(row => row.request.method), ['GET']);
  }
});

test('the longest shared Tavily hold blocks even usage and malformed state fails closed', async () => {
  const nextDay = '2026-11-28T23:15:00.000Z';
  const later = '2026-11-29T23:15:00.000Z';
  const latest = '2026-11-30T23:15:00.000Z';
  for (const deadlines of [[nextDay, latest, later], [latest, nextDay, later]]) {
    const f = fixture({ previous: { nextRetryAt: deadlines[0] }, cache: { ...cache, nextRetryAt: deadlines[1] },
      instagramHoldUntil: deadlines[2] });
    const result = await f.run();
    assert.equal(result.status, 'cooldown');
    assert.equal(result.nextRetryAt, latest);
    assert.deepEqual(f.requests, []);
  }
  for (const options of [{ cache: null }, { previous: { nextRetryAt: 'invalid' } },
    { cache: { ...cache, nextRetryAt: 'invalid' } }, { instagramHoldUntil: 'invalid' }]) {
    const f = fixture(options);
    assert.equal((await f.run()).status, 'shared-index-state-invalid');
    assert.deepEqual(f.requests, []);
  }
});

test('an Instagram website hold blocks verification without poisoning the Tavily and TikTok hold', async () => {
  const instagramHoldUntil = '2026-11-28T16:00:00.000Z';
  const f = fixture({ instagramHoldUntil });
  const result = await f.run();
  assert.equal(result.status, 'instagram-access-paused');
  assert.equal(result.instagramNextRetryAt, instagramHoldUntil);
  assert.equal(result.nextRetryAt, '');
  assert.deepEqual(f.requests, []);
  assert.equal(updateInstagramTavilyCache(cache, { nextRetryAt: result.nextRetryAt,
    instagramIndex: { attemptedQueries: result.attemptedQueries, links: result.links } }, { now }), null);
});

test('retry-after stops immediately and carries to the shared reader without changing the old probe', async () => {
  const getThrottle = () => Response.json({ error: apiKey }, { status: 429, headers: { 'Retry-After': '7200' } });
  const first = fixture({ getUsage: getThrottle });
  const refusedAtUsage = await first.run();
  assert.equal(refusedAtUsage.status, 'rate-limited');
  assert.equal(refusedAtUsage.usageHttpStatus, 429);
  assert.equal(refusedAtUsage.nextRetryAt, '2026-11-28T01:15:00.000Z');
  assert.equal(first.requests.length, 1);
  assert.equal(refusedAtUsage.attemptedQueries, 0);
  const partial = fixture({ getSearch: i => i === 2 ? getThrottle() : search([{ url: firstPost }]) });
  const report = await partial.run();
  assert.equal(report.status, 'rate-limited');
  assert.equal(report.attemptedQueries, 2);
  assert.equal(report.reportedSearchCredits, 1);
  assert.equal(report.comparisons[1].reportedSearchCredits, null);
  assert.equal(report.comparisons[1].httpStatus, 429);
  assert.equal(report.nextRetryAt, '2026-11-28T01:15:00.000Z');
  assert.deepEqual(partial.waits, [1000]);
  assert.equal(partial.requests.length, 3);
  assert.deepEqual(report.links, [firstPost]);
  assert.ok(!JSON.stringify(report).includes(apiKey));
  const updated = updateInstagramTavilyCache(cache, { nextRetryAt: report.nextRetryAt,
    instagramIndex: { attemptedQueries: report.attemptedQueries, links: report.links } }, { now });
  assert.equal(updated.lastProbeAt, lastProbeAt);
  assert.equal(updated.nextRetryAt, report.nextRetryAt);
  assert.deepEqual(updated.links, [{ url: firstPost, source: INSTAGRAM_TAVILY_SOURCE, indexedAt: now.toISOString() }]);
  let networkCalls = 0;
  const normal = await discoverTikTokLinksViaTavily({ enabled: true, freePlanConfirmed: true, apiKey,
    previous, instagramIndex: { enabled: true, previous: updated }, clock: () => now,
    fetcher: async () => { networkCalls++; throw new Error('network is disabled in this test'); } });
  assert.equal(networkCalls, 0);
  assert.equal(normal.status, 'cooldown');
  assert.equal(normal.nextQueryIndex, previous.nextQueryIndex);
  const oldProbe = await discoverTikTokLinksViaTavily({ enabled: true, freePlanConfirmed: true, apiKey,
    previous, instagramIndex: { probe: true, previous: updated }, clock: () => now,
    fetcher: async () => { networkCalls++; throw new Error('network is disabled in this test'); } });
  assert.equal(networkCalls, 0);
  assert.equal(oldProbe.status, 'probe-already-attempted');
});

test('an abnormal or absent Basic credit receipt stops before the next comparison and discards its links', async () => {
  for (const receipt of [2, 0, '1', { leaked: apiKey }, null, undefined]) {
    const f = fixture({ getSearch: () => Response.json({ results: [{ url: firstPost }], usage: { credits: receipt } }) });
    const result = await f.run();
    assert.equal(result.status, 'unexpected-search-credit-cost');
    assert.equal(result.attemptedQueries, 1);
    assert.equal(f.requests.length, 2);
    assert.deepEqual(f.waits, []);
    assert.deepEqual(result.links, []);
    assert.equal(result.nextRetryAt, '2026-11-28T23:15:00.000Z');
    assert.equal(result.comparisons[0].reportedSearchCredits, typeof receipt === 'number' ? receipt : null);
    assert.equal(result.reportedSearchCredits, receipt === 2 ? 2 : 0);
    assert.ok(!JSON.stringify(result).includes(apiKey));
  }
});

test('claim is persisted once and refuses another workflow run and a retry', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'instagram-tavily-investigation-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, INSTAGRAM_TAVILY_INVESTIGATION_STATE);
  const output = path.join(directory, 'github-output');
  const script = fileURLToPath(new URL('./check-instagram-tavily-investigation.mjs', import.meta.url));
  const invoke = (action, env = {}) => spawnSync(process.execPath, [script, action], {
    cwd: directory, encoding: 'utf8', env: {
      GITHUB_REF: 'refs/heads/main', GITHUB_RUN_ATTEMPT: '1', GITHUB_RUN_ID: '123456',
      GITHUB_OUTPUT: output, ...env,
    },
  });
  const claim = invoke('--claim');
  assert.equal(claim.status, 0, claim.stderr);
  const original = fs.readFileSync(file, 'utf8');
  const persisted = JSON.parse(original);
  assert.equal(persisted.investigation, INSTAGRAM_TAVILY_INVESTIGATION);
  assert.equal(persisted.status, 'claimed');
  assert.equal(persisted.runId, '123456');
  assert.ok(Number.isFinite(Date.parse(persisted.claimedAt)));
  assert.equal(persisted.maximumSearchRequests, 4);
  assert.equal(fs.readFileSync(output, 'utf8'), 'claimed=true\n');
  const second = invoke('--claim', { GITHUB_RUN_ID: '654321' });
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /already claimed/);
  assert.equal(invoke('--run', { GITHUB_RUN_ID: '654321' }).status, 1);
  assert.equal(invoke('--run', { GITHUB_RUN_ATTEMPT: '2' }).status, 1);
  assert.equal(invoke('--run', { GITHUB_REF: 'refs/heads/topic' }).status, 1);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  assert.equal(fs.readFileSync(output, 'utf8'), 'claimed=true\n');
  assert.equal(fs.existsSync(path.join(directory, 'output')), false);
  assert.equal(invoke('--run').status, 1);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  assert.equal(fs.existsSync(path.join(directory, 'output')), false);

  const seed = (name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value));
  fs.mkdirSync(path.join(directory, 'docs'));
  seed('source-state/instagram-tavily-index.json', cache);
  seed('docs/tiktok-scanner-report.json', { tavilyDiscovery: previous });
  seed('docs/instagram-ai-report.json', {});
  seed('docs/instagram-auth-health.json', {});
  const relatedHold = new Date(Date.now() + 3_600_000).toISOString();
  seed('docs/instagram-discovery-report.json', { webAccess: { all: { nextRetryAt: relatedHold, reason: 'http-429' } } });
  const cacheBefore = fs.readFileSync(path.join(directory, 'source-state/instagram-tavily-index.json'), 'utf8');
  const run = invoke('--run');
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(run.stdout);
  assert.equal(report.status, 'instagram-access-paused');
  assert.equal(report.usageChecks, 0);
  assert.equal(report.attemptedQueries, 0);
  assert.equal(report.instagramNextRetryAt, relatedHold);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).status, 'instagram-access-paused');
  assert.equal(fs.readFileSync(path.join(directory, 'source-state/instagram-tavily-index.json'), 'utf8'), cacheBefore);
  assert.equal(invoke('--run').status, 1);
});

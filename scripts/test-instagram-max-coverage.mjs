import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { selectCoverageAccounts, selectCoverageHashtags, accountCoverageSummary, accountRescanHours } from '../scraper/instagram-source-scheduler.js';
import { buildConfig, loadAccountCatalog, runMetaInstagramCollector, isGlobalMetaGraphError } from '../scraper/meta-instagram-deals.js';
import { selectDiscoveryAccounts } from '../scraper/vienna-merchant-discovery.js';
import { createSharedQuotaFetch } from '../scraper/instagram-shared-quota.js';

const HOUR = 3600000;
const start = new Date('2026-10-07T08:00:00Z');
const config = { ...buildConfig({}, start), coverageMode: true, discoveryPoolLimit: 5000, maxAccountsPerRun: 180, foodAccountShare: 0.9, maxHashtagsPerRun: 8 };
assert.equal(isGlobalMetaGraphError({ status: 400, code: 100, message: 'Object does not exist or cannot be loaded due to missing permissions' }), false);
assert.equal(isGlobalMetaGraphError({ status: 400, code: 803, message: 'Some of the aliases you requested do not exist' }), false);
for (const code of [10, 190, 613, 80002]) assert.equal(isGlobalMetaGraphError({ status: 400, code }), true);
const merchants = Array.from({ length: 891 }, (_, index) => ({
  username: `new.cafe${String(index).padStart(4, '0')}`, accountType: 'merchant', category: 'food', priority: 25,
  evidenceKind: 'directory-and-website-link', discoveryEvidenceKind: 'directory-and-website-link', origins: ['vienna-directory'],
  merchants: [{ merchant: `Cafe ${index}`, postcode: String(1010 + index % 23 * 10) }],
}));
const proven = Array.from({ length: 30 }, (_, index) => ({ username: `proven${index}`, accountType: 'merchant', category: 'food', manualApprovedDeals: 10, priority: 104 }));
const scouts = Array.from({ length: 15 }, (_, index) => ({ username: `scout${index}`, accountType: 'creator', category: 'food', scoutApprovedDeals: 2 }));
const other = Array.from({ length: 20 }, (_, index) => ({ username: `other${index}`, accountType: 'merchant', category: 'shopping' }));
const accounts = [...merchants, ...proven, ...scouts, ...other];
const state = { accountPerformance: Object.fromEntries(proven.map((account) => [account.username, { lastRunAt: new Date(+start - 6 * HOUR).toISOString(), runs: 20, recentFetched: 100, recentNewAccepted: 2 }])) };
const first = selectCoverageAccounts(accounts, config, state, start);
assert.equal(first.length, 180);
assert(first.filter((account) => account.selectionLane === 'first-check').length >= 90);
assert(first.some((account) => account.selectionLane === 'proven-food'));
assert(first.some((account) => account.selectionLane === 'food-scout'));
assert(first.slice(0, 3).some((account) => account.selectionLane === 'first-check'));
assert(new Set(first.filter((account) => account.selectionLane === 'first-check').slice(0, 23).map((account) => account.merchants[0].postcode)).size >= 20);
assert.equal(new Set(first.map((account) => account.username)).size, first.length);

// A partial hourly run must still traverse the entire large directory. Only
// actually attempted accounts update the state, not the unspent planned tail.
const visited = new Set();
for (let hour = 0; hour < 48; hour += 1) {
  const now = new Date(+start + hour * HOUR);
  const selected = selectCoverageAccounts(accounts, config, state, now).slice(0, 80);
  for (const account of selected) {
    if (account.origins?.includes('vienna-directory')) visited.add(account.username);
    const previous = state.accountPerformance[account.username] || {};
    state.accountPerformance[account.username] = { ...previous, runs: Number(previous.runs || 0) + 1, lastRunAt: now.toISOString() };
  }
}
assert.equal(visited.size, 891, 'priority incumbents cannot starve directory first checks');
assert.equal(accountCoverageSummary(accounts, state.accountPerformance, new Date(+start + 48 * HOUR)).directoryUnchecked, 0);
assert.equal(accountRescanHours({ ...merchants[0], manualRejectedDeals: 3 }, {}, start), 168);
assert.equal(accountRescanHours(merchants[0], { runs: 8, accepted: 0 }, start), 72);
assert.equal(selectCoverageAccounts([merchants[0]], config, { accountPerformance: { [merchants[0].username]: { lastRunAt: start.toISOString() } } }, start).length, 0);
assert.equal(selectDiscoveryAccounts({ generatedAt: start.toISOString(), accounts: merchants }, start, 5000).length, 891);

const tagState = { hashtagPerformance: {
  wienkaffee: { recentFetched: 100, recentNewAccepted: 4, lastRunAt: new Date(+start - 4 * HOUR).toISOString() },
  wienrabatt: { recentFetched: 0, runs: 10, lastRunAt: start.toISOString() },
} };
const pool = ['wienkaffee', 'wienrabatt', 'wiengastro', 'wienessen', 'wien', 'vienna', 'gratisinwien', 'wienaktion', 'viennaeats', 'wienangebote'];
const tags = selectCoverageHashtags(pool, config, tagState, start);
assert(tags.includes('wienkaffee'));
assert(!tags.includes('wienrabatt'));
assert(tags.filter((tag) => ['wien', 'vienna'].includes(tag)).length <= 1);
assert(tags.every((tag) => pool.includes(tag)));

const makeStore = () => {
  let state = { version: 1, reservations: [], pausedUntil: 0 }; let revision = 0;
  return { async read() { return { state: structuredClone(state), revision }; },
    async compareAndSwap(expected, next) { if (expected !== revision) return false; state = structuredClone(next); revision += 1; return true; } };
};
let now = +start;
let store = makeStore(); let calls = 0;
const fetch = async () => { calls += 1; return Response.json({}); };
const worker = () => createSharedQuotaFetch(fetch, { store, clock: () => now, maxRequestsPerHour: 190, usageThreshold: 95 });
const a = worker(), b = worker();
for (let index = 0; index < 95; index += 1) await Promise.all([a('unused'), b('unused')]);
assert.equal(calls, 190);
await assert.rejects(worker()('unused'), { code: 'SCAN_BUDGET' });
assert.equal(calls, 190);
now += HOUR;
const waiting = createSharedQuotaFetch(fetch, { store, clock: () => now, maxRequestsPerHour: 190, waitForBudgetMs: 360000, sleep: async (ms) => { now += ms; } });
await waiting('unused');
assert(waiting.quotaStats.waitedMs <= 360000);
assert.equal(calls, 191);
store = makeStore();
const started = [];
const paced = createSharedQuotaFetch(async () => { started.push(now); return Response.json({}); }, {
  store, clock: () => now, minRequestIntervalMs: 15000, sleep: async (ms) => { now += ms; },
});
await Promise.all([paced('unused'), paced('unused'), paced('unused')]);
assert.deepEqual(started.map((at) => at - started[0]), [0, 15000, 30000]);
store = makeStore();
await createSharedQuotaFetch(async () => Response.json({}, { headers: { 'x-app-usage': '{"call_count":30,"total_cputime":95}' } }), { store, clock: () => now, usageThreshold: 95 })('unused');
assert.equal((await store.read()).state.pausedUntil, now + 10 * 60000);
await assert.rejects(createSharedQuotaFetch(fetch, { store, clock: () => now })('unused'), { code: 'SCAN_BUDGET' });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-max-coverage-'));
try {
  const write = (name, data) => { const file = path.join(dir, name); fs.writeFileSync(file, JSON.stringify(data)); return file; };
  const paths = { watchlistPath: write('watch.json', { accounts: [] }), registryPath: write('registry.json', { accounts: [] }), discoveryPath: write('directory.json', { generatedAt: start.toISOString(), accounts: merchants }), candidatePaths: [] };
  const catalog = loadAccountCatalog({ ...config, scanNow: start }, paths, {});
  assert.equal(catalog.length, 891);
  assert(catalog.every((account) => account.verifiedVienna === false));
  assert(catalog.every((account) => account.discoveryEvidenceKind === 'directory-and-website-link'));
  const historical = Object.fromEntries(merchants.slice(0, 600).map((account) => [account.username, { lastRunAt: start.toISOString(), runs: 1 }]));
  const testConfig = { ...config, instagramAccessToken: 'FAKE', instagramUserId: '123', hashtags: ['wienkaffee', 'wiengastro'], maxGraphRequests: 30, maxRetries: 0,
    statePath: write('state.json', {}), outputPath: path.join(dir, 'pending.json'), reportPath: path.join(dir, 'report.json'), mediaOcrEnabled: false, mediaLlmEnabled: false, mediaVisionEnabled: false };
  const requests = [];
  const result = await runMetaInstagramCollector({ config: testConfig, env: {}, now: start, paths, write: false, fetchImpl: async (url) => {
    const parsed = new URL(url); requests.push(parsed);
    if (parsed.pathname.endsWith('/ig_hashtag_search')) return Response.json({ data: [{ id: `tag-${parsed.searchParams.get('q')}` }] });
    if (parsed.pathname.endsWith('/recent_media')) return Response.json({ data: [] });
    const username = parsed.searchParams.get('fields').match(/username\(([^)]+)\)/)[1];
    return Response.json({ business_discovery: { username, name: 'Cafe', media: { data: [] } } });
  } });
  assert.equal(result.shouldFail, false);
  assert(requests.some((url) => url.pathname.endsWith('/recent_media')), 'account breadth cannot starve reserved hashtag calls');
  assert(requests.length <= 30);
  assert.equal(requests.length, 30, 'unused hashtag reservations return to merchant discovery');
  assert(result.report.accountCoverage.firstChecksThisRun > 0);
  assert(result.report.accountCoverage.directoryUnchecked < 891);
  assert.equal(Object.keys(result.state.accountPerformance).length, result.report.selectedAccounts.length);
  let blockedUsername = '';
  const oneUnavailable = await runMetaInstagramCollector({ config: { ...testConfig, hashtags: [], maxAccountsPerRun: 3 }, env: {}, now: start, paths, write: false, fetchImpl: async (url) => {
    const username = new URL(url).searchParams.get('fields').match(/username\(([^)]+)\)/)[1];
    blockedUsername ||= username;
    if (username === blockedUsername) return Response.json({ error: { code: 100, message: 'Object cannot be loaded due to missing permissions' } }, { status: 400 });
    return Response.json({ business_discovery: { username, media: { data: [] } } });
  } });
  assert.equal(oneUnavailable.shouldFail, false);
  assert.equal(oneUnavailable.report.sources.instagramGraph.successfulAccounts, 3);
  assert.equal(oneUnavailable.report.sources.instagramGraph.globalError, null);
  assert(oneUnavailable.state.sourceFailures.accounts[blockedUsername].cooldownUntil);
  write('state.json', { accountPerformance: historical });
  const largeState = await runMetaInstagramCollector({ config: testConfig, env: {}, now: start, paths, write: false, fetchImpl: async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/ig_hashtag_search')) return Response.json({ data: [{ id: `tag-${parsed.searchParams.get('q')}` }] });
    if (parsed.pathname.endsWith('/recent_media')) return Response.json({ data: [] });
    const username = parsed.searchParams.get('fields').match(/username\(([^)]+)\)/)[1];
    return Response.json({ business_discovery: { username, media: { data: [] } } });
  } });
  assert(Object.keys(largeState.state.accountPerformance).length > 600, 'coverage history must not truncate to 500 accounts and revive already scanned leads');
  const retained = { lastUpdated: start.toISOString(), deals: [{ id: 'last-good' }] };
  write('pending.json', retained);
  const deferred = await runMetaInstagramCollector({ config: testConfig, env: {}, now: start, paths, write: false, fetchImpl: async () => { throw Object.assign(new Error('shared cooldown'), { code: 'SCAN_BUDGET' }); } });
  assert.equal(deferred.shouldFail, false);
  assert.equal(deferred.report.sources.instagramGraph.budgetDeferred, true);
  assert.equal(deferred.report.selectedAccounts.length, 0);
  assert.equal(deferred.payload.deals[0].id, 'last-good');
  let attempts = 0;
  const partialEmpty = await runMetaInstagramCollector({ config: testConfig, env: {}, now: start, paths, write: false, fetchImpl: async () => {
    if (attempts++ >= 3) throw Object.assign(new Error('shared budget exhausted'), { code: 'SCAN_BUDGET' });
    return Response.json({ business_discovery: { media: { data: [] } } });
  } });
  assert.equal(partialEmpty.report.selectedAccounts.length, 3);
  assert.equal(Object.keys(partialEmpty.state.accountPerformance).length, 603, 'an empty but successful query must keep progress when a later shared pause occurs');
  assert.equal(partialEmpty.payload.deals[0].id, 'last-good');
  write('state.json', { accountPerformance: historical, mediaLlmUsage: [
    { at: new Date(+start - 2 * HOUR).toISOString(), calls: 47 },
    { at: new Date(+start - 25 * HOUR).toISOString(), calls: 99 },
  ] });
  const dailyBounded = await runMetaInstagramCollector({ config: { ...testConfig, maxAccountsPerRun: 1, hashtags: [], mediaLlmMaxCallsPerRun: 6 }, env: {}, now: start, paths, write: false,
    fetchImpl: async () => Response.json({ business_discovery: { media: { data: [] } } }),
    enrichGraphMedia: async (entries, config) => {
      assert.equal(config.mediaLlmMaxCallsPerRun, 1);
      return { entries, cache: {}, report: { aiCalls: 1 } };
    },
  });
  assert.equal(dailyBounded.report.mediaClassificationBudget.remaining, 0);
  assert.equal(dailyBounded.state.mediaLlmUsage.reduce((sum, row) => sum + row.calls, 0), 48);
  write('state.json', dailyBounded.state);
  await runMetaInstagramCollector({ config: { ...testConfig, maxAccountsPerRun: 1, hashtags: [] }, env: {}, now: start, paths, write: false,
    fetchImpl: async () => Response.json({ business_discovery: { media: { data: [] } } }),
    enrichGraphMedia: async (entries, config) => {
      assert.equal(config.mediaLlmMaxCallsPerRun, 0, 'daily exhaustion must not reset with a new process');
      return { entries, cache: {}, report: { aiCalls: 0 } };
    },
  });
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
console.log('Maximum Instagram coverage: 891-account starvation simulation, fair lanes, hashtag rotation, shared 190-call ceiling, CPU headroom, budget waiting and collector integration passed');

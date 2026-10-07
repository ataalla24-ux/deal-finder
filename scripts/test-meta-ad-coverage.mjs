import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanAdLibraryCoverage, hasFreshActiveAdEvidence } from '../scraper/meta-ad-library-coverage.js';
import { createSharedQuotaFetch, readMetaRateUsage } from '../scraper/instagram-shared-quota.js';
import { buildConfig, collectAdLibrary, normalizeAdLibraryItem, runMetaInstagramCollector } from '../scraper/meta-instagram-deals.js';
import { validateDealsForSlack } from '../scraper/deal-validity-agent.js';
import { normalizeDeal } from '../scraper/slack-notify.js';
import { runAdLibraryAccessCheck } from './check-meta-ad-library.mjs';

const now = new Date('2026-10-07T18:00:00Z');
const next = (cursor) => `https://graph.facebook.com/v26.0/ads_archive?after=${cursor}&access_token=do-not-store`;
const page = (ids, cursor = '') => ({ payload: { data: ids.map((id) => ({ id })), ...(cursor ? { paging: { next: next(cursor) } } : {}) } });
const scan = (options) => scanAdLibraryCoverage({ terms: ['Wien Kebab', 'Wien Kaffee'], scope: 'test', now, ...options });
let calls = [];
const first = await scan({ maxRequests: 2, fetchPage: async (term, after) => {
  calls.push([term, after]); return page([term], term.includes('Kebab') ? 'k1' : 'c1');
} });
assert.deepEqual(calls, [['Wien Kebab', ''], ['Wien Kaffee', '']], 'heads first, not one query monopolizing pagination');
assert.equal(first.pendingPages, 2);
assert.doesNotMatch(JSON.stringify(first.state), /access_token|do-not-store|https:/);
calls = [];
const resumed = await scan({ previous: first.state, maxRequests: 4, fetchPage: async (term, after) => {
  calls.push([term, after]);
  return after === 'k1' ? page(['k2'], 'k2') : after === 'c1' ? page(['c2']) : page([]);
} });
assert.deepEqual(calls, [['Wien Kebab', 'k1'], ['Wien Kaffee', 'c1'], ['Wien Kebab', 'k2']]);
assert.equal(resumed.pendingPages, 0);
assert.equal(resumed.stopReason, 'relevant-queries-complete');
await scan({ previous: resumed.state, fetchPage: () => assert.fail('do not waste calls on completed heads within one hour') });

const later = new Date(+now + 3600000);
const headRefresh = await scan({ previous: first.state, now: later, headsOnly: true, maxRequests: 1,
  fetchPage: async () => page(['new-head'], 'new-cursor') });
assert.equal(headRefresh.state.queries['Wien Kebab'].resumeAfter, 'k1', 'head refresh must not discard unfinished pages');
const fair = await scan({ previous: { ...first.state, queries: {
  ...first.state.queries, 'Wien Kebab': { ...first.state.queries['Wien Kebab'], lastPageAt: later.toISOString() },
} }, maxRequests: 1, fetchPage: async (term) => { assert.equal(term, 'Wien Kaffee'); return page([]); } });
assert.equal(fair.requests, 1, 'oldest unfinished query first across runs');
const backlogTerms = Array.from({ length: 20 }, (_, i) => `query${i}`);
const backlogCalls = [];
await scan({ terms: backlogTerms, headsOnly: true, maxRequests: 8, previous: {
  version: 1, scope: 'test', queries: Object.fromEntries(backlogTerms.map((term) => [term, { resumeAfter: 'older-page' }])),
}, fetchPage: async (term, after) => { backlogCalls.push(after); return page(['row'], 'more'); } });
assert.equal(backlogCalls.filter(Boolean).length, 2, 'backfill gets reserved seed capacity even without an organic remainder');

let count = 0;
const interrupted = await scan({ maxRequests: 5, fetchPage: async () => {
  if (++count === 1) return page(['kept'], 'resume');
  throw Object.assign(new Error('paused'), { code: 'SCAN_BUDGET' });
} });
assert.equal(interrupted.raw[0].id, 'kept');
assert.equal(interrupted.state.queries['Wien Kebab'].resumeAfter, 'resume');
assert.equal(interrupted.failure, null);
assert.equal(interrupted.budgetDeferred, true);
const empty = await scan({ terms: ['only'], fetchPage: async () => page([], 'ignored') });
assert.equal(empty.requests, 1);
assert.equal(empty.pendingPages, 0, 'empty data terminates even with a next link');
const untrusted = await scan({ terms: ['only'], fetchPage: async () => ({ payload: { data: [{ id: '1' }], paging: { next: 'https://evil.invalid/v26.0/ads_archive?after=x' } } }) });
assert.equal(untrusted.failure.message, 'Untrusted Ad Library pagination URL');
const stale = await scan({ previous: first.state, maxRequests: 2, fetchPage: async () => {
  throw Object.assign(new Error('cursor expired'), { code: 100 });
} });
assert.equal(stale.failure, null);
assert.equal(stale.pendingPages, 0);

const config = buildConfig({ META_AD_LIBRARY_ACCESS_TOKEN: 'private-token', META_AD_LIBRARY_MAX_COVERAGE: '1',
  META_AD_LIBRARY_MAX_TERMS_PER_RUN: '200', META_AD_LIBRARY_MAX_PAGES_PER_TERM: '20',
  META_AD_LIBRARY_PAGE_SIZE: '5000', META_INSTAGRAM_MAX_RETRIES: '0' }, now);
assert(config.adSearchTerms.length > 50);
assert(config.adSearchTerms.every((term) => term.length <= 100));
let apiCalls = 0;
const actualAdapter = await collectAdLibrary({ ...config, adSearchTerms: ['Wien Kebab'] }, now, async (url) => {
  const query = new URL(url);
  assert.equal(query.origin, 'https://graph.facebook.com');
  assert.equal(query.searchParams.get('access_token'), 'private-token');
  assert.equal(query.searchParams.get('limit'), '5000');
  assert.equal(query.searchParams.get('ad_active_status'), 'ACTIVE');
  assert.equal(query.searchParams.get('publisher_platforms'), '["INSTAGRAM"]');
  assert.equal(query.searchParams.get('ad_reached_countries'), '["AT"]');
  apiCalls += 1;
  return Response.json({ data: [{ id: String(apiCalls) }], ...(apiCalls < 12 ? { paging: { next: next(`cursor${apiCalls}`) } } : {}) });
});
assert.equal(apiCalls, 12, 'full pagination, not the legacy one-page/two-page limit');
assert.equal(actualAdapter.fetched, 12);
assert.doesNotMatch(JSON.stringify(actualAdapter.state), /private-token|do-not-store/);
let diagnosticCalls = 0;
await runAdLibraryAccessCheck({ env: { META_AD_LIBRARY_ACCESS_TOKEN: 'test', META_AD_LIBRARY_MAX_COVERAGE: '1' }, now, write: false,
  fetchImpl: async () => { diagnosticCalls += 1; return Response.json({ data: [{ id: '1' }], paging: { next: next('more') } }); } });
assert.equal(diagnosticCalls, 1, 'access diagnostic remains strictly one request despite maximum-coverage env');

const headers = new Headers({
  'x-app-usage': '{"call_count":4,"total_time":7}',
  'x-business-use-case-usage': '{"1":[{"object_count_pct":96,"estimated_time_to_regain_access":130}]}',
  'x-ad-account-usage': '{"acc_id_util_pct":82,"reset_time_duration":7200}',
});
assert.deepEqual(readMetaRateUsage(headers), { highestPercent: 96, recoveryMs: 130 * 60000, reported: true });
assert.equal(readMetaRateUsage(new Headers({ 'x-app-usage': 'bad-json' })).reported, false);
assert.equal(readMetaRateUsage(new Headers({ 'x-app-usage': '{"call_count":"","total_time":null}' })).reported, false);
const makeStore = () => {
  let state = { version: 1, reservations: [], pausedUntil: 0 }, revision = 0;
  return { async read() { return { state: structuredClone(state), revision }; },
    async compareAndSwap(expected, value) { if (expected !== revision) return false; state = structuredClone(value); revision += 1; return true; } };
};
let store = makeStore();
const adaptive = createSharedQuotaFetch(async () => Response.json({}, { headers: { 'x-app-usage': '{"call_count":2,"total_time":3}' } }), {
  store, clock: () => +now, blockSize: 1, maxRequestsPerHour: 4, adaptiveMaxRequestsPerHour: 10,
});
for (let i = 0; i < 10; i += 1) await adaptive('unused');
assert.equal(adaptive.quotaStats.limitPerHour, 10);
assert(adaptive.quotaStats.adaptiveIncreases > 0);
await assert.rejects(adaptive('unused'), { code: 'SCAN_BUDGET' });
const peer = createSharedQuotaFetch(async () => assert.fail('shared budget already exhausted'), { store, clock: () => +now, maxRequestsPerHour: 4 });
await assert.rejects(peer('unused'), { code: 'SCAN_BUDGET' });
assert.equal(peer.quotaStats.limitPerHour, 10, 'other collectors adopt the shared budget, not independent allowances');
store = makeStore();
const blind = createSharedQuotaFetch(async () => Response.json({}), { store, clock: () => +now,
  maxRequestsPerHour: 4, blockSize: 1, adaptiveMaxRequestsPerHour: 10 });
for (let i = 0; i < 4; i += 1) await blind('unused');
await assert.rejects(blind('unused'), { code: 'SCAN_BUDGET' });
assert.equal(blind.quotaStats.limitPerHour, 4, 'no optimistic growth with absent telemetry');
store = makeStore();
let quotaClock = +now;
let reportedUsage = 80;
const recovering = createSharedQuotaFetch(async () => Response.json({}, { headers: { 'x-app-usage': JSON.stringify({ call_count: reportedUsage }) } }), {
  store, clock: () => quotaClock, maxRequestsPerHour: 4, blockSize: 1, adaptiveMaxRequestsPerHour: 10,
});
await recovering('unused');
quotaClock += 3 * 60000; reportedUsage = 3;
for (let i = 0; i < 5; i += 1) await recovering('unused');
assert(recovering.quotaStats.limitPerHour > 4, 'an old high sample must age out, not be perpetually refreshed by lower observations');
assert.equal((await store.read()).state.metaUsage.highestPercent, 3);
store = makeStore();
const nearLimit = createSharedQuotaFetch(async () => Response.json({}, { headers: { 'x-app-usage': '{"call_count":90}' } }), {
  store, clock: () => +now, maxRequestsPerHour: 190, blockSize: 1, adaptiveMaxRequestsPerHour: 1000, usageThreshold: 95,
});
for (let i = 0; i < 191; i += 1) await nearLimit('unused');
assert(nearLimit.quotaStats.limitPerHour > 190 && nearLimit.quotaStats.limitPerHour < 200,
  'small telemetry-based growth near capacity, not a blind 25% jump or permanent 190-call cap');
store = makeStore();
const throttle = createSharedQuotaFetch(async () => Response.json({}, { headers }), { store, clock: () => +now });
await throttle('unused');
assert.equal((await store.read()).state.pausedUntil, +now + 130 * 60000);
assert.equal((await store.read()).state.adaptiveQuota, null);

const ad = { id: '1768157911106247', page_name: 'Test Restaurant',
  ad_creative_bodies: ['Wien: Sonntagsbrunch 9,90 EUR statt 19,90 EUR. 04.10.2026 bis 15.11.2026. Jeden Sonntag von 09:00 bis 12:00. Wurlitzergasse 87, 1170 Wien.'],
  ad_delivery_start_time: '2026-09-01T09:00:00Z', publisher_platforms: ['INSTAGRAM'],
  ad_snapshot_url: 'https://www.facebook.com/ads/archive/render_ad/?id=1768157911106247', _adLibraryActiveCheckedAt: now.toISOString() };
const deal = normalizeAdLibraryItem(ad, config, now).deal;
assert(deal, 'older ongoing active campaigns remain eligible, without faking publication');
assert.equal(deal.pubDate, new Date(ad.ad_delivery_start_time).toISOString());
assert(hasFreshActiveAdEvidence(deal, now));
const validate = (candidate) => validateDealsForSlack([normalizeDeal(candidate, 'meta-instagram')], {
  now, inspectDealUrlHealth: async (url) => ({ ok: true, status: 200, finalUrl: url, contentHints: {} }),
});
assert.equal((await validate(deal)).allowedDeals.length, 1, 'fresh ACTIVE evidence survives central Slack validation');
assert.equal((await validate({ ...deal, evidence: { ...deal.evidence, activeAdCheckedAt: '2026-10-01T09:00:00Z' } })).allowedDeals.length, 0);
assert.equal((await validate({ ...deal, originSource: 'Instagram' })).allowedDeals.length, 0);
assert.equal((await validate({ ...deal, url: 'https://www.facebook.com/ads/library/?id=111' })).allowedDeals.length, 0);
assert.equal(normalizeAdLibraryItem({ ...ad, ad_creative_bodies: ['Gratis Kebab in Wien am 05.10.2026'] }, config, now).deal, null);
assert.equal(normalizeAdLibraryItem({ ...ad, ad_creative_bodies: ['Gratis Kebab in Wien am 05.10.2025'] }, config, now).deal, null);
const todayAd = normalizeAdLibraryItem({ ...ad, ad_creative_bodies: ['Nur heute gratis Kebab in Wien!'] }, config, now).deal;
assert.equal((await validate(todayAd)).allowedDeals.length, 0, 'old relative today offers still fail, even in active ads');
const futureAd = normalizeAdLibraryItem({ ...ad, ad_creative_bodies: ['Gratis Kebab in Wien am 15.10.2026'] }, config, now).deal;
assert.equal((await validate(futureAd)).allowedDeals.length, 1);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-ad-coverage-test-'));
try {
  const env = { META_AD_LIBRARY_ACCESS_TOKEN: 'test', META_AD_LIBRARY_MAX_COVERAGE: '1', META_AD_LIBRARY_SEARCH_TERMS: 'Wien Kebab,Wien Kaffee',
    META_AD_LIBRARY_MAX_TERMS_PER_RUN: '200', META_AD_LIBRARY_SEED_REQUESTS: '1', META_AD_LIBRARY_MAX_REQUESTS: '10',
    META_AD_LIBRARY_MAX_PAGES_PER_TERM: '10', META_AD_LIBRARY_PAGE_SIZE: '5000', META_INSTAGRAM_MAX_RETRIES: '0',
    META_INSTAGRAM_OUTPUT_ALL_VERIFIED: '1', META_INSTAGRAM_MAX_DEALS_PER_RUN: '1',
    META_INSTAGRAM_OUTPUT_PATH: path.join(tmp, 'output.json'), META_INSTAGRAM_REPORT_PATH: path.join(tmp, 'report.json'),
    META_INSTAGRAM_STATE_PATH: path.join(tmp, 'state.json'), INSTAGRAM_GRAPH_EVIDENCE_PATH: path.join(tmp, 'evidence.json') };
  const paths = { watchlistPath: path.join(tmp, 'none'), registryPath: path.join(tmp, 'none'), candidatePaths: [] };
  const order = [];
  const collected = await runMetaInstagramCollector({ env, now, paths, fetchImpl: async (url) => {
    const query = new URL(url); order.push(query.searchParams.get('search_terms'));
    return Response.json({ data: [{ ...ad, id: query.searchParams.get('search_terms').includes('Kebab') ? '1001' : '1002',
      page_name: query.searchParams.get('search_terms').includes('Kebab') ? 'First Restaurant' : 'Other Restaurant' }] });
  } });
  assert.deepEqual(order, ['Wien Kebab', 'Wien Kaffee']);
  assert.equal(collected.payload.deals.length, 2, 'all eligible candidates forwarded, not silently truncated to the old output cap');
  assert.equal(collected.report.outputLimit, null);
  assert.equal(collected.report.sources.adLibrary.coverage.stopReason, 'relevant-queries-complete');
  assert.equal(collected.state.adLibraryScan.queries['Wien Kaffee'].lastHeadAt, now.toISOString());
  const sequence = [];
  const graphConfig = { ...buildConfig({ ...env, INSTAGRAM_ACCESS_TOKEN: 'graph-token', INSTAGRAM_USER_ID: '123',
    META_INSTAGRAM_ACCOUNTS: 'testrestaurant', META_INSTAGRAM_MAX_ACCOUNTS_PER_RUN: '1' }, now), hashtags: [], mediaMaxPostsPerRun: 0 };
  await runMetaInstagramCollector({ env, config: graphConfig, now: new Date(+now + 3600000), paths, write: false,
    scanStatePath: path.join(tmp, 'scan.json'), peerScanStatePath: path.join(tmp, 'peer.json'), fetchImpl: async (url) => {
      const query = new URL(url);
      if (query.pathname.endsWith('/ads_archive')) { sequence.push('ads'); return Response.json({ data: [ad] }); }
      sequence.push('organic'); return Response.json({ business_discovery: { username: 'testrestaurant', media: { data: [] } } });
    } });
  assert.deepEqual(sequence, ['ads', 'organic', 'ads'], 'a seed, organic coverage, then spare-capacity fill in that order');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log('Meta ad maximum coverage: pagination, checkpoints, fairness, telemetry, shared growth, active-ad validity and unlimited verified output passed');

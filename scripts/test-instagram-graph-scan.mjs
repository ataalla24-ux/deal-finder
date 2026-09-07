import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanGraphPages, scanGraphSource, createGraphRequestBudget, createGraphScanStore, graphCursor } from '../scraper/instagram-graph-scan.js';
import { buildConfig, fetchInstagramBusinessDiscoveryMedia, runMetaInstagramCollector, selectAccountShard } from '../scraper/meta-instagram-deals.js';
import { runWienDealsCombined } from '../scraper/wien-deals-combined.js';

const now = new Date('2026-09-07T08:00:00Z');
const media = (id, extra = {}) => ({ id, timestamp: '2026-09-06T10:00:00Z', caption: 'Am 09.09.2026 gibt es in 1070 Wien 1+1 Kaffee.', permalink: `https://www.instagram.com/p/${id}/`, ...extra });
const page = (ids, after) => ({ data: ids.map((id) => media(id)), ...(after ? { paging: { next: 'https://graph.facebook.com/ignored?access_token=DO_NOT_PERSIST', cursors: { after } } } : {}) });
const recentCheckpoint = { lastSweepAt: now.toISOString(), seenIds: ['pinned', 'known', 'known2'] };

// Pinned/known items and mixed pages cannot hide an unseen later item.
let calls = [];
let result = await scanGraphPages({ now, previous: recentCheckpoint, fetchPage: async (cursor) => {
  calls.push(cursor);
  return cursor === '' ? page(['pinned', 'new'], 'page2') : cursor === 'page2' ? page(['known', 'hidden'], 'page3') : page(['tail']);
} });
assert.deepEqual(calls, ['', 'page2', 'page3']);
assert.deepEqual(result.rows.map((row) => row.id), ['pinned', 'new', 'known', 'hidden', 'tail']);
assert.equal(result.report.newPosts, 3);

// Two complete known pages can stop an incremental scan, but never a periodic sweep.
calls = [];
const knownFetch = async (cursor) => { calls.push(cursor); return cursor === '' ? page(['pinned'], 'p2') : cursor === 'p2' ? page(['known'], 'p3') : page(['hidden']); };
result = await scanGraphPages({ now, previous: recentCheckpoint, fetchPage: knownFetch });
assert.equal(result.report.stopReason, 'known-pages');
assert.equal(calls.length, 2);
calls = [];
result = await scanGraphPages({ now, previous: { ...recentCheckpoint, lastSweepAt: '2026-09-06T00:00:00Z' }, fetchPage: knownFetch });
assert.equal(calls.length, 3);
assert(result.rows.some((row) => row.id === 'hidden'));

// Hard cap, then latest page + saved tail on the next run.
result = await scanGraphPages({ now, maxPages: 999, fetchPage: async (cursor) => page([cursor || 'head'], cursor ? `${cursor}x` : 'p2') });
assert.equal(result.report.pages, 3);
assert.equal(result.report.incomplete, true);
assert.equal(result.checkpoint.lastSuccessfulAt, '');
const resume = result.checkpoint.resumeAfter;
calls = [];
const resumed = await scanGraphPages({ now, previous: result.checkpoint, fetchPage: async (cursor) => { calls.push(cursor); return cursor === '' ? page(['new-head'], 'p2') : page(['old-tail']); } });
assert.deepEqual(calls, ['', resume]);
assert.equal(resumed.report.resumed, true);
assert.equal(resumed.checkpoint.resumeAfter, '');

// Partial failures keep useful rows and retry the failed cursor, not a later one.
result = await scanGraphPages({ now, previous: { lastSuccessfulAt: '2026-09-06T08:00:00Z' }, fetchPage: async (cursor) => {
  if (cursor) throw Object.assign(new Error('temporary failure'), { status: 503 });
  return page(['kept'], 'retry-me');
} });
assert.equal(result.rows.length, 1);
assert.equal(result.report.stopReason, 'page-error');
assert.equal(result.checkpoint.resumeAfter, 'retry-me');
assert.equal(result.checkpoint.lastSuccessfulAt, '2026-09-06T08:00:00Z');
await assert.rejects(scanGraphPages({ now, fetchPage: async () => { throw new Error('first page failed'); } }), /first page/);

result = await scanGraphPages({ now, previous: { resumeAfter: 'expired' }, fetchPage: async (cursor) => {
  if (cursor) throw Object.assign(new Error('Invalid cursor'), { code: 100 });
  return page(['kept'], 'p2');
} });
assert.equal(result.report.stopReason, 'cursor-rejected');
assert.equal(result.checkpoint.resumeAfter, '');
assert.equal(result.rows.length, 1);

result = await scanGraphPages({ now, fetchPage: async () => page(['same'], 'same-cursor') });
assert.equal(result.report.stopReason, 'cursor-loop');
assert.equal(result.report.pages, 2);
assert.equal(graphCursor('evil){id,access_token}'), '');
result = await scanGraphPages({ now, fetchPage: async () => page(['kept'], 'https://evil.example/') });
assert.equal(result.report.stopReason, 'invalid-cursor');
result = await scanGraphPages({ now, fetchPage: async () => ({ data: [media('old', { timestamp: '2026-08-01T00:00:00Z' })], paging: { next: 'ignored', cursors: { after: 'next' } } }) });
assert.equal(result.report.stopReason, 'age-window');

// Header-based backoff and global budget also cover retries/field fallbacks.
let budget = createGraphRequestBudget(async () => Response.json({}, { headers: { 'x-business-use-case-usage': JSON.stringify({ business: [{ call_count: 86 }] }) } }));
await budget.fetch('unused');
await assert.rejects(budget.fetch('unused'), { code: 'SCAN_BUDGET' });
assert.equal(budget.stats.requests, 1);
budget = createGraphRequestBudget(async () => Response.json({}), { maxRequests: 2 });
await budget.fetch('unused'); await budget.fetch('unused');
await assert.rejects(budget.fetch('unused'), { code: 'SCAN_BUDGET' });
assert.equal(budget.stats.requests, 2);

// Store ownership, cross-collector replay, failed-state isolation and no paging credentials.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-graph-scan-'));
try {
  const a = path.join(dir, 'a.json'); const b = path.join(dir, 'b.json');
  const store = createGraphScanStore({ ownPath: a, peerPath: b, scope: 'v26.0:test', now });
  await scanGraphSource({ key: 'hashtag:wien', store, now, fetchPage: async () => ({ data: [media('shared', { children: { data: [{ id: 'child' }], paging: { next: 'https://graph.facebook.com/?access_token=SECRET' } } })] }) });
  store.save();
  assert(!fs.readFileSync(a, 'utf8').includes('SECRET'));
  const peer = createGraphScanStore({ ownPath: b, peerPath: a, scope: 'v26.0:test', now });
  const cached = await scanGraphSource({ key: 'hashtag:wien', store: peer, now, fetchPage: async () => { throw new Error('must use cache'); } });
  assert.equal(cached.report.cacheHit, true);
  assert.equal(cached.rows[0].id, 'shared');
  const isolated = createGraphScanStore({ ownPath: b, peerPath: a, scope: 'v26.0:other-user', now });
  assert.deepEqual(isolated.get('hashtag:wien'), {});
  const oldStore = createGraphScanStore({ ownPath: b, peerPath: a, scope: 'v26.0:test', now: new Date('2026-09-15T00:00:00Z') });
  assert.deepEqual(oldStore.get('hashtag:wien'), {});
} finally { fs.rmSync(dir, { recursive: true, force: true }); }

// Business Discovery paging uses nested field cursors, never a supplied next URL.
calls = [];
const config = buildConfig({ INSTAGRAM_ACCESS_TOKEN: 'fake', INSTAGRAM_USER_ID: '123', META_INSTAGRAM_MEDIA_OCR_ENABLED: '0', META_INSTAGRAM_MAX_RETRIES: '0' }, now);
const account = await fetchInstagramBusinessDiscoveryMedia(config, { username: 'testcafe' }, async (url) => {
  const fields = new URL(url).searchParams.get('fields'); calls.push(fields);
  return Response.json({ business_discovery: { username: 'testcafe', name: 'Test Cafe', media: fields.includes('.after(p2)') ? page(['second']) : page(['first'], 'p2') } });
});
assert.equal(account.entries.length, 2);
assert.match(calls[1], /media\.limit\(25\)\.after\(p2\)/);

// Both collectors accept a real matching deal from page two with fake network only.
const fakeFetch = async (url) => {
  const parsed = new URL(url);
  if (parsed.pathname.endsWith('ig_hashtag_search')) return Response.json({ data: [{ id: 'tag' }] });
  if (parsed.pathname.endsWith('recent_media')) return Response.json(parsed.searchParams.get('after') ? page(['second-page-deal']) : { ...page(['ordinary'], 'p2'), data: [media('ordinary', { caption: 'Unser Café in 1070 Wien.' })] });
  throw new Error(`Unexpected endpoint: ${parsed.pathname}`);
};
const env = { INSTAGRAM_ACCESS_TOKEN: 'fake', INSTAGRAM_USER_ID: '123', META_INSTAGRAM_HASHTAGS: 'wien', WIEN_COMBINED_GRAPH_HASHTAGS: 'wien', META_INSTAGRAM_MEDIA_OCR_ENABLED: '0', META_INSTAGRAM_MEDIA_VISION_ENABLED: '0', META_INSTAGRAM_MEDIA_LLM_ENABLED: '0' };
const combined = await runWienDealsCombined({ env, now, write: false, fetchImpl: fakeFetch });
assert(combined.payload.deals.some((deal) => deal.id.includes('second-page-deal')));
assert.equal(combined.report.sources[0].coverage.pages, 2);
const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-graph-empty-'));
let meta;
try {
  meta = await runMetaInstagramCollector({ env, now, write: false,
    config: { ...buildConfig(env, now), statePath: path.join(emptyRoot, 'state.json'), maxRetries: 0 },
    paths: { watchlistPath: path.join(emptyRoot, 'watchlist.json'), registryPath: path.join(emptyRoot, 'registry.json'), candidatePaths: [] }, fetchImpl: fakeFetch });
} finally { fs.rmSync(emptyRoot, { recursive: true, force: true }); }
assert(meta.payload.deals.some((deal) => deal.id.includes('second-page-deal')));
assert.equal(meta.report.sources.instagramGraph.coverage.find((row) => row.source === '#wien').pages, 2);

// Frequent scans prioritize already useful food accounts without removing exploration.
const recent = '2026-09-07T05:00:00Z';
const selected = selectAccountShard([
  { username: 'foodcafe', accountType: 'merchant', category: 'kaffee', manualApprovedDeals: 2, priority: 1 },
  { username: 'other', accountType: 'merchant', category: 'shopping', manualApprovedDeals: 10, priority: 100 },
], { ...config, maxAccountsPerRun: 1 }, { accountPerformance: { foodcafe: { lastRunAt: recent }, other: { lastRunAt: recent } } }, now);
assert.equal(selected[0].username, 'foodcafe');
console.log('Instagram bounded pagination, checkpoints, shared cache, budgets and collector integration tests passed');

import assert from 'node:assert/strict';
import { runDiscoveryWatchdog } from '../referrals-worker/src/discovery-watchdog.js';
import worker from '../referrals-worker/src/index.js';
import { acknowledgeCommunitySubmissions } from '../scraper/ack-community-submissions.js';

class MemoryKV {
  data = new Map();
  writes = 0;
  async get(key, type) { const value = this.data.get(key); return value == null ? null : type === 'json' ? JSON.parse(value) : value; }
  async put(key, value) { this.writes += 1; this.data.set(key, value); }
}
const now = new Date('2026-10-07T18:00:00Z');
const env = { META_DISCOVERY_WATCHDOG_ENABLED: '1', GITHUB_WORKFLOW_TOKEN: 'test', REFERRAL_KV: new MemoryKV() };
let dispatched = [], enabled = '1', state = 'active', runs = [], failMeta = false;
const api = async (url, init) => {
  if (url.includes('/variables/')) return Response.json({ value: enabled });
  if (failMeta && url.includes('meta-instagram-deals.yml')) return new Response('', { status: 503 });
  if (url.endsWith('/dispatches')) { dispatched.push(url); assert.deepEqual(JSON.parse(init.body), { ref: 'main' }); return new Response(null, { status: 204 }); }
  if (url.includes('/runs?')) return Response.json({ workflow_runs: runs });
  return Response.json({ state });
};
assert.equal((await runDiscoveryWatchdog({}, { fetchImpl: () => assert.fail('disabled') })).status, 'disabled');
enabled = '0';
assert.equal((await runDiscoveryWatchdog(env, { fetchImpl: api, now })).status, 'paused');
assert.equal(dispatched.length, 0);
enabled = '1'; state = 'disabled_manually';
assert((await runDiscoveryWatchdog(env, { fetchImpl: api, now })).results.every((r) => r.action === 'disabled'));
state = 'active'; runs = [{ status: 'in_progress', created_at: '2026-10-07T15:00:00Z' }];
assert((await runDiscoveryWatchdog(env, { fetchImpl: api, now })).results.every((r) => r.action === 'already-running'));
runs = [{ status: 'completed', created_at: '2026-10-07T17:50:00Z' }];
assert((await runDiscoveryWatchdog(env, { fetchImpl: api, now })).results.every((r) => r.action === 'recent'));
runs = [];
assert((await runDiscoveryWatchdog(env, { fetchImpl: api, now })).results.every((r) => r.action === 'requested'));
assert.equal(dispatched.length, 2);
assert((await runDiscoveryWatchdog(env, { fetchImpl: api, now: new Date(+now + 15 * 60000) })).results.every((r) => r.action === 'cooldown'));
assert.equal(dispatched.length, 2);
const mixed = await runDiscoveryWatchdog(env, { fetchImpl: api, now: new Date(+now + 35 * 60000) });
assert.equal(mixed.results[0].action, 'cooldown'); assert.equal(mixed.results[1].action, 'requested');
env.REFERRAL_KV = new MemoryKV(); failMeta = true;
const degraded = await runDiscoveryWatchdog(env, { fetchImpl: api, now });
assert.equal(degraded.status, 'degraded');
assert.equal(degraded.results[0].action, 'failed');
assert.equal(degraded.results[1].action, 'requested', 'independent delivery retry survives collector API errors');
env.REFERRAL_KV = new MemoryKV(); failMeta = false;
let lost = 0;
const lostResponse = async (url, init) => {
  if (url.endsWith('/dispatches')) { lost += 1; throw new Error('Response lost'); }
  return api(url, init);
};
await runDiscoveryWatchdog(env, { fetchImpl: lostResponse, now });
await runDiscoveryWatchdog(env, { fetchImpl: lostResponse, now: new Date(+now + 60000) });
assert.equal(lost, 2, 'no immediate duplicate dispatch after ambiguous network outcome');

const kv = new MemoryKV();
const workerEnv = { REFERRAL_KV: kv, COMMUNITY_SYNC_TOKEN: 'test-sync' };
const ids = Array.from({ length: 34 }, (_, i) => `submission${i}`);
for (const id of ids) await kv.put(`deal:submission:${id}`, JSON.stringify({ id, status: 'pending' }));
await kv.put('deal:submission:submission0', JSON.stringify({ id: ids[0], status: 'approved', postedAt: 123 }));
await kv.put('deal:submission:submission1', JSON.stringify({ id: ids[1], status: 'rejected', postedAt: 123 }));
await kv.put('deal:submission:submission2', JSON.stringify({ id: ids[2], status: 'queued', postedAt: 123 }));
let calls = 0; const sizes = [];
const fetchWorker = async (url, init) => {
  calls += 1; sizes.push(JSON.parse(init.body).ids.length);
  if (calls === 1) return new Response('', { status: 500 });
  return worker.fetch(new Request(url, init), workerEnv);
};
const options = { apiBase: 'https://worker.example', token: 'test-sync', ids: [...ids, ids[0]], fetchImpl: fetchWorker, sleep: async () => {} };
assert.equal(await acknowledgeCommunitySubmissions(options), 31);
assert.deepEqual(sizes, [10, 10, 10, 10, 4]);
assert.equal((await kv.get('deal:submission:submission0', 'json')).status, 'approved');
assert.equal((await kv.get('deal:submission:submission1', 'json')).status, 'rejected');
assert.equal((await kv.get('deal:submission:submission2', 'json')).postedAt, 123);
const writes = kv.writes;
assert.equal(await acknowledgeCommunitySubmissions(options), 0);
assert.equal(kv.writes, writes, 'repeated acknowledgements do not rewrite KV or timestamps');
const unauthorized = await worker.fetch(new Request('https://worker.example/api/discovery/watchdog'), workerEnv);
assert.equal(unauthorized.status, 401);
const oversized = await worker.fetch(new Request('https://worker.example/api/deals/submissions/admin/mark-posted', {
  method: 'POST', headers: { authorization: 'Bearer test-sync', 'content-type': 'application/json' }, body: JSON.stringify({ ids }),
}), workerEnv);
assert.equal(oversized.status, 400);
let forbiddenCalls = 0;
await assert.rejects(acknowledgeCommunitySubmissions({ ...options, fetchImpl: async () => {
  forbiddenCalls += 1; return new Response('', { status: 403 });
} }), /403/);
assert.equal(forbiddenCalls, 1, 'permanent permission failures are not retried');
console.log('Discovery watchdog and community delivery: pauses, schedule gaps, cooldowns, retry isolation, batching and idempotence passed');

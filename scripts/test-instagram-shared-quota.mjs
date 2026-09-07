import assert from 'node:assert/strict';
import { createSharedQuotaFetch, githubQuotaStore, sharedInstagramFetch } from '../scraper/instagram-shared-quota.js';

const HOUR = 3600000;
let now = Date.parse('2026-09-07T20:00:00Z');
const makeStore = () => {
  let state = { version: 1, reservations: [], pausedUntil: 0 };
  let revision = 0;
  return {
    async read() { return { state: structuredClone(state), revision }; },
    async compareAndSwap(expected, next) {
      if (expected !== revision) return false;
      state = structuredClone(next); revision += 1; return true;
    },
  };
};
let store = makeStore();
let calls = 0;
const response = async () => { calls += 1; return Response.json({ data: [] }); };
const worker = (s = store, fetcher = response) => createSharedQuotaFetch(fetcher, { store: s, clock: () => now });
const a = worker(), b = worker(), c = worker();
for (let i = 0; i < 50; i += 1) await Promise.all([a('unused'), b('unused'), c('unused')]);
assert.equal(calls, 150);
await assert.rejects(worker()('unused'), { code: 'SCAN_BUDGET' });
assert.equal(calls, 150);

// Reservations outlive their spend deadline by one hour; late spends cannot
// disappear from the ledger early, even if a runner stalls for several minutes.
store = makeStore(); calls = 0;
const slow = worker(); await slow('unused');
now += 4 * 60000; await slow('unused');
assert.equal(slow.quotaStats.reserved, 5);
now += 2 * 60000; await slow('unused');
assert.equal(slow.quotaStats.reserved, 10);
let snapshot = await store.read();
assert.equal(snapshot.state.reservations[0].expiresAt, now - 6 * 60000 + HOUR + 5 * 60000);

// A code-4 throttle returned as HTTP 400 pauses *other* jobs, including one
// already holding unused slots. This is not limited to HTTP 429.
store = makeStore(); calls = 0;
const other = worker(); await other('unused');
await worker(store, async () => Response.json({ error: { code: 4 } }, { status: 400 }))('unused');
await assert.rejects(other('unused'), { code: 'SCAN_BUDGET' });
assert.equal(calls, 1);
now += HOUR + 1;
await worker()('unused');
assert.equal(calls, 2);

// CPU usage can throttle before call_count. Honor a longer Retry-After too.
store = makeStore();
await worker(store, async () => Response.json({}, { headers: { 'x-app-usage': '{"call_count":3,"total_cputime":86}', 'retry-after': '7200' } }))('unused');
assert.equal((await store.read()).state.pausedUntil, now + 2 * HOUR);

// Contention never admits calls without a committed reservation; corrupt or
// inaccessible storage fails closed instead of silently using a local budget.
calls = 0;
await assert.rejects(worker({ read: async () => { throw new Error('offline'); } })('unused'), { code: 'SCAN_BUDGET' });
await assert.rejects(worker({ read: makeStore().read, compareAndSwap: async () => false })('unused'), { code: 'SCAN_BUDGET' });
assert.equal(calls, 0);
assert.throws(() => sharedInstagramFetch(response, { INSTAGRAM_SHARED_QUOTA_ENABLED: '1' }), { code: 'SCAN_BUDGET' });

// Exercise GitHub adapter initialization, SHA conflicts and secret-free state.
const requests = [];
let saved = null;
const github = githubQuotaStore({ GITHUB_REPOSITORY: 'owner/repo', GH_TOKEN: 'private-test-token' }, async (url, init) => {
  requests.push({ url, method: init.method, body: init.body });
  if (url.includes('/git/ref/heads/automation')) return Response.json({}, { status: 404 });
  if (url.endsWith('/git/ref/heads/main')) return Response.json({ object: { sha: 'main-sha' } });
  if (url.endsWith('/git/refs')) return Response.json({}, { status: 201 });
  if (init.method === 'GET') return saved ? Response.json({ content: Buffer.from(JSON.stringify(saved)).toString('base64'), sha: 'current' }) : Response.json({}, { status: 404 });
  const body = JSON.parse(init.body);
  if (body.sha && body.sha !== 'current') return Response.json({}, { status: 409 });
  saved = JSON.parse(Buffer.from(body.content, 'base64').toString());
  assert(!JSON.stringify(saved).includes('private-test-token'));
  assert.equal(body.branch, 'automation/instagram-quota');
  return Response.json({}, { status: 201 });
});
const empty = await github.read();
assert.equal(empty.revision, 'current');
assert(empty.state.pausedUntil > Date.now() + HOUR);
assert.equal(await github.compareAndSwap('current', empty.state), true);
assert.equal((await github.read()).revision, 'current');
assert.equal(await github.compareAndSwap('stale', empty.state), false);
assert(requests.every((r) => r.url.startsWith('https://api.github.com/repos/owner/repo/')));
console.log('Shared Instagram quota: concurrent collectors, rolling window, cooldowns, failure safety and GitHub CAS tests passed');

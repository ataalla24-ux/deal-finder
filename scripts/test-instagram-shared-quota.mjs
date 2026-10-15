import assert from 'node:assert/strict';
import { createSharedQuotaFetch, githubQuotaStore, sharedInstagramFetch } from '../scraper/instagram-shared-quota.js';

const HOUR = 3600000;
let cachedReads = 0;
const conditionalStore = githubQuotaStore({ GITHUB_REPOSITORY: 'owner/repo', GH_TOKEN: 'test-token' }, async (url, init) => {
  if (url.includes('/git/ref/')) return Response.json({});
  cachedReads += 1;
  if (init.headers['If-None-Match'] === '"verified-state"') return new Response(null, { status: 304 });
  return Response.json({ content: Buffer.from(JSON.stringify({ version: 1, reservations: [], pausedUntil: 0 })).toString('base64'), sha: 'state-sha' },
    { headers: { etag: '"verified-state"' } });
});
const conditionalFirst = await conditionalStore.read();
conditionalFirst.state.pausedUntil = 999;
const conditionalSecond = await conditionalStore.read();
assert.equal(conditionalSecond.state.pausedUntil, 0, 'cached state cannot be mutated by callers');
assert.equal(conditionalSecond.revision, 'state-sha');
assert.equal(cachedReads, 2, 'still observe global pauses via conditional polling, not a stale local-only lease');
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

const limited = githubQuotaStore({ GITHUB_REPOSITORY: 'owner/repo', GH_TOKEN: 'secret-fixture' }, async () =>
  Response.json({ message: 'API rate limit exceeded secret-fixture' }, { status: 403, headers: {
    'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.ceil(Date.now() / 1000) + 120),
  } }));
await assert.rejects(limited.read(), (error) => {
  assert.equal(error.code, 'SCAN_BUDGET');
  assert.equal(error.storage.provider, 'github');
  assert.equal(error.storage.httpStatus, 403);
  assert.equal(error.storage.rateLimited, true);
  assert(Date.parse(error.storage.retryAt) >= Date.now() + 119000);
  assert(!error.message.includes('secret-fixture'));
  return true;
});
const forbidden = githubQuotaStore({ GITHUB_REPOSITORY: 'owner/repo', GH_TOKEN: 'secret-fixture' }, async () =>
  Response.json({ message: 'Resource not accessible by integration' }, { status: 403 }));
await assert.rejects(forbidden.compareAndSwap('revision', {}), (error) => {
  assert.equal(error.storage.rateLimited, false, 'permission failure is not mislabeled as exhausted quota');
  assert.equal(error.storage.operation, 'write-state');
  return true;
});

// A paid-for/reserved successful Graph response must not be discarded merely
// because the subsequent telemetry write failed. No later call may slip through.
store = makeStore(); calls = 0;
const telemetryStore = { read: store.read, compareAndSwap: async (revision, next) => {
  if (next.metaUsage) throw Object.assign(new Error('GitHub unavailable'), { code: 'SCAN_BUDGET', storage: {
    provider: 'github', operation: 'write-state', httpStatus: 503, rateLimited: false, retryAt: '',
  } });
  return store.compareAndSwap(revision, next);
} };
const preserveResponse = worker(telemetryStore, async () => {
  calls += 1;
  return Response.json({ data: [{ id: 'fresh-post' }] }, { headers: { 'x-app-usage': '{"call_count":20}' } });
});
assert.equal((await (await preserveResponse('unused')).json()).data[0].id, 'fresh-post');
assert.equal(preserveResponse.quotaStats.stopped, true);
assert.equal(preserveResponse.quotaStats.storageFailure.httpStatus, 503);
await assert.rejects(preserveResponse('unused'), { code: 'SCAN_BUDGET' });
await assert.rejects(preserveResponse('unused'), { code: 'SCAN_BUDGET' });
assert.equal(calls, 1);
assert((preserveResponse.quotaStats.reason.match(/Instagram shared quota paused:/g) || []).length <= 1);

// A server error can arrive before OR after the conditional write commits.
// Reconcile without a cached response before retrying the same SHA once.
const originalQuota = { version: 1, reservations: [], pausedUntil: 0 };
const intendedQuota = { ...originalQuota, pausedUntil: 1234 };
for (const scenario of ['before-commit', 'after-commit', 'second-commit', 'persistent', 'concurrent', 'read-failed', 'malformed-read', 'rate-limit', 'long-retry']) {
  let writes = 0, reads = 0;
  const waits = [];
  const resilientStore = githubQuotaStore({ GITHUB_REPOSITORY: 'owner/repo', GH_TOKEN: 'secret-fixture' }, async (url, init) => {
    if (init.method === 'PUT') {
      writes += 1;
      const body = JSON.parse(init.body);
      assert.equal(body.sha, 'original-sha', 'never overwrite a concurrent revision');
      assert.deepEqual(JSON.parse(Buffer.from(body.content, 'base64').toString()), intendedQuota);
      if (scenario === 'before-commit' && writes === 2) return Response.json({}, { status: 200 });
      if (scenario === 'rate-limit') return Response.json({}, { status: 429 });
      return Response.json({}, { status: 500, headers: scenario === 'long-retry' ? { 'retry-after': '120' } : {} });
    }
    reads += 1;
    assert(!init.headers['If-None-Match'], 'uncertain writes require an uncached reconciliation');
    if (scenario === 'read-failed') return Response.json({}, { status: 503 });
    if (scenario === 'malformed-read') return Response.json({});
    const committed = scenario === 'after-commit' || scenario === 'second-commit' && writes === 2;
    return Response.json({ sha: committed ? 'committed-sha' : scenario === 'concurrent' ? 'other-sha' : 'original-sha',
      content: Buffer.from(JSON.stringify(committed ? intendedQuota : originalQuota) + '\n').toString('base64') });
  }, { sleep: async (ms) => waits.push(ms) });
  if (['persistent', 'read-failed', 'malformed-read', 'rate-limit', 'long-retry'].includes(scenario)) {
    await assert.rejects(resilientStore.compareAndSwap('original-sha', intendedQuota), { code: 'SCAN_BUDGET' });
  } else {
    assert.equal(await resilientStore.compareAndSwap('original-sha', intendedQuota), scenario !== 'concurrent');
  }
  assert.equal(writes, ['before-commit', 'second-commit', 'persistent'].includes(scenario) ? 2 : 1, `${scenario}: bounded writes`);
  assert.equal(reads, ['rate-limit', 'long-retry'].includes(scenario) ? 0 : ['persistent', 'second-commit'].includes(scenario) ? 2 : 1);
  assert(waits.every((ms) => ms >= 2000));
}
console.log('Shared Instagram quota: concurrent collectors, rolling window, cooldowns, failure safety and GitHub CAS tests passed');

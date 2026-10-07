import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { createPublicInteractionCache } from '../src/public-interaction-cache.js';
import { measureStorage, storageIdentity, StorageQuotaError } from '../src/storage-usage.js';

const API = 'https://worker.test/api/deals/interactions';
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fakeStorage() {
  const values = new Map();
  const calls = [];
  return {
    values, calls,
    async get(key) { calls.push(['get', key]); return structuredClone(values.get(key) ?? null); },
    async put(key, raw) { calls.push(['put', key]); values.set(key, JSON.parse(raw)); },
    async list() { calls.push(['list']); return { keys: [], list_complete: true }; },
  };
}
async function get(env, ids = ['sample']) {
  return worker.fetch(new Request(`${API}?dealIds=${ids.map(encodeURIComponent).join(',')}`), env);
}
async function post(env, action, extra = {}) {
  return worker.fetch(new Request(API, { method: 'POST', headers: {
    'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.1',
  }, body: JSON.stringify({ dealId: 'sample', deviceId: 'device-private', action, ...extra }) }), env);
}

test('cache coalesces requests and expires without extending on hits', async () => {
  let now = 0, loads = 0;
  const cache = createPublicInteractionCache({ now: () => now });
  const load = async () => ({ votes: ++loads });
  const results = await Promise.all(Array.from({ length: 50 }, () => cache.get('deal', load)));
  assert.ok(results.every(value => value.votes === 1));
  now = 29_999;
  assert.equal((await cache.get('deal', load)).votes, 1);
  now = 30_000;
  assert.equal((await cache.get('deal', load)).votes, 2);
});

test('old in-flight completion cannot replace a post-write result', async () => {
  const cache = createPublicInteractionCache();
  const stale = deferred();
  const old = cache.get('deal', () => stale.promise);
  await tick();
  cache.invalidate('deal');
  assert.equal(await cache.get('deal', async () => 'fresh'), 'fresh');
  stale.resolve('old');
  assert.equal(await old, 'old');
  assert.equal(await cache.get('deal', async () => 'unexpected'), 'fresh');
});

test('errors are not cached and an old failed request cannot evict a new value', async () => {
  const cache = createPublicInteractionCache();
  await assert.rejects(cache.get('deal', async () => { throw Error('network'); }));
  assert.equal(await cache.get('deal', async () => 'retry'), 'retry');
  const stale = deferred();
  const old = cache.get('other', () => stale.promise);
  const rejection = assert.rejects(old, /network/);
  await tick();
  cache.invalidate('other');
  await cache.get('other', async () => 'new');
  stale.reject(Error('network'));
  await rejection;
  assert.equal(await cache.get('other', async () => 'bad'), 'new');
});

test('cache is bounded and evicts least recently used entries', async () => {
  const cache = createPublicInteractionCache({ maxEntries: 2 });
  let loads = 0;
  const load = async () => ++loads;
  await cache.get('a', load); await cache.get('b', load);
  assert.equal(await cache.get('a', load), 1);
  await cache.get('c', load);
  assert.equal(await cache.get('a', load), 1);
  assert.equal(await cache.get('b', load), 4);
});

test('20 concurrent 67-deal refreshes use 268 reads instead of 5360, plus warm hits', async t => {
  const logs = t.mock.method(console, 'log', () => {});
  const storage = fakeStorage();
  const env = { MERCHANT_CAMPAIGNS: storage };
  const ids = Array.from({ length: 67 }, (_, i) => `deal-${i}`);
  const responses = await Promise.all(Array.from({ length: 20 }, () => get(env, ids)));
  for (const response of responses) {
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(Object.keys((await response.json()).interactions).length, 67);
  }
  assert.equal(storage.calls.length, 268);
  await get(env, ids.slice().reverse());
  await get(env, ids.slice(0, 15));
  assert.equal(storage.calls.length, 268);
  const reports = logs.mock.calls.map(call => call.arguments[0]);
  assert.equal(reports.flatMap(report => Object.values(report.operations)).reduce((sum, count) => sum + (count.get || 0), 0), 268);
  assert.equal(reports.at(-1).status, 200);
  assert.deepEqual(reports.at(-1).operations, {});
});

test('different namespaces cannot share interaction results; empty requests do not read KV', async t => {
  t.mock.method(console, 'log', () => {});
  const first = fakeStorage(), second = fakeStorage();
  first.values.set('deal-interaction:sample', { upvotes: ['first'] });
  const a = await (await get({ MERCHANT_CAMPAIGNS: first })).json();
  const b = await (await get({ MERCHANT_CAMPAIGNS: second })).json();
  assert.equal(a.interactions.sample.votes, 1);
  assert.equal(b.interactions.sample.votes, 0);
  const empty = fakeStorage();
  await get({ MERCHANT_CAMPAIGNS: empty }, []);
  assert.equal(empty.calls.length, 0);
});

test('cached projections expose counts and public text but no private identity or moderation records', async t => {
  t.mock.method(console, 'log', () => {});
  const storage = fakeStorage();
  const entry = { id: 'entry', text: 'Valid comment', createdAt: '2026-10-07T12:00:00Z', deviceId: 'secret-device', reports: ['private-reporter'] };
  storage.values.set('deal-interaction:sample', { upvotes: ['secret-device'], comments: [entry], ratings: { 'secret-device': 5 } });
  storage.values.set('deal-interaction-community:tips:sample', { entries: [{ ...entry, hidden: true, text: 'Hidden text' }] });
  const response = await get({ MERCHANT_CAMPAIGNS: storage });
  const text = await response.text();
  assert.doesNotMatch(text, /secret-device|private-reporter|Hidden text|deviceId|reports/);
  const state = JSON.parse(text).interactions.sample;
  assert.equal(state.votes, 1); assert.equal(state.ratingAverage, 5);
  assert.equal(state.comments.length, 1); assert.equal(state.tips.length, 0);
});

test('mutations invalidate only their deal, retain all action types and skip redundant repair writes', async t => {
  t.mock.method(console, 'log', () => {});
  const storage = fakeStorage();
  const env = { MERCHANT_CAMPAIGNS: storage };
  await get(env, ['sample', 'unrelated']);
  const actions = [
    ['upvote', {}, state => assert.equal(state.votes, 1)],
    ['remove_upvote', {}, state => assert.equal(state.votes, 0)],
    ['favorite', {}, state => assert.equal(state.favorites, 1)],
    ['remove_favorite', {}, state => assert.equal(state.favorites, 0)],
    ['open', {}, state => assert.equal(state.opens, 1)],
    ['redeem', {}, state => assert.equal(state.redeems, 1)],
    ['rate', { rating: 4 }, state => assert.equal(state.ratingAverage, 4)],
    ['add_comment', { text: 'Das Angebot hat gut funktioniert.' }, state => assert.equal(state.comments.length, 1)],
    ['add_tip', { text: 'Am besten am Vormittag vorbeikommen.' }, state => assert.equal(state.tips.length, 1)],
  ];
  for (const [action, payload, check] of actions) {
    const start = storage.calls.length;
    const response = await post(env, action, payload);
    assert.equal(response.status, 200, action);
    check((await response.json()).interaction);
    const writes = storage.calls.slice(start).filter(([method, key]) => method === 'put' && !key.startsWith('deal-interaction-rate:'));
    assert.equal(writes.length, 1, `${action}: no redundant second write`);
    const refreshed = (await (await get(env)).json()).interactions.sample;
    check(refreshed);
  }
  const before = storage.calls.length;
  await get(env, ['unrelated']);
  assert.equal(storage.calls.length, before);
  assert.equal((await post(env, 'hide_comment', { entryId: 'anything' })).status, 401);
});

test('repair write still restores an intent lost to a concurrent writer', async t => {
  t.mock.method(console, 'log', () => {});
  const storage = fakeStorage();
  const original = storage.put;
  let writes = 0;
  storage.put = async (key, raw) => {
    await original(key, raw);
    if (key === 'deal-interaction:sample' && ++writes === 1) {
      storage.values.set(key, { upvotes: ['other-device'] });
    }
  };
  const response = await post({ MERCHANT_CAMPAIGNS: storage }, 'upvote');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).interaction.votes, 2);
  assert.equal(writes, 2);
  assert.deepEqual(storage.values.get('deal-interaction:sample').upvotes, ['other-device', 'device-private']);
});

test('writes use fresh private records, not an earlier public cache value', async t => {
  t.mock.method(console, 'log', () => {});
  const storage = fakeStorage();
  const env = { MERCHANT_CAMPAIGNS: storage };
  await get(env);
  storage.values.set('deal-interaction:sample', { upvotes: ['external-device'] });
  const response = await post(env, 'upvote');
  assert.equal((await response.json()).interaction.votes, 2);
});

test('rate limits remain authoritative even with a warm public cache', async t => {
  t.mock.method(console, 'log', () => {});
  const storage = fakeStorage();
  const env = { MERCHANT_CAMPAIGNS: storage };
  await get(env);
  storage.values.set('deal-interaction-rate:upvote:device:device-private', { startedAt: Date.now(), count: 90 });
  const response = await post(env, 'upvote');
  assert.equal(response.status, 429);
  assert.equal(storage.values.has('deal-interaction:sample'), false);
});

test('invalid actions, ratings, text and unauthorized moderation consume no storage quota', async t => {
  t.mock.method(console, 'log', () => {});
  const storage = fakeStorage();
  const env = { MERCHANT_CAMPAIGNS: storage };
  for (const [action, payload, expected] of [
    ['unsupported', {}, 400], ['rate', { rating: 10 }, 400],
    ['add_comment', { text: '' }, 400], ['hide_tip', { entryId: 'x' }, 401],
  ]) assert.equal((await post(env, action, payload)).status, expected);
  assert.equal(storage.calls.length, 0);
});

test('community and rating repair writes still preserve competing users', async t => {
  t.mock.method(console, 'log', () => {});
  for (const [action, key, payload, competitor, field] of [
    ['rate', 'deal-interaction-ratings:sample', { rating: 4 }, { ratings: { competitor: 2 } }, 'ratings'],
    ['add_tip', 'deal-interaction-community:tips:sample', { text: 'Ein hilfreicher Hinweis fuer Besucher.' }, { entries: [
      { id: 'competitor-tip', deviceId: 'competitor', text: 'Bereits vorhandener Tipp.', createdAt: '2026-10-07T12:00:00Z' },
    ] }, 'entries'],
  ]) {
    const storage = fakeStorage();
    const original = storage.put;
    let writes = 0;
    storage.put = async (name, raw) => {
      await original(name, raw);
      if (name === key && ++writes === 1) storage.values.set(key, competitor);
    };
    assert.equal((await post({ MERCHANT_CAMPAIGNS: storage }, action, payload)).status, 200);
    assert.equal(writes, 2);
    assert.equal(Object.keys(storage.values.get(key)[field]).length, 2);
  }
});

test('a partial failed mutation clears the cache and is not falsely acknowledged', async t => {
  t.mock.method(console, 'log', () => {});
  const storage = fakeStorage();
  const env = { MERCHANT_CAMPAIGNS: storage };
  await get(env);
  const original = storage.put;
  storage.put = async (key, raw) => {
    await original(key, raw);
    if (key === 'deal-interaction:sample') throw Error('connection closed after write');
  };
  assert.equal((await post(env, 'upvote')).status, 500);
  assert.equal((await (await get(env)).json()).interactions.sample.votes, 1);
});

test('failed reads return an error, not cached zero counts; transient failures can retry', async t => {
  t.mock.method(console, 'log', () => {});
  const storage = fakeStorage();
  const original = storage.get;
  storage.get = async () => { throw Error('network'); };
  const env = { MERCHANT_CAMPAIGNS: storage };
  const failure = await get(env);
  assert.equal(failure.status, 500); assert.equal((await failure.json()).ok, false);
  storage.get = original;
  assert.equal((await get(env)).status, 200);
});

test('quota circuit breaker is bounded, separate per operation and emits no sensitive data', async () => {
  const storage = fakeStorage();
  let now = 0, reads = 0;
  storage.get = async () => { reads++; throw Error('KV get() limit exceeded for the day.'); };
  const request = new Request(`${API}?dealIds=private-query`);
  const first = measureStorage(request, storage, { now: () => now });
  assert.equal(storageIdentity(first.storage), storage);
  await assert.rejects(first.storage.get('deal-interaction:private-key'), StorageQuotaError);
  const second = measureStorage(request, storage, { now: () => now });
  await assert.rejects(second.storage.get('deal-interaction:private-key'), StorageQuotaError);
  assert.equal(reads, 1); assert.equal(second.report.suppressed, 1);
  await second.storage.put('campaign:private-key', '{}');
  assert.equal(second.report.operations.campaigns.put, 1);
  now = 60_000;
  await assert.rejects(second.storage.get('deal-interaction:private-key'), StorageQuotaError);
  assert.equal(reads, 2);
  assert.doesNotMatch(JSON.stringify([first.report, second.report]), /private|limit exceeded|https:/);
});

test('quota exhaustion returns retryable 503 and suppresses immediate repeated KV failures', async t => {
  const logs = t.mock.method(console, 'log', () => {});
  const storage = fakeStorage();
  let reads = 0;
  storage.get = async () => { reads++; throw Error('KV get() limit exceeded for the day.'); };
  const env = { MERCHANT_CAMPAIGNS: storage };
  const first = await get(env);
  assert.equal(first.status, 503); assert.equal(first.headers.get('retry-after'), '60');
  assert.equal((await first.json()).ok, false);
  const count = reads;
  assert.equal((await get(env)).status, 503);
  assert.equal(reads, count);
  assert.equal(logs.mock.calls.at(-1).arguments[0].suppressed, 4);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from 'miniflare';

test('SQLite migration preserves legacy interactions and analytics with zero new KV writes', async t => {
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/index.js', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'node', target: 'es2022',
    banner: { js: 'import { createRequire } from "node:module"; const require = createRequire("/worker.js");' } });
  const mf = new Miniflare(convertV4MiniflareOptions({
    compatibilityDate: '2026-03-09', compatibilityFlags: ['nodejs_compat'],
    modules: [{ type: 'ESModule', path: 'worker.js', contents: bundle.outputFiles[0].text }],
    durableObjects: { HOT_DATA: { className: 'HotDataLedger', useSQLite: true } },
    kvNamespaces: ['MERCHANT_CAMPAIGNS'], bindings: { MERCHANT_API_SECRET: 'fixture-secret', ANALYTICS_HASH_SECRET: 'fixture-hash' },
    log: new Log(LogLevel.ERROR),
  }));
  t.after(() => mf.dispose());
  const kv = await mf.getKVNamespace('MERCHANT_CAMPAIGNS');
  const legacy = { upvotes: ['old-device'], favorites: [], opens: [], redeems: [], updatedAt: new Date().toISOString() };
  await kv.put('deal-interaction:fixture-deal', JSON.stringify(legacy));
  const before = await kv.list();
  const post = (path, body) => mf.dispatchFetch('https://example.test' + path, {
    method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.1' }, body: JSON.stringify(body),
  });
  const get = () => mf.dispatchFetch('https://example.test/api/deals/interactions?dealIds=fixture-deal').then(r => r.json());
  assert.equal((await get()).interactions['fixture-deal'].votes, 1);
  const vote = await post('/api/deals/interactions', { dealId: 'fixture-deal', deviceId: 'new-device', action: 'upvote' });
  assert.equal(vote.status, 200, await vote.text());
  assert.equal((await get()).interactions['fixture-deal'].votes, 2);
  const event = { eventId: 'fixture-event-001', anonymousId: 'fixture-installation-001', name: 'app_open',
    occurredAt: new Date().toISOString(), platform: 'ios', plan: 'free' };
  const first = await post('/api/analytics/events', { events: [event] });
  assert.equal(first.status, 202, await first.clone().text());
  assert.equal((await first.json()).accepted, 1);
  assert.equal((await (await post('/api/analytics/events', { events: [event] })).json()).duplicate, 1);
  const summary = await mf.dispatchFetch('https://example.test/api/analytics/summary?days=1',
    { headers: { 'x-freefinder-merchant-secret': 'fixture-secret' } });
  assert.equal(summary.status, 200);
  const body = await summary.json();
  assert.equal(body.totals.events, 1);
  assert.equal(body.totals.uniqueInstallations, 1);
  assert.deepEqual((await kv.list()).keys, before.keys, 'Hot writes must not create KV keys');
  assert.deepEqual(await kv.get('deal-interaction:fixture-deal', 'json'), legacy, 'Do not overwrite legacy rollback data');
  assert.equal((await mf.dispatchFetch('https://example.test/api/analytics/summary')).status, 401);
  let last;
  for (let i = 0; i < 13; i++) last = await post('/api/analytics/events', { events: Array.from({ length: 10 }, (_, j) =>
    ({ ...event, eventId: `fixture-limit-${i}-${j}` })) });
  assert.equal(last.status, 429, 'Rate limits survive migration and remain atomic');
  assert.deepEqual((await kv.list()).keys, before.keys);
});

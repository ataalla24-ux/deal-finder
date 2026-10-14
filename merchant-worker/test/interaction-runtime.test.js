import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from 'miniflare';
import { bundledAuth } from './bundled-auth.js';
import { bundledEmail } from './bundled-email.js';
import { bundledAppleClaims } from './bundled-apple-claims.js';

test('Workers runtime retains public cache across requests and invalidates after real KV writes', async t => {
  const modules = await Promise.all(['index.js', 'referral-months.js', 'ad-content-policy.js', 'merchant-promos.js', 'public-interaction-cache.js', 'storage-usage.js', 'subscription-trial.js', 'store-catalog.js', 'store-test-receipt.js'].map(async name => ({
    type: 'ESModule', path: `src/${name}`, contents: await readFile(new URL(`../src/${name}`, import.meta.url), 'utf8'),
  })));
  modules.push(await bundledAuth());
  modules.push(await bundledEmail());
  modules.push(await bundledAppleClaims());
  const mf = new Miniflare(convertV4MiniflareOptions({
    compatibilityDate: '2025-12-01', compatibilityFlags: ['nodejs_compat'], modules,
    kvNamespaces: ['MERCHANT_CAMPAIGNS'],
    log: new Log(LogLevel.NONE),
  }));
  t.after(() => mf.dispose());
  const kv = await mf.getKVNamespace('MERCHANT_CAMPAIGNS');
  const key = 'deal-interaction:sample';
  await kv.put(key, JSON.stringify({ upvotes: ['original-user'] }));
  async function get() {
    const response = await mf.dispatchFetch('https://worker.test/api/deals/interactions?dealIds=sample');
    assert.equal(response.status, 200);
    return (await response.json()).interactions.sample;
  }
  assert.equal((await get()).votes, 1);
  await kv.put(key, JSON.stringify({ upvotes: ['original-user', 'another-user'] }));
  const warm = await Promise.all(Array.from({ length: 20 }, get));
  assert.ok(warm.every(value => value.votes === 1), 'cached public projection is shared within the isolate');
  const response = await mf.dispatchFetch('https://worker.test/api/deals/interactions', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dealId: 'sample', deviceId: 'runtime-user', action: 'rate', rating: 5 }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).interaction.votes, 2, 'write path reads fresh private state');
  const after = await get();
  assert.equal(after.votes, 2); assert.equal(after.ratingAverage, 5);
  assert.equal(after.ratingCount, 1);
});

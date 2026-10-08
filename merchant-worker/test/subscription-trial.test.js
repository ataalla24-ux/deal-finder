import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trialStatus, handleTrialStatus } from '../src/subscription-trial.js';
import worker from '../src/index.js';
const id = 'freefinder.pro.monthly';
const now = Date.parse('2026-10-08T10:00:00Z');
const item = { productId: id, expiryTime: '2026-11-08T10:00:00Z', autoRenewingPlan: { autoRenewEnabled: true }, offerPhase: { freeTrial: {} } };
const purchase = lineItem => ({ subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE', lineItems: [lineItem] });
test('returns only verified trial expiry, not account data or guessed dates', () => {
  assert.deepEqual(trialStatus(purchase(item), id, now), { ok: true, freeTrial: true, productId: id, expiresAt: '2026-11-08T10:00:00.000Z' });
  for (const patch of [
    { offerPhase: undefined }, { offerPhase: { basePrice: {} } }, { offerPhase: { introductoryPrice: {} } },
    { offerPhase: { freeTrial: {}, basePrice: {} } }, { offerPhase: { freeTrial: null } },
    { autoRenewingPlan: { autoRenewEnabled: false } }, { productId: 'unknown' },
    { expiryTime: 'bad' }, { expiryTime: '2026-10-07T10:00:00Z' },
    { deferredItemReplacement: {} }, { deferredItemRemoval: {} },
  ]) assert.equal(trialStatus(purchase({ ...item, ...patch }), id, now).freeTrial, false);
  for (const state of ['PENDING', 'CANCELED', 'EXPIRED', 'IN_GRACE_PERIOD', 'ON_HOLD', 'PAUSED']) {
    assert.equal(trialStatus({ ...purchase(item), subscriptionState: 'SUBSCRIPTION_STATE_' + state }, id, now).freeTrial, false);
  }
  assert.equal(trialStatus({ ...purchase(item), lineItems: [item, item] }, id, now).freeTrial, false);
});

test('accepts both published Android products and rejects Apple-only identifiers', () => {
  for (const productId of ['freefinder.pro.monthly', 'freefinder.pro.yearly']) {
    assert.equal(trialStatus(purchase({ ...item, productId }), productId, now).freeTrial, true);
  }
  for (const productId of ['com.stefanataalla.freefinderwien.premium.monthly', 'com.stefanataalla.freefinderwien.premium.yearly']) {
    assert.equal(trialStatus(purchase({ ...item, productId }), productId, now).freeTrial, false);
  }
});
test('endpoint bounds payload, handles Play failures and reveals only trial status', async t => {
  const request = body => new Request('https://example.test/api/subscriptions/trial-status', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const payload = { productId: id, purchaseToken: 'opaque-purchase-token-value' };
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  const credentials = async () => ({ ok: true, token: 'test-access' });
  globalThis.fetch = async (url, init) => { calls++; assert.ok(String(url).includes('/purchases/subscriptionsv2/tokens/')); assert.equal(init.headers.authorization, 'Bearer test-access'); return Response.json({ ...purchase(item), emailAddress: 'private@example.test' }); };
  const result = await handleTrialStatus(request(payload), {}, credentials, now);
  assert.equal(result.status, 200);
  assert.equal((await result.json()).expiresAt, '2026-11-08T10:00:00.000Z');
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal((await handleTrialStatus(request({ ...payload, productId: 'other' }), {}, credentials, now)).status, 400);
  assert.equal((await handleTrialStatus(request({ ...payload, purchaseToken: 'x'.repeat(5000) }), {}, credentials, now)).status, 413);
  assert.equal(calls, 1);
  globalThis.fetch = async () => new Response('', { status: 403 });
  assert.equal((await handleTrialStatus(request(payload), {}, credentials, now)).status, 503);
  globalThis.fetch = async () => new Response('', { status: 410 });
  assert.deepEqual(await (await handleTrialStatus(request(payload), {}, credentials, now)).json(), { ok: true, freeTrial: false });
});

test('real Worker route uses the existing Google credential contract and no KV', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(init.headers.authorization, 'Bearer route-test-token');
    assert.ok(String(url).includes('/applications/com.stefanataalla.freefinderwien/purchases/subscriptionsv2/tokens/'));
    return Response.json(purchase({ ...item, expiryTime: new Date(Date.now() + 86400000 * 20).toISOString() }));
  };
  const request = () => new Request('https://example.test/api/subscriptions/trial-status', {
    method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': 'route-test' },
    body: JSON.stringify({ productId: id, purchaseToken: 'opaque-purchase-token-value' }),
  });
  const storage = new Proxy({}, { get() { assert.fail('trial verification must not consume KV'); } });
  const response = await worker.fetch(request(), { GOOGLE_PLAY_ACCESS_TOKEN: 'route-test-token', MERCHANT_CAMPAIGNS: storage });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).freeTrial, true);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const unavailable = await worker.fetch(request(), { MERCHANT_CAMPAIGNS: storage });
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { ok: false });
  assert.equal(calls, 1, 'missing credentials must not call Google with an object or error as token');
});

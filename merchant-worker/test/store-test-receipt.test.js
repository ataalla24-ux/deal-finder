import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { generateKeyPair, exportPKCS8 } from 'jose';
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from 'miniflare';
import { handleTestReceipt, summarizeTestReceipt } from '../src/store-test-receipt.js';
import { referralPurchase } from '../src/referral-months.js';

const APP = 'com.stefanataalla.freefinderwien';
const owner = '00000000-0000-4000-8000-000000000123';
const now = Date.now();
const iosInput = { platform: 'ios', accountId: owner, transactionId: '9999912345' };
const playInput = { platform: 'android', accountId: owner, purchaseToken: 'fixture-private-test-token-123456789' };
const apple = { environment: 'Sandbox', bundleId: APP, transactionId: iosInput.transactionId,
  originalTransactionId: iosInput.transactionId, productId: APP + '.premium.monthly', appAccountToken: owner,
  purchaseDate: now - 60000, expiresDate: now + 240000, offerDiscountType: 'FREE_TRIAL',
  offerIdentifier: 'referral-earned-month-2026', privateField: 'never-return' };
const play = { testPurchase: {}, startTime: new Date(now - 60000).toISOString(),
  externalAccountIdentifiers: { obfuscatedExternalAccountId: owner }, subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
  acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED', lineItems: [{ productId: 'freefinder.pro.monthly',
    expiryTime: new Date(now + 240000).toISOString(), offerDetails: { offerId: 'referral-earned-month' },
    offerPhase: { freeTrial: {} } }], privateField: 'never-return' };
const env = { STORE_TEST_RECEIPTS_ENABLED: '1', MERCHANT_PROMO_ADMIN_SECRET: 'fixture-admin' };

test('diagnostic summaries expose test facts without granting credit or fabricating a real-month duration', () => {
  for (const [input, raw] of [[iosInput, apple], [playInput, play]]) {
    const output = summarizeTestReceipt(input, raw, now);
    assert.equal(output.testReceipt, true); assert.equal(output.ownerMatches, true);
    assert.equal(output.periodSeconds, 300); assert.equal(output.freePhase, true);
    assert.equal(output.rewardOfferMatches, true); assert.equal(output.activePeriod, true);
    assert.equal(output.grantsCredit, false); assert.equal(output.redemptionTested, false);
    assert.equal(output.billingPeriodVerified, false);
    assert.doesNotMatch(JSON.stringify(output), /never-return|00000000|9999912345|fixture-private|purchaseToken/);
    assert.throws(() => referralPurchase(input.platform, raw, owner, now), 'Production policy must continue rejecting test receipts');
  }
  const externalCode = summarizeTestReceipt(iosInput, { ...apple, appAccountToken: undefined }, now);
  assert.equal(externalCode.ownerPresent, false); assert.equal(externalCode.ownerMatches, false);
  assert.equal(summarizeTestReceipt(iosInput, { ...apple, appAccountToken: 'other' }, now).ownerMatches, false);
  assert.equal(summarizeTestReceipt(iosInput, { ...apple, expiresDate: 'invalid' }, now).periodSeconds, null);
  assert.equal(summarizeTestReceipt(iosInput, { ...apple, revocationDate: now }, now).activePeriod, false);
  assert.equal(summarizeTestReceipt(playInput, { ...play, acknowledgementState: 'OTHER' }, now).acknowledged, false);
  assert.equal(summarizeTestReceipt(playInput, { ...play, subscriptionState: 'OTHER' }, now).activePeriod, false);
});

test('paid production, wrong-app/product and mismatched receipt responses are never accepted as sandbox evidence', () => {
  for (const raw of [null, {}, { ...apple, environment: 'Production' }, { ...apple, bundleId: 'other.app' },
    { ...apple, transactionId: '5555555555' }, { ...apple, productId: 'other.product' }]) {
    assert.throws(() => summarizeTestReceipt(iosInput, raw, now), error => error.status === 409);
  }
  for (const raw of [null, {}, { ...play, testPurchase: undefined }, { ...play, testPurchase: [] },
    { ...play, lineItems: [] }, { ...play, lineItems: [play.lineItems[0], play.lineItems[0]] },
    { ...play, lineItems: [{ productId: 'other.product' }] }]) {
    assert.throws(() => summarizeTestReceipt(playInput, raw, now), error => error.status === 409);
  }
});

test('operator auth, default-OFF gate and bounded schema reject before credential lookup', async () => {
  const unexpected = async () => assert.fail('No Store authorization before gates');
  const run = (body = iosInput, overrides = {}, settings = env) => handleTestReceipt(new Request('https://fixture/check', {
    method: 'POST', headers: { authorization: 'Bearer fixture-admin', 'content-type': 'application/json' },
    body: JSON.stringify(body), ...overrides,
  }), settings, { appleToken: unexpected, googleToken: unexpected });
  assert.equal((await run(iosInput, {}, { ...env, STORE_TEST_RECEIPTS_ENABLED: '0' })).status, 503);
  assert.equal((await run(iosInput, { headers: { authorization: 'Bearer customer' } })).status, 401);
  assert.equal((await run(iosInput, {}, {})).status, 503);
  assert.equal((await run(iosInput, { method: 'GET', body: undefined })).status, 405);
  for (const input of [null, [], {}, { ...iosInput, accountId: [owner] }, { ...iosInput, platform: 'other' },
    { ...iosInput, transactionId: 123456789 }, { ...iosInput, transactionId: '../x' },
    { ...iosInput, sandbox: true }, { ...playInput, purchaseToken: ['x'.repeat(30)] },
    { ...playInput, url: 'https://untrusted.example' }, { ...iosInput, huge: 'x'.repeat(16001) }]) {
    assert.equal((await run(input)).status, 400);
  }
});

test('actual Worker receipt diagnostic uses Sandbox-only Apple GET / test-marked Play GET and never touches a ledger', async t => {
  const key = await generateKeyPair('ES256', { extractable: true });
  const bundled = await build({ entryPoints: [fileURLToPath(new URL('../src/index.js', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
  let mode = 'success', calls = [];
  const mf = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-03-09',
    modules: [{ type: 'ESModule', path: 'worker.js', contents: bundled.outputFiles[0].text }],
    // No DO or KV bindings at all: any ledger operation fails this integration test.
    bindings: { ...env, GOOGLE_PLAY_ACCESS_TOKEN: 'fixture-google-secret', APP_STORE_CONNECT_KEY_ID: 'FIXTUREKEY',
      APP_STORE_CONNECT_ISSUER_ID: owner, APP_STORE_CONNECT_PRIVATE_KEY: await exportPKCS8(key.privateKey) },
    log: new Log(LogLevel.NONE), outboundService: async request => {
      const url = new URL(request.url); calls.push({ host: url.host, path: url.pathname, method: request.method });
      assert.equal(request.method, 'GET'); assert.equal(await request.text(), '');
      assert.equal(url.search, ''); assert.ok(request.headers.get('authorization').startsWith('Bearer '));
      assert.ok(['api.storekit-sandbox.itunes.apple.com', 'androidpublisher.googleapis.com'].includes(url.host));
      if (mode.startsWith('http')) return new Response('private-provider-error', { status: Number(mode.slice(4)),
        headers: { location: 'https://untrusted.example' } });
      if (mode === 'oversized') return Response.json({ value: 'x'.repeat(262145) });
      if (mode === 'bad-json') return new Response('private-provider-error', { headers: { 'content-type': 'application/json' } });
      if (mode === 'network') throw Error('private-provider-error');
      if (url.host.startsWith('api.storekit')) {
        assert.equal(url.pathname, '/inApps/v1/transactions/' + iosInput.transactionId);
        const raw = { ...apple, environment: mode === 'production' ? 'Production' : 'Sandbox' };
        return Response.json({ signedTransactionInfo: 'fixture.' + btoa(JSON.stringify(raw)) + '.fixture' });
      }
      assert.equal(url.pathname, '/androidpublisher/v3/applications/' + APP + '/purchases/subscriptionsv2/tokens/' + playInput.purchaseToken);
      return Response.json({ ...play, testPurchase: mode === 'production' ? undefined : {} });
    },
  }));
  t.after(() => mf.dispose());
  const run = body => mf.dispatchFetch('https://fixture/api/subscriptions/admin/test-receipt', {
    method: 'POST', headers: { authorization: 'Bearer fixture-admin', 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  for (const input of [iosInput, playInput]) {
    mode = 'success'; calls = [];
    const response = await run(input); assert.equal(response.status, 200);
    assert.equal((await response.json()).testReceipt, true); assert.equal(calls.length, 1);
    for (const failure of ['http301', 'http302', 'http303', 'http307', 'http308', 'http401', 'http404', 'http429',
      'http500', 'oversized', 'bad-json', 'network', 'production']) {
      mode = failure; calls = [];
      const response = await run(input); assert.equal(response.status, failure === 'production' ? 409 : 503);
      assert.equal(calls.length, 1, 'No follow-up request or production fallback');
      assert.doesNotMatch(await response.text(), /private-provider|fixture-google|00000000|fixture-private/);
    }
  }
});

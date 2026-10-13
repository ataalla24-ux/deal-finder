import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { generateKeyPair, exportPKCS8 } from 'jose';
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from 'miniflare';
import { handlePlayCatalog, summarizePlayCatalog } from '../src/store-catalog.js';

const APP = 'com.stefanataalla.freefinderwien', product = 'freefinder.pro.monthly';
const subscription = id => ({ packageName: APP, productId: id, privateField: 'never-expose', basePlans: [{
  basePlanId: id.endsWith('yearly') ? 'yearly' : 'monthly', state: 'ACTIVE',
  autoRenewingBasePlanType: { billingPeriodDuration: id.endsWith('yearly') ? 'P1Y' : 'P1M' },
  regionalConfigs: [{ regionCode: 'AT', newSubscriberAvailability: true, price: { currencyCode: 'EUR', units: '3', nanos: 990000000 } },
    { regionCode: 'DE', newSubscriberAvailability: true }, { regionCode: 'US', privateField: 'never-expose' }],
}] });
const offers = id => ({ subscriptionOffers: [{ packageName: APP, productId: id,
  basePlanId: id.endsWith('yearly') ? 'yearly' : 'monthly', offerId: 'fixture-trial', state: 'ACTIVE',
  targeting: { acquisitionRule: { scope: { anySubscriptionInApp: {} } } },
  regionalConfigs: [{ regionCode: 'AT', newSubscriberAvailability: true }, { regionCode: 'DE', newSubscriberAvailability: false }],
  phases: [{ duration: 'P1M', recurrenceCount: 1, regionalConfigs: [{ regionCode: 'AT', free: {} }, { regionCode: 'DE', free: {} }] }],
  privateField: 'never-expose',
}] });

test('catalog summaries expose only offer terms, never private fields, unrelated regions or pagination tokens', () => {
  const input = offers(product), raw = subscription(product);
  const summary = summarizePlayCatalog(product, raw, input);
  assert.equal(summary.complete, true);
  assert.equal(summary.offers[0].targeting, 'new_to_app');
  assert.deepEqual(summary.basePlans[0].regions.map(x => x.regionCode), ['AT', 'DE']);
  assert.deepEqual(summary.basePlans[0].regions[0].price, { currencyCode: 'EUR', units: '3', nanos: 990000000 });
  assert.equal(summary.offers[0].phases[0].regions[0].free, true);
  assert.equal(summary.offers[0].regions[1].newSubscriberAvailability, false);
  assert.doesNotMatch(JSON.stringify(summary), /never-expose|privateField|US/);
  const paginated = summarizePlayCatalog(product, raw, { ...input, nextPageToken: 'private-pagination-token' });
  assert.equal(paginated.complete, false);
  assert.doesNotMatch(JSON.stringify(paginated), /private-pagination-token/);
  assert.deepEqual(summarizePlayCatalog(product, raw, {}).offers, []);
});

test('offer targeting and free phase reporting do not treat paid or malformed overrides as free', () => {
  for (const [target, expected] of [[undefined, 'developer_determined'], [{}, 'developer_determined'],
    [{ acquisitionRule: { scope: { thisSubscription: {} } } }, 'new_to_subscription'],
    [{ upgradeRule: {} }, 'upgrade'], [{ unknownRule: {} }, 'unknown']]) {
    const input = offers(product); input.subscriptionOffers[0].targeting = target;
    assert.equal(summarizePlayCatalog(product, subscription(product), input).offers[0].targeting, expected);
  }
  for (const patch of [{ free: null }, { free: [] }, { free: undefined, price: { currencyCode: 'EUR', units: '1' } },
    { price: { currencyCode: 'EUR', units: '1' } }, { relativeDiscount: 0.5 }, { absoluteDiscount: { units: '1' } }]) {
    const input = offers(product); Object.assign(input.subscriptionOffers[0].phases[0].regionalConfigs[0], patch);
    assert.equal(summarizePlayCatalog(product, subscription(product), input).offers[0].phases[0].regions[0].free, false);
  }
  for (const input of [null, { subscriptionOffers: {} }, { subscriptionOffers: [null] },
    { subscriptionOffers: [{ ...offers(product).subscriptionOffers[0], productId: 'other.product' }] },
    { subscriptionOffers: [{ ...offers(product).subscriptionOffers[0], basePlanId: 'unknown-plan' }] }]) {
    assert.throws(() => summarizePlayCatalog(product, subscription(product), input));
  }
  assert.throws(() => summarizePlayCatalog(product, { ...subscription(product), packageName: 'other.app' }, offers(product)));
});

test('catalog handler rejects unsupported methods, parameters and missing admin access before OAuth', async () => {
  const auth = () => assert.fail('Rejected requests must not resolve Store credentials');
  for (const [method, suffix, env, bearer, expected] of [
    ['POST', '', {}, '', 405], ['GET', '?product=other', {}, '', 400], ['GET', '', {}, '', 503],
    ['GET', '', { MERCHANT_PROMO_ADMIN_SECRET: 'fixture-admin' }, '', 401],
    ['GET', '', { MERCHANT_PROMO_ADMIN_SECRET: 'fixture-admin' }, 'Bearer wrong-secret', 401],
  ]) {
    const response = await handlePlayCatalog(new Request('https://fixture/catalog' + suffix,
      { method, headers: { authorization: bearer } }), env, auth);
    assert.equal(response.status, expected); assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});

test('actual Worker catalog route is authenticated, bounded and GET-only at Google with no ledger operations', async t => {
  const key = await generateKeyPair('RS256', { extractable: true });
  const bundled = await build({ entryPoints: [fileURLToPath(new URL('../src/index.js', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
  const outbound = []; let mode = 'success';
  const mf = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-03-09',
    modules: [{ type: 'ESModule', path: 'worker.js', contents: bundled.outputFiles[0].text }],
    bindings: { MERCHANT_PROMO_ADMIN_SECRET: 'fixture-admin', GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: JSON.stringify({
      client_email: 'fixture@example.test', private_key: await exportPKCS8(key.privateKey),
    }) }, log: new Log(LogLevel.NONE), outboundService: async request => {
      const url = new URL(request.url); outbound.push({ host: url.host, path: url.pathname, method: request.method });
      assert.ok(request.signal instanceof AbortSignal);
      if (url.host === 'oauth2.googleapis.com') {
        assert.equal(url.pathname, '/token'); assert.equal(request.method, 'POST');
        assert.ok(new URLSearchParams(await request.text()).get('assertion'));
        if (mode === 'oauth-error') return Response.json({ error_description: 'private-upstream-details' }, { status: 401 });
        return Response.json({ access_token: 'fixture-token-never-echo' });
      }
      assert.equal(url.host, 'androidpublisher.googleapis.com', 'never follow credential-bearing redirects');
      assert.equal(request.method, 'GET'); assert.equal(await request.text(), '');
      assert.equal(request.headers.get('authorization'), 'Bearer fixture-token-never-echo');
      const match = url.pathname.match(/^\/androidpublisher\/v3\/applications\/com\.stefanataalla\.freefinderwien\/subscriptions\/(freefinder\.pro\.(monthly|yearly))(\/basePlans\/-\/offers)?$/);
      assert.ok(match, 'no financial/purchase/other-app endpoint allowed');
      if (mode.startsWith('http-')) return new Response('private-upstream-details', { status: Number(mode.slice(5)),
        headers: { location: 'https://untrusted.example/collect' } });
      if (mode === 'oversized') return Response.json({ data: 'x'.repeat(262145) });
      if (mode === 'bad-json') return new Response('private-upstream-details', { headers: { 'content-type': 'application/json' } });
      if (mode === 'network-error') throw Error('private-upstream-details');
      if (match[3]) { assert.equal(url.search, '?pageSize=20'); return Response.json(offers(match[1])); }
      assert.equal(url.search, ''); return Response.json(subscription(match[1]));
    },
  }));
  t.after(() => mf.dispose());
  const run = (authorization = 'Bearer fixture-admin') => mf.dispatchFetch('https://fixture/api/subscriptions/admin/play-catalog',
    { headers: { authorization } });
  assert.equal((await run('Bearer ordinary-account-token')).status, 401);
  assert.equal(outbound.length, 0);
  const response = await run();
  assert.equal(response.status, 200); const result = await response.json();
  assert.equal(result.ok, true); assert.equal(result.purchaseVerificationTested, false); assert.equal(result.redemptionTested, false);
  assert.equal(result.products.length, 2); assert.equal(outbound.length, 5);
  assert.equal(outbound.filter(x => x.host === 'oauth2.googleapis.com').length, 1);
  assert.doesNotMatch(JSON.stringify(result), /never-echo|private|example.test|BEGIN/);
  for (const failure of ['http-301', 'http-302', 'http-303', 'http-307', 'http-308', 'http-401', 'http-403', 'http-404',
    'http-429', 'http-500', 'oversized', 'bad-json', 'network-error', 'oauth-error']) {
    await t.test(failure, async () => {
      mode = failure; outbound.length = 0;
      const denied = await run(); const data = await denied.json();
      assert.equal(denied.status, 503); assert.equal(data.ok, false);
      assert.equal(outbound.length, failure === 'oauth-error' ? 1 : 2);
      assert.doesNotMatch(JSON.stringify(data), /private-upstream-details|never-echo|example.test|BEGIN/);
      assert.equal(data.stage, failure === 'oauth-error' ? 'authorization' : product + ':subscription');
    });
  }
});

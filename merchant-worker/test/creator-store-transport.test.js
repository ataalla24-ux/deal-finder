import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { generateKeyPair, exportPKCS8, jwtVerify } from 'jose';
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from 'miniflare';
import { workerBundleOptions } from './bundled-apple-claims.js';
import { creatorDrafts, creatorHash } from '../src/creator-program.js';

const DAY = 86400000, OWNER = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'fixture-creator-private-token', APP = 'com.stefanataalla.freefinderwien';
const jws = body => ['fixture', Buffer.from(JSON.stringify(body)).toString('base64url'), 'signature'].join('.');
const money = cents => ({ currencyCode: 'EUR', units: String(Math.floor(cents / 100)), nanos: cents % 100 * 10000000 });

test('creator transport trusts only authenticated Store HTTP evidence, including renewal and refund history', async t => {
  const now = Date.now(), start = now - 20 * DAY;
  const p = { ...creatorDrafts()[0], state: 'active', acceptsNew: true, storeVerified: true, contractRef: 'fixture-contract',
    activatedAt: now - 90 * DAY, appleOfferId: 'creator-foodiewien', playOfferId: 'creator-foodiewien' };
  const appleKey = await generateKeyPair('ES256', { extractable: true });
  const googleKey = await generateKeyPair('RS256', { extractable: true });
  const bundle = await build({ ...workerBundleOptions, entryPoints: [fileURLToPath(new URL('../src/index.js', import.meta.url))] });
  let mode = 'apple', redirect = null, overrides = {}, historyMore = false, calls = [];
  const apple = patch => ({ environment: 'Production', bundleId: APP, productId: APP + '.premium.monthly',
    transactionId: '100000001', originalTransactionId: '100000001', currency: 'EUR', storefront: 'AUT',
    inAppOwnershipType: 'PURCHASED', price: 3990, purchaseDate: start, originalPurchaseDate: start,
    expiresDate: start + 30 * DAY, offerType: 3, offerIdentifier: p.appleOfferId, appAccountToken: OWNER, ...patch });
  const order = (orderId, patch = {}) => ({ orderId, purchaseToken: TOKEN, state: 'PROCESSED',
    buyerAddress: { buyerCountry: 'AT' }, total: money(399),
    lineItems: [{ productId: 'freefinder.pro.monthly', subscriptionDetails: { basePlanId: 'monthly', offerId: p.playOfferId,
      servicePeriodStartTime: new Date(start).toISOString(), servicePeriodEndTime: new Date(start + 30 * DAY).toISOString() } }], ...patch });
  const mf = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-03-09', compatibilityFlags: ['nodejs_compat'],
    modules: [{ type: 'ESModule', path: 'entry.js', contents: `
      import { CreatorProgram } from './worker.js';
      export default { async fetch(request, env) {
        const body = await request.json();
        const ledger = new CreatorProgram({storage:{async get(){return body.storedChain || null}}}, env);
        try { return Response.json({ok:true,evidence:await ledger.verify(body.request,body.partners,body.chain || null)}); }
        catch { return Response.json({ok:false},{status:503}); }
      }};
    ` }, { type: 'ESModule', path: 'worker.js', contents: bundle.outputFiles[0].text }],
    bindings: {
      APP_STORE_CONNECT_ISSUER_ID: OWNER, APP_STORE_CONNECT_KEY_ID: 'TESTKEY001', APP_STORE_CONNECT_PRIVATE_KEY: await exportPKCS8(appleKey.privateKey),
      GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'fixture@example.test', private_key: await exportPKCS8(googleKey.privateKey) }),
    }, log: new Log(LogLevel.NONE), outboundService: async request => {
      const url = new URL(request.url); calls.push({ host: url.host, path: url.pathname });
      if (url.host === redirect) return new Response(null, { status: 307, headers: { location: 'https://untrusted.example.test/steal' } });
      if (url.host === 'oauth2.googleapis.com') {
        const form = new URLSearchParams(await request.text());
        await jwtVerify(form.get('assertion'), googleKey.publicKey, { issuer: 'fixture@example.test', audience: 'https://oauth2.googleapis.com/token', algorithms: ['RS256'] });
        return Response.json({ access_token: 'fixture-google-access' });
      }
      if (url.host === 'api.storekit.itunes.apple.com') {
        const jwt = request.headers.get('authorization')?.slice(7);
        await jwtVerify(jwt, appleKey.publicKey, { issuer: OWNER, audience: 'appstoreconnect-v1', algorithms: ['ES256'] });
        if (url.pathname.includes('/history/')) return Response.json({ environment: 'Production', bundleId: APP,
          hasMore: historyMore, signedTransactions: [jws(apple({ transactionId: '100000002', price: 4990, offerIdentifier: undefined })),
            jws(apple({ revocationDate: now - DAY }))] });
        if (url.pathname.includes('/subscriptions/')) return Response.json({ environment: 'Production', bundleId: APP,
          data: [{ lastTransactions: [{ originalTransactionId: '100000001', signedRenewalInfo: jws({ environment: 'Production',
            originalTransactionId: '100000001', offerType: 3, offerIdentifier: p.appleOfferId }) }] }] });
        return Response.json({ signedTransactionInfo: jws(apple(mode === 'trial' ? { price: 0, offerType: 1,
          offerDiscountType: 'FREE_TRIAL', offerIdentifier: undefined, ...overrides } : overrides)) });
      }
      assert.equal(url.host, 'androidpublisher.googleapis.com', 'Unexpected outbound requests must never reach the network');
      assert.equal(request.headers.get('authorization'), 'Bearer fixture-google-access');
      if (url.pathname.includes('/orders/')) {
        const orderId = decodeURIComponent(url.pathname.split('/orders/')[1]);
        return Response.json(order(orderId, mode === 'google-refund' ? {
          state: 'PARTIALLY_REFUNDED', orderHistory: { partialRefundEvents: [{ state: 'PROCESSED_SUCCESSFULLY', refundDetails: { total: money(1) } }] },
        } : overrides));
      }
      return Response.json({ regionCode: 'AT', startTime: new Date(start).toISOString(),
        externalAccountIdentifiers: { obfuscatedExternalAccountId: OWNER },
        lineItems: [{ productId: 'freefinder.pro.monthly', latestSuccessfulOrderId: 'GPA.1111-2222-3333-44444..1' }] });
    },
  }));
  t.after(() => mf.dispose());
  async function verify(request, extra = {}) {
    const response = await mf.dispatchFetch('https://test/verify', { method: 'POST', body: JSON.stringify({ request, partners: [p], ...extra }) });
    return { status: response.status, body: await response.json() };
  }
  await t.test('Apple uses authenticated production API, ignores client amount and signed payload', async () => {
    const result = await verify({ platform: 'ios', transactionId: '100000001', price: 1, signedTransactionInfo: jws(apple({ price: 1 })) });
    assert.equal(result.status, 200); assert.equal(result.body.evidence.grossCents, 399);
    assert.deepEqual(calls.map(x => x.host), ['api.storekit.itunes.apple.com']);
  });
  await t.test('intro trial links only through trusted upcoming renewal offer and earns zero', async () => {
    mode = 'trial'; calls = [];
    const result = await verify({ platform: 'ios', transactionId: '100000001' });
    assert.equal(result.status, 200); assert.equal(result.body.evidence.grossCents, 0);
    assert.equal(calls.filter(x => x.path.includes('/subscriptions/')).length, 1);
  });
  await t.test('unpaid or foreign Apple proof is never substituted for a production receipt', async () => {
    mode = 'apple'; overrides = { environment: 'Sandbox' };
    assert.equal((await verify({ platform: 'ios', transactionId: '100000001' })).status, 503);
    overrides = {};
  });
  await t.test('existing Apple chain loads renewals and historical full refunds, not only the submitted transaction', async () => {
    const result = await verify({ platform: 'ios', transactionId: '100000001' }, {
      chain: { key: 'ios:100000001', partnerId: p.id, terms: p },
    });
    assert.equal(result.status, 200); assert.equal(result.body.evidence.length, 2);
    assert.equal(result.body.evidence[0].grossCents, 499); assert.equal(result.body.evidence[1].refundedCents, 399);
    historyMore = true;
    assert.equal((await verify({ platform: 'ios', transactionId: '100000001' }, {
      chain: { key: 'ios:100000001', partnerId: p.id, terms: p },
    })).status, 503, 'A truncated history must hold payout for review');
    historyMore = false;
  });
  await t.test('Google checks real order price and token after authenticated subscription lookup', async () => {
    mode = 'google'; calls = [];
    const result = await verify({ platform: 'android', purchaseToken: TOKEN, grossCents: 99999 });
    assert.equal(result.status, 200); assert.equal(result.body.evidence.grossCents, 399);
    assert.equal(result.body.evidence.key, 'android:' + await creatorHash(TOKEN));
    overrides = { purchaseToken: TOKEN + '-other' };
    assert.equal((await verify({ platform: 'android', purchaseToken: TOKEN })).status, 503);
    overrides = {};
  });
  await t.test('Google reconciliation rechecks previously paid orders for partial refunds', async () => {
    mode = 'google-refund'; calls = [];
    const result = await verify({ platform: 'android', purchaseToken: TOKEN }, { chain: {
      key: 'android:' + await creatorHash(TOKEN), partnerId: p.id, terms: p,
      paymentKeys: ['payment:android:GPA.1111-2222-3333-44444..0'],
    } });
    assert.equal(result.status, 200); assert.equal(result.body.evidence.length, 2);
    assert.equal(result.body.evidence[1].refundedCents, 1);
    assert.equal(calls.filter(x => x.path.includes('/orders/')).length, 2);
  });
  for (const host of ['oauth2.googleapis.com', 'androidpublisher.googleapis.com', 'api.storekit.itunes.apple.com']) {
    await t.test('credentials cannot follow redirects from ' + host, async () => {
      redirect = host; mode = 'apple'; calls = [];
      const result = await verify(host.includes('storekit') ? { platform: 'ios', transactionId: '100000001' } : { platform: 'android', purchaseToken: TOKEN });
      assert.equal(result.status, 503); assert.equal(calls.some(x => x.host === 'untrusted.example.test'), false);
      redirect = null;
    });
  }
});

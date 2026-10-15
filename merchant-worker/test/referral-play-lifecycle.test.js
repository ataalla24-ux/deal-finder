import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { generateKeyPair, exportJWK, exportPKCS8, jwtVerify, SignJWT } from 'jose';
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from 'miniflare';
import { workerBundleOptions } from './bundled-apple-claims.js';
import { accountID } from '../src/account-auth.js';
import { monthAfter } from '../src/referral-months.js';

const DAY = 86400000;
const APP = 'com.stefanataalla.freefinderwien';
const API = `/androidpublisher/v3/applications/${APP}`;
const PROJECT = 'fixture-freefinder';

// Real router, JWT verification, Store transport and SQLite ledger. Only external providers are fixtures.
async function runtime(t) {
  const firebase = await generateKeyPair('RS256', { extractable: true });
  const google = await generateKeyPair('RS256', { extractable: true });
  const jwk = { ...await exportJWK(firebase.publicKey), kid: 'fixture-firebase', alg: 'RS256', use: 'sig' };
  const bundled = await build({ entryPoints: [fileURLToPath(new URL('../src/index.js', import.meta.url))], ...workerBundleOptions });
  const directory = await mkdtemp(join(tmpdir(), 'freefinder-play-lifecycle-'));
  const users = new Map(), purchases = new Map(), orders = new Map(), calls = [];
  let mf, sequence = 0, lostDeferralResponse = false, providerUnavailable = false;
  const options = {
    compatibilityDate: '2026-03-09', compatibilityFlags: ['nodejs_compat'],
    modules: [{ type: 'ESModule', path: 'worker.js', contents: bundled.outputFiles[0].text }],
    durableObjects: { REFERRAL_MONTHS: { className: 'ReferralMonths', useSQLite: true } },
    bindings: {
      ACCOUNTS_ENABLED: '1', FIREBASE_PROJECT_ID: PROJECT, FIREBASE_WEB_API_KEY: 'fixture-api-key',
      REFERRAL_MONTHS_ENABLED: '1', REFERRAL_PLAY_DEFERRAL_ENABLED: '1',
      REFERRAL_PLAY_REWARD_SUBSCRIPTION_ENABLED: '1', REFERRAL_PLAY_REWARD_BASE_PLAN: 'monthly',
      GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'fixture@example.test', private_key: await exportPKCS8(google.privateKey) }),
    },
    log: new Log(LogLevel.NONE),
    outboundService: async request => {
      const url = new URL(request.url);
      calls.push({ host: url.host, path: url.pathname, method: request.method });
      if (url.host === 'www.googleapis.com') {
        assert.equal(url.pathname, '/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
        assert.equal(request.method, 'GET');
        return Response.json({ keys: [jwk] });
      }
      if (url.host === 'identitytoolkit.googleapis.com') {
        assert.equal(url.pathname, '/v1/accounts:lookup');
        assert.equal(url.searchParams.get('key'), 'fixture-api-key');
        assert.equal(request.method, 'POST');
        const { idToken } = await request.json();
        const user = users.get(idToken);
        return Response.json({ users: user ? [user] : [] });
      }
      if (url.host === 'oauth2.googleapis.com') {
        assert.equal(url.pathname, '/token');
        assert.equal(request.method, 'POST');
        const form = new URLSearchParams(await request.text());
        assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
        const { payload } = await jwtVerify(form.get('assertion'), google.publicKey,
          { issuer: 'fixture@example.test', audience: 'https://oauth2.googleapis.com/token', algorithms: ['RS256'] });
        assert.equal(payload.scope, 'https://www.googleapis.com/auth/androidpublisher');
        return Response.json({ access_token: 'fixture-google-access' });
      }
      assert.equal(url.host, 'androidpublisher.googleapis.com', 'Never allow real network or unexpected providers');
      assert.equal(request.headers.get('authorization'), 'Bearer fixture-google-access');
      if (providerUnavailable) return Response.json({ error: 'fixture-provider-private-error' }, { status: 503 });
      if (url.pathname.startsWith(`${API}/orders/`)) {
        assert.equal(request.method, 'GET');
        const order = orders.get(decodeURIComponent(url.pathname.slice(`${API}/orders/`.length)));
        return Response.json(order || {}, { status: order ? 200 : 404 });
      }
      assert.ok(url.pathname.startsWith(`${API}/purchases/subscriptionsv2/tokens/`));
      const suffix = decodeURIComponent(url.pathname.slice(`${API}/purchases/subscriptionsv2/tokens/`.length));
      const defer = suffix.endsWith(':defer'), token = defer ? suffix.slice(0, -6) : suffix;
      const purchase = purchases.get(token);
      if (!purchase) return Response.json({}, { status: 404 });
      if (!defer) { assert.equal(request.method, 'GET'); return Response.json(purchase); }
      assert.equal(request.method, 'POST');
      const { deferralContext } = await request.json();
      assert.equal(deferralContext.etag, purchase.etag);
      assert.equal(deferralContext.validateOnly, false);
      const item = purchase.lineItems[0], before = Date.parse(item.expiryTime), after = monthAfter(before);
      assert.equal(deferralContext.deferDuration, `${(after - before) / 1000}s`);
      item.expiryTime = new Date(after).toISOString();
      purchase.etag += '-deferred';
      if (lostDeferralResponse) return Response.json({ error: 'fixture-response-lost-after-commit' }, { status: 503 });
      return Response.json({ itemExpiryTimeDetails: [{ productId: item.productId, expiryTime: item.expiryTime }] });
    },
  };
  const start = () => { mf = new Miniflare({ ...convertV4MiniflareOptions(options), resourcePersistencePath: directory }); };
  start();
  t.after(async () => { await mf.dispose(); await rm(directory, { recursive: true, force: true }); });
  const actor = async name => {
    const seconds = Math.floor(Date.now() / 1000), uid = 'fixture-' + name, email = name + '@example.test';
    const token = await new SignJWT({ email, email_verified: true, auth_time: seconds, firebase: { sign_in_provider: 'password' } })
      .setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).setSubject(uid).setIssuedAt(seconds)
      .setExpirationTime(seconds + 3600).setIssuer(`https://securetoken.google.com/${PROJECT}`).setAudience(PROJECT).sign(firebase.privateKey);
    users.set(token, { localId: uid, email, emailVerified: true, providerUserInfo: [{ providerId: 'password' }] });
    return { token, id: await accountID(uid) };
  };
  const call = async (action, person, body = {}, expected = 200, root = 'referral-months') => {
    const response = await mf.dispatchFetch(`https://fixture/api/${root}/${action}`, {
      method: 'POST', headers: { authorization: 'Bearer ' + person.token, 'content-type': 'application/json',
        'cf-connecting-ip': `192.0.2.${++sequence % 250 + 1}` },
      body: JSON.stringify({ platform: 'android', ...body }),
    });
    const result = await response.json();
    assert.equal(response.status, expected, action + ': ' + JSON.stringify(result));
    return result;
  };
  const receipt = (person, name, { yearly = false, rewardId, started = Date.now(), paid = false } = {}) => {
    const token = 'fixture-purchase-token-' + name, orderId = 'GPA.fixture-order-' + name;
    const productId = 'freefinder.pro.' + (yearly ? 'yearly' : 'monthly'), basePlanId = yearly ? 'yearly' : 'monthly';
    const offerId = rewardId ? 'referral-earned-month' : yearly ? 'yearly-month-free' : 'flyer-month-free';
    const expiryTime = new Date(started + (paid && yearly ? 365 : 30) * DAY).toISOString();
    const raw = { subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE', acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
      regionCode: 'AT', etag: 'fixture-etag-' + name, startTime: new Date(started).toISOString(),
      externalAccountIdentifiers: { obfuscatedExternalAccountId: person.id, ...(rewardId ? { obfuscatedExternalProfileId: rewardId } : {}) },
      lineItems: [{ productId, expiryTime, latestSuccessfulOrderId: orderId, autoRenewingPlan: { autoRenewEnabled: true },
        offerDetails: { basePlanId, ...(paid ? {} : { offerId }) }, offerPhase: paid ? { basePrice: {} } : { freeTrial: {} } }] };
    purchases.set(token, raw);
    const order = { orderId, purchaseToken: token, state: 'PROCESSED', lineItems: [{ productId,
      subscriptionDetails: { basePlanId, ...(paid ? {} : { offerId }), servicePeriodStartTime: raw.startTime,
        servicePeriodEndTime: expiryTime, offerPhaseDetails: paid ? { basePriceDetails: {} } : { freeTrialDetails: {} } } }] };
    orders.set(orderId, order);
    return { token, orderId, raw, order };
  };
  const earn = async (name, yearly = false) => {
    const owner = await actor(name + '-inviter'), friend = await actor(name + '-friend');
    const registered = await call('register', owner);
    await call('register', friend);
    await call('accept', friend, { code: registered.code });
    const source = receipt(friend, name + '-trial', { yearly });
    await call('confirm', friend, { purchaseToken: source.token });
    await call('confirm', friend, { purchaseToken: source.token });
    const status = await call('status', owner);
    assert.equal(status.earnedMonths, 1);
    assert.equal(status.rewards.length, 1);
    return { owner, friend, source, rewardId: status.rewards[0].id };
  };
  return { actor, call, receipt, earn, calls, users,
    restart: async () => { await mf.dispose(); start(); },
    lostResponse: value => { lostDeferralResponse = value; },
    outage: value => { providerUnavailable = value; } };
}

test('authenticated production Google HTTP lifecycle preserves ownership, credit and financial idempotence across Worker restart', async t => {
  const r = await runtime(t);
  const deferrals = () => r.calls.filter(x => x.path.endsWith(':defer')).length;
  await t.test('new inviter subscription settles once and survives a fresh Worker process', async () => {
    const { owner, friend, rewardId } = await r.earn('new');
    const reserved = await r.call('prepare-subscription', owner, { rewardId });
    assert.equal(reserved.rewards[0].state, 'store_subscription');
    const purchase = r.receipt(owner, 'earned-new', { rewardId, started: reserved.rewards[0].reservedAt + 1 });
    await r.call('confirm-subscription', friend, { purchaseToken: purchase.token,
      accountId: owner.id, principal: { id: owner.id } }, 409);
    assert.equal((await r.call('status', owner)).redeemedMonths, 0);
    r.outage(true);
    const unavailable = await r.call('confirm-subscription', owner, { purchaseToken: purchase.token }, 503);
    assert.doesNotMatch(JSON.stringify(unavailable), /fixture-provider|fixture-purchase-token|fixture-google/);
    r.outage(false);
    await r.restart();
    const settled = await r.call('confirm-subscription', owner, { purchaseToken: purchase.token });
    assert.equal(settled.redeemedMonths, 1);
    assert.deepEqual(await r.call('confirm-subscription', owner, { purchaseToken: purchase.token }), settled);
    assert.deepEqual(await r.call('confirm-subscription', owner, { purchaseToken: purchase.token, initialOrderId: purchase.orderId }), settled);
    assert.equal(deferrals(), 0);
  });
  await t.test('original free order settles when latest phase is paid, never credits a second referral', async () => {
    const { owner, rewardId } = await r.earn('history', true);
    const reserved = await r.call('prepare-subscription', owner, { rewardId });
    const purchase = r.receipt(owner, 'earned-history', { rewardId, started: reserved.rewards[0].reservedAt + 1 });
    purchase.raw.lineItems[0].offerPhase = { basePrice: {} };
    purchase.raw.lineItems[0].latestSuccessfulOrderId += '..0';
    purchase.raw.lineItems[0].expiryTime = new Date(Date.parse(purchase.raw.lineItems[0].expiryTime) + 30 * DAY).toISOString();
    assert.equal((await r.call('confirm-subscription', owner, { purchaseToken: purchase.token })).redeemedMonths, 0);
    const before = r.calls.length;
    await r.call('confirm-subscription', owner, { purchaseToken: purchase.token, initialOrderId: purchase.orderId });
    const reads = r.calls.slice(before).filter(x => x.host === 'androidpublisher.googleapis.com');
    assert.deepEqual(reads.map(x => x.path), [`${API}/purchases/subscriptionsv2/tokens/${purchase.token}`, `${API}/orders/${purchase.orderId}`]);
    assert.ok(reads.every(x => x.method === 'GET'));
    const status = await r.call('status', owner);
    assert.equal(status.earnedMonths, 1); assert.equal(status.redeemedMonths, 1);
  });
  for (const yearly of [false, true]) await t.test(`${yearly ? 'yearly' : 'monthly'} active subscriber receives one deferral, including lost response and restart`, async () => {
    const { owner, rewardId } = await r.earn('active-' + yearly);
    const purchase = r.receipt(owner, 'active-' + yearly, { yearly, paid: true });
    const target = monthAfter(Date.parse(purchase.raw.lineItems[0].expiryTime));
    const before = deferrals();
    r.lostResponse(yearly);
    const result = await r.call('redeem', owner, { rewardId, purchaseToken: purchase.token });
    assert.equal(result.rewards[0].state, yearly ? 'store_pending' : 'redeemed');
    r.lostResponse(false);
    await r.restart();
    const recovered = await r.call('redeem', owner, { rewardId, purchaseToken: purchase.token });
    assert.equal(recovered.redeemedMonths, 1);
    assert.equal(recovered.rewards[0].newExpiry, target);
    await r.call('redeem', owner, { rewardId, purchaseToken: purchase.token });
    assert.equal(deferrals(), before + 1, 'Never repeat a financial request after a lost response/restart');
  });
  await t.test('test receipts, wrong reward profiles and deleted identities cannot consume reserved credit', async () => {
    const { owner, rewardId } = await r.earn('negative');
    await r.call('prepare-subscription', owner, { rewardId });
    const purchase = r.receipt(owner, 'negative', { rewardId });
    purchase.raw.testPurchase = {};
    await r.call('confirm-subscription', owner, { purchaseToken: purchase.token }, 409);
    delete purchase.raw.testPurchase;
    purchase.raw.externalAccountIdentifiers.obfuscatedExternalProfileId = '00000000-0000-4000-8000-000000000001';
    assert.equal((await r.call('confirm-subscription', owner, { purchaseToken: purchase.token })).redeemedMonths, 0);
    const before = r.calls.filter(x => x.host === 'androidpublisher.googleapis.com').length;
    r.users.get(owner.token).disabled = true;
    await r.call('confirm-subscription', owner, { purchaseToken: purchase.token, accountId: owner.id }, 401);
    assert.equal(r.calls.filter(x => x.host === 'androidpublisher.googleapis.com').length, before);
    r.users.get(owner.token).disabled = false;
    assert.equal((await r.call('status', owner)).rewards[0].state, 'store_subscription');
    await r.call('delete', owner, {}, 200, 'account');
    await r.call('confirm-subscription', owner, { purchaseToken: purchase.token }, 410);
    assert.equal(r.calls.filter(x => x.host === 'androidpublisher.googleapis.com').length, before);
  });
});

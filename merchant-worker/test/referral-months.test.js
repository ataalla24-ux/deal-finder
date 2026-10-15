import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from 'miniflare';
import { referralPurchase, referralEvidence, isQualifyingTrial, isMatchingAppleRedemption, isMatchingPlayDeferral, isMatchingPlayRewardSubscription, monthAfter } from '../src/referral-months.js';
import worker from '../src/index.js';
import { bundledAuth } from './bundled-auth.js';

const account = '00000000-0000-4000-8000-000000000001';
const now = Date.now();
const DAY = 86400000;
const apple = { bundleId: 'com.stefanataalla.freefinderwien', environment: 'Production',
  productId: 'com.stefanataalla.freefinderwien.premium.monthly', appAccountToken: account,
  transactionId: '10000001', originalTransactionId: '10000001', purchaseDate: now,
  originalPurchaseDate: now, expiresDate: now + 30 * DAY, offerType: 1, offerDiscountType: 'FREE_TRIAL' };
const play = { subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE', acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED', startTime: new Date(now).toISOString(),
  externalAccountIdentifiers: { obfuscatedExternalAccountId: account }, etag: 'fixture-etag',
  lineItems: [{ productId: 'freefinder.pro.monthly', expiryTime: new Date(now + 30 * DAY).toISOString(),
    latestSuccessfulOrderId: 'GPA.1111-2222-3333-44444',
    autoRenewingPlan: { autoRenewEnabled: true }, offerPhase: { freeTrial: {} },
    offerDetails: { basePlanId: 'monthly', offerId: 'flyer-month-free' } }] };

test('Play acquisition requires the exact configured trial, never a promotional code or malformed free phase', () => {
  for (const [productId, basePlanId, offerId] of [
    ['freefinder.pro.monthly', 'monthly', 'flyer-month-free'],
    ['freefinder.pro.yearly', 'yearly', 'yearly-month-free'],
  ]) {
    const item = { ...play.lineItems[0], productId, offerDetails: { basePlanId, offerId } };
    const qualify = patch => isQualifyingTrial(referralPurchase('android',
      { ...play, lineItems: [{ ...item, ...patch }] }, account, now), now, now);
    assert.equal(qualify({}), true);
    for (const patch of [
      { signupPromotion: { oneTimeCode: {} } }, { signupPromotion: { vanityCode: { promotionCode: 'FIXTUREONLY' } } },
      { signupPromotion: {} }, { signupPromotion: false }, { itemReplacement: {} },
      { prepaidPlan: {} }, { offerDetails: undefined },
      { offerDetails: { basePlanId, offerId: 'referral-earned-month' } },
      { offerDetails: { basePlanId, offerId: 'unrelated-free-month' } },
      { offerDetails: { basePlanId: 'different', offerId } },
      { offerPhase: { freeTrial: [] } }, { offerPhase: { freeTrial: true } },
      { offerPhase: { freeTrial: 'FREE_TRIAL' } }, { offerPhase: { freeTrial: {}, basePrice: {} } },
    ]) assert.equal(qualify(patch), false, JSON.stringify(patch));
  }
});

test('only verified, account-bound production one-month trials qualify', () => {
  for (const [platform, raw] of [['ios', apple], ['android', play]]) {
    assert.equal(isQualifyingTrial(referralPurchase(platform, raw, account, now), now - 1000, now), true);
    assert.throws(() => referralPurchase(platform, raw, 'another-account', now));
    assert.equal(isQualifyingTrial(referralPurchase(platform, raw, account, now), now - 8 * DAY, now), false);
    assert.equal(isQualifyingTrial(referralPurchase(platform, raw, account, now), now + DAY, now), false);
  }
  for (const patch of [{ environment: 'Sandbox' }, { revocationDate: now }, { bundleId: 'another.app' },
    { productId: 'other.sku' }, { expiresDate: now - 1 }, { appAccountToken: null }]) {
    assert.throws(() => referralPurchase('ios', { ...apple, ...patch }, account, now));
  }
  for (const patch of [{ offerType: 3 }, { offerDiscountType: 'PAY_AS_YOU_GO' }, { transactionId: 'renewal' },
    { expiresDate: now + 7 * DAY }, { expiresDate: now + 60 * DAY }]) {
    assert.equal(isQualifyingTrial(referralPurchase('ios', { ...apple, ...patch }, account, now), now, now), false);
  }
  for (const patch of [{ testPurchase: {} }, { subscriptionState: 'SUBSCRIPTION_STATE_PENDING' },
    { lineItems: [] }, { lineItems: [play.lineItems[0], play.lineItems[0]] }]) {
    assert.throws(() => referralPurchase('android', { ...play, ...patch }, account, now));
  }
  for (const patch of [{ linkedPurchaseToken: 'previous' }, { lineItems: [{ ...play.lineItems[0], offerPhase: { basePrice: {} } }] }]) {
    assert.equal(isQualifyingTrial(referralPurchase('android', { ...play, ...patch }, account, now), now, now), false);
  }
  for (const acknowledgementState of [undefined, null, 'ACKNOWLEDGEMENT_STATE_PENDING', 'ACKNOWLEDGEMENT_STATE_UNSPECIFIED']) {
    assert.equal(isQualifyingTrial(referralPurchase('android', { ...play, acknowledgementState }, account, now), now, now), false);
  }
});
test('expired Apple periods can confirm only a historical free code redemption, never a new trial', () => {
  const raw = { ...apple, offerType: 3, offerIdentifier: 'historical-reward',
    purchaseDate: now - 60 * DAY, originalPurchaseDate: now - 90 * DAY, expiresDate: now - 30 * DAY };
  assert.throws(() => referralPurchase('ios', raw, account, now), { status: 409 });
  const historical = () => referralPurchase('ios', raw, account, now, { historicalAppleRedemption: true });
  assert.equal(historical().expires, raw.expiresDate);
  assert.equal(isMatchingAppleRedemption(historical(), { state: 'store_confirmation',
    offerId: raw.offerIdentifier, productId: raw.productId, reservedAt: now - 61 * DAY }, now), true);
  for (const patch of [{ offerType: 1 }, { offerDiscountType: 'PAY_AS_YOU_GO' }, { offerIdentifier: null },
    { environment: 'Sandbox' }, { appAccountToken: null }, { appAccountToken: identity(7).accountId },
    { revocationDate: now - DAY }, { productId: 'other.product' }, { purchaseDate: 0 },
    { expiresDate: null }, { expiresDate: Infinity }, { expiresDate: raw.purchaseDate }]) {
    assert.throws(() => referralPurchase('ios', { ...raw, ...patch }, account, now,
      { historicalAppleRedemption: true }), { status: 409 });
  }
  assert.throws(() => referralPurchase('android', { ...play, subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED' }, account, now,
    { historicalAppleRedemption: true }), { status: 409 });
});
test('calendar-month credit clamps month-end, including leap years', () => {
  assert.equal(new Date(monthAfter(Date.parse('2027-01-31T10:00:00Z'))).toISOString(), '2027-02-28T10:00:00.000Z');
  assert.equal(new Date(monthAfter(Date.parse('2028-01-31T10:00:00Z'))).toISOString(), '2028-02-29T10:00:00.000Z');
});
test('reconciliation evidence retains only the exact verified receipt, product, owner and funded period', () => {
  for (const [platform, raw] of [['ios', apple], ['android', play]]) {
    const purchase = referralPurchase(platform, raw, account, now);
    purchase.key ||= 'android:' + 'a'.repeat(64);
    purchase.purchaseToken = 'must-never-be-stored';
    purchase.email = 'friend@example.test';
    const evidence = referralEvidence(platform, purchase, now);
    assert.deepEqual(Object.keys(evidence).sort(), ['accountId', 'periodEnd', 'platform', 'productId',
      'purchaseKey', 'purchasedAt', 'receiptId', 'verifiedAt', 'version'].sort());
    assert.equal(evidence.receiptId, platform === 'ios' ? apple.transactionId : play.lineItems[0].latestSuccessfulOrderId);
    assert.equal(evidence.accountId, account);
    assert.equal(evidence.purchasedAt, now);
    assert.equal(evidence.periodEnd, now + 30 * DAY);
    assert.equal(evidence.verifiedAt, now);
    assert.doesNotMatch(JSON.stringify(evidence), /must-never-be-stored|friend@example/);
    for (const patch of [{ product: 'another.sku' }, { account: null }, { key: 'wrong-store' }, { key: platform + ':raw-token' },
      { expires: NaN }, { expires: now - 1 }]) {
      assert.throws(() => referralEvidence(platform, { ...purchase, ...patch }, now), { status: 409 });
    }
    for (const started of [undefined, NaN, 0, -1, now + 60001]) {
      assert.throws(() => referralEvidence(platform, { ...purchase,
        [platform === 'ios' ? 'purchasedAt' : 'started']: started }, now), { status: 409 });
    }
    for (const receiptId of [undefined, null, '', {}, 'a'.repeat(201), 'not/a/receipt']) {
      assert.throws(() => referralEvidence(platform, { ...purchase,
        [platform === 'ios' ? 'transactionId' : 'orderId']: receiptId }, now), { status: 409 });
    }
  }
});
test('Apple redemption requires a new matching one-month transaction after reservation', () => {
  const purchase = referralPurchase('ios', { ...apple, offerType: 3, offerIdentifier: 'reward-month-a' }, account, now);
  const reward = { state: 'store_confirmation', offerId: 'reward-month-a', productId: apple.productId,
    reservedAt: now, originalPurchaseKey: purchase.key };
  assert.equal(isMatchingAppleRedemption(purchase, reward, now), true);
  for (const patch of [{ purchasedAt: now - 1 }, { purchasedAt: undefined }, { transactionId: undefined },
    { purchasedAt: now + 60001 }, { product: 'other.sku' }, { offer: 'other-offer' },
    { key: 'other-chain' }, { expires: now + 7 * DAY }, { expires: now + 365 * DAY }, { redeemedFreeOffer: false }]) {
    assert.equal(isMatchingAppleRedemption({ ...purchase, ...patch }, reward, now), false);
  }
  for (const patch of [{ reservedAt: undefined }, { productId: undefined }, { state: 'redeemed' }, { redemptionPlatform: 'android' }]) {
    assert.equal(isMatchingAppleRedemption(purchase, { ...reward, ...patch }, now), false);
  }
});
test('Play readback requires complete pre-operation proof for the same owner, order and exact month', () => {
  const purchase = { ...referralPurchase('android', play, account, now), key: 'android:' + 'a'.repeat(64),
    expires: monthAfter(now + 30 * DAY) };
  const proof = { version: 1, platform: 'android', accountId: account, productId: purchase.product,
    receiptId: purchase.orderId, purchaseKey: purchase.key, requestedAt: now,
    originalExpiry: now + 30 * DAY, expectedExpiry: purchase.expires };
  const reward = { state: 'store_pending', redemptionPlatform: 'android', deferralEvidence: proof,
    purchaseKey: purchase.key, originalExpiry: proof.originalExpiry, expectedExpiry: proof.expectedExpiry };
  assert.equal(isMatchingPlayDeferral(purchase, reward, now), true);
  for (const patch of [{ version: 2 }, { platform: 'ios' }, { accountId: 'other-account' },
    { productId: 'freefinder.pro.yearly' }, { receiptId: 'other-order' }, { receiptId: null },
    { purchaseKey: 'android:' + 'b'.repeat(64) }, { originalExpiry: NaN }, { expectedExpiry: Infinity },
    { requestedAt: undefined }, { requestedAt: 0 }, { requestedAt: now + 1 }]) {
    assert.equal(isMatchingPlayDeferral(purchase, { ...reward, deferralEvidence: { ...proof, ...patch } }, now), false);
  }
  for (const patch of [{ account: 'other-account' }, { orderId: undefined }, { orderId: purchase.orderId + '..0' },
    { product: 'freefinder.pro.yearly' }, { key: 'android:' + 'b'.repeat(64) }, { expires: purchase.expires + 1 }]) {
    assert.equal(isMatchingPlayDeferral({ ...purchase, ...patch }, reward, now), false);
  }
  for (const patch of [{ state: 'earned' }, { redemptionPlatform: 'ios' }, { purchaseKey: 'another-purchase' },
    { originalExpiry: proof.originalExpiry + 1 }, { expectedExpiry: proof.expectedExpiry + 1 }, { deferralEvidence: undefined }]) {
    assert.equal(isMatchingPlayDeferral(purchase, { ...reward, ...patch }, now), false);
  }
  assert.equal(isMatchingPlayDeferral(purchase, reward, proof.originalExpiry), false);
  assert.equal(isMatchingPlayDeferral(purchase, reward, NaN), false);
});
test('production router exposes only a disabled config until deliberately enabled', async () => {
  const response = await worker.fetch(new Request('https://test/api/referral-months/config'), {}, {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {ok:true, enabled:false});
  const unavailable = await worker.fetch(new Request('https://test/api/referral-months/register', {method:'POST'}), {}, {});
  assert.equal(unavailable.status, 503);
});

async function runtime(t, enabled = '1', bindings = {}) {
  const source = await readFile(new URL('../src/referral-months.js', import.meta.url), 'utf8');
  const mf = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-03-09',
    modules: [await bundledAuth('account-auth.js'), { type: 'ESModule', path: 'ledger.js', contents: source }, { type: 'ESModule', path: 'test.js', contents: `
      import { ReferralMonthsLedger, handleReferralMonths } from './ledger.js';
      export class TestLedger extends ReferralMonthsLedger {
        async appleTransaction(id) {
          const fixture = await this.storage.get('fixture');
          const raw = fixture.apple;
          const key = 'source:ios:' + id;
          if (!await this.storage.get(key)) await this.storage.put(key, raw);
          return {ok:true, environment:raw.environment, signedTransactionInfo:'x.'+btoa(JSON.stringify(raw))+'.x'};
        }
        async playPurchase(token) {
          const raw = (await this.storage.get('fixture')).play;
          const item = raw.lineItems[0];
          if (item.latestSuccessfulOrderId) {
            const key = 'source:android:' + item.latestSuccessfulOrderId;
            if (!await this.storage.get(key)) await this.storage.put(key, {
              orderId:item.latestSuccessfulOrderId, purchaseToken:token, state:'PROCESSED',
              lineItems:[{productId:item.productId, subscriptionDetails:{
                basePlanId:item.offerDetails?.basePlanId, offerId:item.offerDetails?.offerId,
                offerPhaseDetails:{freeTrialDetails:{}}, servicePeriodStartTime:raw.startTime,
                servicePeriodEndTime:item.expiryTime}}],
            });
          }
          return raw;
        }
        async playOrder(id) {
          const fixture = await this.storage.get('fixture');
          await this.storage.put('history-reads', (await this.storage.get('history-reads') || 0) + 1);
          if (fixture.orderError) throw Error('Store unavailable');
          return fixture.order || await this.storage.get('source:android:' + id);
        }
        async sourcePurchase(evidence) {
          const fixture = await this.storage.get('fixture');
          await this.storage.put('source-checks', (await this.storage.get('source-checks') || 0) + 1);
          if (fixture.sourceError) throw Error('Mock Store outage with private details');
          return fixture.sourceOverride || await this.storage.get('source:' + evidence.platform + ':' + evidence.receiptId);
        }
        async deferPlay(token, purchase, expected) {
          await this.storage.put('deferrals', (await this.storage.get('deferrals') || 0) + 1);
          await this.storage.put('deferral-before-send', await this.storage.get('account:' + purchase.account));
          return (await this.storage.get('fixture')).deferResult || {ok:true, expires:expected};
        }
        async fetch(request) {
          if (new URL(request.url).pathname === '/fixture') {
            await this.storage.put('fixture', await request.json()); return Response.json({ok:true});
          }
          if (new URL(request.url).pathname === '/stored-rewards') {
            const {accountId, removePlatform, removeEvidence, removeDeferralEvidence, ageReservationByDays} = await request.json();
            const key = 'account:' + accountId;
            const account = await this.storage.get(key);
            if (removePlatform) {
              for (const reward of account.rewards) delete reward.redemptionPlatform;
              await this.storage.put(key, account);
            }
            if (removeEvidence) {
              for (const reward of account.rewards) delete reward.sourceEvidence;
              await this.storage.put(key, account);
            }
            if (removeDeferralEvidence) {
              for (const reward of account.rewards) delete reward.deferralEvidence;
              await this.storage.put(key, account);
            }
            if (ageReservationByDays) {
              for (const reward of account.rewards) {
                reward.reservedAt -= ageReservationByDays * 86400000;
                reward.createdAt -= ageReservationByDays * 86400000;
              }
              await this.storage.put(key, account);
            }
            return Response.json(account.rewards);
          }
          if (new URL(request.url).pathname === '/deferral-before-send') return Response.json(await this.storage.get('deferral-before-send'));
          if (new URL(request.url).pathname === '/deferrals') return Response.json(await this.storage.get('deferrals') || 0);
          if (new URL(request.url).pathname === '/source-checks') return Response.json(await this.storage.get('source-checks') || 0);
          if (new URL(request.url).pathname === '/history-reads') return Response.json(await this.storage.get('history-reads') || 0);
          return super.fetch(request);
        }
      }
      export default { fetch(request, env) {
        if (new URL(request.url).pathname.startsWith('/api/')) return handleReferralMonths(request, env, async request => {
          const identity = JSON.parse(request.headers.get('x-test-identity'));
          if (identity.secret !== identity.accountId.slice(-12).padStart(64, '0')) {
            throw Object.assign(Error('Invalid fixture credential'), {status:403});
          }
          return {id:identity.accountId, email:'test'+identity.accountId+'@example.test', providers:['password'], authTime:Date.now()/1000};
        });
        return env.REFERRAL_MONTHS.get(env.REFERRAL_MONTHS.idFromName('referral-months-v1')).fetch(request);
      } };
    ` }].reverse(), durableObjects: { REFERRAL_MONTHS: { className: 'TestLedger', useSQLite: true } },
    bindings: { REFERRAL_MONTHS_ENABLED: enabled, REFERRAL_PLAY_DEFERRAL_ENABLED: '1', REFERRAL_ADMIN_SECRET: 'fixture-admin', ...bindings },
    log: new Log(LogLevel.NONE) }));
  t.after(() => mf.dispose());
  const call = async (action, body, expected = 200) => {
    const response = await mf.dispatchFetch(`https://test/api/referral-months/${action}`, { method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': body?.accountId || 'test', 'x-freefinder-merchant-secret': 'fixture-admin',
        'x-test-identity': JSON.stringify(body && {accountId:body.accountId, secret:body.secret}) }, body: JSON.stringify(body) });
    const data = await response.json(); assert.equal(response.status, expected, JSON.stringify(data)); return data;
  };
  const fixture = body => mf.dispatchFetch('https://test/fixture', { method: 'POST', body: JSON.stringify(body) });
  return { mf, call, fixture };
}
const identity = (n, platform = 'ios') => ({ accountId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, secret: String(n).padStart(64, '0'), platform });

async function earnedReward(t, bindings = {}) {
  const runtimeState = await runtime(t, '1', bindings);
  const { call, fixture } = runtimeState;
  const owner = identity(1), friend = identity(2);
  const { code } = await call('register', owner);
  await call('register', friend);
  await call('accept', { ...friend, code });
  const purchasedAt = Date.now();
  await fixture({ apple: { ...apple, appAccountToken: friend.accountId, purchaseDate: purchasedAt,
    originalPurchaseDate: purchasedAt, expiresDate: purchasedAt + 30 * DAY } });
  await call('confirm', { ...friend, transactionId: apple.transactionId });
  const rewardId = (await call('status', owner)).rewards[0].id;
  await call('import-apple-offers', { offers: [{ productId: apple.productId, offerId: 'platform-lock-fixture',
    code: 'PLATFORMTESTONLY', customerType: 'existing', environment: 'Production', freeMonths: 1, expiresAt: now + 60 * DAY }] });
  await fixture({ apple: { ...apple, offerType: null }, play, deferResult: { ok: false, definitive: false } });
  return { ...runtimeState, owner, rewardId };
}

const rewardBindings = { REFERRAL_PLAY_REWARD_SUBSCRIPTION_ENABLED: '1', REFERRAL_PLAY_REWARD_BASE_PLAN: 'monthly' };

test('historical Play reward settles its original free order after renewal or expiry, never grants another month', async t => {
  const { call, fixture, mf, owner, rewardId } = await earnedReward(t, rewardBindings);
  await call('prepare-subscription', { ...owner, platform: 'android', rewardId });
  await mf.dispatchFetch('https://test/stored-rewards', { method: 'POST', body: JSON.stringify({ accountId: owner.accountId, ageReservationByDays: 40 }) });
  const start = Date.now() - 39 * DAY, token = 'private-historical-play-reward-token';
  const raw = structuredClone(playReward(rewardId, start));
  const order = { orderId: 'GPA.1111-2222-3333-55555', purchaseToken: token, state: 'PROCESSED',
    lineItems: [{ productId: 'freefinder.pro.monthly', subscriptionDetails: {
      basePlanId: 'monthly', offerId: 'referral-earned-month', offerPhaseDetails: { freeTrialDetails: {} },
      servicePeriodStartTime: new Date(start).toISOString(), servicePeriodEndTime: new Date(start + 30 * DAY).toISOString() } }] };
  const request = { ...owner, platform: 'android', purchaseToken: token, initialOrderId: order.orderId };
  raw.subscriptionState = 'SUBSCRIPTION_STATE_EXPIRED';
  raw.lineItems[0].autoRenewingPlan.autoRenewEnabled = false;
  const baseline = await call('status', owner);
  const stored = async () => (await (await mf.dispatchFetch('https://test/stored-rewards', {
    method: 'POST', body: JSON.stringify({ accountId: owner.accountId }) })).json());
  const storedBefore = await stored();
  for (const bad of [
    { order: { ...order, state: 'REFUNDED' } }, { order: { ...order, orderId: 'OTHER-ORDER' } },
    { order: { ...order, purchaseToken: 'another-token' } }, { order: { ...order, orderHistory: { partialRefundEvents: [{}] } } },
    { order: { ...order, orderHistory: { cancellationEvent: {} } } }, { order: { ...order, lineItems: [] } },
    ...[{ offerPhaseDetails: { baseDetails: {} } }, { offerId: 'flyer-month-free' }, { basePlanId: 'yearly' },
      { servicePeriodStartTime: new Date(start + DAY).toISOString() }, { servicePeriodEndTime: new Date(start + 60 * DAY).toISOString() }
    ].map(patch => ({ order: { ...order, lineItems: [{ ...order.lineItems[0], subscriptionDetails: { ...order.lineItems[0].subscriptionDetails, ...patch } }] } })),
    { play: { ...raw, testPurchase: {} } }, { play: { ...raw, linkedPurchaseToken: 'another-subscription' } },
    { play: { ...raw, regionCode: 'US' } }, { play: { ...raw, acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING' } },
    { play: { ...raw, externalAccountIdentifiers: { ...raw.externalAccountIdentifiers, obfuscatedExternalAccountId: identity(99).accountId } } },
    { play: { ...raw, externalAccountIdentifiers: { ...raw.externalAccountIdentifiers, obfuscatedExternalProfileId: identity(98).accountId } } },
  ]) {
    await fixture({ play: raw, order, ...bad });
    await call('confirm-subscription', request, 409);
    assert.deepEqual(await stored(), storedBefore);
  }
  await fixture({ play: raw, order, orderError: true });
  await call('confirm-subscription', request, 503);
  assert.deepEqual(await call('status', owner), baseline, 'unknown order outcome preserves credit');
  await fixture({ play: raw, order });
  await call('confirm-subscription', { ...request, initialOrderId: undefined }, 409);
  const settled = await call('confirm-subscription', request);
  assert.equal(settled.redeemedMonths, 1);
  assert.equal(settled.rewards[0].newExpiry, start + 30 * DAY, 'uses old funded period, not today plus one month');
  assert.equal(await (await mf.dispatchFetch('https://test/deferrals')).json(), 0, 'recovery never defers billing');
  const reads = await (await mf.dispatchFetch('https://test/history-reads')).json();
  assert.deepEqual(await call('confirm-subscription', request), settled);
  assert.equal(await (await mf.dispatchFetch('https://test/history-reads')).json(), reads, 'settled retry does not replay historical lookup');
  const exported = await (await mf.dispatchFetch('https://test/account-export', { method: 'POST', body: JSON.stringify({
    ...owner, principal: { id: owner.accountId, authTime: Date.now() / 1000 }, trustedIP: 'local-history-export',
  }) })).json();
  assert.equal(exported.ok, true);
  assert.doesNotMatch(JSON.stringify(exported), /private-historical|initialOrderId|redemptionEvidence/);
});

test('Play paid renewal cannot substitute for the initial earned free period', async t => {
  const { call, fixture, mf, owner, rewardId } = await earnedReward(t, rewardBindings);
  await call('prepare-subscription', { ...owner, platform: 'android', rewardId });
  await mf.dispatchFetch('https://test/stored-rewards', { method: 'POST', body: JSON.stringify({ accountId: owner.accountId, ageReservationByDays: 40 }) });
  const start = Date.now() - 39 * DAY, token = 'historical-renewed-play-reward-token';
  const raw = playReward(rewardId, start);
  raw.lineItems[0].expiryTime = new Date(start + 60 * DAY).toISOString();
  raw.lineItems[0].offerPhase = { basePrice: {} };
  const initial = { orderId: 'GPA.1111-2222-3333-66666', purchaseToken: token, state: 'PROCESSED',
    lineItems: [{ productId: 'freefinder.pro.monthly', subscriptionDetails: {
      basePlanId: 'monthly', offerId: 'referral-earned-month', offerPhaseDetails: { freeTrialDetails: {} },
      servicePeriodStartTime: new Date(start).toISOString(), servicePeriodEndTime: new Date(start + 30 * DAY).toISOString() } }] };
  const request = { ...owner, platform: 'android', purchaseToken: token, initialOrderId: initial.orderId };
  await fixture({ play: raw, order: { ...initial, lineItems: [{ ...initial.lineItems[0], subscriptionDetails: {
    ...initial.lineItems[0].subscriptionDetails, offerPhaseDetails: { baseDetails: {} },
    servicePeriodStartTime: new Date(start + 30 * DAY).toISOString(), servicePeriodEndTime: new Date(start + 60 * DAY).toISOString() } }] } });
  await call('confirm-subscription', request, 409);
  await fixture({ play: raw, order: initial });
  assert.equal((await call('confirm-subscription', request)).redeemedMonths, 1);
});

function playReward(rewardId, purchasedAt = Date.now()) {
  return { ...play, regionCode: 'AT', startTime: new Date(purchasedAt).toISOString(),
    externalAccountIdentifiers: { ...play.externalAccountIdentifiers, obfuscatedExternalProfileId: rewardId },
    lineItems: [{ ...play.lineItems[0], expiryTime: new Date(purchasedAt + 30 * DAY).toISOString(),
      offerDetails: { basePlanId: 'monthly', offerId: 'referral-earned-month' } }] };
}
test('earned-month purchases require the reserved reward, exact Store offer and acknowledged free phase', () => {
  const id = identity(8).accountId;
  const raw = playReward(id, now);
  const purchase = referralPurchase('android', raw, account, now);
  const reward = { id, state: 'store_subscription', redemptionPlatform: 'android', reservedAt: now,
    productId: 'freefinder.pro.monthly', offerId: 'referral-earned-month', basePlanId: 'monthly' };
  assert.equal(isMatchingPlayRewardSubscription(purchase, reward, now), true);
  assert.equal(isQualifyingTrial(purchase, now, now), false, 'an earned month cannot fund another referral');
  for (const patch of [{ rewardProfile: identity(9).accountId }, { rewardProfile: null }, { freePhase: false },
    { region: 'US' }, { product: 'freefinder.pro.yearly' }, { offer: 'flyer-month-free' }, { basePlan: 'other' },
    { orderId: null }, { started: now - 1 }, { started: now + 60001 }, { started: NaN },
    { expires: now + 7 * DAY }, { expires: now + 60 * DAY }]) {
    assert.equal(isMatchingPlayRewardSubscription({ ...purchase, ...patch }, reward, now), false);
  }
  for (const patch of [{ state: 'earned' }, { state: 'redeemed' }, { redemptionPlatform: 'ios' },
    { reservedAt: undefined }, { productId: null }, { offerId: 'other' }, { basePlanId: '' }, { id: 'invalid' }]) {
    assert.equal(isMatchingPlayRewardSubscription(purchase, { ...reward, ...patch }, now), false);
  }
  const noProfile = referralPurchase('android', { ...raw, externalAccountIdentifiers: play.externalAccountIdentifiers }, account, now);
  assert.equal(isQualifyingTrial(noProfile, now, now), false, 'reward offer alone excludes referral farming');
});
test('new reward subscriptions are disabled by default, preserving earned credit', async t => {
  const { call, owner, rewardId } = await earnedReward(t);
  await call('prepare-subscription', { ...owner, platform: 'android', rewardId }, 409);
  await call('redeem', { ...owner, rewardId }, 409);
  assert.equal((await call('status', owner)).rewards[0].state, 'earned');
});
test('cancelling renewal after an earned-month purchase still settles that one credit', async t => {
  const { call, fixture, owner, rewardId } = await earnedReward(t, rewardBindings);
  const request = { ...owner, platform: 'android', rewardId };
  await call('prepare-subscription', request);
  const raw = playReward(rewardId);
  raw.subscriptionState = 'SUBSCRIPTION_STATE_CANCELED';
  raw.lineItems[0].autoRenewingPlan = { autoRenewEnabled: false };
  await fixture({ play: raw });
  assert.equal((await call('confirm-subscription', { ...request, purchaseToken: 'cancelled-earned-month-token' })).redeemedMonths, 1);
  assert.throws(() => referralPurchase('android', raw, owner.accountId), { status: 409 }, 'ordinary new-trial requirements remain unchanged');
});
test('Play reservation is retryable without consuming credit; exact receipt settles once without deferral', async t => {
  const { call, fixture, mf, owner, rewardId } = await earnedReward(t, rewardBindings);
  const request = { ...owner, platform: 'android', rewardId };
  const reserved = await call('prepare-subscription', request);
  assert.equal(reserved.rewards[0].state, 'store_subscription');
  assert.equal(reserved.redeemedMonths, 0);
  assert.deepEqual(await call('prepare-subscription', request), reserved, 'cancel/reopen keeps the same reservation');
  await call('redeem', { ...owner, rewardId, transactionId: apple.transactionId }, 409);
  const raw = playReward(rewardId);
  const confirmation = { ...request, purchaseToken: 'private-reward-subscription-token' };
  for (const patch of [
    { acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING' },
    { externalAccountIdentifiers: { ...raw.externalAccountIdentifiers, obfuscatedExternalProfileId: identity(9).accountId } },
    { lineItems: [{ ...raw.lineItems[0], offerDetails: { basePlanId: 'monthly', offerId: 'flyer-month-free' } }] },
    { lineItems: [{ ...raw.lineItems[0], offerPhase: { basePrice: {} } }] },
    { regionCode: 'US' },
  ]) {
    await fixture({ play: { ...raw, ...patch } });
    assert.deepEqual(await call('confirm-subscription', confirmation), reserved);
  }
  await fixture({ play: raw });
  const settled = await call('confirm-subscription', confirmation);
  assert.equal(settled.rewards[0].state, 'redeemed');
  assert.equal(settled.redeemedMonths, 1);
  assert.deepEqual(await call('confirm-subscription', confirmation), settled);
  assert.deepEqual(await call('prepare-subscription', request), settled);
  assert.equal(await (await mf.dispatchFetch('https://test/deferrals')).json(), 0);
  const stored = await (await mf.dispatchFetch('https://test/stored-rewards', { method: 'POST',
    body: JSON.stringify({ accountId: owner.accountId }) })).json();
  assert.equal(stored[0].redemptionEvidence.receiptId, raw.lineItems[0].latestSuccessfulOrderId);
  assert.ok(stored[0].sourceEvidence, 'original qualifying friend proof preserved');
  assert.doesNotMatch(JSON.stringify(settled), /sourceEvidence|redemptionEvidence|private-reward/);
});
test('Play preparation holds credit when original source is unverified and rejects wrong owner receipts', async t => {
  const { call, fixture, owner, rewardId } = await earnedReward(t, rewardBindings);
  const request = { ...owner, platform: 'android', rewardId };
  await fixture({ sourceError: true });
  await call('prepare-subscription', request, 409);
  assert.equal((await call('status', owner)).rewards[0].state, 'earned');
  await fixture({});
  await call('prepare-subscription', request);
  await fixture({ play: { ...playReward(rewardId), externalAccountIdentifiers: {
    obfuscatedExternalAccountId: identity(7).accountId, obfuscatedExternalProfileId: rewardId } } });
  await call('confirm-subscription', { ...request, purchaseToken: 'wrong-owner-reward-token' }, 409);
  assert.equal((await call('status', owner)).rewards[0].state, 'store_subscription');
});
test('new and expired Apple inviters require an explicitly renewing non-stacked offer', async t => {
  const { call, owner, rewardId } = await earnedReward(t, { REFERRAL_APPLE_REWARD_SUBSCRIPTION_ENABLED: '1' });
  const offer = { productId: apple.productId, offerId: 'returning-earned-month', code: 'RETURNINGTESTONLY',
    customerType: 'new_or_expired', freeMonths: 1, expiresAt: now + 60 * DAY,
    autoRenew: true, combineIntroductoryOffer: false, environment: 'Production' };
  for (const patch of [{ autoRenew: false }, { autoRenew: undefined }, { combineIntroductoryOffer: true },
    { combineIntroductoryOffer: undefined }]) {
    await call('import-apple-offers', { offers: [{ ...offer, ...patch }] }, 400);
  }
  await call('redeem', { ...owner, rewardId }, 409);
  await call('import-apple-offers', { offers: [offer] });
  const reserved = await call('redeem', { ...owner, rewardId });
  assert.equal(reserved.rewards[0].state, 'store_confirmation');
  assert.equal(reserved.rewards[0].offerId, offer.offerId);
  assert.equal(reserved.redeemedMonths, 0);
  assert.deepEqual(await call('redeem', { ...owner, rewardId }), reserved);
});

test('an Apple reservation cannot also trigger a Play deferral, including older reservations', async t => {
  const { call, mf, owner, rewardId } = await earnedReward(t);
  const reserved = await call('redeem', { ...owner, rewardId, transactionId: apple.transactionId });
  for (const removePlatform of [false, true]) {
    await mf.dispatchFetch('https://test/stored-rewards', { method: 'POST', body: JSON.stringify({ accountId: owner.accountId, removePlatform }) });
    await call('redeem', { ...owner, platform: 'android', rewardId, purchaseToken: 'cross-store-owner-token-fixture' }, 409);
    assert.deepEqual(await call('status', owner), reserved);
    assert.equal(await (await mf.dispatchFetch('https://test/deferrals')).json(), 0);
  }
});

test('an unknown Play outcome stays locked to Play and cannot reserve an Apple code', async t => {
  const { call, fixture, mf, owner, rewardId } = await earnedReward(t);
  const pending = await call('redeem', { ...owner, platform: 'android', rewardId, purchaseToken: 'cross-store-owner-token-fixture' });
  for (const removePlatform of [false, true]) {
    await mf.dispatchFetch('https://test/stored-rewards', { method: 'POST', body: JSON.stringify({ accountId: owner.accountId, removePlatform }) });
    await call('redeem', { ...owner, rewardId, transactionId: apple.transactionId }, 409);
    assert.deepEqual(await call('status', owner), pending);
    assert.equal(await (await mf.dispatchFetch('https://test/deferrals')).json(), 1);
  }
  await fixture({ play: { ...play, lineItems: [{ ...play.lineItems[0], expiryTime: new Date(monthAfter(now + 30 * DAY)).toISOString() }] } });
  const settled = await call('redeem', { ...owner, platform: 'android', rewardId, purchaseToken: 'cross-store-owner-token-fixture' });
  assert.equal(settled.redeemedMonths, 1);
  assert.deepEqual(await call('redeem', { ...owner, rewardId, transactionId: apple.transactionId }), settled);
  assert.equal(await (await mf.dispatchFetch('https://test/deferrals')).json(), 1);
});

test('an unknown Play outcome is not settled by a later order, another product or an unrelated extension', async t => {
  const expected = monthAfter(now + 30 * DAY);
  for (const [name, patch] of [
    ['paid renewal', { latestSuccessfulOrderId: play.lineItems[0].latestSuccessfulOrderId + '..0' }],
    ['product change', { productId: 'freefinder.pro.yearly' }],
    ['different extension', { expiryTime: new Date(expected + DAY).toISOString() }],
    ['missing order', { latestSuccessfulOrderId: undefined }],
  ]) {
    await t.test(name, async t => {
      const { call, fixture, mf, owner, rewardId } = await earnedReward(t);
      const request = { ...owner, platform: 'android', rewardId, purchaseToken: 'pending-play-proof-fixture-token' };
      const pending = await call('redeem', request);
      await fixture({ play: { ...play, lineItems: [{ ...play.lineItems[0],
        expiryTime: new Date(expected).toISOString(), ...patch }] } });
      await call('redeem', request, 409);
      assert.deepEqual(await call('status', owner), pending, 'uncertain evidence preserves the month and pending Store lock');
      assert.equal(await (await mf.dispatchFetch('https://test/deferrals')).json(), 1);
      await fixture({ play: { ...play, lineItems: [{ ...play.lineItems[0], expiryTime: new Date(expected).toISOString() }] } });
      assert.equal((await call('redeem', request)).redeemedMonths, 1, 'later exact evidence may settle without replay');
      assert.equal(await (await mf.dispatchFetch('https://test/deferrals')).json(), 1);
    });
  }
});

test('old pending Play credits without original-order evidence stay pending rather than guessing or replaying', async t => {
  const { call, fixture, mf, owner, rewardId } = await earnedReward(t);
  const request = { ...owner, platform: 'android', rewardId, purchaseToken: 'legacy-pending-play-fixture-token' };
  const pending = await call('redeem', request);
  await mf.dispatchFetch('https://test/stored-rewards', { method: 'POST', body: JSON.stringify({
    accountId: owner.accountId, removeDeferralEvidence: true,
  }) });
  await fixture({ play: { ...play, lineItems: [{ ...play.lineItems[0],
    expiryTime: new Date(monthAfter(now + 30 * DAY)).toISOString() }] } });
  await call('redeem', request, 409);
  assert.deepEqual(await call('status', owner), pending);
  await call('redeem', { ...owner, rewardId, transactionId: apple.transactionId }, 409);
  assert.equal(await (await mf.dispatchFetch('https://test/deferrals')).json(), 1);
});

test('new Play deferrals require the Store order, persist private proof before sending and preserve source evidence', async t => {
  for (const confirmation of ['deferral_response', 'subscription_readback']) {
    await t.test(confirmation, async t => {
      const { call, fixture, mf, owner, rewardId } = await earnedReward(t);
      const request = { ...owner, platform: 'android', rewardId, purchaseToken: 'private-fixture-purchase-token',
        deferralEvidence: { receiptId: 'client-forged-order' } };
      const stored = async () => (await mf.dispatchFetch('https://test/stored-rewards', { method: 'POST',
        body: JSON.stringify({ accountId: owner.accountId }) })).json();
      const source = (await stored())[0].sourceEvidence;
      for (const latestSuccessfulOrderId of [undefined, '', 'bad/order', 'a'.repeat(201)]) {
        await fixture({ play: { ...play, lineItems: [{ ...play.lineItems[0], latestSuccessfulOrderId }] } });
        await call('redeem', request, 409);
        assert.equal((await call('status', owner)).rewards[0].state, 'earned');
        assert.equal(await (await mf.dispatchFetch('https://test/deferrals')).json(), 0);
      }
      const expected = monthAfter(now + 30 * DAY);
      await fixture({ play, deferResult: confirmation === 'deferral_response' ? { ok: true, expires: expected } : { ok: false, definitive: false } });
      let status = await call('redeem', request);
      const sent = (await (await mf.dispatchFetch('https://test/deferral-before-send')).json()).rewards[0];
      assert.equal(sent.state, 'store_pending');
      assert.deepEqual(sent.deferralEvidence, { version: 1, platform: 'android', accountId: owner.accountId,
        productId: play.lineItems[0].productId, receiptId: play.lineItems[0].latestSuccessfulOrderId,
        purchaseKey: sent.purchaseKey, requestedAt: sent.deferralEvidence.requestedAt,
        originalExpiry: now + 30 * DAY, expectedExpiry: expected });
      assert.ok(sent.deferralEvidence.requestedAt <= Date.now());
      if (confirmation === 'subscription_readback') {
        await fixture({ play: { ...play, lineItems: [{ ...play.lineItems[0], expiryTime: new Date(expected).toISOString() }] } });
        status = await call('redeem', request);
      }
      assert.equal(status.redeemedMonths, 1);
      const records = await stored(), reward = records[0];
      assert.deepEqual(reward.sourceEvidence, source);
      assert.deepEqual(reward.deferralEvidence, sent.deferralEvidence);
      assert.deepEqual(reward.redemptionEvidence, { ...sent.deferralEvidence, newExpiry: expected,
        confirmedAt: reward.redemptionEvidence.confirmedAt, confirmation });
      assert.ok(reward.redemptionEvidence.confirmedAt >= sent.deferralEvidence.requestedAt);
      assert.doesNotMatch(JSON.stringify(records), /private-fixture-purchase-token|client-forged-order/);
      assert.doesNotMatch(JSON.stringify(status), /deferralEvidence|redemptionEvidence|sourceEvidence|GPA\./);
      assert.deepEqual(await call('redeem', request), status);
      assert.deepEqual(await stored(), records, 'repeated confirmation must not rewrite evidence');
      assert.equal(await (await mf.dispatchFetch('https://test/deferrals')).json(), 1);
      const exported = await (await mf.dispatchFetch('https://test/account-export', { method: 'POST', body: JSON.stringify({
        ...owner, principal: { id: owner.accountId, authTime: Date.now()/1000 }, trustedIP: 'play-proof-export',
      }) })).json();
      assert.equal(exported.ok, true);
      assert.doesNotMatch(JSON.stringify(exported), /deferralEvidence|redemptionEvidence|sourceEvidence|GPA\./);
    });
  }
});

test('a definitively rejected Play deferral releases the credit for another store', async t => {
  const { call, fixture, mf, owner, rewardId } = await earnedReward(t);
  await fixture({ play, deferResult: { ok: false, definitive: true } });
  const rejected = await call('redeem', { ...owner, platform: 'android', rewardId, purchaseToken: 'cross-store-owner-token-fixture' });
  assert.equal(rejected.rewards[0].state, 'earned');
  const records = await (await mf.dispatchFetch('https://test/stored-rewards', { method: 'POST',
    body: JSON.stringify({ accountId: owner.accountId }) })).json();
  for (const field of ['deferralEvidence', 'redemptionEvidence', 'redemptionPlatform', 'purchaseKey', 'originalExpiry', 'expectedExpiry']) {
    assert.equal(records[0][field], undefined);
  }
  assert.ok(records[0].sourceEvidence, 'the original invitation proof is not deferral metadata');
  await fixture({ apple: { ...apple, offerType: null } });
  const reserved = await call('redeem', { ...owner, rewardId, transactionId: apple.transactionId });
  assert.equal(reserved.rewards[0].state, 'store_confirmation');
  assert.equal(await (await mf.dispatchFetch('https://test/deferrals')).json(), 1);
});

test('concurrent cross-store redemption requests can start only one store operation', async t => {
  const { mf, owner, rewardId } = await earnedReward(t);
  const request = async body => mf.dispatchFetch('https://test/api/referral-months/redeem', {
    method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': owner.accountId,
      'x-test-identity': JSON.stringify(owner) }, body: JSON.stringify(body),
  });
  const responses = await Promise.all([
    request({ ...owner, rewardId, transactionId: apple.transactionId }),
    request({ ...owner, platform: 'android', rewardId, purchaseToken: 'concurrent-cross-store-owner-fixture' }),
  ]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  const status = await responses.find(r => r.status === 200).json();
  const deferrals = await (await mf.dispatchFetch('https://test/deferrals')).json();
  assert.equal(deferrals, status.rewards[0].state === 'store_pending' ? 1 : 0);
});

test('Apple confirmation rejects an Android request without settling the reserved credit', async t => {
  const { call, owner, rewardId } = await earnedReward(t);
  const reserved = await call('redeem', { ...owner, rewardId, transactionId: apple.transactionId });
  await call('confirm-redemption', { ...owner, platform: 'android', purchaseToken: 'wrong-confirmation-store-fixture' }, 400);
  assert.deepEqual(await call('status', owner), reserved);
});

test('revoked or unavailable source blocks new Apple/Play operations without deleting credit; a fresh verified retry succeeds', async t => {
  for (const platform of ['ios', 'android']) {
    const { call, fixture, mf, owner, rewardId } = await earnedReward(t);
    const read = async () => (await mf.dispatchFetch('https://test/stored-rewards', {
      method: 'POST', body: JSON.stringify({ accountId: owner.accountId }),
    })).json();
    const evidence = (await read())[0].sourceEvidence;
    const source = { ...apple, appAccountToken: evidence.accountId, transactionId: evidence.receiptId,
      originalTransactionId: evidence.receiptId, purchaseDate: evidence.purchasedAt,
      originalPurchaseDate: evidence.purchasedAt, expiresDate: evidence.periodEnd };
    const request = { ...owner, platform, rewardId, transactionId: apple.transactionId,
      purchaseToken: 'owner-source-review-fixture-token', sourceReview: { status: 'verified' },
      sourceEvidence: { ...evidence, accountId: owner.accountId } };
    for (const extra of [{ sourceOverride: { ...source, revocationDate: Date.now() } }, { sourceError: true }]) {
      await fixture({ ...extra, apple: { ...apple, offerType: null }, play });
      await call('redeem', request, 409);
      const stored = (await read())[0];
      assert.equal(stored.state, 'earned');
      assert.deepEqual(stored.sourceEvidence, evidence);
      assert.equal(stored.sourceReview.status, extra.sourceError ? 'unverified' : 'revoked');
      const status = await call('status', owner);
      assert.equal(status.earnedMonths, 1);
      assert.equal(status.redeemedMonths, 0);
      assert.equal(status.rewards[0].redemptionURL, undefined);
      assert.equal(status.rewards[0].sourceReview, undefined);
      assert.equal(await (await mf.dispatchFetch('https://test/deferrals')).json(), 0);
    }
    await fixture({ apple: { ...apple, offerType: null }, play, sourceOverride: source });
    const retried = await call('redeem', request);
    assert.equal((await read())[0].sourceReview.status, 'verified');
    assert.equal(retried.rewards[0].state, platform === 'ios' ? 'store_confirmation' : 'redeemed');
    assert.equal(await (await mf.dispatchFetch('https://test/deferrals')).json(), platform === 'ios' ? 0 : 1);
  }
});

test('historical missing evidence preserves credit and cannot be substituted by client proof', async t => {
  const { call, mf, owner, rewardId } = await earnedReward(t);
  await mf.dispatchFetch('https://test/stored-rewards', {
    method: 'POST', body: JSON.stringify({ accountId: owner.accountId, removeEvidence: true }),
  });
  for (const platform of ['ios', 'android']) {
    await call('redeem', { ...owner, platform, rewardId, transactionId: apple.transactionId,
      purchaseToken: 'legacy-owner-review-fixture-token', sourceReview: { status: 'verified' } }, 409);
  }
  const status = await call('status', owner);
  assert.equal(status.earnedMonths, 1);
  assert.equal(status.rewards[0].state, 'earned');
  assert.equal(await (await mf.dispatchFetch('https://test/deferrals')).json(), 0);
  assert.equal(await (await mf.dispatchFetch('https://test/source-checks')).json(), 0);
});

test('a refunded original Play order holds the credit, while a subsequent verified lookup unlocks one deferral', async t => {
  const { call, fixture, mf } = await runtime(t);
  const owner = identity(1, 'android'), friend = identity(2, 'android');
  const { code } = await call('register', owner);
  await call('register', friend); await call('accept', { ...friend, code });
  const token = 'original-friend-order-review-fixture';
  await fixture({ play: { ...play, externalAccountIdentifiers: { obfuscatedExternalAccountId: friend.accountId } } });
  await call('confirm', { ...friend, purchaseToken: token });
  const rewardId = (await call('status', owner)).rewards[0].id;
  const source = { orderId: play.lineItems[0].latestSuccessfulOrderId, purchaseToken: token, state: 'PROCESSED',
    lineItems: [{ productId: play.lineItems[0].productId, subscriptionDetails: {
      ...play.lineItems[0].offerDetails,
      offerPhaseDetails: { freeTrialDetails: {} }, servicePeriodStartTime: play.startTime,
      servicePeriodEndTime: play.lineItems[0].expiryTime,
    } }] };
  await fixture({ play, sourceOverride: { ...source, state: 'REFUNDED',
    orderHistory: { refundEvent: { eventTime: new Date().toISOString() } } } });
  const request = { ...owner, rewardId, purchaseToken: 'owner-order-review-fixture-token' };
  await call('redeem', request, 409);
  assert.equal((await call('status', owner)).earnedMonths, 1);
  assert.equal(await (await mf.dispatchFetch('https://test/deferrals')).json(), 0);
  await fixture({ play, sourceOverride: source });
  assert.equal((await call('redeem', request)).redeemedMonths, 1);
  assert.equal((await call('redeem', request)).redeemedMonths, 1);
  assert.equal(await (await mf.dispatchFetch('https://test/deferrals')).json(), 1);
  assert.equal(await (await mf.dispatchFetch('https://test/source-checks')).json(), 2);
});

test('receipt evidence is immutable on retry, ignores client claims and stays private in status/export', async t => {
  const { call, fixture, mf } = await runtime(t);
  const owner = identity(1), friend = identity(2);
  const { code } = await call('register', owner);
  await call('register', friend);
  await call('accept', { ...friend, code });
  await fixture({ apple: { ...apple, appAccountToken: friend.accountId } });
  await call('confirm', { ...friend, transactionId: apple.transactionId, sourceEvidence: { receiptId: 'forged', accountId: owner.accountId } });
  const read = async (extra = {}) => (await mf.dispatchFetch('https://test/stored-rewards', {
    method: 'POST', body: JSON.stringify({ accountId: owner.accountId, ...extra }),
  })).json();
  const before = await read();
  assert.equal(before[0].sourceEvidence.receiptId, apple.transactionId);
  assert.equal(before[0].sourceEvidence.accountId, friend.accountId);
  await call('confirm', { ...friend, transactionId: apple.transactionId, sourceEvidence: { receiptId: 'replace' } });
  assert.deepEqual(await read(), before);
  const visible = await call('status', owner);
  assert.equal(visible.earnedMonths, 1);
  assert.equal(visible.rewards[0].sourceEvidence, undefined);
  const exported = await (await mf.dispatchFetch('https://test/account-export', { method: 'POST', body: JSON.stringify({
    ...owner, principal: { id: owner.accountId, authTime: Date.now()/1000 }, trustedIP: 'local-export',
  }) })).json();
  assert.equal(exported.ok, true);
  assert.equal(exported.account.rewards[0].sourceEvidence, undefined);
  await read({ removeEvidence: true });
  assert.deepEqual(await call('status', owner), visible, 'historical rewards stay readable and are not reconstructed');
  await call('confirm', { ...friend, transactionId: apple.transactionId });
  assert.equal((await read())[0].sourceEvidence, undefined, 'no speculative backfill on duplicate confirmation');
});

test('Play requires the authoritative initial order for a new credit, not an order supplied by the client', async t => {
  const { call, fixture, mf } = await runtime(t);
  const owner = identity(1, 'android'), friend = identity(2, 'android');
  const { code } = await call('register', owner);
  await call('register', friend);
  await call('accept', { ...friend, code });
  const raw = { ...play, externalAccountIdentifiers: { obfuscatedExternalAccountId: friend.accountId } };
  const purchaseToken = 'friend-proof-token-never-persisted';
  const claim = { ...friend, purchaseToken, orderId: 'CLIENT-CANNOT-CHOOSE', sourceEvidence: { receiptId: 'forged' } };
  await fixture({ play: { ...raw, lineItems: [{ ...raw.lineItems[0], latestSuccessfulOrderId: undefined }] } });
  await call('confirm', claim, 409);
  assert.equal((await call('status', owner)).earnedMonths, 0);
  assert.equal((await call('status', friend)).confirmed, false);
  await fixture({ play: raw });
  await call('confirm', claim);
  const rewards = await (await mf.dispatchFetch('https://test/stored-rewards', {
    method: 'POST', body: JSON.stringify({ accountId: owner.accountId }),
  })).json();
  assert.equal(rewards[0].sourceEvidence.receiptId, raw.lineItems[0].latestSuccessfulOrderId);
  assert.match(rewards[0].sourceEvidence.purchaseKey, /^android:[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(rewards), /friend-proof-token|CLIENT-CANNOT-CHOOSE|forged/);
  await call('confirm', claim);
  assert.equal((await call('status', owner)).earnedMonths, 1);
});

test('atomic attribution, authentication, self-invite, reciprocal invite, duplicates and disabled rollout', async t => {
  const { call, fixture } = await runtime(t);
  const a = identity(1), b = identity(2), c = identity(3);
  const as = await call('register', a), bs = await call('register', b);
  await call('register', c);
  await call('status', { ...a, secret: 'f'.repeat(64) }, 403);
  await call('accept', { ...a, code: as.code }, 409);
  await call('accept', { ...b, code: as.code });
  await call('accept', { ...a, code: bs.code }, 409);
  const purchasedAt = Date.now();
  await fixture({ apple: { ...apple, appAccountToken: b.accountId, purchaseDate: purchasedAt, originalPurchaseDate: purchasedAt } });
  await Promise.all([call('confirm', { ...b, transactionId: apple.transactionId }), call('confirm', { ...b, transactionId: apple.transactionId })]);
  assert.equal((await call('status', a)).earnedMonths, 1);
  assert.equal((await call('status', b)).confirmed, true);
  await call('accept', { ...c, code: as.code });
  await call('confirm', { ...c, transactionId: apple.transactionId }, 409);
  await call('confirm', { ...c, signedTransactionInfo: 'untrusted' }, 400);
  await call('redeem', { ...a, rewardId: (await call('status', a)).rewards[0].id }, 409);
  const disabled = await runtime(t, '0');
  await disabled.call('register', a);
  await disabled.call('accept', { ...a, code: bs.code }, 503);
  await disabled.call('register', null, 400);
});

test('Apple links reserve once; only matching authoritative redemption marks the credit redeemed', async t => {
  const { call, fixture, mf } = await runtime(t);
  const stored = async accountId => (await mf.dispatchFetch('https://test/stored-rewards', {
    method: 'POST', body: JSON.stringify({ accountId }),
  })).json();
  const a = identity(1), b = identity(2);
  const as = await call('register', a); await call('register', b);
  await call('accept', { ...b, code: as.code });
  await fixture({ apple: { ...apple, appAccountToken: b.accountId } });
  await call('confirm', { ...b, transactionId: apple.transactionId });
  const sourceEvidence = (await stored(a.accountId))[0].sourceEvidence;
  await call('import-apple-offers', { offers: [{ productId: apple.productId, offerId: 'reward-month-a',
    code: 'TESTCODEONLY', customerType: 'existing', environment: 'Production', freeMonths: 1, expiresAt: now + 60 * DAY }] });
  await fixture({ apple: { ...apple, offerType: null } });
  const rewardId = (await call('status', a)).rewards[0].id;
  const reserved = await call('redeem', { ...a, rewardId, transactionId: apple.transactionId });
  assert.equal((await stored(a.accountId))[0].redemptionEvidence, undefined);
  assert.equal(reserved.redeemedMonths, 0);
  assert.match(reserved.rewards[0].redemptionURL, /^https:\/\/apps.apple.com\/redeem\?/);
  assert.deepEqual(await call('redeem', { ...a, rewardId }), reserved);
  assert.equal((await call('confirm-redemption', { ...a, transactionId: apple.transactionId })).redeemedMonths, 0);
  // A receipt predating this reservation must not settle a new reward.
  await fixture({ apple: { ...apple, offerType: 3, offerIdentifier: 'reward-month-a', purchaseDate: now - DAY } });
  assert.equal((await call('confirm-redemption', { ...a, transactionId: apple.transactionId })).redeemedMonths, 0);
  const redeemedAt = Date.now();
  const redemption = { ...apple, offerType: 3, offerIdentifier: 'reward-month-a', purchaseDate: redeemedAt, expiresDate: redeemedAt + 30 * DAY };
  await fixture({ apple: { ...redemption, expiresDate: redeemedAt + 7 * DAY } });
  assert.equal((await call('confirm-redemption', { ...a, transactionId: apple.transactionId })).redeemedMonths, 0);
  await fixture({ apple: redemption });
  const confirmed = await call('confirm-redemption', { ...a, transactionId: apple.transactionId,
    redemptionEvidence: { receiptId: 'forged' } });
  assert.equal(confirmed.redeemedMonths, 1);
  assert.equal(confirmed.rewards[0].redemptionEvidence, undefined);
  const proof = await stored(a.accountId);
  assert.deepEqual(proof[0].sourceEvidence, sourceEvidence);
  assert.equal(proof[0].redemptionEvidence.accountId, a.accountId);
  assert.equal(proof[0].redemptionEvidence.receiptId, redemption.transactionId);
  assert.equal(proof[0].redemptionEvidence.purchasedAt, redeemedAt);
  assert.equal(proof[0].redemptionEvidence.periodEnd, redeemedAt + 30 * DAY);
  assert.equal((await call('confirm-redemption', { ...a, transactionId: apple.transactionId })).redeemedMonths, 1);
  assert.deepEqual(await stored(a.accountId), proof);
  const exported = await (await mf.dispatchFetch('https://test/account-export', { method: 'POST', body: JSON.stringify({
    ...a, principal: { id: a.accountId, authTime: Date.now()/1000 }, trustedIP: 'apple-redeemed-export',
  }) })).json();
  assert.equal(exported.ok, true);
  assert.equal(exported.account.rewards[0].redemptionEvidence, undefined);
  assert.equal(exported.account.rewards[0].sourceEvidence, undefined);
});

test('historical Apple reward receipt settles once after expiry without weakening owner, offer or refund checks', async t => {
  const { call, fixture, mf, owner, rewardId } = await earnedReward(t);
  const reserved = await call('redeem', { ...owner, rewardId, transactionId: apple.transactionId });
  assert.equal(reserved.rewards[0].productId, apple.productId);
  assert.equal(reserved.rewards[0].offerId, 'platform-lock-fixture');
  assert.ok(reserved.rewards[0].reservedAt > 0);
  const stored = async extra => (await mf.dispatchFetch('https://test/stored-rewards', {
    method: 'POST', body: JSON.stringify({ accountId: owner.accountId, ...extra }),
  })).json();
  const previous = (await stored({ ageReservationByDays: 90 }))[0];
  const purchasedAt = previous.reservedAt + DAY;
  const raw = { ...apple, offerType: 3, offerIdentifier: 'platform-lock-fixture',
    transactionId: '10000099', purchaseDate: purchasedAt, expiresDate: purchasedAt + 30 * DAY };
  for (const [patch, status] of [
    [{ revocationDate: now - DAY }, 409], [{ appAccountToken: identity(7).accountId }, 409],
    [{ environment: 'Sandbox' }, 503], [{ offerType: 1 }, 409],
    [{ offerIdentifier: 'other-offer' }, 200], [{ productId: apple.productId.replace('monthly', 'yearly') }, 200],
    [{ originalTransactionId: '10000077' }, 200], [{ expiresDate: purchasedAt + 7 * DAY }, 200],
    [{ purchaseDate: previous.reservedAt - 1, expiresDate: previous.reservedAt + 30 * DAY }, 200],
  ]) {
    await fixture({ apple: { ...raw, ...patch } });
    await call('confirm-redemption', { ...owner, transactionId: raw.transactionId,
      historicalAppleRedemption: true, reservedAt: now - 100 * DAY }, status);
    assert.deepEqual((await stored())[0], previous, 'invalid proof must preserve pending credit and internal evidence');
  }
  await fixture({ apple: raw });
  const confirmed = await call('confirm-redemption', { ...owner, transactionId: raw.transactionId });
  assert.equal(confirmed.redeemedMonths, 1);
  assert.equal(confirmed.rewards[0].offerId, undefined, 'recovery metadata only accompanies pending Apple rewards');
  assert.equal(confirmed.rewards[0].reservedAt, undefined);
  assert.doesNotMatch(JSON.stringify(confirmed), /sourceEvidence|redemptionEvidence|10000099/);
  const settled = (await stored())[0];
  assert.deepEqual(settled.sourceEvidence, previous.sourceEvidence);
  assert.equal(settled.redemptionEvidence.receiptId, raw.transactionId);
  assert.equal(settled.redemptionEvidence.periodEnd, raw.expiresDate);
  await call('confirm-redemption', { ...owner, transactionId: raw.transactionId });
  assert.deepEqual((await stored())[0], settled);
  assert.equal(await (await mf.dispatchFetch('https://test/deferrals')).json(), 0);

  // A client-supplied historical flag must not authorize a new referral using an expired introductory period.
  const late = identity(8); await call('register', late); await call('accept', { ...late, code: reserved.code });
  await fixture({ apple: { ...raw, appAccountToken: late.accountId, transactionId: '10000888',
    originalTransactionId: '10000888', originalPurchaseDate: purchasedAt, offerType: 1 } });
  await call('confirm', { ...late, transactionId: '10000888', historicalAppleRedemption: true }, 409);
  assert.equal((await call('status', owner)).earnedMonths, 1);
});

test('Play deferral retries never repeat an unknown external financial operation', async t => {
  const { call, fixture, mf } = await runtime(t);
  const a = identity(1, 'android'), b = identity(2, 'android');
  const as = await call('register', a); await call('register', b);
  await call('accept', { ...b, code: as.code });
  await fixture({ play: { ...play, externalAccountIdentifiers: { obfuscatedExternalAccountId: b.accountId } } });
  await call('confirm', { ...b, purchaseToken: 'friend-token-12345678901234567890' });
  const rewardId = (await call('status', a)).rewards[0].id;
  await fixture({ play, deferResult: {ok:false, definitive:false} });
  const pending = await call('redeem', { ...a, rewardId, purchaseToken: 'inviter-token-12345678901234567890' });
  assert.equal(pending.rewards[0].state, 'store_pending');
  await call('redeem', { ...a, rewardId, purchaseToken: 'inviter-token-12345678901234567890' }, 409);
  assert.equal(await (await mf.dispatchFetch('https://test/deferrals')).json(), 1);
  await fixture({ sourceError: true, play: { ...play, lineItems: [{ ...play.lineItems[0], expiryTime: new Date(monthAfter(now + 30 * DAY)).toISOString() }] } });
  const confirmed = await call('redeem', { ...a, rewardId, purchaseToken: 'inviter-token-12345678901234567890' });
  assert.equal(confirmed.redeemedMonths, 1);
  assert.equal(await (await mf.dispatchFetch('https://test/deferrals')).json(), 1);
  assert.equal(await (await mf.dispatchFetch('https://test/source-checks')).json(), 1, 'settle an already-started operation without creating a new benefit');
});

test('Play trial credit waits for acknowledgement and remains retryable without a duplicate reward', async t => {
  const { call, fixture } = await runtime(t);
  const a = identity(1, 'android'), b = identity(2, 'android');
  const as = await call('register', a); await call('register', b);
  await call('accept', { ...b, code: as.code });
  const friend = { ...play, externalAccountIdentifiers: { obfuscatedExternalAccountId: b.accountId } };
  const claim = { ...b, purchaseToken: 'friend-token-acknowledgement-fixture' };
  await fixture({ play: { ...friend, acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING' } });
  await call('confirm', claim, 409);
  assert.equal((await call('status', a)).earnedMonths, 0);
  assert.equal((await call('status', b)).confirmed, false);
  await fixture({ play: friend });
  await call('confirm', claim);
  await call('confirm', claim);
  assert.equal((await call('status', a)).earnedMonths, 1);
  assert.equal((await call('status', b)).confirmed, true);
});

test('Play promo rejection preserves invitation and earned balances; later qualifying trial credits once', async t => {
  const { call, fixture, mf, owner, rewardId } = await earnedReward(t);
  const friend = identity(3, 'android');
  const before = await call('status', owner);
  await call('register', friend);
  await call('accept', { ...friend, code: before.code });
  const started = Date.now();
  const raw = { ...play, startTime: new Date(started).toISOString(),
    externalAccountIdentifiers: { obfuscatedExternalAccountId: friend.accountId },
    lineItems: [{ ...play.lineItems[0], latestSuccessfulOrderId: 'GPA.9999-8888-7777-66666',
      expiryTime: new Date(started + 30 * DAY).toISOString() }] };
  const claim = { ...friend, purchaseToken: 'promo-rejection-friend-token',
    trial: true, freePhase: true, signupPromotion: null, offerId: 'flyer-month-free' };
  for (const patch of [{ signupPromotion: { oneTimeCode: {} } },
    { signupPromotion: { vanityCode: { promotionCode: 'FIXTUREONLY' } } },
    { offerDetails: { basePlanId: 'monthly', offerId: 'unrelated-free-month' } },
    { offerPhase: { freeTrial: [] } }]) {
    await fixture({ play: { ...raw, lineItems: [{ ...raw.lineItems[0], ...patch }] } });
    await call('confirm', claim, 409);
    assert.deepEqual(await call('status', owner), before, 'previous reward remains unchanged');
  }
  const pending = await call('status', friend);
  assert.equal(pending.accepted, true);
  assert.equal(pending.confirmed, false);
  await fixture({ play: raw });
  await call('confirm', claim);
  await call('confirm', claim);
  const after = await call('status', owner);
  assert.equal(after.earnedMonths, before.earnedMonths + 1);
  assert.deepEqual(after.rewards.find(x => x.id === rewardId), before.rewards.find(x => x.id === rewardId));
  assert.equal(await (await mf.dispatchFetch('https://test/deferrals')).json(), 0);
});

test('Play earned-month live and historical confirmation reject promo substitution without consuming credit', async t => {
  const { call, fixture, mf, owner, rewardId } = await earnedReward(t, rewardBindings);
  const reserved = await call('prepare-subscription', { ...owner, platform: 'android', rewardId });
  const raw = playReward(rewardId), token = 'promo-substitution-earned-month-token';
  const item = raw.lineItems[0];
  const order = { orderId: item.latestSuccessfulOrderId, purchaseToken: token, state: 'PROCESSED',
    lineItems: [{ productId: item.productId, subscriptionDetails: {
      ...item.offerDetails, servicePeriodStartTime: raw.startTime, servicePeriodEndTime: item.expiryTime,
      offerPhaseDetails: { freeTrialDetails: {} },
    } }] };
  for (const signupPromotion of [{ oneTimeCode: {} }, { vanityCode: { promotionCode: 'FIXTUREONLY' } }, {}]) {
    await fixture({ play: { ...raw, lineItems: [{ ...item, signupPromotion }] }, order });
    const result = await call('confirm-subscription', { ...owner, platform: 'android', purchaseToken: token });
    assert.deepEqual(result, reserved);
    await call('confirm-subscription', { ...owner, platform: 'android', purchaseToken: token,
      initialOrderId: order.orderId }, 409);
    assert.deepEqual(await call('status', owner), reserved);
  }
  await fixture({ play: raw, order });
  assert.equal((await call('confirm-subscription', { ...owner, platform: 'android', purchaseToken: token })).redeemedMonths, 1);
  assert.equal(await (await mf.dispatchFetch('https://test/deferrals')).json(), 0);
});

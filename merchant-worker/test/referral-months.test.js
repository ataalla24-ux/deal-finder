import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from 'miniflare';
import { referralPurchase, referralEvidence, isQualifyingTrial, isMatchingAppleRedemption, isMatchingPlayDeferral, monthAfter } from '../src/referral-months.js';
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
    autoRenewingPlan: { autoRenewEnabled: true }, offerPhase: { freeTrial: {} } }] };

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

async function runtime(t, enabled = '1') {
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
                offerPhaseDetails:{freeTrialDetails:{}}, servicePeriodStartTime:raw.startTime,
                servicePeriodEndTime:item.expiryTime}}],
            });
          }
          return raw;
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
            const {accountId, removePlatform, removeEvidence, removeDeferralEvidence} = await request.json();
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
            return Response.json(account.rewards);
          }
          if (new URL(request.url).pathname === '/deferral-before-send') return Response.json(await this.storage.get('deferral-before-send'));
          if (new URL(request.url).pathname === '/deferrals') return Response.json(await this.storage.get('deferrals') || 0);
          if (new URL(request.url).pathname === '/source-checks') return Response.json(await this.storage.get('source-checks') || 0);
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
    bindings: { REFERRAL_MONTHS_ENABLED: enabled, REFERRAL_PLAY_DEFERRAL_ENABLED: '1', REFERRAL_ADMIN_SECRET: 'fixture-admin' },
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

async function earnedReward(t) {
  const runtimeState = await runtime(t);
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
    code: 'PLATFORMTESTONLY', customerType: 'existing', freeMonths: 1, expiresAt: now + 60 * DAY }] });
  await fixture({ apple: { ...apple, offerType: null }, play, deferResult: { ok: false, definitive: false } });
  return { ...runtimeState, owner, rewardId };
}

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
    code: 'TESTCODEONLY', customerType: 'existing', freeMonths: 1, expiresAt: now + 60 * DAY }] });
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

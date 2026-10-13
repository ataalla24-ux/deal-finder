import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from 'miniflare';
import { referralPurchase, isQualifyingTrial, isMatchingAppleRedemption, monthAfter } from '../src/referral-months.js';
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
  for (const patch of [{ reservedAt: undefined }, { productId: undefined }, { state: 'redeemed' }]) {
    assert.equal(isMatchingAppleRedemption(purchase, { ...reward, ...patch }, now), false);
  }
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
          return {ok:true, environment:raw.environment, signedTransactionInfo:'x.'+btoa(JSON.stringify(raw))+'.x'};
        }
        async playPurchase(token) { return (await this.storage.get('fixture')).play; }
        async deferPlay(token, purchase, expected) {
          await this.storage.put('deferrals', (await this.storage.get('deferrals') || 0) + 1);
          return (await this.storage.get('fixture')).deferResult || {ok:true, expires:expected};
        }
        async fetch(request) {
          if (new URL(request.url).pathname === '/fixture') {
            await this.storage.put('fixture', await request.json()); return Response.json({ok:true});
          }
          if (new URL(request.url).pathname === '/deferrals') return Response.json(await this.storage.get('deferrals') || 0);
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
  const { call, fixture } = await runtime(t);
  const a = identity(1), b = identity(2);
  const as = await call('register', a); await call('register', b);
  await call('accept', { ...b, code: as.code });
  await fixture({ apple: { ...apple, appAccountToken: b.accountId } });
  await call('confirm', { ...b, transactionId: apple.transactionId });
  await call('import-apple-offers', { offers: [{ productId: apple.productId, offerId: 'reward-month-a',
    code: 'TESTCODEONLY', customerType: 'existing', freeMonths: 1, expiresAt: now + 60 * DAY }] });
  await fixture({ apple: { ...apple, offerType: null } });
  const rewardId = (await call('status', a)).rewards[0].id;
  const reserved = await call('redeem', { ...a, rewardId, transactionId: apple.transactionId });
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
  assert.equal((await call('confirm-redemption', { ...a, transactionId: apple.transactionId })).redeemedMonths, 1);
  assert.equal((await call('confirm-redemption', { ...a, transactionId: apple.transactionId })).redeemedMonths, 1);
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
  await fixture({ play: { ...play, lineItems: [{ ...play.lineItems[0], expiryTime: new Date(monthAfter(now + 30 * DAY)).toISOString() }] } });
  const confirmed = await call('redeem', { ...a, rewardId, purchaseToken: 'inviter-token-12345678901234567890' });
  assert.equal(confirmed.redeemedMonths, 1);
  assert.equal(await (await mf.dispatchFetch('https://test/deferrals')).json(), 1);
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

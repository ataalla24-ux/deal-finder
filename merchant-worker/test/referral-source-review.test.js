import test from 'node:test';
import assert from 'node:assert/strict';
import { referralHash, reviewReferralSource, ReferralMonthsLedger } from '../src/referral-months.js';
import { ReferralMonths } from '../src/index.js';

const DAY = 86400000;
const now = Date.UTC(2026, 9, 13), start = now - 60 * DAY, end = start + 30 * DAY;
const accountId = '00000000-0000-4000-8000-000000000002';
const ios = { version: 1, platform: 'ios', accountId, receiptId: '100000001', purchaseKey: 'ios:100000001',
  productId: 'com.stefanataalla.freefinderwien.premium.monthly', purchasedAt: start, periodEnd: end };
const apple = { bundleId: 'com.stefanataalla.freefinderwien', environment: 'Production',
  transactionId: ios.receiptId, originalTransactionId: ios.receiptId, productId: ios.productId,
  appAccountToken: accountId, purchaseDate: start, originalPurchaseDate: start, expiresDate: end,
  offerType: 1, offerDiscountType: 'FREE_TRIAL' };
const token = 'original-play-purchase-token-only-in-fixture';
const android = { ...ios, platform: 'android', productId: 'freefinder.pro.monthly',
  receiptId: 'GPA.1111-2222-3333-44444', purchaseKey: 'android:' + await referralHash(token) };
const play = { orderId: android.receiptId, purchaseToken: token, state: 'PROCESSED',
  lineItems: [{ productId: android.productId, subscriptionDetails: {
    basePlanId: 'monthly', offerId: 'flyer-month-free',
    servicePeriodStartTime: new Date(start).toISOString(), servicePeriodEndTime: new Date(end).toISOString(),
    offerPhaseDetails: { freeTrialDetails: {} },
  } }] };

test('an ended qualifying period remains valid; only its own authoritative revocation is recognized', async () => {
  assert.deepEqual(await reviewReferralSource(ios, apple, now), { status: 'verified', checkedAt: now });
  assert.equal((await reviewReferralSource(ios, { ...apple, revocationDate: now - DAY }, now)).status, 'revoked');
  for (const revocationDate of [0, 'not-a-date', now + DAY]) {
    assert.equal((await reviewReferralSource(ios, { ...apple, revocationDate }, now)).status, 'unverified');
  }
  for (const patch of [{ transactionId: '100000002', revocationDate: now - DAY }, { productId: 'another.product' },
    { appAccountToken: undefined }, { appAccountToken: 'someone-else' }, { environment: 'Sandbox' },
    { bundleId: 'other.app' }, { originalTransactionId: '100000000' }, { purchaseDate: start + DAY },
    { originalPurchaseDate: start - DAY }, { expiresDate: end + DAY }, { offerType: 3 }, { offerDiscountType: 'BASE_PRICE' }]) {
    assert.equal((await reviewReferralSource(ios, { ...apple, ...patch }, now)).status, 'unverified');
  }
  // A fresh Store response after a reversal is re-evaluated, not permanently blacklisted.
  assert.equal((await reviewReferralSource(ios, apple, now + DAY)).status, 'verified');
});

test('Play review matches the exact original order/token/product/free period and ignores later subscription expiry', async () => {
  assert.deepEqual(await reviewReferralSource(android, play, now), { status: 'verified', checkedAt: now });
  const refunded = { ...play, state: 'REFUNDED', orderHistory: { refundEvent: { eventTime: new Date(now - DAY).toISOString() } } };
  assert.equal((await reviewReferralSource(android, refunded, now)).status, 'revoked');
  for (const patch of [{ orderId: play.orderId + '..0' }, { purchaseToken: 'different-token' },
    { lineItems: [] }, { lineItems: [play.lineItems[0], play.lineItems[0]] }, { orderHistory: {} },
    { orderHistory: { refundEvent: { eventTime: 'invalid' } } }]) {
    assert.equal((await reviewReferralSource(android, { ...refunded, ...patch }, now)).status, 'unverified');
  }
  for (const state of ['PENDING_REFUND', 'PARTIALLY_REFUNDED', 'CANCELED', 'PENDING', 'STATE_UNSPECIFIED']) {
    assert.equal((await reviewReferralSource(android, { ...play, state }, now)).status, 'unverified');
  }
  for (const orderHistory of [{ refundEvent: {} }, { cancellationEvent: {} }, { partialRefundEvents: [{}] }]) {
    assert.equal((await reviewReferralSource(android, { ...play, orderHistory }, now)).status, 'unverified');
  }
  for (const patch of [{ servicePeriodStartTime: new Date(start + DAY).toISOString() },
    { servicePeriodEndTime: new Date(end + DAY).toISOString() }, { offerPhaseDetails: { baseDetails: {} } },
    { offerPhaseDetails: { freeTrialDetails: {}, baseDetails: {} } }]) {
    const raw = { ...play, lineItems: [{ ...play.lineItems[0], subscriptionDetails: { ...play.lineItems[0].subscriptionDetails, ...patch } }] };
    assert.equal((await reviewReferralSource(android, raw, now)).status, 'unverified');
  }
  assert.equal((await reviewReferralSource(android, { ...play, lineItems: [{ ...play.lineItems[0], productId: 'another.product' }] }, now)).status, 'unverified');
});

test('missing, legacy or malformed evidence and Store outages never mean confirmed revocation', async () => {
  for (const evidence of [null, {}, { ...ios, version: 2 }, { ...ios, platform: 'web' },
    { ...ios, purchaseKey: 'ios:private-token' }, { ...ios, periodEnd: start + DAY }]) {
    assert.equal((await reviewReferralSource(evidence, apple, now)).status, 'unverified');
  }
  const ledger = new ReferralMonthsLedger({ storage: {} }, {});
  let calls = 0;
  ledger.sourcePurchase = async () => { calls++; throw Error('Private Store failure'); };
  assert.deepEqual(await ledger.reviewSource(ios, now), { status: 'unverified', checkedAt: now });
  assert.deepEqual(await ledger.reviewSource(undefined, now), { status: 'unverified', checkedAt: now });
  assert.equal(calls, 1);
  assert.equal((await ledger.reviewSource({ ...ios, version: 2 }, now)).status, 'unverified');
  assert.equal(calls, 1, 'malformed historical proof never triggers a Store lookup');
  for (const raw of [null, 'not-an-object', { ...apple, appAccountToken: 42 }]) {
    assert.equal((await reviewReferralSource(ios, raw, now)).status, 'unverified');
  }
  for (const raw of [{ ...play, lineItems: [null] }, { ...play, lineItems: { length: 1 } },
    { ...play, lineItems: [{ ...play.lineItems[0], subscriptionDetails: {} }] }]) {
    assert.equal((await reviewReferralSource(android, raw, now)).status, 'unverified');
  }
});

test('Play source review requires the configured acquisition offer even when the period is free', async () => {
  for (const patch of [{ offerId: undefined }, { offerId: 'referral-earned-month' },
    { offerId: 'unrelated-free-month' }, { basePlanId: undefined }, { basePlanId: 'yearly' }]) {
    const raw = { ...play, lineItems: [{ ...play.lineItems[0], subscriptionDetails: {
      ...play.lineItems[0].subscriptionDetails, ...patch,
    } }] };
    assert.equal((await reviewReferralSource(android, raw, now)).status, 'unverified');
  }
  const annualEvidence = { ...android, productId: 'freefinder.pro.yearly' };
  const annualOrder = { ...play, lineItems: [{ productId: annualEvidence.productId, subscriptionDetails: {
    ...play.lineItems[0].subscriptionDetails, basePlanId: 'yearly', offerId: 'yearly-month-free',
  } }] };
  assert.equal((await reviewReferralSource(annualEvidence, annualOrder, now)).status, 'verified');
});

test('source transport reads the exact Apple transaction without requiring an active subscription', async () => {
  const ledger = new ReferralMonthsLedger({ storage: {} }, {});
  ledger.appleTransaction = async id => {
    assert.equal(id, ios.receiptId);
    return { ok: true, environment: 'Production', signedTransactionInfo: 'x.' + btoa(JSON.stringify(apple)) + '.x' };
  };
  assert.deepEqual(await ledger.reviewSource(ios, now), { status: 'verified', checkedAt: now });
  ledger.appleTransaction = async () => ({ ok: false, environment: 'Production' });
  assert.equal((await ledger.reviewSource(ios, now)).status, 'unverified');
  ledger.appleTransaction = async () => ({ ok: true, environment: 'Sandbox', signedTransactionInfo: 'x.' + btoa(JSON.stringify(apple)) + '.x' });
  assert.equal((await ledger.reviewSource(ios, now)).status, 'unverified');
});

test('production Play order lookup is GET-only, bounded and never forwards credentials on redirects', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const ledger = new ReferralMonths({ storage: {} }, { GOOGLE_PLAY_ACCESS_TOKEN: 'test-access' });
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(url, 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.stefanataalla.freefinderwien/orders/' + android.receiptId);
    assert.equal(init.method, 'GET');
    assert.equal(init.body, undefined);
    assert.equal(init.redirect, 'manual');
    assert.equal(init.headers.authorization, 'Bearer test-access');
    assert.ok(init.signal instanceof AbortSignal);
    return Response.json(play);
  };
  assert.deepEqual(await ledger.reviewSource(android, now), { status: 'verified', checkedAt: now });
  assert.equal(calls, 1);
  for (const status of [302, 403, 404, 429, 500]) {
    globalThis.fetch = async () => { calls++; return new Response(null, { status, headers: { location: 'https://untrusted.example/' } }); };
    assert.equal((await ledger.reviewSource(android, now)).status, 'unverified');
  }
  assert.equal(calls, 6);
});

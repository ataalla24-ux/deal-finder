import test from 'node:test';
import assert from 'node:assert/strict';
import { referralHash, referralPurchase, referralEvidence, isQualifyingTrial,
  reviewReferralSource, isMatchingAppleRedemption, isMatchingPlayRewardSubscription } from '../src/referral-months.js';

const DAY = 86400000;
const now = Date.UTC(2026, 10, 27, 12);
const owner = '00000000-0000-4000-8000-000000000001';
const token = 'fixture-original-play-seven-day-token';
const apple = {
  bundleId: 'com.stefanataalla.freefinderwien', environment: 'Production',
  productId: 'com.stefanataalla.freefinderwien.premium.monthly', appAccountToken: owner,
  transactionId: '10000001', originalTransactionId: '10000001', purchaseDate: now,
  originalPurchaseDate: now, expiresDate: now + 7 * DAY, offerType: 1, offerDiscountType: 'FREE_TRIAL',
};
const play = (productId, basePlanId, offerId, duration) => ({
  subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE', acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
  startTime: new Date(now).toISOString(), externalAccountIdentifiers: { obfuscatedExternalAccountId: owner },
  lineItems: [{ productId, expiryTime: new Date(now + duration).toISOString(),
    latestSuccessfulOrderId: 'GPA.1111-2222-3333-44444', autoRenewingPlan: { autoRenewEnabled: true },
    offerPhase: { freeTrial: {} }, offerDetails: { basePlanId, offerId } }],
});

test('verified Apple week and legacy calendar-month acquisition both qualify and retain exact expiry', async () => {
  for (const duration of [7 * DAY, 7 * DAY - 3600000, 7 * DAY + 3600000, 28 * DAY, 31 * DAY]) {
    const raw = { ...apple, expiresDate: now + duration };
    const purchase = referralPurchase('ios', raw, owner, now);
    assert.equal(isQualifyingTrial(purchase, now - 1000, now), true);
    assert.equal(purchase.expires, raw.expiresDate);
    const proof = referralEvidence('ios', purchase, now);
    assert.equal((await reviewReferralSource(proof, raw, now + 90 * DAY)).status, 'verified');
    assert.equal((await reviewReferralSource(proof, { ...raw, revocationDate: now + DAY }, now + 90 * DAY)).status, 'revoked');
  }
  for (const duration of [DAY, 6 * DAY, 8 * DAY, 14 * DAY, 26 * DAY, 33 * DAY, 60 * DAY]) {
    const purchase = referralPurchase('ios', { ...apple, expiresDate: now + duration }, owner, now);
    assert.equal(isQualifyingTrial(purchase, now, now), false);
    assert.equal((await reviewReferralSource(referralEvidence('ios', purchase, now), { ...apple, expiresDate: now + duration }, now)).status, 'unverified');
  }
  assert.equal(isQualifyingTrial(referralPurchase('ios', apple, owner, now), now - 8 * DAY, now), false);
  assert.throws(() => referralPurchase('ios', { ...apple, appAccountToken: 'wrong-owner' }, owner, now));
});

test('Play new week offer IDs and legacy month offers verify the original exact free order', async () => {
  for (const [product, plan, offer, duration] of [
    ['freefinder.pro.monthly', 'monthly', 'flyer-week-free', 7 * DAY],
    ['freefinder.pro.yearly', 'yearly', 'yearly-week-free', 7 * DAY],
    ['freefinder.pro.monthly', 'monthly', 'flyer-month-free', 30 * DAY],
    ['freefinder.pro.yearly', 'yearly', 'yearly-month-free', 31 * DAY],
  ]) {
    const raw = play(product, plan, offer, duration);
    const purchase = referralPurchase('android', raw, owner, now);
    purchase.key = 'android:' + await referralHash(token);
    assert.equal(isQualifyingTrial(purchase, now - 1000, now), true);
    const proof = referralEvidence('android', purchase, now);
    const order = { orderId: purchase.orderId, purchaseToken: token, state: 'PROCESSED', lineItems: [{
      productId: product, subscriptionDetails: { basePlanId: plan, offerId: offer,
        servicePeriodStartTime: new Date(now).toISOString(), servicePeriodEndTime: new Date(now + duration).toISOString(),
        offerPhaseDetails: { freeTrialDetails: {} } },
    }] };
    assert.equal((await reviewReferralSource(proof, order, now + 90 * DAY)).status, 'verified');
    const changed = structuredClone(order); changed.lineItems[0].subscriptionDetails.offerId = 'referral-earned-month';
    assert.equal((await reviewReferralSource(proof, changed, now + 90 * DAY)).status, 'unverified');
    for (const [wrongPlan, wrongOffer] of [[plan, 'unrelated-week'], [plan, 'referral-earned-month'], ['wrong-plan', offer]]) {
      assert.equal(isQualifyingTrial(referralPurchase('android', play(product, wrongPlan, wrongOffer, duration), owner, now), now, now), false);
    }
  }
});

test('week acquisition does not shorten the separately earned reward month', () => {
  const redeemed = referralPurchase('ios', { ...apple, offerType: 3, offerIdentifier: 'reward-month-a' }, owner, now);
  const reward = { state: 'store_confirmation', offerId: 'reward-month-a', productId: apple.productId,
    reservedAt: now, originalPurchaseKey: redeemed.key };
  assert.equal(isMatchingAppleRedemption(redeemed, reward, now), false);
  assert.equal(isMatchingAppleRedemption({ ...redeemed, expires: now + 30 * DAY }, reward, now), true);
  const androidReward = { state: 'store_subscription', redemptionPlatform: 'android', id: owner,
    productId: 'freefinder.pro.monthly', offerId: 'referral-earned-month', basePlanId: 'monthly', reservedAt: now };
  const android = { rewardProfile: owner, product: androidReward.productId, offer: androidReward.offerId,
    basePlan: 'monthly', region: 'AT', freePhase: true, orderId: 'GPA.1111-2222-3333-44444', started: now, expires: now + 7 * DAY };
  assert.equal(isMatchingPlayRewardSubscription(android, androidReward, now), false);
  assert.equal(isMatchingPlayRewardSubscription({ ...android, expires: now + 30 * DAY }, androidReward, now), true);
});

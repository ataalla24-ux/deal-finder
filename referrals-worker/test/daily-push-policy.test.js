import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyMessage, eligiblePushDeals, normalizePushRegistration, pickDailyPush, pickMarketingPush, pushAudience, marketingDay, viennaClock, PUSH_APP_ID } from '../src/daily-push-policy.js';

const now = Date.parse('2026-10-08T07:00:00Z');
const deal = { id: 'verified-pizza', title: '1+1 Pizza gratis', brand: 'Testrestaurant', category: 'essen',
  dateConfidence: 'high', expiryKind: 'range', validFrom: '2026-10-08', validUntil: '2026-10-09',
  pipelineLifecycle: { manualDecision: 'approved' } };
const feed = { lastUpdated: new Date(now).toISOString(), deals: [deal] };
const state = { ok: true, overrides: [], dailyDeal: { date: '2026-10-08', dealId: deal.id } };
test('Vienna delivery hour follows DST and local date, not UTC or device timezone', () => {
  for (const input of ['2026-07-08T07:00:00Z', '2026-12-08T08:00:00Z', '2026-03-29T07:00:00Z', '2026-10-25T08:00:00Z']) assert.equal(viennaClock(Date.parse(input)).hour, 9);
  assert.equal(viennaClock(Date.parse('2026-10-07T23:00:00Z')).day, '2026-10-08');
});
test('verified current deal is selected with UTF-8-safe localized message', () => {
  assert.equal(pickDailyPush(feed, state, [], now).id, deal.id);
  assert.deepEqual(dailyMessage(deal), { title: 'FreeFinder Deal des Tages', body: 'Heute: 1+1 Pizza gratis · Testrestaurant' });
  assert.match(dailyMessage(deal, 'en').body, /^Today:/);
});

test('Pro uses the published daily feature and never substitutes an unrelated deal', () => {
  const other = { ...deal, id: 'other', title: 'Gratis Kebap' };
  const two = { ...feed, deals: [other, deal] };
  assert.equal(pickDailyPush(two, state, [], now).id, deal.id);
  for (const featured of [null, { date: '2026-10-07', dealId: deal.id }, { date: '2026-10-08', dealId: 'missing' }]) {
    assert.equal(pickDailyPush(two, state, [], now, featured), null);
  }
  assert.equal(pickDailyPush(two, state, [deal.id], now), null);
  assert.ok(pickMarketingPush(two, state, [], now));
});

test('Free requires explicit versioned marketing consent, independent of Pro and OS permission', () => {
  const body = { packageName: PUSH_APP_ID, token: 'test-fcm-token-'.repeat(4), appDeviceId: 'test-marketing-installation',
    subscriptionPlan: 'free', policyVersion: 2, notificationsEnabled: false, marketingEnabled: true,
    marketingConsentVersion: 1, marketingConsentAt: now - 1000, pushEnvironment: 'production', revision: now };
  const optedIn = normalizePushRegistration(body, 'fcm', now);
  assert.equal(optedIn.enabled, true);
  assert.equal(optedIn.dailyEnabled, false);
  for (const edit of [{ policyVersion: 1 }, { marketingEnabled: false }, { marketingConsentVersion: 0 },
    { marketingConsentAt: 0 }, { marketingConsentAt: now + 600000 }, { marketingConsentAt: undefined }]) {
    assert.equal(normalizePushRegistration({ ...body, ...edit }, 'fcm', now).enabled, false);
  }
  const env = { DAILY_PUSH_ENABLED: '1', MARKETING_PUSH_ENABLED: '1' };
  const friday = now + 86400000;
  assert.equal(pushAudience(optedIn, env, now), null);
  assert.equal(pushAudience(optedIn, env, friday), 'marketing_deal');
  assert.equal(pushAudience(optedIn, { ...env, MARKETING_PUSH_ENABLED: '0' }, friday), null);
  const pro = normalizePushRegistration({ ...body, subscriptionPlan: 'pro', notificationsEnabled: true }, 'fcm', now);
  assert.equal(pushAudience(pro, env, friday), 'daily_deal');
  assert.equal(pushAudience({ ...pro, dailyEnabled: false }, env, friday), null, 'Pro is never silently moved into marketing');
  for (let offset = 0; offset < 30; offset++) {
    assert.equal(Array.from({ length: 7 }, (_, n) => marketingDay(now + (offset + n) * 86400000)).filter(Boolean).length, 3);
  }
});
test('expired, future, unknown, malformed and timed offers fail closed', () => {
  for (const edit of [{ validUntil: '2026-10-07' }, { validFrom: '2026-10-09' }, { validUntil: '2026-99-99' },
    { dateConfidence: 'low' }, { expiryKind: 'recurring' }, { title: 'Wien - manuell prüfen' },
    { description: 'Montag bis Freitag' }, { description: 'Ab 16:00 Uhr' }, { hidden: true },
    { pipelineLifecycle: { manualDecision: 'pending' } }, { validity: { status: 'expired' } }]) {
    assert.equal(eligiblePushDeals({ ...feed, deals: [{ ...deal, ...edit }] }, state, now).length, 0, JSON.stringify(edit));
  }
});
test('missing/old feed and unavailable moderation state never use cached fallback', () => {
  assert.equal(eligiblePushDeals({ ...feed, lastUpdated: '2026-10-01' }, state, now).length, 0);
  assert.equal(eligiblePushDeals(feed, { ok: false }, now).length, 0);
  assert.equal(eligiblePushDeals(feed, { ok: true }, now).length, 0);
});
test('moderation removal and edits apply even before CDN feed updates', () => {
  assert.equal(eligiblePushDeals(feed, { ok: true, overrides: [{ dealId: deal.id, hidden: true }] }, now).length, 0);
  assert.equal(eligiblePushDeals(feed, { ok: true, overrides: [{ dealId: deal.id, title: '2+1 Pizza gratis' }] }, now)[0].title, '2+1 Pizza gratis');
});
test('no repeating deal even when daily selection pins it', () => {
  assert.equal(pickDailyPush(feed, { ...state, dailyDeal: { dealId: deal.id, date: '2026-10-08' } }, [deal.id], now), null);
});
test('registration requires exact app, permission, plan, metadata and valid clock', () => {
  const body = { bundleId: PUSH_APP_ID, token: 'ab'.repeat(32), appDeviceId: 'test-installation-0001',
    subscriptionPlan: 'pro', notificationsEnabled: true, policyVersion: 1, pushEnvironment: 'production', revision: now };
  assert.equal(normalizePushRegistration(body, 'apns', now).enabled, true);
  for (const edit of [{ subscriptionPlan: 'free' }, { notificationsEnabled: false }, { policyVersion: 0 }, { pushEnvironment: '' }]) {
    assert.equal(normalizePushRegistration({ ...body, ...edit }, 'apns', now).enabled, false);
  }
  for (const edit of [{ bundleId: 'other' }, { appDeviceId: '' }, { token: 'secret' }, { revision: now - 700000 }]) {
    assert.throws(() => normalizePushRegistration({ ...body, ...edit }, 'apns', now));
  }
});

test('Android registrations retain test isolation and reject missing environment metadata', () => {
  const body = { packageName: PUSH_APP_ID, token: 'test-fcm-token-'.repeat(4), appDeviceId: 'test-installation-android',
    subscriptionPlan: 'pro', notificationsEnabled: true, policyVersion: 1, revision: now };
  assert.equal(normalizePushRegistration(body, 'fcm', now).enabled, false);
  for (const pushEnvironment of ['development', 'production']) {
    const device = normalizePushRegistration({ ...body, pushEnvironment }, 'fcm', now);
    assert.equal(device.enabled, true);
    assert.equal(device.environment, pushEnvironment);
  }
  assert.equal(normalizePushRegistration({ ...body, pushEnvironment: 'sandbox' }, 'fcm', now).enabled, false);
});

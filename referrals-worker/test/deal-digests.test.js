import test from 'node:test';
import assert from 'node:assert/strict';
import { campaignMessage, digestType, normalizePushRegistration, pickDigestDeals, pushAudience, pushSlot, PUSH_APP_ID } from '../src/daily-push-policy.js';
import { DailyPushService } from '../src/daily-push.js';

const now = Date.parse('2026-10-11T16:05:00Z');
const deal = (id, edits = {}) => ({ id, title: '1+1 Pizza gratis', brand: 'Pizzeria', votes: 2,
  dateConfidence: 'high', expiryKind: 'range', validFrom: '2026-10-01', validUntil: '2026-10-31',
  pipelineLifecycle: { manualDecision: 'approved', publishedAt: '2026-10-08T10:00:00Z' }, ...edits });
const feed = deals => ({ lastUpdated: new Date(now).toISOString(), deals });
const state = { ok: true, overrides: [] };
const env = { DAILY_PUSH_ENABLED: '1', MARKETING_PUSH_ENABLED: '1', DIGEST_PUSH_ENABLED: '1' };
const body = { packageName: PUSH_APP_ID, token: 'test-digest-token-'.repeat(3), appDeviceId: 'test-digest-installation',
  policyVersion: 3, subscriptionPlan: 'pro', notificationsEnabled: true, marketingEnabled: true,
  marketingConsentVersion: 2, marketingConsentAt: now - 1000, pushEnvironment: 'production', revision: now };

test('disabled digests do not start evening alarms or read the feed', async () => {
  const service = Object.create(DailyPushService.prototype);
  service.env = { ...env, DIGEST_PUSH_ENABLED: '0' };
  service.now = () => now;
  service.ctx = { storage: { setAlarm: () => assert.fail('Unexpected scheduled alarm') } };
  service.deliverBatch = () => assert.fail('Unexpected feed load or batch');
  assert.equal(service.activeWindow(), false);
  await service.alarm();
  await service.fetch(new Request('https://test/tick'));
  service.env.DIGEST_PUSH_ENABLED = '1';
  assert.equal(service.activeWindow(), true);
});

test('two Vienna evening windows per week, including winter and DST changes', () => {
  for (const [date, type] of [['2026-10-11T16:05:00Z', 'weekly_digest'], ['2026-10-14T16:05:00Z', 'discovery_digest'],
    ['2026-10-25T17:05:00Z', 'weekly_digest'], ['2026-12-16T17:05:00Z', 'discovery_digest']]) {
    assert.equal(digestType(Date.parse(date)), type);
    assert.equal(pushSlot(Date.parse(date)), 'digest');
  }
  for (let n = 0; n < 7; n++) {
    assert.equal(Boolean(digestType(now + n * 86400000)), [0, 3].includes(n));
  }
  for (const date of ['2026-10-11T07:05:00Z', '2026-10-11T15:59:00Z', '2026-10-11T17:00:00Z']) {
    assert.equal(digestType(Date.parse(date)), null);
  }
});

test('Free and Pro opt in separately from daily and legacy Pro consents stay paused', () => {
  for (const plan of ['free', 'pro', 'plus']) {
    const device = normalizePushRegistration({ ...body, subscriptionPlan: plan }, 'fcm', now);
    assert.equal(pushAudience(device, env, now), 'weekly_digest');
    assert.equal(pushAudience(device, { ...env, DIGEST_PUSH_ENABLED: '0' }, now), null);
    assert.equal(pushAudience(device, { ...env, MARKETING_PUSH_ENABLED: '0' }, now), null);
    assert.equal(pushAudience({ ...device, marketingEnabled: false }, env, now), null);
    assert.equal(pushAudience({ ...device, dailyEnabled: false }, env, now), 'weekly_digest');
    assert.equal(pushAudience({ ...device, consentVersion: 1 }, env, now), plan === 'free' ? 'weekly_digest' : null);
    assert.equal(pushAudience({ ...device, policyVersion: 2 }, env, now), null);
  }
  const legacyPro = normalizePushRegistration({ ...body, marketingConsentVersion: 1, notificationsEnabled: false }, 'fcm', now);
  assert.equal(legacyPro.enabled, false);
  assert.equal(normalizePushRegistration({ ...body, notificationsEnabled: false }, 'fcm', now).enabled, true);
  assert.equal(normalizePushRegistration({ ...body, subscriptionPlan: 'unknown' }, 'fcm', now).enabled, false);
});

test('new clients do not also receive legacy morning advertising; daily Pro unchanged', () => {
  const morning = Date.parse('2026-10-14T07:05:00Z');
  const device = normalizePushRegistration(body, 'fcm', now);
  assert.equal(pushAudience(device, env, morning), 'daily_deal');
  assert.equal(pushAudience({ ...device, plan: 'free' }, env, morning), null);
  assert.equal(pushAudience({ ...device, plan: 'free', policyVersion: 2, consentVersion: 1 }, env, morning), 'marketing_deal');
});

test('recap sorts current recently published deals by votes, then publication time', () => {
  const offers = [deal('low'), deal('popular', { votes: 8 }), deal('fresh', {
    pipelineLifecycle: { manualDecision: 'approved', publishedAt: '2026-10-10T10:00:00Z' } }), deal('fourth', { votes: 0 })];
  assert.deepEqual(pickDigestDeals(feed(offers), state, [], now, 'weekly_digest').map(d => d.id), ['popular', 'fresh', 'low']);
  assert.equal(pickDigestDeals(feed(offers), state, [], now, 'discovery_digest')[0].id, 'fresh');
  assert.ok(!pickDigestDeals(feed(offers), state, ['popular'], now).some(d => d.id === 'popular'));
});

test('no expired, old, unknown-date, future, unapproved or internally contaminated recap', () => {
  for (const edits of [{ validUntil: '2026-10-10' }, { dateConfidence: 'low' }, { title: 'Manuell prüfen' },
    { validFrom: '2026-10-12' }, { pipelineLifecycle: { manualDecision: 'pending', publishedAt: '2026-10-08' } },
    { pipelineLifecycle: { manualDecision: 'approved', publishedAt: '2026-09-01T16:05:00Z' } },
    { pipelineLifecycle: { manualDecision: 'approved', publishedAt: '2026-10-12' } },
    { pipelineLifecycle: { manualDecision: 'approved' }, pubDate: '2026-10-08' }]) {
    assert.deepEqual(pickDigestDeals(feed([deal('bad', edits)]), state, [], now), [], JSON.stringify(edits));
  }
  assert.deepEqual(pickDigestDeals(feed([deal('hidden')]), { ok: true, overrides: [{ dealId: 'hidden', hidden: true }] }, [], now), []);
  assert.deepEqual(pickDigestDeals({ ...feed([deal('old')]), lastUpdated: '2026-10-01' }, state, [], now), []);
});

test('weekly recap includes ongoing offers, without calling them new or repeating a recent offer', () => {
  const ongoing = deal('ongoing', { pipelineLifecycle: { manualDecision: 'approved', publishedAt: '2026-09-25T10:00:00Z' } });
  assert.equal(pickDigestDeals(feed([ongoing]), state, [], now, 'weekly_digest')[0]?.id, 'ongoing');
  assert.deepEqual(pickDigestDeals(feed([ongoing]), state, [], now, 'discovery_digest'), []);
  assert.deepEqual(pickDigestDeals(feed([ongoing]), state, ['ongoing'], now, 'weekly_digest'), []);
  assert.match(campaignMessage({ type: 'weekly_digest', deal: ongoing, deals: [ongoing] }).body, /^Noch nutzbar:/);
});

test('digest text is grounded in complete offer titles and available in both languages', () => {
  const deals = [deal('a'), deal('b', { title: 'Gratis Kaffee', brand: 'Cafe' })];
  const campaign = { type: 'weekly_digest', deal: deals[0], deals };
  assert.deepEqual(campaignMessage(campaign), { title: 'Deine Wiener Wochen-Highlights',
    body: 'Noch nutzbar: 1+1 Pizza gratis (Pizzeria) · Gratis Kaffee (Cafe)' });
  assert.equal(campaignMessage(campaign, 'en').title, 'Your Vienna weekly highlights');
  assert.equal(campaignMessage({ ...campaign, type: 'discovery_digest' }).title, 'Entdecke neue Angebote in Wien');
  const long = deal('long', { title: '🍕'.repeat(45), brand: 'Untrusted'.repeat(100) });
  const message = campaignMessage({ ...campaign, deal: long, deals: [long, ...deals, long] });
  assert.ok(Array.from(message.body).length <= 220);
  assert.ok(!message.body.includes('Untrusted'));
  assert.ok(!message.body.includes('\uFFFD'));
});

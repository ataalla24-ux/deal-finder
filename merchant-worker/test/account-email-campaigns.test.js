import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEmailDigest, rewardEmail, scheduledAccountEmail } from '../src/account-email-campaigns.js';

const now = Date.parse('2026-10-14T16:05:00Z');
const deal = { id: 'example-pizza', title: '1+1 Pizza gratis', brand: 'Pizzeria', dateConfidence: 'high',
  expiryKind: 'range', validFrom: '2026-10-01', validUntil: '2026-10-31',
  pipelineLifecycle: { manualDecision: 'approved', publishedAt: '2026-10-12T10:00:00Z' } };
const feed = { lastUpdated: new Date(now).toISOString(), deals: [deal] };
const state = { ok: true, overrides: [] };

test('email templates use complete recently approved current deal titles, fixed app links and Vienna slots', () => {
  const message = buildEmailDigest(feed, state, now);
  assert.equal(message.preference, 'dealEmails'); assert.equal(message.logicalId, 'digest:discovery_digest:2026-10-14');
  assert.match(message.content.text, /1\+1 Pizza gratis \(Pizzeria\)/);
  assert.match(message.content.text, /https:\/\/freefinder.at\/\?deal=example-pizza/);
  assert.equal(buildEmailDigest(feed, state, now + 3600000), null);
  const sunday = Date.parse('2026-10-18T16:05:00Z');
  assert.equal(buildEmailDigest({ ...feed, lastUpdated: new Date(sunday).toISOString() }, state, sunday).preference, 'weeklyEmails');
});

test('email inherits feed expiry, human approval, freshness and hidden-deal exclusions', () => {
  for (const patch of [{ hidden: true }, { validUntil: '2026-10-13' }, { validFrom: '2026-10-15' },
    { dateConfidence: 'low' }, { title: 'manuell prüfen' }, { pipelineLifecycle: { manualDecision: 'pending' } }]) {
    assert.equal(buildEmailDigest({ ...feed, deals: [{ ...deal, ...patch }] }, state, now), null);
  }
  assert.equal(buildEmailDigest(feed, { ok: false, overrides: [] }, now), null);
  assert.equal(buildEmailDigest({ ...feed, lastUpdated: '2026-10-10' }, state, now), null);
  assert.equal(buildEmailDigest(feed, { ...state, overrides: [{ dealId: deal.id, hidden: true }] }, now), null);
});

test('reward email requires recent earned verified-source credit and explicit separate preference', () => {
  const reward = { id: 'e2d276c7-c969-44af-887f-49857eed41cf', state: 'earned', months: 1,
    createdAt: now - 1000, sourceEvidence: { version: 1 } };
  const account = { preferences: { rewardEmails: true }, rewards: [reward] };
  const env = { REFERRAL_MONTHS_ENABLED: '1' };
  assert.match(rewardEmail(account, env, now).content.text, /nicht automatisch/);
  for (const patch of [{ state: 'redeemed' }, { sourceReview: { status: 'revoked' } },
    { reconciliation: { status: 'manual_review' } }, { createdAt: now - 8 * 86400000 }, { sourceEvidence: null }]) {
    assert.equal(rewardEmail({ ...account, rewards: [{ ...reward, ...patch }] }, env, now), null);
  }
  assert.equal(rewardEmail({ ...account, preferences: {} }, env, now), null);
  assert.equal(rewardEmail(account, {}, now), null);
});

test('disabled schedules never call storage or feed; enabled schedule reads fixed feeds and bounds batches', async t => {
  const original = globalThis.fetch; let reads = 0, calls = 0;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (url, options) => {
    reads++; assert.equal(options.redirect, 'manual');
    if (url === 'https://freefinder.at/deals.json') return Response.json(feed);
    assert.equal(url, 'https://freefinder-referrals.freefinder-stefan.workers.dev/api/deals/state');
    return Response.json(state);
  };
  const env = { ACCOUNT_EMAIL_ENABLED: '1', ACCOUNT_EMAIL_TRANSPORT_ENABLED: '1', RESEND_WEBHOOK_SECRET: 'fixture',
    REFERRAL_MONTHS: { idFromName: () => 'id', get: () => ({ fetch: async (_url, options) => {
      calls++; assert.equal(JSON.parse(options.body).digest.preference, 'dealEmails');
      return Response.json({ ok: true, complete: false });
    } }) } };
  await scheduledAccountEmail({ ...env, ACCOUNT_EMAIL_ENABLED: '0' }, now);
  assert.equal(reads, 0); assert.equal(calls, 0);
  await scheduledAccountEmail(env, now); assert.equal(reads, 2); assert.equal(calls, 5);
});

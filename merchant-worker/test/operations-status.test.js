import test from 'node:test';
import assert from 'node:assert/strict';
import { ReferralMonthsLedger, handleReferralMonths } from '../src/referral-months.js';

const now = Date.parse('2026-10-18T14:00:00Z');
const product = 'com.stefanataalla.freefinderwien.premium.monthly';
function ledger(entries = []) {
  const data = new Map(entries);
  const storage = { get: async k => data.get(k), list: async ({ prefix, limit, startAfter }) =>
    new Map([...data].filter(([k]) => k.startsWith(prefix) && (!startAfter || k > startAfter))
      .sort(([a], [b]) => a.localeCompare(b)).slice(0, limit)) };
  return new ReferralMonthsLedger({ storage }, { REFERRAL_MONTHS_ENABLED: '1' });
}
test('operations require admin; no account authentication or writes for diagnostics', async () => {
  let calls = 0;
  const env = { REFERRAL_ADMIN_SECRET: 'fixture-admin', REFERRAL_MONTHS: { idFromName: () => 'id', get: () => ({ fetch: () => {
    calls++; return Response.json({ ok: true });
  } }) } };
  const request = secret => new Request('https://example.test/api/referral-months/operations-status', { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-freefinder-merchant-secret': secret }, body: JSON.stringify({ section: 'offers' }) });
  assert.equal((await handleReferralMonths(request('wrong'), env)).status, 403);
  assert.equal(calls, 0);
  assert.equal((await handleReferralMonths(request('fixture-admin'), env, () => { throw Error('Never authenticate customer'); })).status, 200);
  assert.equal(calls, 1);
});
test('inventory separates available, reserved, expired and Sandbox without exposing codes', async () => {
  const base = { productId: product, customerType: 'existing', expiresAt: now + 1000, environment: 'Production', code: 'SECRETTEST' };
  const r = await ledger([['offer:a', base], ['offer:b', { ...base, assignedTo: 'private-customer' }],
    ['offer:c', { ...base, expiresAt: now }], ['offer:d', { ...base, environment: 'Sandbox' }]])
    .operationsStatus({ section: 'offers' }, now);
  for (const state of ['available', 'assigned', 'expired', 'non_production']) assert.equal(r.counts[`${product}|existing|${state}`], 1);
  assert.equal(r.complete, true);
  assert.doesNotMatch(JSON.stringify(r), /SECRETTEST|private-customer/);
});
test('bounded pagination accounts for every row and does not leak profiles or preferences', async () => {
  const l = ledger(Array.from({ length: 205 }, (_, i) => [`account:${String(i).padStart(3, '0')}`, {
    recoverable: true, email: 'private@example.test', preferences: { dealEmails: true }, rewards: [{ state: 'earned' }],
  }]));
  const first = await l.operationsStatus({ section: 'accounts' }, now);
  assert.equal(first.scanned, 200); assert.equal(first.complete, false);
  const last = await l.operationsStatus({ section: 'accounts', cursor: first.cursor }, now);
  assert.equal(last.scanned, 5); assert.equal(last.complete, true);
  assert.equal(first.counts.dealEmails + last.counts.dealEmails, 205);
  assert.equal(first.counts['reward:earned'], 200);
  assert.doesNotMatch(JSON.stringify(first), /private@example/);
  for (const body of [{ section: '__proto__' }, { section: 'offers', cursor: 'account:123' }, { section: 'accounts', extra: true }]) {
    await assert.rejects(l.operationsStatus(body, now), { status: 400 });
  }
});
test('quota resets for UTC day/month and diagnostic reads never reserve sends', async () => {
  const l = ledger([['mail:quota', { day: '2026-10-17', month: '2026-10', daily: 90, monthly: 500 }]]);
  const r = await l.operationsStatus({ section: 'deliveries' }, now);
  assert.equal(r.email.dailyUsed, 0); assert.equal(r.email.monthlyUsed, 500);
  assert.equal(r.email.dailyLimit, 90); assert.equal(r.email.monthlyLimit, 2700);
  assert.equal((await l.operationsStatus({ section: 'deliveries' }, Date.parse('2026-11-01T00:00:00Z'))).email.monthlyUsed, 0);
});

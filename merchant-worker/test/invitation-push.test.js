import test from 'node:test';
import assert from 'node:assert/strict';
import { invitationPushLedger, handleInvitationPushAdmin } from '../src/invitation-push.js';
import { ReferralMonthsLedger } from '../src/referral-months.js';
import { handleAccount } from '../src/account-auth.js';

const identity = n => {
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  return { accountId: id, trustedIP: 'fixture', principal: { id, email: `owner${n}@example.test`, authTime: Date.now() / 1000 } };
};
const registration = { installation: identity(9).accountId, enabled: true, consentVersion: 1,
  provider: 'apns', token: 'a'.repeat(64), environment: 'production', language: 'de' };

function fixture(result = { ok: true, status: 200 }) {
  const data = new Map(), sends = [];
  const storage = {
    get: async k => structuredClone(data.get(k)),
    put: async (k, v) => { for (const [key, value] of typeof k === 'string' ? [[k, v]] : Object.entries(k)) data.set(key, structuredClone(value)); },
    delete: async k => { for (const key of Array.isArray(k) ? k : [k]) data.delete(key); },
    list: async ({ prefix = '', limit = 1000 } = {}) => new Map([...data].filter(([k]) => k.startsWith(prefix)).sort().slice(0, limit).map(([k, v]) => [k, structuredClone(v)])),
    getAlarm: async () => storage.at, setAlarm: async at => { storage.at = at; },
    transaction: async fn => fn(storage),
  };
  const env = { REFERRAL_MONTHS_ENABLED: '1', INVITATION_PUSH_ENABLED: '1', DAILY_DEAL_PUSH: {
    idFromName: x => x, get: () => ({ fetch: async (url, options) => {
      sends.push(JSON.parse(options.body));
      if (result === 'throw') throw Error('network unknown');
      return Response.json(result);
    } }),
  } };
  const ctx = { storage, blockConcurrencyWhile: fn => fn() };
  const ledger = new (invitationPushLedger(ReferralMonthsLedger))(ctx, env);
  const call = (action, n, body = {}) => ledger.perform(action, { ...identity(n), ...body });
  const register = async () => { await call('register', 1); await call('register', 2); };
  const accept = async () => call('accept', 2, { code: (await call('status', 1)).code });
  return { data, storage, env, sends, ledger, call, register, accept };
}

test('authenticated acceptance sends once, never claims an earned month and never changes rewards', async () => {
  const f = fixture(); await f.register();
  await f.call('account-push-device', 1, registration);
  await f.accept(); await f.accept();
  await f.ledger.deliverInvitationPushes(); await f.ledger.deliverInvitationPushes();
  assert.equal(f.sends.length, 1);
  assert.equal(f.sends[0].accountId, identity(1).accountId);
  assert.deepEqual(f.data.get('account:' + identity(1).accountId).rewards, []);
  await f.accept(); await f.ledger.deliverInvitationPushes();
  assert.equal(f.sends.length, 1, 'receipt cleanup cannot replay the event');
});

test('default off, late opt-in, disabled feature and unconfirmed devices never send', async () => {
  for (const mode of ['off', 'late', 'feature', 'sandbox']) {
    const f = fixture(); await f.register();
    if (mode === 'feature') f.env.INVITATION_PUSH_ENABLED = '0';
    if (mode === 'sandbox') await f.call('account-push-device', 1, { ...registration, environment: 'sandbox' });
    await f.accept();
    if (mode === 'late') await f.call('account-push-device', 1, registration);
    await f.ledger.deliverInvitationPushes();
    assert.equal(f.sends.length, 0, mode);
  }
});

test('opt-out and deletion revoke queued notifications; another account cannot disable this binding', async () => {
  for (const action of ['account-push-device', 'account-delete']) {
    const f = fixture(); await f.register();
    await f.call('account-push-device', 1, registration);
    await f.accept();
    await f.call(action, 1, { installation: registration.installation, enabled: false });
    await f.ledger.deliverInvitationPushes();
    assert.equal(f.sends.length, 0);
  }
  const f = fixture(); await f.register();
  await f.call('account-push-device', 1, registration);
  await f.call('account-push-device', 2, { installation: registration.installation, enabled: false });
  await f.accept(); await f.ledger.deliverInvitationPushes();
  assert.equal(f.sends.length, 1);
});

test('token rotation and transfer to another account cannot notify the old account', async () => {
  const f = fixture(); await f.register();
  await f.call('account-push-device', 1, registration);
  await f.accept();
  await f.call('account-push-device', 1, { ...registration, token: 'b'.repeat(64) });
  await f.ledger.deliverInvitationPushes();
  assert.equal(f.sends[0].device.token, 'b'.repeat(64));
  const g = fixture(); await g.register();
  await g.call('account-push-device', 1, registration);
  await g.accept();
  await g.call('account-push-device', 2, { ...registration, installation: identity(10).accountId });
  await g.ledger.deliverInvitationPushes();
  assert.equal(g.sends.length, 0);
});

test('invalid tokens, expired events and unknown provider outcomes cannot repeat', async () => {
  for (const result of ['throw', { ok: false, status: 410, invalidToken: true }]) {
    const f = fixture(result); await f.register();
    await f.call('account-push-device', 1, registration); await f.accept();
    await f.ledger.deliverInvitationPushes(); await f.ledger.deliverInvitationPushes();
    assert.equal(f.sends.length, 1);
  }
  const f = fixture(); await f.register();
  await f.call('account-push-device', 1, registration); await f.accept();
  const event = [...f.data].find(([k]) => k.startsWith('invitation-event:'));
  event[1].expires = Date.now() - 1; f.data.set(...event);
  await f.ledger.deliverInvitationPushes();
  assert.equal(f.sends.length, 0);
});

test('binding needs verified identity and consent; rate and device bounds remain enforced', async () => {
  const f = fixture(); await f.register();
  await assert.rejects(f.call('account-push-device', 1, { ...registration, consentVersion: 0 }), { status: 400 });
  await assert.rejects(f.call('account-push-device', 1, { ...registration, token: 'wrong' }), { status: 400 });
  await assert.rejects(f.call('account-push-device', 1, { ...registration, principal: identity(2).principal }), { status: 401 });
  const response = await handleAccount(new Request('https://example.test/api/account/push-device', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(registration),
  }), {}, async () => { throw Object.assign(Error('auth required'), { status: 401 }); });
  assert.equal(response.status, 401);
});

test('renewed consent never revives a queued event from an earlier opt-in', async () => {
  const f = fixture(); await f.register();
  await f.call('account-push-device', 1, registration); await f.accept();
  await f.call('account-push-device', 1, { ...registration, enabled: false });
  await f.call('account-push-device', 1, registration);
  await f.ledger.deliverInvitationPushes();
  assert.equal(f.sends.length, 0);
});

test('owner QA is default off, bound, exactly once, time limited and independent of rewards', async t => {
  t.mock.method(Date, 'now', () => Date.parse('2026-10-20T10:00:00Z'));
  const f = fixture(); await f.register();
  await assert.rejects(f.ledger.perform('invitation-owner-test', {}), { status: 403 });
  f.env.INVITATION_PUSH_QA_ENABLED = '1'; f.env.INVITATION_PUSH_QA_ACCOUNT = identity(1).accountId;
  await assert.rejects(f.ledger.perform('invitation-owner-test', {}), { status: 409 });
  await f.call('account-push-device', 1, { ...registration, environment: 'sandbox' });
  const before = structuredClone(f.data.get('account:' + identity(1).accountId));
  assert.equal((await f.ledger.perform('invitation-owner-test', {})).test.state, 'accepted');
  await f.ledger.perform('invitation-owner-test', {});
  assert.equal(f.sends.length, 1);
  assert.deepEqual(f.data.get('account:' + identity(1).accountId), before);
  const g = fixture(); await g.register();
  g.env.INVITATION_PUSH_QA_ENABLED = '1'; g.env.INVITATION_PUSH_QA_ACCOUNT = identity(1).accountId;
  t.mock.method(Date, 'now', () => Date.parse('2026-10-22T00:00:00Z'));
  await assert.rejects(g.ledger.perform('invitation-owner-test', {}), { status: 403 });
});

test('test admin endpoint requires the secret, rejects request data and cannot choose a recipient', async () => {
  const env = { MERCHANT_PROMO_ADMIN_SECRET: 'fixture-secret', REFERRAL_MONTHS: {
    idFromName: x => x, get: () => ({ fetch: async () => Response.json({ ok: true }) }),
  } };
  const url = 'https://example.test/api/invitations/admin/owner-test';
  assert.equal((await handleInvitationPushAdmin(new Request(url), env)).status, 401);
  const headers = { authorization: 'Bearer fixture-secret' };
  assert.equal((await handleInvitationPushAdmin(new Request(url, { method: 'POST', headers, body: '{"token":"x"}' }), env)).status, 400);
  assert.equal((await handleInvitationPushAdmin(new Request(url + '?account=x', { headers }), env)).status, 400);
  assert.equal((await handleInvitationPushAdmin(new Request(url, { method: 'POST', headers }), env)).status, 200);
});

test('delivery receipts expire even when sending is disabled and schedule their own cleanup', async () => {
  const f = fixture(), now = Date.now();
  f.env.INVITATION_PUSH_ENABLED = '0';
  await f.storage.put('invitation-receipt:old', { at: now - 8 * 86400000, states: [] });
  await f.storage.put('invitation-receipt:new', { at: now - 86400000, states: [] });
  await f.ledger.pruneInvitationReceipts();
  assert.equal(await f.storage.get('invitation-receipt:old'), undefined);
  assert.equal(f.storage.at, now + 6 * 86400000);
});

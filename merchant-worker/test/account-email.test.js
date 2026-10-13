import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from 'miniflare';
import { Webhook } from 'svix';
import { bundledEmail } from './bundled-email.js';
import { bundledAuth } from './bundled-auth.js';

const accountId = '4066b3a2-ea02-480e-b846-532b57f118aa';
const secret = 'whsec_' + Buffer.from('fixture-signing-key-not-a-real-secret').toString('base64');
const providerId = 'fb0221f9-c30e-47e1-8b77-2ebc55b0040d';
const account = { id: accountId, recoverable: true, email: 'fixture@example.test', rewards: [],
  preferences: { dealEmails: true, weeklyEmails: false, rewardEmails: false }, consentEvents: [] };
const env = { ACCOUNT_EMAIL_ENABLED: '1', ACCOUNT_EMAIL_TRANSPORT_ENABLED: '1', ACCOUNT_EMAIL_QA_ENABLED: '1',
  RESEND_API_KEY: 're_fixture_only_not_a_real_key', RESEND_WEBHOOK_SECRET: secret, MERCHANT_PROMO_ADMIN_SECRET: 'fixture-admin' };
const content = { subject: 'Neue Deals', text: 'Aktuelle Angebote findest du in der App.' };

async function runtime(t, bindings = {}) {
  const sent = []; let providerStatus = 200;
  const mf = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2025-12-01',
    log: new Log(LogLevel.NONE), bindings: { ...env, ...bindings },
    modules: [{ type: 'ESModule', path: 'runtime.js', contents: `
      import { accountEmailLedger, handleAccountEmail } from './src/account-email.js';
      import { ReferralMonthsLedger } from './src/referral-months.js';
      export class Ledger extends accountEmailLedger(ReferralMonthsLedger) {
        async perform(action, body) {
          if (action === 'seed') { await this.storage.put(body); return {ok:true}; }
          if (action === 'rows') return Object.fromEntries(await this.storage.list());
          if (action === 'send') return this.sendAccountEmail(body.accountId, body.logicalId, body.preference, body.content);
          if (action === 'clear') { await this.storage.delete(body.keys); return {ok:true}; }
          return super.perform(action, body);
        }
      }
      export default { fetch(request, env) { return handleAccountEmail(request, env); } };
    ` }, await bundledEmail(), await bundledAuth(), { type: 'ESModule', path: 'src/referral-months.js',
      contents: await readFile(new URL('../src/referral-months.js', import.meta.url), 'utf8') }],
    durableObjects: { REFERRAL_MONTHS: { className: 'Ledger', useSQLite: true } },
    outboundService: async request => {
      assert.equal(request.url, 'https://api.resend.com/emails');
      assert.equal(request.headers.get('authorization'), 'Bearer ' + env.RESEND_API_KEY);
      sent.push({ body: await request.json(), id: request.headers.get('idempotency-key') });
      return Response.json({ id: providerId }, { status: providerStatus });
    },
  }));
  t.after(() => mf.dispose());
  const ns = await mf.getDurableObjectNamespace('REFERRAL_MONTHS');
  const ledger = ns.get(ns.idFromName('referral-months-v1'));
  const call = async (action, body = {}) => {
    const response = await ledger.fetch('https://internal/' + action, { method: 'POST', body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const send = (patch = {}) => call('send', { accountId, logicalId: 'deal:2026-10-13', preference: 'dealEmails', content, ...patch });
  await call('seed', { ['account:' + accountId]: account });
  return { mf, call, send, sent, failProvider: value => { providerStatus = value; } };
}

test('customer email requires all gates, current consent, live recoverable profile and exact category', async t => {
  for (const bindings of [{ ACCOUNT_EMAIL_ENABLED: '0' }, { ACCOUNT_EMAIL_TRANSPORT_ENABLED: '0' }, { RESEND_WEBHOOK_SECRET: '' }]) {
    const r = await runtime(t, bindings);
    assert.equal((await r.send()).body.state, 'disabled'); assert.equal(r.sent.length, 0);
  }
  const r = await runtime(t);
  for (const patch of [{ deletedAt: 1 }, { recoverable: false }, { email: '' }, { preferences: { dealEmails: false } }]) {
    await r.call('seed', { ['account:' + accountId]: { ...account, ...patch } });
    assert.equal((await r.send()).body.state, 'no_consent');
  }
  assert.equal((await r.send({ preference: 'bogus' })).body.state, 'invalid');
  assert.equal(r.sent.length, 0);
});

test('concurrent sends have exactly one immutable delivery and reserve provider quota first', async t => {
  const r = await runtime(t);
  const results = await Promise.all(Array.from({ length: 6 }, () => r.send()));
  assert.ok(results.every(x => x.body.state === 'accepted'));
  assert.equal(r.sent.length, 1);
  const rows = (await r.call('rows')).body;
  assert.equal(rows['mail:quota'].daily, 1); assert.equal(rows['mail:quota'].monthly, 1);
  const row = Object.entries(rows).find(([k]) => k.startsWith('mail:account:'))[1];
  assert.equal(row.state, 'accepted'); assert.equal(row.delivery.to, account.email);
  assert.ok(row.tokenHash); assert.equal(row.delivery.subject, content.subject);
  assert.deepEqual(r.sent[0].body.to, [account.email]);
  assert.match(r.sent[0].body.text, /E-Mails abbestellen:/);
  assert.equal((await r.send({ content: { ...content, subject: 'Changed' } })).body.state, 'accepted');
  assert.equal(r.sent.length, 1);
});

test('unknown responses and persisted pre-send attempts never replay, even with a changed body', async t => {
  const r = await runtime(t); r.failProvider(503);
  assert.equal((await r.send()).body.state, 'unknown');
  r.failProvider(200);
  assert.equal((await r.send()).body.state, 'unknown'); assert.equal(r.sent.length, 1);
  const rows = (await r.call('rows')).body;
  const [key, row] = Object.entries(rows).find(([k]) => k.startsWith('mail:account:'));
  await r.call('seed', { [key]: { ...row, state: 'attempting', result: undefined } });
  assert.equal((await r.send()).body.state, 'attempting'); assert.equal(r.sent.length, 1);
});

test('daily and monthly safety quotas fail closed without attempting delivery', async t => {
  const r = await runtime(t); const day = new Date().toISOString().slice(0, 10), month = day.slice(0, 7);
  for (const counts of [{ daily: 90, monthly: 90 }, { daily: 1, monthly: 2700 }]) {
    await r.call('seed', { 'mail:quota': { day, month, ...counts } });
    assert.equal((await r.send()).body.state, 'quota');
  }
  assert.equal(r.sent.length, 0);
});

test('unsubscribe GET is inert, POST disables all email choices, repeats are private and no login is needed', async t => {
  const r = await runtime(t); await r.send();
  const url = r.sent[0].body.headers['List-Unsubscribe'].slice(1, -1);
  assert.equal((await r.mf.dispatchFetch(url)).status, 200);
  assert.equal((await r.call('rows')).body['account:' + accountId].preferences.dealEmails, true);
  for (let i = 0; i < 2; i++) assert.equal((await r.mf.dispatchFetch(url, { method: 'POST', body: 'List-Unsubscribe=One-Click' })).status, 200);
  const updated = (await r.call('rows')).body['account:' + accountId];
  assert.deepEqual(updated.preferences, { dealEmails: false, weeklyEmails: false, rewardEmails: false });
  assert.equal((await r.send({ logicalId: 'next' })).body.state, 'no_consent'); assert.equal(r.sent.length, 1);
  assert.equal((await r.mf.dispatchFetch('https://fixture/api/email/unsubscribe?token=' + 'a'.repeat(64), { method: 'POST' })).status, 200);
  assert.equal((await r.mf.dispatchFetch(url + '&token=' + 'a'.repeat(64), { method: 'POST' })).status, 400);
});

test('old email unsubscribe cannot disable a newly verified address', async t => {
  const r = await runtime(t); await r.send();
  const url = r.sent[0].body.headers['List-Unsubscribe'].slice(1, -1);
  await r.call('seed', { ['account:' + accountId]: { ...account, email: 'new@example.test' } });
  await r.mf.dispatchFetch(url, { method: 'POST' });
  assert.equal((await r.call('rows')).body['account:' + accountId].preferences.dealEmails, true);
});

async function webhook(r, type, { age = 0, tamper = false, id = providerId, unsigned = false } = {}) {
  const payload = JSON.stringify({ type, data: { email_id: id, to: ['private@example.test'], subject: 'private' } });
  const timestamp = new Date(Date.now() - age), msgId = 'msg_fixture';
  const headers = unsigned ? {} : { 'svix-id': msgId, 'svix-timestamp': String(Math.floor(timestamp.getTime() / 1000)),
    'svix-signature': new Webhook(secret).sign(msgId, timestamp, payload) };
  return r.mf.dispatchFetch('https://fixture/api/email/resend-webhook', { method: 'POST', headers, body: payload + (tamper ? ' ' : '') });
}

test('signed events work in Workers; invalid, altered and stale signatures cannot update delivery', async t => {
  const r = await runtime(t); await r.send();
  for (const options of [{ unsigned: true }, { age: 600000 }, { tamper: true }]) {
    assert.equal((await webhook(r, 'email.delivered', options)).status, 400);
  }
  assert.equal((await webhook(r, 'email.delivered')).status, 200);
  let rows = (await r.call('rows')).body;
  assert.equal(Object.entries(rows).find(([k]) => k.startsWith('mail:account:'))[1].delivered, true);
  assert.equal((await webhook(r, 'email.complained')).status, 200);
  assert.equal((await webhook(r, 'email.complained')).status, 200);
  assert.equal((await webhook(r, 'email.delivered')).status, 200);
  rows = (await r.call('rows')).body;
  assert.equal(Object.entries(rows).find(([k]) => k.startsWith('mail:account:'))[1].state, 'complained');
  assert.equal((await r.send({ logicalId: 'next' })).body.state, 'suppressed');
  assert.equal(JSON.stringify(rows).includes('private@example.test'), false);
  assert.equal(r.sent.length, 1);
});

test('account deletion removes message, recipient, provider and unsubscribe records and is retryable', async t => {
  const r = await runtime(t); await r.send();
  const deletion = { accountId, principal: { id: accountId, authTime: Date.now() / 1000 }, trustedIP: 'fixture' };
  for (let i = 0; i < 2; i++) assert.equal((await r.call('account-delete', deletion)).body.ok, true);
  const rows = (await r.call('rows')).body;
  assert.equal(JSON.stringify(rows).includes(account.email), false);
  assert.equal(Object.keys(rows).filter(x => /^mail:(account|provider|token):/.test(x)).length, 0);
  assert.equal((await r.send({ logicalId: 'after-delete' })).body.state, 'no_consent');
});

test('fixed owner-only test requires admin and independent gate; at most one message even concurrently', async t => {
  const r = await runtime(t, { ACCOUNT_EMAIL_ENABLED: '0' });
  const url = 'https://fixture/api/email/admin/owner-test', headers = { authorization: 'Bearer fixture-admin' };
  assert.equal((await r.mf.dispatchFetch(url, { method: 'POST' })).status, 401);
  assert.equal((await r.mf.dispatchFetch(url + '?to=evil@example.test', { method: 'POST', headers })).status, 400);
  assert.equal((await r.mf.dispatchFetch(url, { method: 'POST', headers, body: '{}' })).status, 400);
  const results = await Promise.all(Array.from({ length: 4 }, () => r.mf.dispatchFetch(url, { method: 'POST', headers })));
  assert.ok(results.every(x => x.status === 200)); assert.equal(r.sent.length, 1);
  assert.deepEqual(r.sent[0].body.to, ['freefinder.at@gmail.com']);
  assert.equal(r.sent[0].body.from, 'FreeFinder <hallo@freefinder.at>');
  assert.match(r.sent[0].body.subject, /einmaliger E-Mail-Zustelltest/);
  assert.equal((await (await r.mf.dispatchFetch(url, { headers })).json()).state, 'accepted');
  const off = await runtime(t, { ACCOUNT_EMAIL_QA_ENABLED: '0' });
  assert.equal((await off.mf.dispatchFetch(url, { method: 'POST', headers })).status, 503); assert.equal(off.sent.length, 0);
});

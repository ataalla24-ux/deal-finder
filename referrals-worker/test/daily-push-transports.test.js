import test from 'node:test';
import assert from 'node:assert/strict';
import { DailyDealPush } from '../src/index.js';
import { sendFcmPush } from '../src/fcm-push.js';

async function pem(algorithm) {
  const keys = await crypto.subtle.generateKey(algorithm, true, ['sign', 'verify']);
  return `-----BEGIN PRIVATE KEY-----\n${Buffer.from(await crypto.subtle.exportKey('pkcs8', keys.privateKey)).toString('base64')}\n-----END PRIVATE KEY-----`;
}
const campaign = () => ({ day: '2026-10-08', deal: { id: 'verified-pizza' }, expires: Date.now() + 300000 });
test('APNs uses the device environment, collapse key and real expiration', async t => {
  const env = { APNS_TEAM_ID: 'TESTTEAM', APNS_KEY_ID: 'TESTKEY', APNS_BUNDLE_ID: 'com.stefanataalla.freefinderwien',
    APNS_USE_SANDBOX: 'true', APNS_PRIVATE_KEY: await pem({ name: 'ECDSA', namedCurve: 'P-256' }) };
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => { calls.push({ url, init }); return new Response('', { status: 200 }); });
  const push = campaign();
  const device = { token: 'ab'.repeat(32), environment: 'production' };
  const sender = Object.create(DailyDealPush.prototype); sender.env = env;
  assert.equal((await sender.sendApple(device, push, { title: 'Top deal', body: 'Pizza' })).ok, true);
  assert.match(calls[0].url, /^https:\/\/api.push.apple.com\//);
  assert.equal(calls[0].init.headers['apns-collapse-id'], 'daily-2026-10-08');
  assert.equal(calls[0].init.headers['apns-expiration'], String(Math.floor(push.expires / 1000)));
  const payload = JSON.parse(calls[0].init.body);
  assert.equal(payload.type, 'daily_deal'); assert.equal(payload.dealId, 'verified-pizza');
  await sender.sendApple({ ...device, environment: 'sandbox' }, push, { title: 'Test', body: 'Test' });
  assert.match(calls[1].url, /^https:\/\/api.sandbox.push.apple.com\//);
  assert.equal(calls[0].init.headers.authorization, calls[1].init.headers.authorization, 'reuse provider JWT');
  await sender.sendApple(device, { ...push, type: 'marketing_deal' }, { title: 'Deal tip', body: 'Pizza' });
  assert.equal(JSON.parse(calls[2].init.body).type, 'marketing_deal');
  await sender.sendApple(device, { ...push, type: 'weekly_digest' }, { title: 'Wochen-Highlights', body: 'Noch nutzbar: Pizza' });
  assert.equal(calls[3].init.headers['apns-collapse-id'], 'digest-2026-10-08');
  assert.equal(JSON.parse(calls[3].init.body).type, 'weekly_digest');
  assert.equal(JSON.parse(calls[3].init.body).dealId, 'verified-pizza');
  await sender.sendApple(device, { type: 'invitation_accepted', eventId: 'a'.repeat(64), accountId: 'owner',
    day: 'a'.repeat(64), expires: push.expires }, { title: 'Einladung', body: 'Angenommen' });
  const invite = JSON.parse(calls[4].init.body);
  assert.equal(invite.eventId, 'a'.repeat(64));
  assert.equal(invite.accountId, 'owner');
  assert.equal(calls[4].init.headers['apns-collapse-id'], 'a'.repeat(64));
});
test('FCM sends data-only, scoped OAuth, bounded TTL and handles unregistered tokens', async t => {
  const key = await pem({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' });
  const env = { FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: 'test-project', client_email: 'test@example.test', private_key: key }) };
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, init });
    return url.includes('oauth2') ? Response.json({ access_token: 'test-token', expires_in: 3600 }) :
      Response.json({ error: { details: [{ errorCode: 'UNREGISTERED' }] } }, { status: 404 });
  });
  const result = await sendFcmPush(env, { token: 'test-fcm-token' }, campaign(), { title: 'Top deal', body: 'Pizza' });
  assert.equal(result.invalidToken, true);
  const claims = JSON.parse(Buffer.from(calls[0].init.body.get('assertion').split('.')[1], 'base64url'));
  assert.equal(claims.scope, 'https://www.googleapis.com/auth/firebase.messaging');
  const message = JSON.parse(calls[1].init.body).message;
  assert.equal(message.notification, undefined);
  assert.equal(message.data.type, 'daily_deal'); assert.equal(message.data.dealId, 'verified-pizza');
  assert.ok(parseInt(message.android.ttl) <= 300);
  await sendFcmPush(env, { token: 'test-fcm-token' }, { ...campaign(), type: 'marketing_deal' }, { title: 'Deal tip', body: 'Pizza' });
  assert.equal(JSON.parse(calls[2].init.body).message.data.type, 'marketing_deal');
  await sendFcmPush(env, { token: 'test-fcm-token' }, { ...campaign(), type: 'discovery_digest' }, { title: 'Neue Angebote', body: 'Pizza' });
  const digest = JSON.parse(calls[3].init.body).message;
  assert.equal(digest.data.type, 'discovery_digest');
  assert.equal(digest.data.dealId, 'verified-pizza');
  assert.equal(digest.notification, undefined);
  assert.equal(digest.android.collapse_key, 'digest-2026-10-08');
  await sendFcmPush(env, { token: 'test-fcm-token' }, { type: 'invitation_accepted', eventId: 'a'.repeat(64),
    accountId: 'owner', day: 'a'.repeat(64), expires: Date.now() + 300000 }, { title: 'Einladung', body: 'Angenommen' });
  const invitation = JSON.parse(calls[4].init.body).message;
  assert.equal(invitation.data.eventId, 'a'.repeat(64));
  assert.equal(invitation.data.accountId, 'owner');
  assert.equal(invitation.notification, undefined);
});

test('invitation QA permits one owner sandbox send only; real campaigns keep production restriction', async () => {
  const sender = Object.create(DailyDealPush.prototype);
  const data = new Map(), sends = [];
  sender.env = {};
  sender.now = () => Date.parse('2026-10-20T10:00:00Z');
  sender.ready = () => true;
  sender.ctx = { storage: { get: async k => data.get(k), put: async (k, v) => data.set(k, v) },
    blockConcurrencyWhile: fn => fn() };
  sender.sendApple = async (...args) => { sends.push(args); return { ok: true, status: 200 }; };
  const body = { device: { provider: 'apns', environment: 'sandbox', token: 'a'.repeat(64) },
    accountId: '00000000-0000-4000-8000-000000000001',
    eventId: Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('invitation-owner-test:2026-10-20'))).toString('hex'),
    expires: sender.now() + 60000 };
  const request = (path, value = body) => new Request('https://push.internal/' + path, { method: 'POST', body: JSON.stringify(value) });
  assert.equal((await sender.fetch(request('invitation'))).status, 400);
  assert.equal((await sender.fetch(request('invitation-owner-test'))).status, 403);
  sender.env.INVITATION_PUSH_QA_ENABLED = '1'; sender.env.INVITATION_PUSH_QA_ACCOUNT = body.accountId;
  assert.equal((await sender.fetch(request('invitation-owner-test', { ...body, accountId: 'someone-else' }))).status, 403);
  assert.equal((await sender.fetch(request('invitation-owner-test'))).status, 200);
  await sender.fetch(request('invitation-owner-test'));
  assert.equal(sends.length, 1);
  assert.match(sends[0][2].title, /^TEST:/);
  sender.now = () => Date.parse('2026-10-22T00:00:00Z');
  assert.equal((await sender.fetch(request('invitation-owner-test'))).status, 403);
});

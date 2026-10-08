import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

function environment() {
  const calls = [];
  return { calls, ADMIN_API_TOKEN: 'local-test-admin', REFERRAL_KV: { delete: async key => calls.push({ deleted: key }) },
    DAILY_DEAL_PUSH: { idFromName: name => name, get: () => ({ fetch: async (url, init) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
      return Response.json({ ok: true });
    } }) } };
}
test('register routes preserve metadata and forward only to the private registry', async () => {
  for (const provider of ['apns', 'fcm']) {
    const env = environment();
    const body = { token: 'test-token', policyVersion: 1, notificationsEnabled: true, language: 'en', subscriptionPlan: 'pro', revision: Date.now() };
    const response = await worker.fetch(new Request(`https://test/api/push/${provider}/register`, {
      method: 'POST', body: JSON.stringify(body),
    }), env);
    assert.equal(response.status, 200);
    assert.deepEqual(env.calls[0].body, { provider, body });
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});
test('status and no-send preview require admin authentication', async () => {
  for (const action of ['status', 'preview']) {
    const env = environment();
    assert.equal((await worker.fetch(new Request(`https://test/api/push/daily/${action}`), env)).status, 401);
    assert.equal(env.calls.length, 0);
    assert.equal((await worker.fetch(new Request(`https://test/api/push/daily/${action}`, {
      headers: { authorization: 'Bearer local-test-admin' },
    }), env)).status, 200);
    assert.equal(env.calls.length, 1);
  }
});
test('legacy opt-out removes both old KV registration and current token target', async () => {
  const env = environment();
  const response = await worker.fetch(new Request('https://test/api/push/apns/unregister', {
    method: 'POST', body: JSON.stringify({ token: 'ab'.repeat(32), platform: 'ios' }),
  }), env);
  assert.equal(response.status, 200);
  assert.match(env.calls[0].url, /revoke-token$/);
  assert.equal(env.calls[1].deleted, `push:apns:${'ab'.repeat(32)}`);
});
test('malformed, excessive or unconfigured registrations never report success', async () => {
  for (const body of ['{bad', ' '.repeat(8193)]) {
    const env = environment();
    const response = await worker.fetch(new Request('https://test/api/push/fcm/register', { method: 'POST', body }), env);
    assert.ok(response.status >= 400); assert.equal(env.calls.length, 0);
  }
  const unconfigured = environment();
  delete unconfigured.DAILY_DEAL_PUSH;
  const response = await worker.fetch(new Request('https://test/api/push/fcm/register', {
    method: 'POST', body: JSON.stringify({ policyVersion: 1 }),
  }), unconfigured);
  assert.equal(response.status, 503);
});

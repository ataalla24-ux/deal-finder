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
  for (const provider of ['apns', 'fcm']) for (const policyVersion of [1, 2, 3]) {
    const env = environment();
    const body = { token: 'test-token', policyVersion, notificationsEnabled: true, language: 'en', subscriptionPlan: 'pro', revision: Date.now() };
    const response = await worker.fetch(new Request(`https://test/api/push/${provider}/register`, {
      method: 'POST', body: JSON.stringify(body),
    }), env);
    assert.equal(response.status, 200);
    assert.equal(env.calls.length, 1);
    assert.equal(env.calls[0].url, 'https://push.internal/register');
    assert.deepEqual(env.calls[0].body, { provider, body });
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});
test('v3 consent and both audiences survive registration even while digest delivery is off', async () => {
  for (const provider of ['apns', 'fcm']) for (const subscriptionPlan of ['free', 'pro', 'plus']) {
    const env = { ...environment(), DIGEST_PUSH_ENABLED: '0', DAILY_PUSH_ENABLED: '1', MARKETING_PUSH_ENABLED: '1' };
    const body = { token: 'test-token', policyVersion: 3, subscriptionPlan, notificationsEnabled: true,
      marketingEnabled: true, marketingConsentVersion: 2, marketingConsentAt: Date.now(),
      pushEnvironment: 'production', revision: Date.now(), language: 'de' };
    const response = await worker.fetch(new Request(`https://test/api/push/${provider}/register`, {
      method: 'POST', body: JSON.stringify(body),
    }), env);
    assert.equal(response.status, 200);
    assert.deepEqual(env.calls, [{ url: 'https://push.internal/register', body: { provider, body } }]);
  }
});
test('unknown explicit policy versions never downgrade to the legacy registry', async () => {
  for (const provider of ['apns', 'fcm']) for (const policyVersion of [0, 4, '3', null]) {
    const env = environment();
    const body = { token: 'ab'.repeat(32), platform: 'ios', bundleId: 'com.stefanataalla.freefinderwien', policyVersion };
    const response = await worker.fetch(new Request(`https://test/api/push/${provider}/register`, {
      method: 'POST', body: JSON.stringify(body),
    }), env);
    assert.equal(response.status, 409);
    assert.equal(env.calls.length, 0);
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

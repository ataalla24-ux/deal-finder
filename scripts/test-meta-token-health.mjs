import assert from 'node:assert/strict';
import { runCheck } from './check-meta-instagram-graph.mjs';

const now = new Date('2026-10-16T00:00:00Z');
const DAY = 86400000;
const token = 'fixture-token-never-a-real-secret';
const env = {
  INSTAGRAM_ACCESS_TOKEN: token, INSTAGRAM_USER_ID: 'fixture-ig', META_INSTAGRAM_APP_ID: 'fixture-app',
  META_INSTAGRAM_TOKEN_EXPIRES_AT: '2026-10-10T00:00:00Z', INSTAGRAM_SHARED_QUOTA_ENABLED: '0',
  META_INSTAGRAM_TAGGED_MEDIA_ENABLED: '0', META_INSTAGRAM_HEALTHCHECK_HASHTAG: '',
};
const data = { is_valid: true, type: 'USER', app_id: 'fixture-app',
  expires_at: (+now + 60 * DAY) / 1000, data_access_expires_at: (+now + 90 * DAY) / 1000 };
const check = (metadata, options = {}) => runCheck({ env: { ...env, ...options.env }, now, write: false,
  fetchImpl: async (rawUrl) => {
    const url = new URL(rawUrl);
    if (url.pathname.endsWith('/debug_token')) {
      assert.equal(url.searchParams.get('input_token'), token);
      assert.equal(url.searchParams.get('access_token'), token);
      if (options.error) throw new Error(`Unable to inspect ${url}`);
      if (options.denied) return Response.json({ error: { code: 10, message: 'Inspection requires an app developer token' } }, { status: 400 });
      return Response.json({ data: metadata });
    }
    if (url.pathname.endsWith('/me')) return Response.json({ id: 'fixture-user' });
    if (url.pathname.endsWith('/permissions')) return Response.json({ data: [{ permission: 'instagram_basic', status: 'granted' }] });
    if (url.pathname.endsWith('/media')) return Response.json({ data: [] });
    if (url.searchParams.get('fields')?.includes('business_discovery')) return Response.json({ business_discovery: { username: 'ciosgrill', media: { data: [] } } });
    throw new Error(`Unexpected fixture route ${url.pathname}`);
  },
});

const renewed = await check(data);
assert.equal(renewed.ok, true, 'provider expiry supersedes stale configured metadata');
assert.equal(renewed.report.tokenExpiry.source, 'meta-debug-token');
assert.equal(renewed.report.tokenExpiry.daysRemaining, 60);
assert.equal(renewed.report.checks.filter((row) => row.name === 'token-expiry').length, 1);
assert.doesNotMatch(JSON.stringify(renewed.report), new RegExp(token));
const short = await check({ ...data, expires_at: (+now + 3600000) / 1000 });
assert.equal(short.report.tokenExpiry.status, 'expiring-soon');
assert.match(short.report.nextAction, /Renew/);
const dataExpiry = await check({ ...data, data_access_expires_at: (+now + DAY) / 1000 });
assert.equal(dataExpiry.report.tokenExpiry.daysRemaining, 1, 'data access can end before the token itself');
assert.equal((await check({ ...data, expires_at: (+now - 1000) / 1000 })).report.status, 'expired-token');
assert.equal((await check({ ...data, is_valid: false })).ok, false);
assert.equal((await check({ ...data, app_id: 'wrong-app' })).report.status, 'wrong-token-app');
const denied = await check(data, { denied: true, env: { META_INSTAGRAM_TOKEN_EXPIRES_AT: '2026-11-16T00:00:00Z' } });
assert.equal(denied.ok, true, 'optional inspection permissions do not disable working Graph endpoints');
assert.equal(denied.report.tokenExpiry.source, 'configured-metadata');
assert.equal(denied.report.checks.find((row) => row.name === 'token-inspection').status, 'unavailable');
const redacted = await check(data, { error: true });
assert.doesNotMatch(JSON.stringify(redacted.report), new RegExp(token));
assert.equal(redacted.ok, false, 'expired fallback metadata remains a failure when inspection is unavailable');
const malformed = await check({});
assert.equal(malformed.report.tokenExpiry.source, 'configured-metadata');
const noExpiry = await check({ ...data, expires_at: 0, data_access_expires_at: 0 });
assert.equal(noExpiry.report.tokenExpiry.status, 'unknown', 'zero expiry is not a made-up sixty-day renewal');
console.log('Meta token health: provider expiry, data-access deadline, short/expired/invalid/wrong-app tokens, permission fallback and secret redaction passed');

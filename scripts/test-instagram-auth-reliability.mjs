import assert from 'node:assert/strict';
import {
  parseRetryAfter,
  validateInstagramAuth,
} from './check-instagram-auth.mjs';

const cookies = [
  { name: 'sessionid', value: 'test-session' },
  { name: 'csrftoken', value: 'test-csrf' },
];
const nowMs = Date.parse('2026-07-17T10:00:00.000Z');

assert.equal(
  parseRetryAfter('120', nowMs)?.toISOString(),
  '2026-07-17T10:02:00.000Z',
  'numeric Retry-After must be interpreted as seconds',
);
assert.equal(
  parseRetryAfter('Fri, 17 Jul 2026 10:05:00 GMT', nowMs)?.toISOString(),
  '2026-07-17T10:05:00.000Z',
  'HTTP-date Retry-After must be supported',
);

let rateLimitFetches = 0;
const rateLimited = await validateInstagramAuth(cookies, {
  nowMs,
  env: {
    INSTAGRAM_AUTH_ATTEMPTS: '3',
    INSTAGRAM_AUTH_RATE_LIMIT_COOLDOWN_MS: '10000',
    INSTAGRAM_AUTH_RATE_LIMIT_MAX_COOLDOWN_MS: '600000',
  },
  fetchImpl: async () => {
    rateLimitFetches += 1;
    return new Response('{"message":"Please wait"}', {
      status: 429,
      headers: { 'content-type': 'application/json', 'retry-after': '120' },
    });
  },
  sleepImpl: async () => assert.fail('429 must open the circuit instead of retrying'),
});

assert.equal(rateLimitFetches, 1, '429 must not trigger repeated requests');
assert.equal(rateLimited.status, 'rate-limited');
assert.equal(rateLimited.credentialsState, 'unknown');
assert.equal(rateLimited.shouldRefreshCookies, false);
assert.equal(rateLimited.nextRetryAt, '2026-07-17T10:02:00.000Z');

let circuitFetches = 0;
const circuitOpen = await validateInstagramAuth(cookies, {
  nowMs: nowMs + 30_000,
  previousReport: rateLimited,
  env: {
    INSTAGRAM_AUTH_RATE_LIMIT_COOLDOWN_MS: '10000',
    INSTAGRAM_AUTH_RATE_LIMIT_MAX_COOLDOWN_MS: '600000',
  },
  fetchImpl: async () => {
    circuitFetches += 1;
    throw new Error('fetch should not run while the circuit is open');
  },
});

assert.equal(circuitFetches, 0);
assert.equal(circuitOpen.status, 'rate-limited');
assert.equal(circuitOpen.circuitOpen, true);
assert.equal(circuitOpen.nextRetryAt, rateLimited.nextRetryAt, 'a circuit read must not extend its cooldown');

const loginWall = await validateInstagramAuth(cookies, {
  nowMs,
  env: { INSTAGRAM_AUTH_ATTEMPTS: '1' },
  fetchImpl: async () => new Response('<html>Log in to Instagram</html>', {
    status: 401,
    headers: { 'content-type': 'text/html' },
  }),
});

assert.equal(loginWall.status, 'login-wall');
assert.equal(loginWall.shouldRefreshCookies, true);
assert.equal(loginWall.credentialsState, 'invalid');

const bareForbidden = await validateInstagramAuth(cookies, {
  nowMs,
  env: { INSTAGRAM_AUTH_ATTEMPTS: '1' },
  fetchImpl: async () => new Response('<html>Access denied</html>', {
    status: 403,
    headers: { 'content-type': 'text/html' },
  }),
});
assert.equal(bareForbidden.status, 'blocked');
assert.equal(bareForbidden.credentialsState, 'unknown', 'a runner/WAF 403 is not proof that cookies are invalid');
assert.equal(bareForbidden.shouldRefreshCookies, false);

const challengeForbidden = await validateInstagramAuth(cookies, {
  nowMs,
  env: { INSTAGRAM_AUTH_ATTEMPTS: '1' },
  fetchImpl: async () => new Response('{"message":"challenge_required"}', {
    status: 403,
    headers: { 'content-type': 'application/json' },
  }),
});
assert.equal(challengeForbidden.status, 'blocked');
assert.equal(challengeForbidden.credentialsState, 'invalid');
assert.equal(challengeForbidden.shouldRefreshCookies, true);

const browserConfig = { INSTAGRAM_AUTH_METHOD: 'own-profile-ui', INSTAGRAM_USERNAME: 'fixture_user' };
const noLegacyEndpoint = async () => assert.fail('Browser mode must not call obsolete profile API');
let browserCalls = 0;
const validProfile = await validateInstagramAuth(cookies, {
  env: browserConfig, nowMs, fetchImpl: noLegacyEndpoint,
  browserProbe: async (input, account) => {
    browserCalls++;
    assert.deepEqual(input, cookies);
    assert.equal(account, 'fixture_user');
    return { ok: true, accountMatched: true };
  },
});
assert.equal(browserCalls, 1);
assert.equal(validProfile.ok, true);
assert.equal(validProfile.canProceed, true);
assert.equal(validProfile.shouldRefreshCookies, false);
assert.equal(validProfile.username, 'configured-account');

const pausedBrowser = await validateInstagramAuth(cookies, {
  env: browserConfig, nowMs: nowMs + 30_000, previousReport: rateLimited,
  fetchImpl: noLegacyEndpoint, browserProbe: async () => assert.fail('Do not bypass saved cooldown'),
});
assert.equal(pausedBrowser.canProceed, false);
assert.equal(pausedBrowser.nextRetryAt, rateLimited.nextRetryAt);
assert.equal(pausedBrowser.attempts, 0);

const newBrowserLimit = await validateInstagramAuth(cookies, {
  env: browserConfig, nowMs, fetchImpl: noLegacyEndpoint,
  browserProbe: async () => { throw Object.assign(new Error('private provider response'), { status: 'rate-limited' }); },
});
assert.equal(newBrowserLimit.status, 'rate-limited');
assert.equal(newBrowserLimit.canProceed, false);
assert.equal(newBrowserLimit.shouldRefreshCookies, false);
assert.equal(JSON.stringify(newBrowserLimit).includes('private provider'), false);

const unconfirmedProfile = await validateInstagramAuth(cookies, {
  env: browserConfig, nowMs, fetchImpl: noLegacyEndpoint,
  browserProbe: async () => ({ ok: true, accountMatched: false }),
});
assert.equal(unconfirmedProfile.ok, false);
assert.equal(unconfirmedProfile.canProceed, false);
assert.equal(unconfirmedProfile.credentialsState, 'unknown');
assert.equal(unconfirmedProfile.shouldRefreshCookies, false);

const missingProfileAccount = await validateInstagramAuth(cookies, {
  env: { INSTAGRAM_AUTH_METHOD: 'own-profile-ui' }, nowMs,
  browserProbe: async () => assert.fail('Missing account must stop before browser starts'),
});
assert.equal(missingProfileAccount.status, 'missing-account');
assert.equal(missingProfileAccount.attempts, 0);

console.log('instagram auth reliability tests passed, including own-profile validation and preserved cooldowns');

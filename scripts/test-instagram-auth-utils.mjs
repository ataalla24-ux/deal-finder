import assert from 'node:assert/strict';

import {
  instagramAuthCircuitStatus,
  instagramAuthSummary,
  instagramCookieHeader,
  instagramPlaywrightCookies,
  loadInstagramCookieHints,
  parseInstagramCookies,
} from '../scraper/instagram-auth-utils.js';

const parsed = parseInstagramCookies('csrftoken=csrf-1; ds_user_id=42; sessionid=old-session');
assert.deepEqual(parsed.map((cookie) => cookie.name), ['csrftoken', 'ds_user_id', 'sessionid']);

const loaded = loadInstagramCookieHints({
  INSTAGRAM_COOKIES: 'csrftoken=csrf-1; sessionid=old-session',
  INSTAGRAM_SESSIONID: 'fresh-session',
});
assert.equal(loaded.find((cookie) => cookie.name === 'sessionid')?.value, 'fresh-session');
assert.equal(instagramAuthSummary(loaded).authenticatedSession, true);
assert.match(instagramCookieHeader(loaded), /sessionid=fresh-session/);

const playwrightCookies = instagramPlaywrightCookies(loaded);
assert.equal(playwrightCookies.find((cookie) => cookie.name === 'sessionid')?.httpOnly, true);
assert.equal(playwrightCookies.every((cookie) => cookie.domain === '.instagram.com'), true);

const netscape = parseInstagramCookies('.instagram.com\tTRUE\t/\tTRUE\t0\tsessionid\tnetscape-session');
assert.equal(netscape[0]?.value, 'netscape-session');

const httpOnlyNetscape = parseInstagramCookies('#HttpOnly_.instagram.com\tTRUE\t/\tTRUE\t0\tsessionid\thttp-only-session');
assert.equal(httpOnlyNetscape[0]?.domain, '.instagram.com');
assert.equal(httpOnlyNetscape[0]?.value, 'http-only-session');

const apifyFallback = loadInstagramCookieHints({
  APIFY_INSTAGRAM_COOKIE_STRING: 'csrftoken=apify-csrf',
  APIFY_INSTAGRAM_SESSIONID: 'apify-session',
});
assert.equal(apifyFallback.find((cookie) => cookie.name === 'sessionid')?.value, 'apify-session');

const mergedCookieSources = loadInstagramCookieHints({
  APIFY_INSTAGRAM_COOKIE_STRING: 'csrftoken=apify-csrf; mid=apify-mid',
  INSTAGRAM_COOKIES: 'csrftoken=primary-csrf; ig_did=primary-device',
});
assert.equal(mergedCookieSources.find((cookie) => cookie.name === 'csrftoken')?.value, 'primary-csrf');
assert.ok(mergedCookieSources.some((cookie) => cookie.name === 'mid'));
assert.ok(mergedCookieSources.some((cookie) => cookie.name === 'ig_did'));

const authCooldown = instagramAuthCircuitStatus({
  status: 'rate-limited',
  nextRetryAt: '2026-09-04T18:00:00.000Z',
}, new Date('2026-09-04T17:00:00.000Z'));
assert.equal(authCooldown.allowed, false);
assert.equal(authCooldown.reason, 'auth-health-cooldown');
assert.equal(instagramAuthCircuitStatus({
  status: 'rate-limited',
  nextRetryAt: '2026-09-04T16:00:00.000Z',
}, new Date('2026-09-04T17:00:00.000Z')).allowed, true);

console.log('Instagram auth utility tests passed');

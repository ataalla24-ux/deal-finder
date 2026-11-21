import assert from 'node:assert/strict';
import { runInstagramSearchQueries } from '../scraper/instagram-search-discovery.js';
import { readPublicSearchResponse } from '../scraper/public-search-response.js';
import { sourceHttpError } from '../scraper/source-http-policy.js';

const now = new Date('2026-10-20T12:00:00Z');
const queries = ['food', 'coffee', 'pizza'];
const delays = [];
let calls = 0;
const first = await runInstagramSearchQueries(queries, {
  now, sleep: async ms => delays.push(ms),
  search: async () => {
    calls++;
    if (calls === 2) throw sourceHttpError(429, '172800', now);
    return [{ title: 'first candidate' }];
  },
});
assert.equal(calls, 2);
assert.equal(first.candidates.length, 1, 'preserve discoveries before throttle');
assert.equal(first.attemptedQueries, 2);
assert.equal(first.nextRetryAt, '2026-10-22T12:00:00.000Z');
assert.deepEqual(delays, [1000], 'no wait/retry after a block');
const never = async () => assert.fail('search/sleep must not run during cooldown');
const held = await runInstagramSearchQueries(queries, {
  now, search: never, sleep: never, previousReport: { lastUpdated: now.toISOString(), search: first },
});
assert.equal(held.attemptedQueries, 0);
assert.equal(held.stoppedReason, 'search-cooldown');
assert.equal(held.nextRetryAt, first.nextRetryAt);
const heldAgain = await runInstagramSearchQueries(queries, {
  now: new Date('2026-10-21T10:00:00Z'), search: never, sleep: never,
  previousReport: { lastUpdated: '2026-10-21T09:00:00Z', search: held },
});
assert.equal(heldAgain.nextRetryAt, first.nextRetryAt, 'a skipped run never extends the cooldown');
const resumed = await runInstagramSearchQueries(queries, {
  now: new Date('2026-10-22T12:00:00Z'), search: async () => [], sleep: async () => {},
  previousReport: { search: heldAgain },
});
assert.equal(resumed.attemptedQueries, 3);
assert.equal(resumed.nextRetryAt, '');
const legacy = await runInstagramSearchQueries(queries, {
  now, search: never, sleep: never,
  previousReport: { lastUpdated: '2026-10-20T11:00:00Z', search: { errors: [{ error: 'HTTP 403: blocked' }] } },
});
assert.equal(legacy.nextRetryAt, '2026-10-21T11:00:00.000Z');
for (const status of [401, 403, 429, 503]) {
  const stopped = await runInstagramSearchQueries(queries, {
    now, search: async () => { throw sourceHttpError(status, '86400', now); }, sleep: never,
  });
  assert.equal(stopped.attemptedQueries, 1);
  assert.equal(stopped.nextRetryAt, '2026-10-21T12:00:00.000Z');
}
const challenge = (time, headers) => readPublicSearchResponse(
  new Response('<div class="anomaly-modal"></div>', { headers }), time);
const local = await runInstagramSearchQueries(queries, {
  now, search: () => challenge(now), sleep: never,
});
assert.equal(local.attemptedQueries, 1);
assert.equal(local.nextRetryAt, '2026-10-20T16:00:00.000Z');
assert.equal(local.errors[0].retryAfterProvided, false);
assert.equal(local.boundedRetry.failures, 1);
const beforeRetry = await runInstagramSearchQueries(queries, {
  now: new Date('2026-10-20T15:59:59Z'), search: never, sleep: never, previousReport: { search: local },
});
assert.deepEqual(beforeRetry.boundedRetry, local.boundedRetry);
assert.equal(beforeRetry.nextRetryAt, local.nextRetryAt);
const after = new Date(local.nextRetryAt);
const repeated = await runInstagramSearchQueries(queries, {
  now: after, search: () => challenge(after), sleep: never, previousReport: { search: beforeRetry },
});
assert.equal(repeated.attemptedQueries, 1);
assert.equal(repeated.nextRetryAt, '2026-10-21T16:00:00.000Z');
assert.equal(repeated.boundedRetry.failures, 2);
for (const [header, deadline] of [
  ['172800', '2026-10-22T12:00:00.000Z'],
  ['120', '2026-10-21T12:00:00.000Z'],
  ['invalid', '2026-10-21T12:00:00.000Z'],
]) {
  const heldByProvider = await runInstagramSearchQueries(queries, {
    now, search: () => challenge(now, { 'Retry-After': header }), sleep: never,
  });
  assert.equal(heldByProvider.errors[0].retryAfterProvided, true);
  assert.equal(heldByProvider.nextRetryAt, deadline);
}
const oldChallenge = {
  lastAttemptAt: now.toISOString(), nextRetryAt: '2026-10-21T12:00:00.000Z',
  errors: [{ error: 'Search challenge; no bypass attempted', httpStatus: 403, retryAt: '' }],
  stoppedReason: 'search-unavailable',
};
const repairedLegacy = await runInstagramSearchQueries(queries, {
  now: after, search: () => challenge(after), sleep: never, previousReport: { search: oldChallenge },
});
assert.equal(repairedLegacy.attemptedQueries, 1);
assert.equal(repairedLegacy.nextRetryAt, '2026-10-21T16:00:00.000Z');
for (const search of [
  { ...oldChallenge, errors: [] },
  { ...oldChallenge, errors: [{ ...oldChallenge.errors[0], retryAt: undefined }] },
  { ...oldChallenge, errors: [{ ...oldChallenge.errors[0], retryAfterProvided: true }] },
]) {
  const ambiguous = await runInstagramSearchQueries(queries, {
    now: after, search: never, sleep: never, previousReport: { search },
  });
  assert.equal(ambiguous.nextRetryAt, '2026-10-21T12:00:00.000Z');
}
const recovered = await runInstagramSearchQueries(['food'], {
  now: new Date(repeated.nextRetryAt), search: async () => [], sleep: never, previousReport: { search: repeated },
});
assert.equal(recovered.boundedRetry, undefined);

console.log('instagram search discovery tests passed');

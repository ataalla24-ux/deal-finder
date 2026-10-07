import assert from 'node:assert/strict';
import { runAdLibraryAccessCheck } from './check-meta-ad-library.mjs';

const now = new Date('2026-10-07T17:00:00Z');
const env = { META_AD_LIBRARY_ACCESS_TOKEN: 'private-test-token' };
const run = (fetchImpl, configEnv = env) => runAdLibraryAccessCheck({ env: configEnv, now, write: false, fetchImpl });
const missing = await run(async () => assert.fail('no token must not make a request'), {});
assert.equal(missing.report.status, 'not-configured');
let calls = 0;
const available = await run(async (url) => {
  calls += 1;
  const query = new URL(url).searchParams;
  assert.equal(query.get('ad_type'), 'ALL');
  assert.equal(query.get('ad_active_status'), 'ACTIVE');
  assert.equal(query.get('ad_reached_countries'), '["AT"]');
  assert.equal(query.get('publisher_platforms'), '["INSTAGRAM"]');
  return Response.json({ data: [{ id: 'ad-1', ad_creative_bodies: ['private creative content'] }], paging: { next: 'https://graph.facebook.com/v26.0/ads_archive?after=more' } });
});
assert.equal(calls, 1, 'diagnostic must not follow pagination or scan organic Instagram');
assert.equal(available.ok, true);
assert.equal(available.report.fetched, 1);
assert.doesNotMatch(JSON.stringify(available.report), /private-test-token|private creative content/);
assert.equal((await run(async () => Response.json({ data: [] }))).ok, true, 'empty valid results still verify API access');
for (const [code, status, expected] of [[10, 400, 'missing-permission'], [190, 400, 'invalid-token'], [613, 400, 'quota-deferred'], [100, 400, 'api-error']]) {
  const failure = await run(async () => Response.json({ error: { code, message: 'Denied private-test-token' } }, { status }));
  assert.equal(failure.report.status, expected);
  assert.equal(failure.ok, false);
  assert.doesNotMatch(JSON.stringify(failure.report), /private-test-token/);
}
const deferred = await run(async () => { throw Object.assign(new Error('shared quota'), { code: 'SCAN_BUDGET' }); });
assert.equal(deferred.report.status, 'quota-deferred');
assert.equal(deferred.ok, false);
console.log('Ad Library diagnostic: one bounded read-only request, token redaction, empty success and permission/token/quota/error distinctions passed');

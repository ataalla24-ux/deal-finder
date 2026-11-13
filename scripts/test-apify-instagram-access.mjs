import test from 'node:test';
import assert from 'node:assert/strict';
import { checkApifyInstagramAccess } from './check-apify-instagram-access.mjs';

const env = { APIFY_TOKEN: 'private-fixture', APIFY_INSTAGRAM_VIENNA_ACTOR_ID: 'owner~actor', APIFY_2: 'never-use' };
test('access check only reads account and configured Actor; no scan, budget or credential output', async () => {
  const urls = [];
  const report = await checkApifyInstagramAccess(env, async (url, options) => {
    urls.push(url);
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer private-fixture');
    assert(options.signal);
    assert.equal(options.body, undefined);
    return Response.json({ data: { id: 'private-id', email: 'private@example.test' } });
  });
  assert.deepEqual(urls, ['https://api.apify.com/v2/users/me', 'https://api.apify.com/v2/acts/owner~actor']);
  assert.equal(report.status, 'access-verified');
  assert.equal(report.requests, 2);
  assert.equal(report.actorRunsStarted, 0);
  assert.equal(report.collectionRecoveryVerified, false);
  assert.doesNotMatch(JSON.stringify(report), /private-fixture|never-use|private-id|private@example/);
});
test('401, 403, 404, 429 and 5xx stop without retry, second account or raw body', async () => {
  for (const [status, expected] of [[401, 'authentication-invalid'], [403, 'access-denied'], [404, 'resource-not-found'],
    [429, 'rate-limited'], [503, 'provider-unavailable']]) {
    let calls = 0;
    const report = await checkApifyInstagramAccess(env, async () => {
      calls += 1;
      return Response.json({ error: { message: 'private-fixture' } }, { status });
    });
    assert.equal(report.status, expected);
    assert.equal(report.actorRunsStarted, 0);
    assert.equal(calls, 1);
    assert.doesNotMatch(JSON.stringify(report), /private-fixture/);
  }
});
test('actor access is distinct from account authentication', async () => {
  let calls = 0;
  const report = await checkApifyInstagramAccess(env, async () => ++calls === 1
    ? Response.json({ data: { id: 'account' } }) : Response.json({}, { status: 403 }));
  assert.equal(report.authenticated, true);
  assert.equal(report.actorAccessible, false);
  assert.equal(report.step, 'actor');
});
test('missing legacy key never falls back to APIFY_2; transport and malformed data fail closed', async () => {
  assert.equal((await checkApifyInstagramAccess({ APIFY_2: 'never-use' }, async () => assert.fail('no request'))).status, 'configuration-missing');
  assert.equal((await checkApifyInstagramAccess(env, async () => { throw new Error('private-fixture'); })).status, 'transport-unavailable');
  assert.equal((await checkApifyInstagramAccess(env, async () => Response.json({}))).status, 'unverified-response');
});

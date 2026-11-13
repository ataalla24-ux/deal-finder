import test from 'node:test';
import assert from 'node:assert/strict';
import { checkApifyInstagramAccess } from './check-apify-instagram-access.mjs';

const env = { APIFY_TOKEN: 'private-fixture', APIFY_INSTAGRAM_VIENNA_ACTOR_ID: 'owner~actor', APIFY_2: 'never-use' };
const actor = { id: 'private-id', username: 'owner', name: 'actor', email: 'private@example.test' };
test('scoped access check only reads configured Actor and one run metadata row, never account data', async () => {
  const urls = [];
  const report = await checkApifyInstagramAccess(env, async (url, options) => {
    urls.push(url);
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer private-fixture');
    assert(options.signal);
    assert.equal(options.body, undefined);
    assert.doesNotMatch(url, /users\/me/);
    return Response.json({ data: urls.length === 1 ? actor : { items: [{ id: 'private-run', actId: actor.id }] } });
  });
  assert.deepEqual(urls, ['https://api.apify.com/v2/acts/owner~actor', 'https://api.apify.com/v2/acts/owner~actor/runs?limit=1&desc=1']);
  assert.equal(report.status, 'access-verified');
  assert.equal(report.authenticated, true);
  assert.equal(report.runListAccessible, true);
  assert.equal(report.requests, 2);
  assert.equal(report.actorRunsStarted, 0);
  assert.equal(report.collectionRecoveryVerified, false);
  assert.equal(report.runPermissionVerified, false);
  assert.doesNotMatch(JSON.stringify(report), /private-fixture|never-use|private-id|private-run|private@example/);
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
test('public Actor metadata alone is not authenticated run access', async () => {
  let calls = 0;
  const report = await checkApifyInstagramAccess(env, async () => ++calls === 1
    ? Response.json({ data: actor }) : Response.json({}, { status: 403 }));
  assert.equal(report.authenticated, false);
  assert.equal(report.actorAccessible, true);
  assert.equal(report.runListAccessible, false);
  assert.equal(report.step, 'runs');
});
test('missing legacy key never falls back to APIFY_2; transport and malformed data fail closed', async () => {
  assert.equal((await checkApifyInstagramAccess({ APIFY_2: 'never-use' }, async () => assert.fail('no request'))).status, 'configuration-missing');
  assert.equal((await checkApifyInstagramAccess(env, async () => { throw new Error('private-fixture'); })).status, 'transport-unavailable');
  assert.equal((await checkApifyInstagramAccess(env, async () => Response.json({}))).status, 'unverified-response');
});
test('configured ID and empty run history are valid; mismatched Actor and run rows fail closed', async () => {
  let calls = 0;
  const report = await checkApifyInstagramAccess({ ...env, APIFY_INSTAGRAM_VIENNA_ACTOR_ID: actor.id }, async () =>
    Response.json({ data: ++calls === 1 ? actor : { items: [] } }));
  assert.equal(report.status, 'access-verified');
  for (const data of [{ ...actor, name: 'different' }, { ...actor, id: '' }]) {
    let requests = 0;
    const result = await checkApifyInstagramAccess(env, async () => { requests++; return Response.json({ data }); });
    assert.equal(result.status, 'unverified-response');
    assert.equal(requests, 1);
  }
  for (const data of [{}, { items: [{}] }, { items: [{ id: 'private-run', actId: 'wrong-actor' }] }]) {
    let requests = 0;
    const result = await checkApifyInstagramAccess(env, async () => Response.json({ data: ++requests === 1 ? actor : data }));
    assert.equal(result.status, 'unverified-response');
    assert.equal(result.authenticated, false);
    assert.equal(requests, 2);
  }
});

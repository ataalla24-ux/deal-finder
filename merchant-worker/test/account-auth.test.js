import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generateKeyPair, SignJWT } from 'jose';
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from 'miniflare';
import { accountID, authenticateAccount, boundedJSON, handleAccount } from '../src/account-auth.js';
import { ReferralMonthsLedger, handleReferralMonths } from '../src/referral-months.js';
import { bundledAuth } from './bundled-auth.js';

const { publicKey, privateKey } = await generateKeyPair('RS256');
const env = { ACCOUNTS_ENABLED: '1', FIREBASE_PROJECT_ID: 'fixture-project', FIREBASE_WEB_API_KEY: 'fixture-only' };
const now = Math.floor(Date.now() / 1000);
const valid = { sub: 'test-uid', iss: 'https://securetoken.google.com/fixture-project', aud: 'fixture-project',
  iat: now, exp: now + 3600, auth_time: now, email: 'owner@example.test', email_verified: true,
  firebase: { sign_in_provider: 'password' } };
const verifiedUser = { localId: 'test-uid', email: valid.email, emailVerified: true,
  providerUserInfo: [{ providerId: 'password' }], validSince: String(now - 1) };
const token = async (claims = valid) => new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).sign(privateKey);
const request = async claims => new Request('https://test/api/account/profile', { headers: { authorization: 'Bearer ' + await token(claims) } });
const options = user => ({ keyResolver: publicKey, transport: async () => Response.json({ users: [user ?? verifiedUser] }) });

test('only signed, project-bound, confirmed accounts produce a stable cross-platform identity', async () => {
  const principal = await authenticateAccount(await request(), env, options());
  assert.equal(principal.id, await accountID('test-uid'));
  assert.match(principal.id, /^[a-f0-9]{8}-[a-f0-9]{4}-8[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.notEqual(principal.id, await accountID('other-uid'));
  assert.equal(principal.email, valid.email);
  assert.deepEqual(principal.providers, ['password']);
  for (const provider of ['apple.com', 'google.com']) {
    const social = { ...valid, firebase: { sign_in_provider: provider } };
    assert.equal((await authenticateAccount(await request(social), env, options())).id, principal.id);
  }
});
test('rejects wrong project, issuer, expiry, timestamps, provider and malformed signatures', async () => {
  for (const patch of [{ aud: 'other-project' }, { iss: 'https://example.test' }, { exp: now - 60 },
    { auth_time: now + 600 }, { auth_time: 0 }, { auth_time: '123' }, { iat: now + 600 },
    { firebase: { sign_in_provider: 'anonymous' } }, { sub: '' }, { sub: 'x'.repeat(129) }]) {
    await assert.rejects(authenticateAccount(await request({ ...valid, ...patch }), env, options()), { status: 401 });
  }
  const other = await generateKeyPair('RS256');
  const forged = await new SignJWT(valid).setProtectedHeader({ alg: 'RS256' }).sign(other.privateKey);
  await assert.rejects(authenticateAccount(new Request('https://test', { headers: { authorization: 'Bearer ' + forged } }), env, options()), { status: 401 });
  await assert.rejects(authenticateAccount(new Request('https://test'), env, options()), { status: 401 });
  await assert.rejects(authenticateAccount(await request(), { ...env, ACCOUNTS_ENABLED: '0' }, options()), { status: 503 });
});
test('disabled, deleted, revoked and unverified Firebase users cannot access reward records', async () => {
  for (const patch of [{ disabled: true }, { localId: 'another-user' }, { validSince: String(now + 1) }]) {
    await assert.rejects(authenticateAccount(await request(), env, options({ ...verifiedUser, ...patch })), { status: 401 });
  }
  await assert.rejects(authenticateAccount(await request(), env, {
    keyResolver: publicKey, transport: async () => Response.json({ users: [] }),
  }), { status: 401 });
  for (const patch of [{ emailVerified: false }, { emailVerified: 'false' }, { email: 'changed@example.test' }, { email: undefined }]) {
    await assert.rejects(authenticateAccount(await request(), env, options({ ...verifiedUser, ...patch })), { status: 403 });
  }
  await assert.rejects(authenticateAccount(await request({ ...valid, email_verified: false }), env, options()), { status: 403 });
  await assert.rejects(authenticateAccount(await request({ ...valid, auth_time: now - 301 }), env, { ...options(), recent: true }), { status: 409 });
});
test('Firebase outage fails closed without exposing the token or upstream error', async () => {
  await assert.rejects(authenticateAccount(await request(), env, { keyResolver: publicKey, transport: async () => { throw Error('private response'); } }), { status: 503 });
  await assert.rejects(authenticateAccount(await request(), env, { keyResolver: publicKey, transport: async () => new Response('', { status: 500 }) }), { status: 503 });
});
test('unverified privacy access is UID-bound and always requires recent authentication', async () => {
  const privacy = { ...options({ ...verifiedUser, emailVerified: false }), requireVerifiedEmail: false };
  const claims = { ...valid, email_verified: false };
  assert.deepEqual(await authenticateAccount(await request(claims), env, privacy), {
    id: await accountID(valid.sub), authTime: now,
  });
  for (const patch of [{ email: undefined }, { email: 'changed@example.test' }]) {
    assert.equal((await authenticateAccount(await request(claims), env, {
      ...privacy, ...options({ ...verifiedUser, emailVerified: false, ...patch }),
    })).id, await accountID(valid.sub));
  }
  await assert.rejects(authenticateAccount(await request({ ...claims, auth_time: now - 301 }), env, privacy), { status: 409 });
  for (const patch of [{ localId: 'victim' }, { disabled: true }, { validSince: String(now + 1) }]) {
    await assert.rejects(authenticateAccount(await request(claims), env, {
      ...privacy, ...options({ ...verifiedUser, ...patch }),
    }), { status: 401 });
  }
  await assert.rejects(authenticateAccount(await request(claims), env, {
    ...privacy, transport: async () => Response.json({ users: [] }),
  }), { status: 401 });
});
test('bounded request parser rejects arrays, wrong types, malformed JSON and oversized streams', async () => {
  const req = (body, type = 'application/json') => new Request('https://test', { method: 'POST', headers: { 'content-type': type }, body });
  for (const body of ['null', '[]', '12', '{']) await assert.rejects(boundedJSON(req(body)), { status: 400 });
  await assert.rejects(boundedJSON(req('{}', 'text/plain')), { status: 415 });
  await assert.rejects(boundedJSON(req(JSON.stringify({ value: 'x'.repeat(16000) }))), { status: 413 });
  assert.deepEqual(await boundedJSON(req('{"preferences":{}}')), { preferences: {} });
});
test('account router ignores forged principal/account/IP and requires recent export/delete sign-in', async () => {
  let forwarded, authOptions;
  const owner = await accountID('owner');
  const bindings = { REFERRAL_MONTHS: { idFromName: x => x, get: () => ({ fetch: async req => {
    forwarded = await req.json(); return Response.json({ ok: true });
  } }) } };
  for (const action of ['profile', 'preferences', 'export', 'delete']) {
    const response = await handleAccount(new Request('https://test/api/account/' + action, { method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.1' },
      body: JSON.stringify({ accountId: 'victim', principal: { id: 'victim' }, trustedIP: 'forged' }) }), bindings,
    async (_req, _env, opts) => { authOptions = opts; return { id: owner, email: valid.email }; });
    assert.equal(response.status, 200); assert.equal(forwarded.accountId, owner);
    assert.equal(forwarded.principal.id, owner); assert.notEqual(forwarded.trustedIP, '192.0.2.1');
    assert.notEqual(forwarded.trustedIP, 'forged');
    assert.deepEqual(authOptions, { recent: ['export', 'delete'].includes(action), requireVerifiedEmail: !['export', 'delete'].includes(action) });
  }
});
test('referral router cannot dispatch account or unknown actions', async () => {
  for (const action of ['account-profile', 'account-export', 'account-delete', 'unknown']) {
    const response = await handleReferralMonths(new Request('https://test/api/referral-months/' + action, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ platform: 'ios' }),
    }), { REFERRAL_MONTHS: { idFromName: () => assert.fail('must not reach ledger') } },
    async () => assert.fail('must not authenticate an unsupported action'));
    assert.equal(response.status, 404);
  }
});

function ledger(emailEnabled = '0') {
  const data = new Map();
  const storage = { get: async key => structuredClone(data.get(key)), put: async (key, value) => {
    if (typeof key === 'string') data.set(key, structuredClone(value));
    else for (const [k, v] of Object.entries(key)) data.set(k, structuredClone(v));
  }, delete: async key => data.delete(key), getAlarm: async () => 1, setAlarm: async () => {},
  transaction: async fn => {
    const before = structuredClone(data);
    try { return await fn(storage); }
    catch (error) { data.clear(); for (const [k, v] of before) data.set(k, v); throw error; }
  } };
  const service = new ReferralMonthsLedger({ storage }, { ACCOUNT_EMAIL_ENABLED: emailEnabled, REFERRAL_MONTHS_ENABLED: '1' });
  return { service, data };
}
const principal = { id: await accountID('test-uid'), email: valid.email, providers: ['password'], authTime: now };
const body = { principal, accountId: principal.id, trustedIP: 'hashed-test-ip' };
test('verified profile survives a new client, no implicit marketing consent and no local-ID takeover', async () => {
  const { service } = ledger();
  const a = await service.perform('account-profile', body);
  assert.deepEqual(a.preferences, { rewardEmails: false, dealEmails: false, weeklyEmails: false });
  assert.equal(a.emailDelivery, false);
  assert.deepEqual(await service.perform('account-profile', structuredClone(body)), a);
  await assert.rejects(service.perform('account-profile', { ...body, accountId: await accountID('victim') }), { status: 401 });
  await assert.rejects(service.perform('account-preferences', { ...body, consentVersion: 1, preferences: { dealEmails: true } }), { status: 409 });
});
test('consents are explicit, independently reversible and reset on verified address change', async () => {
  const { service } = ledger('1');
  await service.perform('account-profile', body);
  const consent = preferences => service.perform('account-preferences', { ...body, consentVersion: 1, preferences });
  assert.equal((await consent({ weeklyEmails: true })).preferences.weeklyEmails, true);
  assert.equal((await consent({ rewardEmails: true })).preferences.dealEmails, false);
  assert.equal((await consent({ weeklyEmails: false })).preferences.weeklyEmails, false);
  for (const preferences of [{ spam: true }, { dealEmails: 'true' }, null]) {
    await assert.rejects(consent(preferences), { status: 400 });
  }
  const changed = await service.perform('account-profile', { ...body, principal: { ...principal, email: 'new@example.test' } });
  assert.deepEqual(changed.preferences, { rewardEmails: false, dealEmails: false, weeklyEmails: false });
});
test('delete removes contact data/code but keeps purchase dedupe; repeated delete is safe', async () => {
  const { service, data } = ledger();
  const profile = await service.perform('account-profile', body);
  data.set('purchase:fixture', principal.id);
  const stale = { ...body, principal: { ...principal, authTime: now - 1000 } };
  await assert.rejects(service.perform('account-delete', stale), { status: 409 });
  await assert.rejects(service.perform('account-export', stale), { status: 409 });
  const exported = await service.perform('account-export', body);
  assert.equal(exported.account.email, valid.email);
  await service.perform('account-delete', body);
  assert.equal(data.has('code:' + profile.referral.code), false);
  assert.equal(data.get('account:' + principal.id).email, undefined);
  assert.equal(data.get('purchase:fixture'), principal.id);
  assert.deepEqual(await service.perform('account-delete', body), { ok: true });
  await assert.rejects(service.perform('account-profile', body), { status: 410 });
});
test('privacy actions do not create profiles, issue codes or update verified contact/consents', async () => {
  const { service, data } = ledger('1');
  const privacy = { ...body, principal: { id: principal.id, authTime: now } };
  assert.deepEqual(await service.perform('account-export', privacy), { ok: true, account: null });
  assert.equal(data.has('account:' + principal.id), false);
  assert.equal([...data.keys()].some(key => key.startsWith('code:')), false);
  await service.perform('account-profile', body);
  await service.perform('account-preferences', { ...body, preferences: { weeklyEmails: true }, consentVersion: 1 });
  const before = structuredClone(data.get('account:' + principal.id));
  const exported = await service.perform('account-export', { ...privacy, principal: { ...privacy.principal, email: 'unverified@example.test' } });
  assert.equal(exported.account.email, valid.email);
  assert.equal(exported.account.preferences.weeklyEmails, true);
  assert.deepEqual(data.get('account:' + principal.id), before);
  await service.perform('account-delete', privacy);
  assert.deepEqual(Object.keys(data.get('account:' + principal.id)).sort(), ['deletedAt', 'id', 'recoverable']);
  assert.equal(data.has('code:' + before.code), false);
});
test('privacy-only principals cannot create profiles or access rewards', async () => {
  const { service, data } = ledger();
  const privacy = { ...body, principal: { id: principal.id, authTime: now } };
  for (const action of ['account-profile', 'account-preferences', 'register', 'status', 'accept', 'confirm', 'redeem', 'confirm-redemption']) {
    await assert.rejects(service.perform(action, privacy), { status: 403 });
  }
  assert.equal(data.has('account:' + principal.id), false);
});
test('invalid recent auth cannot mutate profiles, export records or bypass a deletion tombstone', async () => {
  const { service, data } = ledger();
  await service.perform('account-profile', body);
  const before = structuredClone(data.get('account:' + principal.id));
  for (const authTime of [undefined, '123', 0, -1, NaN, Infinity, now + 600, now - 301]) {
    for (const action of ['account-delete', 'account-export']) {
      const stale = { ...body, principal: { ...principal, authTime, email: 'changed@example.test' } };
      await assert.rejects(service.perform(action, stale), { status: 409 });
      assert.deepEqual(data.get('account:' + principal.id), before);
      assert.equal(data.get('code:' + before.code), principal.id);
    }
  }
  await service.perform('account-delete', body);
  const tombstone = structuredClone(data.get('account:' + principal.id));
  for (const action of ['account-delete', 'account-export']) {
    await assert.rejects(service.perform(action, { ...body, principal: { ...principal, authTime: now - 301 } }), { status: 409 });
  }
  assert.deepEqual(await service.perform('account-delete', body), { ok: true });
  assert.deepEqual(data.get('account:' + principal.id), tombstone);
  await assert.rejects(service.perform('account-export', body), { status: 410 });
});
test('deleting a never-verified account stores only a tombstone; legacy records remain migration-gated', async () => {
  const { service, data } = ledger();
  const privacy = { ...body, principal: { id: principal.id, authTime: now } };
  await service.perform('account-delete', privacy);
  assert.equal([...data.keys()].some(key => key.startsWith('code:')), false);
  assert.deepEqual(Object.keys(data.get('account:' + principal.id)).sort(), ['deletedAt', 'id', 'recoverable']);
  const legacy = { id: principal.id, rewards: [{ months: 1 }], code: 'legacy-code' };
  data.set('account:' + principal.id, legacy);
  for (const action of ['account-profile', 'account-delete', 'account-export']) {
    await assert.rejects(service.perform(action, body), { status: 409 });
    assert.deepEqual(data.get('account:' + principal.id), legacy);
  }
});
test('tombstone and invite-code removal roll back together if storage fails', async () => {
  const { service, data } = ledger();
  const profile = await service.perform('account-profile', body);
  const key = 'account:' + principal.id;
  const before = structuredClone(data.get(key));
  const originalPut = service.storage.put;
  service.storage.put = async (key, value) => {
    if (value?.deletedAt) throw Error('fixture write failure');
    return originalPut(key, value);
  };
  await assert.rejects(service.perform('account-delete', body), /fixture write failure/);
  assert.deepEqual(data.get(key), before);
  assert.equal(data.get('code:' + profile.referral.code), principal.id);
  service.storage.put = originalPut;
  await service.perform('account-delete', body);
  assert.ok(data.get(key).deletedAt);
  assert.equal(data.has('code:' + profile.referral.code), false);
});
test('unknown account actions do not create or mutate a profile', async () => {
  const { service, data } = ledger();
  await assert.rejects(service.perform('account-typo', body), { status: 404 });
  assert.equal(data.has('account:' + principal.id), false);
});
test('signed unverified owners can only export/delete their own data through the public router', async () => {
  const { service, data } = ledger();
  const bindings = { ...env, REFERRAL_MONTHS: { idFromName: x => x, get: () => ({ fetch: async req => {
    return Response.json(await service.perform(new URL(req.url).pathname.slice(1), await req.json()));
  } }) } };
  const claims = { ...valid, email_verified: false };
  const unverified = { ...verifiedUser, emailVerified: false };
  const authenticate = (req, env, opts) => authenticateAccount(req, env, { ...opts, ...options(unverified) });
  const victim = await accountID('victim');
  const victimProfile = { id: victim, email: valid.email, recoverable: true };
  data.set('account:' + victim, victimProfile);
  const call = async (action, jwtClaims = claims, referral = false) => {
    const req = new Request('https://test/api/' + (referral ? 'referral-months/' : 'account/') + action, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + await token(jwtClaims) },
      body: JSON.stringify({ accountId: victim, principal: { id: victim, email: valid.email },
        requireVerifiedEmail: false, recent: false, authTime: now, platform: 'ios' }),
    });
    return (referral ? handleReferralMonths : handleAccount)(req, bindings, authenticate);
  };
  for (const action of ['profile', 'preferences']) assert.equal((await call(action)).status, 403);
  for (const action of ['register', 'status', 'accept', 'confirm', 'redeem', 'confirm-redemption']) {
    assert.equal((await call(action, claims, true)).status, 403);
  }
  for (const action of ['export', 'delete']) {
    assert.equal((await call(action, { ...claims, auth_time: now - 301 })).status, 409);
  }
  assert.deepEqual(await (await call('export')).json(), { ok: true, account: null });
  assert.equal(data.has('account:' + principal.id), false);
  assert.deepEqual(await (await call('delete')).json(), { ok: true });
  assert.deepEqual(await (await call('delete')).json(), { ok: true });
  assert.ok(data.get('account:' + principal.id).deletedAt);
  assert.deepEqual(data.get('account:' + victim), victimProfile);
});
test('SQLite ledger serializes deletion against profiles and in-flight reward confirmation without resurrection', async t => {
  const source = await readFile(new URL('../src/referral-months.js', import.meta.url), 'utf8');
  const mf = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-03-09',
    modules: [{ type: 'ESModule', path: 'test.js', contents: `
      import { ReferralMonthsLedger } from './ledger.js';
      export class TestLedger extends ReferralMonthsLedger {
        async verifyPurchase(body, account) {
          await new Promise(resolve => setTimeout(resolve, 25));
          const now = Date.now();
          return {key:'fixture:' + account.id, trial:true, started:now, expires:now + 30 * 86400000};
        }
        async fetch(request) {
          if (new URL(request.url).pathname === '/snapshot') {
            return Response.json(Object.fromEntries(await this.storage.list()));
          }
          return super.fetch(request);
        }
      }
      export default { fetch(request, env) {
        return env.REFERRAL_MONTHS.get(env.REFERRAL_MONTHS.idFromName('fixture')).fetch(request);
      } };
    ` }, { type: 'ESModule', path: 'ledger.js', contents: source }, await bundledAuth('account-auth.js')],
    durableObjects: { REFERRAL_MONTHS: { className: 'TestLedger', useSQLite: true } },
    bindings: { REFERRAL_MONTHS_ENABLED: '1' }, log: new Log(LogLevel.NONE),
    outboundService: () => { throw Error('Network forbidden in account fixtures'); },
  }));
  t.after(() => mf.dispose());
  const call = async (action, payload, expected) => {
    const response = await mf.dispatchFetch('https://test/' + action, { method: 'POST', body: JSON.stringify(payload) });
    const value = await response.json();
    if (expected !== undefined) assert.equal(response.status, expected, JSON.stringify(value));
    return { status: response.status, value };
  };
  for (const deleteFirst of [false, true]) {
    const id = await accountID('inviter-' + deleteFirst), friendID = await accountID('friend-' + deleteFirst);
    const owner = { ...body, accountId: id, principal: { ...principal, id }, trustedIP: id };
    const friend = { ...body, accountId: friendID, principal: { ...principal, id: friendID }, trustedIP: friendID };
    const profile = await call('account-profile', owner, 200);
    await call('register', friend, 200);
    await call('accept', { ...friend, code: profile.value.referral.code }, 200);
    const actions = ['confirm', 'account-delete', 'account-profile'];
    if (deleteFirst) actions.reverse();
    const replies = await Promise.all(actions.map(action => call(action, action === 'confirm' ? friend : owner)));
    for (let i = 0; i < actions.length; i++) {
      assert.ok((actions[i] === 'confirm' ? [200, 409] : actions[i] === 'account-profile' ? [200, 410] : [200]).includes(replies[i].status));
    }
    for (const action of ['account-profile', 'account-preferences', 'register', 'status', 'redeem']) {
      await call(action, owner, 410);
    }
    await call('account-delete', owner, 200);
    await call('account-export', owner, 410);
    const snapshot = await (await mf.dispatchFetch('https://test/snapshot')).json();
    assert.deepEqual(Object.keys(snapshot['account:' + id]).sort(), ['deletedAt', 'id', 'recoverable']);
    assert.equal(snapshot['code:' + profile.value.referral.code], undefined);
    if (snapshot['account:' + friendID].confirmedAt) {
      assert.ok(Object.entries(snapshot).some(([key, value]) => key.startsWith('purchase:') && value === friendID));
    }
  }
});

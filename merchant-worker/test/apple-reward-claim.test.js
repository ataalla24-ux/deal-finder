import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign, X509Certificate } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import cbor from 'cbor';
import { verifyAttestation } from 'node-app-attest';
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from 'miniflare';
import { workerBundleOptions } from './bundled-apple-claims.js';
import { appleClaimPayload, verifyAppleDeviceAssertion, verifyAppleDeviceKey } from '../src/apple-reward-claim.js';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const rewardId = '33333333-3333-4333-8333-333333333333';
const keyId = Buffer.alloc(32, 7).toString('base64');
const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' });
const privateKey = pair.privateKey;
const sha = bytes => createHash('sha256').update(bytes).digest();
function assertion(payload, counter = 1, team = '78C2SA4JP3.com.stefanataalla.freefinderwien') {
  const auth = Buffer.alloc(37); sha(team).copy(auth); auth.writeUInt32BE(counter, 33);
  const nonce = sha(Buffer.concat([auth, sha(payload)]));
  return cbor.encode({ authenticatorData: auth, signature: sign('sha256', nonce, privateKey) }).toString('base64');
}
test('real ECDSA assertion verifies account/reward/transaction/challenge, app identity and monotonic count', () => {
  const fields = { purpose: 'claim', accountId: owner, keyId, rewardId, transactionId: '100000001', nonce: crypto.randomUUID() };
  const payload = appleClaimPayload(fields);
  const body = { assertion: assertion(payload) };
  assert.equal(verifyAppleDeviceAssertion(body, payload, { publicKey, signCount: 0 }), 1);
  for (const field of ['purpose', 'accountId', 'keyId', 'rewardId', 'transactionId', 'nonce']) {
    assert.throws(() => verifyAppleDeviceAssertion(body, appleClaimPayload({ ...fields, [field]: 'changed' }), { publicKey, signCount: 0 }));
  }
  for (const signCount of [1, 2, -1, NaN, undefined]) assert.throws(() => verifyAppleDeviceAssertion(body, payload, { publicKey, signCount }));
  assert.throws(() => verifyAppleDeviceAssertion({ assertion: assertion(payload, 2, 'OTHER.app') }, payload, { publicKey, signCount: 0 }));
  for (const value of ['', 'AAAA', body.assertion + 'AAAA', '!'.repeat(5), 'A'.repeat(2004)]) {
    assert.throws(() => verifyAppleDeviceAssertion({ assertion: value }, payload, { publicKey, signCount: 0 }));
  }
  assert.throws(() => verifyAppleDeviceAssertion({ assertion: cbor.encode({ authenticatorData: Buffer.alloc(38), signature: Buffer.alloc(70) }).toString('base64') }, payload, { publicKey, signCount: 0 }));
});
test('attestation wrapper rejects malformed, development and foreign-app attestations', async () => {
  for (const value of ['', 'AAAA', 'A'.repeat(12004)]) assert.throws(() => verifyAppleDeviceKey({ keyId, attestation: value }, 'nonce'));
  // Published package vectors contain no FreeFinder secrets and cannot attest this app.
  for (const name of ['development', 'production']) {
    const fixture = JSON.parse(await readFile(new URL(`../node_modules/node-app-attest/test/fixtures/attestation-${name}.json`, import.meta.url)));
    const params = { attestation: Buffer.from(fixture.attestation, 'base64'), challenge: Buffer.from(fixture.challenge, 'base64'),
      keyId: fixture.keyId, bundleIdentifier: 'io.uebelacker.AppAttestExample', teamIdentifier: 'V8H6LQ9448',
      allowDevelopmentEnvironment: name === 'development' };
    assert.equal(verifyAttestation(params).environment, name);
    if (name === 'development') assert.throws(() => verifyAttestation({ ...params, allowDevelopmentEnvironment: false }));
    assert.throws(() => verifyAppleDeviceKey({ keyId: fixture.keyId, attestation: fixture.attestation }, params.challenge));
  }
});

test('complete attestation wrapper verifies published Apple certificate vector inside actual Workers runtime', async t => {
  const fixture = JSON.parse(await readFile(new URL('../node_modules/node-app-attest/test/fixtures/attestation-production.json', import.meta.url)));
  const certs = cbor.decodeFirstSync(Buffer.from(fixture.attestation, 'base64')).attStmt.x5c.map(raw => new X509Certificate(raw));
  const now = Math.max(...certs.map(cert => Date.parse(cert.validFrom))) + 1000;
  assert.ok(certs.every(cert => now < Date.parse(cert.validTo)));
  const original = await readFile(new URL('../src/apple-reward-claim.js', import.meta.url), 'utf8');
  // Only the app identity is replaced to match Apple's signed public package vector; crypto and envelope checks stay actual.
  assert.ok(original.includes("const APP = 'com.stefanataalla.freefinderwien';") && original.includes("const TEAM = '78C2SA4JP3';"));
  const vectorSource = original.replace("const APP = 'com.stefanataalla.freefinderwien';", "const APP = 'io.uebelacker.AppAttestExample';")
    .replace("const TEAM = '78C2SA4JP3';", "const TEAM = 'V8H6LQ9448';");
  const bundled = await build({ ...workerBundleOptions, stdin: { resolveDir: new URL('../src/', import.meta.url).pathname,
    contents: vectorSource + `\nexport default { async fetch(request) {
      const body = await request.json();
      try { const result = verifyAppleDeviceKey(body, Buffer.from(body.challenge,'base64'),body.now);
        return Response.json({valid:!!result.publicKey && !!result.receipt});
      } catch { return Response.json({valid:false},{status:409}); }
    } };` } });
  const mf = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2025-12-01', compatibilityFlags: ['nodejs_compat'],
    modules: true, script: bundled.outputFiles[0].text, log: new Log(LogLevel.NONE) }));
  t.after(() => mf.dispose());
  const call = body => mf.dispatchFetch('https://test/', { method: 'POST', body: JSON.stringify(body) });
  const verified = await call({ ...fixture, now });
  assert.equal(verified.status, 200); assert.deepEqual(await verified.json(), { valid: true });
  assert.equal((await call({ ...fixture, now: Date.parse(certs[0].validTo) + 1000 })).status, 409);
  assert.equal((await call({ ...fixture, now, challenge: btoa('wrong') })).status, 409);
});

async function runtime(t, flags = {}, rawPatch = {}) {
  const now = Date.now();
  const raw = { bundleId: 'com.stefanataalla.freefinderwien', environment: 'Production',
    productId: 'com.stefanataalla.freefinderwien.premium.monthly', originalTransactionId: '100000001', transactionId: '100000002',
    purchaseDate: now - 1000, originalPurchaseDate: now - 1000, expiresDate: now + 30 * 86400000,
    offerType: 3, offerDiscountType: 'FREE_TRIAL', offerIdentifier: 'earned-month', inAppOwnershipType: 'PURCHASED', storefront: 'AUT', ...rawPatch };
  const bundled = await build({ ...workerBundleOptions, stdin: { resolveDir: process.cwd(), contents: `
    import { appleRewardClaims } from './src/apple-reward-claim.js';
    import { ReferralMonthsLedger } from './src/referral-months.js';
    export class Ledger extends appleRewardClaims(ReferralMonthsLedger) {
      async alarm() {}
      verifyAppleDeviceKey(body) { if(body.attestation !== btoa('fixture')) throw Error('bad fixture'); return {publicKey:this.env.PUBLIC_KEY,receipt:'private-risk-receipt'}; }
      async verifyAppleRiskReceipt() { if(this.env.RISK_INITIAL_FAIL) throw Object.assign(Error('risk'),{status:503}); return {type:'ATTEST'}; }
      async assessAppleRisk(key) {
        if(this.env.RISK_FAIL) throw Object.assign(Error('risk'),{status:503});
        return {...key,receipt:'updated-risk-receipt',riskReview:!!this.env.RISK_REVIEW};
      }
      async appleTransaction(id) {
        const fixture = await this.storage.get('raw');
        await this.storage.put('store-reads',(await this.storage.get('store-reads')||0)+1);
        if(fixture.error) return {ok:false};
        return {ok:true,environment:fixture.environment,signedTransactionInfo:'x.'+btoa(JSON.stringify(fixture))+'.x'};
      }
      async fetch(request) {
        if(new URL(request.url).pathname === '/fixture') {
          const body=await request.json(); await this.storage.put(body); return Response.json({ok:true});
        }
        if(new URL(request.url).pathname === '/inspect') return Response.json(Object.fromEntries(await this.storage.list()));
        return super.fetch(request);
      }
    }
    export default {fetch(request,env){return env.LEDGER.get(env.LEDGER.idFromName('test')).fetch(request)}};
  ` } });
  const mf = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2025-12-01', compatibilityFlags: ['nodejs_compat'],
    modules: true, script: bundled.outputFiles[0].text, durableObjects: { LEDGER: { className: 'Ledger', useSQLite: true } },
    bindings: { REFERRAL_MONTHS_ENABLED: '1', REFERRAL_APPLE_ATTESTED_CLAIMS_ENABLED: '1', PUBLIC_KEY: publicKey, ...flags }, log: new Log(LogLevel.NONE) }));
  t.after(() => mf.dispose());
  async function call(action, fields = {}, expected = 200) {
    const response = await mf.dispatchFetch('https://test/' + action, { method: 'POST', body: JSON.stringify({
      accountId: owner, platform: 'ios', principal: { id: owner, email: 'fixture@example.test', authTime: Date.now() / 1000 },
      trustedIP: crypto.randomUUID(), keyId, rewardId, ...fields }) });
    const data = await response.json(); assert.equal(response.status, expected, JSON.stringify(data)); return data;
  }
  const reward = { id: rewardId, createdAt: now - 5000, months: 1, state: 'store_confirmation',
    redemptionPlatform: 'ios', productId: raw.productId, reservedAt: now - 2000, offerId: 'earned-month' };
  const account = { id: owner, recoverable: true, code: 'RM-' + 'A'.repeat(24), rewards: [reward] };
  await call('fixture', { raw, ['account:' + owner]: account });
  async function enroll() {
    const challenge = await call('apple-claim-challenge', { purpose: 'enroll' });
    await call('apple-claim-key', { nonce: challenge.nonce, attestation: btoa('fixture') });
  }
  async function proof(counter = 1) {
    const challenge = await call('apple-claim-challenge', { purpose: 'claim', transactionId: raw.transactionId });
    const fields = { purpose: 'claim', accountId: owner, keyId, rewardId, transactionId: raw.transactionId, nonce: challenge.nonce };
    return { ...fields, assertion: assertion(appleClaimPayload(fields), counter) };
  }
  return { call, enroll, proof, raw, account, inspect: () => call('inspect') };
}
test('tokenless Apple reward settles once with cryptographic device assertion; subsequent chain use stays owner-bound', async t => {
  const r = await runtime(t); await r.enroll(); const body = await r.proof();
  const result = await r.call('apple-claim-confirm', body);
  assert.equal(result.redeemedMonths, 1);
  const state = await r.inspect();
  const binding = Object.values(state).find(v => v.method === 'app_attest');
  assert.equal(binding.accountId, owner);
  assert.doesNotMatch(JSON.stringify(result), /publicKey|private-risk-receipt|attestationHash|sourceEvidence|receiptId/);
  await r.call('apple-claim-confirm', body, 409);
  const later = await r.call('confirm-redemption', { transactionId: r.raw.transactionId });
  assert.equal(later.redeemedMonths, 1);
  assert.equal((await r.inspect())['account:' + owner].rewards.length, 1);
  await r.call('fixture', { raw: { ...r.raw, appAccountToken: other } });
  await r.call('confirm-redemption', { transactionId: r.raw.transactionId }, 409);
});
test('unknown Store outcome consumes only replay proof; fresh assertion recovers without another redemption', async t => {
  const r = await runtime(t); await r.enroll(); const body = await r.proof();
  await r.call('fixture', { raw: { ...r.raw, error: true } });
  await r.call('apple-claim-confirm', body, 503);
  await r.call('apple-claim-confirm', body, 409);
  assert.equal((await r.inspect())['account:' + owner].rewards[0].state, 'store_confirmation');
  await r.call('fixture', { raw: r.raw });
  const next = await r.proof(2);
  assert.equal((await r.call('apple-claim-confirm', next)).redeemedMonths, 1);
});
test('unavailable and elevated device risk preserve reward and stop before Store lookup', async t => {
  for (const flags of [{ RISK_FAIL: true }, { RISK_REVIEW: true }]) {
    await t.test(JSON.stringify(flags), async sub => {
      const r = await runtime(sub, flags); await r.enroll();
      await r.call('apple-claim-confirm', await r.proof(), flags.RISK_FAIL ? 503 : 409);
      const state = await r.inspect();
      assert.equal(state['account:' + owner].rewards[0].state, 'store_confirmation');
      assert.equal(state['store-reads'], undefined);
      const key = state['apple-device:' + sha(keyId).toString('hex')];
      assert.equal(key.signCount, 1);
      if (flags.RISK_REVIEW) {
        assert.equal(key.receipt, 'updated-risk-receipt'); assert.equal(key.riskReview, true);
      } else assert.equal(key.receipt, 'private-risk-receipt');
    });
  }
});
test('invalid initial risk receipt never enrolls key or consumes enrollment challenge', async t => {
  const r = await runtime(t, { RISK_INITIAL_FAIL: true });
  const challenge = await r.call('apple-claim-challenge', { purpose: 'enroll' });
  await r.call('apple-claim-key', { nonce: challenge.nonce, attestation: btoa('fixture') }, 503);
  const state = await r.inspect();
  assert.equal(state['apple-device:' + sha(keyId).toString('hex')], undefined);
  assert.equal(state['apple-challenge:' + owner + ':enroll'].nonce, challenge.nonce);
});
test('exact Store/reward/owner/region/period is mandatory even with a valid device assertion', async t => {
  for (const patch of [{ appAccountToken: other }, { appAccountToken: owner }, { appAccountToken: '' },
    { storefront: 'USA' }, { inAppOwnershipType: 'FAMILY_SHARED' }, { environment: 'Sandbox' },
    { bundleId: 'another.app' }, { offerIdentifier: 'different' }, { offerType: 1 }, { offerDiscountType: 'PAY_AS_YOU_GO' },
    { purchaseDate: Date.now() - 86400000 }, { revocationDate: Date.now() }, { originalTransactionId: 'malformed' }]) {
    await t.test(JSON.stringify(patch), async sub => {
      const r = await runtime(sub, {}, patch); await r.enroll();
      await r.call('apple-claim-confirm', await r.proof(), patch.environment ? 503 : 409);
      assert.equal((await r.inspect())['account:' + owner].rewards[0].state, 'store_confirmation');
    });
  }
});
test('known foreign purchase, chain or receipt is never stolen', async t => {
  for (const [prefix, value] of [['purchase:', other], ['apple-owner:', { accountId: other, method: 'app_attest' }],
    ['redemption:', { accountId: other, rewardId }]]) {
    await t.test(prefix, async sub => {
      const r = await runtime(sub); await r.enroll();
      const storeKey = prefix + sha('ios:' + (prefix === 'redemption:' ? r.raw.transactionId : r.raw.originalTransactionId)).toString('hex');
      await r.call('fixture', { [storeKey]: value });
      await r.call('apple-claim-confirm', await r.proof(), 409);
      assert.deepEqual((await r.inspect())[storeKey], value);
    });
  }
});
test('challenge substitution, expiry and fake trusted input cannot claim a transaction', async t => {
  const r = await runtime(t); await r.enroll(); const body = await r.proof();
  await r.call('apple-claim-confirm', { ...body, nonce: crypto.randomUUID() }, 409);
  await r.call('apple-claim-confirm', { ...body, transactionId: '99999999' }, 409);
  await r.call('confirm-redemption', { transactionId: r.raw.transactionId, attestedAppleOwner: owner }, 409);
  const challenge = (await r.inspect())['apple-challenge:' + owner + ':claim'];
  await r.call('fixture', { ['apple-challenge:' + owner + ':claim']: { ...challenge, expiresAt: Date.now() - 1 } });
  await r.call('apple-claim-confirm', body, 409);
  assert.equal((await r.inspect())['account:' + owner].rewards[0].state, 'store_confirmation');
});
test('enrollment is recent-auth bound, retry-safe and cannot reset a counter or change owners', async t => {
  const r = await runtime(t);
  await r.call('apple-claim-challenge', { purpose: 'enroll', principal: { id: owner, email: 'fixture@example.test', authTime: Date.now() / 1000 - 400 } }, 409);
  await r.enroll(); await r.call('apple-claim-confirm', await r.proof());
  await r.call('apple-claim-key', { attestation: btoa('fixture') });
  assert.equal((await r.inspect())['apple-device:' + sha(keyId).toString('hex')].signCount, 1);
  await r.call('fixture', { ['account:' + other]: { ...r.account, id: other } });
  await r.call('apple-claim-challenge', { purpose: 'enroll', accountId: other,
    principal: { id: other, email: 'other@example.test', authTime: Date.now() / 1000 } }, 409);
});
test('disabled path fails closed; deleting account removes device key/receipt but retains dedup tombstone', async t => {
  const off = await runtime(t, { REFERRAL_APPLE_ATTESTED_CLAIMS_ENABLED: '0' });
  await off.call('apple-claim-challenge', { purpose: 'enroll' }, 503);
  const r = await runtime(t); await r.enroll(); await r.proof();
  await r.call('account-delete');
  const data = await r.inspect();
  assert.doesNotMatch(JSON.stringify(data), /private-risk-receipt|publicKey|BEGIN PUBLIC KEY/);
  const tombstone = data['apple-device:' + sha(keyId).toString('hex')];
  assert.equal(tombstone.accountId, owner); assert.ok(tombstone.deletedAt);
  assert.equal(data['apple-devices:' + owner], undefined);
  assert.equal(data['apple-challenge:' + owner + ':claim'], undefined);
});

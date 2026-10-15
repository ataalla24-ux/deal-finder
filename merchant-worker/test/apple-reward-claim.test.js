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
test('legacy assertion uses a distinct domain and signs the exact previous identity', () => {
  const fields = { purpose: 'legacy', accountId: owner, keyId, rewardId, transactionId: '100000001',
    legacyAccountId: other, nonce: crypto.randomUUID() };
  const payload = appleClaimPayload(fields);
  const body = { assertion: assertion(payload) };
  assert.equal(verifyAppleDeviceAssertion(body, payload, { publicKey, signCount: 0 }), 1);
  for (const field of ['purpose', 'accountId', 'keyId', 'rewardId', 'transactionId', 'legacyAccountId', 'nonce']) {
    assert.throws(() => verifyAppleDeviceAssertion(body, appleClaimPayload({ ...fields, [field]: 'changed' }), { publicKey, signCount: 0 }));
  }
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
        const fixture = await this.storage.get('raw:' + id) || await this.storage.get('raw');
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
async function legacyRuntime(t, flags = {}, rawPatch = {}) {
  const r = await runtime(t, { REFERRAL_APPLE_LEGACY_BINDING_ENABLED: '1', ...flags },
    { appAccountToken: other, offerType: undefined, offerDiscountType: undefined, offerIdentifier: undefined, ...rawPatch });
  r.account.rewards[0].state = 'earned';
  await r.call('fixture', { ['account:' + owner]: r.account });
  await r.enroll();
  r.legacyProof = async (counter = 1, patch = {}) => {
    const fields = { purpose: 'legacy', accountId: owner, keyId, rewardId, transactionId: r.raw.transactionId,
      legacyAccountId: other, ...patch };
    const challenge = await r.call('apple-claim-challenge', fields);
    fields.nonce = challenge.nonce;
    return { ...fields, assertion: assertion(appleClaimPayload(fields), counter) };
  };
  return r;
}
test('legacy Store owner binds immutably without changing a receipt, reward, subscription or old identity', async t => {
  const r = await legacyRuntime(t);
  await r.call('confirm-redemption', { transactionId: r.raw.transactionId }, 409);
  const fields = await r.legacyProof();
  assert.deepEqual(await r.call('apple-claim-confirm', fields), { ok: true, linked: true });
  const before = await r.inspect();
  const chainKey = 'apple-owner:' + sha('ios:' + r.raw.originalTransactionId).toString('hex');
  assert.equal(before[chainKey].method, 'legacy_app_attest');
  assert.equal(before[chainKey].accountId, owner);
  assert.equal(before[chainKey].legacyTokenHash, sha(other).toString('hex'));
  assert.deepEqual(before.raw, JSON.parse(JSON.stringify(r.raw)));
  assert.deepEqual(before['account:' + owner], r.account);
  assert.equal(before['account:' + other], undefined);
  assert.equal(before['purchase:' + sha('ios:' + r.raw.originalTransactionId).toString('hex')], undefined);
  await r.call('apple-claim-confirm', fields, 409);
  // A lost successful response can be retried with a fresh assertion and the same immutable association.
  await r.call('apple-claim-confirm', await r.legacyProof(2));
  const status = await r.call('confirm-redemption', { transactionId: r.raw.transactionId });
  assert.equal(status.redeemedMonths, 0);
  assert.deepEqual((await r.inspect())[chainKey], before[chainKey]);
  await r.call('fixture', { raw: { ...r.raw, appAccountToken: rewardId } });
  await r.call('confirm-redemption', { transactionId: r.raw.transactionId }, 409);
});
test('invitation through legacy binding, reservation and exact free-period settlement is idempotent in Workers SQLite', async t => {
  const r = await runtime(t, { REFERRAL_APPLE_LEGACY_BINDING_ENABLED: '1' },
    { appAccountToken: other, offerType: undefined, offerDiscountType: undefined, offerIdentifier: undefined });
  const friend = '44444444-4444-8444-8444-444444444444';
  const friendFields = { accountId: friend, principal: { id: friend, email: 'friend@example.test', authTime: Date.now()/1000 } };
  const account = { ...r.account, rewards: [] };
  await r.call('fixture', { ['account:' + owner]: account, ['code:' + account.code]: owner });
  await r.call('register', friendFields);
  await r.call('accept', { ...friendFields, code: account.code });
  const started = Date.now();
  const original = { ...r.raw, appAccountToken: friend, originalTransactionId:'200000001', transactionId:'200000001',
    purchaseDate:started, originalPurchaseDate:started, expiresDate:started+30*86400000,
    offerType:1, offerDiscountType:'FREE_TRIAL' };
  await r.call('fixture', { ['raw:' + original.transactionId]: original });
  const confirmed = await r.call('confirm', { ...friendFields, transactionId:original.transactionId });
  assert.equal(confirmed.confirmed,true);
  await r.call('confirm', { ...friendFields, transactionId:original.transactionId });
  const earned = (await r.call('status')).rewards;
  assert.equal(earned.length,1); assert.equal(earned[0].state,'earned');
  const earnedID = earned[0].id;
  const enrolled = await r.call('apple-claim-challenge',{purpose:'enroll',rewardId:earnedID});
  await r.call('apple-claim-key',{rewardId:earnedID,nonce:enrolled.nonce,attestation:btoa('fixture')});
  const fields = {purpose:'legacy',accountId:owner,keyId,rewardId:earnedID,transactionId:r.raw.transactionId,legacyAccountId:other};
  const challenge = await r.call('apple-claim-challenge',fields); fields.nonce=challenge.nonce;
  await r.call('apple-claim-confirm',{...fields,assertion:assertion(appleClaimPayload(fields))});
  await r.call('import-apple-offers',{offers:[{productId:r.raw.productId,offerId:'lifecycle-month',code:'FIXTURELIFECYCLE001',
    freeMonths:1,customerType:'existing',expiresAt:Date.now()+60*86400000,environment:'Production',
    autoRenew:true,combineIntroductoryOffer:false}]});
  const reserved = await r.call('redeem',{rewardId:earnedID,transactionId:r.raw.transactionId});
  assert.equal(reserved.rewards[0].state,'store_confirmation'); assert.equal(reserved.redeemedMonths,0);
  assert.equal(reserved.rewards[0].offerId,'lifecycle-month');
  assert.deepEqual(await r.call('redeem',{rewardId:earnedID,transactionId:r.raw.transactionId}),reserved);
  const deliveredAt=Date.now();
  const redeemed={...r.raw,transactionId:'100000003',purchaseDate:deliveredAt,expiresDate:deliveredAt+30*86400000,
    offerType:3,offerDiscountType:'FREE_TRIAL',offerIdentifier:'lifecycle-month'};
  await r.call('fixture',{['raw:'+redeemed.transactionId]:redeemed});
  const settled=await r.call('confirm-redemption',{transactionId:redeemed.transactionId});
  assert.equal(settled.redeemedMonths,1); assert.equal(settled.rewards[0].state,'redeemed');
  const proof=(await r.inspect())['account:'+owner].rewards[0].redemptionEvidence;
  assert.equal(proof.accountId,owner); assert.equal(proof.receiptId,redeemed.transactionId);
  assert.equal(proof.periodEnd-proof.purchasedAt,30*86400000);
  assert.deepEqual(await r.call('confirm-redemption',{transactionId:redeemed.transactionId}),settled);
  assert.deepEqual(await r.call('redeem',{rewardId:earnedID}),settled);
  // A later source revocation does not erase the already delivered benefit or replay billing.
  await r.call('fixture',{['raw:'+original.transactionId]:{...original,revocationDate:Date.now()}});
  assert.deepEqual(await r.call('redeem',{rewardId:earnedID}),settled);
  assert.equal((await r.inspect())['account:'+other],undefined);
});
test('disabled legacy binding and forged request assertions cannot bypass server ownership',async t=>{
  const r=await legacyRuntime(t,{REFERRAL_APPLE_LEGACY_BINDING_ENABLED:'0'});
  await r.call('fixture',{['apple-owner:'+sha('ios:'+r.raw.originalTransactionId).toString('hex')]:{
    accountId:owner,method:'legacy_app_attest',legacyTokenHash:sha(other).toString('hex')}});
  await r.call('confirm-redemption',{transactionId:r.raw.transactionId,attestedAppleOwner:owner,attestedLegacyToken:other},409);
  assert.equal((await r.call('status')).appleLegacyBinding,false);
});
test('legacy ownership never accepts another account, Sandbox, revoked, expired, shared or mismatched Store proof', async t => {
  for (const patch of [{ appAccountToken: rewardId }, { appAccountToken: null }, { appAccountToken: owner },
    { appAccountToken: '22222222-2222-8222-8222-222222222222' }, { environment: 'Sandbox' },
    { bundleId: 'another.app' }, { productId: 'another.product' }, { expiresDate: Date.now() - 1000 },
    { revocationDate: Date.now() }, { inAppOwnershipType: 'FAMILY_SHARED' }, { storefront: 'USA' },
    { transactionId: '100000099' }, { originalTransactionId: 'malformed' }]) {
    await t.test(JSON.stringify(patch), async sub => {
      const r = await legacyRuntime(sub, {}, patch);
      const fields = await r.legacyProof();
      if (patch.transactionId) fields.transactionId = '100000002';
      await r.call('apple-claim-confirm', fields, patch.environment ? 503 : 409);
      const state = await r.inspect();
      assert.equal(Object.keys(state).some(k => k.startsWith('apple-owner:') || k.startsWith('apple-legacy-owner:')), false);
      assert.deepEqual(state['account:' + owner], r.account);
    });
  }
});
test('legacy identity and chain conflicts, deletion tombstones and old reward records are preserved', async t => {
  const chain = 'ios:100000001';
  for (const [key, value] of [
    ['account:' + other, { id: other, rewards: [{ months: 2 }] }],
    ['account:' + other, { id: other, deletedAt: 1 }],
    ['apple-legacy-owner:' + sha(other).toString('hex'), { accountId: rewardId }],
    ['apple-owner:' + sha(chain).toString('hex'), { accountId: rewardId, method: 'legacy_app_attest' }],
    ['apple-owner:' + sha(chain).toString('hex'), { accountId: owner, method: 'app_attest' }],
    ['purchase:' + sha(chain).toString('hex'), other],
  ]) {
    await t.test(key, async sub => {
      const r = await legacyRuntime(sub); await r.call('fixture', { [key]: value });
      await r.call('apple-claim-confirm', await r.legacyProof(), 409);
      const state = await r.inspect();
      assert.deepEqual(state[key], value);
      assert.deepEqual(state['account:' + owner], r.account);
    });
  }
});
test('legacy feature, recent authentication, credit state and v4 namespace must all qualify before signing', async t => {
  await t.test('disabled', async sub => {
    const r = await legacyRuntime(sub, { REFERRAL_APPLE_LEGACY_BINDING_ENABLED: '0' });
    await r.call('apple-claim-challenge', { purpose: 'legacy', transactionId: r.raw.transactionId, legacyAccountId: other }, 503);
  });
  const r = await legacyRuntime(t);
  for (const legacyAccountId of [owner, '22222222-2222-8222-8222-222222222222', '', 'invalid']) {
    await r.call('apple-claim-challenge', { purpose: 'legacy', transactionId: r.raw.transactionId, legacyAccountId }, 409);
  }
  await r.call('apple-claim-challenge', { purpose: 'legacy', transactionId: r.raw.transactionId, legacyAccountId: other,
    principal: { id: owner, email: 'fixture@example.test', authTime: 1 } }, 409);
  r.account.rewards[0].state = 'store_confirmation';
  await r.call('fixture', { ['account:' + owner]: r.account });
  await r.call('apple-claim-challenge', { purpose: 'legacy', transactionId: r.raw.transactionId, legacyAccountId: other }, 409);
});
test('legacy risk/outage consumes only assertion; credit remains and a fresh retry recovers', async t => {
  const r = await legacyRuntime(t); const fields = await r.legacyProof();
  await r.call('fixture', { raw: { ...r.raw, error: true } });
  await r.call('apple-claim-confirm', fields, 503);
  await r.call('apple-claim-confirm', fields, 409);
  assert.deepEqual((await r.inspect())['account:' + owner], r.account);
  await r.call('fixture', { raw: r.raw });
  await r.call('apple-claim-confirm', await r.legacyProof(2));
  for (const flags of [{ RISK_FAIL: true }, { RISK_REVIEW: true }]) {
    await t.test(JSON.stringify(flags), async sub => {
      const blocked = await legacyRuntime(sub, flags);
      await blocked.call('apple-claim-confirm', await blocked.legacyProof(), flags.RISK_FAIL ? 503 : 409);
      assert.equal((await blocked.inspect())['store-reads'], undefined);
    });
  }
});
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

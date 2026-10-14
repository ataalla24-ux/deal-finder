import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, generateKeyPairSync, X509Certificate } from 'node:crypto';
import { build } from 'esbuild';
import cbor from 'cbor';
import * as asn from 'asn1js';
import * as pki from 'pkijs';
import { jwtVerify, importSPKI } from 'jose';
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from 'miniflare';
import { workerBundleOptions } from './bundled-apple-claims.js';
import { assessAppleRisk, verifyAppleRiskReceipt } from '../src/app-attest-risk.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const app = '78C2SA4JP3.com.stefanataalla.freefinderwien';
const now = Date.now();
const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' });
const env = { APP_ATTEST_KEY_ID: 'ABCDEFGHIJ', APP_ATTEST_PRIVATE_KEY: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }) };
const source = await readFile(new URL('../src/app-attest-risk.js', import.meta.url), 'utf8');

test('real Apple CMS receipt passes inside Workers with only public fixture app/date substituted', async t => {
  const fixture = JSON.parse(await readFile(new URL('../node_modules/node-app-attest/test/fixtures/attestation-production.json', import.meta.url)));
  const data = cbor.decodeFirstSync(Buffer.from(fixture.attestation, 'base64'));
  const key = new X509Certificate(data.attStmt.x5c[0]).publicKey.export({ type: 'spki', format: 'pem' });
  const receipt = data.attStmt.receipt.toString('base64');
  const at = Date.parse('2024-02-07T21:08:57.308Z');
  await assert.rejects(verifyAppleRiskReceipt(receipt, key, at, 'ATTEST'));
  const contents = source.replace(`const APP_ID = '${app}';`, "const APP_ID = 'V8H6LQ9448.io.uebelacker.AppAttestExample';") + `
    export default {async fetch(request) {try {const x=await request.json();
      return Response.json(await verifyAppleRiskReceipt(x.receipt,x.key,x.now,x.type));
    } catch {return Response.json({ok:false},{status:503});}}};`;
  const bundle = await build({ ...workerBundleOptions, stdin: { resolveDir: process.cwd(), contents } });
  const mf = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2025-12-01', compatibilityFlags: ['nodejs_compat'],
    modules: true, script: bundle.outputFiles[0].text, log: new Log(LogLevel.NONE) }));
  t.after(() => mf.dispose());
  const call = x => mf.dispatchFetch('https://test', { method: 'POST', body: JSON.stringify({ receipt, key, now: at, type: 'ATTEST', ...x }) });
  const response = await call({});
  assert.equal(response.status, 200);
  assert.equal((await response.json()).receiptHash, hash(receipt));
  for (const x of [{ key: publicKey }, { now: at + 300000 }, { now: at - 60000 }, { type: 'RECEIPT' },
    { receipt: receipt + 'AAAA' }, { receipt: 'A'.repeat(32772) }, { receipt: '' }]) {
    assert.equal((await call(x)).status, 503);
  }
});

async function signedFixture() {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const root = new pki.Certificate();
  root.version = 2; root.serialNumber = new asn.Integer({ value: 1 });
  root.issuer.typesAndValues.push(new pki.AttributeTypeAndValue({ type: '2.5.4.3', value: new asn.Utf8String({ value: 'TEST ONLY' }) }));
  root.subject = root.issuer;
  root.notBefore.value = new Date(now - 86400000); root.notAfter.value = new Date(now + 86400000);
  root.extensions = [new pki.Extension({ extnID: '2.5.29.19', critical: true,
    extnValue: new pki.BasicConstraints({ cA: true, pathLenConstraint: 1 }).toSchema().toBER(false) })];
  await root.subjectPublicKeyInfo.importKey(keys.publicKey); await root.sign(keys.privateKey, 'SHA-256');
  const leaf = new pki.Certificate();
  leaf.version = 2; leaf.serialNumber = new asn.Integer({ value: 2 }); leaf.issuer = root.subject;
  leaf.subject.typesAndValues.push(new pki.AttributeTypeAndValue({ type: '2.5.4.3', value: new asn.Utf8String({ value: 'TEST RECEIPT' }) }));
  leaf.notBefore = root.notBefore; leaf.notAfter = root.notAfter;
  leaf.extensions = [new pki.Extension({ extnID: '1.2.840.113635.100.12.15', extnValue: new asn.Null().toBER(false) })];
  await leaf.subjectPublicKeyInfo.importKey(keys.publicKey); await leaf.sign(keys.privateKey, 'SHA-256');
  const rootPem = new X509Certificate(Buffer.from(root.toSchema().toBER(false))).toString();
  const key = new X509Certificate(Buffer.from(leaf.toSchema().toBER(false))).publicKey.export({ type: 'spki', format: 'pem' });
  const modified = source.replace(/const ROOT = `[\s\S]*?`;/, 'const ROOT = ' + JSON.stringify(rootPem) + ';');
  const bundle = await build({ ...workerBundleOptions, stdin: { resolveDir: process.cwd(), contents: modified } });
  const verifier = (await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'))).verifyAppleRiskReceipt;
  async function sign(patch = {}, duplicate = false) {
    const fields = { 2: app, 3: Buffer.from(leaf.toSchema().toBER(false)), 6: 'RECEIPT', 7: 'production',
      12: new Date(now).toISOString(), 17: '2', 19: new Date(now + 60000).toISOString(),
      21: new Date(now + 86400000).toISOString(), ...patch };
    const entries = Object.entries(fields).filter(([, value]) => value !== null).map(([id, value]) => new asn.Sequence({ value: [
      new asn.Integer({ value: Number(id) }), new asn.Integer({ value: 1 }),
      new asn.OctetString({ valueHex: Buffer.isBuffer(value) ? value : Buffer.from(value) })] }));
    if (duplicate) entries.push(entries[0]);
    const sd = new pki.SignedData({ certificates: [leaf, root],
      encapContentInfo: new pki.EncapsulatedContentInfo({ eContentType: '1.2.840.113549.1.7.1',
        eContent: new asn.OctetString({ valueHex: new asn.Set({ value: entries }).toBER(false) }) }),
      signerInfos: [new pki.SignerInfo({ sid: new pki.IssuerAndSerialNumber({ issuer: leaf.issuer, serialNumber: leaf.serialNumber }) })] });
    await sd.sign(keys.privateKey, 0, 'SHA-256');
    return Buffer.from(new pki.ContentInfo({ contentType: '1.2.840.113549.1.7.2', content: sd.toSchema() }).toSchema().toBER(false)).toString('base64');
  }
  return { sign, key, verifier };
}

test('signed risk fields enforce app, key, environment, type, freshness, metric, dates and unique fields', async () => {
  const f = await signedFixture(), receipt = await f.sign();
  const risk = await f.verifier(receipt, f.key, now);
  assert.equal(risk.metric, 2); assert.equal(risk.notBefore, now + 60000);
  // Test root is never accepted by the actual production-pinned verifier.
  await assert.rejects(verifyAppleRiskReceipt(receipt, f.key, now));
  for (const patch of [{ 2: 'OTHER.app' }, { 6: 'ATTEST' }, { 7: 'development' }, { 17: null }, { 17: '-1' }, { 17: '2.5' },
    { 17: '02' }, { 17: '99999999999999999' }, { 12: new Date(now - 300001).toISOString() },
    { 12: new Date(now + 31000).toISOString() }, { 19: new Date(now - 1).toISOString() },
    { 19: new Date(now + 86400000).toISOString() }, { 21: new Date(now).toISOString() }, { 21: '2026-02-30T00:00:00.000Z' }]) {
    await assert.rejects(f.verifier(await f.sign(patch), f.key, now));
  }
  await assert.rejects(f.verifier(await f.sign({}, true), f.key, now));
  await assert.rejects(f.verifier(receipt, publicKey, now));
  const damaged = Buffer.from(receipt, 'base64'); damaged[damaged.length - 1] ^= 1;
  await assert.rejects(f.verifier(damaged.toString('base64'), f.key, now));
});

test('Apple transport uses dedicated ES256 auth, fixed host, no redirect and verified replacement', async () => {
  let calls = 0;
  const key = { publicKey, receipt: 'old', signCount: 7, initialReceipt: { expiresAt: now + 60000 } };
  const actual = await assessAppleRisk(env, key, now, async (url, options) => {
    calls++;
    assert.equal(url, 'https://data.appattest.apple.com/v1/attestationData');
    assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'manual'); assert.equal(options.body, 'old');
    assert.ok(options.signal instanceof AbortSignal); assert.doesNotMatch(options.headers.Authorization, /Bearer/);
    const jwt = await jwtVerify(options.headers.Authorization, await importSPKI(publicKey, 'ES256'));
    assert.equal(jwt.protectedHeader.kid, env.APP_ATTEST_KEY_ID); assert.equal(jwt.payload.iss, '78C2SA4JP3');
    assert.equal(jwt.payload.iat, Math.floor(now / 1000));
    return new Response('new');
  }, async (receipt, pk, date, type) => {
    assert.equal(receipt, 'new'); assert.equal(pk, publicKey); assert.equal(date, now); assert.equal(type, 'RECEIPT');
    return { metric: 10 };
  });
  assert.equal(calls, 1); assert.equal(actual.receipt, 'new'); assert.equal(actual.signCount, 7); assert.equal(actual.riskReview, true);
  assert.equal(key.receipt, 'old');
});

test('fresh verified cache avoids network; due or mismatched proof does not reuse stale risk', async () => {
  const receipt = 'cache';
  const key = { publicKey, receipt, risk: { version: 1, type: 'RECEIPT', metric: 1, createdAt: now - 1000,
    notBefore: now + 1000, expiresAt: now + 2000, receiptHash: hash(receipt), keyHash: hash(publicKey) } };
  const fail = () => { throw Error('network unexpected'); };
  assert.equal((await assessAppleRisk({}, key, now, fail)).riskReview, false);
  assert.equal((await assessAppleRisk({}, { ...key, risk: { ...key.risk, metric: 10 } }, now, fail)).riskReview, true);
  for (const patch of [{ notBefore: now }, { expiresAt: now }, { keyHash: 'wrong' }, { receiptHash: 'wrong' },
    { createdAt: now + 1 }, { type: 'ATTEST' }, { metric: NaN }]) {
    await assert.rejects(assessAppleRisk({}, { ...key, risk: { ...key.risk, ...patch } }, now, fail));
  }
});

test('unavailable, malformed, redirected and oversized Apple responses fail closed without replacing receipt', async () => {
  const key = { publicKey, receipt: 'old' };
  for (const status of [301, 302, 304, 400, 401, 404, 429, 500, 503]) {
    await assert.rejects(assessAppleRisk(env, key, now, async () => new Response(null, { status }), () => assert.fail('must not trust response')));
  }
  await assert.rejects(assessAppleRisk(env, key, now, async () => new Response('A'.repeat(32769))));
  await assert.rejects(assessAppleRisk(env, key, now, async () => new Response('AAAA')));
  await assert.rejects(assessAppleRisk({}, key, now, () => assert.fail('no request without dedicated key')));
  assert.equal(key.receipt, 'old');
});

test('risk service timeout also bounds a transport that ignores abort', async () => {
  let signal;
  const started = Date.now();
  await assert.rejects(assessAppleRisk(env, { publicKey, receipt: 'old' }, now, async (_, options) => {
    signal = options.signal;
    return new Promise(() => {});
  }));
  assert.equal(signal.aborted, true);
  assert.ok(Date.now() - started < 10000);
});

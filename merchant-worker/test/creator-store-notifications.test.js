import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { X509Certificate } from 'node:crypto';
import { builtinModules } from 'node:module';
import { Environment, SignedDataVerifier, VerificationException } from '@apple/app-store-server-library';
import { SignJWT, createRemoteJWKSet, customFetch, exportJWK, generateKeyPair } from 'jose';
import * as asn from 'asn1js';
import * as pki from 'pkijs';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from 'miniflare';
import { defineEnv } from 'unenv';
import { getCloudflarePreset } from '@cloudflare/unenv-preset';
import { workerBundleOptions } from './bundled-apple-claims.js';
import appleOCSPFetch, { createCreatorNotificationVerifiers, verifyAppleCreatorNotification,
  verifyGoogleCreatorNotification } from '../src/creator-store-notifications.js';

const APP = 'com.stefanataalla.freefinderwien', APP_ID = 6758958213;
const AUDIENCE = 'https://freefinder-merchant-backend.freefinder-stefan.workers.dev/api/creators/google-notifications';
const EMAIL = 'creator-push@fixture-project.iam.gserviceaccount.com';
const ENV = { CREATOR_GOOGLE_PUSH_AUDIENCE: AUDIENCE, CREATOR_GOOGLE_PUSH_EMAIL: EMAIL };
const ID = '11111111-1111-4111-8111-111111111111';
const NOW = Math.floor(Date.now() / 1000);
const SAMPLE_JWS = 'eyJhbGciOiJFUzI1NiJ9.e30.AAAA';
const status = expected => error => error.status === expected && !error.cause;
const clone = value => structuredClone(value);
const ocspOptions = () => ({ method: 'POST', headers: { 'content-type': 'application/ocsp-request' }, body: Buffer.from('fixture-ocsp') });
const appleOuter = () => ({ version: '2.0', notificationType: 'DID_RENEW', notificationUUID: ID,
  signedDate: Date.now(), data: { environment: 'Production', bundleId: APP, appAppleId: APP_ID,
    signedTransactionInfo: SAMPLE_JWS, signedRenewalInfo: SAMPLE_JWS } });
const appleTransaction = () => ({ environment: 'Production', bundleId: APP,
  transactionId: '100000002', originalTransactionId: '100000001', productId: APP + '.premium.monthly' });
const appleRenewal = () => ({ environment: 'Production', originalTransactionId: '100000001', productId: APP + '.premium.monthly' });
function appleFixture({ outer = appleOuter(), transaction = appleTransaction(), renewal = appleRenewal(), failure } = {}) {
  const calls = [];
  const verifier = createCreatorNotificationVerifiers({ appleVerifierFactory(roots, online, environment, app, appId) {
    assert.equal(roots.length, 1);
    assert.ok(new X509Certificate(roots[0]).subject.includes('Apple Root CA - G3'));
    assert.equal(online, true); assert.equal(environment, Environment.PRODUCTION);
    assert.equal(app, APP); assert.equal(appId, APP_ID);
    return {
      async verifyAndDecodeNotification(value) { calls.push(['outer', value]); if (failure === 'outer') throw Error('private JWS'); return clone(outer); },
      async verifyAndDecodeTransaction(value) { calls.push(['transaction', value]); if (failure === 'transaction') throw Error('private receipt'); return clone(transaction); },
      async verifyAndDecodeRenewalInfo(value) { calls.push(['renewal', value]); if (failure === 'renewal') throw Error('private renewal'); return clone(renewal); },
    };
  } });
  return { verify: value => verifier.verifyAppleCreatorNotification(value ?? SAMPLE_JWS), calls };
}

test('Apple factory pins production app/root, verifies every nested signature and returns only server proof', async () => {
  const f = appleFixture(), result = await f.verify();
  assert.deepEqual(result, { notificationId: ID, notificationType: 'DID_RENEW', transactionId: '100000002',
    rawTransaction: appleTransaction(), renewalInfo: appleRenewal(), test: false });
  assert.deepEqual(f.calls.map(x => x[0]), ['outer', 'transaction', 'renewal']);
  assert.equal(Object.hasOwn(result, 'principal'), false);
});

test('Apple public pinned certificate exactly matches the existing public root', async () => {
  const before = await readFile(new URL('../src/app-attest-risk.js', import.meta.url), 'utf8');
  const actual = await readFile(new URL('../src/creator-store-notifications.js', import.meta.url), 'utf8');
  assert.equal(actual.match(/const APPLE_ROOT_G3 = `([^`]+)`/)[1], before.match(/const ROOT = `([^`]+)`/)[1]);
});

test('OCSP adapter uses bounded native fetch without redirects and preserves binary response bytes', async t => {
  const bytes = Buffer.from([0x30, 0x01, 0xff]);
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url.href, 'http://ocsp.apple.com/fixture-only');
    assert.equal(options.redirect, 'manual'); assert.equal(options.method, 'POST');
    assert.ok(options.signal instanceof AbortSignal);
    assert.deepEqual(options.body, ocspOptions().body);
    return new Response(bytes);
  });
  const response = await appleOCSPFetch('http://ocsp.apple.com/fixture-only', ocspOptions());
  assert.equal(response.ok, true); assert.deepEqual(await response.buffer(), bytes);
});

test('OCSP adapter rejects non-Apple hosts, URL credentials, unexpected methods and headers before fetching', async t => {
  const fetcher = t.mock.method(globalThis, 'fetch', () => assert.fail('unexpected OCSP network'));
  for (const url of ['https://evil.test/status', 'https://ocsp.apple.com.evil.test/status', 'ftp://ocsp.apple.com/status',
    'https://user@ocsp.apple.com/status', 'https://ocsp.apple.com:444/status', 'https://ocsp.apple.com/status#fragment']) {
    await assert.rejects(appleOCSPFetch(url, ocspOptions()), status(503));
  }
  await assert.rejects(appleOCSPFetch('https://ocsp.apple.com/status', { ...ocspOptions(), method: 'GET' }), status(503));
  await assert.rejects(appleOCSPFetch('https://ocsp.apple.com/status', { ...ocspOptions(), headers: {} }), status(503));
  assert.equal(fetcher.mock.callCount(), 0);
});

test('OCSP redirects and oversized advertised/streamed responses cannot be accepted', async t => {
  const fetcher = t.mock.method(globalThis, 'fetch', async () => new Response(null, {
    status: 307, headers: { location: 'https://evil.test/status' },
  }));
  assert.equal((await appleOCSPFetch('https://ocsp.apple.com/status', ocspOptions())).ok, false);
  assert.equal(fetcher.mock.callCount(), 1);
  fetcher.mock.mockImplementation(async () => new Response('small', { headers: { 'content-length': '32769' } }));
  await assert.rejects(appleOCSPFetch('https://ocsp.apple.com/status', ocspOptions()), status(503));
  fetcher.mock.mockImplementation(async () => new Response(new Uint8Array(32769)));
  await assert.rejects(appleOCSPFetch('https://ocsp.apple.com/status', ocspOptions()), status(503));
});

test('OCSP timeout aborts even a fixture transport that ignores abort', async t => {
  let signal;
  t.mock.method(globalThis, 'fetch', async (_, options) => { signal = options.signal; return new Promise(() => {}); });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const rejected = assert.rejects(appleOCSPFetch('https://ocsp.apple.com/status', ocspOptions()), status(503));
  t.mock.timers.tick(8000); await rejected;
  assert.equal(signal.aborted, true);
});

test('Apple SDK rejects unsigned/malformed/untrusted payloads without any Store network', async () => {
  for (const value of [null, {}, '', 'a'.repeat(32769), 'a.b', 'a.b.c.d', 'a.b.c\n', SAMPLE_JWS,
    Buffer.from('{"alg":"none"}').toString('base64url') + '.' + Buffer.from(JSON.stringify(appleOuter())).toString('base64url') + '.AAAA']) {
    await assert.rejects(verifyAppleCreatorNotification(value), status(400));
  }
});

for (const field of ['outer', 'transaction', 'renewal']) {
  test(`Apple ${field} signature failure cannot yield proof or leak its payload`, async () => {
    const f = appleFixture({ failure: field });
    await assert.rejects(f.verify(), error => status(400)(error) && !/private/.test(error.message));
    assert.equal(f.calls.at(-1)[0], field);
  });
}

const badAppleOuter = [
  ['wrong version', x => { x.version = '1.0'; }], ['missing ID', x => { delete x.notificationUUID; }],
  ['invalid ID', x => { x.notificationUUID = 'not-an-id'; }], ['no type', x => { delete x.notificationType; }],
  ['sandbox', x => { x.data.environment = 'Sandbox'; }], ['wrong bundle', x => { x.data.bundleId = 'other.app'; }],
  ['wrong app ID', x => { x.data.appAppleId++; }], ['string app ID', x => { x.data.appAppleId = String(APP_ID); }],
  ['no data', x => { delete x.data; }], ['summary mixed with data', x => { x.summary = {}; }],
  ['appData mixed with data', x => { x.appData = {}; }], ['external purchase', x => { x.externalPurchaseToken = {}; }],
  ['missing signed transaction', x => { delete x.data.signedTransactionInfo; }],
  ['raw client transaction', x => { x.data.signedTransactionInfo = appleTransaction(); }],
  ['bad nested renewal JWS', x => { x.data.signedRenewalInfo = 'not-signed'; }],
];
for (const [name, change] of badAppleOuter) test('Apple rejects ' + name, async () => {
  const outer = appleOuter(); change(outer);
  await assert.rejects(appleFixture({ outer }).verify(), status(400));
});

for (const [name, patch] of [
  ['foreign transaction', { bundleId: 'other.app' }], ['sandbox transaction', { environment: 'Sandbox' }],
  ['bad transaction ID', { transactionId: 'not-a-receipt' }], ['missing original ID', { originalTransactionId: undefined }],
  ['missing product', { productId: undefined }],
]) test('Apple rejects ' + name, async () => {
  await assert.rejects(appleFixture({ transaction: { ...appleTransaction(), ...patch } }).verify(), status(400));
});

for (const [name, patch] of [
  ['other original chain', { originalTransactionId: '100000009' }], ['sandbox renewal', { environment: 'Sandbox' }],
  ['mismatched product', { productId: APP + '.premium.yearly' }], ['missing renewal product', { productId: undefined }],
]) test('Apple rejects renewal with ' + name, async () => {
  await assert.rejects(appleFixture({ renewal: { ...appleRenewal(), ...patch } }).verify(), status(400));
});

test('Apple refund without renewal remains verifiable and unknown products remain caller-filtered', async () => {
  const outer = appleOuter(); outer.notificationType = 'REFUND'; delete outer.data.signedRenewalInfo;
  const transaction = { ...appleTransaction(), productId: 'other.owned.product', revocationPercentage: 50000 };
  const f = appleFixture({ outer, transaction });
  assert.deepEqual((await f.verify()).rawTransaction, transaction);
  assert.equal((await f.verify()).renewalInfo, null);
  assert.ok(f.calls.every(x => x[0] !== 'renewal'));
});

test('Apple TEST requires a verified production envelope and never invents a receipt', async () => {
  const outer = appleOuter(); outer.notificationType = 'TEST';
  delete outer.data.signedTransactionInfo; delete outer.data.signedRenewalInfo;
  const f = appleFixture({ outer });
  assert.deepEqual(await f.verify(), { notificationId: ID, notificationType: 'TEST', transactionId: null, rawTransaction: null, renewalInfo: null, test: true });
  assert.equal(f.calls.length, 1);
  outer.data.signedRenewalInfo = SAMPLE_JWS;
  await assert.rejects(appleFixture({ outer }).verify(), status(400));
});

test('Apple deadline fails closed and does not begin nested verification after expiry', async t => {
  let resolve, nested = 0;
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const verifier = createCreatorNotificationVerifiers({ appleVerifierFactory: () => ({
    verifyAndDecodeNotification: () => new Promise(done => { resolve = done; }),
    async verifyAndDecodeTransaction() { nested++; return appleTransaction(); },
  }) });
  const request = verifier.verifyAppleCreatorNotification(SAMPLE_JWS);
  const rejected = assert.rejects(request, status(503));
  while (!resolve) await Promise.resolve();
  t.mock.timers.tick(12000);
  await rejected;
  resolve(appleOuter()); await Promise.resolve(); await Promise.resolve();
  assert.equal(nested, 0);
});

const googlePair = await generateKeyPair('RS256');
const jwk = { ...await exportJWK(googlePair.publicKey), kid: 'fixture-google', alg: 'RS256', use: 'sig' };
const jwks = { keys: [jwk] };
function googleClaims(patch = {}) {
  return { iss: 'https://accounts.google.com', aud: AUDIENCE, sub: '123456789012345678901',
    email: EMAIL, email_verified: true, iat: NOW, exp: NOW + 3600, ...patch };
}
async function authorization(patch = {}, key = googlePair.privateKey, header = {}) {
  const claims = googleClaims(patch);
  for (const field of Object.keys(claims)) if (claims[field] === undefined) delete claims[field];
  return 'Bearer ' + await new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: jwk.kid, ...header }).sign(key);
}
const rtdn = () => ({ version: '1.0', packageName: APP, eventTimeMillis: String(Date.now()),
  subscriptionNotification: { version: '1.0', notificationType: 2, purchaseToken: 'fixture-private-purchase-token' } });
function envelope(notification = rtdn()) {
  return { message: { messageId: '12345678901', data: Buffer.from(JSON.stringify(notification)).toString('base64') },
    subscription: 'projects/fixture-project/subscriptions/creator-rtdn' };
}
function googleFixture() {
  let fetches = 0;
  const verifier = createCreatorNotificationVerifiers({ googleKeyResolverFactory(url, options) {
    assert.equal(url.href, 'https://www.googleapis.com/oauth2/v3/certs');
    assert.equal(options.timeoutDuration, 5000);
    return createRemoteJWKSet(url, { ...options, [customFetch]: async (input, init) => {
      assert.equal(String(input), url.href); assert.equal(init.redirect, 'manual'); fetches++;
      return Response.json(jwks);
    } });
  } });
  return { verify: (auth, body = envelope(), env = ENV) => verifier.verifyGoogleCreatorNotification(auth, body, env),
    fetches: () => fetches };
}

test('Google actual RS256 JWT/JWKS authenticates exact audience/email and both supported issuers', async () => {
  const f = googleFixture();
  for (const iss of ['accounts.google.com', 'https://accounts.google.com']) {
    assert.deepEqual(await f.verify(await authorization({ iss })), {
      messageId: '12345678901', purchaseToken: 'fixture-private-purchase-token', test: false,
    });
  }
  assert.equal(f.fetches(), 1, 'reuse only the pinned Google JWKS cache');
});

for (const [name, patch] of [
  ['wrong audience', { aud: 'https://other.example' }], ['audience array', { aud: [AUDIENCE, 'other'] }],
  ['wrong issuer', { iss: 'https://issuer.example' }], ['issuer suffix', { iss: 'https://accounts.google.com.evil.test' }],
  ['wrong email', { email: 'other@fixture-project.iam.gserviceaccount.com' }],
  ['unverified email', { email_verified: false }], ['string verified email', { email_verified: 'true' }],
  ['missing email', { email: undefined }], ['missing verified flag', { email_verified: undefined }],
  ['expired token', { iat: NOW - 3700, exp: NOW - 100 }], ['future issued', { iat: NOW + 60, exp: NOW + 3600 }],
  ['missing issue time', { iat: undefined }], ['missing expiry', { exp: undefined }],
  ['unbounded lifetime', { exp: NOW + 7200 }], ['non-numeric subject', { sub: 'forged-user' }],
  ['missing subject', { sub: undefined }], ['inverted lifetime', { exp: NOW - 1 }],
]) test('Google rejects ' + name, async () => {
  await assert.rejects(googleFixture().verify(await authorization(patch)), status(401));
});

test('Google rejects wrong signing key, unsigned JWT, wrong algorithm and malformed Bearer headers', async () => {
  const other = await generateKeyPair('RS256'), f = googleFixture();
  await assert.rejects(f.verify(await authorization({}, other.privateKey)), status(401));
  const valid = await authorization();
  for (const auth of ['', null, valid.replace('Bearer ', 'bearer '), valid + '\n', valid + ' extra',
    'Bearer ' + Buffer.from('{"alg":"none"}').toString('base64url') + '.e30.AAAA']) {
    await assert.rejects(f.verify(auth), status(401));
  }
  const key = await crypto.subtle.importKey('raw', new Uint8Array(32), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const hmac = await new SignJWT(googleClaims()).setProtectedHeader({ alg: 'HS256', kid: jwk.kid }).sign(key);
  await assert.rejects(f.verify('Bearer ' + hmac), status(401));
});

test('Google absent/unsafe configuration disables verification before any JWKS lookup', async () => {
  for (const env of [{}, { ...ENV, CREATOR_GOOGLE_PUSH_AUDIENCE: undefined },
    { ...ENV, CREATOR_GOOGLE_PUSH_AUDIENCE: 'https://evil.test/api/creators/google-notifications' },
    { ...ENV, CREATOR_GOOGLE_PUSH_AUDIENCE: AUDIENCE + '?other=1' },
    { ...ENV, CREATOR_GOOGLE_PUSH_EMAIL: 'owner@gmail.com' }, { ...ENV, CREATOR_GOOGLE_PUSH_EMAIL: EMAIL + ' ' }]) {
    const f = googleFixture(); await assert.rejects(f.verify(await authorization(), envelope(), env), status(503));
    assert.equal(f.fetches(), 0);
  }
  await assert.rejects(verifyGoogleCreatorNotification(null, envelope(), {}), status(503));
});

const badRtdn = [
  ['wrong package', x => { x.packageName = 'other.app'; }], ['missing event time', x => { delete x.eventTimeMillis; }],
  ['numeric event time', x => { x.eventTimeMillis = Date.now(); }], ['unsafe event time', x => { x.eventTimeMillis = '9999999999999999'; }],
  ['raw receipt only', x => { delete x.subscriptionNotification; x.purchaseToken = 'fixture-private-purchase-token'; }],
  ['two notification kinds', x => { x.testNotification = { version: '1.0' }; }],
  ['one-time product', x => { delete x.subscriptionNotification; x.oneTimeProductNotification = {}; }],
  ['voided order', x => { delete x.subscriptionNotification; x.voidedPurchaseNotification = {}; }],
  ['null subscription', x => { x.subscriptionNotification = null; }],
  ['missing purchase token', x => { delete x.subscriptionNotification.purchaseToken; }],
  ['invalid purchase token', x => { x.subscriptionNotification.purchaseToken = 'token/unsafe'; }],
  ['fractional type', x => { x.subscriptionNotification.notificationType = 1.5; }],
  ['string type', x => { x.subscriptionNotification.notificationType = '2'; }],
  ['unknown schema version', x => { x.subscriptionNotification.version = '2.0'; }],
];
for (const [name, change] of badRtdn) test('Google rejects RTDN with ' + name, async () => {
  const notification = rtdn(); change(notification);
  await assert.rejects(googleFixture().verify(await authorization(), envelope(notification)), status(400));
});

test('Google requires one bounded wrapped message and strict canonical base64/UTF-8 JSON', async () => {
  const f = googleFixture(), auth = await authorization();
  for (const body of [null, [], rtdn(), { messages: [envelope().message] },
    { ...envelope(), messages: [] }, { ...envelope(), subscription: 'not/a/subscription' },
    { ...envelope(), message: { ...envelope().message, messageId: 123 } }]) {
    await assert.rejects(f.verify(auth, body), status(400));
  }
  for (const data of ['', '!!!!', 'e30', 'e30===', ' e30=', 'e31=', 'e30=\n',
    Buffer.from([0xff]).toString('base64'), Buffer.from('not JSON').toString('base64'), Buffer.from('[]').toString('base64')]) {
    const body = envelope(); body.message.data = data;
    await assert.rejects(f.verify(auth, body), status(400));
  }
  await assert.rejects(f.verify(auth, { ...envelope(), padding: 'x'.repeat(32768) }), status(413));
});

test('Google authenticated test messages return no receipt; unknown subscription types remain re-fetch triggers', async () => {
  const f = googleFixture(), auth = await authorization(), notification = rtdn();
  delete notification.subscriptionNotification; notification.testNotification = { version: '1.0' };
  assert.deepEqual(await f.verify(auth, envelope(notification)), { messageId: '12345678901', purchaseToken: null, test: true });
  const future = rtdn(); future.subscriptionNotification.notificationType = 999;
  future.principal = { id: 'forged-account' }; future.grossCents = 999999;
  assert.deepEqual(await f.verify(auth, envelope(future)), {
    messageId: '12345678901', purchaseToken: 'fixture-private-purchase-token', test: false,
  });
});

test('Google cannot use body authorization/principal to override the actual transport header', async () => {
  const f = googleFixture(), body = { ...envelope(), transportAuthorization: await authorization(),
    authorization: await authorization(), principal: { id: ID } };
  await assert.rejects(f.verify('Bearer invalid', body), status(401));
  body.transportAuthorization = 'Bearer forged-body-token';
  const result = await f.verify(await authorization(), body);
  assert.deepEqual(Object.keys(result).sort(), ['messageId', 'purchaseToken', 'test']);
});

async function certificateFixture() {
  const keys = await Promise.all([0, 1, 2].map(() => crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])));
  const certificates = [];
  for (let i = 0; i < 3; i++) {
    const cert = new pki.Certificate();
    cert.version = 2; cert.serialNumber = new asn.Integer({ value: i + 1 });
    cert.subject.typesAndValues.push(new pki.AttributeTypeAndValue({ type: '2.5.4.3', value: new asn.Utf8String({ value: 'TEST ONLY ' + i }) }));
    cert.issuer = i === 0 ? cert.subject : certificates[i - 1].subject;
    cert.notBefore.value = new Date(Date.now() - 86400000); cert.notAfter.value = new Date(Date.now() + 86400000);
    cert.extensions = [new pki.Extension({ extnID: '2.5.29.19', critical: true,
      extnValue: new pki.BasicConstraints({ cA: i < 2, ...(i < 2 ? { pathLenConstraint: 1 - i } : {}) }).toSchema().toBER(false) })];
    if (i > 0) cert.extensions.push(new pki.Extension({ extnID: i === 1 ? '1.2.840.113635.100.6.2.1' : '1.2.840.113635.100.6.11.1',
      extnValue: new asn.Null().toBER(false) }), new pki.Extension({ extnID: '1.3.6.1.5.5.7.1.1',
      extnValue: new pki.InfoAccess({ accessDescriptions: [new pki.AccessDescription({ accessMethod: '1.3.6.1.5.5.7.48.1',
        accessLocation: new pki.GeneralName({ type: 6, value: 'http://ocsp.apple.com/fixture-only' }) })] }).toSchema().toBER(false) }));
    await cert.subjectPublicKeyInfo.importKey(keys[i].publicKey);
    await cert.sign(keys[Math.max(0, i - 1)].privateKey, 'SHA-256');
    certificates.push(cert);
  }
  const roots = [Buffer.from(certificates[0].toSchema().toBER(false))];
  const x5c = certificates.toReversed().map(cert => Buffer.from(cert.toSchema().toBER(false)).toString('base64'));
  const sign = payload => new SignJWT(payload).setProtectedHeader({ alg: 'ES256', x5c }).sign(keys[2].privateKey);
  const outer = appleOuter();
  outer.data.signedTransactionInfo = await sign(appleTransaction());
  outer.data.signedRenewalInfo = await sign(appleRenewal());
  return { roots, signedPayload: await sign(outer), sign, outer };
}
const certificatePromise = certificateFixture();

test('real Apple SDK checks test chain/JWS and every nested signature; production rejects the test root', async () => {
  const fixture = await certificatePromise;
  let checks = 0;
  const verifier = createCreatorNotificationVerifiers({ appleVerifierFactory(_roots, ...args) {
    const sdk = new SignedDataVerifier(fixture.roots, ...args);
    // Offline fixture only: keep the actual SDK chain, OIDs, app checks and JWS verification; replace OCSP I/O.
    sdk.checkOCSPStatus = async () => { checks++; };
    return sdk;
  } });
  assert.equal((await verifier.verifyAppleCreatorNotification(fixture.signedPayload)).transactionId, '100000002');
  assert.equal(checks, 2, 'SDK verifies leaf and intermediate revocation before caching');
  await assert.rejects(verifyAppleCreatorNotification(fixture.signedPayload), status(400));
  const damaged = fixture.signedPayload.slice(0, -8) + 'AAAAAAAA';
  await assert.rejects(verifier.verifyAppleCreatorNotification(damaged), status(400));
  const outer = clone(fixture.outer); outer.data.signedTransactionInfo = damaged;
  await assert.rejects(verifier.verifyAppleCreatorNotification(await fixture.sign(outer)), status(400));
});

test('Workers nodejs_compat executes the actual Apple SDK/OCSP transport and Google JWT/JWKS offline', async t => {
  const fixture = await certificatePromise;
  const contents = `
    import { Buffer } from 'node:buffer';
    import { createCreatorNotificationVerifiers, verifyAppleCreatorNotification, verifyGoogleCreatorNotification }
      from './src/creator-store-notifications.js';
    let ocspFailure;
    const testVerifier = createCreatorNotificationVerifiers({appleVerifierFactory: async (_roots, ...args) => {
      const {SignedDataVerifier} = await import('@apple/app-store-server-library');
      const sdk = new SignedDataVerifier([Buffer.from(${JSON.stringify(fixture.roots[0].toString('base64'))}, 'base64')], ...args);
      const check = sdk.checkOCSPStatus.bind(sdk);
      sdk.checkOCSPStatus = async (...input) => {try {return await check(...input);} catch(error) {
        ocspFailure = {message:error.message, cause:error.cause?.message, stack:error.cause?.stack}; throw error;
      }};
      return sdk;
    }});
    export default {async fetch(request) {
      const body = await request.json();
      try {
        if (body.action === 'google') return Response.json(await verifyGoogleCreatorNotification(body.authorization, body.body, ${JSON.stringify(ENV)}));
        if (body.action === 'ocsp') return Response.json(await testVerifier.verifyAppleCreatorNotification(body.signedPayload));
        if (body.action === 'apple-crypto') {
          let checks = 0;
          const fixtureVerifier = createCreatorNotificationVerifiers({appleVerifierFactory: async (_roots, ...args) => {
            const {SignedDataVerifier} = await import('@apple/app-store-server-library');
            const sdk = new SignedDataVerifier([Buffer.from(${JSON.stringify(fixture.roots[0].toString('base64'))}, 'base64')], ...args);
            sdk.checkOCSPStatus = async () => {checks++;};
            return sdk;
          }});
          return Response.json({proof:await fixtureVerifier.verifyAppleCreatorNotification(body.signedPayload), checks});
        }
        if (body.action === 'sdk') {
          const {SignedDataVerifier, VerificationException, Environment} = await import('@apple/app-store-server-library');
          const sdk = new SignedDataVerifier([Buffer.from(${JSON.stringify(fixture.roots[0].toString('base64'))}, 'base64')], true, Environment.PRODUCTION, ${JSON.stringify(APP)}, ${APP_ID});
          try { await sdk.verifyAndDecodeNotification(${JSON.stringify(SAMPLE_JWS)}); return Response.json({sdkRejected:false}); }
          catch(error) { return Response.json({sdkRejected:error instanceof VerificationException}); }
        }
        return Response.json(await verifyAppleCreatorNotification(body.signedPayload));
      } catch(error) {return Response.json({error:error.message, ocspFailure},{status:error.status || 500});}
    }};`;
  // Wrangler supplies these compatibility-date-specific aliases, unlike the minimal existing test bundler.
  const { env: compatibility } = defineEnv({ presets: [getCloudflarePreset({
    compatibilityDate: '2025-12-01', compatibilityFlags: ['nodejs_compat'],
  })], resolve: true });
  const builtins = new Set(builtinModules.flatMap(id => [id, 'node:' + id]));
  const bundle = await build({ ...workerBundleOptions, alias: { ...compatibility.alias,
    'node-fetch': new URL('../src/creator-store-notifications.js', import.meta.url).pathname },
    plugins: [{ name: 'wrangler-node-cjs-default-interop', setup(builder) {
      builder.onResolve({ filter: /^(node:|[a-z])/ }, args => {
        if (args.kind === 'require-call' && builtins.has(args.path)) return { path: args.path, namespace: 'node-cjs' };
      });
      builder.onLoad({ filter: /.*/, namespace: 'node-cjs' }, args => ({
        contents: `import libDefault from ${JSON.stringify(args.path)}; module.exports = libDefault;`,
        resolveDir: process.cwd(),
      }));
    } }], stdin: { contents, resolveDir: process.cwd() } });
  const requests = [];
  const mf = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2025-12-01', compatibilityFlags: ['nodejs_compat'],
    modules: true, script: bundle.outputFiles[0].text, log: new Log(LogLevel.NONE), outboundService: async request => {
      const url = new URL(request.url); requests.push({ url: url.href, method: request.method });
      if (url.href === 'https://www.googleapis.com/oauth2/v3/certs') return Response.json(jwks);
      assert.equal(url.href, 'http://ocsp.apple.com/fixture-only', 'unexpected network must never escape offline fixtures');
      assert.equal(request.method, 'POST');
      return new Response('offline OCSP unavailable', { status: 503 });
    },
  }));
  t.after(() => mf.dispose());
  const call = body => mf.dispatchFetch('https://test/verify', { method: 'POST', body: JSON.stringify(body) });
  const sdk = await call({ action: 'sdk' }); assert.equal(sdk.status, 200);
  assert.deepEqual(await sdk.json(), { sdkRejected: true });
  const badApple = await call({ signedPayload: fixture.signedPayload });
  assert.equal(badApple.status, 400); assert.equal(requests.length, 0);
  const goodApple = await call({ action: 'apple-crypto', signedPayload: fixture.signedPayload });
  assert.equal(goodApple.status, 200, await goodApple.clone().text());
  const appleProof = await goodApple.json();
  assert.equal(appleProof.proof.transactionId, '100000002'); assert.equal(appleProof.checks, 2);
  assert.equal(appleProof.proof.notificationType, 'DID_RENEW');
  assert.equal(requests.length, 0, 'positive synthetic-chain crypto test must remain offline');
  const goodGoogle = await call({ action: 'google', authorization: await authorization(), body: envelope() });
  assert.equal(goodGoogle.status, 200);
  assert.equal((await goodGoogle.json()).purchaseToken, 'fixture-private-purchase-token');
  const ocsp = await call({ action: 'ocsp', signedPayload: fixture.signedPayload });
  const diagnostic = await ocsp.text();
  assert.equal(ocsp.status, 503, diagnostic);
  assert.ok(requests.some(x => x.url === 'http://ocsp.apple.com/fixture-only'), 'actual SDK OCSP transport must reach the fixture: ' + diagnostic);
});

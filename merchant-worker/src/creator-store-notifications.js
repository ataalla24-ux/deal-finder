import { Buffer } from 'node:buffer';
import { X509Certificate } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const APP = 'com.stefanataalla.freefinderwien';
const APPLE_APP_ID = 6758958213;
const PRODUCTION = 'Production';
const GOOGLE_AUDIENCE = 'https://freefinder-merchant-backend.freefinder-stefan.workers.dev/api/creators/google-notifications';
const GOOGLE_KEYS = 'https://www.googleapis.com/oauth2/v3/certs';
const MAX_BODY = 32768, MAX_JWS = 32768, DEADLINE_MS = 12000;
// Wrangler integration: alias node-fetch to this module. This preserves the SDK's OCSP verifier,
// rather than unenv's native-Response shim (which lacks the node-fetch v2 buffer() method).
export const Headers = globalThis.Headers;
export default async function appleOCSPFetch(input, options = {}) {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || !/^ocsp\d*\.apple\.com$/.test(url.hostname) ||
      url.username || url.password || url.port || url.hash || options.method !== 'POST' ||
      new Headers(options.headers).get('content-type') !== 'application/ocsp-request') throw problem(503);
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([(async () => {
      const response = await fetch(url, { method: 'POST', headers: options.headers, body: options.body,
        redirect: 'manual', signal: controller.signal });
      if (!response.ok) {
        await response.body?.cancel();
        return { ok: false, buffer: async () => Buffer.alloc(0) };
      }
      if (!response.body || Number(response.headers.get('content-length')) > MAX_BODY) throw problem(503);
      const reader = response.body.getReader(), chunks = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_BODY) throw problem(503);
          chunks.push(Buffer.from(value));
        }
      } finally { await reader.cancel().catch(() => {}); }
      const bytes = Buffer.concat(chunks);
      return { ok: true, buffer: async () => bytes };
    })(), new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(problem(503)); }, 8000); })]);
  } finally { clearTimeout(timer); controller.abort(); }
}
// Public Apple Root CA G3, copied unchanged from app-attest-risk.js.
// Provenance: https://www.apple.com/certificateauthority/AppleRootCA-G3.cer
const APPLE_ROOT_G3 = `-----BEGIN CERTIFICATE-----
MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwS
QXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9u
IEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcN
MTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBS
b290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9y
aXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49
AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtf
TjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517
IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySr
MA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gA
MGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4
at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM
6BgD56KyKA==
-----END CERTIFICATE-----`;

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const transactionID = value => typeof value === 'string' && /^\d{5,30}$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(value);
const problem = status => Object.assign(new Error(status === 503 ? 'Store notification verification unavailable.' : 'Invalid store notification.'), { status });

function compactJWS(value) {
  if (typeof value !== 'string' || value.length > MAX_JWS ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) throw problem(400);
  return value;
}

async function boundedVerification(operation) {
  let timer;
  const until = Date.now() + DEADLINE_MS;
  const checkDeadline = () => { if (Date.now() >= until) throw problem(503); };
  try {
    return await Promise.race([operation(checkDeadline), new Promise((_, reject) => {
      timer = setTimeout(() => reject(problem(503)), DEADLINE_MS);
    })]);
  } finally { clearTimeout(timer); }
}

function googleConfig(env) {
  const audience = env?.CREATOR_GOOGLE_PUSH_AUDIENCE, email = env?.CREATOR_GOOGLE_PUSH_EMAIL;
  if (audience !== GOOGLE_AUDIENCE || typeof email !== 'string' || email.length > 320 ||
      !/^[a-z0-9][a-z0-9._-]*@[a-z0-9][a-z0-9.-]*\.gserviceaccount\.com$/.test(email)) throw problem(503);
  return { audience, email };
}

function googleMessage(body) {
  if (!object(body)) throw problem(400);
  let serialized;
  try { serialized = JSON.stringify(body); } catch { throw problem(400); }
  if (typeof serialized !== 'string') throw problem(400);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_BODY) throw problem(413);
  const envelope = JSON.parse(serialized), message = envelope.message;
  if (!object(message) || envelope.messages !== undefined ||
      typeof message.messageId !== 'string' || !/^\d{1,128}$/.test(message.messageId) ||
      typeof envelope.subscription !== 'string' ||
      !/^projects\/[a-z][a-z0-9-]{4,62}[a-z0-9]\/subscriptions\/[A-Za-z][A-Za-z0-9._~+%-]{2,254}$/.test(envelope.subscription)) throw problem(400);
  const encoded = message.data;
  if (typeof encoded !== 'string' || !encoded.length || encoded.length > MAX_BODY || encoded.length % 4 !== 0 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw problem(400);
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded || bytes.length > MAX_BODY) throw problem(400);
  let notification;
  try { notification = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw problem(400); }
  if (!object(notification) || notification.packageName !== APP || notification.version !== '1.0' ||
      typeof notification.eventTimeMillis !== 'string' || !/^\d{1,16}$/.test(notification.eventTimeMillis) ||
      !Number.isSafeInteger(Number(notification.eventTimeMillis)) || Number(notification.eventTimeMillis) <= 0) throw problem(400);
  const kinds = ['subscriptionNotification', 'testNotification', 'oneTimeProductNotification',
    'voidedPurchaseNotification', 'pendingRefundReviewNotification'].filter(key => Object.hasOwn(notification, key));
  if (kinds.length !== 1 || !['subscriptionNotification', 'testNotification'].includes(kinds[0])) throw problem(400);
  if (kinds[0] === 'testNotification') {
    if (!object(notification.testNotification) || notification.testNotification.version !== '1.0') throw problem(400);
    return { messageId: message.messageId, purchaseToken: null, test: true };
  }
  const subscription = notification.subscriptionNotification;
  if (!object(subscription) || subscription.version !== '1.0' ||
      !Number.isSafeInteger(subscription.notificationType) || subscription.notificationType <= 0 ||
      typeof subscription.purchaseToken !== 'string' || !/^[A-Za-z0-9._-]{10,4096}$/.test(subscription.purchaseToken)) throw problem(400);
  return { messageId: message.messageId, purchaseToken: subscription.purchaseToken, test: false };
}

// Injection is confined to this helper's arguments for offline tests. Public entry points never read factories/keys from env.
export function createCreatorNotificationVerifiers({
  appleVerifierFactory,
  googleKeyResolverFactory = createRemoteJWKSet,
} = {}) {
  let appleVerifier, googleKeys;
  return {
    async verifyAppleCreatorNotification(signedPayload) {
      compactJWS(signedPayload);
      let sdk;
      try {
        return await boundedVerification(async checkDeadline => {
          // jsrsasign initializes randomness: load Apple's unmodified SDK only inside a Worker request, never global scope.
          // SDK 3.1.0 includes upstream-deprecated jsrsasign 11.1.5; dependency policy remains the parent's responsibility.
          sdk = await import('@apple/app-store-server-library');
          checkDeadline();
          const factory = appleVerifierFactory || ((...args) => new sdk.SignedDataVerifier(...args));
          appleVerifier ||= await factory([new X509Certificate(APPLE_ROOT_G3).raw], true, PRODUCTION, APP, APPLE_APP_ID);
          checkDeadline();
          const notification = await appleVerifier.verifyAndDecodeNotification(signedPayload);
          checkDeadline();
          if (!object(notification) || notification.version !== '2.0' || !uuid(notification.notificationUUID) ||
              typeof notification.notificationType !== 'string' || !/^[A-Z_]{1,80}$/.test(notification.notificationType) ||
              !object(notification.data) || notification.data.environment !== PRODUCTION ||
              notification.data.bundleId !== APP || notification.data.appAppleId !== APPLE_APP_ID ||
              ['summary', 'externalPurchaseToken', 'appData'].some(key => Object.hasOwn(notification, key))) throw problem(400);
          const data = notification.data;
          const test = notification.notificationType === 'TEST';
          if (test && data.signedTransactionInfo === undefined && data.signedRenewalInfo === undefined) {
            return { notificationId: notification.notificationUUID, notificationType: notification.notificationType, transactionId: null,
              rawTransaction: null, renewalInfo: null, test: true };
          }
          const rawTransaction = await appleVerifier.verifyAndDecodeTransaction(compactJWS(data.signedTransactionInfo));
          checkDeadline();
          if (!object(rawTransaction) || rawTransaction.environment !== PRODUCTION || rawTransaction.bundleId !== APP ||
              !transactionID(rawTransaction.transactionId) || !transactionID(rawTransaction.originalTransactionId) ||
              typeof rawTransaction.productId !== 'string' || !rawTransaction.productId.length || rawTransaction.productId.length > 200) throw problem(400);
          let renewalInfo = null;
          if (data.signedRenewalInfo !== undefined) {
            renewalInfo = await appleVerifier.verifyAndDecodeRenewalInfo(compactJWS(data.signedRenewalInfo));
            checkDeadline();
            if (!object(renewalInfo) || renewalInfo.environment !== PRODUCTION ||
                renewalInfo.originalTransactionId !== rawTransaction.originalTransactionId ||
                renewalInfo.productId !== rawTransaction.productId) throw problem(400);
          }
          // Product/offer eligibility, receipt accounting and access remain the server caller's responsibility.
          return { notificationId: notification.notificationUUID, notificationType: notification.notificationType, transactionId: rawTransaction.transactionId,
            rawTransaction, renewalInfo, test };
        });
      } catch (error) {
        if ((sdk && error instanceof sdk.VerificationException && error.status === sdk.VerificationStatus.RETRYABLE_VERIFICATION_FAILURE) || error?.status === 503) {
          throw problem(503);
        }
        throw problem(400);
      }
    },

    async verifyGoogleCreatorNotification(authorization, body, env) {
      const { audience, email } = googleConfig(env);
      const match = typeof authorization === 'string' && /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(authorization);
      if (!match || authorization.length > MAX_JWS) throw problem(401);
      let payload;
      try {
        googleKeys ||= googleKeyResolverFactory(new URL(GOOGLE_KEYS), { timeoutDuration: 5000, cooldownDuration: 30000, cacheMaxAge: 600000 });
        ({ payload } = await jwtVerify(match[1], googleKeys, {
          algorithms: ['RS256'], issuer: ['accounts.google.com', 'https://accounts.google.com'], audience,
          requiredClaims: ['iss', 'aud', 'sub', 'iat', 'exp', 'email', 'email_verified'], clockTolerance: 5,
        }));
      } catch (error) {
        if (error?.code === 'ERR_JWKS_TIMEOUT' || error instanceof TypeError) throw problem(503);
        throw problem(401);
      }
      const now = Date.now() / 1000;
      if (payload.aud !== audience || payload.email !== email || payload.email_verified !== true ||
          typeof payload.sub !== 'string' || !/^\d{1,128}$/.test(payload.sub) ||
          !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) ||
          payload.iat > now + 5 || payload.iat < now - 3605 || payload.exp <= payload.iat || payload.exp - payload.iat > 3600) throw problem(401);
      // RTDN authenticates a re-fetch trigger, not a charge, price, order, account principal or entitlement.
      return googleMessage(body);
    },
  };
}

const productionVerifiers = createCreatorNotificationVerifiers();

// Apple POST JSON: { signedPayload: "<App Store Server Notifications V2 JWS>" }; pass only its signedPayload here.
export async function verifyAppleCreatorNotification(signedPayload) {
  return productionVerifiers.verifyAppleCreatorNotification(signedPayload);
}

// Google Authorization: Bearer <Google OIDC JWT>; body is the parsed, wrapped Pub/Sub { message, subscription } object.
export async function verifyGoogleCreatorNotification(authorization, body, env) {
  return productionVerifiers.verifyGoogleCreatorNotification(authorization, body, env);
}

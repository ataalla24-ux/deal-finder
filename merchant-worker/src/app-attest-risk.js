import { Buffer } from 'node:buffer';
import { createHash, createPublicKey, X509Certificate } from 'node:crypto';
import { fromBER, Integer, OctetString, Sequence, Set as ASNSet } from 'asn1js';
import { Certificate, ContentInfo, SignedData } from 'pkijs';
import { importPKCS8, SignJWT } from 'jose';

const APP_ID = '78C2SA4JP3.com.stefanataalla.freefinderwien';
const TEAM = '78C2SA4JP3';
const ENDPOINT = 'https://data.appattest.apple.com/v1/attestationData';
const MAX_BYTES = 32768;
const FRESHNESS = 5 * 60000;
// Apple pins this root for App Attest risk receipts, separately from attestation x5c.
const ROOT = `-----BEGIN CERTIFICATE-----
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
const hash = value => createHash('sha256').update(value).digest('hex');
const unavailable = () => Object.assign(new Error('Apples Geräteprüfung ist gerade nicht verfügbar. Dein Guthaben bleibt erhalten.'), { status: 503 });

function der(bytes) {
  if (!bytes?.byteLength || bytes.byteLength > MAX_BYTES) throw Error('size');
  const value = fromBER(bytes, { maxDepth: 20, maxNodes: 1000, maxContentLength: MAX_BYTES });
  if (value.offset !== bytes.byteLength || value.result.error) throw Error('ASN.1');
  return value.result;
}
function decode(value) {
  if (typeof value !== 'string' || value.length > MAX_BYTES || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw Error('base64');
  const bytes = Buffer.from(value, 'base64');
  if (!bytes.length || bytes.toString('base64') !== value) throw Error('base64');
  return bytes;
}
function text(bytes) {
  if (!bytes) throw Error('missing field');
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
function date(bytes) {
  const value = text(bytes);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) throw Error('date');
  const result = Date.parse(value);
  if (!Number.isFinite(result) || new Date(result).toISOString() !== value) throw Error('date');
  return result;
}

export async function verifyAppleRiskReceipt(receipt, publicKey, now, type = 'RECEIPT') {
  try {
    if (!Number.isFinite(now) || !['ATTEST', 'RECEIPT'].includes(type)) throw Error('arguments');
    const content = new ContentInfo({ schema: der(decode(receipt)) });
    if (content.contentType !== '1.2.840.113549.1.7.2') throw Error('CMS');
    const signed = new SignedData({ schema: content.content });
    if (signed.signerInfos.length !== 1 || !signed.certificates?.length || signed.certificates.length > 4 ||
        signed.encapContentInfo.eContentType !== '1.2.840.113549.1.7.1' || !signed.encapContentInfo.eContent) throw Error('CMS');
    const root = new Certificate({ schema: der(new X509Certificate(ROOT).raw) });
    const verified = await signed.verify({ signer: 0, trustedCerts: [root], checkChain: true,
      checkDate: new Date(now), extendedMode: true });
    if (!verified.signatureVerified || !verified.signerCertificateVerified ||
        !verified.signerCertificate?.extensions?.some(x => x.extnID === '1.2.840.113635.100.12.15')) throw Error('signature');
    const payload = der(signed.encapContentInfo.eContent.getValue());
    if (!(payload instanceof ASNSet) || payload.valueBlock.value.length > 32) throw Error('payload');
    const fields = new Map();
    for (const item of payload.valueBlock.value) {
      if (!(item instanceof Sequence) || item.valueBlock.value.length !== 3) throw Error('field');
      const [kind, version, value] = item.valueBlock.value;
      if (!(kind instanceof Integer) || kind.valueBlock.isHexOnly || kind.valueBlock.valueDec < 1 ||
          !(version instanceof Integer) || version.valueBlock.isHexOnly || version.valueBlock.valueDec !== 1 ||
          !(value instanceof OctetString) || value.idBlock.isConstructed || fields.has(kind.valueBlock.valueDec)) throw Error('field');
      fields.set(kind.valueBlock.valueDec, Buffer.from(value.getValue()));
    }
    const createdAt = date(fields.get(12)), expiresAt = date(fields.get(21));
    if (text(fields.get(2)) !== APP_ID || text(fields.get(6)) !== type ||
        fields.has(7) && text(fields.get(7)) !== 'production' ||
        createdAt > now + 30000 || now - createdAt > FRESHNESS || expiresAt <= now || expiresAt <= createdAt) throw Error('identity/time');
    // Field 3 is Apple's DER credential certificate; compare its SPKI, not the certificate bytes.
    const attestedKey = new X509Certificate(fields.get(3)).publicKey.export({ type: 'spki', format: 'der' });
    const expectedKey = createPublicKey(publicKey).export({ type: 'spki', format: 'der' });
    if (!attestedKey.equals(expectedKey)) throw Error('key');
    const result = { version: 1, createdAt, expiresAt, receiptHash: hash(receipt), keyHash: hash(publicKey), type };
    if (type === 'RECEIPT') {
      const metric = text(fields.get(17));
      if (!/^(0|[1-9]\d{0,8})$/.test(metric)) throw Error('metric');
      const notBefore = date(fields.get(19));
      if (notBefore < createdAt || notBefore >= expiresAt) throw Error('refresh date');
      Object.assign(result, { metric: Number(metric), notBefore });
    }
    return result;
  } catch { throw unavailable(); }
}

function validCached(key, now) {
  const r = key.risk;
  return r?.version === 1 && r.type === 'RECEIPT' && r.receiptHash === hash(key.receipt) && r.keyHash === hash(key.publicKey) &&
    Number.isSafeInteger(r.metric) && r.metric >= 0 && Number.isFinite(r.createdAt) && r.createdAt <= now &&
    Number.isFinite(r.notBefore) && now < r.notBefore && r.notBefore < r.expiresAt;
}
async function boundedText(response) {
  if (!response.body || Number(response.headers.get('content-length')) > MAX_BYTES) throw unavailable();
  const reader = response.body.getReader();
  let length = 0;
  const chunks = [];
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > MAX_BYTES) throw unavailable();
      chunks.push(Buffer.from(next.value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks).toString('utf8').trim();
}

export async function assessAppleRisk(env, key, now, fetcher = fetch, verifier = verifyAppleRiskReceipt) {
  // This is a conservative review threshold, not proof of fraud. Reinstalls also increase the metric.
  const threshold = Number(env.APP_ATTEST_REVIEW_KEY_COUNT || 10);
  if (!Number.isSafeInteger(threshold) || threshold < 2 || threshold > 100) throw unavailable();
  if (validCached(key, now)) return { ...key, riskReview: key.risk.metric >= threshold };
  if (!/^[A-Z0-9]{10}$/.test(env.APP_ATTEST_KEY_ID || '') || !env.APP_ATTEST_PRIVATE_KEY ||
      !key.receipt || key.risk?.expiresAt <= now || key.initialReceipt?.expiresAt <= now && !key.risk) throw unavailable();
  const controller = new AbortController();
  let timer;
  const operation = async () => {
    const signingKey = await importPKCS8(env.APP_ATTEST_PRIVATE_KEY, 'ES256');
    const token = await new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: env.APP_ATTEST_KEY_ID })
      .setIssuer(TEAM).setIssuedAt(Math.floor(now / 1000)).sign(signingKey);
    const response = await fetcher(ENDPOINT, { method: 'POST', redirect: 'manual', signal: controller.signal,
      headers: { Authorization: token, 'Content-Type': 'text/plain' }, body: key.receipt });
    if (response.status !== 200) { await response.body?.cancel().catch(() => {}); throw unavailable(); }
    const receipt = await boundedText(response);
    const risk = await verifier(receipt, key.publicKey, now, 'RECEIPT');
    return { ...key, receipt, risk, riskReview: risk.metric >= threshold };
  };
  try {
    return await Promise.race([operation(), new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(unavailable()); }, 8000);
    })]);
  } catch { throw unavailable(); }
  finally { clearTimeout(timer); controller.abort(); }
}

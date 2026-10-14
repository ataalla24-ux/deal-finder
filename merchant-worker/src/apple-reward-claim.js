import { Buffer } from 'node:buffer';
import { X509Certificate } from 'node:crypto';
import cbor from 'cbor';
import { verifyAttestation, verifyAssertion } from 'node-app-attest';
import { requireRecentAuth } from './account-auth.js';
import { assessAppleRisk, verifyAppleRiskReceipt } from './app-attest-risk.js';
import { referralHash, referralPurchase, referralEvidence, isMatchingAppleRedemption } from './referral-months.js';

const APP = 'com.stefanataalla.freefinderwien';
const TEAM = '78C2SA4JP3';
const TTL = 5 * 60000;
const fail = (message, status = 409) => { throw Object.assign(new Error(message), { status }); };
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
const keyID = value => typeof value === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(value) && Buffer.from(value, 'base64').toString('base64') === value;
function binary(value, max) {
  if (typeof value !== 'string' || value.length > max || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) fail('Ungültiger Gerätenachweis.');
  const decoded = Buffer.from(value, 'base64');
  if (!decoded.length || decoded.toString('base64') !== value) fail('Ungültiger Gerätenachweis.');
  return decoded;
}
function object(data) {
  const values = cbor.decodeAllSync(data, { max_depth: 8 });
  if (values.length !== 1 || !values[0] || typeof values[0] !== 'object') fail('Ungültiger Gerätenachweis.');
  return values[0];
}
export function verifyAppleDeviceKey(body, payload, now = Date.now()) {
  try {
    const attestation = binary(body.attestation, 12000);
    const decoded = object(attestation);
    const certs = decoded.attStmt?.x5c;
    if (!Array.isArray(certs) || certs.length !== 2 || !certs.every(Buffer.isBuffer)) throw Error();
    const chain = certs.map(raw => new X509Certificate(raw));
    if (chain[0].ca || !chain[1].ca || chain.some(cert =>
      !(Date.parse(cert.validFrom) <= now && now < Date.parse(cert.validTo)))) throw Error();
    if (chain[0].publicKey.asymmetricKeyType !== 'ec' ||
        chain[0].publicKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw Error();
    if (!Buffer.isBuffer(decoded.authData) || decoded.authData.length < 87 ||
        decoded.authData.readUInt16BE(53) !== 32) throw Error();
    const result = verifyAttestation({ attestation, challenge: payload, keyId: body.keyId,
      bundleIdentifier: APP, teamIdentifier: TEAM, allowDevelopmentEnvironment: false });
    if (result.environment !== 'production') throw Error();
    return { publicKey: result.publicKey, receipt: result.receipt.toString('base64') };
  } catch { fail('Apple konnte dieses Gerät noch nicht bestätigen. Dein Guthaben bleibt erhalten.'); }
}
export function verifyAppleDeviceAssertion(body, payload, key) {
  try {
    const assertion = binary(body.assertion, 2000);
    const decoded = object(assertion);
    if (!Buffer.isBuffer(decoded.authenticatorData) || decoded.authenticatorData.length !== 37 ||
        !Buffer.isBuffer(decoded.signature) || decoded.signature.length < 64 || decoded.signature.length > 80 ||
        !Number.isSafeInteger(key.signCount) || key.signCount < 0) throw Error();
    const result = verifyAssertion({ assertion, payload, publicKey: key.publicKey,
      bundleIdentifier: APP, teamIdentifier: TEAM, signCount: key.signCount });
    if (!Number.isSafeInteger(result.signCount) || result.signCount <= key.signCount) throw Error();
    return result.signCount;
  } catch { fail('Gerätenachweis abgelaufen. Bitte erneut prüfen.'); }
}
export function appleClaimPayload({ purpose, accountId, keyId, rewardId, transactionId = '', nonce }) {
  return ['FreeFinder:apple-reward:v1', purpose, accountId, keyId, rewardId, transactionId, nonce].join('\n');
}

export function appleRewardClaims(Base) {
  return class extends Base {
    verifyAppleDeviceKey(body, payload, now) { return verifyAppleDeviceKey(body, payload, now); }
    verifyAppleDeviceAssertion(body, payload, key) { return verifyAppleDeviceAssertion(body, payload, key); }
    verifyAppleRiskReceipt(receipt, publicKey, now, type) { return verifyAppleRiskReceipt(receipt, publicKey, now, type); }
    assessAppleRisk(key, now) { return assessAppleRisk(this.env, key, now); }
    async appleClaim(action, body, account, accountKey, now) {
      if (this.env.REFERRAL_APPLE_ATTESTED_CLAIMS_ENABLED !== '1') fail('Die sichere Apple-Einlösung ist noch nicht verfügbar.', 503);
      if (body.platform !== 'ios' || !keyID(body.keyId) || !uuid(body.rewardId)) fail('Ungültige Apple-Anfrage.', 400);
      const reward = account.rewards.find(r => r.id === body.rewardId);
      if (!reward || !['earned', 'store_confirmation', 'redeemed'].includes(reward.state) ||
          reward.redemptionPlatform && reward.redemptionPlatform !== 'ios') fail('Keine passende Apple-Gutschrift.');
      const deviceKey = 'apple-device:' + await referralHash(body.keyId);
      const enrolled = await this.storage.get(deviceKey);
      if (enrolled && (enrolled.accountId !== account.id || enrolled.deletedAt)) fail('Dieses Gerät ist bereits einem anderen Konto zugeordnet.');
      const indexKey = 'apple-devices:' + account.id;
      const purpose = action === 'apple-claim-key' ? 'enroll' : action === 'apple-claim-confirm' ? 'claim' : body.purpose;
      if (!['enroll', 'claim'].includes(purpose) || purpose === 'claim' && !/^\d{5,30}$/.test(body.transactionId || '')) fail('Ungültige Apple-Anfrage.', 400);
      const challengeKey = `apple-challenge:${account.id}:${purpose}`;
      if (action === 'apple-claim-challenge') {
        if (purpose === 'enroll' && enrolled) return { ok: true, enrolled: true };
        if (purpose === 'enroll') {
          requireRecentAuth(body.principal.authTime, now / 1000);
          if ((await this.storage.get(indexKey) || []).length >= 10) fail('Bitte kontaktiere den Support, um ein weiteres Gerät zu verbinden.');
        } else if (!enrolled || reward.state !== 'store_confirmation') fail('Bitte zuerst das Gerät und die Gutschrift bestätigen.');
        const challenge = { purpose, accountId: account.id, keyId: body.keyId, rewardId: reward.id,
          transactionId: purpose === 'claim' ? body.transactionId : '', nonce: crypto.randomUUID(), expiresAt: now + TTL };
        await this.storage.put(challengeKey, challenge);
        return { ok: true, enrolled: false, nonce: challenge.nonce, expiresAt: challenge.expiresAt };
      }
      if (action === 'apple-claim-key' && enrolled) {
        if (enrolled.attestationHash !== await referralHash(body.attestation || '')) fail('Gerätenachweis passt nicht.');
        return { ok: true, enrolled: true };
      }
      const challenge = await this.storage.get(challengeKey);
      if (!challenge || challenge.expiresAt <= now || challenge.expiresAt > now + TTL || challenge.nonce !== body.nonce ||
          challenge.accountId !== account.id || challenge.keyId !== body.keyId || challenge.rewardId !== reward.id ||
          challenge.purpose !== purpose || challenge.transactionId !== (purpose === 'claim' ? body.transactionId : '')) {
        fail('Gerätenachweis abgelaufen. Bitte erneut prüfen.');
      }
      const payload = appleClaimPayload(challenge);
      if (action === 'apple-claim-key') {
        requireRecentAuth(body.principal.authTime, now / 1000);
        const devices = await this.storage.get(indexKey) || [];
        if (devices.length >= 10) fail('Bitte kontaktiere den Support, um ein weiteres Gerät zu verbinden.');
        const verified = this.verifyAppleDeviceKey(body, payload, now);
        const initialReceipt = await this.verifyAppleRiskReceipt(verified.receipt, verified.publicKey, now, 'ATTEST');
        await this.storage.transaction(async tx => {
          await tx.put({ [deviceKey]: { accountId: account.id, ...verified, initialReceipt, signCount: 0,
            attestationHash: await referralHash(body.attestation), createdAt: now }, [indexKey]: [...devices, deviceKey] });
          await tx.delete(challengeKey);
        });
        return { ok: true, enrolled: true };
      }
      if (!enrolled || reward.state !== 'store_confirmation') fail('Keine offene Apple-Bestätigung.');
      const signCount = this.verifyAppleDeviceAssertion(body, payload, enrolled);
      // Consume replay protection before network I/O. A timeout requires a fresh assertion, never another purchase.
      await this.storage.transaction(async tx => {
        await tx.put(deviceKey, { ...enrolled, signCount });
        await tx.delete(challengeKey);
      });
      const assessed = await this.assessAppleRisk({ ...enrolled, signCount }, now);
      // Keep the verified replacement receipt even when review is required. Never erase earned credit.
      await this.storage.put(deviceKey, assessed);
      if (assessed.riskReview) fail('Dieser Gerätenachweis braucht eine Nachprüfung. Bitte kontaktiere den Support. Dein Guthaben bleibt erhalten.');
      const result = await this.appleTransaction(body.transactionId);
      if (!result.ok || result.environment !== 'Production') fail('Apple ist gerade nicht erreichbar.', 503);
      let raw;
      try { raw = JSON.parse(atob(result.signedTransactionInfo.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); }
      catch { fail('Apple-Antwort konnte nicht bestätigt werden.', 503); }
      if (raw.transactionId !== body.transactionId || !/^\d{5,30}$/.test(raw.originalTransactionId || '') ||
          raw.appAccountToken != null || raw.inAppOwnershipType !== 'PURCHASED' || !['AUT', 'DEU'].includes(raw.storefront)) {
        fail('Diese Apple-Bestätigung passt nicht zur Gutschrift.');
      }
      const purchase = referralPurchase('ios', raw, account.id, now,
        { historicalAppleRedemption: true, attestedAppleOwner: account.id });
      if (!isMatchingAppleRedemption(purchase, reward, now)) fail('Diese Apple-Bestätigung passt nicht zur Gutschrift.');
      const chainKey = 'apple-owner:' + await referralHash(purchase.key);
      const previous = await this.storage.get(chainKey);
      const usedPurchase = await this.storage.get('purchase:' + await referralHash(purchase.key));
      const receiptKey = 'redemption:' + await referralHash('ios:' + purchase.transactionId);
      const usedReceipt = await this.storage.get(receiptKey);
      if (previous && previous.accountId !== account.id || usedPurchase && usedPurchase !== account.id ||
          usedReceipt && (usedReceipt.accountId !== account.id || usedReceipt.rewardId !== reward.id)) {
        fail('Dieser Kauf ist bereits zugeordnet. Bitte kontaktiere den Support.');
      }
      reward.state = 'redeemed'; reward.redeemedAt = now; reward.newExpiry = purchase.expires;
      reward.redemptionEvidence = referralEvidence('ios', purchase, now);
      await this.storage.transaction(async tx => {
        await tx.put({ [accountKey]: account, [receiptKey]: { accountId: account.id, rewardId: reward.id },
          [chainKey]: previous || { accountId: account.id, establishedAt: now, method: 'app_attest', receiptId: purchase.transactionId } });
      });
      // This is a local, immutable ownership binding. Never replace Apple's appAccountToken.
      return this.status(account);
    }
    async appleBoundOwner(raw, account) {
      if (this.env.REFERRAL_APPLE_ATTESTED_CLAIMS_ENABLED !== '1' || raw.appAccountToken != null ||
          !/^\d{5,30}$/.test(raw.originalTransactionId || '')) return null;
      const binding = await this.storage.get('apple-owner:' + await referralHash('ios:' + raw.originalTransactionId));
      return binding?.method === 'app_attest' && binding.accountId === account.id ? account.id : null;
    }
    async accountAction(action, body, account, key, now) {
      // Remove public keys and Apple risk receipts before the account tombstone makes retries a no-op.
      if (action === 'delete' && (!account || account.recoverable)) {
        const indexKey = 'apple-devices:' + body.accountId;
        for (const device of await this.storage.get(indexKey) || []) {
          await this.storage.put(device, { accountId: body.accountId, deletedAt: now });
        }
        await this.storage.delete([indexKey, `apple-challenge:${body.accountId}:enroll`, `apple-challenge:${body.accountId}:claim`]);
      }
      return super.accountAction(action, body, account, key, now);
    }
  };
}

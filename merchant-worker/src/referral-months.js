import { authenticateAccount, boundedJSON, requireRecentAuth } from './account-auth.js';
const DAY = 86400000;
const SOURCE_SCAN = 'referral-source-scan:v1';
const SOURCE_SCAN_INTERVAL = 120000;
const SOURCE_REVIEW_COUNTS = ['checked', 'verified', 'revoked', 'unverified', 'skipped'];
const PREFIX = '/api/referral-months/';
const APP = 'com.stefanataalla.freefinderwien';
const APPLE_PRODUCTS = new Set([`${APP}.premium.monthly`, `${APP}.premium.yearly`]);
const PLAY_PRODUCTS = new Set(['freefinder.pro.monthly', 'freefinder.pro.yearly']);
const PLAY_REWARD_OFFER = 'referral-earned-month';
const PENDING_REWARDS = ['store_pending', 'store_confirmation', 'store_subscription'];
const SUPPORT_ACTIONS = ['support-cases', 'support-case', 'support-review'];
const json = (value, status = 200) => Response.json(value, { status, headers: {
  'cache-control': 'no-store', 'access-control-allow-origin': '*',
} });
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
const receiptID = value => typeof value === 'string' && /^[A-Za-z0-9._-]{5,200}$/.test(value);
export async function referralHash(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
    .map(x => x.toString(16).padStart(2, '0')).join('');
}
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function decodeStoreJWS(value) {
  // Called ONLY with the response from Apple's authenticated server API, never a client JWS.
  try { return JSON.parse(atob(value.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); }
  catch { fail('Store-Antwort konnte nicht gelesen werden.', 502); }
}
export function referralPurchase(platform, raw, account, now = Date.now(), { historicalAppleRedemption = false, rewardSubscriptionConfirmation = false, attestedAppleOwner = null } = {}) {
  if (platform === 'ios') {
    // Expired proof is only for settling a reserved, already-consumed free code, never for granting access or new trials.
    const historicalCode = historicalAppleRedemption && raw.offerType === 3 && raw.offerDiscountType === 'FREE_TRIAL' &&
      typeof raw.offerIdentifier === 'string' && raw.offerIdentifier.length > 0 &&
      Number.isFinite(Number(raw.purchaseDate)) && Number(raw.purchaseDate) > 0 && Number(raw.expiresDate) > Number(raw.purchaseDate);
    if (raw.bundleId !== APP || raw.environment !== 'Production' || !APPLE_PRODUCTS.has(raw.productId) ||
        !(raw.appAccountToken?.toLowerCase() === account || raw.appAccountToken == null && attestedAppleOwner === account) ||
        raw.revocationDate != null || !raw.originalTransactionId ||
        (!historicalCode && Number(raw.expiresDate) <= now) || !Number.isFinite(Number(raw.expiresDate))) fail('Kein passendes aktives App-Store-Abo.', 409);
    return { key: `ios:${raw.originalTransactionId}`, product: raw.productId, account,
      started: Number(raw.originalPurchaseDate), purchasedAt: Number(raw.purchaseDate),
      transactionId: raw.transactionId, expires: Number(raw.expiresDate),
      trial: raw.offerType === 1 && raw.offerDiscountType === 'FREE_TRIAL' &&
        raw.transactionId === raw.originalTransactionId && Number(raw.purchaseDate) === Number(raw.originalPurchaseDate),
      offer: raw.offerIdentifier || null, redeemedFreeOffer: raw.offerType === 3 && raw.offerDiscountType === 'FREE_TRIAL' };
  }
  const items = raw.lineItems || [];
  // A cancelled renewal can still carry the already-delivered earned free month. Never use this for acquisition credit.
  const activeState = raw.subscriptionState === 'SUBSCRIPTION_STATE_ACTIVE' ||
    rewardSubscriptionConfirmation && raw.subscriptionState === 'SUBSCRIPTION_STATE_CANCELED';
  const renewingPlan = items[0]?.autoRenewingPlan?.autoRenewEnabled;
  if (platform !== 'android' || raw.testPurchase || !activeState ||
      items.length !== 1 || !PLAY_PRODUCTS.has(items[0].productId) ||
      raw.externalAccountIdentifiers?.obfuscatedExternalAccountId !== account ||
      (renewingPlan !== true && !(rewardSubscriptionConfirmation && renewingPlan === false)) || items[0].deferredItemReplacement ||
      items[0].deferredItemRemoval || Date.parse(items[0].expiryTime) <= now || !Number.isFinite(Date.parse(items[0].expiryTime))) {
    fail('Kein passendes aktives Google-Play-Abo.', 409);
  }
  return { product: items[0].productId, account, started: Date.parse(raw.startTime),
    orderId: items[0].latestSuccessfulOrderId,
    expires: Date.parse(items[0].expiryTime), trial: raw.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED' && !raw.linkedPurchaseToken &&
      !raw.externalAccountIdentifiers?.obfuscatedExternalProfileId && items[0].offerDetails?.offerId !== PLAY_REWARD_OFFER &&
      !!items[0].offerPhase?.freeTrial && Object.keys(items[0].offerPhase).length === 1,
    rewardProfile: raw.externalAccountIdentifiers?.obfuscatedExternalProfileId,
    offer: items[0].offerDetails?.offerId, basePlan: items[0].offerDetails?.basePlanId,
    freePhase: raw.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED' &&
      !!items[0].offerPhase?.freeTrial && Object.keys(items[0].offerPhase).length === 1,
    region: raw.regionCode,
    etag: raw.etag };
}
export function isMatchingPlayRewardSubscription(purchase, reward, now = Date.now()) {
  const days = (purchase.expires - purchase.started) / DAY;
  return reward.state === 'store_subscription' && reward.redemptionPlatform === 'android' &&
    uuid(reward.id) && purchase.rewardProfile === reward.id && purchase.freePhase === true &&
    ['AT', 'DE'].includes(purchase.region) && purchase.product === 'freefinder.pro.monthly' &&
    reward.productId === purchase.product && reward.offerId === PLAY_REWARD_OFFER && purchase.offer === reward.offerId &&
    typeof reward.basePlanId === 'string' && !!reward.basePlanId && purchase.basePlan === reward.basePlanId &&
    receiptID(purchase.orderId) && Number.isFinite(reward.reservedAt) &&
    Number.isFinite(purchase.started) && purchase.started >= reward.reservedAt && purchase.started <= now + 60000 &&
    days >= 27 && days <= 32;
}
export async function historicalPlayReward(raw, order, token, owner, reward, now = Date.now()) {
  const item = raw.lineItems?.[0], details = order.lineItems?.[0]?.subscriptionDetails;
  const phase = details?.offerPhaseDetails;
  const identifiers = raw.externalAccountIdentifiers;
  if (raw.testPurchase || raw.linkedPurchaseToken || raw.lineItems?.length !== 1 ||
      !['ACTIVE', 'CANCELED', 'EXPIRED', 'IN_GRACE_PERIOD', 'ON_HOLD', 'PAUSED'].some(state => raw.subscriptionState === 'SUBSCRIPTION_STATE_' + state) ||
      raw.acknowledgementState !== 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED' ||
      identifiers?.obfuscatedExternalAccountId !== owner || identifiers?.obfuscatedExternalProfileId !== reward.id ||
      typeof item.autoRenewingPlan?.autoRenewEnabled !== 'boolean' || item.prepaidPlan ||
      item.deferredItemReplacement || item.deferredItemRemoval || item.productId !== reward.productId ||
      item.offerDetails?.offerId !== reward.offerId || item.offerDetails?.basePlanId !== reward.basePlanId ||
      order.state !== 'PROCESSED' || order.purchaseToken !== token || order.lineItems?.length !== 1 ||
      order.lineItems[0].productId !== reward.productId || details?.offerId !== reward.offerId ||
      details.basePlanId !== reward.basePlanId || !phase || Object.keys(phase).length !== 1 ||
      !phase.freeTrialDetails || typeof phase.freeTrialDetails !== 'object' || Array.isArray(phase.freeTrialDetails) ||
      order.orderHistory?.refundEvent || order.orderHistory?.cancellationEvent || order.orderHistory?.partialRefundEvents?.length ||
      Date.parse(raw.startTime) !== Date.parse(details.servicePeriodStartTime)) {
    fail('Die ursprüngliche Google-Play-Gutschrift konnte noch nicht bestätigt werden. Dein Guthaben bleibt erhalten.', 409);
  }
  const purchase = { key: 'android:' + await referralHash(token), account: owner, product: item.productId,
    started: Date.parse(details.servicePeriodStartTime), expires: Date.parse(details.servicePeriodEndTime),
    orderId: order.orderId, rewardProfile: identifiers.obfuscatedExternalProfileId, freePhase: true,
    offer: details.offerId, basePlan: details.basePlanId, region: raw.regionCode };
  if (!isMatchingPlayRewardSubscription(purchase, reward, now)) fail('Kein passender bereits gelieferter Gratis-Monat.', 409);
  return purchase;
}
export function referralEvidence(platform, purchase, now = Date.now()) {
  const receiptId = platform === 'ios' ? purchase.transactionId : purchase.orderId;
  const purchasedAt = platform === 'ios' ? purchase.purchasedAt : purchase.started;
  if (!['ios', 'android'].includes(platform) || typeof receiptId !== 'string' ||
      !/^[A-Za-z0-9._-]{5,200}$/.test(receiptId) || !uuid(purchase.account) ||
      !(platform === 'ios' ? APPLE_PRODUCTS : PLAY_PRODUCTS).has(purchase.product) ||
      typeof purchase.key !== 'string' || !(platform === 'ios' ? /^ios:\d{5,30}$/ : /^android:[a-f0-9]{64}$/).test(purchase.key) ||
      !Number.isFinite(purchasedAt) || purchasedAt <= 0 || !Number.isFinite(purchase.expires) || purchasedAt >= purchase.expires ||
      !Number.isFinite(now) || purchasedAt > now + 60000) {
    fail('Der Store-Beleg ist noch nicht vollständig bestätigt. Bitte erneut prüfen.', 409);
  }
  // Keep only server-verified identifiers, never a Play bearer token or the friend's contact data.
  return { version: 1, platform, accountId: purchase.account, purchaseKey: purchase.key,
    productId: purchase.product, receiptId, purchasedAt, periodEnd: purchase.expires, verifiedAt: now };
}
function validSourceEvidence(evidence, now) {
  if (!evidence || evidence.version !== 1 || !Number.isFinite(now)) return false;
  const { platform, receiptId, purchaseKey, productId, accountId, purchasedAt, periodEnd } = evidence;
  try {
    referralEvidence(platform, { transactionId: receiptId, orderId: receiptId, key: purchaseKey,
      product: productId, account: accountId, purchasedAt, started: purchasedAt, expires: periodEnd }, now);
  } catch { return false; }
  const days = (periodEnd - purchasedAt) / DAY;
  return days >= 27 && days <= 32 && (platform !== 'ios' || purchaseKey === 'ios:' + receiptId);
}
export async function reviewReferralSource(evidence, raw, now = Date.now()) {
  const result = status => ({ status, checkedAt: now });
  if (!validSourceEvidence(evidence, now) || !raw || typeof raw !== 'object') return result('unverified');
  const { platform, receiptId, purchaseKey, productId, accountId, purchasedAt, periodEnd } = evidence;
  // Recheck the original qualifying period, not today's subscription or a later paid renewal.
  if (platform === 'ios') {
    if (raw.bundleId !== APP || raw.environment !== 'Production' || raw.transactionId !== receiptId ||
        raw.originalTransactionId !== receiptId || purchaseKey !== 'ios:' + raw.originalTransactionId ||
        raw.productId !== productId || typeof raw.appAccountToken !== 'string' || raw.appAccountToken.toLowerCase() !== accountId ||
        raw.purchaseDate !== purchasedAt || raw.originalPurchaseDate !== purchasedAt || raw.expiresDate !== periodEnd ||
        raw.offerType !== 1 || raw.offerDiscountType !== 'FREE_TRIAL') return result('unverified');
    if (raw.revocationDate == null) return result('verified');
    return result(Number.isFinite(raw.revocationDate) && raw.revocationDate >= purchasedAt &&
      raw.revocationDate <= now + 60000 ? 'revoked' : 'unverified');
  }
  if (raw.orderId !== receiptId || typeof raw.purchaseToken !== 'string' ||
      purchaseKey !== 'android:' + await referralHash(raw.purchaseToken) || !Array.isArray(raw.lineItems) ||
      raw.lineItems.length !== 1 || !raw.lineItems[0]) {
    return result('unverified');
  }
  const item = raw.lineItems[0], details = item.subscriptionDetails, phase = details?.offerPhaseDetails;
  if (item.productId !== productId || !phase || typeof phase.freeTrialDetails !== 'object' ||
      !phase.freeTrialDetails || Array.isArray(phase.freeTrialDetails) || Object.keys(phase).length !== 1 ||
      Date.parse(details.servicePeriodStartTime) !== purchasedAt || Date.parse(details.servicePeriodEndTime) !== periodEnd) {
    return result('unverified');
  }
  if (raw.state === 'REFUNDED') {
    const at = Date.parse(raw.orderHistory?.refundEvent?.eventTime);
    return result(Number.isFinite(at) && at >= purchasedAt && at <= now + 60000 ? 'revoked' : 'unverified');
  }
  if (raw.state === 'PROCESSED' && !raw.orderHistory?.refundEvent && !raw.orderHistory?.cancellationEvent &&
      !(raw.orderHistory?.partialRefundEvents?.length)) return result('verified');
  return result('unverified');
}
export function isQualifyingTrial(purchase, acceptedAt, now = Date.now()) {
  const days = (purchase.expires - purchase.started) / DAY;
  return purchase.trial && Number.isFinite(purchase.started) && purchase.started >= acceptedAt - 30000 &&
    purchase.started <= now + 60000 && purchase.started - acceptedAt <= 7 * DAY && days >= 27 && days <= 32;
}
export function isMatchingAppleRedemption(purchase, reward, now = Date.now()) {
  const days = (purchase.expires - purchase.purchasedAt) / DAY;
  return purchase.redeemedFreeOffer && reward.state === 'store_confirmation' &&
    (!reward.redemptionPlatform || reward.redemptionPlatform === 'ios') &&
    reward.offerId === purchase.offer && reward.productId === purchase.product &&
    Number.isFinite(reward.reservedAt) && Number.isFinite(purchase.purchasedAt) &&
    purchase.purchasedAt >= reward.reservedAt && purchase.purchasedAt <= now + 60000 &&
    days >= 27 && days <= 32 && !!purchase.transactionId &&
    (!reward.originalPurchaseKey || reward.originalPurchaseKey === purchase.key);
}
export function monthAfter(timestamp) {
  const d = new Date(timestamp), day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.getTime();
}
export function isMatchingPlayDeferral(purchase, reward, now = Date.now()) {
  const proof = reward.deferralEvidence;
  // A later paid renewal can also extend expiry. Readback must still describe the original order and exact target.
  return !!proof && proof.version === 1 && proof.platform === 'android' && reward.state === 'store_pending' &&
    (!reward.redemptionPlatform || reward.redemptionPlatform === 'android') &&
    uuid(proof.accountId) && proof.accountId === purchase.account &&
    receiptID(proof.receiptId) && proof.receiptId === purchase.orderId &&
    PLAY_PRODUCTS.has(proof.productId) && proof.productId === purchase.product &&
    /^android:[a-f0-9]{64}$/.test(proof.purchaseKey) && proof.purchaseKey === purchase.key &&
    proof.purchaseKey === reward.purchaseKey && Number.isFinite(proof.requestedAt) && proof.requestedAt > 0 &&
    Number.isFinite(now) && proof.requestedAt <= now && now < proof.originalExpiry &&
    Number.isFinite(proof.originalExpiry) && proof.originalExpiry === reward.originalExpiry &&
    Number.isFinite(proof.expectedExpiry) && proof.expectedExpiry === monthAfter(proof.originalExpiry) &&
    proof.expectedExpiry === reward.expectedExpiry && purchase.expires === proof.expectedExpiry;
}
export async function handleReferralMonths(request, env, authenticate = authenticateAccount) {
  const action = new URL(request.url).pathname.slice(PREFIX.length);
  if (action === 'config' && request.method === 'GET') return json({ ok: true, enabled: env.REFERRAL_MONTHS_ENABLED === '1' });
  if (!['register', 'status', 'accept', 'confirm', 'redeem', 'confirm-redemption', 'prepare-subscription',
    'confirm-subscription', 'import-apple-offers', 'reconciliation-status', ...SUPPORT_ACTIONS,
    'apple-claim-challenge', 'apple-claim-key', 'apple-claim-confirm'].includes(action)) {
    return json({ ok: false, error: 'Nicht gefunden.' }, 404);
  }
  if (!env.REFERRAL_MONTHS) return json({ ok: false, error: 'Einladungen sind noch nicht verfügbar.' }, 503);
  if (request.method !== 'POST') return json({ ok: false }, 405);
  let body;
  try { body = await boundedJSON(request); } catch (error) { return json({ ok: false }, error.status || 400); }
  delete body.principal;
  if (['import-apple-offers', 'reconciliation-status', ...SUPPORT_ACTIONS].includes(action)) {
    if (!env.REFERRAL_ADMIN_SECRET || request.headers.get('x-freefinder-merchant-secret') !== env.REFERRAL_ADMIN_SECRET) return json({ ok: false }, 403);
    if (SUPPORT_ACTIONS.includes(action) && env.REFERRAL_SUPPORT_ENABLED !== '1') return json({ ok: false }, 503);
  } else {
    if (!['ios', 'android'].includes(body.platform)) return json({ ok: false }, 400);
    try {
      body.principal = await authenticate(request, env);
      body.accountId = body.principal.id;
      delete body.secret;
    } catch (error) { return json({ ok: false, error: error.status ? error.message : 'Anmeldung gerade nicht erreichbar.' }, error.status || 503); }
  }
  return env.REFERRAL_MONTHS.get(env.REFERRAL_MONTHS.idFromName('referral-months-v1')).fetch(
    new Request(`https://referrals.internal/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, trustedIP: await referralHash(request.headers.get('cf-connecting-ip') || 'unknown') }) }));
}

export class ReferralMonthsLedger {
  constructor(ctx, env) { this.ctx = ctx; this.storage = ctx.storage; this.env = env; }
  async alarm() {
    const now = Date.now();
    const rates = await this.storage.list({ prefix: 'rate:', limit: 1000 });
    const expired = [...rates].filter(([, value]) => now - value.at > 60000).map(([key]) => key);
    if (expired.length) await this.storage.delete(expired);
    const review = await this.reconcileSources(now);
    await this.storage.transaction(async tx => {
      const scheduled = await tx.getAlarm();
      const next = Math.min(rates.size ? now + SOURCE_SCAN_INTERVAL : Infinity, review.nextAt || Infinity,
        scheduled > now ? scheduled : Infinity);
      if (Number.isFinite(next)) await tx.setAlarm(next);
    });
  }
  async reconcileSources(now = Date.now()) {
    if (this.env.REFERRAL_MONTHS_ENABLED !== '1' || this.env.REFERRAL_RECONCILIATION_ENABLED !== '1') {
      return { checked: 0, nextAt: null };
    }
    const runId = crypto.randomUUID();
    const scan = await this.storage.transaction(async tx => {
      const current = await tx.get(SOURCE_SCAN) || {};
      const nextAt = Math.max(current.nextAt || 0, current.leaseUntil || 0);
      if (nextAt > now) return { waitUntil: nextAt };
      await tx.put(SOURCE_SCAN, { ...current, runId, leaseUntil: now + 60000 });
      return current;
    });
    if (scan.waitUntil) return { checked: 0, nextAt: scan.waitUntil };

    const rows = await this.storage.list({ prefix: 'account:', limit: 20,
      ...(scan.accountKey ? { start: scan.accountKey } : scan.after ? { startAfter: scan.after } : {}) });
    const targets = [];
    let cursor = {}, stopped = false;
    for (const [key, account] of rows) {
      if (!account.deletedAt && account.recoverable && Array.isArray(account.rewards)) {
        const offset = key === scan.accountKey && Number.isInteger(scan.offset) ? Math.max(0, scan.offset) : 0;
        for (let i = offset; i < account.rewards.length; i++) {
          const reward = account.rewards[i];
          if (!['earned', ...PENDING_REWARDS, 'redeemed'].includes(reward.state) ||
              Number.isFinite(reward.sourceReview?.checkedAt) && reward.sourceReview.checkedAt > now - DAY) continue;
          if (targets.length === 2) { cursor = { accountKey: key, offset: i }; stopped = true; break; }
          targets.push({ key, rewardId: reward.id, evidence: reward.sourceEvidence });
        }
      }
      if (stopped) break;
      cursor = { after: key };
    }
    const more = stopped || rows.size === 20;
    const summary = { checked: 0, verified: 0, revoked: 0, unverified: 0, skipped: 0,
      nextAt: now + (more ? SOURCE_SCAN_INTERVAL : DAY) };
    for (const target of targets) {
      // Read-only Store calls run outside the global request lock. Merge only matching, still-current proof.
      const review = await this.reviewSource(target.evidence, now);
      const applied = await this.storage.transaction(async tx => {
        const state = await tx.get(SOURCE_SCAN);
        if (state?.runId !== runId) return false;
        const account = await tx.get(target.key);
        if (!account || account.deletedAt || !account.recoverable) return false;
        const reward = account.rewards?.find(x => x.id === target.rewardId);
        if (!reward || JSON.stringify(reward.sourceEvidence) !== JSON.stringify(target.evidence) ||
            Number.isFinite(reward.sourceReview?.checkedAt) && reward.sourceReview.checkedAt >= now) return false;
        reward.sourceReview = review;
        reward.reconciliation = { checkedAt: now, status: review.status === 'verified' ? 'verified' : 'manual_review' };
        // Audit only: never undo an applied Store benefit, erase credit or replay a pending financial operation.
        await tx.put(target.key, account);
        return true;
      });
      if (applied) { summary.checked++; summary[review.status]++; } else summary.skipped++;
    }
    await this.storage.transaction(async tx => {
      const state = await tx.get(SOURCE_SCAN);
      const totals = Object.fromEntries(SOURCE_REVIEW_COUNTS.map(k => [k, (scan.totals?.[k] || 0) + summary[k]]));
      if (state?.runId === runId) await tx.put(SOURCE_SCAN, {
        ...(more ? { ...cursor, totals } : {}), nextAt: summary.nextAt,
        lastCompleted: more ? scan.lastCompleted || null : { at: now, ...totals },
      });
    });
    return summary;
  }
  async fetch(request) {
    return this.ctx.blockConcurrencyWhile(async () => {
      try { return json(await this.perform(new URL(request.url).pathname.slice(1), await request.json())); }
      catch (error) { return json({ ok: false, error: error.status ? error.message : 'Einladungen sind vorübergehend nicht erreichbar.' }, error.status || 503); }
    });
  }
  async perform(action, body) {
    const now = Date.now();
    if (SUPPORT_ACTIONS.includes(action)) return this.supportAction(action, body, now);
    if (action === 'reconciliation-status') {
      const scan = await this.storage.get(SOURCE_SCAN) || {};
      const counts = value => Object.fromEntries(SOURCE_REVIEW_COUNTS.map(k => [k, value?.[k] || 0]));
      return { ok: true, enabled: this.env.REFERRAL_MONTHS_ENABLED === '1' && this.env.REFERRAL_RECONCILIATION_ENABLED === '1',
        inProgress: scan.leaseUntil > now, nextAt: scan.nextAt || null,
        progress: counts(scan.totals), lastCompleted: scan.lastCompleted ? { at: scan.lastCompleted.at, ...counts(scan.lastCompleted) } : null };
    }
    if (action === 'import-apple-offers') {
      if (!Array.isArray(body.offers) || body.offers.length > 100) fail('Maximal 100 Store-Angebote.');
      const fields = ['productId', 'offerId', 'code', 'freeMonths', 'customerType', 'expiresAt',
        'autoRenew', 'combineIntroductoryOffer', 'environment'];
      for (const offer of body.offers) {
        if (!offer || Object.keys(offer).some(field => !fields.includes(field)) ||
            offer.environment !== 'Production' || !APPLE_PRODUCTS.has(offer.productId) || !/^[A-Za-z0-9_-]{3,100}$/.test(offer.offerId || '') ||
            !/^[A-Z0-9]{6,64}$/.test(offer.code || '') || offer.freeMonths !== 1 ||
            !['new', 'existing', 'expired', 'new_or_expired'].includes(offer.customerType) ||
            (offer.customerType === 'new_or_expired' && (offer.autoRenew !== true || offer.combineIntroductoryOffer !== false)) ||
            !Number.isFinite(offer.expiresAt) || offer.expiresAt <= now) fail('Ungültiges Store-Angebot.');
      }
      const rows = [];
      for (const offer of body.offers) rows.push(['offer:' + await referralHash(offer.code), offer]);
      await this.storage.transaction(async tx => {
        for (const [offerKey, offer] of rows) {
          const previous = await tx.get(offerKey);
          if (previous && fields.some(field => field !== 'environment' && previous[field] !== offer[field]) ||
              previous?.environment && previous.environment !== 'Production') {
            fail('Dieser Code wurde bereits mit anderen Angebotsdaten hinterlegt.', 409);
          }
          // Re-import may classify an old record, but must never clear its reservation.
          await tx.put(offerKey, previous ? { ...previous, environment: 'Production' } : offer);
        }
      });
      return { ok: true };
    }
    const bucketKey = `rate:${body.trustedIP}`;
    let rate = await this.storage.get(bucketKey);
    if (!rate || now - rate.at > 60000) rate = { at: now, count: 0 };
    if (++rate.count > 40) fail('Bitte kurz warten und erneut versuchen.', 429);
    await this.storage.put(bucketKey, rate);
    if (!await this.storage.getAlarm()) await this.storage.setAlarm(now + 120000);
    if (!uuid(body.accountId) || body.principal?.id !== body.accountId) fail('Bitte anmelden.', 401);
    if (['account-delete', 'account-export'].includes(action)) requireRecentAuth(body.principal.authTime, now / 1000);
    else if (typeof body.principal.email !== 'string' || !body.principal.email.includes('@')) {
      fail('Bitte bestätige zuerst deine E-Mail-Adresse.', 403);
    }
    const key = 'account:' + body.accountId;
    let account = await this.storage.get(key);
    if (account?.deletedAt) {
      if (action === 'account-delete') return { ok: true };
      fail('Dieses Konto wurde gelöscht.', 410);
    }
    if (action.startsWith('account-')) return this.accountAction(action.slice(8), body, account, key, now);
    if (this.env.REFERRAL_MONTHS_ENABLED !== '1') {
      if (!['register', 'status'].includes(action)) fail('Die Einladungsaktion ist noch nicht verfügbar.', 503);
      if (!account && action === 'register') return this.status({ code: '', rewards: [] });
    }
    if (!account && action === 'register') {
      account = await this.newAccount(body, now);
      await this.storage.put({ [key]: account, ['code:' + account.code]: account.id });
    }
    if (!account || !account.recoverable) fail('Einladungskonto konnte nicht bestätigt werden.', 403);
    if (action === 'status' || action === 'register') return this.status(account);
    if (this.env.REFERRAL_MONTHS_ENABLED !== '1') fail('Die Einladungsaktion ist noch nicht verfügbar.', 503);
    if (action.startsWith('apple-claim-')) return this.appleClaim(action, body, account, key, now);
    if (action === 'accept') {
      if (!/^RM-[A-F0-9]{24}$/.test(body.code || '')) fail('Ungültiger Einladungslink.');
      const inviter = await this.storage.get('code:' + body.code);
      if (!inviter || inviter === account.id) fail('Dieser Einladungslink kann nicht verwendet werden.', 409);
      if (account.purchaseKey || account.referredBy && account.referredBy !== inviter) fail('Eine Einladung ist bereits zugeordnet.', 409);
      const other = await this.storage.get('account:' + inviter);
      if (!other || other.deletedAt) fail('Diese Einladung ist nicht mehr verfügbar.', 410);
      if (other?.referredBy === account.id) fail('Gegenseitige Eigen-Einladungen sind nicht möglich.', 409);
      account.referredBy = inviter; account.acceptedAt ??= now;
      if (now - account.acceptedAt > 7 * DAY) fail('Die Einladung ist abgelaufen.', 410);
      await this.storage.put(key, account);
      return this.status(account);
    }
    if (action === 'confirm') {
      if (!account.referredBy) return this.status(account);
      const purchase = await this.verifyPurchase(body, account);
      const usedKey = 'purchase:' + await referralHash(purchase.key);
      const used = await this.storage.get(usedKey);
      if (used) {
        if (used !== account.id) fail('Dieses Probeabo wurde bereits zugeordnet.', 409);
        return this.status(account);
      }
      if (account.purchaseKey || !isQualifyingTrial(purchase, account.acceptedAt, now)) fail('Kein neuer bestätigter Gratis-Monat für diese Einladung.', 409);
      const inviter = await this.storage.get('account:' + account.referredBy);
      if (!inviter || inviter.deletedAt || inviter.purchaseKey === purchase.key) fail('Diese Einladung kann nicht bestätigt werden.', 409);
      const reward = { id: crypto.randomUUID(), createdAt: now, state: 'earned', months: 1,
        sourceEvidence: referralEvidence(body.platform, purchase, now) };
      inviter.rewards.push(reward);
      account.purchaseKey = purchase.key; account.confirmedAt = now;
      await this.storage.transaction(async tx => {
        await tx.put({ [key]: account, ['account:' + inviter.id]: inviter, [usedKey]: account.id });
      });
      return this.status(account);
    }
    if (action === 'prepare-subscription') {
      if (body.platform !== 'android') fail('Dieses Angebot gilt nur für Google Play.');
      const reward = account.rewards.find(x => x.id === body.rewardId);
      if (!reward) fail('Belohnung nicht gefunden.', 404);
      if (reward.state === 'redeemed') return this.status(account);
      if (!['earned', 'store_subscription'].includes(reward.state) ||
          reward.redemptionPlatform && reward.redemptionPlatform !== 'android' ||
          account.rewards.some(x => x.id !== reward.id && PENDING_REWARDS.includes(x.state))) {
        fail('Bitte zuerst die bereits gestartete Store-Einlösung bestätigen.', 409);
      }
      if (this.env.REFERRAL_PLAY_REWARD_SUBSCRIPTION_ENABLED !== '1' ||
          !/^[a-z0-9][a-z0-9-]{0,62}$/.test(this.env.REFERRAL_PLAY_REWARD_BASE_PLAN || '')) {
        fail('Dein Monat bleibt gutgeschrieben. Das passende Abo-Angebot ist noch nicht verfügbar.', 409);
      }
      reward.sourceReview = await this.reviewSource(reward.sourceEvidence, now);
      await this.storage.put(key, account);
      if (reward.sourceReview.status !== 'verified') fail('Die Einladung muss zuerst vom Store bestätigt werden. Dein Guthaben bleibt erhalten.', 409);
      if (reward.state === 'earned') {
        Object.assign(reward, { state: 'store_subscription', redemptionPlatform: 'android', reservedAt: now,
          productId: 'freefinder.pro.monthly', offerId: PLAY_REWARD_OFFER,
          basePlanId: this.env.REFERRAL_PLAY_REWARD_BASE_PLAN });
        await this.storage.put(key, account);
      }
      // A reservation is not a purchase or consumed credit. Cancellation can retry the same reservation.
      return this.status(account);
    }
    if (action === 'confirm-subscription') {
      if (body.platform !== 'android') fail('Diese Bestätigung gilt nur für Google Play.');
      const purchase = body.initialOrderId == null
        ? await this.verifyPurchase(body, account, { rewardSubscriptionConfirmation: true })
        : await this.verifyHistoricalReward(body, account, now);
      if (!purchase) return this.status(account);
      const reward = account.rewards.find(x => isMatchingPlayRewardSubscription(purchase, x, now));
      if (!reward) return this.status(account);
      const receiptKey = 'redemption:' + await referralHash('android:' + purchase.orderId);
      const purchaseKey = 'reward-subscription:' + await referralHash(purchase.key);
      if (await this.storage.get(receiptKey) || await this.storage.get(purchaseKey)) return this.status(account);
      reward.redemptionEvidence = referralEvidence('android', purchase, now);
      reward.state = 'redeemed'; reward.redeemedAt = now; reward.newExpiry = purchase.expires;
      const used = { accountId: account.id, rewardId: reward.id };
      await this.storage.transaction(async tx => {
        await tx.put({ [key]: account, [receiptKey]: used, [purchaseKey]: used });
      });
      return this.status(account);
    }
    if (action === 'redeem') {
      const reward = account.rewards.find(x => x.id === body.rewardId);
      if (!reward) fail('Belohnung nicht gefunden.', 404);
      if (reward.state === 'redeemed') return this.status(account);
      if (!['earned', 'store_pending', 'store_confirmation'].includes(reward.state)) {
        fail('Diese Gutschrift kann gerade nicht eingelöst werden.', 409);
      }
      // Older pending records predate the explicit platform field. Their existing store operation still owns the credit.
      const statePlatform = reward.state === 'store_pending' ? 'android' : reward.state === 'store_confirmation' ? 'ios' : null;
      const platform = reward.redemptionPlatform || statePlatform || (reward.redemptionURL ? 'ios' : null);
      if (statePlatform && platform !== statePlatform || reward.redemptionURL && platform !== 'ios') {
        fail('Die begonnene Store-Einlösung muss zuerst geprüft werden.', 409);
      }
      if (platform && platform !== body.platform) {
        fail('Diese Gutschrift wird bereits im anderen Store geprüft. Bitte schließe die Einlösung dort ab.', 409);
      }
      if (account.rewards.some(x => x.id !== reward.id && PENDING_REWARDS.includes(x.state))) {
        fail('Bitte zuerst die bereits gestartete Store-Einlösung bestätigen.', 409);
      }
      if (reward.state === 'earned') {
        reward.sourceReview = await this.reviewSource(reward.sourceEvidence, now);
        await this.storage.put(key, account);
        if (reward.sourceReview.status !== 'verified') {
          fail('Die ursprüngliche Einladung muss zuerst vom Store bestätigt werden. Dein Guthaben bleibt erhalten. Bitte später erneut prüfen.', 409);
        }
      }
      if (body.platform === 'ios') {
        if (reward.redemptionURL) return this.status(account);
        const purchase = body.transactionId ? await this.verifyPurchase(body, account) : null;
        if (!purchase && this.env.REFERRAL_APPLE_REWARD_SUBSCRIPTION_ENABLED !== '1') {
          fail('Dein Monat bleibt gutgeschrieben. Das passende Abo-Angebot ist noch nicht verfügbar.', 409);
        }
        const productId = purchase?.product || `${APP}.premium.monthly`;
        const previous = new Set(account.rewards.map(x => x.offerId).filter(Boolean));
        const customerType = purchase ? 'existing' : 'new_or_expired';
        const scope = await referralHash(JSON.stringify([productId, customerType, [...previous].sort()]));
        let after = reward.appleOfferSearch?.scope === scope ? reward.appleOfferSearch.after : undefined;
        let item, more = false;
        // Bounded pages keep large/used inventories from hiding later codes or blocking the ledger.
        for (let page = 0; page < 10; page++) {
          const offers = await this.storage.list({ prefix: 'offer:', limit: 200, ...(after ? { startAfter: after } : {}) });
          item = [...offers].find(([, offer]) => offer.environment === 'Production' && !offer.assignedTo &&
            offer.productId === productId && offer.expiresAt > now + DAY && offer.customerType === customerType &&
            (purchase || offer.autoRenew === true && offer.combineIntroductoryOffer === false) && !previous.has(offer.offerId));
          more = offers.size === 200;
          if (item || !more) break;
          after = [...offers.keys()].at(-1);
        }
        delete reward.appleOfferSearch;
        if (!item && more) {
          reward.appleOfferSearch = { scope, after };
          await this.storage.put(key, account);
          fail('Apple-Angebote werden noch geprüft. Dein Monat bleibt erhalten. Bitte erneut prüfen.', 409);
        }
        if (!item) await this.storage.put(key, account);
        if (!item) fail('Dein Monat bleibt gutgeschrieben. Ein passendes Apple-Angebot ist noch nicht verfügbar.', 409);
        const [offerKey, offer] = item;
        Object.assign(reward, { state: 'store_confirmation', redemptionPlatform: 'ios', offerId: offer.offerId,
          reservedAt: now, productId,
          originalPurchaseKey: purchase?.key || null,
          redemptionURL: `https://apps.apple.com/redeem?ctx=offercodes&id=6758958213&code=${offer.code}` });
        offer.assignedTo = account.id;
        await this.storage.transaction(async tx => { await tx.put({ [key]: account, [offerKey]: offer }); });
        return this.status(account);
      }
      if (this.env.REFERRAL_PLAY_DEFERRAL_ENABLED !== '1') fail('Dein Monat bleibt gutgeschrieben. Die Store-Einlösung ist noch nicht verfügbar.', 409);
      const purchase = await this.verifyPurchase(body, account);
      if (reward.state === 'store_pending') {
        if (isMatchingPlayDeferral(purchase, reward, now)) {
          reward.state = 'redeemed'; reward.redeemedAt = now; reward.newExpiry = purchase.expires;
          reward.redemptionEvidence = { ...reward.deferralEvidence, confirmedAt: now,
            newExpiry: purchase.expires, confirmation: 'subscription_readback' };
          await this.storage.put(key, account); return this.status(account);
        }
        fail('Google Play prüft die Gutschrift. Bitte nicht erneut einlösen.', 409);
      }
      if (!purchase.etag || !receiptID(purchase.orderId)) fail('Google Play hat die Verlängerung noch nicht bestätigt.', 409);
      reward.state = 'store_pending'; reward.redemptionPlatform = 'android';
      reward.expectedExpiry = monthAfter(purchase.expires); reward.purchaseKey = purchase.key;
      reward.originalExpiry = purchase.expires;
      reward.deferralEvidence = { version: 1, platform: 'android', accountId: account.id,
        productId: purchase.product, receiptId: purchase.orderId, purchaseKey: purchase.key,
        originalExpiry: purchase.expires, expectedExpiry: reward.expectedExpiry, requestedAt: now };
      await this.storage.put(key, account);
      // Persist before sending. Unknown outcomes stay pending; never retry a financial side effect blindly.
      const result = await this.deferPlay(body.purchaseToken, purchase, reward.expectedExpiry);
      if (result.ok && Number.isFinite(result.expires) && result.expires >= reward.expectedExpiry) {
        reward.state = 'redeemed'; reward.redeemedAt = now; reward.newExpiry = result.expires;
        reward.redemptionEvidence = { ...reward.deferralEvidence, confirmedAt: Date.now(),
          newExpiry: result.expires, confirmation: 'deferral_response' };
      }
      else if (result.definitive) {
        reward.state = 'earned';
        for (const field of ['redemptionPlatform', 'expectedExpiry', 'purchaseKey', 'originalExpiry', 'deferralEvidence']) delete reward[field];
      }
      await this.storage.put(key, account);
      return this.status(account);
    }
    if (action === 'confirm-redemption') {
      if (body.platform !== 'ios') fail('Diese Bestätigung gilt nur für den App Store.');
      const purchase = await this.verifyPurchase(body, account, { historicalAppleRedemption: true });
      const usedKey = 'redemption:' + await referralHash(`${body.platform}:${purchase.transactionId || ''}`);
      const reward = account.rewards.find(x => isMatchingAppleRedemption(purchase, x, now));
      if (reward && !await this.storage.get(usedKey)) {
        reward.state = 'redeemed'; reward.redeemedAt = now;
        reward.redemptionEvidence = referralEvidence('ios', purchase, now);
        await this.storage.transaction(async tx => {
          await tx.put({ [key]: account, [usedKey]: { accountId: account.id, rewardId: reward.id } });
        });
      }
      return this.status(account);
    }
    fail('Nicht gefunden.', 404);
  }
  async supportRevision(reward) {
    return referralHash(JSON.stringify([reward.id, reward.state, reward.months, reward.sourceEvidence,
      reward.sourceReview, reward.redemptionPlatform, reward.reservedAt, reward.deferralEvidence,
      reward.redemptionEvidence, reward.redeemedAt, reward.newExpiry, reward.supportHistory]));
  }
  async supportSourceFingerprint(reward, status = reward.sourceReview?.status) {
    return referralHash(JSON.stringify([reward.sourceEvidence, status, reward.state, reward.redemptionEvidence]));
  }
  supportDeliveredEvidence(account, reward, now) {
    const proof = reward.redemptionEvidence;
    if (reward.state !== 'redeemed' || !proof || proof.version !== 1 || proof.accountId !== account.id ||
        !Number.isFinite(reward.redeemedAt) || reward.redeemedAt > now ||
        !receiptID(proof.receiptId) || !['ios', 'android'].includes(proof.platform) ||
        reward.redemptionPlatform && proof.platform !== reward.redemptionPlatform) return false;
    if (proof.confirmation) {
      return proof.platform === 'android' && PLAY_PRODUCTS.has(proof.productId) &&
        /^android:[a-f0-9]{64}$/.test(proof.purchaseKey || '') &&
        ['deferral_response', 'subscription_readback'].includes(proof.confirmation) &&
        Number.isFinite(proof.originalExpiry) && Number.isFinite(proof.confirmedAt) && proof.confirmedAt <= now &&
        proof.expectedExpiry === monthAfter(proof.originalExpiry) && proof.newExpiry >= proof.expectedExpiry &&
        reward.newExpiry === proof.newExpiry;
    }
    try {
      referralEvidence(proof.platform, { account: proof.accountId, key: proof.purchaseKey,
        product: proof.productId, transactionId: proof.receiptId, orderId: proof.receiptId,
        started: proof.purchasedAt, purchasedAt: proof.purchasedAt, expires: proof.periodEnd }, now);
      return true;
    } catch { return false; }
  }
  async supportCase(account, reward) {
    const history = reward.supportHistory || [];
    const last = history.at(-1);
    const resolved = last?.decision === 'retain_delivered_benefit' && reward.state === 'redeemed' &&
      last.sourceFingerprint === await this.supportSourceFingerprint(reward);
    return { accountId: account.id, rewardId: reward.id, state: reward.state, months: reward.months,
      platform: reward.redemptionPlatform || null, reservedAt: reward.reservedAt || null,
      sourceStatus: reward.sourceReview?.status || 'unverified', sourceCheckedAt: reward.sourceReview?.checkedAt || null,
      hasSourceEvidence: validSourceEvidence(reward.sourceEvidence, Date.now()),
      hasRedemptionEvidence: !!reward.redemptionEvidence, resolved: !!resolved,
      revision: await this.supportRevision(reward),
      history: history.map(({ id, decision, at, sourceStatus }) => ({ id, decision, at, sourceStatus })) };
  }
  async supportAction(action, body, now) {
    if (this.env.REFERRAL_SUPPORT_ENABLED !== '1') fail('Support-Prüfung ist nicht aktiviert.', 503);
    const allowed = action === 'support-cases' ? ['cursor'] : action === 'support-case'
      ? ['accountId', 'rewardId'] : ['accountId', 'rewardId', 'revision', 'requestId', 'decision'];
    if (Object.keys(body).some(k => ![...allowed, 'trustedIP'].includes(k))) fail('Ungültige Support-Anfrage.');
    if (action === 'support-cases') {
      const cursor = body.cursor;
      if (cursor != null && (typeof cursor !== 'object' || Array.isArray(cursor) ||
          Object.keys(cursor).some(k => !['accountId', 'offset'].includes(k)) || !uuid(cursor.accountId) ||
          !Number.isSafeInteger(cursor.offset) || cursor.offset < 0)) fail('Ungültiger Cursor.');
      const rows = await this.storage.list({ prefix: 'account:', limit: 5,
        ...(cursor ? { start: 'account:' + cursor.accountId } : {}) });
      const cases = [];
      let scanned = 0, last = null;
      for (const [, account] of rows) {
        if (!uuid(account.id)) continue;
        const rewards = account.recoverable && !account.deletedAt && Array.isArray(account.rewards) ? account.rewards : [];
        const start = account.id === cursor?.accountId ? cursor.offset : 0;
        for (let i = start; i < rewards.length; i++) {
          if (scanned === 100) return { ok: true, cases, cursor: { accountId: account.id, offset: i } };
          scanned++;
          const reward = rewards[i];
          if (!uuid(reward.id) || !['earned', 'redeemed', ...PENDING_REWARDS].includes(reward.state)) continue;
          if (PENDING_REWARDS.includes(reward.state) || !validSourceEvidence(reward.sourceEvidence, now) ||
              ['revoked', 'unverified'].includes(reward.sourceReview?.status)) {
            const item = await this.supportCase(account, reward);
            if (!item.resolved) cases.push(item);
          }
        }
        last = { accountId: account.id, offset: rewards.length };
      }
      // Inclusive cursors also remain valid if the account/reward was deleted between pages.
      if (rows.size === 5 && last) {
        const next = await this.storage.list({ prefix: 'account:', startAfter: 'account:' + last.accountId, limit: 1 });
        const entry = [...next.values()][0];
        if (entry && uuid(entry.id)) return { ok: true, cases, cursor: { accountId: entry.id, offset: 0 } };
      }
      return { ok: true, cases, cursor: null };
    }
    if (!uuid(body.accountId) || !uuid(body.rewardId)) fail('Ungültige Support-Anfrage.');
    const key = 'account:' + body.accountId;
    const account = await this.storage.get(key);
    const reward = account?.recoverable && !account.deletedAt && account.rewards?.find(r => r.id === body.rewardId);
    if (!reward) fail('Fall nicht gefunden.', 404);
    if (action === 'support-case') return { ok: true, case: await this.supportCase(account, reward) };
    if (!uuid(body.requestId) || !/^[a-f0-9]{64}$/.test(body.revision || '') ||
        !['recheck_source', 'retain_delivered_benefit'].includes(body.decision)) fail('Ungültige Prüfentscheidung.');
    const previous = reward.supportHistory?.find(event => event.id === body.requestId);
    if (previous) {
      if (previous.decision !== body.decision || previous.revision !== body.revision) fail('Prüfauftrag wurde bereits anders verwendet.', 409);
      return { ok: true, replay: true, case: await this.supportCase(account, reward) };
    }
    if (await this.supportRevision(reward) !== body.revision) fail('Der Fall hat sich geändert. Bitte erneut laden.', 409);
    if (body.decision === 'retain_delivered_benefit' && !this.supportDeliveredEvidence(account, reward, now)) {
      fail('Nur eine bereits bestätigte Store-Gutschrift kann so abgeschlossen werden.', 409);
    }
    // The only external operation is an authoritative GET for the original source, never billing or code redemption.
    const review = await this.reviewSource(reward.sourceEvidence, now);
    if (body.decision === 'retain_delivered_benefit' && review.status !== 'revoked') {
      fail('Eine eindeutige Store-Rücknahme fehlt. Guthaben und Prüfstatus bleiben erhalten.', 409);
    }
    const event = { id: body.requestId, revision: body.revision, decision: body.decision, at: now,
      sourceStatus: review.status, sourceFingerprint: await this.supportSourceFingerprint(reward, review.status) };
    const updated = await this.storage.transaction(async tx => {
      const current = await tx.get(key);
      const target = current?.recoverable && !current.deletedAt && current.rewards?.find(r => r.id === body.rewardId);
      if (!target || await this.supportRevision(target) !== body.revision) fail('Der Fall hat sich geändert. Bitte erneut laden.', 409);
      target.sourceReview = review;
      target.reconciliation = { checkedAt: now, status: review.status === 'verified' ? 'verified' : 'manual_review' };
      target.supportHistory = [...(target.supportHistory || []), event].slice(-100);
      await tx.put(key, current);
      return { current, target };
    });
    return { ok: true, replay: false, case: await this.supportCase(updated.current, updated.target) };
  }
  status(account) {
    return { ok: true, enabled: this.env.REFERRAL_MONTHS_ENABLED === '1', code: account.code,
      appleAttestedClaims: this.env.REFERRAL_APPLE_ATTESTED_CLAIMS_ENABLED === '1',
      accepted: !!account.referredBy, confirmed: !!account.confirmedAt,
      earnedMonths: account.rewards.reduce((n, r) => n + r.months, 0),
      redeemedMonths: account.rewards.filter(r => r.state === 'redeemed').length,
      rewards: account.rewards.map(({ id, createdAt, state, months, redemptionURL, newExpiry, productId, offerId, reservedAt, basePlanId }) => ({
        id, createdAt, state, months, redemptionURL, newExpiry,
        ...(state === 'store_confirmation' ? { productId, offerId, reservedAt } : {}),
        ...(state === 'store_subscription' ? { productId, offerId, basePlanId, reservedAt } : {}),
      })) };
  }
  async verifyPurchase(body, account, { historicalAppleRedemption = false, rewardSubscriptionConfirmation = false } = {}) {
    if (body.platform === 'ios') {
      if (!/^\d{5,30}$/.test(body.transactionId || '')) fail('Apple-Kaufbestätigung fehlt.');
      const result = await this.appleTransaction(body.transactionId);
      if (!result.ok || result.environment !== 'Production') fail('Apple-Kauf konnte noch nicht bestätigt werden.', 503);
      const raw = decodeStoreJWS(result.signedTransactionInfo);
      if (raw.transactionId !== body.transactionId) fail('Apple-Kauf passt nicht zur Anfrage.', 409);
      const attestedAppleOwner = this.appleBoundOwner ? await this.appleBoundOwner(raw, account) : null;
      return referralPurchase('ios', raw, account.id, Date.now(), { historicalAppleRedemption, attestedAppleOwner });
    }
    if (!/^[A-Za-z0-9._~+\/=:-]{20,2048}$/.test(body.purchaseToken || '')) fail('Google-Play-Kaufbestätigung fehlt.');
    const raw = await this.playPurchase(body.purchaseToken);
    const purchase = referralPurchase('android', raw, account.id, Date.now(), { rewardSubscriptionConfirmation });
    purchase.key = 'android:' + await referralHash(body.purchaseToken);
    return purchase;
  }
  async verifyHistoricalReward(body, account, now) {
    if (!receiptID(body.initialOrderId) || !/^[A-Za-z0-9._~+\/=:-]{20,2048}$/.test(body.purchaseToken || '')) {
      fail('Google-Play-Kaufbestätigung fehlt.');
    }
    const raw = await this.playPurchase(body.purchaseToken);
    const reward = account.rewards.find(r => r.id === raw.externalAccountIdentifiers?.obfuscatedExternalProfileId);
    // Authenticate the subscription owner before querying the untrusted order hint.
    if (raw.testPurchase || raw.externalAccountIdentifiers?.obfuscatedExternalAccountId !== account.id ||
        !reward || !['store_subscription', 'redeemed'].includes(reward.state) || reward.redemptionPlatform !== 'android') {
      fail('Kein passender offener Google-Play-Monat.', 409);
    }
    if (reward.state === 'redeemed') return null;
    const order = await this.playOrder(body.initialOrderId);
    if (order.orderId !== body.initialOrderId) fail('Google-Play-Bestellung passt nicht zur Anfrage.', 409);
    return historicalPlayReward(raw, order, body.purchaseToken, account.id, reward, now);
  }
  async sourcePurchase(evidence) {
    if (evidence.platform === 'ios') {
      const result = await this.appleTransaction(evidence.receiptId);
      if (!result.ok || result.environment !== 'Production') throw new Error('Store unavailable');
      return decodeStoreJWS(result.signedTransactionInfo);
    }
    return this.playOrder(evidence.receiptId);
  }
  async reviewSource(evidence, now) {
    if (!validSourceEvidence(evidence, now)) return { status: 'unverified', checkedAt: now };
    try { return await reviewReferralSource(evidence, await this.sourcePurchase(evidence), now); }
    catch { return { status: 'unverified', checkedAt: now }; }
  }
  async newAccount(body, now) {
    return { id: body.accountId, recoverable: true, createdAt: now,
      email: body.principal.email, providers: body.principal.providers || [],
      code: 'RM-' + (await referralHash(body.accountId)).slice(0, 24).toUpperCase(), rewards: [],
      preferences: { rewardEmails: false, dealEmails: false, weeklyEmails: false }, consentEvents: [] };
  }
  async accountAction(action, body, account, key, now) {
    if (!['profile', 'preferences', 'delete', 'export'].includes(action)) fail('Nicht gefunden.', 404);
    if (account && !account.recoverable) fail('Das bisherige Konto muss zuerst sicher verknüpft werden.', 409);
    if (action === 'delete') {
      // Keep purchase dedupe records, and never leave an active profile behind a removed code.
      await this.storage.transaction(async tx => {
        if (account?.code) await tx.delete('code:' + account.code);
        await tx.put(key, { id: body.accountId, deletedAt: now, recoverable: true });
      });
      return { ok: true };
    }
    if (action === 'export') {
      return { ok: true, account: account ? { ...account, rewards: this.status(account).rewards } : null };
    }
    if (!account) account = await this.newAccount(body, now);
    if (account.email !== body.principal.email) {
      account.email = body.principal.email;
      // Consent is bound to the confirmed address, not transferable to a new mailbox.
      account.preferences = { rewardEmails: false, dealEmails: false, weeklyEmails: false };
      account.consentEvents.push({ at: now, reason: 'email_changed', preferences: account.preferences });
    }
    account.providers = body.principal.providers || [];
    if (action === 'preferences') {
      const allowed = ['rewardEmails', 'dealEmails', 'weeklyEmails'];
      if (!body.preferences || Object.keys(body.preferences).some(k => !allowed.includes(k) || typeof body.preferences[k] !== 'boolean') ||
          body.consentVersion !== 1) fail('Ungültige Mitteilungseinstellungen.');
      if (Object.values(body.preferences).some(Boolean) && this.env.ACCOUNT_EMAIL_ENABLED !== '1') {
        fail('E-Mail-Mitteilungen sind noch nicht verfügbar. Es wurde nichts aktiviert.', 409);
      }
      account.preferences = { ...account.preferences, ...body.preferences };
      account.consentEvents.push({ at: now, version: 1, source: 'account', preferences: { ...account.preferences } });
      account.consentEvents = account.consentEvents.slice(-100);
    }
    await this.storage.put({ [key]: account, ['code:' + account.code]: account.id });
    return { ok: true, accountId: account.id, email: account.email, providers: account.providers,
      preferences: account.preferences, emailDelivery: this.env.ACCOUNT_EMAIL_ENABLED === '1',
      referral: this.status(account) };
  }
}

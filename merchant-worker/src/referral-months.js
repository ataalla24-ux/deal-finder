import { authenticateAccount, boundedJSON, requireRecentAuth } from './account-auth.js';
const DAY = 86400000;
const SOURCE_SCAN = 'referral-source-scan:v1';
const SOURCE_SCAN_INTERVAL = 120000;
const SOURCE_REVIEW_COUNTS = ['checked', 'verified', 'revoked', 'unverified', 'skipped'];
const PREFIX = '/api/referral-months/';
const APP = 'com.stefanataalla.freefinderwien';
const APPLE_PRODUCTS = new Set([`${APP}.premium.monthly`, `${APP}.premium.yearly`]);
const PLAY_PRODUCTS = new Set(['freefinder.pro.monthly', 'freefinder.pro.yearly']);
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
export function referralPurchase(platform, raw, account, now = Date.now()) {
  if (platform === 'ios') {
    if (raw.bundleId !== APP || raw.environment !== 'Production' || !APPLE_PRODUCTS.has(raw.productId) ||
        raw.appAccountToken?.toLowerCase() !== account || raw.revocationDate != null || !raw.originalTransactionId ||
        Number(raw.expiresDate) <= now || !Number.isFinite(Number(raw.expiresDate))) fail('Kein passendes aktives App-Store-Abo.', 409);
    return { key: `ios:${raw.originalTransactionId}`, product: raw.productId, account,
      started: Number(raw.originalPurchaseDate), purchasedAt: Number(raw.purchaseDate),
      transactionId: raw.transactionId, expires: Number(raw.expiresDate),
      trial: raw.offerType === 1 && raw.offerDiscountType === 'FREE_TRIAL' &&
        raw.transactionId === raw.originalTransactionId && Number(raw.purchaseDate) === Number(raw.originalPurchaseDate),
      offer: raw.offerIdentifier || null, redeemedFreeOffer: raw.offerType === 3 && raw.offerDiscountType === 'FREE_TRIAL' };
  }
  const items = raw.lineItems || [];
  if (platform !== 'android' || raw.testPurchase || raw.subscriptionState !== 'SUBSCRIPTION_STATE_ACTIVE' ||
      items.length !== 1 || !PLAY_PRODUCTS.has(items[0].productId) ||
      raw.externalAccountIdentifiers?.obfuscatedExternalAccountId !== account ||
      items[0].autoRenewingPlan?.autoRenewEnabled !== true || items[0].deferredItemReplacement ||
      items[0].deferredItemRemoval || Date.parse(items[0].expiryTime) <= now || !Number.isFinite(Date.parse(items[0].expiryTime))) {
    fail('Kein passendes aktives Google-Play-Abo.', 409);
  }
  return { product: items[0].productId, account, started: Date.parse(raw.startTime),
    orderId: items[0].latestSuccessfulOrderId,
    expires: Date.parse(items[0].expiryTime), trial: raw.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED' && !raw.linkedPurchaseToken &&
      !!items[0].offerPhase?.freeTrial && Object.keys(items[0].offerPhase).length === 1,
    etag: raw.etag };
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
  if (!['register', 'status', 'accept', 'confirm', 'redeem', 'confirm-redemption', 'import-apple-offers', 'reconciliation-status'].includes(action)) {
    return json({ ok: false, error: 'Nicht gefunden.' }, 404);
  }
  if (!env.REFERRAL_MONTHS) return json({ ok: false, error: 'Einladungen sind noch nicht verfügbar.' }, 503);
  if (request.method !== 'POST') return json({ ok: false }, 405);
  let body;
  try { body = await boundedJSON(request); } catch (error) { return json({ ok: false }, error.status || 400); }
  delete body.principal;
  if (['import-apple-offers', 'reconciliation-status'].includes(action)) {
    if (!env.REFERRAL_ADMIN_SECRET || request.headers.get('x-freefinder-merchant-secret') !== env.REFERRAL_ADMIN_SECRET) return json({ ok: false }, 403);
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
          if (!['earned', 'store_pending', 'store_confirmation', 'redeemed'].includes(reward.state) ||
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
    if (action === 'reconciliation-status') {
      const scan = await this.storage.get(SOURCE_SCAN) || {};
      const counts = value => Object.fromEntries(SOURCE_REVIEW_COUNTS.map(k => [k, value?.[k] || 0]));
      return { ok: true, enabled: this.env.REFERRAL_MONTHS_ENABLED === '1' && this.env.REFERRAL_RECONCILIATION_ENABLED === '1',
        inProgress: scan.leaseUntil > now, nextAt: scan.nextAt || null,
        progress: counts(scan.totals), lastCompleted: scan.lastCompleted ? { at: scan.lastCompleted.at, ...counts(scan.lastCompleted) } : null };
    }
    if (action === 'import-apple-offers') {
      if (!Array.isArray(body.offers) || body.offers.length > 100) fail('Maximal 100 Store-Angebote.');
      for (const offer of body.offers) {
        if (!APPLE_PRODUCTS.has(offer.productId) || !/^[A-Za-z0-9_-]{3,100}$/.test(offer.offerId || '') ||
            !/^[A-Z0-9]{6,64}$/.test(offer.code || '') || offer.freeMonths !== 1 ||
            !['new', 'existing', 'expired'].includes(offer.customerType) ||
            !Number.isFinite(offer.expiresAt) || offer.expiresAt <= now) fail('Ungültiges Store-Angebot.');
      }
      for (const offer of body.offers) {
        const key = 'offer:' + await referralHash(offer.code);
        if (!await this.storage.get(key)) await this.storage.put(key, offer);
      }
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
      if (account.rewards.some(x => x.id !== reward.id && ['store_pending', 'store_confirmation'].includes(x.state))) {
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
        const productId = purchase?.product || `${APP}.premium.monthly`;
        const offers = await this.storage.list({ prefix: 'offer:', limit: 1000 });
        const previous = new Set(account.rewards.map(x => x.offerId).filter(Boolean));
        const item = [...offers].find(([, offer]) => !offer.assignedTo && offer.productId === productId &&
          offer.expiresAt > now + DAY && offer.customerType === (purchase ? 'existing' : 'new') && !previous.has(offer.offerId));
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
      const purchase = await this.verifyPurchase(body, account);
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
  status(account) {
    return { ok: true, enabled: this.env.REFERRAL_MONTHS_ENABLED === '1', code: account.code,
      accepted: !!account.referredBy, confirmed: !!account.confirmedAt,
      earnedMonths: account.rewards.reduce((n, r) => n + r.months, 0),
      redeemedMonths: account.rewards.filter(r => r.state === 'redeemed').length,
      rewards: account.rewards.map(({ id, createdAt, state, months, redemptionURL, newExpiry }) => ({ id, createdAt, state, months, redemptionURL, newExpiry })) };
  }
  async verifyPurchase(body, account) {
    if (body.platform === 'ios') {
      if (!/^\d{5,30}$/.test(body.transactionId || '')) fail('Apple-Kaufbestätigung fehlt.');
      const result = await this.appleTransaction(body.transactionId);
      if (!result.ok || result.environment !== 'Production') fail('Apple-Kauf konnte noch nicht bestätigt werden.', 503);
      const raw = decodeStoreJWS(result.signedTransactionInfo);
      if (raw.transactionId !== body.transactionId) fail('Apple-Kauf passt nicht zur Anfrage.', 409);
      return referralPurchase('ios', raw, account.id);
    }
    if (!/^[A-Za-z0-9._~+\/=:-]{20,2048}$/.test(body.purchaseToken || '')) fail('Google-Play-Kaufbestätigung fehlt.');
    const raw = await this.playPurchase(body.purchaseToken);
    const purchase = referralPurchase('android', raw, account.id);
    purchase.key = 'android:' + await referralHash(body.purchaseToken);
    return purchase;
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

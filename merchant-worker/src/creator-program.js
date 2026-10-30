import { authenticateAccount, boundedJSON } from './account-auth.js';

const PREFIX = '/api/creators/';
const DAY = 86400000;
const MONTHLY = { ios: 'com.stefanataalla.freefinderwien.premium.monthly', android: 'freefinder.pro.monthly' };
const json = (body, status = 200) => Response.json(body, { status, headers: {
  'cache-control': 'no-store', 'access-control-allow-origin': '*',
} });
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status, creatorPublic: true }); };
const errorResponse = error => {
  const status = [400, 401, 403, 404, 405, 409, 413, 415, 429, 503].includes(error.status) ? error.status : 503;
  return json({ ok: false, error: error.creatorPublic === true ? error.message :
    status >= 500 ? 'Creator-Dienst gerade nicht erreichbar.' : 'Anmeldung oder Anfrage konnte nicht bestätigt werden.' }, status);
};
const id = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{2,63}$/.test(value);
const receipt = value => typeof value === 'string' && /^[A-Za-z0-9._-]{5,200}$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
const clean = (value, max = 160) => typeof value === 'string' && value.length <= max && !/[\x00-\x1f\x7f]/.test(value) ? value.trim() : '';
export const creatorCode = value => typeof value === 'string' && /^[A-Za-z0-9]{4,32}$/.test(value.trim()) ? value.trim().toUpperCase() : null;
export async function creatorHash(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
    .map(n => n.toString(16).padStart(2, '0')).join('');
}
export function creatorCommission(cents, bps = 3000) {
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > 100000 || bps !== 3000) fail('Ungültige Provisionsbasis.');
  return Number((BigInt(cents) * BigInt(bps) + 5000n) / 10000n);
}
function monthEnd(start, months) {
  const date = new Date(start), day = date.getUTCDate();
  date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + months);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last)); return date.getTime();
}
export const creatorDrafts = () => ['foodiewien', 'tastyfood', 'creator-3', 'creator-4', 'creator-5'].map((partnerId, i) => ({
  id: partnerId, name: i === 0 ? 'Foodiewien' : i === 1 ? 'Tastyfood' : `Creator ${i + 1}`,
  code: i < 2 ? `${partnerId.toUpperCase()}20` : null, state: 'draft', commissionBps: 3000,
  discountBps: 2000, discountedCents: 399, regularCents: 499, currency: 'EUR', region: 'AT',
  paidMonths: 12, commissionMonths: 12, commissionVat: 'inclusive', eligibility: 'new',
  appleOfferId: null, playOfferId: null, playBasePlanId: 'monthly',
  contractRef: null, storeVerified: false, acceptsNew: false, activatedAt: null, closedForNewAt: null, version: 1,
}));
function validatePartner(input, previous) {
  if (!id(input?.id) || !clean(input.name, 80) || !['draft', 'active', 'paused', 'ended'].includes(input.state)) fail('Ungültiger Partner.');
  const p = { ...input, name: clean(input.name, 80), code: input.code == null ? null : creatorCode(input.code),
    closedForNewAt: previous?.closedForNewAt ?? null };
  if (input.code != null && !p.code || p.commissionBps !== 3000 || p.discountBps !== 2000 || p.discountedCents !== 399 ||
      p.regularCents !== 499 || p.currency !== 'EUR' || p.region !== 'AT' || p.eligibility !== 'new' ||
      p.paidMonths !== 12 || ![12, null].includes(p.commissionMonths) || p.commissionVat !== 'inclusive' ||
      !Number.isSafeInteger(p.version) || p.version < 1) fail('Konditionen stimmen nicht mit dem Creator-Pilot überein.');
  for (const key of ['appleOfferId', 'playOfferId', 'playBasePlanId']) {
    if (p[key] != null && !/^[A-Za-z0-9._-]{3,100}$/.test(p[key])) fail('Ungültige Store-Angebotskennung.');
  }
  if (p.state === 'active' && (!p.code || !p.contractRef || !clean(p.contractRef, 200) || p.storeVerified !== true ||
      !p.appleOfferId || !p.playOfferId || !p.playBasePlanId)) fail('Vertrag und beide Store-Angebote müssen bestätigt sein.', 409);
  if (previous?.activatedAt) {
    const mutable = new Set(['state', 'acceptsNew', 'name', 'closedForNewAt']);
    for (const key of Object.keys(previous)) if (!mutable.has(key) && JSON.stringify(p[key]) !== JSON.stringify(previous[key])) {
      fail('Bereits gestartete Konditionen sind unveränderlich. Neue Kampagne gesondert anlegen.', 409);
    }
  }
  return p;
}
function active(p, now) {
  return p?.state === 'active' && p.acceptsNew === true && p.storeVerified === true && !!p.contractRef &&
    p.activatedAt > 0 && p.activatedAt <= now && (!p.redeemUntil || p.redeemUntil > now);
}
function offerFor(partners, platform, offer, now, existing, originatedAt) {
  const p = partners.find(p => (platform === 'ios' ? p.appleOfferId : p.playOfferId) === offer && offer);
  const closedAt = p && Math.min(p.closedForNewAt || Infinity, p.redeemUntil || Infinity);
  const delayed = p?.activatedAt > 0 && ['active', 'paused', 'ended'].includes(p.state) && p.storeVerified === true && !!p.contractRef && Number.isFinite(closedAt) && closedAt <= now &&
    Number.isFinite(originatedAt) && originatedAt >= p.activatedAt && originatedAt < closedAt;
  if (!p || !existing && !active(p, now) && !delayed) throw Object.assign(new Error('Kein bestätigtes Creator-Angebot.'), {
    status: 409, creatorPublic: true, creatorReason: !p ? 'unrelated_offer' : 'inactive_offer',
  });
  return p;
}
function paidAmount(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 100000) fail('Zahlungsbetrag nicht bestätigt.', 409);
  return value;
}
// Only call with the authenticated Store API response, never with client receipt JSON.
export function creatorAppleEvidence(raw, partners, now = Date.now(), existing = null, pendingOffer = null) {
  if (!raw || raw.environment !== 'Production' || raw.bundleId !== 'com.stefanataalla.freefinderwien' ||
      raw.productId !== MONTHLY.ios || raw.inAppOwnershipType === 'FAMILY_SHARED' ||
      !receipt(raw.transactionId) || !receipt(raw.originalTransactionId) || raw.currency !== 'EUR' || raw.storefront !== 'AUT') {
    fail('Kein passender Produktionsbeleg.', 409);
  }
  const pendingTrial = raw.price === 0 && raw.offerType === 1 && raw.offerDiscountType === 'FREE_TRIAL' && pendingOffer?.offerType === 3;
  const p = existing?.terms || (existing ? partners.find(p => p.id === existing.partnerId) :
    offerFor(partners, 'ios', pendingTrial ? pendingOffer.offerIdentifier : raw.offerIdentifier, now, null, raw.originalPurchaseDate));
  if (!p || existing && existing.key !== `ios:${raw.originalTransactionId}` ||
      !Number.isFinite(raw.purchaseDate) || raw.purchaseDate > now + 60000 ||
      !Number.isFinite(raw.originalPurchaseDate) || raw.originalPurchaseDate < p.activatedAt - 60000 ||
      !Number.isFinite(raw.expiresDate) || raw.expiresDate <= raw.purchaseDate ||
      raw.expiresDate - raw.purchaseDate > 32 * DAY ||
      !existing && !pendingTrial && (raw.offerIdentifier !== p.appleOfferId || raw.offerType !== 3)) fail('Creator-Zuordnung nicht bestätigt.', 409);
  if (!Number.isSafeInteger(raw.price) || raw.price % 10 !== 0) fail('Apple-Preis nicht bestätigt.', 409);
  const grossCents = paidAmount(raw.price / 10);
  if (grossCents !== 0 && grossCents !== p.discountedCents && grossCents !== p.regularCents) fail('Abweichender Store-Preis: manuelle Prüfung nötig.', 409);
  const refunded = raw.revocationDate != null;
  if (refunded && (!Number.isFinite(raw.revocationDate) || raw.revocationDate > now + 60000)) fail('Erstattung nicht bestätigt.', 409);
  let refundedCents = 0;
  if (refunded) {
    if (raw.revocationType === 'REFUND_PRORATED') {
      const percent = raw.revocationPercentage;
      if (!Number.isInteger(percent) || percent < 0 || percent > 100000) fail('Teilrückzahlung benötigt Finanzabgleich.', 409);
      // Apple's percentage is rounded to 0.001%. Do not invent cents near a rounding boundary.
      const lower = BigInt(Math.max(0, 2 * percent - 1)), upper = BigInt(Math.min(200000, 2 * percent + 1));
      const lowCents = Number((BigInt(grossCents) * lower + 100000n) / 200000n);
      const highCents = Number((BigInt(grossCents) * upper + 100000n) / 200000n);
      if (lowCents !== highCents) fail('Teilrückzahlung benötigt centgenauen Finanzabgleich.', 409);
      refundedCents = lowCents;
    } else if (raw.revocationType == null && raw.revocationPercentage == null || raw.revocationType === 'REFUND_FULL' &&
        (raw.revocationPercentage == null || raw.revocationPercentage === 100000)) refundedCents = grossCents;
    else fail('Art der Rückzahlung benötigt Finanzabgleich.', 409);
  } else if (raw.revocationType != null || raw.revocationPercentage != null) fail('Widersprüchlicher Erstattungsbeleg.', 409);
  return { platform: 'ios', key: `ios:${raw.originalTransactionId}`, receiptId: raw.transactionId,
    partnerId: p.id, accountId: raw.appAccountToken?.toLowerCase() || null, grossCents,
    purchasedAt: raw.purchaseDate, periodEnd: raw.expiresDate, refundedCents,
    currency: 'EUR', terms: p, originAt: raw.originalPurchaseDate };
}
function moneyCents(money) {
  if (money?.currencyCode !== 'EUR' || !/^-?\d{1,6}$/.test(String(money.units ?? '0')) ||
      !Number.isInteger(money.nanos ?? 0) || (money.nanos ?? 0) < 0 || (money.nanos ?? 0) >= 1000000000 ||
      (money.nanos ?? 0) % 10000000 !== 0) fail('Google-Betrag nicht bestätigt.', 409);
  return paidAmount(Number(money.units ?? 0) * 100 + (money.nanos ?? 0) / 10000000);
}
export function creatorPlayEvidence(purchase, order, tokenHash, partners, now = Date.now(), existing = null) {
  const item = purchase?.lineItems?.[0], line = order?.lineItems?.[0], details = line?.subscriptionDetails;
  if (!purchase || purchase.testPurchase || purchase.regionCode !== 'AT' || purchase.lineItems?.length !== 1 ||
      order?.lineItems?.length !== 1 || !['PROCESSED', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(order.state) || !receipt(order.orderId) ||
      item.productId !== MONTHLY.android || line.productId !== MONTHLY.android ||
      !/^[a-f0-9]{64}$/.test(tokenHash) || !uuid(purchase.externalAccountIdentifiers?.obfuscatedExternalAccountId)) fail('Kein passender Google-Produktionsbeleg.', 409);
  const p = existing?.terms || (existing ? partners.find(p => p.id === existing.partnerId) :
    offerFor(partners, 'android', details?.offerId, now, null, Date.parse(purchase.startTime)));
  const purchasedAt = Date.parse(details?.servicePeriodStartTime), periodEnd = Date.parse(details?.servicePeriodEndTime);
  if (!p || existing && existing.key !== 'android:' + tokenHash || details?.basePlanId !== p.playBasePlanId || purchase.linkedPurchaseToken ||
      !existing && details?.offerId !== p.playOfferId ||
      !Number.isFinite(purchasedAt) || purchasedAt > now + 60000 || purchasedAt < p.activatedAt - 60000 ||
      !Number.isFinite(periodEnd) || periodEnd <= purchasedAt || periodEnd - purchasedAt > 32 * DAY) fail('Google-Angebot nicht bestätigt.', 409);
  const grossCents = moneyCents(order.total);
  if (order.buyerAddress?.buyerCountry !== 'AT' || grossCents !== 0 && grossCents !== p.discountedCents && grossCents !== p.regularCents) fail('Google-Zahlungsbasis prüfen.', 409);
  const partials = order.orderHistory?.partialRefundEvents || [];
  if (!Array.isArray(partials) || partials.some(x => !['PENDING', 'PROCESSED_SUCCESSFULLY'].includes(x.state))) fail('Teilrückzahlung benötigt Abrechnungsprüfung.', 409);
  const partialCents = partials.filter(x => x.state === 'PROCESSED_SUCCESSFULLY').reduce((sum, x) => sum + moneyCents(x.refundDetails?.total), 0);
  if (partialCents > grossCents || partials.some(x => x.state === 'PENDING')) fail('Erstattung noch nicht abgeschlossen.', 409);
  const refunded = order.state === 'REFUNDED' || order.orderHistory?.refundEvent != null;
  return { platform: 'android', key: `android:${tokenHash}`, receiptId: order.orderId,
    partnerId: p.id, accountId: purchase.externalAccountIdentifiers.obfuscatedExternalAccountId,
    grossCents, purchasedAt, periodEnd, refundedCents: refunded ? grossCents : partialCents,
    currency: 'EUR', terms: p, originAt: Date.parse(purchase.startTime) };
}
const defaults = { termsApproved: false, transportReady: false, releasesVerified: false, maxPartners: 5, holdDays: 30 };
const safeChain = c => ({ key: c.key, partnerId: c.partnerId, platform: c.platform, firstPaidAt: c.firstPaidAt,
  checkedAt: c.checkedAt, nextCheckAt: c.nextCheckAt, reviewRequired: c.reviewRequired === true });

export class CreatorProgramLedger {
  constructor(ctx, env) { this.storage = ctx.storage; this.env = env; }
  async partners() { return [...(await this.storage.list({ prefix: 'partner:', limit: 6 })).values()]; }
  async settings() { return await this.storage.get('settings') || defaults; }
  async ready() {
    const s = await this.settings();
    return this.env.CREATOR_PROGRAM_ENABLED === '1' && this.env.CREATOR_APPLE_NOTIFICATIONS_ENABLED === '1' &&
      s.termsApproved === true && s.transportReady === true && s.releasesVerified === true;
  }
  async verify() { fail('Store-Transport noch nicht eingerichtet.', 503); }
  async verifyAppleNotification() { fail('Apple-Servereingang noch nicht eingerichtet.', 503); }
  async verifyGoogleNotification() { fail('Google-Servereingang noch nicht eingerichtet.', 503); }
  async fetch(request) {
    try {
      const path = new URL(request.url).pathname;
      const now = Date.now();
      if (path === '/config') return json({ ok: true, enabled: await this.ready() && (await this.partners()).some(p => active(p, now)) });
      if (path === '/admin/partners' && request.method === 'GET') return json({ ok: true, settings: await this.settings(), partners: await this.partners() });
      if (path === '/admin/summary' && request.method === 'GET') return json(await this.summary());
      const body = await boundedJSON(request, ['/apple-notifications', '/google-notifications'].includes(path) ? 65536 : 16000);
      if (path === '/apple-notifications' || path === '/google-notifications') return json(await this.notification(path, body, now));
      if (path === '/admin/seed') {
        for (const p of creatorDrafts()) if (!await this.storage.get('partner:' + p.id)) await this.storage.put('partner:' + p.id, p);
        return json({ ok: true, partners: await this.partners() });
      }
      if (path === '/admin/settings') {
        if (Object.keys(body).some(k => !['termsApproved', 'transportReady', 'releasesVerified', 'maxPartners', 'holdDays'].includes(k)) ||
            ['termsApproved', 'transportReady', 'releasesVerified'].some(k => typeof body[k] !== 'boolean') ||
            body.maxPartners !== 5 || !Number.isInteger(body.holdDays) || body.holdDays < 30 || body.holdDays > 90) fail('Ungültige Startfreigaben.');
        await this.storage.put('settings', body); return json({ ok: true, settings: body });
      }
      if (path === '/admin/partner') return json({ ok: true, partner: await this.savePartner(body.partner, now) });
      if (path === '/quote') {
        if (!await this.ready()) fail('Creator-Angebote sind noch nicht freigeschaltet.', 503);
        const code = creatorCode(body.code), p = (await this.partners()).find(p => p.code === code && code);
        if (!active(p, now)) fail('Code ungültig oder derzeit nicht verfügbar.', 404);
        return json({ ok: true, offer: { partnerId: p.id, name: p.name, code: p.code,
          productId: MONTHLY[body.platform], currency: p.currency, discountedCents: p.discountedCents,
          regularCents: p.regularCents, paidMonths: p.paidMonths, region: p.region,
          appleOfferId: body.platform === 'ios' ? p.appleOfferId : null,
          playOfferId: body.platform === 'android' ? p.playOfferId : null,
          playBasePlanId: body.platform === 'android' ? p.playBasePlanId : null,
          appleRedemptionURL: body.platform === 'ios' ? `https://apps.apple.com/redeem?ctx=offercodes&id=6758958213&code=${encodeURIComponent(p.code)}` : null,
        } });
      }
      if (path === '/confirm') {
        if (!await this.ready()) fail('Creator-Abrechnung noch nicht freigeschaltet.', 503);
        if (!['ios', 'android'].includes(body.platform) || !uuid(body.principal?.id)) fail('Konto erforderlich.', 401);
        await this.throttle(body.principal.id, now);
        const evidence = await this.verify(body, await this.partners());
        if (evidence.accountId !== body.principal.id) fail('Für diesen Beleg fehlt die bestätigte Kontozuordnung.', 403);
        await this.book(evidence, body.platform === 'android' ? body.purchaseToken : null, now);
        return json({ ok: true, recorded: true });
      }
      if (path === '/admin/reconcile') return json(await this.reconcile(now));
      if (path === '/admin/statement') return json(await this.statement(body, now));
      if (path === '/admin/paid') return json(await this.markPaid(body, now));
      if (path === '/admin/adjust-refund') return json(await this.adjustRefund(body, now));
      return json({ ok: false, error: 'Nicht gefunden.' }, 404);
    } catch (error) { return errorResponse(error); }
  }
  async savePartner(input, now) {
    return this.storage.transaction(async tx => {
      const previous = id(input?.id) ? await tx.get('partner:' + input.id) : null;
      const p = validatePartner(input, previous), all = [...(await tx.list({ prefix: 'partner:', limit: 6 })).values()];
      if (!previous && all.length >= 5) fail('Der Pilot hat höchstens fünf Partner.', 409);
      if (all.some(other => other.id !== p.id && (p.code && other.code === p.code ||
          p.appleOfferId && other.appleOfferId === p.appleOfferId || p.playOfferId && other.playOfferId === p.playOfferId))) fail('Code oder Store-Angebot bereits vergeben.', 409);
      if (p.state === 'active' && !previous?.activatedAt) p.activatedAt = now;
      if (previous?.activatedAt && previous.state === 'active' && previous.acceptsNew && (p.state !== 'active' || !p.acceptsNew)) {
        p.closedForNewAt = now;
      } else if (p.state === 'active' && p.acceptsNew) p.closedForNewAt = null;
      if (previous?.activatedAt && !p.activatedAt) fail('Startzeit darf nicht zurückgesetzt werden.', 409);
      await tx.put('partner:' + p.id, p); return p;
    });
  }
  async hold(key, now) {
    await this.storage.transaction(async tx => {
      const current = await tx.get('chain:' + key);
      if (current) await tx.put('chain:' + key, { ...current, reviewRequired: true, nextCheckAt: now + DAY, checkedAt: now });
    });
  }
  async notification(path, body, now) {
    const apple = path === '/apple-notifications';
    if (this.env[apple ? 'CREATOR_APPLE_NOTIFICATIONS_ENABLED' : 'CREATOR_GOOGLE_NOTIFICATIONS_ENABLED'] !== '1') fail('Servereingang noch nicht freigeschaltet.', 503);
    const proof = apple ? await this.verifyAppleNotification(body) : await this.verifyGoogleNotification(body);
    if (proof.test === true) return { ok: true, test: true, recorded: false };
    if (!await this.ready()) fail('Creator-Abrechnung noch nicht freigeschaltet.', 503);
    const eventId = apple ? proof.notificationId : proof.messageId;
    if (!clean(eventId, 160)) fail('Server-Ereignis unvollständig.');
    const eventKey = 'event:' + (apple ? 'apple:' : 'google:') + await creatorHash(eventId);
    if (await this.storage.get(eventKey)) return { ok: true, duplicate: true };
    const partners = await this.partners();
    const key = apple ? 'ios:' + proof.rawTransaction?.originalTransactionId : 'android:' + await creatorHash(proof.purchaseToken);
    const known = await this.storage.get('chain:' + key);
    if (apple && (!proof.rawTransaction || proof.rawTransaction.productId !== MONTHLY.ios)) return { ok: true, ignored: true };
    if (apple && !known && !partners.some(p => p.appleOfferId && [proof.rawTransaction.offerIdentifier, proof.renewalInfo?.offerIdentifier].includes(p.appleOfferId))) {
      return { ok: true, ignored: true };
    }
    await this.throttle('notifications', now);
    try {
      const evidence = apple ? creatorAppleEvidence(proof.rawTransaction, partners, now, known, proof.renewalInfo) :
        await this.verify({ platform: 'android', purchaseToken: proof.purchaseToken }, partners, known);
      for (const item of Array.isArray(evidence) ? evidence : [evidence]) {
        await this.book(item, apple ? null : proof.purchaseToken, now);
      }
      await this.storage.put(eventKey, { at: now });
      return { ok: true, recorded: true };
    } catch (error) {
      if (!known && error.creatorReason === 'unrelated_offer') return { ok: true, ignored: true };
      if (known) await this.hold(key, now);
      await this.storage.put('notification-review:' + await creatorHash(key), {
        platform: apple ? 'ios' : 'android', at: now, receiptId: apple ? proof.transactionId : null,
        reason: 'store_evidence_requires_review',
      });
      throw error;
    }
  }
  async throttle(principal, now) {
    return this.storage.transaction(async tx => {
      const key = 'rate:' + principal;
      let value = await tx.get(key);
      if (!value || value.until <= now) value = { until: now + DAY, calls: 0 };
      let global = await tx.get('store-budget');
      if (!global || global.until <= now) global = { until: now + DAY, calls: 0 };
      if (value.calls >= (['reconcile', 'notifications'].includes(principal) ? 500 : 12) || global.calls >= 500) fail('Store-Prüfung bitte später erneut versuchen.', 429);
      value.calls++; global.calls++;
      await tx.put(key, value); await tx.put('store-budget', global);
    });
  }
  async book(e, privateToken, now) {
    const key = 'payment:' + e.platform + ':' + e.receiptId;
    const settings = await this.settings();
    return this.storage.transaction(async tx => {
      let chain = await tx.get('chain:' + e.key);
      if (chain && chain.partnerId !== e.partnerId) fail('Eine bestehende Zuordnung kann nicht überschrieben werden.', 409);
      if (chain?.accountId && chain.accountId !== e.accountId) fail('Der Store-Beleg gehört zu einem anderen Konto.', 409);
      const previous = await tx.get(key);
      if (previous && (previous.chainKey !== e.key || previous.grossCents !== e.grossCents || previous.purchasedAt !== e.purchasedAt)) fail('Widersprüchlicher Store-Beleg.', 409);
      const p = chain?.terms || e.terms;
      chain ||= { key: e.key, partnerId: p.id, platform: e.platform, accountId: e.accountId, terms: p, firstPaidAt: null,
        latestReceipt: e.receiptId, privateToken: privateToken || null, createdAt: now };
      if (!Number.isFinite(e.originAt) || e.originAt < p.activatedAt - 60000) fail('Kein neues Creator-Abo.', 409);
      if (e.grossCents > 0) chain.firstPaidAt = Math.min(chain.firstPaidAt ?? e.purchasedAt, e.purchasedAt);
      const commissionCents = creatorCommission(e.grossCents);
      const refundedCents = Math.max(previous?.refundedCents || 0, e.refundedCents);
      const item = { ...previous, platform: e.platform, receiptId: e.receiptId, chainKey: e.key, partnerId: p.id,
        grossCents: e.grossCents, currency: 'EUR', purchasedAt: e.purchasedAt, periodEnd: e.periodEnd,
        refundedCents, commissionCents, reversedCents: commissionCents - creatorCommission(e.grossCents - refundedCents),
        commissionBps: p.commissionBps, commissionVat: p.commissionVat, termsVersion: p.version, verifiedAt: now,
        eligibleAt: (previous?.eligibleAt ?? now + settings.holdDays * DAY) };
      const slot = 'period:' + await creatorHash(e.key) + ':' + e.purchasedAt;
      const occupied = await tx.get(slot);
      if (occupied && occupied !== key) fail('Derselbe Abrechnungszeitraum wurde bereits erfasst.', 409);
      await tx.put(slot, key);
      await tx.put(key, item);
      chain.paymentKeys = [...new Set([...(chain.paymentKeys || []), key])];
      if (chain.paymentKeys.length > 200) fail('Abo-Historie benötigt manuelle Prüfung.', 409);
      const history = (await Promise.all(chain.paymentKeys.map(key => tx.get(key))))
        .sort((a, b) => a.purchasedAt - b.purchasedAt || a.receiptId.localeCompare(b.receiptId));
      let paidPeriods = 0;
      for (const payment of history) {
        if (payment.grossCents > 0) paidPeriods++;
        const included = p.commissionMonths == null || paidPeriods <= p.commissionMonths;
        payment.commissionCents = included ? creatorCommission(payment.grossCents) : 0;
        payment.reversedCents = included ? payment.commissionCents - creatorCommission(payment.grossCents - payment.refundedCents) : 0;
        await tx.put(`payment:${payment.platform}:${payment.receiptId}`, payment);
      }
      if (e.purchasedAt >= (chain.latestAt || 0)) { chain.latestReceipt = e.receiptId; chain.latestAt = e.purchasedAt; }
      Object.assign(chain, { checkedAt: now, nextCheckAt: now + DAY, reviewRequired: chain.reviewRequired === true });
      await tx.put('chain:' + e.key, chain);
      return history.find(p => p.platform === e.platform && p.receiptId === e.receiptId);
    });
  }
  async reconcile(now) {
    if (!await this.ready() || this.env.CREATOR_RECONCILIATION_ENABLED !== '1') return { ok: true, skipped: 'disabled', checked: 0 };
    const cursor = await this.storage.get('reconcile-cursor');
    let page = await this.storage.list({ prefix: 'chain:', limit: 200, ...(cursor ? { startAfter: cursor } : {}) });
    if (!page.size && cursor) page = await this.storage.list({ prefix: 'chain:', limit: 200 });
    const chains = []; let nextCursor = null;
    for (const [key, chain] of page) {
      nextCursor = key;
      if (chain.nextCheckAt <= now) chains.push(chain);
      if (chains.length === 2) break;
    }
    // Advance even past not-yet-due rows so subscriptions beyond the first page cannot starve.
    await this.storage.put('reconcile-cursor', nextCursor);
    let checked = 0, review = 0;
    for (const chain of chains) {
      try {
        const body = { platform: chain.platform, transactionId: chain.latestReceipt, purchaseToken: chain.privateToken, reconcile: true };
        await this.throttle('reconcile', now);
        const evidence = await this.verify(body, await this.partners(), chain);
        const entries = Array.isArray(evidence) ? evidence : [evidence];
        if (!entries.length) fail('Abo-Historie unvollständig.', 409);
        for (const item of entries) await this.book(item, chain.privateToken, now);
        await this.storage.transaction(async tx => {
          const current = await tx.get('chain:' + chain.key);
          const verified = new Set(entries.map(e => `payment:${e.platform}:${e.receiptId}`));
          if (current && current.paymentKeys.every(key => verified.has(key))) {
            await tx.put('chain:' + chain.key, { ...current, reviewRequired: false, checkedAt: now, nextCheckAt: now + DAY });
          }
        });
        checked++;
      } catch {
        await this.hold(chain.key, now);
        review++;
      }
    }
    return { ok: true, checked, review, capacityLimited: chains.length === 2 };
  }
  async summary() {
    const partners = await this.partners();
    const payments = [...(await this.storage.list({ prefix: 'payment:', limit: 2001 })).values()];
    if (payments.length > 2000) fail('Abrechnungsübersicht benötigt paginierte Prüfung.', 409);
    return { ok: true, partners: partners.map(p => ({ id: p.id, name: p.name, state: p.state,
      payments: payments.filter(x => x.partnerId === p.id && x.grossCents > 0).length,
      grossCents: payments.filter(x => x.partnerId === p.id).reduce((n, x) => n + x.grossCents - x.refundedCents, 0),
      commissionCents: payments.filter(x => x.partnerId === p.id).reduce((n, x) => n + x.commissionCents - x.reversedCents, 0),
    })), chains: [...(await this.storage.list({ prefix: 'chain:', limit: 201 })).values()].map(safeChain),
      statements: [...(await this.storage.list({ prefix: 'statement:', limit: 100 })).values()] };
  }
  async statement(body, now) {
    if (!id(body.partnerId) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(body.month || '') || body.reconciledFinancialReports !== true ||
        body.storeFundsReceived !== true || !clean(body.evidenceRef, 200)) fail('Store-Abgleich und Geldeingang müssen bestätigt werden.', 409);
    const statementId = `${body.partnerId}:${body.month}`;
    return this.storage.transaction(async tx => {
      const old = await tx.get('statement:' + statementId);
      if (old) return { ok: true, duplicate: true, statement: old };
      if (!await tx.get('partner:' + body.partnerId)) fail('Partner nicht gefunden.', 404);
      const all = [...(await tx.list({ prefix: 'payment:', limit: 2001 })).entries()];
      if (all.length > 2000) fail('Abrechnung benötigt paginierte Prüfung.', 409);
      const until = monthEnd(Date.parse(body.month + '-01T00:00:00Z'), 1);
      if (!Number.isFinite(until) || until > now) fail('Abrechnungsmonat noch nicht abgeschlossen.', 409);
      const lines = [];
      for (const [key, p] of all) {
        if (p.partnerId !== body.partnerId || p.purchasedAt >= until || p.eligibleAt > now) continue;
        const net = p.commissionCents - p.reversedCents, delta = net - (p.allocatedCents || 0);
        if (!delta) continue;
        if (delta > 0 && (await tx.get('chain:' + p.chainKey))?.reviewRequired) continue;
        lines.push({ receiptId: p.receiptId, platform: p.platform, grossCents: p.grossCents,
          refundedCents: p.refundedCents, commissionCents: delta, currency: p.currency });
        await tx.put(key, { ...p, allocatedCents: net });
      }
      const statements = [...(await tx.list({ prefix: 'statement:', limit: 101 })).values()];
      if (statements.length > 100) fail('Abrechnungsarchiv benötigt paginierte Prüfung.', 409);
      if (statements.some(prior => prior.partnerId === body.partnerId && prior.id.split(':')[1] >= body.month)) {
        fail('Abrechnungsmonate müssen chronologisch abgeschlossen werden.', 409);
      }
      for (const prior of statements) if (prior.partnerId === body.partnerId && prior.totalCents < 0 && !prior.carriedInto) {
        lines.push({ carryFrom: prior.id, commissionCents: prior.totalCents, currency: 'EUR' });
        await tx.put('statement:' + prior.id, { ...prior, carriedInto: statementId });
      }
      if (!lines.length) fail('Keine neuen abrechenbaren Positionen.', 409);
      const totalCents = lines.reduce((n, x) => n + x.commissionCents, 0);
      const statement = { id: statementId, partnerId: body.partnerId, currency: 'EUR', totalCents, lines,
        createdAt: now, evidenceRef: body.evidenceRef, state: 'locked', revision: 1 };
      await tx.put('statement:' + statementId, statement); return { ok: true, statement };
    });
  }
  async markPaid(body, now) {
    const bankReference = clean(body.bankReference, 120);
    if (typeof body.statementId !== 'string' || !/^[a-z0-9-]{3,64}:\d{4}-(0[1-9]|1[0-2])$/.test(body.statementId) ||
        !bankReference || body.ownerConfirmed !== true) fail('Bestätigte Überweisung erforderlich.', 409);
    return this.storage.transaction(async tx => {
      const s = await tx.get('statement:' + body.statementId);
      if (!s || s.totalCents <= 0 || body.amountCents !== s.totalCents) fail('Überweisung passt nicht zur Abrechnung.', 409);
      if (s.state === 'paid') {
        if (s.bankReference !== bankReference) fail('Diese Abrechnung ist bereits bezahlt.', 409);
        return { ok: true, duplicate: true, statement: s };
      }
      const key = 'transfer:' + await creatorHash(bankReference);
      if (await tx.get(key)) fail('Überweisungsreferenz bereits verwendet.', 409);
      Object.assign(s, { state: 'paid', bankReference, paidAt: now });
      await tx.put(key, s.id); await tx.put('statement:' + s.id, s); return { ok: true, statement: s };
    });
  }
  async adjustRefund(body, now) {
    // Administrative corrections require an external financial report; public clients never supply amounts.
    const evidenceRef = clean(body.evidenceRef, 200);
    if (!['ios', 'android'].includes(body.platform) || !receipt(body.receiptId) || !evidenceRef ||
        body.ownerConfirmed !== true) fail('Bestätigter Erstattungsnachweis erforderlich.', 409);
    const cents = paidAmount(body.refundedCents), key = `payment:${body.platform}:${body.receiptId}`;
    return this.storage.transaction(async tx => {
      const p = await tx.get(key);
      if (!p || cents > p.grossCents || cents < p.refundedCents &&
          (body.refundReversalConfirmed !== true || clean(p.refundEvidenceRef, 200) === evidenceRef)) fail('Erstattung passt nicht zur Zahlung.', 409);
      p.refundedCents = cents;
      p.reversedCents = p.commissionCents ? p.commissionCents - creatorCommission(p.grossCents - cents) : 0;
      p.refundEvidenceRef = evidenceRef; p.refundCheckedAt = now;
      await tx.put(key, p); return { ok: true };
    });
  }
}

export async function handleCreatorProgram(request, env, authenticate = authenticateAccount) {
  const action = new URL(request.url).pathname.slice(PREFIX.length);
  const admin = action.startsWith('admin/');
  const notification = ['apple-notifications', 'google-notifications'].includes(action);
  if (!['config', 'quote', 'confirm', 'admin/partners', 'admin/summary', 'admin/seed', 'admin/settings',
    'admin/partner', 'admin/reconcile', 'admin/statement', 'admin/paid', 'admin/adjust-refund', 'apple-notifications', 'google-notifications'].includes(action)) return json({ ok: false }, 404);
  const get = ['config', 'admin/partners', 'admin/summary'].includes(action);
  if (request.method !== (get ? 'GET' : 'POST')) return json({ ok: false }, 405);
  try {
    if (admin) {
      const secret = env.MERCHANT_PROMO_ADMIN_SECRET;
      if (!secret) fail('Creator-Verwaltung nicht eingerichtet.', 503);
      if (await creatorHash(request.headers.get('authorization') || '') !== await creatorHash('Bearer ' + secret)) fail('Nicht berechtigt.', 401);
    }
    if (notification && env[action === 'apple-notifications' ? 'CREATOR_APPLE_NOTIFICATIONS_ENABLED' : 'CREATOR_GOOGLE_NOTIFICATIONS_ENABLED'] !== '1') fail('Servereingang noch nicht freigeschaltet.', 503);
    if (!admin && !notification && env.CREATOR_PROGRAM_ENABLED !== '1') {
      return action === 'config' ? json({ ok: true, enabled: false }) : json({ ok: false, error: 'Creator-Angebote noch nicht aktiv.' }, 503);
    }
    if (!env.CREATOR_PROGRAM) fail('Creator-Dienst noch nicht eingerichtet.', 503);
    let body;
    if (!get) {
      body = await boundedJSON(request, notification ? 65536 : 16000);
      // Never forward a client-supplied principal or trust a device-supplied price.
      delete body.principal;
      delete body.transportAuthorization;
      if (notification && action === 'apple-notifications') body = { signedPayload: body.signedPayload };
      if (notification && action === 'google-notifications') body = { message: body.message, subscription: body.subscription };
      if (notification && action === 'google-notifications') body.transportAuthorization = request.headers.get('authorization') || '';
      if (!admin && !notification) {
        const account = await authenticate(request, env);
        body.principal = { id: account.id };
        if (!['ios', 'android'].includes(body.platform)) fail('Plattform fehlt.');
      }
    }
    const ledger = env.CREATOR_PROGRAM.get(env.CREATOR_PROGRAM.idFromName('creator-program-v1'));
    return ledger.fetch(new Request('https://creators.internal/' + action, {
      method: request.method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
    }));
  } catch (error) { return errorResponse(error); }
}

export async function scheduledCreatorProgram(env) {
  if (env.CREATOR_PROGRAM_ENABLED !== '1' || env.CREATOR_RECONCILIATION_ENABLED !== '1' || !env.CREATOR_PROGRAM) return;
  const ledger = env.CREATOR_PROGRAM.get(env.CREATOR_PROGRAM.idFromName('creator-program-v1'));
  await ledger.fetch(new Request('https://creators.internal/admin/reconcile', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  }));
}

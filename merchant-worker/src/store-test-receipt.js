import { boundedJSON } from './account-auth.js';
import { promoHash } from './merchant-promos.js';

const APP = 'com.stefanataalla.freefinderwien';
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const products = platform => platform === 'ios' ? [`${APP}.premium.monthly`, `${APP}.premium.yearly`]
  : ['freefinder.pro.monthly', 'freefinder.pro.yearly'];

async function readJSON(response) {
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
    await response.body?.cancel(); throw Error('Store unavailable');
  }
  const reader = response.body?.getReader();
  if (!reader) throw Error('Missing body');
  const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 262144) { await reader.cancel(); throw Error('Response too large'); }
    chunks.push(value);
  }
  return JSON.parse(await new Blob(chunks).text());
}

export function summarizeTestReceipt(input, raw, now = Date.now()) {
  const apple = input.platform === 'ios';
  const item = raw?.lineItems?.[0];
  const product = apple ? raw?.productId : item?.productId;
  if (apple ? raw?.environment !== 'Sandbox' || raw.bundleId !== APP || raw.transactionId !== input.transactionId
    : !object(raw?.testPurchase) || !Array.isArray(raw.lineItems) || raw.lineItems.length !== 1) {
    throw Object.assign(Error('Only test receipts are supported'), { status: 409 });
  }
  if (!products(input.platform).includes(product)) throw Object.assign(Error('Unexpected product'), { status: 409 });
  const started = apple ? Number(raw.purchaseDate) : Date.parse(raw.startTime);
  const expires = apple ? Number(raw.expiresDate) : Date.parse(item.expiryTime);
  const validPeriod = Number.isFinite(started) && started > 0 && Number.isFinite(expires) && expires > started;
  const owner = apple ? raw.appAccountToken : raw.externalAccountIdentifiers?.obfuscatedExternalAccountId;
  const offer = apple ? raw.offerIdentifier : item.offerDetails?.offerId;
  const rewardOffers = apple ? ['referral-earned-month-2026', 'referral-active-monthly-2026', 'referral-active-yearly-2026']
    : ['referral-earned-month'];
  return { ok: true, testReceipt: true, platform: input.platform, productId: product,
    ownerPresent: typeof owner === 'string' && !!owner,
    ownerMatches: typeof owner === 'string' && owner.toLowerCase() === input.accountId,
    rewardOfferMatches: rewardOffers.includes(offer),
    freePhase: apple ? raw.offerDiscountType === 'FREE_TRIAL' :
      object(item.offerPhase?.freeTrial) && Object.keys(item.offerPhase).length === 1,
    acknowledged: apple ? null : raw.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
    periodSeconds: validPeriod ? (expires - started) / 1000 : null,
    activePeriod: validPeriod && started <= now && expires > now && (apple ? raw.revocationDate == null :
      ['SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_CANCELED'].includes(raw.subscriptionState)),
    grantsCredit: false, redemptionTested: false, billingPeriodVerified: false };
}

// Diagnostic-only boundary: no account ledger, purchase, acknowledgement, deferral or token reassignment.
export async function handleTestReceipt(request, env, { appleToken, googleToken }) {
  if (request.method !== 'POST') return json({ ok: false }, 405);
  if (new URL(request.url).search) return json({ ok: false }, 400);
  const secret = typeof env.MERCHANT_PROMO_ADMIN_SECRET === 'string' ? env.MERCHANT_PROMO_ADMIN_SECRET.trim() : '';
  if (!secret) return json({ ok: false }, 503);
  if (await promoHash(request.headers.get('authorization') || '') !== await promoHash(`Bearer ${secret}`)) {
    return json({ ok: false }, 401);
  }
  if (env.STORE_TEST_RECEIPTS_ENABLED !== '1') return json({ ok: false, error: 'Test receipt checks disabled' }, 503);
  let input;
  try {
    input = await boundedJSON(request);
    const allowed = ['platform', 'accountId', input.platform === 'ios' ? 'transactionId' : 'purchaseToken'];
    if (!['ios', 'android'].includes(input.platform) || typeof input.accountId !== 'string' || !UUID.test(input.accountId) ||
      Object.keys(input).some(key => !allowed.includes(key)) ||
      (input.platform === 'ios' ? typeof input.transactionId !== 'string' || !/^\d{5,30}$/.test(input.transactionId) :
        typeof input.purchaseToken !== 'string' || !/^[A-Za-z0-9._~+/=:-]{20,2048}$/.test(input.purchaseToken))) throw Error('Invalid input');
  } catch { return json({ ok: false, error: 'Invalid test receipt request' }, 400); }
  try {
    const signal = AbortSignal.timeout(20000);
    let raw;
    if (input.platform === 'ios') {
      const token = await appleToken(env, signal);
      const body = await readJSON(await fetch(`https://api.storekit-sandbox.itunes.apple.com/inApps/v1/transactions/${input.transactionId}`, {
        method: 'GET', headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, signal, redirect: 'manual',
      }));
      // This payload comes only from Apple's authenticated Sandbox API, never from the request body.
      if (typeof body.signedTransactionInfo !== 'string') throw Error('Missing transaction');
      const parts = body.signedTransactionInfo.split('.');
      if (parts.length !== 3) throw Error('Invalid transaction');
      raw = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    } else {
      const auth = await googleToken(env, signal);
      if (!auth.ok || !auth.token) throw Error('Authorization unavailable');
      raw = await readJSON(await fetch(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${APP}/purchases/subscriptionsv2/tokens/${encodeURIComponent(input.purchaseToken)}`, {
        method: 'GET', headers: { authorization: `Bearer ${auth.token}`, accept: 'application/json' }, signal, redirect: 'manual',
      }));
    }
    return json(summarizeTestReceipt(input, raw));
  } catch (error) {
    // Never expose provider diagnostics, raw receipts, owner IDs or private tokens.
    return json({ ok: false, error: error.status === 409 ? 'No matching test subscription' : 'Test receipt unavailable' },
      error.status === 409 ? 409 : 503);
  }
}

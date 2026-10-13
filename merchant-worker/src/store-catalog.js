import { promoHash } from './merchant-promos.js';

const APP = 'com.stefanataalla.freefinderwien';
const PRODUCTS = ['freefinder.pro.monthly', 'freefinder.pro.yearly'];
const REGIONS = new Set(['AT', 'DE']);
const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.length <= 100 ? value : null;
const states = value => ['ACTIVE', 'INACTIVE', 'DRAFT'].includes(value) ? value : 'UNKNOWN';
const list = value => Array.isArray(value) ? value : [];
const regions = value => list(value).filter(x => object(x) && REGIONS.has(x.regionCode));
const money = value => object(value) ? { currencyCode: text(value.currencyCode),
  units: typeof value.units === 'string' && /^-?\d{1,18}$/.test(value.units) ? value.units : null,
  nanos: Number.isInteger(value.nanos) ? value.nanos : null } : null;

function targeting(value) {
  if (value == null || object(value) && Object.keys(value).length === 0) return 'developer_determined';
  if (object(value?.acquisitionRule?.scope?.anySubscriptionInApp)) return 'new_to_app';
  if (object(value?.acquisitionRule?.scope?.thisSubscription)) return 'new_to_subscription';
  if (object(value?.upgradeRule)) return 'upgrade';
  return 'unknown';
}
export function summarizePlayCatalog(productId, subscription, offers) {
  if (subscription?.packageName !== APP || subscription.productId !== productId || !Array.isArray(subscription.basePlans) ||
      !object(offers) || offers.subscriptionOffers != null && !Array.isArray(offers.subscriptionOffers)) throw Error('Invalid catalog');
  const records = list(offers.subscriptionOffers);
  if (records.length > 20 || subscription.basePlans.length > 100 || records.some(x => !object(x) || x.packageName !== APP ||
      x.productId !== productId || !subscription.basePlans.some(p => p?.basePlanId === x.basePlanId))) throw Error('Invalid catalog');
  return { productId, complete: !offers.nextPageToken,
    basePlans: subscription.basePlans.map(p => ({ basePlanId: text(p.basePlanId), state: states(p.state),
      billingPeriod: text(p.autoRenewingBasePlanType?.billingPeriodDuration),
      regions: regions(p.regionalConfigs).map(r => ({ regionCode: r.regionCode,
        newSubscriberAvailability: r.newSubscriberAvailability === true, price: money(r.price) })) })),
    offers: records.map(o => ({ basePlanId: text(o.basePlanId), offerId: text(o.offerId), state: states(o.state),
      targeting: targeting(o.targeting),
      regions: regions(o.regionalConfigs).map(r => ({ regionCode: r.regionCode, newSubscriberAvailability: r.newSubscriberAvailability === true })),
      phases: list(o.phases).slice(0, 2).map(p => ({ duration: text(p.duration),
        recurrenceCount: Number.isInteger(p.recurrenceCount) ? p.recurrenceCount : null,
        regions: regions(p.regionalConfigs).map(r => ({ regionCode: r.regionCode,
          free: object(r.free) && !['price', 'relativeDiscount', 'absoluteDiscount'].some(k => k in r),
          price: money(r.price), relativeDiscount: Number.isFinite(r.relativeDiscount) ? r.relativeDiscount : null,
          absoluteDiscount: money(r.absoluteDiscount) })) })) })) };
}

async function readCatalogJSON(response) {
  if (!response.headers.get('content-type')?.includes('application/json')) throw Error('Invalid response');
  const reader = response.body?.getReader();
  if (!reader) throw Error('Missing response');
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

export async function handlePlayCatalog(request, env, accessToken) {
  if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, 405);
  if (new URL(request.url).search) return json({ ok: false, error: 'No query parameters supported' }, 400);
  const secret = typeof env.MERCHANT_PROMO_ADMIN_SECRET === 'string' ? env.MERCHANT_PROMO_ADMIN_SECRET.trim() : '';
  if (!secret) return json({ ok: false, error: 'Admin access unavailable' }, 503);
  if (await promoHash(request.headers.get('authorization') || '') !== await promoHash(`Bearer ${secret}`)) {
    return json({ ok: false, error: 'Unauthorized' }, 401);
  }
  // Fixed catalog paths only. No purchase tokens, client-selected URLs, Store writes or ledger changes.
  const signal = AbortSignal.timeout(20000);
  let stage = 'authorization', providerStatus = null;
  try {
    const auth = await accessToken(env, signal);
    if (!auth.ok || !auth.token) throw Error('Authorization unavailable');
    const read = async (productId, suffix) => {
      stage = productId + (suffix ? ':offers' : ':subscription');
      providerStatus = null;
      const response = await fetch(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${APP}/subscriptions/${productId}${suffix}`, {
        method: 'GET', headers: { authorization: `Bearer ${auth.token}` }, redirect: 'manual', signal,
      });
      providerStatus = response.status;
      if (!response.ok) { await response.body?.cancel(); throw Error('Catalog unavailable'); }
      return readCatalogJSON(response);
    };
    const products = [];
    for (const productId of PRODUCTS) {
      const subscription = await read(productId, '');
      const offers = await read(productId, '/basePlans/-/offers?pageSize=20');
      products.push(summarizePlayCatalog(productId, subscription, offers));
    }
    return json({ ok: true, checkedAt: new Date().toISOString(), products,
      purchaseVerificationTested: false, redemptionTested: false });
  } catch {
    // Never echo provider messages, account identities, access tokens or private signing data.
    return json({ ok: false, error: 'Store catalog unavailable', stage, providerStatus }, 503);
  }
}

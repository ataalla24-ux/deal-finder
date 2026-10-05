const DAY = 86400000;
const PACKAGE = { id: 'starter', name: 'Starter Boost', durationDays: 1 };
const PREFIX = '/api/merchant/promos';
const headers = {
  'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
  'access-control-allow-origin': '*',
};
const json = (body, status = 200) => Response.json(body, { status, headers });
const text = value => typeof value === 'string' ? value.trim().normalize('NFC') : '';
const normalizeCode = value => text(value).toUpperCase().replace(/[\s-]/g, '');
const validCode = code => /^FF[A-F0-9]{32}$/.test(code);
export async function promoHash(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
}
class PromoError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
async function body(request) {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new PromoError('JSON erwartet.', 415);
  const reader = request.body?.getReader();
  const decoder = new TextDecoder();
  let raw = '', size = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16000) { await reader.cancel(); throw new PromoError('Anfrage zu groß.', 413); }
      raw += decoder.decode(value, { stream: true });
    }
  }
  raw += decoder.decode();
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new PromoError('Ungültige Anfrage.'); }
}
function field(value, label, max, required = true) {
  const result = text(value);
  if ((required && !result) || result.length > max || /[\u0000-\u0008\u000b-\u001f]/.test(result)) {
    throw new PromoError(`${label} fehlt oder ist zu lang.`);
  }
  return result;
}
function campaignDraft(payload, record) {
  if (payload.acceptedTerms !== true) throw new PromoError('Bitte die Richtigkeit der Angaben bestätigen.');
  const restaurantName = field(payload.restaurantName, 'Restaurant', 90);
  if (record.restaurantName && restaurantName.toLocaleLowerCase('de-AT') !== record.restaurantName.toLocaleLowerCase('de-AT')) {
    throw new PromoError('Dieser Code gehört zu einem anderen Restaurant.', 409);
  }
  const ctaURL = field(payload.ctaURL, 'Link', 1000);
  try {
    const url = new URL(ctaURL);
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname.includes('.') || url.username || url.password) throw new Error();
  } catch { throw new PromoError('Bitte einen gültigen https://-Link angeben.'); }
  return {
    restaurantName, dealTitle: field(payload.dealTitle, 'Deal-Titel', 110),
    description: field(payload.description, 'Details und Bedingungen', 360),
    address: field(payload.address, 'Adresse', 140), ctaURL,
    oldPrice: field(payload.oldPrice, 'Normalpreis', 40, false),
    dealPrice: field(payload.dealPrice, 'Dealpreis', 40, false), category: 'essen',
  };
}
function requireAvailable(record, now) {
  if (!record) throw new PromoError('Code ungültig oder nicht mehr verfügbar.', 404);
  if (record.revokedAt) throw new PromoError('Dieser Code wurde gesperrt.', 409);
  if (record.campaign) throw new PromoError('Dieser Code wurde bereits eingelöst.', 409);
  if (record.expiresAt <= now) throw new PromoError('Dieser Code ist abgelaufen.', 410);
}
function publicCode(record) {
  return {
    id: record.id, label: record.label, restaurantName: record.restaurantName,
    suffix: record.suffix, package: PACKAGE, createdAt: record.createdAt,
    expiresAt: record.expiresAt, redeemedAt: record.campaign?.createdAt || null,
    campaignId: record.campaign?.id || null, revokedAt: record.revokedAt || null,
  };
}

// A single durable ledger owns code consumption AND campaign creation. KV is
// eventually consistent and cannot safely enforce a one-use promotion.
export class MerchantPromoLedger {
  constructor(ctx) { this.storage = ctx.storage; }
  async fetch(request) {
    const path = new URL(request.url).pathname;
    try {
      if (path === '/active') {
        const records = await this.storage.list({ prefix: 'code:' });
        const now = Date.now();
        return json({ ok: true, campaigns: Array.from(records.values())
          .map(record => record.campaign).filter(campaign => campaign && campaign.startsAt <= now && campaign.endsAt > now) });
      }
      if (path === '/codes' && request.method === 'GET') {
        const records = await this.storage.list({ prefix: 'code:' });
        return json({ ok: true, codes: Array.from(records.values()).map(publicCode).sort((a, b) => b.createdAt - a.createdAt) });
      }
      const payload = await body(request);
      if (path === '/codes') {
        if (payload.packageId && payload.packageId !== PACKAGE.id) throw new PromoError('Aktuell nur Starter Boost (1 Tag).');
        const restaurantName = field(payload.restaurantName, 'Restaurant', 90, false);
        const label = field(payload.label, 'Notiz', 120, false);
        const expiresInDays = payload.expiresInDays ?? 30;
        if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 90) throw new PromoError('Code-Gültigkeit: 1 bis 90 Tage.');
        const code = `FF-${crypto.randomUUID().replace(/-/g, '').toUpperCase()}`;
        const id = await promoHash(normalizeCode(code));
        const now = Date.now();
        const record = { id, restaurantName, label, suffix: code.slice(-4), createdAt: now, expiresAt: now + expiresInDays * DAY };
        await this.storage.put(`code:${id}`, record);
        return json({ ok: true, code, ...publicCode(record), redeemURL: `https://freefinder.at/business-promo.html#code=${encodeURIComponent(code)}` }, 201);
      }
      if (path === '/revoke') {
        const id = text(payload.id);
        if (!/^[a-f0-9]{64}$/.test(id)) throw new PromoError('Ungültige Code-ID.');
        return await this.storage.transaction(async txn => {
          const record = await txn.get(`code:${id}`);
          if (!record) throw new PromoError('Code nicht gefunden.', 404);
          if (record.campaign) throw new PromoError('Code bereits eingelöst; die laufende Anzeige wird nicht verändert.', 409);
          record.revokedAt ||= Date.now();
          await txn.put(`code:${id}`, record);
          return json({ ok: true, ...publicCode(record) });
        });
      }
      if (!['/check', '/redeem'].includes(path)) return json({ ok: false, error: 'Not found' }, 404);

      const rateKey = `rate:${request.headers.get('x-promo-client') || 'unknown'}`;
      await this.storage.transaction(async txn => {
        const now = Date.now();
        const prior = await txn.get(rateKey);
        const rate = prior?.until > now ? prior : { until: now + 60000, count: 0 };
        if (rate.count >= 30) throw new PromoError('Zu viele Versuche. Bitte in einer Minute erneut versuchen.', 429);
        rate.count += 1;
        await txn.put(rateKey, rate);
      });
      // Bound stored limiter state without persisting raw IP addresses.
      const rates = await this.storage.list({ prefix: 'rate:', limit: 1000 });
      const stale = Array.from(rates).filter(([, value]) => value.until <= Date.now()).map(([key]) => key);
      if (stale.length) await this.storage.delete(stale);
      const code = normalizeCode(payload.code);
      if (!validCode(code)) throw new PromoError('Code ungültig oder nicht mehr verfügbar.', 404);
      const key = `code:${await promoHash(code)}`;
      if (path === '/check') {
        const record = await this.storage.get(key);
        requireAvailable(record, Date.now());
        return json({ ok: true, restaurantName: record.restaurantName, package: PACKAGE, expiresAt: record.expiresAt, amount: 0, currency: 'EUR' });
      }
      const requestId = text(payload.requestId);
      if (!/^[a-f0-9-]{32,36}$/i.test(requestId)) throw new PromoError('Ungültige Anfrage-ID.');
      const record = await this.storage.get(key);
      if (!record) requireAvailable(record, Date.now());
      const draft = campaignDraft(payload, record);
      const fingerprint = await promoHash(JSON.stringify(draft));
      const requestHash = await promoHash(requestId);
      return await this.storage.transaction(async txn => {
        const current = await txn.get(key);
        if (current?.campaign && current.requestHash === requestHash) {
          if (current.fingerprint !== fingerprint) throw new PromoError('Diese Anfrage wurde bereits mit anderen Angaben eingelöst.', 409);
          return json({ ok: true, campaign: current.campaign, duplicate: true });
        }
        const now = Date.now();
        requireAvailable(current, now);
        const campaign = {
          ...draft, id: crypto.randomUUID(), status: 'sponsored', platform: 'web', paymentProvider: 'promo',
          packageId: PACKAGE.id, packageName: PACKAGE.name, amount: 0, currency: 'EUR',
          createdAt: now, startsAt: now, endsAt: now + PACKAGE.durationDays * DAY,
        };
        await txn.put(key, { ...current, campaign, fingerprint, requestHash });
        return json({ ok: true, campaign, duplicate: false }, 201);
      });
    } catch (error) {
      if (error instanceof PromoError) return json({ ok: false, error: error.message }, error.status);
      throw error;
    }
  }
}

export function promoLedger(env) {
  const binding = env.MERCHANT_PROMOS;
  return binding?.get(binding.idFromName('merchant-promos-v1'));
}
export async function handlePromoRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.slice(PREFIX.length);
  const admin = path.startsWith('/admin/');
  const allowedMethod = path === '/admin/codes' ? ['GET', 'POST'] : ['POST'];
  if (!['/check', '/redeem', '/admin/codes', '/admin/revoke'].includes(path)) return json({ ok: false, error: 'Not found' }, 404);
  if (!allowedMethod.includes(request.method)) return json({ ok: false, error: 'Method not allowed' }, 405);
  if (admin) {
    const secret = text(env.MERCHANT_PROMO_ADMIN_SECRET);
    if (!secret) return json({ ok: false, error: 'Promo-Verwaltung nicht eingerichtet.' }, 503);
    const presented = request.headers.get('authorization') || '';
    if (await promoHash(presented) !== await promoHash(`Bearer ${secret}`)) return json({ ok: false, error: 'Unauthorized' }, 401);
  }
  const ledger = promoLedger(env);
  if (!ledger) return json({ ok: false, error: 'Promo-Codes sind momentan nicht verfügbar.' }, 503);
  const init = { method: request.method, headers: {
    'content-type': request.headers.get('content-type') || '',
    'x-promo-client': await promoHash(request.headers.get('cf-connecting-ip') || 'unknown'),
  } };
  if (request.method === 'POST') init.body = request.body;
  return ledger.fetch(new Request(`https://promo.internal${path.replace('/admin', '')}`, init));
}

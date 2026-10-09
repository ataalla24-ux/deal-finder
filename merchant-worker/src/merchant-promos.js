import { adContentViolation, AD_POLICY_MESSAGE } from './ad-content-policy.js';
const DAY = 86400000;
const PACKAGES = [
  { id: 'starter', name: 'Starter Boost', durationDays: 1 },
  { id: 'spotlight', name: 'Spotlight Boost', durationDays: 3 },
  { id: 'city', name: 'City Push', durationDays: 8 },
];
const PREFIX = '/api/merchant/promos';
const headers = {
  'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
  'access-control-allow-origin': '*',
};
const json = (body, status = 200) => Response.json(body, { status, headers });
const text = value => typeof value === 'string' ? value.trim().normalize('NFC') : '';
const normalizeCode = value => text(value).toUpperCase().replace(/[\s-]/g, '');
const validCode = code => /^(?:FF[A-F0-9]{32}|[A-Z0-9]{6,32})$/.test(code);
export async function promoHash(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
}
class PromoError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
function packageFor(id) {
  // Codes created before package selection always granted Starter Boost.
  const pack = PACKAGES.find(item => item.id === (id ?? 'starter'));
  if (!pack) throw new PromoError('Unbekanntes Business-Paket.');
  return pack;
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
  if (payload.offerValidityText != null && typeof payload.offerValidityText !== 'string') throw new PromoError('Angebotszeitraum ist ungültig.');
  if (payload.acceptedTerms !== true) throw new PromoError('Bitte die Richtigkeit der Angaben bestätigen.');
  const restaurantName = field(payload.restaurantName, 'Restaurant', 90);
  const offerValidityText = field(payload.offerValidityText, 'Angebotszeitraum', 160, false);
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
    // Omit empty values so old idempotent retries retain their original hash.
    ...(offerValidityText ? { offerValidityText } : {}),
  };
}
function requireAvailable(record, now) {
  if (!record) throw new PromoError('Code ungültig oder nicht mehr verfügbar.', 404);
  if (record.revokedAt) throw new PromoError('Dieser Code wurde gesperrt.', 409);
  if (record.campaign) throw new PromoError('Dieser Code wurde bereits eingelöst.', 409);
  if (record.expiresAt != null && record.expiresAt <= now) throw new PromoError('Dieser Code ist abgelaufen.', 410);
}
// Business identity is device-independent, but self-declared. This prevents
// repeat/accidental claims, not impersonation without verified merchant accounts.
export function restaurantIdentity(name, address) {
  const normalize = value => text(value).toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/\p{M}/gu, '')
    .replace(/str\.?\b/g, 'strasse').replace(/\bvienna\b/g, 'wien')
    .replace(/[^a-z0-9]/g, '');
  const normalizedName = normalize(name);
  const normalizedAddress = normalize(address);
  if (normalizedName.length < 3 || !/\b\d{4}\b/.test(address) || !/\d/.test(address.replace(/\b\d{4}\b/g, ''))) {
    throw new PromoError('Bitte Restaurantname und vollständige Adresse mit Hausnummer und Postleitzahl angeben.');
  }
  return `${normalizedName}|${normalizedAddress}`;
}
function publicCode(record) {
  return {
    id: record.id, label: record.label, restaurantName: record.restaurantName,
    suffix: record.suffix, package: packageFor(record.packageId), createdAt: record.createdAt,
    expiresAt: record.expiresAt, redeemedAt: record.campaign?.createdAt || null,
    campaignId: record.campaign?.id || null, revokedAt: record.revokedAt || null,
    kind: record.kind || 'individual', redemptionCount: record.redemptionCount || (record.campaign ? 1 : 0),
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
        const redemptions = await this.storage.list({ prefix: 'redemption:' });
        const now = Date.now();
        return json({ ok: true, campaigns: [...records.values(), ...redemptions.values()]
          .map(record => record.campaign).filter(campaign => campaign && !campaign.hiddenAt && campaign.startsAt <= now && campaign.endsAt > now) });
      }
      if (path === '/codes' && request.method === 'GET') {
        const records = await this.storage.list({ prefix: 'code:' });
        return json({ ok: true, codes: Array.from(records.values()).map(publicCode).sort((a, b) => b.createdAt - a.createdAt) });
      }
      const payload = await body(request);
      if (path === '/campaigns/hide') {
        const id = text(payload.id);
        if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) throw new PromoError('Ungültige Anzeigen-ID.');
        const reason = field(payload.reason, 'Grund', 200);
        // Keep the receipt and one-use claim; hiding an ad must not enable reuse.
        return await this.storage.transaction(async txn => {
          const records = await txn.list({ prefix: 'code:' });
          const redemptions = await txn.list({ prefix: 'redemption:' });
          const match = [...records, ...redemptions].find(([, record]) => record.campaign?.id === id);
          if (!match) throw new PromoError('Anzeige nicht gefunden.', 404);
          const [key, record] = match;
          if (!record.campaign.hiddenAt) {
            record.campaign = { ...record.campaign, hiddenAt: Date.now(), hiddenReason: reason };
            await txn.put(key, record);
          }
          return json({ ok: true, campaign: record.campaign });
        });
      }
      if (path === '/codes') {
        const pack = packageFor(payload.packageId);
        const shared = payload.kind === 'shared';
        if (payload.kind && !['shared', 'individual'].includes(payload.kind)) throw new PromoError('Ungültige Code-Art.');
        const restaurantName = shared ? '' : field(payload.restaurantName, 'Restaurant', 90, false);
        const label = field(payload.label, 'Notiz', 120, false);
        const expiresInDays = payload.expiresInDays ?? 30;
        if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 90) throw new PromoError('Code-Gültigkeit: 1 bis 90 Tage.');
        const code = shared ? normalizeCode(payload.code) : `FF-${crypto.randomUUID().replace(/-/g, '').toUpperCase()}`;
        if (!validCode(normalizeCode(code))) throw new PromoError('Gemeinsamer Code: 6 bis 32 Buchstaben oder Ziffern.');
        const id = await promoHash(normalizeCode(code));
        const now = Date.now();
        const record = { id, kind: shared ? 'shared' : 'individual', packageId: pack.id, restaurantName, label, suffix: code.slice(-4), createdAt: now, expiresAt: shared ? null : now + expiresInDays * DAY };
        await this.storage.transaction(async txn => {
          if (await txn.get(`code:${id}`)) throw new PromoError('Dieser Code existiert bereits. Einlösungen werden nicht zurückgesetzt.', 409);
          await txn.put(`code:${id}`, record);
        });
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
        return json({ ok: true, restaurantName: record.restaurantName, kind: record.kind || 'individual', package: packageFor(record.packageId), expiresAt: record.expiresAt, amount: 0, currency: 'EUR' });
      }
      const requestId = text(payload.requestId);
      if (!/^[a-f0-9-]{32,36}$/i.test(requestId)) throw new PromoError('Ungültige Anfrage-ID.');
      const record = await this.storage.get(key);
      if (!record) requireAvailable(record, Date.now());
      const draft = campaignDraft(payload, record);
      const fingerprint = await promoHash(JSON.stringify(draft));
      const requestHash = await promoHash(requestId);
      const redemptionKey = record.kind === 'shared'
        ? `redemption:${record.id}:${await promoHash(restaurantIdentity(draft.restaurantName, draft.address))}`
        : key;
      return await this.storage.transaction(async txn => {
        const current = await txn.get(key);
        const redeemed = redemptionKey === key ? current : await txn.get(redemptionKey);
        if (redeemed?.campaign && redeemed.requestHash === requestHash) {
          if (redeemed.fingerprint !== fingerprint) throw new PromoError('Diese Anfrage wurde bereits mit anderen Angaben eingelöst.', 409);
          return json({ ok: true, campaign: redeemed.campaign, duplicate: true });
        }
        const now = Date.now();
        requireAvailable(current, now);
        if (redeemed?.campaign) throw new PromoError('Dieses Restaurant hat diesen Promo-Code bereits genutzt.', 409);
        if (adContentViolation(draft)) throw new PromoError(AD_POLICY_MESSAGE, 422);
        const pack = packageFor(current.packageId);
        const campaign = {
          ...draft, id: crypto.randomUUID(), status: 'sponsored', platform: ['ios', 'android'].includes(payload.platform) ? payload.platform : 'web', paymentProvider: 'promo',
          packageId: pack.id, packageName: pack.name, amount: 0, currency: 'EUR',
          createdAt: now, startsAt: now, endsAt: now + pack.durationDays * DAY,
        };
        await txn.put(redemptionKey, { ...(redemptionKey === key ? current : {}), campaign, fingerprint, requestHash });
        if (redemptionKey !== key) await txn.put(key, { ...current, redemptionCount: (current.redemptionCount || 0) + 1 });
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
  if (!['/check', '/redeem', '/admin/codes', '/admin/revoke', '/admin/campaigns/hide'].includes(path)) return json({ ok: false, error: 'Not found' }, 404);
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

import { Webhook } from 'svix';
import { sendResendEmail } from './resend-email.js';

export const EMAIL_ORIGIN = 'https://freefinder-merchant-backend.freefinder-stefan.workers.dev';
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const TOKEN = /^[a-f0-9]{64}$/;
const PREFERENCES = ['rewardEmails', 'dealEmails', 'weeklyEmails'];
const QA_ID = '58ebf424-6c46-42ad-972a-a45923c00687';
const QA_LOGICAL = 'owner-delivery-test-2026-10-13';
const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
  new TextEncoder().encode(value)))).map(x => x.toString(16).padStart(2, '0')).join('');
const addressHash = address => hash('freefinder-email-address-v1:' + address.trim().toLowerCase());
const tokenHash = token => hash('freefinder-email-unsubscribe-v1:' + token);
const publicStatus = row => ({ ok: true, state: row?.state || 'absent',
  ...(row?.providerId ? { providerId: row.providerId } : {}),
  ...(row?.result ? { result: row.result } : {}), delivered: row?.delivered === true });
const stub = env => env.REFERRAL_MONTHS.get(env.REFERRAL_MONTHS.idFromName('referral-months-v1'));
const internal = (env, action, body) => stub(env).fetch(new Request('https://referrals.internal/' + action,
  { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));

async function limitedText(request, max) {
  const reader = request.body?.getReader();
  if (!reader) return '';
  let size = 0; const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel(); throw Error('Payload too large'); }
    chunks.push(value);
  }
  return new Blob(chunks).text();
}

function unsubscribePage(done = false) {
  return new Response(`<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FreeFinder E-Mails</title><style>body{font:18px system-ui;max-width:36rem;margin:12vh auto;padding:24px;color:#202124}button{font:inherit;padding:14px 24px;background:#202124;color:white;border:0;border-radius:6px}p{line-height:1.5}</style><h1>${done ? 'Abmeldung gespeichert' : 'FreeFinder E-Mails'}</h1><p>${done ? 'Du erhältst keine weiteren freiwilligen FreeFinder E-Mails an diese Adresse. Bereits versendete Nachrichten können noch eintreffen.' : 'Möchtest du freiwillige Deal-, Wochenrückblick- und Belohnungs-E-Mails abbestellen? Deine App-Mitteilungen und dein Abo bleiben unverändert.'}</p>${done ? '' : '<form method="post"><button type="submit">E-Mails abbestellen</button></form>'}</html>`, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
      'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" },
  });
}

export async function handleAccountEmail(request, env) {
  const url = new URL(request.url);
  if (!env.REFERRAL_MONTHS) return json({ ok: false }, 503);
  if (url.pathname === '/api/email/unsubscribe') {
    if (!['GET', 'POST'].includes(request.method)) return json({ ok: false }, 405);
    const token = url.searchParams.get('token');
    if (!TOKEN.test(token || '') || [...url.searchParams.keys()].some(k => k !== 'token') || url.searchParams.getAll('token').length !== 1) {
      return json({ ok: false, error: 'Ungültiger Abmeldelink.' }, 400);
    }
    // Link scanners may GET without changing a subscription. RFC8058 and the form POST perform the opt-out.
    if (request.method === 'GET') return unsubscribePage();
    try { await limitedText(request, 512); } catch { return json({ ok: false }, 413); }
    const result = await internal(env, 'email-unsubscribe', { tokenHash: await tokenHash(token) });
    return result.ok ? unsubscribePage(true) : json({ ok: false }, 503);
  }
  if (url.pathname === '/api/email/resend-webhook') {
    if (request.method !== 'POST') return json({ ok: false }, 405);
    if (!env.RESEND_WEBHOOK_SECRET) return json({ ok: false }, 503);
    let event;
    try {
      const raw = await limitedText(request, 32768);
      new Webhook(env.RESEND_WEBHOOK_SECRET).verify(raw, {
        'svix-id': request.headers.get('svix-id'), 'svix-timestamp': request.headers.get('svix-timestamp'),
        'svix-signature': request.headers.get('svix-signature'),
      });
      event = JSON.parse(raw);
    } catch { return json({ ok: false }, 400); }
    const allowed = ['email.delivered', 'email.bounced', 'email.complained', 'email.failed', 'email.suppressed'];
    if (!allowed.includes(event?.type)) return json({ ok: true });
    if (!UUID.test(event.data?.email_id || '')) return json({ ok: false }, 400);
    // Do not retain subjects, recipient addresses or diagnostic payloads from provider events.
    return internal(env, 'email-event', { type: event.type, providerId: event.data.email_id });
  }
  if (url.pathname === '/api/email/admin/owner-test') {
    if (!['GET', 'POST'].includes(request.method)) return json({ ok: false }, 405);
    if (url.search) return json({ ok: false }, 400);
    const secret = env.MERCHANT_PROMO_ADMIN_SECRET?.trim();
    if (!secret || await hash(request.headers.get('authorization') || '') !== await hash(`Bearer ${secret}`)) {
      return json({ ok: false }, 401);
    }
    if (request.method === 'POST') {
      if (env.ACCOUNT_EMAIL_QA_ENABLED !== '1') return json({ ok: false }, 503);
      try { if ((await limitedText(request, 1)).length) return json({ ok: false }, 400); }
      catch { return json({ ok: false }, 400); }
    }
    return internal(env, request.method === 'POST' ? 'email-owner-test' : 'email-owner-status', {});
  }
  return json({ ok: false }, 404);
}

// Shares the account's serialized Durable Object, so opt-out/deletion cannot race a queued send.
export function accountEmailLedger(Base) {
  return class extends Base {
    async perform(action, body) {
      if (action === 'email-owner-status') return publicStatus(await this.storage.get('mail:owner-test'));
      if (action === 'email-owner-test') return this.ownerEmailTest();
      if (action === 'email-unsubscribe') return this.unsubscribeEmail(body.tokenHash);
      if (action === 'email-event') return this.emailEvent(body);
      const result = await super.perform(action, body);
      if (action === 'account-delete' && result.ok) await this.purgeAccountEmail(body.accountId);
      return result;
    }
    emailTransport(delivery) { return sendResendEmail(this.env, delivery); }
    async emailQuota(now) {
      const day = new Date(now).toISOString().slice(0, 10), month = day.slice(0, 7);
      const current = await this.storage.get('mail:quota') || {};
      const daily = current.day === day ? current.daily : 0;
      const monthly = current.month === month ? current.monthly : 0;
      if (daily >= 90 || monthly >= 2700) return false;
      // Count attempts before the external call, including ambiguous outcomes; no automatic refunds.
      await this.storage.put('mail:quota', { day, month, daily: daily + 1, monthly: monthly + 1 });
      return true;
    }
    async ownerEmailTest() {
      const prior = await this.storage.get('mail:owner-test');
      if (prior) return publicStatus(prior);
      if (this.env.ACCOUNT_EMAIL_QA_ENABLED !== '1' || this.env.ACCOUNT_EMAIL_TRANSPORT_ENABLED !== '1') {
        return { ok: false, state: 'disabled' };
      }
      return this.dispatchEmail('mail:owner-test', {
        id: QA_ID, logicalId: QA_LOGICAL, createdAt: Date.now(), to: 'freefinder.at@gmail.com',
        subject: 'FreeFinder: einmaliger E-Mail-Zustelltest',
        text: 'Dies ist die von dir freigegebene einmalige Test-E-Mail von FreeFinder.\n\nDer Versand von hallo@freefinder.at funktioniert bis zu deinem Postfach, wenn du diese Nachricht dort siehst. Es wurde kein Newsletter aktiviert und keine Nachricht an andere Nutzer gesendet.\n\nDeine App-Mitteilungen, Abos und Belohnungen bleiben unverändert.\n\nDein FreeFinder Team',
      }, null);
    }
    async sendAccountEmail(accountId, logicalId, preference, content) {
      if (this.env.ACCOUNT_EMAIL_ENABLED !== '1' || this.env.ACCOUNT_EMAIL_TRANSPORT_ENABLED !== '1' ||
          !this.env.RESEND_WEBHOOK_SECRET) return { ok: false, state: 'disabled' };
      if (!UUID.test(accountId || '') || !PREFERENCES.includes(preference) ||
          typeof logicalId !== 'string' || !/^[A-Za-z0-9:_-]{1,160}$/.test(logicalId)) return { ok: false, state: 'invalid' };
      const key = `mail:account:${accountId}:` + await hash(logicalId);
      const prior = await this.storage.get(key);
      if (prior) return publicStatus(prior);
      const account = await this.storage.get('account:' + accountId);
      if (!account?.recoverable || account.deletedAt || !account.email || account.preferences?.[preference] !== true) {
        return { ok: false, state: 'no_consent' };
      }
      const targetHash = await addressHash(account.email);
      if (await this.storage.get('mail:suppressed:' + targetHash)) return { ok: false, state: 'suppressed' };
      const token = Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x => x.toString(16).padStart(2, '0')).join('');
      const unsubscribeURL = EMAIL_ORIGIN + '/api/email/unsubscribe?token=' + token;
      const delivery = { id: crypto.randomUUID(), logicalId, createdAt: Date.now(), to: account.email,
        subject: content.subject, text: content.text + '\n\nE-Mails abbestellen: ' + unsubscribeURL, unsubscribeURL };
      return this.dispatchEmail(key, delivery, { accountId, targetHash, tokenHash: await tokenHash(token), preference });
    }
    async dispatchEmail(key, delivery, owner) {
      if (!await this.emailQuota(delivery.createdAt)) return { ok: false, state: 'quota' };
      const row = { state: 'attempting', delivery, ...(owner || {}) };
      const writes = { [key]: row };
      if (owner) writes['mail:token:' + owner.tokenHash] = { accountId: owner.accountId, targetHash: owner.targetHash };
      // A crash after this write leaves an immutable unresolved attempt, never a new send on restart.
      await this.storage.put(writes);
      const result = await this.emailTransport(delivery);
      const final = { ...row, state: result.outcome, result };
      if (result.providerId) {
        final.providerId = result.providerId;
        await this.storage.put({ [key]: final, ['mail:provider:' + result.providerId]: key });
      } else await this.storage.put(key, final);
      return publicStatus(final);
    }
    async unsubscribeEmail(digest) {
      if (!TOKEN.test(digest || '')) return { ok: false };
      const target = await this.storage.get('mail:token:' + digest);
      if (!target) return { ok: true };
      const account = await this.storage.get('account:' + target.accountId);
      if (account?.email && !account.deletedAt && await addressHash(account.email) === target.targetHash) {
        account.preferences = Object.fromEntries(PREFERENCES.map(k => [k, false]));
        account.consentEvents = [...(account.consentEvents || []), { at: Date.now(), reason: 'email_unsubscribe', version: 1 }].slice(-100);
        await this.storage.put('account:' + target.accountId, account);
      }
      return { ok: true };
    }
    async emailEvent({ providerId, type }) {
      const key = await this.storage.get('mail:provider:' + providerId);
      const row = key && await this.storage.get(key);
      if (!row || row.providerId !== providerId) return { ok: true };
      if (type === 'email.delivered') row.delivered = true;
      if (['email.bounced', 'email.complained', 'email.suppressed', 'email.failed'].includes(type)) {
        row.state = type.slice(6);
        if (row.targetHash) await this.storage.put('mail:suppressed:' + row.targetHash, { at: Date.now(), reason: type });
      }
      // A later delivered event must not undo a complaint or suppression, even if webhook events arrive out of order.
      await this.storage.put(key, row);
      return { ok: true };
    }
    async purgeAccountEmail(accountId) {
      if (!UUID.test(accountId || '')) throw Error('Invalid account');
      const rows = await this.storage.list({ prefix: `mail:account:${accountId}:`, limit: 1000 });
      for (const [key, row] of rows) await this.storage.delete([key,
        ...(row.providerId ? ['mail:provider:' + row.providerId] : []),
        ...(row.tokenHash ? ['mail:token:' + row.tokenHash] : [])]);
      if (rows.size === 1000) throw Error('Email cleanup needs another attempt');
    }
  };
}

import { referralHash } from './referral-months.js';

const DAY = 86400000;
const devicesKey = id => 'invitation-devices:' + id;
const tokenKey = hash => 'invitation-token:' + hash;
const eventPrefix = 'invitation-event:';
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const QA_KEY = 'invitation-owner-test:2026-10-20';
const QA_END = Date.parse('2026-10-21T20:00:00Z');

export async function handleInvitationPushAdmin(request, env) {
  const url = new URL(request.url);
  const secret = env.MERCHANT_PROMO_ADMIN_SECRET?.trim();
  if (!secret || await referralHash(request.headers.get('authorization') || '') !== await referralHash(`Bearer ${secret}`)) {
    return Response.json({ ok: false }, { status: 401 });
  }
  if (url.search || !['GET', 'POST'].includes(request.method) || (request.method === 'POST' && (await request.text()).length)) {
    return Response.json({ ok: false }, { status: 400 });
  }
  return env.REFERRAL_MONTHS.get(env.REFERRAL_MONTHS.idFromName('referral-months-v1'))
    .fetch('https://referrals.internal/' + (request.method === 'GET' ? 'invitation-owner-status' : 'invitation-owner-test'),
      { method: 'POST', body: '{}' });
}

export function invitationPushLedger(Base) {
  return class extends Base {
    async perform(action, body) {
      if (action === 'invitation-owner-status') {
        const owner = this.env.INVITATION_PUSH_QA_ACCOUNT;
        const devices = owner ? await this.storage.get(devicesKey(owner)) || {} : {};
        return { ok: true, enabled: this.env.INVITATION_PUSH_ENABLED === '1',
          qaEnabled: this.env.INVITATION_PUSH_QA_ENABLED === '1' && Date.now() < QA_END,
          devices: Object.values(devices).map(d => ({ provider: d.provider, environment: d.environment, updatedAt: d.updatedAt })),
          test: await this.storage.get(QA_KEY) || null };
      }
      if (action === 'invitation-owner-test') {
        const prior = await this.storage.get(QA_KEY);
        if (prior) return { ok: true, test: prior };
        const now = Date.now(), owner = this.env.INVITATION_PUSH_QA_ACCOUNT;
        if (this.env.INVITATION_PUSH_QA_ENABLED !== '1' || now >= QA_END || !owner) fail('Test nicht freigeschaltet.', 403);
        const account = await this.storage.get('account:' + owner);
        const devices = Object.entries(await this.storage.get(devicesKey(owner)) || {})
          .filter(([, d]) => d.provider === 'apns' && d.updatedAt > now - 3600000);
        if (!account?.recoverable || account.deletedAt || devices.length !== 1) fail('Genau ein frisch angemeldetes iPhone erforderlich.', 409);
        const [installation, device] = devices[0];
        const binding = await this.storage.get(tokenKey(device.tokenHash));
        if (binding?.account !== owner || binding.installation !== installation) fail('Gerätezuordnung fehlt.', 409);
        await this.storage.put(QA_KEY, { state: 'attempting', at: now });
        let result;
        try {
          const response = await this.env.DAILY_DEAL_PUSH.get(this.env.DAILY_DEAL_PUSH.idFromName('daily-deals-v1'))
            .fetch('https://push.internal/invitation-owner-test', { method: 'POST', body: JSON.stringify({
              device, eventId: await referralHash(QA_KEY), accountId: owner, expires: now + 3600000,
            }) });
          result = await response.json();
        } catch { result = { ok: false, status: 0 }; }
        const test = { state: result.ok ? 'accepted' : result.status ? 'rejected' : 'unknown',
          status: result.status || 0, at: now };
        await this.storage.put(QA_KEY, test);
        return { ok: true, test };
      }
      return super.perform(action, body);
    }

    async accountAction(action, body, account, key, now) {
      if (action === 'push-device') {
        if (!account?.recoverable || account.deletedAt) fail('Bitte zuerst dein Konto laden.', 409);
        if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(body.installation || '') || typeof body.enabled !== 'boolean') {
          fail('Ungültige Push-Einstellung.');
        }
        const installation = await referralHash(body.installation);
        const records = await this.storage.get(devicesKey(account.id)) || {};
        const previous = records[installation];
        if (!body.enabled) {
          if (previous) {
            delete records[installation];
            await this.storage.transaction(async tx => {
              const owner = await tx.get(tokenKey(previous.tokenHash));
              if (owner?.account === account.id && owner.installation === installation) await tx.delete(tokenKey(previous.tokenHash));
              await tx.put(devicesKey(account.id), records);
            });
          }
          return { ok: true, enabled: false };
        }
        if (this.env.INVITATION_PUSH_ENABLED !== '1') fail('Einladungs-Mitteilungen sind noch nicht verfügbar.', 503);
        if (body.consentVersion !== 1 || !['apns', 'fcm'].includes(body.provider) ||
            !['production', 'sandbox', 'development'].includes(body.environment) ||
            !(body.provider === 'apns' ? /^[a-f0-9]{64,200}$/i : /^[A-Za-z0-9_:.-]{20,4096}$/).test(body.token || '')) {
          fail('Ungültige Push-Registrierung.');
        }
        if (!previous && Object.keys(records).length >= 10) fail('Maximal zehn Geräte pro Konto.', 409);
        const tokenHash = await referralHash(body.provider + ':' + body.token);
        const record = { provider: body.provider, token: body.token, tokenHash,
          environment: body.environment, language: body.language === 'en' ? 'en' : 'de',
          consentVersion: 1, consentAt: previous?.consentAt || now,
          consentID: previous?.consentID || crypto.randomUUID(), updatedAt: now };
        await this.storage.transaction(async tx => {
          const owner = await tx.get(tokenKey(tokenHash));
          if (owner && (owner.account !== account.id || owner.installation !== installation)) {
            const old = await tx.get(devicesKey(owner.account)) || {};
            delete old[owner.installation];
            await tx.put(devicesKey(owner.account), old);
          }
          if (previous && previous.tokenHash !== tokenHash) await tx.delete(tokenKey(previous.tokenHash));
          records[installation] = record;
          await tx.put({ [devicesKey(account.id)]: records, [tokenKey(tokenHash)]: { account: account.id, installation } });
        });
        return { ok: true, enabled: true };
      }
      const result = await super.accountAction(action, body, account, key, now);
      if (action === 'export') {
        const records = await this.storage.get(devicesKey(body.accountId)) || {};
        result.invitationNotifications = Object.values(records).map(d => ({
          provider: d.provider, language: d.language, consentVersion: d.consentVersion,
          consentAt: d.consentAt, updatedAt: d.updatedAt,
        }));
      }
      if (action === 'delete') {
        const records = await this.storage.get(devicesKey(body.accountId)) || {};
        await this.storage.transaction(async tx => {
          for (const [installation, device] of Object.entries(records)) {
            const owner = await tx.get(tokenKey(device.tokenHash));
            if (owner?.account === body.accountId && owner.installation === installation) await tx.delete(tokenKey(device.tokenHash));
          }
          await tx.delete(devicesKey(body.accountId));
        });
      }
      return result;
    }

    async queueInvitationPush(tx, invitee, now) {
      if (this.env.INVITATION_PUSH_ENABLED !== '1') return;
      const key = eventPrefix + invitee.id;
      if (await tx.get(key)) return;
      const devices = await tx.get(devicesKey(invitee.referredBy)) || {};
      const targets = Object.entries(devices).filter(([, d]) => d.updatedAt > now - 30 * DAY)
        .map(([installation, d]) => ({ installation, consentID: d.consentID }));
      if (!targets.length) return;
      // Snapshot consent at the event: turning notifications on later never sends an old acceptance.
      await tx.put(key, { account: invitee.referredBy, createdAt: now, expires: now + DAY, targets, deliveries: {} });
      if (targets.length) await tx.setAlarm(now + 1000);
    }

    async deliverInvitationPushes() {
      if (this.env.INVITATION_PUSH_ENABLED !== '1' || !this.env.DAILY_DEAL_PUSH) return;
      const now = Date.now();
      const events = await this.storage.list({ prefix: eventPrefix, limit: 20 });
      let attempts = 0;
      for (const [key, event] of events) {
        if (event.expires <= now) {
          // The account's acceptedAt is the permanent dedupe guard; short-lived delivery data can expire.
          await this.storage.delete(key);
          continue;
        }
        const account = await this.storage.get('account:' + event.account);
        if (!account?.recoverable || account.deletedAt) { await this.storage.delete(key); continue; }
        for (const target of event.targets) {
          if (event.deliveries[target.installation]) continue;
          if (attempts >= 1) { await this.storage.setAlarm(Date.now() + 1000); return; }
          const devices = await this.storage.get(devicesKey(event.account)) || {};
          const device = devices[target.installation];
          const owner = device && await this.storage.get(tokenKey(device.tokenHash));
          if (!device || device.consentID !== target.consentID || device.updatedAt <= now - 30 * DAY ||
              owner?.account !== event.account || owner.installation !== target.installation ||
              device.environment !== 'production') {
            event.deliveries[target.installation] = { state: 'skipped' };
            await this.storage.put(key, event);
            continue;
          }
          const eventId = await referralHash(key);
          // Claim before provider I/O; an ambiguous transport outcome must not create duplicate alerts.
          event.deliveries[target.installation] = { state: 'attempting', at: now };
          await this.storage.put(key, event);
          attempts++;
          let result;
          try {
            const response = await this.env.DAILY_DEAL_PUSH.get(this.env.DAILY_DEAL_PUSH.idFromName('daily-deals-v1'))
              .fetch('https://push.internal/invitation', { method: 'POST', body: JSON.stringify({
                device, eventId, accountId: event.account, expires: event.expires,
              }) });
            result = await response.json();
          } catch { result = { ok: false, status: 0 }; }
          event.deliveries[target.installation] = {
            state: result.ok ? 'accepted' : result.status ? 'rejected' : 'unknown', status: result.status || 0, at: now,
          };
          await this.storage.put(key, event);
          if (result.invalidToken || result.status === 410 || result.reason === 'BadDeviceToken') {
            delete devices[target.installation];
            await this.storage.put(devicesKey(event.account), devices);
            await this.storage.delete(tokenKey(device.tokenHash));
          }
        }
        await this.storage.put('invitation-receipt:' + String(now).padStart(13, '0') + ':' + await referralHash(key), {
          at: now, states: Object.values(event.deliveries),
        });
        await this.storage.delete(key);
      }
      if (events.size === 20) await this.storage.setAlarm(Date.now() + 1000);
    }

    async pruneInvitationReceipts() {
      const now = Date.now();
      const receipts = await this.storage.list({ prefix: 'invitation-receipt:', limit: 200 });
      const expired = [...receipts].filter(([, r]) => r.at <= now - 7 * DAY).map(([k]) => k);
      if (expired.length) await this.storage.delete(expired);
      const nextRecord = [...receipts.values()].find(r => r.at > now - 7 * DAY);
      const next = receipts.size === 200 && !nextRecord ? now + 1000 : nextRecord?.at + 7 * DAY;
      const scheduled = await this.storage.getAlarm();
      if (Number.isFinite(next) && (!scheduled || scheduled <= now || next < scheduled)) await this.storage.setAlarm(next);
    }

    async alarm() {
      await this.ctx.blockConcurrencyWhile(async () => {
        await this.deliverInvitationPushes();
        await this.pruneInvitationReceipts();
      });
      await super.alarm();
    }
  };
}

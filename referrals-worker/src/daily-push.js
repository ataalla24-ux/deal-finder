import { campaignMessage, dailyMessage, dailyPushDecision, digestTypes, eligiblePushDeals, normalizePushRegistration, pickDailyPush, pickDigestDeals, pickMarketingPush, pushAudience, pushSlot, viennaClock } from './daily-push-policy.js';
import { sendFcmPush } from './fcm-push.js';

const DAY = 86400000;
const json = value => Response.json(value, { headers: { 'cache-control': 'no-store' } });
const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');

export class DailyPushService {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, provider TEXT, tokenHash TEXT, enabled INTEGER, revision REAL, updated REAL, record TEXT)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS device_token ON devices(tokenHash)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS campaigns (day TEXT PRIMARY KEY, created REAL, record TEXT)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS deliveries (day TEXT, device TEXT, state TEXT, status INTEGER, PRIMARY KEY(day, device))');
  }
  now() { return Date.now(); }
  rows(query, ...params) { return this.sql.exec(query, ...params).toArray(); }
  ready(provider) {
    return provider === 'apns' ? Boolean(this.env.APNS_TEAM_ID && this.env.APNS_KEY_ID && this.env.APNS_PRIVATE_KEY && this.env.APNS_BUNDLE_ID)
      : Boolean(this.env.FCM_SERVICE_ACCOUNT_JSON);
  }
  async loadSource() {
    const get = async url => {
      const response = await fetch(url, { signal: AbortSignal.timeout(12000), headers: { 'cache-control': 'no-cache' } });
      if (!response.ok) throw new Error('Daily push source unavailable');
      return response.json();
    };
    const feed = await get(`https://freefinder.at/deals.json?push=${Math.floor(this.now() / 60000)}`);
    const state = await get('https://freefinder-referrals.freefinder-stefan.workers.dev/api/deals/state');
    const featured = await get(`https://freefinder.at/deal-of-the-day.json?push=${Math.floor(this.now() / 60000)}`);
    return { feed, state, featured };
  }
  async send(device, campaign) {
    const message = campaignMessage(campaign, device.language);
    if (device.provider === 'fcm') return sendFcmPush(this.env, device, campaign, message);
    return this.sendApple(device, campaign, message);
  }
  async fetch(request) {
    const path = new URL(request.url).pathname;
    // Private DO binding only. No public registration or push route forwards to this action.
    if (path === '/invitation' || path === '/invitation-owner-test') {
      const { device, eventId, accountId, expires } = await request.json();
      const qa = path === '/invitation-owner-test';
      if (qa && (this.env.INVITATION_PUSH_QA_ENABLED !== '1' || this.now() >= Date.parse('2026-10-21T20:00:00Z') ||
          accountId !== this.env.INVITATION_PUSH_QA_ACCOUNT || eventId !== await hash('invitation-owner-test:2026-10-20'))) {
        return Response.json({ ok: false, status: 403 }, { status: 403 });
      }
      if (!/^[a-f0-9]{64}$/.test(eventId || '') || !/^[a-f0-9-]{36}$/.test(accountId || '') ||
          !Number.isFinite(expires) || expires <= this.now() || expires > this.now() + DAY ||
          !['apns', 'fcm'].includes(device?.provider) ||
          (qa ? device.provider !== 'apns' || !['sandbox', 'production'].includes(device.environment) : device.environment !== 'production')) {
        return Response.json({ ok: false, status: 400 }, { status: 400 });
      }
      if (!this.ready(device.provider)) return Response.json({ ok: false, status: 503 }, { status: 503 });
      const message = qa ? {
        title: 'TEST: FreeFinder Einladungs-Mitteilung',
        body: 'Dein Push-Test ist angekommen. Dies ist nur ein Test, keine echte Einladung oder Belohnung.',
      } : device.language === 'en' ? {
        title: 'Your invitation was accepted',
        body: 'Someone joined FreeFinder with your invitation. See the status under Invite friends.',
      } : {
        title: 'Deine Einladung wurde angenommen',
        body: 'Jemand ist deiner Einladung zu FreeFinder gefolgt. Den Status findest du unter Freunde einladen.',
      };
      const campaign = { type: 'invitation_accepted', eventId, accountId, day: eventId, expires };
      if (qa) {
        return this.ctx.blockConcurrencyWhile(async () => {
          const key = 'owner-push-test-2026-10-20';
          const prior = await this.ctx.storage.get(key);
          if (prior) return json(prior);
          await this.ctx.storage.put(key, { ok: false, status: 0, claimed: true });
          let result;
          try { result = await this.sendApple(device, campaign, message); }
          catch { result = { ok: false, status: 0 }; }
          await this.ctx.storage.put(key, result);
          return json(result);
        });
      }
      return json(device.provider === 'fcm' ? await sendFcmPush(this.env, device, campaign, message)
        : await this.sendApple(device, campaign, message));
    }
    if (path === '/revoke-token') {
      const { provider, token } = await request.json();
      const tokenHash = await hash(`${provider}:${token}`);
      this.sql.exec('UPDATE devices SET enabled = 0, revision = ? WHERE tokenHash = ?', this.now(), tokenHash);
      return json({ ok: true });
    }
    if (path === '/register' || path === '/unregister') {
      const { body, provider } = await request.json();
      let device;
      try { device = normalizePushRegistration(body, provider, this.now()); }
      catch { return Response.json({ ok: false, error: 'Invalid device registration' }, { status: 400 }); }
      const id = await hash(`${provider}:${device.installation}`);
      const tokenHash = await hash(`${provider}:${device.token}`);
      const existing = this.rows('SELECT revision FROM devices WHERE id = ?', id)[0];
      if (!existing || existing.revision <= device.revision) {
        device.enabled = path === '/register' && device.enabled;
        // Token rotation cannot leave an older installation subscribed to the same provider token.
        this.sql.exec('UPDATE devices SET enabled = 0 WHERE tokenHash = ? AND id != ?', tokenHash, id);
        this.sql.exec('INSERT OR REPLACE INTO devices VALUES (?, ?, ?, ?, ?, ?, ?)', id, provider, tokenHash,
          device.enabled ? 1 : 0, device.revision, this.now(), JSON.stringify(device));
      }
      return json({ ok: true, registered: path === '/register', transportReady: this.ready(provider) });
    }
    if (path === '/status') {
      return json({ ok: true, enabled: this.env.DAILY_PUSH_ENABLED === '1', marketingEnabled: this.env.MARKETING_PUSH_ENABLED === '1',
        digestEnabled: this.env.DIGEST_PUSH_ENABLED === '1', digestDays: ['Wednesday', 'Sunday'], digestHour: 18,
        marketingDays: ['Monday', 'Wednesday', 'Friday'], timeZone: 'Europe/Vienna', hour: 9,
        apnsReady: this.ready('apns'), fcmReady: this.ready('fcm'),
        devices: this.rows('SELECT provider, enabled, COUNT(*) AS count FROM devices GROUP BY provider, enabled'),
        audiences: this.rows(`SELECT provider, enabled,
          CASE WHEN json_extract(record, '$.plan') IN ('free', 'pro', 'plus') THEN json_extract(record, '$.plan') ELSE 'unknown' END AS plan,
          CASE WHEN json_extract(record, '$.environment') IN ('production', 'sandbox', 'development') THEN json_extract(record, '$.environment') ELSE 'unknown' END AS environment,
          CASE WHEN json_extract(record, '$.policyVersion') IN (1, 2, 3) THEN json_extract(record, '$.policyVersion') ELSE 0 END AS policyVersion,
          COUNT(*) AS count FROM devices GROUP BY provider, enabled, plan, environment, policyVersion`),
        deliveries: this.rows('SELECT day, state, status, COUNT(*) AS count FROM deliveries GROUP BY day, state, status ORDER BY day DESC LIMIT 40') });
    }
    if (path === '/preview') {
      const source = await this.loadSource();
      const recentDaily = this.rows('SELECT record FROM campaigns WHERE created > ?', this.now() - 7 * DAY)
        .map(x => JSON.parse(x.record)).filter(x => (x.type || 'daily_deal') === 'daily_deal').map(x => x.deal.id);
      const deal = pickDailyPush(source.feed, source.state, [], this.now(), source.featured);
      const marketing = pickMarketingPush(source.feed, source.state, [], this.now());
      const digests = Object.fromEntries(digestTypes.map(type => {
        const deals = pickDigestDeals(source.feed, source.state, [], this.now(), type);
        return [type, { dealIds: deals.map(d => d.id), message: deals.length ? campaignMessage({ type, deals, deal: deals[0] }) : null }];
      }));
      return json({ ok: true, eligible: eligiblePushDeals(source.feed, source.state, this.now()).length,
        dealId: deal?.id || null, message: deal ? dailyMessage(deal) : null,
        dailyDecision: dailyPushDecision(source.feed, source.state, recentDaily, this.now(), source.featured),
        marketingDealId: marketing?.id || null, digests, sends: 0 });
    }
    if (path === '/tick') {
      if (this.activeWindow()) await this.ctx.storage.setAlarm(this.now() + 1);
      return json({ ok: true });
    }
    return new Response('Not found', { status: 404 });
  }
  enabled() { return this.env.DAILY_PUSH_ENABLED === '1' || this.env.MARKETING_PUSH_ENABLED === '1'; }
  activeWindow() {
    const slot = pushSlot(this.now());
    return slot === 'daily' ? this.enabled() : slot === 'digest' &&
      this.env.DIGEST_PUSH_ENABLED === '1' && this.env.MARKETING_PUSH_ENABLED === '1';
  }
  async alarm() {
    if (!this.activeWindow()) return;
    try { await this.deliverBatch(); }
    catch {
      // A failed source fetch never turns into a notification using stale cached content.
      await this.ctx.storage.setAlarm(this.now() + 60000);
      console.warn('daily_push_batch_failed');
    }
  }
  async deliverBatch() {
    const now = this.now();
    const { day } = viennaClock(now);
    const slot = pushSlot(now);
    if (!slot) return;
    // Keep existing morning claims; a separate evening slot cannot suppress the Pro daily deal.
    const deliveryKey = slot === 'daily' ? day : `${day}:digest`;
    this.sql.exec('DELETE FROM deliveries WHERE day < ?', viennaClock(now - 35 * DAY).day);
    this.sql.exec('DELETE FROM campaigns WHERE created < ?', now - 35 * DAY);
    this.sql.exec('DELETE FROM devices WHERE updated < ?', now - 60 * DAY);
    const devices = this.rows(`SELECT * FROM devices d WHERE enabled = 1 AND updated > ?
      AND NOT EXISTS (SELECT 1 FROM deliveries x WHERE x.device = d.id AND x.day = ?)
      ORDER BY id LIMIT 20`, now - 30 * DAY, deliveryKey);
    if (!devices.length) return;
    const { feed, state, featured } = await this.loadSource();
    const eligible = eligiblePushDeals(feed, state, now);
    for (const row of devices) {
      if (pushSlot(this.now()) !== slot || viennaClock(this.now()).day !== day) break;
      const latest = this.rows('SELECT * FROM devices WHERE id = ?', row.id)[0];
      if (!latest?.enabled) continue;
      const device = JSON.parse(latest.record);
      const type = pushAudience(device, this.env, this.now());
      if (!type) {
        this.sql.exec('INSERT OR IGNORE INTO deliveries VALUES (?, ?, ?, ?)', deliveryKey, row.id, 'not_scheduled', 0);
        continue;
      }
      // A test installation or unavailable transport must not consume a real campaign's repeat window.
      if (device.environment !== 'production' || !this.ready(device.provider)) {
        this.sql.exec('INSERT OR IGNORE INTO deliveries VALUES (?, ?, ?, ?)', deliveryKey, row.id,
          device.environment !== 'production' ? 'test_environment' : 'transport_not_ready', 0);
        continue;
      }
      const campaignKey = `${day}:${type}`;
      let campaign = this.rows('SELECT record FROM campaigns WHERE day = ?', campaignKey)[0];
      campaign = campaign ? JSON.parse(campaign.record) : null;
      if (!campaign) {
        const digest = digestTypes.includes(type);
        const recent = this.rows('SELECT record FROM campaigns WHERE created > ?', now - 7 * DAY)
          .map(x => JSON.parse(x.record))
          .filter(x => digest ? digestTypes.includes(x.type) || x.day === day : (x.type || 'daily_deal') === type)
          .flatMap(x => (x.deals || [x.deal]).map(d => d.id));
        const deals = digest ? pickDigestDeals(feed, state, recent, now, type) : [];
        const deal = digest ? deals[0] : type === 'daily_deal' ? pickDailyPush(feed, state, recent, now, featured) : pickMarketingPush(feed, state, recent, now);
        if (!deal) {
          const reason = type === 'daily_deal' ? dailyPushDecision(feed, state, recent, now, featured).reason : 'no_current_deal';
          this.sql.exec('INSERT OR IGNORE INTO deliveries VALUES (?, ?, ?, ?)', deliveryKey, row.id, reason, 0);
          continue;
        }
        const expires = now + (60 - new Date(now).getUTCMinutes()) * 60000 - new Date(now).getUTCSeconds() * 1000;
        campaign = { day, type, deal, ...(digest ? { deals } : {}), expires };
        this.sql.exec('INSERT OR IGNORE INTO campaigns VALUES (?, ?, ?)', campaignKey, now, JSON.stringify(campaign));
        campaign = JSON.parse(this.rows('SELECT record FROM campaigns WHERE day = ?', campaignKey)[0].record);
      }
      const current = eligible.find(d => d.id === campaign.deal.id);
      const currentDeals = (campaign.deals || []).map(d => eligible.find(e => e.id === d.id));
      if (!current || campaign.expires <= this.now() ||
          currentDeals.some(d => !d) ||
          (type === 'daily_deal' && (featured?.date !== day || featured?.dealId !== current.id))) {
        this.sql.exec('INSERT OR IGNORE INTO deliveries VALUES (?, ?, ?, ?)', deliveryKey, row.id, 'stale_selection', 0);
        continue;
      }
      campaign.deal = current;
      if (campaign.deals) campaign.deals = currentDeals;
      // Claim before network I/O. Unknown outcomes are deliberately not retried: providers offer no exactly-once guarantee.
      const claim = this.rows('INSERT OR IGNORE INTO deliveries VALUES (?, ?, ?, ?) RETURNING device', deliveryKey, row.id, 'attempting', 0);
      if (!claim.length) continue;
      let result;
      try { result = await this.send(device, campaign); }
      catch { result = { ok: false, status: 0 }; }
      this.sql.exec('UPDATE deliveries SET state = ?, status = ? WHERE day = ? AND device = ?',
        result.ok ? 'accepted' : result.status ? 'rejected' : 'unknown', result.status || 0, deliveryKey, row.id);
      if (result.invalidToken || result.status === 410 || result.reason === 'BadDeviceToken') {
        this.sql.exec('UPDATE devices SET enabled = 0 WHERE id = ? AND tokenHash = ?', row.id, latest.tokenHash);
      }
    }
    if (devices.length === 20) await this.ctx.storage.setAlarm(this.now() + 1000);
  }
}

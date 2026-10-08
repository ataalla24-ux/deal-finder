import { dailyMessage, eligiblePushDeals, normalizePushRegistration, pickDailyPush, pickMarketingPush, pushAudience, viennaClock } from './daily-push-policy.js';
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
    const message = dailyMessage(campaign.deal, device.language, campaign.type);
    if (device.provider === 'fcm') return sendFcmPush(this.env, device, campaign, message);
    return this.sendApple(device, campaign, message);
  }
  async fetch(request) {
    const path = new URL(request.url).pathname;
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
        marketingDays: ['Monday', 'Wednesday', 'Friday'], timeZone: 'Europe/Vienna', hour: 9,
        apnsReady: this.ready('apns'), fcmReady: this.ready('fcm'),
        devices: this.rows('SELECT provider, enabled, COUNT(*) AS count FROM devices GROUP BY provider, enabled'),
        deliveries: this.rows('SELECT day, state, status, COUNT(*) AS count FROM deliveries GROUP BY day, state, status ORDER BY day DESC LIMIT 40') });
    }
    if (path === '/preview') {
      const source = await this.loadSource();
      const deal = pickDailyPush(source.feed, source.state, [], this.now(), source.featured);
      const marketing = pickMarketingPush(source.feed, source.state, [], this.now());
      return json({ ok: true, eligible: eligiblePushDeals(source.feed, source.state, this.now()).length,
        dealId: deal?.id || null, message: deal ? dailyMessage(deal) : null,
        marketingDealId: marketing?.id || null, sends: 0 });
    }
    if (path === '/tick') {
      if (this.enabled() && viennaClock(this.now()).hour === 9) await this.ctx.storage.setAlarm(this.now() + 1);
      return json({ ok: true });
    }
    return new Response('Not found', { status: 404 });
  }
  enabled() { return this.env.DAILY_PUSH_ENABLED === '1' || this.env.MARKETING_PUSH_ENABLED === '1'; }
  async alarm() {
    if (!this.enabled() || viennaClock(this.now()).hour !== 9) return;
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
    this.sql.exec('DELETE FROM deliveries WHERE day < ?', viennaClock(now - 35 * DAY).day);
    this.sql.exec('DELETE FROM campaigns WHERE created < ?', now - 35 * DAY);
    this.sql.exec('DELETE FROM devices WHERE updated < ?', now - 60 * DAY);
    const devices = this.rows(`SELECT * FROM devices d WHERE enabled = 1 AND updated > ?
      AND NOT EXISTS (SELECT 1 FROM deliveries x WHERE x.device = d.id AND x.day = ?)
      ORDER BY id LIMIT 20`, now - 30 * DAY, day);
    if (!devices.length) return;
    const { feed, state, featured } = await this.loadSource();
    const eligible = eligiblePushDeals(feed, state, now);
    for (const row of devices) {
      if (viennaClock(this.now()).hour !== 9) break;
      const latest = this.rows('SELECT * FROM devices WHERE id = ?', row.id)[0];
      if (!latest?.enabled) continue;
      const device = JSON.parse(latest.record);
      const type = pushAudience(device, this.env, this.now());
      if (!type) {
        this.sql.exec('INSERT OR IGNORE INTO deliveries VALUES (?, ?, ?, ?)', day, row.id, 'not_scheduled', 0);
        continue;
      }
      const campaignKey = `${day}:${type}`;
      let campaign = this.rows('SELECT record FROM campaigns WHERE day = ?', campaignKey)[0];
      campaign = campaign ? JSON.parse(campaign.record) : null;
      if (!campaign) {
        const recent = this.rows('SELECT record FROM campaigns WHERE created > ?', now - 7 * DAY)
          .map(x => JSON.parse(x.record)).filter(x => (x.type || 'daily_deal') === type).map(x => x.deal.id);
        const deal = type === 'daily_deal' ? pickDailyPush(feed, state, recent, now, featured) : pickMarketingPush(feed, state, recent, now);
        if (!deal) {
          this.sql.exec('INSERT OR IGNORE INTO deliveries VALUES (?, ?, ?, ?)', day, row.id, 'no_current_deal', 0);
          continue;
        }
        const expires = now + (60 - new Date(now).getUTCMinutes()) * 60000 - new Date(now).getUTCSeconds() * 1000;
        campaign = { day, type, deal, expires };
        this.sql.exec('INSERT OR IGNORE INTO campaigns VALUES (?, ?, ?)', campaignKey, now, JSON.stringify(campaign));
        campaign = JSON.parse(this.rows('SELECT record FROM campaigns WHERE day = ?', campaignKey)[0].record);
      }
      const current = eligible.find(d => d.id === campaign.deal.id);
      if (!current || campaign.expires <= this.now() ||
          (type === 'daily_deal' && (featured?.date !== day || featured?.dealId !== current.id))) {
        this.sql.exec('INSERT OR IGNORE INTO deliveries VALUES (?, ?, ?, ?)', day, row.id, 'stale_selection', 0);
        continue;
      }
      campaign.deal = current;
      if (!this.ready(device.provider) || device.environment !== 'production') {
        this.sql.exec('INSERT OR IGNORE INTO deliveries VALUES (?, ?, ?, ?)', day, row.id, 'not_ready', 0);
        continue;
      }
      // Claim before network I/O. Unknown outcomes are deliberately not retried: providers offer no exactly-once guarantee.
      const claim = this.rows('INSERT OR IGNORE INTO deliveries VALUES (?, ?, ?, ?) RETURNING device', day, row.id, 'attempting', 0);
      if (!claim.length) continue;
      let result;
      try { result = await this.send(device, campaign); }
      catch { result = { ok: false, status: 0 }; }
      this.sql.exec('UPDATE deliveries SET state = ?, status = ? WHERE day = ? AND device = ?',
        result.ok ? 'accepted' : result.status ? 'rejected' : 'unknown', result.status || 0, day, row.id);
      if (result.invalidToken || result.status === 410 || result.reason === 'BadDeviceToken') {
        this.sql.exec('UPDATE devices SET enabled = 0 WHERE id = ? AND tokenHash = ?', row.id, latest.tokenHash);
      }
    }
    if (devices.length === 20) await this.ctx.storage.setAlarm(this.now() + 1000);
  }
}

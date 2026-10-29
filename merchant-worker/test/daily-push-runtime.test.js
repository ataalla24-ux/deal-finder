import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from 'miniflare';

const now = Date.parse('2026-10-08T07:05:00Z');
const deal = { id: 'verified-pizza', title: '1+1 Pizza gratis', brand: 'Testrestaurant', category: 'essen',
  dateConfidence: 'high', expiryKind: 'range', validFrom: '2026-10-08', validUntil: '2026-10-31',
  pipelineLifecycle: { manualDecision: 'approved' } };
const source = { feed: { lastUpdated: new Date(now).toISOString(), deals: [deal] }, state: { ok: true, overrides: [] },
  featured: { date: '2026-10-08', dealId: deal.id } };
const device = n => ({ provider: 'apns', body: { bundleId: 'com.stefanataalla.freefinderwien',
  token: n.toString(16).padStart(64, '0'), appDeviceId: `runtime-device-${String(n).padStart(10, '0')}`,
  subscriptionPlan: 'pro', policyVersion: 1, notificationsEnabled: true, pushEnvironment: 'production', revision: now } });

async function runtime(t, flags = { DAILY_PUSH_ENABLED: '1', MARKETING_PUSH_ENABLED: '1' }) {
  const modules = [{ type: 'ESModule', path: 'test-entry.js', contents: `
    import { DailyPushService } from './referrals-worker/src/daily-push.js';
    import router from './referrals-worker/src/index.js';
    export class TestDailyPush extends DailyPushService {
      async alarm() {} // Batches are explicitly driven by tests, never by wall-clock alarms.
      now() { return this.fixture?.now || ${now}; }
      ready() { return this.fixture?.transportReady !== false; }
      async loadSource() { if (this.fixture?.sourceFails) throw Error('test failure'); return this.fixture.source; }
      async send(device, campaign) {
        this.sql.exec('CREATE TABLE IF NOT EXISTS sent (id TEXT, day TEXT)');
        this.sql.exec('INSERT INTO sent VALUES (?, ?)', device.installation, campaign.day);
        this.sql.exec('CREATE TABLE IF NOT EXISTS sent_campaigns (record TEXT)');
        this.sql.exec('INSERT INTO sent_campaigns VALUES (?)', JSON.stringify(campaign));
        await new Promise(r => setTimeout(r, 10));
        if (this.fixture?.unknown) throw Error('simulated lost response');
        return this.fixture?.result || {ok: true, status: 200};
      }
      async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === '/fixture') { this.fixture = await request.json(); return Response.json({ok:true}); }
        if (path === '/batch') { await this.deliverBatch(); return Response.json({ok:true}); }
        if (path === '/sent') return Response.json(this.rows('SELECT * FROM sent'));
        if (path === '/sentCampaigns') return Response.json(this.rows('SELECT * FROM sent_campaigns').map(x => JSON.parse(x.record)));
        if (path === '/resetMemory') { this.fixture = undefined; return Response.json({ok:true}); }
        return super.fetch(request);
      }
    }
    export default { fetch(request, env) {
      if (new URL(request.url).pathname.startsWith('/api/')) {
        return router.fetch(request, { ...env, DAILY_DEAL_PUSH: {
          idFromName: () => env.PUSH.idFromName('test'), get: id => env.PUSH.get(id),
        } });
      }
      return env.PUSH.get(env.PUSH.idFromName('test')).fetch(request);
    } };
  ` }];
  for (const path of ['referrals-worker/src/index.js', 'referrals-worker/src/public-deal-state-cache.js',
    'referrals-worker/src/daily-push.js', 'referrals-worker/src/daily-push-policy.js', 'referrals-worker/src/fcm-push.js',
    'scraper/deal-discovery-policy.js', 'scraper/promotion-quality-utils.js', 'scraper/native-weekly-utils.js']) {
    modules.push({ type: 'ESModule', path, contents: await readFile(new URL(`../../${path}`, import.meta.url), 'utf8') });
  }
  const mf = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-03-09', modules,
    kvNamespaces: { REFERRAL_KV: 'local-referral-test' },
    durableObjects: { PUSH: { className: 'TestDailyPush', useSQLite: true } }, bindings: flags, log: new Log(LogLevel.NONE) }));
  t.after(() => mf.dispose());
  const call = async (path, body) => {
    const response = await mf.dispatchFetch(`https://test${path}`, body ? { method: 'POST', body: JSON.stringify(body) } : {});
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  await call('/fixture', { now, source });
  return call;
}

test('public v3 registrations reach durable storage; Pro daily delivery survives disabled digests', async t => {
  const call = await runtime(t, { DAILY_PUSH_ENABLED: '1', MARKETING_PUSH_ENABLED: '1', DIGEST_PUSH_ENABLED: '0' });
  for (const [n, provider, subscriptionPlan] of [[1, 'apns', 'free'], [2, 'apns', 'pro'], [3, 'fcm', 'free'], [4, 'fcm', 'pro']]) {
    const body = { ...device(n).body, packageName: 'com.stefanataalla.freefinderwien',
      ...(provider === 'fcm' ? { token: `fcm-runtime-token-${n}-`.repeat(3) } : {}),
      policyVersion: 3, subscriptionPlan, marketingEnabled: true, marketingConsentVersion: 2, marketingConsentAt: now - 1000 };
    assert.equal((await call(`/api/push/${provider}/register`, body)).registered, true);
  }
  const status = await call('/status');
  assert.equal(status.digestEnabled, false);
  assert.deepEqual(status.devices.map(row => [row.provider, row.enabled, row.count]), [['apns', 1, 2], ['fcm', 1, 2]]);
  await call('/batch');
  assert.deepEqual((await call('/sent')).map(row => row.id).sort(), [device(2).body.appDeviceId, device(4).body.appDeviceId]);
});

test('atomic daily claims survive concurrent batches and repeated invocations', async t => {
  const call = await runtime(t);
  await call('/register', device(1));
  await Promise.all([call('/batch'), call('/batch'), call('/batch')]);
  assert.equal((await call('/sent')).length, 1);
  await call('/resetMemory');
  await call('/fixture', { now, source });
  await call('/batch');
  assert.equal((await call('/sent')).length, 1, 'persistent claim, not in-memory dedupe');
});

test('audience diagnostics expose only fixed enums and aggregate counts, never arbitrary registration values', async t => {
  const call = await runtime(t);
  await call('/register', { ...device(1), body: { ...device(1).body,
    subscriptionPlan: 'private-value@example.test', pushEnvironment: 'private-environment', policyVersion: 0 } });
  const status = await call('/status');
  assert.deepEqual(status.audiences, [{ provider: 'apns', enabled: 0, plan: 'unknown', environment: 'unknown', policyVersion: 0, count: 1 }]);
  assert.ok(!JSON.stringify(status).includes('private-value'));
  assert.ok(!JSON.stringify(status).includes(device(1).body.token));
});
test('token rotation, out-of-order requests and opt-out do not re-enable delivery', async t => {
  const call = await runtime(t);
  await call('/register', device(1));
  await call('/unregister', { ...device(1), body: { ...device(1).body, revision: now + 1 } });
  await call('/register', device(1));
  await call('/batch');
  assert.equal((await call('/status')).devices[0].enabled, 0);
  const rotated = { ...device(1), body: { ...device(1).body, token: device(2).body.token, revision: now + 2 } };
  await call('/register', rotated);
  await call('/batch');
  await call('/register', { ...rotated, body: { ...rotated.body, token: device(3).body.token, revision: now + 3 } });
  await call('/batch');
  assert.equal((await call('/sent')).length, 1);
});
test('pagination delivers all recipients once, and excludes Free, opt-out and sandbox', async t => {
  const call = await runtime(t);
  for (let n = 1; n <= 25; n++) await call('/register', device(n));
  for (const [n, change] of [[26, { subscriptionPlan: 'free' }], [27, { notificationsEnabled: false }], [28, { pushEnvironment: 'sandbox' }]]) {
    await call('/register', { ...device(n), body: { ...device(n).body, ...change } });
  }
  await call('/batch'); await call('/batch'); await call('/batch');
  assert.equal((await call('/sent')).length, 25);
});

test('Android development installations are never included in the production daily batch', async t => {
  const call = await runtime(t);
  for (const [n, pushEnvironment] of [[1, 'development'], [2, 'production'], [3, undefined]]) {
    await call('/register', { provider: 'fcm', body: { ...device(n).body,
      packageName: 'com.stefanataalla.freefinderwien', token: `fcm-runtime-token-${n}-`.repeat(3), pushEnvironment } });
  }
  await call('/batch');
  assert.deepEqual(await call('/sent'), [{ id: device(2).body.appDeviceId, day: '2026-10-08' }]);
});
test('ambiguous provider outcome is not retried; rejected invalid tokens are disabled', async t => {
  const call = await runtime(t);
  await call('/register', device(1));
  await call('/fixture', { now, source, unknown: true });
  await call('/batch'); await call('/batch');
  assert.equal((await call('/sent')).length, 1);
  assert.equal((await call('/status')).deliveries[0].state, 'unknown');
  await call('/register', device(2));
  await call('/fixture', { now, source, result: { ok: false, status: 410 } });
  await call('/batch');
  assert.ok((await call('/status')).devices.some(x => x.enabled === 0));
});
test('fresh moderation removal stops an already selected campaign and preview sends nothing', async t => {
  const call = await runtime(t);
  await call('/register', device(1)); await call('/batch');
  await call('/register', device(2));
  const hidden = { ...source, state: { ok: true, overrides: [{ dealId: deal.id, hidden: true }] } };
  await call('/fixture', { now, source: hidden });
  await call('/batch');
  assert.equal((await call('/sent')).length, 1);
  assert.equal((await call('/preview')).sends, 0);
  assert.equal((await call('/sent')).length, 1);
});
test('same deal is not selected again the next day', async t => {
  const call = await runtime(t);
  await call('/register', device(1)); await call('/batch');
  const tomorrow = now + 86400000;
  await call('/fixture', { now: tomorrow, source: { ...source, featured: { ...source.featured, date: '2026-10-09' }, feed: { ...source.feed, lastUpdated: new Date(tomorrow).toISOString() } } });
  await call('/batch');
  assert.equal((await call('/sent')).length, 1);
  assert.equal((await call('/status')).deliveries.find(d => d.day === '2026-10-09').state, 'repeat_suppressed');
  assert.equal((await call('/preview')).dailyDecision.reason, 'repeat_suppressed');
});

test('test devices and unavailable transports cannot consume a real campaign repeat window', async t => {
  for (const mode of ['sandbox', 'transport']) {
    const call = await runtime(t);
    await call('/register', { ...device(1), body: { ...device(1).body,
      pushEnvironment: mode === 'sandbox' ? 'sandbox' : 'production' } });
    await call('/fixture', { now, source, transportReady: mode !== 'transport' });
    await call('/batch');
    const status = await call('/status');
    assert.equal(status.deliveries[0].state, mode === 'sandbox' ? 'test_environment' : 'transport_not_ready');
    assert.equal(status.audiences[0].environment, mode === 'sandbox' ? 'sandbox' : 'production');
    assert.equal((await call('/preview')).dailyDecision.reason, 'ready');
    const tomorrow = now + 86400000;
    await call('/fixture', { now: tomorrow, source: { ...source, featured: { ...source.featured, date: '2026-10-09' },
      feed: { ...source.feed, lastUpdated: new Date(tomorrow).toISOString() } } });
    await call('/register', { ...device(2), body: { ...device(2).body, revision: tomorrow } });
    await call('/batch');
    assert.ok((await call('/sent')).some(d => d.id === device(2).body.appDeviceId));
  }
});

test('Free marketing requires consent and a delivery day; upgrading cannot double-send', async t => {
  const call = await runtime(t);
  const free = { ...device(1), body: { ...device(1).body, subscriptionPlan: 'free', policyVersion: 2,
    notificationsEnabled: false, marketingEnabled: true, marketingConsentVersion: 1, marketingConsentAt: now } };
  await call('/register', free);
  await call('/batch');
  assert.equal((await call('/status')).deliveries[0].state, 'not_scheduled');
  const friday = now + 86400000;
  await call('/fixture', { now: friday, source: { ...source, featured: { ...source.featured, date: '2026-10-09' },
    feed: { ...source.feed, lastUpdated: new Date(friday).toISOString() } } });
  await Promise.all([call('/batch'), call('/batch')]);
  assert.equal((await call('/sent')).length, 1);
  await call('/register', { ...free, body: { ...free.body, subscriptionPlan: 'pro', notificationsEnabled: true, revision: friday } });
  await call('/batch');
  assert.equal((await call('/sent')).length, 1, 'same installation shares the daily claim across audience changes');
});

test('marketing opt-out and disabled rollout flags stop delivery', async t => {
  const call = await runtime(t, { DAILY_PUSH_ENABLED: '0', MARKETING_PUSH_ENABLED: '0' });
  await call('/register', device(1));
  await call('/batch');
  assert.equal((await call('/status')).deliveries[0].state, 'not_scheduled');
  const free = { ...device(2), body: { ...device(2).body, subscriptionPlan: 'free', policyVersion: 2,
    notificationsEnabled: false, marketingEnabled: true, marketingConsentVersion: 1, marketingConsentAt: now } };
  await call('/register', free);
  await call('/register', { ...free, body: { ...free.body, marketingEnabled: false, revision: now + 1 } });
  assert.ok((await call('/status')).devices.some(x => x.enabled === 0));
});

test('stale registrations, legacy opt-out and source failure fail closed', async t => {
  const call = await runtime(t);
  await call('/register', device(1)); await call('/batch');
  await call('/register', device(2));
  await call('/revoke-token', { provider: 'apns', token: device(2).body.token });
  await call('/batch');
  assert.equal((await call('/sent')).length, 1);
  await call('/register', device(3));
  await call('/fixture', { now, source, sourceFails: true });
  await assert.rejects(call('/batch'));
  assert.equal((await call('/sent')).length, 1);
  const future = now + 31 * 86400000;
  await call('/fixture', { now: future, source: { ...source, feed: { lastUpdated: new Date(future).toISOString(),
    deals: [{ ...deal, id: 'new-pizza', validUntil: '2026-12-31' }] } } });
  await call('/batch');
  assert.equal((await call('/sent')).length, 1);
});

const digestFlags = { DAILY_PUSH_ENABLED: '1', MARKETING_PUSH_ENABLED: '1', DIGEST_PUSH_ENABLED: '1' };
const sunday = Date.parse('2026-10-11T16:05:00Z');
const digestSource = at => ({ ...source, featured: { date: '2026-10-11', dealId: deal.id },
  feed: { lastUpdated: new Date(at).toISOString(), deals: [deal, ...[1, 2, 3].map(n => ({ ...deal,
    id: `recap-${n}`, votes: n, pipelineLifecycle: { manualDecision: 'approved', publishedAt: '2026-10-09T10:00:00Z' } }))] } });
const digestDevice = (n, edits = {}) => ({ ...device(n), body: { ...device(n).body,
  policyVersion: 3, marketingEnabled: true, marketingConsentVersion: 2, marketingConsentAt: sunday - 1000,
  revision: sunday, ...edits } });

test('Free and Pro receive one evening digest, legacy Pro and old binaries never do', async t => {
  const call = await runtime(t, digestFlags);
  await call('/fixture', { now: sunday, source: digestSource(sunday) });
  for (const [n, changes] of [[1, { subscriptionPlan: 'free' }], [2, {}], [3, { subscriptionPlan: 'plus' }],
    [4, { marketingConsentVersion: 1 }], [5, { policyVersion: 2 }], [6, { marketingEnabled: false }],
    [7, { pushEnvironment: 'sandbox' }]]) await call('/register', digestDevice(n, changes));
  await Promise.all([call('/batch'), call('/batch')]);
  assert.equal((await call('/sent')).length, 3);
  const campaigns = await call('/sentCampaigns');
  assert.ok(campaigns.every(c => c.type === 'weekly_digest' && c.deal.id === 'recap-3' && c.deals.length === 3));
  await call('/resetMemory'); await call('/fixture', { now: sunday, source: digestSource(sunday) });
  await call('/batch');
  assert.equal((await call('/sent')).length, 3);
});

test('morning Pro claim and evening digest claim are independent with no repeated daily offer', async t => {
  const call = await runtime(t, digestFlags);
  const morning = sunday - 9 * 3600000;
  await call('/fixture', { now: morning, source: digestSource(morning) });
  await call('/register', digestDevice(1, { revision: morning, marketingConsentAt: morning - 1000 }));
  await call('/batch');
  await call('/fixture', { now: sunday, source: digestSource(sunday) });
  await call('/batch'); await call('/batch');
  const campaigns = await call('/sentCampaigns');
  assert.deepEqual(campaigns.map(c => c.type), ['daily_deal', 'weekly_digest']);
  assert.ok(campaigns[1].deals.every(d => d.id !== campaigns[0].deal.id));
});

test('evening revalidates every offer, honours opt-out, and skips empty or disabled campaigns', async t => {
  const call = await runtime(t, digestFlags);
  await call('/fixture', { now: sunday, source: digestSource(sunday) });
  await call('/register', digestDevice(1)); await call('/batch');
  await call('/register', digestDevice(2));
  await call('/register', digestDevice(3));
  await call('/unregister', digestDevice(3, { revision: sunday + 1 }));
  await call('/fixture', { now: sunday, source: { ...digestSource(sunday),
    state: { ok: true, overrides: [{ dealId: 'recap-1', hidden: true }] } } });
  await call('/batch');
  assert.equal((await call('/sent')).length, 1, 'even a removed secondary offer blocks the saved recap');
  const disabled = await runtime(t, { ...digestFlags, DIGEST_PUSH_ENABLED: '0' });
  await disabled('/fixture', { now: sunday, source: digestSource(sunday) });
  await disabled('/register', digestDevice(1)); await disabled('/batch');
  assert.equal((await disabled('/status')).deliveries[0].state, 'not_scheduled');
  const empty = await runtime(t, digestFlags);
  await empty('/fixture', { now: sunday, source: { ...digestSource(sunday), feed: {
    lastUpdated: new Date(sunday).toISOString(), deals: [deal] } } });
  await empty('/register', digestDevice(1)); await empty('/batch');
  assert.equal((await empty('/status')).deliveries[0].state, 'no_current_deal');
});

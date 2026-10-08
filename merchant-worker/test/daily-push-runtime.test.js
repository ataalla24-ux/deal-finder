import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from 'miniflare';

const now = Date.parse('2026-10-08T07:05:00Z');
const deal = { id: 'verified-pizza', title: '1+1 Pizza gratis', brand: 'Testrestaurant', category: 'essen',
  dateConfidence: 'high', expiryKind: 'range', validFrom: '2026-10-08', validUntil: '2026-10-31',
  pipelineLifecycle: { manualDecision: 'approved' } };
const source = { feed: { lastUpdated: new Date(now).toISOString(), deals: [deal] }, state: { ok: true, overrides: [] } };
const device = n => ({ provider: 'apns', body: { bundleId: 'com.stefanataalla.freefinderwien',
  token: n.toString(16).padStart(64, '0'), appDeviceId: `runtime-device-${String(n).padStart(10, '0')}`,
  subscriptionPlan: 'pro', policyVersion: 1, notificationsEnabled: true, pushEnvironment: 'production', revision: now } });

async function runtime(t) {
  const modules = [{ type: 'ESModule', path: 'test-entry.js', contents: `
    import { DailyPushService } from './referrals-worker/src/daily-push.js';
    export class TestDailyPush extends DailyPushService {
      now() { return this.fixture?.now || ${now}; }
      ready() { return true; }
      async loadSource() { if (this.fixture?.sourceFails) throw Error('test failure'); return this.fixture.source; }
      async send(device, campaign) {
        this.sql.exec('CREATE TABLE IF NOT EXISTS sent (id TEXT, day TEXT)');
        this.sql.exec('INSERT INTO sent VALUES (?, ?)', device.installation, campaign.day);
        await new Promise(r => setTimeout(r, 10));
        if (this.fixture?.unknown) throw Error('simulated lost response');
        return this.fixture?.result || {ok: true, status: 200};
      }
      async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === '/fixture') { this.fixture = await request.json(); return Response.json({ok:true}); }
        if (path === '/batch') { await this.deliverBatch(); return Response.json({ok:true}); }
        if (path === '/sent') return Response.json(this.rows('SELECT * FROM sent'));
        if (path === '/resetMemory') { this.fixture = undefined; return Response.json({ok:true}); }
        return super.fetch(request);
      }
    }
    export default { fetch(request, env) { return env.PUSH.get(env.PUSH.idFromName('test')).fetch(request); } };
  ` }];
  for (const path of ['referrals-worker/src/daily-push.js', 'referrals-worker/src/daily-push-policy.js', 'referrals-worker/src/fcm-push.js', 'scraper/native-weekly-utils.js']) {
    modules.push({ type: 'ESModule', path, contents: await readFile(new URL(`../../${path}`, import.meta.url), 'utf8') });
  }
  const mf = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-03-09', modules,
    durableObjects: { PUSH: { className: 'TestDailyPush', useSQLite: true } }, bindings: { DAILY_PUSH_ENABLED: '0' }, log: new Log(LogLevel.NONE) }));
  t.after(() => mf.dispose());
  const call = async (path, body) => {
    const response = await mf.dispatchFetch(`https://test${path}`, body ? { method: 'POST', body: JSON.stringify(body) } : {});
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  await call('/fixture', { now, source });
  return call;
}

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
  await call('/fixture', { now: tomorrow, source: { ...source, feed: { ...source.feed, lastUpdated: new Date(tomorrow).toISOString() } } });
  await call('/batch');
  assert.equal((await call('/sent')).length, 1);
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

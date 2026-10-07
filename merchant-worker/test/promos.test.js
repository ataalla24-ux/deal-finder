import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const DAY = 86400000;
const API = 'https://worker.test/api/merchant/promos';
const admin = { authorization: 'Bearer test-only-admin-secret' };
const draft = {
  restaurantName: 'Test Restaurant', dealTitle: '2 Pizzen zum Preis von 1',
  description: 'Nur vor Ort. Heute und morgen, solange der Vorrat reicht.',
  address: 'Testgasse 1, 1010 Wien', ctaURL: 'https://example.com/angebot',
  acceptedTerms: true, oldPrice: '20 EUR', dealPrice: '10 EUR',
};

test('promo ledger integration with real SQLite Durable Object', async t => {
  const mf = new Miniflare(convertV4MiniflareOptions({
    compatibilityDate: '2025-12-01',
    modules: [
      { type: 'ESModule', path: 'test-entry.js', contents: `
        export { default } from './src/index.js';
        import { MerchantPromoLedger } from './src/merchant-promos.js';
        export class TestLedger extends MerchantPromoLedger {
          async fetch(request) {
            if (new URL(request.url).pathname === '/__test_patch') {
              const {id, patch} = await request.json();
              const key = 'code:' + id;
              await this.storage.put(key, {...await this.storage.get(key), ...patch});
              return Response.json({ok:true});
            }
            return super.fetch(request);
          }
        }` },
      ...await Promise.all(['index.js', 'merchant-promos.js', 'public-interaction-cache.js', 'storage-usage.js'].map(async name => ({ type: 'ESModule', path: `src/${name}`, contents: await readFile(new URL(`../src/${name}`, import.meta.url), 'utf8') }))),
    ],
    durableObjects: { MERCHANT_PROMOS: { className: 'TestLedger', useSQLite: true } },
    kvNamespaces: ['MERCHANT_CAMPAIGNS'], bindings: { MERCHANT_PROMO_ADMIN_SECRET: 'test-only-admin-secret' },
  }));
  t.after(() => mf.dispose());
  let client = 0;
  async function call(path, payload, headers = {}, method = payload ? 'POST' : 'GET') {
    const response = await mf.dispatchFetch(`${API}${path}`, { method,
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': `192.0.2.${++client}`, ...headers },
      body: payload ? JSON.stringify(payload) : undefined });
    return { status: response.status, body: await response.json() };
  }
  async function create(extra = {}) {
    const result = await call('/admin/codes', { restaurantName: draft.restaurantName, ...extra }, admin);
    assert.equal(result.status, 201); return result.body;
  }
  const namespace = await mf.getDurableObjectNamespace('MERCHANT_PROMOS');
  const ledger = namespace.get(namespace.idFromName('merchant-promos-v1'));
  async function patch(id, value) {
    const response = await ledger.fetch('https://internal/__test_patch', { method: 'POST', body: JSON.stringify({ id, patch: value }) });
    assert.equal(response.status, 200);
  }
  async function campaigns() {
    const response = await mf.dispatchFetch('https://worker.test/api/merchant/campaigns');
    assert.equal(response.status, 200); return (await response.json()).campaigns;
  }

  await t.test('administration is protected; only known packages and bounded expiry allowed', async () => {
    assert.equal((await call('/admin/codes')).status, 401);
    assert.equal((await call('/admin/codes', {}, { authorization: 'Bearer wrong' })).status, 401);
    for (const packageId of ['unknown', '', 'toString', 8]) {
      assert.equal((await call('/admin/codes', { packageId }, admin)).status, 400);
    }
    for (const days of [0, 91, 1.5, '30']) assert.equal((await call('/admin/codes', { expiresInDays: days }, admin)).status, 400);
    assert.equal((await call('/admin/unknown', {}, admin)).status, 404);
    assert.equal((await call('/check')).status, 405);
  });
  await t.test('checking is non-consuming, case insensitive; plaintext codes absent from admin list', async () => {
    const code = await create();
    assert.equal(code.expiresAt - code.createdAt, 30 * DAY);
    assert.equal(code.package.durationDays, 1);
    for (let i = 0; i < 2; i++) {
      const checked = await call('/check', { code: code.code.toLowerCase() });
      assert.equal(checked.status, 200); assert.equal(checked.body.amount, 0);
    }
    const list = await call('/admin/codes', undefined, admin);
    assert.ok(!JSON.stringify(list).includes(code.code));
    assert.equal((await call('/check', { code: 'NOT-A-CODE' })).status, 404);
  });
  await t.test('bad data, wrong restaurant or missing consent do not consume code', async () => {
    const code = await create();
    const payload = { ...draft, code: code.code, requestId: crypto.randomUUID() };
    for (const change of [{ acceptedTerms: false }, { address: '' }, { dealTitle: 'a'.repeat(111) }, { ctaURL: 'javascript:alert(1)' }, { ctaURL: 'https://user:pass@example.com' }, { requestId: '' }]) {
      assert.equal((await call('/redeem', { ...payload, ...change })).status, 400);
    }
    assert.equal((await call('/redeem', { ...payload, restaurantName: 'Other' })).status, 409);
    assert.equal((await call('/check', { code: code.code })).status, 200);
  });
  await t.test('two concurrent redemptions produce exactly one campaign, ignoring client price or package', async () => {
    const code = await create();
    const results = await Promise.all([1, 2].map(() => call('/redeem', { ...draft, code: code.code, requestId: crypto.randomUUID(), amount: 2599, packageId: 'city', endsAt: Date.now() + 90 * DAY })));
    assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
    const campaign = results.find(result => result.status === 201).body.campaign;
    assert.equal(campaign.endsAt - campaign.startsAt, DAY);
    assert.equal(campaign.amount, 0); assert.equal(campaign.packageId, 'starter');
    assert.equal((await campaigns()).filter(item => item.id === campaign.id).length, 1);
    assert.equal((await call('/admin/revoke', { id: code.id }, admin)).status, 409);
  });
  await t.test('same idempotency key returns same campaign without extending it; changed payload rejected', async () => {
    const code = await create();
    const payload = { ...draft, code: code.code, requestId: crypto.randomUUID() };
    const first = await call('/redeem', payload);
    const second = await call('/redeem', payload);
    assert.equal(first.status, 201); assert.equal(second.status, 200);
    assert.equal(second.body.duplicate, true);
    assert.deepEqual(first.body.campaign, second.body.campaign);
    assert.equal((await call('/redeem', { ...payload, dealTitle: 'Changed' })).status, 409);
    await patch(code.id, { expiresAt: Date.now() - DAY });
    assert.equal((await call('/redeem', payload)).body.campaign.endsAt, first.body.campaign.endsAt);
  });
  await t.test('expired and revoked codes cannot activate ads; expired ads leave only the business feed', async () => {
    const expired = await create();
    await patch(expired.id, { expiresAt: Date.now() - DAY });
    assert.equal((await call('/check', { code: expired.code })).status, 410);
    assert.equal((await call('/redeem', { ...draft, code: expired.code, requestId: crypto.randomUUID() })).status, 410);
    const revoked = await create();
    assert.equal((await call('/admin/revoke', { id: revoked.id }, admin)).status, 200);
    assert.equal((await call('/check', { code: revoked.code })).status, 409);
    assert.equal((await call('/redeem', { ...draft, code: revoked.code, requestId: crypto.randomUUID() })).status, 409);
    const used = await create();
    const result = await call('/redeem', { ...draft, code: used.code, requestId: crypto.randomUUID() });
    await patch(used.id, { campaign: { ...result.body.campaign, endsAt: Date.now() - DAY } });
    assert.ok(!(await campaigns()).some(item => item.id === result.body.campaign.id));
  });
  await t.test('paid campaigns are preserved and promo ads are not hidden by the paid cap', async () => {
    const kv = await mf.getKVNamespace('MERCHANT_CAMPAIGNS');
    const ids = Array.from({ length: 13 }, (_, i) => `paid-${i}`);
    await kv.put('campaign:index', JSON.stringify(ids));
    for (const id of ids) await kv.put(`campaign:${id}`, JSON.stringify({ id, status: 'paid', packageId: 'city', createdAt: Date.now(), endsAt: Date.now() + DAY }));
    const feed = await campaigns();
    assert.equal(feed.filter(item => item.status === 'paid').length, 12);
    assert.ok(feed.some(item => item.status === 'sponsored'));
    assert.ok(feed.length > 12);
    assert.equal(JSON.parse(await kv.get('campaign:index')).length, 13);
  });
  await t.test('public attempts are rate limited', async () => {
    const statuses = [];
    for (let i = 0; i < 31; i++) statuses.push((await call('/check', { code: 'INVALID' }, { 'cf-connecting-ip': '203.0.113.7' })).status);
    assert.equal(statuses[29], 404); assert.equal(statuses[30], 429);
  });
  await t.test('shared code is evergreen, non-consuming checks and independent restaurant claims', async () => {
    const code = await create({ kind: 'shared', code: 'STARTER-GRATIS' });
    assert.equal(code.expiresAt, null);
    assert.equal(code.restaurantName, '');
    const first = await call('/redeem', { ...draft, code: 'starter gratis', platform: 'ios', requestId: crypto.randomUUID() });
    const second = await call('/redeem', { ...draft, restaurantName: 'Other Restaurant', code: code.code, platform: 'android', requestId: crypto.randomUUID() });
    assert.equal(first.status, 201); assert.equal(second.status, 201);
    assert.equal(first.body.campaign.platform, 'ios'); assert.equal(second.body.campaign.platform, 'android');
    assert.equal(first.body.campaign.endsAt - first.body.campaign.startsAt, DAY);
    const checked = await call('/check', { code: code.code });
    assert.equal(checked.status, 200); assert.equal(checked.body.kind, 'shared');
    const list = await call('/admin/codes', undefined, admin);
    assert.equal(list.body.codes.find(item => item.id === code.id).redemptionCount, 2);
    assert.equal((await call('/admin/codes', { kind: 'shared', code: code.code }, admin)).status, 409);
    for (const campaign of [first.body.campaign, second.body.campaign]) {
      assert.equal((await campaigns()).filter(item => item.id === campaign.id).length, 1);
    }
  });
  await t.test('shared claims are device-independent and normalized; concurrent claims only create one ad', async () => {
    const code = await create({ kind: 'shared', code: 'SHAREDTEST2' });
    const payload = { ...draft, restaurantName: 'Caf\u00e9 M\u00fcller', address: 'Musterstra\u00dfe 1, 1010 Wien', code: code.code };
    const results = await Promise.all([
      call('/redeem', { ...payload, platform: 'ios', requestId: crypto.randomUUID() }),
      call('/redeem', { ...payload, restaurantName: 'CAFE MUELLER', address: 'Musterstr. 1 / 1010 Vienna', platform: 'android', requestId: crypto.randomUUID() }),
    ]);
    assert.deepEqual(results.map(item => item.status).sort(), [201, 409]);
    assert.equal((await call('/redeem', { ...payload, requestId: crypto.randomUUID() })).status, 409);
  });
  await t.test('shared retries recover the same receipt, including after revocation, without extending the ad', async () => {
    const code = await create({ kind: 'shared', code: 'SHAREDTEST3' });
    const payload = { ...draft, code: code.code, requestId: crypto.randomUUID() };
    const first = await call('/redeem', payload);
    assert.equal(first.status, 201);
    const retry = await call('/redeem', payload);
    assert.equal(retry.status, 200); assert.deepEqual(retry.body.campaign, first.body.campaign);
    assert.equal((await call('/redeem', { ...payload, dealTitle: 'Changed' })).status, 409);
    assert.equal((await call('/admin/revoke', { id: code.id }, admin)).status, 200);
    assert.equal((await call('/check', { code: code.code })).status, 409);
    assert.equal((await call('/redeem', { ...payload, restaurantName: 'Another Restaurant' })).status, 409);
    assert.deepEqual((await call('/redeem', payload)).body.campaign, first.body.campaign);
    assert.ok((await campaigns()).some(item => item.id === first.body.campaign.id));
  });
  await t.test('shared identity requires house number and postcode before any claim', async () => {
    const code = await create({ kind: 'shared', code: 'SHAREDTEST4' });
    for (const address of ['Wien', '1010 Wien', 'Testgasse Wien', 'Testgasse 1, Wien']) {
      assert.equal((await call('/redeem', { ...draft, address, code: code.code, requestId: crypto.randomUUID() })).status, 400);
    }
    assert.equal((await call('/check', { code: code.code })).status, 200);
  });
  await t.test('each package has an independent once-per-restaurant claim and exact server-owned duration', async () => {
    for (const [packageId, days, name] of [['starter', 1, 'Starter Boost'], ['spotlight', 3, 'Spotlight Boost'], ['city', 8, 'City Push']]) {
      const code = await create({ kind: 'shared', code: `${packageId}PACKAGETEST`, packageId });
      assert.deepEqual(code.package, { id: packageId, name, durationDays: days });
      assert.equal(code.expiresAt, null);
      const checked = await call('/check', { code: code.code });
      assert.equal(checked.status, 200);
      assert.deepEqual(checked.body.package, code.package);
      assert.equal(checked.body.amount, 0);
      assert.equal(checked.body.currency, 'EUR');
      const payload = { ...draft, code: code.code, requestId: crypto.randomUUID(), packageId: 'tampered', amount: 999, durationDays: 90, endsAt: Date.now() + 90 * DAY };
      const claims = await Promise.all([
        call('/redeem', { ...payload, platform: 'ios' }),
        call('/redeem', { ...payload, platform: 'android', requestId: crypto.randomUUID() }),
      ]);
      assert.deepEqual(claims.map(item => item.status).sort(), [201, 409]);
      const winner = claims.findIndex(item => item.status === 201);
      const campaign = claims[winner].body.campaign;
      assert.equal(campaign.packageId, packageId);
      assert.equal(campaign.packageName, name);
      assert.equal(campaign.endsAt - campaign.startsAt, days * DAY);
      assert.equal(campaign.amount, 0);
      assert.equal(campaign.currency, 'EUR');
      assert.equal((await call('/redeem', { ...payload, requestId: crypto.randomUUID() })).status, 409);
      const other = await call('/redeem', { ...payload, restaurantName: 'Other Package Restaurant', requestId: crypto.randomUUID() });
      assert.equal(other.status, 201);
      assert.equal(other.body.campaign.endsAt - other.body.campaign.startsAt, days * DAY);
      if (winner === 0) {
        await call('/admin/revoke', { id: code.id }, admin);
        assert.deepEqual((await call('/redeem', payload)).body.campaign, campaign);
      }
    }
  });
  await t.test('legacy codes without package ID stay Starter; corrupt package IDs fail closed', async () => {
    const legacy = await create();
    await patch(legacy.id, { packageId: null });
    assert.equal((await call('/check', { code: legacy.code })).body.package.id, 'starter');
    const receipt = await call('/redeem', { ...draft, code: legacy.code, requestId: crypto.randomUUID() });
    assert.equal(receipt.status, 201);
    assert.equal(receipt.body.campaign.endsAt - receipt.body.campaign.startsAt, DAY);
    const corrupt = await create();
    await patch(corrupt.id, { packageId: 'unknown' });
    assert.equal((await call('/check', { code: corrupt.code })).status, 400);
    assert.equal((await call('/redeem', { ...draft, code: corrupt.code, requestId: crypto.randomUUID() })).status, 400);
  });
  await t.test('malformed and oversized public requests are rejected', async () => {
    assert.equal((await call('/check', { code: 'a'.repeat(17000) })).status, 413);
    for (const [headers, body, expected] of [[{}, '{}', 415], [{ 'content-type': 'application/json' }, '{', 400]]) {
      const response = await mf.dispatchFetch(`${API}/check`, { method: 'POST', headers, body });
      assert.equal(response.status, expected);
    }
    const response = await mf.dispatchFetch(`${API}/redeem`, { method: 'OPTIONS' });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
  });
});

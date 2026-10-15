import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from 'miniflare';
import { referralHash } from '../src/referral-months.js';
import { bundledAuth } from './bundled-auth.js';

const DAY = 86400000, now = Date.now();
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const monthly = 'com.stefanataalla.freefinderwien.premium.monthly';
const yearly = 'com.stefanataalla.freefinderwien.premium.yearly';
const offer = (n = 1, patch = {}) => ({ productId: monthly, offerId: 'fixture-month',
  code: 'FIXTURE' + String(n).padStart(8, '0'), environment: 'Production', customerType: 'existing',
  freeMonths: 1, expiresAt: now + 60 * DAY, ...patch });
const owner = (n = 1, rewards = [{ id: id(101), state: 'earned', months: 1, createdAt: now }]) => ({
  id: id(n), recoverable: true, code: 'RM-' + String(n).padStart(24, '0'), rewards });
const request = (n = 1) => ({ accountId: id(n), principal: { id: id(n), email: 'fixture@example.test', authTime: now / 1000 },
  platform: 'ios', trustedIP: 'fixture', rewardId: id(101), transactionId: '10000001' });

async function runtime(t) {
  const source = await readFile(new URL('../src/referral-months.js', import.meta.url), 'utf8');
  const mf = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-03-09', log: new Log(LogLevel.NONE),
    bindings: { REFERRAL_MONTHS_ENABLED: '1', REFERRAL_APPLE_REWARD_SUBSCRIPTION_ENABLED: '1' },
    durableObjects: { LEDGER: { className: 'TestLedger', useSQLite: true } },
    modules: [{ type: 'ESModule', path: 'runtime.js', contents: `
      import { ReferralMonthsLedger } from './ledger.js';
      export class TestLedger extends ReferralMonthsLedger {
        async reviewSource() { return { status:'verified',checkedAt:Date.now() }; }
        async verifyPurchase(body) { return { product:body.fixtureProduct || '${monthly}',key:'ios:10000001' }; }
        async fetch(request) {
          const path=new URL(request.url).pathname;
          if(path==='/seed') {
            const rows=Object.entries(await request.json());
            for(let i=0;i<rows.length;i+=100) await this.storage.put(Object.fromEntries(rows.slice(i,i+100)));
            return Response.json({ok:true});
          }
          if(path==='/snapshot') return Response.json(Object.fromEntries(await this.storage.list()));
          return super.fetch(request);
        }
      }
      export default {fetch(request,env){return env.LEDGER.get(env.LEDGER.idFromName('test')).fetch(request);}};
    ` }, { type: 'ESModule', path: 'ledger.js', contents: source }, await bundledAuth('account-auth.js')],
  }));
  t.after(() => mf.dispose());
  return async (path, body = {}, expected = 200) => {
    const response = await mf.dispatchFetch('https://fixture/' + path, { method: 'POST', body: JSON.stringify(body) });
    if (Array.isArray(expected)) {
      assert.ok(expected.includes(response.status), await response.clone().text());
      return { httpStatus: response.status, ...await response.json() };
    }
    assert.equal(response.status, expected, await response.clone().text());
    return response.json();
  };
}
const codeKey = async value => 'offer:' + await referralHash(value.code);

test('production inventory rejects Sandbox, unknown environment and injected reservation fields atomically', async t => {
  const call = await runtime(t);
  for (const patch of [{ environment: 'Sandbox' }, { environment: undefined }, { assignedTo: id(9) }, { arbitrary: true }]) {
    await call('import-apple-offers', { offers: [offer(1), offer(2, patch)] }, 400);
    assert.deepEqual(await call('snapshot'), {});
  }
  await call('import-apple-offers', { offers: [offer()] });
  assert.equal(Object.keys(await call('snapshot')).length, 1);
});

test('duplicate imports preserve assignment and reject changed metadata without partial batch writes', async t => {
  const call = await runtime(t), value = offer(), key = await codeKey(value);
  await call('seed', { [key]: { ...value, assignedTo: id(4) } });
  await call('import-apple-offers', { offers: [value] });
  assert.equal((await call('snapshot'))[key].assignedTo, id(4));
  for (const patch of [{ offerId: 'different' }, { productId: yearly }, { expiresAt: now + 61 * DAY }]) {
    await call('import-apple-offers', { offers: [offer(2), { ...value, ...patch }] }, 409);
    const rows = await call('snapshot');
    assert.equal(Object.keys(rows).length, 1);
    assert.deepEqual(rows[key], { ...value, assignedTo: id(4) });
  }
  await call('import-apple-offers', { offers: [offer(3), offer(3, { offerId: 'conflict-in-batch' })] }, 409);
  assert.equal(Object.keys(await call('snapshot')).length, 1);
});

test('explicit legacy classification preserves the reserved code; Sandbox cannot be relabelled', async t => {
  const call = await runtime(t), value = offer(), key = await codeKey(value);
  const { environment, ...legacy } = value;
  await call('seed', { [key]: { ...legacy, assignedTo: id(8) } });
  await call('import-apple-offers', { offers: [value] });
  assert.deepEqual((await call('snapshot'))[key], { ...value, assignedTo: id(8) });
  await call('seed', { [key]: { ...value, environment: 'Sandbox' } });
  await call('import-apple-offers', { offers: [value] }, 409);
  assert.equal((await call('snapshot'))[key].environment, 'Sandbox');
});

test('selection finds a valid code beyond the old 1000-row cutoff', async t => {
  const call = await runtime(t), value = offer(3000);
  const rows = Object.fromEntries(Array.from({ length: 1200 }, (_, i) => ['offer:' + String(i).padStart(64, '0'),
    offer(i, { assignedTo: id(9) })]));
  rows['offer:' + 'f'.repeat(64)] = value;
  rows['account:' + id(1)] = owner();
  await call('seed', rows);
  const result = await call('redeem', request());
  assert.equal(result.rewards[0].state, 'store_confirmation');
  assert.ok(result.rewards[0].redemptionURL.endsWith(value.code));
  assert.equal(result.redeemedMonths, 0);
  assert.deepEqual(await call('redeem', request()), result);
  assert.equal((await call('snapshot'))['offer:' + 'f'.repeat(64)].assignedTo, id(1));
});

test('large inventories resume bounded scans privately and never consume the earned month while searching', async t => {
  const call = await runtime(t), value = offer(4000);
  const rows = Object.fromEntries(Array.from({ length: 2200 }, (_, i) => ['offer:' + String(i).padStart(64, '0'),
    offer(i, { expiresAt: now - DAY })]));
  rows['offer:' + 'f'.repeat(64)] = value;
  rows['account:' + id(1)] = owner();
  await call('seed', rows);
  await call('redeem', request(), 409);
  const snapshot = await call('snapshot'), reward = snapshot['account:' + id(1)].rewards[0];
  assert.equal(reward.state, 'earned');
  assert.equal(reward.appleOfferSearch.after, 'offer:' + String(1999).padStart(64, '0'));
  assert.equal(snapshot['offer:' + 'f'.repeat(64)].assignedTo, undefined);
  assert.doesNotMatch(JSON.stringify(await call('status', request())), /appleOfferSearch|scope|after/);
  const result = await call('redeem', request());
  assert.equal(result.rewards[0].state, 'store_confirmation');
  assert.equal((await call('snapshot'))['account:' + id(1)].rewards[0].appleOfferSearch, undefined);
});

test('changed product resets the search; exhaustion resets it so later imports are discoverable', async t => {
  const call = await runtime(t);
  const rows = Object.fromEntries(Array.from({ length: 2000 }, (_, i) => ['offer:' + String(i).padStart(64, '0'),
    offer(i, { expiresAt: now - DAY })]));
  rows['account:' + id(1)] = owner();
  await call('seed', rows);
  await call('redeem', request(), 409);
  await call('redeem', request(), 409);
  assert.equal((await call('snapshot'))['account:' + id(1)].rewards[0].appleOfferSearch, undefined);
  const yearlyOffer = offer(5000, { productId: yearly });
  await call('seed', { ['offer:' + '0'.repeat(64)]: yearlyOffer });
  await call('redeem', request(), 409);
  const result = await call('redeem', { ...request(), fixtureProduct: yearly });
  assert.equal(result.rewards[0].productId, yearly);
  assert.equal(result.rewards[0].state, 'store_confirmation');
});

test('selection skips test/unclassified, expired, wrong-product and previously used offers', async t => {
  const call = await runtime(t), original = owner(1, [
    { id: id(100), state: 'redeemed', months: 1, offerId: 'already-used' },
    { id: id(101), state: 'earned', months: 1 },
  ]);
  const invalid = [{ environment: 'Sandbox' }, { environment: undefined }, { assignedTo: id(9) },
    { expiresAt: now + DAY }, { productId: yearly }, { customerType: 'new_or_expired' }, { offerId: 'already-used' }];
  const rows = Object.fromEntries(invalid.map((patch, i) => ['offer:' + String(i).padStart(64, '0'), offer(i, patch)]));
  rows['account:' + id(1)] = original;
  await call('seed', rows);
  await call('redeem', request(), 409);
  for (const [key, value] of Object.entries(rows).filter(([key]) => key.startsWith('offer:'))) {
    assert.deepEqual((await call('snapshot'))[key], JSON.parse(JSON.stringify(value)));
  }
  await call('import-apple-offers', { offers: [offer(6000, { offerId: 'new-round' })] });
  const result = await call('redeem', request());
  assert.equal(result.rewards[1].offerId, 'new-round');
  assert.equal(result.redeemedMonths, 1);
});

test('simultaneous account reservations cannot assign one code twice', async t => {
  const call = await runtime(t);
  await call('seed', { ['account:' + id(1)]: owner(1), ['account:' + id(2)]: owner(2) });
  await call('import-apple-offers', { offers: [offer()] });
  const results = await Promise.all([call('redeem', request(1), [200, 409]), call('redeem', request(2), [200, 409])]);
  assert.deepEqual(results.map(result => result.httpStatus).sort(), [200, 409]);
  const winner = results.findIndex(result => result.httpStatus === 200) + 1;
  const snapshot = await call('snapshot');
  assert.equal(snapshot[await codeKey(offer())].assignedTo, id(winner));
  assert.equal(snapshot['account:' + id(winner === 1 ? 2 : 1)].rewards[0].state, 'earned');
});

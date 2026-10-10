import assert from 'node:assert/strict';
import { after, before, mock, test } from 'node:test';
import { enrichMap, normalize } from './deal-map-enrichment.mjs';

const now = new Date('2026-10-10T10:00:00Z');
const map = { schemaVersion: 1, lastUpdated: '2026-10-01T00:00:00Z', locations: [] };
const address = number => ({ street: 'Wollzeile', number: String(number), postalCode: '1010' });
const label = value => `${value.street} ${value.number}, ${value.postalCode} Wien`;
const key = value => normalize(`${value.street} ${value.number} ${value.postalCode}`);
const offer = number => ({ id: `fixture-${number}`, brand: `Fixture ${number}`, title: '20 Prozent Rabatt', address: label(address(number)) });
const geocoded = value => ({ address: label(value), latitude: 48.208, longitude: 16.378, source: 'fixture:geocode' });
const run = options => enrichMap({ deals: [offer(1)], map, now, ...options });
let externalCalls = 0;
before(() => mock.method(globalThis, 'fetch', async () => { externalCalls++; throw new Error('External requests forbidden'); }));
after(() => { mock.restoreAll(); assert.equal(externalCalls, 0); });
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

test('Twenty throwing addresses cannot starve the twenty-first across hourly cycles or cache-only runs', async () => {
  const deals = freeze(Array.from({ length: 21 }, (_, index) => offer(index + 1)));
  const before = JSON.stringify(deals);
  const calls = [];
  const lookup = async value => {
    calls.push(value.number);
    if (Number(value.number) <= 20) throw new Error('fixture outage');
    return geocoded(value);
  };
  const first = await run({ deals, lookup });
  assert.equal(first.requests, 20);
  assert.deepEqual(calls, deals.slice(0, 20).map((_, index) => String(index + 1)));
  assert.deepEqual(first.report.deals[20].failures, ['request-budget']);
  assert.equal(Object.keys(first.cache).length, 20);
  for (const entry of Object.values(first.cache)) {
    assert.equal(entry.lastAttemptAt, now.toISOString());
    assert.equal(entry.lastFailureAt, now.toISOString());
    assert.equal(entry.result, undefined);
    assert.equal(entry.checkedAt, undefined);
  }
  const nextHour = new Date('2026-10-10T11:00:00Z');
  calls.length = 0;
  const cacheOnly = await run({ deals, lookup, cache: first.cache, now: nextHour, maxRequests: 0 });
  assert.equal(cacheOnly.requests, 0);
  assert.deepEqual(calls, []);
  const second = await run({ deals, lookup, cache: cacheOnly.cache, now: nextHour });
  assert.equal(second.requests, 20);
  assert.equal(calls[0], '21');
  assert.equal(second.report.deals[20].status, 'mapped');
  assert.deepEqual(second.map.locations[0].dealIds, ['fixture-21']);
  for (const result of [first, cacheOnly, second]) assert.deepEqual(result.report.deals.map(row => row.id), deals.map(deal => deal.id));
  assert.equal(JSON.stringify(deals), before);
  calls.length = 0;
  await run({ deals, lookup, cache: second.cache, now: new Date('2026-10-10T12:00:00Z'), maxRequests: 1 });
  assert.deepEqual(calls, ['20'], 'The oldest failed retry precedes failures attempted more recently');
});

test('Failure cooldown lasts fifteen minutes, preserves attempt history, and deduplicates shared addresses', async () => {
  const deals = [offer(1), { ...offer(1), id: 'shared-address' }];
  const calls = [];
  const lookup = async value => { calls.push(value.number); throw new Error('fixture unavailable'); };
  const first = await run({ deals, lookup });
  assert.equal(first.requests, 1);
  assert.deepEqual(calls, ['1']);
  assert.ok(first.report.deals.every(row => row.failures.includes('fixture unavailable')));
  const cache = structuredClone(first.cache);
  calls.length = 0;
  const cooling = await run({ deals, lookup, cache, now: new Date('2026-10-10T10:14:59Z') });
  assert.equal(cooling.requests, 0);
  assert.deepEqual(calls, []);
  assert.deepEqual(cooling.cache, first.cache);
  assert.ok(cooling.report.deals.every(row => row.failures.includes('geocode-cooldown')));
  const retry = await run({ deals, lookup, cache, now: new Date('2026-10-10T10:15:00Z') });
  assert.equal(retry.requests, 1);
  assert.deepEqual(calls, ['1']);
});

test('Stale positive fallback survives outages and cooldown without refreshing its evidence age', async () => {
  const originalTime = '2025-01-01T00:00:00Z';
  const result = geocoded(address(1));
  const cache = { [key(address(1))]: { checkedAt: originalTime, queryVersion: 3, result } };
  const lookup = async () => { throw new Error('fixture outage'); };
  const outage = await run({ cache, lookup });
  assert.equal(outage.requests, 1);
  assert.equal(outage.map.locations[0].address, result.address);
  assert.equal(outage.report.deals[0].status, 'partially-mapped');
  assert.equal(cache[key(address(1))].checkedAt, originalTime);
  assert.deepEqual(cache[key(address(1))].result, result);
  const cooling = await run({ cache, lookup, now: new Date('2026-10-10T10:05:00Z') });
  assert.equal(cooling.requests, 0);
  assert.deepEqual(cooling.map.locations, outage.map.locations);
  assert.ok(cooling.report.deals[0].failures.includes('geocode-cooldown'));
  const healed = await run({ cache, lookup: async value => geocoded(value), now: new Date('2026-10-10T10:15:00Z') });
  assert.equal(healed.requests, 1);
  assert.equal(healed.report.deals[0].status, 'mapped');
  assert.equal(cache[key(address(1))].lastFailureAt, undefined);
  assert.equal(cache[key(address(1))].checkedAt, '2026-10-10T10:15:00.000Z');
});

test('Oldest-first request order never reorders report or markers and the next map remains byte-stable', async () => {
  const deals = freeze([offer(1), offer(2), offer(3)]);
  const cache = Object.fromEntries([1, 2].map(number => [key(address(number)), {
    checkedAt: `2026-10-0${3 - number}T10:00:00Z`, queryVersion: 3, result: null,
  }]));
  const calls = [];
  const first = await run({ deals, cache, lookup: async value => { calls.push(value.number); return geocoded(value); } });
  assert.deepEqual(calls, ['3', '2', '1']);
  assert.deepEqual(first.report.deals.map(row => row.id), deals.map(deal => deal.id));
  assert.deepEqual(first.map.locations.map(location => location.dealIds[0]), deals.map(deal => deal.id));
  const baseline = await run({ deals, lookup: async value => geocoded(value) });
  assert.deepEqual(first.map, baseline.map);
  const second = await run({ deals, map: freeze(structuredClone(first.map)), catalog: freeze(structuredClone(first.catalog)), cache,
    now: new Date('2026-10-10T11:00:00Z'), lookup: async () => { throw new Error('Unexpected lookup'); } });
  assert.equal(second.requests, 0);
  assert.equal(JSON.stringify(second.map), JSON.stringify(first.map));
});

test('Negative results retain their one-day TTL and invalid budgets cannot issue requests', async () => {
  const first = await run({ lookup: async () => null });
  assert.equal(first.requests, 1);
  assert.equal(first.cache[key(address(1))].lastFailureAt, undefined);
  const cached = await run({ cache: first.cache, now: new Date('2026-10-11T09:59:59Z'), lookup: async () => { throw new Error('Unexpected lookup'); } });
  assert.equal(cached.requests, 0);
  const expired = await run({ cache: first.cache, now: new Date('2026-10-11T10:00:00Z'), lookup: async () => null });
  assert.equal(expired.requests, 1);
  for (const maxRequests of [0, -1, NaN, Infinity, 0.9]) {
    const result = await run({ maxRequests, lookup: async () => { throw new Error('Unexpected lookup'); } });
    assert.equal(result.requests, 0);
    assert.deepEqual(result.cache, {});
    assert.deepEqual(result.report.deals[0].failures, ['request-budget']);
  }
});

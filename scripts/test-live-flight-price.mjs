import assert from 'node:assert/strict';
import { normalizeFlightPrice, normalizeLiveDealEdit, upsertLiveDealEdit, applyLiveDealEditsToBundle } from './live-deal-edits-lib.mjs';
import { normalizeDealRecord } from '../scraper/deal-normalization-utils.js';
import { normalizeSocialDeal } from '../scraper/normalize-live-deals.js';

const checkedAt = '2026-11-05T22:18:00.000Z';
const flight = {
  id: 'flight-example', title: 'Saved flight', description: 'Saved terms', votes: 12,
  liveEditedFields: [],
  flight: { provider: 'Ryanair', destination: { airportCode: 'BCN' },
    outbound: { departureDate: '2026-12-14' }, inbound: { departureDate: '2026-12-16' },
    price: { value: 55.98, formatted: '€55.98', currencyCode: 'EUR', sourceNote: 'retained' },
    badges: ['Schnäppchen', 'Top-Schnäppchen', 'Roundtrip', 'Direkt', 'Live-Fare'] },
};
const food = { id: 'food-example', title: 'Food', liveEditedFields: [] };
const input = { deals: [flight, food], totalDeals: 2 };
const original = structuredClone(input);
const raw = { dealId: flight.id, flightPrice: { value: 107.11, currencyCode: 'EUR', checkedAt }, editedBy: 'owner-price-review' };
assert.deepEqual(normalizeFlightPrice(raw.flightPrice), raw.flightPrice);
for (const value of [null, [], '107.11', { value: 0 }, { value: -1 }, { value: Infinity }, { value: NaN },
  ...[true, '107.11', [10]].map(value => ({ value, currencyCode: 'EUR', checkedAt })),
  { value: 1.234, currencyCode: 'EUR', checkedAt }, { value: 10, currencyCode: 'USD', checkedAt },
  { value: 10, currencyCode: 'EUR', checkedAt: 'not-a-date' },
  { value: 10, currencyCode: 'EUR', checkedAt: '2026-02-31T00:00:00.000Z' },
  { value: 10, currencyCode: 'EUR', checkedAt: '2026-11-05' }]) assert.equal(normalizeFlightPrice(value), null);
const createdAt = '2026-10-23T08:00:00.000Z';
let store = { edits: [normalizeLiveDealEdit({ dealId: flight.id, title: 'Earlier approved title', createdAt })] };
store = upsertLiveDealEdit(store, raw, checkedAt);
assert.equal(store.edits[0].createdAt, createdAt);
assert.equal(store.edits[0].title, 'Earlier approved title');
assert.equal(typeof store.edits[0].flightPrice, 'object');
const result = applyLiveDealEditsToBundle(input, store, { checkedAt });
const updated = result.bundle.deals[0];
assert.equal(updated.flight.price.value, 107.11);
assert.equal(updated.flight.price.formatted, '€107.11');
assert.equal(updated.flight.price.checkedAt, checkedAt);
assert.equal(updated.flight.price.sourceNote, 'retained');
assert.deepEqual(updated.flight.destination, flight.flight.destination);
assert.deepEqual(updated.flight.outbound, flight.flight.outbound);
assert.deepEqual(updated.flight.inbound, flight.flight.inbound);
assert.deepEqual(updated.flight.badges, ['Roundtrip', 'Direkt']);
assert.equal(updated.votes, 12);
assert.deepEqual(result.bundle.deals[1], food);
assert.deepEqual(input, original, 'Do not mutate the source record or nested price/badges');
const replay = applyLiveDealEditsToBundle(result.bundle, store, { checkedAt: '2026-11-06T12:00:00.000Z' });
assert.equal(replay.changed, false);
assert.deepEqual(replay.bundle, result.bundle);
let normalized = updated;
for (let i = 0; i < 3; i++) {
  normalized = normalizeDealRecord(normalizeSocialDeal(normalizeDealRecord(normalized)));
  normalized = applyLiveDealEditsToBundle({ deals: [normalized] }, store, { checkedAt }).bundle.deals[0];
  assert.deepEqual(normalized.flight, updated.flight, 'Observed price, route and truthful badges survive canonical normalization plus persistent replay');
}
for (const target of [food, { ...flight, id: 'usd', flight: { ...flight.flight, price: { ...flight.flight.price, currencyCode: 'USD' } } },
  { ...flight, id: 'incomplete', flight: { ...flight.flight, inbound: undefined } }]) {
  const priceOnly = { edits: [normalizeLiveDealEdit({ ...raw, dealId: target.id })] };
  assert.deepEqual(applyLiveDealEditsToBundle({ deals: [target] }, priceOnly, { checkedAt }).bundle.deals[0], target);
}
console.log('Manual flight price PASS: strict EUR observation, nested price/badge consistency, target guards, original metadata, no mutation and stable replay.');

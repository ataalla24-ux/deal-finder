import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { FLIGHT_ALTERNATIVES_PATH, reconcileCityFlightFeed, reconcileCityFlights } from './cheapest-city-flights.mjs';

const now = new Date('2026-11-20T14:00:00Z');
const approvedAt = '2026-11-19T13:00:00.000Z';
const ids = deals => deals.map(deal => deal.id);

function flight(id, {
  city = 'Rome', country = 'Italy', airport = 'FCO', price = 65.85,
  outbound = '2027-01-11', inbound = '2027-01-16',
} = {}) {
  const route = new URLSearchParams({
    adults: '1', teens: '0', children: '0', infants: '0', originIata: 'VIE',
    destinationIata: airport, dateOut: outbound, dateIn: inbound, isReturn: 'true',
    discount: '0', promoCode: '',
  });
  const bookingUrl = `https://www.ryanair.com/gb/en/trip/flights/select?${route}`;
  const formatted = `€${price.toFixed(2)}`;
  return {
    id: `flight-${id}`,
    source: 'Flights Vienna',
    originSource: 'Flights Vienna',
    brand: 'Ryanair',
    title: `Hin & zurück nach ${city} ab ${formatted}`,
    description: `Ryanair: Roundtrip Wien -> ${city} · ${outbound} → ${inbound}`,
    category: 'reisen',
    type: 'rabatt',
    url: bookingUrl,
    validUntil: outbound,
    expires: `${outbound}T23:59:59.999Z`,
    expiresOriginal: `Abflug ${outbound}`,
    expiryKind: 'end',
    expiryDisplayText: `Abflug ${outbound}`,
    approvedAt,
    pipelineLifecycle: { stage: 'published', manualDecision: 'approved' },
    flight: {
      provider: 'Ryanair',
      destination: { city, country, airportCode: airport },
      price: { value: price, currencyCode: 'EUR', formatted },
      outbound: { departureDate: outbound },
      inbound: { departureDate: inbound },
      bookingUrl,
      tripDurationDays: (Date.parse(inbound) - Date.parse(outbound)) / 86400000,
      badges: ['Roundtrip', 'Direkt', 'Live-Fare'],
    },
  };
}

const cheap = flight('cheap', { price: 42.98, outbound: '2027-01-12', inbound: '2027-01-17' });
const expensive = flight('expensive', { price: 79.16 });
const food = { id: 'cake', title: 'Kuchen zum halben Preis', category: 'essen' };

test('picks the cheaper of two newly approved offers in either order', () => {
  for (const offers of [[expensive, cheap], [cheap, expensive]]) {
    const result = reconcileCityFlights(offers, [], { now });
    assert.deepEqual(ids(result.deals), [cheap.id]);
    assert.deepEqual(ids(result.alternatives), [expensive.id]);
  }
});

test('retains the cheaper live price and replaces an expensive live offer when a cheaper one is approved', () => {
  const first = reconcileCityFlights([food, cheap], [], { now });
  const withExpensiveApproval = reconcileCityFlights([...first.deals, expensive], first.alternatives, { now });
  assert.deepEqual(ids(withExpensiveApproval.deals), [food.id, cheap.id]);
  assert.deepEqual(ids(withExpensiveApproval.alternatives), [expensive.id]);

  const second = reconcileCityFlights([food, expensive], [], { now });
  const withCheapApproval = reconcileCityFlights([...second.deals, cheap], second.alternatives, { now });
  assert.deepEqual(ids(withCheapApproval.deals), [food.id, cheap.id]);
  assert.deepEqual(ids(withCheapApproval.alternatives), [expensive.id]);
});

test('an already approved alternative moves into the feed after the cheaper itinerary departs', () => {
  const soon = flight('soon', { price: 21.50, outbound: '2026-11-21', inbound: '2026-11-25' });
  const result = reconcileCityFlights([soon, expensive], [], { now });
  assert.deepEqual(ids(result.deals), [soon.id]);
  assert.deepEqual(ids(result.alternatives), [expensive.id]);

  const afterDeparture = new Date('2026-11-24T12:00:00Z');
  const next = reconcileCityFlights(result.deals, result.alternatives, { now: afterDeparture });
  assert.deepEqual(ids(next.deals), [expensive.id]);
  assert.equal(next.deals[0].approvedAt, approvedAt);
  assert.ok(!ids(next.alternatives).includes(soon.id));
});

test('matches the city across different destination airports and separates same-named cities in other countries', () => {
  const ciampino = flight('ciampino', { city: 'ROME', airport: 'CIA', price: 51.15 });
  const otherRome = flight('otherrome', { city: 'Rome', country: 'United States', airport: 'RME', price: 59.90 });
  const result = reconcileCityFlights([expensive, ciampino, otherRome], [], { now });
  assert.deepEqual(new Set(ids(result.deals)), new Set([ciampino.id, otherRome.id]));
  assert.deepEqual(ids(result.alternatives), [expensive.id]);
});

test('equal prices keep the visible trip stable while holding the equally priced alternative', () => {
  const equal = flight('equal', { price: cheap.flight.price.value, airport: 'CIA' });
  const result = reconcileCityFlights([cheap], [equal], { now });
  assert.deepEqual(ids(result.deals), [cheap.id]);
  assert.deepEqual(ids(result.alternatives), [equal.id]);
});

test('moderated offers do not reappear from reserved alternatives', () => {
  const hiddenIds = new Set([cheap.id]);
  const result = reconcileCityFlights([expensive], [cheap], { now, hiddenIds });
  assert.deepEqual(ids(result.deals), [expensive.id]);
  assert.ok(!ids(result.alternatives).includes(cheap.id));
});

test('compares manually updated prices for the live and reserved offers', () => {
  const edited = { value: 19.92, currencyCode: 'EUR', checkedAt: '2026-11-20T10:00:00.000Z' };
  const result = reconcileCityFlights([cheap], [expensive], {
    now, edits: { edits: [{ dealId: expensive.id, flightPrice: edited }] },
  });
  assert.deepEqual(ids(result.deals), [expensive.id]);
  assert.equal(result.deals[0].flight.price.value, 19.92);
  assert.deepEqual(ids(result.alternatives), [cheap.id]);

  const repriced = { value: 139.90, currencyCode: 'EUR', checkedAt: '2026-11-20T10:30:00.000Z' };
  const after = reconcileCityFlights(result.deals, result.alternatives, {
    now, edits: { edits: [{ dealId: expensive.id, flightPrice: repriced }] },
  });
  assert.deepEqual(ids(after.deals), [cheap.id]);
  assert.deepEqual(ids(after.alternatives), [expensive.id]);
});

test('leaves other deals and unstructured flight entries intact and is idempotent', () => {
  const unsupported = { id: 'flight-old', brand: 'Ryanair', category: 'reisen', title: 'Alter Flug nach Rom um 29 €' };
  const trip = { id: 'train-rome', category: 'reisen', title: 'Mit der Bahn nach Rom um 25 €' };
  const originals = [food, expensive, unsupported, trip, cheap];
  const original = structuredClone(originals);
  const first = reconcileCityFlights(originals, [], { now });
  assert.deepEqual(first.deals.filter(deal => !deal.flight), [food, unsupported, trip]);
  assert.deepEqual(originals, original);
  assert.deepEqual(reconcileCityFlights(first.deals, first.alternatives, { now }), first);
});

test('stores approved alternatives across runs, honors moderator edits and promotes after Vienna departure time', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'freefinder-flight-selection-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = name => path.join(root, name);
  const write = (name, value) => fs.writeFileSync(file(name), JSON.stringify(value));
  const read = name => JSON.parse(fs.readFileSync(file(name), 'utf8'));
  fs.mkdirSync(file('docs'));

  const departingToday = flight('departing', {
    price: 19.98, outbound: '2026-11-20', inbound: '2026-11-24',
  });
  departingToday.flight.outbound.departureTime = '15:15';
  const moderated = flight('moderated', { price: 30.01 });
  const standby = flight('standby', { price: 55.01, airport: 'CIA' });
  standby.pipelineLifecycle.manualDecisionUser = 'PRIVATE_TEST_REVIEWER';
  write('docs/deals.json', { deals: [food, departingToday, moderated, standby], totalDeals: 4 });

  reconcileCityFlightFeed({ root, now });
  assert.deepEqual(ids(read('docs/deals.json').deals), [food.id, departingToday.id]);
  const saved = read(FLIGHT_ALTERNATIVES_PATH);
  assert.deepEqual(new Set(ids(saved.deals)), new Set([moderated.id, standby.id]));
  assert.ok(!JSON.stringify(saved).includes('PRIVATE_TEST_REVIEWER'));

  write('docs/deal-moderation.json', { hiddenDeals: [{ id: moderated.id }] });
  write('docs/live-deal-edits.json', {
    edits: [{ dealId: standby.id, flightPrice: {
      value: 46.50, currencyCode: 'EUR', checkedAt: '2026-11-20T13:55:00.000Z',
    } }],
  });
  reconcileCityFlightFeed({ root, now });
  const edited = read(FLIGHT_ALTERNATIVES_PATH).deals;
  assert.deepEqual(ids(edited), [standby.id]);
  assert.equal(edited[0].flight.price.value, 46.50);

  reconcileCityFlightFeed({ root, now: new Date('2026-11-20T14:16:00Z') });
  const published = read('docs/deals.json');
  assert.deepEqual(ids(published.deals), [food.id, standby.id]);
  assert.equal(published.deals[1].approvedAt, approvedAt);
  assert.equal(published.deals[1].flight.price.value, 46.50);
  assert.equal(published.totalDeals, 2);
  assert.deepEqual(read(FLIGHT_ALTERNATIVES_PATH).deals, []);
});

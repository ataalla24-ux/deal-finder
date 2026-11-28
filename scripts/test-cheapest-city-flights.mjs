import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { FLIGHT_ALTERNATIVES_PATH, reconcileCityFlightFeed, reconcileCityFlights } from './cheapest-city-flights.mjs';

const now = new Date('2026-11-20T14:00:00Z');
const approvedAt = '2026-11-19T13:00:00.000Z';
const ids = deals => deals.map(deal => deal.id);

function flight(id, {
  city = 'Rome', country = 'Italy', airport = 'FCO', price = 65.85,
  outbound = '2027-01-11', inbound = '2027-01-16',
  checkedAt,
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
      price: { value: price, currencyCode: 'EUR', formatted, ...(checkedAt === undefined ? {} : { checkedAt }) },
      outbound: { departureDate: outbound },
      inbound: { departureDate: inbound },
      bookingUrl,
      tripDurationDays: (Date.parse(inbound) - Date.parse(outbound)) / 86400000,
      badges: ['Roundtrip', 'Direkt', 'Live-Fare'],
    },
  };
}

const cheap = flight('cheap', { price: 42.98, outbound: '2027-01-12', inbound: '2027-01-17', checkedAt: '2026-11-20T13:00:00.000Z' });
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

test('an approved alternative needs a fresh price before replacing a departed itinerary', () => {
  const soon = flight('soon', { price: 21.50, outbound: '2026-11-21', inbound: '2026-11-25' });
  const result = reconcileCityFlights([soon, expensive], [], { now });
  assert.deepEqual(ids(result.deals), [soon.id]);
  assert.deepEqual(ids(result.alternatives), [expensive.id]);

  const afterDeparture = new Date('2026-11-24T12:00:00Z');
  const stale = reconcileCityFlights(result.deals, result.alternatives, { now: afterDeparture });
  assert.deepEqual(ids(stale.deals), []);
  assert.deepEqual(ids(stale.alternatives), [expensive.id]);
  const next = reconcileCityFlights(stale.deals, stale.alternatives, {
    now: afterDeparture,
    edits: { edits: [{ dealId: expensive.id, flightPrice: {
      value: expensive.flight.price.value, currencyCode: 'EUR', checkedAt: '2026-11-24T11:00:00.000Z',
    } }] },
  });
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
  const equal = flight('equal', { price: cheap.flight.price.value, airport: 'CIA', checkedAt: now.toISOString() });
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

test('keeps the reviewed Cologne itinerary instead of reviving the cheaper 20 November archive quote', () => {
  const reviewedNow = new Date('2026-11-28T09:14:35.160Z');
  const reviewed = flight('102r4v2', { city: 'Cologne', country: 'Germany', airport: 'CGN',
    price: 78.60, outbound: '2027-01-14', inbound: '2027-01-16', checkedAt: '2026-11-28T08:32:26.425Z' });
  const archived = flight('divz3x', { city: 'Cologne', country: 'Germany', airport: 'CGN',
    price: 76.88, outbound: '2027-01-07', inbound: '2027-01-11', checkedAt: '2026-11-20T14:39:14.630Z' });
  const edits = { edits: [{ dealId: archived.id, updatedAt: reviewedNow.toISOString(),
    flightPrice: { value: 76.88, currencyCode: 'EUR', checkedAt: archived.flight.price.checkedAt } }] };
  const result = reconcileCityFlights([food, reviewed], [archived], { now: reviewedNow, edits });
  assert.deepEqual(ids(result.deals), [food.id, reviewed.id]);
  assert.deepEqual(ids(result.alternatives), [archived.id]);
  assert.deepEqual(result.deals[1], reviewed);
  assert.equal(result.alternatives[0].flight.price.checkedAt, archived.flight.price.checkedAt);
  assert.equal(result.alternatives[0].approvedAt, approvedAt);
  assert.deepEqual(reconcileCityFlights(result.deals, result.alternatives, { now: reviewedNow, edits }), result);
});

test('holds old, missing, invalid and future archive quotes without falsely expiring them', () => {
  const values = [undefined, null, '', 'not-a-date', '2026-11-20', 1795183200000,
    '2026-02-31T14:00:00.000Z', '2026-11-20T14:00:00.000Z ',
    '2026-11-20T15:00:00.000+01:00', '2026-11-20T14:00:00.001Z',
    '2026-11-19T13:59:59.999Z'];
  for (const checkedAt of values) {
    const archived = flight('stale', { price: 19.99, checkedAt });
    for (const live of [[], [expensive]]) {
      const result = reconcileCityFlights(live, [archived], { now });
      assert.deepEqual(result.deals, live, String(checkedAt));
      assert.deepEqual(result.alternatives, [archived], String(checkedAt));
      assert.deepEqual(reconcileCityFlights(result.deals, result.alternatives, { now }), result);
    }
  }
});

test('admits archive quotes at now and exactly 24 hours old while honoring existing vetoes', () => {
  for (const checkedAt of [now.toISOString(), '2026-11-19T14:00:00.000Z']) {
    const archived = flight('fresh', { price: 19.99, checkedAt });
    assert.deepEqual(ids(reconcileCityFlights([expensive], [archived], { now }).deals), [archived.id]);
    for (const guard of [{ hiddenIds: new Set([archived.id]) }, { archivedIds: new Set([archived.id]) }]) {
      const held = reconcileCityFlights([expensive], [archived], { now, ...guard });
      assert.deepEqual(ids(held.deals), [expensive.id]);
      assert.deepEqual(held.alternatives, []);
    }
  }
  const departed = flight('departed', { outbound: '2026-11-18', inbound: '2026-11-22' });
  assert.deepEqual(reconcileCityFlights([], [departed], { now }), { deals: [], alternatives: [] });
});

test('does not gate live input or newly approved input by archive quote freshness or previous visibility', () => {
  for (const checkedAt of [undefined, 'not-a-date', '2026-11-01T14:00:00.000Z']) {
    const incoming = flight('incoming', { price: 19.99, checkedAt });
    const result = reconcileCityFlights([expensive, incoming], [], { now, visibleIds: new Set([expensive.id]) });
    assert.deepEqual(ids(result.deals), [incoming.id]);
    assert.deepEqual(ids(result.alternatives), [expensive.id]);
  }
});

test('quality CLI and generated-commit shared entrypoint retain stale alternatives offline', t => {
  const script = fileURLToPath(new URL('./cheapest-city-flights.mjs', import.meta.url));
  const quality = fs.readFileSync(new URL('../.github/workflows/server-deal-quality.yml', import.meta.url), 'utf8');
  const generated = fs.readFileSync(new URL('./commit-generated.mjs', import.meta.url), 'utf8');
  assert.match(quality, /run: node scripts\/cheapest-city-flights\.mjs/);
  assert.match(generated, /import\('\.\/cheapest-city-flights\.mjs'\)/);
  assert.match(generated, /reconcileCityFlightFeed\(\{ visibleIds \}\)/);
  const clock = new Date();
  const day = offset => new Date(+clock + offset * 86400000).toISOString().slice(0, 10);
  const current = flight('current', { outbound: day(30), inbound: day(34), price: 78.60,
    checkedAt: new Date(+clock - 3600000).toISOString() });
  const archived = flight('stale', { outbound: day(25), inbound: day(29), price: 76.88,
    checkedAt: new Date(+clock - 8 * 86400000).toISOString() });
  for (const mode of ['quality-cli', 'generated-commit']) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'freefinder-flight-freshness-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, 'docs'));
    fs.mkdirSync(path.join(root, 'reviews'));
    fs.writeFileSync(path.join(root, 'docs/deals.json'), JSON.stringify({ deals: [food, current], totalDeals: 2 }));
    fs.writeFileSync(path.join(root, FLIGHT_ALTERNATIVES_PATH), JSON.stringify({ version: 1, deals: [archived] }));
    const run = () => mode === 'quality-cli'
      ? execFileSync(process.execPath, [script], { cwd: root, encoding: 'utf8', timeout: 10000 })
      : reconcileCityFlightFeed({ root, now: clock, visibleIds: new Set([food.id]) });
    run();
    const read = file => fs.readFileSync(path.join(root, file), 'utf8');
    const savedFeed = read('docs/deals.json'), savedArchive = read(FLIGHT_ALTERNATIVES_PATH);
    assert.deepEqual(ids(JSON.parse(savedFeed).deals), [food.id, current.id], mode);
    assert.deepEqual(ids(JSON.parse(savedArchive).deals), [archived.id], mode);
    run();
    assert.equal(read('docs/deals.json'), savedFeed);
    assert.equal(read(FLIGHT_ALTERNATIVES_PATH), savedArchive);
  }
});

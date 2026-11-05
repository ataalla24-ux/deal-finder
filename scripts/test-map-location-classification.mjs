import assert from 'node:assert/strict';
import { after, before, mock, test } from 'node:test';
import { candidatesFor, inspectDealLocation, onlineOnly } from './deal-map-enrichment.mjs';
import { requireApprovalMap } from './approval-map-readiness.mjs';
import { reviewDealMap } from './deal-map-review.mjs';

const now = new Date('2026-11-05T20:00:00Z');
const context = { map: { locations: [] }, reviewed: {}, today: '2026-11-05' };
// The reported card without an enriched location or any street/coordinate evidence.
const passage = {
  id: 'meta-ig-17915890425545174', brand: 'Babenberger Passage',
  title: 'Birthday-Special: Eintritt um 10 \u20ac bei Babenberger Passage',
  description: 'WAS F\u00dcR EINE HALLOWEEN-NACHT! \ud83c\udf83 Ein riesiges DANKESCH\u00d6N an alle, die mit uns Halloween gefeiert haben! Ihr habt diese Nacht unvergesslich gemacht! Aber die Party geht weiter\u2026 Wir k\u00f6nnen es kaum erwarten, mit euch N\u00c4CHSTEN FREITAG, AM 13. NOVEMBER, wieder zu feiern! \ud83d\udccd Babenberger Passage, 1010 Wien \ud83d\udcc5 Freitag, 13.11.2026 \u23f0 ab 23:00 Uhr \ud83c\udfb6 HipHop x KPop x PH HipHop x Party Edits EURE SPECIALS: * Gratis Photobooth * Gratis Chupa Chups Sweets * Spektakul\u00e4re Lightshow * November-Geburtstags-Special: Nur je 10 \u20ac Eintritt f\u00fcr dich & eine Begleitperson! \ud83c\udf93 Studententickets: 10 \u20ac online \ud83c\udf9f Early Bird & Studententickets \u2013 LINK IN BIO! \ud83e\udd42 VIP-Tische: asiannight.at/tisch Gleiche Energie. Neue Erinnerungen. Wir sehen uns n\u00e4chsten Freitag! . . . . #asiannight#wien#asianparty#kpop#party',
  distance: 'Wien',
  url: 'https://www.instagram.com/p/DfXzEe7Cg8D/',
  validFrom: '2026-11-13T00:00:00.000Z', validUntil: '2026-11-13T23:59:59.999Z',
};
const physical = {
  id: 'physical-fixture', title: 'Eintritt um 10 EUR',
  description: 'Studententickets online kaufen.', location: 'Fixture Club, Wien',
  url: 'https://example.invalid/tickets',
};
const address = 'Braunhubergasse 19, 1110 Wien';
const venue = { id: 'fixture-cinema', name: 'Fixture Cinema Wien', address,
  latitude: 48.17024, longitude: 16.41565, confidence: 1, source: 'test-fixture' };
const validation = deals => ({ allowedDeals: deals, blockedDeals: [],
  results: deals.map(deal => ({ deal, decision: { allowed: true, reasons: [], warnings: [] } })) });
let requests = 0;
before(() => mock.method(globalThis, 'fetch', async () => {
  requests++;
  throw new Error('No network allowed in location classification tests');
}));
after(() => {
  mock.restoreAll();
  assert.equal(requests, 0);
});
const noLookup = async () => { throw new Error('No exact address supplied; no geocoding permitted'); };

test('reported Babenberger online ticket sale remains onsite and held without verified coordinates', async () => {
  const snapshot = structuredClone(passage);
  assert.equal(onlineOnly(passage), false);
  assert.equal(inspectDealLocation(passage, context).status, 'needs-review');
  assert.deepEqual(candidatesFor(passage, {}, context.today), { reason: 'missing-exact-address', addresses: [] });
  const review = reviewDealMap(passage, context);
  assert.match(review.text, /\[needs-review\]/);
  assert.match(review.text, /Adresse\/Filiale pr\u00fcfen/);
  assert.doesNotMatch(review.text, /Reines Online/);
  const result = await requireApprovalMap(validation([passage]), { now, lookup: noLookup });
  assert.equal(result.validation.allowedDeals.length, 0);
  assert.deepEqual(result.validation.blockedDeals, [passage]);
  assert.match(result.validation.results[0].decision.reasons[0], /Kartenstandort fehlt/);
  assert.equal(result.requests, 0);
  assert.deepEqual(result.map.locations, []);
  assert.deepEqual(passage, snapshot);
});

test('raw pending location text also remains onsite without supplying an exact address', () => {
  const deal = { ...passage,
    location: 'eder zu feiern! \ud83d\udccd Babenberger Passage, 1010 Wien \ud83d\udcc5 Freitag, 13.11.2026 \u23f0 ab 23:00 Uhr \ud83c\udfb6 HipHop x KPop',
    city: 'Wien', postalCode: '1010' };
  assert.equal(onlineOnly(deal), false);
  assert.equal(inspectDealLocation(deal, context).status, 'needs-review');
  assert.deepEqual(inspectDealLocation(deal, context).addresses, []);
});

for (const description of [
  'Studententickets: 10 EUR online. Eintritt am Freitag.',
  'Tickets nur online kaufen. Eintritt am Freitag.',
  'Tickets ausschlie\u00dflich online erh\u00e4ltlich. Eintritt am Freitag.',
  'Studententickets gibt es nur online. Eintritt am Freitag.',
  'Kinotickets nur online. Eintritt am Freitag.',
  'Tickets nur online buchbar. Eintritt am Freitag.',
  'Eintritt am Freitag, Tickets nur online kaufen. Kein Livestream.',
]) {
  test(`ticket acquisition does not exempt a named venue: ${description}`, () => {
    const deal = { ...physical, description };
    assert.equal(onlineOnly(deal), false);
    assert.equal(inspectDealLocation(deal, context).status, 'needs-review');
  });
}

for (const description of [
  'Gutschein nur online erh\u00e4ltlich, vor Ort einl\u00f6sbar.',
  'Gutscheine nur online kaufen, in der Filiale einl\u00f6sbar.',
  'Coupon online herunterladen, in allen Filialen einl\u00f6sen.',
  'Gutscheine ausschlie\u00dflich online, Einl\u00f6sung vor Ort.',
  'Gutschein im Onlineshop kaufen, vor Ort einl\u00f6sbar.',
]) {
  test(`online coupon with explicit physical redemption requires a map: ${description}`, () => {
    const deal = { id: 'coupon', title: 'Kaffee gratis', location: 'Online', description };
    assert.equal(onlineOnly(deal), false);
    assert.equal(inspectDealLocation(deal, context).status, 'needs-review');
  });
}

test('a named venue must match verified existing coordinates before online-ticket approval', async () => {
  const deal = { ...physical, location: venue.name, title: 'Kinotickets online kaufen' };
  const snapshot = structuredClone({ deal, venue });
  const options = { now, catalog: { locations: [venue] }, lookup: noLookup };
  const result = await requireApprovalMap(validation([deal]), options);
  assert.deepEqual(result.validation.allowedDeals, [deal]);
  assert.equal(result.requests, 0);
  assert.deepEqual(result.checks[deal.id].locationIds, [venue.id]);
  assert.equal(reviewDealMap(deal, { ...context, catalog: options.catalog }).status, 'mapped');
  const wrongVenue = { ...venue, id: 'different', name: 'Another Cinema Wien' };
  const wrong = await requireApprovalMap(validation([deal]), { ...options, catalog: { locations: [wrongVenue] } });
  assert.equal(wrong.validation.allowedDeals.length, 0);
  assert.deepEqual(wrong.map.locations, []);
  assert.deepEqual({ deal, venue }, snapshot);
});

test('a caption address for an actual event survives the online fallback but is not guessed into a point', async () => {
  const deal = { ...physical, location: 'Wien', description: `Eintritt: Tickets online. Veranstaltungsort: ${address}` };
  assert.equal(onlineOnly(deal), false);
  assert.equal(inspectDealLocation(deal, context).status, 'address-ready');
  const result = await requireApprovalMap(validation([deal]), { now, maxRequests: 0, lookup: noLookup });
  assert.equal(result.validation.allowedDeals.length, 0);
  assert.equal(result.requests, 0);
  assert.deepEqual(result.map.locations, []);
});

for (const overrides of [
  { title: 'Nur online im Webshop', description: 'Nur Versand. Keine Abholung.' },
  { title: 'Eintritt Konzert Livestream', description: 'Tickets online kaufen.' },
  { title: 'Party Streaming', description: 'Online only.' },
  { title: 'Webinar Eintritt', description: 'Online buchen.' },
  { title: '20 Prozent im Onlineshop', description: 'Online bestellen.' },
  { title: 'Party Dekoration im Onlineshop', description: 'Online bestellen.' },
  { title: 'Gratis Download', description: 'Online herunterladen.' },
  { title: 'Nur online einl\u00f6sbarer Gutschein', description: 'Firmenkontakt siehe Adresse.' },
  { title: 'Eintritt nur online einl\u00f6sbar', description: 'Tickets nur online kaufen.' },
  { title: 'Kinotickets nur online einl\u00f6sbar', description: 'Online einl\u00f6sen.' },
  { title: 'Kinotickets nur online g\u00fcltig', description: 'Online nutzen.' },
  { id: 'flight-test', title: 'Flugticket online kaufen' },
  { url: 'https://wolt.com/restaurant/fixture', description: 'Online bestellen.' },
  { url: 'https://www.lieferando.at/fixture', description: 'Online bestellen.' },
  { url: 'https://foodora.at/fixture', description: 'Online bestellen.' },
  { title: 'Rabatt via Wolt', description: 'Online bestellen.' },
  { brand: 'Foodora', title: '1+1 Doener', url: 'https://example.invalid/coupon', description: 'Coupon online holen.' },
  { brand: 'WOLT', title: '2 fuer 1 Burger', url: 'https://www.instagram.com/p/fixture/', description: 'Coupon online holen.' },
  { brand: 'Lieferando+', title: '20 EUR Gutschein', url: 'https://example.invalid/coupon', description: 'Gutschein online holen.' },
]) {
  test(`real digital/delivery offer retains exemption despite a contact venue: ${JSON.stringify(overrides)}`, async () => {
    const deal = { ...physical, address, ...overrides };
    assert.equal(onlineOnly(deal), true);
    assert.equal(reviewDealMap(deal, context).status, 'online-only');
    const result = await requireApprovalMap(validation([deal]), { now, lookup: noLookup });
    assert.deepEqual(result.validation.allowedDeals, [deal]);
    assert.equal(result.requests, 0);
    assert.deepEqual(result.map.locations, []);
  });
}

for (const description of ['20 Prozent bei Abholung.', '20 Prozent bei Abholung. Jetzt nur Lieferung, keine Abholung.']) {
  test(`pickup controls survive onsite detection: ${description}`, () => {
    const deal = { ...physical, url: 'https://wolt.com/restaurant/fixture', address, description };
    const deliveryOnly = description.includes('keine Abholung');
    assert.equal(onlineOnly(deal), deliveryOnly);
    assert.equal(inspectDealLocation(deal, context).status, deliveryOnly ? 'online-only' : 'address-ready');
  });
}

for (const brand of ['Foodora', 'Wolt', 'Lieferando']) {
  test(`direct provider ${brand} still permits explicit verified pickup only`, async () => {
    const deal = { ...physical, brand, address, description: '20 Prozent bei Abholung.' };
    assert.equal(onlineOnly(deal), false);
    assert.equal(inspectDealLocation(deal, context).status, 'address-ready');
    const result = await requireApprovalMap(validation([deal]), { now, catalog: { locations: [venue] }, lookup: noLookup });
    assert.equal(result.validation.allowedDeals.length, 1);
    assert.equal(result.requests, 0);
    assert.deepEqual(result.checks[deal.id].locationIds, [venue.id]);
    assert.equal(onlineOnly({ ...deal, description: '20 Prozent bei Abholung. Keine Abholung mehr.' }), true);
  });
}

test('a venue name alone does not convert an online shop or online redemption into onsite use', () => {
  for (const description of ['Online kaufen.', 'Gutschein online einl\u00f6sen.']) {
    const deal = { ...physical, title: '20 Prozent Rabatt', location: 'Online', brand: 'Fixture Club', description };
    assert.equal(onlineOnly(deal), true);
  }
  assert.equal(onlineOnly({ ...passage, title: '20 Prozent Rabatt', description: 'Gutschein online kaufen.' }), true);
  assert.equal(onlineOnly({ ...physical, brand: 'Fixture via Foodora', description: 'Eintritt und Kinotickets online kaufen.' }), false,
    'A provider substring in an unrelated brand is not a delivery-provider identity');
});

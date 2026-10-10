import assert from 'node:assert/strict';
import { after, before, mock, test } from 'node:test';
import {
  candidatesFor, enrichMap, geocode, inspectDealLocation, locationFingerprint,
  onlineOnly, selectExactFeature, verifiedLocation,
} from './deal-map-enrichment.mjs';

// All places and responses below are in-memory fixtures, never live offer evidence.
const NOW = new Date('2026-10-10T12:00:00.000Z');
const TODAY = '2026-10-10';
const MANAGER = 'exact-vienna-address-v1';
const A = { street: 'Braunhubergasse', number: '19', postalCode: '1110' };
const B = { street: 'Wollzeile', number: '29', postalCode: '1010' };
const ADDRESS_A = 'Braunhubergasse 19, 1110 Wien';
const ADDRESS_B = 'Wollzeile 29, 1010 Wien';
const GEO_A = { address: ADDRESS_A, latitude: 48.17024268, longitude: 16.41565621, source: 'fixture:vienna-address-a' };
const GEO_B = { address: ADDRESS_B, latitude: 48.209, longitude: 16.378, source: 'fixture:vienna-address-b' };
const clone = value => structuredClone(value);
const mapOf = (...locations) => ({ schemaVersion: 1, lastUpdated: '2026-10-01T00:00:00.000Z', locations });
const catalogOf = (...locations) => ({ schemaVersion: 2, locations });
const deal = (overrides = {}) => ({
  id: 'fixture-deal', brand: 'Fixture Cafe', title: '20 Prozent Rabatt',
  description: 'Nur am angegebenen Standort.', distance: 'Wien',
  url: 'https://example.invalid/offer', ...overrides,
});
const venue = (overrides = {}) => ({
  id: 'venue-a', name: 'Fixture Cafe Wien', ...GEO_A, confidence: 1, ...overrides,
});
const nordsee = () => [
  venue({ id: 'nordsee-donauzentrum', name: 'NORDSEE Wien Donauzentrum',
    address: 'Wagramer Strasse 94, 1220 Wien', latitude: 48.2421606, longitude: 16.4363892,
    chainId: 'nordsee-vienna-area', officialLocationId: '1427', source: 'fixture:official-nordsee' }),
  venue({ id: 'nordsee-kohlmarkt', name: 'NORDSEE Wien Kohlmarkt',
    address: 'Kohlmarkt 6, 1010 Wien', latitude: 48.209131, longitude: 16.367906,
    chainId: 'nordsee-vienna-area', officialLocationId: '1428', source: 'fixture:official-nordsee' }),
];
const therme = () => venue({ id: 'therme-wien', name: 'Therme Wien',
  address: 'Kurbadstrasse 14, 1100 Wien', latitude: 48.14271741, longitude: 16.40106212 });
const ikea = () => [
  venue({ id: 'ikea-westbahnhof', name: 'IKEA Wien Westbahnhof', address: 'Europaplatz 1, 1150 Wien',
    latitude: 48.1956694, longitude: 16.3376841, chainId: 'ikea-vienna-area', officialLocationId: 'westbahnhof' }),
  venue({ id: 'ikea-wien-nord', name: 'IKEA Wien Nord', address: 'Sverigestra\u00dfe 1, 1220 Wien',
    latitude: 48.2542837, longitude: 16.4713719, chainId: 'ikea-vienna-area', officialLocationId: 'wien-nord' }),
];
const inspect = (offer, options = {}) => inspectDealLocation(offer, { today: TODAY, ...options });

let attemptedFetches = 0;
before(() => {
  mock.method(globalThis, 'fetch', async () => {
    attemptedFetches++;
    throw new Error('External fetch forbidden in map location fixtures');
  });
});
after(() => {
  mock.restoreAll();
  assert.equal(attemptedFetches, 0, 'No test may attempt a real external fetch');
});

async function pipeline(deals, { lookupResult = null, ...options } = {}) {
  const lookupCalls = [];
  const result = await enrichMap({ map: mapOf(), now: NOW, ...options, deals,
    lookup: async address => {
      lookupCalls.push(clone(address));
      return typeof lookupResult === 'function' ? lookupResult(address) : clone(lookupResult);
    },
  });
  return { ...result, lookupCalls };
}

function rowFor(result, id) {
  const rows = result.report.deals.filter(row => row.id === id);
  assert.equal(rows.length, 1, `Exactly one coverage row for ${id}`);
  return rows[0];
}

function mapped(result, id, expectedIds) {
  const locations = result.map.locations.filter(location => location.dealIds.includes(id));
  const row = rowFor(result, id);
  assert.equal(row.status, 'mapped');
  assert.equal(row.needsReview, false);
  assert.equal(row.locationCount, locations.length);
  assert.ok(locations.length > 0);
  if (expectedIds) assert.deepEqual(locations.map(location => location.id).sort(), [...expectedIds].sort());
  return locations;
}

function unmapped(result, id, status) {
  assert.deepEqual(result.map.locations.filter(location => location.dealIds.includes(id)), [], 'No guessed or stale marker');
  const row = rowFor(result, id);
  assert.equal(row.locationCount, 0);
  assert.equal(row.needsReview, status !== 'online-only');
  if (status) assert.equal(row.status, status);
  return row;
}

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

test('named NORDSEE Donauzentrum reuses only that branch, not all chain locations', async () => {
  const offer = deal({ brand: 'NORDSEE', distance: 'NORDSEE Donauzentrum, Wien' });
  const catalog = catalogOf(...nordsee());
  assert.deepEqual(inspect(offer, { catalog }).locationIds, ['nordsee-donauzentrum']);
  const result = await pipeline([offer], { catalog });
  mapped(result, offer.id, ['nordsee-donauzentrum']);
  assert.deepEqual(result.map.locations[0].automaticDealIds, [offer.id]);
  assert.equal(result.requests, 0);
  assert.deepEqual(result.lookupCalls, []);
});

test('NORDSEE Donauzentrum named in the title does not require the redundant city word', async () => {
  const offer = deal({ brand: 'NORDSEE', title: 'NORDSEE Donauzentrum: 20 Prozent Rabatt' });
  const result = await pipeline([offer], { catalog: catalogOf(...nordsee()) });
  mapped(result, offer.id, ['nordsee-donauzentrum']);
  assert.deepEqual(result.lookupCalls, []);
});

test('new all-branches NORDSEE offer must not infer chain coverage from catalog rules', async () => {
  const offer = deal({ brand: 'NORDSEE', distance: 'Alle Filialen in Wien' });
  const locations = nordsee().map(location => ({ ...location, brandMatches: ['NORDSEE'],
    placeMatches: ['Alle Filialen in Wien'], titleMatches: ['Rabatt'], dealIds: ['older-deal'] }));
  const catalog = catalogOf(...locations);
  assert.equal(inspect(offer, { catalog }).status, 'needs-review');
  const result = await pipeline([offer], { catalog });
  unmapped(result, offer.id);
  assert.deepEqual(result.lookupCalls, []);
});

test('all NORDSEE branches with a named example must not collapse to that one branch', async () => {
  const offer = deal({ brand: 'NORDSEE', distance: 'Alle NORDSEE Filialen in Wien, auch NORDSEE Donauzentrum' });
  const result = await pipeline([offer], { catalog: catalogOf(...nordsee()) });
  unmapped(result, offer.id);
  assert.deepEqual(result.lookupCalls, []);
});

test('a named branch edit narrows former explicit all-branches coverage', async () => {
  const offer = deal({ brand: 'NORDSEE', distance: 'Nur NORDSEE Donauzentrum, Wien' });
  const map = mapOf(...nordsee().map(location => ({ ...location, dealIds: [offer.id] })));
  const result = await pipeline([offer], { map });
  mapped(result, offer.id, ['nordsee-donauzentrum']);
  assert.deepEqual(result.lookupCalls, []);
});

for (const [field, text] of [['title', 'BIPA Vorteil: Therme Wien Tageseintritt'], ['location', 'Therme Wien']]) {
  test(`BIPA benefit reuses named Therme Wien from ${field}, not a BIPA store`, async () => {
    const offer = deal({ brand: 'BIPA', [field]: text });
    const catalog = catalogOf(therme(), venue({ id: 'bipa-store', name: 'BIPA Favoriten', brandMatches: ['BIPA'] }));
    assert.deepEqual(inspect(offer, { catalog }).locationIds, ['therme-wien']);
    const result = await pipeline([offer], { catalog });
    mapped(result, offer.id, ['therme-wien']);
    assert.deepEqual(result.lookupCalls, []);
  });
}

test('merchant name alone is not a named venue and does not authorize catalog reuse', async () => {
  const offer = deal({ brand: 'BIPA', title: 'BIPA Vorteil', distance: 'Wien' });
  const result = await pipeline([offer], { catalog: catalogOf(therme(), venue({ name: 'BIPA' })) });
  unmapped(result, offer.id);
  assert.deepEqual(result.lookupCalls, []);
});

test('same venue name at different addresses is ambiguous', async () => {
  const offer = deal({ location: 'Fixture Cafe Wien' });
  const catalog = catalogOf(venue(), venue({ ...GEO_B, id: 'venue-b' }));
  assert.equal(inspect(offer, { catalog }).status, 'needs-review');
  const result = await pipeline([offer], { catalog });
  unmapped(result, offer.id);
  assert.deepEqual(result.lookupCalls, []);
});

for (const binding of ['manual', 'automatic', 'managed']) {
  test(`changed exact address removes stale ${binding} deal ID without losing another live deal`, async () => {
    const edited = deal({ address: ADDRESS_B });
    const keeper = deal({ id: 'keeper', address: ADDRESS_A });
    const old = venue({ dealIds: [edited.id, keeper.id],
      ...(binding === 'automatic' ? { automaticDealIds: [edited.id] } : {}),
      ...(binding === 'managed' ? { managedBy: MANAGER } : {}),
    });
    const map = mapOf(old);
    const catalog = catalogOf(venue({ ...GEO_B, id: 'venue-b' }));
    assert.deepEqual(inspect(edited, { map, catalog }).locationIds, ['venue-b']);
    const result = await pipeline([edited, keeper], { map, catalog });
    mapped(result, edited.id, ['venue-b']);
    mapped(result, keeper.id, [old.id]);
    assert.deepEqual(result.map.locations.find(location => location.id === old.id).dealIds, [keeper.id]);
    assert.deepEqual(result.lookupCalls, []);
  });
}

test('failed geocoding after an address edit never falls back to the former address', async () => {
  const offer = deal({ address: ADDRESS_B });
  const result = await pipeline([offer], { map: mapOf(venue({ dealIds: [offer.id] })) });
  unmapped(result, offer.id, 'geocode-review');
  assert.deepEqual(result.lookupCalls, [B]);
  assert.equal(result.report.mappedDeals, 0);
});

test('editing an automatic named binding into a broad chain offer removes its stale ID', async () => {
  const offer = deal({ brand: 'NORDSEE', distance: 'Alle Filialen in Wien' });
  const old = { ...nordsee()[0], dealIds: [offer.id], automaticDealIds: [offer.id] };
  const result = await pipeline([offer], { map: mapOf(old) });
  unmapped(result, offer.id);
  assert.deepEqual(result.lookupCalls, []);
  assert.equal(result.catalog.locations[0].id, old.id);
});

for (const place of ['Wien', '1010 Wien', 'Wien Zentrum', 'Stephansplatz, Wien', 'Braunhubergasse, 1110 Wien']) {
  test(`no city-center fallback or partial-address geocoding for ${JSON.stringify(place)}`, async () => {
    const offer = deal({ distance: place });
    assert.deepEqual(inspect(offer).addresses, []);
    const result = await pipeline([offer], { lookupResult: GEO_A });
    unmapped(result, offer.id, 'missing-exact-address');
    assert.deepEqual(result.lookupCalls, []);
    assert.equal(result.requests, 0);
  });
}

for (const field of ['address', 'location', 'distance']) {
  test(`exact ${field} without Vienna or postcode context requires Vienna address review`, async () => {
    const offer = deal({ distance: '', [field]: 'Braunhubergasse 19' });
    const assessment = inspect(offer);
    assert.equal(assessment.status, 'needs-review');
    assert.equal(assessment.reason, 'vienna-address-needs-review');
    assert.deepEqual(assessment.addresses, []);
    const result = await pipeline([offer], { lookupResult: GEO_A });
    unmapped(result, offer.id, 'vienna-address-needs-review');
    assert.deepEqual(result.lookupCalls, []);
  });
}

for (const field of ['address', 'description', 'metaGraphCaption', 'viennaEvidence']) {
  test(`Wien context cannot override explicit conflicting 8010 Graz in ${field}`, async () => {
    const offer = deal({ distance: 'Wien', [field]: field === 'viennaEvidence'
      ? { verified: true, detail: 'Hauptstrasse 1, 8010 Graz' } : 'Hauptstrasse 1, 8010 Graz' });
    const result = await pipeline([offer], { lookupResult: { ...GEO_A, address: 'Hauptstrasse 1, 1140 Wien' } });
    unmapped(result, offer.id);
    assert.deepEqual(result.lookupCalls, [], 'An explicitly non-Vienna address is not a Vienna lookup candidate');
    assert.equal(inspect(offer).status, 'needs-review');
    assert.deepEqual(inspect(offer).addresses, []);
  });
}

test('German offer expiry text is not mistaken for a foreign postcode beside an exact Vienna address', async () => {
  const offer = deal({ address: ADDRESS_A, description: 'G\u00fcltig bis 31.12.2026 in Wien' });
  const candidates = candidatesFor(offer, {}, TODAY);
  assert.equal(candidates.reason, '');
  assert.deepEqual(candidates.addresses, [A]);
  assert.equal(inspect(offer).status, 'address-ready');
  const result = await pipeline([offer], { lookupResult: GEO_A });
  assert.equal(mapped(result, offer.id)[0].address, ADDRESS_A);
  assert.equal(result.report.unresolvedDeals, 0);
  assert.deepEqual(result.lookupCalls, [A]);
});

for (const context of ['Wien', '1110']) {
  test(`exact address with ${context} context remains a physical candidate`, async () => {
    const offer = deal({ address: 'Braunhubergasse 19', distance: context });
    assert.equal(inspect(offer).status, 'address-ready');
    const result = await pipeline([offer], { lookupResult: GEO_A });
    assert.equal(mapped(result, offer.id)[0].address, ADDRESS_A);
    assert.deepEqual(result.lookupCalls, [{ ...A, postalCode: '' }]);
  });
}

test('lowercase exact Vienna address is geocoded without changing its street, number, or postcode', async () => {
  const offer = deal({ address: ADDRESS_A.toLowerCase(), distance: 'wien' });
  assert.equal(inspect(offer).status, 'address-ready');
  const result = await pipeline([offer], { lookupResult: GEO_A });
  const [location] = mapped(result, offer.id);
  assert.equal(location.address, ADDRESS_A);
  assert.equal(location.latitude, GEO_A.latitude);
  assert.equal(location.longitude, GEO_A.longitude);
  assert.equal(result.lookupCalls.length, 1);
  assert.equal(result.lookupCalls[0].street.toLowerCase(), A.street.toLowerCase());
  assert.equal(result.lookupCalls[0].number, A.number);
  assert.equal(result.lookupCalls[0].postalCode, A.postalCode);
});

for (const source of ['lookup', 'catalog']) {
  test(`Loving Hut Neubau 38/5 reuses verified building 38 coordinates from ${source}`, async () => {
    const offer = deal({ brand: 'Loving Hut Neubau, Neubaug\u00fcrtel 38/5', distance: '1070 Wien' });
    const building = venue({ id: 'loving-hut-neubau', name: 'Loving Hut Neubau',
      address: 'Neubaug\u00fcrtel 38, 1070 Wien', latitude: 48.20025, longitude: 16.33824 });
    const result = await pipeline([offer], source === 'catalog'
      ? { catalog: catalogOf(building) } : { lookupResult: building });
    const [location] = mapped(result, offer.id, source === 'catalog' ? [building.id] : undefined);
    assert.equal(location.address, building.address);
    assert.equal(location.latitude, building.latitude);
    assert.equal(location.longitude, building.longitude);
    assert.deepEqual(result.lookupCalls, source === 'catalog' ? []
      : [{ street: 'Neubaug\u00fcrtel', number: '38/5', postalCode: '' }]);
    const second = await pipeline([offer], { map: result.map, catalog: result.catalog, cache: result.cache });
    assert.deepEqual(second.map, result.map);
    assert.deepEqual(second.lookupCalls, []);
  });
}

test('unverified Vienna evidence cannot supply a missing exact address', async () => {
  const offer = deal({ viennaEvidence: { verified: false, detail: ADDRESS_A } });
  const result = await pipeline([offer], { lookupResult: GEO_A });
  unmapped(result, offer.id);
  assert.deepEqual(result.lookupCalls, []);
});

for (const url of ['https://wolt.com/offer', 'https://www.lieferando.at/offer', 'https://foodora.at/offer']) {
  test(`delivery-only ${new URL(url).hostname} offer has no marker even with an existing exact-address link`, async () => {
    const offer = deal({ url, address: ADDRESS_A, description: 'Nur Lieferung. Keine Abholung.' });
    assert.equal(onlineOnly(offer), true);
    assert.equal(inspect(offer).channel, 'online');
    const result = await pipeline([offer], { map: mapOf(venue({ dealIds: [offer.id] })), lookupResult: GEO_A });
    unmapped(result, offer.id, 'online-only');
    assert.equal(result.report.onlineDeals, 1);
    assert.equal(result.report.unresolvedDeals, 0);
    assert.deepEqual(result.lookupCalls, []);
  });
}

test('an explicit online-only offer is not made physical by a merchant contact address', async () => {
  const offer = deal({ address: ADDRESS_A, title: 'Nur online im Webshop', description: 'Nur Versand. Keine Abholung.' });
  assert.equal(onlineOnly(offer), true);
  const result = await pipeline([offer], { lookupResult: GEO_A });
  unmapped(result, offer.id, 'online-only');
  assert.deepEqual(result.lookupCalls, []);
});

test('verified exact pickup address permits a delivery-provider offer on the map', async () => {
  const offer = deal({ url: 'https://wolt.com/offer', address: ADDRESS_A, description: '20 Prozent bei Abholung.' });
  assert.equal(onlineOnly(offer), false);
  assert.equal(inspect(offer).status, 'address-ready');
  const result = await pipeline([offer], { lookupResult: GEO_A });
  assert.equal(mapped(result, offer.id)[0].address, ADDRESS_A);
  assert.deepEqual(result.lookupCalls, [A]);
});

test('pickup wording without an exact or verified named venue cannot create a point', async () => {
  const offer = deal({ url: 'https://wolt.com/offer', description: '20 Prozent bei Abholung.' });
  const result = await pipeline([offer], { lookupResult: GEO_A });
  unmapped(result, offer.id);
  assert.deepEqual(result.lookupCalls, []);
});

test('negated pickup overrides a positive pickup phrase', async () => {
  const offer = deal({ url: 'https://foodora.at/offer', address: ADDRESS_A,
    description: 'Frueher bei Abholung. Jetzt nur Lieferung, keine Abholung.' });
  const result = await pipeline([offer], { lookupResult: GEO_A });
  unmapped(result, offer.id, 'online-only');
  assert.deepEqual(result.lookupCalls, []);
});

for (const field of ['description', 'metaGraphCaption', 'viennaEvidence']) {
  test(`conflicting branch addresses in ${field} require review, even with a former manual link`, async () => {
    const offer = deal({ address: ADDRESS_A, [field]: field === 'viennaEvidence'
      ? { verified: true, detail: ADDRESS_B } : `Andere Bedingungen: ${ADDRESS_B}` });
    assert.equal(candidatesFor(offer, {}, TODAY).reason, 'multiple-branches-need-review');
    const result = await pipeline([offer], { map: mapOf(venue({ dealIds: [offer.id] })), lookupResult: GEO_A });
    unmapped(result, offer.id, 'multiple-branches-need-review');
    assert.deepEqual(result.lookupCalls, []);
  });
}

test('reviewed branch dates select only the current branch, inclusively at both boundaries', async () => {
  const offer = deal({ description: `${ADDRESS_A}; ${ADDRESS_B}` });
  const reviewed = { [offer.id]: { evidenceUrl: 'https://example.invalid/branch-terms', locations: [
    { ...A, validFrom: TODAY, validUntil: TODAY },
    { ...B, validUntil: '2026-10-09' },
    { ...B, validFrom: '2026-10-11' },
  ] } };
  assert.deepEqual(candidatesFor(offer, reviewed, TODAY).addresses, [reviewed[offer.id].locations[0]]);
  const result = await pipeline([offer], { reviewed, lookupResult: GEO_A });
  const [location] = mapped(result, offer.id);
  assert.equal(location.validFrom, TODAY);
  assert.equal(location.validUntil, TODAY);
  assert.equal(location.evidenceUrl, reviewed[offer.id].evidenceUrl);
  assert.deepEqual(result.lookupCalls, [reviewed[offer.id].locations[0]]);
});

test('all reviewed branches expired or future removes old coverage without fallback', async () => {
  const offer = deal({ address: ADDRESS_A });
  const reviewed = { [offer.id]: { locations: [{ ...A, validUntil: '2026-10-09' }, { ...B, validFrom: '2026-10-11' }] } };
  const result = await pipeline([offer], { reviewed, map: mapOf(venue({ dealIds: [offer.id] })), lookupResult: GEO_A });
  unmapped(result, offer.id, 'no-current-reviewed-branch');
  assert.deepEqual(result.lookupCalls, []);
});

for (const [state, validity] of [
  ['expired', { validFrom: '2026-10-01', validUntil: '2026-10-09' }],
  ['future', { validFrom: '2026-10-11', validUntil: '2026-10-12' }],
]) {
  for (const binding of ['manual', 'automatic', 'managed']) {
    test(`last ${state} ${binding} registry binding creates a durable exclusion, never an undated replacement`, async () => {
      const offer = freeze(deal({ address: ADDRESS_A }));
      const location = venue({ ...validity, dealIds: [offer.id],
        ...(binding === 'automatic' ? { automaticDealIds: [offer.id] } : {}),
        ...(binding === 'managed' ? { managedBy: MANAGER } : {}),
      });
      const map = freeze(mapOf(location));
      const assessment = inspect(offer, { map });
      assert.equal(assessment.status, 'needs-review');
      assert.equal(assessment.reason, 'inactive-registry-branch');
      assert.deepEqual(assessment.addresses, []);
      assert.deepEqual(assessment.locationIds, []);
      const exclusion = { dealId: offer.id, fingerprint: locationFingerprint(offer),
        reason: 'inactive-registry-branch', locationIds: [location.id] };
      const first = await pipeline([offer], { map, lookupResult: GEO_A });
      unmapped(first, offer.id, 'inactive-registry-branch');
      assert.deepEqual(first.map.locations, []);
      assert.deepEqual(first.map.geocodingExclusions, [exclusion]);
      assert.equal(first.catalog.locations.length, 1);
      assert.equal(first.catalog.locations[0].id, location.id);
      assert.equal(first.catalog.locations[0].validFrom, validity.validFrom);
      assert.equal(first.catalog.locations[0].validUntil, validity.validUntil);
      assert.equal(first.catalog.locations[0].dealIds, undefined);
      assert.equal(first.report.totalDeals, 1, 'An excluded deal must remain in the feed and report');
      assert.equal(first.report.mappedDeals, 0);
      assert.equal(first.report.unresolvedDeals, 1);
      assert.equal(first.requests, 0);
      assert.deepEqual(first.lookupCalls, []);

      const persisted = freeze(JSON.parse(JSON.stringify({ map: first.map, catalog: first.catalog })));
      const second = await pipeline([offer], { ...persisted, lookupResult: GEO_A,
        now: new Date('2026-10-10T13:00:00.000Z') });
      unmapped(second, offer.id, 'inactive-registry-branch');
      assert.deepEqual(second.map.geocodingExclusions, [exclusion]);
      assert.equal(JSON.stringify(second.map), JSON.stringify(first.map));
      assert.deepEqual(second.catalog, first.catalog);
      assert.equal(second.requests, 0);
      assert.deepEqual(second.lookupCalls, [], 'Persisted exclusion must prevent undated geocoding on the next pass');
    });
  }
}

test('future catalog binding reactivates at Vienna midnight and clears its persisted exclusion', async () => {
  const offer = freeze(deal({ address: ADDRESS_A }));
  const location = venue({ id: 'future-reviewed-venue', validFrom: '2026-10-11', validUntil: '2026-10-12' });
  const exclusion = { dealId: offer.id, fingerprint: locationFingerprint(offer),
    reason: 'inactive-registry-branch', locationIds: [location.id] };
  const map = freeze({ ...mapOf(), geocodingExclusions: [exclusion] });
  const catalog = freeze(catalogOf(location));
  const before = await pipeline([offer], { map, catalog, now: new Date('2026-10-10T21:59:59.000Z'), lookupResult: GEO_A });
  unmapped(before, offer.id, 'inactive-registry-branch');
  assert.deepEqual(before.map.geocodingExclusions, [exclusion]);
  assert.deepEqual(before.lookupCalls, []);

  const opened = await pipeline([offer], { map: before.map, catalog: before.catalog,
    now: new Date('2026-10-10T22:00:00.000Z'), lookupResult: GEO_A });
  const [reactivated] = mapped(opened, offer.id, [location.id]);
  assert.equal(reactivated.validFrom, location.validFrom);
  assert.equal(reactivated.validUntil, location.validUntil);
  assert.equal(reactivated.address, location.address);
  assert.deepEqual(reactivated.dealIds, [offer.id]);
  assert.deepEqual(opened.map.geocodingExclusions || [], []);
  assert.equal(opened.report.unresolvedDeals, 0);
  assert.equal(opened.requests, 0);
  assert.deepEqual(opened.lookupCalls, []);
  const repeated = await pipeline([offer], { map: opened.map, catalog: opened.catalog,
    now: new Date('2026-10-11T12:00:00.000Z') });
  mapped(repeated, offer.id, [location.id]);
  assert.equal(JSON.stringify(repeated.map), JSON.stringify(opened.map));
  assert.deepEqual(repeated.map.geocodingExclusions || [], []);
  assert.deepEqual(repeated.lookupCalls, []);
});

test('registry-only broad Vienna deal hands off from dated A to future B and remains excluded after B expires', async () => {
  const offer = freeze(deal({ distance: 'Wien' }));
  const branchA = venue({ id: 'dated-branch-a', dealIds: [offer.id], validFrom: '2026-10-01', validUntil: TODAY });
  const branchB = venue({ ...GEO_B, id: 'dated-branch-b', dealIds: [offer.id], validFrom: '2026-10-11', validUntil: '2026-10-12' });
  let persisted = freeze({ map: mapOf(branchA, branchB), catalog: catalogOf() });
  const binding = { dealId: offer.id, fingerprint: locationFingerprint(offer), locationIds: [branchA.id, branchB.id] };
  let previous;
  for (const [day, expectedBranch] of [[TODAY, branchA], ['2026-10-11', branchB], ['2026-10-12', branchB]]) {
    const result = await pipeline([offer], { ...persisted, now: new Date(`${day}T12:00:00.000Z`), lookupResult: GEO_A });
    const [active] = mapped(result, offer.id, [expectedBranch.id]);
    assert.equal(result.map.locations.length, 1);
    assert.equal(active.address, expectedBranch.address);
    assert.equal(active.validFrom, expectedBranch.validFrom);
    assert.equal(active.validUntil, expectedBranch.validUntil);
    assert.deepEqual(active.dealIds, [offer.id]);
    assert.deepEqual(result.map.geocodingExclusions || [], []);
    assert.equal(result.map.dealBindings, undefined, 'Historical deal bindings belong only in the internal catalog');
    assert.deepEqual(result.catalog.dealBindings, [binding], 'Both registry IDs must survive pruning the inactive map row');
    assert.deepEqual(result.catalog.locations.map(location => location.id).sort(), [branchA.id, branchB.id].sort());
    assert.equal(result.requests, 0);
    assert.deepEqual(result.lookupCalls, []);
    if (day === '2026-10-12') assert.equal(JSON.stringify(result.map), JSON.stringify(previous.map));
    previous = result;
    persisted = freeze(JSON.parse(JSON.stringify({ map: result.map, catalog: result.catalog })));
  }

  const expired = await pipeline([offer], { ...persisted, now: new Date('2026-10-13T12:00:00.000Z'), lookupResult: GEO_A });
  unmapped(expired, offer.id, 'inactive-registry-branch');
  assert.deepEqual(expired.map.locations, []);
  assert.deepEqual(expired.map.geocodingExclusions, [{ ...binding, reason: 'inactive-registry-branch' }]);
  assert.equal(expired.map.dealBindings, undefined);
  assert.deepEqual(expired.catalog.dealBindings, [binding]);
  assert.equal(expired.report.totalDeals, 1);
  assert.equal(expired.requests, 0);
  assert.deepEqual(expired.lookupCalls, []);
  const repeated = await pipeline([offer], { map: expired.map, catalog: expired.catalog,
    now: new Date('2026-10-14T12:00:00.000Z'), lookupResult: GEO_A });
  unmapped(repeated, offer.id, 'inactive-registry-branch');
  assert.equal(JSON.stringify(repeated.map), JSON.stringify(expired.map));
  assert.deepEqual(repeated.catalog, expired.catalog);
  assert.deepEqual(repeated.lookupCalls, []);
});

test('approved undated A survives before, during, and after dated sibling B through persisted catalog bindings', async () => {
  const offer = freeze(deal({ distance: 'Wien' }));
  const branchA = venue({ id: 'undated-sibling-a', dealIds: [offer.id] });
  const branchB = venue({ ...GEO_B, id: 'dated-sibling-b', dealIds: [offer.id],
    validFrom: '2026-10-11', validUntil: '2026-10-12' });
  let persisted = freeze({ map: mapOf(branchA, branchB), catalog: catalogOf() });
  let previous;
  for (const day of [TODAY, '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14']) {
    const bIsCurrent = day >= branchB.validFrom && day <= branchB.validUntil;
    const result = await pipeline([offer], { ...persisted, now: new Date(`${day}T12:00:00.000Z`), lookupResult: GEO_A });
    mapped(result, offer.id, bIsCurrent ? [branchA.id, branchB.id] : [branchA.id]);
    assert.equal(result.map.locations.length, bIsCurrent ? 2 : 1);
    const activeA = result.map.locations.find(location => location.id === branchA.id);
    assert.ok(activeA, `Undated approved A must remain mapped on ${day}`);
    assert.equal(activeA.address, branchA.address);
    assert.equal(activeA.latitude, branchA.latitude);
    assert.equal(activeA.longitude, branchA.longitude);
    assert.equal(activeA.validFrom, undefined, 'A must not inherit the start of B');
    assert.equal(activeA.validUntil, undefined, 'A must not inherit the expiry of B');
    assert.deepEqual(activeA.dealIds, [offer.id]);
    const activeB = result.map.locations.find(location => location.id === branchB.id);
    if (bIsCurrent) {
      assert.equal(activeB.address, branchB.address);
      assert.equal(activeB.validFrom, branchB.validFrom);
      assert.equal(activeB.validUntil, branchB.validUntil);
      assert.deepEqual(activeB.dealIds, [offer.id]);
    } else assert.equal(activeB, undefined);
    assert.deepEqual(result.map.geocodingExclusions || [], [], 'Inactive B must not exclude the deal while undated A remains approved');
    assert.equal(result.map.dealBindings, undefined);
    assert.equal(result.catalog.dealBindings.length, 1);
    assert.equal(result.catalog.dealBindings[0].dealId, offer.id);
    assert.equal(result.catalog.dealBindings[0].fingerprint, locationFingerprint(offer));
    assert.deepEqual([...result.catalog.dealBindings[0].locationIds].sort(), [branchA.id, branchB.id].sort());
    assert.deepEqual(result.catalog.locations.map(location => location.id).sort(), [branchA.id, branchB.id].sort());
    assert.equal(result.report.mappedDeals, 1);
    assert.equal(result.report.unresolvedDeals, 0);
    assert.equal(result.requests, 0);
    assert.deepEqual(result.lookupCalls, []);
    if (day === '2026-10-12' || day === '2026-10-14') {
      assert.equal(JSON.stringify(result.map), JSON.stringify(previous.map));
      assert.deepEqual(result.catalog, previous.catalog);
    }
    previous = result;
    persisted = freeze(JSON.parse(JSON.stringify({ map: result.map, catalog: result.catalog })));
  }
});

for (const edit of ['broad-text', 'exact-address']) {
  test(`${edit} fingerprint edit cannot reapply old registry-only catalog deal bindings`, async () => {
    const original = freeze(deal({ distance: 'Wien' }));
    const branchA = venue({ id: 'original-branch-a', dealIds: [original.id], validFrom: '2026-10-01', validUntil: TODAY });
    const branchB = venue({ ...GEO_B, id: 'original-branch-b', dealIds: [original.id], validFrom: '2026-10-11', validUntil: '2026-10-12' });
    const first = await pipeline([original], { map: mapOf(branchA, branchB) });
    mapped(first, original.id, [branchA.id]);
    assert.deepEqual(first.catalog.dealBindings, [{ dealId: original.id,
      fingerprint: locationFingerprint(original), locationIds: [branchA.id, branchB.id] }]);
    const freshAddress = { street: 'Dresdnerstrasse', number: '115', postalCode: '1200' };
    const freshGeocode = { address: 'Dresdnerstrasse 115, 1200 Wien', latitude: 48.236, longitude: 16.388,
      source: 'fixture:new-address-after-edit' };
    const edited = freeze({ ...original, ...(edit === 'exact-address'
      ? { address: freshGeocode.address } : { description: 'Neue Aktion, Standort noch nicht bestaetigt.' }) });
    assert.notEqual(locationFingerprint(edited), locationFingerprint(original));
    let persisted = freeze(JSON.parse(JSON.stringify({ map: first.map, catalog: first.catalog })));
    let freshId;
    for (const day of ['2026-10-11', '2026-10-12']) {
      const result = await pipeline([edited], { ...persisted, now: new Date(`${day}T12:00:00.000Z`), lookupResult: freshGeocode });
      assert.deepEqual(result.map.locations.filter(location => [branchA.id, branchB.id].includes(location.id)), []);
      assert.deepEqual(result.map.geocodingExclusions || [], [], 'The old fingerprint must not suppress a changed deal either');
      assert.deepEqual(result.catalog.dealBindings || [], [], 'Old dated bindings must not be relabeled with the new fingerprint');
      if (edit === 'exact-address') {
        const [location] = mapped(result, edited.id, freshId ? [freshId] : undefined);
        freshId = location.id;
        assert.equal(location.address, freshGeocode.address);
        assert.equal(location.validFrom, undefined);
        assert.equal(location.validUntil, undefined);
        assert.deepEqual(result.lookupCalls, day === '2026-10-11' ? [freshAddress] : []);
      } else {
        unmapped(result, edited.id, 'missing-exact-address');
        assert.deepEqual(result.lookupCalls, []);
      }
      persisted = freeze(JSON.parse(JSON.stringify({ map: result.map, catalog: result.catalog })));
    }
  });
}

test('changed address fingerprint invalidates a historical exclusion and permits fresh exact geocoding', async () => {
  const previous = freeze(deal({ address: ADDRESS_A }));
  const edited = freeze({ ...previous, address: ADDRESS_B });
  assert.notEqual(locationFingerprint(edited), locationFingerprint(previous));
  const location = venue({ validUntil: '2026-10-09' });
  const map = freeze({ ...mapOf(), geocodingExclusions: [{ dealId: previous.id,
    fingerprint: locationFingerprint(previous), reason: 'inactive-registry-branch', locationIds: [location.id] }] });
  const catalog = freeze(catalogOf(location));
  assert.equal(inspect(edited, { map, catalog }).status, 'address-ready');
  const result = await pipeline([edited], { map, catalog, lookupResult: GEO_B });
  const [fresh] = mapped(result, edited.id);
  assert.notEqual(fresh.id, location.id);
  assert.equal(fresh.address, ADDRESS_B);
  assert.equal(fresh.latitude, GEO_B.latitude);
  assert.equal(fresh.longitude, GEO_B.longitude);
  assert.equal(fresh.validFrom, undefined);
  assert.equal(fresh.validUntil, undefined);
  assert.deepEqual(result.map.geocodingExclusions || [], []);
  assert.deepEqual(result.lookupCalls, [B]);
  assert.equal(result.requests, 1);
  const second = await pipeline([edited], { map: result.map, catalog: result.catalog, cache: result.cache });
  mapped(second, edited.id, [fresh.id]);
  assert.equal(JSON.stringify(second.map), JSON.stringify(result.map));
  assert.deepEqual(second.lookupCalls, []);
});

for (const reason of ['inactive-registry-branch', 'no-current-reviewed-branch']) {
  test(`online classification wins over a matching ${reason} exclusion and reopenable catalog venue`, async () => {
    const offer = freeze(deal({ address: ADDRESS_A, url: 'https://wolt.com/offer', description: 'Nur Lieferung. Keine Abholung.' }));
    const location = venue({ validFrom: '2026-10-01', validUntil: '2026-10-12' });
    const map = freeze({ ...mapOf(), geocodingExclusions: [{ dealId: offer.id,
      fingerprint: locationFingerprint(offer), reason, locationIds: [location.id] }] });
    const catalog = freeze(catalogOf(location));
    const reviewed = reason === 'no-current-reviewed-branch'
      ? freeze({ [offer.id]: { locations: [{ ...A, validUntil: '2026-10-09' }] } }) : {};
    const assessment = inspect(offer, { map, catalog, reviewed });
    assert.equal(assessment.status, 'online-only');
    assert.equal(assessment.channel, 'online');
    assert.deepEqual(assessment.addresses, []);
    assert.deepEqual(assessment.locationIds, []);
    const result = await pipeline([offer], { map, catalog, reviewed, lookupResult: GEO_A });
    unmapped(result, offer.id, 'online-only');
    assert.deepEqual(result.map.locations, []);
    assert.deepEqual(result.map.geocodingExclusions || [], []);
    assert.equal(result.report.onlineDeals, 1);
    assert.equal(result.report.unresolvedDeals, 0);
    assert.equal(result.requests, 0);
    assert.deepEqual(result.lookupCalls, []);
  });
}

test('expired manually reviewed branch creates an exclusion even without a former registry location', async () => {
  const offer = freeze(deal({ address: ADDRESS_A }));
  const reviewed = freeze({ [offer.id]: { locations: [{ ...A, validUntil: '2026-10-09' }] } });
  const exclusion = { dealId: offer.id, fingerprint: locationFingerprint(offer),
    reason: 'no-current-reviewed-branch', locationIds: [] };
  const first = await pipeline([offer], { reviewed, lookupResult: GEO_A });
  unmapped(first, offer.id, 'no-current-reviewed-branch');
  assert.deepEqual(first.map.locations, []);
  assert.deepEqual(first.map.geocodingExclusions, [exclusion]);
  assert.equal(first.report.totalDeals, 1);
  assert.equal(first.requests, 0);
  assert.deepEqual(first.lookupCalls, []);
  const persisted = freeze(JSON.parse(JSON.stringify({ map: first.map, catalog: first.catalog })));
  const repeated = await pipeline([offer], { ...persisted, reviewed, lookupResult: GEO_A });
  unmapped(repeated, offer.id, 'no-current-reviewed-branch');
  assert.deepEqual(repeated.map.geocodingExclusions, [exclusion]);
  assert.equal(JSON.stringify(repeated.map), JSON.stringify(first.map));
  assert.deepEqual(repeated.lookupCalls, []);

  const withoutReviewFile = await pipeline([offer], { ...persisted, lookupResult: GEO_A });
  unmapped(withoutReviewFile, offer.id);
  assert.equal(withoutReviewFile.map.geocodingExclusions.length, 1);
  assert.equal(withoutReviewFile.map.geocodingExclusions[0].dealId, offer.id);
  assert.equal(withoutReviewFile.map.geocodingExclusions[0].fingerprint, locationFingerprint(offer));
  assert.deepEqual(withoutReviewFile.map.geocodingExclusions[0].locationIds, []);
  assert.equal(withoutReviewFile.requests, 0);
  assert.deepEqual(withoutReviewFile.lookupCalls, [], 'Missing review input must not erase a persisted exclusion');
});

test('branch date rollover uses Vienna date, not the previous UTC day', async () => {
  const offer = deal();
  const reviewed = { [offer.id]: { locations: [{ ...A, validUntil: TODAY }, { ...B, validFrom: '2026-10-11' }] } };
  const result = await pipeline([offer], { reviewed, now: new Date('2026-10-10T22:30:00.000Z'), lookupResult: GEO_B });
  assert.equal(mapped(result, offer.id)[0].address, ADDRESS_B);
  assert.deepEqual(result.lookupCalls, [reviewed[offer.id].locations[1]]);
});

test('same-address deals with different branch windows keep two stable rows and expiring A leaves B intact', async () => {
  const offers = freeze([deal({ id: 'window-a', address: ADDRESS_A }), deal({ id: 'window-b', address: ADDRESS_A })]);
  const windowA = { ...A, validFrom: '2026-10-09', validUntil: TODAY };
  const windowB = { ...A, validFrom: TODAY, validUntil: '2026-10-12' };
  const reviewed = freeze({
    'window-a': { locations: [windowA] },
    'window-b': { locations: [windowB] },
  });
  const first = await pipeline(offers, { reviewed, lookupResult: GEO_A });
  assert.equal(first.map.locations.length, 2, 'Different validity windows must not be merged into one map row');
  assert.equal(first.catalog.locations.length, 2);
  const [locationA] = mapped(first, 'window-a');
  const [locationB] = mapped(first, 'window-b');
  assert.notEqual(locationA.id, locationB.id, 'Location identity must distinguish branch validity windows');
  for (const [location, id, window] of [[locationA, 'window-a', windowA], [locationB, 'window-b', windowB]]) {
    assert.equal(location.address, ADDRESS_A);
    assert.equal(location.latitude, GEO_A.latitude);
    assert.equal(location.longitude, GEO_A.longitude);
    assert.equal(location.validFrom, window.validFrom);
    assert.equal(location.validUntil, window.validUntil);
    assert.deepEqual(location.dealIds, [id]);
    assert.deepEqual(location.automaticDealIds, [id]);
  }
  assert.deepEqual(first.lookupCalls, [windowA], 'Coordinates may be reused even when validity windows cannot');
  const second = await pipeline(offers, { reviewed, map: first.map, catalog: first.catalog, cache: first.cache,
    now: new Date('2026-10-10T13:00:00.000Z') });
  assert.equal(JSON.stringify(second.map), JSON.stringify(first.map));
  assert.deepEqual(second.catalog, first.catalog);
  assert.equal(second.requests, 0);
  assert.deepEqual(second.lookupCalls, []);

  const tomorrow = new Date('2026-10-11T12:00:00.000Z');
  const nextDay = await pipeline(offers, { reviewed, map: second.map, catalog: second.catalog, cache: second.cache, now: tomorrow });
  unmapped(nextDay, 'window-a', 'no-current-reviewed-branch');
  mapped(nextDay, 'window-b', [locationB.id]);
  assert.deepEqual(nextDay.map.locations, [locationB], 'Expiring A must not remove, redate, or recreate B');
  assert.equal(nextDay.report.totalDeals, 2);
  assert.equal(nextDay.report.mappedDeals, 1);
  assert.equal(nextDay.report.unresolvedDeals, 1);
  assert.equal(nextDay.requests, 0);
  assert.deepEqual(nextDay.lookupCalls, []);
  const repeated = await pipeline(offers, { reviewed, map: nextDay.map, catalog: nextDay.catalog, cache: nextDay.cache, now: tomorrow });
  assert.equal(JSON.stringify(repeated.map), JSON.stringify(nextDay.map));
  assert.deepEqual(repeated.catalog, nextDay.catalog);
  assert.deepEqual(repeated.lookupCalls, []);
});

test('reviewed partial success is reported as partial, never silently as complete coverage', async () => {
  const offer = deal();
  const reviewed = { [offer.id]: { locations: [A, B] } };
  const result = await pipeline([offer], { reviewed, lookupResult: address => address.street === A.street ? GEO_A : null });
  const row = rowFor(result, offer.id);
  assert.equal(row.status, 'partially-mapped');
  assert.equal(row.needsReview, true);
  assert.equal(row.locationCount, 1);
  assert.deepEqual(row.failures, ['no-exact-coordinate-match']);
  assert.equal(result.map.locations.length, 1);
});

test('catalog exact-address reuse shares one marker across new deals and strips broad rules', async () => {
  const offers = [deal({ id: 'first', address: ADDRESS_A }), deal({ id: 'second', address: ADDRESS_A })];
  const catalog = catalogOf(venue({ dealIds: ['gone'], automaticDealIds: ['gone'],
    brandMatches: ['Fixture Cafe'], titleMatches: ['Rabatt'], placeMatches: ['Wien'] }));
  const result = await pipeline(offers, { catalog });
  for (const offer of offers) mapped(result, offer.id, ['venue-a']);
  assert.equal(result.map.locations.length, 1);
  assert.deepEqual(result.map.locations[0].automaticDealIds, ['first', 'second']);
  for (const key of ['brandMatches', 'titleMatches', 'placeMatches']) assert.equal(result.map.locations[0][key], undefined);
  for (const key of ['dealIds', 'automaticDealIds', 'brandMatches', 'titleMatches', 'placeMatches']) {
    assert.equal(result.catalog.locations[0][key], undefined);
  }
  assert.equal(result.report.mappedDeals, 2);
  assert.deepEqual(result.lookupCalls, []);
});

test('map and catalog copies of the same ID never create duplicate markers', async () => {
  const offer = deal({ address: ADDRESS_A });
  const location = venue({ dealIds: [offer.id] });
  const result = await pipeline([offer], { map: mapOf(location), catalog: catalogOf(clone(location)) });
  mapped(result, offer.id, [location.id]);
  assert.equal(result.map.locations.length, 1);
  assert.equal(result.catalog.locations.length, 1);
  assert.deepEqual(result.lookupCalls, []);
});

test('two new deals at the same verified address create one marker on the first pass', async () => {
  const offers = [deal({ id: 'first', address: ADDRESS_A }), deal({ id: 'second', address: ADDRESS_A })];
  const result = await pipeline(offers, { lookupResult: GEO_A });
  assert.equal(result.map.locations.length, 1, 'Venue identity must not depend on the first deal ID');
  assert.deepEqual(result.map.locations[0].dealIds, ['first', 'second']);
  assert.equal(result.catalog.locations.length, 1);
  assert.deepEqual(result.lookupCalls, [A]);
});

test('an archived venue is reused for a replacement deal without resurrecting the old deal ID', async () => {
  const firstDeal = deal({ id: 'old-offer', address: ADDRESS_A });
  const first = await pipeline([firstDeal], { lookupResult: GEO_A });
  const empty = await pipeline([], { map: first.map, catalog: first.catalog, cache: first.cache });
  assert.deepEqual(empty.map.locations, []);
  assert.equal(empty.catalog.locations.length, 1);
  const replacement = deal({ id: 'replacement', address: ADDRESS_A });
  const result = await pipeline([replacement], { map: empty.map, catalog: empty.catalog });
  mapped(result, replacement.id, [first.map.locations[0].id]);
  assert.deepEqual(result.map.locations[0].dealIds, [replacement.id]);
  assert.deepEqual(result.lookupCalls, []);
});

test('manual existing all-branches chain coverage and official metadata are preserved', async () => {
  const offer = deal({ brand: 'NORDSEE', distance: 'Alle Filialen in Wien' });
  const locations = nordsee().map(location => ({ ...location, dealIds: [offer.id] }));
  const map = mapOf(...locations);
  assert.equal(inspect(offer, { map }).reason, 'existing-registry');
  const result = await pipeline([offer], { map });
  mapped(result, offer.id, locations.map(location => location.id));
  assert.deepEqual(result.map, map);
  for (const location of result.map.locations) assert.equal(location.automaticDealIds, undefined);
  assert.equal(result.report.mappedDeals, 1);
  assert.deepEqual(result.lookupCalls, []);
});

test('IKEA two approved manual branches preserve coverage when both mentioned addresses are known', async () => {
  const offer = deal({ brand: 'IKEA', distance: 'IKEA Wien Westbahnhof und IKEA Wien Nord',
    description: 'Europaplatz 1, 1150 Wien; Sverigestra\u00dfe 1, 1220 Wien' });
  const map = mapOf(...ikea().map(location => ({ ...location, dealIds: [offer.id] })));
  assert.equal(candidatesFor(offer, {}, TODAY).reason, 'multiple-branches-need-review');
  const assessment = inspect(offer, { map });
  assert.equal(assessment.status, 'mapped');
  assert.equal(assessment.reason, 'existing-registry');
  assert.deepEqual([...assessment.locationIds].sort(), map.locations.map(location => location.id).sort());
  const result = await pipeline([offer], { map });
  mapped(result, offer.id, map.locations.map(location => location.id));
  assert.deepEqual(result.map, map);
  assert.deepEqual(result.lookupCalls, []);
  const second = await pipeline([offer], { map: result.map, catalog: result.catalog });
  assert.deepEqual(second.map, result.map);
  assert.deepEqual(second.lookupCalls, []);
});

for (const binding of ['catalog-only', 'automatic', 'incomplete-manual']) {
  test(`IKEA multiple-address ambiguity is not waived by ${binding} coverage`, async () => {
    const offer = deal({ brand: 'IKEA', distance: 'IKEA Wien Westbahnhof und IKEA Wien Nord',
      description: 'Europaplatz 1, 1150 Wien; Sverigestra\u00dfe 1, 1220 Wien' });
    const locations = ikea().map(location => ({ ...location, dealIds: [offer.id],
      ...(binding === 'automatic' ? { automaticDealIds: [offer.id] } : {}) }));
    const map = binding === 'catalog-only' ? mapOf()
      : mapOf(...(binding === 'incomplete-manual' ? locations.slice(0, 1) : locations));
    const catalog = catalogOf(...locations);
    assert.equal(inspect(offer, { map, catalog }).status, 'needs-review');
    const result = await pipeline([offer], { map, catalog });
    unmapped(result, offer.id, 'multiple-branches-need-review');
    assert.deepEqual(result.lookupCalls, []);
  });
}

for (const validity of [{ validUntil: '2026-10-09' }, { validFrom: '2026-10-11' }]) {
  test(`inactive named catalog venue is not reused: ${JSON.stringify(validity)}`, async () => {
    const offer = deal({ title: 'Therme Wien Eintritt' });
    const catalog = catalogOf({ ...therme(), ...validity });
    assert.equal(inspect(offer, { catalog }).status, 'needs-review');
    const result = await pipeline([offer], { catalog });
    unmapped(result, offer.id);
    assert.deepEqual(result.lookupCalls, []);
  });
}

test('verifiedLocation rejects impossible calendar dates in either branch-window boundary', () => {
  for (const [field, today] of [['validFrom', '2026-03-01'], ['validUntil', '2026-02-28']]) {
    const location = venue({ [field]: '2026-02-31' });
    assert.equal(verifiedLocation(location), false, `${field} must reject February 31 even without a current-day filter`);
    assert.equal(verifiedLocation(location, today), false, `${field} must not accept an impossible day through string comparison`);
    assert.equal(verifiedLocation(venue({ [field]: '2026-02-28' }), today), true);
    assert.equal(verifiedLocation(venue({ [field]: '2028-02-29' }), '2028-02-29'), true);
  }
});

const invalidGeocodes = [
  ['no match', null],
  ['NaN latitude', { ...GEO_A, latitude: NaN }],
  ['infinite longitude', { ...GEO_A, longitude: Infinity }],
  ['string latitude', { ...GEO_A, latitude: String(GEO_A.latitude) }],
  ['outside Vienna', { ...GEO_A, latitude: 47.07, longitude: 15.44 }],
  ['reversed coordinates', { ...GEO_A, latitude: GEO_A.longitude, longitude: GEO_A.latitude }],
  ['missing source', { ...GEO_A, source: '' }],
  ['wrong street', { ...GEO_A, address: ADDRESS_B }],
  ['wrong house number', { ...GEO_A, address: 'Braunhubergasse 17, 1110 Wien' }],
  ['wrong postal code', { ...GEO_A, address: 'Braunhubergasse 19, 1020 Wien' }],
  ['city center without address', { ...GEO_A, latitude: 48.2082, longitude: 16.3738, address: 'Wien' }],
];
for (const [label, response] of invalidGeocodes) {
  test(`invalid geocode is rejected: ${label}`, async () => {
    const offer = deal({ address: ADDRESS_A });
    const result = await pipeline([offer], { lookupResult: response });
    const row = unmapped(result, offer.id, 'geocode-review');
    assert.deepEqual(row.failures, ['no-exact-coordinate-match']);
    assert.equal(result.catalog.locations.length, 0);
    assert.deepEqual(result.lookupCalls, [A]);
  });
}

for (const invalid of [{ confidence: 0.89 }, { confidence: 1.01 }, { latitude: NaN }, { longitude: 15 }, { source: '' }]) {
  test(`invalid catalog location cannot supply a named binding: ${JSON.stringify(invalid)}`, async () => {
    const location = { ...therme(), ...invalid };
    assert.equal(verifiedLocation(location, TODAY), false);
    const offer = deal({ title: 'Therme Wien Eintritt' });
    const result = await pipeline([offer], { catalog: catalogOf(location) });
    unmapped(result, offer.id);
    assert.deepEqual(result.lookupCalls, []);
  });
}

const feature = (overrides = {}) => ({ id: 'fixture.1',
  properties: { NAME_STR: A.street, NAME_ONR: A.number, PLZ: A.postalCode },
  geometry: { type: 'Point', coordinates: [GEO_A.longitude, GEO_A.latitude] }, ...overrides,
});
for (const [label, geometry] of [
  ['wrong geometry type', { type: 'Polygon', coordinates: [[16.4, 48.2]] }],
  ['missing coordinates', { type: 'Point' }],
  ['string coordinates', { type: 'Point', coordinates: ['16.41565621', '48.17024268'] }],
  ['outside Vienna', { type: 'Point', coordinates: [15.4, 47.1] }],
]) {
  test(`exact feature selection rejects ${label} without throwing`, () => {
    assert.equal(selectExactFeature([feature({ geometry })], A), null);
  });
}

test('distant exact-address geocode hits are ambiguous; nearby hits have deterministic identity', () => {
  const one = feature({ id: 'fixture.2' });
  const near = feature({ id: 'fixture.1', geometry: { type: 'Point', coordinates: [GEO_A.longitude + 0.00001, GEO_A.latitude] } });
  const far = feature({ geometry: { type: 'Point', coordinates: [16.5, 48.2] } });
  assert.equal(selectExactFeature([one, far], A), null);
  assert.equal(selectExactFeature([one, near], A), near);
  assert.equal(selectExactFeature([near, one], A), near);
});

test('geocode uses the injected fetcher and rejects invalid or oversized response payloads', async () => {
  const urls = [];
  const result = await geocode(A, async url => {
    urls.push(new URL(url));
    return { ok: true, json: async () => ({ numberMatched: 1, features: [feature()] }) };
  });
  assert.equal(result.address, ADDRESS_A);
  assert.equal(result.latitude, GEO_A.latitude);
  assert.equal(result.longitude, GEO_A.longitude);
  assert.equal(urls.length, 1);
  assert.match(urls[0].searchParams.get('cql_filter'), /Braunhubergasse/);
  assert.match(urls[0].searchParams.get('cql_filter'), /19/);
  for (const payload of [{}, { features: null }, { features: [feature()], numberMatched: 101 }]) {
    await assert.rejects(geocode(A, async () => ({ ok: true, json: async () => payload })), /Invalid or ambiguous/);
  }
  await assert.rejects(geocode(A, async () => ({ ok: false, status: 503 })), /HTTP 503/);
});

test('zero lookup budget reports review-needed and never creates a guessed marker', async () => {
  const offer = deal({ address: ADDRESS_A });
  const result = await pipeline([offer], { maxRequests: 0, lookupResult: GEO_A });
  assert.deepEqual(unmapped(result, offer.id, 'geocode-review').failures, ['request-budget']);
  assert.deepEqual(result.lookupCalls, []);
});

test('lookup failure stays review-needed without a cached verified result', async () => {
  const offer = deal({ address: ADDRESS_A });
  const result = await pipeline([offer], { lookupResult: () => { throw new Error('fixture outage'); } });
  assert.ok(unmapped(result, offer.id, 'geocode-review').failures.includes('fixture outage'));
  assert.deepEqual(result.lookupCalls, [A]);
});

test('second pass of a single newly geocoded deal is byte-stable and makes no lookup', async () => {
  const offers = [deal({ address: ADDRESS_A })];
  const first = await pipeline(offers, { lookupResult: GEO_A });
  const second = await pipeline(offers, { map: first.map, catalog: first.catalog, cache: first.cache,
    now: new Date('2026-10-10T13:00:00.000Z') });
  assert.equal(JSON.stringify(second.map), JSON.stringify(first.map));
  assert.deepEqual(second.catalog, first.catalog);
  assert.equal(second.requests, 0);
  assert.deepEqual(second.lookupCalls, []);
  mapped(second, offers[0].id, [first.map.locations[0].id]);
});

test('second pass of two same-address deals cannot merge or churn first-pass marker IDs', async () => {
  const offers = [deal({ id: 'first', address: ADDRESS_A }), deal({ id: 'second', address: ADDRESS_A })];
  const first = await pipeline(offers, { lookupResult: GEO_A });
  const second = await pipeline(offers, { map: first.map, catalog: first.catalog, cache: first.cache });
  assert.deepEqual(second.map, first.map);
  assert.deepEqual(second.catalog, first.catalog);
  assert.equal(second.requests, 0);
  assert.deepEqual(second.lookupCalls, []);
});

test('inspection and enrichment do not mutate feed, input map, catalog, or reviewed evidence', async () => {
  const feed = freeze({ lastUpdated: 'fixture-original', deals: [
    deal({ id: 'exact', address: ADDRESS_A, category: 'Essen', validOn: ['2026-10-10'],
      viennaEvidence: { verified: true, detail: ADDRESS_A }, metadata: { retain: ['all', 'values'] } }),
    deal({ id: 'unresolved', distance: 'Wien Zentrum' }),
    deal({ id: 'online', distance: 'Online', description: 'Nur im Webshop.' }),
    deal({ id: 'reviewed', description: `${ADDRESS_A}; ${ADDRESS_B}` }),
  ] });
  const map = freeze(mapOf(venue({ dealIds: ['exact', 'removed-offer'], automaticDealIds: ['exact'] })));
  const catalog = freeze(catalogOf(therme()));
  const reviewed = freeze({ reviewed: { locations: [B] } });
  const before = JSON.stringify({ feed, map, catalog, reviewed });
  for (const offer of feed.deals) inspect(offer, { map, catalog, reviewed });
  const result = await pipeline(feed.deals, { map, catalog, reviewed, lookupResult: GEO_B });
  assert.equal(JSON.stringify({ feed, map, catalog, reviewed }), before);
  assert.deepEqual(feed.deals.map(offer => offer.id), ['exact', 'unresolved', 'online', 'reviewed']);
  assert.equal(result.report.totalDeals, 4);
  assert.equal(result.report.mappedDeals, 2);
  assert.equal(result.report.onlineDeals, 1);
  assert.equal(result.report.unresolvedDeals, 1);
  assert.deepEqual(result.report.deals.map(row => row.id), feed.deals.map(offer => offer.id));
});

test('fingerprint is stable but location, channel, caption, evidence, and branch-date edits change it', () => {
  const original = deal({ address: ADDRESS_A });
  const fingerprint = locationFingerprint(original);
  assert.equal(locationFingerprint(clone(original)), fingerprint);
  for (const update of [
    { address: ADDRESS_B }, { location: 'Therme Wien' }, { distance: 'Online' },
    { description: 'Nur Lieferung.' }, { metaGraphCaption: ADDRESS_B },
    { viennaEvidence: { verified: true, detail: ADDRESS_B } },
    { offerValidityText: 'Nur am 11.10.2026' }, { validOn: ['2026-10-11'] },
    { expiry: '2026-10-11' }, { expiresAt: '2026-10-11T21:59:59Z' },
  ]) assert.notEqual(locationFingerprint({ ...original, ...update }), fingerprint);
});

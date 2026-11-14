import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { reconcileMapEnrichment, runMapEnrichment } from './enrich-deal-map.mjs';
import { locationFingerprint } from './deal-map-enrichment.mjs';
import { computeDealsFeedVersion } from './deals-feed-contract.mjs';
import { captureMapEnrichmentInput, projectEnrichmentDeal } from '../scraper/deal-enrichment-state.js';

const now = new Date('2026-11-14T13:00:00.000Z');
const original = (fields = ['description', 'map']) => ({ id: 'pending-cafe', brand: 'Cafe Fixture',
  title: 'Kaffee gratis zum Frühstück', description: 'Beim Frühstück einen Kaffee gratis.',
  url: 'https://cafe.example/angebote', address: 'Am Hof 4, 1010 Wien', distance: 'Am Hof 4, 1010 Wien',
  city: 'Wien', postalCode: '1010', latitude: 99, longitude: 99, lat: 99, lng: 99,
  approvalPublicationMode: 'two-stage-v1', enrichmentPending: true, enrichmentFields: fields,
  enrichmentNextReviewAt: '2026-11-14T12:00:00.000Z', pipelineLifecycle: { stage: 'published', manualDecision: 'approved' } });
const point = () => ({ id: 'verified-cafe', name: 'Cafe Fixture', address: 'Am Hof 4, 1010 Wien',
  latitude: 48.211, longitude: 16.369, confidence: 1, source: 'reviewed-fixture', dealIds: ['pending-cafe'] });
const mapResult = (overrides = {}) => ({ map: { locations: [point()] }, catalog: { locations: [point()] },
  report: { totalDeals: 1, mappedDeals: 1, onlineDeals: 0, unresolvedDeals: 0, locations: 1,
    deals: [{ id: 'pending-cafe', status: 'mapped', locationCount: 1, needsReview: false }] }, ...overrides });

test('verified exact point completes only map and exposes verified result on the same record', () => {
  const pending = projectEnrichmentDeal(original());
  const result = reconcileMapEnrichment([pending], mapResult(), { now });
  const [ready] = result.deals;
  assert.equal(ready.id, pending.id);
  assert.deepEqual(ready.enrichmentFields, ['description']);
  assert.equal(ready.enrichmentPending, true);
  assert.equal(ready.description, pending.description);
  assert.equal(ready.address, point().address);
  assert.equal(ready.latitude, point().latitude);
  assert.equal(ready.longitude, point().longitude);
  assert.equal(ready.lat, undefined);
  assert.equal(ready.lng, undefined);
  assert.deepEqual(ready.pipelineLifecycle, pending.pipelineLifecycle);
  assert.equal(result.report.deals[0].fingerprint, locationFingerprint(ready));
  assert.equal(result.report.mappedDeals, 1);
  assert.equal(result.map.geocodingExclusions?.length || 0, 0);
  const complete = reconcileMapEnrichment([projectEnrichmentDeal(original(['map']))], mapResult(), { now }).deals[0];
  assert.deepEqual(complete.enrichmentFields, []);
  assert.equal(complete.enrichmentPending, false);
  assert.equal(complete.enrichmentNextReviewAt, null);
  assert.equal(complete.description, original().description);
});

test('hourly map retries cannot postpone a due description review past the quality worker', () => {
  const unresolved = mapResult({ map: { locations: [] } });
  const dueAt = '2026-11-14T13:13:00.000Z';
  let pending = projectEnrichmentDeal({ ...original(), enrichmentNextReviewAt: dueAt });
  for (const hour of ['13', '14', '15']) {
    pending = reconcileMapEnrichment([pending], unresolved,
      { now: new Date(`2026-11-14T${hour}:23:00.000Z`) }).deals[0];
    assert.equal(pending.enrichmentNextReviewAt, dueAt, 'map :23 must not hide the due row from quality :43');
    assert.ok(Date.parse(pending.enrichmentNextReviewAt) <= Date.parse(`2026-11-14T${hour}:43:00.000Z`));
    assert.deepEqual(pending.enrichmentFields, ['description', 'map']);
  }
  const ready = reconcileMapEnrichment([pending], mapResult(), { now }).deals[0];
  assert.deepEqual(ready.enrichmentFields, ['description']);
  assert.equal(ready.enrichmentNextReviewAt, dueAt, 'successful mapping also leaves the description deadline intact');
  for (const value of [null, 'invalid']) {
    const missingDeadline = projectEnrichmentDeal({ ...original(), enrichmentNextReviewAt: value });
    for (const mapping of [unresolved, mapResult()]) {
      const recovered = reconcileMapEnrichment([missingDeadline], mapping, { now }).deals[0];
      assert.equal(recovered.enrichmentNextReviewAt, now.toISOString(), 'missing description deadline is immediately due');
    }
  }
  const future = '2026-11-14T18:00:00.000Z';
  assert.equal(reconcileMapEnrichment([projectEnrichmentDeal({ ...original(), enrichmentNextReviewAt: future })],
    unresolved, { now }).deals[0].enrichmentNextReviewAt, future, 'map worker does not change another task deadline');
});

test('partial, missing, invalid, expired or wrong-deal points never clear map or leak public pins', () => {
  const pending = projectEnrichmentDeal(original(['map']));
  const variants = [
    mapResult({ report: { ...mapResult().report, deals: [{ id: pending.id, status: 'partially-mapped', locationCount: 1, needsReview: true }] } }),
    mapResult({ map: { locations: [] } }),
    mapResult({ map: { locations: [{ ...point(), latitude: 99 }] } }),
    mapResult({ map: { locations: [{ ...point(), confidence: 0.1 }] } }),
    mapResult({ map: { locations: [{ ...point(), validUntil: '2026-11-13' }] } }),
    mapResult({ map: { locations: [{ ...point(), dealIds: ['other'] }] } }),
    mapResult({ report: { ...mapResult().report, deals: [{ id: pending.id, status: 'online-only', locationCount: 0, needsReview: false }] } }),
    mapResult({ report: { ...mapResult().report, deals: [{ id: pending.id, status: 'mapped', locationCount: 0, needsReview: false }] } }),
  ];
  for (const input of variants) {
    const result = reconcileMapEnrichment([pending], input, { now });
    const [held] = result.deals;
    assert.deepEqual(held.enrichmentFields, ['map']);
    assert.equal(held.enrichmentPending, true);
    assert.equal(held.enrichmentNextReviewAt, '2026-11-14T14:00:00.000Z');
    for (const key of ['address', 'location', 'latitude', 'longitude', 'lat', 'lng', 'coordinates']) assert.equal(held[key], undefined, key);
    assert.equal(held.distance, 'Wien · Standort folgt');
    assert.ok(!result.map.locations.some(location => location.dealIds.includes(pending.id)));
    assert.deepEqual(result.map.geocodingExclusions.find(entry => entry.dealId === pending.id), {
      dealId: pending.id, reason: 'enrichment-map-pending', fingerprint: locationFingerprint(held), locationIds: [] });
    assert.equal(result.report.deals[0].locationCount, 0);
    assert.equal(result.report.deals[0].needsReview, true);
  }
});

test('unrelated records and point members remain exact; broad matching is not republished', () => {
  const pending = projectEnrichmentDeal(original());
  const other = { id: 'other', title: 'Other', description: 'Untouched', url: 'https://other.example', votes: 17 };
  const shared = { ...point(), dealIds: [pending.id, other.id], automaticDealIds: [pending.id],
    brandMatches: ['Cafe Fixture'], titleMatches: ['Kaffee'], placeMatches: ['Wien'] };
  const result = reconcileMapEnrichment([pending, other], mapResult({ map: { locations: [shared] },
    report: { ...mapResult().report, deals: [
      { id: pending.id, status: 'partially-mapped', locationCount: 1, needsReview: true },
      { id: other.id, status: 'mapped', locationCount: 1, needsReview: false },
    ] } }), { now });
  assert.deepEqual(result.deals[1], other);
  assert.deepEqual(result.map.locations[0].dealIds, [other.id]);
  assert.deepEqual(result.map.locations[0].automaticDealIds, []);
  for (const key of ['brandMatches', 'titleMatches', 'placeMatches']) assert.equal(result.map.locations[0][key], undefined);
});

test('public pending exclusion preserves the internal expired-branch constraint for later retries', () => {
  const input = original(['map']), pending = projectEnrichmentDeal(input);
  const old = { ...point(), validUntil: '2026-11-13' };
  const internalFingerprint = locationFingerprint(input);
  const result = reconcileMapEnrichment([pending], mapResult({ map: { locations: [], geocodingExclusions: [{
    dealId: pending.id, fingerprint: internalFingerprint, reason: 'inactive-registry-branch', locationIds: [old.id],
  }] }, catalog: { locations: [old] }, report: { ...mapResult().report,
    deals: [{ id: pending.id, status: 'inactive-registry-branch', locationCount: 0, needsReview: true }] } }), { now });
  assert.equal(result.map.geocodingExclusions[0].fingerprint, locationFingerprint(result.deals[0]));
  assert.equal(result.map.geocodingExclusions[0].reason, 'enrichment-map-pending');
  assert.deepEqual(result.catalog.dealBindings, [{ dealId: pending.id, fingerprint: internalFingerprint, locationIds: [old.id] }]);
  assert.equal(result.deals[0].enrichmentPending, true);
});

async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), 'map-enrichment-status-'));
  const root = pathToFileURL(directory + '/');
  const write = async (name, data) => writeFile(new URL(name, root), JSON.stringify(data, null, 2) + '\n');
  const read = async name => JSON.parse(await readFile(new URL(name, root), 'utf8'));
  try {
    await mkdir(join(directory, 'docs')); await mkdir(join(directory, 'reviews'));
    await write('docs/deal-map-locations.json', { locations: [] });
    await run({ root, write, read });
  } finally { await rm(directory, { recursive: true, force: true }); }
}
const noNetwork = async () => assert.fail('No source network call expected');

test('hourly wrapper restores exact internal inputs, uses existing budget, updates feed and is idempotent', async () => fixture(async ({ root, write, read }) => {
  const input = original(['map']), pending = projectEnrichmentDeal(input);
  const other = { id: 'other', brand: 'Webshop', title: '10 Prozent im Onlineshop', description: 'Nur online', location: 'Online' };
  await write('docs/deals.json', { deals: [pending, other], totalDeals: 2 });
  await write('docs/deal-map-locations.json', { locations: [], geocodingExclusions: [{ dealId: pending.id,
    fingerprint: locationFingerprint(pending), reason: 'enrichment-map-pending', locationIds: [] }] });
  const cache = { version: 1, entries: { [input.id]: captureMapEnrichmentInput(input) } };
  await write('reviews/enrichment-inputs.json', cache);
  let calls = 0;
  const result = await runMapEnrichment({ root, now, refreshBusiness: false, maxSourceRequests: 0, maxGeocodeRequests: 1,
    fetchPage: noNetwork, lookup: async address => { calls++; assert.equal(address.street, 'Am Hof');
      return { latitude: point().latitude, longitude: point().longitude, address: point().address, source: 'official-fixture', featureId: 'test' }; } });
  assert.equal(calls, 1);
  const feed = await read('docs/deals.json');
  assert.equal(feed.deals[0].enrichmentPending, false);
  assert.equal(feed.deals[0].enrichmentNextReviewAt, null);
  assert.equal(feed.deals[0].latitude, point().latitude, 'unverified latitude 99 is never restored publicly');
  assert.deepEqual(feed.deals[1], other);
  assert.equal(feed.feedVersion, computeDealsFeedVersion(feed.deals));
  assert.equal(result.report.deals[0].fingerprint, locationFingerprint(feed.deals[0]));
  assert.deepEqual(await read('reviews/enrichment-inputs.json'), cache, 'worker does not overwrite source input cache');
  const beforeFeed = await readFile(new URL('docs/deals.json', root), 'utf8');
  const beforeMap = await readFile(new URL('docs/deal-map-locations.json', root), 'utf8');
  await runMapEnrichment({ root, now, refreshBusiness: false, maxSourceRequests: 0, maxGeocodeRequests: 0, fetchPage: noNetwork, lookup: noNetwork });
  assert.equal(await readFile(new URL('docs/deals.json', root), 'utf8'), beforeFeed);
  assert.equal(await readFile(new URL('docs/deal-map-locations.json', root), 'utf8'), beforeMap);
}));

test('wrong cache identity or changed offer URL cannot supply an address', async () => {
  for (const change of [{ id: 'different' }, { url: 'https://cafe.example/other' }]) await fixture(async ({ root, write, read }) => {
    const input = original(['map']), pending = projectEnrichmentDeal(input);
    await write('docs/deals.json', { deals: [pending], totalDeals: 1 });
    await write('reviews/enrichment-inputs.json', { version: 1, entries: { [input.id]: { ...captureMapEnrichmentInput(input), ...change } } });
    await runMapEnrichment({ root, now, refreshBusiness: false, maxSourceRequests: 0, maxGeocodeRequests: 1, fetchPage: noNetwork, lookup: noNetwork });
    const feed = await read('docs/deals.json'), map = await read('docs/deal-map-locations.json');
    assert.equal(feed.deals[0].enrichmentPending, true);
    assert.equal(feed.deals[0].address, undefined);
    assert.equal(map.locations.length, 0);
    assert.equal(map.geocodingExclusions[0].fingerprint, locationFingerprint(feed.deals[0]));
  });
});

test('zero existing geocode budget leaves pending map hidden and queued for the next hour', async () => fixture(async ({ root, write, read }) => {
  const input = original(['map']), pending = projectEnrichmentDeal(input);
  await write('docs/deals.json', { deals: [pending], totalDeals: 1 });
  await write('reviews/enrichment-inputs.json', { version: 1, entries: { [input.id]: captureMapEnrichmentInput(input) } });
  const result = await runMapEnrichment({ root, now, refreshBusiness: false, maxSourceRequests: 0, maxGeocodeRequests: 0, fetchPage: noNetwork, lookup: noNetwork });
  assert.equal(result.requests, 0);
  const feed = await read('docs/deals.json');
  assert.equal(feed.deals[0].enrichmentPending, true);
  assert.equal(feed.deals[0].distance, 'Wien · Standort folgt');
  assert.equal(feed.deals[0].enrichmentNextReviewAt, '2026-11-14T14:00:00.000Z');
  assert.equal((await read('docs/deal-map-locations.json')).locations.length, 0);
}));

test('successive hourly runs cannot reopen an expired branch through saved exact address inputs', async () => fixture(async ({ root, write, read }) => {
  const input = original(['map']), pending = projectEnrichmentDeal(input);
  const old = { ...point(), validUntil: '2026-11-13' };
  await write('docs/deals.json', { deals: [pending], totalDeals: 1 });
  await write('docs/deal-map-locations.json', { locations: [], geocodingExclusions: [{ dealId: input.id,
    fingerprint: locationFingerprint(input), reason: 'inactive-registry-branch', locationIds: [old.id] }] });
  await write('reviews/map-location-catalog.json', { locations: [old] });
  await write('reviews/enrichment-inputs.json', { version: 1, entries: { [input.id]: captureMapEnrichmentInput(input) } });
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await runMapEnrichment({ root, now, refreshBusiness: false, maxSourceRequests: 0, maxGeocodeRequests: 1,
      fetchPage: noNetwork, lookup: noNetwork });
    assert.equal(result.requests, 0);
    assert.equal(result.map.locations.length, 0);
    assert.equal((await read('docs/deals.json')).deals[0].enrichmentPending, true);
    assert.deepEqual(result.catalog.dealBindings[0].locationIds, [old.id]);
  }
}));

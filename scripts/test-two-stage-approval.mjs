import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { basicCopyHold, prepareTwoStagePublication } from '../scraper/approval-two-stage.js';
import { captureMapEnrichmentInput, projectEnrichmentDeal, restoreMapEnrichmentInput, updateDealEnrichment } from '../scraper/deal-enrichment-state.js';
import { requireApprovalMap } from './approval-map-readiness.mjs';
import { candidatesFor, locationFingerprint } from './deal-map-enrichment.mjs';
import { stampDealsFeedBundle } from './deals-feed-contract.mjs';

const now = new Date('2026-11-14T11:00:00Z');
const base = { id: 'checked-cafe', url: 'https://example.test/cafe', title: 'Kaffee gratis', brand: 'Cafe',
  description: 'Kaffee gratis in Wien.', distance: 'Wien', pipelineLifecycle: { manualDecision: 'approved' } };
const validation = deal => ({ allowedDeals: [deal], blockedDeals: [], results: [{ deal, decision: { allowed: true, reasons: [], warnings: [] } }] });

test('human basic-valid deal enters list without a pin; same missing map stays held without two-stage authorization', async () => {
  const deal = prepareTwoStagePublication(base, { now });
  const result = await requireApprovalMap(validation(deal), { now, twoStage: true, maxRequests: 0 });
  assert.equal(result.validation.allowedDeals.length, 1);
  assert.deepEqual(result.validation.allowedDeals[0].enrichmentFields, ['map']);
  assert.equal(result.map.locations.length, 0);
  const publicDeal = projectEnrichmentDeal(result.validation.allowedDeals[0]);
  assert.equal(result.map.geocodingExclusions[0].fingerprint, locationFingerprint(publicDeal));
  const unapproved = { ...deal, pipelineLifecycle: {} };
  assert.equal((await requireApprovalMap(validation(unapproved), { now, twoStage: true, maxRequests: 0 })).validation.allowedDeals.length, 0);
  assert.equal((await requireApprovalMap(validation(deal), { now, maxRequests: 0 })).validation.allowedDeals.length, 0);
});

test('known mandatory conditions never become an optional description task', () => {
  for (const caption of ['Gratis Kaffee nur für Neukunden mit App-Coupon.', 'Gratis Kaffee bei Kauf eines Frühstücks.',
    'Gratis Kaffee für Studierende, einmalig pro Gast.', 'Gratis Kaffee ab Mindestbestellwert 20 Euro.', 'Gratis Kaffee nur dienstags von 14 bis 16 Uhr.']) {
    assert.match(basicCopyHold({ ...base, description: '' }, { caption }), /Grundprüfung/);
  }
  assert.match(basicCopyHold({ ...base, description: '' }), /Angebotsbeleg/);
  assert.equal(basicCopyHold(base, { caption: base.description }), '');
  assert.match(basicCopyHold({ ...base, title: '10 Euro Rabatt in der App', description: '5 Euro Rabatt in der App. Mindestbestellwert 50 Euro.' }, { caption: '5 Euro Rabatt in der App. Mindestbestellwert 50 Euro.' }), /Grundprüfung/);
  assert.match(basicCopyHold({ ...base, title: '10 Euro Rabatt', description: 'Mindestbestellwert 10 Euro' }, { caption: '5 Euro Rabatt, Mindestbestellwert 50 Euro' }), /Grundprüfung/);
});

test('pending projection is idempotent, retains source input privately and updates the same record after completion', () => {
  const internal = updateDealEnrichment(prepareTwoStagePublication({ ...base, address: 'Am Hof 4, 1010 Wien',
    latitude: 48.211, longitude: 16.369, streetAddress: 'Ungeprüft 1', ort: 'Ungeprüft 1', lon: 16.369, approvalCopyReview: { waitingForSlot: true } }, { now }), { pendingFields: ['map'], now });
  const store = { version: 1, entries: { [internal.id]: captureMapEnrichmentInput(internal) } };
  const projected = projectEnrichmentDeal(internal);
  assert.equal(projected.distance, 'Wien · Standort folgt');
  assert.equal(projected.address, undefined);
  assert.equal(projected.latitude, undefined);
  for (const field of ['streetAddress', 'ort', 'lon']) assert.equal(projected[field], undefined);
  assert.match(projected.description, /^Details werden ergänzt\./);
  assert.deepEqual(projectEnrichmentDeal(projected), projected);
  assert.equal(restoreMapEnrichmentInput(projected, store).address, internal.address);
  assert.equal(restoreMapEnrichmentInput({ ...projected, url: 'https://wrong.test' }, store).address, undefined);
  assert.equal(restoreMapEnrichmentInput({ ...projected, address: 'Neuer Ort 5, 1020 Wien' }, store).address, 'Neuer Ort 5, 1020 Wien');
  assert.equal(restoreMapEnrichmentInput({ ...projected, liveEditedFields: ['address'] }, store).address, undefined);
  const copyDone = projectEnrichmentDeal(updateDealEnrichment(projected, { completedFields: ['description'], now }));
  assert.equal(copyDone.id, base.id);
  assert.equal(copyDone.description, base.description);
  assert.deepEqual(copyDone.enrichmentFields, ['map']);
  const done = projectEnrichmentDeal(updateDealEnrichment({ ...copyDone, address: internal.address }, { completedFields: ['map'], now }));
  assert.equal(done.enrichmentPending, false);
  assert.equal(done.enrichmentNextReviewAt, null);
  assert.equal(done.address, internal.address);
  const feed = stampDealsFeedBundle({ deals: [projected] }, { nowIso: now.toISOString(), redemptionManifest: null });
  assert.equal(feed.deals.length, 1);
  assert.deepEqual(feed.deals[0], projected);
});

test('reviewed voucher venue cannot override an explicitly changed or manually reviewed address', () => {
  const reviewed = JSON.parse(readFileSync(new URL('../reviews/map-addresses.json', import.meta.url)));
  const deal = JSON.parse(readFileSync(new URL('./fixtures/approved-vapiano-legacy-20261114.json', import.meta.url)));
  const original = candidatesFor(deal, reviewed, '2026-11-14');
  assert.equal(original.addresses.length, 1);
  for (const changed of [{ ...deal, address: 'Theobaldgasse 2, 1060 Wien' }, { ...deal, city: 'Linz' },
    { ...deal, slackEditedFields: ['address'] }, { ...deal, url: deal.url + '?other=1' }]) {
    const result = candidatesFor(changed, reviewed, '2026-11-14');
    assert.equal(result.addresses.length, 0);
    assert.match(result.reason, /reviewed-offer-(?:location-conflict|identity-mismatch)/);
  }
});


test('repeated feed stamping keeps the exact redemption binding across its own pending notice only', () => {
  const deal = updateDealEnrichment(prepareTwoStagePublication({ ...base, approvedAt: now.toISOString() }, { now }), { pendingFields: ['description'], now });
  const manifest = { reviews: [{ dealId: deal.id, expectedTitle: deal.title, expectedDescription: deal.description,
    sourceUrl: deal.url, method: 'onsite', details: 'Kaffee vor Ort holen.', verifiedAt: now.toISOString(),
    reviewUntil: '2026-11-15T11:00:00Z', evidence: ['Source supports this exact offer'] }] };
  const first = stampDealsFeedBundle({ deals: [deal] }, { nowIso: now.toISOString(), redemptionManifest: manifest });
  const second = stampDealsFeedBundle(first, { nowIso: now.toISOString(), redemptionManifest: manifest });
  assert.ok(first.deals[0].redemption);
  assert.deepEqual(second, first);
  const changed = stampDealsFeedBundle({ deals: [{ ...first.deals[0], description: 'Details werden ergänzt. Ein anderes Angebot.' }] },
    { nowIso: now.toISOString(), redemptionManifest: manifest });
  assert.equal(changed.deals[0].redemption, undefined);
});


test('basic title binding preserves complete numbers, decimals and offer operators', () => {
  for (const [title, caption] of [['5 Euro Rabatt', '15 Euro Rabatt'], ['50 Euro Rabatt', '1,50 Euro Rabatt'],
    ['1+1 Pasta gratis', '1-1 Pasta gratis'], ['5% Rabatt', '15% Rabatt']]) {
    assert.match(basicCopyHold({ ...base, title, description: caption }, { caption }), /Grundprüfung/);
  }
  assert.equal(basicCopyHold({ ...base, title: '5 Euro Rabatt', description: '5 Euro Rabatt. Mit App.' }, { caption: '5 Euro Rabatt. Mit App.' }), '');
});

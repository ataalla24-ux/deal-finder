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
  assert.equal(basicCopyHold({ ...base, description: '' }), '');
  assert.equal(basicCopyHold(base, { caption: base.description }), '');
  assert.match(basicCopyHold({ ...base, title: '10 Euro Rabatt in der App', description: '5 Euro Rabatt in der App. Mindestbestellwert 50 Euro.' }, { caption: '5 Euro Rabatt in der App. Mindestbestellwert 50 Euro.' }), /Grundprüfung/);
  assert.match(basicCopyHold({ ...base, title: '10 Euro Rabatt', description: 'Mindestbestellwert 10 Euro' }, { caption: '5 Euro Rabatt, Mindestbestellwert 50 Euro' }), /Grundprüfung/);
});

test('basic-valid approved copy may be absent or paraphrased without copying the source article', () => {
  const deal = { ...base, validUntil: '2026-11-20', description: '' };
  assert.equal(basicCopyHold(deal, { caption: 'Gratis Kaffee in Wien.' }), '');
  assert.equal(basicCopyHold(deal), '');
  assert.equal(basicCopyHold(deal, { caption: 'Gratis Kaffee, ohne App.' }), '');
  for (const caption of ['Gratis Kaffee. Keine App nötig.', 'Gratis Kaffee. Kein Coupon nötig.',
    'Gratis Kaffee. Gutschein ist nicht erforderlich.', 'Gratis Kaffee. Am Montag wurde darüber berichtet.']) {
    assert.equal(basicCopyHold(deal, { caption }), '', caption);
  }
  assert.deepEqual(prepareTwoStagePublication(deal, { now }).enrichmentFields, ['description']);
  assert.equal(prepareTwoStagePublication(deal, { now }).description, '');
  const source = '5 Euro Rabatt. Nur für Neukunden in der App. Mindestbestellwert 20 Euro.';
  assert.equal(basicCopyHold({ ...base, title: '5 € Rabatt', description:
    'Neukundinnen erhalten in der App einen Rabatt von 5 Euro ab einem Bestellwert von 20 Euro.' }, { caption: source }), '');
  assert.equal(basicCopyHold({ ...base, title: 'Kaffee gratis', description:
    'Zum Frühstückskauf gibt es dienstags zwischen 14 und 16 Uhr einmalig einen kostenlosen Kaffee pro Person.' },
  { caption: 'Gratis Kaffee bei Kauf eines Frühstücks, einmalig pro Gast, nur dienstags von 14 bis 16 Uhr.' }), '');
});

test('required conditions cannot be satisfied by their negation; explicitly optional conditions remain optional', () => {
  for (const [caption, title, reason] of [
    ['Gratis Kaffee nur mit Gutschein.', 'Gratis Kaffee ohne Gutschein', /Gutschein/],
    ['Gratis Kaffee nur mit Coupon.', 'Gratis Kaffee. Kein Coupon erforderlich.', /Coupon/],
    ['Gratis Kaffee in der App.', 'Gratis Kaffee. App ist nicht erforderlich.', /App/],
    ['5 Euro Rabatt nur für Neukunden.', '5 Euro Rabatt für alle, auch ohne Neukundenstatus', /Neukunden/],
    ['Gratis Kaffee nur für Mitglieder.', 'Gratis Kaffee ohne Mitgliedschaft', /Mitglied/],
    ['Gratis Kaffee nur mit App. Kuchen auch ohne App möglich.', 'Gratis Kaffee ohne App', /App/],
  ]) assert.match(basicCopyHold({ ...base, title, description: '' }, { caption }), reason);
  for (const [caption, title] of [
    ['Gratis Kaffee. App ist nicht erforderlich.', 'Gratis Kaffee ohne App'],
    ['Gratis Kaffee. Keine App nötig.', 'Gratis Kaffee'],
    ['Gratis Kaffee. Kein Gutschein erforderlich.', 'Gratis Kaffee ohne Gutschein'],
    ['Gratis Kaffee. Keine Mitgliedschaft erforderlich.', 'Gratis Kaffee'],
    ['Gratis Kaffee. Mitgliedschaft ist nicht notwendig.', 'Gratis Kaffee ohne Mitgliedschaft'],
  ]) assert.equal(basicCopyHold({ ...base, title, description: '' }, { caption }), '', caption);
});

test('known evidence cannot support newly invented monetary or percentage units', () => {
  for (const [caption, title] of [
    ['5 Euro Rabatt in Wien.', '20 % Rabatt'],
    ['5 Euro Rabatt in Wien.', '5 Prozent Rabatt'],
    ['20 Prozent Rabatt in Wien.', '20 Euro Rabatt'],
    ['Gratis Kaffee in Wien.', '5 Euro Rabatt auf Kaffee'],
    ['Gratis Kaffee in Wien.', '50 Prozent Rabatt auf Kaffee'],
  ]) assert.match(basicCopyHold({ ...base, title, description: '' }, { caption }), /Grundprüfung/);
  for (const [caption, title] of [['5 Euro Rabatt.', '5 € Rabatt'], ['25,5 Prozent Rabatt.', '25.5 % Rabatt']])
    assert.equal(basicCopyHold({ ...base, title, description: '' }, { caption }), '');
});

test('the exact two-redemption limit accepts equivalent word form without accepting a larger limit', () => {
  const caption = 'Gratis Donut. Maximal 2 Einlösungen pro Gast.';
  for (const description of ['Höchstens zweimal pro Gast.', 'Maximal zwei Einlösungen pro Gast.',
    'Höchstens 2 Mal pro Gast.'])
    assert.equal(basicCopyHold({ ...base, title: 'Gratis Donut', description }, { caption }), '', description);
  for (const description of ['Höchstens dreimal pro Gast.', 'Maximal 3 Einlösungen pro Gast.',
    'Höchstens einmal pro Gast.'])
    assert.match(basicCopyHold({ ...base, title: 'Gratis Donut', description }, { caption }), /Einlösungslimit/);
});

test('known missing conditions and conflicting amounts report their concrete reason', () => {
  const source = '5 Euro Rabatt. Nur für Neukunden in der App. Mindestbestellwert 20 Euro.';
  const offer = { ...base, title: '5 Euro Rabatt', description: 'Für Neukunden in der App. Mindestbestellwert 20 Euro.' };
  for (const [description, reason] of [
    ['Für Neukunden. Mindestbestellwert 20 Euro.', /App/],
    ['In der App. Mindestbestellwert 20 Euro.', /Neukunden/],
    ['Für Neukunden in der App.', /Mindest/],
    ['Für Neukunden in der App. Mindestbestellwert 10 Euro.', /Mindest/],
  ]) assert.match(basicCopyHold({ ...offer, description }, { caption: source }), reason);
  assert.match(basicCopyHold({ ...offer, title: '20 Euro Rabatt' }, { caption: source }), /Rabatt/);
  assert.match(basicCopyHold({ ...base, description: 'Kaffee gratis dienstags von 14 bis 17 Uhr.' },
    { caption: 'Kaffee gratis nur dienstags von 14 bis 16 Uhr.' }), /Uhrzeit/);
  assert.match(basicCopyHold({ ...base, description: 'Kaffee gratis mittwochs von 14 bis 16 Uhr.' },
    { caption: 'Kaffee gratis nur dienstags von 14 bis 16 Uhr.' }), /Wochentag/);
  assert.match(basicCopyHold({ ...base, description: 'Bei Kauf eines Getränks gibt es Kaffee gratis.' },
    { caption: 'Kaffee gratis bei Kauf eines Frühstücks.' }), /Kauf/);
  assert.match(basicCopyHold({ ...base, description: 'Maximal 5 Einlösungen pro Gast.' },
    { caption: 'Kaffee gratis. Maximal 2 Einlösungen pro Gast.' }), /Einlös/);
  assert.match(basicCopyHold({ ...base, title: '2 Pasta gratis', description: '' },
    { caption: '1 Pasta gratis.' }), /Angebotsmenge/);
  assert.match(basicCopyHold({ ...offer, description: 'Für Neukunden ohne App. Mindestbestellwert 20 Euro.' },
    { caption: source }), /App/);
  assert.match(basicCopyHold({ ...offer, description: 'Für Neukunden in der App. MBW: 10 Euro.' },
    { caption: '5 Euro Rabatt. Nur für Neukunden in der App. Mindestbestellwert: 20 Euro.' }), /Mindestbetrag/);
  assert.match(basicCopyHold({ ...base, description: '' }, { caption: 'Kaffee für 5 Euro.' }), /Gratis-Titel/);
  assert.equal(basicCopyHold({ ...base, description: '' }, { caption: 'Kaffee gratis, Croissant für 5 Euro.' }), '');
  for (const [caption, copy] of [['Kaffee gratis vor 10:30 Uhr.', 'Kaffee gratis bis 10:30 Uhr.'],
    ['Kaffee gratis nur ab 17 Uhr.', 'Kaffee gratis ab 16 Uhr.']]) {
    assert.match(basicCopyHold({ ...base, description: '' }, { caption }), /Uhrzeit/);
    assert.match(basicCopyHold({ ...base, description: copy }, { caption }), /Uhrzeit/);
    assert.equal(basicCopyHold({ ...base, description: caption }, { caption }), '');
  }
  assert.match(basicCopyHold({ ...base, description: '' },
    { caption: 'Kaffee gratis. Gültig jeweils montags.' }), /Wochentag/);
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


test('a changed monetary amount cannot hide behind an unclassified price phrase or euro prefix', () => {
  for (const caption of ['Pizza kostet 4,90 Euro bei Abholung.', 'Pizza €4,90 bei Abholung.', 'Pizza 4,90€ bei Abholung.']) {
    assert.match(basicCopyHold({ ...base, title: 'Pizza für 19,90 € bei Abholung', description: '' }, { caption }), /Betrag/);
    assert.equal(basicCopyHold({ ...base, title: 'Pizza für 4,90 € bei Abholung', description: '' }, { caption }), '');
  }
});

test('explicitly denied free product cannot borrow another product’s free claim', () => {
  for (const caption of ['Kaffee ist nicht gratis, sondern kostet 5 Euro.',
    'Kaffee nicht gratis, aber gratis Kuchen.', 'Kein kostenloser Kaffee, aber gratis Kuchen.']) {
    assert.match(basicCopyHold({ ...base, title: 'Kaffee gratis', description: '' }, { caption }), /Gratis-Titel/, caption);
  }
  assert.equal(basicCopyHold({ ...base, title: 'Kuchen gratis', description: '' },
    { caption: 'Kaffee ist nicht gratis, aber gratis Kuchen.' }), '');
});

test('an explicit absence of minimum spend does not create a mandatory description', () => {
  const deal = { ...base, title: '5 Euro Rabatt', description: '' };
  for (const caption of ['5 Euro Rabatt. Kein Mindestbestellwert erforderlich.',
    '5 Euro Rabatt. MBW ist nicht nötig.', '5 Euro Rabatt ohne Mindestumsatz.']) {
    assert.equal(basicCopyHold(deal, { caption }), '', caption);
  }
  assert.match(basicCopyHold(deal, { caption: '5 Euro Rabatt. Mindestbestellwert 20 Euro.' }), /Mindestbetrag/);
  assert.match(basicCopyHold(deal, { caption: '5 Euro Rabatt. Kein Mindestbestellwert erforderlich. Mindestbestellwert 20 Euro bei Lieferung.' }), /Mindestbetrag/);
});

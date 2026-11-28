import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { captureApprovedExpiryEvidence } from './approved-expiry-evidence.mjs';
import { maintainDeals, maintainFeedFile } from './automatic-deal-maintenance.mjs';
import { applyLiveDealEditsToBundle, loadLiveDealEditStore } from './live-deal-edits-lib.mjs';
import { filterModeratedDeals } from '../scraper/deal-moderation-utils.js';

const auditedOriginals = JSON.parse(fs.readFileSync(new URL('./fixtures/expiry-live-originals-20261128.json', import.meta.url)));
const reviewedCorrections = JSON.parse(fs.readFileSync(new URL('./fixtures/expiry-reviewed-periods-20261128.json', import.meta.url)));
const linkedDocumentOffer = JSON.parse(fs.readFileSync(new URL('./fixtures/expiry-linked-document-20261128.json', import.meta.url)));
const originalImageOffer = JSON.parse(fs.readFileSync(new URL('./fixtures/expiry-original-media-20261128.json', import.meta.url)));

const policy = { version: 1, enabled: true, automaticExpiry: true, maxNewHidesPerRun: 5, expiryGraceHours: 12 };
const now = new Date('2026-11-27T20:00:00Z');
const caption = 'Am 27.11.2026 von 15:00 bis 19:00 Uhr feiern wir unsere Eröffnung! Döner gratis!';
const timed = { id: 'original-clock-offer', brand: 'Example', title: 'Döner gratis',
  description: 'Döner gratis bei der Eröffnung.', url: 'https://www.tiktok.com/@example/video/7710635479883992342',
  approvedAt: '2026-11-24T11:00:00Z', expiryKind: 'single', validOn: '2026-11-27',
  validFrom: '2026-11-27', validUntil: '2026-11-27', expires: '2026-11-27T18:00:00.000Z',
  expiresOriginal: '27.11.2026, 15:00 bis 27.11.2026, 19:00 Uhr',
  expiryDisplayText: '27.11.2026, 15:00 bis 27.11.2026, 19:00 Uhr' };
const withReceipt = (deal, sourceText) => ({ ...deal, approvedExpiryEvidence: captureApprovedExpiryEvidence(deal,
  { sourceText, verifiedAt: deal.approvedAt, now }) });

test('an actual privately bound original image confirms its clock without changing a location-only Graph rejection', () => {
  const { deal, edit, latest } = originalImageOffer;
  const end = Date.parse(deal.expires), options = { policy, scheduledExpiryOnly: true, edits: [edit], sourceEvidence: new Map([[deal.id, latest]]) };
  assert.equal(deal.metaGraphAccepted, false);
  assert.equal(deal.metaGraphRejection, 'missing-vienna-evidence');
  assert.equal(maintainDeals([deal], { ...options, now: new Date(end - 1) }).deals.length, 1);
  const result = maintainDeals([deal], { ...options, now: new Date(end) });
  assert.equal(result.deals.length, 0);
  assert.equal(result.report.hidden[0].reason, 'reviewed-original-image-event-window');
  assert.equal(result.state.hidden[0].originalDeal.metaGraphAccepted, false);
  for (const row of [
    { ...deal, approvedExpiryEvidence: undefined }, { ...deal, forceKeep: true },
    { ...deal, metaGraphRejection: 'withdrawn' }, { ...deal, metaGraphBlockingReason: 'source-unavailable' },
    { ...deal, metaGraphOcrText: deal.metaGraphOcrText.replace('12:00', '13:00') },
    { ...deal, ownerUsername: 'unrelated' }, { ...deal, sourcePublishedAt: '2026-11-24T19:05:15Z' },
    { ...deal, expires: '2026-11-28T12:00:00Z' },
    { ...deal, description: deal.description + ' Auch am 29. November.' },
    { ...deal, approvedExpiryEvidence: { ...deal.approvedExpiryEvidence, originalMedia:
      { ...deal.approvedExpiryEvidence.originalMedia, imageSha256: '0'.repeat(64) } } },
  ]) assert.equal(maintainDeals([row], { ...options, now: new Date(end) }).deals.length, 1);
  for (const next of [{ ...latest, blockingReason: 'source-unavailable' },
    { ...latest, ocrText: latest.ocrText.replace('12:00', '13:00') },
    { ...latest, caption: latest.caption + ' The offer remains available after the event.' },
    { ...latest, sourcePublishedAt: '2026-11-24T19:05:15Z' }]) {
    assert.equal(maintainDeals([deal], { ...options, now: new Date(end), sourceEvidence: new Map([[deal.id, next]]) }).deals.length, 1);
  }
  for (const graphRejection of ['post-too-old', 'offer-expired']) {
    assert.equal(maintainDeals([deal], { ...options, now: new Date(end), sourceEvidence: new Map([[deal.id,
      { ...latest, graphAccepted: false, graphRejection, blockingReason: graphRejection }]]) }).deals.length, 0);
  }
});

test('a genuine linked official coupon PDF preserves motorway exclusions and expires at its confirmed day end', () => {
  const before = new Date(Date.parse(linkedDocumentOffer.expires) - 1), after = new Date(linkedDocumentOffer.expires);
  assert.match(linkedDocumentOffer.approvedExpiryEvidence.sourceUrl, /(?:\.pdf|\/pdf)(?:\?|$)/);
  assert.ok(linkedDocumentOffer.approvedExpiryEvidence.sourceText.includes('Nicht gültig an Autobahnraststätten'));
  const options = { policy, scheduledExpiryOnly: true };
  assert.equal(maintainDeals([linkedDocumentOffer], { ...options, now: before }).deals.length, 1);
  const result = maintainDeals([linkedDocumentOffer], { ...options, now: after });
  assert.equal(result.deals.length, 0);
  assert.equal(result.state.hidden[0].originalDeal.approvedExpiryEvidence.sourceText, linkedDocumentOffer.approvedExpiryEvidence.sourceText);
  assert.equal(maintainDeals([{ ...linkedDocumentOffer, approvedExpiryEvidence: undefined }], { ...options, now: after }).deals.length, 1);
  assert.equal(maintainDeals([linkedDocumentOffer], { ...options, now: after,
    sourceEvidence: new Map([[linkedDocumentOffer.id, { blockingReason: 'newer-source-needs-review' }]]) }).deals.length, 1);
});

test('reviewed corrected event periods expire only with a final-period original receipt', () => {
  for (const { deal, edit, latest, expectedReason } of reviewedCorrections) {
    const original = { ...deal, approvedExpiryEvidence: captureApprovedExpiryEvidence(deal,
      { sourceText: deal.metaGraphCaption, verifiedAt: '2026-11-28T08:39:26.934Z', now: new Date('2026-11-28T09:00:00Z') }) };
    const options = { policy, scheduledExpiryOnly: true, edits: [edit], sourceEvidence: new Map([[deal.id, latest]]) };
    const end = Date.parse(deal.expires);
    assert.equal(maintainDeals([original], { ...options, now: new Date(end - 1) }).deals.length, 1, deal.id);
    const result = maintainDeals([original], { ...options, now: new Date(end) });
    assert.equal(result.deals.length, 0, deal.id);
    assert.equal(result.report.hidden[0].reason, expectedReason || (deal.expiryKind === 'range'
      ? 'reviewed-original-two-day-event-end' : 'reviewed-original-single-action-day'));
    for (const graphRejection of ['offer-expired', 'post-too-old']) {
      const dated = { ...latest, graphAccepted: false, graphRejection, blockingReason: graphRejection };
      assert.equal(maintainDeals([original], { ...options, now: new Date(end), sourceEvidence: new Map([[deal.id, dated]]) }).deals.length, 0);
      assert.equal(maintainDeals([original], { ...options, now: new Date(end), sourceEvidence: new Map([[deal.id,
        { ...dated, caption: dated.caption + ' Das Angebot wurde verlängert.' }]]) }).deals.length, 1);
    }
    assert.deepEqual(result.state.hidden[0].originalDeal, original);
    assert.equal(maintainDeals([deal], { ...options, now: new Date(end) }).deals.length, 1);
    for (const row of [
      { ...original, approvedExpiryEvidence: undefined },
      { ...original, forceKeep: true }, { ...original, campaignId: 'paid' }, { ...original, isBusinessAdvertisement: true },
      { ...original, ownerUsername: 'othermerchant' }, { ...original, sourcePublishedAt: '2026-11-20T12:00:00Z' },
      { ...original, expires: new Date(end - 3600000).toISOString() },
      { ...original, description: original.description + ' Das Angebot läuft weiter.' },
      { ...original, description: original.description + ' Das Angebot gilt auch am 10.12.2026.' },
      { ...original, approvedExpiryEvidence: captureApprovedExpiryEvidence(deal,
        { sourceText: deal.description, verifiedAt: '2026-11-28T08:39:26.934Z', now: new Date('2026-11-28T09:00:00Z') }) },
    ]) assert.equal(maintainDeals([row], { ...options, now: new Date(end) }).deals.length, 1, deal.id);
    for (const next of [{ ...latest, caption: latest.caption + ' Extended until December 10.' },
      { ...latest, blockingReason: 'source-unavailable' }, { ...latest, ownerUsername: 'unrelated' }]) {
      assert.equal(maintainDeals([original], { ...options, now: new Date(end), sourceEvidence: new Map([[deal.id, next]]) }).deals.length, 1);
    }
    for (const changedEdit of [{ ...edit, restoreDeal: true }, { ...edit, clearFields: ['validOn', 'expiresOriginal'] },
      { ...edit, validUntil: '2026-12-10' }, { ...edit, expires: new Date(end + 3600000).toISOString() }]) {
      assert.equal(maintainDeals([original], { ...options, edits: [changedEdit], now: new Date(end) }).deals.length, 1);
    }
  }
});

test('confirmed calendar end has no twelve-hour tail, but unproven dates still stay held', () => {
  const row = { ...timed, id: 'calendar-no-tail', expiryKind: 'end', validOn: '', validFrom: '',
    validUntil: '2026-11-27', expires: '2026-11-27T23:59:59.999Z',
    expiresOriginal: 'Bis 27.11.2026', expiryDisplayText: 'Bis 27.11.2026' };
  const original = withReceipt(row, '25% Rabatt. Gültig bis 27.11.2026.');
  const options = { policy, scheduledExpiryOnly: true };
  assert.equal(maintainDeals([original], { ...options, now: new Date('2026-11-27T23:59:59.998Z') }).deals.length, 1);
  assert.equal(maintainDeals([original], { ...options, now: new Date(row.expires) }).deals.length, 0);
  assert.equal(maintainDeals([row], { ...options, now: new Date('2026-11-28T08:26:00Z') }).deals.length, 1);
  const vienna = { ...row, expires: '2026-11-27T22:59:59.999Z' };
  const viennaOriginal = withReceipt(vienna, '25% Rabatt. Gültig bis 27.11.2026.');
  assert.equal(maintainDeals([viennaOriginal], { ...options, now: new Date('2026-11-27T22:59:59.998Z') }).deals.length, 1);
  assert.equal(maintainDeals([viennaOriginal], { ...options, now: new Date(vienna.expires) }).deals.length, 0);
  const unsupportedNoon = { ...row, expires: '2026-11-27T12:00:00Z' };
  assert.equal(maintainDeals([withReceipt(unsupportedNoon, '25% Rabatt. Gültig bis 27.11.2026.')],
    { ...options, now: new Date('2026-11-27T12:00:01Z') }).deals.length, 1);
});

test('identified original Turkish and English event windows expire at their Vienna clock, not end of day', () => {
  for (const [id, end] of [['g2-q3mjlw', '2026-11-27T18:00:00Z'], ['meta-ig-18358319731269651', '2026-11-27T14:00:00Z']]) {
    const original = auditedOriginals.find(row => row.id === id);
    const options = { policy, scheduledExpiryOnly: true };
    assert.equal(maintainDeals([original], { ...options, now: new Date(Date.parse(end) - 1) }).deals.length, 1, id);
    const result = maintainDeals([original], { ...options, now: new Date(end) });
    assert.equal(result.deals.length, 0, id);
    assert.equal(result.report.hidden[0].reason, 'confirmed-original-social-event-window', id);
    assert.deepEqual(result.state.hidden[0].originalDeal, original);
  }
});

test('original event windows require exact identity, trusted time and no newer or contradictory source', () => {
  const options = { policy, scheduledExpiryOnly: true, now: new Date('2026-11-28T08:26:00Z') };
  for (const original of auditedOriginals) {
    const captionField = original.postCaption ? 'postCaption' : 'metaGraphCaption';
    for (const row of [
      { ...original, url: 'https://www.instagram.com/p/DgHKC2NFT3h/' },
      { ...original, sourcePublishedAt: '2026-11-25T12:00:00Z' },
      { ...original, approvedAt: '2026-11-29T12:00:00Z' },
      { ...original, ownerUsername: 'unrelatedmerchant' },
      { ...original, forceKeep: true },
      { ...original, isBusinessAdvertisement: true },
      { ...original, [captionField]: '', description: original[captionField] },
      { ...original, description: original.description + ' Das Angebot läuft weiter.' },
      ...['Kampanya yarın da devam edecek.', 'Kampanya devam ediyor.',
        'This offer remains available after the opening event.', 'This price is also available after the event.']
        .map(note => ({ ...original, description: original.description + ' ' + note })),
      { ...original, description: original.description + ' Das Angebot endet um 20:00 Uhr.' },
      { ...original, description: original.description + ' Auch am 28.11.2026 gültig.' },
      { ...original, validityText: 'Das Angebot endet um 20:00 Uhr.' },
      { ...original, expires: '2026-11-27T16:00:00Z' },
    ]) assert.equal(maintainDeals([row], options).deals.length, 1, `${original.id}: ${JSON.stringify(row).slice(-180)}`);
    for (const latest of [{ blockingReason: 'source-unavailable' }, { officialText: 'Aktueller Vorteil ohne Enddatum.' },
      { caption: original[captionField] + ' Extended until November 30.', graphAccepted: true, url: original.url }]) {
      assert.equal(maintainDeals([original], { ...options, sourceEvidence: new Map([[original.id, latest]]) }).deals.length, 1);
    }
    assert.equal(maintainDeals([original], { ...options, edits: [{ dealId: original.id, restoreDeal: true }] }).deals.length, 1);
    assert.equal(maintainDeals([original], { ...options, edits: [{ dealId: original.id, validUntil: '2026-11-28' }] }).deals.length, 1);
    assert.equal(maintainDeals([original], { ...options, edits: [{ dealId: original.id, validityText: 'Angebot bis 20 Uhr.' }] }).deals.length, 1);
  }
});

test('hourly cleanup uses an original embedded window at its exact end and archives/replays it', () => {
  const original = withReceipt(timed, caption);
  const pending = { id: 'pending-copy', title: 'Kaffee', enrichmentPending: true, enrichmentFields: ['description'] };
  const options = { policy, scheduledExpiryOnly: true };
  assert.deepEqual(maintainDeals([original, pending], { ...options, now: new Date('2026-11-27T17:59:59.999Z') }).deals, [original, pending]);
  const result = maintainDeals([original, pending], { ...options, now: new Date(timed.expires) });
  assert.deepEqual(result.deals, [pending]);
  assert.equal(result.report.hidden[0].reason, 'confirmed-exact-offer-end');
  assert.deepEqual(result.state.hidden[0].originalDeal, original);
  const replay = maintainDeals([original, pending], { ...options, now, state: result.state });
  assert.equal(replay.report.hidden[0].replay, true);
  assert.equal(replay.state.hidden.length, 1);
});

test('stored times and editorial copy cannot replace original proof, newer source or owner corrections', () => {
  const original = withReceipt(timed, caption);
  for (const row of [timed, { ...timed, description: caption },
    { ...original, expires: '2026-11-27T17:00:00Z' }, { ...original, forceKeep: true }]) {
    assert.equal(maintainDeals([row], { policy, scheduledExpiryOnly: true, now }).deals.length, 1);
  }
  for (const latest of [{ blockingReason: 'source-unavailable' },
    { officialText: 'Die Aktion wurde verlängert bis 30.11.2026.' },
    { officialText: 'Aktueller Vorteil ohne Enddatum.' }]) {
    assert.equal(maintainDeals([original], { policy, now, scheduledExpiryOnly: true,
      sourceEvidence: new Map([[original.id, latest]]) }).deals.length, 1);
  }
  assert.equal(maintainDeals([original], { policy, now, scheduledExpiryOnly: true,
    edits: [{ dealId: original.id, expires: '2026-11-27T20:00:00Z' }] }).deals.length, 1);
});

test('hourly calendar cleanup retains source proof and ignores publication-age guesses', () => {
  const calendar = { ...timed, id: 'calendar', expiryKind: 'end', validOn: '', validFrom: '',
    validUntil: '2026-11-24', expires: '2026-11-24T23:59:59.999Z',
    expiresOriginal: 'Bis 24.11.2026', expiryDisplayText: 'Bis 24.11.2026' };
  const original = withReceipt(calendar, '25% Rabatt. Gültig bis 24.11.2026.');
  assert.equal(maintainDeals([original], { policy, now, scheduledExpiryOnly: true }).deals.length, 0);
  assert.equal(maintainDeals([calendar], { policy, now, scheduledExpiryOnly: true }).deals.length, 1);
  assert.equal(maintainDeals([original], { policy, now: new Date('2026-11-24T23:59:59.998Z'), scheduledExpiryOnly: true }).deals.length, 1);
  assert.equal(maintainDeals([original], { policy, now: new Date('2026-11-25T00:00:00Z'), scheduledExpiryOnly: true }).deals.length, 0);
});

test('negated, superseded and continuing calendar ends stay held while ordinary exclusions remain supported', () => {
  const calendar = { ...timed, id: 'calendar-negation', expiryKind: 'end', validOn: '', validFrom: '',
    validUntil: '2026-11-24', expires: '2026-11-24T23:59:59.999Z',
    expiresOriginal: 'Bis 24.11.2026', expiryDisplayText: 'Bis 24.11.2026' };
  for (const source of [
    '25% Rabatt. Nicht nur bis 24.11.2026 gültig, sondern weiterhin.',
    'Die Aktion endet nicht am 24.11.2026. Gültig bis 24.11.2026 war die alte Angabe.',
    '25% Rabatt gültig bis 24.11.2026. Die Aktion läuft weiter.',
    '25% Rabatt mindestens bis 24.11.2026.',
  ]) assert.equal(maintainDeals([withReceipt(calendar, source)], { policy, now, scheduledExpiryOnly: true }).deals.length, 1, source);
  const exclusions = withReceipt(calendar, '25% Rabatt. Nicht kombinierbar mit anderen Gutscheinen. Gültig bis 24.11.2026.');
  assert.equal(maintainDeals([exclusions], { policy, now, scheduledExpiryOnly: true }).deals.length, 0);
  const motorway = withReceipt(calendar, '25% Rabatt. Nicht gültig an Autobahnraststätten. Gültig bis 24.11.2026.');
  assert.equal(maintainDeals([motorway], { policy, now, scheduledExpiryOnly: true }).deals.length, 0);
  const negated = withReceipt(calendar, '25% Rabatt. Nicht gültig bis 24.11.2026.');
  assert.equal(maintainDeals([negated], { policy, now, scheduledExpiryOnly: true }).deals.length, 1);
});

test('conflicting current OCR clocks or edited display clocks veto an otherwise confirmed exact window', () => {
  const original = withReceipt(timed, caption);
  for (const description of [original.description + ' Das Gratis-Angebot endet um 20:00 Uhr.',
    original.description + ' Angebot bis 20 Uhr.']) {
    assert.equal(maintainDeals([{ ...original, description }], { policy, now, scheduledExpiryOnly: true }).deals.length, 1);
  }
  assert.equal(maintainDeals([original], { policy, now, scheduledExpiryOnly: true, sourceEvidence: new Map([[original.id,
    { caption, ocrText: 'Das Gratis-Angebot endet um 20:00 Uhr.' }]]) }).deals.length, 1);
});

test('approved only-today originals enter hourly cleanup without making publication age an expiry', () => {
  const today = { id: 'single-today', brand: 'Tischtennis', title: '3 Stunden um 5 €',
    description: 'Sondertarif für einen Spieltag.', url: 'https://www.instagram.com/p/DgHKC2NFT3h/',
    sourcePublishedAt: '2026-11-24T05:01:45.000Z', sourcePublishedAtSource: 'url.instagramShortcode',
    approvedAt: '2026-11-24T11:10:45Z', expiryKind: 'single', validOn: '2026-11-24', expires: '2026-11-24T23:59:59.999Z' };
  const original = withReceipt(today, 'Nur heute: 3 Stunden spielen um 5 €! Dieser Preis gilt nur für diesen Spieltag.');
  const result = maintainDeals([original], { policy, now, scheduledExpiryOnly: true });
  assert.deepEqual(result.deals, []);
  assert.equal(result.report.hidden[0].reason, 'confirmed-original-social-today');
  assert.equal(maintainDeals([today], { policy, now, scheduledExpiryOnly: true }).deals.length, 1);
  assert.equal(maintainDeals([original], { policy, now: new Date('2026-11-24T23:59:59.998Z'), scheduledExpiryOnly: true }).deals.length, 1);
  assert.equal(maintainDeals([original], { policy, now: new Date('2026-11-25T00:00:00Z'), scheduledExpiryOnly: true }).deals.length, 0);
});

test('scheduled file cleanup is local-only and persists its recovery state', async t => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'expiry-hourly-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  for (const folder of ['docs', 'reviews']) fs.mkdirSync(path.join(cwd, folder));
  const write = (file, value) => fs.writeFileSync(path.join(cwd, file), JSON.stringify(value));
  write('reviews/automatic-maintenance-policy.json', policy);
  write('docs/deals.json', { deals: [withReceipt(timed, caption)], totalDeals: 1 });
  let calls = 0;
  const result = await maintainFeedFile({ cwd, now, allowAi: true, apply: true, scheduledExpiryOnly: true,
    request: () => { calls++; throw Error('No provider calls authorized'); } });
  assert.equal(calls, 0);
  assert.equal(result.report.hidden.length, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(cwd, 'docs/deals.json'))).deals, []);
  assert.equal(JSON.parse(fs.readFileSync(path.join(cwd, 'reviews/automatic-deal-maintenance-state.json'))).hidden.length, 1);
});

test('the three owner removals replay durably while leaving other offers from those merchants available', () => {
  const archive = JSON.parse(fs.readFileSync(new URL('../reviews/expired-owner-2026-11-27.json', import.meta.url)));
  const store = loadLiveDealEditStore(new URL('../docs/live-deal-edits.json', import.meta.url));
  const moderation = JSON.parse(fs.readFileSync(new URL('../docs/deal-moderation.json', import.meta.url)));
  const unrelated = { id: 'another-marc-offer', brand: 'Marc O Polo', url: 'https://www.gutscheine.at/marc-o-polo', title: 'Andere Aktion' };
  const bundle = { deals: [...archive.deals, unrelated] };
  assert.deepEqual(applyLiveDealEditsToBundle(bundle, store, { allowManualRemovals: true, allowRemovals: false }).bundle.deals, [unrelated]);
  assert.deepEqual(filterModeratedDeals(bundle.deals, moderation).deals, [unrelated]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { captureApprovedExpiryEvidence } from './approved-expiry-evidence.mjs';
import { maintainDeals, maintainFeedFile } from './automatic-deal-maintenance.mjs';
import { applyLiveDealEditsToBundle, loadLiveDealEditStore } from './live-deal-edits-lib.mjs';
import { filterModeratedDeals } from '../scraper/deal-moderation-utils.js';

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

test('hourly calendar cleanup retains proof/grace and ignores publication-age guesses', () => {
  const calendar = { ...timed, id: 'calendar', expiryKind: 'end', validOn: '', validFrom: '',
    validUntil: '2026-11-24', expires: '2026-11-24T23:59:59.999Z',
    expiresOriginal: 'Bis 24.11.2026', expiryDisplayText: 'Bis 24.11.2026' };
  const original = withReceipt(calendar, '25% Rabatt. Gültig bis 24.11.2026.');
  assert.equal(maintainDeals([original], { policy, now, scheduledExpiryOnly: true }).deals.length, 0);
  assert.equal(maintainDeals([calendar], { policy, now, scheduledExpiryOnly: true }).deals.length, 1);
  assert.equal(maintainDeals([original], { policy, now: new Date('2026-11-25T11:59:59Z'), scheduledExpiryOnly: true }).deals.length, 1);
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
  assert.equal(maintainDeals([original], { policy, now: new Date('2026-11-25T11:59:59Z'), scheduledExpiryOnly: true }).deals.length, 1);
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

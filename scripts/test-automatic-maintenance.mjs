import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assessAutomaticExpiry, maintainDeals, maintainFeedFile, groundedMaintenanceTitle, automaticMaintenanceReviewCandidates, latestMaintenanceEvidence, protectedFields } from './automatic-deal-maintenance.mjs';

const now = new Date('2026-11-06T12:00:00Z');
const policy = { version: 1, enabled: true, automaticExpiry: true, automaticLocalCopy: true,
  maxNewHidesPerRun: 5, expiryGraceHours: 12, protectedMerchants: ['Wolt'], maxAiCandidatesPerRun: 4 };
const deal = { id: 'old', title: 'Gratis Kaffee', description: 'Gratis Kaffee bei der Aktion.', brand: 'Cafe Wien',
  url: 'https://www.instagram.com/p/test/', expiryKind: 'end', validUntil: '2026-11-04',
  expires: '2026-11-04T23:59:59.999Z', metaGraphCaption: 'Gratis Kaffee in Wien. Angebot gueltig bis 04.11.2026.' };
const assess = (record, date = now) => assessAutomaticExpiry(record, { policy, now: date });

test('manual edits with an explicit deal ID cannot protect or clear another offer on the same homepage', () => {
  const offer = { ...deal, id: 'one-official-offer', url: 'https://www.mcdonalds.at/' };
  const other = { dealId: 'another-official-offer', url: offer.url, description: 'Other campaign copy',
    clearFields: ['validUntil'], forceKeep: true };
  assert.deepEqual([...protectedFields(offer, [other])], []);
  assert.equal(assessAutomaticExpiry(offer, { now, policy, edits: [other] }).eligible, true);
  const sameId = { ...other, dealId: offer.id };
  assert.ok(protectedFields(offer, [sameId]).has('description'));
  assert.equal(assessAutomaticExpiry(offer, { now, policy, edits: [sameId] }).eligible, false);
  const legacyUrlOnly = { url: offer.url, description: 'Legacy reviewed copy', clearFields: ['validUntil'] };
  assert.ok(protectedFields(offer, [legacyUrlOnly]).has('description'));
  assert.equal(assessAutomaticExpiry(offer, { now, policy, edits: [legacyUrlOnly] }).eligible, false);
});

test('literal end date and year are required; old publication or a guessed structured TTL is insufficient', () => {
  assert.equal(assess(deal).eligible, true);
  for (const change of [{ metaGraphCaption: '' }, { metaGraphCaption: 'Gratis Kaffee bis 04.11.' },
    { metaGraphCaption: 'Gratis Kaffee bis 04.11.2025.' }, { expiryKind: '' }, { validUntil: '2026-02-30' },
    { expires: '2026-11-07T23:59:59Z' }, { validOn: '2026-11-03' },
    { metaGraphCaption: 'Veroeffentlicht am 04.11.2026. Gratis Kaffee.' }, { validFrom: '2026-11-07' }]) {
    assert.equal(assess({ ...deal, ...change }).eligible, false, JSON.stringify(change));
  }
});

test('a year in the publication label never supplies a missing action year; conflicting end dates never hide', () => {
  for (const metaGraphCaption of ['Veroeffentlicht am 01.11.2026. Gratis Kaffee bis 04.11.',
    'Gratis Kaffee bis 04.11.2026. Die neue Aktion gilt bis 30.11.2026.',
    'Gratis Kaffee bis 04.11.2026. Gültig bis 30. November 2026.',
    'Gratis Kaffee bis 04.11.2026. Neue Aktion bis 30.11.',
    'Gratis Kaffee bis 04.11.2026. Neue Aktion bis einschließlich 30. November.']) {
    assert.equal(assess({ ...deal, metaGraphCaption }).eligible, false, metaGraphCaption);
  }
  assert.equal(assess({ ...deal, metaGraphCaption: 'Gratis Kaffee bis 4. November 2026.' }).eligible, true);
});

test('confirmed date-only ends retain the stored day and expire without a twelve-hour tail', () => {
  for (const date of ['2026-11-04T22:59:59Z', '2026-11-04T23:59:59.998Z']) {
    assert.equal(assess(deal, new Date(date)).eligible, false, date);
  }
  for (const date of ['2026-11-04T23:59:59.999Z', '2026-11-05T00:01:00Z', '2026-11-05T11:59:59Z']) {
    assert.equal(assess(deal, new Date(date)).eligible, true, date);
  }
});

// A published single-day event whose Slack form and durable edit preserve the exact local time.
const tastingPeriod = {
  validOn: '2026-11-21', validFrom: '2026-11-21', validUntil: '2026-11-21', expiryKind: 'single',
  expires: '2026-11-21T12:00:00.000Z', expiresOriginal: '21.11.2026, 11:00 bis 21.11.2026, 13:00 Uhr',
  expiryDisplayText: '21.11.2026, 11:00 bis 21.11.2026, 13:00 Uhr',
};
const tasting = {
  ...tastingPeriod, id: 'meta-ig-17977851744156986', title: 'Gratis Kaffee-Tasting mit Reservierung',
  brand: 'Villa Vida Café', url: 'https://www.instagram.com/p/DfmtMyGuGVB/',
  originSource: 'Meta Instagram Business Discovery', metaGraphMediaId: '17977851744156986',
  sourcePublishedAt: '2026-11-11T14:34:00.000Z', sourcePublishedAtSource: 'url.instagramShortcode',
  metaGraphVerifiedAt: '2026-11-11T23:09:52.932Z', metaGraphVerified: true, metaGraphAccepted: true,
  sourceAccountType: 'merchant', metaGraphIsRepost: false, approvedAt: '2026-11-11T23:18:21.581Z',
  metaGraphCaption: 'Saturday 21.11 Women & Coffee: Specialty Coffee Cupping 11:00–13:00 · Free Villa Vida Café, Vienna',
  description: 'Am Samstag, 21.11.2026, von 11:00 bis 13:00 Uhr sechs Spezialitätenkaffees verkosten.',
  expirySource: 'manual', expiresSource: 'manual', expiresPrecision: 'day', dateConfidence: 'high',
  validityText: tastingPeriod.expiresOriginal,
};
const tastingEdit = { dealId: tasting.id, ...tastingPeriod };
const tastingEnd = new Date(tastingPeriod.expires);
const tastingObservation = {
  url: tasting.url, mediaId: tasting.metaGraphMediaId, caption: tasting.metaGraphCaption, ocrText: '',
  graphAccepted: false, blockingReason: 'post-too-old', verifiedAt: '2026-11-21T03:24:45.612Z',
  sourcePublishedAt: '2026-11-11T14:34:04.000Z', sourcePublishedAtSource: 'instagram-graph-timestamp',
};
const assessTasting = (record, edits, latestEvidence, time = tastingEnd) =>
  assessAutomaticExpiry(record, { policy, now: time, edits, latestEvidence });

test('a confirmed Vienna event stays until its precise end and is then removed in the same day’s maintenance', () => {
  const before = new Date('2026-11-21T11:59:59.999Z');
  assert.equal(assessTasting(tasting, [tastingEdit], tastingObservation, before).eligible, false);
  const sourceEvidence = latestMaintenanceEvidence([tasting], [tastingObservation], tastingEnd);
  assert.deepEqual([...sourceEvidence.keys()], [tasting.id]);
  const options = { policy, now: tastingEnd, edits: [tastingEdit], sourceEvidence };
  const cleaned = maintainDeals([tasting], options);
  assert.deepEqual(cleaned.deals.map(record => record.id), []);
  assert.equal(cleaned.report.hidden[0].id, tasting.id);
  assert.equal(cleaned.report.hidden[0].reason, 'confirmed-exact-offer-end');
  const replay = maintainDeals([tasting], { ...options, state: cleaned.state });
  assert.equal(replay.report.hidden[0].replay, true);
  assert.equal(replay.state.hidden.length, 1);
});

test('independent proof of a full time range can come from a recorded Slack edit or the captured source', () => {
  const slack = { ...tasting, editedInSlack: true, slackEditedAt: '2026-11-11T23:06:47.262Z',
    slackEditedFields: ['expires', 'expiresOriginal', 'expiryDisplayText', 'validityText'] };
  assert.equal(assessTasting(slack, []).reason, 'confirmed-exact-offer-end');
  assert.equal(assessTasting({ ...slack, slackEditedFields: ['title', 'expires'] }, []).eligible, false);
  const source = { ...tasting, expiresSource: 'url', expirySource: 'url',
    evidence: { offerTiming: { matchedText: tastingPeriod.expiresOriginal } } };
  assert.equal(assessTasting(source, []).reason, 'confirmed-exact-offer-end');
  const hoursOnly = { offerTiming: { matchedText: 'Nur heute, von 11:00 bis 13:00 Uhr.' } };
  assert.equal(assessTasting({ ...source, evidence: hoursOnly }, []).eligible, false);
  assert.equal(assessTasting(tasting, []).eligible, false);
});

test('changed or blocked source evidence, a conflicting manual edit and owner protections hold the timed event', () => {
  for (const patch of [{ url: 'https://www.instagram.com/p/OtherPost/' }, { mediaId: 'different' },
    { caption: '' }, { caption: 'New event tomorrow.' }, { ocrText: 'Verlängert bis 22.11.' },
    { blockingReason: 'excerpt-withdrawn' }]) {
    assert.equal(assessTasting(tasting, [tastingEdit], { ...tastingObservation, ...patch }).eligible, false, JSON.stringify(patch));
  }
  for (const patch of [{ expires: '2026-11-21T17:00:00.000Z' }, { validUntil: '2026-11-22' },
    { expiresOriginal: '21.11.2026, 11:00 bis 21.11.2026, 17:00 Uhr' },
    { forceKeep: true }, { restoreDeal: tasting }, { clearFields: ['validUntil'] }]) {
    assert.equal(assessTasting(tasting, [{ ...tastingEdit, ...patch }]).eligible, false, JSON.stringify(patch));
  }
  assert.equal(assessTasting({ ...tasting, forceKeep: true }, [tastingEdit]).eligible, false);
  assert.equal(assessTasting({ ...tasting, validFrom: '2026-11-20' }, [tastingEdit]).eligible, false);
  const changedTime = '21.11.2026, 11:00 bis 21.11.2026, 18:00 Uhr';
  const conflictingSource = { ...tasting, evidence: { offerTiming: { matchedText: changedTime } } };
  assert.equal(assessTasting(conflictingSource, [tastingEdit]).eligible, false, 'source specifies a later time on the same day');
  const source = { ...tasting, evidence: { offerTiming: { matchedText: tastingPeriod.expiresOriginal } } };
  assert.equal(assessTasting(source, [{ ...tastingEdit, expiresOriginal: changedTime }]).eligible, false,
    'even corroborating source evidence must respect an inconsistent owner edit');
});

test('an exact range uses the Vienna calendar day across UTC midnight and rejects ambiguous local clocks', () => {
  function evaluate(raw, day, expires) {
    const period = { ...tastingPeriod, expiresOriginal: raw, expiryDisplayText: raw,
      validOn: day, validFrom: day, validUntil: day, expires };
    const record = { id: 'timed-event', title: 'Verkostung', validityText: raw, description: 'Einmalige Verkostung.',
      expirySource: 'manual', expiresSource: 'manual', ...period };
    return assessTasting(record, [{ dealId: record.id, ...period }], undefined, new Date(expires));
  }
  assert.equal(evaluate('21.07.2026, 00:05 bis 21.07.2026, 00:30 Uhr', '2026-07-21',
    '2026-07-20T22:30:00.000Z').reason, 'confirmed-exact-offer-end');
  assert.equal(evaluate('25.10.2026, 01:00 bis 25.10.2026, 02:30 Uhr', '2026-10-25',
    '2026-10-25T01:30:00.000Z').eligible, false);
});

test('hourly expiry removes confirmed timed and calendar ends while preserving pending copy work', () => {
  const pending = { id: 'pending-text', title: 'Gratis Getränk', description: 'Standort folgt.',
    enrichmentPending: true, enrichmentFields: ['description'] };
  const run = maintainDeals([deal, tasting, pending], {
    policy, edits: [tastingEdit], now: tastingEnd, scheduledExpiryOnly: true,
  });
  assert.deepEqual(run.deals, [pending], 'source-confirmed date-only expiry is also checked hourly');
  assert.deepEqual(run.report.hidden.map(record => record.id), [deal.id, tasting.id]);
  assert.deepEqual(run.report.corrected, []);
});

test('newer exact-post Graph captions override old expiry snapshots, including removed dates and extensions', () => {
  const original = { ...deal, url: 'https://www.instagram.com/p/DfYCVxHFu4q/' };
  for (const caption of ['Aktion verlängert, Gratis Kaffee bis 30.11.2026.', 'Gratis Kaffee in Wien, aktueller Vorteil ohne Enddatum.']) {
    const sourceEvidence = latestMaintenanceEvidence([original], [{ url: original.url, verifiedAt: '2026-11-06T10:00:00Z', caption }], now);
    assert.equal(maintainDeals([original], { policy, now, sourceEvidence }).deals.length, 1, caption);
  }
  const unrelated = latestMaintenanceEvidence([original], [{ url: 'https://www.instagram.com/p/Other/', verifiedAt: '2026-11-06T10:00:00Z', caption: 'Aktion verlängert.' }], now);
  assert.equal(unrelated.size, 0);
  assert.equal(maintainDeals([original], { policy, now, sourceEvidence: unrelated }).deals.length, 0);
});

test('a manually saved full single day corroborates original yearless OCR, but copy edits and timestamps do not', () => {
  const record = { id: 'flamm-example', brand: 'flamm.vie', title: '1+1 Steak-Döner am 6.11.',
    description: 'Aktion ausschließlich am 6. November.', expiryKind: 'single', validOn: '2026-11-06',
    expires: '2026-11-06T23:59:59.999Z', sourcePublishedAt: '2026-11-04T17:34:23.000Z',
    url: 'https://www.instagram.com/reel/DfVARy_I2AK/',
    evidence: { mediaEvidence: { ocrText: 'AKTION IN WIEN Nurjam 06.11. Thaliastraße 25/7' } } };
  const after = new Date('2026-11-09T19:03:02Z');
  const copyOnly = { dealId: record.id, title: record.title, description: record.description };
  const confirmed = { ...copyOnly, validOn: record.validOn };
  const check = (input = record, edits = [confirmed], latestEvidence, date = after) =>
    assessAutomaticExpiry(input, { policy, edits, latestEvidence, now: date });
  assert.equal(check(record, [copyOnly]).eligible, false);
  assert.equal(check(record, []).eligible, false);
  assert.equal(check().reason, 'editor-confirmed-single-day');
  assert.equal(check(record, [confirmed], undefined, new Date('2026-11-06T21:00:00Z')).eligible, false);
  assert.equal(maintainDeals([record], { policy, edits: [confirmed], now: after }).deals.length, 0);
  for (const edit of [{ ...confirmed, validOn: '2026-11-08' }, { ...confirmed, forceKeep: true },
    { ...confirmed, hidden: true }, { ...confirmed, clearFields: ['validOn'] }, { ...confirmed, restoreDeal: record }]) {
    assert.equal(check(record, [edit]).eligible, false);
  }
  for (const latest of [{ caption: 'Kein konkretes Datum mehr.' }, { caption: 'Nur am 8. November.' },
    { caption: 'Nur am 6. November 2025.' }, { caption: 'Verlängert bis 30. November.' },
    { caption: 'Nur am 6. November.', blockingReason: 'source blocked' }]) {
    assert.equal(check(record, [confirmed], latest).eligible, false, latest.caption);
  }
  assert.equal(check(record, [confirmed], { caption: 'Nur am 6. November.' }).eligible, true);
  assert.equal(check({ ...record, metaGraphCaption: 'Nur am 6. November. Nur am 7. November.' }).eligible, false);
  assert.equal(check({ ...record, description: 'Ausschließlich am 7. November.' }).eligible, false);
});

function originalPost(timestamp, caption, fields = {}) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let mediaId = (BigInt(Date.parse(timestamp)) - 1314220021300n) << 23n;
  let shortcode = '';
  while (mediaId > 0n) {
    shortcode = alphabet[Number(mediaId & 63n)] + shortcode;
    mediaId >>= 6n;
  }
  return { id: `post-${shortcode}`, url: `https://www.instagram.com/reel/${shortcode}/`, title: '1+1 Steak-Döner',
    description: 'Ein Steak-Döner gratis beim Kauf eines weiteren.', caption, sourcePublishedAt: timestamp,
    sourcePublishedAtSource: 'url.instagramShortcode', ...fields };
}

test('a complete literal one-day time window in the original post expires at the exact confirmed end', () => {
  const record = originalPost('2026-11-04T17:34:23Z',
    'Follower bekommen am 06.11.2026 von 12:00 bis 15:00 einen gratis Semmel-Döner.', {
      expiryKind: 'single', validFrom: '2026-11-06', validOn: '2026-11-06',
      validUntil: '2026-11-06', expires: '2026-11-06T14:00:00Z',
    });
  const edit = { dealId: record.id, validOn: record.validOn };
  const afterGrace = new Date('2026-11-07T12:01:00Z');
  const check = (input = record, edits = [edit], time = afterGrace, latestEvidence) =>
    assessAutomaticExpiry(input, { policy, edits, now: time, latestEvidence });
  assert.equal(check().reason, 'confirmed-exact-offer-end');
  assert.equal(check(record, []).eligible, true, 'the literal full-year range independently confirms the stored end');
  assert.equal(check(record, [edit], new Date('2026-11-06T13:59:59.999Z')).eligible, false);
  assert.equal(check(record, [edit], afterGrace, { caption: 'Neue Aktion bis 08.11.2026.' }).eligible, false);
  for (const caption of [
    'Am 06.11. von 12:00 bis 15:00 gibt es ein Angebot.',
    'Nicht am 06.11.2026 von 12:00 bis 15:00.',
    'Am 06.11.2026 von 12:00 bis 15:00 und am 08.11. gibt es ein Angebot.',
    'Repost: Am 06.11.2026 von 12:00 bis 15:00 gibt es ein Angebot.',
    'Am 06.11.2026 von 22:00 bis 20:00 gibt es ein Angebot.',
    'Am 06.11.2026 von 8:00 bis 08:00 gibt es ein Angebot.',
    'Am 06.11.2026 von 12:00 bis 15:00 am nächsten Tag.',
    'Am 06.11.2026 von 12:00 bis 15:00. Die Aktion läuft weiter.',
  ]) {
    assert.equal(check({ ...record, caption }).eligible, false, caption);
  }
});

test('exact original Instagram publication proves a nearby yearless single day, including original Reel OCR', () => {
  const record = originalPost('2026-11-04T17:34:23Z', '', { url: 'https://www.instagram.com/reel/DfVARy_I2AK/',
    validOn: '2026-11-06', expiryKind: 'single', evidence: { mediaEvidence: { ocrText: 'AKTION IN WIEN Nurjam 06.11. Thaliastraße 25/7' } } });
  assert.equal(assess(record).eligible, false);
  const after = new Date('2026-11-08T12:00:00Z');
  const result = assess(record, after);
  assert.equal(result.eligible, true);
  assert.equal(result.validUntil, '2026-11-06');
  assert.equal(result.reason, 'year-inferred-from-original-post');
  assert.equal(result.originalPostPublishedAt, '2026-11-04T17:34:23.666Z');
  const { deals, state } = maintainDeals([record], { policy, now: after });
  assert.equal(deals.length, 0);
  assert.deepEqual(state.hidden[0].originalDeal, record);
});

const dahabCaption = '1 + 1 Döner GRATIS! Bei allen unseren Dönersorten zu jedem Döner einen GRATIS dazu🔥✅ 📍am 21.11 in der Schönbrunner Straße 149, 1050 Wien';
const dahab = {
  id: 'meta-ig-18046812119830342', url: 'https://www.instagram.com/reel/Df2WDjtONVV/', title: '1 + 1 Döner gratis!',
  description: dahabCaption, metaGraphCaption: dahabCaption, metaGraphOcrText: '', metaGraphMediaId: '18046812119830342',
  brand: 'Dahab Döner', ownerUsername: 'dahabdoener', merchantUsername: 'dahabdoener', sourceAccountType: 'merchant',
  source: 'Instagram', originSource: 'Meta Instagram Business Discovery', metaGraphVerified: true,
  metaGraphAccepted: true, metaGraphIsRepost: false, metaGraphVerifiedAt: '2026-11-17T19:40:02.862Z',
  sourcePublishedAt: '2026-11-17T16:19:37.000Z', sourcePublishedAtSource: 'url.instagramShortcode',
  discoveredAt: '2026-11-17T19:40:02.000Z', approvedAt: '2026-11-17T20:53:38.203Z',
  validOn: '2026-11-21', expires: '2026-11-21T23:59:59.999Z', expiryKind: 'single', dateConfidence: 'medium',
  expiryDisplayText: '2026-11-21T23:59:59.999Z', expiresOriginal: '2026-11-21T23:59:59.999Z',
  evidence: { mediaId: '18046812119830342', username: 'dahabdoener', sourceType: 'account',
    entityResolution: { ownerUsername: 'dahabdoener', ownerRole: 'merchant', merchantUsername: 'dahabdoener',
      merchantRole: 'merchant', resolutionMethod: 'owner-is-merchant' } },
};
const dahabGraph = {
  url: dahab.url, postKey: 'instagram:Df2WDjtONVV', mediaId: dahab.metaGraphMediaId, ownerUsername: 'dahabdoener',
  sourceAccountType: 'merchant', isRepost: false, mediaType: 'VIDEO', mediaProductType: 'REELS',
  caption: dahabCaption, ocrText: '', graphAccepted: true, blockingReason: '', verifiedAt: '2026-11-21T07:02:07.203Z',
  sourcePublishedAt: '2026-11-17T16:21:27.000Z', sourcePublishedAtSource: 'instagram-graph-timestamp',
};
const afterDahabGrace = new Date('2026-11-22T12:00:00Z');
const assessDahab = (record, latestEvidence) =>
  assessAutomaticExpiry(record, { policy, latestEvidence, now: afterDahabGrace });

test('an accepted original merchant post with a yearless one-day offer expires after its confirmed day', () => {
  const sourceEvidence = latestMaintenanceEvidence([dahab], [dahabGraph], afterDahabGrace);
  const laterOffer = { id: 'other-dahab-offer', brand: dahab.brand, title: 'Drei Döner zum Preis von zwei',
    expiryKind: 'range', validFrom: '2026-11-03', validUntil: '2026-11-30' };
  const entries = [dahab, laterOffer];
  for (const time of ['2026-11-21T20:00:00Z', '2026-11-21T23:59:59.998Z']) {
    assert.deepEqual(maintainDeals(entries, { policy, now: new Date(time), sourceEvidence }).deals, entries, time);
  }
  assert.deepEqual(maintainDeals(entries, { policy, now: new Date('2026-11-22T00:00:00Z'), sourceEvidence }).deals, [laterOffer]);
  const result = assessDahab(dahab, dahabGraph);
  assert.equal(result.validUntil, '2026-11-21');
  assert.equal(result.reason, 'confirmed-original-instagram-single-day');
  const expired = maintainDeals(entries, { policy, now: afterDahabGrace, sourceEvidence });
  assert.deepEqual(expired.deals, [laterOffer]);
  assert.deepEqual(expired.report.hidden.map(record => record.id), [dahab.id]);
  assert.deepEqual(maintainDeals(entries, { policy, now: afterDahabGrace, sourceEvidence,
    scheduledExpiryOnly: true }).deals, [laterOffer]);
});

test('a bare offer day needs the original merchant and two independently attributable publication clocks', () => {
  assert.equal(assessDahab(dahab, undefined).eligible, false);
  for (const patch of [{ mediaId: '999' }, { url: 'https://www.instagram.com/p/DfmtMyGuGVB/' },
    { ownerUsername: 'othermerchant' }, { graphAccepted: false }, { blockingReason: 'source-unavailable' }, { isRepost: true },
    { sourcePublishedAt: '2026-11-17T16:24:39Z' }, { sourcePublishedAtSource: 'discoveredAt' }]) {
    assert.equal(assessDahab(dahab, { ...dahabGraph, ...patch }).eligible, false, JSON.stringify(patch));
  }
  for (const patch of [{ validOn: '2026-11-20' }, { sourcePublishedAtSource: 'createdAt' }, { metaGraphIsRepost: true },
    { sourceAccountType: 'curator' }]) {
    assert.equal(assessDahab({ ...dahab, ...patch }, dahabGraph).eligible, false, JSON.stringify(patch));
  }
  const caption = dahabCaption.replace('21.11', '21.12'), expires = '2026-12-21T23:59:59.999Z';
  const farFuture = { ...dahab, description: caption, metaGraphCaption: caption, validOn: '2026-12-21',
    expires, expiresOriginal: expires, expiryDisplayText: expires };
  assert.equal(assessAutomaticExpiry(farFuture, { policy, latestEvidence: { ...dahabGraph, caption },
    now: new Date('2026-12-23T12:00:00Z') }).eligible, false, 'event must be near the original publication date');
});

test('a later age or expiry flag can preserve an unchanged verified merchant observation', () => {
  for (const blockingReason of ['offer-expired', 'post-too-old']) {
    const latest = { ...dahabGraph, verifiedAt: '2026-11-22T08:00:00.000Z', graphAccepted: false, blockingReason,
      graphRejection: blockingReason };
    assert.equal(assessDahab(dahab, latest).eligible, true, blockingReason);
    assert.equal(assessDahab(dahab, { ...latest, caption: 'Angebot verlängert.' }).eligible, false);
    assert.equal(assessDahab({ ...dahab, metaGraphAccepted: false }, latest).eligible, false);
  }
});

test('a bare date in repeated captions, start notices or recurring offers cannot establish the end of a deal', () => {
  for (const caption of [
    '1+1 Döner gratis. Die Aktion startet am 21.11 in der Schönbrunner Straße.',
    '1+1 Döner jeden Samstag, auch am 21.11 in der Schönbrunner Straße.',
    '1+1 Döner gratis am 21.11 und am 22.11 in der Schönbrunner Straße.',
    '1+1 Döner gratis. Foto aufgenommen am 21.11 in der Schönbrunner Straße.',
    '1+1 Döner gratis. Wir erzählen euch am 21.11 mehr zum Angebot.',
  ]) {
    const record = { ...dahab, description: caption, metaGraphCaption: caption };
    assert.equal(assessDahab(record, { ...dahabGraph, caption }).eligible, false, caption);
  }
  assert.equal(assessDahab(dahab, { ...dahabGraph, caption: '1+1 Döner ohne festen Endtermin.' }).eligible, false);
});

test('year rollover uses Vienna days, not run year, even without a structured end', () => {
  for (const [posted, caption, end] of [
    ['2026-12-29T10:00:00Z', 'Angebot gültig bis einschließlich 3. Jänner.', '2027-01-03'],
    ['2026-12-31T23:30:00Z', 'Nur am 01.01.', '2027-01-01'],
    ['2026-12-29T10:00:00Z', 'Nur am 31. Dezember.', '2026-12-31'],
    ['2028-02-27T13:00:00Z', 'Nur am 29. Februar.', '2028-02-29'],
  ]) {
    const record = originalPost(posted, caption);
    assert.equal(assess(record, new Date(`${end}T23:00:00Z`)).eligible, false, caption);
    assert.equal(assess(record, new Date(Date.parse(end) + 36 * 3600000)).validUntil, end, caption);
  }
});

test('reposts, stale capture, uncertain clauses and contradictory dates stay in manual review', () => {
  const after = new Date('2027-01-09T12:00:00Z');
  const record = originalPost('2026-12-29T10:00:00Z', 'Nur am 3. Jänner.');
  const other = originalPost('2025-12-29T10:00:00Z', 'Nur am 3. Jänner.');
  for (const change of [
    { caption: 'Repost: Nur am 3. Jänner.' }, { isReshare: true },
    { evidence: { originalPost: { url: other.url } } }, { caption: `Nur am 3. Jänner. ${other.url}` },
    { discoveredAt: '2027-01-15T00:00:00Z' }, { sourcePublishedAt: '2025-12-29T10:00:00Z' },
    { sourcePublishedAtSource: 'createdAt' }, { caption: 'Nur am 28. Dezember.' },
    { caption: 'Nur am 20. Jänner.' }, { caption: 'Nur am 30. Februar.' },
    { caption: 'Nur am 03.01.26.' }, { caption: 'Nur am 3. oder 4. Jänner. Nur am 3. Jänner.' },
    { caption: 'Nur am 03.01. und 04.01.' }, { caption: 'Nur am 3. Jänner. Nur am 4. Jänner.' },
    { caption: 'Gültig vom 30 Dezember bis 3. Jänner.' }, { caption: 'Nicht nur am 3. Jänner.' },
    { description: 'Aktion am 7. Jänner.' }, { validOn: '2026-01-03' },
    { evidence: { offerDateSignal: 'Nur am 2026-01-03.' } },
    { expires: '2026-01-03T23:59:59.999Z' }, { validFrom: '2026-12-31' },
    { caption: 'Teilnahmeschluss bis 3. Jänner.' },
  ]) {
    assert.equal(assess({ ...record, ...change }, after).reason, 'original-post-date-needs-manual-review', JSON.stringify(change));
  }
  const result = maintainDeals([{ ...record, isRepost: true }], { policy, now: after });
  assert.equal(result.deals.length, 1);
  assert(result.report.review.some(entry => entry.id === record.id && entry.reason === 'original-post-date-needs-manual-review'));
});

test('latest Graph evidence and owner edits can veto inferred expiry', () => {
  const record = originalPost('2026-11-04T10:00:00Z', 'Nur am 06.11.');
  const after = new Date('2026-11-09T12:00:00Z');
  const latest = { url: record.url, graphAccepted: true, mediaId: '123', caption: 'Nur am 6. November.',
    sourcePublishedAt: record.sourcePublishedAt, sourcePublishedAtSource: 'instagram-graph-timestamp' };
  const check = (latestEvidence, edits = []) => assessAutomaticExpiry(record, { policy, now: after, latestEvidence, edits });
  assert.equal(check(latest).eligible, true);
  for (const change of [{ blockingReason: 'post-too-old' }, { caption: 'Aktion verlängert.' }, { graphAccepted: false },
    { caption: 'Kein Datum mehr.' }, { url: 'https://www.instagram.com/reel/Other/' }, { sourcePublishedAt: '2026-11-03T10:00:00Z' }]) {
    assert.equal(check({ ...latest, ...change }).eligible, false, JSON.stringify(change));
  }
  for (const edit of [{ forceKeep: true }, { clearFields: ['validOn'] }, { restoreDeal: record }, { validOn: '2026-11-07' }]) {
    assert.equal(check(latest, [{ dealId: record.id, ...edit }]).eligible, false, JSON.stringify(edit));
  }
});

test('permanent, birthday, extended and uncertain offers are retained; a finite recurring campaign may expire', () => {
  for (const description of ['Dauerhaft gratis.', 'Gratis zum Geburtstag.', 'Bis auf weiteres.', 'Die Aktion wurde verlaengert.', 'Voraussichtlich bis 4.11.']) {
    assert.equal(assess({ ...deal, description }).eligible, false, description);
  }
  assert.equal(assess({ ...deal, description: 'Jeden Montag in diesem Aktionszeitraum.' }).eligible, true);
});

test('manual date corrections, forceKeep, business campaigns and Wolt cannot be overridden', () => {
  for (const change of [{ forceKeep: true }, { campaignId: 'ad' }, { brand: 'Wolt' },
    { validUntil: '2026-11-30', expires: '2026-11-30T23:59:59Z', liveEditedFields: ['validUntil'] }]) {
    assert.equal(assess({ ...deal, ...change }).eligible, false, JSON.stringify(change));
  }
  assert.equal(assessAutomaticExpiry(deal, { policy, now, edits: [{ dealId: deal.id, forceKeep: true }] }).eligible, false);
  assert.equal(assessAutomaticExpiry(deal, { policy, now, edits: [{ dealId: deal.id, validUntil: '2026-11-30' }] }).eligible, false);
  assert.equal(assessAutomaticExpiry(deal, { policy, now, edits: [{ dealId: deal.id, clearFields: ['validUntil'] }] }).eligible, false);
});

test('automatic hiding preserves full originals; identical old records stay hidden, renewals are not suppressed', () => {
  const original = structuredClone(deal);
  const first = maintainDeals([deal], { policy, now });
  assert.equal(first.deals.length, 0);
  assert.deepEqual(first.state.hidden[0].originalDeal, original);
  const replay = maintainDeals([deal], { policy, now, state: first.state });
  assert.equal(replay.deals.length, 0);
  assert.equal(replay.state.hidden.length, 1);
  const renewal = { ...deal, validUntil: '2026-11-30', expires: '2026-11-30T23:59:59Z', metaGraphCaption: 'Gratis Kaffee bis 30.11.2026.' };
  assert.equal(maintainDeals([renewal], { policy, now, state: first.state }).deals.length, 1);
  assert.deepEqual(deal, original);
});

test('blast radius is capped and unrelated prices, IDs, votes and ordering stay exact', () => {
  const old = Array.from({ length: 8 }, (_, i) => ({ ...deal, id: `old-${i}` }));
  const future = { ...deal, id: 'future', votes: 19, price: 2, validUntil: '2026-12-31', expires: '2026-12-31T23:59:59Z' };
  const result = maintainDeals([...old, future], { policy, now });
  assert.equal(result.report.newHides, 5);
  assert.deepEqual(result.deals.map(row => row.id), ['old-5', 'old-6', 'old-7', 'future']);
  assert.deepEqual(result.deals.at(-1), future);
});

test('manual titles and descriptions are preserved; deterministic compaction keeps original conditions', () => {
  const input = { id: 'copy', title: 'Jetzt Sichere dir 20 Prozent Rabatt auf ausgewählte Snacks', description: 'Nur mit Gutschein. Mindestbestellwert 10 Euro.' };
  const result = maintainDeals([input], { policy, now });
  assert.equal(result.report.corrected.length, 1);
  assert(result.deals[0].description.includes(input.description));
  assert(result.deals[0].description.includes(input.title));
  const replay = maintainDeals([input], { policy, now, state: result.state });
  assert.equal(replay.deals[0].title, result.deals[0].title);
  for (const field of ['title', 'description']) {
    assert.deepEqual(maintainDeals([{ ...input, liveEditedFields: [field] }], { policy, now }).deals[0], { ...input, liveEditedFields: [field] });
    assert.deepEqual(maintainDeals([input], { policy, now, edits: [{ dealId: input.id, [field]: input[field] }] }).deals[0], input);
    const cleared = { ...input, [field]: '' };
    assert.deepEqual(maintainDeals([cleared], { policy, now, edits: [{ dealId: input.id, clearFields: [field] }] }).deals[0], cleared);
  }
});

test('preview is read-only and a disabled/missing owner policy cannot edit anything', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maintenance-'));
  try {
    fs.mkdirSync(path.join(root, 'docs'));
    fs.mkdirSync(path.join(root, 'reviews'));
    const feed = JSON.stringify({ deals: [deal], totalDeals: 1 });
    fs.writeFileSync(path.join(root, 'docs/deals.json'), feed);
    fs.writeFileSync(path.join(root, 'reviews/automatic-maintenance-policy.json'), JSON.stringify(policy));
    await maintainFeedFile({ cwd: root, now, apply: false, request: () => assert.fail('no network') });
    assert.equal(fs.readFileSync(path.join(root, 'docs/deals.json'), 'utf8'), feed);
    assert.equal(fs.existsSync(path.join(root, 'reviews/automatic-deal-maintenance-state.json')), false);
    const result = await maintainFeedFile({ cwd: root, now, apply: true });
    assert.equal(result.deals.length, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'reviews/automatic-deal-maintenance-state.json'))).hidden[0].originalDeal, deal);
    assert.deepEqual(maintainDeals([deal], { now, policy: { ...policy, enabled: false } }).deals, [deal]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('model approval cannot drop coupon, membership, quantities or purchase thresholds', () => {
  for (const quote of ['Gratis Kaffee mit Gutschein', 'Gratis Kaffee mit Code TEST', 'Gratis Kaffee mit App',
    'Gratis Kaffee für Mitglieder', 'Gratis Kaffee für Neukunden', 'Jeder 10. Kaffee gratis', 'Gratis Kaffee ab 10 Euro']) {
    assert.equal(groundedMaintenanceTitle('Gratis Kaffee', quote, [quote]), false, quote);
  }
  assert.equal(groundedMaintenanceTitle('Gratis Kaffee mit Gutschein', 'Gratis Kaffee mit Gutschein', ['Gratis Kaffee mit Gutschein']), true);
  assert.equal(groundedMaintenanceTitle('Kaffee für 2,50 Euro', 'Kaffee für 2,50 Euro', ['Kaffee für 2,50 Euro']), true);
});

test('unclear maintenance cases enter the existing manual Slack review without auto-approval or stale hints', () => {
  const report = { mode: 'owner-authorized-source-backed', checkedAt: now.toISOString(), review: [{ id: deal.id, reason: 'source-year-or-end-not-confirmed' }] };
  const rows = automaticMaintenanceReviewCandidates(report, now);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].details.automaticRemovalEligible, false);
  assert.match(rows[0].reason, /bleibt sichtbar/);
  assert.deepEqual(automaticMaintenanceReviewCandidates(report, new Date(+now + 49 * 3600000)), []);
});

test('a grounded automatic AI title uses two roles and preserves all original conditions and metadata', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maintenance-ai-'));
  const savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'offline-fixture';
  try {
    const input = { id: 'long-title', title: 'Unsere fantastische neue Kaffeeaktion in Wien mit vielen Worten und einer besonders langen Überschrift',
      description: 'Nur solange der Vorrat reicht.', metaGraphCaption: 'Gratis Kaffee mit Gutschein in Wien.', votes: 17, approvedAt: '2026-11-01T10:00:00Z' };
    fs.mkdirSync(path.join(root, 'docs')); fs.mkdirSync(path.join(root, 'reviews'));
    fs.writeFileSync(path.join(root, 'docs/deals.json'), JSON.stringify({ deals: [input], totalDeals: 1 }));
    fs.writeFileSync(path.join(root, 'reviews/automatic-maintenance-policy.json'), JSON.stringify(policy));
    const models = [];
    const request = async (_url, init) => {
      const body = JSON.parse(init.body); models.push(body.model);
      assert.equal(body.reasoning_effort,'max');
      assert.equal(body.max_completion_tokens,8192);
      const verification = body.response_format.json_schema.schema.required.includes('supported');
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(verification
        ? { supported: true } : { title: 'Gratis Kaffee mit Gutschein', quote: input.metaGraphCaption }) } }] });
    };
    const result = await maintainFeedFile({ cwd: root, now, apply: true, allowAi: true, request });
    assert.deepEqual(models, ['gpt-6.2-sol', 'gpt-6.2-sol']);
    assert.equal(result.deals[0].title, 'Gratis Kaffee mit Gutschein');
    assert.equal(result.deals[0].description,input.description,'title-only patch must not append unreviewed text');
    assert.equal(result.deals[0].votes, 17);
    assert.equal(result.deals[0].approvedAt, input.approvedAt);
    assert.equal(result.state.corrections[0].originalTitle, input.title);
    assert.deepEqual(result.state.corrections[0].models,{editor:'gpt-6.2-sol',review:'gpt-6.2-sol'});
    assert.equal(result.state.corrections[0].reasoningEffort,'max');
  } finally {
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = savedKey;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a captured coupon end binds to the exact card and allows a correction of obsolete start fields', async () => {
  const deal = { id:'gs-15', voucherId:'15', brand:'Shop', title:'40 % auf Parkett', description:'40 % auf Parkett.',
    url:'https://www.gutscheine.at/shop', source:'Gutscheine.at', validUntil:'2026-11-04', expiryKind:'end',
    approvedAt:'2026-11-02T12:00:00Z' };
  const card = { voucherId:'15', brand:'Shop', sourceUrl:'https://www.gutscheine.at/beste-gutscheine', offerUrl:deal.url,
    title:deal.title, quote:'Gültig bis: 04.11.2026', capturedAt:'2026-11-01T11:00:00Z' };
  const edit = { dealId:deal.id, clearFields:['validFrom','validOn'], validUntil:deal.validUntil };
  const candidate = { ...deal, evidence:{couponOfferPeriod:card} };
  const check = (record, edits = [edit], latestEvidence) => assessAutomaticExpiry(record, { policy, edits, latestEvidence, now });
  assert.equal(check(candidate).reason, 'captured-coupon-offer-end');
  for (const cardChanges of [{ voucherId:'42' }, { title:'40 % auf Gartenhäuser' }, { quote:'Gültig bis: 12.11.2026' },
    { sourceUrl:'https://example.org/' }, { capturedAt:'2026-11-03T00:00:00Z' }]) {
    assert.equal(check({ ...candidate, evidence:{ couponOfferPeriod:{...card,...cardChanges} } }).eligible, false);
  }
  for (const changes of [{clearFields:['validUntil']},{validUntil:''},{forceKeep:true},{restoreDeal:deal}]) {
    assert.equal(check(candidate,[{...edit,...changes}]).eligible,false);
  }
  assert.equal(check({...candidate,description:'Angebot gültig bis 25.11.2026.'}).eligible,false);
  assert.equal(check(candidate,[edit],{blockingReason:'current-coupon-changed'}).eligible,false);
  assert.equal(check(candidate,[edit],{officialText:'Gültig bis 20.11.2026'}).eligible,false);
  const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'coupon-renewal-'));
  try {
    fs.mkdirSync(path.join(cwd,'docs')); fs.mkdirSync(path.join(cwd,'reviews'));
    const put=(file,value)=>fs.writeFileSync(path.join(cwd,file),JSON.stringify(value));
    put('reviews/automatic-maintenance-policy.json',policy);
    put('docs/deals.json',{deals:[candidate]});
    put('docs/deals-pending-gutscheine.json',{deals:[{...candidate, pubDate:'2026-11-05T10:00:00Z',
      evidence:{couponOfferPeriod:{...card,quote:'Gültig bis: 12.11.2026'}}}]});
    assert.equal((await maintainFeedFile({cwd,now,apply:false})).report.newHides,0);
  } finally { fs.rmSync(cwd,{recursive:true,force:true}); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assessAutomaticExpiry, maintainDeals, maintainFeedFile, groundedMaintenanceTitle, automaticMaintenanceReviewCandidates, latestMaintenanceEvidence } from './automatic-deal-maintenance.mjs';

const now = new Date('2026-11-06T12:00:00Z');
const policy = { version: 1, enabled: true, automaticExpiry: true, automaticLocalCopy: true,
  maxNewHidesPerRun: 5, expiryGraceHours: 12, protectedMerchants: ['Wolt'], maxAiCandidatesPerRun: 4 };
const deal = { id: 'old', title: 'Gratis Kaffee', description: 'Gratis Kaffee bei der Aktion.', brand: 'Cafe Wien',
  url: 'https://www.instagram.com/p/test/', expiryKind: 'end', validUntil: '2026-11-04',
  expires: '2026-11-04T23:59:59.999Z', metaGraphCaption: 'Gratis Kaffee in Wien. Angebot gueltig bis 04.11.2026.' };
const assess = (record, date = now) => assessAutomaticExpiry(record, { policy, now: date });

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

test('future, today and safety grace are retained across the Vienna midnight boundary', () => {
  for (const date of ['2026-11-04T22:59:59Z', '2026-11-05T00:01:00Z', '2026-11-05T11:59:59Z']) {
    assert.equal(assess(deal, new Date(date)).eligible, false, date);
  }
  assert.equal(assess(deal, new Date('2026-11-05T12:00:00Z')).eligible, true);
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
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(models.length === 1
        ? { title: 'Gratis Kaffee mit Gutschein', quote: input.metaGraphCaption } : { supported: true }) } }] });
    };
    const result = await maintainFeedFile({ cwd: root, now, apply: true, allowAi: true, request });
    assert.deepEqual(models, ['gpt-6.1-terra', 'gpt-6.1-sol']);
    assert.equal(result.deals[0].title, 'Gratis Kaffee mit Gutschein');
    assert.equal(result.deals[0].description,input.description,'title-only patch must not append unreviewed text');
    assert.equal(result.deals[0].votes, 17);
    assert.equal(result.deals[0].approvedAt, input.approvedAt);
    assert.equal(result.state.corrections[0].originalTitle, input.title);
  } finally {
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = savedKey;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

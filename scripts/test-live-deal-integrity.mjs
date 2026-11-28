import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { captureApprovedExpiryEvidence } from './approved-expiry-evidence.mjs';
import { runLiveDealIntegrity, finalizeIntegrityStatus, INTEGRITY_STATUS, INTEGRITY_REPORT, INTEGRITY_STATE } from './live-deal-integrity.mjs';

const now = new Date('2026-11-28T10:00:00Z');
const read = (root, file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const write = (root, file, value) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), JSON.stringify(value) + '\n'); };
function fixture(t, deals, edits = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deal-integrity-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, 'docs/deals.json', { deals, totalDeals: deals.length });
  write(root, 'docs/live-deal-edits.json', { edits });
  write(root, 'reviews/live-deal-integrity-policy.json', { version: 1, enabled: true,
    confirmedExpirySweep: true, confirmedDuplicateRemoval: true, confirmedSourceConflictQuarantine: true,
    sourceBackedCorrections: true, expectedCheckIntervalMinutes: 60 });
  write(root, 'reviews/automatic-maintenance-policy.json', { version: 1, enabled: true,
    automaticExpiry: true, automaticLocalCopy: false, maxNewHidesPerRun: 5, maxAiCandidatesPerRun: 0, protectedMerchants: ['Wolt'] });
  return root;
}
function offer(id, { expired = false, conflict = false, ...patch } = {}) {
  const end = expired ? '2026-11-27' : '2026-12-07';
  const deal = { id, brand: 'Testcafé', title: conflict ? 'Gratis Kaffee' : 'Kaffee für 3 €',
    description: 'Kaffee im Testcafé.', url: `https://merchant.example/${id}`,
    approvedAt: '2026-11-26T10:00:00Z', validUntil: end, expiryKind: 'end',
    expires: `${end}T23:59:59.999Z`, expiresOriginal: `Gültig bis ${expired ? '27.11.2026' : '07.12.2026'}`, ...patch };
  deal.approvedExpiryEvidence = captureApprovedExpiryEvidence(deal, { now, verifiedAt: deal.approvedAt,
    sourceText: `Kaffee ist nicht gratis und kostet 3 €. Gültig bis ${expired ? '27.11.2026' : '07.12.2026'}.` });
  assert.ok(deal.approvedExpiryEvidence); return deal;
}

test('a real full sweep removes more than five confirmed ends and accounts for every input without network', async t => {
  const deals = [...Array.from({ length: 8 }, (_, i) => offer(`expired-${i}`, { expired: true })),
    offer('future'), { id: 'unknown', title: 'Kaffeeaktion', url: 'https://merchant.example/unknown' }];
  const root = fixture(t, deals), before = fs.readFileSync(path.join(root, 'docs/deals.json'), 'utf8');
  let requests = 0; const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { requests++; throw Error('No network permitted'); };
  try {
    const preview = await runLiveDealIntegrity({ root, now, apply: false });
    assert.equal(preview.report.assessedCount, 10);
    assert.equal(preview.report.expired.length, 8);
    assert.deepEqual(preview.deals.map(deal => deal.id), ['future', 'unknown']);
    assert.equal(fs.readFileSync(path.join(root, 'docs/deals.json'), 'utf8'), before);
    assert.equal(fs.existsSync(path.join(root, INTEGRITY_REPORT)), false);
    const applied = await runLiveDealIntegrity({ root, now });
    assert.equal(applied.report.expired.length, 8);
    const status = read(root, INTEGRITY_STATUS);
    assert.equal(status.assessedCount, 10); assert.equal(status.liveCount, 2); assert.equal(status.expiredRemoved, 8);
    assert.equal(read(root, 'reviews/automatic-deal-maintenance-state.json').hidden.length, 8);
    assert.ok(status.reviewRequired > 0); assert.equal(requests, 0);
    const repeat = await runLiveDealIntegrity({ root, now });
    assert.equal(repeat.changed, false); assert.equal(repeat.report.expired.length, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('positive title contradiction is quarantined with recoverable evidence and explicit owner keep is preserved', async t => {
  const bad = offer('wrong-free', { conflict: true }), kept = offer('owner-kept', { conflict: true });
  const root = fixture(t, [bad, kept], [{ dealId: ' owner-kept ', forceKeep: true }]);
  const result = await runLiveDealIntegrity({ root, now });
  assert.deepEqual(result.deals.map(deal => deal.id), [kept.id]);
  assert.equal(result.report.quarantined.length, 1);
  assert.equal(read(root, INTEGRITY_STATE).quarantined[0].originalDeal.title, bad.title);
  assert.ok(result.report.reviewIds.includes(kept.id));
  write(root, 'docs/deals.json', { deals: [bad, kept] });
  const replay = await runLiveDealIntegrity({ root, now });
  assert.equal(replay.report.quarantined[0].replay, true);
  assert.equal(read(root, INTEGRITY_STATE).quarantined.length, 1);
  write(root, 'docs/deals.json', { deals: [{ ...bad, metaGraphBlockingReason: 'source-unavailable',
    lastVerifiedAt: '2026-11-28T09:59:00Z' }, kept] });
  const failedRead = await runLiveDealIntegrity({ root, now });
  assert.equal(failedRead.deals.length, 1, 'failed source reads cannot resurrect unchanged false public claims');
  assert.equal(failedRead.report.quarantined[0].replay, true);
  write(root, 'docs/deals.json', { deals: [bad, kept] });
  write(root, 'docs/live-deal-edits.json', { edits: [{ dealId: bad.id, title: bad.title }, { dealId: kept.id, forceKeep: true }] });
  const manualTitle = await runLiveDealIntegrity({ root, now });
  assert.equal(manualTitle.deals.length, 2, 'a new explicit owner field remains protected even before materialization');
  write(root, 'docs/deals.json', { deals: [bad, kept] });
  write(root, 'docs/live-deal-edits.json', { edits: [{ dealId: bad.id, restoreDeal: bad }, { dealId: kept.id, forceKeep: true }] });
  const restored = await runLiveDealIntegrity({ root, now });
  assert.equal(restored.deals.length, 2); assert.equal(restored.report.quarantined.length, 0);
});

test('a confirmed duplicate cannot return merely because the keeper is absent in the next incoming snapshot', async t => {
  const examples = JSON.parse(fs.readFileSync(new URL('./fixtures/live-duplicate-originals-20261128.json', import.meta.url)));
  const keeper = examples.deals.find(deal => deal.id === 'meta-ig-18107511371456022');
  const copy = { ...keeper, id: 'older-provider-copy', approvedAt: '2026-11-28T08:00:00.000Z' };
  const root = fixture(t, [keeper, copy]);
  const result = await runLiveDealIntegrity({ root, now });
  assert.equal(result.report.quarantined.filter(row => row.kind === 'confirmed-duplicate').length, 1);
  assert.deepEqual(result.deals.map(deal => deal.id), [keeper.id]);
  write(root, 'docs/deals.json', { deals: [copy] });
  const replay = await runLiveDealIntegrity({ root, now });
  assert.equal(replay.deals.length, 0); assert.equal(replay.report.quarantined[0].replay, true);
});

test('a source-corrected end that already elapsed is removed in the same pass', async t => {
  const deal = offer('wrong-future-end');
  delete deal.approvedExpiryEvidence;
  const text = 'Kaffee für 3 €. Gültig bis 27.11.2026.';
  deal.evidence = { source: 'official-merchant-page', sourceUrl: deal.url, merchantSourceKey: deal.brand,
    extractionMethod: 'merchant-card', checkedAt: '2026-11-28T09:00:00Z', textSample: text,
    contentHash: createHash('sha256').update(text).digest('hex') };
  const root = fixture(t, [deal]);
  const result = await runLiveDealIntegrity({ root, now });
  assert.equal(result.report.source[0].status, 'consistent');
  assert.equal(result.report.corrections[0].patch.validUntil, '2026-11-27');
  assert.equal(result.report.corrections.length, 1);
  assert.equal(result.deals.length, 0);
  assert.equal(result.report.expiry.afterCorrections.removedCount, 1);
  write(root, 'docs/deals.json', { deals: [{ ...deal, metaGraphBlockingReason: 'source-unavailable',
    lastVerifiedAt: '2026-11-28T09:59:00Z' }] });
  const unavailable = await runLiveDealIntegrity({ root, now });
  assert.equal(unavailable.deals.length, 0, 'previously corrected false input stays held after a failed recheck');
  write(root, 'docs/deals.json', { deals: [deal] });
  write(root, 'docs/live-deal-edits.json', { edits: [{ dealId: deal.id, validUntil: deal.validUntil, expires: deal.expires }] });
  const owner = await runLiveDealIntegrity({ root, now });
  assert.equal(owner.deals.length, 1, 'a later explicit owner period remains protected');
});

test('public status binds actual offer content, permits map projection, and rejects same-ID title drift', async t => {
  const root = fixture(t, [offer('future')]);
  await runLiveDealIntegrity({ root, now });
  const feed = read(root, 'docs/deals.json');
  feed.deals[0].address = 'Geprüfte Adresse 1, 1010 Wien';
  feed.deals[0].description = 'Details werden ergänzt. ' + feed.deals[0].description;
  write(root, 'docs/deals.json', feed);
  assert.equal(finalizeIntegrityStatus({ root, now }).liveCount, 1);
  feed.deals[0].title = 'Gratis Kaffee'; write(root, 'docs/deals.json', feed);
  assert.throws(() => finalizeIntegrityStatus({ root, now }), /no longer matches final offer content/);
});

test('malformed IDs and disabled prerequisite fail before publishing a misleading status', async t => {
  const deal = offer('same-id'), root = fixture(t, [deal, deal]);
  await assert.rejects(runLiveDealIntegrity({ root, now }), /duplicate live deal IDs/);
  assert.equal(fs.existsSync(path.join(root, INTEGRITY_STATUS)), false);
  write(root, 'docs/deals.json', { deals: [deal] });
  write(root, 'reviews/automatic-maintenance-policy.json', { version: 1, enabled: false });
  await assert.rejects(runLiveDealIntegrity({ root, now }), /requires enabled source-backed maintenance/);
  assert.equal(fs.existsSync(path.join(root, INTEGRITY_STATUS)), false);
});

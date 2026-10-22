import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  applyLiveDealEditsToBundle, normalizeLiveDealEdit, upsertLiveDealEdit,
  loadLiveDealEditStore, saveLiveDealEditStore, writeJson,
} from './live-deal-edits-lib.mjs';

// Explicit owner-approved batch, not a new automatic expiry policy.
export const RETIRE_IDS = [
  'meta-ad-1110887824818940', 'g2-otf93r', 'gs-556958', 'gs-556781',
  'social-food-review-10etoi1', 'meta-ig-18647925118035759',
  'flight-8u61yk', 'flight-rbt5lu',
];

export function prepareRetirement(bundle, store, now = new Date()) {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna' }).format(now);
  const nowIso = now.toISOString();
  const originals = RETIRE_IDS.map(id => {
    const matches = bundle.deals.filter(d => d.id === id);
    assert.equal(matches.length, 1, `Expected exactly one live record: ${id}`);
    const deal = matches[0];
    assert.match(deal.validUntil || '', /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(deal.validUntil < today, `Not expired by stored date: ${id}`);
    return deal;
  });
  let nextStore = store;
  for (const deal of originals) {
    const existing = store.edits.find(e => e.dealId === deal.id) || {};
    const edit = normalizeLiveDealEdit({
      ...existing, dealId: deal.id, url: deal.url, hidden: true,
      manualRemovalApproved: true, restoreDeal: deal,
      updatedAt: nowIso, editedBy: 'owner-request-expired-eight-2026-10-23',
    }, { existing, nowIso });
    nextStore = upsertLiveDealEdit(nextStore, edit, nowIso);
  }
  const result = applyLiveDealEditsToBundle(bundle, nextStore, {
    checkedAt: nowIso, allowRemovals: false, allowManualRemovals: true,
  });
  assert.deepEqual(result.bundle.deals, bundle.deals.filter(d => !RETIRE_IDS.includes(d.id)),
    'Unselected records or their order changed; refusing batch');
  return { bundle: result.bundle, store: nextStore, archive: {
    checkedAt: nowIso, reason: 'Owner requested hiding eight records with expired stored dates; not independent merchant expiry proof.',
    restore: 'Restore the original edit and record from this archive through the existing manual live-edit flow; do not extend dates.',
    deals: originals, previousEdits: store.edits.filter(e => RETIRE_IDS.includes(e.dealId)),
  }, report: result.report };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bundle = JSON.parse(fs.readFileSync('docs/deals.json', 'utf8'));
  const result = prepareRetirement(bundle, loadLiveDealEditStore('docs/live-deal-edits.json'));
  console.log(JSON.stringify({ before: bundle.deals.length, after: result.bundle.deals.length,
    retire: result.archive.deals.map(({id, title, validUntil}) => ({id, title, validUntil})) }, null, 2));
  if (process.argv.includes('--apply')) {
    const archive = 'reviews/expired-owner-2026-10-23.json';
    assert.ok(!fs.existsSync(archive), 'Archive exists; refusing to overwrite');
    writeJson(archive, result.archive);
    saveLiveDealEditStore('docs/live-deal-edits.json', result.store, result.archive.checkedAt);
    writeJson('docs/deals.json', result.bundle);
    writeJson('docs/live-deal-edit-report.json', { ...result.report, mode: 'owner-expired-eight' });
  } else console.log('Dry run. --apply archives and hides only these eight IDs.');
}

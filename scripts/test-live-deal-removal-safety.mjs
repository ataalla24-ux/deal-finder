import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  applyLiveDealEditsToBundle,
  normalizeLiveDealEdit,
} from './live-deal-edits-lib.mjs';

const bundle = {
  deals: [
    { id: 'deal-a', title: 'Deal A', brand: 'A' },
    { id: 'deal-b', title: 'Deal B', brand: 'B' },
  ],
  totalDeals: 2,
  lastUpdated: '2026-01-01T00:00:00.000Z',
};

function apply(edit, options = {}) {
  return applyLiveDealEditsToBundle(bundle, { edits: [edit] }, {
    checkedAt: '2026-07-27T12:00:00.000Z',
    ...options,
  });
}

const unapprovedHiddenEdit = normalizeLiveDealEdit({
  dealId: 'deal-a',
  hidden: true,
  editedBy: 'automation',
});

const paused = apply(unapprovedHiddenEdit);
assert.equal(paused.bundle.deals.length, 2);
assert.equal(paused.report.appliedCount, 0);
assert.equal(paused.report.skippedRemovalCount, 1);

const manualHiddenEdit = normalizeLiveDealEdit({
  dealId: 'deal-a',
  hidden: true,
  editedBy: 'slack-live-review',
  manualRemovalApproved: true,
});
assert.equal(manualHiddenEdit.manualRemovalApproved, true);

const manualPaused = apply(manualHiddenEdit);
assert.equal(manualPaused.bundle.deals.length, 2);
assert.equal(manualPaused.report.skippedRemovalCount, 1);

const manualApplied = apply(manualHiddenEdit, { allowManualRemovals: true });
assert.deepEqual(manualApplied.bundle.deals.map((deal) => deal.id), ['deal-b']);
assert.equal(manualApplied.report.appliedCount, 1);
assert.equal(manualApplied.report.applied[0].manualRemoval, true);
assert.equal(manualApplied.report.removalsPaused, true);
assert.equal(manualApplied.report.manualRemovalsEnabled, true);

const explicitAutomatedApply = apply(unapprovedHiddenEdit, { allowRemovals: true });
assert.deepEqual(explicitAutomatedApply.bundle.deals.map((deal) => deal.id), ['deal-b']);
assert.equal(explicitAutomatedApply.report.removalsPaused, false);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freefinder-manual-moderation-'));
try {
  const dealsPath = path.join(tempDir, 'deals.json');
  const editsPath = path.join(tempDir, 'live-deal-edits.json');
  const moderationPath = path.join(tempDir, 'deal-moderation.json');
  const reportPath = path.join(tempDir, 'live-deal-edit-report.json');
  fs.writeFileSync(dealsPath, JSON.stringify(bundle));
  fs.writeFileSync(editsPath, JSON.stringify({ edits: [] }));
  fs.writeFileSync(moderationPath, JSON.stringify({
    blockedIds: ['deal-a'],
    blockedUrls: [],
    blockedProviders: [],
    blockedText: [],
    hiddenDeals: [],
  }));

  const replay = spawnSync(process.execPath, ['scripts/apply-live-deal-edits.mjs'], {
    cwd: path.resolve('.'),
    env: {
      ...process.env,
      LIVE_DEALS_PATH: dealsPath,
      LIVE_DEAL_EDITS_PATH: editsPath,
      LIVE_DEAL_EDIT_REPORT_PATH: reportPath,
      DEAL_MODERATION_PATH: moderationPath,
      LIVE_DEAL_REMOVALS_ENABLED: '0',
    },
    encoding: 'utf8',
  });
  assert.equal(replay.status, 0, replay.stderr);
  const moderatedBundle = JSON.parse(fs.readFileSync(dealsPath, 'utf8'));
  const replayReport = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.deepEqual(moderatedBundle.deals.map((deal) => deal.id), ['deal-b']);
  assert.equal(replayReport.moderationAfterEdits.removedCount, 1);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log('Live deal removal safety tests passed.');

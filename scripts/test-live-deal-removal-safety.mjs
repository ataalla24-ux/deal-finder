import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  applyLiveDealEditsToBundle,
  normalizeLiveDealEdit,
} from './live-deal-edits-lib.mjs';
import {
  isSafeAutomaticExpiredDeal,
  shouldApplyAutomatedLiveRemoval,
  stableChurchDealId,
} from '../scraper/normalize-live-deals.js';

assert.equal(shouldApplyAutomatedLiveRemoval({
  apply: true,
  removalsEnabled: true,
  automatedRemovalsAllowed: true,
}), true, 'objective automatic removals require all three safety gates');
for (const disabledGate of ['apply', 'removalsEnabled', 'automatedRemovalsAllowed']) {
  const gates = {
    apply: true,
    removalsEnabled: true,
    automatedRemovalsAllowed: true,
    [disabledGate]: false,
  };
  assert.equal(shouldApplyAutomatedLiveRemoval(gates), false, `${disabledGate} must block automatic removals`);
}

const expirySafetyNow = new Date('2026-08-31T18:00:00.000Z');
const strongExpiry = {
  expiresSource: 'text',
  expiresPrecision: 'day',
  dateConfidence: 'high',
};
assert.equal(isSafeAutomaticExpiredDeal({
  ...strongExpiry,
  expires: '2026-08-31T05:00:00.000Z',
}, expirySafetyNow), true, 'strong exact expiry older than 12 hours is safe to remove');
assert.equal(isSafeAutomaticExpiredDeal({
  ...strongExpiry,
  expires: '2026-08-31T12:00:00.000Z',
}, expirySafetyNow), false, 'the 12-hour safety grace must prevent same-day premature removal');
assert.equal(isSafeAutomaticExpiredDeal({
  ...strongExpiry,
  dateConfidence: 'medium',
  expires: '2026-08-01T12:00:00.000Z',
}, expirySafetyNow), false, 'age alone must never make uncertain expiry evidence safe');
assert.equal(isSafeAutomaticExpiredDeal({
  ...strongExpiry,
  expires: '2026-08-01T12:00:00.000Z',
  expiresOriginal: 'Bis ca. 01.08.2026',
}, expirySafetyNow), false, 'approximate wording must never be eligible for automatic removal');

assert.equal(stableChurchDealId({
  id: 'hillsong-vienna-events-20260824',
  source: 'Freikirchen Wien',
  category: 'events',
}), 'hillsong-vienna-events');
assert.equal(stableChurchDealId({
  id: 'ordinary-deal-20260824',
  source: 'Slack',
  category: 'essen',
}), 'ordinary-deal-20260824');

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

const normalizationDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freefinder-live-normalization-'));
try {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const oldExpiry = '2025-12-31T23:59:59.999Z';
  const futureStart = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();
  const futureExpiry = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const recentStrongExpiry = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString();
  const oldSocialPubDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const fixtureDeals = [
    {
      id: 'certainly-expired',
      title: 'Sicher abgelaufener Rabatt',
      brand: 'Test Shop',
      description: '50% Rabatt bis Ende 2025',
      url: 'https://example.com/expired',
      expires: oldExpiry,
      expiresOriginal: '31.12.2025',
      expiresSource: 'text',
      expiresPrecision: 'day',
      dateConfidence: 'high',
    },
    {
      id: 'real-free-museum',
      title: 'Gratis Eintritt ins Museum',
      brand: 'Test Museum Wien',
      description: 'Heute ist der Eintritt in Wien kostenlos.',
      category: 'gratis',
      type: 'gratis',
      url: 'https://example.com/free-museum',
    },
    {
      id: 'uncertain-expiry',
      title: 'Rabatt mit unsicherem Ablaufdatum',
      brand: 'Test Markt',
      description: '20% Rabatt laut nicht bestaetigter Angabe.',
      url: 'https://example.com/uncertain',
      expires: yesterday,
      expiresOriginal: yesterday.slice(0, 10),
      expiresSource: 'text',
      expiresPrecision: 'day',
      dateConfidence: 'medium',
    },
    {
      id: 'future-offer',
      title: 'Kommender 1+1 Deal',
      brand: 'Test Cafe Wien',
      description: 'Der 1+1 Deal startet in drei Tagen.',
      url: 'https://example.com/future',
      validFrom: futureStart,
      validUntil: futureExpiry,
      expires: futureExpiry,
      expiresOriginal: futureExpiry.slice(0, 10),
      expiresSource: 'text',
      expiresPrecision: 'day',
      dateConfidence: 'high',
      pubDate: now.toISOString(),
    },
    {
      id: 'strong-expiry-inside-grace',
      title: 'Gerade beendeter Test-Deal',
      brand: 'Test Cafe Wien',
      description: 'Der Deal endete vor wenigen Stunden.',
      url: 'https://example.com/recent-expiry',
      expires: recentStrongExpiry,
      expiresOriginal: recentStrongExpiry.slice(0, 10),
      expiresSource: 'text',
      expiresPrecision: 'day',
      dateConfidence: 'high',
    },
    {
      id: 'old-social-post-without-expiry',
      title: '20% Rabatt laut Social Post',
      brand: 'Test Shop Wien',
      description: '20% Rabatt, aber ohne bestätigtes Enddatum.',
      url: 'https://www.instagram.com/p/OLDSOCIALPOST/',
      pubDate: oldSocialPubDate,
      pubDateSource: 'instagram-graph-timestamp',
    },
    {
      id: 'manually-restored-expired',
      title: 'Manuell wiederhergestellter Deal',
      brand: 'Test Cafe Wien',
      description: 'Dieser Deal wurde aus Offline zurückgeholt.',
      url: 'https://example.com/restored-expired',
      expires: oldExpiry,
      expiresOriginal: '31.12.2025',
      expiresSource: 'text',
      expiresPrecision: 'day',
      dateConfidence: 'high',
    },
  ];
  fs.writeFileSync(path.join(normalizationDir, 'deals.json'), JSON.stringify({
    deals: fixtureDeals,
    totalDeals: fixtureDeals.length,
    lastUpdated: now.toISOString(),
  }));
  fs.writeFileSync(path.join(normalizationDir, 'live-deal-edits.json'), JSON.stringify({
    edits: [{
      dealId: 'manually-restored-expired',
      forceKeep: true,
      hidden: false,
      editedBy: 'slack-live-review',
    }],
  }));
  fs.writeFileSync(path.join(normalizationDir, 'deal-candidates-index.json'), JSON.stringify({ deals: [] }));
  for (const file of [
    'deals-pending-church-gemeinde.json',
    'deals-pending-church-gottesdienste.json',
    'deals-pending-church-events.json',
  ]) {
    fs.writeFileSync(path.join(normalizationDir, file), JSON.stringify({ deals: [] }));
  }

  const normalization = spawnSync(process.execPath, ['scraper/normalize-live-deals.js'], {
    cwd: path.resolve('.'),
    env: {
      ...process.env,
      LIVE_DEAL_DOCS_DIR: normalizationDir,
      LIVE_DEAL_VALIDATION_APPLY: '1',
      LIVE_DEAL_REMOVALS_ENABLED: '1',
      ALLOW_AUTOMATED_LIVE_REMOVALS: '1',
      MAX_LIVE_URL_HEALTH_CHECKS: '0',
      MAX_LIVE_URL_EXPIRY_REFRESHES: '0',
      MAX_LIVE_CONTENT_ENRICHMENTS: '0',
    },
    encoding: 'utf8',
  });
  assert.equal(normalization.status, 0, normalization.stderr);

  const normalizedBundle = JSON.parse(fs.readFileSync(path.join(normalizationDir, 'deals.json'), 'utf8'));
  const normalizedIds = new Set(normalizedBundle.deals.map((deal) => deal.id));
  assert.equal(normalizedIds.has('certainly-expired'), false, 'strong expired evidence must be removed');
  assert.equal(normalizedIds.has('real-free-museum'), true, 'heuristic false positives must remain live');
  assert.equal(normalizedIds.has('uncertain-expiry'), true, 'uncertain recent expiry must remain live for review');
  assert.equal(normalizedIds.has('future-offer'), true, 'future-start offers must remain live');
  assert.equal(normalizedIds.has('strong-expiry-inside-grace'), true, 'strong expiry inside the safety grace must remain live');
  assert.equal(normalizedIds.has('old-social-post-without-expiry'), true, 'social post age alone must never remove a live deal');
  assert.equal(normalizedIds.has('manually-restored-expired'), true, 'a manually restored deal must stay protected from automatic removal');

  const validationReport = JSON.parse(fs.readFileSync(path.join(normalizationDir, 'live-deal-validation-report.json'), 'utf8'));
  assert.equal(validationReport.removedCount, 1);
  assert.equal(validationReport.heuristicReviewCandidates, 1);
  assert.equal(validationReport.expiredReviewCandidates, 2);
  assert.equal(validationReport.socialPostAgeReviewCandidates, 1);
  assert.equal(validationReport.socialPostDateRemovals, 0);
  assert.equal(validationReport.reviewCandidateCount, 4);
} finally {
  fs.rmSync(normalizationDir, { recursive: true, force: true });
}

const churchNormalizationDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freefinder-church-normalization-'));
try {
  const churchBase = {
    brand: 'Hillsong Vienna',
    title: 'Hillsong Vienna Events',
    description: 'Aktuelle Veranstaltungen in Wien.',
    category: 'events',
    source: 'Freikirchen Wien',
    url: 'https://hillsong.com/austria/events/',
  };
  const existingDeals = [
    { ...churchBase, id: 'hillsong-vienna-events-20260810', pubDate: '2026-08-10T08:00:00.000Z' },
    { ...churchBase, id: 'hillsong-vienna-events-20260817', pubDate: '2026-08-17T08:00:00.000Z' },
  ];
  fs.writeFileSync(path.join(churchNormalizationDir, 'deals.json'), JSON.stringify({
    deals: existingDeals,
    totalDeals: existingDeals.length,
    lastUpdated: '2026-08-17T08:00:00.000Z',
  }));
  fs.writeFileSync(path.join(churchNormalizationDir, 'live-deal-edits.json'), JSON.stringify({ edits: [] }));
  fs.writeFileSync(path.join(churchNormalizationDir, 'deal-candidates-index.json'), JSON.stringify({ deals: [] }));
  fs.writeFileSync(path.join(churchNormalizationDir, 'deals-pending-church-gemeinde.json'), JSON.stringify({ deals: [] }));
  fs.writeFileSync(path.join(churchNormalizationDir, 'deals-pending-church-gottesdienste.json'), JSON.stringify({ deals: [] }));
  fs.writeFileSync(path.join(churchNormalizationDir, 'deals-pending-church-events.json'), JSON.stringify({
    deals: [{ ...churchBase, id: 'hillsong-vienna-events-20260824', pubDate: '2026-08-24T08:00:00.000Z' }],
  }));

  const normalization = spawnSync(process.execPath, ['scraper/normalize-live-deals.js'], {
    cwd: path.resolve('.'),
    env: {
      ...process.env,
      LIVE_DEAL_DOCS_DIR: churchNormalizationDir,
      LIVE_DEAL_VALIDATION_APPLY: '1',
      LIVE_DEAL_REMOVALS_ENABLED: '0',
      ALLOW_AUTOMATED_LIVE_REMOVALS: '0',
      MAX_LIVE_URL_HEALTH_CHECKS: '0',
      MAX_LIVE_URL_EXPIRY_REFRESHES: '0',
      MAX_LIVE_CONTENT_ENRICHMENTS: '0',
    },
    encoding: 'utf8',
  });
  assert.equal(normalization.status, 0, normalization.stderr);

  const normalizedBundle = JSON.parse(fs.readFileSync(path.join(churchNormalizationDir, 'deals.json'), 'utf8'));
  assert.deepEqual(normalizedBundle.deals.map((deal) => deal.id), ['hillsong-vienna-events']);
  assert.equal(normalizedBundle.deals[0].pubDate, '2026-08-24T08:00:00.000Z');
  const report = JSON.parse(fs.readFileSync(path.join(churchNormalizationDir, 'live-deal-validation-report.json'), 'utf8'));
  assert.equal(report.removedCount, 0);
  assert.equal(report.churchDirectoryMerges, 2);
} finally {
  fs.rmSync(churchNormalizationDir, { recursive: true, force: true });
}

console.log('Live deal removal safety tests passed.');

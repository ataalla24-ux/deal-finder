import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { maintainFeedFile, maintainDeals, protectedFields } from './automatic-deal-maintenance.mjs';
import { assessLiveDealDuplicates } from './live-deal-duplicates.mjs';
import { auditLiveDealSourceConsistency } from './live-deal-source-consistency.mjs';
import { computeDealsFeedVersion } from './deals-feed-contract.mjs';
import { redactPublishedCommunityDraft } from './community-public-boundary.mjs';
import { stripEnrichmentNotice } from '../scraper/deal-enrichment-state.js';
import { sanitizePublicDealText } from '../scraper/public-deal-text.js';

export const INTEGRITY_POLICY = 'reviews/live-deal-integrity-policy.json';
export const INTEGRITY_STATE = 'reviews/live-deal-integrity-state.json';
export const INTEGRITY_REPORT = 'reviews/live-deal-integrity-report.json';
export const INTEGRITY_STATUS = 'docs/deal-integrity-status.json';
export const INTEGRITY_OUTPUTS = [INTEGRITY_STATE, INTEGRITY_REPORT, INTEGRITY_STATUS];
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const read = (root, file, fallback) => {
  try { return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
};
const write = (root, file, value) => {
  const target = path.join(root, file), bytes = JSON.stringify(value, null, 2) + '\n';
  if (fs.existsSync(target) && fs.readFileSync(target, 'utf8') === bytes) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, bytes); fs.renameSync(temporary, target);
};
const periodField = field => /^(?:valid|expir|dateConfidence)/.test(field);
// Failed reads and refreshed observation timestamps do not create a new offer.
// Recovery follows the actual published claims and approval, not mutable API
// health/provenance metadata. A newer positive proof is considered separately.
const recoveryFields = ['id','url','brand','title','description','approvedAt','validOn','validFrom','validUntil',
  'expires','expiryKind','expiresOriginal','expiryDisplayText','flight','couponCode','promotionEvidence',
  'price','originalPrice','discount','discountPercent','minimumSpend','conditions'];
const recoveryFingerprint = original => {
  const deal = sanitizePublicDealText(redactPublishedCommunityDraft({ ...original }));
  deal.description = stripEnrichmentNotice(deal.description);
  return hash(recoveryFields.map(key => [key, deal[key] ?? null]));
};
const clean = value => String(value || '').trim();
const matchingEdits = (deal, edits) => edits.filter(edit => clean(edit.dealId)
  ? clean(edit.dealId) === clean(deal.id) : deal.url && edit.url === deal.url);
function protectedOffer(deal, edits, policy) {
  return deal.forceKeep || deal.liveForceKeep || deal.campaignId || deal.isBusinessAdvertisement || deal.isBusiness
    || matchingEdits(deal, edits).some(edit => edit.forceKeep || edit.restoreDeal || edit.hidden)
    || policy.protectedMerchants?.some(brand => String(brand).toLowerCase() === String(deal.brand).toLowerCase());
}
const assessedCoreFields = ['id','url','sourceUrl','evidencePostUrl','brand','title','description',
  'validOn','validFrom','validUntil','expires','expiryKind','expiresSource','expirySource',
  'expiresOriginal','expiryDisplayText','flight','metaGraphCaption','metaGraphOcrText','postCaption',
  'sourcePublishedAt','sourcePublishedAtSource','approvedAt','approvedExpiryEvidence',
  'forceKeep','liveForceKeep','campaignId','liveEditedFields','slackEditedFields'];
function assessedCoreHash(deals) {
  return hash(deals.map(original => {
    const deal = sanitizePublicDealText({ ...original });
    deal.description = stripEnrichmentNotice(deal.description);
    return assessedCoreFields.map(key => [key, deal[key] ?? null]);
  }));
}
function rowsOf(result) { return Array.isArray(result) ? result : result?.entries || result?.records || result?.results || result?.assessments; }
function assertCoverage(rows, deals, label) {
  if (!Array.isArray(rows) || rows.length !== deals.length || new Set(rows.map(row => row.id)).size !== deals.length
    || rows.some(row => !deals.some(deal => deal.id === row.id))) throw Error(`${label} must assess every deal exactly once`);
}

// This is a local check over evidence captured by the existing source APIs.
// It cannot fetch a source, invoke a model, approve a deal, or rotate a secret.
export async function runLiveDealIntegrity({ root = process.cwd(), now = new Date(), apply = true } = {}) {
  const policy = read(root, INTEGRITY_POLICY, null);
  if (!policy) return { enabled: false, changed: false };
  if (policy.version !== 1 || typeof policy.enabled !== 'boolean') throw Error('Invalid live deal integrity policy');
  if (!policy.enabled) return { enabled: false, changed: false };
  if (!Number.isFinite(+now)) throw Error('Invalid integrity clock');
  if (!Number.isInteger(policy.expectedCheckIntervalMinutes) || policy.expectedCheckIntervalMinutes < 1
    || policy.expectedCheckIntervalMinutes > 1440) throw Error('Invalid integrity check interval');
  const feed = read(root, 'docs/deals.json', null), input = Array.isArray(feed) ? feed : feed?.deals;
  if (!Array.isArray(input) || input.some(deal => !deal || typeof deal.id !== 'string' || !deal.id.trim())
    || new Set(input.map(deal => deal.id)).size !== input.length) throw Error('Invalid or duplicate live deal IDs');
  const maintenancePolicy = read(root, 'reviews/automatic-maintenance-policy.json', {});
  if (maintenancePolicy.enabled !== true || maintenancePolicy.version !== 1) throw Error('Integrity requires enabled source-backed maintenance');
  const edits = read(root, 'docs/live-deal-edits.json', {}).edits || [];
  const maintenance = await maintainFeedFile({ cwd: root, now, allowAi: false, apply: false,
    confirmedExpirySweep: policy.confirmedExpirySweep === true, includeSourceEvidence: true });
  const sourceEvidence = maintenance.sourceEvidence;
  if (!(sourceEvidence instanceof Map)) throw Error('Missing complete maintenance source context');
  const sourceRows = rowsOf(auditLiveDealSourceConsistency(maintenance.deals, { now, sourceEvidence, edits, policy: maintenancePolicy }));
  assertCoverage(sourceRows, maintenance.deals, 'Source consistency');
  const state = read(root, INTEGRITY_STATE, { version: 1, quarantined: [], corrections: [] });
  if (state.version !== 1 || !Array.isArray(state.quarantined) || !Array.isArray(state.corrections)) throw Error('Invalid integrity recovery state');
  const quarantined = [], corrections = [], review = new Set();
  const remember = (deal, decision, kind) => {
    const fingerprint = recoveryFingerprint(deal);
    if (!state.quarantined.some(row => row.id === deal.id && row.fingerprint === fingerprint && row.kind === kind)) {
      state.quarantined.push({ id: deal.id, fingerprint, kind, quarantinedAt: now.toISOString(),
        decision, originalDeal: redactPublishedCommunityDraft(deal) });
    }
    quarantined.push({ id: deal.id, kind, decision });
  };
  let deals = [];
  for (const original of maintenance.deals) {
    let deal = original;
    let row = sourceRows.find(entry => entry.id === deal.id);
    const fields = protectedFields(deal, edits);
    const protectedByOwner = protectedOffer(deal, edits, maintenancePolicy);
    const copyOrPeriodProtected = [...fields].some(field => ['title','description','brand'].includes(field) || periodField(field));
    const previous = state.quarantined.find(entry => entry.id === deal.id
      && entry.fingerprint === recoveryFingerprint(deal)
      && entry.originalDeal && recoveryFingerprint(entry.originalDeal) === entry.fingerprint);
    // Losing access to the source must not silently resurrect the exact offer
    // that a previous positive proof quarantined. A changed approved record or
    // an explicit owner restore is assessed normally. The same record needs a
    // newer, affirmative current source read to clear a source contradiction.
    const newlyConfirmed = previous?.kind === 'confirmed-source-conflict' && row.status === 'consistent'
      && row.provenance?.currentRead === true
      && Date.parse(row.provenance.verifiedAt) > Date.parse(previous.quarantinedAt);
    if (previous && !protectedByOwner && !copyOrPeriodProtected && !newlyConfirmed) {
      quarantined.push({ id: deal.id, kind: previous.kind, decision: previous.decision, replay: true });
      continue;
    }
    const priorCorrection = state.corrections.find(entry => entry.id === deal.id
      && entry.inputHash === recoveryFingerprint(deal));
    if (priorCorrection && row.status === 'review' && !protectedByOwner && !copyOrPeriodProtected) {
      remember(deal, { ...row, priorVerifiedCorrection: priorCorrection,
        reason: 'previously-corrected-input-awaiting-current-source' }, 'confirmed-source-conflict');
      continue;
    }
    // A source disagreement is not permission to overwrite an owner's field.
    if (row.status === 'confirmedConflict' && row.quarantineEligible === true
      && policy.confirmedSourceConflictQuarantine === true && !protectedByOwner && !copyOrPeriodProtected) {
      remember(deal, row, 'confirmed-source-conflict'); continue;
    }
    if (row.patch && Object.keys(row.patch).length && policy.sourceBackedCorrections === true && !protectedByOwner) {
      const keys = Object.keys(row.patch);
      const allowed = keys.every(key => ['title','description','validFrom','validOn','validUntil','expires','expiryKind',
        'expiresOriginal','expiryDisplayText','dateConfidence','expirySource','expiresSource'].includes(key));
      if (allowed && row.provenance && !keys.some(key => fields.has(key))
        && !(keys.some(periodField) && [...fields].some(periodField))) {
        deal = { ...deal, ...row.patch };
        const record = { id: deal.id, inputHash: recoveryFingerprint(original), resultHash: recoveryFingerprint(deal),
          patch: row.patch, provenance: row.provenance, at: now.toISOString() };
        if (!state.corrections.some(entry => entry.inputHash === record.inputHash && entry.resultHash === record.resultHash)) state.corrections.push(record);
        corrections.push(record);
        const rechecked = rowsOf(auditLiveDealSourceConsistency([deal], { now, sourceEvidence, edits, policy: maintenancePolicy }))[0];
        assertCoverage([rechecked], [deal], 'Corrected source consistency');
        row = { ...rechecked, correctedIssues: row.issues };
        sourceRows[sourceRows.findIndex(entry => entry.id === deal.id)] = row;
      } else review.add(deal.id);
    }
    if (row.status !== 'consistent') review.add(deal.id);
    deals.push(deal);
  }
  // A corrected date may already have elapsed. Do not publish it for another
  // hour just because the first expiry pass examined the previous date.
  const afterCorrections = maintainDeals(deals, { policy: maintenancePolicy, state: maintenance.state,
    edits, now, sourceEvidence, scheduledExpiryOnly: true,
    confirmedExpirySweep: policy.confirmedExpirySweep === true });
  deals = afterCorrections.deals;
  maintenance.state = afterCorrections.state;
  maintenance.report.hidden.push(...afterCorrections.report.hidden);
  const duplicates = assessLiveDealDuplicates(deals, { now, edits, sourceEvidence, policy: maintenancePolicy });
  assertCoverage(duplicates.decisions, deals, 'Duplicate check');
  for (const row of duplicates.decisions) if (row.action === 'review') review.add(row.id);
  for (const pair of duplicates.reviewPairs || []) { review.add(pair.leftId); review.add(pair.rightId); }
  if (policy.confirmedDuplicateRemoval === true) {
    const removals = new Map(duplicates.removals.map(row => [row.id, row]));
    deals = deals.filter(deal => {
      const removal = removals.get(deal.id);
      if (!removal) return true;
      if (!removal.proof || !deals.some(row => row.id === removal.keeperId) || removals.has(removal.keeperId)
        || protectedOffer(deal, edits, maintenancePolicy)) { review.add(deal.id); return true; }
      remember(deal, removal, 'confirmed-duplicate'); return false;
    });
  }
  for (const row of maintenance.report.review || []) review.add(row.id);
  const liveIds = new Set(deals.map(deal => deal.id));
  const report = { version: 1, checkedAt: now.toISOString(), inputFeedVersion: computeDealsFeedVersion(input),
    assessedCount: input.length, finalCount: deals.length, assessedIds: input.map(deal => deal.id),
    finalIds: deals.map(deal => deal.id), finalAssessedCoreHash: assessedCoreHash(deals), source: sourceRows, duplicates,
    expiry: { initial: maintenance.report.expiry, afterCorrections: afterCorrections.report.expiry }, expired: maintenance.report.hidden,
    corrections: [...maintenance.report.corrected, ...corrections], quarantined,
    reviewIds: [...review].filter(id => liveIds.has(id)),
    providerRequests: 0, modelRequests: 0, humanApprovalRequiredForNewDeals: true };
  const changed = JSON.stringify(deals) !== JSON.stringify(input);
  if (apply) {
    write(root, 'reviews/automatic-deal-maintenance-state.json', maintenance.state);
    write(root, INTEGRITY_STATE, state);
    write(root, INTEGRITY_REPORT, report);
    if (changed) write(root, 'docs/deals.json', Array.isArray(feed) ? deals : { ...feed, deals, totalDeals: deals.length });
    finalizeIntegrityStatus({ root, now });
  }
  return { enabled: true, changed, deals, report, state, maintenance };
}

// Map completion and public-text projection can update metadata after the
// assessment. Bind the status to the actual final feed without claiming those
// later fields were independently source-verified.
export function finalizeIntegrityStatus({ root = process.cwd(), now = new Date() } = {}) {
  const report = read(root, INTEGRITY_REPORT, null);
  if (!report) return null;
  const feed = read(root, 'docs/deals.json', {}), deals = Array.isArray(feed) ? feed : feed.deals;
  if (!Array.isArray(deals) || hash(deals.map(deal => deal.id).sort()) !== hash([...report.finalIds].sort()))
    throw Error('Integrity assessment does not cover the final feed');
  if (assessedCoreHash(deals) !== report.finalAssessedCoreHash) throw Error('Integrity assessment no longer matches final offer content');
  const policy = read(root, INTEGRITY_POLICY, {});
  const status = { version: 1, checkedAt: report.checkedAt, publishedFeedVersion: computeDealsFeedVersion(deals),
    assessmentInputFeedVersion: report.inputFeedVersion, assessedCount: report.assessedCount, liveCount: deals.length,
    expiredRemoved: report.expired.length,
    duplicatesRemoved: report.quarantined.filter(row => row.kind === 'confirmed-duplicate').length,
    sourceConflictsQuarantined: report.quarantined.filter(row => row.kind === 'confirmed-source-conflict').length,
    corrected: new Set(report.corrections.map(row => row.id)).size,
    reviewRequired: report.reviewIds.length,
    expectedCheckIntervalMinutes: policy.expectedCheckIntervalMinutes,
    staleAfter: new Date(Date.parse(report.checkedAt) + 2 * policy.expectedCheckIntervalMinutes * 60000).toISOString(),
    sourceVerification: 'available source-bound evidence; unknown evidence remains review',
    providerRequests: 0, modelRequests: 0 };
  write(root, INTEGRITY_STATUS, status);
  return status;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runLiveDealIntegrity({ apply: !process.argv.includes('--read-only') });
  console.log(JSON.stringify(result.enabled ? { enabled: true, assessed: result.report.assessedCount,
    live: result.deals.length, expired: result.report.expired.length, quarantined: result.report.quarantined.length,
    corrected: result.report.corrections.length, reviewRequired: result.report.reviewIds.length,
    providerRequests: 0, modelRequests: 0 } : { enabled: false }));
}

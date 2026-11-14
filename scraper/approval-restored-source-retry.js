import { isSupportedIamstudentApprovalUrl } from './approval-iamstudent-source-evidence.js';

const OLD_UNAVAILABLE_REASON = 'URL ungültig (Inhalt nicht mehr verfügbar)';

// Slot eligibility only. The caller filters moderation first, then rereads the
// actual Slack reaction and runs the ordinary source, date and location checks.
export function isRestoredIamstudentApprovalRetry(deal, now = Date.now()) {
  if (!isSupportedIamstudentApprovalUrl(deal?.url)
    || deal?.pipelineLifecycle?.manualDecision !== 'approved') return false;
  const reasons = deal.approvalBlock?.reasons;
  if (!Array.isArray(reasons) || !reasons.length
    || !reasons.every(reason => reason === OLD_UNAVAILABLE_REASON)) return false;

  const currentTime = Number(now);
  if (!Number.isFinite(currentTime)) return false;
  const endValues = [deal.validUntil, deal.expires,
    ...(deal.expiryKind === 'single' ? [deal.validOn] : [])];
  for (const value of endValues) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) continue;
    // Retain the existing pending-queue date-only end-of-day convention.
    const end = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59.999Z` : value);
    if (!Number.isFinite(end) || end < currentTime) return false;
  }
  return true;
}

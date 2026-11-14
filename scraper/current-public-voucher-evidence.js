import { isReviewedIamstudentApprovalEvidence } from './approval-iamstudent-source-evidence.js';

// The live health response, not a stored deal flag, supplies this proof. The
// exact public voucher parser already requires complete unchanged conditions
// and a visible positive availability signal. Its countdown is NOT a date.
export function currentPublicVoucherEvidence(deal, health, now = new Date()) {
  const checkedAt = Date.parse(health?.checkedAt);
  const age = Number(now) - checkedAt;
  if (health?.status !== 200 || health.invalid || health.transientError || health.blockedByProtection
    || health.finalUrl !== deal?.url || !Number.isFinite(age) || age < -5000 || age > 10 * 60000
    || !isReviewedIamstudentApprovalEvidence(deal, health.approvalSourceEvidence)) return null;
  return { sourceUrl: deal.url, checkedAt: health.checkedAt,
    method: 'current-public-voucher-v1', scope: 'AT-except-Linz' };
}

// Identity checks are also used by lightweight Slack jobs without HTML tooling.
export function isCommunitySubmission(deal) {
  return String(deal?.id || '').startsWith('community:')
    && Boolean(String(deal?.submissionId || '').trim())
    && deal?.originSource === 'community-submission';
}

export function isHumanReviewedCommunity(deal) {
  const review = deal?.pipelineLifecycle;
  return isCommunitySubmission(deal) && review?.manualDecision === 'approved'
    && Boolean(review.manualDecisionUser) && Number.isFinite(Date.parse(review.manualDecisionAt));
}

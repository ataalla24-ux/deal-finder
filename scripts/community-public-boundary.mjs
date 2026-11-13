export function privateCommunityRow(row) {
  return /^community:/i.test(String(row?.id || row?.dealId || ''))
    || row?.originSource === 'community-submission' || Boolean(row?.submittedContent || row?.communityExtraction);
}

export function redactPublishedCommunityDraft(row) {
  const privateDraft = privateCommunityRow(row);
  const privateReviewer = row?.pipelineLifecycle && Object.hasOwn(row.pipelineLifecycle, 'manualDecisionUser');
  if (!privateDraft && !privateReviewer) return row;
  // Keep approval state and offer fields, not raw drafts or reviewer identities.
  const { submittedContent, communityExtraction, ...published } = row;
  if (privateReviewer) {
    const { manualDecisionUser, ...lifecycle } = row.pipelineLifecycle;
    published.pipelineLifecycle = lifecycle;
  }
  return published;
}

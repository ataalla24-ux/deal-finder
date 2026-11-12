export function privateCommunityRow(row) {
  return /^community:/i.test(String(row?.id || row?.dealId || ''))
    || row?.originSource === 'community-submission' || Boolean(row?.submittedContent || row?.communityExtraction);
}

export function redactPublishedCommunityDraft(row) {
  if (!privateCommunityRow(row)) return row;
  // Approved offer fields remain public; raw submissions are stored privately.
  const { submittedContent, communityExtraction, ...published } = row;
  return published;
}

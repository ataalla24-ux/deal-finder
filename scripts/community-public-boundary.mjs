export function privateCommunityRow(row) {
  return /^community:/i.test(String(row?.id || row?.dealId || ''))
    || row?.originSource === 'community-submission' || Boolean(row?.submittedContent || row?.communityExtraction);
}

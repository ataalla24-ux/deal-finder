# Food and drink discovery: 2026-09-23

## Observed bottlenecks

- Gastro2 at 05:36 UTC attempted 12 searches in one burst. The last two
  (IKEA and Marktguru) failed with the provider's 10 requests/minute limit.
- Food3 found 8 candidates, rejected 7, and retained 5 previous records.
  Its 6 output records were not 6 newly found deals.
- Social-food audit records 13 manual approvals in 7 days (1.86/day).
  Collector acceptance and pending-file size are not manual approval counts.
- Instagram discovery's last report shows 19 unavailable profiles and zero
  posts. This session does not change login, Ads Library, or the separate
  uncommitted Instagram/media-rescue work in the original checkout.

## Changes

- Shared Firecrawl search queue spaces calls 6.5 seconds apart per client.
- One retry after a short rate-limit reset; at most 65 seconds of retry wait.
  Authentication, insufficient credits, and long quota resets fail without
  retries or borrowing another API key.
- Gastro2, Food3, and Key4 hashtag/web searches explicitly target Vienna food
  and drinks. Exact merchant-account queries and non-food collectors keep
  their existing query scope.
- Gastro2 has an optional search-only manual run: the existing 12 searches,
  without any of its 4 broad AI agent passes. Scheduled runs are unchanged.

## Guardrails

No source-age/expiry/Vienna validation relaxed. No live deals added or removed.
All candidates still pass through Central Deal Dispatch and manual Slack
approval. No native binary, store submission, or subscription changes.

## Verification

Local search/pacing, agent configuration, Key4 and original-post verifier
tests passed. Search-only live-run and dispatch results are recorded below
after completion. Production feed has pre-existing validation errors from
expired entries and content issues; this change does not hide those errors.

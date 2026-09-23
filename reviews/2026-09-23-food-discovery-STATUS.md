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

## Live search result

Code commit: d05c6be88.
Run: https://github.com/ataalla24-ux/deal-finder/actions/runs/35837521894

- 12 attempted searches, 11 completed. No rate-limit failures.
- Both previously skipped targets (IKEA and Marktguru) completed.
- One Instagram search timed out after 35 seconds; report correctly records
  completed-with-errors despite the successful workflow conclusion.
- 21 raw candidates, 171 records including retained history. Only one URL
  was new relative to the previous pending file: a Lavazza listing page.
  This is NOT a newly verified restaurant promotion.
- Zero broad AI-agent passes. No extra Apify run or increased daily budgets.
- Therefore increased daily deal yield is NOT demonstrated by this one run.
- Central dispatch completed successfully: 0 validated new deals, 1 unconfirmed
  Firecrawl review candidate sent to Slack, 0 social-food review candidates.
  https://github.com/ataalla24-ux/deal-finder/actions/runs/35837719575
- CI search/pacing, source-content protection and original-post checks passed:
  https://github.com/ataalla24-ux/deal-finder/actions/runs/35837509444
  Overall CI remains red at the pre-existing production-data validation step.

## Immediately relevant existing Slack candidates

These are existing finds, not new output attributed to this change. Their
original sources were checked again on 2026-09-23. No approval was added.

1. H11: free vegetable kebab on 23 September from 12:00, while stocks last,
   Neubaugasse 9, 1070 Wien. Prefer the original merchant post, not duplicate
   review-lane records with the incorrect fallback expiry of 26 September.
   Source: https://www.instagram.com/p/Ddd89V4t_IH/
   Slack: https://freefinder.slack.com/archives/C0AF8TXN2KW/p1790149881472969

2. Anar: 20% discount except the lunch menu, Falkestrasse 5, 1010 Wien,
   until the end of September according to the merchant post dated 21 September.
   The current Slack record still says Instagram / 24 September; correct
   merchant, address and expiry to 30 September before approving it.
   Source: https://www.instagram.com/reel/DdjNqPgND5a/
   Slack: https://freefinder.slack.com/archives/C0AF8TXN2KW/p1790019049726009

3. KAYA Bites: a free Pepsi or Ayran with a sandwich or plate, Engerthstrasse
   84, Vienna. The merchant explicitly gives 8-30 September. The post is older
   than seven days; do not present it as newly posted or relax social-age
   policy globally. This is a source-backed manual-review candidate.
   Source: https://www.instagram.com/reel/DdB2YfYMDUR/
   Existing queue message timestamp: 1789105990.926049.

4. Ganesha: EUR 10 off a EUR 50 restaurant bill, Eschenbachgasse 4,
   1010 Wien, until 31 December 2026. Coupon terms say restaurant consumption;
   the generic redemption instructions mention a delivery driver. Confirm
   that inconsistency before promoting it as an uncomplicated in-person deal.
   Source: https://www.gutschein.at/10-eur-gutschein-13

5. IKEA Family: weekday 1+1 on the specified daily main course, 11:00-14:00,
   4-25 September, participating Austrian IKEA restaurants. Existing pending
   records mix end dates and offers; review one canonical offer rather than
   approving multiple versions.
   Source: https://www.ikea.com/at/de/food/

## Next useful work

- Correct and approve the small source-backed shortlist through Slack.
- Evaluate food-search yield over several scheduled runs, using unique new
  manual approvals rather than the size of retained pending files.
- Replace consistently empty hashtag targets with measured merchant/scout
  coverage, without increasing paid crawl volume blindly.
- Keep work on the original checkout's Instagram/media-rescue changes separate
  until reconciled; the Ads Library integration was explicitly paused there.

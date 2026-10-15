# Slack food quality and collector recovery

Baseline: ef44b7585, isolated from the dirty owner checkout. Review window:
9-15 October (Vienna), 295 Slack deliveries, 20 approvals, no recorded rejections.
Pending messages are not negative feedback; approvals are not proof of factual accuracy.

## Changes

- Fix URL-object handling in the shared Meta quota wrapper. This caused Wien
  Combined to fail before contacting Meta. Persist failed collector reports and
  include source error details; preserve last-good deals on failure.
- Ad requests start at 1000 rows and shrink on Meta's payload-size error.
  Persist the working size per query, retain pagination cursors, isolate exhausted
  heavy queries, and count retries against the scan budget. Existing global
  authentication/quota stops remain enforced.
- Recognize plural cocktails/mocktails for offer deduplication, separate explicit
  campaign windows and important redemption conditions. Existing posted Slack
  message identities remain addressable; no manual message deletion.
- Reject explicit venue conflicts even if a generated city says Vienna. Repair
  direct-message versus dm merchant confusion when the caption names a restaurant.
  Show source-backed purchase/new-customer/follow-up conditions near the card title.
  Fix numeric-price versus gratis classification; exclude free-trade and itinerary
  false positives. Strong permanent prices and evidenced future offers remain valid.
- Prioritize high-intent recent merchant media, cap queue-age boosts, reserve 10%
  of sufficiently large media batches for exploration. Refresh failing signed
  media URLs through authenticated Graph at most four times per run, respecting
  shared quota and permissions. No increase in the daily AI allowance.
- Target Apify at recent food post URLs rather than unsuccessful profile/hashtag
  discovery. Exclude live/already-enriched posts and skip paid runs with no seeds.
  Separate seed enrichment from new-post discovery in its report.
- Prefer productive food accounts, retaining discovery/scouts. Use explicit
  manual feedback rather than published/collector-accepted counts for learned
  ranking, including separate scout manual outcomes and hashtag provenance.
- Report pending/approved/rejected cohorts and unique approved offer keys. Label
  Slack decision latency separately from unmeasured review effort. Do not divide
  one-run token snapshots by seven-day approvals to invent a cost metric.

## Verification

Focused deterministic regressions are in scripts/test-slack-food-improvements.mjs.
They exercise the actual Wien quota wrapper and collector together with controlled
GitHub/Meta responses, payload backoff, Slack duplicates, factual guards, retained
cheap/future offers, media recovery, explicit feedback and Apify targeting.
The pre-fix quota module reproduces Invalid URL before any network request.
All 23 selected local suites passed on 16 October, including collector, media,
shared quota, Slack approval/queue, source scheduling, feedback, Power food and
brand normalization regressions. External APIs in these suites are fixtures.
GitHub coverage CI now runs on relevant main pushes, without API credentials.
No native build, simulator, phone operation or manual Slack broadcast is required.

## GitHub and live verification

- Implementation pushed to main as 1c72ee42625bc98deac361534f0d57cc5f177735.
  Follow-up c527c5e36c4251311588b65244ef686306413c44 fixes the isolated Slack
  removal test fixture's explicit helper-copy list. That test passes locally and
  GitHub Slack Removal Tests run 38817763687 is successful.
- Instagram coverage run 38817630944 and Power Food run 38817630875 succeeded.
- Real Wien run 38817645997 reads 50 posts (46 unique), with zero accepted deals.
  Two hashtag sources completed their bounded pages; the next was deferred by
  the shared quota. The live report exposed a remaining healthy-versus-deferred
  reporting error. A regression first failed against that code, then passed with
  fix 69cb0aff1a3352ce33bf04dcb6f58d2aa2cde597. Successful partial results remain
  available; a quota pause no longer looks like complete healthy coverage.
  Follow-up Instagram coverage run 38818368112 also succeeded.
- Real Meta validation run 38817641574 completed but its collector is degraded,
  not a clean discovery success: 16 ad requests returned no ads, the only due
  account (@wien.orf.at) failed, and all 96 output deals were retained candidates.
  No new deal is claimed. The health probe successfully read own media and
  Business Discovery for @ciosgrill. The existing 48-per-24-hour AI allowance was
  already exhausted; no paid AI request was made. Four bounded signed-media URL
  refresh attempts did not recover inaccessible third-party media in this run.
- Apify live run 38818155939 used 18 direct posts, zero profiles and zero hashtags.
  The Actor visited all 18 and returned one candidate, correctly rejected by the
  importer for missing Vienna evidence. The importer incorrectly classified that
  policy rejection as a missing dataset. A red/green regression now distinguishes
  source-backed policy rejections from malformed data; timestamp/schema outage
  guards remain enforced. Targeted imports retain unexpired, recent pending
  output across incremental runs, without counting it as newly enriched deals.
- Production Feed Integrity run 38817630882 fails on four existing records:
  gs-552149, gs-552155, gs-549228 and stream-1. These same records were already in
  baseline ef44b7585. Do not describe all repository CI as green. The separate
  source-verified expiry process and removal safeguards were not bypassed, and
  no expiry was extended to suppress this validation failure.

## External requirements and limitations

The configured Instagram token expiry is 2026-10-21T00:00:00Z, not a newly verified
provider expiry. Existing health checks and deduplicated Slack alerts remain on.
Token renewal requires the owner's Meta authorization; no renewal is claimed.
Third-party media may remain inaccessible after refresh; failures stay explicit.
This change does not promise exhaustive Instagram coverage or a measured increase
in approved deals until subsequent production runs and human review supply evidence.

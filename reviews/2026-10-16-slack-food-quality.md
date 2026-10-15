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

## External requirements and limitations

The configured Instagram token expiry is 2026-10-21T00:00:00Z, not a newly verified
provider expiry. Existing health checks and deduplicated Slack alerts remain on.
Token renewal requires the owner's Meta authorization; no renewal is claimed.
Third-party media may remain inaccessible after refresh; failures stay explicit.
This change does not promise exhaustive Instagram coverage or a measured increase
in approved deals until subsequent production runs and human review supply evidence.

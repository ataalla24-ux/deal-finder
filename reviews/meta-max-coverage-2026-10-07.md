# Meta food discovery: maximum useful coverage

## Scope

User requested all reachable qualifying Vienna food/drink offers and maximum
permitted Meta capacity. Original dirty nested checkout and pending native work
were not modified. Firecrawl scraper/workflow files, live feed, approval/removal
policy, API permissions and paid AI budgets are unchanged.

## Production configuration

- Hourly workflow; up to 300 organic Graph requests and 300 selected accounts.
- Expanded German/English ad query pool for free food/drinks, inexpensive kebab,
  coffee, pizza, opening offers, brunch/buffet, BOGO and delivery coupons.
  Equivalent unordered keyword queries are deduplicated.
- ACTIVE Austrian Instagram ads only; page size 5,000, with trusted cursor-only
  pagination. Empty data terminates a query even with a paging hint.
- Persistent query checkpoints in `meta-instagram-state.json.adLibraryScan`.
  Nonempty heads are due after one hour, empty heads after three. Oldest due
  heads and unfinished pages rotate fairly. Refreshing a head does not erase
  its unfinished backfill. A 12-request seed reserves some backfill capacity;
  organic account/hashtag discovery runs next, then ads fill spare capacity.
- No collector output-count cap in production: all deduplicated verified
  candidates enter the existing central validation/durable Slack delivery path.
  This does NOT bypass moderation, quality checks or duplicate protection.

## Rate safety, not an invented Meta entitlement

Meta does not publish a fixed numerical call allowance for user tokens. The
200-times-active-app-users platform formula is not a restaurant-account limit
and cannot be multiplied by our source-directory size.

One shared CAS quota ledger coordinates every participating Graph collector.
The existing 190-reservation operational base may grow by up to 25% per step
against fresh Meta telemetry. Steps get smaller near the 95% stop threshold;
growth targets two percentage points below that stop. Peers adopt the committed
common capacity. Missing,
malformed or stale usage headers do not authorize growth. Samples expire after
two minutes rather than perpetually retaining old high readings. Production's
1,000-request rolling-hour ceiling is an engineering runaway guard, NOT a Meta
published limit or guaranteed entitlement. Three-second pacing and a 50-minute
ad fill deadline leave time to save state and run existing media checks.

At 95% observed usage, or an actual Meta throttle, all participating collectors
pause together. CPU/time, app/BUC/ad-account usage, Retry-After, BUC recovery
minutes and ad-account reset seconds are honored. Actual throttles reset the
learned capacity. We stop when relevant queries finish: no useless calls merely
to consume quota. A bounded validation run uses at most 16 ad page attempts,
80 organic requests and two existing AI calls, without adaptive expansion.

## Ongoing ad campaigns

Real ACTIVE-endpoint responses receive fresh evidence tied to the exact numeric
ad ID, public URL, API origin and Instagram publisher platform. Central Slack
validation accepts that evidence for 24 hours, with at most a 365-day campaign
start age. The actual delivery-start timestamp remains unchanged. Ordinary
social posts keep their existing seven-day maximum. Explicit expired calendar
dates/years, stopped campaigns and old relative "today" promotions remain
blocked. Future offer dates remain allowed. Ad-food gating additionally recognizes
Sonntagsbrunch and breakfast-buffet compounds; a genuine numeric price reduction
can qualify without requiring the literal word "nur".

## Local verification

Passed: `test:meta-ad-coverage`, `test:instagram-food-discovery`,
`test:instagram-shared-quota`, `test:instagram-graph-scan`, merchant discovery,
the 891-account maximum-coverage simulation, one-request Ad Library diagnostic
regressions, and the full 15-suite Instagram reliability command.

New tests cover 12-page pagination, fair rotation, interrupted scans, malicious
pagination URLs, expired cursors, empty terminal pages, secret-free checkpoints,
5,000-row request configuration, single-call access diagnostics, shared adaptive
growth, missing/invalid telemetry, high-sample aging, longest recovery time,
active/stale/mismatched ad evidence, expired prior-year offers, old relative
offers, future offers, uncapped verified output and seed/organic/fill ordering.

Local stubbed URL checks are not proof that Facebook ad permalinks return HTTP
200 from GitHub. Live verification is recorded below.

## Deployment and actual live results

Core changes were pushed to `main` in `ce987facfc4e`, `4d049dd36dfc` and
`593f56a40182`. Consumer-food and incidental-offer corrections followed in
`42e482402eae` and `dd8fa6fdf110`.

- Bounded collector, success:
  https://github.com/ataalla24-ux/deal-finder/actions/runs/37665090905
  Accepted the 5,000-row page configuration, read 210 unique ads and 1,324
  organic posts with 96 actual wrapped requests. OCR completed 24/24 posts;
  two successful AI calls used 4,706 tokens. Five deduplicated candidates
  included false positives and previously known offers: this is NOT proof of
  five new good food deals. A coffee-shop business course was blocked before
  Slack posting after this live check.
- One-call, read-only Ad Library diagnostic, success:
  https://github.com/ataalla24-ux/deal-finder/actions/runs/37665465907
  Read 52 ads without AI calls or Slack messages.
- Normal maximum-coverage collector, success with factual degraded report:
  https://github.com/ataalla24-ux/deal-finder/actions/runs/37666055266
  Read 151 unique ads and 2,092 organic posts. Shared capacity increased from
  190 to 237 rolling-hour reservations, then stopped at 95% Meta usage.
  There were 109 actual wrapped requests and 110 local reservations; other
  participating workers also used the shared rolling window. Meta recovery
  was saved until 18:38:46 UTC. Sixteen unfinished ad queries and 38 due heads
  remained persisted. These two runs overlap and must not be summed as daily
  unique coverage. The three output rows were staff-recruitment ads mentioning
  free breakfast, not consumer food deals; the new gate rejects all three.
- Final correction CI, success on `dd8fa6fdf110`:
  https://github.com/ataalla24-ux/deal-finder/actions/runs/37669061986
  Seven coverage/integration suites and read-only real GitHub quota-storage
  verification passed. Local 15-suite reliability, food discovery, shared
  quota and Slack repair tests were repeated successfully.

The ordinary verified Slack path has no daily count cap. The separate lane
for uncertain social-food review candidates retains its existing 16/day cap.
Neither model-call budgets nor manual approval requirements were removed.

## Live-discovered quality defects and safe Slack correction

The revised checks reject coffee-shop founder courses, employee-only meals,
free access to food stalls (not free food), and normal-priced painting courses
without a genuine saving. Discounted courses and explicit public food gifts
remain covered by positive regressions. The incidental organic check applies
to Meta Instagram origins, not to Firecrawl scraper behavior.

Three exact bot messages that escaped during earlier live runs were updated
in place with current automatic-block reasons. No messages were deleted and
no manual rejection/approval learning signal was fabricated:

- `meta-ig-18103178105573063`, circus/food-stall access:
  https://github.com/ataalla24-ux/deal-finder/actions/runs/37669064634
- `meta-ig-18642115168046564`, normal-priced painting activity:
  https://github.com/ataalla24-ux/deal-finder/actions/runs/37669067536
- `meta-ad-1059890699987314`, employee breakfast in a job advertisement:
  https://github.com/ataalla24-ux/deal-finder/actions/runs/37669088601

All three repair runs succeeded. Comparison before/after proved all 383 queue
entries remained, with only `validity` changed on those three target rows.
Original facts, message timestamps, other rows and human decisions were
unchanged. The genuinely discounted SoulArtMessage candidate was left alone.

An additional roundtrip regression preserves the exact ad-delivery provenance
through validation and recognizes the prior validator's single `deal.` prefix.
Repeated validation cannot extend a stale ACTIVE check or substitute a fake
campaign-start date. Conditional authenticated GitHub reads use verified ETags
and clone the last state on 304, while still checking global pause before every
Meta request. This avoids unnecessary quota-store primary-rate consumption;
compare-and-swap reservations and conflict handling remain authoritative.

Central dispatch actually delivered its messages, but run 37666519485 failed
afterward on the pre-existing community-acknowledgement HTTP 500. This work does
not claim that unrelated endpoint or the entire production pipeline is green.
https://github.com/ataalla24-ux/deal-finder/actions/runs/37666519485

## Limits

This does not guarantee all Instagram offers exist in the API or match our
queries. Ad decisions use API creative text; a complete ad-image/Reel OCR
pipeline is not included. Unknown redemption locations stay blocked. Larger
capacity does not imply more genuinely new deals. Ordinary Graph hashtags keep
their existing rolling distinct-tag restrictions; no token rotation, permission
bypass or Meta-limit evasion was added.

## Primary references checked 2026-10-07

- https://developers.facebook.com/docs/graph-api/overview/rate-limiting/
- https://developers.facebook.com/docs/graph-api/reference/ads_archive/
- https://www.facebook.com/ads/library/api/

The public API FAQ explicitly documents all matching search results across
pagination, with a maximum of 5,000 ads on each page. This is a page-size limit,
not a daily or hourly request allowance.

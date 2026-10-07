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
The existing 190-reservation operational base may grow by 25% steps when fresh
Meta telemetry is below 70%. Peers adopt the committed common capacity. Missing,
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

Live verification is recorded separately after deployment. Local stubbed URL
checks are not proof that Facebook ad permalinks return HTTP 200 from GitHub.

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

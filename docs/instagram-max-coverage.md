# Instagram discovery: maximum stable coverage

The Meta collector uses an hourly, breadth-first schedule. A large catalog is
not evidence of coverage: `meta-instagram-report.json` separately reports
queried accounts, first checks, unqueried directory leads and seven-day coverage.
These counts are NOT verified offers, Slack deliveries or manual approvals.
Queued jobs check out the current main when they start, not the possibly stale
event snapshot from before the preceding serialized job saved its scan state.

## Shared API budget

- All Graph callers still use the atomic shared quota branch. No runner bypasses
  reservations, including health checks, retries and field fallbacks.
- Production defaults to 190 admitted HTTP requests per rolling hour across
  collectors, reserving headroom against the 200-call single-user planning
  baseline. This is an operational ceiling, not a claim about the exact quota
  of our user token. Meta may count expanded requests differently, and CPU/time
  usage may limit throughput first.
- Every response checks the maximum of call-count, CPU and processing-time
  usage. At 95% the runners share a ten-minute pause before a new probe.
  Actual rate-limit errors pause for at least an hour, honoring longer
  Retry-After values. Missing/inaccessible reservation storage fails closed.
- Hourly jobs may wait up to six minutes for expiring reservations. Reservations
  remain valid for their five-minute spending lease plus a full rolling hour;
  an old runner's delayed calls cannot disappear from accounting early.
- The main collector spaces request starts by at least fifteen seconds. Other
  Graph users can claim shared slots during the scan instead of finding the
  whole hour exhausted by one burst. A dispatch-only validation mode bounds a
  short live check at 64 accounts, 80 requests and two paid AI classifications;
  scheduled production keeps the full settings.
- `INSTAGRAM_SHARED_MAX_REQUESTS_PER_HOUR` and
  `INSTAGRAM_SHARED_USAGE_THRESHOLD` can be configured if a different app/token
  entitlement is actually verified. Do not infer more budget from the number
  of observed restaurants or FreeFinder app installations.

## Account selection

- Include the complete fresh Vienna directory, bounded at 5,000 leads, rather
  than hiding most accounts behind a daily 200-account preselection.
- Target 90% food/drink. Reserve 55% of food slots for first checks, 30% for
  productive merchants and 10% for food scouts; remaining slots use oldest-due
  rotation. Empty lanes return capacity to the others.
- Interleave the lanes so an early quota stop still admits new merchants.
  First checks prefer website-linked evidence and relevant kebab, burger,
  coffee and other food merchants, with district-diverse order when available.
- Manual Slack approvals/rejections are distinct from collector acceptance.
  Scores smooth small feedback samples rather than treating one success as
  proof of a consistently productive source.
- Upcoming openings: hourly; approved/productive merchants: two to four hours;
  productive scouts: six hours; ordinary accounts: twelve hours; repeatedly
  fruitless accounts: twenty-four to seventy-two hours; repeatedly manually
  rejected sources: weekly. Existing source-failure/moderation blocks remain.
- Fetch each account's newest page before deep paging. Reserve requests for
  hashtags, return unused reservations to more accounts, then use leftover
  capacity for saved deeper-page cursors. Actual calls, not the 180-account
  planning target, determine how much work can complete.
- Preserve up to 5,000 account histories/checkpoints, preventing large catalogs
  from repeatedly forgetting sources after the previous 500/300-entry caps.
- Directory links and addresses are scheduling hints, not automatic Vienna or
  offer verification. Date, location, benefit and moderation gates remain.

## Hashtags and cost controls

The existing configured 28-tag pool is retained. Wien Combined's configured
ten tags are already a subset, keeping their union below Meta's 30 distinct
hashtags per connected account per rolling seven days. No new speculative
hashtags or account credentials are created.

Choose up to eight due tags per run: reward fresh candidate yield with sample
smoothing; prioritize food and concrete benefit tags; reserve exploration for
least-recently queried tags. Productive tags become due after three hours,
ordinary tags after twelve and empty tags after twenty-four. Broad `wien` and
`vienna` do not both consume slots in one run. Repeated queries still consume
the hourly API budget even though they do not add a new distinct weekly tag.

OCR remains bounded at 24 posts and paid media classification at six calls per
hourly run AND 48 recorded classification calls per rolling 24 hours in this
collector. Persisted call history prevents a new hourly job from resetting the
daily ceiling; exhausted classification budget does not block Graph or OCR.
Other collectors' OpenAI usage is separate. Call count is not a dollar cap;
token lengths vary. No billing,
automatic recharge, model, or purchase setting is changed. The output cap is
120 candidates; central Slack deduplication/manual moderation still applies.

## Verification

`scripts/test-instagram-max-coverage.mjs` simulates the complete 891-account
directory with strong incumbents and partial 80-account hourly runs. All
directory sources get an attempt within 48 simulated hours. This is a fairness
test, not a promise of live Meta access or verified deals for all 891 accounts.
Tests also cover reserved hashtag calls, returning unused reservations, shared
concurrent 190-call admission, CPU headroom, bounded budget waiting, retained
last-good output on deferral and histories larger than 500 accounts.

No Firecrawl scraper/workflow, live-feed removal policy, native app binary,
existing source conditions, or public offer has been edited by this change.

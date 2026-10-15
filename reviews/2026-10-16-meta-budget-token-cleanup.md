# Meta account, AI budget and expired-feed follow-up

## Scope

- Owner requested the remaining Meta account error, AI daily budget, four obsolete
  live deals, token renewal, tests and publication on main.
- Owner explicitly selected 144 AI analyses per rolling 24 hours. GitHub variable
  `META_INSTAGRAM_MEDIA_LLM_MAX_CALLS_PER_DAY` is 144. No billing, auto-recharge,
  model, API key, app/Store or customer-email settings were changed.

## Changes

- `wien.orf.at` was a website inferred from a bare caption mention, not a failure
  of the linked Instagram account. Bare ORF and Austrian institutional website
  namespaces are excluded; old unproven website discoveries are pruned on load.
  Explicit tags, provider-returned owners and curated accounts remain eligible.
  `cafe.at`, `chastudio.vienna` and `urbans.wien` recall is retained.
- AI classification retains the rolling daily ledger and adds a rolling two-hour
  pacing window. At the approved 144/day this permits at most 12 calls per two
  hours, also bounded by the existing per-run limit (two for validation scans).
  Failed attempted calls are still counted. Pacing does not reset at midnight or
  on a normal persisted restart. Slow runs charge at completion, conservatively.
  This is a call allowance, not a fixed dollar spend or guaranteed new-deal count.
- Health checks inspect the actual token via Meta `debug_token` using the existing
  app developer user token. No new app-secret dependency. Provider validity/app ID
  and the earlier of token expiry or data-access expiry are checked. If inspection
  is unavailable, the report explicitly identifies configured metadata as a
  fallback, without disabling otherwise working Graph endpoints.
- Expected app ID is configured via `META_INSTAGRAM_APP_ID`. Tokens and user IDs
  are not written into the inspection report. `input_token` is also redacted.
  Inspection is read-only, not an automatic Facebook Login token renewal.

Official reference inspected in the authenticated Meta browser:
https://developers.facebook.com/docs/graph-api/reference/v26.0/debug_token

## Four obsolete live deals

Deal Moderation run 38819752668 succeeded. Feed moved from 63 to 59 records.
The only live IDs removed were `gs-552149`, `gs-552155`, `gs-549228`, `stream-1`.
These are ID-only moderation entries, not provider/URL blocks. Three dated
campaign snapshots had ended on October 11/13; the old three-month Spotify
offer was superseded by the current one-month offer on its official page.
The existing moderation workflow also applied existing rejection entries to 40
pending records; those are not 40 additional new live-deal removals.

Plain production-feed validation, without removal-baseline exemptions: 59 deals,
zero errors, 13 existing presentation/map warnings. All other live records kept.

## Verification And Remaining Handoff

Local focused tests: media-budget rolling windows/72-hour simulation, maximum
coverage/catalog migration, Meta collector, media evidence and token health.
Provider responses in unit tests are fixtures, not live token-renewal proof.

The owner extended the token in Meta, then explicitly authorized storing it in
the existing GitHub secret. GitHub required reauthentication, completed by the
owner. `INSTAGRAM_ACCESS_TOKEN` updated at 2026-10-15T23:06:58Z. Configured expiry
is 2026-12-14T22:55:36Z (14 December, 23:55 Vienna). No permission expansion.
The user posted the credentials in chat despite the secret-entry handoff; they
were not copied to source or shell commands. A later rotation is recommended
because the active credential has appeared in the conversation.

## Live Results

- Source commit `a288faa09721298adaea5f5728674736b6517dd7` pushed main.
- Instagram Graph Coverage Tests 38821322828: success.
- Production Feed Integrity 38821322809: success, including map contracts.
- Public https://freefinder.at/deals.json returned HTTP 200 at 23:08:20Z:
  59 live deals, none of the four removed IDs, feed `ff1-a75b6e1251a4d56056af`.
- Bounded Meta run 38821620497: workflow success, factual collector degraded.
  Provider inspection confirmed the renewed USER token, correct app and five
  existing scopes; exact expiry matches configured metadata. Own-media and
  Business Discovery both work from GitHub. Data access ends 2027-01-13T23:01:23Z.
- Ten due accounts, 237 posts, zero account errors. Five false website leads
  pruned, including `wien.orf.at`; existing source-failure history is not erased.
- Both AI calls succeeded, one AI-positive candidate, two collector-accepted
  existing candidates, zero new deals. 96 retained candidates are NOT 96 newly
  found or Slack-approved deals. Budget: 48 prior calls, 2 validation calls,
  144 rolling-day maximum, 94 remaining; two-hour allowance 12.
- Four old media fetches still returned 403 and refresh recovered none. Ad
  scanning stopped after five requests when GitHub quota storage could not
  reserve/persist capacity. No Meta auth error was recorded. The old generic
  message does not establish which GitHub HTTP status caused this stop.

## Storage Failure Follow-up

The shared quota adapter now reports GitHub HTTP status, operation, rate-limit
classification and retry time without logging response bodies or credentials.
If telemetry persistence fails AFTER an already-reserved Graph call succeeds,
the downloaded response is retained while all subsequent local Graph calls stop.
No unreserved requests, retry storm, higher cap or credential bypass is added.
The pacing/budget reason is included in the GitHub step summary.

Focused shared-quota regressions cover HTTP 403 rate limit versus missing access,
secret-free errors, preserved downloaded posts, and no request after failed
telemetry persistence. Existing concurrent ceiling/cooldown and maximum-coverage
tests remain green. GitHub's documented REST limits are a separate constraint
from Meta's API limits:
https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api

## Second Live Validation And Transient Storage Recovery

- Source `382caa02078486c94229a455d7f561ed662d305d`: Instagram coverage CI
  38822321930 and production-feed CI 38822321907 both succeeded.
- Bounded live run 38822336282 succeeded as a workflow, but reported degraded
  collection. It read 356 Instagram posts and 250 ads, with zero newly accepted
  deals. Both additional AI calls worked (6,609 tokens); the rolling daily ledger
  held 44 calls afterwards, leaving 100 of 144. Old calls expired normally.
- Diagnostics establish a GitHub Contents API **HTTP 500 write-state failure**,
  NOT a Meta login failure or a confirmed rate limit. The shared quota state was
  only 5,280 bytes. Meta usage peaked at 67%; the global stop remained enforced.
  Four old media downloads still returned 403; their refresh could not complete
  after shared storage stopped. No evidence of recovered media is claimed.
- Added one bounded conditional-write retry for GitHub 500/502/503/504. Because
  a server error can occur after a successful commit, first wait at least two
  seconds and read current state without cache. Matching content means success;
  a different revision is a conflict, never overwritten. Only an unchanged base
  revision permits one retry. Ambiguous reads, sustained failures, rate limits,
  permission errors and long Retry-After instructions still stop safely.
- New fixtures failed on the prior source, then passed for failures before/after
  commit, a committed second attempt, concurrent writers, persistent failures,
  failed/malformed reconciliation, 429 and long Retry-After. Existing quota,
  maximum-coverage, Graph pagination and Ad Library tests passed again.
- Public feed recheck 2026-10-15T23:17:31Z: HTTP 200, 59 records, none of the four
  removed IDs. No unrelated native, Store, email, pricing or billing changes.

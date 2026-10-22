# Recurring food discovery within expiring trial credit

Owner requested regular ScrapingBee and Zyte use without additional monetary
cost. This extends the existing provider workflow, not the native app, existing
Power/Apify schedules, Slack approval rules or any customer messaging.

## Provider-side protection verified

Zyte organization 1047012 still shows the initial USD 5 trial for October 22 to
November 22, 2026. No paid subscription, payment or plan spending limit selected.
An organization-wide **blocking spending alert** was saved and verified after
reload: Billing cycle, USD 4, Block requests ON. The existing owner is the alert
recipient. This is a restrictive account-wide cap, not PAYG enrollment. Other
uses of this Zyte organization also count toward this cap and may be paused.

The extraction credential cannot query Stats API. The collector does NOT report
a fabricated live balance. Instead it requires the reviewed credential's SHA-256
fingerprint in `ZYTE_FREE_TRIAL_KEY_SHA256`, a fixed nonrenewing cutoff before
November 21 UTC, and conservative local reservations of USD 0.05 per call,
USD 0.10 per UTC day and USD 3 for this entire trial, including earlier tests.
Only plain browserHtml is requested, without AI, actions, screenshots or premium
geolocation. The provider cap leaves USD 1 of included credit as headroom.
The code cannot detect a human removing the provider-side cap: retain it, and
disable the workflow before changing the account/credential/billing setup.

ScrapingBee must return an authenticated usage response before reservation and
before every request: exactly 1000 trial credits, zero concurrency and at least
100 credits remaining after the request. Fixed basic rendering costs at most
5 credits; local caps are 10/day and 900 for the entire trial, including tests.
The trial is not monthly-free and stops before November 5 UTC (dashboard expiry
November 6). No premium, stealth, auto mode, AI or plan changes.

ScraperAPI keeps its existing free-plan, overage-OFF, 25/day and 900/31-day caps.
All providers keep every reservation, including failed or cancelled requests.
The one-shot benchmark remains permanently consumed and cannot be replayed.

## Scheduling and quality

One existing scheduled opportunity daily at 07:45 UTC. Up to two distinct merchant
pages per provider, at most six in a scan. Expiring Bee/Zyte credit has priority.
The pool is the existing 12 official food/coffee sources; alcohol-oriented bar
sources are not added. Rotate by oldest attempt, preserve shared source cooldowns
and 7/14/28-day no-gain pauses. No provider hopping on denied/throttled sources.
Some or all scheduled opportunities may legitimately do no provider requests.

Direct HTML is tried first; if it already provides offers, skip the provider.
Existing food/alcohol/evidence/date/location extraction, independent direct
official-page verification, feed deduplication and central Slack human approval
are unchanged. JS-only unconfirmed offers still cannot be queued. Neither more
requests nor a successful render means a new deal reached Slack.

## Verification

Provider policy/client/collector tests cover recurring trials, key rotation,
expiry, daily/lifetime exhaustion, low balance, no paid options, distinct-source
assignment, shared cooldowns, replay prevention and independent human-review
queuing. Live activation/audit evidence is recorded separately after deployment.

- Source 74fcdb0b110b39e162c72e1ecae302986058e8cd pushed nonforce, preserving
  concurrent generated-feed changes. 21 provider tests and six relevant existing
  suites passed locally; full Power Food CI 39851372924 succeeded.
- Read-only audit 39851392794 succeeded: Bee 10/1000, ScraperAPI 20/5000 with
  both overage switches OFF. Zyte key fingerprint obtained in Actions without
  exporting the key; bound as the repository variable above.
- Activated scan 39851542283 succeeded, confirmed trialKeyBound=true and correctly
  skipped all three services because today's benchmark already reserved their
  daily allowance. Zero additional scraped pages, candidates or Slack sends.
- FOOD_PROVIDER_DISCOVERY_ENABLED remains true. The existing 07:45 UTC daily
  schedule is unchanged. First expanded scheduled opportunity is October 23,
  09:45 Vienna; DST later changes the local clock time, not the UTC schedule.
- A local tomorrow-plan dry run selects six distinct pages with unchanged current
  usage. This is NOT a live full-batch run or proof of future Slack delivery.
- Evidence: root output/recurring-food-trials-2026-10-22/, downloaded before-binding
  audit and activated-scan artifacts. No payment, plan upgrade, new key, customer
  message, public-deal approval, native/Store/device/OS action or new automation.

Official references checked October 22, 2026:
- https://docs.zyte.com/zyte-api/pricing.html#spending-alerts-and-limits
- https://docs.zyte.com/zyte-api/usage/stats/index.html
- https://www.scrapingbee.com/documentation/

Pause with `gh variable set FOOD_PROVIDER_DISCOVERY_ENABLED --body false`.
Do not erase reservations or remove the Zyte blocking limit to resume scanning.

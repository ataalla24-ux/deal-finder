# Supplemental food providers: bounded free-credit rollout

## Owner request

Implement and test the supplied ScraperAPI, ScrapingBee and Zyte credentials to
improve Vienna food/non-alcoholic-drink discovery, without additional monetary
cost. This is backend discovery only, not a native app or Store release.

## Live evidence

- Read-only credential audit: Actions 39846823421, success.
- Six-request comparison: Actions 39847658729, success. Each service fetched the
  public Burger King app page and KFC Austria once. No retries or premium modes.
- All three fetched KFC and extracted the same already-known 1.70 EUR Crispy
  Cheese Burger offer. Existing direct-source verification confirmed its wording;
  this alone does not establish Vienna participation, expiry or Slack eligibility.
- Burger King: ScraperAPI/Bee returned an empty rendered shell; Zyte returned
  visible content, but no concrete offer was extracted. Do not report this as
  three equally complete JavaScript renders or six new deals.
- Unique confirmed candidates: 1. Already known: 1. New pending candidates: 0.
  New Slack messages from this collector: 0. No live deals approved/published.
- Read-only post-test audit 39848415559: ScraperAPI 20/5000 test credits used,
  pay-as-you-go and auto-upgrade both false; ScrapingBee 10/1000 trial credits.
- Zyte dashboard confirmed a trial with no selected paid subscription, two
  requests and approximately USD 0.006 from the included USD 5. The rounded
  overview showed USD 0.00; do not mistake rounding for zero credit consumption.
- Scan guard 39848781475 succeeded without scraping: another two-page batch
  would exceed the local daily cap and was rejected before any charged request.
- Power Food Discovery Tests 39848620421 succeeded on source 29fb047a5.
  Fifteen new provider tests plus existing food, source scheduling, validity,
  evidence and Slack approval regressions passed locally/CI.

## Operation

Workflow `food-provider-discovery.yml`, `FOOD_PROVIDER_DISCOVERY_ENABLED=true`.
One daily opportunity at 07:45 UTC, at most two official pages. Pool: Burger King,
NORDSEE, McDonald's, Der Mann and BackWerk. Last-attempt rotation and fresh Power
health are required. Existing Power/Apify schedules and budgets are unchanged.

1. Public exact-allowlisted merchant URLs only. Respect persisted Power cooldowns;
   no alternative service after a 401/403/429 response. Honor longer Retry-After.
2. Read-only provider usage check. A missing/changed/paid plan, active concurrent
   requests, insufficient headroom or unavailable usage stops the request.
3. Commit conservative reservations before any provider request. Failed/cancelled
   requests keep their reservations; no rerun/replay/refund of uncertain usage.
4. Try the free direct fetch first. If it already supplies offers, do not spend
   provider credits on the same page. ScraperAPI may render a missing-content
   page with max_cost=10. The explicit JavaScript wait is now configured, but the
   post-change wait has not been live-retested; the six-request comparison used
   the earlier renderer settings.
5. Feed provider HTML through the existing factual food/alcohol/date/location
   extractor. Independently re-fetch and confirm the official offer before
   queuing. No fabricated votes, dates, location, reward or automatic approval.
6. Deduplicate against current feed and all pending files. Keep unsent own
   candidates at most 48 hours. Central Dispatch picks up the standard pending
   filename on its existing schedule and revalidates before human Slack review.
7. No incremental offer: pause extra provider requests to that source for
   7/14/28 days. Skipping does not extend the deadline. This does not disable
   normal direct discovery. The first benchmark's BK/KFC no-gain results were
   persisted, not repeatedly fetched to spend trial credits.

## Cost boundaries

- ScraperAPI only for recurring provider calls: at most 25 reserved credits per
  UTC day and 900 per rolling 31 days, with at least 100 account credits held back.
  Actual two-page batches reserve at most 20. The recurring Free allowance is
  1000/month; the initial 5000 is a temporary trial, not a permanent allowance.
  Only account limits 1000/5000 with both overage switches false are accepted.
- ScrapingBee: initial trial comparison only, no recurring calls. Initial trial
  expires November 6; the code stops before November 5. Fixed basic rendering,
  no premium/stealth/AI/autoupgrade features. No monthly-free claim.
- Zyte: only the one-shot comparison within 24 hours of the dashboard trial check;
  reserve USD 0.05 per request, at most USD 0.10 total. Extraction keys cannot
  query the Stats API. No unattended Zyte use until free usage can be verified
  reliably. No spending-limit/plan/payment change was made.
- The comparison cannot be replayed with another workflow dispatch. Existing
  reservations were not erased after obtaining lower measured costs.

## Remaining limits

No increase in new Slack deals has yet been demonstrated. NORDSEE image/PDF-only
coupon text still needs grounded extraction; no prices or expiry were guessed.
JS-only offers that cannot be independently reconfirmed stay out of the queue.
The existing crawler now honors explicit `source.render`; a shell without a
browser is reported as needs-browser rather than healthy/no offers. Existing
native builds, user consents and customer notifications were not touched.

Pause supplemental scanning with:

```sh
gh variable set FOOD_PROVIDER_DISCOVERY_ENABLED --body false
```

Keep the ledger when paused or rolled back. This preserves the consumed one-shot
test and conservative credit reservations. Do not reset it to repeat tests.

## Primary documentation

- https://docs.scraperapi.com/account-management/credit-usage
- https://docs.scraperapi.com/control-and-optimization/cost-control
- https://docs.scraperapi.com/resources/faq/js-rendering
- https://www.scrapingbee.com/documentation/
- https://docs.zyte.com/zyte-api/pricing.html
- https://docs.zyte.com/zyte-api/usage/stats/index.html

Local evidence: root `output/food-providers-2026-10-22/`, audit/benchmark/after/
scan-guard directories. Public comparison report remains in Git history and the
GitHub artifact; the current report records the latest guarded scan.

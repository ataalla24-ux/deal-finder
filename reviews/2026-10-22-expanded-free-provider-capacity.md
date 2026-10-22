# Expanded free food-provider capacity

Owner explicitly requested maximum useful use of all three existing free API
credits, with no additional monetary costs. This supersedes the two-page/provider
daily cap in `2026-10-22-recurring-food-trials.md`.

## Allocation and safeguards

- Four scheduled opportunities: 07:45, 11:45, 15:45 and 19:45 UTC. Maximum 32
  distinct pages per run, 128 scheduled page slots/day across all providers, not
  per provider and not a guarantee of 128 requests or new offers.
- ScraperAPI: at most 4,900 locally reserved signup-trial credits before
  2026-10-29 00:00 UTC, only while the live account reports 5,000 included credits,
  zero concurrency and both overage/auto-upgrade disabled. Later, a verified
  1,000-credit free account can use at most 900 credits per rolling 31 days.
  Current live account headroom must always include 100 untouched credits.
- ScrapingBee: at most 900 total trial credits, 100-credit live reserve, exact
  1,000-credit account, zero concurrency, automatic stop 2026-11-05 00:00 UTC.
  Usage checks spaced at least 13 seconds apart (six/minute API limit).
- Zyte: at most USD 3.90 locally reserved for this trial. Existing USD 4.00
  organization-wide BLOCKING alert stays unchanged, below USD 5.00 free credit.
  Existing reviewed extraction-key SHA256 pin and 2026-11-21 cutoff remain.
  New plain browser requests reserve USD .02; historical .05 allocations are
  preserved. Published highest plain-browser tier is .01608/request, reviewed
  2026-10-22. No AI, actions, screenshots, premium location or other extras.
  Extraction credentials cannot read Stats: this is NOT a live balance claim.
- Serial requests, no retries, 18-minute collection window, 30-minute job limit.
  ScraperAPI checks wait 16 seconds after extraction for its delayed usage counter.
- Reserve/persist before requests. Only provably uncalled tasks can release their
  allocation. All started, failed, timed-out and interrupted calls retain it.
  No payment, plan, billing authorization or automatic upgrade is changed.

## Better coverage without duplicate spending

Existing official food/coffee roots plus merchant seeds, healthy child pages from
the fresh main crawler report, and discovered same-merchant offer links enter the
queue. Links are allowlisted, normalized, bounded to 40 per merchant and age out
after 14 days. No arbitrary domains, PDFs, login data or source-block bypass.
No same URL is allocated to multiple providers within a scan; canonical redirects
are deduplicated before a second provider call.

Direct HTML is checked first. If it already contains offers, those receive the
same independent evidence verification and review-only queue handling without
calling the paid API. Links from direct and rendered pages are retained for later
reserved runs. Empty/duplicate results back off per page for 7/14/28 days, not the
entire merchant. Positive rendered yield is rechecked no more than once daily.
Existing source-level HTTP/access cooldowns remain shared by all providers.

Unchanged: alcohol exclusion, Vienna/current-offer evidence, expiry validation,
human approval, central Slack dispatch, all primary/Apify budgets and schedules,
customer consent/messaging, app binaries and Store releases.

## Verification

Local provider regression suite: 32 tests passed, including legacy ledger,
allocation exhaustion, exact trial boundaries, failed/unknown calls, multiple
pages at one merchant, rate limits, direct discovery and no automatic approval.
All 15 existing food/source/evidence/Slack regression scripts passed.

Production rollout and actual run evidence to be recorded after deployment.

## Primary references

- https://docs.scraperapi.com/resources/faq/plans-and-billing
- https://docs.scraperapi.com/account-management/credit-usage
- https://docs.scraperapi.com/control-and-optimization/cost-control
- https://www.scrapingbee.com/documentation/
- https://www.zyte.com/pricing/
- https://docs.zyte.com/zyte-api/pricing.html

Remaining limitation: only independently verifiable, relevant offers can enter
the queue. Rendering alone does not prove Vienna eligibility or turn image/PDF
coupons into verified deals. Unused credit is preferable to repeating empty
pages or sending unsubstantiated promotions.

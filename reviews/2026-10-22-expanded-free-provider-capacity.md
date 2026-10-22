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

Local provider regression suite: 33 tests passed, including legacy ledger,
allocation exhaustion, exact trial boundaries, failed/unknown calls, multiple
pages at one merchant, rate limits, direct discovery and no automatic approval.
All 15 existing food/source/evidence/Slack regression scripts passed.

Source e9e38b40726aa7f25edaece896964c1151c585b5 deployed nonforce. Power Food CI
39854675657 succeeded. Live run 39854690150 succeeded operationally, with a PARTIAL
collector report: 19 planned pages, six successful provider page calls (four Bee,
two Zyte), one ScraperAPI HTTP403, 18 independently confirmed existing offers,
zero new candidates/Slack messages. Audit 39855145687 verified ScraperAPI20/5000,
Bee30/1000 and Zyte key pin; both ScraperAPI overage switches remained false.

The ScraperAPI dashboard's free Domain Credit Costs lookup for ikea.com showed
Standard Rendered=20 credits, above our fixed max_cost=10. This explains a possible
cost refusal, but the original 403 body was not retained, so its exact reason is
not proven. The healthy account audit and independent domain quote justify
removing ONLY the global provider pause raised by this one call. IKEA's shared
source pause until Oct25 stays intact; no retry or rotation around it, no max_cost
increase and no refund of the uncertain 10-credit reservation.

Future documented `This request exceeds your max_cost.` messages are classified
without logging response content and pause the source only. Unknown403,401,429
and unexpected reported costs still stop the provider. A targeted regression
checks both branches and secret redaction.

Correction3490f8cc1bca065e9d6bf49e385bf31de978d703 and Power Food CI39855579606
succeeded. Second live scan39855595897 completed:23/23 successful page requests
(ScraperAPI7, Bee8, Zyte8), no errors, no newly verified candidates. No provider
pause remains; IKEA stays quarantined. Combined this turn:29 successful provider
calls plus one403 refusal; zero new pending deals/Slack messages/publications.

Final read-only audit39856183434 succeeded at21:20:06UTC. Bee70/1000; ScraperAPI
observed80/5000, concurrency0, overage and auto-upgrade false; Zyte key pin valid.
ScraperAPI80 is below90 inferred from successful response headers including the
earlier benchmark, so it is not a reconciled billing total. Conservative ledger
retains100 ScraperAPI credits,70 Bee credits and.30USD Zyte reservations; no refund
or balance invention. No payment/plan change. All required local/manual jobs ended.
Evidence: root output/expanded-food-providers-2026-10-22/{scan,second-scan,audit,
final-audit,STATUS.json}. Primary/Apify schedules and follow-up unchanged.

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

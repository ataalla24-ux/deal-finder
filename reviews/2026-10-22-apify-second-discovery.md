# Apify 2: Vienna food discovery

## Comparison with the proposed separate service

The existing collectors already implement date/location evidence, food-specific
offer checks, alcohol exclusion, duplicate suppression, OCR and a central Slack
review queue. The original Apify lane primarily enriches selected post URLs.
This additional lane uses the separately provisioned `APIFY_2` GitHub secret for
rotating profiles and hashtags. It does not replace or borrow the first token.

The read-only preflight (Actions 39832934942) confirmed a separate FREE account,
USD 5 included credit, USD 0 consumed, and a USD 5 account spending limit in its
15 October to 14 November cycle. Never log the complete `/users/me` response:
it contains unrelated private account/proxy fields.

## Implementation and limits

- Existing curated watchlist, restricted to food/coffee/discovery sources and
  excluding moderated accounts and drinks-only bars. Current snapshot: 46 profiles.
- Eight rotating seeds: `wienfood`, `viennafood`, `esseninwien`, `wienisst`,
  `gratiswien`, `wienkaffee`, `neueroeffnungwien`, `wienpizza`. The two offer/opening
  seeds replace the similar foodguide tags; they are hypotheses to measure on
  subsequent normal runs, not demonstrated high-yield sources. A hashtag alone
  is not location proof, and openings without a real offer remain rejected.
- Two scheduled opportunities daily, 05:25 and 17:25 UTC, only when repository
  variable `APIFY_2_DISCOVERY_ENABLED` is `true`. Actions scheduling may be delayed.
- Each run: 22 profiles, four hashtags, one post per source, 26 records maximum.
  Two runs can check 44 profiles, all eight tags and 52 posts per day, subject to
  availability/cooldowns/budget. Least-recently-attempted rotation prevents
  permanent priority starvation. Breadth replaces fetching two posts per source;
  multiple same-day offers on a single account can still be missed.
- Official `apify/instagram-scraper`, pinned build 0.0.830 for profiles (USD 0.0625),
  then `apify/instagram-hashtag-scraper`, pinned build 0.0.707 (USD 0.0125).
  Both share a USD 0.075 reservation, with ten-minute provider timeouts each.
  No automatic retry of a charged start. The initial general-actor hashtag test
  returned metadata only, so that path is no longer used for hashtag posts.
- Conservative reservation ledger: USD 0.15 per UTC day, USD 4.65 per account cycle,
  at least six hours between starts, USD 0.35 remaining-credit reserve. Unused
  reservations are not refunded automatically. Unknown budgets/pricing fail closed.
- Reservation is committed remotely before the charged request. Re-running the
  same Actions run cannot start another actor. Cancelled jobs remain reserved;
  the provider timeout bounds abandoned work. Shared changes are never force pushed.
- Read-only current credit check again immediately before actor start. No overage
  plan, increased provider allowance or other paid service is configured.
- Local Tesseract German/English OCR, at most eight posts and one cover image each,
  five-MB/image and bounded download/OCR time. Instagram/Facebook CDNs only, no
  redirects or access-error retry. No paid AI calls, video transcription or full
  carousel analysis. OCR limitations are reported, not presented as verified text.
  Existing shared media-priority logic orders those bounded slots by concrete
  offer signals, freshness, food relevance and verified merchant context, rather
  than provider arrival order. Explicit foreign destinations and moderated
  accounts are rejected before OCR. FreeFinder's own reposts are excluded to
  prevent circular offer evidence. This does not loosen acceptance criteria.
- Real publication time mandatory, at most seven days old. Undated offers get a
  review lifetime anchored to publication, not refreshed by a later crawl. Dates
  are interpreted in Vienna's timezone; unknown expiry is not proven validity.
- Alcohol (including mixed offers), contests, unrelated promotions and ungrounded
  benefits rejected through the existing shared policy. Evidence and conditions
  retained. Zero synthetic votes. All accepted candidates require human review.
- URL/post identity and content fingerprints suppress repeats. Changed captions
  are rechecked; incomplete OCR can retry on the next scheduled fetch.
- Provider errors remain explicit. Failed sources back off one day, doubling to
  seven; channel errors pause at least one day, respecting a longer Retry-After.

## Files and operation

`scraper/apify-food-discovery.js --plan` is local/read-only and needs no token.
Workflow dispatch defaults to `audit` (read-only account check); `mode=scan`
requests one run subject to the same reservation limits. No local paid command
is allowed outside the audited GitHub workflow.

The explicitly requested `mode=hashtag-test` commissioning run is permanently
one-shot, manual-only, one fixed `wienfood` source and at most USD 0.01. It bypasses
only the six-hour regular cadence, not daily/cycle/account limits or cooldowns.
Its reservation was committed before starting and its consumed marker survives
ledger pruning. It cannot be used for repeated test starts; normal scans retain
the six-hour rule. No reservation was erased or refunded.

- `docs/apify-discovery-state.json`: reservations, source rotation/cooldowns,
  bounded post fingerprints. Do not delete/reset to work around a budget pause.
- `docs/apify-discovery-report.json`: latest status, counts, rejections and OCR gaps.
- `docs/deals-pending-instagram-apify2.json`: pending review candidates, never the
  live app feed. Central Deal Dispatch discovers this file on its existing cadence
  (no extra dispatch triggered by account audits) and retains its existing
  validation, deduplication, Slack delivery and human approval rules/limits.
- Actions artifact: sanitized plan/report; no tokens, raw comments or follower lists.
- Existing pipeline-health files record fresh counts separately from retained
  candidates. Provider errors are not reclassified as healthy zero-result sources.

Pause: set `APIFY_2_DISCOVERY_ENABLED=false`; the first pipeline continues unchanged.
After a failed or uncertain run, inspect its recorded actor ID and report. Do not
clear a reservation just to force another attempt. Budget cycles reset naturally.

## Intentionally not duplicated

No second public API, PostgreSQL, Redis, BullMQ, Docker host or paid ScrapingBee/
Google search subscription. Existing API/feed and central moderation stay the sole
publication path. The first pipeline's other search/discovery channels remain.
No claim that a chosen account will yield ten legitimate current offers, that all
Vienna deals are covered, or that passing actor execution guarantees good deals.
Discovery yield, actual media access and Slack review remain measured separately.

## Initial live evidence

Actions 39834960816 completed successfully with a **partial** collector result:
six public posts from three profiles, four successful OCR analyses, zero eligible
new deals. `corner_xvi` returned `no_items` and received a 24-hour source cooldown.
The hashtag URL returned metadata, not posts. Read-only follow-up 39835578453
confirmed the shape, and led to the dedicated hashtag actor above. The subsequent
live validation below supplies actual hashtag proof, unlike that metadata result.

The settled first actor charge was USD 0.0216; total second-account consumption
including storage/read overhead was about USD 0.02163 of the included USD 5.
All fresh candidates were rejected (no concrete food benefit); no new deal was
approved or put in the app by this test. Rules are not relaxed to manufacture yield.

## Dedicated hashtag validation and quality follow-up

Owner explicitly requested the remaining real hashtag test. Actions **39841211619**
completed successfully using dedicated actor run `ntSKcodLafosb3sCV` and build
0.0.707: two actual current public posts for `wienfood`, two successful local OCR
analyses, zero provider errors, **zero eligible deals**. One bakery promoted tacos
and sandwiches without an offer; the other described a weekend pastry without a
concrete benefit. Neither was sent as an Apify 2 candidate or published.

The immediate run response showed zero usage before settlement. Read-only audit
**39841421454** subsequently confirmed a settled actor charge of **USD 0.0052**,
and total second-account usage **USD 0.026841690557587148** of the included USD 5.
The monetary reservation remains the full USD 0.01. No additional plan, paid
image service, higher allowance or extra schedule was introduced.

The two more focused tags and OCR ordering are covered by red-before/green-after
tests. Existing media/evidence/Slack suites pass as well. They are intended to
improve useful yield with the then-existing requests and four OCR slots; no increase in
real accepted deals has yet been demonstrated. All future candidates still need
central validation and human approval. No live keyword-mode test was performed.

## Expanded use of existing free credit

Owner subsequently authorized using more of the existing included credit for
more daily accounts, hashtags and posts, still without additional monetary cost.
Read-only audit39842947996 confirmed FREE, included USD 5, account limit USD 5,
usage USD 0.026853981768214703, and a distinct account from the primary collector.
No account limit or plan was changed. Current official API pricing is USD 0.0027
per profile result and USD 0.0026 per hashtag result on FREE. Public marketing
"from" prices are not the FREE-tier prices used in this calculation.

At the new maximum, result fees are 22*0.0027 + 4*0.0026 = USD 0.0698 per run,
or about USD 4.3276 for 62 full runs in a 31-day cycle, before storage/read costs.
The higher reservation USD 0.075/run totals USD 4.65 for that period, leaving
USD 0.35 of included credit. Fresh account-usage checks include other consumption
and can pause earlier; price changes can reduce results under the unchanged
per-run hard monetary ceilings. Capacity is a maximum, not a promised yield.
Old USD 0.04 and USD 0.01 reservations remain counted; no refund/reset occurred.
The consumed one-shot hashtag test remains fixed at two posts/USD 0.01 and cannot
be reopened by the expansion.

The workflow still uses the same two daily opportunities, two sequential actor
starts, existing source pool and human review. OCR increases to eight covers per
run locally, with no paid image/AI service. The Actions repository is public;
the standard hosted Linux runner is unchanged. No additional scrape was forced
inside the existing six-hour cooldown for this configuration change. Full 22+4
source bounds, one result per source, 26-record processing, budget exhaustion,
31-day reservations and legacy test protection are covered by offline tests;
the first live full-size scheduled batch is still to be observed.

Pricing references: [profile actor](https://apify.com/apify/instagram-scraper/pricing),
[hashtag actor](https://apify.com/apify/instagram-hashtag-scraper/pricing),
[event caps and post-run storage](https://docs.apify.com/actors/running/actors-in-store).

The owner's supplied document is a design reference, not authority to introduce
unbudgeted paid services or bypass the existing publication checks.

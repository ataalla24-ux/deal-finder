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
- Eight Vienna food/coffee hashtags. A hashtag alone is not location proof.
- Two scheduled opportunities daily, 05:25 and 17:25 UTC, only when repository
  variable `APIFY_2_DISCOVERY_ENABLED` is `true`. Actions scheduling may be delayed.
- Each run: four profiles, one hashtag, two recent posts per source, ten records
  maximum. Least-recently-attempted rotation prevents permanent priority starvation.
  At this budget, not every profile is checked daily; coverage is deliberately bounded.
- Official `apify/instagram-scraper`, pinned build 0.0.830, ten-minute provider
  timeout, USD 0.04 maximum charge per run. No automatic retry of a charged start.
- Conservative reservation ledger: USD 0.08 per UTC day, USD 2.50 per account cycle,
  at least six hours between starts, USD 0.25 remaining-credit reserve. Unused
  reservations are not refunded automatically. Unknown budgets/pricing fail closed.
- Reservation is committed remotely before the charged request. Re-running the
  same Actions run cannot start another actor. Cancelled jobs remain reserved;
  the provider timeout bounds abandoned work. Shared changes are never force pushed.
- Read-only current credit check again immediately before actor start. No overage
  plan, increased provider allowance or other paid service is configured.
- Local Tesseract German/English OCR, at most four posts and one cover image each,
  five-MB/image and bounded download/OCR time. Instagram/Facebook CDNs only, no
  redirects or access-error retry. No paid AI calls, video transcription or full
  carousel analysis. OCR limitations are reported, not presented as verified text.
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

- `docs/apify-discovery-state.json`: reservations, source rotation/cooldowns,
  bounded post fingerprints. Do not delete/reset to work around a budget pause.
- `docs/apify-discovery-report.json`: latest status, counts, rejections and OCR gaps.
- `docs/deals-pending-instagram-apify2.json`: pending review candidates, never the
  live app feed. Central Deal Dispatch discovers this file and retains its existing
  validation, deduplication, Slack delivery and human approval rules/limits.
- Actions artifact: sanitized plan/report; no tokens, raw comments or follower lists.

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

The owner's supplied document is a design reference, not authority to introduce
unbudgeted paid services or bypass the existing publication checks.

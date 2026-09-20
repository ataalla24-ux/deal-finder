# Instagram Food Discovery

## Policy

The collector prioritizes current, directly usable Vienna food and drink offers.
At least 80% of account slots are reserved for food/drink when the catalog has
enough eligible accounts. Existing merchant/scout weighting, moderation blocks,
source cooldowns, discovery rotation and shared Graph quotas remain in force.
Food hashtags are prioritized inside the existing pool, without expanding the
rolling unique-hashtag allowance. Firecrawl collectors are unchanged.

Ordinary promotions, free food/drinks, BOGO and future offers retain their date,
location and concrete-offer checks. Particularly cheap regular prices can now
qualify without an explicit sale. Conservative review thresholds in
`scraper/food-discovery-utils.js` are EUR 4 for kebab/wrap/burger, EUR 5 for pizza,
EUR 6 for a main meal, EUR 2 for coffee/drinks, EUR 1.50 for selected snacks.
These are product-review policy thresholds, not asserted market comparisons.
Price tips keep the quoted product and amount; the title does not invent a
discount, prior price, or permanent availability. Add-ons, partial portions,
from-prices and weight prices cannot qualify through this new rule.

Post timestamps and explicit offer dates (including year) are still checked.
An undated regular price is not automatically made evergreen. Existing short
review TTLs and the maximum seven-day social-post policy remain unchanged.

## Media Recovery

Repeated media IDs are analyzed once. Already extractable or irrecoverably
rejected captions do not spend the collector's rescue budget. Carousel and reel
sampling remain enabled. Tesseract uses one OpenMP thread per process to avoid
CPU oversubscription. OCR timeouts can be retried after six hours.

OpenAI errors retain a sanitized status/category, not provider messages or keys.
Transient throttling/server errors get at most one retry, respecting Retry-After;
long waits are deferred. Billing/authentication failures stop the batch and
persist a six-hour cooldown. Failed/deferred AI analyses are retryable rather
than becoming negative results cached for seven days. Caption-confirmed deals
continue without AI. OCR-only claims still need successful AI corroboration.

## Instagram Advertising

The separate Ad Library API searches active Instagram ads reaching Austria,
using four rotating food queries and one page each per workflow run. It
deduplicates ads across terms and requires Vienna redemption evidence; ad
targeting alone is not sufficient. Only public ad permalinks are persisted.

The dedicated `META_AD_LIBRARY_ACCESS_TOKEN` is preferred. The workflow opts in
to trying the existing Instagram token when no dedicated token is configured.
This is a capability check, not a permission grant. On a denied API request it
stops the search rotation, records the error and backs off for six hours; organic
Instagram remains independently operational. Meta may require Ad Library
authorization and an appropriately authorized user token.

## Verification

Run `npm run test:instagram-food-discovery`, `npm run test:instagram-reliability`,
`npm run test:instagram-graph-scan` and `npm run test:slack-deal-quality`.

`docs/meta-instagram-report.json` records food account share, new food candidates,
media failures/cooldowns and ad capability. Collector acceptance is **not** proof
of Slack delivery or manual approval. The Central Deal Dispatch remains the
single writer for Slack with its existing validation and deduplication.

Official references: [Meta Ad Library API](https://www.facebook.com/ads/library/api/)
and [OpenAI API error codes](https://developers.openai.com/api/docs/guides/error-codes).

# Instagram Vienna Food Offers

Apify Actor that crawls Instagram account pages and hashtag pages, opens candidate post URLs, and returns only offers that match all of these rules:

- focus on **food and drinks**
- **free offers**, **BOGO / 1+1**, or concrete discounts (percentage, promo price, code, happy hour)
- clear **Vienna** relevance
- deal is **still valid** or **upcoming**
- every output item includes the **direct Instagram post URL**

## What it returns

Each dataset item includes:

- `postUrl`
- `postPublishedAt`
- `postPublishedAtSource` (the real Instagram metadata field used)
- `offerKind`
- `venueName`
- `locationText`
- `description`
- `validFrom`
- `validUntil`
- `stillValid`
- `matchedKeywords`

## Validity logic

The Actor keeps a post when one of these is true:

1. The caption/text contains an explicit future validity window.
2. The post is scheduled in the future.
3. There is no explicit end date, but the post itself is at most three days old by default (`maxAgeDaysWithoutExplicitValidity`).

Expired deals, giveaways, non-food offers, and non-Vienna posts are rejected.

Posts without a real Instagram timestamp are rejected. `scrapedAt` is diagnostic only and is never used as publication time. Each run inspects a bounded candidate window, moves visibly pinned profile posts behind ordinary posts, and then applies the real source timestamp. The importer rotates the full watchlist and merchant registry through deterministic shards.

Only accounts listed in `verifiedViennaAccounts` may use their account identity as Vienna evidence. Unverified registry leads must contain a Vienna geotag, address, postcode, or explicit post signal.

## Notes

- Changes under this Actor directory are tested and deployed to the configured `APIFY_INSTAGRAM_VIENNA_ACTOR_ID` by `.github/workflows/deploy-apify-instagram-actor.yml` after they reach `main`.
- Instagram is much more reliable with a logged-in session. If anonymous crawling gets blocked, provide `cookieString` or `sessionId`.
- The Actor uses `PlaywrightCrawler` with the Apify SDK and Crawlee, following the official Apify Actor structure and input schema format:
  - [Apify SDK docs](https://docs.apify.com/sdk/)
  - [actor.json docs](https://docs.apify.com/platform/actors/development/actor-definition/actor-json)
  - [input schema docs](https://docs.apify.com/actors/development/input-schema)

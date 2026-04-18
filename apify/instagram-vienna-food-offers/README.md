# Instagram Vienna Food Offers

Apify Actor that crawls Instagram account pages and hashtag pages, opens candidate post URLs, and returns only offers that match all of these rules:

- focus on **food and drinks**
- **free offers** or **BOGO / 1+1** style offers
- clear **Vienna** relevance
- deal is **still valid** or **upcoming**
- every output item includes the **direct Instagram post URL**

## What it returns

Each dataset item includes:

- `postUrl`
- `postPublishedAt`
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
3. There is no explicit end date, but the post itself is still recent enough according to `maxAgeDaysWithoutExplicitValidity`.

Expired deals, giveaways, non-food offers, and non-Vienna posts are rejected.

## Notes

- Instagram is much more reliable with a logged-in session. If anonymous crawling gets blocked, provide `cookieString` or `sessionId`.
- The Actor uses `PlaywrightCrawler` with the Apify SDK and Crawlee, following the official Apify Actor structure and input schema format:
  - [Apify SDK docs](https://docs.apify.com/sdk/)
  - [actor.json docs](https://docs.apify.com/platform/actors/development/actor-definition/actor-json)
  - [input schema docs](https://docs.apify.com/actors/development/input-schema)

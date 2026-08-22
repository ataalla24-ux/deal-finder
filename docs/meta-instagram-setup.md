# Meta Instagram Deal Discovery

This collector adds two official Meta sources without changing the existing Firecrawl collectors:

1. Meta Ad Library API for active Instagram ads delivered in Austria.
2. Instagram Graph API for exact hashtags and known professional accounts through Business Discovery.

The scheduled workflow stays visibly skipped until the repository variable
`ENABLE_META_INSTAGRAM_DISCOVERY=1` is set. A manual run fails when neither source is configured,
so a missing credential cannot look like a successful zero-result scan.

## Required GitHub secrets

At least one source must be configured:

- `META_AD_LIBRARY_ACCESS_TOKEN` for Ad Library discovery.
- `INSTAGRAM_ACCESS_TOKEN` for Instagram Graph discovery. The collector resolves the linked
  professional Instagram account through the managed Facebook Page automatically.
- `INSTAGRAM_USER_ID` is recommended when you already know the Instagram professional account ID.
  With it, the collector can use a Page token directly and skips fragile `/me/accounts` discovery.

The Instagram Graph path requires a professional Instagram account and the applicable Meta app
permissions. Hashtag discovery additionally requires Instagram Public Content Access approval.

Slack delivery uses the existing `SLACK_BOT_TOKEN` and `SLACK_CHANNEL_ID` secrets.

## Current setup checklist

1. In Meta, use a Business or Creator Instagram account that is linked to a Facebook Page.
2. Create or open the Meta app and use Instagram API with Facebook Login for this repo.
3. Generate a long-lived access token that can read the linked Page and Instagram account.
4. Save the token in GitHub as `INSTAGRAM_ACCESS_TOKEN`.
5. Save the linked Instagram professional account ID as `INSTAGRAM_USER_ID` when available.
6. Run `npm run instagram:meta:check` locally or the `Meta Instagram Deal Discovery` workflow manually.
7. Only enable the scheduled workflow after the healthcheck returns `ok`.

The existing GitHub workflow is already wired. If it reports `Bad signature`, the stored
`INSTAGRAM_ACCESS_TOKEN` is not a valid Meta Graph token anymore and must be replaced.

## Optional repository variables

- `META_GRAPH_VERSION` (defaults to `v26.0`).
- `INSTAGRAM_USER_ID` can be supplied as a secret to override automatic account discovery.
- `META_AD_LIBRARY_SEARCH_TERMS` as a comma/newline separated list.
- `META_INSTAGRAM_HASHTAGS` as a comma/newline separated list, without `#`.
- `META_INSTAGRAM_ACCOUNTS` for additional Business Discovery usernames.
- `META_INSTAGRAM_VERIFIED_ACCOUNTS` for accounts whose Vienna address has been checked outside the post.

Only put an account in `META_INSTAGRAM_VERIFIED_ACCOUNTS` after its Vienna location is backed by an
official website, address or merchant onboarding record. The ordinary watchlist is deliberately not
accepted as Vienna evidence.

## Evidence rules

A result is emitted only when all three facts are present:

- a real Graph timestamp or Ad Library delivery timestamp;
- a concrete deal such as a discount, free item, BOGO, coupon or explicit deal price;
- Vienna evidence in the content, EU ad target locations or the verified merchant list.

Organic posts are accepted for 72 hours. Posts up to seven days old require an explicit future expiry.
When an active ad or fresh post has no stated expiry, the emitted deal receives a transparent 72-hour
review TTL (`expirySource=short-review-ttl`) instead of pretending that an expiry was published.

Generated files:

- `docs/deals-pending-meta-instagram.json`
- `docs/meta-instagram-report.json`
- `docs/meta-instagram-auth-health.json`
- `docs/meta-instagram-state.json`

The state file caches hashtag IDs and recently observed Meta object IDs for diagnostics and fair batch
rotation. Observed IDs move behind not-yet-observed rows but never suppress collector output, because
collection alone does not prove that Slack delivery succeeded.
The state file never contains access tokens.

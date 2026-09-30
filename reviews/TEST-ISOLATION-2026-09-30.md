# Source-backed regression test isolation

The cheesecake fixture reused the real deal ID tiktok-1l9p5mu. The normalizer
honoured LIVE_DEAL_DOCS_DIR for deals but loaded moderation from the repository's
production docs directory. Manual Slack removal on 2026-09-27 therefore leaked
into the test and removed its fixture. This was not evidence of an app crash.

Normalizer now loads moderation from its configured docs directory, or the
explicit DEAL_MODERATION_PATH override. Default production path is unchanged.
The regression test owns an empty moderation file, checks content preservation,
then applies a test manual removal and verifies it still takes precedence over
reviewed content while both automatic-removal flags are disabled.

Passed locally: source-backed-content, live-deal-removal-safety, feed-contract,
offer-title, deal-logo-normalization, slack-deal-quality, slack-approval-validation,
firecrawl-search-client, firecrawl-search-utils, firecrawl-agent-utils,
firecrawl-instagram-direct4, firecrawl-post-verifier, map-enrichment, map validator.

Production data validation remains red (9 errors, 17 warnings): 5 expired deals,
Dahab truncated title, unsupported bildung category, missing SPAR/BIPA logo
files. No actual feed deals, dates, moderation decisions or removal policies
were changed to make tests green.

Additional map review: Madame Tussauds official address Riesenradplatz 5-6 has
separate OGD address records 5 and 6. Explicitly reviewed point 5 is used;
generic range matching was not loosened. Shared map now has 26 deals/50 points.
Unresolved merchant participation/address evidence remains in map-coverage.json.
No native app binary or store submission changed.

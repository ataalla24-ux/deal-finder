# Food Discovery and Alcohol Exclusion

Owner request: review recent Slack suggestions, focus discovery on food and
drinks, and exclude alcohol. Other app categories and existing live records are
not removed by this change.

## Evidence

Read actual public Slack threads, including:

- 19 October, 13:28 CEST: Babenberger Passage admission plus free beer/spritzer,
  a BUWOG property-fair lead, a free team-coaching consultation and a free
  property-clearance viewing.
  https://freefinder.slack.com/archives/C0AF8TXN2KW/p1792409311822209
- 20 October, 12:11 CEST: Ferris wheel and Women Event suggestions, which are
  not food offers but are not automatically removed just for being another
  category.
  https://freefinder.slack.com/archives/C0AF8TXN2KW/p1792491099110679
- Existing queue includes mixed cocktail/mocktail happy hours, a schnitzel/beer
  bundle and an unrelated SEO post in the social-food review lane.

## Changes

- Shared discovery policy rejects named alcohol offers, including mixed bundles.
  Explicitly alcohol-free products and mocktails remain eligible. Names/addresses
  alone are not treated as promoted alcohol. Common exclusions and "kommt rum"
  are not alcohol signals.
- Free sales consultations/viewings, real-estate leads and free business-only
  reservation tools are excluded. An unrelated SEO post is not a food review.
  Unknown food names are not rejected simply for missing a keyword.
- Food offers precede other valid suggestions in Slack, followed by existing
  validity/source/quality criteria. No invented price, expiry or approval.
- Meta/Instagram AI, TikTok and official-food extraction reject unwanted
  candidates early. No AI rescue or old-card editorial retry overrides policy.
- All central Slack lanes (including manual review candidates) share the final
  pre-dispatch gate. Old cards must pass it again on approval.
- Replaced the explicit beer search with Ayran and made the broad happy-hour
  query pizza-focused. Configured alcohol search terms are also filtered.
  Request/AI budgets, schedules and approval requirements are unchanged.

## Verification

Regression reproduced the old acceptance of "Gratis Spritzer & Bier" before
editing. Tests cover actual Slack examples, alcohol-free exceptions, food
priority, old-card approval and all central dispatch lanes. Existing tests that
deliberately expected alcoholic cocktail discovery now assert rejection and use
explicitly synthetic non-alcoholic counterparts for price/timing checks.

`node scripts/audit-food-discovery.mjs` is an offline, read-only preview of saved
outboxes, review candidates and queue history, not a live crawl or proof of
currently valid offers. Local logs and the full audit are retained outside the
repository in `output/scraper-food-2026-10-20/`.

Final local run: 28 suites passed. Offline snapshot: 1,070 distinct candidate IDs
including history; 45 alcohol, 13 business-lead and one unrelated SEO review
excluded. These are saved records, not 59 new offers or 59 live removals.

No existing Slack messages, live deals, customer data, native binaries or Store
metadata were edited. No paid-plan change, budget increase or manual collector
dispatch. Existing push-triggered collectors continue under their existing limits.

Code published as `82cc99d48b031d2e3f0370bff9045d2792a8ec5d`.
Power Food Discovery Tests 39412870702, Instagram Graph Coverage Tests
39412870704 and Pages 39412870435 passed. The normal push-triggered Instagram AI
run 39412870859 was still running at the final checkpoint; no result claimed.

Production Feed Integrity 39412870701 remains red for six expired pre-existing
records: `meta-ad-1110887824818940`, `g2-otf93r`, `gs-556781`,
`social-food-review-10etoi1`, `meta-ig-18647925118035759`, `flight-rbt5lu`.
The validator and all four input feeds are unchanged by this patch. Expiry dates
were not extended, records were not removed and the validation was not weakened.

## Remaining Source Limits

The saved 20 October Meta report reports Graph/Ad Library OK, 270 fresh posts and
three new collector candidates (not three published deals). Provider token
inspection reports expiry 14 December; the old 21 October warning is stale.
The Power report still has ten failed sources, including Too Good To Go HTTP 429
and KFC's untrusted redirect. These are not fixed by content filtering; no access
restriction is bypassed and no claim of complete coverage is made.

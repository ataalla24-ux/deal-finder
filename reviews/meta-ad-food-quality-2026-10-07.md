# Ad Library: real Slack delivery and scoped Food gate

## Live evidence before this quality fix

API access probe: https://github.com/ataalla24-ux/deal-finder/actions/runs/37655860339
One bounded request returned 53 ads with the existing authorized token. No AI
or Slack messages were used by that probe.

Real bounded collector: https://github.com/ataalla24-ux/deal-finder/actions/runs/37656840802
Started 2026-10-07 17:09 UTC, completed 17:16 UTC. Read 91 ads and 1236 organic
posts. Ad Library status was OK, with one accepted, new ad candidate. Graph was
degraded by one account-specific Invalid user id (akaraka_home), not a global
authentication failure. Eight total collector candidates are NOT eight manually
verified current offers; repeated organic output is included in that count.

The new ad was XxXL Grillrestaurant: Sunday brunch at EUR 9.90 instead of EUR
19.90, Wurlitzergasse 87, 1170 Wien; advertised window 04 Oct to 15 Nov 2026,
Sundays 09:00-12:00. Ad ID 1768157911106247.

Central dispatch: https://github.com/ataalla24-ux/deal-finder/actions/runs/37657811610
Its Slack delivery step succeeded. docs/deal-review-feedback.json records
meta-ad-1768157911106247 sent at 17:21:20 UTC / 19:21:20 CEST, pending manual
decision. This establishes real ad-to-Slack delivery, NOT app publication or
manual approval. Do not send the same ad again for a test.

The overall dispatch run failed afterward at the pre-existing community
submission acknowledgment HTTP 500. That separate service failure is not fixed
here; it must not be presented as an Ad Library/Slack delivery failure either.

## Observed quality defect

Four older ad-derived candidates had ALREADY been sent to Slack at 14:33 UTC:

- 1054221017431694: free e-commerce networking ticket, incidental drinks/snacks.
- 1714447872949942: office refrigerator service trial; meals paid separately.
- 1528665465695041: another office refrigerator service trial.
- 2203948727211270: discounted dentures with incidental eating/coffee references.

All four were pending in the feedback ledger. Food keywords alone were enough
for the Food-only ad lane. A free event ticket may be useful in an event lane,
but is not evidence of the direct consumer Food promotion this lane promises.

## Scoped fix

Require a consumer Food/drink benefit at ad normalization and again at the
central pre-Slack gate. Use the saved creative description for the latter,
not generic Ad Library page-preview text. Keep explicit Food discounts,
coupons, BOGO, named free food/drinks and conservative low-price tips. Reject
hardware, medical products, office service trials, shipping-only promotions,
negated benefits and incidental Food mentions.

Check separate offer clauses so a genuinely named free coffee benefit can
still pass in an otherwise non-Food event. An explicitly configured non-Food
Ad Library mode writes foodBenefitRequired=false; other scrapers do not acquire
this gate. Date, location, contest and other validity checks still apply.

## Verification and limits

Food discovery/Slack regressions, full Instagram reliability suites, maximum
coverage simulation, Ad Library diagnostic, Slack quality and approval
validation passed locally. A no-network replay of the four complete older
creative descriptions rejected all four at the central Food gate; replay of
the actual brunch candidate allowed it. URL health was stubbed for these
replays, so these checks do not establish a new live URL fetch.

This is a deterministic text gate, not a complete understanding of every ad.
Image-only offers and ambiguous wording can still be missed; multi-day yield
has not been established by one bounded run. Historic Slack messages/seen
keys, moderation records and published offers were not deleted or reset.
No automatic live-feed removal, Firecrawl scraper/workflow, native app, store,
identity/security setting or billing change was made.

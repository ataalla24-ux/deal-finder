# TikTok access and the 18 Instagram candidates

## Evidence

Historical Instagram output: `6ae240fbeb65`; following central dispatch state:
`aa553fa65d04`, report time 2026-11-10T21:26:10.688Z. Reproducible without network:

```sh
SENTRY_DISABLED=1 node scripts/audit-instagram-delivery.mjs 6ae240fbeb65 aa553fa65d04
```

18 extracted candidates were NOT 18 new deals. Fourteen exact posts were in
both the seen cache and the pre-dispatch posted queue. None of the other four
passed the central validator:

| Candidate | Original central decision | Action |
| --- | --- | --- |
| Only Pizza, free Pepsi | Encoded post date October 30, older than 7 days; stored Graph date says November 8 | Preserve existing date precedence and block; expose conflicting dates in delivery audit |
| Tuchlauben EIS, 6 Krapfen / EUR 9 or 10 / EUR 13 | No concrete promotion under current rules | No invented discount or relaxed bundle-price threshold |
| Mahrischer Spatz 1925, soup and lunch / EUR 14.90 | Editorial roundup | Fix duplicated evidence composition, not the roundup rule |
| Lunch with soup/salad / EUR 9.99 | No concrete promotion under current rules | Keep blocked |

The Mahrischer Spatz original URL returned HTTP 200 on November 11 at 09:25Z:
https://www.instagram.com/reel/DfiAZS_R3e8/
The same caption appears in Graph evidence, the OG title (author wrapper) and
OG description (author/date suffix). Concatenating all three makes dates in
later copies look like dates belonging to earlier undated menu bullets.
Replaying this exact current HTTP evidence and saved candidate with the old
validator blocks it; the new validator accepts it with no warnings, retaining
the November 13 expiry. This is validation proof, NOT a Slack receipt.

Only exact repeated long evidence passages across fields are collapsed; distinct
conditions, captions and real dated roundups are retained. No fuzzy rewriting,
offer facts, quality patterns, age rules or thresholds changed. The source
records and original evidence remain untouched.

The central validity report now contains `instagramDelivery`, with per-candidate
first blocking stage, reasons and declared/selected source dates. Selected for
delivery is separate from an actual confirmed Slack timestamp. Only standard
Instagram AI delivery is counted, not other sources or review-lane messages.

## TikTok

Scheduled run 42913769770 returned HTTP 200 with provider code 2483, not an empty
successful search. The fallback search later returned a challenge/403. The
stored pauses expire on November 11 around 22:22Z (23:22 Vienna). They are not
cleared, shortened or bypassed by this change.

Replace the hand-built website API fetch with normal public search-page
navigation, observing the browser's own exact-keyword response. Pagination uses
normal scrolling. Do not synthesize signatures, forge browser versions, use
proxies, solve challenges, log in, or switch endpoints after refusal. Cap
outgoing search requests at the existing page/count allocation and stop the
page before releasing the request guard. Unknown responses, visible challenges,
provider errors and HTTP 403/429 fail closed with the existing persistent pause.
Malformed optional item metadata cannot crash normalization or invent a date.

Browser tests fulfill/abort all traffic locally, including real Chromium
navigation, pagination, provider 2483, 403/429, unrelated responses, no-response,
request caps and cooldowns. They are NOT proof that TikTok permits GitHub access.
The production schedule and all candidate/media/model budgets are unchanged.
Successful live discovery must be confirmed after the existing pause, not
claimed from fixtures. No additional paid provider, manual collector run,
forced deal publication, seen-cache reset or Slack test send is part of this fix.

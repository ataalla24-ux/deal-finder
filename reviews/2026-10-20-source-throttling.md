# Source Throttling and Vienna Food Discovery

Owner requested better handling of throttled sources without additional costs.
The changes reduce wasted requests and prioritize Vienna food discovery within
existing budgets. They do not unlock blocked providers or guarantee exhaustive
coverage of Vienna offers.

## Source Findings

The saved Power report at 10:15 UTC contained 43 reachable and 10 failed sources.
Too Good To Go returned 429; six retail sources returned 403; MediaMarkt returned
404 and Libro 521. KFC failed an official-host redirect check. NORDSEE's HTML page
worked, but its extensionless `/at/coupons/pdf` download was treated as HTML.

Read-only checks confirmed that `www.kfc.co.at` redirects to `kfc.co.at`.
Only these two exact Austrian hostnames are trusted. KFC and NORDSEE each
returned HTML successfully in the bounded check; no blocked provider was retried.

The latest Instagram AI report contained a DuckDuckGo 403 at the end of its
search batch. The search loop previously continued after individual failures.
Meta Graph itself was not throttled in its 11:37 UTC report: one account returned
no media collection. The combined Graph run exhausted its local request budget
after broad `wien`/`vienna` searches, before `viennafood`.

## Changes

- Power sources preserve cooldowns in the already-persisted source report.
  Initial pauses: 429 for 24 hours; 401/403/404/410 for 72 hours; other errors
  for 6 hours. Consecutive failures double these pauses up to seven days.
  A longer server Retry-After always takes precedence.
- A skipped run does not extend the deadline, issue network requests or claim a
  source is healthy. A successful retry resets backoff. Existing complete-source
  failures are adopted from the saved report; optional legacy page failures do
  not pause an otherwise reachable source.
- No browser retry after 401/403/429. Official food crawls stop visiting further
  merchant pages after those responses. Redirect destinations are deduplicated
  against queued seeds without consuming an extra page slot.
- Food sources are scheduled first. Other categories remain available.
- Combined Graph discovery interleaves two food hashtags and one broader tag,
  rotating by previous attempt time within each group. Request, media and AI
  budgets are unchanged; incomplete runs still preserve last-good output.
- DuckDuckGo stops on 401/403/429 or a server Retry-After, persists at least a
  24-hour pause, and retains candidates already found. Later runs skip the search
  service until due, without disabling independent sources or altering cookies.
  Search requests have a 12-second timeout and one-second spacing.
- KFC uses its canonical official hostname. Its opted-in promotional image
  captions are extracted verbatim, without OCR or an AI call. A saved live page
  yields one burger-price candidate with location and expiry still missing.
  It remains review-required; no Vienna eligibility or end date is invented.
- Extensionless PDF download paths are excluded from the HTML crawler.
  NORDSEE's image/PDF coupon prices remain a coverage gap, not invented offers.

## Verification

31 local suites passed, covering cooldown persistence/recovery, Retry-After,
zero requests during pauses, HTTP wrappers, browser refusal after blocking,
food prioritization, a real collector path with a one-request mocked Graph
budget, exact KFC captions, alcohol/location/expiry rejection, central approval,
shared quota, authentication, generated-state merge and report regressions.
The old 403 fallback and KFC hostname tests failed before the corrections.

A no-network replay of the saved Power report defers nine sources and leaves
the corrected KFC and reachable NORDSEE source due. This is scheduling evidence,
not proof those external providers have lifted their restrictions.

Evidence: `output/source-throttling-2026-10-20/` in the native workspace,
including `tests.json`, `live-food-checks.json`, `kfc-extracted.json`,
`source-plan.json` and individual test logs.

The separate production-feed validator still reports the same six expired IDs:
`meta-ad-1110887824818940`, `g2-otf93r`, `gs-556781`,
`social-food-review-10etoi1`, `meta-ig-18647925118035759`, `flight-rbt5lu`.
Feed contents, expiry dates and validator rules are unchanged.

No paid service, plan upgrade, higher quota, manual paid collector dispatch,
customer message, native build or Store change. Existing approval requirements,
alcohol exclusion, schedules and consent settings remain in force. The previous
normal Instagram AI run 39412870859 has since completed successfully.

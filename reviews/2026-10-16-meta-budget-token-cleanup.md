# Meta account, AI budget and expired-feed follow-up

## Scope

- Owner requested the remaining Meta account error, AI daily budget, four obsolete
  live deals, token renewal, tests and publication on main.
- Owner explicitly selected 144 AI analyses per rolling 24 hours. GitHub variable
  `META_INSTAGRAM_MEDIA_LLM_MAX_CALLS_PER_DAY` is 144. No billing, auto-recharge,
  model, API key, app/Store or customer-email settings were changed.

## Changes

- `wien.orf.at` was a website inferred from a bare caption mention, not a failure
  of the linked Instagram account. Bare ORF and Austrian institutional website
  namespaces are excluded; old unproven website discoveries are pruned on load.
  Explicit tags, provider-returned owners and curated accounts remain eligible.
  `cafe.at`, `chastudio.vienna` and `urbans.wien` recall is retained.
- AI classification retains the rolling daily ledger and adds a rolling two-hour
  pacing window. At the approved 144/day this permits at most 12 calls per two
  hours, also bounded by the existing per-run limit (two for validation scans).
  Failed attempted calls are still counted. Pacing does not reset at midnight or
  on a normal persisted restart. Slow runs charge at completion, conservatively.
  This is a call allowance, not a fixed dollar spend or guaranteed new-deal count.
- Health checks inspect the actual token via Meta `debug_token` using the existing
  app developer user token. No new app-secret dependency. Provider validity/app ID
  and the earlier of token expiry or data-access expiry are checked. If inspection
  is unavailable, the report explicitly identifies configured metadata as a
  fallback, without disabling otherwise working Graph endpoints.
- Expected app ID is configured via `META_INSTAGRAM_APP_ID`. Tokens and user IDs
  are not written into the inspection report. `input_token` is also redacted.
  Inspection is read-only, not an automatic Facebook Login token renewal.

Official reference inspected in the authenticated Meta browser:
https://developers.facebook.com/docs/graph-api/reference/v26.0/debug_token

## Four obsolete live deals

Deal Moderation run 38819752668 succeeded. Feed moved from 63 to 59 records.
The only live IDs removed were `gs-552149`, `gs-552155`, `gs-549228`, `stream-1`.
These are ID-only moderation entries, not provider/URL blocks. Three dated
campaign snapshots had ended on October 11/13; the old three-month Spotify
offer was superseded by the current one-month offer on its official page.
The existing moderation workflow also applied existing rejection entries to 40
pending records; those are not 40 additional new live-deal removals.

Plain production-feed validation, without removal-baseline exemptions: 59 deals,
zero errors, 13 existing presentation/map warnings. All other live records kept.

## Verification And Remaining Handoff

Local focused tests: media-budget rolling windows/72-hour simulation, maximum
coverage/catalog migration, Meta collector, media evidence and token health.
Provider responses in unit tests are fixtures, not live token-renewal proof.

The owner-generated short-lived token was inspected in Meta: valid, correct app,
existing five permissions, approximately one hour of validity. It was not stored
as a production replacement. Owner must complete Meta's extension and the secure
GitHub secret update; no token content belongs in this report or the repository.
Live validation and final renewal evidence will be recorded below after completion.

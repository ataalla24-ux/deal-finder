# Daily native deal notifications

## Rollout gate

On 2026-10-08 the owner explicitly requested activation before the remaining
end-to-end handset test: "aktiviere einfach und wenn ich die neue version vom
app store downloade werden wir sehen ob es klappt". DAILY_PUSH_ENABLED and
MARKETING_PUSH_ENABLED are therefore set to 1. This is an accepted rollout risk,
NOT evidence of successful handset display/tap. The test remains outstanding.

Pro/Plus receives only the actual published Deal of the Day; Free receives
marketing tips only with explicit policy-v2 marketing consent, on Monday,
Wednesday and Friday. Both run in the existing 09:00-10:00 Europe/Vienna
window. No eligible fresh/non-repeated offer means no message. Opening the
updated app and granting OS permission are needed for a current registration.
Legacy registrations remain excluded. Trial reminders are unchanged.

The production store builds containing this policy are iOS 1.32 (70) and
Android 1.35 (71), submitted but not yet verified live. iOS build 70 is also
available to the existing internal TestFlight group.

Emergency stop: set BOTH flags to 0 and deploy with --keep-vars, explicitly
overriding the two flags if needed. Preserve all secrets, bindings and existing
cron schedules. Registration and read-only status/preview work independently.

Original verification checklist (the owner waived completion before activation):

1. Configure Firebase for Android package `com.stefanataalla.freefinderwien`.
   Add its genuine `google-services.json` to the native app, and provision a
   dedicated Firebase Messaging service account as the Worker secret
   `FCM_SERVICE_ACCOUNT_JSON`. Do not expand the Play billing verifier account.
2. Verify a consented production APNs device and a real Android FCM device;
   test notification receipt with the app backgrounded, opening the exact deal,
   opt-out, Free-plan removal, disabled OS permissions and token rotation.
3. Ship the corresponding native changes with NEW build numbers. Already
   submitted iOS 1.32 (68) / Android 1.34 (70) do not contain this implementation.
4. Inspect admin `GET /api/push/daily/preview` (never sends) and `/status`.
   Activate only after the remaining real-provider/device checks pass.

No migration of legacy token records into the daily audience occurs. Current
clients must register policyVersion 1, explicit enabled state, Pro/Plus plan,
permission, language, environment, installation ID and a timestamp. APNs
sandbox and Android development devices are excluded from automatic production
sends. Android registrations without explicit environment metadata are disabled.
Plan is client-reported, not independently verified by a server receipt check.
Registrations expire for targeting after 30 days without refresh, and device
records are purged after 60 days. Refunds/expiry while an iOS app remains closed
cannot be discovered immediately with the current entitlement architecture.

## Delivery rules

- One selected offer each Vienna day, dispatch between 09:00 and 10:00 Vienna.
  Both DST offsets are scheduled; hourly watchdog retries do not bypass the
  local-time gate. Delivery time is not an exact device-time guarantee.
- Only a fresh public feed AND successful moderation-state read may select an
  offer. Require manual approval, high-confidence explicit calendar validity,
  no internal review text, no hidden/expired/future offers. Recurring/clock-time
  offers are currently omitted rather than guessing their availability.
- Reuse existing native daily selection among the safe subset, preferring a
  current manually selected daily deal when eligible. A deal ID is not repeated
  for seven days. If no qualifying deal remains, send nothing.
- SQLite Durable Object persists device revisions, campaign and atomic
  per-installation/day claims. Batches are limited to 20. Unknown provider
  outcomes are not retried, preventing a blind retry from sending twice.
  `accepted` means accepted by APNs/FCM, NOT proven handset delivery.
- APNs uses correct device environment, collapse ID and expiration. FCM is
  data-only; Android also checks local permission/plan, day, expiration and
  duplicate receipt. The old cached/fallback-deal alarm is cancelled on upgrade.
- Default notification: `FreeFinder Top-Deal`, `Heute: [title] · [merchant]`.
  English app settings use `FreeFinder top deal` / `Today:`. Source offer text
  is not machine-translated. Tap opens the exact native deal ID.
- Trial-end reminders, subscription terms, prices, QR codes, live deal contents
  and Slack moderation are unchanged. No marketing broadcast endpoint is added.

## Verification

`node --test referrals-worker/test/*.test.js` covers selection, DST, consent
metadata and mocked APNs/FCM request contracts. `npm test` in merchant-worker
includes real Workers/SQLite runtime coverage for concurrent claims, batching,
rotation, stale requests, opt-out, provider ambiguity, moderation updates and
expired registrations. No test sends a production push.

# FreeFinder Referral Worker

Central referral backend for the FreeFinder PRO unlock flow.

## What it solves

The old implementation stored referral progress in `localStorage`. That only worked on the same device and could not reliably detect friends downloading the app.

This worker makes referral progress authoritative:

- inviter registers a referral code
- friend opens a referral landing link
- backend creates a pending claim token
- friend confirms the install flow later
- backend increments the inviter's referral count

This is still not an Apple-verified install callback. It is the strongest web-compatible flow available without native App Store attribution APIs inside the iOS app.

## Endpoints

- `POST /api/referrals/register`
- `GET /api/referrals/status?code=FF-XXXXXX`
- `POST /api/referrals/claim/start`
- `POST /api/referrals/claim/complete`
- `POST /api/push/apns/register`
- `POST /api/push/apns/send`
- `GET /api/push/apns/status`
- `POST /api/checkout/session`
- `GET /api/checkout/status?session_id=cs_...`
- `POST /api/checkout/webhook`
- `POST /api/slack/interactions`
- `POST /api/slack/events`
- `POST /api/social/tiktok/connect-session`
- `GET /api/social/tiktok/callback`
- `GET /api/social/tiktok/status`
- `POST /api/social/tiktok/publish`
- `GET|POST /api/social/tiktok/publish/status`
- `POST /api/social/media`
- `GET /api/social/media/:token.:extension`
- `POST /api/social/instagram/connect-session`
- `GET /api/social/instagram/callback`
- `GET /api/social/instagram/status`
- `POST /api/social/instagram/publish`
- `GET|POST /api/social/instagram/publish/status`
- `POST /api/social/instagram/publish/complete`
- `GET /health`

## TikTok publishing

The Worker owns the OAuth callback, encrypted refresh-token storage, token rotation,
idempotent Direct Post initialization, direct file-upload sessions, and publish-status
polling. `PULL_FROM_URL` media must use the verified `https://freefinder.at/` prefix.
Local MP4, MOV, or WebM files can use `FILE_UPLOAD`; TikTok receives the binary directly,
so no video file needs to be committed to the website repository.

Set these Worker secrets before connecting the account:

```bash
npx wrangler secret put TIKTOK_CLIENT_KEY
npx wrangler secret put TIKTOK_CLIENT_SECRET
npx wrangler secret put TIKTOK_SANDBOX_CLIENT_KEY
npx wrangler secret put TIKTOK_SANDBOX_CLIENT_SECRET
npx wrangler secret put SOCIAL_TOKEN_ENCRYPTION_KEY
npx wrangler secret put SOCIAL_CONNECT_TOKEN
npx wrangler secret put SOCIAL_PUBLISH_TOKEN
```

Optional variables:

```text
TIKTOK_EXPECTED_USERNAME=freefinder.at
TIKTOK_REDIRECT_URI=https://freefinder-referrals.freefinder-stefan.workers.dev/api/social/tiktok/callback
```

`connect-session` and `status` accept `Authorization: Bearer <SOCIAL_CONNECT_TOKEN>`.
Publishing accepts `Authorization: Bearer <SOCIAL_PUBLISH_TOKEN>` and requires an
explicit `consent: true` marker plus an idempotency key for every individually reviewed post.
Production is the default. Add `?environment=sandbox` to connection/status requests,
or `"environment":"sandbox"` to publishing requests, for isolated sandbox credentials,
encrypted tokens, and idempotency records.

TikTok's Content Sharing Guidelines require a visible preview, current creator data,
manual privacy and interaction choices, and express consent before every Direct Post.
They also reject internal utilities that only publish to accounts managed by the app owner.
For that reason production TikTok publishing is disabled by default, and the CLI only posts
to TikTok in `sandbox`. Keep daily TikTok packages as `READY_FOR_UPLOAD` and schedule them
manually in TikTok Studio. A future compliant creator-facing review UI may enable the Worker
guard with `TIKTOK_PRODUCTION_PUBLISH_ENABLED=1` after TikTok approves that integration.

## Instagram publishing

Instagram publishing uses **Instagram API with Instagram Login**. The connected account
must be a professional Business or Creator account. A linked Facebook Page is not
required for this login type. Configure the Meta app with this exact OAuth callback:

```text
https://freefinder-referrals.freefinder-stefan.workers.dev/api/social/instagram/callback
```

Required scopes:

```text
instagram_business_basic
instagram_business_content_publish
```

Set the Meta app credentials as Worker secrets:

```bash
npx wrangler secret put INSTAGRAM_APP_ID
npx wrangler secret put INSTAGRAM_APP_SECRET
```

The existing `SOCIAL_TOKEN_ENCRYPTION_KEY`, `SOCIAL_CONNECT_TOKEN`, and
`SOCIAL_PUBLISH_TOKEN` secrets are shared with TikTok. Optional variables:

```text
INSTAGRAM_EXPECTED_USERNAME=freefinder.at
INSTAGRAM_REDIRECT_URI=https://freefinder-referrals.freefinder-stefan.workers.dev/api/social/instagram/callback
INSTAGRAM_GRAPH_API_VERSION=v26.0
```

The Worker exchanges the OAuth code for a long-lived Instagram token, stores it encrypted,
and refreshes it before expiry. Reels are initialized, polled until processing finishes,
then published through a separate idempotent completion request. The temporary media
endpoint accepts authenticated files up to 24 MB and removes them automatically after
36 hours. Public download URLs are unguessable and exist only so Meta can fetch the file.

Publish a prepared video to both platforms from the repository root:

```bash
npm run social:publish -- \
  --platform both \
  --video /absolute/path/to/freefinder-reel.mp4 \
  --tiktok-caption "Gratis essen und trinken in Wien mit FreeFinder #freefinder" \
  --instagram-caption "Gratis essen und trinken in Wien. Jetzt mit FreeFinder entdecken. #freefinder" \
  --idempotency daily:2026-08-21 \
  --consent
```

The script validates the video with `ffprobe`, loads `SOCIAL_PUBLISH_TOKEN` from the
environment or the macOS Keychain service `freefinder-tiktok-publish-token`, uploads the
file, polls both platforms, and prints a secret-free JSON result. Use `--dry-run` to check
connections without uploading or publishing anything.

## Slack approvals

Slack approve reactions can trigger the GitHub approval workflow immediately. In the Slack app dashboard, configure Event Subscriptions with this request URL:

```text
https://freefinder-referrals.freefinder-stefan.workers.dev/api/slack/events
```

Subscribe the bot to `reaction_added`. The worker verifies Slack signatures, ignores non-check reactions, and dispatches `approve-deals.yml` for `white_check_mark`, `heavy_check_mark`, or `check`. The approval workflow also runs every 15 minutes as a fallback.

Required Worker secrets for Slack Events:

```bash
npx wrangler secret put SLACK_SIGNING_SECRET
npx wrangler secret put SLACK_CHANNEL_ID
```

`SLACK_SIGNING_SECRET` is strongly recommended. If it is temporarily missing, the worker can still use Slack Events to dispatch the targeted approval workflow, but it does not trust the event user and the workflow must confirm the real check reaction through the Slack API before approving a deal.

Slack Event dispatches include the reacted `message_ts`, so the approval workflow can approve that single deal immediately instead of scanning the full pending queue.

## Stripe Checkout

The website calls `POST /api/checkout/session` with one of these plans:

- `pro`
- `plus`
- `businessStarter`
- `businessSpotlight`
- `businessCity`

The worker creates a Stripe-hosted Checkout Session and returns `{ ok: true, url }`.
If no `STRIPE_PRICE_*` secret is set, the worker finds or creates the matching Stripe Price automatically by `lookup_key`.

Business plans must include a `campaign` object from the website form. The worker stores the campaign draft in KV, attaches a `campaign_id` to Stripe Checkout metadata, and submits the campaign to the Merchant backend after Stripe confirms payment through the webhook.

Do not commit Stripe secret keys. Set the Stripe live secret key as a Cloudflare Worker secret:

```bash
npx wrangler secret put STRIPE_SECRET_KEY
```

Set the Stripe webhook signing secret after creating a Dashboard webhook endpoint for:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`

Use this endpoint URL:

```text
https://freefinder-referrals.freefinder-stefan.workers.dev/api/checkout/webhook
```

Then save the endpoint secret:

```bash
npx wrangler secret put STRIPE_WEBHOOK_SECRET
```

The Price IDs are optional. Set them only if you created the prices manually in Stripe and want to pin exact `price_...` ids:

```bash
npx wrangler secret put STRIPE_PRICE_PRO
npx wrangler secret put STRIPE_PRICE_PLUS
npx wrangler secret put STRIPE_PRICE_BUSINESS_STARTER
npx wrangler secret put STRIPE_PRICE_BUSINESS_SPOTLIGHT
npx wrangler secret put STRIPE_PRICE_BUSINESS_CITY
```

Use Stripe **Price IDs** (`price_...`), not product IDs (`prod_...`). PRO and PLUS are subscription prices; the Business Boost products are one-time prices. If the worker auto-creates them, it uses these live prices:

- FreeFinder PRO: 3,99 EUR monthly, lookup key `freefinder_pro_monthly_eur`
- FreeFinder PLUS: 12,99 EUR monthly, lookup key `freefinder_plus_monthly_eur`
- Starter Boost: 25,99 EUR one-time, lookup key `freefinder_business_starter_eur`
- Spotlight Boost: 64,99 EUR one-time, lookup key `freefinder_business_spotlight_eur`
- City Push: 129,99 EUR one-time, lookup key `freefinder_business_city_eur`

Optional return URLs can also be configured as worker vars or secrets:

```bash
npx wrangler secret put CHECKOUT_SUCCESS_URL
npx wrangler secret put CHECKOUT_CANCEL_URL
```

If they are not set, the worker returns customers to the FreeFinder website with `?checkout=success` or `?checkout=cancel`.

The Merchant backend base URL defaults to `https://freefinder-merchant-backend.freefinder-stefan.workers.dev`. Override it only if the backend moves:

```bash
npx wrangler secret put MERCHANT_API_BASE
```

For automatic Business ads after a paid Stripe checkout, deploy the Merchant backend with the same `STRIPE_SECRET_KEY` so it can verify the Checkout Session before storing the campaign. Optionally set a shared server-to-server secret on both workers:

```bash
npx wrangler secret put MERCHANT_API_SECRET
```

If you want a Slack notification after a paid campaign is stored, set this on the Merchant backend:

```bash
npx wrangler secret put SLACK_WEBHOOK_URL
```

## Required Cloudflare setup

1. Create a KV namespace.
2. Put the namespace id into [`wrangler.toml`](/Users/Stefan/Downloads/deal-finder-main-9/referrals-worker/wrangler.toml).
3. Deploy the worker with Wrangler.
4. Add the worker URL to the frontend config:

```json
{
  "referralEnabled": true,
  "referralApiBase": "https://freefinder-referrals.YOUR_SUBDOMAIN.workers.dev"
}
```

## APNS setup

For real iPhone push notifications, add these Worker secrets:

- `ADMIN_API_TOKEN`
- `APNS_TEAM_ID`
- `APNS_KEY_ID`
- `APNS_PRIVATE_KEY`
- `APNS_BUNDLE_ID`
- optional: `APNS_USE_SANDBOX=true`

`/api/push/apns/send` is intentionally protected with `Authorization: Bearer <ADMIN_API_TOKEN>` or `x-admin-token`.

Example payload:

```json
{
  "token": "apns_device_token_hex",
  "title": "Neuer Deal",
  "body": "Gratis Kaffee heute in Wien",
  "dealId": "deal_123",
  "url": "freefinder://deal/deal_123"
}
```

Admin status check:

```bash
curl -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  https://freefinder-referrals.YOUR_SUBDOMAIN.workers.dev/api/push/apns/status
```

Send a test push from local terminal:

```bash
cd referrals-worker
PUSH_API_BASE="https://freefinder-referrals.YOUR_SUBDOMAIN.workers.dev" \
ADMIN_API_TOKEN="..." \
APNS_DEVICE_TOKEN="ios_device_token_hex" \
node scripts/test-apns-push.mjs
```

Recommended rollout order:

1. Deploy the worker with all APNS secrets set.
2. Install a fresh iPhone build and open the app once.
3. Check `/api/push/apns/status` and confirm at least one registered token appears.
4. Send one manual test push with `test-apns-push.mjs`.
5. Only after that wire automatic deal-triggered push sends.

## Notes

- One referral can only be completed once per visitor id.
- The inviter device cannot claim its own referral.
- Completion is blocked for the first 15 seconds after claim start to reduce trivial abuse.

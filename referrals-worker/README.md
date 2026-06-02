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
- `GET /health`

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

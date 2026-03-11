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
- `GET /health`

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

## Notes

- One referral can only be completed once per visitor id.
- The inviter device cannot claim its own referral.
- Completion is blocked for the first 15 seconds after claim start to reduce trivial abuse.

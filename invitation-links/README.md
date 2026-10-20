# Invitation links

`https://www.freefinder.at/i/<token>` redirects to the existing
`https://freefinder.at/invite.html?invite=RM-<24 uppercase hex digits>` URL.
An optional validated `deal` query parameter is preserved.

The 16-character Base64URL token contains all 96 bits of the existing public
invitation code. No alias database, KV writes, account lookup, cookies, messages,
reward creation or downstream fetches are used by this service.

## Compatibility

Published native apps claim the apex domain for universal/App Links but only
understand the legacy invitation path and code. The `www` host is intentionally
not added to native associated domains: the server converts the URL before it
can reach the legacy parser. All other `www` paths and queries keep their
existing redirect to the apex website.

Tests verify encoding and URL compatibility, not OS handoff, installation
attribution or WhatsApp's cached preview. A controlled handset check is still
needed before claiming those flows have been exercised.

## Test

From the repository root:

```sh
node --test invitation-links/links.test.js
```

After the custom-domain certificate is active, read-only live checks can run with
`node invitation-links/verify-live.mjs`. These fetch a format-test URL and static
pages only; they do not accept an invitation or send a notification.

The Swift and Kotlin helpers use the same known-vector test:

- Code: `RM-0123456789ABCDEF01234567`
- Token: `ASNFZ4mrze8BI0Vn`

This is a format test vector, not a real referral invitation.

## Deploy

This is a Cloudflare **Pages** advanced-mode service with no bindings, secrets
or cron triggers. Run from this directory, never from `merchant-worker`:

```sh
../merchant-worker/node_modules/.bin/wrangler pages deploy public \
  --project-name freefinder-invitation-links --branch main --commit-dirty=true
```

The project already exists. Wrangler 4.147 delegates Pages project creation to
a Worker by default; recreating it requires the explicit Pages opt-out:

```sh
../merchant-worker/node_modules/.bin/wrangler pages project create \
  freefinder-invitation-links --production-branch main --force
```

Do not replace or deploy the merchant backend for a link-service update.
Normal Pages function request quotas still apply; no paid plan is required by
this configuration and no unlimited-capacity claim is made.

The custom domain must be registered with Pages before configuring external DNS.
The only DNS change for this service is:

```text
www 600 IN CNAME freefinder-invitation-links.pages.dev.
```

Leave apex A/AAAA, verification TXT and all email records intact. Verify the
certificate without bypassing TLS checks, the short-link 302, an invalid-link
404, and root/privacy/support 301 redirects before shipping the native change.

## Rollback

Before any native version using these links is distributed, DNS can be restored
to the previous `www` CNAME, `ataalla24-ux.github.io.`, TTL 600. After distribution,
keep `/i/` resolution available when rolling back an application or deployment:
already-shared short links must not be abandoned.

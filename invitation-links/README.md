# Invitation links

## Prepared App Clip release

The web changes prepare the Clip association on both hosts. They do not release
an App Clip. Both AASA paths on `www.freefinder.at` return JSON directly; the apex
copies retain their existing full-app association and add the Clip identifier.

Short links keep their existing 302 destinations unless the Pages deployment
has all three release values below. Never set them before the reviewed full app
containing the Clip has been released and its experiences have been verified:

```text
APP_CLIP_RELEASE_ENABLED=1
APP_CLIP_APPROVED_VERSION=<released app version, e.g. 1.42>
APP_CLIP_RELEASE_VERIFIED_AT=<actual verification time in UTC ISO format>
```

Only the first value is the switch; the other two record the verified release.
Absent or incomplete configuration fails closed to the existing redirects.
On a supported iOS browser, an enabled `/i/` or `/d/` URL returns a small page
with a Smart App Banner, full-app fallback, and existing public deal text when
available. Android, desktop, iOS below 14 and legacy `?r=` links keep the old
route. It adds no account request, database, cookie, cron or AI/provider call;
deal resolution reuses the same bounded public feed read.

The full release sequence, native identifiers, canonical invocation URLs and
unverified Store/device checks are documented in
[`reviews/app-clip-release-readiness-20261127.md`](../reviews/app-clip-release-readiness-20261127.md).

## Compact deal sharing

`https://www.freefinder.at/d/<12-character-token>` resolves the SHA-256-derived
72-bit token against the actual public feed. Optional `i` retains all 96 bits of
the existing invitation code; `r` retains the legacy six-character referral
suffix. No alias database, KV writes, new permissions or tracking cookies.
The only downstream read is the fixed public feed, cached for 180 seconds,
bounded to 2 MiB/2,000 records and eight seconds. Unknown offers return 410;
ambiguous IDs or unavailable feeds fail closed, never redirect to another offer.
Native photo sharing supplies the actual card attachment and short caption.
Link-only recipient previews are controlled by the recipient, not this redirect.

Before Clip activation, the destination is the same apex URL understood by
existing native apps. Adding `www` to native associated domains requires the
full app to handle the same compact tokens and preview as the Clip.
Run `node --test invitation-links/*.test.js` before deploying this Pages service.

`https://www.freefinder.at/i/<token>` redirects to the existing
`https://freefinder.at/invite.html?invite=RM-<24 uppercase hex digits>` URL.
An optional validated `deal` query parameter is preserved.

The 16-character Base64URL token contains all 96 bits of the existing public
invitation code. No alias database, KV writes, account lookup, cookies, messages,
reward creation or downstream fetches are used by the invitation route.

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

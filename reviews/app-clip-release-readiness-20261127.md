# App Clip preview release readiness — 27 November 2026

This is release preparation, not evidence of an approved or publicly available
App Clip. Web activation defaults off. A user must actually launch the App Clip
before it can save context for the full app. Opening a web page or downloading
the full app alone does not create that shared state. Previewing a deal does
not accept an invitation, start a subscription, or award a referral month.

## Fixed identifiers

| Purpose | Identifier |
| --- | --- |
| Apple team | `78C2SA4JP3` |
| Parent app | `com.stefanataalla.freefinderwien` |
| App Store app | `6758958213` |
| App Clip | `com.stefanataalla.freefinderwien.Clip` |
| Shared App Group | `group.com.stefanataalla.freefinderwien.referral` |

In Certificates, Identifiers & Profiles, create/verify the Clip identifier and
assign that exact App Group to both the parent app and Clip. Regenerate the
affected provisioning profiles. The archived parent and Clip must have matching
App Groups and their parent/associated-Clip signing relationship. Xcode creates
the parent entitlement for the Clip and adds the associated-Clip entitlement to
the parent archive. Inspect the signed archive, not only the source plists.
[Apple: capabilities](https://developer.apple.com/help/account/identifiers/enable-app-capabilities),
[Apple: shared Clip data](https://developer.apple.com/documentation/appclip/sharing-data-between-your-app-clip-and-your-full-app).

The App Group stores only the bounded invitation/deal handoff, never a password,
Store receipt or auth token. Its native reader must validate expiry, account
changes and an existing invitation before using it. The backend's real account,
invitation acceptance, Store verification and reward deduplication remain in
force. Shared local context is not authentication or eligibility proof.

## Invocation contract and existing fallback

Use these existing canonical links; token case is significant:

| URL | Meaning |
| --- | --- |
| `https://www.freefinder.at/i/<16-token>` | Decode all 96 bits of `RM-<24 uppercase hex>`; optional `?deal=<validated ID>` |
| `https://www.freefinder.at/d/<12-token>` | Resolve the first 9 SHA-256 bytes of the current deal ID, encoded Base64URL |
| `https://www.freefinder.at/d/<12-token>?i=<16-token>` | The exact current deal plus personal invitation |
| `https://www.freefinder.at/d/<12-token>?r=ABC123` | Existing legacy referral; preserve its full-app redirect, no Clip migration |

The known format vector is `RM-0123456789ABCDEF01234567` →
`ASNFZ4mrze8BI0Vn`; deal `pizza-1` → `UoJ7Ip8gAf8e`. These are test values,
not real invitations or guaranteed live offers. Never create production rewards
to check route formatting.

The `/i/` route performs no account lookup. `/d/` resolves against only
`https://freefinder.at/deals.json`, retaining the existing 2 MiB / 2,000-row /
8-second read bounds and 180-second upstream cache. A removed deal returns 410;
ambiguous IDs or an unavailable feed return 503. Invalid/duplicate parameters
return 404 before any read. No alias database or tracking cookie is added.

While disabled, `/i/` still returns the original apex `invite.html?invite=...`
302; `/d/` still returns the same apex deal/invitation destination. Android,
older unsupported iOS, desktop and legacy referrals retain that behavior after
activation. Already shared links and older installed apps remain supported.

When released and enabled, supported iOS browsers receive HTTP 200 HTML on the
original compact URL. Its static Smart App Banner includes the parent App Store
ID and Clip bundle ID. **The Clip receives the website URL, not the banner's
`app-argument`.** Native code must parse the compact path/query. If the full app
is installed, it must handle every invocation and provide the same deal preview.
[Apple: website banners](https://developer.apple.com/documentation/appclip/supporting-invocations-from-your-website-and-the-messages-app),
[Apple: invocation handling](https://developer.apple.com/documentation/AppClip/responding-to-invocations).

## Domains and App Store Connect setup

1. Both Xcode targets need `appclips:freefinder.at` and
   `appclips:www.freefinder.at` in Associated Domains. The full app also needs its
   existing apex `applinks:` association and `applinks:www.freefinder.at` once its
   compact-link parser is included. Each host requires its own association;
   redirects are not a substitute.
2. Publish the prepared AASA on both hosts over valid HTTPS, with direct HTTP
   200 JSON at `/.well-known/apple-app-site-association`. The apex also retains
   `/apple-app-site-association`; the www worker serves both paths directly.
   Preserve the existing `applinks` entry. New `appclips.apps` contains only
   `78C2SA4JP3.com.stefanataalla.freefinderwien.Clip`.
3. Archive the full app including the Clip and upload that version through the
   normal Store process. Add the default App Clip experience and its reviewed
   card artwork/title/action. Configure advanced experiences for
   `https://www.freefinder.at/i/` and `https://www.freefinder.at/d/`; include any
   additional apex invocation URL only if native handling and its HTML support
   have actually been verified. AASA preparation alone does not create an
   experience. Card metadata belongs to the experience; individual deal content
   comes from the invocation URL.
4. Complete App Review and release the containing version. Verify the released
   experience on a device before switching the website to the Clip page.

[Apple: domain association](https://developer.apple.com/documentation/appclip/associating-your-app-clip-with-your-website),
[Apple: separate subdomains](https://developer.apple.com/documentation/Xcode/supporting-associated-domains),
[Apple: advanced experience](https://developer.apple.com/help/app-store-connect/offer-app-clip-experiences/offer-an-advanced-app-clip-experience).

## Tests before activation

- Run `node --test invitation-links/*.test.js`; these use local responses and
  verify association consistency, disabled redirects, enabled HTML, exact deal
  resolution, escaping, no invitation-side downstream reads and legacy routing.
- In the Clip scheme, set `_XCAppClipURL` to an actual reviewed test invocation.
  This checks parsing/UI; it does not prove discovery or show the App Clip card.
- Configure a development Local Experience to test the card and invocation.
  Remove it before testing the Store experience, because it overrides the latter.
- Test the included Clip through TestFlight; App Store Connect allows up to
  three TestFlight invocation URLs. TestFlight is not public-release proof.
- On a supported iPhone without the full app, verify the actual released Safari
  banner/card and read-only deal preview. Then install the full app normally and
  open it: verify the saved context appears without reopening the link, while
  account and trial checks remain necessary. Also test no Clip launch, expired
  handoff, changed account, existing invitation, unavailable/removed deal and an
  installed full app opening the same www compact URL. Use no real purchases.
- Run iPhone Developer → App Clips Testing → Diagnostics on both invocation
  prefixes. Check publication, association, experience and banner. Clear the
  experience cache if old metadata remains, and test outside Local Experiences.

[Apple: launch tests and diagnostics](https://developer.apple.com/documentation/AppClip/testing-the-launch-experience-of-your-app-clip),
[Apple: TestFlight invocations](https://developer.apple.com/help/app-store-connect/test-a-beta-version/test-an-app-clip-experience/).

## Activation and rollback

The source Pages configuration explicitly sets `APP_CLIP_RELEASE_ENABLED=0`;
no live environment was changed while preparing this code. After the reviewed containing app
and Clip are public and verified, set the www Pages production environment:

```text
APP_CLIP_RELEASE_ENABLED=1
APP_CLIP_APPROVED_VERSION=<actual released version>
APP_CLIP_RELEASE_VERIFIED_AT=<actual verification UTC timestamp, e.g. 2026-12-01T10:00:00Z>
```

The version and timestamp are release evidence metadata; `APP_CLIP_RELEASE_ENABLED`
is the single switch. Do not copy the example timestamp as a claim of verification.
Use the existing invitation-links Pages project and verify the production
deployment. Do not deploy the merchant/referral ledger for this website change.

Set `APP_CLIP_RELEASE_ENABLED=0` (or remove it) and deploy that configuration to
restore the established compact-link redirects. Keep AASA, DNS, tokens and old
URLs available. No published deal record, human approval, price, budget,
collection schedule, subscription or referral ledger is changed by this switch.

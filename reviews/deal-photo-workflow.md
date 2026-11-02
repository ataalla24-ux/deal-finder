# Approved Original Deal Photos

Original photos take priority in both native clients. Arbitrary scraped `imageUrl`,
OpenGraph images, social thumbnails and logos are deliberately NOT eligible.
The fallback is a stable, dish-specific editorial image, not merchant photography.

## Review and Import

1. Obtain the actual food/product photo from the merchant or an owned original.
   A publicly accessible photograph alone is not permission to reuse it.
2. Verify the photo matches this offer, check the full image and its central 2.7:1
   card crop. Reject packaging-only, empty plates, unrelated ingredients, text-only
   advertisements, unsuitable resolution and incorrectly attributed venue photos.
3. Export a normalized JPEG without EXIF/GPS, at least 600x400, preferably 1200x800,
   no more than 1.5 MB / 12 MP. Do not enlarge a low-resolution image.
4. Prepare a LOCAL review JSON with `dealId`, `file` (relative to the review file),
   `sourceURL`, `rights` (`merchant-permission` or `owned-original`), `rightsEvidence`
   (non-sensitive evidence reference), `reviewedBy`, and explicit booleans
   `matchesOffer`, `showsActualProduct`, `cropChecked`, all true after actual review.
5. Run `node scripts/prepare-deal-photo.mjs review.json --check`, then `--apply`.
   This writes an immutable deal-bound photo and a persistent live-edit override.
   It does NOT publish anything and cannot approve a pending/hidden offer.
6. Use the normal existing live-edit application, tests and non-forced GitHub
   publication. Preserve other edits, prior hides, approval records and concurrent
   state. Check the public JPEG and actual feed `photoUrl` before claiming success.

The import runs offline, uses no paid API, and preserves existing human approval.
Only already-approved live offers can be imported. Permission references in
`reviews/deal-photos` must not include private correspondence or personal data.
Clear `photoUrl` via the existing edit route to withdraw a photo. Keep immutable
old files while cached clients may reference them. Re-review when the product or
merchant changes; never recycle another deal's photo automatically.

## Client Safety

Clients accept only `https://freefinder.at/assets/approved-deal-photos/` with an
exact SHA-256 deal prefix and content-hash JPEG filename. They reject redirects,
foreign hosts, query tokens, oversized/invalid bytes and undersized images.
Memory caches and queues are bounded; failed loads use the local editorial image.
Cards, details and image sharing use the same selection. There are no customer
credentials, new paid providers, model calls or tracking requests in this path.

No original merchant photograph was newly approved during this implementation.
An importer and client support do not constitute merchant permission or delivery
of an actual original photo. The 120-image fallback library includes 17 new
editorial images compared with the previously submitted 103-image app build.

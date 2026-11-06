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
3. Export a JPEG without EXIF/GPS, at least 600x400, preferably 1200x800,
   no more than 1.5 MB / 12 MP. Do not enlarge a low-resolution image. The importer
   decodes the entire JPEG, rejects broken/truncated scans, and normalizes pixels
   to sRGB without metadata. It calculates the actual central 2.7:1 card crop;
   the crop must retain at least 600x222 original pixels.
4. Prepare a LOCAL review JSON with `dealId`, `file` (relative to the review file),
   `sourceURL`, `rights` (`merchant-permission` or `owned-original`), `rightsEvidence`
   (non-sensitive evidence reference), `reviewedBy`, and explicit booleans
   `matchesOffer`, `showsActualProduct`, `cropChecked`, all true after actual review.
5. Run `node scripts/prepare-deal-photo.mjs review.json --check`, then `--apply`.
   This writes an immutable deal-bound photo, version2 review and a persistent
   live-edit override. The review binds exact product/merchant/description/source,
   normalized file hash and actual crop hash. Private extra fields from the local
   request are not copied into the persistent review.
   It does NOT publish anything and cannot approve a pending/hidden offer.
6. Use the normal existing live-edit application, tests and non-forced GitHub
   publication. Preserve other edits, prior hides, approval records and concurrent
   state. Check the public JPEG and actual feed `photoUrl` before claiming success.

The import runs offline, uses no paid API, and preserves existing human approval.
Only already-approved live offers can be imported. Permission references in
`reviews/deal-photos` must not include private correspondence or personal data.
Clear `photoUrl` via the existing edit route to withdraw a photo. Keep immutable
old files while cached clients may reference them. New imports carry a subject
hash in the persistent edit: if the reviewed product, merchant, description,
category or source changes, normal edit application clears the public original
photo and the clients use their existing editorial fallback. Re-review/import
for the changed offer; a replay never restores a mismatching photo.

`node scripts/validate-original-deal-photos.mjs` checks every selected original
against its current permission record, subject, immutable bytes and decoded crop.
This gate runs in production integrity and before scheduled quality work. The
generated-feed committer also validates originals BEFORE pushing: it rejects
changed remote photo permissions/assets and partial batches missing the reviewed
image/review record. Conflict-override flags cannot bypass this guard. Bounded
automatic copy maintenance clears only a bound original invalidated by changed
offer content, retaining the existing fallback and all deal facts. Old
unbound photo imports require a new review, not a silently invented permission.
The server's image review sees the actual original plus crop independently of
the fallback-library observation. Original, fallback and website checks share
the same maximum TWO new model calls/run. A matching model result neither grants
rights nor proves merchant authenticity/recipient UI delivery. Revoked/missing
permission or changed bytes cannot reuse an old positive model-cache result.

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

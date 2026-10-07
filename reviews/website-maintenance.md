# Website publishing checks

The website lives in `docs/` and is served by GitHub Pages at
https://freefinder.at/. Keep existing URLs and printed QR destinations stable.
Never publish real customer, checkout, analytics or credential data in this tree.

After adding or updating an article:

1. Verify the original provider source, address, dates and redemption conditions.
   A blocked provider request does not establish that an offer has expired.
   No invented availability, discounts, district coverage or guaranteed savings.
2. Use a distinct, concise title and description. Link relevant Vienna guides
   naturally; do not create duplicate district pages with interchangeable text.
3. Add the article to `docs/blog/index.html` and its canonical URL to the sitemap.
   Add `data-deal-expires` when the provider specifies a reliable end date.
4. Run `node scripts/polish-website.mjs` to refresh archive metadata, blog ordering,
   keyboard navigation and FAQ markup. Topic/feed generators call the same helper.
5. Run `node scripts/audit-website.mjs --summary`,
   `node scripts/test-website-quality.mjs`, `node scripts/test-pro-website.mjs`
   and `node scripts/test-seo-deals-page.mjs`. Check small and desktop viewports.
6. Publish only scoped website changes and verify the deployed files over HTTPS.

The Website Quality workflow is read-only and checks future website edits.
Provider link checks are optional (`--external`); some providers restrict bots.
The QR promotion `/plus-gratis.html` intentionally remains unlisted. Preserve
its destination and eligibility. Noindex admin/test pages must not enter the sitemap.
Do not claim that passing these checks guarantees rankings, traffic, real payment
success or exhaustive verification of the shared app feed.

Homepage preview assets in `docs/assets/native-preview-20260923/` are losslessly
encoded copies of the genuine native captures used for the September 23 approved series
(recommendations with IKEA Family, the IKEA Westbahnhof map and favorites).
The decoded RGBA pixels were compared byte-for-byte against each original;
all three are identical, at roughly half the combined file size. The source
captures and store screenshot backups remain unchanged. Do not call
them a capture of the unpublished October 7 native polish. Homepage text highlights
use the separately checked October 7 Hummel, Ganesha and Watertuin conditions.
`docs/og-home-20261007.jpg` is a 1200 x 630 browser capture of that website,
including both stores, rather than the former Pro-only homepage social preview.

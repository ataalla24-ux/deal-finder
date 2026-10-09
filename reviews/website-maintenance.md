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
   Use a subject-specific cover, never the shared pizza/Foodora app mockup.
   Editorial cover assignments live in `scripts/blog-visuals.mjs`; provider logos
   are explicit and source-documented in `docs/assets/blog/covers/logos/sources.json`.
   A restaurant article must not inherit the logo of its delivery platform.
   Keep cover text independent of temporary prices and availability. Genuine
   article-specific photos may be retained; identify generic photos as symbols.
   To render new code-authored covers, run `node scripts/build-blog-covers.mjs`
   with Sharp installed, or set `SHARP_MODULE` to an existing Sharp module path.
   Commit both the 1200 x 630 JPEG and its lightweight 480px WebP thumbnail.
   No image dependency is needed to serve or normalize the published website.
4. Run `node scripts/polish-website.mjs` to refresh archive metadata, blog ordering,
   keyboard navigation and FAQ markup. Topic/feed generators call the same helper.
   It also aligns card, article, Open Graph, Twitter and Article-schema images,
   replaces stale picture sources and provides a neutral fallback for new articles
   that still reference an old shared mockup. Check that future covers match the title.
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

The Deals website intentionally shows a bounded selection with explicit end dates,
not the complete app feed. Keep the visible subset notice and both store links
above the filters, including on mobile. Never broaden the date/source filters
just to increase the card count; do not mutate the shared feed during website work.

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

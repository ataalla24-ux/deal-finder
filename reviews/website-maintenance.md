# Website publishing checks

The website lives in `docs/` and is served by GitHub Pages at
https://freefinder.at/. Keep existing URLs and printed QR destinations stable.
Never publish real customer, checkout, analytics or credential data in this tree.

Owner selection, 2026-10-30: homepage app artwork uses the six approved Klar x
Urban designs in `assets/klar-urban-20261030/`, not the older native feed images.
Keep the visible design-preview/sample-data disclosures; these are illustrations,
not current app captures or verified deals. Never use them as blog cover photos.
`home-showcase.css` keeps the Pro band charcoal/orange on desktop and mobile;
preserve existing billing, trial eligibility and renewal text. Responsive checks
include 320x568, the horizontal keyboard-accessible gallery and the next-section
hint in the first viewport. Original source image hashes are in `sources.json`.

After adding or updating an article:

1. Verify the original provider source, address, dates and redemption conditions.
   A blocked provider request does not establish that an offer has expired.
   No invented availability, discounts, district coverage or guaranteed savings.
2. Use a distinct, concise title and description. Link relevant Vienna guides
   naturally; do not create duplicate district pages with interchangeable text.
3. Add the article to `docs/blog/index.html` and its canonical URL to the sitemap.
   Add `data-deal-expires` when the provider specifies a reliable end date.
   Use a subject-specific photograph, never a text poster or shared app mockup.
   Explicit article-to-photo assignments live in `scripts/blog-photo-catalog.mjs`;
   `scripts/blog-visuals.mjs` keeps listings, articles and sharing metadata aligned.
   Match the actual benefit: Pizza Rando is a kebab offer, Loving Hut is vegan,
   and the current NORDSEE wrap is tuna, not shrimp. A delivery coupon must not
   imply that an unrelated meal is included. Keep genuine article-specific photos;
   identify generated/editorial illustrations as symbols, not merchant originals.
   Reuse a matching committed photo where possible. For new exports, run
   `node scripts/build-blog-photos.mjs [subject-or-article-slug]` with Sharp
   available (`SHARP_MODULE` may point to an existing installation). Source assets
   require `NATIVE_ASSETS_ROOT` and/or `BLOG_PHOTO_SOURCE_DIR` as appropriate.
   The old `build-blog-covers.mjs` entry point now exports photos, not text covers.
   Commit the 1200 x 630 JPEG, 1200px WebP, 480px WebP and updated photo provenance.
   Current cover sources must be at least 600 x 400; do not enlarge tiny app tiles.
   Do not delete old cover URLs that may remain in external caches or links.
   No image dependency is needed to serve or normalize the published website.
4. Run `node scripts/polish-website.mjs` to refresh archive metadata, blog ordering,
   keyboard navigation and FAQ markup. Topic/feed generators call the same helper.
   It also aligns card, article, Open Graph, Twitter and Article-schema images,
   replaces stale picture sources and provides a neutral fallback for new articles
   that still reference an old shared mockup or text cover. For photo-only edits,
   use `--visuals-only` (and `--visuals-only --check`) to preserve archive dates,
   article order, content and availability. Check that future photos match the title.
5. Run `node scripts/audit-website.mjs --summary`,
   `node scripts/test-website-quality.mjs`, `node scripts/test-pro-website.mjs`
   and `node scripts/test-seo-deals-page.mjs`. Check small and desktop viewports.
6. Publish only scoped website changes and verify the deployed files over HTTPS.

The Website Quality workflow is read-only and checks future website edits.
The shared photo-led presentation is in `docs/visual-refresh.css` and the
idempotent `polishVisualDiscovery` helper in `scripts/blog-visuals.mjs`.
Keep its category links and related-guide photos when regenerating pages.
Deal cards prefer matching high-resolution editorial photos, with the existing
native artwork and logo fallback retained if those local assets are unavailable.
Photos are generic illustrations, never verification of a merchant or menu.
Run `node scripts/test-website-visuals.mjs` after presentation or motif changes.
Before selecting the next daily article, run `node scripts/audit-blog-coverage.mjs`.
The dated coverage ledger distinguishes existing articles, held evidence and
informational directory records. New IDs and changed offer content require a new
editorial decision; votes and routine feed timestamps do not create a new topic.
Do not mark an offer covered merely because another article mentions its merchant.
Do not regenerate the historical ledger to suppress a warning without research.
Run `node scripts/test-blog-catchup.mjs` after modifying the October 30 collection.
Provider link checks are optional (`--external`); some providers restrict bots.
The QR promotion `/plus-gratis.html` intentionally remains unlisted. Preserve
its destination and eligibility. Noindex admin/test pages must not enter the sitemap.
Do not claim that passing these checks guarantees rankings, traffic, real payment
success or exhaustive verification of the shared app feed.

The Deals website intentionally shows a bounded selection with explicit end dates,
not the complete app feed. Keep the visible subset notice and both store links
above the filters, including on mobile. Never broaden the date/source filters
just to increase the card count; do not mutate the shared feed during website work.

Offer cards and homepage previews reuse existing native editorial symbol photos
from `docs/assets/deal-photos/`, not original merchant/product photographs.
`scripts/deal-photos.mjs` chooses a relevant local motif without reading arbitrary
remote image URLs. IDs keep variants stable through sorting/filtering; unknown
subjects get a neutral motif, and missing files retain the logo/initial fallback.
Source atlas hashes, native cell indices, exact crops and dimensions are recorded
in `docs/assets/deal-photos/sources.json`. To re-export existing app assets, set
`NATIVE_ASSETS_ROOT` to the iOS `Assets.xcassets` directory and run
`node scripts/build-website-deal-photos.mjs` with Sharp available (or `SHARP_MODULE`).
This authoring step resizes/crops existing images only; it must not alter native
assets, call an image provider or change deal facts. The public page generator
needs neither Sharp nor the native checkout. Keep responsive sizes and lazy loading.

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

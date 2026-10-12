# Strict Source-Verified Expiry

The daily validation workflow may unpublish only an individually matched,
single-offer page. LLM confidence, an old feed date, post age, HTTP errors,
redirects and missing pages never authorize removal.

Required evidence:

- Public HTTPS original source; robots permission and DNS-pinned bounded fetch.
- Direct HTTP 200 HTML, exact canonical URL, one structured Offer.
- Exact deal title, merchant and source URL in structured data.
- Offer.validThrough is an explicit calendar date with year, also matching the
  existing validUntil/validOn. A priceValidUntil alone is insufficient.
- Visible title, merchant and explicit end date in the same leaf content block.
- No other dates, multiple offers, listings, recurring/member benefits or
  extension ambiguity. Manual edits, forceKeep and Business ads are protected.
- At least 72 hours after the source end date, plus two independent successful
  observations 24-72 hours apart. Any changed deal/source resets confirmation.
- At most five removals and at most 10% of the feed per run (minimum cap one).

This deliberately rejects many genuine expired offers rather than guessing.
No software can guarantee that a merchant's original page is itself accurate.
Uncertain cases remain in the existing manual review report.

## Audit and Recovery

`reviews/verified-expiry-state.json` records observations. Full original records,
both evidence snapshots and removal time are appended to
`reviews/verified-expiry-archive.json` BEFORE changing the feed. Reports are also
saved as 90-day workflow artifacts. State/archive/feed/map/featured references
are committed together through the existing generated-state consistency guard.
A changed remote feed, manual edit or expiry state forces a fresh run.

To recover an entry, select its exact originalDeal from the archive, restore it
through the existing persistent live-edit workflow with forceKeep=true, and
retain the archive. Never roll back a whole old feed over newer deals. For an
emergency pause, set VERIFIED_EXPIRY_APPLY to 0 in the daily workflow; evidence
collection continues without changing the feed. Generic/LLM removal flags stay 0.

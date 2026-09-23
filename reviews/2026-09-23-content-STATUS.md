# Source-backed content review, 23 September 2026

## Scope

Eight existing live records corrected from their linked sources. Four records
have confirmed offer terms, three still need specific follow-up, and one is
confirmed to have expired. No deal was removed or added. No expiry was extended,
no discovery date or vote count was reset. Source URLs, evidence summaries and
the exact reviewed patches are in `2026-09-23-live-content.json`.

- Duru: correct merchant, prices, branch, single-day date, time and person limit;
  remove the unrelated Thalia logo.
- Chocoberry: whole-menu 1+1, not only a drink; season-end date/address remain open.
- Piazza Urban Loritz: correct merchant and pizza price; no invented eligibility
  period. Existing expiry is uncorroborated and remains unchanged pending review.
- Maza Burger: restaurant instead of creator Mahnoor; explicitly disclose the
  expired 18-22 September promotion. Manual Slack removal remains available.
- Osteria Da Contessa: full address, dine-in restriction and coupon conditions.
- Wiener Riesenrad: full 1+1 terms, correct non-food category and 2027 source date
  matching the existing feed expiry.
- NORDSEE: actual wrap variety, Drei eligibility and excluded motorway branches.
- McDonald's: restore the specific coupon instead of truncated list fragments;
  the public source is secondary, individual app availability is not verified.

## Automatic Prevention

- Brand matching requires word boundaries/explicit aliases; street names such
  as Thaliastrasse are not merchant evidence. Generic crepes are not Mama's.
- A verified, classified merchant account takes precedence over incidental
  textual brand matches. Creator accounts cannot use that override.
- Full pending descriptions survive shortened Slack previews. A different
  manually edited Slack description is not overwritten by this prefix recovery.
- App/coupon language remains in the text. Complete descriptions are no longer
  replaced by generic social summaries or clipped to 160/180 characters.
- Persistent reviewed fields, including addresses, survive normalization and
  logo passes. Repeated replay is idempotent; previous edited fields are retained.
- Existing scheduled normalization now adds content issues to the existing live
  Slack review candidates: truncation, caption residue, street/merchant mixups,
  unresolved creators, vague locations/dates and source conditions missing in copy.
  These are heuristic review hints, not automatic invalidation or removal.
- The same checks run before Slack approval as non-blocking validity warnings.
  Reviewers see potential content problems before publication, not only afterward.
- Regression coverage is part of Production Feed Integrity CI.

## Verification

Passed locally: source-content regression including offline full normalizer,
logo normalization, removal safety, expiry normalization, Slack approval queue
and validation, feed schema/version, map references and featured-reference sync.
Compared normalizer behavior on all 85 baseline records: the new behavior only
changes Duru's merchant/logo and preserves the word App in a reviewed foodora
description. The eight reviewed patches preserve all 85 IDs and other records.
Daily/weekly snapshots now match the corrected records; picks are unchanged.

Full production-data validation is NOT green: both the unchanged baseline and
the corrected feed have the same 14 errors (12 expired live entries, one other
truncated title, one unsupported `bildung` category). Warnings fell from 17 to
16; map coverage remains 17 linked deals/71 eligible records. These are not
silently removed or bypassed to make the test pass. Broader source review is
still required, especially for expired/ambiguous offers and missing map addresses.

Native binaries/store listings are unchanged. These corrections use the shared
feed consumed by iOS and Android. Deployment status must be verified separately.

# Map coverage repair

Both shipped native clients consume docs/deal-map-locations.json for map pins
and nearest participating location distances. No binary or subscription change.

Baseline: 71 feed deals, 12 linked deals, 36 locations.
After enrichment: 25 linked deals, 49 locations. This is NOT complete coverage
of every onsite offer; reviews/map-coverage.json lists each unresolved case.
Online offers and flights intentionally have no pin. Duru is a Wolt offer,
not evidence of onsite redemption. Unknown branches are not guessed.

New verified address links: Subway Donau Zentrum, Urban Kitchen, Ossi's,
HITOMI, Dahab, Anars, Alpizena, Riesenrad, Tenno, Osteria Da Contessa,
Therme Wien, Alleewirt, Wiener Deewan.

Source of coordinates: Stadt Wien - data.wien.gv.at, ADRESSENOGD WFS:
https://data.wien.gv.at/daten/geo
https://www.data.gv.at/katalog/dataset/1d5c2411-9719-4c8f-b99d-57a5f4a4ae41
Each generated location records the query and deal/merchant evidence URL.
Reviewed non-structured addresses and branch restrictions are in
map-addresses.json. The Dahab caption permits Wagramer Strasse 126 on
27 Sep-4 Oct, Schoenbrunner Strasse 149 on 27 Sep only. The latter is not
presented as a currently participating branch. The deal itself stays live.

Safeguards:
- Exact street/house number and postal code (when available); no city centroids.
- Ambiguous multi-branch captions require review rather than merchant matching.
- Online delivery links are not promoted as onsite redemption.
- New links use explicit deal IDs only, never broad brand/title matching.
- Coordinates cached centrally; no extra work on either app's UI thread.
- Bounded 20 lookups per feed publication, 15-second timeout per lookup.
- Successful lookups cached 180 days; negative results 1 day.
- Network errors retain previously verified coordinates.
- Existing hand-curated chain registry preserved. No feed deals edited/removed.
- commit-generated runs enrichment whenever publishing changed deals.json,
  so normal feed publishing maintains new address coverage on both clients.

Remaining: missing merchant/participation evidence for chains and city-only
offers, SPAR address mismatch, Madame Tussauds official 5-6 address not an
exact geocoder match. Resolve these with evidence rather than nearby guesses.

Verification: map enrichment regression suite and existing map validator.
No iOS/Android source changes, native build, store resubmission, or new device
runtime test in this task. Existing September 29 reviews are left untouched.

Published: commit 147bcb2b0dfd on main; GitHub Pages deployment succeeded.
Live freefinder.at/deal-map-locations.json verified with 49 locations / 25
linked deals, including Dahab at Wagramer Strasse 126 only.
The wider integrity workflow fails before map tests at the unchanged
test-source-backed-content.mjs:159 assertion expecting tiktok-1l9p5mu in a
fixture. Map validation is now independent of preceding test failures; this
does not suppress the failing assertion or make the overall pipeline green.

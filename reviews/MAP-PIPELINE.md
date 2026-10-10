# Verified Deal Map Pipeline

## Ownership

`scripts/enrich-deal-map.mjs` reconciles ordinary published deals and the public
projection of active Business campaigns. It does not edit public deal text,
approval/removal policy, campaign records, receipts, payments, or push settings.
The native apps consume the same explicit `dealIds` in
`docs/deal-map-locations.json`.

Feed commits already run this resolver. The `Deal Map Reconciliation` workflow
also runs hourly, on manual dispatch and after location rules change. It shares
the existing `deal-state-writer` concurrency group. GitHub schedule latency is
possible; this is not a real-time service guarantee.

## Evidence Rules

- Exact street/house number and Vienna context are required for new geocoding.
- Verified venue coordinates may be reused, but a chain name alone never proves
  that all branches participate. Ambiguous or contradictory evidence needs review.
- Pure online/delivery offers are accounted for without a physical marker.
- Reviewed per-branch dates are inclusive Vienna calendar days. Invalid dates,
  foreign places, city-center fallbacks and ambiguous coordinates are rejected.
- Source discovery uses bounded, robots-aware, pinned-DNS requests to eligible
  source pages. Structured offer/location evidence is required; contact footers
  and headquarters do not establish participation. TheFork remains excluded.
- Existing good coordinates are retained in a separate venue catalog after a
  deal disappears, without automatically transferring its offer to a new deal.

`reviews/map-addresses.json` remains the human-reviewed authority. Source-derived
addresses are temporary resolver input and are not written into that file.
`reviews/map-coverage.json` accounts for every current ordinary/Business deal.
Catalog, source cache, geocode cache and Business projection are generated state.
Business snapshots contain only public fields, never contacts or receipt data.

Optional public `geocodingExclusions` entries retain the deal ID, input
fingerprint, reason and dated location IDs when the last branch is inactive.
They suppress native address supplementation only, not valid explicit pins.
Unchanged exclusions survive pruning; changed inputs are re-evaluated and future
verified windows can reopen from the catalog. This client guard requires the
corresponding native update; older clients ignore the additional field.
The internal catalog retains fingerprint-bound `dealBindings` for dated branches,
including future siblings while another branch is active. This keeps a reopened
branch's original window and prevents losing later participating branches.

## Review and Failures

New Slack review messages include a separate `INTERN Karte:` context block.
Existing edit actions remain available. Daily live review includes unresolved
map cases, with Business cases separately identified. These notes are not copied
into public deal fields and do not approve, reject or remove a deal automatically.
No retroactive mass Slack resend is required.

The approval fast path uses cached source evidence without page discovery.
The hourly job currently allows 8 source requests and 20 geocode requests.
Request limits, retries and cached failures prevent repeated failures from
consuming unlimited API/network resources. Unresolved deals stay in the feed.

`commit-generated.mjs` rejects a generated map batch when the remote feed,
reviewed addresses, relevant source code or other map inputs changed underneath
it. It never merges a stale derived map separately from its feed. A rejected
writer must rerun from current main. Other unrelated queue merges stay intact.

## Verification

Run the map tests listed in `.github/workflows/deal-map-sync.yml`, then:

```sh
MAP_SOURCE_REQUESTS=0 MAP_GEOCODE_REQUESTS=0 node scripts/enrich-deal-map.mjs
node scripts/validate-deal-map-locations.mjs
node scripts/validate-map-coverage.mjs
```

Tests use fixtures and local Git remotes; they send no Slack messages and create
no campaigns. A local resolver run only writes local derived files. Publication
must use the generated-state writer against current main.

This improves coverage, not a promise that every incomplete source can be mapped.
Unknown participating branches still require source verification or an exact
address supplied through review.

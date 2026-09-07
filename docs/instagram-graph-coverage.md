# Bounded Instagram Graph coverage

The Meta collector now requests 25 media per account page (previously 9 in the
workflow), following at most 3 pages per source. Hashtags use the same bounded
scanner; the Combined workflow requests 25 media per page. This is at most 75
account media per scan, not an unlimited historical import.

## Traversal and checkpoints

- Read the current first page on each non-cached scan.
- Deduplicate media IDs across pages. A single known or pinned item never stops
  traversal. Between sweeps, two entire known pages allow an early stop.
- Every 6 hours, ignore that heuristic and sweep again within the page limit.
  Meta does not guarantee ordering, so incremental stops are an optimization,
  not a proof that no other media exist.
- When capped, save the cursor and mark coverage incomplete. Next time, read
  the current first page and then continue the saved tail. This improves bounded
  backfill but cannot guarantee complete coverage of arbitrarily busy feeds.
- Two entire pages older than the existing 7-day eligibility window stop a sweep.
  Offer validity/acceptance policy is unchanged.
- On a later-page error, keep the pages already fetched, retain the last fully
  successful checkpoint, and retry the failed cursor next time. An invalid cursor
  resets continuation to the head; invalid/repeated cursors never cause loops.
- Rebuild requests against the configured Graph endpoint with an opaque cursor.
  Never follow or persist the `paging.next` URL, which may contain credentials.

Checkpoint files are `docs/meta-instagram-scan-state.json` and
`docs/wien-combined-scan-state.json`. Each workflow writes only its own file and
reads both. Scope includes Graph version and Instagram user ID. Old entries expire
after 7 days, with bounded source and seen-ID counts. Child paging objects are
excluded from cached media.

The two collectors reuse complete raw source results for 30 minutes, while still
running their own normalization. They do not just skip cached sources and remove
their candidates. The shared snapshot is best-effort: simultaneous jobs starting
before either has committed can still issue duplicate requests. Incomplete scans
are never treated as complete cache hits. Changing configuration is picked up
after cache expiry, or immediately with `META_INSTAGRAM_SCAN_CACHE_MINUTES=0`.

## Request limits

The Meta collector caps Graph scan requests at 120 per run; Combined caps them
at 80. Searches, retries, field fallbacks and additional pages count toward these
limits. Identity/token health probes and unrelated ad-library requests are
separate. Back off before another request when `x-app-usage` or
`x-business-use-case-usage` reaches 85%, or on HTTP 429. Budgets are per process,
not a shared cross-job platform quota.

Reports include `requestBudget` and per-source `coverage`: pages, distinct/new
posts, stop reason, continuation and cache hits. `newPosts` means new to that
source checkpoint, not a new approved deal. Cached replay reports zero pages;
its source statistics come from the cached scan.

Useful food accounts with an approval history become due after 2 hours instead
of 6. A Food candidate with opening language and an explicit structured future
start marks its source account due after 1 hour near that date. Actual frequency
is still bounded by workflow execution and available account slots. Generic and
new sources retain the existing exploration allocation. This does not add a new
automated publication path or broaden old-post acceptance.

The separate dispatcher evidence refresh keeps one-page account reads, avoiding
an unintended increase in its request volume.

## Configuration

| Variable | Default / workflow value | Bounds |
|---|---:|---|
| `META_INSTAGRAM_MEDIA_PER_ACCOUNT` | 25 | 1–25 |
| `META_INSTAGRAM_MAX_PAGES_PER_SOURCE` | 3 | 1–3 |
| `META_INSTAGRAM_MAX_GRAPH_REQUESTS` | 120 | 1–300 |
| `WIEN_COMBINED_MAX_GRAPH_REQUESTS` | 80 | 1–300 |
| `META_INSTAGRAM_GRAPH_USAGE_THRESHOLD` | 85 | 20–95 |
| `META_INSTAGRAM_SCAN_CACHE_MINUTES` | 30 | 0–60 |
| `META_INSTAGRAM_SCAN_REFRESH_HOURS` | 6 | 1–24 |

To roll back increased reading, set the workflow page limit to 1 and account
page size to 9. Keep checkpoint/report logic for visibility. To compare yield,
use net-new manually approved Food deals per request over comparable periods,
not the total size of a pending file. Monitor incomplete sources and actual run
intervals before raising budgets.

## Validation

`npm run test:instagram-graph-scan` covers later-page deals, pinned/known/mixed
pages, full sweeps, caps/resumption, partial failure, cursor safety, stale caches,
cross-collector replay, secret-free persistence, budget exhaustion, usage headers
and integrations with both collectors. Existing Meta, Combined and Graph-refresh
regressions remain required. Network responses are mocked and no credentials
are needed. Real API pagination must be verified after deployment with existing
GitHub credentials; no local Graph credentials were available for a live probe.

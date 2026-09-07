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

All three scheduled consumers now share a **150-call rolling-hour budget**:
Meta discovery, Combined and the central dispatcher's evidence refresh. Meta's
preflight token/permission checks participate too. The workflow-local scan caps
are 100 (Meta) and 30 (Combined); dispatch verifies at most 6 accounts per run.
These local caps are subordinate to the shared budget, including manual runs.

`INSTAGRAM_SHARED_QUOTA_ENABLED=1` and the workflow's `GH_TOKEN` activate the
shared coordinator. It uses `instagram-quota.json` on the dedicated
`automation/instagram-quota` Git branch. Every worker reads the shared cooldown
before each Graph request. SHA compare-and-swap reserves blocks of at most 5
calls, preventing two runners from allocating the same remaining budget. The
branch is created lazily from main and never merged into main. A newly initialized
ledger pauses for 105 minutes (45-minute old-run overlap plus a full hour), so
untracked pre-rollout requests can drain before the new allowance is used. It stores only
counts, random reservation IDs and timestamps; no Instagram or GitHub tokens.

A block can be spent for at most 5 minutes and remains charged for 60 minutes
after that deadline. This conservatively bounds all admitted calls in every
rolling hour, even after runner crashes or slow jobs. Unused reservations can
reduce throughput temporarily. GitHub storage failure, bad state or persistent
contention stops Graph requests instead of falling back to independent budgets.
At normal saturation this costs about 30 reservation writes per hour, on the
separate state branch, plus reads before calls. The coordinator assumes the
GitHub-hosted runners' clocks are synchronized. Do not delete/reset that branch
to recover capacity; wait for reservations to expire.

HTTP 429, Meta error codes 4/17/32/613/80002 (including HTTP 400 responses), or
85% usage in either Meta usage header persist a shared pause of at least one
hour, extended by a longer Retry-After. The wrapper covers retries, field
fallbacks, identity and health probes. Other Graph requests made within these
entry points, including optional ad-library calls, are conservatively charged
too. Jobs outside this repository/integration cannot be counted by this ledger.

Meta documents Platform limits for Business Discovery and Hashtag Search as
`200 × active app users` per rolling hour, plus processing-time and unpublished
user limits. 150 is our safety budget for a single-user assumption, not a Meta
guarantee. Header-based pauses remain necessary. Hashtag discovery still has its
separate 30-distinct-hashtags/7-day cap; current configured pool union is 28.
Sources: [Meta rate limits](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/)
and [hashtag search](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/hashtag-search/).

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
| `META_INSTAGRAM_MAX_GRAPH_REQUESTS` | 120 / workflow 100 | 1–300 |
| `WIEN_COMBINED_MAX_GRAPH_REQUESTS` | 80 / workflow 30 | 1–300 |
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

`npm run test:instagram-shared-quota` verifies concurrent workers, lease expiry,
shared pauses, HTTP-400 throttles, storage failure and the GitHub CAS adapter.

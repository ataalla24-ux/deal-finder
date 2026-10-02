# Vienna-wide discovery expansion

## Implementation

This replaces the small-batch-only expansion plan, not any existing source.
The 52 curated accounts (38 unchanged + 14 website-checked additions) remain.

`discover-vienna-merchants.mjs` builds a separate directory from OpenStreetMap
relation 109166 (Vienna, ISO3166-2 AT-9). It covers restaurants, cafes, fast food,
bars, pubs, ice cream, food courts, bakeries, confectionery and delis. The directory
is refreshed weekly; a daily GitHub workflow visits up to 200 website URLs in
oldest-first order, with four workers, per-request size/time limits and robots.txt
rules. DNS destinations are checked and pinned to public IPv4 addresses.
This job uses no paid scraper/LLM service.

The first complete import returned 7,177 named venue records, 3,041 website URLs
and 336 distinct directory-linked Instagram handles. These are OSM records, not
a guaranteed count of unique active merchants, current deals or verified handles.
Missing/old OSM records remain an inherent coverage limitation. All 23 postcode
districts are represented; 2,862 records lack a usable district postcode.

Website links supplement the directory handles. The existing Meta collector
reads a bounded, daily rotating pool of up to 200 accounts from the resulting
sidecar. Existing accounts win on collisions, moderation blocks still apply,
and source leads never establish deal validity or set `verifiedVienna`.
The existing Graph call budget, food quota, rescan/cooldown rules, manual Slack
approval, and creator/merchant logic are not relaxed. The collector remains
enabled by the existing repository variable (verified value 1).

## Boundaries

- TheFork stays excluded. No change to other existing source exclusions.
- No live deal writes, native app changes, automated removals or paid quota rises.
- Website offer URLs are recorded as leads, not automatically added as trusted
  Power Scraper sources. The two manually checked official sources are separate.
- Directory/profile leads are not deals. Only individually evidenced offers can
  enter the existing validation and Slack approval pipeline.
- No claim of all Vienna deals: stories, private accounts, missing listings,
  outdated directory records, robots restrictions and platform limits remain.
- No merchant credentials/contact details are collected; only business source
  names, addresses, URLs, Instagram references and coverage status are stored.

## Data / License

Directory and derived source data: © OpenStreetMap contributors, ODbL 1.0.
https://www.openstreetmap.org/copyright
Attribution and license URL are also included in the published account JSON.

## Tests and Rollback

`test-vienna-merchant-discovery.mjs` covers URL/IP guards, robots rules, expired
catalogs, profile parsing, duplicate profiles, rotation, moderation and preserving
curated account roles/priorities. Existing food-discovery, Graph-scan and Meta
collector tests pass. Initial website discovery is a live read-only network run,
not a verified increase in published deals.

To stop only the extension, disable the Vienna Merchant Discovery workflow and
remove `docs/vienna-discovery-accounts.json` from the production branch. Missing
sidecar is handled as an empty pool; previous collectors and curated sources
continue unchanged. Do not reset the whole working tree.

Initial completed network batch: 600 website URLs attempted across two runs,
437 readable, 554 unique Instagram leads, 253 with a website-link evidence label.
542 handles are additional to the current curated watchlist and existing registry.
The current rotating catalog includes 195 additional directory accounts (five
overlapping accounts keep their established entries), 330 total catalog accounts.
These are discovery counts, not approved offers or confirmed active businesses.

Publication is scoped to the source expansion files and its data only; unrelated
dirty native/pipeline files are excluded. A production run still needs to verify
the scheduled workflow after the push.

## Production Verification

Published to main in commit 59ed9bc85340. GitHub run 37004623065 completed
successfully, including regression tests, discovery and data publication.
Updated data commit: 053c172a7. Final production totals: 7,177 venue records,
3,041 website URLs, 800 websites attempted, 575 readable, 621 Instagram source
leads, of which 331 have website-link evidence. This confirms the discovery job,
not that all 621 profiles have been scanned or any resulting deal approved.
Daily schedule: 03:15 UTC. Existing Meta collector continues on its own schedule.
Live-removal safety regression also passed; no removal setting was changed.

# Faster Slack approval publication

Backend fix published in `3836cb18969d`; Worker deployment after corrected
channel setting: `6a2e662a-07c3-449e-8979-827ade76c96b`.

The Worker channel setting was the literal placeholder `C...`, causing valid
Slack approval events to be ignored. It now matches the existing review channel.
Event subscription and reaction scope were already correctly configured.

Approval dispatch failures now return HTTP 503 for Slack retries instead of a
false HTTP 200 success. Outcome logs make a future channel mismatch observable.
Whole-feed network checks no longer delay the selected approval; per-deal
validation, local normalization, persistent edits, logo caching and the shared
writer lock remain. No automated-removal policy changes.

Verified with a diagnostic message (not a live deal): signed Slack event at
12:52:01 UTC, dispatch in 1.928 seconds, workflow created 12:52:03, completed
12:52:23 UTC. Run: https://github.com/ataalla24-ux/deal-finder/actions/runs/37009297108
The target did not exist in the candidate queue and the feed was not changed.
This is not a measurement of a real deal's complete publication latency.

Regression coverage: signed/invalid events, channel isolation, failed dispatch
retry, Slack approval validation, pending edits and concurrent queue safety.

The sibling native iOS/Android workspaces contain compiled foreground-only
30-second ETag checks and feed cache revalidation. Those changes are not in
this Git repository and have not been uploaded to the stores. See the parent
workspace `output/slack-fast-approval-2026-10-02/STATUS.md` for release details.

GitHub runner queueing, per-deal validity checks, Pages deployment and older
installed clients' cache behavior still prevent a guaranteed instant display.

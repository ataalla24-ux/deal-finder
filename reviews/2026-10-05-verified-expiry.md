# Source-backed expiry review: shadow rollout

The daily validator previously enabled both automatic removal flags while URL
health/expiry refresh budgets were zero. Both flags are now zero. Manual Slack
moderation and live edits remain unchanged. LLM review remains apply=0.

The new daily review fetches independent source pages using the existing health
inspector. It never modifies deals.json, irrespective of environment removal flags.
It preserves original records, checked time, extracted text and text hash in a
report and uploads each daily report as a 90-day Actions artifact. Slack's existing
review reads reports younger than 48 hours and preserves Edit/Remove/Source actions.

Conservative candidate requirements: successful current response, no redirects,
merchant and specific title tokens present, explicit full end date with year,
single non-conflicting end date, no recurring/member/birthday wording or extension,
and a 48-hour grace beyond UTC end-of-day (also past Vienna end-of-day).
Manual edited records are protected. Every decision remains review-only.

Limitations: extracted HTML snippets are not a complete visual inspection.
Social captions/media, ambiguous redirects, arbitrary date formats, generic
merchant pages and explicit cancellation notices currently require manual review.
There is no new automatic archive/removal executor yet. Do not enable the legacy
normalizer as a shortcut: its removal paths also include non-expiry heuristics.

Local live-source run on Oct 5: 64 records, 0 expiry candidates, 60 requiring review,
4 manually protected. Of the review cases: 6 social, 19 unclear offer attribution,
14 recurring/member benefits, 15 redirects, 4 unreadable, 2 unclear dates.
Feed unchanged (git diff verified). This is not a claim all 64 offers are active.
Seven fixture tests passed, queue-workflow safety passed, Slack dry run passed.

Next gate: compare these reasons with actual manual Slack decisions, implement
source-specific extraction for the recurring failure classes, then test a separate
reversible expiry-only archival executor. Do not activate removals before that gate.

Implementation isolated from the dirty original checkout in
/tmp/freefinder-verified-expiry-20261005. No native/store/subscription changes.

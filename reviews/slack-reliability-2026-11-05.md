# Slack quality and reliability fixes, 2026-11-05

Owner requested fixes after reviewing real Slack delivery and workflow failures.

- Reject hypothetical B2B software rewards and paid VIP surcharges without a
  separate real saving. Recheck strict discovery, Social Food Review and approval
  of already-posted cards. Preserve real cafe loyalty and Community offers.
- Treat online ticket/coupon purchase separately from physical redemption.
  Named onsite experiences still require verified map coordinates before approval.
  Preserve real digital/delivery and explicitly supported pickup exceptions.
- Keep a timestamped incremental Slack delivery cache, with a one-hour recovery
  overlap. Retain individual post ages; do not perpetually extend suppression.
  Optional history refresh yields immediately on throttling when a usable cache
  exists. Failed/partial reads do not advance the checkpoint. Cold-start history
  failure remains an error rather than authorizing blind repeat sends.
- Concurrent rebuilds of the derived Instagram merchant registry no longer abort
  unrelated approved changes. Five collector/verifier source queues merge by
  record and changed field, preserving concurrent corrections and deletions.
  Strict shared-queue and atomic feed/map conflict guards remain enforced.

New exact cases: social-food-review-lln1ce, social-food-review-1mp6nbd and
meta-ig-17915890425545174. Fixtures include positive counterexamples and both
pre-send and approval-path checks. All 71 current live records retain their
classification and pass the new targeted quality rules; no live data is edited.

Verification: 8 targeted quality tests; 41 location tests; 103 existing location
tests; delivery migration/429/partial-read/expiry checks; real local-Git concurrent
writer tests; 53 map commit consistency checks; existing Slack queue, validation,
Unicode, source-cache, immediate-approval and Community approval suites.
Focused quality/location and generated-commit tests are now part of normal
dispatch/approval CI. No manual approval, Slack send, collector restart, paid
extraction, new API budget, automatic live removal or schedule change.

The new policy targets demonstrated false positives; unfamiliar offers still
need human review. Unknown or missing venue coordinates are held for correction,
not invented. Slack/GitHub outages can still defer a run; no zero-delay or
universal exactly-once delivery guarantee is claimed.

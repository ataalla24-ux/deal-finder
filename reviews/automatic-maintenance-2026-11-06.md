# Owner-authorized deal maintenance and free-credit AI

The owner explicitly authorized source-proven expiry hiding, source-backed copy
and map maintenance, appropriate stronger models, tests and a non-force main push.
New-deal approvals remain human decisions. Wolt and explicit manual fields remain
protected. No native app, Store, paid crawler, geocoder, top-up or new key change.

## Cost protection

The actual OpenAI organization hard limit was lowered from an unenforced alert
to an enforced USD 40 ceiling. Existing automatic reload remained OFF. Separate
private verification confirmed an active free grant and no remaining purchased
credit; payment methods were not changed. OpenAI states enforcement can lag, so
this deliberately leaves a reserve rather than spending to the free balance.

`ai-credit-policy.json` additionally limits this repository to USD 38 for the
verified period, USD 2 per rolling day and USD 1 reserved maximum per request.
All production inference entry points use `ai-credit-budget.js`. A dedicated
`automation/openai-free-credit-budget` branch provides SHA compare-and-swap
reservations shared across runners. Requests start only after a durable
reservation; retries are charged independently. Missing telemetry or ambiguous
failures retain the reservation, rather than granting free capacity. Responses
release unused reservation only with valid usage. Storage errors, bad policy,
unpriced models and billing limits defer work without unbudgeted calls.

The confirmed grant expires on 20 November 2026 at 08:10:11 UTC. No next grant,
balance, automatic renewal, calendar reset or purchased-credit fallback is
assumed. Admission stops two minutes earlier. A new period requires explicit
verification and ledger transition; this is intentional fail-closed behavior.
The ordinary code cannot independently detect a later owner change to provider
billing settings, so those settings must not be weakened outside this policy.

## Models and automated decisions

Luna performs scoped extraction, Terra handles visual evidence and title drafts,
and Sol performs multi-fact reviews and independent title verification. Explicit
task overrides must be priced. Legacy generic model settings no longer silently
force every task onto the former small model. Requests use standard processing,
bounded input/output, supported reasoning parameters, no hosted paid tools and
no automatic premium/model fallback. Existing approval card-editor switch stays
OFF; the separate daily live-maintenance stage has at most four AI candidates.

Expiry is deterministic, never an LLM verdict: a literal action date with year
must agree with all structured ends, followed by at least 12 hours of grace.
Post age, HTTP failures, guessed TTLs, publication years, missing years,
conflicting dates, indefinite/birthday offers, possible extensions, forceKeep
and newer manual date corrections cannot trigger a hide. A finite weekly
campaign can expire only when its explicit source-backed campaign end agrees.
At most five new hides occur per run. Originals and evidence are archived before
the feed changes; renewals with different evidence/dates are not suppressed.
Newer verified evidence for the exact Instagram post replaces older snapshots:
extensions and removed action dates cannot be overruled by an old caption.

Safe local title compaction preserves original wording and conditions. Difficult
titles require a verbatim source quotation, numeric and restriction guards and
an independent Sol verification. Manual title/description edits are not replaced.
No AI-generated price, date, merchant, address or coordinate is applied.
Unclear cases are integrated into the existing manual Slack live-review lane;
no new Slack messages are manually dispatched by this work.

The daily validation workflow reuses its existing schedule and writer queue,
performs maintenance and reconciles map coverage using the existing free-source
and lookup limits. The hourly map reconciliation remains. Every canonical feed
commit also replays deterministic maintenance before stamping, map, featured
references and SEO generation. Policy/state are protected map inputs, so a stale
writer cannot publish over concurrent manual or maintenance decisions.
The exact-post Graph evidence cache is also a protected input.

## Verification

The latest integration baseline is main `dd8e9638650e590e42d12ce414f599aec95a4c4a`:
68 live records. All six public feed/edit/featured/map/SEO documents were
byte-unchanged by this code work; no immediate expiry or copy change was proposed.
Independent earlier main edits reducing the historical 71 records were preserved.

New offline groups exercise shared funding races, state failure, deadlines,
redaction, real customer restrictions, date/year conflicts, future/recurring
offers, archive/replay/renewal behavior, manual protection and grounded title
draft/verification. The map commit suite additionally tests the real canonical
expiry hook and concurrent changes to all new policy/state inputs.

Initial integration tests exposed eager reads of disabled fixture state and
missing fixture packaging for the new pure Slack-review helper. Those were
corrected without weakening existing assertions. Original failures are retained
in private output. All 87 distinct final test commands passed, including the
58-case map commit consistency suite. Workflow YAML and source syntax passed.
A post-push GitHub schema check exposed a duplicate environment key tolerated
by the basic YAML parser. It was removed and the workflow-permission suite now
checks duplicate keys in every YAML mapping, including a negative regression.
Post-push GitHub/model-probe receipts are retained separately in
`output/free-credit-maintenance-2026-11-06` in the shared workspace.

Official model and billing references inspected on 6 November 2026:
- https://developers.openai.com/api/docs/models/gpt-6-luna
- https://developers.openai.com/api/docs/models/gpt-6.1-terra
- https://developers.openai.com/api/docs/models/gpt-6.1-sol
- https://developers.openai.com/api/docs/guides/spend-limits
- https://developers.openai.com/api/docs/guides/chatgpt-api-credits

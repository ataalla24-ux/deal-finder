# Conservative deal-card editorial drafts

New Slack dispatch candidates receive an extractive AI pass using the existing
OPENAI_API_KEY secret. Exact evidence quotations only; no invented factual fields.
Short offer titles can replace marketing headings. Full existing descriptions
and quoted conditions are retained, including through Slack approval. Original
text is stored in metadata. Manually edited and published records bypass AI.

Merchant, location and validity suggestions require human review in Slack.
This is not independent target-page verification or automatic approval. Existing
live deals are not rewritten. Removal policy, native clients and store releases
are unchanged.

Maximum 40 calls and 120 seconds per dispatch, 25 seconds per request. Cached
proposals avoid repeated calls. Failures preserve the candidate for manual review.
Normal, Firecrawl review and Social Food review dispatch lanes use the editor.

Verification: mocked editorial tests, Slack approval integration, Unicode,
pending-edit and queue workflow safety regressions. A real provider response and
production dispatch have not yet been verified for this change.

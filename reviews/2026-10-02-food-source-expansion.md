# Additive food source expansion

## Scope

First verified batch: 14 additional official Instagram merchant profiles,
preserving all 38 previous watchlist entries and priorities. Evidence URLs are
stored on each new entry; their websites linked these profiles on 2026-10-02.
Profile ownership is not proof of a particular promotion, validity or Vienna
participation. Existing post verification, merchant/scout separation, API limits,
rotation, moderation blocks and the food account quota remain unchanged.

Five additional Instagram search queries cover breakfast, lunch, openings,
two-for-one pizza and coffee/cake. Existing queries are retained.

Two official website sources use the existing bounded Power Scraper and current
page re-verification, not a new scraper schedule:

- Cafe Hummel: service-card extraction preserves the weekday/time restriction;
  address evidence is on its official homepage.
- Wunderkammer Vienna: restaurant carousel extraction avoids duplicated modal
  text; the domain/path is restricted to this hotel's dining section. Address
  evidence is on the official hotel overview. Buying the first cocktail remains
  a condition, not an unconditional free drink.

## Safeguards

- No edits to live deals, native apps, subscription settings or removal policy.
- No increase to Instagram/LLM quotas or scraper frequency.
- New watchlist priorities are 68-70, below established high-priority accounts.
- New candidates still go through the existing validation and Slack approval.
- TheFork remains blocked pending an explicit change of policy.
- Do not infer offers from ordinary menus. 7Stern and Radatz were reviewed as
  website leads but not added as official offer crawlers: the current pages
  did not yield suitable self-contained HTML promotions.
- Westfield requires merchant-aware offer extraction before adding it to this
  single-merchant parser; otherwise the shopping centre could become the wrong
  merchant. Not enabled in this batch.
- 100-150 merchants / 15-20 creators remain a staged expansion target, not an
  achieved or verified count. No fabricated handles or blanket trust flags.

## Verification

Passed: test-food-source-expansion, test-power-food,
test-instagram-food-discovery, test-instagram-entity-resolution.
The Power Scraper workflow runs the new regression test before crawling.
No claim of new published deals: manual approval is still required.

Live read-only checks on both new official pages extracted one offer each and
passed verifyOfficialFoodDeal with ok=true and current=true. No Slack messages
were sent by these checks. All original watchlist entries were compared against
origin/main and remain byte-for-value identical.

Status: implemented and tested locally; not committed/pushed or deployed in
this turn. Scheduled production collectors only receive this expansion after
publication to main.

Follow-up: user requested a much larger expansion. The above local-only status
describes the first turn; see 2026-10-02-vienna-wide-discovery.md for the combined
publication and broader directory-backed implementation. TheFork exclusion was
explicitly confirmed and remains unchanged.

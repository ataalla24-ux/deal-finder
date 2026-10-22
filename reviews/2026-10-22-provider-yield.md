# Food provider yield investigation

Owner requested diagnosing the zero-new-deal result and increasing useful Vienna
food/non-alcoholic drink coverage without monetary cost.

## Observed causes

- Scan39854690150:18 independently verified direct candidates, all already known.
  Six successful rendered requests extracted zero candidates. One IKEA cost/access
  refusal and source/provider pauses were retained; no retry/bypass here.
- Scan39855595897:22 of23 requests went to BackWerk, including coffee reference
  material, generic product news and a Salzburg opening. All23 HTTP successes
  yielded zero candidates. The other page, DerMann's voucher campaign, was expired.
- The provider services retrieve pages; they are not automatically new-source
  discovery engines. Enlarging the request cap alone expanded a weak URL pool.
- PDF/image-only coupons and rendered-only offers without independent official
  HTML corroboration remain coverage gaps. The evidence verifier is not weakened.

## Changes

- Round-robin merchant pages with a maximum of4 per source/run, keeping32 total,
  the same four daily scheduled opportunities and every credit/expiry guard.
- BackWerk follows promotional links, not the entire news archive. The restriction
  applies to saved historical child URLs too; access/cooldown records are retained.
- Readable direct HTML with no extractable offer skips the paid renderer, reports
  why, and retains the existing no-yield page cooldown. Explicit JS sources/shells
  still use the guarded renderer. No claim this detects image-only promotions.
- Reports distinguish direct/rendered candidates, rejection reasons, independent
  verification failures and source concentration, apart from cross-feed duplicates.
- Add three observed official local sources: Gasthaus Maria (1120), Salieri (1010),
  Weltcafe (1090). Configured offer-block selectors retain prices/conditions.
  Weltcafe's adjacent coffee offer is separate from the alcoholic happy hour;
  alcohol inside the coffee offer is still rejected. Soft hyphens are normalized.
  Explicit weekday offers are recognized as recurring, not given invented expiry.

## Verification before production

- New regression cases failed before fixes;36 provider tests pass after fixes.
-16 existing source/evidence/Slack/queue regression scripts pass.
- Live official fetch + independent regular Slack validation on22Oct21:32UTC:
  all3 new source candidates allowed, none already present in current live/pending
  files. No end date invented, no manual approval/publication, no API credit spent.
  Slack delivery has NOT been established at this checkpoint.
- No budget, paid account, payment, consent, app/Store, customer message or source
  access policy changes. Preexisting .wrangler files preserved.

Local evidence: output/provider-yield-2026-10-22/audit.json and tests.json in the
parent app workspace.

## Production result

- Source commit cf55eed143e2787d73e101add86140188c8553af pushed nonforce to main.
- PowerFood39858211626, Graph39858211317 and Pages39858210556 SUCCESS.
- Power Scraper39858226067 SUCCESS; all3 new merchant pages HTTP200, each yielded
  one candidate. Generated commit ac520c6acf900758fe6fb5c6bc01dd45d9c95639.
- Automatic Central Deal Dispatch39859522368 SUCCESS; generated commit
  63a17207a includes all3 records with slackTs and lifecycle slack-sent.
- Read actual Slack thread C0AF8TXN2KW / 1792705785.845129 on22Oct21:50UTC:
  parent confirms3of3 sent; replies1792705789.458759 (WeltCafe),
  1792705793.593769 (Salieri),1792705797.409259 (Gasthaus Maria) contain the exact
  tracked IDs and prices. Human review/approval still required; none published
  by this task. Recurring offers have no invented end date. The displayed fetch
  date is explicitly NOT proof of a new publication or promotion start.
- No ScraperAPI/ScrapingBee/Zyte page requests this turn. These3 offers came from
  direct official HTML. Normal central card editing kept its existing budget;
  this is not a claim that the existing editorial service uses no API calls.
- Provider enabled variable freshly true. Real post-crawl target plan contains
  only3 currently eligible pages (the new sources); old cooldowns remain. Max32
  and four scheduled runs are ceilings/opportunities, NOT promised daily volume.
- ProductionFeed39858211380 still fails8 preexisting expired IDs:
  meta-ad-1110887824818940,g2-otf93r,gs-556958,gs-556781,
  social-food-review-10etoi1,meta-ig-18647925118035759,flight-8u61yk,flight-rbt5lu.
  No validator weakening, live-feed deletion or artificial date extension.
- PDF/image-only offers and unsupported rendered-only corroboration remain gaps.

Evidence: production-evidence.json, production-*.json, run-*.log,
provider-tests.log and target-plan.json in the local evidence directory above.
Slack thread: https://freefinder.slack.com/archives/C0AF8TXN2KW/p1792705785845129

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
parent app workspace. Production run/delivery evidence to be appended after checks.

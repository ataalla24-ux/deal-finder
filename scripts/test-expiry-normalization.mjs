import assert from 'node:assert/strict';

import {
  extractTargetPageDateHints,
  isVagueExpiry,
  normalizeDealExpiry,
  parseExpiryDetails,
  parseExpiryShape,
} from '../scraper/expiry-utils.js';
import { validateDealsForSlack } from '../scraper/deal-validity-agent.js';

const now = new Date('2026-06-27T12:00:00.000Z');

assert.equal(isVagueExpiry('2026-05-08T23:59:59.999Z'), false, 'ISO expiry must stay concrete');
assert.equal(isVagueExpiry('Kurzfristig / siehe TikTok'), true, 'vague TikTok expiry stays vague');
assert.equal(isVagueExpiry('Ganztägig'), true, 'all-day schedule text is not a concrete expiry');
assert.equal(isVagueExpiry('Gutschein-abhängig'), true, 'voucher-dependent text is not a concrete expiry');

const iso = parseExpiryDetails('2026-05-08T23:59:59.999Z', { now });
assert.equal(iso?.date.toISOString(), '2026-05-08T23:59:59.999Z', 'ISO datetime parses as day expiry');

const singleDay = parseExpiryDetails('Am 29.06', { now });
assert.equal(singleDay?.date.toISOString(), '2026-06-29T23:59:59.999Z', 'German single-day prefix parses');

for (const raw of ['4.9.2026', '04.09.2026', '4/9/2026']) {
  assert.equal(
    parseExpiryDetails(raw, { now })?.date.toISOString(),
    '2026-09-04T23:59:59.999Z',
    `${raw} must use de-AT day/month order`
  );
}
assert.equal(
  parseExpiryShape('4.9.2026', { now, contextText: 'Am 4. September findet das 6. Straßenfest statt.' }).validOn,
  '2026-09-04'
);

const broadPageDate = extractTargetPageDateHints(`
  <html><head><meta property="og:title" content="1+1 jeden Mittwoch"></head>
  <body><footer>Zuletzt aktualisiert am 3. Juli 2026</footer></body></html>
`, { now });
assert.equal(broadPageDate.targetDateEvidence, 'broad-token');

const explicitPageEnd = extractTargetPageDateHints(`
  <html><head>
    <meta property="og:title" content="20% Kaffee-Rabatt">
    <meta property="og:description" content="Gültig bis 30.9.2026">
  </head><body></body></html>
`, { now });
assert.equal(explicitPageEnd.targetDateEvidence, 'explicit-phrase');
assert.equal(explicitPageEnd.validUntil, '2026-09-30');

const joeUpdatedPage = extractTargetPageDateHints(`
  <meta property="og:title" content="jö Rabattsammler">
  <meta property="og:description" content="Das Angebot ist gültig bis für dich weiter. Aktualisiert am 07.07.2026 und online verfügbar.">
`, { now });
assert.notEqual(joeUpdatedPage.targetDateEvidence, 'explicit-phrase');

const joeTravelPage = extractTargetPageDateHints(`
  <meta property="og:title" content="jö Reisen">
  <meta property="og:description" content="Gültig bis auf Widerruf. Reisezeitraum: 12.4. bis 20.4.">
`, { now });
assert.notEqual(joeTravelPage.targetDateEvidence, 'explicit-phrase');

const dealWithConcreteExpiry = await normalizeDealExpiry({
  title: 'Gratis Pizza',
  expires: '2026-06-29T23:59:59.999Z',
  expiresOriginal: 'Kurzfristig / siehe TikTok',
}, { now, allowUrlLookup: false });
assert.equal(dealWithConcreteExpiry.expires, '2026-06-29T23:59:59.999Z');
assert.equal(dealWithConcreteExpiry.expiresPrecision, 'day');

const urlDerivedDeal = await normalizeDealExpiry({
  title: 'Probeangebot',
  expires: '2026-09-30T23:59:59.999Z',
  expiresOriginal: 'Ganztägig',
  expiresSource: 'url',
  expiresDetectedFromUrl: true,
}, { now, allowUrlLookup: false });
assert.equal(urlDerivedDeal.expiresSource, 'url');
assert.equal(urlDerivedDeal.expiresDetectedFromUrl, true);
assert.equal(urlDerivedDeal.validUntil, '2026-09-30');

const vagueSocialDeal = await normalizeDealExpiry({
  title: 'TikTok Deal',
  expiresOriginal: 'Kurzfristig / siehe TikTok',
}, { now, allowUrlLookup: false });
assert.equal(vagueSocialDeal.expires, '');
assert.equal(vagueSocialDeal.expiresPrecision, '');

const repairedSocialDate = await normalizeDealExpiry({
  title: 'Gratis Pizza bei Pizzeria Pozzuoli 3',
  expires: '29.6.2001',
  pubDate: '2026-06-24T10:42:26.000Z',
}, { now, allowUrlLookup: false });
assert.equal(repairedSocialDate.expires, '2026-06-29T23:59:59.999Z');
assert.equal(repairedSocialDate.expiresOriginal, '29.06.2026');
assert.equal(repairedSocialDate.validUntil, '2026-06-29');

async function validateExpiryCandidate(overrides) {
  const result = await validateDealsForSlack([{
    id: 'expiry-regression',
    brand: 'Wien Test Cafe',
    title: '50% Rabatt auf Kaffee',
    description: '50% Rabatt auf Kaffee in 1070 Wien.',
    url: 'https://example.com/expiry-regression',
    source: 'Official',
    distance: '1070 Wien',
    ...overrides,
  }], {
    now,
    concurrency: 1,
    inspectDealUrlHealth: async (url) => ({
      status: 200,
      finalUrl: url,
      dateHints: {},
      contentHints: {},
    }),
  });
  return result.results[0].decision;
}

const expiredIsoTimestamp = await validateExpiryCandidate({
  validUntil: '2026-06-26T23:59:59.999Z',
  expiryKind: 'end',
  dateConfidence: 'high',
});
assert.equal(expiredIsoTimestamp.allowed, false, 'an expired ISO validUntil timestamp must be blocked');
assert.match(expiredIsoTimestamp.reasons.join(' | '), /abgelaufen \(2026-06-26T23:59:59\.999Z\)/);

const explicitExpiryBeforeReviewTtl = await validateExpiryCandidate({
  expires: '2026-06-26',
  expiresSource: 'content-date',
  validUntil: '2026-06-29',
  expirySource: 'short-review-ttl',
  expiryKind: 'review-ttl',
  dateConfidence: 'low',
});
assert.equal(explicitExpiryBeforeReviewTtl.allowed, false, 'an expired explicit deal.expires must beat a synthetic review TTL');
assert.equal(explicitExpiryBeforeReviewTtl.expirySource, 'deal.expires');
assert.match(explicitExpiryBeforeReviewTtl.reasons.join(' | '), /abgelaufen \(2026-06-26\)/);

console.log('Expiry normalization regression tests passed.');

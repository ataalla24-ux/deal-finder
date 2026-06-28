import assert from 'node:assert/strict';

import { isVagueExpiry, normalizeDealExpiry, parseExpiryDetails } from '../scraper/expiry-utils.js';

const now = new Date('2026-06-27T12:00:00.000Z');

assert.equal(isVagueExpiry('2026-05-08T23:59:59.999Z'), false, 'ISO expiry must stay concrete');
assert.equal(isVagueExpiry('Kurzfristig / siehe TikTok'), true, 'vague TikTok expiry stays vague');
assert.equal(isVagueExpiry('Ganztägig'), true, 'all-day schedule text is not a concrete expiry');
assert.equal(isVagueExpiry('Gutschein-abhängig'), true, 'voucher-dependent text is not a concrete expiry');

const iso = parseExpiryDetails('2026-05-08T23:59:59.999Z', { now });
assert.equal(iso?.date.toISOString(), '2026-05-08T23:59:59.999Z', 'ISO datetime parses as day expiry');

const singleDay = parseExpiryDetails('Am 29.06', { now });
assert.equal(singleDay?.date.toISOString(), '2026-06-29T23:59:59.999Z', 'German single-day prefix parses');

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

console.log('Expiry normalization regression tests passed.');

import assert from 'node:assert/strict';

import { isVagueExpiry, normalizeDealExpiry, parseExpiryDetails, parseExpiryShape } from '../scraper/expiry-utils.js';

const now = new Date('2026-06-27T12:00:00.000Z');

assert.equal(isVagueExpiry('2026-05-08T23:59:59.999Z'), false, 'ISO expiry must stay concrete');
assert.equal(isVagueExpiry('Kurzfristig / siehe TikTok'), true, 'vague TikTok expiry stays vague');
assert.equal(isVagueExpiry('Ganztägig'), true, 'all-day schedule text is not a concrete expiry');
assert.equal(isVagueExpiry('Gutschein-abhängig'), true, 'voucher-dependent text is not a concrete expiry');

const iso = parseExpiryDetails('2026-05-08T23:59:59.999Z', { now });
assert.equal(iso?.date.toISOString(), '2026-05-08T23:59:59.999Z', 'ISO datetime parses as day expiry');

const singleDay = parseExpiryDetails('Am 29.06', { now });
assert.equal(singleDay?.date.toISOString(), '2026-06-29T23:59:59.999Z', 'German single-day prefix parses');

const compactRange = parseExpiryDetails('12.–25.07.', { now });
assert.equal(compactRange?.date.toISOString(), '2026-07-25T23:59:59.999Z', 'compact range expires on its end date');
assert.deepEqual(
  parseExpiryShape('12.–25.07.', { now }),
  {
    kind: 'range',
    raw: '12.–25.07.',
    validFrom: '2026-07-12',
    validUntil: '2026-07-25',
    confidence: 'high',
  },
  'compact range preserves start and end dates'
);
const normalizedCompactRange = await normalizeDealExpiry({
  title: 'Instagram-Angebot',
  expires: '12.–25.07.',
}, { now: new Date('2026-07-17T12:00:00.000Z'), allowUrlLookup: false });
assert.equal(normalizedCompactRange.expires, '2026-07-25T23:59:59.999Z');
assert.equal(normalizedCompactRange.validFrom, '2026-07-12');
assert.equal(normalizedCompactRange.validUntil, '2026-07-25');

const oldSameMonthRangeNow = new Date('2026-07-17T12:00:00.000Z');
assert.equal(
  parseExpiryDetails('01.–05.01.', { now: oldSameMonthRangeNow })?.date.toISOString(),
  '2026-01-05T23:59:59.999Z',
  'a plainly elapsed same-month yearless range must not be revived as next year',
);
assert.equal(parseExpiryShape('01.–05.01.', { now: oldSameMonthRangeNow })?.validUntil, '2026-01-05');

const newYearRangeNow = new Date('2026-12-17T12:00:00.000Z');
assert.equal(
  parseExpiryDetails('28.–05.01.', { now: newYearRangeNow })?.date.toISOString(),
  '2027-01-05T23:59:59.999Z',
  'compact yearless ranges must roll over New Year',
);
assert.deepEqual(
  parseExpiryShape('28.–05.01.', { now: newYearRangeNow }),
  {
    kind: 'range',
    raw: '28.–05.01.',
    validFrom: '2026-12-28',
    validUntil: '2027-01-05',
    confidence: 'high',
  },
);
assert.deepEqual(
  parseExpiryShape('28.12.–05.01.', { now: newYearRangeNow }),
  {
    kind: 'range',
    raw: '28.12.–05.01.',
    validFrom: '2026-12-28',
    validUntil: '2027-01-05',
    confidence: 'high',
  },
);

const beforeNewYearRangeNow = new Date('2026-11-30T12:00:00.000Z');
assert.deepEqual(
  parseExpiryShape('28.12.–05.01.', { now: beforeNewYearRangeNow }),
  {
    kind: 'range',
    raw: '28.12.–05.01.',
    validFrom: '2026-12-28',
    validUntil: '2027-01-05',
    confidence: 'high',
  },
  'an imminent Dec-Jan range is upcoming even when parsed in late November',
);
assert.equal(
  parseExpiryDetails('gültig bis 05.01.', { now: newYearRangeNow })?.date.toISOString(),
  '2027-01-05T23:59:59.999Z',
  'a nearby yearless January end date crosses New Year',
);
assert.deepEqual(
  parseExpiryShape('28.12.–05.01.2027', { now: newYearRangeNow }),
  {
    kind: 'range',
    raw: '28.12.–05.01.2027',
    validFrom: '2026-12-28',
    validUntil: '2027-01-05',
    confidence: 'high',
  },
  'an explicit end year must also assign the start to the preceding year',
);
assert.deepEqual(
  parseExpiryShape('28.–05.07.2026', { now }),
  {
    kind: 'range',
    raw: '28.–05.07.2026',
    validFrom: '2026-06-28',
    validUntil: '2026-07-05',
    confidence: 'high',
  },
  'a compact descending day range starts in the preceding month',
);

assert.deepEqual(
  parseExpiryShape('Nur heute: 1+1 Burger', {
    now,
    referenceDate: new Date('2026-07-17T22:30:00.000Z'),
    timeZone: 'Europe/Vienna',
  }),
  {
    kind: 'single',
    raw: 'Nur heute: 1+1 Burger',
    validOn: '2026-07-18',
    confidence: 'high',
  },
  'relative captions use the Vienna calendar day of the source post',
);
assert.equal(
  parseExpiryShape('gültig bis 31.12.', {
    now: new Date('2027-01-02T12:00:00.000Z'),
    referenceDate: new Date('2026-12-30T10:00:00.000Z'),
  }).validUntil,
  '2026-12-31',
  'yearless caption dates are inferred from publication time, not a later crawl year',
);

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

console.log('Expiry normalization regression tests passed.');

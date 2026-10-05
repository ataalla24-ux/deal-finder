import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessExpiry, buildReview, sourceURL } from './verified-expiry-review.mjs';

const now = new Date('2026-10-05T12:00:00Z');
const deal = { id: 'test', brand: 'Box 16', title: 'Chicken Döner 3,50 Euro', url: 'https://example.com/offer', expires: '2020-01-01' };
const health = value => ({ status: 200, finalUrl: deal.url, contentHints: { textSnippet: `Box 16 Chicken Döner 3,50 Euro. ${value}` } });
const assess = (value, overrides = {}) => assessExpiry({ ...deal, ...overrides }, health(value), { now });

test('fresh exact expiry is a review candidate, never removal', () => {
  const result = assess('Gültig bis 30.09.2026');
  assert.equal(result.status, 'expiry_candidate');
  assert.equal(result.automaticRemovalEligible, false);
  assert.equal(result.validUntil, '2026-09-30');
});
test('stored dates, post age, missing dates cannot trigger expiry', () => {
  for (const page of ['Veröffentlicht am 01.01.2020', 'Gültig bis 30.09.', '']) assert.equal(assess(page).status, 'review');
});
test('future, today, grace, leap/invalid dates and conflicting offers', () => {
  assert.equal(assess('Gültig bis 05.10.2026').status, 'not_expired');
  assert.equal(assess('Gültig bis 01.01.2027').status, 'not_expired');
  for (const page of ['Gültig bis 04.10.2026', 'Gültig bis 31.09.2026', 'Gültig bis 29.02.2026', 'Gültig bis 30.09.2026. Gültig bis 10.10.2026', 'Gültig bis 30.09.2026, verlängert']) {
    assert.equal(assess(page).status, 'review');
  }
});
test('Vienna calendar day, not UTC date', () => {
  assert.equal(assessExpiry(deal, health('Gültig bis 05.10.2026'), { now: new Date('2026-10-04T22:30:00Z') }).status, 'not_expired');
});
test('recurring, membership, unrelated merchant and manual edits protected', () => {
  for (const description of ['Geburtstag', 'jeden Montag', 'Mitgliedervorteil']) assert.equal(assess('Gültig bis 30.09.2026', { description }).status, 'review');
  assert.equal(assess('Gültig bis 30.09.2026', { brand: 'Other' }).status, 'review');
  assert.equal(assessExpiry(deal, health('Gültig bis 30.09.2026'), { now, protectedByEdit: true }).status, 'protected');
});
test('blocked, missing, redirected and social evidence never proves expiry', () => {
  for (const status of [403, 404, 410, 429, 500]) assert.equal(assessExpiry(deal, { status }, { now }).status, 'review');
  assert.equal(assessExpiry(deal, { ...health('Gültig bis 30.09.2026'), blockedByProtection: true }, { now }).status, 'review');
  assert.equal(assessExpiry(deal, { ...health('Gültig bis 30.09.2026'), finalUrl: 'https://example.com/' }, { now }).status, 'review');
  assert.equal(assessExpiry({ ...deal, url: 'https://www.instagram.com/p/abc/' }, { ...health('Gültig bis 30.09.2026'), finalUrl: 'https://www.instagram.com/p/abc/' }, { now }).status, 'review');
  assert.equal(sourceURL({ url: 'https://freefinder.at/blog/example' }), '');
});
test('runner preserves original records and isolates fetch failures', async () => {
  const deals = [deal, { ...deal, id: 'second' }];
  const before = JSON.stringify(deals);
  const report = await buildReview(deals, [{ dealId: 'second' }], { now, inspect: async () => { throw Error('timeout'); } });
  assert.equal(JSON.stringify(deals), before);
  assert.equal(report.apply, false);
  assert.equal(report.entries[0].status, 'review');
  assert.equal(report.entries[1].status, 'protected');
  assert.deepEqual(report.entries[0].originalDeal, deal);
});

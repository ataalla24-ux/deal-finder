import assert from 'node:assert/strict';
import { publicDealText, sanitizePublicDealText } from '../scraper/public-deal-text.js';
import { normalizeDealRecord } from '../scraper/deal-normalization-utils.js';
import { stampDealsFeedBundle, computeDealsFeedVersion } from './deals-feed-contract.mjs';

const input = {
  id: 'legacy-review', brand: 'Wien - manuell pruefen',
  title: '20% Rabatt bei Wien - manuell pruefen', distance: 'Wien - manuell pruefen',
  description: 'Nur mit Coupon.\nPr\u00fcfgrund: Quelle nicht erreichbar',
  manualDecision: 'approved', liveEditedFields: ['title', 'brand', 'description'],
  socialFoodReviewReason: 'manuell pruefen', validUntil: '2026-10-08',
};
const cleaned = sanitizePublicDealText(input);
assert.equal(cleaned.title, '20% Rabatt');
assert.equal(cleaned.brand, '');
assert.equal(cleaned.distance, 'Wien');
assert.equal(cleaned.description, 'Nur mit Coupon.');
assert.equal(cleaned.manualDecision, 'approved');
assert.equal(cleaned.validUntil, input.validUntil);
assert.equal(cleaned.socialFoodReviewReason, input.socialFoodReviewReason);
assert.equal(input.brand, 'Wien - manuell pruefen');
assert.deepEqual(sanitizePublicDealText(cleaned), cleaned);
assert.equal(publicDealText('Coupon an der Kassa pr\u00fcfen lassen.'), 'Coupon an der Kassa pr\u00fcfen lassen.');
assert.equal(publicDealText('Cafe (manual review required)'), 'Cafe');
assert.equal(publicDealText('WIEN \u2013 MANUELL PR\u00dcFEN'), 'WIEN');
assert.equal(publicDealText('Code TEST\nNur einmal pro Person.'), 'Code TEST\nNur einmal pro Person.');
assert.equal(normalizeDealRecord(input).title, '20% Rabatt');
const other = { id: 'unchanged', title: 'Gratis Kaffee', description: 'Nur am Montag.' };
const feed = stampDealsFeedBundle({ deals: [input, other] });
assert.deepEqual(feed.deals, [cleaned, other]);
assert.equal(feed.totalDeals, 2);
assert.equal(feed.feedVersion, computeDealsFeedVersion(feed.deals));
console.log('PASS: public text guards, internal metadata, manual decisions, source conditions, count/order and feed hash');

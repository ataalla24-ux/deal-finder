import assert from 'node:assert/strict';

import {
  filterAlreadyQueuedDeals,
  prepareSocialFoodReviewDeals,
  selectSocialFoodReviewDeals,
} from '../scraper/slack-notify.js';

const now = new Date('2026-08-31T10:00:00.000Z');

function reviewDeal(shortcode, overrides = {}) {
  return {
    id: `review-${shortcode}`,
    title: '30 Prozent auf Burger',
    brand: 'Test Burger',
    description: '30 % Rabatt auf Burger in 1070 Wien.',
    source: 'Instagram Review',
    originSource: 'Meta Instagram Graph',
    url: `https://www.instagram.com/reel/${shortcode}/`,
    pubDate: '2026-08-30T10:00:00.000Z',
    sourcePublishedAt: '2026-08-30T10:00:00.000Z',
    category: 'essen',
    type: 'rabatt',
    socialFoodReview: true,
    socialFoodReviewReason: 'missing-vienna-evidence',
    evidence: {
      socialFoodAudit: {
        foodDrinkScore: 2,
        dealSignal: true,
        viennaSignal: true,
        hardRejection: false,
      },
    },
    ...overrides,
  };
}

const prepared = prepareSocialFoodReviewDeals([
  reviewDeal('CurrentFood1'),
  reviewDeal('StaleFood1', { pubDate: '2026-08-20T10:00:00Z', sourcePublishedAt: '2026-08-20T10:00:00Z' }),
  reviewDeal('HardFood1', {
    socialFoodReviewReason: 'giveaway',
    evidence: { socialFoodAudit: { foodDrinkScore: 2, dealSignal: true, viennaSignal: true, hardRejection: true } },
  }),
], { now, maxAgeDays: 7 });

assert.equal(prepared.deals.length, 1);
assert.equal(prepared.deals[0].url, 'https://www.instagram.com/reel/CurrentFood1/');
assert.equal(prepared.rejectionCounts['stale-post'], 1);
assert.equal(prepared.rejectionCounts['hard-rejection'], 1);

const state = {
  day: '2026-08-31',
  posted: Array.from({ length: 7 }, (_, index) => ({ key: `instagram:old-${index}` })),
};
const selected = selectSocialFoodReviewDeals([
  reviewDeal('CurrentFood1', { qualityScore: 60 }),
  reviewDeal('CurrentFood2', { qualityScore: 50 }),
], state, { now, maxPerDay: 8 });
assert.equal(selected.remainingBeforeSelection, 1);
assert.equal(selected.deals.length, 1);
assert.equal(selected.deals[0].url, 'https://www.instagram.com/reel/CurrentFood1/');

const expandedDailySelection = selectSocialFoodReviewDeals(
  Array.from({ length: 18 }, (_, index) => reviewDeal(`ExpandedFood${index}`, { qualityScore: 80 - index })),
  { day: '2026-08-31', posted: [] },
  { now, maxPerDay: 16 },
);
assert.equal(expandedDailySelection.deals.length, 16, 'the review lane supports sixteen daily food candidates');

const crossLaneFiltered = filterAlreadyQueuedDeals(
  [reviewDeal('CurrentFood1')],
  new Set(['post:instagram:CurrentFood1']),
);
assert.equal(crossLaneFiltered.deals.length, 0, 'a regular Slack deal must suppress the same post in the review lane');

console.log('social food Slack review tests passed');

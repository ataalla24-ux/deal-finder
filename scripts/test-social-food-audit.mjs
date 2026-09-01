import assert from 'node:assert/strict';

import { advanceDealLifecycle } from '../scraper/deal-lifecycle.js';
import {
  buildSocialFoodArtifacts,
} from '../scraper/social-food-audit.js';
import {
  buildStratifiedAuditSample,
  dedupeAuditRows,
  normalizeLossReason,
  normalizeSocialAuditCandidate,
} from '../scraper/social-food-audit-utils.js';

const now = new Date('2026-08-31T12:00:00.000Z');

const reviewable = normalizeSocialAuditCandidate({
  url: 'https://www.instagram.com/reel/FOOD123/',
  title: 'Gratis Pizza in Wien',
  textSample: 'Heute Aktion: gratis Pizza in 1070 Wien bei @pizzahaus',
  ownerUsername: 'foodblog.wien',
  merchantUsername: 'pizzahaus',
  pubDate: '2026-08-30T12:00:00.000Z',
  reason: 'no-concrete-offer',
  status: 'rejected',
}, { source: 'meta-instagram', sourceLabel: 'Meta Instagram Graph' }, now);
assert.equal(reviewable.reviewEligible, true);
assert.equal(reviewable.foodDrinkRelevant, true);
assert.equal(reviewable.lossCategory, 'no-concrete-offer');

const stale = normalizeSocialAuditCandidate({
  ...reviewable,
  url: 'https://www.instagram.com/reel/STALE123/',
  pubDate: '2026-08-20T12:00:00.000Z',
  reason: 'post-too-old',
  status: 'rejected',
}, { source: 'meta-instagram' }, now);
assert.equal(stale.reviewEligible, false);
assert.equal(normalizeLossReason('post-too-old'), 'stale-post');

const wrongCity = normalizeSocialAuditCandidate({
  ...reviewable,
  url: 'https://www.tiktok.com/@food/video/1234567890123456789',
  title: 'Gratis Burger in Graz',
  textSample: 'Gratis Burger in Graz',
  reason: 'non-vienna-location',
  status: 'rejected',
}, { source: 'tiktok' }, now);
assert.equal(wrongCity.reviewEligible, false);

const recommendation = normalizeSocialAuditCandidate({
  url: 'https://www.instagram.com/reel/TOPFIVE1/',
  title: 'Top 5 Restaurants in Wien',
  textSample: 'Save my top 5 restaurants in Vienna. A special dinner experience.',
  pubDate: '2026-08-30T12:00:00.000Z',
  reason: 'no-concrete-offer',
  status: 'rejected',
}, { source: 'meta-instagram' }, now);
assert.equal(recommendation.reviewEligible, false);

const virginia = normalizeSocialAuditCandidate({
  url: 'https://www.instagram.com/reel/VIRGINIA1/',
  title: 'Lunch special',
  textSample: 'Banh Mi lunch deal for only 11.99 dollars in Vienna, Virginia 22182.',
  pubDate: '2026-08-30T12:00:00.000Z',
  reason: 'no-concrete-offer',
  status: 'rejected',
}, { source: 'meta-instagram' }, now);
assert.equal(virginia.reviewEligible, false);

const contaminatedDiscoveryKeyword = normalizeSocialAuditCandidate({
  url: 'https://www.tiktok.com/@tri.cities.foodie/video/7680426812756790559',
  title: 'Kids eat free in Richland WA',
  textSample: 'Food vendors at 815 George Washington Way, Richland WA. Kids enter free.',
  keyword: 'wien gratis 1 september 2026',
  ownerUsername: 'tri.cities.foodie',
  pubDate: '2026-08-31T12:00:00.000Z',
  reason: 'kein eindeutiges Wien-Signal',
  status: 'rejected',
}, { source: 'tiktok' }, now);
assert.equal(contaminatedDiscoveryKeyword.viennaSignal, false, 'search keywords are not location evidence');
assert.equal(contaminatedDiscoveryKeyword.reviewEligible, false);

const ownFreeFinderPost = normalizeSocialAuditCandidate({
  url: 'https://www.tiktok.com/@freefinder.at/video/7678424923206929686',
  title: 'Gratis Iced Matcha Latte in Wien',
  textSample: 'Gratis Iced Matcha Latte in Wien bis 1. September.',
  ownerUsername: 'freefinder.at',
  pubDate: '2026-08-30T12:00:00.000Z',
  reason: 'kein starkes Gratis-/Deal-Signal',
  status: 'rejected',
}, { source: 'tiktok' }, now);
assert.equal(ownFreeFinderPost.ownAccount, true);
assert.equal(ownFreeFinderPost.reviewEligible, false);

const expiredReviewCandidate = normalizeSocialAuditCandidate({
  url: 'https://www.tiktok.com/@chocoberry.at/video/7678679890975051030',
  title: '1+1 gratis bei ChocoBerry',
  textSample: '1+1 gratis bei ChocoBerry, verlängert bis Freitag 28.08., Copa Beach Wien.',
  ownerUsername: 'chocoberry.at',
  pubDate: '2026-08-27T12:00:00.000Z',
  reason: 'kein eindeutiges Wien-Signal',
  status: 'rejected',
}, { source: 'tiktok' }, new Date('2026-09-01T12:00:00.000Z'));
assert.equal(expiredReviewCandidate.expiredOfferWindow, true);
assert.equal(expiredReviewCandidate.reviewEligible, false);

const reviewRoundup = normalizeSocialAuditCandidate({
  url: 'https://www.instagram.com/reel/ROUNDUP1/',
  title: 'Free events in Vienna',
  textSample: '• Food Festival (September 2, 2026), free entry. • Coffee Market (September 3, 2026), free tasting in Vienna.',
  ownerUsername: 'vienna.guide',
  pubDate: '2026-08-30T12:00:00.000Z',
  reason: 'no-concrete-offer',
  status: 'rejected',
}, { source: 'meta-instagram' }, now);
assert.equal(reviewRoundup.unsafeContent, true);
assert.equal(reviewRoundup.reviewEligible, false);

const rows = [];
for (let index = 0; index < 120; index += 1) {
  rows.push(normalizeSocialAuditCandidate({
    url: `https://www.instagram.com/reel/SAMPLE${index}/`,
    title: index % 2 ? 'Gratis Kaffee Wien' : 'Burger Rabatt Wien',
    textSample: index % 2 ? 'Gratis Kaffee in 1010 Wien' : '20% Burger Rabatt in Wien',
    pubDate: '2026-08-30T12:00:00.000Z',
    reason: index % 3 ? 'no-concrete-offer' : 'kein eindeutiges Wien-Signal',
    status: 'rejected',
  }, { source: index % 2 ? 'instagram-ai' : 'meta-instagram' }, now));
}
assert.equal(buildStratifiedAuditSample(rows, 80).length, 80);

const crossCollectorDuplicate = {
  ...reviewable,
  source: 'wien-combined',
  status: 'collector-accepted',
  reviewEligible: false,
};
assert.equal(
  dedupeAuditRows([crossCollectorDuplicate, reviewable])[0].status,
  'collector-accepted',
  'a rejection from another collector must never downgrade an already accepted post into the review lane',
);

const artifacts = buildSocialFoodArtifacts({
  observations: [...rows, reviewable, stale, wrongCity],
  runMetrics: [{ source: 'meta-instagram', mediaTotalTokens: 1200 }],
  feedbackEvents: [{
    category: 'essen',
    decision: 'approved',
    decidedAt: '2026-08-30T13:00:00.000Z',
    slackSentAt: '2026-08-30T12:00:00.000Z',
    publicationStatus: 'published',
  }],
  now,
  reviewLimit: 10,
});
assert.equal(artifacts.audit.auditSample.length, 80);
assert.equal(artifacts.review.totalDeals, 10);
assert.equal(artifacts.audit.manualOutcomeMetrics.manuallyApproved, 1);
assert.equal(artifacts.audit.costMetrics.mediaTokensPerManualApproval7d, 1200);

let deal = advanceDealLifecycle({ id: 'deal-1' }, 'discovered', { at: now });
deal = advanceDealLifecycle(deal, 'extracted', { at: new Date(now.getTime() + 1000) });
deal = advanceDealLifecycle(deal, 'slack-sent', { at: new Date(now.getTime() + 2000) });
deal = advanceDealLifecycle(deal, 'manually-approved', { at: new Date(now.getTime() + 3000), user: 'U123' });
deal = advanceDealLifecycle(deal, 'published', { at: new Date(now.getTime() + 4000) });
assert.equal(deal.pipelineLifecycle.stage, 'published');
assert.equal(deal.pipelineLifecycle.manualDecision, 'approved');
assert.equal(deal.pipelineLifecycle.manualDecisionUser, 'U123');

console.log('social food audit tests passed');

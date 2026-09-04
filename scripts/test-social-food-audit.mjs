import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { advanceDealLifecycle } from '../scraper/deal-lifecycle.js';
import {
  buildSocialFoodArtifacts,
  collectSocialFoodObservations,
} from '../scraper/social-food-audit.js';
import {
  buildStratifiedAuditSample,
  buildSocialFoodReviewDeal,
  dedupeAuditRows,
  normalizeLossReason,
  normalizeSocialAuditCandidate,
} from '../scraper/social-food-audit-utils.js';

const now = new Date('2026-08-31T12:00:00.000Z');

const reviewable = normalizeSocialAuditCandidate({
  url: 'https://www.instagram.com/reel/FOOD123/',
  title: 'Gratis Pizza in Wien',
  textSample: 'Diese Woche Aktion: gratis Pizza in 1070 Wien bei @pizzahaus',
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

const reviewableCollectorAgeCutoff = normalizeSocialAuditCandidate({
  ...reviewable,
  url: 'https://www.instagram.com/reel/FOURDAYS123/',
  pubDate: '2026-08-27T12:00:00.000Z',
  reason: 'post-too-old',
  status: 'rejected',
}, { source: 'meta-instagram' }, now);
assert.equal(
  reviewableCollectorAgeCutoff.reviewEligible,
  true,
  'a direct 3–7 day old food post may enter human review while the seven-day hard cap remains enforced',
);

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

const recommendationWithExplicitOffer = normalizeSocialAuditCandidate({
  url: 'https://www.instagram.com/reel/STUDENTCOMBO1/',
  title: 'Food-Tipp in Wien',
  textSample: 'Food-Tipp in Wien: Bei BURGERISTA gibt es die Schüler-Combo mit Burger und Getränk für nur €9,90.',
  pubDate: '2026-08-28T12:00:00.000Z',
  reason: 'general-recommendation',
  status: 'rejected',
}, { source: 'meta-instagram' }, now);
assert.equal(
  recommendationWithExplicitOffer.reviewEligible,
  true,
  'an explicit food offer inside recommendation wording belongs in human review',
);
const recommendationReviewDeal = buildSocialFoodReviewDeal(recommendationWithExplicitOffer, now);
assert.equal(recommendationReviewDeal.brand, 'Burgerista');
assert.match(recommendationReviewDeal.title, /Schüler-Combo.+€9,90.+Burgerista/i);

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

const expiredTodayOnlyCandidate = normalizeSocialAuditCandidate({
  ...reviewable,
  url: 'https://www.instagram.com/reel/YESTERDAYTODAYONLY1/',
  textSample: 'Nur heute: gratis Pizza in 1070 Wien.',
  pubDate: '2026-08-30T12:00:00.000Z',
  reason: 'post-too-old',
  status: 'rejected',
}, { source: 'meta-instagram' }, now);
assert.equal(expiredTodayOnlyCandidate.expiredOfferWindow, true);
assert.equal(expiredTodayOnlyCandidate.reviewEligible, false);

const expiredWeekendCandidate = normalizeSocialAuditCandidate({
  ...reviewable,
  url: 'https://www.instagram.com/reel/LASTWEEKEND1/',
  textSample: 'Dieses Wochenende: zwei Pizzen kaufen und einen Burger gratis in 1070 Wien.',
  pubDate: '2026-08-28T12:00:00.000Z',
  reason: 'post-too-old',
  status: 'rejected',
}, { source: 'meta-instagram' }, new Date('2026-09-04T12:00:00.000Z'));
assert.equal(expiredWeekendCandidate.expiredOfferWindow, true);
assert.equal(expiredWeekendCandidate.reviewEligible, false);

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

const incidentalTravelFood = normalizeSocialAuditCandidate({
  url: 'https://www.instagram.com/reel/TRAVELFOOD1/',
  title: 'Umrah package from Vienna',
  textSample: 'Umrah ab Wien mit Hotel, Transfer und Flug für nur €890. Wie teuer ist das Essen in Mekka?',
  ownerUsername: 'travel.example',
  pubDate: '2026-08-30T12:00:00.000Z',
  reason: 'no-concrete-offer',
  status: 'rejected',
}, { source: 'meta-instagram' }, now);
assert.equal(incidentalTravelFood.unsafeContent, true);
assert.equal(incidentalTravelFood.reviewEligible, false, 'incidental food words in a travel package must not enter Slack food review');

const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freefinder-social-food-registry-'));
fs.writeFileSync(path.join(registryDir, 'instagram-merchant-registry.json'), JSON.stringify({
  accounts: [{
    username: 'roth.restaurant',
    accountType: 'merchant',
    viennaVerified: true,
    verificationSource: 'approved-deal-history',
  }],
}));
fs.writeFileSync(path.join(registryDir, 'meta-report.json'), JSON.stringify({
  candidateAudit: [{
    id: 'registry-food-1',
    status: 'rejected',
    url: 'https://www.instagram.com/p/REGISTRYFOOD1/',
    caption: 'Von Montag bis Freitag gibt es den Mittagsteller für nur €10,80.',
    ownerUsername: 'roth.restaurant',
    pubDate: '2026-08-30T12:00:00.000Z',
    rejectionReason: 'missing-vienna-evidence',
  }],
}));
fs.writeFileSync(path.join(registryDir, 'meta-output.json'), JSON.stringify({ deals: [] }));
const registryObservation = collectSocialFoodObservations({
  docsDir: registryDir,
  now,
  sourceSpecs: [{
    key: 'meta-instagram',
    label: 'Meta Instagram Graph',
    report: 'meta-report.json',
    output: 'meta-output.json',
  }],
}).observations[0];
assert.equal(registryObservation.foodDrinkRelevant, true);
assert.equal(registryObservation.verifiedViennaSignal, true);
assert.equal(registryObservation.reviewEligible, true, 'a verified Vienna merchant may supply missing location evidence');
fs.rmSync(registryDir, { recursive: true, force: true });

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

const reviewDealWithSafetyTtl = buildSocialFoodReviewDeal(reviewable, now);
assert.equal(reviewDealWithSafetyTtl?.expiryKind, 'review-ttl');
assert.equal(reviewDealWithSafetyTtl?.expirySource, 'short-review-ttl');
assert.ok(Date.parse(reviewDealWithSafetyTtl?.expires) <= Date.parse(reviewable.pubDate) + 7 * 24 * 60 * 60 * 1000);

const locationBrandReviewDeal = buildSocialFoodReviewDeal(normalizeSocialAuditCandidate({
  url: 'https://www.instagram.com/p/LOCATIONBRAND1/',
  title: 'Mittagskracher is here',
  textSample: 'Montag bis Freitag: Burger kaufen, Fries und Getränk GRATIS. 📍Burger Brothers | Jägerstraße 40, 1200 Wien',
  ownerUsername: 'burgerbrothers20',
  merchantUsername: 'burgerbrothers20',
  pubDate: '2026-08-30T12:00:00.000Z',
  reason: 'post-too-old',
  status: 'rejected',
}, { source: 'meta-instagram' }, now), now);
assert.equal(locationBrandReviewDeal.brand, 'Burger Brothers');

let deal = advanceDealLifecycle({ id: 'deal-1' }, 'discovered', { at: now });
deal = advanceDealLifecycle(deal, 'extracted', { at: new Date(now.getTime() + 1000) });
deal = advanceDealLifecycle(deal, 'slack-sent', { at: new Date(now.getTime() + 2000) });
deal = advanceDealLifecycle(deal, 'manually-approved', { at: new Date(now.getTime() + 3000), user: 'U123' });
deal = advanceDealLifecycle(deal, 'published', { at: new Date(now.getTime() + 4000) });
assert.equal(deal.pipelineLifecycle.stage, 'published');
assert.equal(deal.pipelineLifecycle.manualDecision, 'approved');
assert.equal(deal.pipelineLifecycle.manualDecisionUser, 'U123');

console.log('social food audit tests passed');

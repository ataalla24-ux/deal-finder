import assert from 'node:assert/strict';

import {
  getFeaturedDealEligibility,
  isFoodDrinkDeal,
  normalizeFeaturedDeal,
  resolveWeeklyFeaturedSelection,
  selectAutomaticFeaturedDeal,
  shouldPreserveManualPick,
  getViennaWeekKey,
} from '../scraper/set-daily-deal.js';
import { weeklyRedeemableDays } from '../scraper/daily-featured-policy.js';

const now = new Date('2026-06-29T12:00:00.000Z');

for (const selectionReason of ['slack-pick', 'slack-live-review']) {
  const pick = { manualPick: true, selectionReason, pickedAt: '2026-06-29T12:00:00Z' };
  assert.equal(shouldPreserveManualPick(pick), true, 'next daily run preserves manual weekly choice');
  assert.equal(shouldPreserveManualPick(pick, '2026-06-29T11:00:00Z'), true, 'old reply cannot overwrite choice');
  assert.equal(shouldPreserveManualPick(pick, pick.pickedAt), true, 'reply replay is idempotent');
  assert.equal(shouldPreserveManualPick(pick, '2026-06-30T12:00:00Z'), false, 'new explicit selection remains possible');
}
assert.equal(shouldPreserveManualPick({ manualPick: false }), false);
assert.equal(getViennaWeekKey('2026-09-22T21:59:00Z'), getViennaWeekKey('2026-09-22T22:01:00Z'), 'Vienna midnight does not rotate a weekly pick');
assert.notEqual(getViennaWeekKey('2026-09-27T21:59:00Z'), getViennaWeekKey('2026-09-27T22:01:00Z'), 'Monday starts a new Vienna calendar week');

const featuredWithoutCachedLogo = normalizeFeaturedDeal({
  id: 'chocoberry-live',
  brand: 'Chocoberry',
  title: '1+1 bei Chocoberry',
  type: 'bogo',
  category: 'essen',
  url: 'https://www.tiktok.com/@chocoberry.at/video/123',
  logoUrl: '',
});
assert.equal(
  featuredWithoutCachedLogo.logoUrl,
  '',
  'featured snapshots must preserve an intentionally empty live logo after cache rejection',
);

assert.equal(isFoodDrinkDeal({
  brand: 'Apapika',
  title: 'Bowl kostenlos',
  description: 'Gratis Bowl in Wien',
  category: 'essen',
}), true, 'food category should be weekly-eligible');

assert.equal(isFoodDrinkDeal({
  brand: 'Starbucks',
  title: 'Gratis Iced Latte',
  description: 'Kaffee Deal',
  category: 'kaffee',
}), true, 'coffee category should be weekly-eligible');

assert.equal(isFoodDrinkDeal({
  brand: 'Shop',
  title: '20% auf Schuhe',
  description: 'Shopping Rabatt',
  category: 'shopping',
}), false, 'shopping should not be weekly-eligible');

assert.equal(isFoodDrinkDeal({
  brand: 'Hillsong Vienna',
  title: 'Hillsong Vienna Events',
  description: 'Community genießen und unserer Stadt dienen',
  category: 'events',
}), false, 'church/event copy should not be weekly-eligible via genießen');

assert.equal(isFoodDrinkDeal({
  brand: 'CIG Gemeinde',
  title: 'CIG Gemeinde',
  description: 'Gratis Event in Wien',
  category: 'gemeinde',
}), false, 'church/community deals should never be weekly food deals');

assert.equal(isFoodDrinkDeal({
  brand: 'Raiffeisen RaiffEIStag',
  title: 'Gratis Eis in teilnehmenden Eissalons',
  description: 'Gratis Eis im Juli',
  category: 'essen',
}), true, 'ice cream deals should remain weekly-eligible');

assert.equal(isFoodDrinkDeal({
  brand: 'lisa.maria.b',
  title: 'Indoor-Minigolf mitten in Wien',
  description: '10% Rabatt, danach vielleicht Kino oder Restaurant',
  category: 'essen',
  type: 'rabatt',
}), false, 'a miscategorized activity must not become the weekly food deal');

assert.equal(isFoodDrinkDeal({
  brand: 'EVO Fitness',
  title: '7 Tage kostenloses Probetraining',
  category: 'essen',
  type: 'gratis',
}), false, 'a miscategorized fitness trial must not become the weekly food deal');

const weeklyEligibility = await getFeaturedDealEligibility({
  id: 'food-1',
  brand: 'Pizza Wien',
  title: 'Gratis Pizza',
  description: 'Gratis Pizza am Montag',
  category: 'essen',
  type: 'gratis',
  expires: '2026-07-01T23:59:59.999Z',
  url: 'https://example.com/pizza',
}, 'weekly', { now, llmEnabled: false });
assert.equal(weeklyEligibility.eligible, true, 'food/drink weekly deal should pass deterministic eligibility');

const expiredEligibility = await getFeaturedDealEligibility({
  id: 'food-old',
  brand: 'Pizza Wien',
  title: 'Gratis Pizza',
  category: 'essen',
  expires: '2026-06-01T23:59:59.999Z',
  url: 'https://example.com/pizza',
}, 'weekly', { now, llmEnabled: false });
assert.equal(expiredEligibility.eligible, false, 'expired weekly deal should fail eligibility');

const selectedWeekly = await selectAutomaticFeaturedDeal([
  {
    id: 'church-1',
    brand: 'Hillsong Vienna',
    title: 'Hillsong Vienna Events',
    description: 'Community genießen und Gottesdienst',
    category: 'events',
    type: 'gratis',
    pubDate: '2026-06-29T10:00:00.000Z',
    url: 'https://example.com/hillsong',
  },
  {
    id: 'fitness-1',
    brand: 'Gym',
    title: 'Gratis Probetraining',
    description: 'Sehr guter Fitness Deal',
    category: 'fitness',
    type: 'gratis',
    pubDate: '2026-06-29T09:00:00.000Z',
    url: 'https://example.com/gym',
  },
  {
    id: 'food-2',
    brand: 'Cafe Wien',
    title: 'Gratis Kaffee',
    description: 'Gratis Kaffee in Wien',
    category: 'kaffee',
    type: 'gratis',
    dateConfidence: 'high',
    expiryKind: 'end',
    validUntil: '2026-07-05',
    pubDate: '2026-06-28T09:00:00.000Z',
    url: 'https://example.com/coffee',
  },
], { kind: 'weekly', now, llmEnabled: false });

assert.equal(selectedWeekly?.deal?.id, 'food-2', 'weekly automatic fallback should ignore non-food deals');

const noWeekly = await selectAutomaticFeaturedDeal([
  {
    id: 'shop-1',
    brand: 'Shop',
    title: 'Gratis Tasche',
    description: 'Shopping Deal',
    category: 'shopping',
    type: 'gratis',
    pubDate: '2026-06-29T09:00:00.000Z',
    url: 'https://example.com/shop',
  },
], { kind: 'weekly', now, llmEnabled: false });

assert.equal(noWeekly, null, 'weekly fallback must not pick non-food when no food/drink candidate exists');

const weekNow = new Date('2026-11-11T10:00:00Z');
const offer = (id, title, fields = {}) => ({ id, title, brand: 'Pizza Wien', category: 'essen',
  type: 'rabatt', description: 'Vor Ort in Wien.', url: 'https://example.com/pizza', dateConfidence: 'high',
  expiryKind: 'end', validUntil: '2026-11-16', ...fields });
const strongest = offer('strongest', 'Pizza für 5 € statt 15 €');
const weaker = offer('weaker', '25 % Rabatt auf Pizza', { pubDate: weekNow.toISOString(), votes: 500, hot: true });
const daily = { date: '2026-11-11', dealId: strongest.id };
const weekly = { week: '2026-11-09', dealId: weaker.id, manualPick: false };
assert.equal((await resolveWeeklyFeaturedSelection([weaker, strongest], weekly, null, weekNow)).deal.id, strongest.id);
assert.equal((await resolveWeeklyFeaturedSelection([weaker, strongest], weekly, daily, weekNow)).deal.id, weaker.id);
assert.equal((await resolveWeeklyFeaturedSelection([weaker, strongest], weekly, { ...daily, date: '2026-11-10' }, weekNow)).deal.id, strongest.id);
assert.equal(await resolveWeeklyFeaturedSelection([strongest], null, daily, weekNow), null, 'do not duplicate today in the weekly card');
assert.equal((await resolveWeeklyFeaturedSelection([weaker, strongest], { ...weekly, manualPick: true }, null, weekNow)).deal.id, weaker.id);
assert.equal((await resolveWeeklyFeaturedSelection([{ ...weaker, validUntil: '2026-11-10' }, strongest],
  { ...weekly, manualPick: true }, null, weekNow)).deal.id, strongest.id);
assert.deepEqual(weeklyRedeemableDays(offer('breakfast', '1+1 Pizza', { description: 'Aktion bis 10:30 Uhr.' }), weekNow,
  { verified: true }), ['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']);
assert.deepEqual(weeklyRedeemableDays(offer('friday', '1+1 Pizza freitags'), weekNow, { verified: true }), ['2026-11-13']);
assert.deepEqual(weeklyRedeemableDays(offer('next', '1+1 Pizza montags'), weekNow, { verified: true }), []);
assert.deepEqual(weeklyRedeemableDays(offer('sunday', '1+1 Pizza sonntags'), new Date('2026-11-15T23:01:00Z'), { verified: true }), []);
assert.deepEqual(weeklyRedeemableDays(offer('sunday', '1+1 Pizza sonntags'), new Date('2026-11-15T22:59:00Z'), { verified: true }), ['2026-11-15']);
assert.deepEqual(weeklyRedeemableDays(offer('dst', '1+1 Pizza sonntags', { validUntil: '2026-10-25' }),
  new Date('2026-10-24T20:00:00Z'), { verified: true }), ['2026-10-25']);
const sameValue = offer('equal', strongest.title, { validUntil: '2026-11-12' });
assert.equal((await resolveWeeklyFeaturedSelection([sameValue, strongest], { ...weekly, dealId: 'equal' }, null, weekNow)).deal.id,
  strongest.id, 'more redeemable days win ties');
for (const candidate of [offer('private', '1+1 Pizza', { description: 'Personalisierter Code.' }),
  offer('no-date', '1+1 Pizza', { dateConfidence: 'low' }), offer('next', '1+1 Pizza montags')]) {
  assert.equal(await resolveWeeklyFeaturedSelection([candidate], null, null, weekNow), null, candidate.id);
}

console.log('Featured deal selection checks passed.');

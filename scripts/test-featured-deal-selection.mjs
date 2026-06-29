import assert from 'node:assert/strict';

import {
  getFeaturedDealEligibility,
  isFoodDrinkDeal,
  selectAutomaticFeaturedDeal,
} from '../scraper/set-daily-deal.js';

const now = new Date('2026-06-29T12:00:00.000Z');

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

console.log('Featured deal selection checks passed.');

import assert from 'node:assert/strict';

import { buildHeuristicDeal } from '../scraper/instagram-ai-agent.js';

const now = new Date();
const dayMs = 24 * 60 * 60 * 1000;
const publishedEightDaysAgo = new Date(now.getTime() - 8 * dayMs).toISOString();
const publishedYesterday = new Date(now.getTime() - dayMs).toISOString();
const activeEnd = new Date(now.getTime() + 20 * dayMs);
const activeEndText = `${activeEnd.getUTCDate()}.${activeEnd.getUTCMonth() + 1}.${activeEnd.getUTCFullYear()}`;
const germanMonths = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

function candidate({ url, source = 'all', sourceDeal = null, title, description, pubDate = publishedYesterday }) {
  return {
    url,
    source,
    sourceDeal,
    title,
    snippet: description,
    preview: {
      status: 200,
      title,
      description,
      bodyText: description,
      pubDate,
      pubDateSource: 'instagram-rendered-time-datetime',
    },
  };
}

const blueTomato = buildHeuristicDeal(candidate({
  url: 'https://www.instagram.com/p/DaxA5jYFitT/',
  title: 'Blue Tomato auf Instagram',
  description: 'Free coffee in our @bluetomatoshopwien Rotenturmstraße. Come by and grab a coffee.',
}));
assert.ok(blueTomato, 'the explicit Vienna branch handle must rescue the Blue Tomato free-coffee post');

const unverifiedLegacyViennaContext = buildHeuristicDeal(candidate({
  url: 'https://www.instagram.com/p/Das-rG-kVlD/',
  source: 'deals',
  sourceDeal: {
    brand: 'Ernesto Osteria',
    title: '2. Illy Caffè GRATIS zu jedem Frühstück',
    distance: 'Wien',
  },
  title: 'Ernesto Osteria auf Instagram',
  description: `AKTION: 2. Illy Caffè GRATIS zu jedem Frühstück. Gültig bis ${activeEndText}.`,
  pubDate: publishedEightDaysAgo,
}));
assert.equal(
  unverifiedLegacyViennaContext,
  null,
  'a legacy distance label must not turn a non-Vienna Instagram offer into a Vienna deal',
);

const apronPrice = buildHeuristicDeal(candidate({
  url: 'https://www.instagram.com/p/Daia5aCFi-M/',
  source: 'gastro2',
  sourceDeal: { brand: 'Restaurant APRON', title: '5-Gänge-Menü', distance: 'Wien' },
  title: 'Restaurant APRON Wien auf Instagram',
  description: `Von heute bis ${activeEndText}: 5-Gänge-Menü um € 130 statt € 166 in Wien.`,
  pubDate: publishedEightDaysAgo,
}));
assert.ok(apronPrice, 'the euro-before-number instead-price form must count as a concrete active offer');

const futureEventDate = new Date(now.getTime() + 20 * dayMs);
const futureAidsEvent = buildHeuristicDeal(candidate({
  url: 'https://www.instagram.com/p/DbAYf0BMaIn/',
  source: 'deals',
  sourceDeal: { brand: 'Aids Hilfe Wien', distance: 'Wien' },
  title: 'Aids Hilfe Wien Straßenfest',
  description: `Am ${futureEventDate.getUTCDate()}. ${germanMonths[futureEventDate.getUTCMonth()]} ${futureEventDate.getUTCFullYear()} findet unser 6. Straßenfest statt – gratis Kinderbetreuung in Wien.`,
}));
assert.equal(futureAidsEvent, null, 'a future one-day event must not enter the current-deal queue');

const glutenFreeMarketing = buildHeuristicDeal(candidate({
  url: 'https://www.instagram.com/p/Da0GlutenFree/',
  title: 'Pizza in Wien',
  description: '100% gluten-free pizza, sugar-free drinks und vegane Zutaten in Wien.',
}));
assert.equal(glutenFreeMarketing, null, 'free-from product claims must not be classified as gratis deals');

console.log('Instagram AI end-to-end acceptance tests passed');

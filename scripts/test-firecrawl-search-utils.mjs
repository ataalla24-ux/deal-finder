import assert from 'node:assert/strict';

import {
  buildFreshInstagramDealSearchQuery,
  buildFreshWebDealSearchQuery,
  inferFirecrawlSearchDealType,
  isConcreteFirecrawlSearchResult,
  searchFreshInstagramPosts,
  searchFreshWebDeals,
} from '../scraper/firecrawl-search-utils.js';

const now = new Date('2026-08-23T12:00:00.000Z');
const targetUrl = 'https://www.instagram.com/ciosgrill/';
const query = buildFreshInstagramDealSearchQuery(targetUrl, { now });
assert.match(query, /"@ciosgrill"/);
assert.match(query, /after:2026-08-16/);

let capturedQuery = '';
let capturedOptions = null;
const posts = await searchFreshInstagramPosts({
  async search(searchQuery, options) {
    capturedQuery = searchQuery;
    capturedOptions = options;
    return {
      web: [
        {
          url: 'https://www.instagram.com/p/FreshDeal123/?utm_source=search',
          title: "Cio's Grill (@ciosgrill) • Instagram photos and videos",
          description: 'Heute 1+1 gratis in Wien.',
        },
        {
          url: 'https://www.instagram.com/p/FreshDeal123/',
          title: 'Duplicate',
          description: '1+1 gratis',
        },
        { url: 'https://www.instagram.com/ciosgrill/', title: 'Profile' },
        { url: 'https://example.com/deal', title: 'Other site' },
        {
          url: 'https://www.instagram.com/reel/WrongOwner123/',
          title: 'Other Restaurant (@otherrestaurant) • Instagram',
          description: '@ciosgrill erwähnt: 20% Rabatt',
        },
      ],
    };
  },
}, targetUrl, { now, limit: 20 });

assert.match(capturedQuery, /after:2026-08-16/);
assert.equal(capturedOptions.tbs, 'qdr:w');
assert.equal(capturedOptions.limit, 20);
assert.equal(posts.length, 1);
assert.equal(posts[0].url, 'https://www.instagram.com/p/FreshDeal123/');
assert.equal(posts[0].ownerUsername, 'ciosgrill');
assert.equal(posts[0].discoveryMethod, 'firecrawl-search');
assert.equal(isConcreteFirecrawlSearchResult(posts[0]), true);
assert.equal(isConcreteFirecrawlSearchResult({ description: 'Gewinnspiel: gratis Essen gewinnen, markiere einen Freund' }), false);
assert.equal(isConcreteFirecrawlSearchResult({ description: 'Gewinn: 2 Gutscheine, jetzt in den Lostopf' }), false);
assert.equal(isConcreteFirecrawlSearchResult({ description: 'Nur kostenloser Versand im Onlineshop' }), false);
assert.equal(isConcreteFirecrawlSearchResult({ description: 'Unser Frühstück ist gluten free und vegan.' }), false);
assert.equal(isConcreteFirecrawlSearchResult({ description: 'Sonntagsbrunch mit Free-Flow Prosecco.' }), false);
assert.equal(isConcreteFirecrawlSearchResult({ title: 'Alle Termine dieser Woche - Seite 3', description: 'Gratis Events in Wien' }), false);
assert.equal(isConcreteFirecrawlSearchResult({ description: '20% Rabatt vor Ort in Wien' }), true);
assert.equal(inferFirecrawlSearchDealType({ description: '1+1 gratis Pizza' }), 'bogo');
assert.equal(inferFirecrawlSearchDealType({ description: 'Gratis Kaffee' }), 'gratis');
assert.equal(inferFirecrawlSearchDealType({ description: '20% Rabatt' }), 'rabatt');

const webQuery = buildFreshWebDealSearchQuery('https://www.1000things.at/', { now });
assert.match(webQuery, /site:1000things\.at/);
assert.match(webQuery, /after:2026-08-16/);
const webDeals = await searchFreshWebDeals({
  async search() {
    return {
      web: [
        {
          url: 'https://www.1000things.at/blog/gratis-in-wien/?utm_source=test',
          title: 'Gratis in Wien',
          description: 'Aktuelle kostenlose Aktion.',
        },
        { url: 'https://example.com/wrong', title: 'Wrong domain' },
      ],
    };
  },
}, 'https://www.1000things.at/', { now });
assert.equal(webDeals.length, 1);
assert.equal(webDeals[0].url, 'https://www.1000things.at/blog/gratis-in-wien/');

console.log('Firecrawl fresh Instagram search tests passed.');

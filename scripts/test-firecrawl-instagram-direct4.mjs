import assert from 'node:assert/strict';

import { decodeInstagramShortcodeDate } from '../scraper/deal-evidence-utils.js';
import { discoverKey4RawOffers } from '../scraper/firecrawl-instagram-direct4.js';
import { verifyFirecrawlDeals } from '../scraper/firecrawl-post-verifier.js';
import {
  isRecentKey4PostUrl,
  normalizeKey4Offer,
  qualifyKey4Deals,
} from '../scraper/firecrawl-instagram-direct4-utils.js';

const now = new Date('2026-07-26T12:00:00.000Z');

let agentCalls = 0;
let searchCalls = 0;
const discoveryClient = {
  async agent() {
    agentCalls += 1;
    if (agentCalls === 1) {
      return { success: true, status: 'completed', data: { offers: [] }, creditsUsed: 12 };
    }
    return {
      success: true,
      status: 'completed',
      data: {
        offers: [{
          restaurant_name: 'Cio’s Grill',
          post_url: 'https://www.instagram.com/p/DbDbw1Glw4Q/',
          offer_description: 'Gratis Döner in Wien',
          offer_type: 'gratis',
          location: 'Franz-Josefs-Kai 15, 1010 Wien',
          location_citation: 'https://www.instagram.com/p/DbDbw1Glw4Q/',
          owner_username: 'ciosgrill',
        }],
      },
      creditsUsed: 40,
    };
  },
  async search(query) {
    searchCalls += 1;
    if (!query.includes('gratis Essen')) return { web: [] };
    return {
      web: [{
        title: 'Grey Kaffee auf Instagram',
        description: 'Heute gratis Kaffee, Kalvarienberggasse 1, 1170 Wien',
        url: 'https://www.instagram.com/reel/DbN6gIBK7Zk/?utm_source=search',
      }],
    };
  },
};

const discovery = await discoverKey4RawOffers({
  client: discoveryClient,
  now,
  minRawCandidates: 2,
  profileHandles: ['ciosgrill'],
});
assert.equal(agentCalls, 2, 'a zero-result primary agent triggers the focused fallback agent');
assert.equal(searchCalls, 6, 'all focused seven-day Firecrawl searches are attempted');
assert.equal(discovery.normalizedDeals.length, 2, 'search and fallback candidates are merged and deduplicated');
assert.equal(discovery.diagnostics.primary.offers, 0);
assert.equal(discovery.diagnostics.fallback.offers, 1);
assert.equal(discovery.diagnostics.recentInstagramPostsBeforeFallback, 1);

function rawOffer({
  url,
  description = 'Gratis Kaffee',
  location = '',
  locationCitation = '',
  reportedPostDate = '2025-01-01',
  currentlyValid = true,
}) {
  return normalizeKey4Offer({
    restaurant_name: 'Test Café',
    post_url: url,
    offer_description: description,
    offer_type: description,
    location,
    location_citation: locationCitation,
    post_date: reportedPostDate,
    is_currently_valid: currentlyValid,
  }, { discoverySource: 'fixture' });
}

async function timestampDeals(deals) {
  return verifyFirecrawlDeals(deals, {
    now,
    maxNetworkVerifications: 0,
    registry: new Map(),
  });
}

const freshUrl = 'https://www.instagram.com/reel/DbN6gIBK7Zk/';
assert.equal(isRecentKey4PostUrl(freshUrl, { now }), true);
assert.equal(isRecentKey4PostUrl('https://www.instagram.com/reel/DaifkcjshtA/', { now }), false);
const freshVerified = (await timestampDeals([rawOffer({
  url: freshUrl,
  description: 'Diese Woche gibt es einen Kaffee gratis.',
})]))[0];
freshVerified.postCaption = 'Diese Woche gibt es einen Kaffee gratis in Wien.';
freshVerified.city = 'Wien';
freshVerified.viennaVerified = true;
freshVerified.viennaEvidence = {
  verified: true,
  source: 'instagram-post-caption',
  type: 'instagram-post-caption',
  value: 'Wien',
  detail: 'Wien',
};

const wrongReportedYear = qualifyKey4Deals([freshVerified], { now, maxAgeDays: 7 });
assert.equal(wrongReportedYear.deals.length, 1);
assert.match(wrongReportedYear.deals[0].sourcePublishedAt, /^2026-07-25T/);
assert.equal(
  wrongReportedYear.deals[0].sourcePublishedAt,
  decodeInstagramShortcodeDate(freshUrl).toISOString(),
  'the Instagram shortcode timestamp wins over an agent-reported wrong year',
);

const citedUrl = 'https://www.instagram.com/p/DbDbw1Glw4Q/';
const citedLocation = (await timestampDeals([rawOffer({
  url: citedUrl,
  description: '1+1 gratis Burger',
  location: 'Berggasse 30, 1090 Wien',
  locationCitation: citedUrl,
})]))[0];
const citedResult = qualifyKey4Deals([citedLocation], { now, maxAgeDays: 7 });
assert.equal(citedResult.deals.length, 1, 'a specific Vienna address cited to the same original post is accepted');
assert.equal(citedResult.deals[0].viennaEvidence.method, 'firecrawl-cited-original-post-location');

const genericVienna = (await timestampDeals([rawOffer({
  url: citedUrl,
  description: '1+1 gratis Burger',
  location: 'Wien',
  locationCitation: citedUrl,
})]))[0];
const genericResult = qualifyKey4Deals([genericVienna], { now, maxAgeDays: 7 });
assert.equal(genericResult.deals.length, 0, 'an agent-only generic "Wien" label is not enough');
assert.equal(genericResult.rejected[0].reason, 'not-verified-vienna');

const wrongCitation = (await timestampDeals([rawOffer({
  url: citedUrl,
  description: 'Gratis Burger',
  location: 'Berggasse 30, 1090 Wien',
  locationCitation: freshUrl,
})]))[0];
assert.equal(
  qualifyKey4Deals([wrongCitation], { now }).rejected[0].reason,
  'not-verified-vienna',
  'location evidence must cite the same Instagram post',
);

const oldUrl = 'https://www.instagram.com/reel/DaifkcjshtA/';
const oldDeal = (await timestampDeals([rawOffer({
  url: oldUrl,
  description: 'Gratis Kaffee in Wien',
})]))[0];
oldDeal.city = 'Wien';
oldDeal.viennaVerified = true;
oldDeal.viennaEvidence = {
  verified: true,
  source: 'instagram-post-caption',
  type: 'instagram-post-caption',
  value: 'Wien',
  detail: 'Wien',
};
assert.equal(
  qualifyKey4Deals([oldDeal], { now, maxAgeDays: 365 }).rejected[0].reason,
  'older-than-7-days',
  'the Key 4 hard limit remains seven days even if a larger value is configured',
);

const expiredTodayOnly = {
  ...citedLocation,
  description: 'Nur heute gibt es einen Burger gratis.',
};
assert.equal(
  qualifyKey4Deals([expiredTodayOnly], { now }).rejected[0].reason,
  'expired-offer',
  '"nur heute" is anchored to the real post day',
);

const giveaway = {
  ...freshVerified,
  description: 'Gewinnspiel: Gewinne einen gratis Burger, markiere zwei Freunde.',
  postCaption: '',
};
assert.equal(qualifyKey4Deals([giveaway], { now }).rejected[0].reason, 'giveaway');

const freeEntry = {
  ...freshVerified,
  title: 'Live-Musik im Restaurant: free entry',
  description: 'Free entry zur Live-Musik im Restaurant.',
  offerTypeOriginal: 'free entry',
  postCaption: '',
};
assert.equal(qualifyKey4Deals([freeEntry], { now }).rejected[0].reason, 'not-free');

const agentExpired = { ...freshVerified, agentCurrentlyValid: false };
assert.equal(qualifyKey4Deals([agentExpired], { now }).rejected[0].reason, 'agent-marked-expired');

const deduped = qualifyKey4Deals([freshVerified, { ...freshVerified, title: `${freshVerified.title} ausführlich` }], { now });
assert.equal(deduped.deals.length, 1);

console.log('Firecrawl Key 4 discovery and qualification tests passed.');

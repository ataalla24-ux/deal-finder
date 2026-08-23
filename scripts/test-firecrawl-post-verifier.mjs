import assert from 'node:assert/strict';

import { canonicalInstagramPostKey } from '../scraper/deal-evidence-utils.js';
import {
  extractInstagramOwnerUsername,
  mergeFirecrawlDealHistory,
  verifyFirecrawlDeals,
} from '../scraper/firecrawl-post-verifier.js';

const now = new Date('2026-07-23T12:00:00.000Z');
const registry = new Map([
  ['ciosgrill', {
    username: 'ciosgrill',
    accountType: 'merchant',
    viennaVerified: true,
    verificationSource: 'historical-profile-address-evidence',
  }],
]);

assert.equal(
  extractInstagramOwnerUsername({
    contentHints: {
      description: '120 likes, 5 comments - ciosgrill on July 21, 2026: "Gratis Döner"',
    },
  }),
  'ciosgrill',
);

let inspections = 0;
const verified = await verifyFirecrawlDeals([
  {
    id: 'firecrawl-original-post',
    title: 'Gratis Döner bis 31. Juli',
    description: 'Gratis Premium Döner.',
    source: 'Firecrawl Gastro #2',
    url: 'https://www.instagram.com/p/DbDbw1Glw4Q/?tracking=1',
    pubDate: now.toISOString(),
    pubDateSource: 'firecrawlAgentRun',
  },
  {
    id: 'firecrawl-original-post-duplicate',
    title: 'Gratis Döner',
    description: 'Gratis Premium Döner.',
    source: 'Firecrawl Gastro #2',
    url: 'https://www.instagram.com/p/DbDbw1Glw4Q/',
    pubDate: now.toISOString(),
    pubDateSource: 'firecrawlAgentRun',
  },
], {
  now,
  registry,
  concurrency: 1,
  maxNetworkVerifications: 10,
  inspectDealUrlHealth: async (url) => {
    inspections += 1;
    return {
      status: 200,
      finalUrl: url,
      checkedAt: '2026-07-23T12:01:00.000Z',
      contentHints: {
        title: 'Cio’s Grill auf Instagram: "Gratis Premium Döner bis 31. Juli 2026"',
        description: '120 likes, 5 comments - ciosgrill on July 21, 2026: "Gratis Premium Döner bis 31. Juli 2026"',
        textSnippet: 'Gratis Premium Döner bis 31. Juli 2026.',
      },
      dateHints: {
        publicationDate: '2026-07-21T11:42:41.000Z',
        publicationDateSource: 'timeDatetime',
      },
    };
  },
});

assert.equal(inspections, 1, 'duplicate Firecrawl URLs are verified only once');
assert.equal(verified.length, 2);
assert.equal(verified[0].ownerUsername, 'ciosgrill');
assert.equal(verified[0].sourcePublishedAt, '2026-07-21T11:42:41.000Z');
assert.equal(verified[0].sourcePublishedAtSource, 'instagram-original-post-timeDatetime');
assert.equal(verified[0].pubDate, verified[0].sourcePublishedAt);
assert.equal(verified[0].postVerification.status, 'verified-original-post');
assert.equal(verified[0].type, 'gratis');
assert.equal(verified[0].originalEvidenceAligned, true);
assert.match(verified[0].validUntil, /^2026-07-31T23:59:59/);
assert.equal(verified[0].expirySource, 'instagram-original-post');
assert.equal(verified[0].viennaEvidence.source, 'merchant-registry');
assert.equal(verified[0].discoveredAt, now.toISOString());
assert.notEqual(verified[0].pubDateSource, 'firecrawlAgentRun');

const timestampOnly = await verifyFirecrawlDeals([
  {
    id: 'firecrawl-shortcode-only',
    title: 'Aktuelles Angebot',
    description: '1+1 gratis in Wien.',
    source: 'Firecrawl Food #2',
    url: 'https://www.instagram.com/reel/DbAQfxFi4RK/',
    pubDate: now.toISOString(),
    pubDateSource: 'firecrawlAgentRun',
  },
  {
    id: 'firecrawl-web-with-synthetic-date',
    title: 'Web-Fund',
    description: 'Rabatt',
    source: 'Firecrawl Gastro #2',
    url: 'https://example.com/deal',
    pubDate: now.toISOString(),
    pubDateSource: 'firecrawlAgentRun',
  },
], {
  now,
  registry,
  maxNetworkVerifications: 0,
});

assert.equal(timestampOnly[0].pubDateSource, 'url.instagramShortcode');
assert.match(timestampOnly[0].pubDate, /^2026-07-20T/);
assert.equal(timestampOnly[0].postVerification.status, 'timestamp-derived');
assert.equal(
  timestampOnly[0].viennaEvidence,
  undefined,
  'an unverified Firecrawl description must not be relabeled as original-post Vienna evidence',
);
assert.equal(timestampOnly[1].pubDate, '', 'crawler run time is never retained as a web publication date');
assert.equal(timestampOnly[1].sourcePublishedAt, '');

const strictFreshness = await verifyFirecrawlDeals([
  {
    id: 'old-instagram-future-offer',
    title: '1+1 gratis ab nächster Woche',
    description: '1+1 gratis in Wien.',
    source: 'Firecrawl',
    url: 'https://www.instagram.com/reel/DZMxfDsif1b/',
    validFrom: '2026-08-01',
    validUntil: '2026-08-31',
  },
  {
    id: 'non-social-web-deal',
    title: '50% Rabatt',
    description: '50% Rabatt in Wien.',
    source: 'Firecrawl',
    url: 'https://example.com/current-deal',
  },
], {
  now,
  registry,
  maxNetworkVerifications: 0,
  maxAcceptedAgeDays: 7,
});
assert.deepEqual(strictFreshness.map((deal) => deal.id), ['non-social-web-deal']);

const strictSearchResults = await verifyFirecrawlDeals([
  {
    id: 'search-good-instagram',
    title: 'Search snippet with mixed text',
    description: 'Untrusted snippet.',
    source: 'Firecrawl Search',
    discoveryMethod: 'firecrawl-search',
    url: 'https://www.instagram.com/p/StrictGood123/',
  },
  {
    id: 'search-normal-post',
    title: 'Gratis breakfast according to a mixed snippet',
    description: '20% Rabatt in Wien according to search.',
    source: 'Firecrawl Search',
    discoveryMethod: 'firecrawl-search',
    url: 'https://www.instagram.com/p/StrictNoise123/',
  },
  {
    id: 'search-giveaway',
    title: 'Gutschein in Wien',
    description: 'Untrusted search snippet.',
    source: 'Firecrawl Search',
    discoveryMethod: 'firecrawl-search',
    url: 'https://www.instagram.com/p/StrictGiveaway123/',
  },
  {
    id: 'search-berlin-offer',
    title: '20% Rabatt',
    description: 'Untrusted search snippet says Wien.',
    source: 'Firecrawl Search',
    discoveryMethod: 'firecrawl-search',
    url: 'https://www.instagram.com/p/StrictBerlin123/',
  },
  {
    id: 'search-good-web',
    title: 'Search result',
    description: 'Untrusted snippet.',
    source: 'Firecrawl Search',
    discoveryMethod: 'firecrawl-search',
    url: 'https://example.com/wien-deal',
  },
  {
    id: 'search-bad-web',
    title: 'Search result contaminated by deal text',
    description: 'Gratis in Wien.',
    source: 'Firecrawl Search',
    discoveryMethod: 'firecrawl-search',
    url: 'https://example.com/police-news',
  },
], {
  now,
  registry,
  maxNetworkVerifications: 20,
  inspectDealUrlHealth: async (url) => {
    const base = {
      status: 200,
      finalUrl: url,
      checkedAt: '2026-07-23T12:02:00.000Z',
    };
    if (url.includes('StrictGood')) {
      return {
        ...base,
        contentHints: {
          title: 'Cio’s Grill auf Instagram: "1+1 Döner in Wien"',
          description: '120 likes, 5 comments - ciosgrill on July 22, 2026: "1+1 Döner in Wien"',
          textSnippet: '1+1 Döner in 1020 Wien.',
        },
        dateHints: {
          publicationDate: '2026-07-22T10:00:00.000Z',
          publicationDateSource: 'timeDatetime',
        },
      };
    }
    if (url.includes('StrictNoise')) {
      return {
        ...base,
        contentHints: {
          title: 'Normal breakfast post',
          description: 'otheraccount on July 22, 2026: "Our breakfast is gluten free and delicious in Berlin."',
          textSnippet: 'Our breakfast is gluten free and delicious in Berlin.',
        },
        dateHints: {
          publicationDate: '2026-07-22T09:00:00.000Z',
          publicationDateSource: 'timeDatetime',
        },
      };
    }
    if (url.includes('StrictGiveaway')) {
      return {
        ...base,
        contentHints: {
          title: 'Gewinnspiel in Wien',
          description: 'giveawayaccount on July 22, 2026: "Gewinnspiel: zwei Gutscheine gewinnen, markiere einen Freund in Wien."',
          textSnippet: 'Jetzt in den Lostopf.',
        },
        dateHints: {
          publicationDate: '2026-07-22T08:00:00.000Z',
          publicationDateSource: 'timeDatetime',
        },
      };
    }
    if (url.includes('StrictBerlin')) {
      return {
        ...base,
        contentHints: {
          title: '20% Rabatt in Berlin',
          description: 'berlinrestaurant on July 22, 2026: "Diese Woche 20% Rabatt in Berlin."',
          textSnippet: 'Das Angebot gilt nur in Berlin.',
        },
        dateHints: {
          publicationDate: '2026-07-22T07:00:00.000Z',
          publicationDateSource: 'timeDatetime',
        },
      };
    }
    if (url.endsWith('/wien-deal')) {
      return {
        ...base,
        contentHints: {
          title: 'Lunch Deal in Wien',
          description: 'Montag bis Freitag: 20% Rabatt in 1050 Wien.',
          textSnippet: 'Das aktuelle Angebot gilt vor Ort.',
        },
      };
    }
    return {
      ...base,
      contentHints: {
        title: 'Polizei fasst Taschendiebin',
        description: 'Lokale Nachrichten aus Wien.',
        textSnippet: 'Die Polizei ermittelt.',
      },
    };
  },
});
assert.deepEqual(
  strictSearchResults.map((deal) => deal.id).sort(),
  ['search-good-instagram', 'search-good-web'],
  'Search snippets never substitute for exact offer and Vienna evidence from the opened source',
);
const strictInstagramDeal = strictSearchResults.find((deal) => deal.id === 'search-good-instagram');
assert.equal(strictInstagramDeal.brand, 'ciosgrill');
assert.equal(strictInstagramDeal.type, 'bogo');
assert.match(strictInstagramDeal.description, /1\+1 Döner in Wien/);
assert.equal(strictInstagramDeal.searchEvidenceAligned, true);
assert.equal(strictSearchResults.find((deal) => deal.id === 'search-good-web').type, 'rabatt');

const graphUrl = 'https://www.instagram.com/p/GraphFreshPost1/';
let graphNetworkInspections = 0;
const graphVerified = await verifyFirecrawlDeals([
  {
    id: 'graph-verified-firecrawl',
    title: 'Aktuelles Angebot',
    description: 'Instagram-Fund',
    source: 'Firecrawl',
    url: graphUrl,
  },
], {
  now,
  registry,
  graphEvidenceIndex: new Map([[canonicalInstagramPostKey(graphUrl), {
    postKey: canonicalInstagramPostKey(graphUrl),
    url: graphUrl,
    ownerUsername: 'ciosgrill',
    sourcePublishedAt: '2026-07-22T08:30:00.000Z',
    sourcePublishedAtSource: 'instagram-graph-timestamp',
    caption: '1+1 gratis in Wien bis 31. Juli 2026.',
    ocrText: '1+1 GRATIS',
    graphAccepted: true,
    graphRejection: '',
    blockingReason: '',
    verifiedAt: '2026-07-23T11:30:00.000Z',
  }]]),
  inspectDealUrlHealth: async () => {
    graphNetworkInspections += 1;
    throw new Error('Graph matches must not use the fallback network inspector');
  },
});
assert.equal(graphVerified.length, 1);
assert.equal(graphNetworkInspections, 0);
assert.equal(graphVerified[0].sourcePublishedAt, '2026-07-22T08:30:00.000Z');
assert.equal(graphVerified[0].sourcePublishedAtSource, 'instagram-graph-timestamp');
assert.equal(graphVerified[0].postVerification.status, 'verified-meta-graph');
assert.equal(graphVerified[0].metaGraphOcrText, '1+1 GRATIS');
assert.match(graphVerified[0].validUntil, /^2026-07-31T23:59:59/);

const graphBlocked = await verifyFirecrawlDeals([
  { id: 'graph-blocked-firecrawl', title: 'Alter Deal', source: 'Firecrawl', url: graphUrl },
], {
  now,
  registry,
  graphEvidenceIndex: new Map([[canonicalInstagramPostKey(graphUrl), {
    postKey: canonicalInstagramPostKey(graphUrl),
    url: graphUrl,
    sourcePublishedAt: '2026-07-22T08:30:00.000Z',
    sourcePublishedAtSource: 'instagram-graph-timestamp',
    blockingReason: 'offer-expired',
    verifiedAt: '2026-07-23T11:30:00.000Z',
  }]]),
  maxNetworkVerifications: 0,
});
assert.deepEqual(graphBlocked, []);

const history = mergeFirecrawlDealHistory([
  {
    id: 'current-post',
    title: 'Current Graph Deal',
    source: 'Firecrawl',
    url: graphUrl,
    discoveredAt: '2026-07-23T10:00:00.000Z',
  },
], [
  {
    id: 'previous-same-post',
    title: 'Previous Graph Deal with more detail',
    source: 'Firecrawl',
    url: graphUrl,
    sourcePublishedAt: '2026-07-22T08:30:00.000Z',
    sourcePublishedAtSource: 'instagram-graph-timestamp',
    discoveredAt: '2026-07-22T09:00:00.000Z',
  },
  {
    id: 'recent-web-history',
    title: 'Recent web deal',
    source: 'Firecrawl',
    url: 'https://example.com/recent',
    discoveredAt: '2026-07-20T09:00:00.000Z',
  },
  {
    id: 'stale-history',
    title: 'Stale old deal',
    source: 'Firecrawl',
    url: 'https://example.com/stale',
    discoveredAt: '2026-07-01T09:00:00.000Z',
  },
], { now });
assert.equal(history.retainedPreviousDeals, 2);
assert.equal(history.prunedPreviousDeals, 1);
assert.equal(history.duplicateCount, 1);
assert.equal(history.deals.length, 2);
assert.equal(history.deals.filter((deal) => canonicalInstagramPostKey(deal.url) === canonicalInstagramPostKey(graphUrl)).length, 1);
assert.ok(history.deals.some((deal) => deal.id === 'recent-web-history'));

console.log('Firecrawl original-post verifier tests passed.');

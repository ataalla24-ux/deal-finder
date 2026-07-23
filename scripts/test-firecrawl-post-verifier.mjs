import assert from 'node:assert/strict';

import {
  extractInstagramOwnerUsername,
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

console.log('Firecrawl original-post verifier tests passed.');

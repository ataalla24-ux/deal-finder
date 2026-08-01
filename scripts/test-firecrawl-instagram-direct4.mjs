import assert from 'node:assert/strict';

import {
  createKey4FirecrawlPool,
  discoverKey4PostCandidates,
  runKey4Pipeline,
} from '../scraper/firecrawl-instagram-direct4.js';
import {
  buildKey4SearchQueries,
  buildKey4TargetAccounts,
  classifyKey4Evidence,
  extractKey4PostEvidence,
  searchResultToKey4Candidate,
} from '../scraper/firecrawl-instagram-direct4-utils.js';

const now = new Date('2026-07-26T12:00:00.000Z');
const freshUrl = 'https://www.instagram.com/reel/DbN6gIBK7Zk/';

const targetAccounts = buildKey4TargetAccounts({
  accounts: [
    { username: 'soya_wien', priority: 100, category: 'food' },
    { username: 'viennaeats', priority: 99, category: 'discovery' },
  ],
}, {
  accounts: [{
    username: 'soya_wien',
    accountType: 'merchant',
    viennaVerified: true,
    confidence: 80,
    priorityScore: 50,
    verificationSource: 'fixture-address',
  }],
});
assert.deepEqual(targetAccounts.map((account) => account.username), ['soya_wien']);
assert.equal(targetAccounts[0].viennaVerified, true);

const queries = buildKey4SearchQueries(targetAccounts, { profileLimit: 1 });
assert.equal(queries.length, 7, 'six focused searches plus one verified merchant query');
assert.equal(queries.at(-1).targetUsername, 'soya_wien');

const clients = {
  exhausted: {
    async search() {
      throw new Error('Insufficient credits to perform this request');
    },
  },
  healthy: {
    async search() {
      return { web: [{ url: freshUrl, title: 'SOYA (@soya_wien) on Instagram' }] };
    },
  },
};
const rotatingPool = createKey4FirecrawlPool({
  keys: [
    { alias: 'exhausted', apiKey: 'fixture-exhausted' },
    { alias: 'healthy', apiKey: 'fixture-healthy' },
  ],
  clientFactory(apiKey) {
    return apiKey === 'fixture-exhausted' ? clients.exhausted : clients.healthy;
  },
  maxCalls: 10,
});
const rotatedResult = await rotatingPool.search('fixture', { sources: ['web'] });
assert.equal(rotatedResult.web.length, 1);
await rotatingPool.search('fixture-again', { sources: ['web'] });
assert.equal(rotatingPool.diagnostics().keys[0].disabledReason, 'credits');
assert.equal(rotatingPool.diagnostics().keys[0].calls, 1);
assert.equal(rotatingPool.diagnostics().keys[1].calls, 2, 'the healthy Key 4 replacement remains primary');

const discoveryPool = {
  async search() {
    return {
      web: [
        {
          url: `${freshUrl}?utm_source=search`,
          title: 'SOYA (@soya_wien) on Instagram',
          description: 'BUY 1, GET 1 FREE ON ALL COCKTAILS in Wien.',
        },
        {
          url: 'https://www.instagram.com/soya_wien/',
          title: 'SOYA profile',
        },
      ],
    };
  },
};
const discovery = await discoverKey4PostCandidates({
  pool: discoveryPool,
  now,
  queries: [{
    id: 'fixture',
    query: 'fixture query',
    targetUsername: 'soya_wien',
    targetViennaVerified: true,
  }],
  searchLimit: 5,
  concurrency: 1,
});
assert.equal(discovery.rawResults.length, 2);
assert.equal(discovery.candidates.length, 1, 'only direct post/reel URLs survive discovery');

const registry = new Map([['soya_wien', {
  username: 'soya_wien',
  accountType: 'merchant',
  viennaVerified: true,
  verificationSource: 'fixture-address',
}]]);
const directDocument = {
  markdown: 'BUY 1, GET 1 FREE ON ALL COCKTAILS.',
  metadata: {
    url: freshUrl,
    ogTitle: 'SOYA Wien (@soya_wien) on Instagram',
    ogDescription: '125 likes, 2 comments - soya_wien on Instagram: "BUY 1, GET 1 FREE ON ALL COCKTAILS. Rotgasse 8, 1010 Wien."',
    publishedTime: '2026-07-25T09:00:00.000Z',
    statusCode: 200,
  },
};
const directCandidate = searchResultToKey4Candidate({
  url: freshUrl,
  title: 'SOYA Wien (@soya_wien) on Instagram',
  description: 'BUY 1, GET 1 FREE ON ALL COCKTAILS in Wien.',
}, { id: 'fixture' }, now);
const evidence = extractKey4PostEvidence(directDocument, directCandidate, { now, registry });
assert.equal(evidence.postVerification.status, 'verified-original-post');
assert.equal(evidence.ownerUsername, 'soya_wien');
assert.equal(evidence.viennaVerified, true);
assert.match(evidence.postCaption, /BUY 1, GET 1 FREE/);

const accepted = classifyKey4Evidence([evidence], { now, maxAgeDays: 7, recurringMaxAgeDays: 45 });
assert.equal(accepted.accepted.length, 1);
assert.equal(accepted.accepted[0].type, 'bogo');
assert.equal(accepted.accepted[0].source, 'Firecrawl Instagram Direct #4');
assert.equal(accepted.accepted[0].descriptionSource, 'instagram-original-post');

const missingEvidence = extractKey4PostEvidence({}, directCandidate, { now, registry });
const missingResult = classifyKey4Evidence([missingEvidence], { now });
assert.equal(missingResult.review.length, 1, 'strong discovery snippets are retained for review');
assert.deepEqual(missingResult.review[0].key4Decision.reasons, ['missing-original-offer-evidence']);

const giveawayDocument = {
  metadata: {
    ...directDocument.metadata,
    ogDescription: 'soya_wien on Instagram: "Gewinnspiel: Gewinne einen gratis Burger und markiere zwei Freunde. 1010 Wien."',
  },
};
const giveawayEvidence = extractKey4PostEvidence(giveawayDocument, directCandidate, { now, registry });
const giveawayResult = classifyKey4Evidence([giveawayEvidence], { now });
assert.equal(giveawayResult.rejected[0].reason, 'giveaway');

const unknownViennaDocument = {
  metadata: {
    ...directDocument.metadata,
    ogTitle: 'Example (@example_food) on Instagram',
    ogDescription: 'example_food on Instagram: "Heute gibt es einen Burger gratis."',
  },
};
const unknownViennaEvidence = extractKey4PostEvidence(unknownViennaDocument, directCandidate, {
  now,
  registry: new Map(),
});
const unknownViennaResult = classifyKey4Evidence([unknownViennaEvidence], { now });
assert.equal(unknownViennaResult.review.length, 1);
assert.deepEqual(unknownViennaResult.review[0].key4Decision.reasons, ['not-verified-vienna']);

const recurringDocument = {
  metadata: {
    ...directDocument.metadata,
    ogDescription: 'soya_wien on Instagram: "Jeden Dienstag gibt es 1+1 Burger gratis. Rotgasse 8, 1010 Wien."',
    publishedTime: '2026-07-05T09:00:00.000Z',
  },
};
const recurringEvidence = extractKey4PostEvidence(recurringDocument, directCandidate, { now, registry });
const recurringResult = classifyKey4Evidence([recurringEvidence], {
  now,
  maxAgeDays: 7,
  recurringMaxAgeDays: 45,
});
assert.equal(recurringResult.accepted.length, 1, 'verified recurring offers may be older than seven days');
assert.equal(recurringResult.accepted[0].recurringSchedule, true);

const expiredDocument = {
  metadata: {
    ...directDocument.metadata,
    ogDescription: 'soya_wien on Instagram: "Gratis Kaffee bis 20. Juli 2026. Rotgasse 8, 1010 Wien."',
  },
};
const expiredEvidence = extractKey4PostEvidence(expiredDocument, directCandidate, { now, registry });
const expiredResult = classifyKey4Evidence([expiredEvidence], { now });
assert.equal(expiredResult.rejected[0].reason, 'expired-offer');

const integrationPool = {
  async search() {
    return {
      web: [{
        url: freshUrl,
        title: 'SOYA Wien (@soya_wien) on Instagram',
        description: 'BUY 1, GET 1 FREE ON ALL COCKTAILS in Wien.',
      }],
    };
  },
  async scrape() {
    return directDocument;
  },
  diagnostics() {
    return { totalCalls: 2, keys: [] };
  },
};
const pipeline = await runKey4Pipeline({
  pool: integrationPool,
  now,
  targetAccounts,
  registry,
  registryDocument: { accounts: [...registry.values()] },
  previousDeals: [],
  queries: [{ id: 'fixture', query: 'fixture', targetUsername: 'soya_wien', targetViennaVerified: true }],
  inspector: null,
  searchConcurrency: 1,
  scrapeConcurrency: 1,
});
assert.equal(pipeline.classification.accepted.length, 1);
assert.equal(pipeline.scrape.diagnostics.originalPostsVerified, 1);

console.log('Firecrawl Key 4 v2 evidence pipeline tests passed.');

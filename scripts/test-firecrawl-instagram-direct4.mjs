import assert from 'node:assert/strict';

import {
  createKey4FirecrawlPool,
  discoverKey4AgentCandidates,
  discoverKey4PostCandidates,
  runKey4Pipeline,
} from '../scraper/firecrawl-instagram-direct4.js';
import {
  agentDealToKey4Candidate,
  buildKey4HashtagSources,
  buildKey4SearchQueries,
  buildKey4TargetAccounts,
  classifyKey4Evidence,
  dealToKey4SeedCandidate,
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
assert.equal(queries.length, 10, 'nine focused searches plus one verified merchant query');
assert.equal(queries.at(-1).targetUsername, 'soya_wien');

const hashtagSources = buildKey4HashtagSources();
assert.equal(hashtagSources.length, 10);
assert.ok(hashtagSources.some((source) => source.hashtag === 'gratiswien'));
assert.ok(hashtagSources.some((source) => source.hashtag === 'viennafood'));
assert.ok(hashtagSources.some((source) => source.hashtag === 'allyoucaneatvienna'));
assert.ok(hashtagSources.every((source) => !/(?:1000things|meinbezirk)/i.test(source.url)));
assert.deepEqual(
  buildKey4HashtagSources(4).map((source) => source.hashtag),
  ['allyoucaneatvienna', 'viennafood', 'wienesse', 'viennarestaurant'],
  'the live-tested productive hashtags receive the expensive agent slots',
);

const clients = {
  exhausted: {
    async search() {
      throw new Error('Insufficient credits to perform this request');
    },
    async agent() {
      throw new Error('Insufficient credits to perform this request');
    },
  },
  healthy: {
    async search() {
      return { web: [{ url: freshUrl, title: 'SOYA (@soya_wien) on Instagram' }] };
    },
    async agent() {
      return { data: { deals: [{ post_url: freshUrl }] } };
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
const rotatedAgentResult = await rotatingPool.agent({ url: hashtagSources[0].url });
assert.equal(rotatedAgentResult.data.deals.length, 1);

const concurrentAliases = [];
const concurrentPool = createKey4FirecrawlPool({
  keys: [
    { alias: 'primary', apiKey: 'fixture-primary' },
    { alias: 'secondary', apiKey: 'fixture-secondary' },
  ],
  clientFactory(apiKey, alias) {
    return {
      async agent() {
        concurrentAliases.push(alias);
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { status: 'completed', data: { deals: [] } };
      },
    };
  },
  maxCalls: 10,
});
await Promise.all([
  concurrentPool.agent({ url: hashtagSources[0].url, timeout: 30 }),
  concurrentPool.agent({ url: hashtagSources[1].url, timeout: 30 }),
]);
assert.deepEqual(
  new Set(concurrentAliases),
  new Set(['primary', 'secondary']),
  'parallel hashtag agents are spread across free keys',
);

let cancelledAgentId = '';
const timeoutPool = createKey4FirecrawlPool({
  keys: [{ alias: 'timeout', apiKey: 'fixture-timeout' }],
  clientFactory() {
    return {
      async agent() {
        return { id: 'fixture-agent-job', status: 'processing' };
      },
      async cancelAgent(id) {
        cancelledAgentId = id;
        return true;
      },
    };
  },
  maxCalls: 2,
});
const timedOutAgent = await timeoutPool.agent({ url: hashtagSources[0].url, timeout: 30 });
assert.equal(timedOutAgent.key4TimedOut, true);
assert.equal(cancelledAgentId, 'fixture-agent-job', 'timed-out remote agents are cancelled');

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

const agentCandidate = agentDealToKey4Candidate({
  post_url: `${freshUrl}?utm_source=agent`,
  owner_username: '@soya_wien',
  brand_or_store: 'SOYA Wien',
  post_caption: 'BUY 1, GET 1 FREE ON ALL COCKTAILS. #viennafood',
  post_date: '2026-07-25',
}, hashtagSources[0], now);
assert.equal(agentCandidate.url, freshUrl);
assert.equal(agentCandidate.ownerUsername, 'soya_wien');
assert.match(agentCandidate.discoveredBy[0], /^firecrawl-agent:/);

const agentDiscovery = await discoverKey4AgentCandidates({
  pool: {
    async agent() {
      return {
        data: {
          deals: [
            {
              post_url: freshUrl,
              owner_username: 'soya_wien',
              post_caption: 'BUY 1, GET 1 FREE ON ALL COCKTAILS. #viennafood',
            },
            {
              post_url: 'https://www.instagram.com/soya_wien/',
              post_caption: 'profile page',
            },
          ],
        },
      };
    },
  },
  sources: [hashtagSources[0]],
  now,
  concurrency: 1,
});
assert.equal(agentDiscovery.rawResults.length, 2);
assert.equal(agentDiscovery.candidates.length, 1, 'hashtag agents also retain only direct posts or reels');
assert.equal(agentDiscovery.diagnostics.completedSources, 1);

const seedCandidate = dealToKey4SeedCandidate({
  url: freshUrl,
  title: 'Gratis Kaffee in Wien',
  description: 'Heute gibt es einen Kaffee gratis.',
  ownerUsername: 'soya_wien',
  viennaVerified: true,
}, 'deals-pending-fixture.json', now);
assert.equal(seedCandidate.seedSource, 'deals-pending-fixture.json');
assert.equal(seedCandidate.url, freshUrl);

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

const malformedUnicodeDocument = {
  metadata: {
    ...directDocument.metadata,
    ogDescription: `soya_wien on Instagram: "Heute gibt es einen Burger gratis. Rotgasse 8, 1010 Wien. ${'x'.repeat(240)}\uD83E"`,
  },
};
const malformedUnicodeEvidence = extractKey4PostEvidence(
  malformedUnicodeDocument,
  directCandidate,
  { now, registry },
);
const malformedUnicodeResult = classifyKey4Evidence([malformedUnicodeEvidence], { now });
assert.equal(malformedUnicodeResult.accepted.length, 1);
assert.equal(malformedUnicodeResult.accepted[0].title.isWellFormed(), true, 'deal titles remain valid Unicode');
assert.equal(malformedUnicodeResult.accepted[0].postCaption.isWellFormed(), true, 'captions remain valid Unicode');

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

const birthdayDocument = {
  metadata: {
    ...directDocument.metadata,
    ogTitle: 'TOKKI Korean BBQ (@tokki_korean_bbq) on Instagram',
    ogDescription: 'tokki_korean_bbq on Instagram: "Du isst zu deinem Geburtstag gratis bei uns. Ausweis und vollzahlende Begleitung mitnehmen. #vienna #birthday"',
    publishedTime: '2026-07-05T09:00:00.000Z',
  },
};
const birthdayEvidence = extractKey4PostEvidence(birthdayDocument, directCandidate, {
  now,
  registry: new Map(),
});
const birthdayResult = classifyKey4Evidence([birthdayEvidence], {
  now,
  maxAgeDays: 7,
  recurringMaxAgeDays: 45,
});
assert.equal(birthdayResult.accepted.length, 1, 'an original #vienna birthday offer is recurring and accepted');
assert.equal(birthdayResult.accepted[0].recurringSchedule, true);

const newerBirthdayEvidence = {
  ...birthdayEvidence,
  url: 'https://www.instagram.com/reel/DbcqqHNijHo/',
  postCaption: 'Du isst zu deinem Geburtstag gratis bei uns. #birthday #vienna',
  sourcePublishedAt: '2026-07-25T10:00:00.000Z',
  postVerification: {
    ...birthdayEvidence.postVerification,
    originalPostUrl: 'https://www.instagram.com/reel/DbcqqHNijHo/',
  },
};
const duplicateBirthdayResult = classifyKey4Evidence([
  birthdayEvidence,
  newerBirthdayEvidence,
], {
  now,
  maxAgeDays: 7,
  recurringMaxAgeDays: 45,
});
assert.equal(duplicateBirthdayResult.accepted.length, 1, 'the same merchant offer is emitted once');
assert.equal(duplicateBirthdayResult.accepted[0].url, newerBirthdayEvidence.url, 'the newest offer post wins');
assert.equal(duplicateBirthdayResult.rejected[0].reason, 'duplicate-offer-post');

const chanceDocument = {
  metadata: {
    ...directDocument.metadata,
    ogDescription: 'bigbox_fastfood on Instagram: "Jeden Mittwoch hast du die Chance, dein Essen kostenlos zu bekommen. Einfach würfeln. 1190 Wien."',
  },
};
const chanceEvidence = extractKey4PostEvidence(chanceDocument, directCandidate, { now, registry });
const chanceResult = classifyKey4Evidence([chanceEvidence], { now });
assert.equal(chanceResult.review.length, 1, 'chance-based free offers require human review');
assert.deepEqual(chanceResult.review[0].key4Decision.reasons, ['chance-based-offer']);

const expiredDocument = {
  metadata: {
    ...directDocument.metadata,
    ogDescription: 'soya_wien on Instagram: "Gratis Kaffee bis 20. Juli 2026. Rotgasse 8, 1010 Wien."',
  },
};
const expiredEvidence = extractKey4PostEvidence(expiredDocument, directCandidate, { now, registry });
const expiredResult = classifyKey4Evidence([expiredEvidence], { now });
assert.equal(expiredResult.rejected[0].reason, 'expired-offer');

const foreignViennaDocument = {
  metadata: {
    ...directDocument.metadata,
    ogTitle: 'Aroma Express | Coffee • Bakery • Kitchen on Instagram',
    ogDescription: 'Aroma Express on Instagram: "Complimentary coffee all day. 416 Maple Ave, Vienna, VA 22180."',
  },
};
const foreignViennaEvidence = extractKey4PostEvidence(foreignViennaDocument, directCandidate, {
  now,
  registry: new Map(),
});
assert.equal(foreignViennaEvidence.ownerUsername, '', 'a generic title suffix is not treated as an account owner');
const foreignViennaResult = classifyKey4Evidence([foreignViennaEvidence], { now });
assert.equal(foreignViennaResult.rejected[0].reason, 'not-vienna-austria');

const excludedPlatformDocument = {
  metadata: {
    ...directDocument.metadata,
    ogDescription: 'soya_wien on Instagram: "Mit NeoTaste bekommst du heute 1+1 Pizza gratis. Rotgasse 8, 1010 Wien."',
  },
};
const excludedPlatformEvidence = extractKey4PostEvidence(excludedPlatformDocument, directCandidate, { now, registry });
const excludedPlatformResult = classifyKey4Evidence([excludedPlatformEvidence], { now });
assert.equal(excludedPlatformResult.rejected[0].reason, 'excluded-platform');

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
  diagnostics() {
    return { totalCalls: 1, keys: [] };
  },
};
const pipeline = await runKey4Pipeline({
  pool: integrationPool,
  now,
  targetAccounts,
  registry,
  registryDocument: { accounts: [...registry.values()] },
  previousDeals: [],
  seedCandidates: [seedCandidate],
  agentSources: [],
  queries: [{ id: 'fixture', query: 'fixture', targetUsername: 'soya_wien', targetViennaVerified: true }],
  inspector: async () => ({
    status: 200,
    finalUrl: freshUrl,
    contentHints: {
      title: directDocument.metadata.ogTitle,
      description: directDocument.metadata.ogDescription,
      textSnippet: directDocument.markdown,
    },
    dateHints: {
      publicationDate: directDocument.metadata.publishedTime,
    },
  }),
  searchConcurrency: 1,
  scrapeConcurrency: 1,
});
assert.equal(pipeline.classification.accepted.length, 1);
assert.equal(pipeline.scrape.diagnostics.originalPostsVerified, 1);

console.log('Firecrawl Key 4 v2 evidence pipeline tests passed.');

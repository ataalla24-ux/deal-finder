import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  isFirecrawlRateOrCreditError,
  runBoundedFirecrawlAgent,
  selectRotatingFirecrawlTargets,
} from '../scraper/firecrawl-agent-utils.js';

let clock = 0;
let polls = 0;
let capturedRequest = null;
const completed = await runBoundedFirecrawlAgent({
  async startAgent(request) {
    capturedRequest = request;
    return { success: true, id: 'agent-completed' };
  },
  async getAgentStatus() {
    polls += 1;
    return polls === 1
      ? { success: true, status: 'processing', creditsUsed: 3 }
      : { success: true, status: 'completed', data: { deals: [] }, creditsUsed: 7 };
  },
}, {
  prompt: 'Find deals',
}, {
  timeoutSeconds: 10,
  pollIntervalSeconds: 1,
  maxCredits: 123,
  now: () => clock,
  sleep: async (milliseconds) => {
    clock += milliseconds;
  },
});

assert.equal(completed.id, 'agent-completed');
assert.equal(completed.creditsUsed, 7);
assert.equal(capturedRequest.maxCredits, 123);

let cancelledJob = '';
clock = 0;
await assert.rejects(
  runBoundedFirecrawlAgent({
    async startAgent() {
      return { success: true, id: 'agent-timeout' };
    },
    async getAgentStatus() {
      return { success: true, status: 'processing', creditsUsed: 11 };
    },
    async cancelAgent(jobId) {
      cancelledJob = jobId;
      return true;
    },
  }, {
    prompt: 'Find deals',
  }, {
    timeoutSeconds: 2,
    pollIntervalSeconds: 1,
    now: () => clock,
    sleep: async (milliseconds) => {
      clock += milliseconds;
    },
  }),
  (error) => error.code === 'firecrawl-agent-timeout'
    && error.cancelled === true
    && error.creditsUsed === 11,
);
assert.equal(cancelledJob, 'agent-timeout');

await assert.rejects(
  runBoundedFirecrawlAgent({
    async startAgent() {
      return { success: false, error: 'Insufficient credits to perform this request' };
    },
    async getAgentStatus() {
      throw new Error('must not poll');
    },
  }, { prompt: 'Find deals' }),
  (error) => error.code === 'firecrawl-agent-start-failed'
    && isFirecrawlRateOrCreditError(error.message),
);

assert.equal(isFirecrawlRateOrCreditError('Rate limit exceeded'), true);
assert.equal(isFirecrawlRateOrCreditError('Network unavailable'), false);

const rotatingTargets = ['a', 'b', 'c', 'd', 'e', 'f'];
const rotationDayOne = selectRotatingFirecrawlTargets(rotatingTargets, 3, new Date('2026-08-22T12:00:00Z'));
const rotationDayTwo = selectRotatingFirecrawlTargets(rotatingTargets, 3, new Date('2026-08-23T12:00:00Z'));
assert.equal(rotationDayOne.length, 3);
assert.equal(rotationDayTwo.length, 3);
assert.notDeepEqual(rotationDayOne, rotationDayTwo);
assert.deepEqual(new Set([...rotationDayOne, ...rotationDayTwo]), new Set(rotatingTargets));

const scraperConfigs = [
  ['scraper/firecrawl-gastro2.js', '.github/workflows/firecrawl-gastro-key1.yml', 'FIRECRAWL1_AGENT_TIMEOUT_SECONDS', 'FIRECRAWL1_MAX_CREDITS_PER_TARGET'],
  ['scraper/firecrawl-food3.js', '.github/workflows/firecrawl-food-key2.yml', 'FIRECRAWL2_AGENT_TIMEOUT_SECONDS', 'FIRECRAWL2_MAX_CREDITS_PER_TARGET'],
  ['scraper/firecrawl-consumables.js', '.github/workflows/firecrawl-consumables-key3.yml', 'FIRECRAWL3_AGENT_TIMEOUT_SECONDS', 'FIRECRAWL3_MAX_CREDITS_PER_TARGET'],
  ['scraper/firecrawl-instagram-direct4.js', '.github/workflows/firecrawl-instagram-key4.yml', 'FIRECRAWL4_AGENT_TIMEOUT_SECONDS', 'FIRECRAWL4_MAX_CREDITS_PER_TARGET'],
  ['scraper/firecrawl-instagram-gastro5.js', '.github/workflows/firecrawl-instagram-key5.yml', 'FIRECRAWL5_AGENT_TIMEOUT_SECONDS', 'FIRECRAWL5_MAX_CREDITS_PER_TARGET'],
];

for (const [sourcePath, workflowPath, timeoutVariable, creditVariable] of scraperConfigs) {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  assert.match(source, /runBoundedFirecrawlAgent\(/, `${sourcePath} must use bounded agent jobs`);
  assert.match(source, /searchFreshInstagramPosts\(/, `${sourcePath} must use Firecrawl Search before agent fallback`);
  assert.match(source, /mergeFirecrawlDealHistory\(/, `${sourcePath} must retain only rolling fresh history`);
  assert.match(source, /verifyFirecrawlDeals\(history\.deals/, `${sourcePath} must verify the merged history`);
  assert.doesNotMatch(source, /firecrawl\.agent\(/, `${sourcePath} must not start an unbounded waiter`);
  assert.ok(source.includes(timeoutVariable));
  assert.ok(source.includes(creditVariable));
  assert.ok(workflow.includes(`${timeoutVariable}:`));
  assert.ok(workflow.includes(`${creditVariable}:`));
  assert.match(workflow, /timeout-minutes:\s*\d+/);
}

const key1Source = fs.readFileSync('scraper/firecrawl-gastro2.js', 'utf8');
const key1Workflow = fs.readFileSync('.github/workflows/firecrawl-gastro-key1.yml', 'utf8');
assert.match(key1Source, /FIRECRAWL1_BROAD_AGENT_PASSES/);
assert.match(key1Source, /kind: 'broad-agent'/);
assert.doesNotMatch(key1Source, /urls: \[url\]/, 'Key 1 broad discovery must not be constrained to one seed URL');
assert.doesNotMatch(key1Source, /\n\s*url: url,/, 'the ignored legacy singular url field must not return');
assert.match(key1Source, /searchFreshWebDeals\(/);
assert.match(key1Workflow, /FIRECRAWL1_BROAD_AGENT_PASSES: 4/);
assert.match(key1Workflow, /FIRECRAWL1_AGENT_TIMEOUT_SECONDS: 420/);
assert.match(key1Workflow, /FIRECRAWL1_MAX_CREDITS_PER_TARGET: 500/);
assert.match(key1Workflow, /timeout-minutes: 40/);
assert.match(key1Workflow, /group: deal-state-writer/);
assert.match(key1Source, /instagram\.com\/explore\/tags\/gutscheinwien/);
assert.match(key1Source, /ikea\.com\/at\/de\/offers/);
assert.match(key1Source, /marktguru\.at\/c\/essensgutscheine/);
assert.match(key1Source, /höchstens zwei Deals von Wolt und höchstens zwei von Lieferando/);
assert.match(key1Source, /excluded-downstream-history/);

const key4Source = fs.readFileSync('scraper/firecrawl-instagram-direct4.js', 'utf8');
assert.match(key4Source, /searchFreshWebDeals\(/);

console.log('Firecrawl bounded-agent tests passed.');

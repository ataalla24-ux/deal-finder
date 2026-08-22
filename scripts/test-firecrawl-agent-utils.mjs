import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  isFirecrawlRateOrCreditError,
  runBoundedFirecrawlAgent,
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

const scraperConfigs = [
  ['scraper/firecrawl-gastro2.js', '.github/workflows/firecrawl-gastro-key1.yml', 'FIRECRAWL1_AGENT_TIMEOUT_SECONDS', 'FIRECRAWL1_MAX_CREDITS_PER_TARGET'],
  ['scraper/firecrawl-food3.js', '.github/workflows/firecrawl-food-key2.yml', 'FIRECRAWL2_AGENT_TIMEOUT_SECONDS', 'FIRECRAWL2_MAX_CREDITS'],
  ['scraper/firecrawl-consumables.js', '.github/workflows/firecrawl-consumables-key3.yml', 'FIRECRAWL3_AGENT_TIMEOUT_SECONDS', 'FIRECRAWL3_MAX_CREDITS'],
  ['scraper/firecrawl-instagram-direct4.js', '.github/workflows/firecrawl-instagram-key4.yml', 'FIRECRAWL4_AGENT_TIMEOUT_SECONDS', 'FIRECRAWL4_MAX_CREDITS_PER_TARGET'],
  ['scraper/firecrawl-instagram-gastro5.js', '.github/workflows/firecrawl-instagram-key5.yml', 'FIRECRAWL5_AGENT_TIMEOUT_SECONDS', 'FIRECRAWL5_MAX_CREDITS'],
];

for (const [sourcePath, workflowPath, timeoutVariable, creditVariable] of scraperConfigs) {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  assert.match(source, /runBoundedFirecrawlAgent\(/, `${sourcePath} must use bounded agent jobs`);
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
assert.match(key1Source, /urls: \[url\]/, 'Key 1 must pass each real target through the v2 urls field');
assert.doesNotMatch(key1Source, /\n\s*url: url,/, 'the ignored legacy singular url field must not return');

console.log('Firecrawl bounded-agent tests passed.');

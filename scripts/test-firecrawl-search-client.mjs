import assert from 'node:assert/strict';
import { createFirecrawlSearch } from '../scraper/firecrawl-search-client.js';

function harness(responses) {
  let clock = 100000;
  const calls = [];
  const waits = [];
  const retries = [];
  const search = createFirecrawlSearch({
    async search(query, params) {
      calls.push({ query, params, at: clock });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response || { web: [] };
    },
  }, {
    now: () => clock,
    sleep: async (ms) => { waits.push(ms); clock += ms; },
    onRetry: (ms) => retries.push(ms),
  });
  return { search, calls, waits, retries };
}

const paced = harness([]);
await Promise.all(Array.from({ length: 12 }, (_, i) => paced.search(`query-${i}`, { limit: 12 })));
assert.equal(paced.calls.length, 12);
assert.equal(paced.calls[11].query, 'query-11');
for (let i = 1; i < paced.calls.length; i += 1) {
  assert.equal(paced.calls[i].at - paced.calls[i - 1].at, 6500);
}
assert.equal(paced.calls[10].at - paced.calls[0].at, 65000);

const limited = harness([
  Object.assign(new Error('Rate limit exceeded. Please retry after 53s'), { statusCode: 429 }),
  { web: [{ url: 'https://example.com/offer' }] },
]);
const result = await limited.search('same query', { limit: 12 });
assert.equal(result.web.length, 1);
assert.deepEqual(limited.waits, [54000]);
assert.deepEqual(limited.retries, [54000]);
assert.equal(limited.calls[1].query, limited.calls[0].query);
assert.deepEqual(limited.calls[1].params, limited.calls[0].params);

const headers = harness([Object.assign(new Error('Too many requests'), {
  statusCode: 429, response: { headers: new Headers({ 'Retry-After': '60' }) },
})]);
await headers.search('headers');
assert.deepEqual(headers.waits, [61000]);

const dated = harness([Object.assign(new Error('Rate limit'), {
  statusCode: 429, response: { headers: { 'retry-after': new Date(130000).toUTCString() } },
})]);
await dated.search('date header');
assert.deepEqual(dated.waits, [31000]);

const body = harness([{ success: false, error: 'Rate limit exceeded; retry after 10s', statusCode: 429 }]);
await body.search('body failure');
assert.deepEqual(body.waits, [11000]);

for (const error of [
  Object.assign(new Error('Unauthorized'), { statusCode: 401 }),
  Object.assign(new Error('Payment required'), { statusCode: 402 }),
  Object.assign(new Error('Forbidden'), { statusCode: 403 }),
  Object.assign(new Error('Insufficient credits (rate limit)'), { statusCode: 429 }),
  new Error('Network failure'),
  new Error('Rate limit; retry after 120s'),
]) {
  const test = harness([error]);
  await assert.rejects(test.search('no repeated spend'), error);
  assert.equal(test.calls.length, 1);
  assert.equal(test.waits.length, 0);
  await test.search('later query still runs');
  assert.equal(test.calls.length, 2, 'a rejected request must not poison the queue');
}

const repeated = harness([new Error('Rate limit'), new Error('Rate limit')]);
await assert.rejects(repeated.search('bounded'), /Rate limit/);
assert.equal(repeated.calls.length, 2);
assert.deepEqual(repeated.waits, [61000]);

console.log('Firecrawl paced search and bounded retry tests passed.');

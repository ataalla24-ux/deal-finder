import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

test('merchant review and Instagram extraction preserve heuristics without unbudgeted model requests', async t => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    throw new Error('Unexpected outbound request');
  });
  t.mock.method(console, 'log', () => {});
  const legacyEnvironment = {
    OPENAI_API_KEY: 'unused-test-credential',
    OPENAI_MODEL: 'unbudgeted-test-model',
  };
  const cases = [
    {
      path: '/api/deals/review',
      payload: { deals: [{ id: 'fixture-review', brand: 'OMV', title: 'Gratis Kaffee', category: 'fluege',
        description: 'Gratis Kaffee in Wien', location: 'Wien' }] },
      keys: ['fixes', 'issues', 'ok', 'removedDealIDs'],
    },
    {
      path: '/api/instagram-agent/deals',
      payload: { media: [{ id: 'fixture-post', caption: 'Gratis Burger in Wien, solange der Vorrat reicht.',
        permalink: 'https://www.instagram.com/p/fixture/', timestamp: new Date().toISOString(), username: 'fixture' }] },
      keys: ['agent', 'deals', 'generatedAt', 'ok'],
    },
  ];
  for (const { path, payload, keys } of cases) {
    const call = async env => {
      const response = await worker.fetch(new Request(`https://worker.test${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      }), env);
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.deepEqual(Object.keys(result).sort(), keys);
      return result;
    };
    const ordinary = await call({});
    const configured = await call(legacyEnvironment);
    assert.equal(requests, 0, path);
    delete ordinary.generatedAt;
    delete configured.generatedAt;
    assert.deepEqual(configured, ordinary);
    if (path.endsWith('/deals')) assert.equal(configured.deals.length, 1);
  }
});

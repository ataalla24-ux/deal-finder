import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { verifyModelRouting } from './check-ai-model-routing.mjs';
import { loadAiCreditPolicy } from '../scraper/ai-credit-budget.js';

test('a selected model probe performs one complete structured call and checks the active profile', async () => {
  const previous = process.env.FREEFINDER_ASTRA_ENRICHMENT;
  const clock = Date.now;
  const now = new Date(Date.parse(loadAiCreditPolicy().astraEnrichment.notBefore) + 600_000);
  Date.now = () => +now;
  try {
    for (const variant of ['sol', 'astra']) {
      process.env.FREEFINDER_ASTRA_ENRICHMENT = variant === 'astra' ? '1' : '0';
      let calls = 0;
      const response = await verifyModelRouting({ variant, apiKey: 'offline-fixture', now, request: async (url, init) => {
        calls++;
        assert.equal(url, 'https://api.openai.com/v1/chat/completions');
        const body = JSON.parse(init.body);
        assert.equal(body.model, `gpt-6.2-${variant}`);
        assert.equal(body.response_format.json_schema.strict, true);
        assert.equal(body.temperature, undefined);
        assert.equal(JSON.parse(body.messages[1].content).length, 3);
        return Response.json({ model: body.model, choices: [{ finish_reason: 'stop',
          message: { content: JSON.stringify({ 'future-coffee': true, 'business-software': false, 'expired-opening': false }) } }],
        usage: { total_tokens: 100 } });
      } });
      assert.equal(calls, 1, 'model-specific verification never starts the full collector probe');
      assert.equal(response.model, `gpt-6.2-${variant}`);
      assert.equal(response.qualityCasesPassed, 3);
      await assert.rejects(verifyModelRouting({ variant: variant === 'sol' ? 'astra' : 'sol',
        apiKey: 'offline-fixture', request: () => assert.fail('mismatched profile must not call the API') }), /profile mismatch/);
    }
  } finally {
    Date.now = clock;
    if (previous === undefined) delete process.env.FREEFINDER_ASTRA_ENRICHMENT;
    else process.env.FREEFINDER_ASTRA_ENRICHMENT = previous;
  }
});

test('the model probe rejects incomplete, wrong-model and missing-usage responses', async () => {
  const previous = process.env.FREEFINDER_ASTRA_ENRICHMENT;
  process.env.FREEFINDER_ASTRA_ENRICHMENT = '0';
  const correct = { model: 'gpt-6.2-sol', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
    'future-coffee': true, 'business-software': false, 'expired-opening': false,
  }) } }], usage: { total_tokens: 100 } };
  try {
    for (const body of [{ ...correct, model: 'gpt-6.1-sol' }, { ...correct, usage: {} },
      { ...correct, choices: [{ ...correct.choices[0], finish_reason: 'length' }] }]) {
      await assert.rejects(verifyModelRouting({ variant: 'sol', apiKey: 'offline-fixture', request: async () => Response.json(body) }));
    }
    const invalid = spawnSync(process.execPath, ['scripts/check-ai-model-routing.mjs', '--verify-model', 'legacy'], {
      encoding: 'utf8', env: { ...process.env, OPENAI_API_KEY: '' },
    });
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /Usage:/);
  } finally {
    if (previous === undefined) delete process.env.FREEFINDER_ASTRA_ENRICHMENT;
    else process.env.FREEFINDER_ASTRA_ENRICHMENT = previous;
  }
});

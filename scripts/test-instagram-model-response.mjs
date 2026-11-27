import test from 'node:test';
import assert from 'node:assert/strict';
import { cachedClassificationCandidates, checkInstagramModelResponse } from './check-instagram-model-response.mjs';

const now = new Date('2026-11-27T20:00:00Z');
const row = (id, date = '2026-11-27T10:00:00Z') => ({ id, url: `https://www.instagram.com/p/${id}/`,
  title: 'Originales Angebot', description: 'Originale vollständige Aktionsbedingungen.', qualityScore: 80,
  pubDate: date, sourcePublishedAt: date, sourcePublishedAtSource: 'instagram-graph-timestamp',
  pubDateSource: 'instagram-graph-timestamp' });

test('diagnostic uses one unique fresh batch without changing saved offers or publishing', async () => {
  const payload = { deals: [row('Old', '2026-11-10T10:00:00Z'), row('Future', '2026-11-28T10:00:00Z'),
    row('A'), row('A'), row('B'), row('C'), row('D'), row('E')] };
  const before = structuredClone(payload);
  assert.deepEqual(cachedClassificationCandidates(payload, now).map(candidate => candidate.sourceDeal.id), ['A', 'B', 'C', 'D']);
  let calls = 0;
  const report = await checkInstagramModelResponse({ payload, now,
    env: { INSTAGRAM_MODEL_DIAGNOSTIC: '1', OPENAI_API_KEY: 'fixture-only' }, classify: async (candidates, options) => {
      calls++;
      assert.equal(candidates.length, 4);
      assert.equal(options.background, true);
      candidates[0].sourceDeal.title = 'Changed in memory';
      return { deals: [], health: { status: 'ok' }, usage: { inputTokens: 40, outputTokens: 60, totalTokens: 100 } };
    } });
  assert.equal(calls, 1);
  assert.equal(report.status, 'success');
  assert.equal(report.publishedDeals, 0);
  assert.equal(report.sourceReads, 0);
  assert.deepEqual(payload, before);
});

test('diagnostic refuses implicit execution and reports only sanitized failure metadata', async () => {
  const payload = { deals: [row('A')] };
  await assert.rejects(checkInstagramModelResponse({ payload, env: {}, classify: () => assert.fail('no dispatch') }));
  const report = await checkInstagramModelResponse({ payload, now,
    env: { INSTAGRAM_MODEL_DIAGNOSTIC: '1', OPENAI_API_KEY: 'fixture-only' }, classify: async () => ({
      deals: [], errors: ['secret'], health: { status: 'unavailable', code: 'secret', budgetReason: 'secret' }, usage: {},
    }) });
  assert.equal(report.status, 'unavailable');
  assert(!JSON.stringify(report).includes('secret'));
});

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkInstagramAiAccess } from './check-instagram-ai-access.mjs';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'instagram-ai-access-'));
const statePath = path.join(dir, 'state.json');
const state = {
  seen: { existing: '2026-09-20' },
  adLibraryFailure: { code: 10 },
  mediaEvidence: {
    failed: { aiError: 'OpenAI HTTP 429', aiFailure: { haltBatch: true } },
    deferred: { aiPending: true },
    accepted: { ai: { isDeal: true } },
    rejected: { ai: { isDeal: false } },
    ocrOnly: { ocrText: 'OCR evidence' },
  },
};
const env = { OPENAI_API_KEY: 'test-placeholder' };
const success = async (input, config) => {
  assert.match(input.visionImages[0], /^data:image\/png;base64,/);
  assert.equal(config.mediaLlmEnabled, true);
  return { isDeal: true, confidence: 0.95, exclusion: 'none', offerText: 'Gratis Kaffee', locationText: 'Wien', usage: { totalTokens: 10 } };
};
try {
  await fs.writeFile(statePath, JSON.stringify(state));
  await assert.rejects(checkInstagramAiAccess({ env: {}, classify: success }), /key is missing/);
  await assert.rejects(checkInstagramAiAccess({ env, recover: true, statePath, classify: async () => {
    throw Object.assign(new Error('PRIVATE PROVIDER DETAIL'), { status: 429, code: 'insufficient_quota' });
  } }), (error) => /insufficient_quota/.test(error.message) && !/PRIVATE/.test(error.message));
  assert.deepEqual(JSON.parse(await fs.readFile(statePath, 'utf8')), state, 'failed probe preserves state');
  await assert.rejects(checkInstagramAiAccess({ env, recover: true, statePath, classify: async () => ({ isDeal: false }) }), /missing structured/);
  assert.deepEqual(JSON.parse(await fs.readFile(statePath, 'utf8')), state);
  const readOnly = await checkInstagramAiAccess({ env, statePath, classify: success });
  assert.equal(readOnly.recoveredEntries, 0);
  assert.deepEqual(JSON.parse(await fs.readFile(statePath, 'utf8')), state, 'default check is read-only');
  const negative = await checkInstagramAiAccess({ env, statePath, classify: async (...args) => ({ ...await success(...args), isDeal: false }) });
  assert.equal(negative.status, 'ok', 'a valid rejection is still a successful provider access check');
  assert.equal(negative.syntheticDealDetected, false);
  const recovered = await checkInstagramAiAccess({ env, recover: true, statePath, classify: success });
  assert.equal(recovered.recoveredEntries, 2);
  const next = JSON.parse(await fs.readFile(statePath, 'utf8'));
  assert.deepEqual(next.seen, state.seen);
  assert.deepEqual(next.adLibraryFailure, state.adLibraryFailure);
  assert.deepEqual(Object.keys(next.mediaEvidence), ['accepted', 'rejected', 'ocrOnly']);
  assert.equal((await checkInstagramAiAccess({ env, recover: true, statePath, classify: success })).recoveredEntries, 0);
  console.log('Instagram AI access: read-only default, safe failures and selective recovery passed');
} finally {
  await fs.rm(dir, { recursive: true, force: true });
}

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { createCardEditor } from '../scraper/deal-card-editor.js';
import { retryQueuedEditorial } from '../scraper/card-editor-retry.js';

const deal = { id: 'draft', title: 'Gemeinsam schmeckt es besser', description: 'Zweite Pizza gratis.',
  slackTs: '2', slackThreadTs: '1', cardEditorial: { version: 1 } };
const forbidden = () => assert.fail('disabled title editing must have no side effects');

test('disabled drafts preserve input and never use AI, cache, clock or callbacks', async () => {
  const cache = { existing: { proposal: { title: 'Cached title' } } };
  const before = structuredClone(cache);
  for (const enabled of [false, 'false', '0', null]) {
    const edit = createCardEditor({ enabled, apiKey: 'mock-configured-key', request: forbidden,
      cache, onCache: forbidden, clock: forbidden });
    assert.equal(await edit(deal), deal);
    assert.equal(await edit(deal), deal);
  }
  assert.deepEqual(cache, before);
});

test('disabled retries do not inspect Slack, call AI, update messages or persist queue', async () => {
  const queue = [deal];
  const result = await retryQueuedEditorial(queue, { enabled: false, editCard: forbidden,
    isUntouched: forbidden, updateMessage: forbidden, persist: forbidden });
  assert.deepEqual(result, queue);
  assert.equal(result[0], deal);
});

test('default is disabled and only explicit 1 enables the production switch', async () => {
  const old = process.env.DEAL_CARD_EDITOR_ENABLED;
  try {
    for (const value of [undefined, '0', 'false', 'true', 'invalid']) {
      if (value === undefined) delete process.env.DEAL_CARD_EDITOR_ENABLED;
      else process.env.DEAL_CARD_EDITOR_ENABLED = value;
      assert.equal(await createCardEditor({ apiKey: 'mock-configured-key', request: forbidden, clock: forbidden })(deal), deal);
      assert.deepEqual(await retryQueuedEditorial([deal], { editCard: forbidden,
        isUntouched: forbidden, updateMessage: forbidden, persist: forbidden }), [deal]);
    }
    process.env.DEAL_CARD_EDITOR_ENABLED = '1';
    const enabled = await createCardEditor({ apiKey: '', request: forbidden })(deal);
    assert.equal(enabled.cardEditorial.status, 'no-api-key');
  } finally {
    if (old === undefined) delete process.env.DEAL_CARD_EDITOR_ENABLED;
    else process.env.DEAL_CARD_EDITOR_ENABLED = old;
  }
});

test('production delivery drops the OpenAI secret and disables title editing only', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/daily-digest.yml', import.meta.url), 'utf8');
  const delivery = workflow.split('- name: Deliver validated new deals to Slack')[1].split('- name: Mark posted community')[0];
  assert.match(delivery, /DEAL_CARD_EDITOR_ENABLED: ['"]0['"]/);
  assert.doesNotMatch(delivery, /OPENAI_API_KEY/);
  assert.match(delivery, /SLACK_BOT_TOKEN/);
  assert.match(delivery, /run: node scraper\/slack-notify\.js/);
  const source = fs.readFileSync(new URL('../scraper/slack-notify.js', import.meta.url), 'utf8');
  assert.match(source, /const editorialEnabled = process\.env\.DEAL_CARD_EDITOR_ENABLED === '1'/);
  assert.equal((source.match(/enabled: editorialEnabled/g) || []).length, 2);
});

test('manual paid diagnostic fails closed before credentials or network unless explicitly enabled', () => {
  const result = spawnSync(process.execPath, ['scripts/check-card-editor-live.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, DEAL_CARD_EDITOR_ENABLED: '0', OPENAI_API_KEY: '' }, encoding: 'utf8', timeout: 5000,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Paid card-editor requests are disabled/);
  assert.doesNotMatch(result.stderr, /Configure the existing OPENAI_API_KEY/);
  const workflow = fs.readFileSync(new URL('../.github/workflows/card-editor-check.yml', import.meta.url), 'utf8');
  assert.match(workflow, /DEAL_CARD_EDITOR_ENABLED: '0'/);
  assert.match(workflow, /if: \$\{\{ env\.DEAL_CARD_EDITOR_ENABLED == '1' \}\}/);
});

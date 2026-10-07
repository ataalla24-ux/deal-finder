import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retryQueuedEditorial } from '../scraper/card-editor-retry.js';

const deal = { id: 'a', title: 'old', slackTs: '2', slackThreadTs: '1', cardEditorial: { version: 1 } };
function dependencies(overrides = {}) {
  const events = [];
  return { events, editCard: async d => ({ ...d, title: 'new' }),
    isUntouched: async () => true, updateMessage: async d => { events.push(['update', d.title]); return true; },
    persist: async ds => events.push(['persist', ds[0].title]), ...overrides };
}
test('retry updates existing message then persists same complete proposal', async () => {
  const deps = dependencies();
  const result = await retryQueuedEditorial([deal], deps);
  assert.equal(result[0].title, 'new');
  assert.deepEqual(deps.events, [['update', 'new'], ['persist', 'new']]);
  assert.equal(deal.title, 'old');
});
test('human changes during model call prevent any update', async () => {
  let reads = 0;
  const deps = dependencies({ isUntouched: async () => ++reads === 1 });
  assert.deepEqual(await retryQueuedEditorial([deal], deps), [deal]);
  assert.deepEqual(deps.events, []);
});
test('approved, live, blocked and manually edited cards are never retried', async () => {
  for (const patch of [{ approvedAt: 'today' }, { slackFormEditTs: '123' }, { editedInSlack: true },
    { liveEditedAt: 'today' }, { approvalBlock: 'review' }, { slackTs: '' }]) {
    const input = { ...deal, ...patch };
    const deps = dependencies({ isUntouched: () => { assert.fail('should skip guard'); } });
    assert.deepEqual(await retryQueuedEditorial([input], deps), [input]);
    assert.deepEqual(deps.events, []);
  }
  const deps = dependencies({ liveIds: new Set(['a']) });
  assert.deepEqual(await retryQueuedEditorial([deal], deps), [deal]);
  assert.deepEqual(deps.events, []);
});
test('Slack failures retain old queue, persistence failures fail visibly', async () => {
  for (const override of [{ isUntouched: async () => false }, { isUntouched: async () => { throw Error('403'); } },
    { updateMessage: async () => false }, { editCard: async () => { throw Error('timeout'); } }]) {
    const deps = dependencies(override);
    assert.deepEqual(await retryQueuedEditorial([deal], deps), [deal]);
    assert.deepEqual(deps.events, []);
  }
  await assert.rejects(retryQueuedEditorial([deal], dependencies({ persist: () => { throw Error('disk'); } })), /disk/);
});
test('retry network work and model attempts are bounded independently', async () => {
  let calls = 0;
  let checks = 0;
  const list = Array.from({ length: 20 }, (_, i) => ({ ...deal, id: `${i}` }));
  const deps = dependencies({ isUntouched: async () => { checks++; return false; }, editCard: async d => { calls++; return d; } });
  await retryQueuedEditorial(list, { ...deps, maxChecks: 4 });
  assert.equal(checks, 4); assert.equal(calls, 0);
  await retryQueuedEditorial(list, { ...deps, isUntouched: async () => true, maxDeals: 3 });
  assert.equal(calls, 3);
});

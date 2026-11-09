import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { COMMUNITY_RETENTION_MS, activeCommunityRecord, communityExpiry, dueCommunitySlackReceipts,
  purgeExpiredCommunitySubmissions, updateCommunityReviewScope } from '../src/community-review-state.js';
import { privateCommunityRow, reviewDiff } from '../../scripts/community-private-state.mjs';

function fixture() {
  const values = new Map(), expiry = new Map();
  const one = id => JSON.parse(values.get(id) || 'null');
  const kv = {
    get: async key => Array.isArray(key) ? new Map(key.map(id => [id, one(id)])) : one(key),
    list: async ({ prefix, cursor }) => {
      const keys = [...values.keys()].filter(name => name.startsWith(prefix));
      const from = Number(cursor || 0);
      return { keys: keys.slice(from, from + 2).map(name => ({ name })),
        list_complete: from + 2 >= keys.length, cursor: String(from + 2) };
    },
    put: async (key, value, options) => { values.set(key, value); expiry.set(key, options?.expiration); },
    delete: async key => { values.delete(key); },
  };
  const env = { COMMUNITY_SYNC_TOKEN: 'internal-only', REFERRAL_KV: kv };
  const call = (scope, input, authorized = true) => worker.fetch(new Request(
    `https://test/api/deals/submissions/admin/review-state?scope=${scope}`, {
      method: input ? 'POST' : 'GET',
      headers: authorized ? { authorization: 'Bearer internal-only' } : {},
      body: input ? JSON.stringify(input) : undefined,
    }), env);
  return { kv, values, expiry, call };
}

test('private intake, queue, and cleanup are inaccessible without auth', async () => {
  const { call, values } = fixture();
  for (const scope of ['queue', 'intake', 'receipts']) {
    assert.equal((await call(scope, null, false)).status, 401);
    assert.equal((await call(scope, { upserts: [], removes: [] }, false)).status, 401);
  }
  assert.equal(values.size, 0);
  assert.equal((await call('queue')).headers.get('cache-control'), 'no-store');
});

test('age is measured from submission, not edit, with no resurrection', async () => {
  const { kv, expiry, call } = fixture();
  const now = Date.now();
  const row = { id: 'community:a', submittedAt: now - 86400000, title: 'Internal only',
    slackTs: '1793990001.123456', slackThreadTs: '1793990000.123456' };
  assert.equal(communityExpiry(row), row.submittedAt + COMMUNITY_RETENTION_MS);
  const key = 'community:review:queue:a';
  for (const next of [row, { ...row, title: 'Updated' }]) {
    assert.equal((await call('queue', { upserts: [next], removes: [] })).status, 200);
    assert.equal(expiry.get(key), Math.floor(communityExpiry(row) / 1000));
  }
  assert.equal((await (await call('queue')).json()).deals[0].title, 'Updated');
  assert.equal(activeCommunityRecord(row, communityExpiry(row)), false);
  assert.equal(await updateCommunityReviewScope(kv, 'queue', { upserts: [row], removes: [] }, communityExpiry(row)), 0);
  assert.deepEqual(await dueCommunitySlackReceipts(kv, now), []);
  assert.deepEqual(await dueCommunitySlackReceipts(kv, communityExpiry(row)), [row.slackTs]);
  assert.deepEqual(reviewDiff([row], [row], communityExpiry(row)).removes, [row.id]);
  assert.equal(privateCommunityRow(row), true);
  assert.equal(privateCommunityRow({ id: 'non-community', title: 'Ordinary deal' }), false);
});

test('legacy sweep handles pagination and only deletes timestamped expired records', async () => {
  const { kv, values } = fixture();
  const now = Date.now();
  for (const [id, offset] of [['a', 0], ['b', 20], ['c', 15], ['d', 2]]) {
    values.set('deal:submission:' + id, JSON.stringify({ id, submittedAt: now - offset * 86400000 }));
  }
  assert.equal(await purgeExpiredCommunitySubmissions(kv, now), 2);
  assert.deepEqual([...values.keys()].sort(), ['deal:submission:a', 'deal:submission:d']);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSlackMessage, loadRecentlySeenPostKeys, normalizeSeenPostCache } from '../scraper/slack-notify.js';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'slack-delivery-state-'));
const cachePath = path.join(directory, 'seen.json');
const now = new Date('2026-11-05T20:00:00Z');
const before = new Date(+now - 20 * 60000).toISOString();
const originalFetch = globalThis.fetch;
function seed(extra = {}) {
  fs.writeFileSync(cachePath, JSON.stringify({ generatedAt: before, suppressionDays: 30,
    seenPostKeys: ['instagram:p:OldPost'], ...extra }));
}
try {
  seed();
  let reads = 0;
  const keys = await loadRecentlySeenPostKeys({ now, cachePath,
    listThreads: async (days, options) => {
      assert.equal(days, 30);
      assert.equal(options.oldest, '2026-11-05T18:40:00.000Z');
      return ['new-thread'];
    },
    readThread: async () => {
      reads++;
      return [{ ts: '1.1', text: buildSlackMessage({ id: 'new', title: 'Gratis Kaffee',
        url: 'https://www.instagram.com/p/NewPost/' }, 1) }];
    },
  });
  assert.equal(reads, 1);
  assert.ok(keys.has('instagram:p:OldPost') && keys.has('instagram:p:NewPost'));
  const saved = JSON.parse(fs.readFileSync(cachePath));
  assert.equal(saved.version, 2);
  assert.equal(saved.historyScannedAt, now.toISOString());
  assert.equal(saved.seenAtByKey['instagram:p:OldPost'], before, 'Migration must not refresh old key age');

  seed();
  const retained = await loadRecentlySeenPostKeys({ now, cachePath,
    listThreads: async () => ['partial', 'failed'],
    readThread: async thread => {
      if (thread === 'failed') throw new Error('rate limit');
      return [{ ts: '2.1', text: buildSlackMessage({ id: 'partial', title: 'Kaffee', url: 'https://www.instagram.com/p/Partial/' }, 1) }];
    },
  });
  assert.deepEqual([...retained], ['instagram:p:OldPost', 'instagram:p:Partial'], 'Confirmed earlier threads must still suppress repeat sends');
  const partialBytes = fs.readFileSync(cachePath, 'utf8');
  const partial = JSON.parse(partialBytes);
  assert.equal(partial.historyScannedAt, before, 'Partial reads must not advance history cursor');
  assert.equal(partial.generatedAt, before, 'Partial reads must not mark incomplete history fresh');
  assert.ok(partial.seenPostKeys.includes('instagram:p:Partial'), 'Confirmed deliveries survive the next process');

  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return { status: 429, headers: new Headers({ 'retry-after': '86400' }), json: async () => ({ ok: false, error: 'ratelimited' }) };
  };
  await loadRecentlySeenPostKeys({ now, cachePath });
  assert.equal(calls, 1, 'Optional history sync must yield immediately instead of blocking approval queue on 429');
  assert.equal(fs.readFileSync(cachePath, 'utf8'), partialBytes);
  await assert.rejects(loadRecentlySeenPostKeys({ now, cachePath: path.join(directory, 'missing.json') }), /ratelimited/);

  const expired = normalizeSeenPostCache({ generatedAt: now.toISOString(), suppressionDays: 30,
    seenPostKeys: ['old', 'new'], seenAtByKey: { old: '2026-09-01T00:00:00Z', new: before } }, { now });
  assert.deepEqual([...expired.keys], ['new'], 'Incremental refresh must not indefinitely extend post suppression');
  console.log('Slack incremental history, Unicode delivery reuse, partial failure, HTTP429 yielding and key expiry passed');
} finally {
  globalThis.fetch = originalFetch;
  fs.rmSync(directory, { recursive: true, force: true });
}

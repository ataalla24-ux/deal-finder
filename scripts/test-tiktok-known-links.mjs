import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readKnownTikTokLinks } from '../scraper/tiktok-known-links.js';

const now = new Date('2026-11-23T16:00:00Z');
const discoveredAt = now.toISOString();
const baseId = 7700000000000000000n;
function lead(n, changes = {}) {
  return {
    id: `g2-${n}`,
    url: `https://www.tiktok.com/@food.at/video/${baseId + BigInt(n)}`,
    discoveredAt, ...changes,
  };
}

function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tiktok-links-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const write = (file, data) => writeFileSync(path.join(dir, file + '.json'), JSON.stringify(data));
  for (const file of ['deals', 'deals-pending-all', 'deals-pending-tiktok', 'deals-pending-tiktok-browser',
    'deals-pending-gastro2', 'deals-pending-firecrawl4']) write(file, { deals: [] });
  write('deal-review-feedback', { events: [] });
  write('slack-seen-posts', { seenPostKeys: [] });
  write('sent-deal-ids', {});
  return { dir, write, select: () => readKnownTikTokLinks(dir, { now }) };
}

test('accepts only exact canonical targets from the two lead queues and returns URLs alone', t => {
  const f = fixture(t);
  const good = lead(1, { caption: 'unverified copy', creator: 'unverified author', sourcePublishedAt: '2020-01-01' });
  const bad = [
    good.url.replace('https:', 'http:'), good.url.replace('www.', 'm.'), good.url.replace('www.', 'vm.'),
    good.url.replace('www.', 'test@www.'), good.url.replace('.com/', '.com.evil.example/'),
    good.url.replace('.com/', '.com:443/'), good.url + '?share=1', good.url + '/private',
    good.url + '#timestamp', good.url + '\n', good.url.replace('/video/', '/photos/'),
    good.url.replace('@food.at/', '%40food.at/'), 'https://vm.tiktok.com/Z123abc',
    'https://example.org/redirect?url=' + encodeURIComponent(good.url),
  ];
  f.write('deals-pending-gastro2', { deals: bad.map(url => ({ url, discoveredAt })) });
  assert.deepEqual(f.select(), []);
  f.write('deals-pending-gastro2', { deals: [good] });
  f.write('deals-pending-firecrawl4', { deals: [lead(2), { description: lead(3).url, discoveredAt }] });
  f.write('deals-pending-firecrawl2', { deals: [lead(4)] });
  assert.deepEqual(f.select(), [lead(2).url, good.url]);
});

test('uses only the recorded discovery instant inside the last seven days, including the boundary', t => {
  const f = fixture(t);
  f.write('deals-pending-firecrawl4', { deals: [
    lead(1, { discoveredAt: '2026-11-16T17:00:00+01:00' }),
    lead(2, { discoveredAt: '2026-11-16T15:59:59.999Z' }),
    lead(3, { discoveredAt: '2026-11-23T16:00:00.001Z' }),
    lead(4, { discoveredAt: undefined, pubDate: discoveredAt, reportedPostDate: discoveredAt }),
    lead(5, { discoveredAt: '2026-11-23' }), lead(6, { discoveredAt: 'bad' }), null,
  ] });
  assert.deepEqual(f.select(), [lead(1).url]);
});

test('deduplicates by video identity and collector ID across feedback, seen, live and both outboxes', t => {
  const f = fixture(t);
  f.write('deals-pending-gastro2', { deals: Array.from({ length: 10 }, (_, i) => lead(i + 1)) });
  f.write('deals-pending-firecrawl4', { deals: [
    lead(2, { id: 'fc4-reviewed', discoveredAt: '2026-01-01T00:00:00Z' }),
    lead(9, { id: 'fc4-unseen', url: lead(9).url.replace('food.at', 'renamed') }),
  ] });
  f.write('slack-seen-posts', { seenPostKeys: [`tiktok:video:${baseId + 1n}`, lead(8).url + '?share=1'] });
  f.write('deal-review-feedback', { events: [{ dealId: 'fc4-reviewed' }, { key: `tiktok:video:${baseId + 3n}` }] });
  f.write('deals', { deals: [{ id: lead(4).id }] });
  f.write('deals-pending-all', { deals: [{ url: lead(5).url.replace('food.at', 'before') }] });
  f.write('deals-pending-tiktok', { deals: [{ url: lead(6).url }] });
  f.write('deals-pending-tiktok-browser', { deals: [{ postUrl: lead(7).url.replace('www.', 'm.') + '/' }] });
  f.write('sent-deal-ids', { [lead(10).id]: +now });
  assert.deepEqual(f.select(), [lead(9).url]);
});

test('keeps the fallback bounded and deterministic across reordered queues', t => {
  const f = fixture(t);
  const rows = Array.from({ length: 27 }, (_, i) => lead(i + 1));
  const expected = rows.slice(-20).reverse().map(row => row.url);
  f.write('deals-pending-gastro2', { deals: rows });
  assert.deepEqual(f.select(), expected);
  f.write('deals-pending-gastro2', { deals: rows.reverse() });
  assert.deepEqual(f.select(), expected);
});

test('excludes scanner self-accounts before budget selection, using the video URL owner', t => {
  const f = fixture(t);
  const from = (id, handle) => lead(id, { url: lead(id).url.replace('food.at', handle), ownerUsername: 'somebody_else' });
  const external = from(1, 'freefinderat_guest');
  f.write('deals-pending-firecrawl4', { deals: [external, from(2, 'FreeFinder'), from(3, 'freefinderat')] });
  f.write('deals-pending-gastro2', { deals: [
    from(4, 'freefinderwien'), from(5, 'Free_Finder.Wien'), from(6, 'freefinder.at'),
    from(6, 'otherhandle'),
  ] });
  assert.deepEqual(f.select(), [external.url]);
});

test('missing lead input leaves the other eligible, unreadable suppression state skips the fallback', t => {
  const f = fixture(t);
  f.write('deals-pending-firecrawl4', { deals: [lead(1)] });
  rmSync(path.join(f.dir, 'deals-pending-gastro2.json'));
  assert.deepEqual(f.select(), [lead(1).url]);
  writeFileSync(path.join(f.dir, 'slack-seen-posts.json'), '{');
  assert.deepEqual(f.select(), []);
  f.write('slack-seen-posts', { seenPostKeys: [] });
  f.write('deals', { deals: 'unavailable' });
  assert.deepEqual(f.select(), []);
});

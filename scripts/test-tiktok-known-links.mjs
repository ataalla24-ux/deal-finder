import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readKnownTikTokLinks, retainUnattemptedTikTokIndexLeads, selectTikTokIndexedLeads } from '../scraper/tiktok-known-links.js';

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
  write('deal-moderation', {});
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

test('suppresses moderated and previously observed old videos even on rediscovery', t => {
  const f = fixture(t);
  f.write('deal-moderation', { hiddenDeals: [{ url: lead(1).url }] });
  f.write('deals-pending-gastro2', { deals: [lead(1), lead(2), lead(3)] });
  f.write('deals-pending-firecrawl4', { deals: [lead(2, { discoveredAt: '2026-11-10T12:00:00Z' })] });
  assert.deepEqual(f.select(), [lead(3).url]);
});

test('keeps the first discovery and both index sources for a canonical video, without carrying index claims', t => {
  const { dir } = fixture(t);
  const firstSeenAt = '2026-11-22T18:00:00.000Z';
  const original = { url: lead(1).url, sources: ['tavily'], firstSeenAt,
    title: 'unverified index copy', publishedAt: '2026-11-23' };
  const alias = lead(1).url.replace('food.at', 'renamed');
  const { leads: selected, ready } = selectTikTokIndexedLeads(dir, { now, previous: [original],
    duckduckgo: [alias, lead(2).url], tavily: [original.url, lead(3).url] });
  assert.equal(ready, true);
  assert.deepEqual(selected, [
    { url: original.url, sources: ['duckduckgo', 'tavily'], firstSeenAt },
    { url: lead(3).url, sources: ['tavily'], firstSeenAt: discoveredAt },
    { url: lead(2).url, sources: ['duckduckgo'], firstSeenAt: discoveredAt },
  ]);
  assert.deepEqual(retainUnattemptedTikTokIndexLeads(selected, new Set([alias])), selected.slice(1));
  assert.deepEqual(retainUnattemptedTikTokIndexLeads(selected), selected);
});

test('a repeat index result cannot extend 48 hours or promote a malformed stored record', t => {
  const { dir } = fixture(t);
  const dates = ['2026-11-21T16:00:00.000Z', '2026-11-21T16:00:00.001Z',
    '2026-11-23T16:00:00.001Z', 'bad', '2026-11-23'];
  const previous = dates.map((firstSeenAt, i) => ({ url: lead(i + 1).url, sources: ['tavily'], firstSeenAt }));
  previous.push({ url: lead(6).url, sources: ['external'], firstSeenAt: discoveredAt }, null);
  const { leads: selected, ready } = selectTikTokIndexedLeads(dir, { now, previous, tavily: [lead(1).url, lead(2).url] });
  assert.equal(ready, true);
  assert.deepEqual(selected, [previous[1]]);
});

test('filters seen IDs, local moderation, aliases of self-account posts and known old hints before selection', t => {
  const { dir, write } = fixture(t);
  write('slack-seen-posts', { seenPostKeys: [lead(1).url] });
  write('deals', { deals: [{ url: lead(2).url + '?ref=abc' }] });
  write('deal-moderation', { hiddenDeals: [{ url: lead(3).url }] });
  write('deals-pending-firecrawl4', { deals: [lead(4, { discoveredAt: '2026-10-14T08:00:00Z' }),
    lead(5, { id: 'moderated-merchant' })] });
  write('deal-review-feedback', { events: [{ dealId: 'moderated-merchant' }] });
  const fresh = Array.from({ length: 7 }, (_, i) => lead(i + 1).url);
  const malformed = [fresh[6] + '?share=1', fresh[6].replace('https:', 'http:'),
    fresh[6].replace('www.', 'm.'), fresh[6] + '\n', fresh[6].replace('/@food.at/video/', '/explore/')];
  const { leads: selected, ready } = selectTikTokIndexedLeads(dir, { now, duckduckgo: [...fresh, ...malformed],
    tavily: [fresh[5].replace('food.at', 'Free_Finder.Wien')] });
  assert.equal(ready, true);
  assert.deepEqual(selected, [{ url: fresh[6], sources: ['duckduckgo'], firstSeenAt: discoveredAt }]);
});

test('limits saved unattempted videos after actual visits, preserving the current scan budget and source order', t => {
  const { dir } = fixture(t);
  const fresh = Array.from({ length: 135 }, (_, i) => lead(i + 10).url);
  const { leads: selected, ready } = selectTikTokIndexedLeads(dir, { now, duckduckgo: fresh });
  assert.equal(ready, true);
  assert.equal(selected.length, 135);
  assert.deepEqual(retainUnattemptedTikTokIndexLeads(selected, fresh.slice(0, 4)), selected.slice(4, 124));
  assert.deepEqual(selectTikTokIndexedLeads(dir, { now, previous: selected }), { ready: true, leads: selected.slice(0, 120) });
});

test('missing protections keep only sanitized previous leads queued and hold all visits until recovery', t => {
  const { dir, write } = fixture(t);
  const firstSeenAt = '2026-11-22T16:00:00.000Z';
  const valid = { url: lead(1).url, firstSeenAt, sources: ['duckduckgo'] };
  const previous = [{ ...valid, sources: ['untrusted', 'duckduckgo'], caption: 'drop' },
    { ...valid, url: lead(2).url, firstSeenAt: '2026-11-21T16:00:00.000Z' },
    { ...valid, url: lead(3).url + '?tracking=abc' }, { ...valid, url: lead(4).url.replace('food.at', 'freefinderat') },
    { ...valid, url: lead(5).url, firstSeenAt: [firstSeenAt] }];
  write('deals', { deals: 'unreadable' });
  let result = selectTikTokIndexedLeads(dir, { now, previous, tavily: [valid.url, lead(7).url] });
  assert.deepEqual(result, { ready: false, leads: [valid] });
  write('deals', { deals: [] });
  write('deal-moderation', { blockedUrls: 'invalid' });
  assert.deepEqual(selectTikTokIndexedLeads(dir, { now, previous: result.leads }), result);
  write('deal-moderation', {});
  rmSync(path.join(dir, 'sent-deal-ids.json'));
  assert.deepEqual(selectTikTokIndexedLeads(dir, { now, previous: result.leads }), result);
  write('sent-deal-ids', {});
  write('slack-seen-posts', { seenPostKeys: [valid.url] });
  result = selectTikTokIndexedLeads(dir, { now, previous: result.leads, tavily: [lead(7).url] });
  assert.deepEqual(result, { ready: true, leads: [{ url: lead(7).url, firstSeenAt: discoveredAt, sources: ['tavily'] }] });
});

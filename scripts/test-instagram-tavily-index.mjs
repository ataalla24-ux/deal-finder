import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildHeuristicDeal, enrichPreviews, enrichRenderedPreviews } from '../scraper/instagram-ai-agent.js';
import { createInstagramWebAccess } from '../scraper/instagram-web-access-policy.js';
import { getInstagramTavilyLeads, INSTAGRAM_TAVILY_SOURCE, readInstagramTavilyCache,
  selectInstagramTavilyProductionQuery, updateInstagramTavilyCache, writeInstagramTavilyCache } from '../scraper/instagram-tavily-index.js';

const day = 86_400_000;
const now = new Date('2026-11-27T22:30:00Z');
const indexedAt = new Date(+now - day).toISOString();
const url = 'https://www.instagram.com/reel/CafeWien123/';
const source = INSTAGRAM_TAVILY_SOURCE;
const cache = { version: 1, links: [{ url, source, indexedAt }] };

test('the cache stores only bounded canonical public links and their original index observation time', () => {
  const index = { attemptedQueries: 1, links: [url + '?igsh=sensitive-source-noise',
    'https://instagram.com/p/CafeWien123/', 'https://instagram.com/tv/CafeWien123/',
    'https://instagram.invalid/p/CafeWien123/', 'https://instagram.com/accounts/login/?next=/p/CafeWien123/',
    'https://instagram.com/p/BarWien123/'] };
  const result = updateInstagramTavilyCache(cache, { instagramIndex: index }, { now, probe: true });
  assert.equal(result.lastProbeAt, now.toISOString());
  assert.equal(result.links.length, 2);
  assert.deepEqual(result.links.at(-1), cache.links[0]);
  assert.deepEqual(result.links[0], { url: 'https://www.instagram.com/p/BarWien123/', source, indexedAt: now.toISOString() });
  assert.equal(getInstagramTavilyLeads(result, new Date(+now + 8 * day)).length, 0);
  assert.equal(getInstagramTavilyLeads(result, new Date(+now - 2 * day)).length, 0);
  const many = Array.from({ length: 35 }, (_, i) => ({ url: `https://www.instagram.com/p/CafeWien${i}/`, source, indexedAt }));
  assert.equal(getInstagramTavilyLeads({ links: many }, now).length, 20);
  assert.equal(updateInstagramTavilyCache(null, { instagramIndex: index }, { now }), null);
});

test('an interrupted cache replacement keeps the last committed links and retry state', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'instagram-tavily-index-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'state.json');
  const saved = { ...cache, nextRetryAt: new Date(+now + day).toISOString() };
  writeInstagramTavilyCache(file, saved);
  assert.throws(() => writeInstagramTavilyCache(file, { ...cache, links: [] }, { ...fs,
    renameSync() { throw new Error('interrupted replacement'); },
  }), /interrupted replacement/);
  assert.deepEqual(readInstagramTavilyCache(file), saved);
  assert.deepEqual(fs.readdirSync(dir), ['state.json']);
  fs.writeFileSync(file, JSON.stringify({ ...saved, nextRetryAt: 'invalid' }));
  assert.equal(readInstagramTavilyCache(file), null);
  fs.writeFileSync(file, '{malformed');
  assert.equal(readInstagramTavilyCache(file), null);
});

test('plan wrap and stale lead expiry leave the versioned cursor independent of observations', () => {
  let state = { ...cache, nextRetryAt: '', lastProbeAt: '2026-11-27T00:00:00.000Z' };
  const ids = [];
  for (let index = 0; index < 2; index++) {
    const selected = selectInstagramTavilyProductionQuery(state);
    ids.push(selected.id);
    state = updateInstagramTavilyCache(state, { instagramIndex: {
      attemptedQueries: 1, status: 'completed', reportedSearchCredits: 1,
      productionQueryId: selected.id, productionQueryPlanVersion: selected.version,
      nextProductionQueryCursor: selected.nextCursor, links: [],
    } }, { now });
  }
  assert.deepEqual(ids, ['vienna-bogo-restaurant-coffee', 'vienna-opening-benefits']);
  assert.equal(state.productionQueryCursor.nextTopicId, ids[0]);
  const otherDiagnostic = updateInstagramTavilyCache(state, {
    instagramIndex: { attemptedQueries: 1, links: [] },
  }, { now: new Date(+now + 8 * day), probe: true });
  assert.deepEqual(otherDiagnostic.links, []);
  assert.deepEqual(otherDiagnostic.productionQueryCursor, state.productionQueryCursor);
  assert.equal(otherDiagnostic.lastProbeAt, state.lastProbeAt);
});

test('invalid cursor metadata resets just the selector, while a malformed cooldown blocks the full cache', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'instagram-tavily-rotation-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'state.json');
  const persisted = { ...cache, nextRetryAt: '' };
  const initial = selectInstagramTavilyProductionQuery(persisted);
  for (const invalid of [null, {}, { version: 2, nextTopicId: initial.nextCursor.nextTopicId },
    { version: 1, nextTopicId: 'fictitious' }, { version: '1', nextTopicId: initial.nextCursor.nextTopicId }]) {
    fs.writeFileSync(file, JSON.stringify({ ...persisted, productionQueryCursor: invalid }));
    assert.deepEqual(readInstagramTavilyCache(file), persisted);
    assert.deepEqual(selectInstagramTavilyProductionQuery(readInstagramTavilyCache(file)), initial);
  }
  fs.writeFileSync(file, JSON.stringify({ ...persisted, nextRetryAt: 'invalid', productionQueryCursor: initial.nextCursor }));
  assert.equal(readInstagramTavilyCache(file), null);
  const advanced = { ...persisted, productionQueryCursor: initial.nextCursor };
  const repeat = updateInstagramTavilyCache(advanced, { instagramIndex: {
    attemptedQueries: 1, status: 'completed', reportedSearchCredits: 1,
    productionQueryId: initial.id, productionQueryPlanVersion: initial.version,
    nextProductionQueryCursor: initial.nextCursor,
  } }, { now });
  assert.deepEqual(repeat.productionQueryCursor, advanced.productionQueryCursor);
});

test('index leads cannot bypass Instagram preview/render pauses or act as dated offer proof', async () => {
  const retryAt = new Date(+now + day).toISOString();
  const access = createInstagramWebAccess({ now, previousReport: { webAccess: {
    all: { reason: 'http-429', nextRetryAt: retryAt },
  } } });
  const leads = getInstagramTavilyLeads(cache, now).map(({ url: target, source: provenance }) => ({
    url: target, source: provenance, reasons: [], score: 0,
  }));
  assert.equal(leads.length, 1);
  const previews = await enrichPreviews(leads, { access, enabled: true,
    fetchPreview: async () => assert.fail('no Instagram requests under a saved web pause') });
  assert.equal(previews.stats.attempted, 0);
  assert.equal(previews.stats.nextRetryAt, retryAt);
  const renders = await enrichRenderedPreviews(leads, { access, enabled: true,
    browserType: { launch: async () => assert.fail('no render alternate under a saved web pause') } });
  assert.equal(renders[0].nextRetryAt, retryAt);
  assert.equal(buildHeuristicDeal(leads[0]), null);
});

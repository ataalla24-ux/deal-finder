import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkInstagramFilterSearch, filterSearchCacheUpdate, loadInstagramFilterKnownPosts } from './check-instagram-filter-search.mjs';
import { buildInstagramTavilyQuery, INSTAGRAM_TAVILY_SOURCE } from '../scraper/instagram-tavily-index.js';

const now = new Date('2026-11-28T08:30:00Z');
const old = 'https://www.instagram.com/reel/DgKMgKnB387/';
const stale = 'https://www.instagram.com/reel/Df_mFWlNzPp/';
const newUrl = 'https://www.instagram.com/p/FreshCafe11/';
const cache = { version: 1, nextRetryAt: '', lastProbeAt: '2026-11-27T22:38:00.124Z', links: [
  { url: old, source: INSTAGRAM_TAVILY_SOURCE, indexedAt: '2026-11-27T22:59:32.890Z' },
  { url: stale, source: INSTAGRAM_TAVILY_SOURCE, indexedAt: '2026-11-01T14:00:00.000Z' },
] };
const credentials = { apiKey: 'offline-key', freePlanConfirmed: true, clock: () => now };
const account = { current_plan: 'Researcher', plan_limit: 1000, plan_usage: 400, paygo_usage: 0, paygo_limit: null };
const usage = options => Response.json({ account: { ...account, ...options }, key: { usage: 400, limit: null } });

test('one production-shaped cached query admits only unseen links to the cache and preserves previous dates and probe', async () => {
  const calls = [];
  const result = await checkInstagramFilterSearch({ ...credentials, cache,
    knownKeys: new Set(['instagram:PreviouslySeen11']),
    fetcher: async (url, request) => {
      calls.push([url, request.method]);
      assert.equal(request.redirect, 'error');
      assert.equal(request.credentials, 'omit');
      if (url.endsWith('/usage')) return usage();
      const body = JSON.parse(request.body);
      assert.equal(body.query, buildInstagramTavilyQuery(now));
      assert.equal(body.search_depth, 'basic');
      assert.equal(body.max_age_hours, -1);
      assert.equal(body.time_range, 'week');
      assert.deepEqual(body.include_domains, ['instagram.com']);
      assert.equal(body.include_raw_content, false);
      assert.equal(body.include_answer, false);
      assert.equal(body.auto_parameters, false);
      assert.equal(body.include_usage, true);
      return Response.json({ usage: { credits: 1 }, results: [
        { url: old }, { url: stale }, { url: 'https://instagram.com/reel/PreviouslySeen11/' },
        { url: newUrl + '?tracking=private', title: 'untrusted', content: 'untrusted' },
        { url: 'https://instagram.com/reel/FreshCafe11/' }, { url: 'https://instagram.invalid/p/FakeCafe11/' },
      ] });
    },
  });
  assert.deepEqual(calls, [['https://api.tavily.com/usage', 'GET'], ['https://api.tavily.com/search', 'POST']]);
  assert.equal(result.reportedSearchCredits, 1);
  assert.equal(result.canonicalLinks, 4);
  assert.equal(result.previouslyKnownLinks, 3);
  assert.equal(result.unseenLinks, 1);
  assert.doesNotMatch(JSON.stringify(result), /untrusted|tracking|offline-key/);
  const updated = filterSearchCacheUpdate(cache, result);
  assert.equal(updated.lastProbeAt, cache.lastProbeAt);
  assert.deepEqual(updated.links, [{ url: newUrl, source: INSTAGRAM_TAVILY_SOURCE, indexedAt: now.toISOString() }, cache.links[0]]);
});

test('existing shared holds and absent free-plan confirmation stop before any provider request', async () => {
  const fetcher = () => assert.fail('a guarded check must make no request');
  const retryAt = '2026-11-29T02:00:00.000Z';
  const paused = await checkInstagramFilterSearch({ ...credentials, previous: { nextRetryAt: retryAt },
    cache: { ...cache, nextRetryAt: '2026-11-29T00:00:00.000Z' }, fetcher });
  assert.equal(paused.status, 'cooldown');
  assert.equal(paused.nextRetryAt, retryAt);
  const sameHold = { ...cache, nextRetryAt: retryAt };
  const stillPaused = await checkInstagramFilterSearch({ ...credentials, cache: sameHold, fetcher });
  assert.equal(filterSearchCacheUpdate(sameHold, stillPaused), null, 'the persisted hold stays unchanged');
  assert.equal(filterSearchCacheUpdate(cache, paused).nextRetryAt, retryAt, 'a longer peer hold is preserved for both lanes');
  assert.equal((await checkInstagramFilterSearch({ ...credentials, cache, freePlanConfirmed: false, fetcher })).status, 'free-plan-unconfirmed');
  assert.equal((await checkInstagramFilterSearch({ ...credentials, cache: null, fetcher })).status, 'shared-index-state-invalid');
  assert.equal((await checkInstagramFilterSearch({ ...credentials, cache: {}, fetcher })).status, 'shared-index-state-invalid');
  assert.equal((await checkInstagramFilterSearch({ ...credentials, cache: { ...cache, lastProbeAt: '' }, fetcher })).status, 'shared-index-state-invalid');
});

test('an unconfirmed free account or a throttle cannot cause a second search', async () => {
  let calls = 0;
  const rejected = await checkInstagramFilterSearch({ ...credentials, cache, fetcher: () => {
    calls++;
    return usage({ paygo_limit: 5 });
  } });
  assert.equal(rejected.attemptedQueries, 0);
  assert.equal(rejected.status, 'free-plan-unverified');
  assert.equal(calls, 1);
  const refused = await checkInstagramFilterSearch({ ...credentials, cache, fetcher: url => {
    calls++;
    return url.endsWith('/usage') ? usage() : new Response(null, { status: 429, headers: { 'Retry-After': '36000' } });
  } });
  assert.equal(calls, 3);
  assert.equal(refused.attemptedQueries, 1);
  assert.equal(refused.status, 'rate-limited');
  assert.equal(refused.nextRetryAt, '2026-11-28T18:30:00.000Z');
  assert.equal(filterSearchCacheUpdate(cache, refused).nextRetryAt, refused.nextRetryAt);
});

test('the CLI creates a distinct single-use claim and refuses attempts to replay it', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'instagram-filter-search-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const workflowOutput = path.join(directory, 'github-output');
  const run = (argument, runId = '100', runAttempt = '1') => spawnSync(process.execPath,
    [fileURLToPath(new URL('./check-instagram-filter-search.mjs', import.meta.url)), argument],
    { cwd: directory, encoding: 'utf8', env: { ...process.env, TAVILY_API_KEY: '',
      GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main', GITHUB_RUN_ID: runId,
      GITHUB_RUN_ATTEMPT: runAttempt, GITHUB_OUTPUT: workflowOutput } });
  assert.equal(run('--claim').status, 0);
  assert.equal(fs.readFileSync(workflowOutput, 'utf8'), 'claimed=true\n');
  const claim = path.join(directory, 'source-state/instagram-filter-search-check-claim.json');
  assert.equal(JSON.parse(fs.readFileSync(claim, 'utf8')).runId, '100');
  assert.equal(run('--claim', '101').status, 0);
  assert.equal(JSON.parse(fs.readFileSync(claim, 'utf8')).runId, '100');
  assert.equal(fs.readFileSync(workflowOutput, 'utf8'), 'claimed=true\n');
  assert.equal(run('--run', '101').status, 1);
  assert.equal(run('--run', '100', '2').status, 1);
  assert.equal(run('--run').status, 1, 'the fixture lacks repository data');
  const marker = path.join(directory, 'output/social-discovery/instagram-filter-search-check.json.started');
  assert.equal(fs.readFileSync(marker, 'utf8'), '100\n', 'a failed execution must leave its pre-provider marker');
  assert.equal(run('--run').status, 1);
  assert.equal(fs.readFileSync(marker, 'utf8'), '100\n');
  fs.writeFileSync(path.join(directory, 'source-state/instagram-filter-search-check-result.json'), '{}');
  assert.equal(run('--run').status, 1);
});

test('the known inventory includes previous Instagram AI rejections', t => {
  const docs = fs.mkdtempSync(path.join(os.tmpdir(), 'instagram-filter-inventory-'));
  t.after(() => fs.rmSync(docs, { recursive: true, force: true }));
  for (const file of ['meta-instagram-scan-state', 'wien-combined-scan-state', 'slack-seen-posts']) {
    fs.writeFileSync(path.join(docs, file + '.json'), '{}');
  }
  fs.writeFileSync(path.join(docs, 'instagram-ai-report.json'), JSON.stringify({
    freshRejected: [{ url: 'https://instagram.com/p/FreshRejected1/' }],
    terminalRejected: [{ url: 'https://instagram.com/reel/TerminalRejected1/' }],
    rejected: [{ url: 'https://instagram.com/p/PreviousRejected1/' }],
  }));
  assert.deepEqual(loadInstagramFilterKnownPosts(docs), new Set([
    'instagram:FreshRejected1', 'instagram:TerminalRejected1', 'instagram:PreviousRejected1',
  ]));
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compareInstagramQueries, instagramQueryMatrix, INSTAGRAM_QUERY_RESULT } from '../scraper/instagram-query-improvement.js';
import { buildInstagramTavilyQuery } from '../scraper/instagram-tavily-index.js';

const now = new Date('2026-11-28T09:00:00Z');
const old = 'https://www.instagram.com/reel/OldIndex12/';
const control = 'https://www.instagram.com/reel/DgQIUvqNQm-/';
const newPost = 'https://www.instagram.com/p/FreshCafe11/';
const cache = { version: 1, nextRetryAt: '', lastProbeAt: '2026-11-27T22:38:00.124Z', links: [{ url: old }] };
const key = 'offline-secret-key';
const account = { current_plan: 'Researcher', plan_limit: 1000, plan_usage: 400, paygo_usage: 0, paygo_limit: null };
const usage = changes => Response.json({ account: { ...account, ...changes }, key: { usage: 400, limit: null } });
const search = (results = [], credits = 1) => Response.json({ results, usage: { credits } });

function fixture({ makeUsage = () => usage(), makeSearch = () => search(), previous, sharedCache = cache } = {}) {
  const bodies = [], delays = [];
  let usageReads = 0;
  const run = () => compareInstagramQueries({ freePlanConfirmed: true, apiKey: key, clock: () => now,
    cache: sharedCache, previous, sleep: ms => { delays.push(ms); }, fetcher: async (url, options) => {
      assert.equal(options.redirect, 'error');
      assert.equal(options.credentials, 'omit');
      assert.equal(options.headers.Authorization, 'Bearer ' + key);
      if (url === 'https://api.tavily.com/usage') { usageReads++; return makeUsage(); }
      assert.equal(url, 'https://api.tavily.com/search');
      const body = JSON.parse(options.body);
      bodies.push(body);
      return makeSearch(body, bodies.length);
    } });
  return { run, bodies, delays, countUsage: () => usageReads };
}

test('the six fixed variants keep production parameters; only the matched control changes the date filter', () => {
  const plan = instagramQueryMatrix(now);
  assert.equal(plan.length, 6);
  assert.deepEqual(plan.map(variant => variant.body.query), [
    buildInstagramTavilyQuery(now), 'Wien Instagram öffentliche Beiträge oder Reels gratis Essen und Getränke Neueröffnung',
    'Wien gratis Kaffee', 'Wien Neueröffnung gratis Döner', 'Dahab Döner 1+1 Rußbergstraße Wien', 'Dahab Döner 1+1 Rußbergstraße Wien',
  ]);
  for (const { body } of plan) {
    assert.equal(body.search_depth, 'basic');
    assert.equal(body.country, 'austria');
    assert.equal(body.max_age_hours, -1);
    assert.equal(body.max_results, 20);
    assert.deepEqual(body.include_domains, ['instagram.com']);
    assert.equal(body.include_answer, false);
    assert.equal(body.include_raw_content, false);
    assert.equal(body.auto_parameters, false);
  }
  assert(plan.slice(0, 5).every(({ body }) => body.time_range === 'week'));
  assert.equal(Object.hasOwn(plan[5].body, 'time_range'), false);
  assert.deepEqual({ ...plan[5].body, time_range: 'week' }, plan[4].body);
});

test('the comparison reports unique unseen links and the known exact control; search hints never enter its receipt', async () => {
  const f = fixture({ makeSearch: (_, position) => position === 3 ? Response.json({ results: [
    { url: old }, { url: newPost + '?private=tracking', title: '<b>Café</b>' + key, content: 'w'.repeat(900), published_date: 'pretend-date' },
    { url: 'https://instagram.com/reel/FreshCafe11/' }, { url: 'https://instagram.invalid/p/Outside11/' },
  ], usage: { credits: 1 }, response_time: 2.4, warning: 'private warning', privateField: 'private value' }) :
    position === 6 ? search([{ url: control }]) : search() });
  const { report, leadHints } = await f.run();
  assert.equal(f.countUsage(), 1);
  assert.equal(f.bodies.length, 6);
  assert.deepEqual(f.delays, Array(5).fill(1000));
  assert.equal(report.status, 'completed');
  assert.equal(report.reportedSearchCredits, 6);
  assert.equal(report.indexRows, 5);
  assert.equal(report.canonicalLinks, 3);
  assert.equal(report.previouslyKnownLinks, 2);
  assert.equal(report.unseenLinks, 1);
  assert.deepEqual(report.links, [newPost]);
  assert.equal(report.comparisons[4].expectedControlSeen, false);
  assert.equal(report.comparisons[5].expectedControlSeen, true);
  assert.equal(report.comparisons[5].unseenLinks, 0);
  assert.equal(report.comparisons[2].providerWarningPresent, true);
  assert.equal(report.comparisons[2].responseTimeSeconds, 2.4);
  assert.equal(leadHints.length, 1);
  assert.equal(leadHints[0].title.length + leadHints[0].snippet.length, 600);
  assert.doesNotMatch(JSON.stringify({ report, leadHints }), /offline-secret|tracking|pretend-date|private warning|privateField|<b>/);
  assert.doesNotMatch(JSON.stringify(report), /redacted|snippet/);
});

test('a recorded hold, missing state, exhausted free balance and unconfirmed pay-as-you-go remain binding', async () => {
  const until = '2026-11-29T00:00:00.000Z';
  const paused = fixture({ previous: { nextRetryAt: until } });
  assert.equal((await paused.run()).report.nextRetryAt, until);
  assert.equal(paused.countUsage(), 0);
  const malformed = fixture({ sharedCache: {} });
  assert.equal((await malformed.run()).report.status, 'shared-index-state-invalid');
  assert.equal(malformed.countUsage(), 0);
  const exhausted = fixture({ makeUsage: () => usage({ plan_usage: 1000 }) });
  assert.equal((await exhausted.run()).report.status, 'free-credits-exhausted');
  assert.equal(exhausted.bodies.length, 0);
  const paid = fixture({ makeUsage: () => usage({ paygo_limit: 5 }) });
  assert.equal((await paid.run()).report.status, 'free-plan-unverified');
  assert.equal(paid.bodies.length, 0);
});

test('partial credit budgets cap the matrix and a later refusal or abnormal credit ends it immediately', async () => {
  const limited = fixture({ makeUsage: () => usage({ plan_usage: 998 }) });
  assert.equal((await limited.run()).report.status, 'budget-limited');
  assert.equal(limited.bodies.length, 1);
  const refused = fixture({ makeSearch: (_, i) => i === 1 ? search([{ url: newPost }]) :
    new Response(null, { status: 429, headers: { 'Retry-After': '7200' } }) });
  const { report } = await refused.run();
  assert.equal(refused.bodies.length, 2);
  assert.equal(report.status, 'rate-limited');
  assert.equal(report.nextRetryAt, '2026-11-28T11:00:00.000Z');
  assert.deepEqual(report.links, [newPost]);
  const cost = fixture({ makeSearch: () => search([{ url: newPost }], 2) });
  const blocked = (await cost.run()).report;
  assert.equal(cost.bodies.length, 1);
  assert.equal(blocked.status, 'unexpected-search-credit-cost');
  assert.deepEqual(blocked.links, []);
});

test('the CLI retains its separate claim and exclusive pre-request marker after a failed execution', t => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'instagram-query-improvement-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const workflowOutput = path.join(cwd, 'output.txt');
  const entry = fileURLToPath(new URL('./check-instagram-query-improvement.mjs', import.meta.url));
  const run = (command, runId = '123', attempt = '1') => spawnSync(process.execPath, [entry, command], { cwd, encoding: 'utf8',
    env: { ...process.env, TAVILY_API_KEY: '', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main',
      GITHUB_RUN_ID: runId, GITHUB_RUN_ATTEMPT: attempt, GITHUB_OUTPUT: workflowOutput } });
  assert.equal(run('--claim').status, 0);
  assert.equal(run('--claim', '456').status, 0);
  assert.equal(fs.readFileSync(workflowOutput, 'utf8'), 'claimed=true\n');
  assert.equal(run('--run', '456').status, 1);
  assert.equal(run('--run').status, 1, 'the fixture does not provide production inventory');
  assert.equal(fs.readFileSync(path.join(cwd, 'output/social-discovery/instagram-query-improvement.json.started'), 'utf8'), '123\n');
  assert.equal(run('--run').status, 1);
  assert.equal(run('--run', '123', '2').status, 1);
  assert.equal(fs.existsSync(path.join(cwd, INSTAGRAM_QUERY_RESULT)), false);
});

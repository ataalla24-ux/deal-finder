import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalInstagramPostKey } from '../scraper/deal-evidence-utils.js';
import { instagramTavilyComparisons } from '../scraper/instagram-tavily-investigation.js';
import { INSTAGRAM_TAVILY_CACHE, normalizeInstagramTavilyUrl, readInstagramTavilyCache,
  updateInstagramTavilyCache, writeInstagramTavilyCache } from '../scraper/instagram-tavily-index.js';
import { getFreeSearchBudget, requestTavilyJson } from '../scraper/tiktok-public-index.js';

const dayMs = 86_400_000;
const checkName = 'instagram-filter-search-20261128-v1';
const claimPath = 'source-state/instagram-filter-search-check-claim.json';
const resultPath = 'source-state/instagram-filter-search-check-result.json';
const artifactPath = 'output/social-discovery/instagram-filter-search-check.json';
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

export async function checkInstagramFilterSearch({ apiKey = '', freePlanConfirmed = false,
  previous = {}, cache = {}, knownKeys = new Set(), fetcher = fetch, clock = () => new Date(),
} = {}) {
  const now = clock();
  const query = instagramTavilyComparisons(now)[0].body;
  const result = { checkedAt: now.toISOString(), status: 'not-started', query: query.query,
    dateWindow: query.time_range, cacheMode: 'index-only', liveFetchAllowed: false,
    usageChecks: 0, attemptedQueries: 0, reportedSearchCredits: null, indexRows: 0,
    canonicalLinks: 0, previouslyKnownLinks: 0, unseenLinks: 0, nextRetryAt: '', links: [],
    instagramReads: 0, modelCalls: 0, publishedDeals: 0 };
  const deadlines = [previous.nextRetryAt, cache?.nextRetryAt];
  if (cache?.version !== 1 || !Array.isArray(cache.links) || typeof cache.nextRetryAt !== 'string'
      || !Number.isFinite(Date.parse(cache.lastProbeAt))
      || deadlines.some(value => value && !Number.isFinite(Date.parse(value)))) {
    return { ...result, status: 'shared-index-state-invalid' };
  }
  const held = Math.max(0, ...deadlines.map(value => Date.parse(value) || 0));
  if (held > +now) return { ...result, status: 'cooldown', nextRetryAt: new Date(held).toISOString() };
  if (!freePlanConfirmed) return { ...result, status: 'free-plan-unconfirmed' };
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!key) return { ...result, status: 'key-missing' };

  const authorization = { Authorization: 'Bearer ' + key };
  const usage = await requestTavilyJson('https://api.tavily.com/usage', { method: 'GET', headers: authorization },
    { fetcher, clock, isValid: value => value && typeof value === 'object' && !Array.isArray(value) });
  result.usageChecks = 1;
  result.usageHttpStatus = usage.httpStatus;
  if (usage.status !== 'completed') return { ...result, status: usage.status, nextRetryAt: usage.nextRetryAt };
  const budget = getFreeSearchBudget(usage.payload, now, 1);
  if (budget.refusal) return { ...result, status: 'free-plan-unverified', budgetRefusalReason: budget.refusal };
  result.budget = budget;
  if (Math.min(budget.remainingCredits, budget.plannedQueries) < 1) return { ...result, status: 'free-credits-exhausted' };

  result.attemptedQueries = 1;
  const search = await requestTavilyJson('https://api.tavily.com/search', {
    method: 'POST', headers: { ...authorization, 'Content-Type': 'application/json' }, body: JSON.stringify(query),
  }, { fetcher, clock, isValid: value => Array.isArray(value?.results) });
  result.httpStatus = search.httpStatus;
  if (search.status !== 'completed') return { ...result, status: search.status, nextRetryAt: search.nextRetryAt };
  result.indexRows = search.payload.results.length;
  const credits = search.payload.usage?.credits;
  result.reportedSearchCredits = Number.isSafeInteger(credits) && credits >= 0 ? credits : null;
  if (result.reportedSearchCredits !== 1) {
    return { ...result, status: 'unexpected-search-credit-cost', nextRetryAt: new Date(+clock() + dayMs).toISOString() };
  }
  const seen = new Set(knownKeys);
  for (const entry of cache.links || []) {
    const post = canonicalInstagramPostKey(entry?.url);
    if (post) seen.add(post);
  }
  const urls = new Map();
  for (const row of search.payload.results.slice(0, 20)) {
    const url = normalizeInstagramTavilyUrl(row?.url);
    const post = canonicalInstagramPostKey(url);
    if (post && !urls.has(post)) urls.set(post, url);
  }
  result.links = [...urls].map(([post, url]) => ({ url, status: seen.has(post) ? 'known' : 'unseen-link' }));
  result.canonicalLinks = result.links.length;
  result.previouslyKnownLinks = result.links.filter(row => row.status === 'known').length;
  result.unseenLinks = result.canonicalLinks - result.previouslyKnownLinks;
  result.status = 'completed';
  return result;
}

export function filterSearchCacheUpdate(cache, result) {
  return updateInstagramTavilyCache(cache, { nextRetryAt: result.nextRetryAt,
    instagramIndex: { attemptedQueries: result.attemptedQueries,
      links: result.links.filter(row => row.status === 'unseen-link').map(row => row.url) } }, { now: new Date(result.checkedAt) });
}

export function loadInstagramFilterKnownPosts(docs) {
  const known = new Set();
  const add = raw => {
    const post = canonicalInstagramPostKey(raw);
    if (post) known.add(post);
  };
  for (const file of fs.readdirSync(docs).filter(name => /^(?:deals\.json|deals-pending-.+\.json|deal-candidates-index\.json|instagram-graph-post-evidence\.json)$/.test(name))) {
    const data = readJson(path.join(docs, file));
    for (const row of data.deals || data.candidates || data.posts || []) add(row.url || row.postUrl || row.post_url || row.permalink);
  }
  for (const file of ['meta-instagram-scan-state.json', 'wien-combined-scan-state.json']) {
    const scan = readJson(path.join(docs, file));
    for (const source of Object.values(scan.sources || {})) for (const row of source.rows || []) add(row.permalink);
  }
  for (const key of readJson(path.join(docs, 'slack-seen-posts.json')).seenPostKeys || []) {
    const match = /^instagram:(?:(?:p|reel|tv):)?([A-Za-z0-9_-]{5,20})$/.exec(key);
    if (match) known.add('instagram:' + match[1]);
  }
  const instagramAi = readJson(path.join(docs, 'instagram-ai-report.json'));
  for (const lane of ['freshRejected', 'terminalRejected', 'rejected']) {
    for (const row of instagramAi[lane] || []) add(row?.url);
  }
  return known;
}

async function main() {
  const { GITHUB_EVENT_NAME, GITHUB_REF, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT, GITHUB_OUTPUT } = process.env;
  if (GITHUB_EVENT_NAME !== 'workflow_dispatch' || GITHUB_REF !== 'refs/heads/main'
      || GITHUB_RUN_ATTEMPT !== '1' || !/^\d+$/.test(GITHUB_RUN_ID || '')) {
    throw new Error('A fresh explicit main-branch filter-search check is required.');
  }
  if (process.argv[2] === '--claim') {
    if (fs.existsSync(claimPath) || fs.existsSync(resultPath)) {
      console.log('The filter-search check is already claimed.');
      return;
    }
    fs.mkdirSync(path.dirname(claimPath), { recursive: true });
    fs.writeFileSync(claimPath, JSON.stringify({ check: checkName, runId: GITHUB_RUN_ID,
      claimedAt: new Date().toISOString(), maximumSearchRequests: 1 }, null, 2) + '\n', { flag: 'wx' });
    fs.appendFileSync(GITHUB_OUTPUT, 'claimed=true\n');
    return;
  }
  if (process.argv[2] !== '--run') throw new Error('Explicit diagnostic action required.');
  const claim = readJson(claimPath);
  if (claim.check !== checkName || claim.runId !== GITHUB_RUN_ID || claim.maximumSearchRequests !== 1 || fs.existsSync(resultPath)) {
    throw new Error('Matching unused filter-search claim required.');
  }
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  fs.writeFileSync(artifactPath + '.started', GITHUB_RUN_ID + '\n', { flag: 'wx' });
  const cache = readInstagramTavilyCache(INSTAGRAM_TAVILY_CACHE);
  const result = { check: checkName, runId: GITHUB_RUN_ID, ...await checkInstagramFilterSearch({ cache,
    previous: readJson('docs/tiktok-scanner-report.json').tavilyDiscovery || {}, knownKeys: loadInstagramFilterKnownPosts('docs'),
    apiKey: process.env.TAVILY_API_KEY, freePlanConfirmed: process.env.TIKTOK_TAVILY_FREE_PLAN_CONFIRMED === '1' }) };
  fs.writeFileSync(artifactPath, JSON.stringify(result, null, 2) + '\n');
  writeInstagramTavilyCache(resultPath, result);
  const updated = filterSearchCacheUpdate(cache, result);
  if (updated) writeInstagramTavilyCache(INSTAGRAM_TAVILY_CACHE, updated);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('Instagram filter-search check failed.'); process.exitCode = 1; });
}

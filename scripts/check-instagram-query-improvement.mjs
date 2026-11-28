import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { INSTAGRAM_TAVILY_CACHE, readInstagramTavilyCache, writeInstagramTavilyCache } from '../scraper/instagram-tavily-index.js';
import { compareInstagramQueries, INSTAGRAM_QUERY_COMPARISON, INSTAGRAM_QUERY_RESULT,
  MAX_INSTAGRAM_COMPARISON_QUERIES } from '../scraper/instagram-query-improvement.js';
import { loadInstagramFilterKnownPosts } from './check-instagram-filter-search.mjs';

const claimPath = 'source-state/instagram-query-improvement-claim.json';
const artifactPath = 'output/social-discovery/instagram-query-improvement.json';
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

async function main() {
  const { GITHUB_EVENT_NAME, GITHUB_REF, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT, GITHUB_OUTPUT } = process.env;
  if (GITHUB_EVENT_NAME !== 'workflow_dispatch' || GITHUB_REF !== 'refs/heads/main'
      || GITHUB_RUN_ATTEMPT !== '1' || !/^\d+$/.test(GITHUB_RUN_ID || '')) {
    throw new Error('A fresh manual comparison on main is required.');
  }
  if (process.argv[2] === '--claim') {
    if (fs.existsSync(claimPath) || fs.existsSync(INSTAGRAM_QUERY_RESULT)) {
      console.log('This comparison has already been claimed.');
      return;
    }
    fs.mkdirSync(path.dirname(claimPath), { recursive: true });
    fs.writeFileSync(claimPath, JSON.stringify({ check: INSTAGRAM_QUERY_COMPARISON, runId: GITHUB_RUN_ID,
      claimedAt: new Date().toISOString(), maximumSearchRequests: MAX_INSTAGRAM_COMPARISON_QUERIES }, null, 2) + '\n', { flag: 'wx' });
    fs.appendFileSync(GITHUB_OUTPUT, 'claimed=true\n');
    return;
  }
  if (process.argv[2] !== '--run') throw new Error('Explicit diagnostic action required.');
  const claim = readJson(claimPath);
  if (claim.check !== INSTAGRAM_QUERY_COMPARISON || claim.runId !== GITHUB_RUN_ID
      || claim.maximumSearchRequests !== MAX_INSTAGRAM_COMPARISON_QUERIES || fs.existsSync(INSTAGRAM_QUERY_RESULT)) {
    throw new Error('Matching unused comparison claim required.');
  }
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  fs.writeFileSync(artifactPath + '.started', GITHUB_RUN_ID + '\n', { flag: 'wx' });
  const cache = readInstagramTavilyCache(INSTAGRAM_TAVILY_CACHE);
  const { report, leadHints } = await compareInstagramQueries({ cache,
    previous: readJson('docs/tiktok-scanner-report.json').tavilyDiscovery || {},
    knownKeys: loadInstagramFilterKnownPosts('docs'), apiKey: process.env.TAVILY_API_KEY,
    freePlanConfirmed: process.env.TIKTOK_TAVILY_FREE_PLAN_CONFIRMED === '1' });
  const result = { runId: GITHUB_RUN_ID, ...report };
  fs.writeFileSync(artifactPath, JSON.stringify(result, null, 2) + '\n');
  fs.writeFileSync(artifactPath.replace(/\.json$/, '.hints.json'), JSON.stringify({ runId: GITHUB_RUN_ID,
    evidence: 'unverified-search-text', links: leadHints }, null, 2) + '\n');
  writeInstagramTavilyCache(INSTAGRAM_QUERY_RESULT, result);
  if (cache?.version === 1 && Date.parse(report.nextRetryAt) > (Date.parse(cache.nextRetryAt) || 0)) {
    writeInstagramTavilyCache(INSTAGRAM_TAVILY_CACHE, { ...cache, nextRetryAt: report.nextRetryAt });
  }
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('The bounded Instagram query comparison failed.'); process.exitCode = 1; });
}

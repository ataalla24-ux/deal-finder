import fs from 'node:fs';
import { discoverTikTokLinksViaTavily } from '../scraper/tiktok-public-index.js';
import { INSTAGRAM_TAVILY_CACHE, readInstagramTavilyCache, updateInstagramTavilyCache, writeInstagramTavilyCache } from '../scraper/instagram-tavily-index.js';

if (process.env.GITHUB_RUN_ATTEMPT !== '1' || process.env.GITHUB_REF !== 'refs/heads/main') {
  throw new Error('A fresh manual main-branch run is required for the Instagram index check.');
}

const previous = JSON.parse(fs.readFileSync('docs/tiktok-scanner-report.json', 'utf8'));
const cache = readInstagramTavilyCache(INSTAGRAM_TAVILY_CACHE);
const result = await discoverTikTokLinksViaTavily({
  enabled: true, previous: previous.tavilyDiscovery,
  apiKey: process.env.TAVILY_API_KEY,
  freePlanConfirmed: process.env.TIKTOK_TAVILY_FREE_PLAN_CONFIRMED === '1',
  instagramIndex: { probe: true, previous: cache },
});
const index = result.instagramIndex;
const report = { checkedAt: new Date().toISOString(), status: result.status,
  usageChecks: result.usageChecks || 0, usageHttpStatus: result.usageHttpStatus || 0,
  budgetRefusalReason: result.budgetRefusalReason || '', attemptedQueries: index?.attemptedQueries || 0,
  httpStatus: index?.httpStatus || 0, reportedSearchCredits: index?.reportedSearchCredits ?? null,
  indexRows: index?.indexRows || 0, canonicalPublicLinks: index?.links.length || 0,
  nextRetryAt: result.nextRetryAt,
};
fs.mkdirSync('output/social-discovery', { recursive: true });
fs.writeFileSync('output/social-discovery/instagram-tavily-index.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));

const updated = updateInstagramTavilyCache(cache, result, { probe: true });
if (updated) {
  writeInstagramTavilyCache(INSTAGRAM_TAVILY_CACHE, updated);
  fs.appendFileSync(process.env.GITHUB_OUTPUT, 'cache_changed=true\n');
}

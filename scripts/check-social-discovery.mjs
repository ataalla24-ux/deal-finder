// Read-only public probe: no deals/cache writes, paid provider/model calls or Slack sends.
import fs from 'node:fs';
import { chromium } from 'playwright';
import { fetchTikTokApiCandidates, discoverTikTokLinksViaDuckDuckGo } from '../scraper/tiktok-deals-scanner.js';
import { loadWatchlist, selectRotatingAccounts } from '../scraper/instagram-ai-agent.js';
import { planInstagramQueries } from '../scraper/instagram-query-plan.js';

let previous = {};
try { previous = JSON.parse(fs.readFileSync('docs/tiktok-scanner-report.json','utf8')); } catch {}
const report = { checkedAt: new Date().toISOString(), readOnly: true, maxApiSearchRequests: 1, maxWebSearchRequests: 1 };
const browser = await chromium.launch({headless:true});
try {
  const context = await browser.newContext({locale:'de-AT',timezoneId:'Europe/Vienna'});
  const page = await context.newPage();
  const api = await fetchTikTokApiCandidates(page,{
    keywords:['wien gratis kaffee'],pages:1,maxCandidates:3,previous:previous.apiDiscovery,
  });
  const { rows, ...apiSummary } = api;
  report.tiktokApi = {...apiSummary,candidates:rows.length};
} catch (error) {
  report.tiktokApi={stoppedReason:'probe-session-unavailable',error:error.name};
} finally { await browser.close(); }
const search = await discoverTikTokLinksViaDuckDuckGo({
  queries:['site:tiktok.com wien gratis kaffee'],previousReport:{lastUpdated:previous.lastUpdated,
    search:previous.searchDiscovery || {errors:previous.discoveryErrors || []}},
});
const {links,...searchSummary}=search;
report.webSearch={...searchSummary,candidates:links.length};
const accounts=loadWatchlist();
report.instagramPlan={eligibleFoodAccounts:accounts.length,selectedAccounts:selectRotatingAccounts(accounts,16).map(a=>a.username),
  exampleQueries:planInstagramQueries({general:['site:instagram.com/reel wien gratis kaffee'],
    accounts:selectRotatingAccounts(accounts,16),limit:6}),
  graphRequests:0,websiteCooldownUnchanged:true};
fs.mkdirSync('output/social-discovery',{recursive:true});
fs.writeFileSync('output/social-discovery/probe.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));

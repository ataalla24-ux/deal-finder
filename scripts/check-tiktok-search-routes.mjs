import fs from 'node:fs';
import { chromium } from 'playwright';
import { retryAfterAt } from '../scraper/source-http-policy.js';
import { observeTikTokSearchRoutes } from '../scraper/tiktok-browser-search.js';
import { githubRunProvenance } from '../scraper/pipeline-run-report-utils.js';

const previous = JSON.parse(fs.readFileSync('docs/tiktok-scanner-report.json', 'utf8')).apiDiscovery || {};
const retryAt = Date.parse(previous.nextRetryAt);
const last = previous.errors?.at(-1);
const localOnly = last?.status === 0 && last.transportReason === 'request-policy-blocked' && previous.searchRequests === 0;
let routes = null;
if (localOnly || !(retryAt > Date.now())) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ locale: 'de-AT', timezoneId: 'Europe/Vienna', serviceWorkers: 'block' });
    routes = await observeTikTokSearchRoutes(page, 'wien gratis kaffee');
  } finally { await browser.close(); }
}

if (routes?.refusal) {
  const { retryAfter, ...refusal } = routes.refusal;
  routes.refusal = { ...refusal, retryAt: retryAfterAt(retryAfter) };
}
const report = {
  checkedAt: new Date().toISOString(), provenance: githubRunProvenance(),
  recordedSearchRetryAt: previous.nextRetryAt || '', status: routes ? 'routes-observed' : 'cooldown',
  routes,
};
fs.mkdirSync('output/social-discovery', { recursive: true });
fs.writeFileSync('output/social-discovery/tiktok-routes.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));

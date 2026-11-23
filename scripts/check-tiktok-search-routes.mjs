import fs from 'node:fs';
import { chromium } from 'playwright';
import { retryAfterAt } from '../scraper/source-http-policy.js';
import { observeTikTokPublicSearchPage, observeTikTokSearchRoutes } from '../scraper/tiktok-browser-search.js';
import { githubRunProvenance } from '../scraper/pipeline-run-report-utils.js';

const previous = JSON.parse(fs.readFileSync('docs/tiktok-scanner-report.json', 'utf8'));
const publicUi = process.argv.includes('--public-ui');
const api = previous.apiDiscovery;
const retryAt = Math.max(
  Date.parse(api?.nextRetryAt) || 0,
  Date.parse(api?.postVisitStop?.retryAt) || 0,
  Date.parse(previous.searchDiscovery?.postVisitStop?.retryAt) || 0,
);
const confirmedComparison = publicUi && process.argv.includes('--confirm-45169295428')
  && process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' && process.env.GITHUB_RUN_ATTEMPT === '1'
  && api?.checkedBy?.runId === '45162411395' && api.lastFailure?.providerCode === '2483'
  && api.lastFailure?.providerSignal === 'unclassified' && api.lastFailure?.status === 200
  && api.lastFailure?.retryAfterProvided === false && api.lastSearchResponse?.retryAfterProvided === false
  && !api.postVisitStop && !previous.searchDiscovery?.postVisitStop;
let routes = null;
if (retryAt <= Date.now() || confirmedComparison) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ locale: 'de-AT', timezoneId: 'Europe/Vienna',
      ...(publicUi ? {} : { serviceWorkers: 'block' }) });
    routes = publicUi
      ? await observeTikTokPublicSearchPage(page, api?.errors?.[0]?.keyword || 'wien gratis kaffee')
      : await observeTikTokSearchRoutes(page, 'wien gratis kaffee');
  } finally { await browser.close(); }
}

if (routes?.refusal) {
  const { retryAfter, ...refusal } = routes.refusal;
  routes.refusal = { ...refusal, retryAt: retryAfterAt(retryAfter) };
}
if (routes && publicUi) {
  const { documentRetryAfter, responses } = routes;
  delete routes.documentRetryAfter;
  routes.documentRetryAfterProvided = documentRetryAfter !== null;
  routes.documentRetryAt = retryAfterAt(documentRetryAfter);
  routes.responses = responses.map(({ retryAfter, ...response }) => ({ ...response, retryAt: retryAfterAt(retryAfter) }));
}
const report = {
  checkedAt: new Date().toISOString(), provenance: githubRunProvenance(),
  recordedSearchRetryAt: retryAt ? new Date(retryAt).toISOString() : '',
  mode: publicUi ? 'normal-public-search-page' : 'blocked-route-diagnostics',
  status: routes ? 'routes-observed' : 'cooldown',
  ...(confirmedComparison ? { comparisonOfRun: '45169295428' } : {}),
  routes,
};
fs.mkdirSync('output/social-discovery', { recursive: true });
fs.writeFileSync('output/social-discovery/tiktok-routes.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));

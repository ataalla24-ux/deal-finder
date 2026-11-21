import fs from 'node:fs';
import { chromium } from 'playwright';
import { buildDealFromPost, extractTikTokPostData, fetchTikTokApiCandidates } from '../scraper/tiktok-deals-scanner.js';
import { tikTokDirectProbePrevious, tikTokRetryAt } from '../scraper/tiktok-search-discovery.js';
import { canonicalSocialPostKey, semanticCrossPlatformOfferKey } from '../scraper/deal-evidence-utils.js';
import { filterModeratedDeals, loadDealModeration } from '../scraper/deal-moderation-utils.js';
import { githubRunProvenance } from '../scraper/pipeline-run-report-utils.js';

function read(file) {
  return JSON.parse(fs.readFileSync('docs/' + file + '.json', 'utf8'));
}

const previous = read('tiktok-scanner-report');
const previousCandidates = [
  ...(read('deals').deals || []),
  ...(read('deals-pending-all').deals || []),
  ...(read('deals-pending-tiktok').deals || []),
  ...(read('deal-candidates-index').candidates || []),
];
const known = new Set(previousCandidates.map(row => canonicalSocialPostKey(row.url || row.postUrl)).filter(Boolean));
const knownOffers = new Set(previousCandidates.map(semanticCrossPlatformOfferKey).filter(Boolean));
for (const key of read('slack-seen-posts').seenPostKeys || []) {
  if (/^tiktok:video:\d{8,30}$/.test(key)) known.add(key);
}

const provenance = githubRunProvenance();
const report = { checkedAt: new Date().toISOString(), provenance, maxSearchPages: 1, maxPostVisits: 3 };
const apiPrevious = tikTokDirectProbePrevious(previous.apiDiscovery);
const releasedLocalPolicyDeadline = apiPrevious !== previous.apiDiscovery ? previous.apiDiscovery.nextRetryAt : null;
if (releasedLocalPolicyDeadline) report.releasedLocalPolicyDeadline = releasedLocalPolicyDeadline;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ locale: 'de-AT', timezoneId: 'Europe/Vienna' });
  const api = await fetchTikTokApiCandidates(page, {
    keywords: ['wien gratis kaffee'], pages: 1, maxCandidates: 12, previous: apiPrevious,
  });
  const { rows, publicVideoLinks = [], ...summary } = api;
  const deals = [];
  const inspected = new Set();
  const writeAttempt = () => {
    const file = 'docs/tiktok-scanner-report.json';
    const next = {
      ...previous,
      apiDiscovery: {
        ...summary,
        ...(releasedLocalPolicyDeadline ? { releasedLocalPolicyDeadline } : {}),
        nextKeywordIndex: previous.apiDiscovery?.nextKeywordIndex || 0,
        normalizedCandidates: rows.length,
        inspectedPublicLinks: inspected.size,
        checkedBy: provenance,
      },
    };
    const temporary = file + '.direct-probe.tmp';
    fs.writeFileSync(temporary, JSON.stringify(next, null, 2) + '\n');
    fs.renameSync(temporary, file);
  };
  if (summary.attemptedRequests) {
    writeAttempt();
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'attempted=true\n');
  }
  const include = (url, data) => {
    const key = canonicalSocialPostKey(url);
    if (!key || known.has(key)) return;
    const { deal } = buildDealFromPost(url, data);
    if (!deal) return;
    const offer = semanticCrossPlatformOfferKey(deal);
    if (offer && knownOffers.has(offer)) return;
    known.add(key);
    if (offer) knownOffers.add(offer);
    deals.push(deal);
  };
  for (const { data } of rows) include(data.url, data);
  for (const url of publicVideoLinks.filter(url => {
    const key = canonicalSocialPostKey(url);
    return key && !known.has(key);
  }).slice(0, report.maxPostVisits)) {
    inspected.add(url);
    let data;
    try { data = await extractTikTokPostData(page, url); } catch { continue; }
    if (data.accessRefusal) {
      const { status, retryAfter, transportReason } = data.accessRefusal;
      const until = tikTokRetryAt(retryAfter);
      if (!summary.nextRetryAt || until > summary.nextRetryAt) summary.nextRetryAt = until;
      summary.postVisitStop = { status, transportReason, retryAt: summary.nextRetryAt };
      break;
    }
    include(url, data);
  }
  if (summary.attemptedRequests && inspected.size) writeAttempt();
  const filtered = filterModeratedDeals(deals, loadDealModeration());
  Object.assign(report, {
    directSearch: summary, normalizedCandidates: rows.length, renderedLinks: publicVideoLinks.length,
    inspectedPosts: inspected.size,
    novelOffers: filtered.deals.map(({ url, pubDate, title }) => ({ url, pubDate, title })),
  });
} finally { await browser.close(); }

fs.mkdirSync('output/social-discovery', { recursive: true });
fs.writeFileSync('output/social-discovery/tiktok-direct.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));

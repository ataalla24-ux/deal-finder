import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import robotsParser from 'robots-parser';
import { resolve4 } from 'node:dns/promises';
import { fileURLToPath } from 'node:url';
import { VIENNA_FOOD_QUERY, buildMerchantDirectory, discoveryAccounts, extractMerchantLinks, merchantWebsite } from '../scraper/vienna-merchant-discovery.js';
import { selectMerchantOfferPages, extractMerchantOfferCandidates, currentMerchantCandidates, merchantOfferHostPaused } from '../scraper/merchant-offer-discovery.js';
import { sourceHttpError, sourceFailureFields } from '../scraper/source-http-policy.js';
import { githubRunProvenance } from '../scraper/pipeline-run-report-utils.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const userAgent = 'FreeFinder-source-discovery/1.0 (+https://freefinder.at)';
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(path.join(root, file))); } catch { return fallback; } };
const writeJson = (file, data) => {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target + '.tmp', JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(target + '.tmp', target);
};

export function publicIPv4(address) {
  const p = address.split('.').map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a,b] = p;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && [0,168].includes(b) || a === 100 && b >= 64 && b <= 127 || a === 198 && [18,19,51].includes(b) || a === 203 && b === 0);
}

// Pin a public DNS result for the connection; validate each redirect separately.
export async function fetchMerchantPage(value, hops = 0, allowedOrigin = '', allowedPath = () => true) {
  const normalized = merchantWebsite(value);
  if (!normalized || hops > 3) throw new Error('Blocked URL or redirect limit');
  const url = new URL(normalized);
  if (allowedOrigin && url.origin !== allowedOrigin) throw new Error('Cross-origin offer redirect deferred');
  if (!allowedPath(url.href)) throw new Error('Robots redirect policy deferred');
  const addresses = await Promise.race([resolve4(url.hostname), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('DNS timeout')), 5000); timer.unref(); })]);
  if (!addresses.length || !addresses.every(publicIPv4)) throw new Error('Non-public destination');
  const response = await new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'user-agent': userAgent, 'accept': 'text/html,text/plain', 'accept-encoding': 'identity' },
      lookup: (host, options, callback) => options?.all ? callback(null, [{ address: addresses[0], family: 4 }]) : callback(null, addresses[0], 4),
    }, res => {
      const chunks = []; let size = 0;
      res.on('data', chunk => { size += chunk.length; if (size > 2_500_000) res.destroy(new Error('Response too large')); else chunks.push(chunk); });
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8'), url: url.href }));
    });
    const timer = setTimeout(() => req.destroy(new Error('Request timeout')), 8000);
    req.on('close', () => clearTimeout(timer));
    req.on('error', reject);
  });
  if ([301,302,303,307,308].includes(response.status)) return fetchMerchantPage(new URL(response.headers.location, url).href, hops + 1, allowedOrigin, allowedPath);
  return response;
}

export function robotsAllowsDiscovery(text, url = 'https://example.com/') {
  return robotsParser(new URL('/robots.txt', url).href, text).isAllowed(url, userAgent) === true;
}

export async function runDiscovery(options = {}) {
  const now = options.now || new Date();
  const read = options.read || readJson;
  const save = options.save || writeJson;
  const fetchPage = options.fetchPage || fetchMerchantPage;
  const wait = options.wait || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  let directory = read('reviews/vienna-merchant-directory.json', {});
  if (!directory.merchants?.length || Date.parse(directory.generatedAt) < now.getTime() - 7 * 86400000) {
    const url = 'https://overpass-api.de/api/interpreter?' + new URLSearchParams({ data: VIENNA_FOOD_QUERY });
    const response = await (options.fetchImpl || fetch)(url, { headers: { 'user-agent': userAgent }, signal: AbortSignal.timeout(115000) });
    if (!response.ok) throw new Error(`Overpass HTTP ${response.status}; existing data preserved`);
    directory = buildMerchantDirectory(await response.json(), now);
    save('reviews/vienna-merchant-directory.json', directory);
  }
  const state = read('reviews/vienna-merchant-website-state.json', {});
  const offerState = read('reviews/vienna-merchant-offer-state.json', {});
  const budget = Math.max(0, Math.min(500, Number(process.env.VIENNA_WEBSITE_BUDGET ?? 200) || 0));
  const offerTasks = selectMerchantOfferPages(directory, state, offerState, now, budget, read('docs/power-scraper-report.json', {}));
  const sites = [...new Set(directory.merchants.map(m => m.website).filter(Boolean))]
    .filter(url => !merchantOfferHostPaused(url, offerState, now))
    .filter(url => !offerTasks.some(task => new URL(task.url).origin === new URL(url).origin))
    .filter(url => state[url]?.policyVersion !== 2 || Date.parse(state[url].checkedAt) < now.getTime() - 30 * 86400000)
    .sort((a,b) => (Date.parse(state[a]?.checkedAt) || 0) - (Date.parse(state[b]?.checkedAt) || 0) || a.localeCompare(b))
    .slice(0, budget - offerTasks.length);
  const tasks = [...offerTasks, ...sites.map(url => ({ url }))];
  let cursor = 0;
  async function worker() {
    while (cursor < tasks.length) {
      const task = tasks[cursor++];
      const { url } = task;
      const targetState = task.merchant ? offerState : state;
      try {
        const robots = await fetchPage(new URL('/robots.txt', url).href);
        if ([401, 403, 429].includes(robots.status)) throw sourceHttpError(robots.status, robots.headers['retry-after'], now);
        if (robots.status !== 404 && (robots.status !== 200 || !robotsAllowsDiscovery(robots.body, url))) throw new Error('Robots policy deferred');
        const delay = robots.status === 200 ? robotsParser(new URL('/robots.txt', url).href, robots.body).getCrawlDelay(userAgent) || 0 : 0;
        if (delay > 15) throw new Error('Long crawl delay deferred');
        await wait(Math.max(500, delay * 1000));
        const page = await fetchPage(url, 0, task.merchant ? new URL(url).origin : '',
          task.merchant && robots.status === 200 ? value => robotsAllowsDiscovery(robots.body, value) : () => true);
        if (page.status !== 200) throw sourceHttpError(page.status, page.headers['retry-after'], now);
        if (page.status !== 200 || !/text\/html/i.test(page.headers['content-type'] || '')) throw new Error(`HTML unavailable (${page.status})`);
        if (task.merchant) {
          // The final URL is the evidence URL; directory locations remain unverified leads.
          offerState[url] = { checkedAt: now.toISOString(), status: 'ok',
            deals: extractMerchantOfferCandidates(page.body, { ...task, url: page.url }, now) };
        } else state[url] = { checkedAt: now.toISOString(), policyVersion: 2, status: 'ok', ...extractMerchantLinks(page.body, page.url) };
      } catch (error) {
        targetState[url] = { checkedAt: now.toISOString(), policyVersion: 2, status: 'deferred', reason: error.message, ...sourceFailureFields(error) };
      }
      save(task.merchant ? 'reviews/vienna-merchant-offer-state.json' : 'reviews/vienna-merchant-website-state.json', targetState);
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  const candidates = currentMerchantCandidates(offerState, now);
  save('docs/deals-pending-vienna-websites.json', { lastUpdated: now.toISOString(), runProvenance: githubRunProvenance(), source: 'vienna-merchant-website', deals: candidates });
  const accounts = discoveryAccounts(directory, state, now);
  save('docs/vienna-discovery-accounts.json', { generatedAt: now.toISOString(), attribution: directory.attribution, licenseUrl: directory.licenseUrl, accounts });
  const report = { generatedAt: now.toISOString(), runProvenance: githubRunProvenance(), venues: directory.merchants.length, websites: new Set(directory.merchants.map(m => m.website).filter(Boolean)).size,
    sitesAttemptedThisRun: sites.length, offerPagesAttemptedThisRun: offerTasks.length,
    totalPageSlotsUsed: tasks.length, pageSlotBudget: budget,
    offerCandidates: candidates.length, offerPagesDeferredThisRun: offerTasks.filter(t => offerState[t.url]?.status !== 'ok').length,
    websitesChecked: Object.keys(state).length,
    websitesReadable: Object.values(state).filter(s => s.status === 'ok').length,
    instagramAccounts: accounts.length, websiteLinkedAccounts: accounts.filter(a => a.evidenceKind === 'directory-and-website-link').length,
    districtCoverage: directory.merchants.reduce((s,m) => { const code = /^1(?:0[1-9]|1[0-9]|2[0-3])0$/.test(m.postcode) ? m.postcode : 'unknown'; s[code] = (s[code] || 0) + 1; return s; }, {}),
    note: 'Discovery leads, not verified offers. No live feed writes. TheFork excluded. Existing Graph quotas apply.' };
  save('reviews/vienna-merchant-discovery-report.json', report);
  (options.log || console.log)(JSON.stringify(report, null, 2));
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runDiscovery().catch(error => { console.error(error.message); process.exitCode = 1; });
}

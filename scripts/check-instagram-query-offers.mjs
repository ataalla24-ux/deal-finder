import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { canonicalInstagramPostKey } from '../scraper/deal-evidence-utils.js';
import { loadDealModeration } from '../scraper/deal-moderation-utils.js';
import { loadInstagramCookieHints } from '../scraper/instagram-auth-utils.js';
import { getInstagramTavilyLeads, normalizeInstagramTavilyUrl, INSTAGRAM_TAVILY_CACHE } from '../scraper/instagram-tavily-index.js';
import { loadRenderedTavilyInventory, verifyRenderedInstagramTavilyLinks } from './check-instagram-tavily-rendered-offers.mjs';

const cap = 4;
const reportPath = 'docs/instagram-ai-report.json';
const receiptPath = 'source-state/instagram-query-improvement-result.json';
const claimPath = 'source-state/instagram-query-offers-claim.json';
const output = 'output/social-discovery';
const basename = 'instagram-query-offers';
const comparisonName = 'instagram-query-improvement-20261128-v1';
const list = value => Array.isArray(value) ? value : [];
const readJson = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));

export function comparisonUrls(receipt, compareRunId) {
  if (receipt?.check !== comparisonName || receipt.runId !== compareRunId
    || !['completed', 'budget-limited'].includes(receipt.status)
    || !Array.isArray(receipt.links) || receipt.links.length !== receipt.unseenLinks
    || !Array.isArray(receipt.comparisons) || receipt.comparisons.length > 6) {
    throw new Error('Expected completed exact query comparison receipt');
  }
  const validLink = url => typeof url === 'string' && normalizeInstagramTavilyUrl(url) === url;
  const unseen = new Set(receipt.links);
  const keys = new Set(receipt.links.map(canonicalInstagramPostKey));
  if (receipt.links.length !== keys.size || !receipt.links.every(validLink)) throw new Error('Expected unique canonical originals');
  const successful = receipt.comparisons.filter(row => row?.status === 'completed' && row.httpStatus === 200);
  if (!successful.length || successful.some(row => !Array.isArray(row.links) || !row.links.every(validLink))) {
    throw new Error('Expected successful comparison responses with canonical originals');
  }
  const byQuery = successful.map(row => row.links.filter(url => unseen.has(url)));
  const max = Math.max(0, ...byQuery.map(links => links.length));
  // Read across successful variants before trying more from the same result page.
  const ordered = new Set();
  for (let index = 0; index < max; index++) for (const links of byQuery) {
    if (links[index]) ordered.add(links[index]);
  }
  if (ordered.size !== unseen.size) throw new Error('Original link missing from completed comparison responses');
  return [...ordered];
}

export function addPreviouslyReviewedInstagram(inventory, { graph, aiReport, previousComparison, priorDirect,
  priorRenderedFirst, priorRenderedRemaining, tavilyCache, now = new Date() } = {}) {
  const graphPosts = Object.values(graph?.sources || {}).flatMap(source => list(source?.rows))
    .map(row => ({ permalink: row?.permalink || row?.url })).filter(row => row.permalink);
  const reviewedPosts = [aiReport?.terminalRejected, aiReport?.freshRejected, aiReport?.rejected,
    priorDirect?.rows, priorRenderedFirst?.rows, priorRenderedRemaining?.rows]
    .flatMap(list).concat(list(previousComparison?.links).map(url => ({ url })), getInstagramTavilyLeads(tavilyCache, now));
  return { ...inventory, graphPosts: [...list(inventory.graphPosts), ...graphPosts],
    reviewedPosts: [...list(inventory.reviewedPosts), ...reviewedPosts] };
}

export async function verifyInstagramQueryOffers({ receipt, compareRunId, ...options } = {}) {
  const urls = comparisonUrls(receipt, compareRunId);
  const result = await verifyRenderedInstagramTavilyLinks({ ...options, urls, maxSourceReads: cap });
  result.report.compareRunId = compareRunId;
  result.report.maxBrowserNavigations = cap;
  return result;
}

function writeJson(file, value, exclusive = false) {
  const temporary = exclusive ? file : file + '.tmp-' + process.pid;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
    if (!exclusive) fs.renameSync(temporary, file);
  } finally {
    if (!exclusive) fs.rmSync(temporary, { force: true });
  }
}

async function main() {
  const [action, compareRunId, receiptSha256, ...extra] = process.argv.slice(2);
  const { GITHUB_EVENT_NAME, GITHUB_REF, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT, GITHUB_OUTPUT } = process.env;
  if (!['--claim', '--run'].includes(action) || !/^\d+$/.test(compareRunId || '') || !/^[0-9a-f]{64}$/.test(receiptSha256 || '')
    || extra.length || GITHUB_EVENT_NAME !== 'workflow_dispatch' || GITHUB_REF !== 'refs/heads/main'
    || GITHUB_RUN_ATTEMPT !== '1' || !/^\d+$/.test(GITHUB_RUN_ID || '') || !GITHUB_OUTPUT) {
    throw new Error('Expected explicit first main-branch verification invocation');
  }
  const raw = fs.readFileSync(receiptPath);
  if (createHash('sha256').update(raw).digest('hex') !== receiptSha256) throw new Error('Unexpected comparison receipt digest');
  const receipt = JSON.parse(raw);
  comparisonUrls(receipt, compareRunId);
  const claim = { version: 1, runId: GITHUB_RUN_ID, compareRunId, receiptSha256, maxBrowserNavigations: cap };
  if (action === '--claim') {
    try { writeJson(claimPath, { ...claim, claimedAt: new Date().toISOString() }, true); }
    catch (error) { if (error.code === 'EEXIST') return; throw error; }
    fs.appendFileSync(GITHUB_OUTPUT, 'claimed=true\n');
    return;
  }
  const storedClaim = readJson(claimPath);
  if (Object.entries(claim).some(([key, value]) => storedClaim?.[key] !== value)) {
    throw new Error('Missing exact query-original verification claim');
  }
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, '.' + basename + '.started'), GITHUB_RUN_ID + '\n', { flag: 'wx' });
  const now = new Date();
  const previousReport = readJson(reportPath);
  const inventory = addPreviouslyReviewedInstagram(loadRenderedTavilyInventory('docs'), {
    graph: readJson('docs/meta-instagram-scan-state.json'), aiReport: previousReport,
    previousComparison: readJson('source-state/instagram-tavily-investigation-result.json'),
    priorDirect: readJson('source-state/instagram-tavily-offer-verification-result.json'),
    priorRenderedFirst: readJson('source-state/instagram-tavily-render-first-result.json'),
    priorRenderedRemaining: readJson('source-state/instagram-tavily-render-remaining-result.json'),
    tavilyCache: readJson(INSTAGRAM_TAVILY_CACHE), now,
  });
  const result = await verifyInstagramQueryOffers({ receipt, compareRunId, inventory, now, previousReport,
    cookies: loadInstagramCookieHints(), moderation: loadDealModeration(),
    relatedReport: readJson('docs/instagram-discovery-report.json'), healthReport: readJson('docs/instagram-auth-health.json'),
  });
  if (result.webAccessChanged) {
    const latest = readJson(reportPath);
    const webAccess = { ...latest.webAccess };
    let changed = false;
    for (const [scope, pause] of Object.entries(result.webAccessChanges)) {
      if (Date.parse(pause.nextRetryAt) <= (Date.parse(webAccess[scope]?.nextRetryAt) || 0)) continue;
      webAccess[scope] = pause;
      changed = true;
    }
    if (changed) {
      writeJson(reportPath, { ...latest, webAccess });
      fs.appendFileSync(GITHUB_OUTPUT, 'web_access_changed=true\n');
    }
  }
  const { report, candidates } = result;
  writeJson(path.join(output, basename + '.json'), report);
  writeJson(path.join(output, basename + '.candidates.json'), { version: 1, compareRunId, checkedAt: report.checkedAt, candidates });
  console.log(JSON.stringify({ compareRunId, browserNavigations: report.browserNavigations,
    knownLinks: report.knownLinks, verifiedNewOffers: report.verifiedNewOffers,
    outcomes: report.rows.map(({ url, status, reason, httpStatus }) => ({ url, status, reason, httpStatus })) }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('Instagram query original verification could not be completed'); process.exitCode = 1; });
}

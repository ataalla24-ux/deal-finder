import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createInstagramWebAccess } from '../scraper/instagram-web-access-policy.js';
import { investigateInstagramTavily, INSTAGRAM_TAVILY_INVESTIGATION,
  INSTAGRAM_TAVILY_INVESTIGATION_STATE as stateFile } from '../scraper/instagram-tavily-investigation.js';
import { INSTAGRAM_TAVILY_CACHE, readInstagramTavilyCache, updateInstagramTavilyCache,
  writeInstagramTavilyCache } from '../scraper/instagram-tavily-index.js';

export function claimInstagramTavilyInvestigation(previous, runId, now = new Date()) {
  if (previous !== undefined) return null;
  if (!/^\d+$/.test(runId || '')) throw new Error('Invalid diagnostic run');
  return { investigation: INSTAGRAM_TAVILY_INVESTIGATION, runId, status: 'claimed',
    claimedAt: now.toISOString(), maximumSearchRequests: 4 };
}

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const resultFile = 'source-state/instagram-tavily-investigation-result.json';
async function main() {
  if (process.env.GITHUB_REF !== 'refs/heads/main' || process.env.GITHUB_RUN_ATTEMPT !== '1') {
    throw new Error('Fresh explicit main-branch workflow required');
  }
  const runId = process.env.GITHUB_RUN_ID;
  if (process.argv.includes('--claim')) {
    const prior = fs.existsSync(stateFile) ? read(stateFile) : undefined;
    const claim = claimInstagramTavilyInvestigation(prior, runId);
    if (!claim) { console.log('Investigation already claimed; no provider calls.'); return; }
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(claim, null, 2) + '\n', { flag: 'wx' });
    fs.appendFileSync(process.env.GITHUB_OUTPUT, 'claimed=true\n');
    return;
  }
  if (!process.argv.includes('--run')) throw new Error('Explicit diagnostic action required');
  const claim = read(stateFile);
  if (claim.investigation !== INSTAGRAM_TAVILY_INVESTIGATION || claim.runId !== runId
    || claim.status !== 'claimed' || fs.existsSync(resultFile)) {
    throw new Error('Matching durable investigation claim required');
  }
  const cache = readInstagramTavilyCache(INSTAGRAM_TAVILY_CACHE);
  if (cache?.version !== 1 || !Number.isFinite(Date.parse(cache.lastProbeAt))) {
    throw new Error('The original persisted probe is required for comparison');
  }
  const previous = read('docs/tiktok-scanner-report.json').tavilyDiscovery || {};
  const instagram = read('docs/instagram-ai-report.json');
  const access = createInstagramWebAccess({ previousReport: instagram,
    relatedReport: read('docs/instagram-discovery-report.json'),
    healthReport: read('docs/instagram-auth-health.json') });
  const report = await investigateInstagramTavily({ cache, previous,
    instagramHoldUntil: access.pause('profiles')?.nextRetryAt || '',
    apiKey: process.env.TAVILY_API_KEY,
    freePlanConfirmed: process.env.TIKTOK_TAVILY_FREE_PLAN_CONFIRMED === '1' });
  const directory = 'output/social-discovery';
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(directory + '/instagram-tavily-investigation.json', JSON.stringify(report, null, 2) + '\n');
  // The claim was already pushed from this checkout. Keep it immutable: the
  // generated-state committer correctly rejects overwriting that newer remote
  // path against the runner's pre-claim HEAD. Results have a separate path.
  fs.writeFileSync(resultFile, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  const updated = updateInstagramTavilyCache(cache, { nextRetryAt: report.nextRetryAt,
    instagramIndex: { attemptedQueries: report.attemptedQueries, links: report.links } });
  if (updated) writeInstagramTavilyCache(INSTAGRAM_TAVILY_CACHE, updated);
  console.log(JSON.stringify(report, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('Bounded Instagram comparison failed; claim remains consumed.'); process.exitCode = 1; });
}

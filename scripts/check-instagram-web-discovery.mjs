// The collector writes only to this disposable validation checkout.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { canonicalInstagramPostKey } from '../scraper/deal-evidence-utils.js';

function read(file) {
  try { return JSON.parse(fs.readFileSync('docs/' + file + '.json', 'utf8')); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return {};
  }
}

const before = read('instagram-discovery-report');
const search = read('instagram-ai-report').search || {};
const known = new Set([
  ...(read('deals').deals || []),
  ...(read('deals-pending-all').deals || []),
  ...(read('deals-pending-instagram-discovery').deals || []),
  ...(read('deal-candidates-index').candidates || []),
].map(row => canonicalInstagramPostKey(row.url || row.postUrl)).filter(Boolean));

for (const key of read('slack-seen-posts').seenPostKeys || []) {
  const match = /^instagram:(?:(?:p|reel|tv):)?([A-Za-z0-9_-]{5,20})$/.exec(key);
  if (match) known.add('instagram:' + match[1]);
}

const result = spawnSync(process.execPath, ['scraper/instagram-daily-sync.js'], {
  stdio: 'inherit',
  env: { ...process.env, IG_MAX_PAGE_VISITS: '12', IG_MAX_SOURCES_TOTAL: '3', IG_SOURCE_DELAY_MS: '1800' },
});
const after = read('instagram-discovery-report');
const ran = after.updatedAt !== before.updatedAt && after.github?.runId === process.env.GITHUB_RUN_ID;
const discovered = new Map();
for (const candidate of ran ? after.candidates || [] : []) {
  const key = canonicalInstagramPostKey(candidate.url);
  if (key && !known.has(key)) discovered.set(key, { url: candidate.url, pubDate: candidate.pubDate });
}

const evidence = {
  checkedAt: new Date().toISOString(),
  provenance: ran ? after.github : null,
  status: result.status !== 0 ? 'probe-failed' : ran ? after.status : 'deferred-before-navigation',
  visitedProfiles: ran ? after.visitedSources : 0,
  profileNavigation: ran ? after.profileNavigation : {},
  profilesWithPostLinks: ran ? after.readableProfiles : 0,
  visitedPosts: ran ? after.visitedPosts : 0,
  acceptedFromThisRun: ran ? after.scrapedDealsRaw : 0,
  novelOffers: [...discovered.values()],
  websiteAccess: after.webAccess || {},
  webSearchRetryAt: search.nextRetryAt || '',
};

fs.mkdirSync('output/social-discovery', { recursive: true });
fs.writeFileSync('output/social-discovery/instagram-web.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
if (result.status !== 0) process.exitCode = 1;

import fs from 'node:fs';
import {
  buildHeuristicDeal, enrichPreviews, knownInstagramPosts, searchDuckDuckGo,
} from '../scraper/instagram-ai-agent.js';
import { runInstagramSearchQueries } from '../scraper/instagram-search-discovery.js';
import { canonicalInstagramPostKey } from '../scraper/deal-evidence-utils.js';
import { filterModeratedDeals, loadDealModeration } from '../scraper/deal-moderation-utils.js';
import { githubRunProvenance } from '../scraper/pipeline-run-report-utils.js';

function read(file) {
  return JSON.parse(fs.readFileSync('docs/' + file + '.json', 'utf8'));
}

const previous = read('instagram-ai-report');
const saved = previous.search || {};
const queries = Array.isArray(saved.queries) && saved.queries.length
  ? saved.queries : ['site:instagram.com/reel wien gratis kaffee'];
const index = Math.max(0, Math.floor(Number(saved.nextQueryIndex) || 0)) % queries.length;
const { candidates, ...attempt } = await runInstagramSearchQueries([queries[index]], {
  previousReport: previous,
  search: searchDuckDuckGo,
});
if (attempt.attemptedQueries) {
  const file = 'docs/instagram-ai-report.json';
  // This job shares the normal collector's concurrency group. Persist the
  // decision before additional reads so automation cannot repeat an early trial.
  const report = {
    ...previous,
    search: {
      ...saved,
      ...attempt,
      boundedRetry: attempt.boundedRetry || null,
      checkedBy: githubRunProvenance(),
      nextQueryIndex: (index + 1) % queries.length,
      discovered: candidates.length,
    },
  };
  const temporary = file + '.search-probe.tmp';
  fs.writeFileSync(temporary, JSON.stringify(report, null, 2) + '\n');
  fs.renameSync(temporary, file);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'attempted=true\n');
}

const known = knownInstagramPosts({
  live: read('deals').deals,
  pending: read('deals-pending-all').deals,
  seen: read('slack-seen-posts'),
});
for (const candidate of read('deal-candidates-index').candidates || []) {
  const key = canonicalInstagramPostKey(candidate.url || candidate.postUrl);
  if (key) known.set(key, 'previously-indexed');
}

const novelLinks = [...new Map(candidates.flatMap(candidate =>
  candidate.key && !known.has(candidate.key) ? [[candidate.key, candidate]] : [])).values()];
const sampled = novelLinks.slice(0, 3);
const previewed = await enrichPreviews(sampled, { maxFetches: 3 });
const accepted = sampled.filter(candidate => candidate.preview?.status === 200 && !candidate.preview.loginWall)
  .map(buildHeuristicDeal).filter(Boolean);
const { deals } = filterModeratedDeals(accepted, loadDealModeration());
const output = {
  checkedAt: new Date().toISOString(),
  provenance: githubRunProvenance(),
  search: attempt,
  foundLinks: candidates.length,
  novelLinks: novelLinks.length,
  previewAttempts: previewed.stats.attempted,
  novelOffers: deals.map(({ url, pubDate, title }) => ({ url, pubDate, title })),
};
fs.mkdirSync('output/social-discovery', { recursive: true });
fs.writeFileSync('output/social-discovery/instagram-search.json', JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(output, null, 2));

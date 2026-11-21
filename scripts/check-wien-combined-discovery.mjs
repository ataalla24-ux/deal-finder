import fs from 'node:fs';
import { runWienDealsCombined } from '../scraper/wien-deals-combined.js';
import { canonicalInstagramPostKey } from '../scraper/deal-evidence-utils.js';

function read(file) {
  try { return JSON.parse(fs.readFileSync('docs/' + file + '.json', 'utf8')); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return {};
  }
}

const known = new Set([
  ...(read('deals').deals || []),
  ...(read('deals-pending-all').deals || []),
  ...(read('deals-pending-wien-combined').deals || []),
  ...(read('deal-candidates-index').candidates || []),
].map(row => canonicalInstagramPostKey(row.url || row.postUrl)).filter(Boolean));
for (const key of read('slack-seen-posts').seenPostKeys || []) {
  const match = /^instagram:(?:(?:p|reel|tv):)?([A-Za-z0-9_-]{5,20})$/.exec(key);
  if (match) known.add('instagram:' + match[1]);
}

const { payload, report } = await runWienDealsCombined({
  write: false,
  env: { ...process.env, OPENAI_API_KEY: '', WIEN_COMBINED_MEDIA_LLM_MAX_CALLS_PER_RUN: '0' },
});
const novelOffers = (payload?.deals || []).flatMap(deal => {
  const key = canonicalInstagramPostKey(deal.url);
  return key && !known.has(key) ? [{ url: deal.url, pubDate: deal.pubDate }] : [];
});
const evidence = {
  checkedAt: new Date().toISOString(),
  status: report.status,
  freshGraphPosts: report.fetchedPosts - report.cachedGraphPosts,
  cachedGraphPosts: report.cachedGraphPosts,
  acceptedOffers: payload?.totalDeals || 0,
  novelOffers,
  quota: report.sharedQuota,
  sources: report.sources.map(({ hashtag, status, error }) => ({ hashtag, status, error })),
};
fs.mkdirSync('output/social-discovery', { recursive: true });
fs.writeFileSync('output/social-discovery/wien-combined.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));

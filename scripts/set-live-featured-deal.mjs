import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFeaturedDealEligibility, getViennaDayKey, getViennaWeekKey, normalizeFeaturedDeal } from '../scraper/set-daily-deal.js';

export async function buildLiveFeaturedPick(deals, dealId, kind, now = new Date()) {
  if (!['daily', 'weekly'].includes(kind)) throw new Error('Invalid featured kind');
  const deal = deals.find((row) => row.id === dealId);
  if (!deal) throw new Error('Deal is no longer live');
  const eligibility = await getFeaturedDealEligibility(deal, kind, { llmEnabled: false, now });
  if (!eligibility.eligible) throw new Error(`Deal cannot be featured: ${eligibility.reason}`);
  const normalized = normalizeFeaturedDeal(deal);
  return {
    ...(kind === 'daily' ? { date: getViennaDayKey(now) } : { week: getViennaWeekKey(now) }),
    dealId,
    ...Object.fromEntries(['brand', 'title', 'description', 'url', 'category', 'type', 'distance', 'logo', 'logoUrl']
      .map((key) => [key, normalized[key] || (key === 'distance' ? 'Wien' : '')])),
    manualPick: true,
    selectionReason: 'slack-live-review',
    pickedAt: now.toISOString(),
    eligibility,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { dealId, kind } = JSON.parse(process.env.FEATURED_PICK_PAYLOAD || '{}');
  const feed = JSON.parse(fs.readFileSync('docs/deals.json', 'utf8'));
  const pick = await buildLiveFeaturedPick(feed.deals, dealId, kind);
  fs.writeFileSync(`docs/deal-of-the-${kind === 'daily' ? 'day' : 'week'}.json`, `${JSON.stringify(pick, null, 2)}\n`);
  console.log(`Selected ${kind}: ${dealId}`);
}

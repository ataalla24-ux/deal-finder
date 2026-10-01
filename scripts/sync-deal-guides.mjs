import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function applyGuides(deals, guides, available, now = Date.now()) {
  return deals.map(deal => {
    const next = { ...deal };
    delete next.guideUrl;
    delete next.guideReviewUntil;
    const guide = guides.find(g => g.id === deal.id && g.title === deal.title
      && g.sourceUrl === deal.url && Date.parse(g.reviewUntil) > now
      && /^[a-z0-9-]+$/.test(g.slug) && available.has(g.slug));
    if (guide && deal.approvedAt) {
      next.guideUrl = `https://freefinder.at/blog/${guide.slug}.html`;
      next.guideReviewUntil = guide.reviewUntil;
    }
    return next;
  });
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const guides = JSON.parse(fs.readFileSync(path.join(root, 'reviews/deal-guides.json'))).guides;
  const available = new Set();
  for (const g of guides) {
    if (Date.parse(g.reviewUntil) <= Date.now() || !/^[a-z0-9-]+$/.test(g.slug)) continue;
    try {
      const response = await fetch(`https://freefinder.at/blog/${g.slug}.html`, {
        redirect: 'error', signal: AbortSignal.timeout(8000),
      });
      const html = await response.text();
      if (response.ok && html.includes(`data-guide-reviewed="${g.reviewedAt}"`)
        && html.includes(g.sourceUrl)) available.add(g.slug);
    } catch { /* An unreachable guide must never replace the original destination. */ }
  }
  const feedPath = path.join(root, 'docs/deals.json');
  const feed = JSON.parse(fs.readFileSync(feedPath));
  feed.deals = applyGuides(feed.deals, guides, available);
  fs.writeFileSync(feedPath, JSON.stringify(feed, null, 2) + '\n');
  const candidates = feed.deals.filter(d => d.approvedAt && !d.guideUrl
    && /omv|ikea/i.test(d.brand || '')).map(d => ({ id: d.id, title: d.title,
      sourceUrl: d.url, status: 'needs-source-review', reason: 'No current approved matching guide' }));
  fs.writeFileSync(path.join(root, 'reviews/deal-guide-candidates.json'), JSON.stringify({ candidates }, null, 2) + '\n');
  console.log(`Verified deal guides: ${feed.deals.filter(d => d.guideUrl).length}; review candidates: ${candidates.length}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();

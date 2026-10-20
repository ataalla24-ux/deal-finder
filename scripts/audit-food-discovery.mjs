import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { filterDiscoveryDeals, foodDiscoveryPriority } from '../scraper/deal-discovery-policy.js';

// Offline policy preview only: no network, Slack delivery or state changes.
const docs = fileURLToPath(new URL('../docs/', import.meta.url));
const files = fs.readdirSync(docs).filter(f => /^deals-pending-.*\.json$/.test(f)
  || /^deals-review-(?:firecrawl4|social-food)\.json$/.test(f)).sort();
const unique = new Map();
for (const file of files) {
  const data = JSON.parse(fs.readFileSync(path.join(docs, file), 'utf8'));
  for (const deal of Array.isArray(data) ? data : data.deals || []) {
    const key = deal.id || `${deal.url}|${deal.title}`;
    // Queue copy includes the latest human edits; retain it over raw candidates.
    if (!unique.has(key) || file === 'deals-pending-all.json') unique.set(key, { ...deal, auditFile: file });
  }
}
const result = filterDiscoveryDeals([...unique.values()]);
console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  mode: 'offline-policy-preview-no-sends',
  files: files.length,
  uniqueCandidatesIncludingHistory: unique.size,
  retained: result.deals.length,
  retainedFoodPriority: result.deals.filter(d => foodDiscoveryPriority(d)).length,
  excluded: result.removed.length,
  reasonCounts: result.reasonCounts,
  excludedCandidates: result.removed.map(({ deal, reason }) => ({
    id: deal.id, title: deal.title, reason, file: deal.auditFile,
    previouslyPosted: Boolean(deal.slackTs), url: deal.url,
  })),
  note: 'Includes old and already posted records; counts are not new discoveries or currently valid deals. Live feed and Slack history remain unchanged.',
}, null, 2));

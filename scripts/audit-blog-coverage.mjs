import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { backfillGuides } from './blog-backfill-20261018.mjs';
import { catchupGuides } from './blog-backfill-20261030.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const digest = value => createHash('sha256').update(value).digest('hex');
const contentHash = d => digest(JSON.stringify([d.title, d.description, d.url, d.validUntil, d.expires]));
const reviewFile = 'reviews/blog-coverage-2026-10-30.json';
const feedText = read('docs/deals.json');
const feed = JSON.parse(feedText);
const previous = JSON.parse(read('reviews/blog-backfill-2026-10-18.json'));
const mapping = new Map(Object.entries(previous.existingCoverage));
for (const guide of [...backfillGuides, ...catchupGuides]) {
  for (const id of guide.ids) mapping.set(id, guide.slug);
}
for (const id of ['power-food-eca409ce31f3', 'power-food-fea2efd7d1c2']) mapping.set(id, 'nordsee-coupons-wien');
const holds = {
  'g2-3dn8v3': 'Owner-retained Wolt record; expiry and current discount unresolved. No feed change or current-offer article.',
  'gs-344271': 'weloveholidays: merchant redemption conditions not freshly confirmed.',
  'gs-567555': 'INTERSPORT: the claimed 15 percent offer was not found in the current source; do not substitute another promotion.',
  'gs-565332': 'Pets Deli: current source does not establish the claimed 40 percent. Do not confuse a 40-euro referral with 40 percent.',
  'fc4g-17quqdp': 'Meter offer: exact merchant, product and location remain unidentified.',
  'g2-ezkkws': 'Honu: January-2026 campaign URL is not evidence of a current October offer.',
  'g2-mpwntm': 'Marden: retained Lieferando prices not freshly confirmed; no new current-price article.',
  'benefit-drei-plus-j3z6si': 'Schuelerhilfe: paid minimum six-month contract; official main terms and old FAQ deadline conflict. Confirm participation before promotion.',
};
const directory = new Set(['hillsong-vienna-kirche', 'cig-wien-kirche', 'icf-wien-kirche', 'jesuszentrum-events']);

if (process.argv.includes('--write-review')) {
  const entries = feed.deals.map(d => {
    const base = { id: d.id, observedTitle: d.title, source: d.url, contentHash: contentHash(d) };
    const slug = mapping.get(d.id);
    if (slug) {
      if (!fs.existsSync(path.join(root, 'docs/blog', `${slug}.html`))) throw new Error(`Missing guide: ${slug}`);
      return { ...base, status: 'covered', slug };
    }
    if (directory.has(d.id)) return { ...base, status: 'informational-not-promotion', reason: 'Church/community directory entry, not a specific discount. Do not manufacture a coupon article.' };
    if (d.id.startsWith('flight-')) return { ...base, status: 'held', reason: 'Cached flight price without a fresh bookable quote. No current fare promise.' };
    if (holds[d.id]) return { ...base, status: 'held', reason: holds[d.id] };
    return { ...base, status: 'needs-review', reason: 'No individually reviewed coverage or hold decision.' };
  });
  fs.writeFileSync(path.join(root, reviewFile), JSON.stringify({
    reviewedAt: '2026-10-30', feedLastUpdated: feed.lastUpdated, feedSha256: digest(feedText),
    note: 'Coverage means matching article existence, not current verification of every historical offer. New social articles disclose retained evidence; portal articles are not redemption tests. No feed, featured-selection, native or Store change.',
    entries,
  }, null, 2) + '\n');
}
const review = JSON.parse(read(reviewFile));
const reviewed = new Map(review.entries.map(entry => [entry.id, entry]));
if (reviewed.size !== review.entries.length) throw new Error('Duplicate review IDs');
const result = { total: feed.deals.length, covered: 0, held: 0, informational: 0, missing: [], changed: [] };
for (const deal of feed.deals) {
  const entry = reviewed.get(deal.id);
  if (!entry) { result.missing.push({ id: deal.id, title: deal.title }); continue; }
  if (entry.contentHash !== contentHash(deal)) result.changed.push({ id: deal.id, title: deal.title });
  if (entry.status === 'covered') {
    if (!fs.existsSync(path.join(root, 'docs/blog', `${entry.slug}.html`))) throw new Error(`Missing article for ${deal.id}`);
    result.covered++;
  } else if (entry.status === 'held') result.held++;
  else if (entry.status === 'informational-not-promotion') result.informational++;
  else result.missing.push({ id: deal.id, title: deal.title });
}
console.log(JSON.stringify(result, null, 2));
if (process.argv.includes('--strict') && (result.missing.length || result.changed.length)) process.exitCode = 1;

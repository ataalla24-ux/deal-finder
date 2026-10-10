import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { activeBusinessDeals } from './deal-map-business.mjs';
import { locationFingerprint } from './deal-map-enrichment.mjs';

const read = async file => JSON.parse(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'));
const feed = await read('docs/deals.json');
const map = await read('docs/deal-map-locations.json');
const report = await read('reviews/map-coverage.json');
let business = {};
try { business = await read('reviews/map-business-campaigns.json'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const deals = [...feed.deals, ...activeBusinessDeals(business)];
assert.equal(report.totalDeals, deals.length, 'Coverage must account for every current deal');
assert.equal(report.deals.length, deals.length, 'Coverage cannot silently omit a deal');
assert.equal(new Set(report.deals.map(row => row.id)).size, deals.length, 'Coverage cannot duplicate deals');
const mapped = new Set(map.locations.flatMap(location => location.dealIds || []));
const exclusions = map.geocodingExclusions || [];
assert.equal(new Set(exclusions.map(entry => entry.dealId)).size, exclusions.length, 'Duplicate geocoding exclusion');
for (const entry of exclusions) {
  const deal = deals.find(deal => deal.id === entry.dealId);
  assert.ok(deal, `Geocoding exclusion references a missing deal: ${entry.dealId}`);
  assert.equal(entry.fingerprint, locationFingerprint(deal), `Stale geocoding exclusion: ${entry.dealId}`);
  assert.ok(!mapped.has(entry.dealId), `Active mapped deal unnecessarily excluded: ${entry.dealId}`);
}
for (const deal of deals) {
  const row = report.deals.find(entry => entry.id === deal.id);
  assert.ok(row, `Missing map disposition: ${deal.id}`);
  assert.equal(row.fingerprint, locationFingerprint(deal), `Stale map disposition: ${deal.id}`);
  assert.equal(row.locationCount > 0, mapped.has(deal.id), `Map/report mismatch: ${deal.id}`);
  assert.equal(row.needsReview, !['mapped', 'online-only'].includes(row.status), `Unresolved deal not reported: ${deal.id}`);
}
console.log(`Every deal accounted for: ${report.mappedDeals} mapped, ${report.onlineDeals} online, ${report.unresolvedDeals} for review.`);

import { readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { enrichMap } from './deal-map-enrichment.mjs';
import { activeBusinessDeals, refreshBusinessSnapshot } from './deal-map-business.mjs';

const root = new URL('../', import.meta.url);
const read = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const optional = async path => { try { return await read(path); } catch (e) { if (e.code === 'ENOENT') return {}; throw e; } };
async function save(path, data) {
  const file = fileURLToPath(new URL(path, root));
  const content = JSON.stringify(data, null, 2) + '\n';
  try { if (await readFile(file, 'utf8') === content) return; } catch (e) { if (e.code !== 'ENOENT') throw e; }
  await writeFile(`${file}.tmp`, content);
  await rename(`${file}.tmp`, file);
}
const now = new Date();
const regularDeals = (await read('docs/deals.json')).deals;
let business = await optional('reviews/map-business-campaigns.json');
if (process.env.MAP_REFRESH_BUSINESS === '1') {
  const refresh = await refreshBusinessSnapshot({ snapshot: business, now });
  business = refresh.snapshot;
  if (refresh.error) console.warn(`Business map refresh deferred: ${refresh.error}`);
  await save('reviews/map-business-campaigns.json', business);
}
const deals = [...regularDeals, ...activeBusinessDeals(business, now)];
const map = await read('docs/deal-map-locations.json');
const catalog = await optional('reviews/map-location-catalog.json');
const reviewed = await optional('reviews/map-addresses.json');
const sourceCache = await optional('reviews/map-source-address-cache.json');
// Approval stays fast: network source discovery belongs to scheduled reconciliation.
const sourceBudget = Math.max(0, Math.min(20, Number(process.env.MAP_SOURCE_REQUESTS) || 0));
const { enrichSourceAddresses } = await import('./deal-map-source-addresses.mjs');
const sources = await enrichSourceAddresses({ deals, map, catalog, reviewed, cache: sourceCache, now, maxRequests: sourceBudget });
const result = await enrichMap({ deals, map, catalog, reviewed: sources.reviewed,
  cache: await optional('reviews/map-geocode-cache.json'), now,
  maxRequests: Math.max(0, Math.min(40, Number(process.env.MAP_GEOCODE_REQUESTS ?? 8) || 0)) });
result.report.regularDeals = regularDeals.length;
result.report.businessDeals = deals.length - regularDeals.length;
result.report.sourceDiscovery = sources.report;
await save('docs/deal-map-locations.json', result.map);
await save('reviews/map-geocode-cache.json', result.cache);
await save('reviews/map-location-catalog.json', result.catalog);
await save('reviews/map-source-address-cache.json', sources.cache);
await save('reviews/map-coverage.json', result.report);
console.log(`Map: ${result.report.mappedDeals}/${result.report.totalDeals} deals, ${result.report.locations} locations, ${result.requests} address lookups. Unresolved addresses remain in the feed.`);

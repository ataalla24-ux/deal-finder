import { readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { enrichMap } from './deal-map-enrichment.mjs';

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
const result = await enrichMap({ deals: (await read('docs/deals.json')).deals,
  map: await read('docs/deal-map-locations.json'),
  reviewed: await optional('reviews/map-addresses.json'), cache: await optional('reviews/map-geocode-cache.json') });
await save('docs/deal-map-locations.json', result.map);
await save('reviews/map-geocode-cache.json', result.cache);
await save('reviews/map-coverage.json', result.report);
console.log(`Map: ${result.report.mappedDeals}/${result.report.totalDeals} deals, ${result.report.locations} locations, ${result.requests} address lookups. Unresolved addresses remain in the feed.`);

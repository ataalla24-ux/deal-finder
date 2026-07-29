import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mapPath = path.join(root, 'docs', 'deal-map-locations.json');
const dealsPath = path.join(root, 'docs', 'deals.json');

const [mapPayload, dealsPayload] = await Promise.all(
  [mapPath, dealsPath].map(async (file) => JSON.parse(await readFile(file, 'utf8')))
);

const errors = [];
const locations = Array.isArray(mapPayload.locations) ? mapPayload.locations : [];
const liveDealIds = new Set((dealsPayload.deals || []).map((deal) => String(deal.id || '').trim()).filter(Boolean));
const locationIds = new Set();

if (mapPayload.schemaVersion !== 1) errors.push('schemaVersion must be 1');
if (!locations.length) errors.push('locations must not be empty');

for (const [index, location] of locations.entries()) {
  const label = `locations[${index}]`;
  const id = String(location.id || '').trim();
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  const dealIds = Array.isArray(location.dealIds) ? location.dealIds : [];
  const matchCount = ['brandMatches', 'titleMatches', 'placeMatches']
    .flatMap((key) => Array.isArray(location[key]) ? location[key] : [])
    .filter((value) => String(value || '').trim()).length;

  if (!id) errors.push(`${label}.id is required`);
  if (locationIds.has(id)) errors.push(`${label}.id is duplicated: ${id}`);
  locationIds.add(id);
  if (!String(location.name || '').trim()) errors.push(`${label}.name is required`);
  if (!String(location.address || '').trim()) errors.push(`${label}.address is required`);
  if (!Number.isFinite(latitude) || latitude < 48.10 || latitude > 48.35) {
    errors.push(`${label}.latitude must be inside the Vienna map bounds`);
  }
  if (!Number.isFinite(longitude) || longitude < 16.15 || longitude > 16.60) {
    errors.push(`${label}.longitude must be inside the Vienna map bounds`);
  }
  if (!String(location.source || '').trim()) errors.push(`${label}.source is required`);
  if (!(Number(location.confidence) >= 0.9 && Number(location.confidence) <= 1)) {
    errors.push(`${label}.confidence must be between 0.9 and 1`);
  }
  if (!dealIds.length && matchCount === 0) {
    errors.push(`${label} must reference a deal or include a matching rule`);
  }
  for (const dealId of dealIds) {
    if (!liveDealIds.has(dealId)) errors.push(`${label} references missing live deal: ${dealId}`);
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

const mappedDealIds = new Set(
  locations.flatMap((location) => Array.isArray(location.dealIds) ? location.dealIds : [])
);
console.log(`Validated ${locations.length} map locations and ${mappedDealIds.size} explicit live deal links.`);

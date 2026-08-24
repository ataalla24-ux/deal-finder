import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mapPath = path.join(root, 'docs', 'deal-map-locations.json');
const dealsPath = path.join(root, 'docs', 'deals.json');

const [mapPayload, dealsPayload] = await Promise.all(
  [mapPath, dealsPath].map(async (file) => JSON.parse(await readFile(file, 'utf8')))
);

const liveDeals = Array.isArray(dealsPayload.deals) ? dealsPayload.deals : [];
const liveDealIds = new Set(liveDeals.map((deal) => String(deal.id || '').trim()).filter(Boolean));
const removedReferences = [];
const addedReferences = [];
let changed = false;

function normalized(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function inferredLocationDealIds(location) {
  const brandMatches = (location.brandMatches || []).map(normalized).filter(Boolean);
  const titleMatches = (location.titleMatches || []).map(normalized).filter(Boolean);
  const placeMatches = (location.placeMatches || []).map(normalized).filter(Boolean);
  if (!brandMatches.length && !titleMatches.length && !placeMatches.length) return [];

  return liveDeals.filter((deal) => {
    const brand = normalized(deal.brand);
    const title = normalized(deal.title);
    const place = normalized([deal.address, deal.location, deal.distance].filter(Boolean).join(' '));
    return brandMatches.some((match) => brand === match)
      || titleMatches.some((match) => title.includes(match))
      || placeMatches.some((match) => place.includes(match));
  }).map((deal) => String(deal.id || '').trim()).filter(Boolean);
}

const locations = (mapPayload.locations || []).map((location) => {
  const next = { ...location };
  const dealIds = Array.isArray(location.dealIds) ? location.dealIds : [];
  next.dealIds = dealIds.filter((dealId) => {
    const keep = liveDealIds.has(String(dealId || '').trim());
    if (!keep) removedReferences.push({ locationId: location.id, dealId });
    return keep;
  });
  if (next.dealIds.length !== dealIds.length) changed = true;

  for (const dealId of inferredLocationDealIds(location)) {
    if (next.dealIds.includes(dealId)) continue;
    next.dealIds.push(dealId);
    addedReferences.push({ locationId: location.id, dealId });
    changed = true;
  }

  const isIkeaLocation = String(location.id || '').startsWith('ikea-');
  if (isIkeaLocation && next.chainId !== 'ikea-vienna-area') {
    next.chainId = 'ikea-vienna-area';
    changed = true;
  } else if (!isIkeaLocation && next.chainId === 'ikea-vienna-area') {
    delete next.chainId;
    delete next.officialLocationId;
    changed = true;
  }

  return next;
});

if (!changed) {
  console.log('Deal map references already match the live feed.');
  process.exit(0);
}

const nextPayload = {
  ...mapPayload,
  lastUpdated: new Date().toISOString(),
  locations,
};
const temporaryPath = `${mapPath}.tmp-${process.pid}`;
await writeFile(temporaryPath, `${JSON.stringify(nextPayload, null, 2)}\n`);
await rename(temporaryPath, mapPath);

console.log(`Removed ${removedReferences.length} stale map references and added ${addedReferences.length} verified references.`);
for (const item of removedReferences) {
  console.log(`- ${item.locationId}: ${item.dealId}`);
}
for (const item of addedReferences) {
  console.log(`+ ${item.locationId}: ${item.dealId}`);
}

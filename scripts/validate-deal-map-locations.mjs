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
const coverageByDealId = new Map();
const locationsByChainId = new Map();

const requiredChainCoverage = [
  {
    chainId: 'omv-vienna',
    minimumLocations: 21,
    dealCoverage: {
      'joe-omv-viva-free-taste-l62fzo': 21,
      'joe-omv-viva-free-taste-flur7': 21,
      'joe-omv-viva-free-taste-xipghf': 21,
      'joe-omv-viva-free-taste-6qmpsq': 21,
      'joe-omv-xlrh16': 17
    }
  },
  {
    chainId: 'nordsee-vienna-area',
    minimumLocations: 12,
    dealCoverage: {
      'g2-1ffpc0f': 12,
      'benefit-drei-plus-aekytk': 12
    }
  },
  {
    chainId: 'ikea-vienna-area',
    minimumLocations: 3,
    dealCoverage: {
      'g2-5ntng7': 3,
      'b1-s5vhj5': 2
    }
  }
];

if (mapPayload.schemaVersion !== 1) errors.push('schemaVersion must be 1');
if (!locations.length) errors.push('locations must not be empty');
if (Number.isNaN(Date.parse(mapPayload.lastUpdated))) errors.push('lastUpdated must be an ISO date');

for (const [index, location] of locations.entries()) {
  const label = `locations[${index}]`;
  const id = String(location.id || '').trim();
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  const dealIds = Array.isArray(location.dealIds) ? location.dealIds : [];

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
  const chainId = String(location.chainId || '').trim();
  if (chainId) {
    const chainLocations = locationsByChainId.get(chainId) || [];
    chainLocations.push(location);
    locationsByChainId.set(chainId, chainLocations);
  }
  if (!dealIds.length) {
    errors.push(`${label} must reference at least one active deal`);
  }
  for (const dealId of dealIds) {
    if (!liveDealIds.has(dealId)) errors.push(`${label} references missing live deal: ${dealId}`);
    coverageByDealId.set(dealId, (coverageByDealId.get(dealId) || 0) + 1);
  }
}

for (const requirement of requiredChainCoverage) {
  const chainLocations = locationsByChainId.get(requirement.chainId) || [];
  if (chainLocations.length < requirement.minimumLocations) {
    errors.push(
      `${requirement.chainId} must include at least ${requirement.minimumLocations} locations, found ${chainLocations.length}`
    );
  }
  for (const [dealId, minimumLocations] of Object.entries(requirement.dealCoverage)) {
    const actualLocations = coverageByDealId.get(dealId) || 0;
    if (actualLocations < minimumLocations) {
      errors.push(
        `${dealId} must be mapped to at least ${minimumLocations} locations, found ${actualLocations}`
      );
    }
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

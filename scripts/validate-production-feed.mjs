import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeDealsFeedVersion } from './deals-feed-contract.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docs = path.join(root, 'docs');
const now = Date.now();
const errors = [];
const warnings = [];

const readJson = async (name) => JSON.parse(await readFile(path.join(docs, name), 'utf8'));
const [feed, map, weekly, daily] = await Promise.all([
  readJson('deals.json'),
  readJson('deal-map-locations.json'),
  readJson('deal-of-the-week.json'),
  readJson('deal-of-the-day.json'),
]);

const deals = Array.isArray(feed.deals) ? feed.deals : [];
const allowedCategories = new Set([
  'essen', 'kaffee', 'trinken', 'getränke', 'getraenke', 'supermarkt', 'shopping',
  'beauty', 'fitness', 'reisen', 'kultur', 'events', 'kirche', 'gottesdienste',
  'gemeinde', 'technik', 'streaming', 'freizeit', 'bars',
]);
const allowedTypes = new Set(['gratis', 'freebie', 'rabatt', 'bogo', 'gutschein', 'event', 'info']);
const foodDrinkCategories = new Set(['essen', 'kaffee', 'trinken', 'getränke', 'getraenke', 'supermarkt', 'bars']);
const nonFoodSignals = /\b(kirche|gottesdienst|gemeinde|worship|fitness|museum|kino|ticket|flug|reise)\b/i;
const nonFoodOfferSignals = /\b(mini\s*golf|minigolf|golf|probetraining|fitness|museum|kino|ticket|festival|therme|flug|reise|shopping|parfum|beauty)\b/i;
const foodSignals = /\b(essen|food|drink|getränk|kaffee|espresso|latte|matcha|tee|eis|pizza|burger|wrap|restaurant|cafe|café|frühstück|brunch|bowl|lieferando|foodora|wolt)\b/i;
const htmlEntityPattern = /&(?:[a-z][a-z0-9]+|#\d+|#x[a-f0-9]+);/i;
const brandLogoUrlPrefix = 'https://freefinder.at/assets/brand-logos/';
const minimumBrandLogoDimension = 160;
const localBrandLogoFiles = new Set();

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalized(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function expiryTime(deal) {
  for (const value of [deal.expires, deal.validUntil, deal.validity?.expiryDate]) {
    const parsed = Date.parse(clean(value));
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
}

function isFoodDrink(deal) {
  const category = clean(deal.category).toLowerCase();
  const signal = [deal.brand, deal.title, deal.description, deal.category].map(clean).join(' ');
  const primarySignal = [deal.brand, deal.title, deal.type].map(clean).join(' ');
  if (nonFoodSignals.test(signal) && !foodDrinkCategories.has(category)) return false;
  if (nonFoodOfferSignals.test(primarySignal)) return false;
  if (['event', 'info'].includes(clean(deal.type).toLowerCase())) return false;
  return foodDrinkCategories.has(category) || foodSignals.test(signal);
}

function imageDimensions(buffer) {
  if (buffer.length >= 24 && buffer.toString('ascii', 1, 4) === 'PNG') {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

if (!Array.isArray(feed.deals)) errors.push('deals.json must contain a deals array');
if (feed.schemaVersion !== 1) errors.push('deals.json schemaVersion must be 1');
if (feed.totalDeals !== deals.length) errors.push(`totalDeals=${feed.totalDeals} but deals.length=${deals.length}`);
if (feed.feedVersion !== computeDealsFeedVersion(deals)) errors.push('feedVersion does not match the live deals payload');
if (Number.isNaN(Date.parse(feed.lastUpdated))) errors.push('deals.json lastUpdated must be an ISO date');

const ids = new Set();
const semanticKeys = new Map();
let validOk = 0;
let validWarning = 0;
let validMissing = 0;

for (const [index, deal] of deals.entries()) {
  const label = `deals[${index}]`;
  const id = clean(deal.id);
  for (const field of ['id', 'brand', 'title', 'url', 'category', 'type']) {
    if (!clean(deal[field])) errors.push(`${label}.${field} is required`);
  }
  if (ids.has(id)) errors.push(`${label}.id is duplicated: ${id}`);
  ids.add(id);

  try {
    const url = new URL(clean(deal.url));
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
  } catch {
    errors.push(`${label}.url is not a valid HTTP(S) URL`);
  }

  const category = clean(deal.category).toLowerCase();
  const type = clean(deal.type).toLowerCase();
  const brand = clean(deal.brand);
  if (!allowedCategories.has(category)) errors.push(`${label}.category is unsupported: ${category}`);
  if (!allowedTypes.has(type)) errors.push(`${label}.type is unsupported: ${type}`);
  if (/^@|^(?:online|wien|vienna|österreich|osterreich)(?:\s*[\/|,&-]\s*(?:online|wien|vienna|österreich|osterreich))*$|^attraktive preise warten$/i.test(brand)) {
    errors.push(`${id} has a source-like or generic provider: ${brand}`);
  }
  if (/\([^)]*$/.test(clean(deal.title))) errors.push(`${id} has a truncated title`);
  if (/\b(?:1\+1|buy (?:one|1) get (?:one|1))\b/i.test(clean(deal.title)) && type !== 'bogo') {
    errors.push(`${id} has 1+1 copy but type=${type}`);
  }

  const expiry = expiryTime(deal);
  if (expiry && expiry < now) errors.push(`${id} is expired but still live`);
  if (deal.validity?.status === 'invalid') errors.push(`${id} has validity.status=invalid`);
  if (deal.validity?.status === 'ok') validOk += 1;
  else if (deal.validity?.status === 'warning') validWarning += 1;
  else validMissing += 1;

  const key = `${normalized(deal.brand)}|${normalized(deal.title)}`;
  const matches = semanticKeys.get(key) || [];
  matches.push(id);
  semanticKeys.set(key, matches);

  const title = normalized(deal.title);
  const description = normalized(deal.description);
  if (description && (title === description || (description.length > 24 && title.includes(description)))) {
    warnings.push(`${id} repeats its title in the description`);
  }
  if (htmlEntityPattern.test(`${deal.title || ''} ${deal.description || ''}`)) {
    warnings.push(`${id} contains an undecoded HTML entity`);
  }
  if (/^[\w.]+:\s/i.test(clean(deal.title)) || clean(deal.title).length > 150) {
    warnings.push(`${id} still looks like an unnormalized social caption`);
  }
  if (clean(deal.description).length > 500) {
    warnings.push(`${id} has an excessively long card description`);
  }

  const logoUrl = clean(deal.logoUrl);
  if (logoUrl.startsWith(brandLogoUrlPrefix)) {
    const fileName = decodeURIComponent(logoUrl.slice(brandLogoUrlPrefix.length));
    if (!fileName || path.basename(fileName) !== fileName) errors.push(`${id} has an unsafe local logo path`);
    else localBrandLogoFiles.add(fileName);
  } else if (logoUrl) {
    warnings.push(`${id} still loads its logo from an external host`);
  }
}

for (const fileName of localBrandLogoFiles) {
  try {
    const buffer = await readFile(path.join(docs, 'assets', 'brand-logos', fileName));
    const dimensions = imageDimensions(buffer);
    if (!dimensions) errors.push(`brand logo has an unsupported image format: ${fileName}`);
    else if (dimensions.width < minimumBrandLogoDimension || dimensions.height < minimumBrandLogoDimension) {
      errors.push(`brand logo is too small (${dimensions.width}x${dimensions.height}): ${fileName}`);
    }
  } catch {
    errors.push(`brand logo file is missing: ${fileName}`);
  }
}

for (const [key, duplicateIds] of semanticKeys) {
  if (key !== '|' && duplicateIds.length > 1) {
    warnings.push(`possible duplicate deals: ${duplicateIds.join(', ')}`);
  }
}

function validateFeatured(payload, kind) {
  const id = clean(payload.dealId || payload.id);
  const deal = deals.find((candidate) => clean(candidate.id) === id);
  if (!deal) {
    errors.push(`${kind} deal references missing live deal: ${id || '(empty)'}`);
    return;
  }
  if (expiryTime(deal) && expiryTime(deal) < now) errors.push(`${kind} deal is expired: ${id}`);
  if (kind === 'weekly' && !isFoodDrink(deal)) errors.push(`weekly deal is not food/drink: ${id}`);
  const expected = {
    brand: deal.brand,
    title: deal.title,
    description: deal.description,
    url: deal.url,
    type: deal.type,
    category: deal.category || 'wien',
    distance: deal.distance || 'Wien',
    logo: deal.logo || (kind === 'weekly' ? '🔥' : '🎯'),
    logoUrl: deal.logoUrl || '',
  };
  for (const [field, value] of Object.entries(expected)) {
    if (clean(payload[field]) !== clean(value)) {
      errors.push(`${kind} deal ${field} is stale for live deal: ${id}`);
    }
  }
}

validateFeatured(weekly, 'weekly');
validateFeatured(daily, 'daily');

const mapDealIds = new Set();
for (const [index, location] of (map.locations || []).entries()) {
  for (const dealId of location.dealIds || []) {
    mapDealIds.add(clean(dealId));
    if (!ids.has(clean(dealId))) errors.push(`map locations[${index}] references missing live deal: ${dealId}`);
  }
}

const localPhysicalDeals = deals.filter((deal) => {
  const place = clean(deal.location || deal.distance).toLowerCase();
  return place && !/\b(online|österreich|austria|ganz wien|mehrere|multiple)\b/i.test(place);
});
const mappedPhysicalDeals = localPhysicalDeals.filter((deal) => mapDealIds.has(clean(deal.id)));
const mapCoverage = localPhysicalDeals.length
  ? Math.round((mappedPhysicalDeals.length / localPhysicalDeals.length) * 100)
  : 100;
if (mapCoverage < 50) warnings.push(`explicit map coverage is only ${mapCoverage}% (${mappedPhysicalDeals.length}/${localPhysicalDeals.length})`);

const report = {
  checkedAt: new Date().toISOString(),
  totalDeals: deals.length,
  errors: errors.length,
  warnings: warnings.length,
  validity: { ok: validOk, warning: validWarning, missing: validMissing },
  mapCoverage: { percent: mapCoverage, mapped: mappedPhysicalDeals.length, eligible: localPhysicalDeals.length },
};

console.log(JSON.stringify(report, null, 2));
for (const warning of warnings) console.warn(`WARNING: ${warning}`);
if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exit(1);
}

console.log('Production feed integrity passed.');

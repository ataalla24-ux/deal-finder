import '../sentry/instrument.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { cleanText, cleanUiNoiseText } from './deal-normalization-utils.js';
import {
  canonicalInstagramPostKey,
  extractInstagramProfileUsername,
  extractStructuredOwnerUsername,
  getPublicationEvidence,
  getViennaEvidence,
  mergeDealEvidence,
} from './deal-evidence-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const OUTPUT_PATH = path.join(DOCS_DIR, 'instagram-merchant-registry.json');

const FOOD_DRINK_KEYWORDS = [
  'restaurant', 'pizza', 'burger', 'kebab', 'kebap', 'döner', 'doener', 'sushi', 'cafe',
  'café', 'brunch', 'coffee', 'kaffee', 'croissant', 'frühstück', 'fruehstueck',
  'mittag', 'abendessen', 'essen', 'drink', 'cocktail', 'food', 'meal', 'snack',
  'eis', 'gelato', 'bubble tea', 'spritz', 'bakery',
];

const PROMO_KEYWORDS = [
  'gratis', 'kostenlos', 'free', 'freebie', 'geschenkt', '0€', '0 €', '1+1', 'bogo',
  '2 for 1', '2for1', 'happy hour', 'aktion', 'angebot', 'deal', 'gutschein', 'coupon',
  'voucher', 'opening offer', 'opening deal', 'neueröffnung', 'neueroeffnung',
  'eröffnung', 'eroeffnung', 'grand opening', 'soft opening',
];

const INPUT_FILES = [
  'deals.json',
  'deals-pending-all.json',
  'deals-pending-gastro2.json',
  'deals-pending-firecrawl2.json',
  'deals-pending-firecrawl4.json',
  'deals-pending-firecrawl5.json',
  'deals-pending-instagram.json',
  'deals-pending-instagram-ai.json',
  'deals-pending-instagram-apify.json',
  'deals-pending-instagram-discovery.json',
  'deals-pending-instagram-web.json',
  'deals-pending-meta-instagram.json',
];

const DAY_MS = 24 * 60 * 60 * 1000;

function hasKeyword(text, keywords) {
  const lower = cleanText(text).toLowerCase();
  return keywords.some((keyword) => lower.includes(keyword));
}

function parseTimestamp(value) {
  const text = cleanText(value);
  if (!text) return null;
  const ts = Date.parse(text);
  return Number.isFinite(ts) ? ts : null;
}

function loadDeals(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (Array.isArray(parsed)) return parsed;
    return Array.isArray(parsed?.deals) ? parsed.deals : [];
  } catch {
    return [];
  }
}

function ensureEntry(registry, username) {
  if (!registry.has(username)) {
    registry.set(username, {
      username,
      occurrences: 0,
      liveOccurrences: 0,
      pendingOccurrences: 0,
      foodDrinkHits: 0,
      promoHits: 0,
      viennaHits: 0,
      fresh1dHits: 0,
      fresh7dHits: 0,
      missionHits: 0,
      structuredOwnerOccurrences: 0,
      verifiedProfileOccurrences: 0,
      totalQualityScore: 0,
      categories: new Map(),
      types: new Map(),
      files: new Set(),
      sourceLabels: new Set(),
      sampleTitles: [],
      sampleUrls: new Set(),
      viennaEvidence: new Set(),
    });
  }
  return registry.get(username);
}

function incrementMap(map, key) {
  const normalized = cleanUiNoiseText(key || '').toLowerCase();
  if (!normalized) return;
  map.set(normalized, (map.get(normalized) || 0) + 1);
}

function scoreEntry(entry) {
  const countScore = Math.min(entry.occurrences * 10, 40);
  const liveScore = Math.min(entry.liveOccurrences * 12, 24);
  const promoScore = Math.min(entry.promoHits * 8, 16);
  const foodScore = Math.min(entry.foodDrinkHits * 8, 16);
  const viennaScore = Math.min(entry.viennaHits * 4, 8);
  return Math.max(0, Math.min(100, Math.round(countScore + liveScore + promoScore + foodScore + viennaScore)));
}

function priorityScore(entry) {
  if (!entry.occurrences) return 0;
  const fresh1dRate = entry.fresh1dHits / entry.occurrences;
  const missionRate = entry.missionHits / entry.occurrences;
  const liveRate = entry.liveOccurrences / entry.occurrences;
  const qualityAverage = entry.totalQualityScore > 0 ? entry.totalQualityScore / entry.occurrences : 0;
  const score =
    scoreEntry(entry) * 0.42 +
    missionRate * 26 +
    fresh1dRate * 18 +
    liveRate * 8 +
    Math.min(qualityAverage, 100) * 0.06;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function compactCounts(map, limit = 4) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

function profileEvidence(deal = {}) {
  const structuredUsername = extractStructuredOwnerUsername(deal);
  const profileUrls = [
    deal?.profileUrl,
    deal?.instagramProfileUrl,
    deal?.ownerProfileUrl,
    deal?.accountUrl,
    deal?.url,
    deal?.post_url,
  ];
  const profileUsername = profileUrls.map(extractInstagramProfileUsername).find(Boolean) || '';
  return { structuredUsername, profileUsername, username: structuredUsername || profileUsername };
}

function registryRecordKey(deal, username) {
  const postKey = canonicalInstagramPostKey(deal?.url || deal?.post_url || deal?.postUrl)
    || canonicalInstagramPostKey(deal?.post_url || deal?.postUrl);
  if (postKey) return `${username}|${postKey}`;
  const publication = getPublicationEvidence(deal).sourcePublishedAt;
  return [username, cleanText(deal?.id), cleanText(deal?.title).toLowerCase(), publication].filter(Boolean).join('|');
}

export function getIndependentViennaEvidence(deal) {
  const sanitized = { ...deal };
  delete sanitized.viennaVerified;
  delete sanitized.locationVerified;
  const derivedAccountEvidence = /(?:verified-registry|merchant-registry|verified-account|configured-watchlist)/i;
  const declaredSource = cleanText(deal?.viennaEvidence?.source || deal?.viennaEvidence?.type);
  let accountDerivedLocation = derivedAccountEvidence.test(declaredSource);
  if (accountDerivedLocation) {
    delete sanitized.viennaEvidence;
  }
  if (sanitized.evidence && typeof sanitized.evidence === 'object' && !Array.isArray(sanitized.evidence)) {
    sanitized.evidence = { ...sanitized.evidence };
    const nestedSource = cleanText(
      sanitized.evidence?.viennaEvidence?.source || sanitized.evidence?.viennaEvidence?.type
    );
    if (derivedAccountEvidence.test(nestedSource)) {
      accountDerivedLocation = true;
      delete sanitized.evidence.viennaEvidence;
    }
  }
  if (accountDerivedLocation) {
    for (const field of [
      'city', 'distance', 'location', 'ort', 'address', 'streetAddress',
      'venueAddress', 'postalCode', 'zip', 'zipCode', 'latitude', 'longitude',
    ]) delete sanitized[field];
  }
  return getViennaEvidence(sanitized);
}

function collectRegistryRecords() {
  const records = new Map();
  for (const fileName of INPUT_FILES) {
    const filePath = path.join(DOCS_DIR, fileName);
    const isLiveFile = fileName === 'deals.json';
    for (const deal of loadDeals(filePath)) {
      const evidence = profileEvidence(deal);
      if (!evidence.username) continue;
      const key = registryRecordKey(deal, evidence.username);
      if (!key) continue;
      const record = {
        ...deal,
        ownerUsername: evidence.structuredUsername || deal.ownerUsername,
        __username: evidence.username,
        __structuredOwner: Boolean(evidence.structuredUsername),
        __verifiedProfile: Boolean(evidence.profileUsername),
        __isLive: isLiveFile,
        __sourceFiles: [fileName],
      };
      if (!records.has(key)) {
        records.set(key, record);
        continue;
      }
      const previous = records.get(key);
      const merged = mergeDealEvidence(previous, record);
      merged.__username = evidence.username;
      merged.__structuredOwner = Boolean(previous.__structuredOwner || record.__structuredOwner);
      merged.__verifiedProfile = Boolean(previous.__verifiedProfile || record.__verifiedProfile);
      merged.__isLive = Boolean(previous.__isLive || record.__isLive);
      merged.__sourceFiles = [...new Set([...(previous.__sourceFiles || []), fileName])];
      records.set(key, merged);
    }
  }
  return [...records.values()];
}

export function buildInstagramMerchantRegistry(options = {}) {
  const registry = new Map();
  const now = options.now instanceof Date ? options.now.getTime() : Number(options.now) || Date.now();

  for (const deal of collectRegistryRecords()) {
      const username = deal.__username;

      const entry = ensureEntry(registry, username);
      entry.occurrences += 1;
      if (deal.__isLive) entry.liveOccurrences += 1;
      else entry.pendingOccurrences += 1;
      if (deal.__structuredOwner) entry.structuredOwnerOccurrences += 1;
      if (deal.__verifiedProfile) entry.verifiedProfileOccurrences += 1;
      for (const fileName of deal.__sourceFiles || []) entry.files.add(fileName);
      if (deal?.source) entry.sourceLabels.add(cleanText(deal.source));
      if (deal?.title && entry.sampleTitles.length < 4) entry.sampleTitles.push(cleanText(deal.title));
      entry.sampleUrls.add(`https://www.instagram.com/${username}/`);

      const haystack = [deal?.brand, deal?.title, deal?.description, deal?.distance, deal?.location]
        .map(cleanText)
        .join(' ');

      if (hasKeyword(haystack, FOOD_DRINK_KEYWORDS)) entry.foodDrinkHits += 1;
      const promoHit = hasKeyword(haystack, PROMO_KEYWORDS) || ['gratis', 'bogo', 'freebie'].includes(cleanUiNoiseText(deal?.type || '').toLowerCase());
      if (promoHit) {
        entry.promoHits += 1;
      }
      const viennaEvidence = getIndependentViennaEvidence(deal);
      const viennaHit = viennaEvidence.hasViennaEvidence;
      if (viennaHit) {
        entry.viennaHits += 1;
        entry.viennaEvidence.add(`${viennaEvidence.type}:${viennaEvidence.value}`);
      }

      const publication = getPublicationEvidence(deal);
      const pubTs = parseTimestamp(publication.sourcePublishedAt);
      if (pubTs && pubTs <= now + 5 * 60 * 1000 && now - pubTs <= DAY_MS) entry.fresh1dHits += 1;
      if (pubTs && pubTs <= now + 5 * 60 * 1000 && now - pubTs <= 7 * DAY_MS) entry.fresh7dHits += 1;
      if (viennaHit && promoHit && hasKeyword(haystack, FOOD_DRINK_KEYWORDS)) entry.missionHits += 1;
      entry.totalQualityScore += Number.isFinite(Number(deal?.qualityScore)) ? Number(deal.qualityScore) : 0;

      incrementMap(entry.categories, deal?.category);
      incrementMap(entry.types, deal?.type);
  }

  const accounts = [...registry.values()]
    .map((entry) => ({
      username: entry.username,
      confidence: scoreEntry(entry),
      priorityScore: priorityScore(entry),
      occurrences: entry.occurrences,
      liveOccurrences: entry.liveOccurrences,
      pendingOccurrences: entry.pendingOccurrences,
      foodDrinkHits: entry.foodDrinkHits,
      promoHits: entry.promoHits,
      viennaHits: entry.viennaHits,
      fresh1dHits: entry.fresh1dHits,
      fresh7dHits: entry.fresh7dHits,
      missionHits: entry.missionHits,
      structuredOwnerOccurrences: entry.structuredOwnerOccurrences,
      verifiedProfileOccurrences: entry.verifiedProfileOccurrences,
      viennaVerified: Boolean(
        entry.structuredOwnerOccurrences > 0
        && (
          (entry.liveOccurrences > 0 && entry.viennaHits > 0)
          || (entry.structuredOwnerOccurrences >= 2 && entry.viennaHits >= 2)
        )
      ),
      viennaEvidence: [...entry.viennaEvidence].slice(0, 6),
      averageQualityScore: entry.occurrences > 0 ? Math.round((entry.totalQualityScore / entry.occurrences) * 10) / 10 : 0,
      sourceFiles: [...entry.files].sort(),
      sourceLabels: [...entry.sourceLabels].sort(),
      topCategories: compactCounts(entry.categories),
      topTypes: compactCounts(entry.types),
      sampleTitles: entry.sampleTitles,
      sampleUrls: [...entry.sampleUrls].slice(0, 3),
    }))
    // Keep unverified accounts as discovery leads, but downstream Vienna checks
    // may trust only the explicit `viennaVerified` flag.
    .filter((entry) => entry.confidence >= 30)
    .sort((a, b) => b.priorityScore - a.priorityScore || b.confidence - a.confidence || b.occurrences - a.occurrences || a.username.localeCompare(b.username));

  const payload = {
    generatedAt: new Date(now).toISOString(),
    totalAccounts: accounts.length,
    accounts,
  };

  if (options.write !== false) {
    fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  }

  console.log('📇 Instagram merchant registry updated');
  console.log(`   accounts: ${accounts.length}`);
  console.log(`   top: ${accounts.slice(0, 8).map((entry) => `${entry.username} (${entry.confidence})`).join(', ')}`);

  return payload;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  buildInstagramMerchantRegistry();
}

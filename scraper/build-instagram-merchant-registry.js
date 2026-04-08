import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { cleanText, cleanUiNoiseText } from './deal-normalization-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const OUTPUT_PATH = path.join(DOCS_DIR, 'instagram-merchant-registry.json');

const RESERVED_IG_PATHS = new Set([
  'explore', 'accounts', 'about', 'developer', 'legal', 'privacy', 'api', 'reel', 'p',
  'stories', 'direct', 'reels', 'tv', 'challenge', 'directory', 'topics', 'emails',
  'download', 'press', 'jobs', 'threads', 'create', 'login', 'signup',
]);

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

const WIEN_KEYWORDS = [
  'wien', 'vienna', '1010', '1020', '1030', '1040', '1050', '1060', '1070', '1080',
  '1090', '1100', '1110', '1120', '1130', '1140', '1150', '1160', '1170', '1180',
  '1190', '1200', '1210', '1220', '1230',
];

const INPUT_FILES = [
  'deals.json',
  'deals-pending-all.json',
  'deals-pending-gastro2.json',
  'deals-pending-firecrawl2.json',
  'deals-pending-firecrawl4.json',
  'deals-pending-firecrawl5.json',
  'deals-pending-instagram.json',
  'deals-pending-instagram-discovery.json',
  'deals-pending-instagram-web.json',
];

function normalizeUsername(value) {
  const text = cleanText(value).toLowerCase().replace(/^@/, '').trim();
  if (!text || RESERVED_IG_PATHS.has(text)) return '';
  if (!/^[a-z0-9._]{2,40}$/.test(text)) return '';
  return text;
}

function extractInstagramProfileUsername(url) {
  const text = cleanText(url);
  if (!text) return '';
  try {
    const parsed = new URL(text);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (host !== 'instagram.com') return '';
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length !== 1) return '';
    return normalizeUsername(parts[0]);
  } catch {
    return '';
  }
}

function hasKeyword(text, keywords) {
  const lower = cleanText(text).toLowerCase();
  return keywords.some((keyword) => lower.includes(keyword));
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
      categories: new Map(),
      types: new Map(),
      files: new Set(),
      sourceLabels: new Set(),
      sampleTitles: [],
      sampleUrls: new Set(),
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

function compactCounts(map, limit = 4) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

function main() {
  const registry = new Map();

  for (const fileName of INPUT_FILES) {
    const filePath = path.join(DOCS_DIR, fileName);
    const deals = loadDeals(filePath);
    const isLiveFile = fileName === 'deals.json';

    for (const deal of deals) {
      const urls = [deal?.url, deal?.post_url, deal?.logoUrl];
      const username = urls.map(extractInstagramProfileUsername).find(Boolean);
      if (!username) continue;

      const entry = ensureEntry(registry, username);
      entry.occurrences += 1;
      if (isLiveFile) entry.liveOccurrences += 1;
      else entry.pendingOccurrences += 1;
      entry.files.add(fileName);
      if (deal?.source) entry.sourceLabels.add(cleanText(deal.source));
      if (deal?.title && entry.sampleTitles.length < 4) entry.sampleTitles.push(cleanText(deal.title));
      const normalizedUrl = urls.find((url) => extractInstagramProfileUsername(url) === username);
      if (normalizedUrl) entry.sampleUrls.add(cleanText(normalizedUrl));

      const haystack = [deal?.brand, deal?.title, deal?.description, deal?.distance, deal?.location]
        .map(cleanText)
        .join(' ');

      if (hasKeyword(haystack, FOOD_DRINK_KEYWORDS)) entry.foodDrinkHits += 1;
      if (hasKeyword(haystack, PROMO_KEYWORDS) || ['gratis', 'bogo', 'freebie'].includes(cleanUiNoiseText(deal?.type || '').toLowerCase())) {
        entry.promoHits += 1;
      }
      if (hasKeyword(haystack, WIEN_KEYWORDS)) entry.viennaHits += 1;

      incrementMap(entry.categories, deal?.category);
      incrementMap(entry.types, deal?.type);
    }
  }

  const accounts = [...registry.values()]
    .map((entry) => ({
      username: entry.username,
      confidence: scoreEntry(entry),
      occurrences: entry.occurrences,
      liveOccurrences: entry.liveOccurrences,
      pendingOccurrences: entry.pendingOccurrences,
      foodDrinkHits: entry.foodDrinkHits,
      promoHits: entry.promoHits,
      viennaHits: entry.viennaHits,
      sourceFiles: [...entry.files].sort(),
      sourceLabels: [...entry.sourceLabels].sort(),
      topCategories: compactCounts(entry.categories),
      topTypes: compactCounts(entry.types),
      sampleTitles: entry.sampleTitles,
      sampleUrls: [...entry.sampleUrls].slice(0, 3),
    }))
    .filter((entry) => entry.confidence >= 30)
    .sort((a, b) => b.confidence - a.confidence || b.occurrences - a.occurrences || a.username.localeCompare(b.username));

  const payload = {
    generatedAt: new Date().toISOString(),
    totalAccounts: accounts.length,
    accounts,
  };

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);

  console.log('📇 Instagram merchant registry updated');
  console.log(`   accounts: ${accounts.length}`);
  console.log(`   top: ${accounts.slice(0, 8).map((entry) => `${entry.username} (${entry.confidence})`).join(', ')}`);
}

main();

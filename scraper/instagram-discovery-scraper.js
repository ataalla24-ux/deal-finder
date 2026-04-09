import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeCategoryForScraper } from './category-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const OUTPUT_PATH = path.join(ROOT, 'docs', 'deals-pending-instagram-discovery.json');
const SOURCE_STATS_PATH = path.join(ROOT, 'docs', 'instagram-source-stats.json');
const DISCOVERY_REPORT_PATH = path.join(ROOT, 'docs', 'instagram-discovery-report.json');
const MERCHANT_REGISTRY_PATH = path.join(ROOT, 'docs', 'instagram-merchant-registry.json');
const ARTIFACTS_DIR = path.join(ROOT, 'artifacts');
const CANDIDATE_LOG_PATH = path.join(ARTIFACTS_DIR, 'instagram-discovery-candidates.json');
const ENV_PATH = path.join(ROOT, '.env');

const DEFAULT_CONFIG = {
  maxAgeDays: 1,
  maxDealsPerRun: 120,
  maxPostsToVisit: 260,
  maxRelatedAccounts: 70,
  maxSourcesTotal: 90,
  sourceScrollRounds: 18,
  sourceScrollStepPx: 2600,
  sourceScrollWaitMs: 2200,
  sourceStagnationRounds: 6,
  perSourceLinksLimit: 180,
  postLoadTimeoutMs: 7000,
  sourceDelayMs: 650,
  minDealScore: 60,
  maxDealsPerInstagramAccount: 4,
};
let CONFIG = { ...DEFAULT_CONFIG };
const TRUSTED_PUBDATE_SOURCES = new Set(['ldDate', 'timeDatetime', 'igScriptTimestamp']);

const SEED_HASHTAGS = [
  'gratiswien',
  'wiengastro',
  'wienessen',
  'wienrestaurants',
  'wienkaffee',
  'wienbrunch',
  'gratisessenwien',
  'neueröffnungwien',
  'neueroeffnungwien',
  'wienfood',
  'kaffeewien',
  'wienimbiss',
  'wienstreetfood',
  'wienkebab',
  'freefoodvienna',
  'gratisdoenerwien',
  'gratisdönerwien',
  'gratisburgerwien',
  'gratispizza',
  'gratiskaffeewien',
  'freecoffeewien',
  'gratisdrinkwien',
  'freedrinkvienna',
  'gratiseiswien',
  'freeicecreamvienna',
  'wieneroeffnung',
  'openingwien',
];

const SEED_ACCOUNTS = [
  'ciosgrill',
  'corner_xvi',
  'assal.burger',
  'cafe_wirr',
  'pizzeriapummaro',
  'mangalet.at',
  'vienna.coffee',
  'viennaeats',
  'viennafoodstories',
  'viennarestaurants',
  'viennawurstelstand',
];

const EXTRA_SEARCH_QUERIES = [
  'site:instagram.com/reel wien gratis essen',
  'site:instagram.com/p wien gratis essen',
  'site:instagram.com/reel vienna free food',
  'site:instagram.com/p wien neueröffnung gratis',
  'site:instagram.com/p wien kaffee gratis',
  'site:instagram.com/reel wien gratis kaffee',
  'site:instagram.com/p wien gratis drink',
  'site:instagram.com/reel vienna free coffee',
  'site:instagram.com/p vienna free drink',
  'site:instagram.com/reel wien gratis eis',
  'site:instagram.com/p wien 1+1 restaurant',
];

const ACCOUNT_SEARCH_QUERIES = [
  'gratis wien',
  'wien gratis',
  'wien gastro',
  'wien restaurant',
  'wien kaffee',
  'wien coffee',
  'wien pizza',
  'wien burger',
  'wien kebab',
  'wien döner',
  'wien brunch',
  'wien eis',
  'vienna coffee',
  'vienna food',
  'vienna brunch',
  'neueröffnung wien cafe',
  'neueröffnung wien restaurant',
];

const RESERVED_IG_PATHS = new Set([
  'explore', 'accounts', 'about', 'developer', 'legal', 'privacy', 'api', 'reel', 'p',
  'stories', 'direct', 'reels', 'tv', 'challenge', 'directory', 'topics', 'emails',
  'download', 'press', 'jobs', 'threads', 'create', 'login', 'signup',
]);

const WIEN_KEYWORDS = [
  'wien', 'vienna', 'wiener', 'innere stadt', 'donaustadt', 'ottakring', 'favoriten',
  'leopoldstadt', 'josefstadt', 'margareten', 'mariahilf', 'neubau', 'währing',
  'floridsdorf', 'simmering', 'meidling', 'hietzing', 'penzing', 'rudolfsheim',
  'landstraße', 'alsergrund', 'hernals', 'liesing',
  '1010', '1020', '1030', '1040', '1050', '1060', '1070', '1080', '1090',
  '1100', '1110', '1120', '1130', '1140', '1150', '1160', '1170', '1180', '1190',
  '1200', '1210', '1220', '1230',
  'vösendorf', 'voesendorf', 'schwechat', 'klosterneuburg', 'brunn am gebirge',
  'perchtoldsdorf', 'mödling', 'moedling', 'purkersdorf', 'gerasdorf', 'korneuburg',
  'guntramsdorf', 'neusiedl', 'baden bei wien',
];

const DEAL_KEYWORDS = [
  'gratis', 'kostenlos', 'for free', 'free', 'freebie', '0€', '0 €', '0 euro', 'geschenkt',
  'rabatt', 'discount', 'aktion', 'angebot', 'deal', 'gutschein', 'coupon', 'voucher',
  'promocode', 'code', '1+1', '2for1', '2 for 1', 'buy one get one', 'bogo',
  'happy hour', 'eröffnung', 'neueroeffnung', 'neueröffnung', 'limited',
  'nur heute', 'nur morgen', 'only today', 'only this week',
  'free sample', 'gratisprobe', 'probe', 'geschenk', 'gift', 'opening deal', 'opening offer',
  'grand opening', 'soft opening', 'launch', 'welcome gift',
];

const FREEBIE_KEYWORDS = [
  'gratis', 'kostenlos', 'for free', 'freebie', 'geschenkt', '0€', '0 euro',
  'umsonst', 'free coffee', 'free food', 'gratis essen', 'gratis kaffee',
  'gratis döner', 'gratis doener', 'gratis burger', 'gratis pizza', 'gratis dessert',
  'gratis drink', 'free drink', 'gratis eis', 'free ice cream', 'gratis probe',
  'free sample', 'welcome gift', 'gratis geschenk', 'geschenkaktion',
];

const PROMO_KEYWORDS = [
  'aktion', 'angebot', 'deal', 'promo', 'promotion', 'opening deal',
  'opening offer', 'eröffnungsangebot', 'eroeffnungsangebot', 'eröffnungsaktion',
  'eroeffnungsaktion', 'soft opening', 'grand opening', 'launch special',
  '1+1', '2for1', '2 for 1', 'bogo', 'happy hour', 'voucher', 'coupon', 'gutschein',
];

const GIFT_KEYWORDS = [
  'geschenk', 'gift', 'welcome gift', 'goodie', 'goodiebag', 'goodie bag',
  'giveaway gift', 'gratis geschenk', 'geschenkaktion', 'free gift',
];

const DRINK_KEYWORDS = [
  'drink', 'cocktail', 'spritz', 'coffee', 'kaffee', 'espresso', 'matcha',
  'latte', 'smoothie', 'bubble tea', 'tee', 'bier', 'beer', 'wein', 'wine',
];

const OPENING_KEYWORDS = [
  'neueröffnung', 'neueroeffnung', 'opening', 'grand opening', 'soft opening',
  'eröffnung', 'eroeffnung', 'coming soon', 'launch',
];

const FOOD_KEYWORDS = [
  'restaurant', 'pizza', 'burger', 'kebab', 'kebap', 'döner', 'doener', 'sushi', 'cafe',
  'café', 'brunch', 'coffee', 'kaffee', 'croissant', 'frühstück', 'fruehstueck',
  'mittag', 'abendessen', 'essen', 'drink', 'cocktail', 'food', 'meal', 'snack',
];

const EVENT_KEYWORDS = [
  'event', 'festival', 'konzert', 'worship', 'abend', 'livemusik', 'live musik',
  'open air', 'kino', 'theater', 'show', 'party', 'community', 'treffen',
];

const EXPIRED_KEYWORDS = [
  'abgelaufen', 'vorbei', 'ended', 'expired', 'ausverkauft', 'nicht mehr gültig',
  'not valid anymore', 'beendet',
];

const GIVEAWAY_KEYWORDS = ['gewinnspiel', 'verlosung', 'giveaway'];

function loadEnvFile() {
  if (!fs.existsSync(ENV_PATH)) return;
  const lines = fs.readFileSync(ENV_PATH, 'utf-8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function cleanText(value) {
  if (!value) return '';
  return String(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function containsKeyword(text, keywords) {
  const t = cleanText(text).toLowerCase();
  if (!t) return false;
  return keywords.some((k) => t.includes(k));
}

function looksLikeDiscoveryAccount({ username = '', fullName = '', biography = '', hitCount = 1 } = {}) {
  const accountText = cleanText([username, fullName, biography].join(' '));
  if (!accountText) return false;

  if (containsKeyword(accountText, WIEN_KEYWORDS)) return true;

  const merchantishKeywords = [
    'cafe', 'café', 'coffee', 'kaffee', 'espresso', 'matcha', 'bar', 'bistro', 'brunch',
    'restaurant', 'pizza', 'burger', 'kebab', 'kebap', 'döner', 'doener', 'sushi',
    'falafel', 'bakery', 'croissant', 'dessert', 'donut', 'ice cream', 'icecream', 'eis',
    'bubble tea', 'spritz', 'cocktail', 'drink',
  ];
  if (containsKeyword(accountText, merchantishKeywords)) return true;

  if (hitCount >= 2 && (containsKeyword(accountText, FOOD_KEYWORDS) || containsKeyword(accountText, DRINK_KEYWORDS))) {
    return true;
  }

  return false;
}

function keywordHits(text, keywords) {
  const t = cleanText(text).toLowerCase();
  if (!t) return 0;
  let hits = 0;
  for (const k of keywords) {
    if (t.includes(k)) hits += 1;
  }
  return hits;
}

function toNum(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function buildConfig() {
  const requestedMaxAgeDays = toNum(process.env.IG_MAX_AGE_DAYS, DEFAULT_CONFIG.maxAgeDays);
  return {
    ...DEFAULT_CONFIG,
    maxAgeDays: Math.min(14, requestedMaxAgeDays),
    maxDealsPerRun: toNum(process.env.IG_MAX_DEALS, DEFAULT_CONFIG.maxDealsPerRun),
    maxPostsToVisit: toNum(process.env.IG_MAX_POSTS_VISIT, DEFAULT_CONFIG.maxPostsToVisit),
    maxRelatedAccounts: toNum(process.env.IG_MAX_RELATED_ACCOUNTS, DEFAULT_CONFIG.maxRelatedAccounts),
    maxSourcesTotal: toNum(process.env.IG_MAX_SOURCES_TOTAL, DEFAULT_CONFIG.maxSourcesTotal),
    sourceScrollRounds: toNum(process.env.IG_SCROLL_ROUNDS, DEFAULT_CONFIG.sourceScrollRounds),
    sourceScrollWaitMs: toNum(process.env.IG_SCROLL_WAIT_MS, DEFAULT_CONFIG.sourceScrollWaitMs),
    sourceStagnationRounds: toNum(process.env.IG_STAGNATION_ROUNDS, DEFAULT_CONFIG.sourceStagnationRounds),
    perSourceLinksLimit: toNum(process.env.IG_PER_SOURCE_LINKS, DEFAULT_CONFIG.perSourceLinksLimit),
    minDealScore: toNum(process.env.IG_MIN_SCORE, DEFAULT_CONFIG.minDealScore),
    maxDealsPerInstagramAccount: toNum(process.env.IG_MAX_DEALS_PER_ACCOUNT, DEFAULT_CONFIG.maxDealsPerInstagramAccount),
  };
}

function stableId(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 33 + seed.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

function loadSourceStats() {
  if (!fs.existsSync(SOURCE_STATS_PATH)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(SOURCE_STATS_PATH, 'utf-8'));
    const sourceStats = parsed?.sources && typeof parsed.sources === 'object' ? parsed.sources : parsed;
    if (!sourceStats || typeof sourceStats !== 'object') return {};
    const cleaned = {};
    for (const [key, value] of Object.entries(sourceStats)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const runs = Number(value.runs || 0);
      const totalLinks = Number(value.totalLinks || 0);
      const acceptedDeals = Number(value.acceptedDeals || 0);
      const kind = cleanText(value.kind || '');
      if (!kind && !runs && !totalLinks && !acceptedDeals) continue;
      cleaned[key] = {
        kind,
        runs,
        totalLinks,
        acceptedDeals,
        lastSeenAt: cleanText(value.lastSeenAt || ''),
      };
    }
    return cleaned;
  } catch {
    return {};
  }
}

function sourcePerformanceScore(stat) {
  if (!stat) return 0;
  const runs = Number(stat.runs || 0);
  const hits = Number(stat.acceptedDeals || 0);
  const links = Number(stat.totalLinks || 0);
  if (runs <= 0) return 0;
  const hitRate = hits / runs;
  const linksPerRun = links / runs;
  return hitRate * 100 + Math.min(linksPerRun / 4, 20);
}

function shouldSkipWeakSource(source, stat) {
  if (!stat) return false;
  const runs = Number(stat.runs || 0);
  const hits = Number(stat.acceptedDeals || 0);
  const links = Number(stat.totalLinks || 0);
  const linksPerRun = runs > 0 ? links / runs : 0;
  if (source.kind === 'account' || source.kind === 'account-api') {
    if (runs < 8) return false;
    if (hits > 0) return false;
    return linksPerRun < 3;
  }
  if (runs < 7) return false;
  if (hits === 0) return true;
  const hitRate = hits / runs;
  return hitRate < 0.25 && linksPerRun < 10;
}

function normalizeInstagramPostUrl(rawUrl) {
  const text = cleanText(rawUrl);
  if (!text) return '';
  try {
    const decoded = decodeURIComponent(text);
    const directMatch = decoded.match(/https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel)\/[A-Za-z0-9_-]+\/?/i);
    if (!directMatch) return '';
    const u = new URL(directMatch[0]);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return '';
    return `https://www.instagram.com/${parts[0]}/${parts[1]}/`;
  } catch {
    return '';
  }
}

function normalizeAccountFromHref(rawHref) {
  const href = cleanText(rawHref);
  if (!href) return '';
  if (!href.startsWith('/') || href.startsWith('/p/') || href.startsWith('/reel/') || href.startsWith('/explore/')) {
    return '';
  }
  const parts = href.split('/').filter(Boolean);
  if (parts.length !== 1) return '';
  const username = parts[0].toLowerCase();
  if (!username || RESERVED_IG_PATHS.has(username)) return '';
  if (!/^[a-z0-9._]{2,40}$/.test(username)) return '';
  return username;
}

function normalizeUsername(value) {
  const username = cleanText(value).toLowerCase().replace(/^@/, '').trim();
  if (!username || RESERVED_IG_PATHS.has(username)) return '';
  if (!/^[a-z0-9._]{2,40}$/.test(username)) return '';
  return username;
}

function extractPostUrls(html) {
  const urls = new Set();
  const re = /https:\/\/(?:www\.)?instagram\.com\/(?:p|reel)\/[A-Za-z0-9_-]+\//g;
  const matches = html.match(re) || [];
  for (const m of matches) urls.add(normalizeInstagramPostUrl(m));
  return [...urls].filter(Boolean);
}

function extractShortcodesFromText(text) {
  const urls = new Set();
  if (!text) return urls;
  const patterns = [
    /"shortcode"\s*:\s*"([A-Za-z0-9_-]{8,})"/g,
    /"code"\s*:\s*"([A-Za-z0-9_-]{8,})"/g,
    /\/(?:p|reel)\/([A-Za-z0-9_-]{8,})\//g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) {
      if (/^[a-z]{2}_[A-Z]{2}$/i.test(m[1])) continue;
      urls.add(`https://www.instagram.com/p/${m[1]}/`);
    }
  }
  return urls;
}

function parseRelativeAgeToDate(text, nowMs = Date.now()) {
  const raw = cleanText(text).toLowerCase();
  if (!raw) return null;
  const match = raw.match(/(?:edited\s*•\s*)?(\d+)\s*([dhwmy])/i);
  if (!match) return null;
  const n = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (!Number.isFinite(n) || n < 0) return null;
  const msPerUnit = {
    d: 24 * 60 * 60 * 1000,
    h: 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    m: 30 * 24 * 60 * 60 * 1000,
    y: 365 * 24 * 60 * 60 * 1000,
  };
  const ms = msPerUnit[unit];
  if (!ms) return null;
  return new Date(nowMs - n * ms).toISOString();
}

function extractRelativeAgeDays(text) {
  const raw = cleanText(text).toLowerCase();
  if (!raw) return null;

  const wordMatch = raw.match(/(\d+)\s*(hours?|stunden|days?|tage|weeks?|wochen|months?|monate|years?|jahre?n?)\b/i);
  if (wordMatch) {
    const n = Number(wordMatch[1]);
    const unit = wordMatch[2].toLowerCase();
    if (!Number.isFinite(n) || n < 0) return null;
    if (unit.startsWith('hour') || unit.includes('stund')) return 0;
    if (unit.startsWith('day') || unit.includes('tag')) return n;
    if (unit.startsWith('week') || unit.includes('woch')) return n * 7;
    if (unit.startsWith('month') || unit.includes('monat')) return n * 30;
    if (unit.startsWith('year') || unit.includes('jahr')) return n * 365;
  }

  const compactMatch = raw.match(/(?:edited\s*•\s*)?(\d+)\s*([dhwmy])\b/i);
  if (compactMatch) {
    const n = Number(compactMatch[1]);
    const unit = compactMatch[2].toLowerCase();
    if (!Number.isFinite(n) || n < 0) return null;
    if (unit === 'h') return 0;
    if (unit === 'd') return n;
    if (unit === 'w') return n * 7;
    if (unit === 'm') return n * 30;
    if (unit === 'y') return n * 365;
  }

  return null;
}

function parseDateCandidatesFromText(text) {
  const t = cleanText(text);
  if (!t) return [];
  const out = [];

  const ymdMatches = [...t.matchAll(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g)];
  for (const m of ymdMatches) {
    const yyyy = Number(m[1]);
    const mm = Number(m[2]);
    const dd = Number(m[3]);
    const d = new Date(Date.UTC(yyyy, mm - 1, dd, 12, 0, 0));
    if (!Number.isNaN(d.getTime())) out.push(d.getTime());
  }

  const dmyMatches = [...t.matchAll(/\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b/g)];
  for (const m of dmyMatches) {
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    const yyRaw = String(m[3]);
    const yyyy = yyRaw.length === 2 ? Number(`20${yyRaw}`) : Number(yyRaw);
    const d = new Date(Date.UTC(yyyy, mm - 1, dd, 12, 0, 0));
    if (!Number.isNaN(d.getTime())) out.push(d.getTime());
  }

  return out;
}

function textSignalsPostTooOld(text) {
  const relativeAgeDays = extractRelativeAgeDays(text);
  if (relativeAgeDays !== null && relativeAgeDays > CONFIG.maxAgeDays) return true;

  const candidateDates = parseDateCandidatesFromText(text);
  if (candidateDates.length === 0) return false;

  const freshCutoff = Date.now() - CONFIG.maxAgeDays * 24 * 60 * 60 * 1000;
  const recentCandidates = candidateDates.filter((ts) => ts >= freshCutoff && ts <= Date.now() + 24 * 60 * 60 * 1000);
  return recentCandidates.length === 0;
}

function parseDateFromPage({ ldDate, timeDateTime, igScriptTimestamp, ogDescription, fullText, fallbackNow = Date.now() }) {
  // Only accept trusted publication signals. Do not infer dates from generic caption text
  // because that often represents offer validity, not post publish time.
  if (ldDate) {
    const ts = Date.parse(ldDate);
    if (!Number.isNaN(ts)) return { iso: new Date(ts).toISOString(), source: 'ldDate' };
  }

  if (timeDateTime) {
    const ts = Date.parse(timeDateTime);
    if (!Number.isNaN(ts)) return { iso: new Date(ts).toISOString(), source: 'timeDatetime' };
  }

  if (igScriptTimestamp) {
    const ts = Number(igScriptTimestamp);
    if (Number.isFinite(ts) && ts > 0) {
      const ms = ts > 1e12 ? ts : ts * 1000;
      return { iso: new Date(ms).toISOString(), source: 'igScriptTimestamp' };
    }
  }

  return null;
}

function parseExpiryFromText(text, now = new Date()) {
  const t = cleanText(text).toLowerCase();
  if (!t) return '';

  const dmy = t.match(/(?:gültig\s*bis|nur\s*bis|bis|ends?\s*(?:on)?|until)\s*(\d{1,2})\.(\d{1,2})\.(\d{2,4})?/i);
  if (dmy) {
    const year = dmy[3] ? (dmy[3].length === 2 ? Number(`20${dmy[3]}`) : Number(dmy[3])) : now.getFullYear();
    const mm = String(dmy[2]).padStart(2, '0');
    const dd = String(dmy[1]).padStart(2, '0');
    return `${year}-${mm}-${dd}`;
  }

  if (t.includes('nur heute') || t.includes('only today')) {
    return now.toISOString().slice(0, 10);
  }
  if (t.includes('nur morgen') || t.includes('only tomorrow')) {
    const d = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  }

  return '';
}

function isExpiredByText(text) {
  const t = cleanText(text).toLowerCase();
  if (!t) return false;
  return EXPIRED_KEYWORDS.some((k) => t.includes(k));
}

function isFresh(pubDateIso) {
  const ts = Date.parse(pubDateIso);
  if (Number.isNaN(ts)) return false;
  const ageMs = Date.now() - ts;
  return ageMs >= 0 && ageMs <= CONFIG.maxAgeDays * 24 * 60 * 60 * 1000;
}

function isExpiryInPast(expiryValue) {
  const t = cleanText(expiryValue);
  if (!t) return false;
  const ts = Date.parse(t);
  if (Number.isNaN(ts)) return false;
  const endTs = new Date(new Date(ts).toISOString().slice(0, 10)).getTime() + (24 * 60 * 60 * 1000 - 1);
  return Date.now() > endTs;
}

function detectCategory(text, meta = {}) {
  return normalizeCategoryForScraper('', [
    text,
    meta.accountHint,
    meta.relatedHint,
    meta.sourceHits,
  ]);
}

function detectType(text) {
  const lower = cleanText(text).toLowerCase();
  if (FREEBIE_KEYWORDS.some((k) => lower.includes(k))) return 'gratis';
  if (lower.includes('1+1') || lower.includes('2for1') || lower.includes('2 for 1')) return 'bogo';
  return 'rabatt';
}

function isFoodDrinkRelevant(text) {
  const lower = cleanText(text).toLowerCase();
  return keywordHits(lower, FOOD_KEYWORDS) > 0 || keywordHits(lower, DRINK_KEYWORDS) > 0;
}

function hasFreebieOrPromoSignal(text) {
  const lower = cleanText(text).toLowerCase();
  return keywordHits(lower, FREEBIE_KEYWORDS) > 0 || keywordHits(lower, PROMO_KEYWORDS) > 0;
}

function isGiveawayOnly(text) {
  const lower = cleanText(text).toLowerCase();
  return GIVEAWAY_KEYWORDS.some((k) => lower.includes(k))
    && !hasFreebieOrPromoSignal(lower);
}

function inferLogo(category, text) {
  const lower = cleanText(text).toLowerCase();
  if (lower.includes('kebab') || lower.includes('kebap') || lower.includes('döner') || lower.includes('doener')) return '🥙';
  if (lower.includes('pizza')) return '🍕';
  if (lower.includes('burger')) return '🍔';
  if (lower.includes('sushi')) return '🍣';
  if (lower.includes('kaffee') || lower.includes('coffee') || lower.includes('cafe') || lower.includes('café')) return '☕';
  if (lower.includes('eis') || lower.includes('gelato')) return '🍦';
  if (category === 'events') return '🎉';
  if (category === 'fitness') return '💪';
  return '📷';
}

function scoreDeal({ text, sourceHits, sourceKinds, accountHint, relatedHint }) {
  const lower = cleanText(text).toLowerCase();
  const dealHits = keywordHits(lower, DEAL_KEYWORDS);
  const freebieHits = keywordHits(lower, FREEBIE_KEYWORDS);
  const promoHits = keywordHits(lower, PROMO_KEYWORDS);
  const giftHits = keywordHits(lower, GIFT_KEYWORDS);
  const drinkHits = keywordHits(lower, DRINK_KEYWORDS);
  const openingHits = keywordHits(lower, OPENING_KEYWORDS);
  const wienHits = keywordHits(lower, WIEN_KEYWORDS);
  const foodHits = keywordHits(lower, FOOD_KEYWORDS);
  const isFoodDrinkDeal = foodHits > 0 || drinkHits > 0 || /drink|cocktail|coffee|kaffee|brunch|restaurant/.test(lower);
  const isFreeSignal = /gratis|kostenlos|free|freebie|geschenkt|0 ?€|1\+1|2 for 1|bogo|free sample|gratisprobe|welcome gift/.test(lower);
  const isGiveaway = GIVEAWAY_KEYWORDS.some((k) => lower.includes(k));
  const isRealPromo = promoHits > 0 || openingHits > 0;
  const isGiftish = giftHits > 0;

  let score = 0;
  score += Math.min(dealHits * 9, 36);
  score += Math.min(freebieHits * 13, 32);
  score += Math.min(promoHits * 8, 24);
  score += Math.min(giftHits * 10, 20);
  score += Math.min(wienHits * 11, 33);
  score += Math.min(foodHits * 4, 12);
  score += Math.min(drinkHits * 5, 12);
  score += Math.min(openingHits * 9, 18);
  score += Math.min(sourceHits * 8, 20);

  if (sourceKinds.has('hashtag')) score += 6;
  if (sourceKinds.has('account')) score += 7;
  if (sourceKinds.has('search')) score += 4;
  if (accountHint) score += 5;
  if (relatedHint) score += 6;

  if (lower.includes('nur heute') || lower.includes('only today')) score += 8;
  if (lower.includes('neueröffnung') || lower.includes('neueroeffnung') || lower.includes('opening')) score += 7;
  if (isGiveaway) score += 4;
  if (isFoodDrinkDeal) score += 8;
  if (isFoodDrinkDeal && isFreeSignal) score += 18;
  if (isRealPromo && isFoodDrinkDeal) score += 12;
  if (isGiftish && isRealPromo) score += 8;
  if (isGiveaway && !isFreeSignal && !isRealPromo) score -= 10;

  if (isExpiredByText(lower)) score -= 50;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function extractAccountKeyFromDeal(deal) {
  const brand = cleanText(deal.brand).toLowerCase().replace(/^@/, '');
  if (brand && /^[a-z0-9._-]{2,40}$/.test(brand)) return brand;
  try {
    const u = new URL(deal.url || '');
    const p = u.pathname.split('/').filter(Boolean);
    if (p.length >= 2) {
      const maybe = cleanText(p[0]).toLowerCase();
      if (maybe && /^[a-z0-9._-]{2,40}$/.test(maybe)) return maybe;
    }
  } catch {}
  return 'unknown';
}

function buildSources(sourceStats) {
  const hashtags = [...new Set(SEED_HASHTAGS)].map((tag) => ({
    kind: 'hashtag',
    key: `tag:${tag}`,
    url: `https://www.instagram.com/explore/tags/${tag}/`,
    priority: 2,
  }));

  const accounts = [...new Set(getSeedAccounts())].map((username) => ({
    kind: 'account',
    key: `acct:${username}`,
    url: `https://www.instagram.com/${username}/`,
    priority: 3,
  }));

  const combined = [...accounts, ...hashtags]
    .filter((source) => !shouldSkipWeakSource(source, sourceStats[source.key]))
    .sort((a, b) => {
      const aScore = sourcePerformanceScore(sourceStats[a.key]) + a.priority * 15;
      const bScore = sourcePerformanceScore(sourceStats[b.key]) + b.priority * 15;
      return bScore - aScore;
    });

  return combined;
}

function shouldUseMerchantRegistrySeeds() {
  return cleanText(process.env.IG_USE_MERCHANT_REGISTRY) === '1';
}

function loadMerchantRegistryAccounts() {
  if (!fs.existsSync(MERCHANT_REGISTRY_PATH)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(MERCHANT_REGISTRY_PATH, 'utf-8'));
    const accounts = Array.isArray(parsed?.accounts) ? parsed.accounts : [];
    return accounts
      .filter((account) => Number(account?.confidence || 0) >= 40)
      .map((account) => ({
        username: normalizeUsername(account?.username),
        confidence: Number(account?.confidence || 0),
        priorityScore: Number(account?.priorityScore || 0),
        missionHits: Number(account?.missionHits || 0),
        fresh1dHits: Number(account?.fresh1dHits || 0),
      }))
      .filter((account) => account.username)
      .sort((a, b) => b.priorityScore - a.priorityScore || b.confidence - a.confidence || a.username.localeCompare(b.username));
  } catch {
    return [];
  }
}

function countAccountishCandidates(candidatePosts) {
  let count = 0;
  for (const candidate of candidatePosts.values()) {
    if (candidate?.accountHint || candidate?.relatedHint) count += 1;
  }
  return count;
}

function getSeedAccounts() {
  const ordered = [];
  const seen = new Set();
  for (const username of SEED_ACCOUNTS) {
    const normalized = normalizeUsername(username);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    ordered.push(normalized);
  }
  if (shouldUseMerchantRegistrySeeds()) {
    for (const account of loadMerchantRegistryAccounts()) {
      if (seen.has(account.username)) continue;
      seen.add(account.username);
      ordered.push(account.username);
    }
  }
  return ordered;
}

function merchantRegistryPriorityMap() {
  const map = new Map();
  if (!shouldUseMerchantRegistrySeeds()) return map;
  for (const account of loadMerchantRegistryAccounts()) {
    map.set(account.username, account);
  }
  return map;
}

function buildCookieHints() {
  const hints = [];
  const sessionId = cleanText(process.env.INSTAGRAM_SESSIONID);
  if (sessionId) hints.push({ name: 'sessionid', value: sessionId });

  const cookieFile = cleanText(process.env.INSTAGRAM_COOKIES_FILE);
  if (cookieFile && fs.existsSync(cookieFile)) {
    const lines = fs.readFileSync(cookieFile, 'utf-8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      if (line.includes('\t')) {
        const cols = line.split('\t').map((c) => c.trim());
        if (cols.length >= 2) {
          const name = cols[0];
          const value = cols[1];
          if (name && value) hints.push({ name, value, domain: cols[2] || '.instagram.com' });
          continue;
        }
      }

      const parts = trimmed.split(';').map((p) => p.trim()).filter(Boolean);
      for (const part of parts) {
        const eq = part.indexOf('=');
        if (eq <= 0) continue;
        const name = part.slice(0, eq).trim();
        const value = part.slice(eq + 1).trim();
        if (name && value) hints.push({ name, value, domain: '.instagram.com' });
      }
    }
  }

  return hints;
}

function buildCookieHeader() {
  const parts = [];
  const seen = new Set();
  for (const hint of buildCookieHints()) {
    const name = cleanText(hint?.name);
    const value = cleanText(hint?.value);
    if (!name || !value) continue;
    const key = `${name}=${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(key);
  }
  return parts.join('; ');
}

function buildInstagramApiHeaders(cookieHeader, referer = 'https://www.instagram.com/') {
  return {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Cookie': cookieHeader,
    'X-IG-App-ID': '936619743392459',
    'X-Requested-With': 'XMLHttpRequest',
    Referer: referer,
  };
}

async function fetchInstagramJsonInBrowser(page, url, referer) {
  if (!page || !url) return null;
  try {
    const result = await page.evaluate(async ({ url, referer }) => {
      try {
        const response = await fetch(url, {
          method: 'GET',
          credentials: 'include',
          referrer: referer,
          headers: {
            'X-IG-App-ID': '936619743392459',
            'X-Requested-With': 'XMLHttpRequest',
            Accept: '*/*',
          },
        });
        const text = await response.text();
        return { ok: response.ok, status: response.status, text };
      } catch (error) {
        return { ok: false, status: 0, text: '', error: String(error?.message || error || '') };
      }
    }, { url, referer });

    if (!result?.ok || !result?.text) return null;
    return JSON.parse(result.text);
  } catch {
    return null;
  }
}

async function fetchInstagramProfile(username, cookieHeader) {
  if (!username || !cookieHeader) return null;
  try {
    const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
    const response = await fetch(url, { headers: buildInstagramApiHeaders(cookieHeader, `https://www.instagram.com/${encodeURIComponent(username)}/`) });
    if (!response.ok) return null;
    const parsed = await response.json();
    return parsed?.data?.user || null;
  } catch {
    return null;
  }
}

async function fetchInstagramProfileInBrowser(page, username) {
  if (!page || !username) return null;
  try {
    const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
    const parsed = await fetchInstagramJsonInBrowser(page, url, `https://www.instagram.com/${encodeURIComponent(username)}/`);
    return parsed?.data?.user || null;
  } catch {
    return null;
  }
}

function extractAccountUsernameFromSource(source) {
  if (!source) return '';
  if (source.kind === 'account' && typeof source.url === 'string') {
    const parts = source.url.split('/').filter(Boolean);
    return cleanText(parts[parts.length - 1]);
  }
  if (typeof source.key === 'string') {
    const match = source.key.match(/^(?:acct|related):(.+)$/);
    if (match) return cleanText(match[1]);
  }
  return '';
}

async function fetchAccountTimelineLinksFromApi(username, cookieHeader, page = null) {
  const normalized = cleanText(username).toLowerCase();
  if (!normalized) return [];
  try {
    const user = page
      ? await fetchInstagramProfileInBrowser(page, normalized)
      : await fetchInstagramProfile(normalized, cookieHeader);
    const edges = Array.isArray(user?.edge_owner_to_timeline_media?.edges)
      ? user.edge_owner_to_timeline_media.edges
      : [];
    const links = new Set();
    for (const edge of edges) {
      const postUrl = buildInstagramPostUrl(edge?.node);
      if (postUrl) links.add(postUrl);
      if (links.size >= CONFIG.perSourceLinksLimit) break;
    }
    return [...links];
  } catch {
    return [];
  }
}

async function fetchInstagramAccountSearch(query, cookieHeader) {
  if (!query || !cookieHeader) return [];
  try {
    const url = `https://www.instagram.com/web/search/topsearch/?context=blended&query=${encodeURIComponent(query)}`;
    const response = await fetch(url, { headers: buildInstagramApiHeaders(cookieHeader, 'https://www.instagram.com/explore/') });
    if (!response.ok) return [];
    const parsed = await response.json();
    const users = Array.isArray(parsed?.users) ? parsed.users : [];
    return users
      .map((entry) => entry?.user || entry)
      .filter(Boolean)
      .map((user) => ({
        username: cleanText(user?.username),
        fullName: cleanText(user?.full_name),
        biography: cleanText(user?.biography),
        isVerified: Boolean(user?.is_verified),
        isPrivate: Boolean(user?.is_private),
      }))
      .filter((user) => user.username && !user.isPrivate);
  } catch {
    return [];
  }
}

function extractCaptionFromNode(node) {
  const edges = Array.isArray(node?.edge_media_to_caption?.edges) ? node.edge_media_to_caption.edges : [];
  return edges.map((edge) => cleanText(edge?.node?.text)).filter(Boolean).join(' ');
}

function buildInstagramPostUrl(node) {
  const shortcode = cleanText(node?.shortcode);
  if (!shortcode) return '';
  const pathKind = node?.is_video || node?.__typename === 'GraphVideo' ? 'reel' : 'p';
  return `https://www.instagram.com/${pathKind}/${shortcode}/`;
}

async function collectDealsFromAccountApi(sourceStats, page) {
  if (!page) {
    console.log('ℹ️ account API path skipped: no browser page available');
    return null;
  }

  const sourceRunStats = new Map();
  const candidateSnapshot = [];
  const deals = [];
  const seenSourceKeys = new Set();
  const seenUsernames = new Set();
  const seenUrls = new Set();
  const seedAccounts = new Map();
  const merchantPriorities = merchantRegistryPriorityMap();
  for (const username of getSeedAccounts()) {
    const merchant = merchantPriorities.get(username);
    const priorityBoost = merchant ? Math.max(0, Math.min(3, Math.floor((merchant.priorityScore || merchant.confidence || 0) / 25))) : 0;
    seedAccounts.set(username, {
      kind: 'account-api',
      key: `acct:${username}`,
      username,
      priority: 3 + priorityBoost,
      discoveredBy: ['seed-account'],
    });
  }

  console.log(`🧠 account API seed queue: ${seedAccounts.size} accounts`);

  const queue = [...seedAccounts.values()]
    .sort((a, b) => (b.priority || 0) - (a.priority || 0) || a.username.localeCompare(b.username))
    .map((username) => ({
      kind: username.kind,
      key: username.key,
      username: username.username,
      priority: username.priority,
      discoveredBy: username.discoveredBy || [],
    }))
    .filter((source) => !shouldSkipWeakSource(source, sourceStats[source.key]));

  function ensureSourceRunStat(key, kind) {
    if (!sourceRunStats.has(key)) {
      sourceRunStats.set(key, {
        runs: 0,
        links: 0,
        acceptedDeals: 0,
        kind: kind || '',
        lastSeenAt: '',
      });
    }
    return sourceRunStats.get(key);
  }

  while (queue.length > 0 && seenSourceKeys.size < CONFIG.maxSourcesTotal) {
    const source = queue.shift();
    if (!source || seenSourceKeys.has(source.key)) continue;
    seenSourceKeys.add(source.key);
    seenUsernames.add(source.username);

    const runStat = ensureSourceRunStat(source.key, source.kind);
    runStat.runs += 1;
    runStat.kind = source.kind;
    runStat.lastSeenAt = new Date().toISOString();

    console.log(`🔎 api source ${source.key}`);
    const user = await fetchInstagramProfileInBrowser(page, source.username);
    if (!user) continue;

    const timelineEdges = Array.isArray(user.edge_owner_to_timeline_media?.edges)
      ? user.edge_owner_to_timeline_media.edges
      : [];
    console.log(`   ↳ timeline links: ${timelineEdges.length}`);
    runStat.links += timelineEdges.length;

    const relatedEdges = Array.isArray(user.edge_related_profiles?.edges)
      ? user.edge_related_profiles.edges
      : [];
    for (const edge of relatedEdges) {
      const username = cleanText(edge?.node?.username || edge?.node?.user?.username);
      const fullName = cleanText(edge?.node?.full_name || edge?.node?.user?.full_name);
      const biography = cleanText(edge?.node?.biography || edge?.node?.user?.biography);
      if (!username || seenUsernames.has(username)) continue;
      if (!looksLikeDiscoveryAccount({ username, fullName, biography })) continue;
      if (queue.length + seenSourceKeys.size >= CONFIG.maxSourcesTotal) break;
      seenUsernames.add(username);
      queue.push({
        kind: 'related-account-api',
        key: `related:${username}`,
        username,
        priority: 1,
      });
    }

    for (const edge of timelineEdges) {
      const node = edge?.node;
      const postUrl = buildInstagramPostUrl(node);
      if (!postUrl) continue;

      const pubDateMs = Number(node?.taken_at_timestamp || 0) * 1000;
      if (!Number.isFinite(pubDateMs) || pubDateMs <= 0) continue;
      const pubDateIso = new Date(pubDateMs).toISOString();

      const caption = extractCaptionFromNode(node);
      const locationName = cleanText(node?.location?.name);
      const combinedText = cleanText([
        caption,
        user?.full_name,
        user?.username,
        locationName,
        user?.biography,
      ].join(' '));

      candidateSnapshot.push({
        url: postUrl,
        sourceHits: 1,
        sourceKinds: [source.kind],
        refs: [source.key],
        accountHint: true,
        relatedHint: source.kind === 'related-account-api',
        discoveredBy: source.discoveredBy || [],
      });

      if (!isFresh(pubDateIso)) continue;
      if (!combinedText) continue;
      if (isExpiredByText(combinedText)) continue;
      if (isGiveawayOnly(combinedText)) continue;

      const isWien = containsKeyword(`${combinedText} ${locationName}`, WIEN_KEYWORDS)
        || /wien|vienna/i.test(cleanText(user?.username))
        || /wien|vienna/i.test(cleanText(user?.full_name));
      if (!isWien) continue;
      if (!isFoodDrinkRelevant(combinedText)) continue;
      if (!containsKeyword(combinedText, DEAL_KEYWORDS)) continue;
      if (!hasFreebieOrPromoSignal(combinedText)) continue;

      const sourceKinds = new Set([source.kind]);
      const score = scoreDeal({
        text: combinedText,
        sourceHits: 1,
        sourceKinds,
        accountHint: true,
        relatedHint: source.kind === 'related-account-api',
      });
      if (score < CONFIG.minDealScore) continue;

      const expiry = parseExpiryFromText(combinedText);
      if (expiry && isExpiryInPast(expiry)) continue;
      if (seenUrls.has(postUrl)) continue;
      seenUrls.add(postUrl);

      const category = detectCategory(combinedText, {
        accountHint: user?.username,
        relatedHint: source.kind,
        sourceHits: 1,
      });
      const type = detectType(combinedText);
      const brand = cleanText(user?.username || user?.full_name || 'Instagram');
      const titleSource = cleanText(caption || user?.full_name || user?.username || 'Instagram Deal');
      const title = titleSource.length > 88 ? `${titleSource.slice(0, 85)}...` : titleSource;

      deals.push({
        id: `igx-${stableId(`${postUrl}|${pubDateIso}|${brand}`)}`,
        brand,
        title,
        logo: inferLogo(category, combinedText),
        description: combinedText.slice(0, 220),
        type,
        category,
        source: 'Instagram Discovery',
        url: postUrl,
        expires: expiry || 'Unbekannt',
        distance: locationName || 'Wien',
        hot: score >= 84,
        isNew: true,
        priority: Math.max(1, Math.round(score / 10)),
        votes: 1,
        qualityScore: score,
        pubDate: pubDateIso,
        pubDateSource: 'profileTimeline',
        discoveredBy: [...new Set([source.kind, 'profile-api', ...(source.discoveredBy || [])])].join(','),
        sourceHits: 1,
        reviewTier: score >= 84 ? 'high' : score >= 70 ? 'medium' : 'low',
      });
      runStat.acceptedDeals += 1;
    }
  }

  return {
    deals,
    sourceRunStats,
    candidateSnapshot,
    visitedSources: seenSourceKeys.size,
    totalCandidates: candidateSnapshot.length,
    visitedPosts: candidateSnapshot.length,
    mode: 'account-api',
  };
}

async function dismissInstagramOverlays(page) {
  const labels = [
    'Nur erforderliche Cookies erlauben',
    'Allow essential cookies',
    'Jetzt nicht',
    'Not now',
    'Ablehnen',
    'Decline optional cookies',
  ];
  for (const label of labels) {
    try {
      const locator = page.getByRole('button', { name: label }).first();
      if (await locator.isVisible({ timeout: 300 })) {
        await locator.click({ timeout: 600 });
        await page.waitForTimeout(200);
      }
    } catch {}
  }
  try { await page.keyboard.press('Escape'); } catch {}
}

async function collectLinksFromDom(page) {
  try {
    const hrefs = await page.$$eval('a[href]', (nodes) => nodes.map((n) => n.getAttribute('href') || '').filter(Boolean));
    const urls = new Set();
    for (const href of hrefs) {
      let normalized = '';
      if (href.startsWith('/p/') || href.startsWith('/reel/')) {
        const parts = href.split('/').filter(Boolean);
        if (parts.length >= 2) normalized = `https://www.instagram.com/${parts[0]}/${parts[1]}/`;
      } else if (/^https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel)\//i.test(href)) {
        normalized = normalizeInstagramPostUrl(href);
      }
      if (normalized) urls.add(normalized);
    }
    return [...urls];
  } catch {
    return [];
  }
}

async function collectRelatedAccountsFromDom(page) {
  try {
    const hrefs = await page.$$eval('a[href]', (nodes) => nodes.map((n) => n.getAttribute('href') || '').filter(Boolean));
    const users = new Set();
    for (const href of hrefs) {
      const username = normalizeAccountFromHref(href);
      if (username) users.add(username);
    }
    return [...users];
  } catch {
    return [];
  }
}

function toMirrorUrl(url) {
  return `https://r.jina.ai/http://${url.replace(/^https?:\/\//, '')}`;
}

async function fetchMirrorText(url) {
  try {
    const res = await fetch(toMirrorUrl(url), { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return '';
  }
}

async function discoverLinksViaDuckDuckGo() {
  const links = new Set();
  for (const query of EXTRA_SEARCH_QUERIES) {
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!response.ok) continue;
      const html = await response.text();
      const hrefMatches = html.match(/href="([^"]+)"/g) || [];
      for (const hrefToken of hrefMatches) {
        const raw = hrefToken.replace(/^href="/, '').replace(/"$/, '');
        const normalized = normalizeInstagramPostUrl(raw);
        if (normalized) links.add(normalized);
      }
    } catch {}
  }
  return [...links];
}

function deriveBrand(data, postUrl) {
  const ldAuthor = cleanText(data.ldAuthor);
  if (ldAuthor) return ldAuthor;

  const ogTitle = cleanText(data.ogTitle);
  const titleMatch = ogTitle.match(/^(.+?)\s+auf Instagram[:]?/i);
  if (titleMatch && titleMatch[1]) return titleMatch[1].replace(/^@/, '').trim();

  const desc = cleanText(data.ogDescription);
  const atMatch = desc.match(/@([A-Za-z0-9._]+)/);
  if (atMatch) return atMatch[1];

  try {
    const u = new URL(postUrl);
    const p = u.pathname.split('/').filter(Boolean);
    return p[0] || 'Instagram';
  } catch {
    return 'Instagram';
  }
}

function ensureArtifactsDir() {
  if (!fs.existsSync(ARTIFACTS_DIR)) fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
}

function loadPreviousDeals() {
  if (!fs.existsSync(OUTPUT_PATH)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf-8'));
    return Array.isArray(parsed.deals) ? parsed.deals : [];
  } catch {
    return [];
  }
}

function saveSourceStats(sourceStats, runSummary) {
  fs.writeFileSync(SOURCE_STATS_PATH, JSON.stringify({
    updatedAt: new Date().toISOString(),
    ...runSummary,
    sources: sourceStats,
  }, null, 2));
}

function mergeDeals(newDeals, oldDeals) {
  const map = new Map();
  for (const deal of [...newDeals, ...oldDeals]) {
    const key = `${deal.url}|${deal.brand}|${String(deal.title || '').toLowerCase()}`;
    if (!map.has(key) || (map.get(key).qualityScore || 0) < (deal.qualityScore || 0)) {
      map.set(key, deal);
    }
  }

    const sorted = [...map.values()]
      .filter((d) => d.pubDate && isFresh(d.pubDate))
      .filter((d) => !isExpiryInPast(d.expires))
      .sort((a, b) => {
      const aText = `${a.title || ''} ${a.description || ''}`;
      const bText = `${b.title || ''} ${b.description || ''}`;
      const aFoodFree = /essen|restaurant|pizza|burger|kebab|kaffee|coffee|drink|brunch|food|cocktail|eis/i.test(aText) && /gratis|kostenlos|free|freebie|geschenkt|0 ?€|1\+1|bogo|gratisprobe|free sample|welcome gift/i.test(aText);
      const bFoodFree = /essen|restaurant|pizza|burger|kebab|kaffee|coffee|drink|brunch|food|cocktail|eis/i.test(bText) && /gratis|kostenlos|free|freebie|geschenkt|0 ?€|1\+1|bogo|gratisprobe|free sample|welcome gift/i.test(bText);
      const aOpeningPromo = /neueröffnung|neueroeffnung|opening|eröffnung|eroeffnung|opening deal|opening offer|eröffnungsangebot|eroeffnungsangebot/i.test(aText);
      const bOpeningPromo = /neueröffnung|neueroeffnung|opening|eröffnung|eroeffnung|opening deal|opening offer|eröffnungsangebot|eroeffnungsangebot/i.test(bText);
      if (aFoodFree !== bFoodFree) return bFoodFree ? 1 : -1;
      if (aOpeningPromo !== bOpeningPromo) return bOpeningPromo ? 1 : -1;
      if ((b.qualityScore || 0) !== (a.qualityScore || 0)) return (b.qualityScore || 0) - (a.qualityScore || 0);
      return Date.parse(b.pubDate) - Date.parse(a.pubDate);
    });

  const accountCap = Math.max(1, CONFIG.maxDealsPerInstagramAccount || 4);
  const accountCounts = new Map();
  const balanced = [];
  for (const deal of sorted) {
    const accountKey = extractAccountKeyFromDeal(deal);
    const count = accountCounts.get(accountKey) || 0;
    if (count >= accountCap) continue;
    accountCounts.set(accountKey, count + 1);
    balanced.push(deal);
    if (balanced.length >= CONFIG.maxDealsPerRun) break;
  }
  return balanced;
}

function finalizeDiscoveryRun({
  sourceStats,
  sourceRunStats,
  candidateSnapshot,
  visitedSources,
  totalCandidates,
  visitedPosts,
  rawDeals,
  mode,
}) {
  const previousDeals = loadPreviousDeals();
  const finalDeals = mergeDeals(rawDeals, previousDeals);

  ensureArtifactsDir();
  fs.writeFileSync(CANDIDATE_LOG_PATH, JSON.stringify({
    updatedAt: new Date().toISOString(),
    sourceCount: visitedSources,
    totalCandidates,
    candidates: candidateSnapshot,
    mode,
  }, null, 2));

  const persistedStats = { ...sourceStats };
  for (const [key, runStat] of sourceRunStats.entries()) {
    const prev = persistedStats[key] || {};
    persistedStats[key] = {
      kind: runStat.kind || prev.kind || '',
      runs: Number(prev.runs || 0) + Number(runStat.runs || 0),
      totalLinks: Number(prev.totalLinks || 0) + Number(runStat.links || 0),
      acceptedDeals: Number(prev.acceptedDeals || 0) + Number(runStat.acceptedDeals || 0),
      lastSeenAt: runStat.lastSeenAt || prev.lastSeenAt || '',
    };
  }

  const topSources = Object.entries(persistedStats)
    .map(([key, stat]) => {
      const safeStat = (stat && typeof stat === 'object') ? stat : {};
      return {
        key,
        kind: safeStat.kind || '',
        runs: Number(safeStat.runs || 0),
        acceptedDeals: Number(safeStat.acceptedDeals || 0),
        totalLinks: Number(safeStat.totalLinks || 0),
        performance: Math.round(sourcePerformanceScore(safeStat) * 100) / 100,
      };
    })
    .sort((a, b) => b.performance - a.performance)
    .slice(0, 30);

  saveSourceStats(persistedStats, {
    runMeta: {
      mode,
      visitedSources,
      totalCandidates,
      visitedPosts,
      scrapedDealsRaw: rawDeals.length,
      savedDeals: finalDeals.length,
    },
    topSources,
  });

  fs.writeFileSync(DISCOVERY_REPORT_PATH, JSON.stringify({
    updatedAt: new Date().toISOString(),
    mode,
    visitedSources,
    totalCandidates,
    visitedPosts,
    rawDeals: rawDeals.length,
    savedDeals: finalDeals.length,
    topSources,
  }, null, 2));

  const payload = {
    lastUpdated: new Date().toISOString(),
    source: 'instagram-discovery-engine',
    totalDeals: finalDeals.length,
    deals: finalDeals,
    meta: {
      mode,
      visitedSources,
      totalCandidates,
      visitedPosts,
      scrapedDealsRaw: rawDeals.length,
    },
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(`✅ saved ${finalDeals.length} deals → ${OUTPUT_PATH}`);
  console.log(`🧾 candidates snapshot → ${CANDIDATE_LOG_PATH}`);
  console.log(`📊 source stats → ${SOURCE_STATS_PATH}`);
  console.log(`📈 discovery report → ${DISCOVERY_REPORT_PATH}`);

  return payload;
}

function restoreCandidateMapFromSnapshot(candidateSnapshot) {
  const candidatePosts = new Map();
  for (const candidate of candidateSnapshot || []) {
    const url = normalizeInstagramPostUrl(candidate?.url);
    if (!url) continue;
    candidatePosts.set(url, {
      url,
      sourceHits: Number(candidate?.sourceHits || 0),
      sourceKinds: new Set(Array.isArray(candidate?.sourceKinds) ? candidate.sourceKinds : []),
      sourceRefs: new Set(Array.isArray(candidate?.refs) ? candidate.refs : []),
      accountHint: Boolean(candidate?.accountHint),
      relatedHint: Boolean(candidate?.relatedHint),
    });
  }
  return candidatePosts;
}

async function scrapeInstagramDiscovery() {
  console.log('📸 INSTAGRAM DISCOVERY ENGINE');
  console.log('========================================');

  loadEnvFile();
  CONFIG = buildConfig();
  const sourceStats = loadSourceStats();

  let browser;
  try {
    const { chromium } = await import('playwright');

    browser = await chromium.launch({
      headless: true,
      args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage'],
    });

    const cookieHeader = buildCookieHeader();
    const context = await browser.newContext({
      viewport: { width: 1366, height: 900 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      locale: 'de-AT',
      timezoneId: 'Europe/Vienna',
    });

    const cookieHints = buildCookieHints();
    if (cookieHints.length > 0) {
      await context.addCookies(
        cookieHints.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain || '.instagram.com',
          path: '/',
          secure: true,
          httpOnly: c.name === 'sessionid',
          sameSite: 'Lax',
        }))
      );
      console.log(`🍪 loaded ${cookieHints.length} Instagram cookies`);
    } else {
      console.log('ℹ️ no Instagram cookies found; coverage can be lower');
    }

    const page = await context.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(1800);
    await dismissInstagramOverlays(page);

    const apiResult = await collectDealsFromAccountApi(sourceStats, page);
    if (apiResult && apiResult.deals.length > 0) {
      console.log(`🧠 account API discovery: sources=${apiResult.visitedSources}, candidates=${apiResult.totalCandidates}, rawDeals=${apiResult.deals.length}`);
      return finalizeDiscoveryRun({
        sourceStats,
        sourceRunStats: apiResult.sourceRunStats,
        candidateSnapshot: apiResult.candidateSnapshot,
        visitedSources: apiResult.visitedSources,
        totalCandidates: apiResult.totalCandidates,
        visitedPosts: apiResult.visitedPosts,
        rawDeals: apiResult.deals,
        mode: apiResult.mode,
      });
    }
    const sourcesQueue = buildSources(sourceStats);
    const processedSourceKeys = new Set();
    const relatedCandidates = new Map();
    let candidatePosts = new Map();
    let sourceRunStats = new Map();
    const accountCandidateThreshold = Math.max(24, Math.min(120, Math.floor(CONFIG.maxPostsToVisit * 0.4)));
    let discoveryMode = 'browser-fallback';

    if (apiResult?.totalCandidates > 0) {
      candidatePosts = restoreCandidateMapFromSnapshot(apiResult.candidateSnapshot);
      sourceRunStats = new Map(apiResult.sourceRunStats);
      discoveryMode = 'account-api-candidates';
      console.log(`ℹ️ account API path produced 0 raw deals, but kept ${candidatePosts.size} candidate posts for extraction`);
    } else if (apiResult) {
      console.log('ℹ️ account API path produced 0 deals; falling back to browser discovery');
    }

    function ensureSourceRunStat(key) {
      if (!sourceRunStats.has(key)) {
        sourceRunStats.set(key, {
          runs: 0,
          links: 0,
          acceptedDeals: 0,
          kind: '',
          lastSeenAt: '',
        });
      }
      return sourceRunStats.get(key);
    }

    function pushCandidate(postUrl, source) {
      const normalized = normalizeInstagramPostUrl(postUrl);
      if (!normalized) return;
      if (!candidatePosts.has(normalized)) {
        candidatePosts.set(normalized, {
          url: normalized,
          sourceHits: 0,
          sourceKinds: new Set(),
          sourceRefs: new Set(),
          accountHint: false,
          relatedHint: false,
        });
      }
      const c = candidatePosts.get(normalized);
      c.sourceHits += 1;
      c.sourceKinds.add(source.kind === 'search' ? 'search' : source.kind);
      c.sourceRefs.add(source.key);
      if (source.kind === 'account') c.accountHint = true;
      if (source.kind === 'related-account') c.relatedHint = true;
    }

    if (candidatePosts.size === 0) {
      // DISCOVERY PHASE
      while (sourcesQueue.length > 0 && processedSourceKeys.size < CONFIG.maxSourcesTotal) {
        const source = sourcesQueue.shift();
        if (!source || processedSourceKeys.has(source.key)) continue;
        if (source.kind === 'hashtag' && countAccountishCandidates(candidatePosts) >= accountCandidateThreshold) {
          continue;
        }
        processedSourceKeys.add(source.key);
        const runStat = ensureSourceRunStat(source.key);
        runStat.runs += 1;
        runStat.kind = source.kind;
        runStat.lastSeenAt = new Date().toISOString();

        try {
          console.log(`🔎 source ${source.key}`);
          await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 26000 });
          await page.waitForTimeout(2200);
          await dismissInstagramOverlays(page);

          const sourceLinks = new Set();
          const relatedUsernames = new Set();
          let stagnant = 0;

          for (let round = 0; round < CONFIG.sourceScrollRounds; round += 1) {
            const before = sourceLinks.size;

            const domUrls = await collectLinksFromDom(page);
            for (const u of domUrls) sourceLinks.add(u);

            if (source.kind === 'account' || source.kind === 'related-account') {
              const users = await collectRelatedAccountsFromDom(page);
              for (const u of users) relatedUsernames.add(u);
            }

            if (sourceLinks.size >= CONFIG.perSourceLinksLimit) break;

            if (sourceLinks.size === before) stagnant += 1;
            else stagnant = 0;
            if (stagnant >= CONFIG.sourceStagnationRounds) break;

            await page.mouse.wheel(0, CONFIG.sourceScrollStepPx);
            await page.waitForTimeout(CONFIG.sourceScrollWaitMs);
            await dismissInstagramOverlays(page);
          }

          let links = [...sourceLinks].filter(Boolean).slice(0, CONFIG.perSourceLinksLimit);
          if (links.length < 10 && (source.kind === 'account' || source.kind === 'related-account')) {
            const username = extractAccountUsernameFromSource(source);
            const apiLinks = await fetchAccountTimelineLinksFromApi(username, cookieHeader, page);
            if (apiLinks.length > 0) {
              links = [...new Set([...links, ...apiLinks])].slice(0, CONFIG.perSourceLinksLimit);
            }
          }
          if (links.length < 6) {
            const mirror = await fetchMirrorText(source.url);
            links = [...new Set([...links, ...extractPostUrls(mirror)])].slice(0, CONFIG.perSourceLinksLimit);
          }

          console.log(`   ↳ links: ${links.length}`);
          runStat.links += links.length;
          for (const u of links) pushCandidate(u, source);

          if ((source.kind === 'account' || source.kind === 'related-account') && relatedUsernames.size > 0) {
            for (const username of relatedUsernames) {
              const hit = relatedCandidates.get(username) || { hits: 0, via: new Set() };
              hit.hits += 1;
              hit.via.add(source.key);
              relatedCandidates.set(username, hit);
            }
          }

          await page.waitForTimeout(CONFIG.sourceDelayMs);
        } catch (error) {
          console.log(`   ⚠️ source failed: ${error.message}`);
        }

        if (relatedCandidates.size > 0 && sourcesQueue.length < CONFIG.maxSourcesTotal) {
          const sortedRelated = [...relatedCandidates.entries()]
            .sort((a, b) => b[1].hits - a[1].hits)
            .slice(0, CONFIG.maxRelatedAccounts);

          for (const [username, meta] of sortedRelated) {
            const key = `related:${username}`;
            if (processedSourceKeys.has(key)) continue;
            if (sourcesQueue.find((s) => s.key === key)) continue;
            if (sourcesQueue.length + processedSourceKeys.size >= CONFIG.maxSourcesTotal) break;

            if (!looksLikeDiscoveryAccount({ username, hitCount: meta.hits })) continue;

            sourcesQueue.push({
              kind: 'related-account',
              key,
              url: `https://www.instagram.com/${username}/`,
              priority: 1,
            });
          }
        }
      }

      const discoveredViaSearch = await discoverLinksViaDuckDuckGo();
      for (const postUrl of discoveredViaSearch) {
        pushCandidate(postUrl, { kind: 'search', key: 'search:duckduckgo' });
      }
    } else {
      for (const key of sourceRunStats.keys()) processedSourceKeys.add(key);
      console.log(`🧠 using ${candidatePosts.size} account-api candidates for extraction`);
    }

    const candidateSnapshot = [...candidatePosts.values()].map((c) => ({
      url: c.url,
      sourceHits: c.sourceHits,
      sourceKinds: [...c.sourceKinds],
      refs: [...c.sourceRefs].slice(0, 20),
      accountHint: c.accountHint,
      relatedHint: c.relatedHint,
    }));

    const postsToVisit = [...candidatePosts.values()]
      .sort((a, b) => b.sourceHits - a.sourceHits)
      .slice(0, CONFIG.maxPostsToVisit);

    console.log(`🧠 discovery done: sources=${processedSourceKeys.size}, candidates=${candidatePosts.size}, visiting=${postsToVisit.length}`);

    // EXTRACTION PHASE
    const deals = [];

    for (let i = 0; i < postsToVisit.length; i += 1) {
      const candidate = postsToVisit[i];
      try {
        await page.goto(candidate.url, { waitUntil: 'domcontentloaded', timeout: CONFIG.postLoadTimeoutMs });
        await page.waitForTimeout(1150);

        let data = await page.evaluate(() => {
          const result = {
            ldDate: '',
            timeDateTime: '',
            igScriptTimestamp: 0,
            ldCaption: '',
            ldAuthor: '',
            ogTitle: '',
            ogDescription: '',
            text: document.body ? document.body.innerText : '',
          };

          for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
            try {
              const parsed = JSON.parse(script.textContent || '{}');
              const obj = Array.isArray(parsed) ? parsed[0] : parsed;
              if (!obj || typeof obj !== 'object') continue;
              if (obj.datePublished && !result.ldDate) result.ldDate = String(obj.datePublished);
              if (obj.caption && !result.ldCaption) result.ldCaption = String(obj.caption);
              if (obj.author && typeof obj.author === 'object' && obj.author.name && !result.ldAuthor) {
                result.ldAuthor = String(obj.author.name);
              }
            } catch {}
          }

          const ogTitle = document.querySelector('meta[property="og:title"]');
          const ogDescription = document.querySelector('meta[property="og:description"]');
          if (ogTitle?.content) result.ogTitle = ogTitle.content;
          if (ogDescription?.content) result.ogDescription = ogDescription.content;
          const timeEl = document.querySelector('time[datetime]');
          if (timeEl?.getAttribute('datetime')) result.timeDateTime = timeEl.getAttribute('datetime') || '';

          // Fallback: parse post timestamp from embedded JSON/script payloads.
          // Instagram frequently exposes `taken_at_timestamp` / `created_at`.
          const scriptTexts = Array.from(document.querySelectorAll('script'))
            .map((n) => n.textContent || '')
            .filter(Boolean)
            .slice(0, 120);
          for (const text of scriptTexts) {
            const taken = text.match(/"taken_at_timestamp"\s*:\s*(\d{9,13})/);
            if (taken) {
              result.igScriptTimestamp = Number(taken[1]);
              break;
            }
            const created = text.match(/"created_at"\s*:\s*(\d{9,13})/);
            if (created) {
              result.igScriptTimestamp = Number(created[1]);
              break;
            }
          }

          return result;
        });

        if (!data.ldCaption && !data.ogDescription) {
          const mirrorText = await fetchMirrorText(candidate.url);
          if (mirrorText) {
            const firstLines = mirrorText.split('\n').slice(0, 40).join(' ');
            data = {
              ...data,
              ogDescription: data.ogDescription || firstLines,
              text: `${data.text || ''} ${mirrorText.slice(0, 3200)}`,
            };
          }
        }

        const combinedText = cleanText([
          data.ldCaption,
          data.ogTitle,
          data.ogDescription,
          data.text.slice(0, 2200),
        ].join(' '));

        if (!combinedText) continue;

        const pubDateMeta = parseDateFromPage({
          ldDate: data.ldDate,
          timeDateTime: data.timeDateTime,
          igScriptTimestamp: data.igScriptTimestamp,
          ogDescription: data.ogDescription,
          fullText: combinedText,
        });
        if (!pubDateMeta || !pubDateMeta.iso || !TRUSTED_PUBDATE_SOURCES.has(pubDateMeta.source)) continue;
        if (!isFresh(pubDateMeta.iso)) continue;
        const pubDateIso = pubDateMeta.iso;

        if (isExpiredByText(combinedText)) continue;
        if (isGiveawayOnly(combinedText)) continue;

        const isWien = containsKeyword(combinedText, WIEN_KEYWORDS)
          || [...candidate.sourceRefs].some((k) => k.includes('wien') || k.includes('vienna'));
        if (!isWien) continue;
        if (!isFoodDrinkRelevant(combinedText)) continue;

        const dealSignal = containsKeyword(combinedText, DEAL_KEYWORDS);
        if (!dealSignal) continue;
        if (!hasFreebieOrPromoSignal(combinedText)) continue;

        const score = scoreDeal({
          text: combinedText,
          sourceHits: candidate.sourceHits,
          sourceKinds: candidate.sourceKinds,
          accountHint: candidate.accountHint,
          relatedHint: candidate.relatedHint,
        });
        if (score < CONFIG.minDealScore) continue;

        const expiry = parseExpiryFromText(combinedText);
        if (expiry && isExpiryInPast(expiry)) continue;

        const category = detectCategory(combinedText);
        const type = detectType(combinedText);
        const brand = deriveBrand(data, candidate.url);
        const titleBase = cleanText(data.ogTitle || data.ldCaption || 'Instagram Deal');
        const title = titleBase.length > 88 ? `${titleBase.slice(0, 85)}...` : titleBase;

        deals.push({
          id: `igx-${stableId(`${candidate.url}|${pubDateIso}|${brand}`)}`,
          brand,
          title,
          logo: inferLogo(category, combinedText),
          description: combinedText.slice(0, 220),
          type,
          category,
          source: 'Instagram Discovery',
          url: candidate.url,
          expires: expiry || 'Unbekannt',
          distance: 'Wien',
          hot: score >= 84,
          isNew: true,
          priority: Math.max(1, Math.round(score / 10)),
          votes: 1,
          qualityScore: score,
          pubDate: pubDateIso,
          pubDateSource: pubDateMeta.source || '',
          discoveredBy: [...candidate.sourceKinds].join(','),
          sourceHits: candidate.sourceHits,
          reviewTier: score >= 84 ? 'high' : score >= 70 ? 'medium' : 'low',
        });
        for (const ref of candidate.sourceRefs) {
          const stat = ensureSourceRunStat(ref);
          stat.acceptedDeals += 1;
          if (!stat.lastSeenAt) stat.lastSeenAt = new Date().toISOString();
        }
      } catch {
        // ignore inaccessible post
      }

      if ((i + 1) % 30 === 0) {
        console.log(`   ✅ extracted ${i + 1}/${postsToVisit.length}`);
      }
    }

    const payload = finalizeDiscoveryRun({
      sourceStats,
      sourceRunStats,
      candidateSnapshot,
      visitedSources: processedSourceKeys.size,
      totalCandidates: candidatePosts.size,
      visitedPosts: postsToVisit.length,
      rawDeals: deals,
      mode: discoveryMode,
    });

    await browser.close();
    return payload;
  } catch (error) {
    console.error(`❌ Instagram discovery failed: ${error.message}`);
    if (browser) await browser.close();

    const fallback = {
      lastUpdated: new Date().toISOString(),
      source: 'instagram-discovery-engine',
      totalDeals: 0,
      deals: [],
      meta: { error: cleanText(error.message) },
    };
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(fallback, null, 2));
    return fallback;
  }
}

scrapeInstagramDiscovery()
  .then((result) => {
    console.log(`🎉 Done: ${result.totalDeals} Instagram deals`);
    process.exit(0);
  })
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });

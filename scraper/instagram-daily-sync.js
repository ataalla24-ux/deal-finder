import '../sentry/instrument.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeCategoryForScraper } from './category-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const OUTPUT_DISCOVERY_PATH = path.join(DOCS_DIR, 'deals-pending-instagram-discovery.json');
const OUTPUT_WEB_PATH = path.join(DOCS_DIR, 'deals-pending-instagram-web.json');
const OUTPUT_MERGED_PATH = path.join(DOCS_DIR, 'deals-pending-instagram.json');
const DISCOVERY_REPORT_PATH = path.join(DOCS_DIR, 'instagram-discovery-report.json');
const WEB_REPORT_PATH = path.join(DOCS_DIR, 'instagram-web-report.json');
const SOURCE_STATS_PATH = path.join(DOCS_DIR, 'instagram-source-stats.json');
const MERCHANT_REGISTRY_PATH = path.join(DOCS_DIR, 'instagram-merchant-registry.json');
const ENV_PATH = path.join(ROOT, '.env');

const DEFAULT_CONFIG = {
  maxAgeDays: 7,
  maxDealsPerRun: 40,
  maxSourcesTotal: 24,
  maxTimelinePostsPerAccount: 18,
  maxRegistryAccounts: 12,
  minDealScore: 58,
  maxDealsPerAccount: 3,
  sourceDelayMs: 650,
  maxRunMinutes: 45,
};

const TRUSTED_PUBDATE_SOURCE = 'profileTimeline';

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
  'gelato', 'ice cream', 'eis', 'bakery', 'bäckerei', 'backerei', 'ramen',
];

const EXPIRED_KEYWORDS = [
  'abgelaufen', 'vorbei', 'ended', 'expired', 'ausverkauft', 'nicht mehr gültig',
  'not valid anymore', 'beendet',
];

const GIVEAWAY_KEYWORDS = ['gewinnspiel', 'verlosung', 'giveaway'];

let CONFIG = { ...DEFAULT_CONFIG };

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

function toNum(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function buildConfig() {
  return {
    ...DEFAULT_CONFIG,
    maxAgeDays: Math.min(14, toNum(process.env.IG_MAX_AGE_DAYS, DEFAULT_CONFIG.maxAgeDays)),
    maxDealsPerRun: toNum(process.env.IG_MAX_DEALS, DEFAULT_CONFIG.maxDealsPerRun),
    maxSourcesTotal: toNum(process.env.IG_MAX_SOURCES_TOTAL, DEFAULT_CONFIG.maxSourcesTotal),
    maxTimelinePostsPerAccount: toNum(process.env.IG_MAX_TIMELINE_POSTS, DEFAULT_CONFIG.maxTimelinePostsPerAccount),
    maxRegistryAccounts: toNum(process.env.IG_MAX_REGISTRY_ACCOUNTS, DEFAULT_CONFIG.maxRegistryAccounts),
    minDealScore: toNum(process.env.IG_MIN_SCORE, DEFAULT_CONFIG.minDealScore),
    maxDealsPerAccount: toNum(process.env.IG_MAX_DEALS_PER_ACCOUNT, DEFAULT_CONFIG.maxDealsPerAccount),
    sourceDelayMs: toNum(process.env.IG_SOURCE_DELAY_MS, DEFAULT_CONFIG.sourceDelayMs),
    maxRunMinutes: toNum(process.env.IG_MAX_RUN_MINUTES, DEFAULT_CONFIG.maxRunMinutes),
  };
}

function normalizeUsername(value) {
  const username = cleanText(value).toLowerCase().replace(/^@/, '').trim();
  if (!username || RESERVED_IG_PATHS.has(username)) return '';
  if (!/^[a-z0-9._]{2,40}$/.test(username)) return '';
  return username;
}

function keywordHits(text, keywords) {
  const lower = cleanText(text).toLowerCase();
  if (!lower) return 0;
  let hits = 0;
  for (const keyword of keywords) {
    if (lower.includes(keyword)) hits += 1;
  }
  return hits;
}

function containsKeyword(text, keywords) {
  return keywordHits(text, keywords) > 0;
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

function isExpiredByText(text) {
  const lower = cleanText(text).toLowerCase();
  if (!lower) return false;
  return EXPIRED_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function detectCategory(text, meta = {}) {
  return normalizeCategoryForScraper('', [
    text,
    meta.accountHint,
    meta.sourceKey,
  ]);
}

function detectType(text) {
  const lower = cleanText(text).toLowerCase();
  if (lower.includes('1+1') || lower.includes('2for1') || lower.includes('2 for 1') || lower.includes('bogo')) return 'bogo';
  const hasExplicitFreebie = FREEBIE_KEYWORDS.some((k) => lower.includes(k));
  const hasStrongPriceSignal = /(?:\b\d{1,3}\s?€)|(?:€\s?\d{1,3})|(?:\b\d{1,3}\s?euro)|(?:\b-\d{1,3}%\b)|(?:\b\d{1,3}%\s*(?:rabatt|off|discount))/i.test(lower);
  if (hasExplicitFreebie && !hasStrongPriceSignal) return 'gratis';
  return 'rabatt';
}

function detectOfferLabel(text = '') {
  const signal = cleanText(text).toLowerCase();
  if (!signal) return '';
  if (/(döner|doener|kebab|kebap)/.test(signal)) return 'Döner';
  if (/(burger|smashburger)/.test(signal)) return 'Burger';
  if (/(pizza|pinsa)/.test(signal)) return 'Pizza';
  if (/(eis|gelato|ice cream|cone)/.test(signal)) return 'Eis';
  if (/(kaffee|coffee|espresso|latte|cappuccino|matcha)/.test(signal)) return 'Kaffee';
  if (/(sushi|maki|nigiri)/.test(signal)) return 'Sushi';
  if (/(cocktail|getränk|getraenk|drink|spritz|smoothie|bubble tea|tee)/.test(signal)) return 'Getränk';
  if (/(croissant|krapfen|brioche|pastry|gebäck|gebaeck)/.test(signal)) return 'Gebäck';
  if (/(ramen|noodles?)/.test(signal)) return 'Ramen';
  return '';
}

function inferLogo(category, text) {
  const lower = cleanText(text).toLowerCase();
  if (lower.includes('kebab') || lower.includes('kebap') || lower.includes('döner') || lower.includes('doener')) return '🥙';
  if (lower.includes('pizza')) return '🍕';
  if (lower.includes('burger')) return '🍔';
  if (lower.includes('sushi')) return '🍣';
  if (lower.includes('kaffee') || lower.includes('coffee') || lower.includes('cafe') || lower.includes('café')) return '☕';
  if (lower.includes('eis') || lower.includes('gelato') || lower.includes('ice cream')) return '🍦';
  if (category === 'fitness') return '💪';
  if (category === 'beauty') return '💄';
  return '📷';
}

function parseExpiryFromText(text, now = new Date()) {
  const lower = cleanText(text).toLowerCase();
  if (!lower) return '';

  const dmy = lower.match(/(?:gültig\s*bis|nur\s*bis|bis|ends?\s*(?:on)?|until)\s*(\d{1,2})\.(\d{1,2})\.(\d{2,4})?/i);
  if (dmy) {
    const year = dmy[3] ? (dmy[3].length === 2 ? Number(`20${dmy[3]}`) : Number(dmy[3])) : now.getFullYear();
    const month = String(dmy[2]).padStart(2, '0');
    const day = String(dmy[1]).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  if (lower.includes('nur heute') || lower.includes('only today')) {
    return now.toISOString().slice(0, 10);
  }
  if (lower.includes('nur morgen') || lower.includes('only tomorrow')) {
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    return tomorrow.toISOString().slice(0, 10);
  }

  return '';
}

function isExpiryInPast(expiryValue) {
  const value = cleanText(expiryValue);
  if (!value) return false;
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return false;
  const endTs = new Date(new Date(ts).toISOString().slice(0, 10)).getTime() + (24 * 60 * 60 * 1000 - 1);
  return Date.now() > endTs;
}

function isFresh(pubDateIso) {
  const ts = Date.parse(pubDateIso);
  if (Number.isNaN(ts)) return false;
  const ageMs = Date.now() - ts;
  return ageMs >= 0 && ageMs <= CONFIG.maxAgeDays * 24 * 60 * 60 * 1000;
}

function stableId(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 33 + seed.charCodeAt(i)) >>> 0;
  return hash.toString(36);
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
    const pair = `${name}=${value}`;
    if (seen.has(pair)) continue;
    seen.add(pair);
    parts.push(pair);
  }
  return parts.join('; ');
}

function buildInstagramApiHeaders(cookieHeader, referer = 'https://www.instagram.com/') {
  return {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Cookie: cookieHeader,
    'X-IG-App-ID': '936619743392459',
    'X-Requested-With': 'XMLHttpRequest',
    Referer: referer,
    Accept: '*/*',
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

async function fetchInstagramProfileDirect(username, cookieHeader) {
  if (!username || !cookieHeader) return null;
  try {
    const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
    const response = await fetch(url, {
      headers: buildInstagramApiHeaders(cookieHeader, `https://www.instagram.com/${encodeURIComponent(username)}/`),
    });
    if (!response.ok) return null;
    const parsed = await response.json();
    return parsed?.data?.user || null;
  } catch {
    return null;
  }
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

function normalizePostHref(href) {
  const raw = cleanText(href);
  if (!raw) return '';
  if (raw.startsWith('/p/') || raw.startsWith('/reel/')) {
    const parts = raw.split('/').filter(Boolean);
    if (parts.length >= 2) return `https://www.instagram.com/${parts[0]}/${parts[1]}/`;
  }
  if (/^https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel)\//i.test(raw)) {
    return normalizeInstagramPostUrl(raw);
  }
  return '';
}

function extractPostUrls(html) {
  const urls = new Set();
  const re = /https:\/\/(?:www\.)?instagram\.com\/(?:p|reel)\/[A-Za-z0-9_-]+\//g;
  const matches = html.match(re) || [];
  for (const match of matches) urls.add(match);
  return [...urls];
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
    let match;
    while ((match = re.exec(text)) !== null) {
      if (/^[a-z]{2}_[A-Z]{2}$/i.test(match[1])) continue;
      urls.add(`https://www.instagram.com/p/${match[1]}/`);
    }
  }
  return urls;
}

async function collectLinksFromDom(page) {
  try {
    const hrefs = await page.$$eval('a[href]', (nodes) => nodes.map((n) => n.getAttribute('href') || '').filter(Boolean));
    const urls = new Set();
    for (const href of hrefs) {
      const normalized = normalizePostHref(href);
      if (normalized) urls.add(normalized);
    }
    return [...urls];
  } catch {
    return [];
  }
}

async function collectLinksFromScripts(page) {
  try {
    const scriptContents = await page.$$eval('script', (nodes) => nodes.map((n) => n.textContent || '').filter(Boolean));
    const urls = new Set();
    for (const content of scriptContents.slice(0, 60)) {
      for (const url of extractShortcodesFromText(content)) urls.add(url);
    }
    return [...urls];
  } catch {
    return [];
  }
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

function parseDateFromPage({ ldDate, timeDateTime, igScriptTimestamp, ogDescription, fullText, fallbackNow = Date.now() }) {
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

  const text = cleanText(ogDescription);
  const ymd = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) return { iso: new Date(`${ymd[1]}-${ymd[2]}-${ymd[3]}T12:00:00Z`).toISOString(), source: 'ogDescriptionDate' };

  const dmy = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (dmy) {
    const yyyy = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
    const mm = String(dmy[2]).padStart(2, '0');
    const dd = String(dmy[1]).padStart(2, '0');
    return { iso: new Date(`${yyyy}-${mm}-${dd}T12:00:00Z`).toISOString(), source: 'ogDescriptionDate' };
  }

  const dmyNoYear = text.match(/(\d{1,2})\.(\d{1,2})(?!\.)/);
  if (dmyNoYear) {
    const mm = String(dmyNoYear[2]).padStart(2, '0');
    const dd = String(dmyNoYear[1]).padStart(2, '0');
    const now = new Date(fallbackNow);
    let candidate = new Date(`${now.getFullYear()}-${mm}-${dd}T12:00:00Z`);
    if (candidate.getTime() - fallbackNow > 30 * 24 * 60 * 60 * 1000) {
      candidate = new Date(`${now.getFullYear() - 1}-${mm}-${dd}T12:00:00Z`);
    }
    if (!Number.isNaN(candidate.getTime())) return { iso: candidate.toISOString(), source: 'ogDescriptionDate' };
  }

  const relFromOg = parseRelativeAgeToDate(ogDescription, fallbackNow);
  if (relFromOg) return { iso: relFromOg, source: 'relativeAge' };

  const relFromText = parseRelativeAgeToDate(fullText, fallbackNow);
  if (relFromText) return { iso: relFromText, source: 'relativeAge' };

  return null;
}

function deriveBrandFromPostData(data, postUrl) {
  const ldAuthor = cleanText(data.ldAuthor);
  if (ldAuthor) return ldAuthor;

  const ogTitle = cleanText(data.ogTitle);
  const titleMatch = ogTitle.match(/^(.+?)\s+auf Instagram[:]?/i);
  if (titleMatch && titleMatch[1]) return titleMatch[1].replace(/^@/, '').trim();

  const desc = cleanText(data.ogDescription);
  const atMatch = desc.match(/@([A-Za-z0-9._]+)/);
  if (atMatch) return prettifyUsername(atMatch[1]);

  try {
    const parsed = new URL(postUrl);
    const parts = parsed.pathname.split('/').filter(Boolean);
    return parts[0] || 'Instagram';
  } catch {
    return 'Instagram';
  }
}

function toMirrorUrl(url) {
  return `https://r.jina.ai/http://${url.replace(/^https?:\/\//, '')}`;
}

async function fetchMirrorText(url) {
  try {
    const response = await fetch(toMirrorUrl(url), { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!response.ok) return '';
    return await response.text();
  } catch {
    return '';
  }
}

async function collectProfileFallbackLinks(page, username) {
  const normalized = normalizeUsername(username);
  if (!page || !normalized) return [];
  const links = new Set();

  const collectOnCurrentPage = async () => {
    const domUrls = await collectLinksFromDom(page);
    const scriptUrls = await collectLinksFromScripts(page);
    const html = await page.content();
    const htmlUrls = extractPostUrls(html);
    for (const url of [...domUrls, ...scriptUrls, ...htmlUrls]) {
      links.add(normalizeInstagramPostUrl(url));
      if (links.size >= CONFIG.maxTimelinePostsPerAccount) break;
    }
  };

  try {
    await page.goto(`https://www.instagram.com/${normalized}/`, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(1400);
    await dismissInstagramOverlays(page);
    await collectOnCurrentPage();
  } catch {}

  if (links.size < 4) {
    try {
      await page.goto(`https://www.instagram.com/${normalized}/reels/`, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.waitForTimeout(1200);
      await dismissInstagramOverlays(page);
      await collectOnCurrentPage();
    } catch {}
  }

  return [...links].filter(Boolean).slice(0, CONFIG.maxTimelinePostsPerAccount);
}

function buildInstagramPostUrl(node) {
  const shortcode = cleanText(node?.shortcode);
  if (!shortcode) return '';
  const pathKind = node?.is_video || node?.__typename === 'GraphVideo' ? 'reel' : 'p';
  return `https://www.instagram.com/${pathKind}/${shortcode}/`;
}

function extractCaptionFromNode(node) {
  const edges = Array.isArray(node?.edge_media_to_caption?.edges) ? node.edge_media_to_caption.edges : [];
  return edges.map((edge) => cleanText(edge?.node?.text)).filter(Boolean).join(' ');
}

function prettifyUsername(username) {
  const text = normalizeUsername(username)
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  return text.split(' ').map((part) => `${part[0].toUpperCase()}${part.slice(1)}`).join(' ');
}

function deriveBrandFromUser(user) {
  const fullName = cleanText(user?.full_name);
  const username = normalizeUsername(user?.username);
  if (fullName && fullName.length >= 3 && !/^(vienna|wien)$/i.test(fullName)) return fullName;
  if (username) return prettifyUsername(username);
  return 'Instagram';
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

function loadSourceStats() {
  if (!fs.existsSync(SOURCE_STATS_PATH)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(SOURCE_STATS_PATH, 'utf-8'));
    const sourceStats = parsed?.sources && typeof parsed.sources === 'object' ? parsed.sources : parsed;
    if (!sourceStats || typeof sourceStats !== 'object') return {};
    const cleaned = {};
    for (const [key, value] of Object.entries(sourceStats)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      cleaned[key] = {
        kind: cleanText(value.kind || ''),
        runs: Number(value.runs || 0),
        totalLinks: Number(value.totalLinks || 0),
        acceptedDeals: Number(value.acceptedDeals || 0),
        lastSeenAt: cleanText(value.lastSeenAt || ''),
      };
    }
    return cleaned;
  } catch {
    return {};
  }
}

function shouldSkipWeakSource(stat) {
  if (!stat) return false;
  const runs = Number(stat.runs || 0);
  const hits = Number(stat.acceptedDeals || 0);
  const links = Number(stat.totalLinks || 0);
  if (runs < 6) return false;
  if (hits > 0) return false;
  return (links / Math.max(1, runs)) < 2;
}

function loadMerchantRegistryAccounts() {
  if (!fs.existsSync(MERCHANT_REGISTRY_PATH)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(MERCHANT_REGISTRY_PATH, 'utf-8'));
    const accounts = Array.isArray(parsed?.accounts) ? parsed.accounts : [];
    return accounts
      .map((account) => ({
        username: normalizeUsername(account?.username),
        confidence: Number(account?.confidence || 0),
        priorityScore: Number(account?.priorityScore || 0),
        missionHits: Number(account?.missionHits || 0),
        fresh1dHits: Number(account?.fresh1dHits || 0),
      }))
      .filter((account) => account.username)
      .filter((account) => account.confidence >= 45 && (account.missionHits > 0 || account.fresh1dHits > 0))
      .sort((a, b) => (
        b.priorityScore - a.priorityScore
        || b.confidence - a.confidence
        || b.missionHits - a.missionHits
        || a.username.localeCompare(b.username)
      ));
  } catch {
    return [];
  }
}

function buildSourceQueue(sourceStats) {
  const queue = [];
  const seen = new Set();
  const registryAccounts = loadMerchantRegistryAccounts().slice(0, CONFIG.maxRegistryAccounts);

  for (const username of SEED_ACCOUNTS) {
    const normalized = normalizeUsername(username);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    queue.push({ username: normalized, key: `acct:${normalized}`, sourceType: 'seed-account', priority: 100 });
  }

  for (const account of registryAccounts) {
    if (seen.has(account.username)) continue;
    seen.add(account.username);
    queue.push({
      username: account.username,
      key: `acct:${account.username}`,
      sourceType: 'merchant-registry',
      priority: 70 + Math.min(20, Math.floor((account.priorityScore || account.confidence || 0) / 10)),
    });
  }

  return queue
    .filter((source) => !shouldSkipWeakSource(sourceStats[source.key]))
    .sort((a, b) => {
      const aScore = a.priority + sourcePerformanceScore(sourceStats[a.key]);
      const bScore = b.priority + sourcePerformanceScore(sourceStats[b.key]);
      return bScore - aScore || a.username.localeCompare(b.username);
    })
    .slice(0, CONFIG.maxSourcesTotal);
}

function createRejectionCounters() {
  return {
    noProfile: 0,
    noTimeline: 0,
    noPostUrl: 0,
    noPubDate: 0,
    stale: 0,
    noContent: 0,
    expired: 0,
    giveaway: 0,
    notWien: 0,
    notFoodDrink: 0,
    noDealSignal: 0,
    noPromoSignal: 0,
    lowScore: 0,
    duplicateUrl: 0,
    accountCap: 0,
  };
}

function scoreDeal({ text, sourcePerformance = 0, sourceType = '' }) {
  const lower = cleanText(text).toLowerCase();
  const dealHits = keywordHits(lower, DEAL_KEYWORDS);
  const freebieHits = keywordHits(lower, FREEBIE_KEYWORDS);
  const promoHits = keywordHits(lower, PROMO_KEYWORDS);
  const giftHits = keywordHits(lower, GIFT_KEYWORDS);
  const drinkHits = keywordHits(lower, DRINK_KEYWORDS);
  const openingHits = keywordHits(lower, OPENING_KEYWORDS);
  const wienHits = keywordHits(lower, WIEN_KEYWORDS);
  const foodHits = keywordHits(lower, FOOD_KEYWORDS);
  const isFoodDrinkDeal = foodHits > 0 || drinkHits > 0;
  const isFreeSignal = /gratis|kostenlos|free|freebie|geschenkt|0 ?€|1\+1|2 for 1|bogo|free sample|gratisprobe|welcome gift/.test(lower);
  const isRealPromo = promoHits > 0 || openingHits > 0;

  let score = 0;
  score += Math.min(dealHits * 9, 36);
  score += Math.min(freebieHits * 13, 32);
  score += Math.min(promoHits * 8, 24);
  score += Math.min(giftHits * 10, 20);
  score += Math.min(wienHits * 11, 33);
  score += Math.min(foodHits * 5, 15);
  score += Math.min(drinkHits * 5, 12);
  score += Math.min(openingHits * 9, 18);
  score += Math.min(sourcePerformance / 10, 10);

  if (sourceType === 'seed-account') score += 8;
  if (sourceType === 'merchant-registry') score += 6;
  if (isFoodDrinkDeal) score += 10;
  if (isFoodDrinkDeal && isFreeSignal) score += 18;
  if (isRealPromo && isFoodDrinkDeal) score += 12;
  if (lower.includes('nur heute') || lower.includes('only today')) score += 8;
  if (lower.includes('neueröffnung') || lower.includes('neueroeffnung') || lower.includes('opening')) score += 7;
  if (isExpiredByText(lower)) score -= 50;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function buildFallbackTitle({ type, brand, text }) {
  const offer = cleanText(text).toLowerCase();
  const offerLabel = detectOfferLabel(text);
  if (type === 'gratis') {
    if (offerLabel) return `Gratis ${offerLabel} bei ${brand}`;
    return `Gratis bei ${brand}`;
  }
  if (type === 'bogo') return offerLabel ? `1+1 ${offerLabel} bei ${brand}` : `1+1 bei ${brand}`;
  if (/grand opening|soft opening|neueröffnung|neueroeffnung|eröffnung|eroeffnung/.test(offer)) {
    return offerLabel ? `${offerLabel}-Opening bei ${brand}` : `Opening Deal bei ${brand}`;
  }
  if (offerLabel) return `${offerLabel}-Deal bei ${brand}`;
  return `${brand}: Rabatt`;
}

function buildDealDescription({ type, brand, text, location }) {
  const cleanLocation = cleanText(location);
  const offerLabel = detectOfferLabel(text);
  if (type === 'gratis') {
    if (offerLabel && cleanLocation) return `Gratis ${offerLabel} bei ${brand} in ${cleanLocation}`;
    if (offerLabel) return `Gratis ${offerLabel} bei ${brand}`;
    if (cleanLocation) return `Gratis bei ${brand} in ${cleanLocation}`;
    return `Gratis bei ${brand}`;
  }
  if (type === 'bogo') {
    if (offerLabel && cleanLocation) return `1+1 ${offerLabel} bei ${brand} in ${cleanLocation}`;
    if (offerLabel) return `1+1 ${offerLabel} bei ${brand}`;
    if (cleanLocation) return `1+1 Angebot bei ${brand} in ${cleanLocation}`;
    return `1+1 Angebot bei ${brand}`;
  }
  const title = buildFallbackTitle({ type, brand, text });
  if (cleanLocation) return `${title} in ${cleanLocation}`;
  return title;
}

function limitTitle(title) {
  const clean = cleanText(title);
  if (!clean) return '';
  return clean.length > 88 ? `${clean.slice(0, 85)}...` : clean;
}

function formatCandidateSnapshot(candidate) {
  return {
    url: candidate.url,
    pubDate: candidate.pubDate,
    pubDateSource: candidate.pubDateSource,
    sourceKey: candidate.sourceKey,
    sourceType: candidate.sourceType,
    score: candidate.score,
    brand: candidate.brand,
    category: candidate.category,
    type: candidate.type,
    distance: candidate.distance,
  };
}

function buildDealFromCandidate({
  postUrl,
  pubDateIso,
  pubDateSource,
  combinedText,
  brand,
  locationName,
  rawTitle,
  source,
  sourcePerformance,
  rejectionReasons,
  seenUrls,
  accountDealCounts,
}) {
  if (!pubDateIso) {
    rejectionReasons.noPubDate += 1;
    return null;
  }
  if (!isFresh(pubDateIso)) {
    rejectionReasons.stale += 1;
    return null;
  }
  if (!combinedText) {
    rejectionReasons.noContent += 1;
    return null;
  }
  if (isExpiredByText(combinedText)) {
    rejectionReasons.expired += 1;
    return null;
  }
  if (isGiveawayOnly(combinedText)) {
    rejectionReasons.giveaway += 1;
    return null;
  }

  const isWien = containsKeyword(`${combinedText} ${locationName}`, WIEN_KEYWORDS)
    || /wien|vienna/i.test(cleanText(source?.username))
    || /wien|vienna/i.test(cleanText(brand));
  if (!isWien) {
    rejectionReasons.notWien += 1;
    return null;
  }
  if (!isFoodDrinkRelevant(combinedText)) {
    rejectionReasons.notFoodDrink += 1;
    return null;
  }
  if (!containsKeyword(combinedText, DEAL_KEYWORDS)) {
    rejectionReasons.noDealSignal += 1;
    return null;
  }
  if (!hasFreebieOrPromoSignal(combinedText)) {
    rejectionReasons.noPromoSignal += 1;
    return null;
  }

  const score = scoreDeal({
    text: combinedText,
    sourcePerformance,
    sourceType: source?.sourceType || '',
  });
  if (score < CONFIG.minDealScore) {
    rejectionReasons.lowScore += 1;
    return null;
  }

  const expiry = parseExpiryFromText(combinedText);
  if (expiry && isExpiryInPast(expiry)) {
    rejectionReasons.expired += 1;
    return null;
  }
  const accountCount = accountDealCounts.get(source.username) || 0;

  const type = detectType(combinedText);
  const category = detectCategory(combinedText, {
    accountHint: source.username,
    sourceKey: source.key,
  });
  const title = limitTitle(cleanText(rawTitle) || buildFallbackTitle({ type, brand, text: combinedText }));
  const description = buildDealDescription({
    type,
    brand,
    text: combinedText,
    location: locationName || 'Wien',
  });

  const deal = {
    id: `igd-${stableId(`${postUrl}|${pubDateIso}|${brand}`)}`,
    brand,
    title,
    logo: inferLogo(category, combinedText),
    description,
    type,
    category,
    source: 'Instagram Daily Sync',
    originSource: 'Instagram Daily Sync v2',
    url: postUrl,
    expires: expiry || 'Unbekannt',
    distance: locationName || 'Wien',
    hot: score >= 84,
    isNew: true,
    priority: Math.max(1, Math.round(score / 10)),
    votes: 1,
    qualityScore: score,
    pubDate: pubDateIso,
    pubDateSource: pubDateSource || TRUSTED_PUBDATE_SOURCE,
    discoveredBy: source.sourceType,
    sourceHits: 1,
    reviewTier: score >= 84 ? 'high' : score >= 70 ? 'medium' : 'low',
  };

  accountDealCounts.set(source.username, accountCount + 1);

  return {
    deal,
    candidate: formatCandidateSnapshot({
      url: postUrl,
      pubDate: pubDateIso,
      pubDateSource: pubDateSource || TRUSTED_PUBDATE_SOURCE,
      sourceKey: source.key,
      sourceType: source.sourceType,
      score,
      brand,
      category,
      type,
      distance: locationName || 'Wien',
    }),
  };
}

async function buildDealFromPostPage(page, source, postUrl, sourcePerformance, rejectionReasons, seenUrls, accountDealCounts) {
  try {
    await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 12000 });
    await page.waitForTimeout(900);

    let data = await page.evaluate(() => {
      const result = {
        ldDate: '',
        ldCaption: '',
        ldAuthor: '',
        ogTitle: '',
        ogDescription: '',
        timeDateTime: '',
        igScriptTimestamp: 0,
        locationName: '',
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

      const locationLink = document.querySelector('a[href*="/explore/locations/"]');
      if (locationLink?.textContent) result.locationName = locationLink.textContent;

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
      const mirrorText = await fetchMirrorText(postUrl);
      if (mirrorText) {
        const firstLines = mirrorText.split('\n').slice(0, 40).join(' ');
        data = {
          ...data,
          ogDescription: data.ogDescription || firstLines,
          text: `${data.text || ''} ${mirrorText.slice(0, 3000)}`,
        };
      }
    }

    const combinedText = cleanText([
      data.ldCaption,
      data.ogTitle,
      data.ogDescription,
      data.text.slice(0, 2000),
    ].join(' '));

    const pubDateMeta = parseDateFromPage({
      ldDate: data.ldDate,
      timeDateTime: data.timeDateTime,
      igScriptTimestamp: data.igScriptTimestamp,
      ogDescription: data.ogDescription,
      fullText: combinedText,
    });

    const brand = cleanText(deriveBrandFromPostData(data, postUrl)) || prettifyUsername(source.username) || 'Instagram';
    const locationName = cleanText(data.locationName) || 'Wien';

    return buildDealFromCandidate({
      postUrl,
      pubDateIso: pubDateMeta?.iso || '',
      pubDateSource: pubDateMeta?.source || '',
      combinedText,
      brand,
      locationName,
      source,
      sourcePerformance,
      rejectionReasons,
      seenUrls,
      accountDealCounts,
    });
  } catch {
    rejectionReasons.noContent += 1;
    return null;
  }
}

async function fetchInstagramProfileWithFallbacks(page, username, cookieHeader) {
  const normalized = normalizeUsername(username);
  if (!normalized) return { user: null, strategy: 'invalid' };

  const direct = await fetchInstagramProfileDirect(normalized, cookieHeader);
  if (direct) return { user: direct, strategy: 'direct-api', fallbackLinks: [] };

  const browser = await fetchInstagramProfileInBrowser(page, normalized);
  if (browser) return { user: browser, strategy: 'browser-api', fallbackLinks: [] };

  const fallbackLinks = await collectProfileFallbackLinks(page, normalized);
  if (fallbackLinks.length > 0) {
    return { user: null, strategy: 'profile-dom', fallbackLinks };
  }

  return { user: null, strategy: 'none', fallbackLinks: [] };
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

async function main() {
  loadEnvFile();
  CONFIG = buildConfig();
  const sourceStats = loadSourceStats();
  const sourceQueue = buildSourceQueue(sourceStats);
  const runStats = new Map();
  const rejectionReasons = createRejectionCounters();
  const candidateSnapshot = [];
  const acceptedDeals = [];
  const seenUrls = new Set();
  const accountDealCounts = new Map();
  let totalCandidates = 0;
  let visitedPosts = 0;
  const runStartedAt = Date.now();
  let stoppedByRunBudget = false;

  const shouldStopForRunBudget = () => (
    Number.isFinite(CONFIG.maxRunMinutes) &&
    CONFIG.maxRunMinutes > 0 &&
    Date.now() - runStartedAt >= CONFIG.maxRunMinutes * 60 * 1000
  );

  let browser;
  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({
      headless: true,
      args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage'],
    });

    const context = await browser.newContext({
      viewport: { width: 1366, height: 900 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      locale: 'de-AT',
      timezoneId: 'Europe/Vienna',
    });

    const cookieHints = buildCookieHints();
    const cookieHeader = buildCookieHeader();
    const profileStrategyCounts = {
      directApi: 0,
      browserApi: 0,
      profileDom: 0,
      none: 0,
    };
    if (cookieHints.length > 0) {
      await context.addCookies(
        cookieHints.map((cookie) => ({
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain || '.instagram.com',
          path: '/',
          secure: true,
          httpOnly: cookie.name === 'sessionid',
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
    await page.waitForTimeout(1500);
    await dismissInstagramOverlays(page);

    console.log('📸 INSTAGRAM DAILY SYNC V2');
    console.log('========================================');
    console.log(`🧠 source queue: ${sourceQueue.length} accounts`);
    console.log(`⏱️ search budget: ${CONFIG.maxRunMinutes} min, delay ${CONFIG.sourceDelayMs}ms/account`);

    for (const source of sourceQueue) {
      if (shouldStopForRunBudget()) {
        stoppedByRunBudget = true;
        console.log(`⏱️ stopping source loop after ${Math.round((Date.now() - runStartedAt) / 1000)}s budget`);
        break;
      }

      const stat = runStats.get(source.key) || {
        kind: source.sourceType,
        runs: 0,
        links: 0,
        acceptedDeals: 0,
        lastSeenAt: '',
      };
      stat.runs += 1;
      stat.kind = source.sourceType;
      stat.lastSeenAt = new Date().toISOString();
      runStats.set(source.key, stat);

      const sourcePerformance = sourcePerformanceScore(sourceStats[source.key]);
      const profileResult = await fetchInstagramProfileWithFallbacks(page, source.username, cookieHeader);
      if (profileResult.strategy === 'direct-api') profileStrategyCounts.directApi += 1;
      else if (profileResult.strategy === 'browser-api') profileStrategyCounts.browserApi += 1;
      else if (profileResult.strategy === 'profile-dom') profileStrategyCounts.profileDom += 1;
      else profileStrategyCounts.none += 1;

      console.log(`🔎 timeline source ${source.key} (${profileResult.strategy || 'none'})`);

      if (profileResult.user) {
        const user = profileResult.user;
        let timelineEdges = Array.isArray(user.edge_owner_to_timeline_media?.edges)
          ? user.edge_owner_to_timeline_media.edges
          : [];

        if (timelineEdges.length === 0) {
          const fallbackLinks = await collectProfileFallbackLinks(page, source.username);
          if (fallbackLinks.length === 0) {
            rejectionReasons.noTimeline += 1;
          } else {
            profileStrategyCounts.profileDom += 1;
            stat.links += fallbackLinks.length;
            totalCandidates += fallbackLinks.length;
            console.log(`   ↳ fallback links after empty timeline: ${fallbackLinks.length}`);

            for (const postUrl of fallbackLinks.slice(0, CONFIG.maxTimelinePostsPerAccount)) {
              visitedPosts += 1;
              const built = await buildDealFromPostPage(
                page,
                source,
                postUrl,
                sourcePerformance,
                rejectionReasons,
                seenUrls,
                accountDealCounts
            );
              if (!built) continue;
              stat.acceptedDeals += 1;
              acceptedDeals.push(built.deal);
              candidateSnapshot.push(built.candidate);
            }
          }
        }

        if (timelineEdges.length > 0) {
          const slicedEdges = timelineEdges.slice(0, CONFIG.maxTimelinePostsPerAccount);
          stat.links += slicedEdges.length;
          totalCandidates += slicedEdges.length;
          console.log(`   ↳ timeline links: ${slicedEdges.length}`);

          for (const edge of slicedEdges) {
            visitedPosts += 1;
            const node = edge?.node;
            const postUrl = buildInstagramPostUrl(node);
            if (!postUrl) {
              rejectionReasons.noPostUrl += 1;
              continue;
            }

            const pubDateMs = Number(node?.taken_at_timestamp || 0) * 1000;
            const pubDateIso = Number.isFinite(pubDateMs) && pubDateMs > 0 ? new Date(pubDateMs).toISOString() : '';
            const caption = extractCaptionFromNode(node);
            const locationName = cleanText(node?.location?.name);
            const brand = deriveBrandFromUser(user);
            const combinedText = cleanText([
              caption,
              locationName,
              user?.full_name,
              user?.username,
              user?.biography,
            ].join(' '));

            const built = buildDealFromCandidate({
              postUrl,
              pubDateIso,
              pubDateSource: TRUSTED_PUBDATE_SOURCE,
              combinedText,
              brand,
              locationName,
              rawTitle: caption,
              source,
              sourcePerformance,
              rejectionReasons,
              seenUrls,
              accountDealCounts,
            });
            if (!built) continue;

            stat.acceptedDeals += 1;
            acceptedDeals.push(built.deal);
            candidateSnapshot.push(built.candidate);
          }
        }
      } else if (profileResult.fallbackLinks.length > 0) {
        const fallbackLinks = profileResult.fallbackLinks.slice(0, CONFIG.maxTimelinePostsPerAccount);
        stat.links += fallbackLinks.length;
        totalCandidates += fallbackLinks.length;
        console.log(`   ↳ profile fallback links: ${fallbackLinks.length}`);

        for (const postUrl of fallbackLinks) {
          visitedPosts += 1;
          const built = await buildDealFromPostPage(
            page,
            source,
            postUrl,
            sourcePerformance,
            rejectionReasons,
            seenUrls,
            accountDealCounts
          );
          if (!built) continue;
          stat.acceptedDeals += 1;
          acceptedDeals.push(built.deal);
          candidateSnapshot.push(built.candidate);
        }
      } else {
        rejectionReasons.noProfile += 1;
      }

      if (CONFIG.sourceDelayMs > 0) {
        await page.waitForTimeout(CONFIG.sourceDelayMs);
      }
    }

    const finalDeals = acceptedDeals
      .slice()
      .sort((a, b) => {
        if ((b.qualityScore || 0) !== (a.qualityScore || 0)) return (b.qualityScore || 0) - (a.qualityScore || 0);
        return Date.parse(b.pubDate || '') - Date.parse(a.pubDate || '');
      });

    const persistedStats = { ...sourceStats };
    for (const [key, stat] of runStats.entries()) {
      const prev = persistedStats[key] || {};
      persistedStats[key] = {
        kind: stat.kind || prev.kind || '',
        runs: Number(prev.runs || 0) + Number(stat.runs || 0),
        totalLinks: Number(prev.totalLinks || 0) + Number(stat.links || 0),
        acceptedDeals: Number(prev.acceptedDeals || 0) + Number(stat.acceptedDeals || 0),
        lastSeenAt: stat.lastSeenAt || prev.lastSeenAt || '',
      };
    }

    const topSources = Object.entries(persistedStats)
      .map(([key, stat]) => ({
        key,
        kind: cleanText(stat?.kind || ''),
        runs: Number(stat?.runs || 0),
        acceptedDeals: Number(stat?.acceptedDeals || 0),
        totalLinks: Number(stat?.totalLinks || 0),
        performance: Math.round(sourcePerformanceScore(stat) * 100) / 100,
      }))
      .sort((a, b) => b.performance - a.performance)
      .slice(0, 30);

    const discoveryPayload = {
      lastUpdated: new Date().toISOString(),
      source: 'instagram-daily-sync-v2',
      totalDeals: finalDeals.length,
      deals: finalDeals,
      meta: {
        mode: 'timeline-api-v2',
        visitedSources: sourceQueue.length,
        totalCandidates,
        visitedPosts,
        scrapedDealsRaw: acceptedDeals.length,
        stoppedByRunBudget,
        profileStrategies: profileStrategyCounts,
        rejectionReasons,
      },
    };

    const mergedPayload = {
      lastUpdated: new Date().toISOString(),
      source: 'instagram-merged',
      totalDeals: finalDeals.length,
      meta: {
        sources: {
          web: 0,
          discovery: finalDeals.length,
          merged: finalDeals.length,
        },
        mode: 'timeline-api-v2',
      },
      deals: finalDeals.map((deal) => ({ ...deal, source: 'Instagram' })),
    };

    const disabledWebPayload = {
      lastUpdated: new Date().toISOString(),
      source: 'instagram-web-disabled',
      totalDeals: 0,
      meta: {
        mode: 'disabled',
        note: 'Legacy instagram-web scraper replaced by instagram-daily-sync-v2.',
      },
      deals: [],
    };

    writeJson(OUTPUT_DISCOVERY_PATH, discoveryPayload);
    writeJson(OUTPUT_MERGED_PATH, mergedPayload);
    writeJson(OUTPUT_WEB_PATH, disabledWebPayload);
    writeJson(DISCOVERY_REPORT_PATH, {
      updatedAt: new Date().toISOString(),
      mode: 'timeline-api-v2',
      visitedSources: sourceQueue.length,
      totalCandidates,
      visitedPosts,
      savedDeals: finalDeals.length,
      stoppedByRunBudget,
      profileStrategies: profileStrategyCounts,
      rejectionReasons,
      topSources,
      candidates: candidateSnapshot.slice(0, 200),
    });
    writeJson(WEB_REPORT_PATH, {
      updatedAt: new Date().toISOString(),
      mode: 'disabled',
      note: 'Legacy instagram-web scraper replaced by instagram-daily-sync-v2.',
      savedDeals: 0,
    });
    writeJson(SOURCE_STATS_PATH, {
      updatedAt: new Date().toISOString(),
      runMeta: {
        mode: 'timeline-api-v2',
        visitedSources: sourceQueue.length,
        totalCandidates,
        visitedPosts,
        scrapedDealsRaw: acceptedDeals.length,
        savedDeals: finalDeals.length,
        stoppedByRunBudget,
        profileStrategies: profileStrategyCounts,
      },
      topSources,
      sources: persistedStats,
    });

    console.log(`✅ saved ${finalDeals.length} deals → ${OUTPUT_DISCOVERY_PATH}`);
    console.log(`✅ merged Instagram deals → ${OUTPUT_MERGED_PATH}`);
    console.log(`   web: 0, discovery: ${finalDeals.length}, merged: ${finalDeals.length}`);
  } catch (error) {
    console.error(`❌ Instagram Daily Sync v2 failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
}

main();

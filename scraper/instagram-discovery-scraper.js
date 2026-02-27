import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const OUTPUT_PATH = path.join(ROOT, 'docs', 'deals-pending-instagram.json');
const ARTIFACTS_DIR = path.join(ROOT, 'artifacts');
const CANDIDATE_LOG_PATH = path.join(ARTIFACTS_DIR, 'instagram-discovery-candidates.json');
const ENV_PATH = path.join(ROOT, '.env');

const DEFAULT_CONFIG = {
  maxAgeDays: 14,
  maxDealsPerRun: 180,
  maxPostsToVisit: 850,
  maxRelatedAccounts: 140,
  maxSourcesTotal: 230,
  sourceScrollRounds: 22,
  sourceScrollStepPx: 2600,
  perSourceLinksLimit: 340,
  postLoadTimeoutMs: 8000,
  sourceDelayMs: 650,
  minDealScore: 60,
};
let CONFIG = { ...DEFAULT_CONFIG };

const SEED_HASHTAGS = [
  'gratiswien',
  'wiengratis',
  'wiendeals',
  'wienaktion',
  'wienrabatt',
  'wiengastro',
  'wienessen',
  'wienrestaurants',
  'wienkaffee',
  'wienbrunch',
  'wienkostenlos',
  'gratisessenwien',
  'schnäppchenwien',
  'neueröffnungwien',
  'neueroeffnungwien',
  'freebieswien',
  'wienfood',
  'kaffeewien',
  'wienimbiss',
  'wienstreetfood',
  'wienkebab',
  'wienopening',
  'viennafreebies',
  'freefoodvienna',
  'dönerwien',
  'doenerwien',
  'gratisdoenerwien',
  'gratisdönerwien',
  'gratisburgerwien',
  'gratispizza',
  'wiengratisfutter',
  'wiencafedeal',
  'wienfooddeal',
  'wienoffers',
  'wienrestaurantdeal',
  'wieneventgratis',
  'wiengeschenk',
  'wienvoucher',
  'wiengewinnspiel',
  'wiencoupon',
];

const SEED_ACCOUNTS = [
  '1000thingsinvienna',
  'viennawurstelstand',
  'viennafoodstories',
  'viennaeats',
  'wienmalanders',
  'wienmitte',
  'wienliebe',
  'wien.info',
  'wienerbezirksblatt',
  '1000things',
  'vienna.go',
  'wienfoodguide',
  'viennafoodblog',
  'wiendeals',
  'wienerlinien',
  'wienmuseum',
  'wienxtra',
];

const EXTRA_SEARCH_QUERIES = [
  'site:instagram.com/reel wien gratis',
  'site:instagram.com/p wien gutscheincode',
  'site:instagram.com/reel vienna free food',
  'site:instagram.com/p wien neueröffnung gratis',
  'site:instagram.com/reel wien 1+1',
  'site:instagram.com/p wien kaffee gratis',
  'site:instagram.com/reel wien restaurant angebot',
  'site:instagram.com/p vienna opening offer',
  'site:instagram.com/reel wien freebie',
  'site:instagram.com/p wien gratis essen',
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
];

const DEAL_KEYWORDS = [
  'gratis', 'kostenlos', 'for free', 'free', 'freebie', '0€', '0 €', '0 euro', 'geschenkt',
  'rabatt', 'discount', 'aktion', 'angebot', 'deal', 'gutschein', 'coupon', 'voucher',
  'promocode', 'code', '1+1', '2for1', '2 for 1', 'buy one get one', 'bogo',
  'happy hour', 'eröffnung', 'neueroeffnung', 'neueröffnung', 'special', 'limited',
  'nur heute', 'nur morgen', 'only today', 'only this week',
];

const FREEBIE_KEYWORDS = [
  'gratis', 'kostenlos', 'for free', 'freebie', 'geschenkt', '0€', '0 euro',
  'umsonst', 'free coffee', 'free food', 'gratis essen', 'gratis kaffee',
  'gratis döner', 'gratis doener', 'gratis burger', 'gratis pizza', 'gratis dessert',
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
  return {
    ...DEFAULT_CONFIG,
    maxAgeDays: toNum(process.env.IG_MAX_AGE_DAYS, DEFAULT_CONFIG.maxAgeDays),
    maxDealsPerRun: toNum(process.env.IG_MAX_DEALS, DEFAULT_CONFIG.maxDealsPerRun),
    maxPostsToVisit: toNum(process.env.IG_MAX_POSTS_VISIT, DEFAULT_CONFIG.maxPostsToVisit),
    maxRelatedAccounts: toNum(process.env.IG_MAX_RELATED_ACCOUNTS, DEFAULT_CONFIG.maxRelatedAccounts),
    sourceScrollRounds: toNum(process.env.IG_SCROLL_ROUNDS, DEFAULT_CONFIG.sourceScrollRounds),
    perSourceLinksLimit: toNum(process.env.IG_PER_SOURCE_LINKS, DEFAULT_CONFIG.perSourceLinksLimit),
    minDealScore: toNum(process.env.IG_MIN_SCORE, DEFAULT_CONFIG.minDealScore),
  };
}

function stableId(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 33 + seed.charCodeAt(i)) >>> 0;
  return hash.toString(36);
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
    /"shortcode"\s*:\s*"([A-Za-z0-9_-]{5,})"/g,
    /"code"\s*:\s*"([A-Za-z0-9_-]{5,})"/g,
    /\/(?:p|reel)\/([A-Za-z0-9_-]{5,})\//g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) {
      urls.add(`https://www.instagram.com/p/${m[1]}/`);
      urls.add(`https://www.instagram.com/reel/${m[1]}/`);
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

function parseDateFromPage({ ldDate, ogDescription, fullText, fallbackNow = Date.now() }) {
  if (ldDate) {
    const ts = Date.parse(ldDate);
    if (!Number.isNaN(ts)) return new Date(ts).toISOString();
  }

  const text = cleanText(ogDescription);
  const ymd = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) return new Date(`${ymd[1]}-${ymd[2]}-${ymd[3]}T12:00:00Z`).toISOString();

  const dmy = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (dmy) {
    const yyyy = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
    const mm = String(dmy[2]).padStart(2, '0');
    const dd = String(dmy[1]).padStart(2, '0');
    return new Date(`${yyyy}-${mm}-${dd}T12:00:00Z`).toISOString();
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
    if (!Number.isNaN(candidate.getTime())) return candidate.toISOString();
  }

  const relFromOg = parseRelativeAgeToDate(ogDescription, fallbackNow);
  if (relFromOg) return relFromOg;

  const relFromText = parseRelativeAgeToDate(fullText, fallbackNow);
  if (relFromText) return relFromText;

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

function detectCategory(text) {
  const lower = cleanText(text).toLowerCase();
  if (EVENT_KEYWORDS.some((k) => lower.includes(k))) return 'events';
  if (FOOD_KEYWORDS.some((k) => lower.includes(k))) return 'essen';
  if (lower.includes('coffee') || lower.includes('kaffee')) return 'kaffee';
  if (lower.includes('fitness') || lower.includes('gym')) return 'fitness';
  return 'wien';
}

function detectType(text) {
  const lower = cleanText(text).toLowerCase();
  if (FREEBIE_KEYWORDS.some((k) => lower.includes(k))) return 'gratis';
  if (lower.includes('1+1') || lower.includes('2for1') || lower.includes('2 for 1')) return 'bogo';
  return 'rabatt';
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
  const wienHits = keywordHits(lower, WIEN_KEYWORDS);
  const foodHits = keywordHits(lower, FOOD_KEYWORDS);

  let score = 0;
  score += Math.min(dealHits * 9, 36);
  score += Math.min(freebieHits * 13, 32);
  score += Math.min(wienHits * 11, 33);
  score += Math.min(foodHits * 4, 12);
  score += Math.min(sourceHits * 8, 20);

  if (sourceKinds.has('hashtag')) score += 6;
  if (sourceKinds.has('account')) score += 7;
  if (sourceKinds.has('search')) score += 4;
  if (accountHint) score += 5;
  if (relatedHint) score += 6;

  if (lower.includes('nur heute') || lower.includes('only today')) score += 8;
  if (lower.includes('neueröffnung') || lower.includes('neueroeffnung') || lower.includes('opening')) score += 7;
  if (lower.includes('gewinnspiel') || lower.includes('verlosung')) score += 5;

  if (isExpiredByText(lower)) score -= 50;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function buildSources() {
  const hashtags = [...new Set(SEED_HASHTAGS)].map((tag) => ({
    kind: 'hashtag',
    key: `tag:${tag}`,
    url: `https://www.instagram.com/explore/tags/${tag}/`,
    priority: 2,
  }));

  const accounts = [...new Set(SEED_ACCOUNTS)].map((username) => ({
    kind: 'account',
    key: `acct:${username}`,
    url: `https://www.instagram.com/${username}/`,
    priority: 3,
  }));

  return [...accounts, ...hashtags];
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

function mergeDeals(newDeals, oldDeals) {
  const map = new Map();
  for (const deal of [...newDeals, ...oldDeals]) {
    const key = `${deal.url}|${deal.brand}|${String(deal.title || '').toLowerCase()}`;
    if (!map.has(key) || (map.get(key).qualityScore || 0) < (deal.qualityScore || 0)) {
      map.set(key, deal);
    }
  }

  return [...map.values()]
    .filter((d) => d.pubDate && isFresh(d.pubDate))
    .filter((d) => !isExpiryInPast(d.expires))
    .sort((a, b) => {
      if ((b.qualityScore || 0) !== (a.qualityScore || 0)) return (b.qualityScore || 0) - (a.qualityScore || 0);
      return Date.parse(b.pubDate) - Date.parse(a.pubDate);
    })
    .slice(0, CONFIG.maxDealsPerRun);
}

async function scrapeInstagramDiscovery() {
  console.log('📸 INSTAGRAM DISCOVERY ENGINE');
  console.log('========================================');

  loadEnvFile();
  CONFIG = buildConfig();

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

    const sourcesQueue = buildSources();
    const processedSourceKeys = new Set();
    const relatedCandidates = new Map();
    const candidatePosts = new Map();

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

    // DISCOVERY PHASE
    while (sourcesQueue.length > 0 && processedSourceKeys.size < CONFIG.maxSourcesTotal) {
      const source = sourcesQueue.shift();
      if (!source || processedSourceKeys.has(source.key)) continue;
      processedSourceKeys.add(source.key);

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
          const scripts = await page.$$eval('script', (nodes) => nodes.map((n) => n.textContent || '').filter(Boolean));
          for (const u of domUrls) sourceLinks.add(u);
          for (const scriptText of scripts.slice(0, 50)) {
            for (const u of extractShortcodesFromText(scriptText)) sourceLinks.add(normalizeInstagramPostUrl(u));
          }

          if (source.kind === 'account' || source.kind === 'related-account') {
            const users = await collectRelatedAccountsFromDom(page);
            for (const u of users) relatedUsernames.add(u);
          }

          if (sourceLinks.size >= CONFIG.perSourceLinksLimit) break;

          if (sourceLinks.size === before) stagnant += 1;
          else stagnant = 0;
          if (stagnant >= 2) break;

          await page.mouse.wheel(0, CONFIG.sourceScrollStepPx);
          await page.waitForTimeout(850);
          await dismissInstagramOverlays(page);
        }

        let links = [...sourceLinks].filter(Boolean).slice(0, CONFIG.perSourceLinksLimit);
        if (links.length < 6) {
          const mirror = await fetchMirrorText(source.url);
          const mirrorLinks = [...extractShortcodesFromText(mirror)].map((u) => normalizeInstagramPostUrl(u)).filter(Boolean);
          links = [...new Set([...links, ...extractPostUrls(mirror), ...mirrorLinks])].slice(0, CONFIG.perSourceLinksLimit);
        }

        console.log(`   ↳ links: ${links.length}`);
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

          const accountLooksWien = username.includes('wien') || username.includes('vienna') || meta.hits >= 2;
          if (!accountLooksWien) continue;

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

    ensureArtifactsDir();
    const candidateSnapshot = [...candidatePosts.values()].map((c) => ({
      url: c.url,
      sourceHits: c.sourceHits,
      sourceKinds: [...c.sourceKinds],
      refs: [...c.sourceRefs].slice(0, 20),
      accountHint: c.accountHint,
      relatedHint: c.relatedHint,
    }));
    fs.writeFileSync(CANDIDATE_LOG_PATH, JSON.stringify({
      updatedAt: new Date().toISOString(),
      sourceCount: processedSourceKeys.size,
      relatedAccountCandidates: relatedCandidates.size,
      totalCandidates: candidateSnapshot.length,
      candidates: candidateSnapshot,
    }, null, 2));

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

        const pubDateIso = parseDateFromPage({
          ldDate: data.ldDate,
          ogDescription: data.ogDescription,
          fullText: combinedText,
        });
        if (!pubDateIso || !isFresh(pubDateIso)) continue;

        if (isExpiredByText(combinedText)) continue;

        const isWien = containsKeyword(combinedText, WIEN_KEYWORDS)
          || [...candidate.sourceRefs].some((k) => k.includes('wien') || k.includes('vienna'));
        if (!isWien) continue;

        const dealSignal = containsKeyword(combinedText, DEAL_KEYWORDS);
        if (!dealSignal) continue;

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
          discoveredBy: [...candidate.sourceKinds].join(','),
          sourceHits: candidate.sourceHits,
          reviewTier: score >= 84 ? 'high' : score >= 70 ? 'medium' : 'low',
        });
      } catch {
        // ignore inaccessible post
      }

      if ((i + 1) % 30 === 0) {
        console.log(`   ✅ extracted ${i + 1}/${postsToVisit.length}`);
      }
    }

    const previousDeals = loadPreviousDeals();
    const finalDeals = mergeDeals(deals, previousDeals);

    const payload = {
      lastUpdated: new Date().toISOString(),
      source: 'instagram-discovery-engine',
      totalDeals: finalDeals.length,
      deals: finalDeals,
      meta: {
        visitedSources: processedSourceKeys.size,
        totalCandidates: candidatePosts.size,
        visitedPosts: postsToVisit.length,
        scrapedDealsRaw: deals.length,
      },
    };

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2));
    console.log(`✅ saved ${finalDeals.length} deals → ${OUTPUT_PATH}`);
    console.log(`🧾 candidates snapshot → ${CANDIDATE_LOG_PATH}`);

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

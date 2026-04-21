import '../sentry/instrument.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeCategoryForScraper } from './category-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const OUTPUT_PATH = path.join(ROOT, 'docs', 'deals-pending-instagram-web.json');
const WEB_REPORT_PATH = path.join(ROOT, 'docs', 'instagram-web-report.json');
const MERCHANT_REGISTRY_PATH = path.join(ROOT, 'docs', 'instagram-merchant-registry.json');
const ENV_PATH = path.join(ROOT, '.env');

const DEFAULT_CONFIG = {
  maxDealsPerRun: 140,
  maxAgeDays: 1,
  perSourceLinksLimit: 280,
  maxPostsToVisit: 520,
  postLoadTimeoutMs: 7000,
  sourceScrollRounds: 18,
  sourceScrollStepPx: 2600,
  sourceScrollWaitMs: 2200,
  sourceStagnationRounds: 6,
};
let CONFIG = { ...DEFAULT_CONFIG };

const HASHTAGS = [
  'gratiswien',
  'wiengastro',
  'wienessen',
  'wienrestaurants',
  'wienkaffee',
  'wienbrunch',
  'gratisessenwien',
  'neueröffnungwien',
  'neueroeffnungwien',
  'foodiewien',
  'wienfood',
  'kaffeewien',
  'gratisdoenerwien',
  'gratisdönerwien',
  'wienimbiss',
  'wienstreetfood',
  'wienkebab',
  'freefoodvienna',
  'gratiskaffeewien',
  'freecoffeewien',
  'gratisdrinkwien',
  'freedrinkvienna',
  'gratiseiswien',
  'freeicecreamvienna',
  'gratisburgerwien',
  'gratispizza',
];

const INSTAGRAM_ACCOUNTS = [
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

const SEARCH_QUERIES = [
  'site:instagram.com/reel wien gratis essen',
  'site:instagram.com/p wien gratis essen',
  'site:instagram.com/reel wien gratis kaffee',
  'site:instagram.com/p wien gratis kaffee',
  'site:instagram.com/reel wien gratis drink',
  'site:instagram.com/p wien gratis drink',
  'site:instagram.com/reel vienna free food',
  'site:instagram.com/p vienna free food',
  'site:instagram.com/reel vienna free coffee',
  'site:instagram.com/p vienna free drink',
  'site:instagram.com/reel wien neueröffnung gratis',
  'site:instagram.com/p wien 1+1 restaurant',
];

const WIEN_KEYWORDS = [
  'wien', 'vienna', 'innere stadt', 'mariahilf', 'leopoldstadt', 'ottakring',
  'favoriten', 'neubau', 'währing', 'floridsdorf', 'donaustadt', '1010', '1020', '1030',
  '1040', '1050', '1060', '1070', '1080', '1090', '1100', '1110', '1120', '1130',
  '1140', '1150', '1160', '1170', '1180', '1190', '1200', '1210', '1220', '1230',
];

const DEAL_KEYWORDS = [
  'gratis', 'kostenlos', 'free', 'freebie', '0€', '0 €', 'rabatt', 'discount', 'aktion',
  'angebot', 'deal', 'gutschein', 'coupon', 'voucher', '1+1', '2for1', '2 for 1',
  'happy hour', 'eröffnung', 'neueröffnung',
];

const FOOD_KEYWORDS = [
  'restaurant', 'pizza', 'burger', 'sushi', 'cafe', 'café', 'brunch', 'coffee', 'kaffee',
  'croissant', 'frühstück', 'mittag', 'abendessen', 'essen', 'drink', 'cocktail',
];

const FREEBIE_KEYWORDS = [
  'gratis', 'kostenlos', 'free', 'freebie', 'geschenkt', '0€', '0 €', 'free coffee',
  'free food', 'gratis essen', 'gratis kaffee', 'gratis drink', 'gratis burger',
  'gratis pizza', 'gratis döner', 'gratis doener', 'free drink',
];

const PROMO_KEYWORDS = [
  '1+1', '2for1', '2 for 1', 'bogo', 'happy hour', 'rabatt', 'discount',
  'aktion', 'angebot', 'deal', 'coupon', 'voucher', 'gutschein',
  'opening offer', 'opening deal', 'eröffnungsangebot', 'eroeffnungsangebot',
];

const GIVEAWAY_KEYWORDS = ['gewinnspiel', 'verlosung', 'giveaway'];

const SHOPPING_KEYWORDS = [
  'shop', 'store', 'fashion', 'beauty', 'fitness', 'gym', 'ticket', 'museum', 'kino',
  'event', 'club', 'bar', 'spa', 'wellness', 'reise', 'hotel',
];

const EVENT_KEYWORDS = [
  'konzert', 'event', 'party', 'festival', 'kino', 'theater', 'show',
  'livemusik', 'live musik', 'drinks', 'opening party',
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

function buildConfig() {
  const toNum = (v, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const requestedMaxAgeDays = toNum(process.env.IG_MAX_AGE_DAYS, DEFAULT_CONFIG.maxAgeDays);
  return {
    ...DEFAULT_CONFIG,
    maxAgeDays: Math.min(7, requestedMaxAgeDays),
    maxDealsPerRun: toNum(process.env.IG_MAX_DEALS, DEFAULT_CONFIG.maxDealsPerRun),
    perSourceLinksLimit: toNum(process.env.IG_PER_SOURCE_LINKS, DEFAULT_CONFIG.perSourceLinksLimit),
    maxPostsToVisit: toNum(process.env.IG_MAX_POSTS_VISIT, DEFAULT_CONFIG.maxPostsToVisit),
    sourceScrollRounds: toNum(process.env.IG_SCROLL_ROUNDS, DEFAULT_CONFIG.sourceScrollRounds),
    sourceScrollWaitMs: toNum(process.env.IG_SCROLL_WAIT_MS, DEFAULT_CONFIG.sourceScrollWaitMs),
    sourceStagnationRounds: toNum(process.env.IG_STAGNATION_ROUNDS, DEFAULT_CONFIG.sourceStagnationRounds),
  };
}

function loadCookieHints() {
  const hints = [];
  const sessionId = cleanText(process.env.INSTAGRAM_SESSIONID);
  if (sessionId) {
    hints.push({ name: 'sessionid', value: sessionId });
  }

  const rawCookies = cleanText(process.env.INSTAGRAM_COOKIES);
  if (rawCookies) {
    const parts = rawCookies.split(';').map((p) => p.trim()).filter(Boolean);
    for (const part of parts) {
      const eq = part.indexOf('=');
      if (eq <= 0) continue;
      const name = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      if (name && value) hints.push({ name, value, domain: '.instagram.com' });
    }
  }

  const cookieFile = cleanText(process.env.INSTAGRAM_COOKIES_FILE);
  if (cookieFile && fs.existsSync(cookieFile)) {
    const raw = fs.readFileSync(cookieFile, 'utf-8');
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      // TSV export format (common from browser extensions):
      // name, value, domain, path, expires, ...
      if (line.includes('\t')) {
        const cols = line.split('\t').map((c) => c.trim());
        if (cols.length >= 2) {
          const name = cols[0];
          const value = cols[1];
          const domain = cols[2] || '.instagram.com';
          if (/^[A-Za-z0-9_.-]+$/.test(name) && value) {
            hints.push({ name, value, domain });
            continue;
          }
        }
      }

      // key=value; key2=value2 format
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

function normalizeUsername(value) {
  const username = cleanText(value).toLowerCase().replace(/^@/, '').trim();
  if (!username || RESERVED_IG_PATHS.has(username)) return '';
  if (!/^[a-z0-9._]{2,40}$/.test(username)) return '';
  return username;
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
      }))
      .filter((account) => account.username)
      .sort((a, b) => b.priorityScore - a.priorityScore || b.confidence - a.confidence || a.username.localeCompare(b.username));
  } catch {
    return [];
  }
}

function shouldUseMerchantRegistrySeeds() {
  return cleanText(process.env.IG_USE_MERCHANT_REGISTRY) === '1';
}

function containsKeyword(text, keywords) {
  const lower = cleanText(text).toLowerCase();
  return keywords.some((k) => lower.includes(k));
}

function isFoodDrinkRelevant(text) {
  return containsKeyword(text, FOOD_KEYWORDS);
}

function hasFreebieOrPromoSignal(text) {
  return containsKeyword(text, FREEBIE_KEYWORDS) || containsKeyword(text, PROMO_KEYWORDS);
}

function isGiveawayOnly(text) {
  const lower = cleanText(text).toLowerCase();
  return GIVEAWAY_KEYWORDS.some((k) => lower.includes(k))
    && !containsKeyword(lower, FREEBIE_KEYWORDS)
    && !containsKeyword(lower, PROMO_KEYWORDS);
}

function isWienRelevant(text, sourceKey, postUrl, brand) {
  const combined = [cleanText(text), cleanText(sourceKey), cleanText(postUrl), cleanText(brand)].join(' ').toLowerCase();
  if (containsKeyword(combined, WIEN_KEYWORDS)) return true;
  if (combined.includes('wien') || combined.includes('vienna')) return true;
  return false;
}

function detectCategory(text) {
  return normalizeCategoryForScraper('', [text]);
}

function detectType(text) {
  const lower = cleanText(text).toLowerCase();
  if (lower.includes('gratis') || lower.includes('kostenlos') || lower.includes('free')) return 'gratis';
  if (lower.includes('1+1') || lower.includes('2for1') || lower.includes('2 for 1')) return 'bogo';
  return 'rabatt';
}

function scorePost({ text, accountHint }) {
  let score = 0;
  if (containsKeyword(text, DEAL_KEYWORDS)) score += 55;
  if (containsKeyword(text, WIEN_KEYWORDS)) score += 30;
  if (accountHint) score += 10;
  if (containsKeyword(text, FOOD_KEYWORDS)) score += 10;
  if (containsKeyword(text, FREEBIE_KEYWORDS)) score += 14;
  if (containsKeyword(text, PROMO_KEYWORDS)) score += 10;
  return Math.min(100, score);
}

function stableId(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

function createRejectionCounters() {
  return {
    navigationError: 0,
    noPubDate: 0,
    stale: 0,
    giveaway: 0,
    notFoodDrink: 0,
    noPromoSignal: 0,
    lowScore: 0,
    notWien: 0,
  };
}

function writeWebReport(report) {
  try {
    fs.writeFileSync(WEB_REPORT_PATH, JSON.stringify(report, null, 2));
  } catch {}
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

function isFresh(isoDate) {
  const ts = Date.parse(isoDate);
  if (Number.isNaN(ts)) return false;
  const ageMs = Date.now() - ts;
  return ageMs >= 0 && ageMs <= CONFIG.maxAgeDays * 24 * 60 * 60 * 1000;
}

function extractPostUrls(html) {
  const urls = new Set();
  const re = /https:\/\/(?:www\.)?instagram\.com\/(?:p|reel)\/[A-Za-z0-9_-]+\//g;
  const matches = html.match(re) || [];
  for (const m of matches) urls.add(m);
  return [...urls];
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

async function collectLinksFromScripts(page) {
  try {
    const scriptContents = await page.$$eval('script', (nodes) => nodes.map((n) => n.textContent || '').filter(Boolean));
    const urls = new Set();
    for (const content of scriptContents.slice(0, 40)) {
      for (const url of extractShortcodesFromText(content)) urls.add(url);
    }
    return [...urls];
  } catch {
    return [];
  }
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
        await locator.click({ timeout: 500 });
        await page.waitForTimeout(200);
      }
    } catch {}
  }
  try { await page.keyboard.press('Escape'); } catch {}
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

function buildInstagramPostUrlFromNode(node) {
  const shortcode = cleanText(node?.shortcode);
  if (!shortcode) return '';
  const pathKind = node?.is_video || node?.__typename === 'GraphVideo' ? 'reel' : 'p';
  return `https://www.instagram.com/${pathKind}/${shortcode}/`;
}

async function fetchAccountTimelineLinks(page, username) {
  const normalized = normalizeUsername(username);
  if (!page || !normalized) return [];
  try {
    const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(normalized)}`;
    const parsed = await fetchInstagramJsonInBrowser(page, url, `https://www.instagram.com/${encodeURIComponent(normalized)}/`);
    const user = parsed?.data?.user;
    const edges = Array.isArray(user?.edge_owner_to_timeline_media?.edges)
      ? user.edge_owner_to_timeline_media.edges
      : [];
    const links = new Set();
    for (const edge of edges) {
      const postUrl = buildInstagramPostUrlFromNode(edge?.node);
      if (postUrl) links.add(postUrl);
      if (links.size >= CONFIG.perSourceLinksLimit) break;
    }
    return [...links];
  } catch {
    return [];
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

async function discoverLinksViaDuckDuckGo() {
  const links = new Set();
  for (const query of SEARCH_QUERIES) {
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
    } catch {
      // ignore one query failure
    }
  }
  return [...links];
}

function buildDuckDuckGoQueriesForSource(source) {
  if (source.kind === 'account') {
    const profileUrl = source.url.replace(/\/$/, '');
    return [
      `site:instagram.com (${profileUrl}) (p OR reel)`,
      `site:instagram.com/p ${source.key.replace('acct:', '')}`,
      `site:instagram.com/reel ${source.key.replace('acct:', '')}`,
    ];
  }

  const tag = source.key.replace('tag:', '');
  return [
    `site:instagram.com/p "#${tag}"`,
    `site:instagram.com/reel "#${tag}"`,
    `site:instagram.com/p ${tag}`,
    `site:instagram.com/reel ${tag}`,
    `site:instagram.com/p ${tag} gratis`,
    `site:instagram.com/reel ${tag} gratis`,
    `site:instagram.com/p ${tag} kostenlos`,
    `site:instagram.com/reel ${tag} kostenlos`,
  ];
}

async function discoverLinksForSourceViaDuckDuckGo(source) {
  const links = new Set();
  const queries = buildDuckDuckGoQueriesForSource(source);
  for (const query of queries) {
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
      if (links.size >= CONFIG.perSourceLinksLimit) break;
    } catch {}
  }
  return [...links];
}

function buildSources() {
  const hashtagSources = [...new Set(HASHTAGS)].map((tag) => ({
    kind: 'hashtag',
    key: `tag:${tag}`,
    url: `https://www.instagram.com/explore/tags/${tag}/`,
    priority: 1,
  }));

  const accountSources = [];
  const seenAccounts = new Set();
  for (const username of INSTAGRAM_ACCOUNTS) {
    const normalized = normalizeUsername(username);
    if (!normalized || seenAccounts.has(normalized)) continue;
    seenAccounts.add(normalized);
    accountSources.push({
      kind: 'account',
      key: `acct:${normalized}`,
      url: `https://www.instagram.com/${normalized}/`,
      username: normalized,
      priority: 3,
    });
  }
  if (shouldUseMerchantRegistrySeeds()) {
    for (const account of loadMerchantRegistryAccounts()) {
      if (seenAccounts.has(account.username)) continue;
      seenAccounts.add(account.username);
      const priorityBoost = Math.max(0, Math.min(2, Math.floor((account.priorityScore || account.confidence || 0) / 35)));
      accountSources.push({
        kind: 'account',
        key: `acct:${account.username}`,
        url: `https://www.instagram.com/${account.username}/`,
        username: account.username,
        priority: 1 + priorityBoost,
      });
    }
  }

  return [...accountSources, ...hashtagSources]
    .sort((a, b) => (b.priority || 0) - (a.priority || 0) || a.key.localeCompare(b.key));
}

function countAccountCandidates(candidatePosts) {
  let count = 0;
  for (const candidate of candidatePosts.values()) {
    if (candidate?.accountHint) count += 1;
  }
  return count;
}

async function createInstagramPageSession(browser, cookieHints) {
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'de-AT',
    timezoneId: 'Europe/Vienna',
  });

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
  }

  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  return { context, page };
}

function fallbackBrandFromUrl(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    return parts[0] || 'Instagram';
  } catch {
    return 'Instagram';
  }
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

  return fallbackBrandFromUrl(postUrl);
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

async function scrapeInstagram() {
  console.log('📸 INSTAGRAM SCRAPER - current deals mode');
  console.log('========================================');
  loadEnvFile();
  CONFIG = buildConfig();

  const report = {
    lastUpdated: '',
    source: 'instagram-web',
    config: {
      maxAgeDays: CONFIG.maxAgeDays,
      perSourceLinksLimit: CONFIG.perSourceLinksLimit,
      maxPostsToVisit: CONFIG.maxPostsToVisit,
      sourceScrollRounds: CONFIG.sourceScrollRounds,
      sourceScrollWaitMs: CONFIG.sourceScrollWaitMs,
      sourceStagnationRounds: CONFIG.sourceStagnationRounds,
    },
    totals: {
      sourcesProcessed: 0,
      candidatePosts: 0,
      postsVisited: 0,
      acceptedBeforeDedup: 0,
      uniqueDeals: 0,
      reusedPreviousDeals: 0,
      rejectionReasons: createRejectionCounters(),
    },
    sourceSummaries: [],
    samples: {
      candidateUrls: [],
      acceptedUrls: [],
    },
    error: '',
  };

  let browser;
  try {
    const { chromium } = await import('playwright');

    browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-dev-shm-usage',
      ],
    });

    const cookieHints = loadCookieHints();
    if (cookieHints.length > 0) {
      console.log(`🍪 loaded ${cookieHints.length} Instagram cookies`);
    } else {
      console.log('ℹ️ no Instagram auth cookies found; public pages may return login wall');
    }

    const sources = buildSources();
    const candidatePosts = new Map();
    const accountCandidateThreshold = Math.max(18, Math.min(90, Math.floor(CONFIG.maxPostsToVisit * 0.35)));

    for (const source of sources) {
      let sourceContext;
      let sourcePage;
      const sourceSummary = {
        key: source.key,
        kind: source.kind,
        domLinks: 0,
        accountApiLinks: 0,
        scriptLinks: 0,
        htmlLinks: 0,
        reelsFallbackLinks: 0,
        mirrorFallbackLinks: 0,
        duckduckgoLinks: 0,
        linksFound: 0,
      };
      if (source.kind === 'hashtag' && countAccountCandidates(candidatePosts) >= accountCandidateThreshold) {
        sourceSummary.skipped = 'enough-account-candidates';
        report.sourceSummaries.push(sourceSummary);
        continue;
      }
      try {
        ({ context: sourceContext, page: sourcePage } = await createInstagramPageSession(browser, cookieHints));
        console.log(`🔎 Source ${source.key}`);
        await sourcePage.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 25000 });
        await sourcePage.waitForTimeout(2500);
        await dismissInstagramOverlays(sourcePage);

        const sourceLinks = new Set();
        let stagnantRounds = 0;

        for (let round = 0; round < CONFIG.sourceScrollRounds; round += 1) {
          const beforeCount = sourceLinks.size;

          const domUrls = await collectLinksFromDom(sourcePage);
          const html = await sourcePage.content();
          const htmlUrls = extractPostUrls(html);
          sourceSummary.domLinks += domUrls.length;
          sourceSummary.htmlLinks += htmlUrls.length;
          for (const u of [...domUrls, ...htmlUrls]) {
            sourceLinks.add(u);
          }

          if (sourceLinks.size >= CONFIG.perSourceLinksLimit) break;

          if (sourceLinks.size === beforeCount) {
            stagnantRounds += 1;
          } else {
            stagnantRounds = 0;
          }

          if (stagnantRounds >= CONFIG.sourceStagnationRounds) break;

          await sourcePage.mouse.wheel(0, CONFIG.sourceScrollStepPx);
          await sourcePage.waitForTimeout(CONFIG.sourceScrollWaitMs);
          await dismissInstagramOverlays(sourcePage);
        }

        let postUrls = [...sourceLinks].slice(0, CONFIG.perSourceLinksLimit);
        if (postUrls.length === 0 && source.kind === 'account') {
          const reelsUrl = source.url.endsWith('/') ? `${source.url}reels/` : `${source.url}/reels/`;
          try {
            await sourcePage.goto(reelsUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
            await sourcePage.waitForTimeout(1800);
            await dismissInstagramOverlays(sourcePage);
            const reelsDom = await collectLinksFromDom(sourcePage);
            const reelsHtml = await sourcePage.content();
            const reelsHtmlUrls = extractPostUrls(reelsHtml);
            sourceSummary.reelsFallbackLinks += reelsDom.length + reelsHtmlUrls.length;
            postUrls = [...new Set([...postUrls, ...reelsDom, ...reelsHtmlUrls])].slice(0, CONFIG.perSourceLinksLimit);
          } catch {}
        }
        if (postUrls.length < 10 && source.kind === 'account') {
          const apiLinks = await fetchAccountTimelineLinks(sourcePage, source.username || source.key.replace(/^acct:/, ''));
          sourceSummary.accountApiLinks += apiLinks.length;
          postUrls = [...new Set([...postUrls, ...apiLinks])].slice(0, CONFIG.perSourceLinksLimit);
        }
        if (postUrls.length === 0) {
          const mirrorText = await fetchMirrorText(source.url);
          const mirrorUrls = extractPostUrls(mirrorText);
          sourceSummary.mirrorFallbackLinks += mirrorUrls.length;
          postUrls = [...new Set([...postUrls, ...mirrorUrls])].slice(0, CONFIG.perSourceLinksLimit);
        }
        if (postUrls.length < 16) {
          const sourceDiscovered = await discoverLinksForSourceViaDuckDuckGo(source);
          sourceSummary.duckduckgoLinks += sourceDiscovered.length;
          postUrls = [...new Set([...postUrls, ...sourceDiscovered])].slice(0, CONFIG.perSourceLinksLimit);
        }
        sourceSummary.linksFound = postUrls.length;
        console.log(`   ↳ links found: ${postUrls.length}`);

        for (const postUrl of postUrls) {
          if (!candidatePosts.has(postUrl)) {
            candidatePosts.set(postUrl, {
              url: postUrl,
              sourceKey: source.key,
              accountHint: source.kind === 'account',
            });
          }
        }
      } catch (error) {
        console.log(`   ⚠️ source failed: ${error.message}`);
        sourceSummary.error = error.message;
      } finally {
        report.sourceSummaries.push(sourceSummary);
        if (sourcePage) await sourcePage.close().catch(() => {});
        if (sourceContext) await sourceContext.close().catch(() => {});
      }
    }

    const discovered = await discoverLinksViaDuckDuckGo();
    for (const postUrl of discovered) {
      if (!candidatePosts.has(postUrl)) {
        candidatePosts.set(postUrl, {
          url: postUrl,
          sourceKey: 'search:duckduckgo',
          accountHint: false,
        });
      }
    }
    console.log(`🌐 duckduckgo discovered: ${discovered.length}, total candidates: ${candidatePosts.size}`);
    report.totals.sourcesProcessed = report.sourceSummaries.length;
    report.totals.candidatePosts = candidatePosts.size;
    report.samples.candidateUrls = [...candidatePosts.keys()].slice(0, 20);

    const postsToVisit = [...candidatePosts.values()];
    const deals = [];
    const { context: postContext, page } = await createInstagramPageSession(browser, cookieHints);

    try {
      for (let i = 0; i < postsToVisit.length; i += 1) {
        const post = postsToVisit[i];
        try {
          report.totals.postsVisited += 1;
          await page.goto(post.url, { waitUntil: 'domcontentloaded', timeout: CONFIG.postLoadTimeoutMs });
          await page.waitForTimeout(1200);

          let data = await page.evaluate(() => {
            const result = {
              ldDate: '',
              ldCaption: '',
              ldAuthor: '',
              ogTitle: '',
              ogDescription: '',
              timeDateTime: '',
              igScriptTimestamp: 0,
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
            const mirrorText = await fetchMirrorText(post.url);
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
          const pubDateIso = pubDateMeta?.iso || new Date().toISOString();

          const score = scorePost({ text: combinedText, accountHint: post.accountHint });

          const brand = deriveBrand(data, post.url);

          const titleBase = cleanText(data.ogTitle || data.ldCaption || 'Instagram Deal');
          const title = titleBase.length > 80 ? `${titleBase.slice(0, 77)}...` : titleBase;

          const deal = {
            id: `ig-${stableId(`${post.url}|${pubDateIso}`)}`,
            brand,
            title,
            logo: detectCategory(combinedText) === 'essen' ? '🍔' : '📷',
            description: combinedText.slice(0, 180),
            type: detectType(combinedText),
            category: detectCategory(combinedText),
            source: 'Instagram',
            url: post.url,
            expires: 'Unbekannt',
            distance: containsKeyword(combinedText, WIEN_KEYWORDS) ? 'Wien' : 'Online',
            hot: score >= 80,
            isNew: true,
            priority: Math.max(1, Math.round(score / 12)),
            votes: 1,
            qualityScore: score,
            pubDate: pubDateIso,
            pubDateSource: pubDateMeta.source || '',
          };

          deals.push(deal);
          if (report.samples.acceptedUrls.length < 20) report.samples.acceptedUrls.push(post.url);
        } catch {
          report.totals.rejectionReasons.navigationError += 1;
        }

        if ((i + 1) % 25 === 0) {
          console.log(`   ✅ checked posts: ${i + 1}/${postsToVisit.length}`);
        }
      }
    } finally {
      await page.close().catch(() => {});
      await postContext.close().catch(() => {});
    }

    report.totals.acceptedBeforeDedup = deals.length;

    const uniqueDeals = deals
      .sort((a, b) => {
        if (b.qualityScore !== a.qualityScore) return b.qualityScore - a.qualityScore;
        return Date.parse(b.pubDate) - Date.parse(a.pubDate);
      });

    const payload = {
      lastUpdated: new Date().toISOString(),
      source: 'instagram-web',
      totalDeals: uniqueDeals.length,
      deals: uniqueDeals,
    };
    report.lastUpdated = payload.lastUpdated;
    report.totals.uniqueDeals = uniqueDeals.length;

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2));
    writeWebReport(report);
    console.log(`✅ saved ${uniqueDeals.length} deals → ${OUTPUT_PATH}`);
    console.log(`📈 web report → ${WEB_REPORT_PATH}`);

    await browser.close();
    return payload;
  } catch (error) {
    console.error(`❌ Instagram scrape failed: ${error.message}`);
    if (browser) await browser.close();

    const fallback = {
      lastUpdated: new Date().toISOString(),
      source: 'instagram-web',
      totalDeals: 0,
      deals: [],
    };
    report.lastUpdated = fallback.lastUpdated;
    report.error = error.message;
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(fallback, null, 2));
    writeWebReport(report);
    return fallback;
  }
}

scrapeInstagram()
  .then((result) => {
    console.log(`🎉 Done: ${result.totalDeals} Instagram deals`);
    process.exit(0);
  })
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });

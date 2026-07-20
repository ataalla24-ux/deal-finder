import '../sentry/instrument.mjs';

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

import {
  filterModeratedDeals,
  loadDealModeration,
  moderationCounts,
} from './deal-moderation-utils.js';
import { normalizeCategoryForScraper } from './category-utils.js';
import {
  cleanText as cleanDealText,
  isExpiredDealRecord,
  isFalsePositiveFreeDeal,
  normalizeDealRecord,
} from './deal-normalization-utils.js';
import {
  evaluateInstagramOfferTiming,
  extractActiveOfferWindow,
  hasRecurringWeekdaySchedule,
  hasViennaInstagramEvidence,
  unicodeSafeTruncate,
} from './instagram-ai-validity-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const ENV_PATH = path.join(ROOT, '.env');
const OUTPUT_PATH = path.join(DOCS_DIR, 'deals-pending-instagram-ai.json');
const REPORT_PATH = path.join(DOCS_DIR, 'instagram-ai-report.json');
const WATCHLIST_PATH = path.join(DOCS_DIR, 'instagram-watchlist.json');
const SEEDS_PATH = path.join(DOCS_DIR, 'instagram-ai-seeds.json');
const CANDIDATES_INDEX_PATH = path.join(DOCS_DIR, 'deal-candidates-index.json');
const MERCHANT_REGISTRY_PATH = path.join(DOCS_DIR, 'instagram-merchant-registry.json');

const DAY_MS = 24 * 60 * 60 * 1000;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const INSTAGRAM_SHORTCODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

loadEnvFile();

const CONFIG = {
  maxCandidates: numberEnv('INSTAGRAM_AI_MAX_CANDIDATES', 80),
  maxDeals: numberEnv('INSTAGRAM_AI_MAX_DEALS', 35),
  maxSearchQueries: numberEnv('INSTAGRAM_AI_MAX_SEARCH_QUERIES', 42),
  maxPreviewFetches: numberEnv('INSTAGRAM_AI_MAX_PREVIEW_FETCHES', 80),
  maxRenderFetches: numberEnv('INSTAGRAM_AI_MAX_RENDER_FETCHES', 80),
  maxProfileAccounts: numberEnv('INSTAGRAM_AI_MAX_PROFILE_ACCOUNTS', 8),
  maxProfilePostsPerAccount: numberEnv('INSTAGRAM_AI_MAX_PROFILE_POSTS', 4),
  maxAgeDays: numberEnv('INSTAGRAM_AI_MAX_AGE_DAYS', 7),
  activeOfferMaxAgeDays: numberEnv('INSTAGRAM_AI_ACTIVE_OFFER_MAX_AGE_DAYS', 45),
  publicationFutureSkewMinutes: numberEnv('INSTAGRAM_AI_PUBLICATION_FUTURE_SKEW_MINUTES', 10),
  minScore: numberEnv('INSTAGRAM_AI_MIN_SCORE', 62),
  aiCandidateLimit: numberEnv('INSTAGRAM_AI_LLM_CANDIDATES', 32),
  profileDiscoveryEnabled: process.env.INSTAGRAM_AI_DISABLE_PROFILES !== '1',
  searchEnabled: process.env.INSTAGRAM_AI_DISABLE_SEARCH !== '1',
  previewFetchEnabled: process.env.INSTAGRAM_AI_FETCH_PAGES !== '0',
  renderFetchEnabled: process.env.INSTAGRAM_AI_RENDER_PAGES !== '0',
  aiEnabled: process.env.INSTAGRAM_AI_DISABLE_AI !== '1',
  model: process.env.OPENAI_MODEL || process.env.INSTAGRAM_AI_MODEL || 'gpt-4.1-mini',
};

const BASE_SEARCH_QUERIES = [
  'site:instagram.com/reel wien gratis essen',
  'site:instagram.com/p wien gratis essen',
  'site:instagram.com/reel wien gratis kaffee',
  'site:instagram.com/p vienna free coffee',
  'site:instagram.com/reel vienna free food',
  'site:instagram.com/p wien 1+1 restaurant',
  'site:instagram.com/reel wien 2 fuer 1 essen',
  'site:instagram.com/p wien happy hour deal',
  'site:instagram.com/reel wien neueroeffnung gratis',
  'site:instagram.com/p wien neueroeffnung gratis',
  'site:instagram.com/reel vienna opening free food',
  'site:instagram.com/p wien goodie bag gratis',
  'site:instagram.com/reel wien rabatt gutschein essen',
  'site:instagram.com/p vienna food deal',
  'site:instagram.com/reel wien gratis drink',
  'site:instagram.com/p vienna free drinks',
];

const LOCAL_DEAL_CORPUS_FILES = [
  'deals.json',
  'deals-pending-all.json',
  'deals-pending-merged.json',
  'deals-pending-community.json',
  'deals-pending-instagram-apify.json',
  'deals-pending-instagram-discovery.json',
  'deals-pending-instagram-web.json',
  'deals-pending-firecrawl4.json',
  'deals-pending-firecrawl5.json',
];

const CORE_PROFILE_ACCOUNTS = [
  { username: 'tastyfood.vienna', priority: 96, category: 'discovery', note: 'High-volume Vienna food deals and restaurant promos' },
  { username: 'foodiewien', priority: 96, category: 'discovery', note: 'Vienna food discovery account with promo posts' },
  { username: 'zushimarket', priority: 94, category: 'food', note: 'Merchant account with frequent opening and discount posts' },
  { username: 'german.doener.house', priority: 88, category: 'food', note: 'Merchant account with recent promos' },
  { username: 'merdins_cheesy_doener', priority: 88, category: 'food', note: 'Merchant account with recent promos' },
  { username: 'doenerwerkwien', priority: 84, category: 'food', note: 'Vienna kebab merchant/discovery source' },
  { username: 'seelokaya', priority: 82, category: 'food', note: 'Vienna restaurant source' },
  { username: '2ndstreetburger', priority: 82, category: 'food', note: 'Vienna burger merchant source' },
  { username: 'birbsbagel', priority: 80, category: 'food', note: 'Vienna bagel merchant source' },
  { username: 'blumencafe.wien', priority: 80, category: 'food', note: 'Vienna cafe merchant source' },
  { username: 'lebaron.wien', priority: 78, category: 'food', note: 'Vienna food merchant source' },
  { username: 'friendscovienna', priority: 76, category: 'food', note: 'Vienna food merchant source' },
  { username: 'behalal.official', priority: 76, category: 'food', note: 'Vienna halal food discovery source' },
  { username: 'viennaafterclass', priority: 72, category: 'discovery', note: 'Vienna student/deal discovery source' },
];

const VIENNA_PATTERNS = [
  /\bwien\b/i,
  /\bvienna\b/i,
  /\b(?:viennafood|viennaeats|viennarestaurants|viennafoodie|viennafoodies|wienfood|wieneats)\b/i,
  /\b1(?:0[1-9]0|1[0-9]0|2[0-3]0)\b/i,
  /\binnere stadt|leopoldstadt|landstrasse|wieden|margareten|mariahilf|neubau|josefstadt|alsergrund|favoriten|meidling|hietzing|penzing|rudolfsheim|ottakring|hernals|waehring|doebling|brigittenau|floridsdorf|donaustadt|liesing\b/i,
];

const STRONG_DEAL_PATTERNS = [
  /\bgratis\b/i,
  /\bkostenlos(?:e|er|es|en)?\b/i,
  /\bfree\b/i,
  /\b0\s*(?:euro|eur)\b/i,
  /\b1\s*\+\s*1\b/i,
  /\b2\s*(?:fuer|fur)\s*1\b/i,
  /\bbogo\b/i,
  /\b(?:rabatt|gutschein|coupon|voucher|deal|aktion|promo|happy hour|goodie bag)\b/i,
  /\b(?:neuer(?:o)?effnung|opening offer|opening deal)\b/i,
  /\b(?:nur heute|heute gratis|this week only|limited offer)\b/i,
  /\b(?:nur|only|um|for just|for only)\s+\d{1,2}(?:[,.]\d{1,2})?\s*(?:€|euro|eur)?\b/i,
  /\b\d{1,2}(?:[,.]\d{1,2})?\s*(?:€|euro|eur)\s*(?:angebot|aktion|special|deal)\b/i,
  /\b\d{1,2}(?:[,.]\d{1,2})?\s*(?:€|euro|eur)\s*(?:doner|doener|kebab|kebap|durum|burger|pizza|kaffee|coffee|drink|taco|wrap|falafel|croissant|baklava|menu|menue)\b/i,
  /\b\d{1,2}(?:[,.]\d{1,2})?\s*(?:€|euro|eur)\s*(?:matcha|latte|espresso|cappuccino)\b/i,
  /(?:€\s*)\d{1,3}(?:[,.]\d{1,2})?\s+statt\s+(?:€\s*)?\d{1,3}(?:[,.]\d{1,2})?/i,
  /\b\d{1,2}\s*%\s*(?:rabatt|off|discount)\b/i,
  /\b(?:mittag(?:s)?deal|lunch deal|student(?:en)?deal|special price|spezialpreis)\b/i,
];

const FOOD_DRINK_PATTERNS = [
  /\b(?:essen|food|restaurant|pizza|burger|kebab|kebap|doner|doener|durum|sushi|ramen|falafel|wrap|brunch|breakfast|croissant|bakery|cake|eis|gelato|ice cream|snack)\b/i,
  /\b(?:kaffee|coffee|cafe|espresso|latte|matcha|drink|drinks|cocktail|bar|bubble tea|boba)\b/i,
];

const CURRENT_PATTERNS = [
  /\b(?:heute|morgen|wochenende|diese woche|nur heute|ab heute|bis sonntag|bis morgen)\b/i,
  /\b(?:today|tomorrow|weekend|this week|now open|grand opening|opening weekend)\b/i,
];

const FALSE_POSITIVE_PATTERNS = [
  /\b(?:gewinnspiel|verlosung|giveaway|win a|zu gewinnen)\b/i,
  /\b(?:gratis versand|kostenlose lieferung|free shipping)\b/i,
  /\b(?:job|stellenangebot|wohnung|immobilie|airbnb|hotelzimmer)\b/i,
  /\b(?:things to do|wochenendtipps|guide|was in wien geht|top \d+)\b/i,
  /\b(?:anzeige|sponsored|affiliate)\b/i,
];

const BLOCKED_SOURCE_PATTERNS = [
  /\bneotaste\b/i,
  /\bneotaste\.app\b/i,
  /\bneotaste\.wien\b/i,
];

const DISCOVERY_ACCOUNT_PATTERNS = [
  /\b(?:eatinvienna|foodiewien|tastyfood|viennafood|viennaeats|viennarestaurants|viennas_joy|1000things|foodspots|shaysfoodblog|lisapestschansky)\b/i,
];

const EXPIRY_PATTERNS = [
  /\b(?:abgelaufen|vorbei|nicht mehr gueltig|expired|ended)\b/i,
];

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

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

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const json = JSON.stringify(
    value,
    (_key, item) => (typeof item === 'string' ? unicodeSafeTruncate(item) : item),
    2
  );
  fs.writeFileSync(filePath, `${json}\n`);
}

function cleanText(value = '', max = 1800) {
  return unicodeSafeTruncate(
    cleanDealText(value).replace(/[\u200B-\u200D\uFEFF]/g, ''),
    max
  ).trim();
}

function decodeHtmlEntities(value = '') {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function stripTags(value = '') {
  return cleanText(decodeHtmlEntities(String(value).replace(/<[^>]+>/g, ' ')), 1400);
}

function normalizeAscii(value = '') {
  return cleanText(value, 5000)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00df/g, 'ss')
    .toLowerCase();
}

const MONTH_NAMES = new Map([
  ['january', 1],
  ['february', 2],
  ['march', 3],
  ['april', 4],
  ['may', 5],
  ['june', 6],
  ['july', 7],
  ['august', 8],
  ['september', 9],
  ['october', 10],
  ['november', 11],
  ['december', 12],
  ['januar', 1],
  ['jaenner', 1],
  ['janner', 1],
  ['februar', 2],
  ['maerz', 3],
  ['marz', 3],
  ['mai', 5],
  ['juni', 6],
  ['juli', 7],
  ['oktober', 10],
  ['dezember', 12],
]);

function parseDateText(value = '') {
  const text = normalizeAscii(value);
  if (!text) return null;

  const english = text.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+([0-3]?\d),\s*(20\d{2})\b/);
  if (english) {
    return new Date(Date.UTC(Number(english[3]), MONTH_NAMES.get(english[1]) - 1, Number(english[2])));
  }

  const german = text.match(/\b([0-3]?\d)\.\s*(januar|jaenner|janner|februar|maerz|marz|april|mai|juni|juli|august|september|oktober|november|dezember)\s+(20\d{2})\b/);
  if (german) {
    return new Date(Date.UTC(Number(german[3]), MONTH_NAMES.get(german[2]) - 1, Number(german[1])));
  }

  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) {
    return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  }

  return null;
}

function stableHash(value) {
  return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 12);
}

function splitEnvList(value) {
  return String(value || '')
    .split(/[\n,]+/)
    .map((item) => cleanText(item, 500))
    .filter(Boolean);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function unwrapRedirectUrl(value) {
  const text = decodeHtmlEntities(cleanText(value, 2000));
  if (!text) return '';
  try {
    const parsed = new URL(text, 'https://duckduckgo.com');
    const redirect = parsed.searchParams.get('uddg') || parsed.searchParams.get('url') || parsed.searchParams.get('u');
    if (redirect) return decodeURIComponent(redirect);
    return parsed.href;
  } catch {
    return text;
  }
}

function normalizeInstagramPostUrl(value) {
  const unwrapped = unwrapRedirectUrl(value);
  if (!/^https?:\/\//i.test(unwrapped)) return '';

  try {
    const parsed = new URL(unwrapped);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (!host.endsWith('instagram.com')) return '';

    if (parsed.pathname.toLowerCase().startsWith('/accounts/login')) {
      const next = parsed.searchParams.get('next');
      if (!next) return '';
      const nextUrl = next.startsWith('http') ? next : `https://www.instagram.com${next}`;
      return normalizeInstagramPostUrl(nextUrl);
    }

    const parts = parsed.pathname.split('/').filter(Boolean);
    const typeIndex = parts.findIndex((part) => ['p', 'reel', 'tv'].includes(part.toLowerCase()));
    if (typeIndex < 0 || !parts[typeIndex + 1]) return '';
    const type = parts[typeIndex].toLowerCase();
    const shortcode = parts[typeIndex + 1].replace(/[^a-z0-9_-]/gi, '');
    if (!shortcode) return '';
    return `https://www.instagram.com/${type}/${shortcode}/`;
  } catch {
    return '';
  }
}

function instagramShortcodeRank(url) {
  const normalized = normalizeInstagramPostUrl(url);
  if (!normalized) return 0n;
  try {
    const parsed = new URL(normalized);
    const shortcode = parsed.pathname.split('/').filter(Boolean)[1] || '';
    let rank = 0n;
    for (const char of shortcode) {
      const value = INSTAGRAM_SHORTCODE_ALPHABET.indexOf(char);
      if (value < 0) continue;
      rank = (rank * 64n) + BigInt(value);
    }
    return rank;
  } catch {
    return 0n;
  }
}

function canonicalPostKey(url) {
  const normalized = normalizeInstagramPostUrl(url);
  if (!normalized) return '';
  try {
    const parsed = new URL(normalized);
    const parts = parsed.pathname.split('/').filter(Boolean);
    return `instagram:${parts[0]}:${parts[1].toLowerCase()}`;
  } catch {
    return normalized.toLowerCase();
  }
}

function extractInstagramUrlsFromText(value) {
  const text = decodeHtmlEntities(String(value || ''));
  const urls = new Set();
  const directMatches = text.match(/https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv)\/[A-Za-z0-9_-]+\/?(?:\?[^"'<\s]*)?/gi) || [];
  for (const match of directMatches) {
    const normalized = normalizeInstagramPostUrl(match);
    if (normalized) urls.add(normalized);
  }

  const hrefMatches = [...text.matchAll(/href=["']([^"']+)["']/gi)];
  for (const match of hrefMatches) {
    const normalized = normalizeInstagramPostUrl(match[1]);
    if (normalized) urls.add(normalized);
  }
  return [...urls];
}

function extractInstagramPostPaths(value) {
  const text = decodeHtmlEntities(String(value || ''))
    .replace(/\\u002f/gi, '/')
    .replace(/\\\//g, '/');
  const matches = text.match(/\/(?:p|reel|tv)\/[A-Za-z0-9_-]+\/?/g) || [];
  return [...new Set(matches)]
    .map((postPath) => normalizeInstagramPostUrl(`https://www.instagram.com${postPath}`))
    .filter(Boolean);
}

function makeCandidate({ url, title = '', snippet = '', source = '', query = '', sourceDeal = null }) {
  const normalizedUrl = normalizeInstagramPostUrl(url);
  if (!normalizedUrl) return null;
  return {
    url: normalizedUrl,
    key: canonicalPostKey(normalizedUrl),
    title: cleanText(title, 300),
    snippet: cleanText(snippet, 1200),
    source: cleanText(source, 80),
    query: cleanText(query, 240),
    sourceDeal,
    sourceAccount: cleanText(sourceDeal?.profileAccount || '', 80),
    sourceCategory: cleanText(sourceDeal?.sourceCategory || '', 80),
    preview: null,
    score: 0,
    reasons: [],
    rejectionReason: '',
  };
}

function mergeCandidate(existing, candidate) {
  if (!existing) return candidate;
  return {
    ...existing,
    title: existing.title || candidate.title,
    snippet: cleanText([existing.snippet, candidate.snippet].filter(Boolean).join(' '), 1600),
    source: [...new Set([existing.source, candidate.source].filter(Boolean))].join(', '),
    query: cleanText([...new Set([existing.query, candidate.query].filter(Boolean))].join(' | '), 500),
    sourceDeal: existing.sourceDeal || candidate.sourceDeal,
    sourceAccount: existing.sourceAccount || candidate.sourceAccount,
    sourceCategory: existing.sourceCategory || candidate.sourceCategory,
  };
}

function addCandidate(map, candidate) {
  if (!candidate?.key) return;
  map.set(candidate.key, mergeCandidate(map.get(candidate.key), candidate));
}

function parseDuckDuckGoResults(html, query) {
  const results = [];
  const blocks = String(html || '').split(/<div[^>]+class=["'][^"']*result[^"']*["'][^>]*>/i).slice(1);

  for (const block of blocks) {
    const href = block.match(/href=["']([^"']+)["']/i)?.[1] || '';
    const title = block.match(/class=["'][^"']*result__a[^"']*["'][^>]*>([\s\S]*?)<\/a>/i)?.[1] || '';
    const snippet = block.match(/class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i)?.[1] || '';
    const url = normalizeInstagramPostUrl(href);
    if (!url) continue;
    results.push(makeCandidate({
      url,
      title: stripTags(title),
      snippet: stripTags(snippet),
      source: 'duckduckgo',
      query,
    }));
  }

  if (results.length === 0) {
    for (const url of extractInstagramUrlsFromText(html)) {
      results.push(makeCandidate({ url, source: 'duckduckgo', query }));
    }
  }

  return results.filter(Boolean);
}

async function searchDuckDuckGo(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: {
      'user-agent': USER_AGENT,
      'accept-language': 'de-AT,de;q=0.9,en;q=0.8',
    },
  });
  const html = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${unicodeSafeTruncate(html, 160)}`);
  return parseDuckDuckGoResults(html, query);
}

function loadWatchlist() {
  const parsed = readJson(WATCHLIST_PATH, {});
  const registry = readJson(MERCHANT_REGISTRY_PATH, {});
  const envAccounts = splitEnvList(process.env.INSTAGRAM_AI_PROFILE_ACCOUNTS).map((username) => ({
    username,
    priority: 90,
    category: 'env',
    note: 'Configured through INSTAGRAM_AI_PROFILE_ACCOUNTS',
  }));
  const registryAccounts = Array.isArray(registry.accounts)
    ? registry.accounts.map((account) => ({
      username: account.username,
      priority: Number(account.priorityScore) || 50,
      category: 'registry',
      note: 'Discovered by merchant registry',
    }))
    : [];
  const baseAccounts = Array.isArray(parsed.accounts) ? parsed.accounts : [];
  const byUsername = new Map();
  for (const account of [...baseAccounts, ...CORE_PROFILE_ACCOUNTS, ...registryAccounts, ...envAccounts]) {
    const username = cleanText(account.username, 80).toLowerCase();
    if (!username) continue;
    const existing = byUsername.get(username);
    if (!existing || (Number(account.priority) || 0) > (Number(existing.priority) || 0)) {
      byUsername.set(username, { ...account, username });
    }
  }
  return [...byUsername.values()].sort((left, right) => (Number(right.priority) || 0) - (Number(left.priority) || 0));
}

function loadSeedFile() {
  const parsed = readJson(SEEDS_PATH, {});
  const urls = [];
  const queries = [];
  if (Array.isArray(parsed.urls)) urls.push(...parsed.urls);
  if (Array.isArray(parsed.queries)) queries.push(...parsed.queries);
  return {
    urls: urls.map((url) => cleanText(url, 1000)).filter(Boolean),
    queries: queries.map((query) => cleanText(query, 300)).filter(Boolean),
  };
}

function buildWatchlistQueries(accounts) {
  const selected = [...accounts]
    .sort((left, right) => (Number(right.priority) || 0) - (Number(left.priority) || 0))
    .slice(0, 16);

  const queries = [];
  for (const account of selected) {
    const username = cleanText(account.username, 80);
    if (!username) continue;
    queries.push(`site:instagram.com/${username} wien gratis`);
    queries.push(`site:instagram.com/${username} vienna deal`);
  }
  return queries;
}

function buildSearchQueries(accounts) {
  const seedFile = loadSeedFile();
  return [
    ...splitEnvList(process.env.INSTAGRAM_AI_QUERIES),
    ...seedFile.queries,
    ...BASE_SEARCH_QUERIES,
    ...buildWatchlistQueries(accounts),
  ]
    .map((query) => cleanText(query, 300))
    .filter(Boolean)
    .filter((query, index, arr) => arr.indexOf(query) === index)
    .slice(0, CONFIG.maxSearchQueries);
}

function addSeedCandidates(map) {
  const seedFile = loadSeedFile();
  const urls = [
    ...splitEnvList(process.env.INSTAGRAM_AI_URLS),
    ...seedFile.urls,
  ];
  for (const url of urls) {
    addCandidate(map, makeCandidate({ url, source: 'seed-url' }));
  }
  return urls.length;
}

async function discoverProfileCandidates(accounts, map) {
  const stats = {
    accountsVisited: 0,
    discovered: 0,
    blocked: 0,
    noPostLinks: 0,
    errors: [],
  };
  if (!CONFIG.profileDiscoveryEnabled || accounts.length === 0) return stats;

  const selected = [...accounts]
    .sort((left, right) => (Number(right.priority) || 0) - (Number(left.priority) || 0))
    .slice(0, CONFIG.maxProfileAccounts);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    userAgent: USER_AGENT,
    locale: 'de-AT',
    timezoneId: 'Europe/Vienna',
  });

  try {
    for (const account of selected) {
      const username = cleanText(account.username, 80);
      if (!username) continue;
      const page = await context.newPage();
      try {
        let data = null;
        let urls = [];
        const profileUrls = [
          `https://www.instagram.com/${username}/`,
          `https://www.instagram.com/${username}/?hl=en`,
        ];
        for (const profileUrl of profileUrls) {
          await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForTimeout(4500);
          await page.mouse.wheel(0, 900).catch(() => {});
          await page.waitForTimeout(700);
          data = await page.evaluate(() => ({
            title: document.title || '',
            text: document.body?.innerText || '',
            html: document.documentElement?.innerHTML || '',
          }));
          urls = extractInstagramPostPaths(data.html).slice(0, CONFIG.maxProfilePostsPerAccount);
          if (urls.length > 0 || !isProfileUnavailable(data)) break;
        }

        if (urls.length === 0) {
          if (isProfileUnavailable(data)) stats.blocked += 1;
          else stats.noPostLinks += 1;
        }

        for (const url of urls) {
          addCandidate(map, makeCandidate({
            url,
            title: data.title,
            snippet: data.text,
            source: `profile:${username}`,
            query: `https://www.instagram.com/${username}/`,
            sourceDeal: {
              profileAccount: username,
              sourceCategory: account.category || '',
              brand: account.category === 'discovery' ? '' : username,
              title: `${username} Instagram profile`,
              description: account.note || '',
            },
          }));
        }
        stats.accountsVisited += 1;
        stats.discovered += urls.length;
      } catch (error) {
        stats.errors.push({ account: username, error: error.message });
      } finally {
        await page.close();
      }
      await sleep(250);
    }
  } finally {
    await context.close();
    await browser.close();
  }

  return stats;
}

function isProfileUnavailable(data = {}) {
  const signal = normalizeAscii([data.title, data.text].filter(Boolean).join(' '));
  return /seite konnte nicht geladen werden|etwas ist schiefgelaufen|something went wrong|page could not be loaded|log in|anmelden|registrieren/.test(signal);
}

function isInstagramLikeUrl(value) {
  return Boolean(normalizeInstagramPostUrl(value));
}

function collectExistingCandidates(map) {
  let count = 0;
  const index = readJson(CANDIDATES_INDEX_PATH, {});
  const candidates = Array.isArray(index.candidates) ? index.candidates : [];
  for (const row of candidates) {
    const url = row.url || row.postUrl || row.post_url || '';
    if (!isInstagramLikeUrl(url)) continue;
    addCandidate(map, makeCandidate({
      url,
      title: row.title,
      snippet: [row.description, row.brand, row.distance, row.sourceLabel].filter(Boolean).join(' '),
      source: row.sourceKey || 'deal-candidates-index',
      sourceDeal: row,
    }));
    count += 1;
  }

  for (const file of LOCAL_DEAL_CORPUS_FILES) {
    const parsed = readJson(path.join(DOCS_DIR, file), {});
    const deals = Array.isArray(parsed.deals) ? parsed.deals : [];
    for (const deal of deals) {
      const url = deal.url || deal.postUrl || deal.post_url || '';
      if (!isInstagramLikeUrl(url)) continue;
      addCandidate(map, makeCandidate({
        url,
        title: deal.title,
        snippet: [deal.description, deal.brand, deal.distance, deal.expires].filter(Boolean).join(' '),
        source: file.replace(/^deals-pending-/, '').replace(/\.json$/, ''),
        sourceDeal: deal,
      }));
      count += 1;
    }
  }
  return count;
}

function metaContent(html, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i');
  return stripTags(pattern.exec(html)?.[1] || '');
}

function extractJsonLdText(html) {
  const parts = [];
  const matches = [...String(html || '').matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const match of matches.slice(0, 4)) {
    try {
      const parsed = JSON.parse(decodeHtmlEntities(match[1]));
      const entries = Array.isArray(parsed) ? parsed : [parsed];
      for (const entry of entries) {
        parts.push(entry.name, entry.headline, entry.caption, entry.description, entry.uploadDate, entry.datePublished);
      }
    } catch {}
  }
  return cleanText(parts.filter(Boolean).join(' '), 1200);
}

function extractDateFromHtml(html) {
  const text = String(html || '');
  const candidates = [
    ...text.matchAll(/"(?:uploadDate|datePublished|dateCreated|taken_at_timestamp)"\s*:\s*"?([^",}]+)"?/gi),
    ...text.matchAll(/<time[^>]+datetime=["']([^"']+)["']/gi),
  ].map((match) => match[1]);

  for (const raw of candidates) {
    const value = /^\d{10}$/.test(raw) ? Number(raw) * 1000 : raw;
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return '';
}

async function fetchInstagramPreview(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'user-agent': USER_AGENT,
      'accept-language': 'de-AT,de;q=0.9,en;q=0.8',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });
  const html = await response.text();
  const finalUrl = response.url || url;
  const status = response.status;
  const loginWall = /\/accounts\/login|login \u2022 instagram|log in to instagram|sign in to view/i.test(`${finalUrl} ${html.slice(0, 5000)}`);
  const preview = {
    status,
    finalUrl,
    loginWall,
    title: '',
    description: '',
    image: '',
    jsonLdText: '',
    pubDate: '',
  };

  if (response.ok && !loginWall) {
    preview.title = metaContent(html, 'og:title') || metaContent(html, 'twitter:title') || stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
    preview.description = metaContent(html, 'og:description') || metaContent(html, 'description') || metaContent(html, 'twitter:description');
    preview.image = metaContent(html, 'og:image') || metaContent(html, 'twitter:image');
    preview.jsonLdText = extractJsonLdText(html);
    preview.pubDate = extractDateFromHtml(html);
  }

  return preview;
}

function extractRenderedPostDate(data = {}) {
  const timeWithDateTime = (data.times || []).find((item) => item.dateTime);
  if (timeWithDateTime?.dateTime) {
    const parsed = new Date(timeWithDateTime.dateTime);
    if (!Number.isNaN(parsed.getTime())) return { date: parsed, source: 'instagram-rendered-time-datetime' };
  }

  const fromMeta = parseDateText([data.ogDescription, data.ogTitle].filter(Boolean).join(' '));
  if (fromMeta) return { date: fromMeta, source: 'instagram-rendered-og' };

  const absoluteTime = (data.times || []).find((item) => parseDateText(item.text));
  const fromTimeText = parseDateText(absoluteTime?.text || '');
  if (fromTimeText) return { date: fromTimeText, source: 'instagram-rendered-time-text' };

  return null;
}

async function fetchRenderedInstagramPreview(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4500);

  const data = await page.evaluate(() => {
    const meta = (name) => document.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.getAttribute('content') || '';
    return {
      finalUrl: location.href,
      title: document.title || '',
      ogTitle: meta('og:title'),
      ogDescription: meta('og:description') || meta('description') || meta('twitter:description'),
      image: meta('og:image') || meta('twitter:image'),
      times: Array.from(document.querySelectorAll('time')).map((node) => ({
        dateTime: node.getAttribute('datetime') || '',
        text: node.textContent || '',
      })).slice(0, 24),
      bodyText: document.body?.innerText || '',
    };
  });

  const postDate = extractRenderedPostDate(data);
  return {
    status: 200,
    finalUrl: data.finalUrl,
    loginWall: /accounts\/login|anmelden|registrieren|log in to instagram/i.test(cleanText(data.bodyText, 500)),
    title: cleanText(data.ogTitle || data.title, 1200),
    description: cleanText(data.ogDescription, 2200),
    image: cleanText(data.image, 1200),
    jsonLdText: '',
    bodyText: cleanText(data.bodyText, 2500),
    pubDate: postDate?.date?.toISOString() || '',
    pubDateSource: postDate?.source || '',
    timeTags: data.times,
  };
}

function candidateSignal(candidate) {
  const deal = candidate.sourceDeal || {};
  const preview = candidate.preview || {};
  return [
    candidate.title,
    candidate.snippet,
    preview.title,
    preview.description,
    preview.jsonLdText,
    preview.bodyText,
    deal.title,
    deal.description,
    deal.brand,
    deal.distance,
    deal.expires,
  ].map((part) => cleanText(part, 1800)).filter(Boolean).join(' ');
}

function postSignal(candidate) {
  const preview = candidate.preview || {};
  return [
    preview.title,
    preview.description,
    preview.jsonLdText,
    preview.bodyText,
  ].map((part) => cleanText(part, 1800)).filter(Boolean).join(' ');
}

function offerDateSignal(candidate) {
  const preview = candidate.preview || {};
  const deal = candidate.sourceDeal || {};
  return [
    candidate.title,
    candidate.snippet,
    preview.title,
    preview.description,
    preview.jsonLdText,
    deal.title,
    deal.description,
    deal.expires,
  ].map((part) => cleanText(part, 1200)).filter(Boolean).join(' ');
}

function hasPattern(patterns, value) {
  const normalized = patterns === STRONG_DEAL_PATTERNS
    ? stripFreeFromClaims(normalizeAscii(value))
    : normalizeAscii(value);
  return patterns.some((pattern) => pattern.test(normalized));
}

function stripFreeFromClaims(value = '') {
  return String(value || '')
    .replace(/\b(?:gluten|sugar|zucker|alcohol|alkohol|dairy|lactose|laktose|cruelty|fat|caffeine|koffein)[-\s]?free\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parsePubDate(candidate) {
  const raw = candidate.preview?.pubDate || '';
  const date = new Date(raw);
  if (!Number.isNaN(date.getTime())) return { date, source: candidate.preview?.pubDateSource || 'instagram-rendered' };
  return null;
}

function ageDays(date) {
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / DAY_MS));
}

function ageDaysExact(date) {
  return Math.max(0, (Date.now() - date.getTime()) / DAY_MS);
}

function localDayEnd(year, month, day) {
  return new Date(year, month - 1, day, 23, 59, 59, 999);
}

function endOfLocalDay(date) {
  return localDayEnd(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function addLocalDays(date, days) {
  return localDayEnd(date.getFullYear(), date.getMonth() + 1, date.getDate() + days);
}

function relativeOfferWindowEnd(signal, pubDate = new Date()) {
  const text = normalizeAscii(signal);
  if (!text) return null;

  if (/\b(?:nur heute|heute gratis|today only|free today)\b/.test(text)) {
    return endOfLocalDay(pubDate);
  }

  if (/\b(?:bis morgen|nur morgen|tomorrow only|only tomorrow)\b/.test(text)) {
    return addLocalDays(pubDate, 1);
  }

  const weekdayMatch = hasRecurringWeekdaySchedule(text)
    ? null
    : text.match(/\b(?:bis|until)\s+(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (weekdayMatch) {
    const weekdayMap = {
      sonntag: 0,
      sunday: 0,
      montag: 1,
      monday: 1,
      dienstag: 2,
      tuesday: 2,
      mittwoch: 3,
      wednesday: 3,
      donnerstag: 4,
      thursday: 4,
      freitag: 5,
      friday: 5,
      samstag: 6,
      saturday: 6,
    };
    const target = weekdayMap[weekdayMatch[1]];
    const current = pubDate.getDay();
    const daysUntilTarget = (target - current + 7) % 7;
    return addLocalDays(pubDate, daysUntilTarget);
  }

  if (/\b(?:dieses wochenende|this weekend|weekend)\b/.test(text)) {
    const daysUntilSunday = (7 - pubDate.getDay()) % 7;
    return addLocalDays(pubDate, daysUntilSunday);
  }

  return null;
}

function hasExpiredRelativeOfferDate(signal, pubDate) {
  if (!pubDate) return false;
  const windowEnd = relativeOfferWindowEnd(signal, pubDate);
  return Boolean(windowEnd && windowEnd.getTime() < Date.now());
}

function inferType(signal) {
  const text = stripFreeFromClaims(normalizeAscii(signal));
  if (/\b1\s*\+\s*1\b|\b2\s*(?:fuer|fur)\s*1\b|\bbogo\b/.test(text)) return 'bogo';
  if (/\bgratis\b|\bkostenlos\w*\b|\bfree\b|\b0\s*(?:euro|eur)\b/.test(text)) return 'gratis';
  if (/\bgutschein|coupon|voucher\b/.test(text)) return 'gutschein';
  return 'rabatt';
}

function inferBrand(candidate, signal) {
  const dealBrand = cleanText(candidate.sourceDeal?.brand, 80);
  if (dealBrand && !/^instagram$/i.test(dealBrand) && !isWeakBrand(dealBrand)) return dealBrand;

  const sourceAccount = cleanText(candidate.sourceAccount || candidate.sourceDeal?.profileAccount || '', 80).toLowerCase();
  const handleMatches = [...signal.matchAll(/@([a-z0-9._]{2,40})/gi)]
    .map((match) => match[1])
    .filter((handle) => handle.toLowerCase() !== sourceAccount)
    .filter((handle) => !hasPattern(BLOCKED_SOURCE_PATTERNS, handle))
    .filter((handle) => !hasPattern(DISCOVERY_ACCOUNT_PATTERNS, handle));
  if (handleMatches.length > 0) return handleMatches[0];

  const title = cleanText(candidate.preview?.title || candidate.title, 160);
  const onInstagram = title.match(/^(.{2,70}?)\s+(?:on|auf)\s+instagram\b/i);
  if (
    onInstagram
    && !isWeakBrand(onInstagram[1])
    && !hasPattern(DISCOVERY_ACCOUNT_PATTERNS, onInstagram[1])
  ) {
    return cleanText(onInstagram[1].replace(/^@/, ''), 80);
  }

  const sourceTitle = cleanText(candidate.sourceDeal?.title || '', 180);
  const sourceOfferBrand = sourceTitle.match(/:\s*([A-Za-z][A-Za-z0-9 .'&-]{2,45})\s+(?:angebot|deal|aktion|gratis|menu|menue)\b/i)?.[1];
  if (sourceOfferBrand && !isWeakBrand(sourceOfferBrand)) return cleanText(sourceOfferBrand, 80);

  const quoted = signal.match(/^(.{2,45}?):\s/);
  if (quoted && !isWeakBrand(quoted[1])) return cleanText(quoted[1], 80);
  return 'Instagram Deal Wien';
}

function isWeakBrand(value) {
  const text = normalizeAscii(value);
  if (!text || /^instagram\b/.test(text) || text === 'wien' || text === 'vienna') return true;
  if (/^\d/.test(text)) return true;
  if (/(?:strasse|str\.?|gasse|platz|weg|ring|allee|markt|graben)/.test(text) && /\d/.test(text)) return true;
  if (/\b1(?:0[1-9]0|1[0-9]0|2[0-3]0)\b/.test(text)) return true;
  return false;
}

function hasSpecificBrand(candidate, signal) {
  return !isWeakBrand(inferBrand(candidate, signal));
}

function buildOfferTitle(brand, type, signal, candidate = null) {
  const sourceTitleCandidates = [
    candidate?.sourceDeal?.description,
    candidate?.sourceDeal?.title,
  ];
  for (const sourceCandidate of sourceTitleCandidates) {
    const sourceTitle = cleanText(String(sourceCandidate || '').split(/\s+[–-]\s+/)[0], 110);
    if (sourceTitle && hasPattern(STRONG_DEAL_PATTERNS, sourceTitle) && !isWeakTitleText(sourceTitle)) {
      return sourceTitle;
    }
  }

  const text = cleanText(signal, 260);
  const firstSentence = text.split(/[.!?]\s/).find((part) => part.length >= 16 && part.length <= 110);
  if (firstSentence && !/^instagram$/i.test(firstSentence) && !isWeakTitleText(firstSentence)) {
    return cleanText(firstSentence, 100);
  }

  if (type === 'gratis') return `${brand}: Gratis-Aktion in Wien`;
  if (type === 'bogo') return `${brand}: 1+1 Deal in Wien`;
  if (type === 'gutschein') return `${brand}: Gutschein-Aktion in Wien`;
  return `${brand}: Instagram-Deal in Wien`;
}

function isWeakTitleText(value) {
  const text = normalizeAscii(value);
  if (text.includes('|')) return true;
  if (/\b1(?:0[1-9]0|1[0-9]0|2[0-3]0)\b/.test(text) && /(?:strasse|str\.?|gasse|platz|weg|ring|allee)/.test(text)) return true;
  return false;
}

function extractExpiryText(signal, pubDate = null) {
  const text = cleanText(signal, 1000);
  const activeWindow = extractActiveOfferWindow(text, { pubDate });
  if (activeWindow?.endDate) return activeWindow.endDate.toISOString();
  const relativeEnd = pubDate ? relativeOfferWindowEnd(text, pubDate) : null;
  if (relativeEnd) return relativeEnd.toISOString();

  const matches = [
    text.match(/\b(?:bis|gueltig bis|valid until)\s+([0-3]?\d[./-][01]?\d(?:[./-]\d{2,4})?)/i)?.[0],
    text.match(/\b(?:nur heute|heute|morgen|dieses wochenende|this weekend|today only)\b/i)?.[0],
    text.match(/\b(?:bis sonntag|bis morgen|bis freitag|bis samstag)\b/i)?.[0],
  ].filter(Boolean);
  return cleanText(matches[0] || '', 80);
}

function offerTimingEvidence(timing) {
  return {
    kind: timing.offerWindow?.kind || (timing.recurring ? 'recurring' : ''),
    matchedText: cleanText(timing.offerWindow?.evidence || '', 180),
    validFrom: timing.offerWindow?.startDate?.toISOString() || '',
    validUntil: timing.offerWindow?.endDate?.toISOString() || '',
    recurring: Boolean(timing.recurring),
    activeOfferMaxAgeDays: timing.activeOfferMaxAgeDays,
  };
}

function hasTrustedViennaEvidence(candidate, primarySignal) {
  if (hasViennaInstagramEvidence(primarySignal)) return true;
  const trustedApprovedContext = /(?:^|,\s*)deals(?:,|$)/i.test(cleanText(candidate.source));
  if (!trustedApprovedContext && !candidate.sourceDeal?.viennaEvidence?.verified) return false;
  const sourceLocation = [
    candidate.sourceDeal?.distance,
    candidate.sourceDeal?.address,
    candidate.sourceDeal?.location,
    candidate.sourceDeal?.ort,
  ].map((value) => cleanText(value, 300)).filter(Boolean).join(' ');
  return hasPattern(VIENNA_PATTERNS, sourceLocation);
}

function buildQualityScore(candidate, signal) {
  const reasons = [];
  let score = 0;

  const primarySignal = postSignal(candidate) || signal;
  const pubDate = parsePubDate(candidate);
  const dateSignal = offerDateSignal(candidate) || primarySignal;
  const offerTiming = evaluateInstagramOfferTiming({
    signal: dateSignal,
    pubDate: pubDate?.date,
    maxAgeDays: CONFIG.maxAgeDays,
    activeOfferMaxAgeDays: CONFIG.activeOfferMaxAgeDays,
    futureSkewMinutes: CONFIG.publicationFutureSkewMinutes,
  });
  const sourceDeal = candidate.sourceDeal || {};
  const hasVienna = hasTrustedViennaEvidence(candidate, primarySignal);
  const hasDeal = hasPattern(STRONG_DEAL_PATTERNS, primarySignal);
  const hasFoodDrink = hasPattern(FOOD_DRINK_PATTERNS, primarySignal);
  const hasCurrent = hasPattern(CURRENT_PATTERNS, primarySignal);
  const hasPreview = Boolean(candidate.preview?.description || candidate.preview?.title);

  if (hasVienna) {
    score += 22;
    reasons.push('vienna');
  }
  if (hasDeal) {
    score += 28;
    reasons.push('deal-signal');
  }
  if (hasFoodDrink) {
    score += 12;
    reasons.push('food-drink');
  }
  if (hasCurrent) {
    score += 10;
    reasons.push('current-language');
  }
  if (hasPreview) {
    score += 6;
    reasons.push('public-preview');
  }
  if (sourceDeal.brand || sourceDeal.title) {
    score += 8;
    reasons.push('existing-source-context');
  }
  if (/watchlist|instagram|firecrawl/i.test(candidate.source)) {
    score += 4;
    reasons.push('known-source');
  }

  if (pubDate?.date) {
    const age = ageDaysExact(pubDate.date);
    if (age <= 1) score += 14;
    else if (age <= 3) score += 11;
    else if (age <= 7) score += 8;
    else if (age <= CONFIG.maxAgeDays) score += 4;
    else if (offerTiming.eligibleByAge) {
      score += 4;
      reasons.push(offerTiming.recurring ? 'active-recurring-offer' : 'active-explicit-offer');
    } else score -= 18;
    reasons.push(`age-${ageDays(pubDate.date)}d`);
  } else {
    score -= 28;
    reasons.push('unknown-date');
  }

  if (hasPattern(BLOCKED_SOURCE_PATTERNS, signal)) {
    score -= 60;
    reasons.push('blocked-source');
  }
  if (hasPattern(FALSE_POSITIVE_PATTERNS, primarySignal)) {
    score -= 28;
    reasons.push('false-positive-language');
  }
  if (hasPattern(EXPIRY_PATTERNS, primarySignal)) {
    score -= 20;
    reasons.push('expired-language');
  }
  if (offerTiming.explicitExpired) {
    score -= 45;
    reasons.push('past-offer-date');
  }
  if (offerTiming.yesterdayOnly) {
    score -= 45;
    reasons.push('yesterday-only-offer');
  }
  if (offerTiming.notStarted) {
    score -= 45;
    reasons.push('future-offer-date');
  }
  if (offerTiming.futurePublication) {
    score -= 60;
    reasons.push('future-publication-date');
  }
  if (hasExpiredRelativeOfferDate(dateSignal, pubDate?.date)) {
    score -= 45;
    reasons.push('expired-relative-date');
  }
  if (candidate.preview?.loginWall) {
    score -= 3;
    reasons.push('preview-login-wall');
  }

  return { score: Math.max(0, Math.min(100, score)), reasons };
}

function getRejectionReason(candidate, signal, score) {
  const primarySignal = postSignal(candidate) || signal;
  if (!signal) return 'kein Textsignal zum Post';
  if (hasPattern(BLOCKED_SOURCE_PATTERNS, signal)) return 'NeoTaste blockiert';
  const pubDate = parsePubDate(candidate);
  if (!pubDate?.date) return 'kein echtes Instagram-Postdatum';
  const dateSignal = offerDateSignal(candidate) || primarySignal;
  const offerTiming = evaluateInstagramOfferTiming({
    signal: dateSignal,
    pubDate: pubDate.date,
    maxAgeDays: CONFIG.maxAgeDays,
    activeOfferMaxAgeDays: CONFIG.activeOfferMaxAgeDays,
    futureSkewMinutes: CONFIG.publicationFutureSkewMinutes,
  });
  if (offerTiming.futurePublication) return 'Instagram-Postdatum liegt unplausibel in der Zukunft';
  if (offerTiming.explicitExpired) return 'explizites Aktionsende liegt in der Vergangenheit';
  if (offerTiming.yesterdayOnly) return 'Aktion galt ausdruecklich nur gestern';
  if (offerTiming.notStarted) return 'expliziter Aktionszeitraum hat noch nicht begonnen';
  if (hasExpiredRelativeOfferDate(dateSignal, pubDate.date)) return 'relative Kurz-Aktion ist abgelaufen';
  if (!offerTiming.eligibleByAge) {
    if (offerTiming.ageDays > CONFIG.activeOfferMaxAgeDays) {
      return `Instagram-Post aelter als ${CONFIG.activeOfferMaxAgeDays} Tage`;
    }
    return `Instagram-Post aelter als ${CONFIG.maxAgeDays} Tage ohne belegte laufende Aktion`;
  }
  if (!hasTrustedViennaEvidence(candidate, primarySignal)) return 'kein eindeutiges Wien-Signal im Instagram-Post';
  if (!hasPattern(STRONG_DEAL_PATTERNS, primarySignal)) return 'kein starkes Gratis-/Deal-Signal im Instagram-Post';
  if (!hasSpecificBrand(candidate, signal)) return 'keine belastbare Marke/Quelle';
  if (hasPattern(FALSE_POSITIVE_PATTERNS, primarySignal)) return 'Gewinnspiel/Versand/Guide/sonstiges False-Positive-Signal';
  if (hasPattern(EXPIRY_PATTERNS, primarySignal)) return 'explizit abgelaufen oder vorbei';
  if (score < CONFIG.minScore) return `Score zu niedrig (${score})`;
  return '';
}

function buildHeuristicDeal(candidate) {
  const signal = candidateSignal(candidate);
  const { score, reasons } = buildQualityScore(candidate, signal);
  candidate.score = score;
  candidate.reasons = reasons;
  candidate.rejectionReason = getRejectionReason(candidate, signal, score);
  if (candidate.rejectionReason) return null;

  const type = inferType(signal);
  const brand = inferBrand(candidate, signal);
  const category = normalizeCategoryForScraper('', [brand, signal]);
  const pubDate = parsePubDate(candidate);
  if (!pubDate?.date) {
    candidate.rejectionReason = 'kein echtes Instagram-Postdatum';
    return null;
  }
  const title = buildOfferTitle(brand, type, signal, candidate);
  const dateSignal = offerDateSignal(candidate) || signal;
  const offerTiming = evaluateInstagramOfferTiming({
    signal: dateSignal,
    pubDate: pubDate.date,
    maxAgeDays: CONFIG.maxAgeDays,
    activeOfferMaxAgeDays: CONFIG.activeOfferMaxAgeDays,
    futureSkewMinutes: CONFIG.publicationFutureSkewMinutes,
  });
  const expires = extractExpiryText(dateSignal, pubDate.date);
  const primarySignal = postSignal(candidate) || signal;
  const timingEvidence = offerTimingEvidence(offerTiming);

  const rawDeal = {
    id: `instagram-ai-${stableHash(`${candidate.url}|${title}`)}`,
    brand,
    logo: 'IG',
    title,
    description: cleanText(`${unicodeSafeTruncate(primarySignal, 360)} Quelle: Instagram/Public Search.`, 520),
    type,
    category,
    source: 'Instagram AI Agent',
    originSource: 'instagram-ai-agent',
    url: candidate.url,
    expires,
    expiryKind: timingEvidence.kind,
    expiryDisplayText: timingEvidence.matchedText,
    validFrom: timingEvidence.validFrom.slice(0, 10),
    validUntil: timingEvidence.validUntil.slice(0, 10),
    dateConfidence: timingEvidence.kind ? 'high' : '',
    distance: 'Wien',
    hot: type === 'gratis' || type === 'bogo',
    isNew: true,
    priority: score >= 78 ? 5 : 4,
    votes: score >= 78 ? 3 : 2,
    qualityScore: score,
    pubDate: pubDate.date.toISOString(),
    pubDateSource: pubDate.source,
    evidence: {
      heuristicReasons: reasons,
      source: candidate.source,
      query: candidate.query,
      previewStatus: candidate.preview?.status || null,
      previewLoginWall: Boolean(candidate.preview?.loginWall),
      postDateSource: pubDate.source,
      offerDateSignal: cleanText(dateSignal, 4000),
      offerTiming: timingEvidence,
      textSample: cleanText(signal, 500),
    },
    confidence: Math.min(0.97, Math.max(0.45, score / 100)),
    reviewTier: score >= 78 ? 'high' : 'review',
  };

  const deal = normalizeDealRecord(rawDeal);
  if (isExpiredDealRecord(deal) || isFalsePositiveFreeDeal(deal)) {
    candidate.rejectionReason = 'Normalisierung/Validity-Filter blockiert Deal';
    return null;
  }
  return deal;
}

function dedupeDeals(deals) {
  const byKey = new Map();
  for (const deal of deals) {
    const key = canonicalPostKey(deal.url) || `${normalizeAscii(deal.brand)}|${normalizeAscii(deal.title)}`;
    const existing = byKey.get(key);
    if (!existing || (deal.qualityScore || 0) > (existing.qualityScore || 0)) {
      byKey.set(key, deal);
    }
  }
  return [...byKey.values()]
    .sort((left, right) => (right.qualityScore || 0) - (left.qualityScore || 0))
    .slice(0, CONFIG.maxDeals);
}

function buildAiPrompt(candidates) {
  return candidates.map((candidate, index) => ({
    index,
    url: candidate.url,
    heuristicScore: candidate.score,
    evidence: cleanText(candidateSignal(candidate), 1800),
    pubDate: parsePubDate(candidate)?.date?.toISOString() || '',
  }));
}

function coerceAiType(value) {
  const text = stripFreeFromClaims(normalizeAscii(value));
  if (text.includes('gratis') || text.includes('free')) return 'gratis';
  if (text.includes('bogo') || text.includes('1+1')) return 'bogo';
  if (text.includes('gutschein') || text.includes('coupon') || text.includes('voucher')) return 'gutschein';
  return 'rabatt';
}

function mergeAiDeal(candidate, aiRow) {
  const signal = candidateSignal(candidate);
  const primarySignal = postSignal(candidate) || signal;
  const confidence = Math.max(0, Math.min(1, Number(aiRow.confidence) || 0));
  if (!aiRow.accept || confidence < 0.58) {
    candidate.rejectionReason = cleanText(aiRow.reason, 180) || 'LLM hat Kandidat abgelehnt';
    return null;
  }
  if (hasPattern(BLOCKED_SOURCE_PATTERNS, signal)) {
    candidate.rejectionReason = 'NeoTaste blockiert';
    return null;
  }

  const type = coerceAiType(aiRow.type || inferType(signal));
  const brand = cleanText(aiRow.brand, 80) || inferBrand(candidate, signal);
  const category = normalizeCategoryForScraper(aiRow.category || '', [brand, aiRow.title, aiRow.description, primarySignal]);
  const pubDate = parsePubDate(candidate);
  if (!pubDate?.date) {
    candidate.rejectionReason = 'kein echtes Instagram-Postdatum';
    return null;
  }
  const dateSignal = offerDateSignal(candidate) || primarySignal;
  const offerTiming = evaluateInstagramOfferTiming({
    signal: dateSignal,
    pubDate: pubDate.date,
    maxAgeDays: CONFIG.maxAgeDays,
    activeOfferMaxAgeDays: CONFIG.activeOfferMaxAgeDays,
    futureSkewMinutes: CONFIG.publicationFutureSkewMinutes,
  });
  if (offerTiming.futurePublication) {
    candidate.rejectionReason = 'Instagram-Postdatum liegt unplausibel in der Zukunft';
    return null;
  }
  if (offerTiming.explicitExpired) {
    candidate.rejectionReason = 'explizites Aktionsende liegt in der Vergangenheit';
    return null;
  }
  if (offerTiming.yesterdayOnly) {
    candidate.rejectionReason = 'Aktion galt ausdruecklich nur gestern';
    return null;
  }
  if (offerTiming.notStarted) {
    candidate.rejectionReason = 'expliziter Aktionszeitraum hat noch nicht begonnen';
    return null;
  }
  if (hasExpiredRelativeOfferDate(dateSignal, pubDate.date)) {
    candidate.rejectionReason = 'relative Kurz-Aktion ist abgelaufen';
    return null;
  }
  if (!offerTiming.eligibleByAge) {
    candidate.rejectionReason = offerTiming.ageDays > CONFIG.activeOfferMaxAgeDays
      ? `Instagram-Post aelter als ${CONFIG.activeOfferMaxAgeDays} Tage`
      : `Instagram-Post aelter als ${CONFIG.maxAgeDays} Tage ohne belegte laufende Aktion`;
    return null;
  }
  const score = Math.max(candidate.score, Math.round(confidence * 100));
  const timingEvidence = offerTimingEvidence(offerTiming);
  const rawDeal = {
    id: `instagram-ai-${stableHash(`${candidate.url}|${aiRow.title || brand}`)}`,
    brand,
    logo: 'IG',
    title: cleanText(aiRow.title, 110) || buildOfferTitle(brand, type, signal, candidate),
    description: cleanText(aiRow.description, 520) || cleanText(`${unicodeSafeTruncate(signal, 360)} Quelle: Instagram/Public Search.`, 520),
    type,
    category,
    source: 'Instagram AI Agent',
    originSource: 'instagram-ai-agent',
    url: candidate.url,
    expires: cleanText(aiRow.expires, 90) || extractExpiryText(dateSignal || signal, pubDate?.date || null),
    expiryKind: timingEvidence.kind,
    expiryDisplayText: timingEvidence.matchedText,
    validFrom: timingEvidence.validFrom.slice(0, 10),
    validUntil: timingEvidence.validUntil.slice(0, 10),
    dateConfidence: timingEvidence.kind ? 'high' : '',
    distance: 'Wien',
    hot: type === 'gratis' || type === 'bogo',
    isNew: true,
    priority: score >= 80 ? 5 : 4,
    votes: score >= 80 ? 3 : 2,
    qualityScore: score,
    pubDate: pubDate.date.toISOString(),
    pubDateSource: pubDate.source,
    evidence: {
      heuristicScore: candidate.score,
      heuristicReasons: candidate.reasons,
      aiReason: cleanText(aiRow.reason, 220),
      source: candidate.source,
      query: candidate.query,
      previewStatus: candidate.preview?.status || null,
      previewLoginWall: Boolean(candidate.preview?.loginWall),
      postDateSource: pubDate.source,
      offerDateSignal: cleanText(dateSignal, 4000),
      offerTiming: timingEvidence,
      textSample: cleanText(signal, 500),
    },
    confidence,
    reviewTier: confidence >= 0.82 ? 'high' : 'review',
  };

  const deal = normalizeDealRecord(rawDeal);
  if (isExpiredDealRecord(deal) || isFalsePositiveFreeDeal(deal)) {
    candidate.rejectionReason = 'Normalisierung/Validity-Filter blockiert LLM-Deal';
    return null;
  }
  return deal;
}

async function classifyWithOpenAi(candidates) {
  if (candidates.length === 0) return { deals: [], errors: [] };
  if (!CONFIG.aiEnabled) return { deals: [], errors: ['LLM deaktiviert'] };
  if (!process.env.OPENAI_API_KEY) return { deals: [], errors: ['OPENAI_API_KEY fehlt'] };

  const payload = buildAiPrompt(candidates);
  const body = {
    model: CONFIG.model,
    temperature: 0.1,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'instagram_deal_classification',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            deals: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  index: { type: 'integer' },
                  accept: { type: 'boolean' },
                  confidence: { type: 'number' },
                  brand: { type: 'string' },
                  title: { type: 'string' },
                  description: { type: 'string' },
                  type: { type: 'string', enum: ['gratis', 'bogo', 'gutschein', 'rabatt'] },
                  category: { type: 'string' },
                  expires: { type: 'string' },
                  reason: { type: 'string' },
                },
                required: ['index', 'accept', 'confidence', 'brand', 'title', 'description', 'type', 'category', 'expires', 'reason'],
              },
            },
          },
          required: ['deals'],
        },
      },
    },
    messages: [
      {
        role: 'system',
        content: [
          'You classify public Instagram/search snippets for FreeFinder Wien.',
          'Accept only concrete current deals in Vienna: free items, 1+1/BOGO, food/drink promos, vouchers, opening offers, or similar.',
          'Reject ordinary posts older than 7 days. An older post may be accepted only up to 45 days when its text proves a currently active explicit offer period/end date or a recurring weekday schedule.',
          'Reject giveaways, free shipping, generic guides, expired offers, non-Vienna offers, and vague brand marketing.',
          'Use only the supplied evidence. Do not invent dates, prices, brands, or locations.',
        ].join(' '),
      },
      {
        role: 'user',
        content: JSON.stringify({ candidates: payload }, null, 2),
      },
    ],
  };

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`OpenAI HTTP ${response.status}: ${unicodeSafeTruncate(text, 260)}`);
    const parsed = JSON.parse(text);
    const content = parsed.choices?.[0]?.message?.content || '{}';
    const classified = JSON.parse(content);
    const deals = [];
    for (const row of classified.deals || []) {
      const candidate = candidates[row.index];
      if (!candidate) continue;
      const deal = mergeAiDeal(candidate, row);
      if (deal) deals.push(deal);
    }
    return { deals, errors: [] };
  } catch (error) {
    return { deals: [], errors: [error.message] };
  }
}

function rejectionCounts(candidates) {
  const counts = {};
  for (const candidate of candidates) {
    if (!candidate.rejectionReason) continue;
    counts[candidate.rejectionReason] = (counts[candidate.rejectionReason] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function summarizeCandidate(candidate) {
  const pubDate = parsePubDate(candidate);
  return {
    url: candidate.url,
    score: candidate.score,
    source: candidate.source,
    reason: candidate.rejectionReason || '',
    reasons: candidate.reasons,
    pubDate: pubDate?.date?.toISOString() || '',
    ageDays: pubDate?.date ? ageDays(pubDate.date) : null,
    ageDaysExact: pubDate?.date ? Number(ageDaysExact(pubDate.date).toFixed(2)) : null,
    postDateSource: pubDate?.source || '',
    title: cleanText(candidate.preview?.title || candidate.title || candidate.sourceDeal?.title || '', 180),
    textSample: cleanText(postSignal(candidate) || candidateSignal(candidate), 360),
  };
}

function freshRejectedCandidates(candidates) {
  return candidates
    .filter((candidate) => candidate.rejectionReason)
    .map(summarizeCandidate)
    .filter((candidate) => typeof candidate.ageDaysExact === 'number' && candidate.ageDaysExact <= CONFIG.maxAgeDays)
    .sort((left, right) => (right.score || 0) - (left.score || 0))
    .slice(0, 40);
}

function sourcePriority(candidate) {
  const source = candidate.source || '';
  if (source.includes('seed-url')) return 0;
  if (source.startsWith('profile:')) return 1;
  if (source.includes('duckduckgo')) return 2;
  if (source.includes('instagram')) return 3;
  return 3;
}

function compareBigIntDesc(left, right) {
  if (left > right) return -1;
  if (left < right) return 1;
  return 0;
}

function rankCandidatesForScan(candidates) {
  return [...candidates].sort((left, right) => {
    const priorityDiff = sourcePriority(left) - sourcePriority(right);
    if (priorityDiff !== 0) return priorityDiff;
    const shortcodeDiff = compareBigIntDesc(instagramShortcodeRank(left.url), instagramShortcodeRank(right.url));
    if (shortcodeDiff !== 0) return shortcodeDiff;
    return (Number(right.sourceDeal?.qualityScore) || 0) - (Number(left.sourceDeal?.qualityScore) || 0);
  });
}

async function discoverCandidates(accounts) {
  const map = new Map();
  const stats = {
    seedUrls: addSeedCandidates(map),
    existingCandidates: 0,
    profileDiscovery: {
      accountsVisited: 0,
      discovered: 0,
      blocked: 0,
      noPostLinks: 0,
      errors: [],
    },
    searchQueries: [],
    searchErrors: [],
    searchDiscovered: 0,
  };
  stats.existingCandidates = collectExistingCandidates(map);
  stats.profileDiscovery = await discoverProfileCandidates(accounts, map);

  if (!CONFIG.searchEnabled) return { candidates: rankCandidatesForScan([...map.values()]).slice(0, CONFIG.maxCandidates), stats };

  const queries = buildSearchQueries(accounts);
  stats.searchQueries = queries;
  for (const query of queries) {
    try {
      const found = await searchDuckDuckGo(query);
      for (const candidate of found) addCandidate(map, candidate);
      stats.searchDiscovered += found.length;
    } catch (error) {
      stats.searchErrors.push({ query, error: error.message });
    }
    await sleep(250);
  }
  return { candidates: rankCandidatesForScan([...map.values()]).slice(0, CONFIG.maxCandidates), stats };
}

async function enrichPreviews(candidates) {
  const errors = [];
  if (!CONFIG.previewFetchEnabled) return errors;

  let fetched = 0;
  for (const candidate of candidates) {
    if (fetched >= CONFIG.maxPreviewFetches) break;
    try {
      candidate.preview = await fetchInstagramPreview(candidate.url);
    } catch (error) {
      candidate.preview = { status: 0, finalUrl: candidate.url, loginWall: false, title: '', description: '', image: '', jsonLdText: '', pubDate: '' };
      errors.push({ url: candidate.url, error: error.message });
    }
    fetched += 1;
    await sleep(300);
  }
  return errors;
}

async function enrichRenderedPreviews(candidates) {
  const errors = [];
  if (!CONFIG.renderFetchEnabled) return errors;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    userAgent: USER_AGENT,
    locale: 'de-AT',
    timezoneId: 'Europe/Vienna',
  });

  let fetched = 0;
  try {
    for (const candidate of candidates) {
      if (fetched >= CONFIG.maxRenderFetches) break;
      const page = await context.newPage();
      try {
        const rendered = await fetchRenderedInstagramPreview(page, candidate.url);
        candidate.preview = {
          ...(candidate.preview || {}),
          ...rendered,
          loginWall: rendered.loginWall && !rendered.description,
        };
      } catch (error) {
        errors.push({ url: candidate.url, error: error.message });
      } finally {
        await page.close();
      }
      fetched += 1;
      await sleep(250);
    }
  } finally {
    await context.close();
    await browser.close();
  }

  return errors;
}

async function main() {
  console.log('Instagram AI Agent');
  console.log('No Instagram Graph API, no cookies; using public search/preview signals.');

  const accounts = loadWatchlist();
  const { candidates, stats } = await discoverCandidates(accounts);
  console.log(`Candidates: ${candidates.length} (${stats.existingCandidates} existing, ${stats.searchDiscovered} search hits)`);

  const previewErrors = await enrichPreviews(candidates);
  const renderErrors = await enrichRenderedPreviews(candidates);
  const heuristicDeals = candidates.map(buildHeuristicDeal).filter(Boolean);

  const aiCandidates = candidates
    .filter((candidate) => !candidate.rejectionReason && candidate.score >= Math.max(40, CONFIG.minScore - 20))
    .sort((left, right) => right.score - left.score)
    .slice(0, CONFIG.aiCandidateLimit);
  const aiResult = await classifyWithOpenAi(aiCandidates);

  const preModerationDeals = dedupeDeals([...aiResult.deals, ...heuristicDeals]);
  const moderation = loadDealModeration();
  const moderationFilter = filterModeratedDeals(preModerationDeals, moderation);
  const finalDeals = moderationFilter.deals;
  const lastUpdated = new Date().toISOString();
  const payload = {
    lastUpdated,
    source: 'instagram-ai-agent',
    totalDeals: finalDeals.length,
    deals: finalDeals,
  };
  const report = {
    lastUpdated,
    config: {
      ...CONFIG,
      aiEnabled: Boolean(CONFIG.aiEnabled && process.env.OPENAI_API_KEY),
      openAiKeyPresent: Boolean(process.env.OPENAI_API_KEY),
    },
    watchlistAccounts: accounts.length,
    discoveredCandidates: candidates.length,
    acceptedDeals: finalDeals.length,
    acceptedBeforeModeration: preModerationDeals.length,
    heuristicAccepted: heuristicDeals.length,
    aiAccepted: aiResult.deals.length,
    moderation: {
      removed: moderationFilter.removed.length,
      reasons: moderationCounts(moderationFilter.removed),
      removedDeals: moderationFilter.removed.slice(0, 40),
    },
    search: {
      enabled: CONFIG.searchEnabled,
      queries: stats.searchQueries,
      discovered: stats.searchDiscovered,
      errors: stats.searchErrors,
    },
    existingCandidates: stats.existingCandidates,
    seedUrls: stats.seedUrls,
    profileDiscovery: stats.profileDiscovery,
    previewErrors,
    renderErrors,
    aiErrors: aiResult.errors,
    rejectionReasons: rejectionCounts(candidates),
    freshRejected: freshRejectedCandidates(candidates),
    rejected: candidates
      .filter((candidate) => candidate.rejectionReason)
      .slice(0, 180)
      .map(summarizeCandidate),
  };

  writeJson(OUTPUT_PATH, payload);
  writeJson(REPORT_PATH, report);
  console.log(`Wrote ${finalDeals.length} deals to ${OUTPUT_PATH}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error('instagram-ai-agent failed:', error);
    process.exit(1);
  });
}

export {
  buildHeuristicDeal,
  buildQualityScore,
  getRejectionReason,
};

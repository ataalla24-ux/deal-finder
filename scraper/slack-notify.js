import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { inspectDealUrlHealth } from './expiry-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const SENT_IDS_PATH = path.join(DOCS_DIR, 'sent-deal-ids.json');
const PENDING_ALL_PATH = path.join(DOCS_DIR, 'deals-pending-all.json');
const ENV_PATH = path.join(ROOT, '.env');

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

loadEnvFile();

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || '';
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID || '';
const VIENNA_TIME_ZONE = 'Europe/Vienna';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const CUTOFF_DATE = Date.now() - SEVEN_DAYS_MS;
const RECENT_SOCIAL_CUTOFF_DATE = CUTOFF_DATE;
const DAY_MS = 24 * 60 * 60 * 1000;
const TRUSTED_PUBDATE_SOURCES = new Set(['ldDate', 'timeDatetime', 'igScriptTimestamp', 'socialPostDate', 'profileTimeline', 'targetUrlHints']);
const SOCIAL_FRESHNESS_TIMEOUT_MS = Number(process.env.SOCIAL_FRESHNESS_TIMEOUT_MS || 8000);
const MAX_SOCIAL_FRESHNESS_CHECKS = Number(process.env.MAX_SOCIAL_FRESHNESS_CHECKS || 60);
const SOCIAL_FRESHNESS_CONCURRENCY = Math.max(1, Number(process.env.SOCIAL_FRESHNESS_CONCURRENCY || 6));
const SLACK_POST_DELAY_MS = Math.max(1000, Number(process.env.SLACK_POST_DELAY_MS || 1500));
const SLACK_MAX_DEALS_PER_MESSAGE = Math.max(1, Number(process.env.SLACK_MAX_DEALS_PER_MESSAGE || 8));
const SLACK_MAX_MESSAGE_CHARS = Math.max(2000, Number(process.env.SLACK_MAX_MESSAGE_CHARS || 12000));
const SAME_DAY_SIG_RETENTION_DAYS = Math.max(1, Number(process.env.SAME_DAY_SIG_RETENTION_DAYS || 3));
const PENDING_FILE_NAMES = String(process.env.PENDING_FILE_NAMES || '')
  .split(',')
  .map((value) => cleanText(value))
  .filter(Boolean);
const MONTH_MAP = {
  'jänner': 0, 'januar': 0, 'january': 0, 'jan': 0,
  'februar': 1, 'february': 1, 'feb': 1,
  'märz': 2, 'maerz': 2, 'march': 2, 'mar': 2, 'mär': 2,
  'april': 3, 'apr': 3,
  'mai': 4, 'may': 4,
  'juni': 5, 'june': 5, 'jun': 5,
  'juli': 6, 'july': 6, 'jul': 6,
  'august': 7, 'aug': 7,
  'september': 8, 'sep': 8, 'sept': 8,
  'oktober': 9, 'october': 9, 'okt': 9, 'oct': 9,
  'november': 10, 'nov': 10,
  'dezember': 11, 'december': 11, 'dez': 11, 'dec': 11,
};

function ensureObject(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value) {
  if (!value) return '';
  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function isStrictRecentSocialDeal(deal) {
  const source = cleanText(deal?.source).toLowerCase();
  return source.includes('firecrawl gastro #2') ||
    source.includes('firecrawl food #3') ||
    source.includes('firecrawl consumables') ||
    source.includes('firecrawl instagram direct #4') ||
    source.includes('firecrawl instagram gastro #5');
}

function isViennaDeal(deal) {
  const haystack = [
    deal?.distance,
    deal?.location,
    deal?.ort,
    deal?.description,
    deal?.title,
    deal?.brand,
  ]
    .map(cleanText)
    .join(' ')
    .toLowerCase();

  return haystack.includes('wien') || haystack.includes('vienna') || /\b1\d{3}\b/.test(haystack);
}

function normalizeUrl(url) {
  const text = cleanText(url);
  if (!text) return '';
  if (!/^https?:\/\//i.test(text)) return '';
  return text;
}

function stableDealSignature(deal) {
  const normalizedUrl = normalizeUrl(deal?.url)
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
  const title = cleanText(deal?.title)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const brand = cleanText(deal?.brand)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const type = cleanText(deal?.type).toLowerCase();
  const distance = cleanText(deal?.distance || deal?.location || deal?.ort)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return [normalizedUrl, brand, title, type, distance].filter(Boolean).join('|');
}

function alternateDealSignature(deal) {
  const title = cleanText(deal?.title)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const brand = cleanText(deal?.brand)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const type = cleanText(deal?.type).toLowerCase();
  const distance = cleanText(deal?.distance || deal?.location || deal?.ort)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return [brand, title, type, distance].filter(Boolean).join('|');
}

function getDealSignatureVariants(deal) {
  return [stableDealSignature(deal), alternateDealSignature(deal)].filter(Boolean);
}

function toIsoDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString();
}

function inferBrand(deal, sourceKey) {
  const brand = cleanText(deal.brand);
  if (brand) return brand;
  const title = cleanText(deal.title);
  if (title.includes(' - ')) return title.split(' - ')[0].trim();
  if (title.includes(':')) return title.split(':')[0].trim();
  return sourceKey;
}

function inferTitle(deal, brand) {
  const title = cleanText(deal.title);
  if (title) return title;
  const desc = cleanText(deal.description);
  if (desc) return desc.slice(0, 80);
  return `${brand} Deal`;
}

function inferType(deal) {
  const t = cleanText(deal.type).toLowerCase();
  if (['gratis', 'rabatt', 'testabo', 'bogo'].includes(t)) return t;
  return 'rabatt';
}

function inferCategory(deal) {
  const c = cleanText(deal.category).toLowerCase();
  return c || 'wien';
}

function inferLogo(deal, type) {
  const logo = cleanText(deal.logo);
  if (logo) return logo;
  if (type === 'gratis') return '🎁';
  return '🎯';
}

function inferDistance(deal) {
  const distance = cleanText(deal.distance || deal.location || deal.ort);
  return distance || 'Wien';
}

function inferExpires(deal) {
  const raw = deal.expires || deal.end_date || deal.validity_date || '';
  const iso = toIsoDate(raw);
  return iso || cleanText(raw) || '';
}

function parseLooseExpiry(text) {
  const value = cleanText(text);
  if (!value) return null;
  const lower = value.toLowerCase();

  if (
    lower.includes('unknown') ||
    lower.includes('unbekannt') ||
    lower.includes('ongoing') ||
    lower.includes('laufend') ||
    lower.includes('siehe') ||
    lower.includes('website') ||
    lower.includes('webseite')
  ) {
    return null;
  }

  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) return direct.getTime();

  const matchYmd = value.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (matchYmd) {
    const ts = Date.parse(`${matchYmd[1]}-${matchYmd[2]}-${matchYmd[3]}T23:59:59`);
    if (!Number.isNaN(ts)) return ts;
  }

  const matchDmy = value.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (matchDmy) {
    const yyyy = matchDmy[3].length === 2 ? `20${matchDmy[3]}` : matchDmy[3];
    const mm = String(matchDmy[2]).padStart(2, '0');
    const dd = String(matchDmy[1]).padStart(2, '0');
    const ts = Date.parse(`${yyyy}-${mm}-${dd}T23:59:59`);
    if (!Number.isNaN(ts)) return ts;
  }

  return null;
}

function extractRelativeAgeDays(text) {
  const t = cleanText(text).toLowerCase();
  if (!t) return null;
  const m = t.match(/(\d+)\s*(weeks?|wochen|days?|tage|months?|monate|years?|jahre?n?|y|w|d|m)\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 0) return null;
  const unit = m[2].toLowerCase();
  if (unit.startsWith('w') || unit.includes('woch')) return n * 7;
  if (unit.startsWith('d') || unit.includes('tag')) return n;
  if (unit.startsWith('m') || unit.includes('monat')) return n * 30;
  if (unit.startsWith('y') || unit.includes('jahr') || unit.includes('year')) return n * 365;
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

function parseNamedDateCandidatesFromText(text, now = new Date()) {
  const t = cleanText(text);
  if (!t) return [];
  const out = [];
  const monthPattern = '(j[aä]nner|januar|februar|m[aä]rz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember|january|february|march|april|may|june|july|august|september|october|november|december)';

  const dayMonthYearRegex = new RegExp(`\\b(\\d{1,2})\\.?\\s+${monthPattern}\\s*(\\d{4})?\\b`, 'gi');
  for (const match of t.matchAll(dayMonthYearRegex)) {
    const day = Number(match[1]);
    const month = MONTH_MAP[String(match[2] || '').toLowerCase()];
    const year = match[3] ? Number(match[3]) : now.getUTCFullYear();
    if (month === undefined || !Number.isFinite(day) || !Number.isFinite(year)) continue;
    const date = new Date(Date.UTC(year, month, day, 12, 0, 0));
    if (!Number.isNaN(date.getTime())) out.push(date.getTime());
  }

  const monthDayYearRegex = new RegExp(`\\b${monthPattern}\\s+(\\d{1,2}),?\\s*(\\d{4})?\\b`, 'gi');
  for (const match of t.matchAll(monthDayYearRegex)) {
    const month = MONTH_MAP[String(match[1] || '').toLowerCase()];
    const day = Number(match[2]);
    const year = match[3] ? Number(match[3]) : now.getUTCFullYear();
    if (month === undefined || !Number.isFinite(day) || !Number.isFinite(year)) continue;
    const date = new Date(Date.UTC(year, month, day, 12, 0, 0));
    if (!Number.isNaN(date.getTime())) out.push(date.getTime());
  }

  return out;
}

function parseAnchoredPostDateCandidatesFromText(text, now = new Date()) {
  const t = cleanText(text);
  if (!t) return [];
  const out = [];
  const monthPattern = '(j[aä]nner|januar|februar|m[aä]rz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember|january|february|march|april|may|june|july|august|september|october|november|december)';

  const anchoredNamedRegex = new RegExp(`\\b(?:on|am|posted\\s+on)\\s+(${monthPattern}\\s+\\d{1,2},?\\s*\\d{4}|\\d{1,2}\\.?\\s+${monthPattern}\\s*\\d{4})\\b`, 'gi');
  for (const match of t.matchAll(anchoredNamedRegex)) {
    const candidates = parseNamedDateCandidatesFromText(match[1], now);
    for (const ts of candidates) out.push(ts);
  }

  const anchoredNumericRegex = /\b(?:on|am|posted\s+on)\s+(\d{1,2}\.\d{1,2}\.\d{2,4})\b/gi;
  for (const match of t.matchAll(anchoredNumericRegex)) {
    const candidates = parseDateCandidatesFromText(match[1]);
    for (const ts of candidates) out.push(ts);
  }

  return out;
}

function isSocialUrl(url) {
  return /https?:\/\/(?:www\.)?(instagram|tiktok)\.com\//i.test(cleanText(url));
}

function extractSocialHintTimestamp(text, nowMs = Date.now()) {
  const now = new Date(nowMs);
  const anchoredDates = parseAnchoredPostDateCandidatesFromText(text, now)
    .filter((ts) => Number.isFinite(ts) && ts <= nowMs + DAY_MS);
  if (anchoredDates.length > 0) return Math.max(...anchoredDates);

  const directDates = parseDateCandidatesFromText(text);
  const namedDates = parseNamedDateCandidatesFromText(text, now);
  const explicitDates = [...directDates, ...namedDates]
    .filter((ts) => Number.isFinite(ts) && ts <= nowMs + DAY_MS);
  if (explicitDates.length > 0) return Math.max(...explicitDates);

  const ageDays = extractRelativeAgeDays(text);
  if (Number.isFinite(ageDays)) return nowMs - (ageDays * DAY_MS);

  return null;
}

function getEffectivePubTimestamp(deal) {
  const verified = Date.parse(cleanText(deal?.verifiedTargetPubDate || ''));
  if (Number.isFinite(verified)) return verified;
  return Date.parse(cleanText(deal?.pubDate || ''));
}

async function enrichSocialFreshness(deals) {
  const candidates = deals
    .filter((deal) => isSocialUrl(deal?.url))
    .slice(0, MAX_SOCIAL_FRESHNESS_CHECKS);

  const stats = {
    candidates: candidates.length,
    checked: 0,
    verifiedFromTargetUrl: 0,
    noUsableTargetDate: 0,
    invalidUrl: 0,
    transientErrors: 0,
  };

  for (let i = 0; i < candidates.length; i += SOCIAL_FRESHNESS_CONCURRENCY) {
    const batch = candidates.slice(i, i + SOCIAL_FRESHNESS_CONCURRENCY);
    await Promise.all(batch.map(async (deal) => {
      stats.checked += 1;
      const health = await inspectDealUrlHealth(deal.url, { timeoutMs: SOCIAL_FRESHNESS_TIMEOUT_MS });
      if (health?.invalid) {
        stats.invalidUrl += 1;
        return;
      }
      if (health?.transientError) {
        stats.transientErrors += 1;
        return;
      }

      const hintText = [
        health?.contentHints?.description,
        health?.contentHints?.title,
      ].map(cleanText).filter(Boolean).join(' ');

      const derivedTs = extractSocialHintTimestamp(hintText, Date.now());
      if (!Number.isFinite(derivedTs)) {
        stats.noUsableTargetDate += 1;
        return;
      }

      deal.verifiedTargetPubDate = new Date(derivedTs).toISOString();
      deal.verifiedTargetPubDateSource = 'targetUrlHints';
      stats.verifiedFromTargetUrl += 1;
    }));
  }

  return stats;
}

function stableId(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

function getViennaDayKey(value = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: VIENNA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));

  const year = parts.find((part) => part.type === 'year')?.value || '0000';
  const month = parts.find((part) => part.type === 'month')?.value || '00';
  const day = parts.find((part) => part.type === 'day')?.value || '00';
  return `${year}-${month}-${day}`;
}

function getPostingKeys(deal) {
  const keys = new Set(getDealSignatureVariants(deal));
  const id = cleanText(deal?.id);
  const url = normalizeUrl(deal?.url);
  if (id) keys.add(`id:${id}`);
  if (url) keys.add(`url:${url.toLowerCase()}`);
  return [...keys];
}

function getDigestFingerprint(deals) {
  const keys = deals
    .flatMap((deal) => getPostingKeys(deal))
    .filter(Boolean)
    .sort();
  return stableId(keys.join('||'));
}

function normalizeDeal(rawDeal, sourceKey) {
  const deal = ensureObject(rawDeal);
  const brand = inferBrand(deal, sourceKey);
  const title = inferTitle(deal, brand);
  const rawUrl = normalizeUrl(deal.url);
  const rawDistance = cleanText(deal.distance || deal.location || deal.ort);
  const rawExpires = cleanText(deal.expires || deal.end_date || deal.validity_date || '');
  const rawSource = cleanText(deal.source);
  const originSource = cleanText(deal.originSource) || rawSource || sourceKey;
  const url = rawUrl;
  const pubDate = toIsoDate(deal.pubDate);
  const pubDateSource = cleanText(deal.pubDateSource);
  const idSeed = `${sourceKey}|${deal.id || ''}|${url}|${title}`;
  const id = cleanText(deal.id) || `${sourceKey}-${stableId(idSeed)}`;
  const type = inferType(deal);
  const missingFields = [];
  if (!rawUrl) missingFields.push('Ziel-URL');
  if (!rawDistance) missingFields.push('Ort');
  if (!rawExpires) missingFields.push('Ablauf');
  if (!rawSource) missingFields.push('Quelle');

  return {
    id,
    submissionId: cleanText(deal.submissionId).replace(/^community:/, ''),
    brand,
    title,
    description: cleanText(deal.description),
    url,
    category: inferCategory(deal),
    type,
    logo: inferLogo(deal, type),
    distance: inferDistance(deal),
    pubDate,
    pubDateSource,
    expires: inferExpires(deal),
    source: cleanText(deal.source) || sourceKey,
    originSource,
    qualityScore: Number(deal.qualityScore) || 0,
    hot: Boolean(deal.hot),
    isNew: true,
    votes: Number(deal.votes) || 1,
    priority: Number(deal.priority) || 3,
    missingFields,
    slackTs: cleanText(deal.slackTs),
    slackThreadTs: cleanText(deal.slackThreadTs),
  };
}

function getPendingFiles() {
  return fs.readdirSync(DOCS_DIR).filter((file) => {
    if (!file.startsWith('deals-pending-') || !file.endsWith('.json')) return false;
    if (file === 'deals-pending-all.json') return false;
    return true;
  });
}

function loadPendingDeals() {
  const files = getPendingFiles();
  const deals = [];
  console.log(`📂 Found ${files.length} pending deal files`);

  for (const file of files) {
    const sourceKey = file.replace(/^deals-pending-/, '').replace(/\.json$/, '');
    const filePath = path.join(DOCS_DIR, file);
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const items = ensureArray(parsed.deals || parsed);
      const normalized = items.map((d) => normalizeDeal(d, sourceKey));
      console.log(`  - ${file}: ${normalized.length} deals`);
      deals.push(...normalized);
    } catch (error) {
      console.log(`  ⚠️ Error reading ${file}: ${error.message}`);
    }
  }

  return deals;
}

function loadSentIds() {
  if (!fs.existsSync(SENT_IDS_PATH)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(SENT_IDS_PATH, 'utf-8'));
    return ensureObject(parsed);
  } catch {
    return {};
  }
}

function saveSentIds(sentIds) {
  fs.writeFileSync(SENT_IDS_PATH, JSON.stringify(sentIds, null, 2));
}

function loadPendingQueue() {
  if (!fs.existsSync(PENDING_ALL_PATH)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(PENDING_ALL_PATH, 'utf-8'));
    const deals = ensureArray(parsed.deals);
    return deals.map((d) => normalizeDeal(d, cleanText(d.source) || 'queue'));
  } catch {
    return [];
  }
}

function buildSeenSignatureMap(sentIds, pendingQueue) {
  const seen = new Map();

  for (const [key, value] of Object.entries(sentIds)) {
    if (key.startsWith('sig:')) {
      seen.set(key.slice(4), Number(value) || Date.now());
    }
  }

  for (const deal of pendingQueue) {
    if (!deal?.slackTs) continue;
    const postedAt = deal.slackTs ? Number.parseFloat(deal.slackTs) * 1000 : Date.now();
    for (const signature of getDealSignatureVariants(deal)) {
      seen.set(signature, Number.isFinite(postedAt) ? postedAt : Date.now());
    }
  }

  return seen;
}

function buildPostedTodaySignatureSet(sentIds, pendingQueue, dayKey) {
  const posted = new Set();
  const prefix = `daySig:${dayKey}:`;

  for (const key of Object.keys(sentIds)) {
    if (key.startsWith(prefix)) posted.add(key.slice(prefix.length));
  }

  for (const deal of pendingQueue) {
    const slackTs = Number.parseFloat(cleanText(deal?.slackTs));
    if (!Number.isFinite(slackTs)) continue;
    const postedAtMs = slackTs * 1000;
    if (getViennaDayKey(postedAtMs) !== dayKey) continue;
    for (const key of getPostingKeys(deal)) posted.add(key);
  }

  return posted;
}

function filterDealsForSlack(deals, postedTodayKeys) {
  const seen = new Set(postedTodayKeys);
  const kept = [];
  let skippedSameDay = 0;

  for (const deal of deals) {
    const postingKeys = getPostingKeys(deal);
    if (postingKeys.length > 0 && postingKeys.some((key) => seen.has(key))) {
      skippedSameDay += 1;
      continue;
    }

    for (const key of postingKeys) seen.add(key);
    kept.push(deal);
  }

  return { kept, skippedSameDay };
}

function pruneSentIds(sentIds) {
  const cutoffDay = getViennaDayKey(Date.now() - (SAME_DAY_SIG_RETENTION_DAYS * DAY_MS));
  for (const key of Object.keys(sentIds)) {
    if (!key.startsWith('daySig:')) continue;
    const [, dayKey] = key.split(':');
    if (dayKey && dayKey < cutoffDay) delete sentIds[key];
  }
}

function markDealsPosted(sentIds, deals, dayKey, postedAtMs) {
  for (const deal of deals) {
    for (const key of getPostingKeys(deal)) {
      sentIds[`sig:${key}`] = postedAtMs;
      sentIds[`daySig:${dayKey}:${key}`] = postedAtMs;
    }
  }
}

function isRecent(deal) {
  const pubMs = getEffectivePubTimestamp(deal);
  if (!Number.isFinite(pubMs)) return false;
  if (isStrictRecentSocialDeal(deal)) return pubMs >= RECENT_SOCIAL_CUTOFF_DATE;
  return pubMs >= CUTOFF_DATE;
}

function isNeoTasteDeal(deal) {
  const haystack = [
    deal?.brand,
    deal?.title,
    deal?.description,
    deal?.url,
    deal?.source,
    deal?.originSource,
    deal?.distance,
    deal?.expires,
  ]
    .map(cleanText)
    .join(' ')
    .toLowerCase();

  return haystack.includes('neotaste');
}

function hasTrustedInstagramDate(deal) {
  if (cleanText(deal?.verifiedTargetPubDateSource) === 'targetUrlHints') return true;
  const source = cleanText(deal.source).toLowerCase();
  if (isStrictRecentSocialDeal(deal)) return true;
  if (!source.includes('instagram')) return true;
  return TRUSTED_PUBDATE_SOURCES.has(cleanText(deal.pubDateSource));
}

function isNotExpired(deal) {
  if (isStrictRecentSocialDeal(deal)) return true;
  const expiryMs = parseLooseExpiry(deal.expires);
  if (!expiryMs) return true;
  return expiryMs + DAY_MS >= Date.now();
}

function hasOldAgeSignal(deal) {
  if (cleanText(deal?.verifiedTargetPubDateSource) === 'targetUrlHints') return false;
  if (isStrictRecentSocialDeal(deal)) return false;
  const haystack = `${deal.title || ''} ${deal.description || ''} ${deal.expires || ''}`;
  const ageDays = extractRelativeAgeDays(haystack);
  if (!Number.isFinite(ageDays)) return false;
  return ageDays > 7;
}

function hasStaleExplicitDateSignal(deal) {
  if (cleanText(deal?.verifiedTargetPubDateSource) === 'targetUrlHints') return false;
  if (isStrictRecentSocialDeal(deal)) return false;
  const bundle = `${deal.title || ''} ${deal.description || ''} ${deal.expires || ''}`;
  const dates = parseDateCandidatesFromText(bundle);
  if (dates.length === 0) return false;
  const newest = Math.max(...dates);
  return newest < CUTOFF_DATE;
}

function formatDate(value) {
  if (!value) return 'k.A.';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('de-AT');
}

function buildSlackMessage(deal, index) {
  const link = deal.url ? `<${deal.url}|Zum Angebot>` : '⚠️ FEHLT';
  const desc = deal.description ? `\n📝 ${deal.description.slice(0, 180)}` : '';
  const missingNote = Array.isArray(deal.missingFields) && deal.missingFields.length > 0
    ? `\n⚠️ FEHLT: ${deal.missingFields.join(', ')}`
    : '';
  return [
    `*${index}. ${deal.title}*`,
    `🏷️ Marke/Restaurant: ${deal.brand || 'k.A.'}`,
    `📍 Ort: ${deal.distance || 'Wien'}`,
    `📅 Angebotsdatum: ${formatDate(deal.pubDate)}`,
    `⏳ Gültig bis: ${deal.expires ? formatDate(deal.expires) : 'k.A.'}`,
    `🧭 Kategorie: ${deal.category} | Typ: ${deal.type}`,
    `🧩 Ursprung intern: ${deal.originSource || deal.source || 'k.A.'}`,
    `🔗 Direktlink: ${link}`,
    `🆔 Deal-ID: ${deal.id}`,
    missingNote,
    desc,
    '_Mit ✅ freigeben_',
  ].join('\n');
}

function buildSlackChunkMessages(deals) {
  const chunks = [];
  let currentEntries = [];
  let currentDeals = [];
  let currentLength = 0;
  let currentStartIndex = 0;

  for (let i = 0; i < deals.length; i += 1) {
    const entry = buildSlackMessage(deals[i], i + 1);
    const projectedStart = currentDeals.length === 0 ? i + 1 : currentStartIndex + 1;
    const projectedEnd = currentDeals.length === 0 ? i + 1 : i + 1;
    const chunkHeader = `*Deals ${projectedStart}-${projectedEnd} von ${deals.length}*`;
    const separatorLength = currentEntries.length === 0 ? 0 : 2;
    const estimatedLength = chunkHeader.length + 2 + currentLength + separatorLength + entry.length;

    if (
      currentEntries.length > 0 &&
      (currentEntries.length >= SLACK_MAX_DEALS_PER_MESSAGE || estimatedLength > SLACK_MAX_MESSAGE_CHARS)
    ) {
      chunks.push({
        entries: currentEntries,
        deals: currentDeals,
        startIndex: currentStartIndex,
      });
      currentEntries = [];
      currentDeals = [];
      currentLength = 0;
    }

    if (currentDeals.length === 0) currentStartIndex = i;
    currentEntries.push(entry);
    currentDeals.push(deals[i]);
    currentLength += entry.length + (currentEntries.length > 1 ? 2 : 0);
  }

  if (currentEntries.length > 0) {
    chunks.push({
      entries: currentEntries,
      deals: currentDeals,
      startIndex: currentStartIndex,
    });
  }
  return chunks;
}

function buildSlackChunkText(chunk, chunkIndex, totalChunks, totalDeals) {
  const start = chunk.startIndex + 1;
  const end = start + chunk.entries.length - 1;
  return [
    `*Deals ${start}-${end} von ${totalDeals}*`,
    `_Teil ${chunkIndex + 1}/${totalChunks}_`,
    chunk.entries.join('\n\n'),
  ].join('\n\n');
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function postSlackMessage(text, threadTs = null, attempt = 0) {
  const payload = { channel: SLACK_CHANNEL_ID, text };
  if (threadTs) payload.thread_ts = threadTs;

  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (response.status === 429 && attempt < 8) {
    const retryMs = (Number(response.headers.get('retry-after')) || 2) * 1000;
    console.log(`  ⏳ HTTP 429 from Slack, waiting ${retryMs}ms...`);
    await sleep(retryMs + 250);
    return postSlackMessage(text, threadTs, attempt + 1);
  }

  const raw = await response.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { ok: false, error: raw || `http_${response.status}` };
  }

  if (data.ok) return data.ts;

  if (data.error === 'ratelimited' && attempt < 8) {
    const retryMs = (Number(data.retry_after) || 2) * 1000;
    console.log(`  ⏳ Rate limited, waiting ${retryMs}ms...`);
    await sleep(retryMs + 250);
    return postSlackMessage(text, threadTs, attempt + 1);
  }

  console.log(`❌ Slack post failed: ${data.error || 'unknown_error'}`);
  return null;
}

function writePendingAll(deals) {
  const payload = {
    deals,
    totalDeals: deals.length,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(PENDING_ALL_PATH, JSON.stringify(payload, null, 2));
}

function queueKey(deal) {
  return cleanText(deal.id) || normalizeUrl(deal.url) || cleanText(deal.slackTs);
}

function mergePendingQueue(existingDeals, newPostedDeals) {
  const byKey = new Map();
  for (const deal of existingDeals) {
    const key = queueKey(deal);
    if (!key) continue;
    byKey.set(key, deal);
  }
  for (const deal of newPostedDeals) {
    const key = queueKey(deal);
    if (!key) continue;
    byKey.set(key, deal);
  }
  return [...byKey.values()];
}

async function main() {
  console.log('📱 SLACK NOTIFY - APPROVAL PIPELINE');
  console.log('========================================');

  if (!SLACK_BOT_TOKEN || !SLACK_CHANNEL_ID) {
    console.log('❌ SLACK_BOT_TOKEN oder SLACK_CHANNEL_ID fehlt (ENV oder .env)');
    process.exit(1);
  }

  const pendingDeals = loadPendingDeals();
  const sentIds = loadSentIds();
  console.log(`📋 Total pending deals loaded: ${pendingDeals.length}`);

  const existingQueue = loadPendingQueue();
  const dayKey = getViennaDayKey();

  pendingDeals.sort((a, b) => {
    if ((b.qualityScore || 0) !== (a.qualityScore || 0)) {
      return (b.qualityScore || 0) - (a.qualityScore || 0);
    }
    return new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime();
  });

  const postedTodayKeys = buildPostedTodaySignatureSet(sentIds, existingQueue, dayKey);
  const { kept: dealsToPost, skippedSameDay } = filterDealsForSlack(pendingDeals, postedTodayKeys);
  const digestFingerprint = getDigestFingerprint(dealsToPost);

  console.log(`📨 Pending: ${pendingDeals.length}, toPost: ${dealsToPost.length}, skippedSameDay: ${skippedSameDay}`);

  if (dealsToPost.length === 0) {
    console.log('✅ Keine neuen Deals für Slack');
    return;
  }

  if (
    cleanText(sentIds['meta:lastDigestDay']) === dayKey &&
    cleanText(sentIds['meta:lastDigestFingerprint']) === digestFingerprint
  ) {
    console.log('✅ Identischer Digest wurde heute bereits an Slack gesendet');
    return;
  }

  const chunks = buildSlackChunkMessages(dealsToPost);
  const freeCount = dealsToPost.filter((d) => d.type === 'gratis').length;
  const headerTs = await postSlackMessage(
    `🎯 *FreeFinder Wien* — ${dealsToPost.length} Pending-Deals aus allen Scrapern\n` +
    `🆓 ${freeCount} gratis | 💰 ${dealsToPost.length - freeCount} rabatt/test\n` +
    `🧵 ${Math.max(1, chunks.length)} Thread-Blöcke\n` +
    `_Ungefilterter Slack-Durchlauf ohne Seen-/Freshness-Blocker. Slack-Dedupe nur für gleiche Deals am selben Tag._`
  );

  if (!headerTs) {
    console.log('❌ Konnte Header-Nachricht nicht senden');
    process.exit(1);
  }

  const postedDeals = [];
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    const text = buildSlackChunkText(chunk, i, chunks.length, dealsToPost.length);
    const ts = await postSlackMessage(text, headerTs);
    if (!ts) continue;

    for (const deal of chunk.deals) {
      deal.slackTs = ts;
      deal.slackThreadTs = headerTs;
      postedDeals.push(deal);
    }

    console.log(`  ✅ posted chunk ${i + 1}/${chunks.length} (${postedDeals.length}/${dealsToPost.length} deals)`);
    await sleep(SLACK_POST_DELAY_MS);
  }

  const mergedQueue = mergePendingQueue(existingQueue, postedDeals);
  const postedAtMs = Date.now();
  markDealsPosted(sentIds, postedDeals, dayKey, postedAtMs);
  if (postedDeals.length === dealsToPost.length) {
    sentIds['meta:lastDigestDay'] = dayKey;
    sentIds['meta:lastDigestFingerprint'] = digestFingerprint;
    sentIds['meta:lastDigestPostedAt'] = postedAtMs;
  }
  pruneSentIds(sentIds);
  saveSentIds(sentIds);
  writePendingAll(mergedQueue);

  console.log(`✅ ${postedDeals.length} Deals an Slack gesendet`);
  console.log(`🗂️ pending queue size: ${mergedQueue.length}`);
  console.log(`💾 saved: ${path.relative(ROOT, PENDING_ALL_PATH)}`);
}

main().catch((error) => {
  console.error('❌ slack-notify failed:', error.message);
  process.exit(1);
});

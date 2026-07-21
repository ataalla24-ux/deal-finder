import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeCategoryForScraper } from './category-utils.js';
import { stripInstagramMetaDescriptionPrefix } from '../apify/instagram-vienna-food-offers/src/validity-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const OUTPUT_PATH = path.join(DOCS_DIR, 'deals-pending-instagram-apify.json');
const REPORT_PATH = path.join(DOCS_DIR, 'apify-instagram-report.json');
const DEFAULT_INPUT_PATH = path.join(ROOT, 'apify', 'instagram-vienna-food-offers', 'default-input.json');
const WATCHLIST_PATH = path.join(DOCS_DIR, 'instagram-watchlist.json');
const MERCHANT_REGISTRY_PATH = path.join(DOCS_DIR, 'instagram-merchant-registry.json');
const INSTAGRAM_AI_OUTPUT_PATH = path.join(DOCS_DIR, 'deals-pending-instagram-ai.json');
const INSTAGRAM_AI_REPORT_PATH = path.join(DOCS_DIR, 'instagram-ai-report.json');

const APIFY_TOKEN = String(process.env.APIFY_TOKEN || '').trim();
const APIFY_ACTOR_ID = String(
  process.env.APIFY_INSTAGRAM_VIENNA_ACTOR_ID ||
  process.env.APIFY_ACTOR_ID ||
  ''
).trim();
const APIFY_BASE_URL = String(process.env.APIFY_API_BASE_URL || 'https://api.apify.com/v2').replace(/\/+$/, '');
const POLL_INTERVAL_MS = Math.max(5000, Number(process.env.APIFY_POLL_INTERVAL_MS || 15000));
const RUN_TIMEOUT_MS = Math.max(120000, Number(process.env.APIFY_RUN_TIMEOUT_MS || 25 * 60 * 1000));
const APIFY_INSTAGRAM_COOKIE_STRING = String(process.env.APIFY_INSTAGRAM_COOKIE_STRING || '').trim();
const APIFY_INSTAGRAM_SESSIONID = String(process.env.APIFY_INSTAGRAM_SESSIONID || '').trim();
const MAX_POST_AGE_DAYS = Math.max(1, Number(process.env.APIFY_INSTAGRAM_MAX_POST_AGE_DAYS || 7));
const MAX_AGE_WITHOUT_EXPLICIT_VALIDITY_DAYS = Math.max(
  1,
  Number(process.env.APIFY_INSTAGRAM_MAX_AGE_WITHOUT_EXPLICIT_VALIDITY_DAYS || 3),
);
const UNKNOWN_EXPIRY_TTL_HOURS = Math.max(
  12,
  Number(process.env.APIFY_INSTAGRAM_UNKNOWN_EXPIRY_TTL_HOURS || 72),
);

const RESERVED_INSTAGRAM_PATHS = new Set([
  'p', 'reel', 'reels', 'explore', 'accounts', 'stories', 'direct', 'about', 'legal', 'privacy',
]);

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJsonIfExists(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function normalizeText(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/#[\p{L}\p{N}_]+/gu, ' ')
    .replace(/@[\p{L}\p{N}._]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (!/^https?:$/i.test(url.protocol)) return '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

export function toIso(value) {
  if (!value) return '';
  let normalized = value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    normalized = value > 1e12 ? value : value * 1000;
  } else if (/^\d{10,13}$/.test(String(value).trim())) {
    const numeric = Number(value);
    normalized = String(value).trim().length === 10 ? numeric * 1000 : numeric;
  }
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

function normalizeInstagramHandle(value) {
  const handle = String(value || '').trim().toLowerCase().replace(/^@/, '');
  if (!handle || RESERVED_INSTAGRAM_PATHS.has(handle)) return '';
  return /^[a-z0-9._]{2,40}$/.test(handle) ? handle : '';
}

function normalizePostUrl(value) {
  const url = normalizeUrl(value);
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (!/(^|\.)instagram\.com$/i.test(parsed.hostname)) return '';
    const match = parsed.pathname.match(/^\/(p|reel|reels|tv)\/([^/?#]+)\/?/i);
    if (!match) return '';
    const postType = /^reels?$/i.test(match[1]) ? 'reel' : match[1].toLowerCase();
    return `https://www.instagram.com/${postType}/${match[2]}/`;
  } catch {
    return '';
  }
}

export function collectDirectPostSeedUrls({ output = {}, report = {}, limit = 32 } = {}) {
  const rows = [
    ...(Array.isArray(output?.deals) ? output.deals : []),
    ...(Array.isArray(report?.freshRejected) ? report.freshRejected : []),
  ];
  const urls = [];
  const seen = new Set();
  for (const row of rows) {
    const url = normalizePostUrl(row?.url || row?.postUrl || row);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
    if (urls.length >= toBoundedInt(limit, 32, 1, 100)) break;
  }
  return urls;
}

function postShortcode(postUrl) {
  return postUrl.match(/^https:\/\/www\.instagram\.com\/(?:p|reel|tv)\/([^/]+)\//i)?.[1] || '';
}

export function realPostTimestamp(item) {
  const rawCandidates = [
    ['postPublishedAt', item?.postPublishedAt],
    ['sourcePublishedAt', item?.sourcePublishedAt],
    ['timestamp', item?.timestamp],
    ['takenAt', item?.takenAt],
    ['taken_at_timestamp', item?.taken_at_timestamp],
  ];
  for (const [field, raw] of rawCandidates) {
    const iso = toIso(raw);
    if (iso) return { iso, raw, source: `apify-${field}` };
  }
  return { iso: '', raw: '', source: '' };
}

function toBoundedInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function addAccount(accountMap, rawUsername, rawPriority, source, verifiedVienna = false) {
  const username = normalizeInstagramHandle(rawUsername);
  if (!username) return;
  const priority = Number.isFinite(Number(rawPriority)) ? Number(rawPriority) : 0;
  const existing = accountMap.get(username);
  if (!existing || priority > existing.priority) {
    accountMap.set(username, {
      username,
      priority,
      source,
      verifiedVienna: Boolean(verifiedVienna || existing?.verifiedVienna),
    });
  } else if (verifiedVienna && !existing.verifiedVienna) {
    accountMap.set(username, { ...existing, verifiedVienna: true });
  }
}

export function selectAccountShard({
  watchlist = {},
  registry = {},
  fallbackAccounts = [],
  shardCount = 4,
  shardIndex = 0,
  hotAccountCount = 6,
  maxAccounts = 24,
} = {}) {
  const accounts = new Map();
  for (const entry of Array.isArray(watchlist.accounts) ? watchlist.accounts : []) {
    addAccount(
      accounts,
      entry?.username,
      entry?.priority,
      'watchlist',
      entry?.viennaVerified === true || entry?.verifiedVienna === true,
    );
  }
  for (const entry of Array.isArray(registry.accounts) ? registry.accounts : []) {
    const registryPriority = Number(entry?.priorityScore || 0) + Number(entry?.confidence || 0) / 10;
    addAccount(accounts, entry?.username, registryPriority, 'registry', entry?.viennaVerified === true);
  }
  for (const username of fallbackAccounts) {
    addAccount(accounts, username, 1, 'default');
  }

  const sorted = [...accounts.values()].sort((left, right) => {
    if (right.priority !== left.priority) return right.priority - left.priority;
    return left.username.localeCompare(right.username);
  });
  const safeShardCount = toBoundedInt(shardCount, 4, 1, 24);
  const safeShardIndex = ((toBoundedInt(shardIndex, 0, 0, Number.MAX_SAFE_INTEGER) % safeShardCount) + safeShardCount) % safeShardCount;
  const safeHotCount = toBoundedInt(hotAccountCount, 6, 0, sorted.length);
  const safeMaxAccounts = toBoundedInt(maxAccounts, 24, 1, 100);
  const hot = sorted.slice(0, safeHotCount);
  const rotating = sorted
    .slice(safeHotCount)
    .filter((_, index) => index % safeShardCount === safeShardIndex);
  const selected = [...hot, ...rotating].slice(0, safeMaxAccounts);

  return {
    accounts: selected.map((entry) => entry.username),
    selected,
    totalAccounts: sorted.length,
    shardCount: safeShardCount,
    shardIndex: safeShardIndex,
    hotAccounts: hot.map((entry) => entry.username),
    verifiedAccounts: selected.filter((entry) => entry.verifiedVienna).map((entry) => entry.username),
  };
}

function computedShardIndex(now, shardCount) {
  const sixHourBucket = Math.floor(now.getTime() / (6 * 60 * 60 * 1000));
  return sixHourBucket % shardCount;
}

export function buildShardedActorInput(baseInput, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const shardCount = toBoundedInt(options.shardCount, 4, 1, 24);
  const explicitShard = Number(options.shardIndex);
  const shardIndex = Number.isFinite(explicitShard)
    ? ((Math.floor(explicitShard) % shardCount) + shardCount) % shardCount
    : computedShardIndex(now, shardCount);
  const selection = selectAccountShard({
    watchlist: options.watchlist,
    registry: options.registry,
    fallbackAccounts: baseInput.seedAccounts || [],
    shardCount,
    shardIndex,
    hotAccountCount: options.hotAccountCount,
    maxAccounts: options.maxAccounts,
  });

  const hashtags = [...new Set((baseInput.seedHashtags || []).map((tag) => normalizeText(tag).replace(/^#/, '')).filter(Boolean))];
  const alwaysHashtags = hashtags.slice(0, Math.min(2, hashtags.length));
  const rotatingHashtags = hashtags
    .slice(alwaysHashtags.length)
    .filter((_, index) => index % selection.shardCount === selection.shardIndex);
  const selectedHashtags = [...alwaysHashtags, ...rotatingHashtags]
    .slice(0, toBoundedInt(options.maxHashtags, 6, 0, 30));

  return {
    input: {
      ...baseInput,
      seedAccounts: selection.accounts,
      verifiedViennaAccounts: selection.verifiedAccounts,
      seedHashtags: selectedHashtags,
      maxPostsPerSource: toBoundedInt(options.maxPostsPerSource, 6, 1, 12),
      maxPostsToInspect: toBoundedInt(options.maxPostsToInspect, 100, 1, 500),
      maxPostAgeDays: toBoundedInt(options.maxPostAgeDays, 7, 1, 30),
      maxAgeDaysWithoutExplicitValidity: toBoundedInt(
        options.maxAgeDaysWithoutExplicitValidity,
        3,
        1,
        7,
      ),
    },
    shard: {
      ...selection,
      selectedHashtags,
    },
  };
}

function stableId(seed) {
  let hash = 5381;
  for (let i = 0; i < seed.length; i += 1) {
    hash = ((hash << 5) + hash) ^ seed.charCodeAt(i);
    hash >>>= 0;
  }
  return hash.toString(36);
}

function formatDateDisplay(value) {
  const iso = toIso(value);
  if (!iso) return '';
  return iso.slice(0, 10);
}

function inferType(item) {
  const kind = String(item.offerKind || '').toLowerCase();
  if (kind === 'bogo') return 'bogo';
  if (kind === 'free') return 'gratis';
  return 'rabatt';
}

function inferCategory(item) {
  return normalizeCategoryForScraper('', [
    item.description,
    item.venueName,
    item.locationText,
  ]);
}

function inferLogo(category, type) {
  if (type === 'bogo') return '1+1';
  if (category === 'kaffee') return '☕';
  if (category === 'essen') return '🍽️';
  return '🎁';
}

function buildTitle(item, brand) {
  const base = normalizeText(item.description);
  const escapedBrand = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const withoutBrand = base.replace(new RegExp(`^${escapedBrand}\\s*:?\\s*`, 'i'), '').trim();
  const titleText = normalizeText(withoutBrand || base || `${brand} Instagram-Angebot`);
  return titleText.slice(0, 110);
}

function buildDescription(item, brand, type) {
  const location = normalizeText(item.locationText);
  const dateText = formatDateDisplay(item.validUntil);
  const lead = type === 'bogo'
    ? `1+1 Angebot bei ${brand}`
    : type === 'gratis'
      ? `Gratis-Angebot bei ${brand}`
      : `Rabatt-Angebot bei ${brand}`;
  const locationSuffix = location ? ` in ${location}` : '';
  const dateSuffix = dateText ? `. Gültig bis ${dateText}` : '';
  return `${lead}${locationSuffix}${dateSuffix}`;
}

function computeQualityScore(item, type) {
  let score = type === 'gratis' ? 90 : type === 'bogo' ? 86 : 78;
  if (item.explicitValidityDetected) score += 4;
  if (item.locationText) score += 2;
  if (item.postPublishedAt) score += 3;
  return Math.min(score, 100);
}

function hasViennaEvidence(item) {
  const declaredType = normalizeText(item.viennaEvidence?.type || item.viennaEvidence?.source);
  if (/trustedSeedAccount|verified-account|merchant-registry/i.test(declaredType)) return true;
  const location = normalizeText(item.locationText);
  if (/\b(?:wien|vienna|10[1-9]0|1[12][0-3]0)\b/i.test(location)) return true;
  const offerText = [item.caption, item.description]
    .map(stripInstagramMetaDescriptionPrefix)
    .map(normalizeText)
    .filter(Boolean)
    .join(' ');
  return /\b(?:wien|vienna|10[1-9]0|1[12][0-3]0)\b/i.test(offerText);
}

function hasConcreteOfferSignal(item) {
  const kind = String(item.offerKind || '').toLowerCase();
  if (['free', 'bogo', 'discount'].includes(kind)) return true;
  const text = `${item.caption || ''} ${item.description || ''}`;
  return /\b(?:gratis|kostenlos|free|1\s*\+\s*1|2\s*(?:for|f(?:ü|u|ue)r)\s*1|bogo|geschenkt|umsonst)\b/i.test(text)
    || /\b\d{1,2}\s*%\s*(?:rabatt|off|discount)?\b/i.test(text)
    || /\b(?:nur|only|um|ab|f(?:ü|u|ue)r)\s+\d{1,3}(?:[,.]\d{1,2})?\s*(?:€|eur|euro)\b/i.test(text)
    || /\b(?:happy\s*hour|halber\s+preis)\b/i.test(text)
    || /\b(?:mit\s+)?(?:code|codewort|promo(?:code)?)\s*[:\-]?\s*[a-z0-9]{3,}\b/i.test(text);
}

function normalizeViennaEvidence(item, handle) {
  const declared = item.viennaEvidence && typeof item.viennaEvidence === 'object'
    ? item.viennaEvidence
    : null;
  const declaredType = normalizeText(declared?.type || declared?.source);
  const declaredValues = Array.isArray(declared?.values)
    ? declared.values.map(normalizeText).filter(Boolean)
    : [normalizeText(declared?.value || declared?.detail)].filter(Boolean);

  if (/trustedSeedAccount|verified-account|merchant-registry/i.test(declaredType)) {
    return {
      verified: true,
      source: 'verified-account',
      detail: declaredValues[0] || handle,
    };
  }

  const location = normalizeText(item.locationText);
  if (/\b(?:wien|vienna|10[1-9]0|1[12][0-3]0)\b/i.test(location)) {
    return {
      verified: true,
      source: 'apify-location',
      detail: location,
    };
  }

  const keywordValues = Array.isArray(item.matchedKeywords?.vienna)
    ? item.matchedKeywords.vienna.map(normalizeText).filter(Boolean)
    : declaredValues;
  return {
    verified: false,
    source: 'post-text',
    detail: keywordValues.join(', ') || 'Vienna signal in actor output',
  };
}

function apifyItemRejectReason(item, timestamp, now, maxPostAgeDays, maxAgeWithoutExplicitValidityDays) {
  if (!normalizePostUrl(item.postUrl || item.url || item.postURL)) return 'missingPostUrl';
  if (!timestamp.iso) return 'missingRealPostTimestamp';

  const publishedMs = Date.parse(timestamp.iso);
  const maxFutureMs = now.getTime() + 10 * 60 * 1000;
  if (publishedMs > maxFutureMs) return 'futurePostTimestamp';
  if (publishedMs < now.getTime() - maxPostAgeDays * 24 * 60 * 60 * 1000) return 'postTooOld';
  if (item.accepted === false) return normalizeText(item.rejectReason || 'actorRejected');
  if (!hasViennaEvidence(item)) return 'missingViennaEvidence';
  if (!hasConcreteOfferSignal(item)) return 'noConcreteOfferSignal';
  if (item.stillValid === false) return 'expiredOrTooOld';
  const validFrom = toIso(item.validFrom);
  const validFromDay = validFrom.slice(0, 10);
  const viennaNowParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Vienna',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const nowByType = Object.fromEntries(viennaNowParts.map((part) => [part.type, part.value]));
  const viennaToday = `${nowByType.year}-${nowByType.month}-${nowByType.day}`;
  if (validFromDay && validFromDay > viennaToday) return 'offerNotStarted';
  const validUntil = toIso(item.validUntil);
  if (validUntil && Date.parse(validUntil) < now.getTime()) return 'expiredOrTooOld';
  const hasExplicitFutureValidity = Boolean(validUntil && Date.parse(validUntil) >= now.getTime());
  if (!hasExplicitFutureValidity
      && publishedMs < now.getTime() - maxAgeWithoutExplicitValidityDays * 24 * 60 * 60 * 1000) {
    return 'postTooOldWithoutExplicitValidity';
  }
  if (/giveaway|gewinnspiel|verlosung/i.test(`${item.offerKind || ''} ${item.description || ''}`) || item.isGiveaway === true) return 'giveaway';
  return '';
}

export function normalizeApifyItem(raw, options = {}) {
  const item = raw && typeof raw === 'object' ? raw : {};
  const now = options.now instanceof Date ? options.now : new Date();
  const maxPostAgeDays = Math.max(1, Number(options.maxPostAgeDays || MAX_POST_AGE_DAYS));
  const maxAgeWithoutExplicitValidityDays = Math.max(
    1,
    Number(options.maxAgeWithoutExplicitValidityDays || MAX_AGE_WITHOUT_EXPLICIT_VALIDITY_DAYS),
  );
  const timestamp = realPostTimestamp(item);
  const rejectReason = apifyItemRejectReason(
    item,
    timestamp,
    now,
    maxPostAgeDays,
    maxAgeWithoutExplicitValidityDays,
  );
  if (rejectReason) return { deal: null, rejectReason };

  const postUrl = normalizePostUrl(item.postUrl || item.url || item.postURL);

  const rawBrand = item.venueName || item.ownerFullName || item.instagramHandle || item.ownerUsername || '';
  const brand = normalizeText(rawBrand) || normalizeInstagramHandle(rawBrand) || 'Instagram Deal';
  const type = inferType(item);
  const category = inferCategory(item);
  const pubDate = timestamp.iso;
  const explicitValidUntil = toIso(item.validUntil);
  const expires = explicitValidUntil || new Date(
    now.getTime() + UNKNOWN_EXPIRY_TTL_HOURS * 60 * 60 * 1000,
  ).toISOString();
  const expirySource = explicitValidUntil ? 'apify-explicit-validity' : 'short-review-ttl';
  const title = buildTitle(item, brand);
  const qualityScore = computeQualityScore(item, type);
  const handle = normalizeInstagramHandle(item.instagramHandle || item.ownerUsername || item.username);
  const shortcode = postShortcode(postUrl);
  const viennaEvidence = normalizeViennaEvidence(item, handle);
  const structuredLocation = viennaEvidence.source === 'apify-location' ? normalizeText(item.locationText) : '';
  const postalCode = structuredLocation.match(/\b(1(?:0[1-9]|1\d|2[0-3])0)\b/)?.[1] || '';

  return {
    rejectReason: '',
    deal: {
      id: `igap-${stableId(shortcode || `${postUrl}|${pubDate}|${brand}`)}`,
      brand,
      title,
      logo: inferLogo(category, type),
      description: buildDescription(item, brand, type),
      type,
      category,
      source: 'Instagram',
      originSource: 'Apify Instagram Vienna Food Offers',
      url: postUrl,
      expires,
      expiresSource: expirySource,
      expirySource,
      expiryKind: explicitValidUntil ? 'date' : 'review-ttl',
      distance: normalizeText(item.locationText),
      city: structuredLocation ? 'Wien' : '',
      postalCode,
      address: structuredLocation,
      viennaVerified: viennaEvidence.verified,
      hot: qualityScore >= 88,
      isNew: true,
      priority: Math.max(6, Math.round(qualityScore / 10)),
      votes: 1,
      qualityScore,
      pubDate,
      sourcePublishedAt: pubDate,
      pubDateSource: timestamp.source,
      sourcePublishedAtSource: timestamp.source,
      discoveredAt: now.toISOString(),
      instagramShortcode: shortcode,
      instagramHandle: handle,
      ownerUsername: handle,
      discoveredBy: normalizeText(item.sourceType || 'apify'),
      sourceHits: 1,
      reviewTier: qualityScore >= 88 ? 'high' : 'medium',
      apifyOfferKind: normalizeText(item.offerKind),
      validFrom: toIso(item.validFrom) || '',
      validUntil: expires,
      viennaEvidence,
    },
  };
}

function dedupeDeals(deals) {
  const byUrl = new Map();
  for (const deal of deals) {
    const existing = byUrl.get(deal.url);
    if (!existing) {
      byUrl.set(deal.url, deal);
      continue;
    }

    const existingScore = Number(existing.qualityScore || 0);
    const score = Number(deal.qualityScore || 0);
    if (score > existingScore) {
      byUrl.set(deal.url, deal);
      continue;
    }

    if (score === existingScore && String(deal.pubDate || '') > String(existing.pubDate || '')) {
      byUrl.set(deal.url, deal);
    }
  }

  return [...byUrl.values()].sort((a, b) => {
    if ((b.qualityScore || 0) !== (a.qualityScore || 0)) return (b.qualityScore || 0) - (a.qualityScore || 0);
    return Date.parse(b.pubDate || '') - Date.parse(a.pubDate || '');
  });
}

function retryDelayMs(response, attempt) {
  const retryAfter = String(response.headers.get('retry-after') || '').trim();
  if (/^\d+(?:\.\d+)?$/.test(retryAfter)) {
    return Math.min(60_000, Math.max(1000, Number(retryAfter) * 1000));
  }
  const retryAt = Date.parse(retryAfter);
  if (!Number.isNaN(retryAt)) {
    return Math.min(60_000, Math.max(1000, retryAt - Date.now()));
  }
  return Math.min(30_000, 1000 * (2 ** Math.max(0, attempt - 1)));
}

async function apifyFetchJson(url, options = {}) {
  const { retryUnsafe = false, ...fetchOptions } = options;
  const method = String(fetchOptions.method || 'GET').toUpperCase();
  const configuredAttempts = toBoundedInt(process.env.APIFY_API_RETRY_ATTEMPTS, 4, 1, 8);
  // Starting an Actor run is not safely idempotent: a lost 5xx response can
  // still mean the paid run started. Retry reads, never an unsafe POST.
  const attempts = retryUnsafe || ['GET', 'HEAD', 'OPTIONS'].includes(method) ? configuredAttempts : 1;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(url, {
      ...fetchOptions,
      headers: {
        Authorization: `Bearer ${APIFY_TOKEN}`,
        'Content-Type': 'application/json',
        ...(fetchOptions.headers || {}),
      },
    });

    if (response.ok) return response.json();

    const body = await response.text();
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === attempts) {
      const error = new Error(`Apify API ${response.status} for ${url}: ${body.slice(0, 500)}`);
      error.httpStatus = response.status;
      error.rateLimited = response.status === 429;
      throw error;
    }

    const delayMs = retryDelayMs(response, attempt);
    console.warn(`Apify API ${response.status}; retry ${attempt + 1}/${attempts} in ${Math.ceil(delayMs / 1000)}s`);
    await sleep(delayMs);
  }

  throw new Error(`Apify API request failed for ${url}`);
}

async function triggerActorRun(input) {
  const url = `${APIFY_BASE_URL}/acts/${encodeURIComponent(APIFY_ACTOR_ID)}/runs`;
  const response = await apifyFetchJson(url, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return response.data;
}

async function getRun(runId) {
  const url = `${APIFY_BASE_URL}/actor-runs/${encodeURIComponent(runId)}`;
  const response = await apifyFetchJson(url);
  return response.data;
}

async function getDatasetItems(datasetId) {
  const url = `${APIFY_BASE_URL}/datasets/${encodeURIComponent(datasetId)}/items?clean=true&format=json`;
  return apifyFetchJson(url, { headers: { Accept: 'application/json' } });
}

async function getSummaryRecord(storeId) {
  if (!storeId) return null;
  const url = `${APIFY_BASE_URL}/key-value-stores/${encodeURIComponent(storeId)}/records/SUMMARY`;
  try {
    return await apifyFetchJson(url, { headers: { Accept: 'application/json' } });
  } catch (error) {
    if (error.httpStatus === 404) return null;
    throw error;
  }
}

async function waitForRunCompletion(runId) {
  const startedAt = Date.now();
  while (true) {
    const run = await getRun(runId);
    const status = String(run.status || '');
    if (['SUCCEEDED', 'FAILED', 'TIMED-OUT', 'ABORTED'].includes(status)) return run;
    if (Date.now() - startedAt > RUN_TIMEOUT_MS) {
      throw new Error(`Apify run ${runId} did not finish within ${RUN_TIMEOUT_MS / 1000}s`);
    }
    console.log(`⏳ Apify run ${runId} status: ${status}`);
    await sleep(POLL_INTERVAL_MS);
  }
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function writeGithubImportStatus(report) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    fs.appendFileSync(outputPath, `status=${report.operationalStatus || report.status || 'unknown'}\n`);
    fs.appendFileSync(outputPath, `usable=${report.usable ? 'true' : 'false'}\n`);
    fs.appendFileSync(outputPath, `accepted_deals=${Number(report.acceptedDeals || 0)}\n`);
    fs.appendFileSync(outputPath, `inspected_posts=${Number(report.inspectedPosts || 0)}\n`);
  }

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    fs.appendFileSync(summaryPath, [
      '### Apify Instagram scan',
      '',
      `- Operational status: ${report.operationalStatus || report.status || 'unknown'}`,
      `- Usable scan: ${report.usable ? 'yes' : 'no'}`,
      `- Accounts in shard: ${report.shard?.accounts?.length || 0} / ${report.shard?.totalAccounts || 0}`,
      `- Hashtags in shard: ${report.shard?.selectedHashtags?.length || 0}`,
      `- Inspected posts: ${Number(report.inspectedPosts || 0)}`,
      `- Dataset items: ${Number(report.rawDatasetItems || 0)}`,
      `- Verified deals: ${Number(report.acceptedDeals || 0)}`,
      ...(report.reason ? [`- Reason: ${report.reason}`] : []),
      '',
    ].join('\n'));
  }
}

function countRejections(results) {
  const counts = {};
  for (const result of results) {
    if (!result.rejectReason) continue;
    counts[result.rejectReason] = (counts[result.rejectReason] || 0) + 1;
  }
  return counts;
}

export function classifyApifyRunHealth({ summary, rawDatasetItems, acceptedDeals }) {
  const inspectedPosts = Math.max(0, Number(summary?.inspectedPosts || 0));
  const sourceEntries = Object.values(summary?.sources || {}).filter((entry) => entry && typeof entry === 'object');
  const sourceStates = sourceEntries.reduce((counts, entry) => {
    const state = normalizeText(entry.state || 'unknown') || 'unknown';
    counts[state] = (counts[state] || 0) + 1;
    return counts;
  }, {});
  const rejectReasons = summary?.rejectReasons && typeof summary.rejectReasons === 'object'
    ? summary.rejectReasons
    : {};
  const timestampFailures = Number(rejectReasons.missingRealPostTimestamp || 0)
    + Number(rejectReasons.invalidPostTimestamp || 0);
  const postRequestFailures = Number(rejectReasons['requestFailed:POST'] || 0);
  const actorAcceptedDeals = Math.max(0, Number(summary?.acceptedDeals || 0));
  const healthySourceCount = Number(sourceStates.ok || 0);
  const allInspectedPostsLostMetadata = inspectedPosts > 0
    && acceptedDeals === 0
    && timestampFailures >= inspectedPosts;
  const acceptedDatasetMissing = actorAcceptedDeals > 0 && acceptedDeals === 0;
  const usable = !allInspectedPostsLostMetadata
    && !acceptedDatasetMissing
    && (rawDatasetItems > 0 || (inspectedPosts > 0 && healthySourceCount > 0));

  if (!summary) {
    return { usable: rawDatasetItems > 0, operationalStatus: rawDatasetItems > 0 ? 'healthy' : 'missing-summary', inspectedPosts, sourceStates };
  }
  if (!usable) {
    const reason = allInspectedPostsLostMetadata
      ? 'all-posts-missing-source-timestamps'
      : acceptedDatasetMissing
        ? 'accepted-dataset-missing'
        : postRequestFailures > 0
          ? 'post-requests-failed'
          : 'no-usable-source-data';
    return { usable: false, operationalStatus: 'source-unusable', reason, inspectedPosts, sourceStates };
  }
  if (acceptedDeals === 0) {
    return { usable: true, operationalStatus: 'healthy-no-verified-deals', inspectedPosts, sourceStates };
  }
  return { usable: true, operationalStatus: 'healthy', inspectedPosts, sourceStates };
}

export async function main() {
  ensureDir(DOCS_DIR);

  if (!APIFY_TOKEN) {
    throw new Error('APIFY_TOKEN fehlt');
  }
  if (!APIFY_ACTOR_ID) {
    throw new Error('APIFY_INSTAGRAM_VIENNA_ACTOR_ID oder APIFY_ACTOR_ID fehlt');
  }

  const storedBaseInput = readJsonIfExists(DEFAULT_INPUT_PATH, {});
  const directPostSeeds = collectDirectPostSeedUrls({
    output: readJsonIfExists(INSTAGRAM_AI_OUTPUT_PATH, {}),
    report: readJsonIfExists(INSTAGRAM_AI_REPORT_PATH, {}),
    limit: process.env.APIFY_INSTAGRAM_MAX_DIRECT_POSTS || 32,
  });
  const baseInput = {
    ...storedBaseInput,
    seedPostUrls: [...new Set([
      ...(Array.isArray(storedBaseInput.seedPostUrls) ? storedBaseInput.seedPostUrls : []),
      ...directPostSeeds,
    ])],
  };
  const watchlist = readJsonIfExists(WATCHLIST_PATH, {});
  const registry = readJsonIfExists(MERCHANT_REGISTRY_PATH, {});
  const explicitShardIndex = String(process.env.APIFY_INSTAGRAM_SHARD_INDEX || process.env.GITHUB_RUN_NUMBER || '').trim();
  const { input: shardedInput, shard } = buildShardedActorInput(baseInput, {
    now: new Date(),
    watchlist,
    registry,
    shardCount: process.env.APIFY_INSTAGRAM_ACCOUNT_SHARDS,
    shardIndex: explicitShardIndex ? Number(explicitShardIndex) : undefined,
    hotAccountCount: process.env.APIFY_INSTAGRAM_HOT_ACCOUNT_COUNT,
    maxAccounts: process.env.APIFY_INSTAGRAM_MAX_ACCOUNTS,
    maxHashtags: process.env.APIFY_INSTAGRAM_MAX_HASHTAGS,
    maxPostsPerSource: process.env.APIFY_INSTAGRAM_POSTS_PER_SOURCE,
    maxPostsToInspect: process.env.APIFY_INSTAGRAM_MAX_POSTS_TO_INSPECT,
    maxPostAgeDays: MAX_POST_AGE_DAYS,
    maxAgeDaysWithoutExplicitValidity: MAX_AGE_WITHOUT_EXPLICIT_VALIDITY_DAYS,
  });
  const input = {
    ...shardedInput,
    ...(APIFY_INSTAGRAM_COOKIE_STRING ? { cookieString: APIFY_INSTAGRAM_COOKIE_STRING } : {}),
    ...(APIFY_INSTAGRAM_SESSIONID ? { sessionId: APIFY_INSTAGRAM_SESSIONID } : {}),
  };

  console.log('🕷️ APIFY INSTAGRAM IMPORT');
  console.log(`Actor: ${APIFY_ACTOR_ID}`);
  console.log(`Shard: ${shard.shardIndex + 1}/${shard.shardCount}; accounts=${shard.accounts.length}/${shard.totalAccounts}; hashtags=${shard.selectedHashtags.length}`);
  console.log(`Direct recent post candidates: ${input.seedPostUrls.length}`);
  console.log(`Posts per source: ${input.maxPostsPerSource}; max age: ${input.maxPostAgeDays} days`);

  const run = await triggerActorRun(input);
  console.log(`▶️ Started Apify run ${run.id}`);

  const finishedRun = await waitForRunCompletion(run.id);
  console.log(`✅ Finished with status ${finishedRun.status}`);

  if (finishedRun.status !== 'SUCCEEDED') {
    throw new Error(`Apify run ended with status ${finishedRun.status}`);
  }

  const datasetItems = await getDatasetItems(finishedRun.defaultDatasetId);
  const summary = await getSummaryRecord(finishedRun.defaultKeyValueStoreId);

  const datasetRecords = Array.isArray(datasetItems)
    ? datasetItems.filter((item) => item)
    : [];
  const normalizedResults = datasetRecords.map((item) => normalizeApifyItem(item, {
    now: new Date(),
    maxPostAgeDays: MAX_POST_AGE_DAYS,
    maxAgeWithoutExplicitValidityDays: MAX_AGE_WITHOUT_EXPLICIT_VALIDITY_DAYS,
  }));
  const normalizedDeals = dedupeDeals(normalizedResults.map((result) => result.deal).filter(Boolean));
  const rejectedItems = countRejections(normalizedResults);
  const health = classifyApifyRunHealth({
    summary,
    rawDatasetItems: datasetRecords.length,
    acceptedDeals: normalizedDeals.length,
  });

  const payload = {
    lastUpdated: new Date().toISOString(),
    source: 'instagram-apify',
    totalDeals: normalizedDeals.length,
    meta: {
      actorId: APIFY_ACTOR_ID,
      runId: finishedRun.id,
      datasetId: finishedRun.defaultDatasetId,
      status: finishedRun.status,
      operationalStatus: health.operationalStatus,
      shardIndex: shard.shardIndex,
      shardCount: shard.shardCount,
    },
    deals: normalizedDeals,
  };

  const report = {
    updatedAt: new Date().toISOString(),
    actorId: APIFY_ACTOR_ID,
    runId: finishedRun.id,
    status: finishedRun.status,
    operationalStatus: health.operationalStatus,
    usable: health.usable,
    startedAt: finishedRun.startedAt || '',
    finishedAt: finishedRun.finishedAt || '',
    datasetId: finishedRun.defaultDatasetId,
    keyValueStoreId: finishedRun.defaultKeyValueStoreId,
    rawDatasetItems: datasetRecords.length,
    inspectedPosts: health.inspectedPosts,
    acceptedDeals: normalizedDeals.length,
    rejectedItems,
    sourceStates: health.sourceStates,
    reason: health.reason || '',
    shard,
    summary,
  };

  if (health.usable) writeJson(OUTPUT_PATH, payload);
  writeJson(REPORT_PATH, report);
  writeGithubImportStatus(report);

  if (health.usable) console.log(`💾 ${normalizedDeals.length} deals -> ${path.relative(ROOT, OUTPUT_PATH)}`);
  else console.log(`🛑 Existing ${path.relative(ROOT, OUTPUT_PATH)} kept because the scan produced no usable source data`);
  console.log(`📝 report -> ${path.relative(ROOT, REPORT_PATH)}`);
  console.log(`📊 operational status: ${health.operationalStatus}`);

  if (!health.usable) {
    const error = new Error(`Apify scan unusable: ${health.operationalStatus}`);
    error.reportWritten = true;
    throw error;
  }
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMainModule) {
  main().catch((error) => {
    if (!error.reportWritten) {
      ensureDir(DOCS_DIR);
      const operationalStatus = error.rateLimited ? 'apify-rate-limited' : 'failed';
      const failureReport = {
        updatedAt: new Date().toISOString(),
        actorId: APIFY_ACTOR_ID,
        status: 'FAILED',
        operationalStatus,
        usable: false,
        acceptedDeals: 0,
        inspectedPosts: 0,
        reason: error.message,
        httpStatus: Number(error.httpStatus || 0),
      };
      writeJson(REPORT_PATH, failureReport);
      writeGithubImportStatus(failureReport);
    }
    console.error(`❌ ${error.message}`);
    process.exit(1);
  });
}

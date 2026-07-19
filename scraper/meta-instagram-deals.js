import '../sentry/instrument.mjs';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { normalizeCategoryForScraper } from './category-utils.js';
import { canonicalInstagramPostKey } from './deal-evidence-utils.js';
import { parseExpiryShape } from './expiry-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');

const DEFAULT_OUTPUT_PATH = path.join(DOCS_DIR, 'deals-pending-meta-instagram.json');
const DEFAULT_REPORT_PATH = path.join(DOCS_DIR, 'meta-instagram-report.json');
const DEFAULT_STATE_PATH = path.join(DOCS_DIR, 'meta-instagram-state.json');
const WATCHLIST_PATH = path.join(DOCS_DIR, 'instagram-watchlist.json');
const MERCHANT_REGISTRY_PATH = path.join(DOCS_DIR, 'instagram-merchant-registry.json');

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_AD_SEARCH_TERMS = [
  'Wien Aktion',
  'Wien Rabatt',
  'Wien gratis',
  'Wien Gutschein',
  'Wien Happy Hour',
  'Wien 2 für 1',
  'Vienna deal',
  'Vienna opening offer',
];
const DEFAULT_HASHTAGS = [
  'freefinderwien',
  'gratiswien',
  'wienaktion',
  'wienrabatt',
  'wiengutschein',
  'wienfooddeal',
  'neueröffnungwien',
];

const CONCRETE_FREE_PATTERN = /(?<!gluten[- ])(?<!sugar[- ])(?<!lactose[- ])(?<!dairy[- ])(?<!alcohol[- ])(?<!caffeine[- ])(?<!cruelty[- ])(?<!plastic[- ])(?<!smoke[- ])(?<!tax[- ])(?<!risk[- ])(?<!fat[- ])(?<!nut[- ])(?<!gmo[- ])\bfree\b/i;

const PROMO_PATTERNS = [
  /\bgratis\b/i,
  /\bkostenlos(?:e|er|es|en)?\b/i,
  CONCRETE_FREE_PATTERN,
  /\b1\s*\+\s*1\b/i,
  /\b2\s*(?:f(?:ü|u|ue)r|for)\s*1\b/i,
  /\bbogo\b/i,
  /\b\d{1,2}\s*%\s*(?:rabatt|off|discount)?\b/i,
  /\b(?:rabatt|discount|gutschein|voucher|coupon|promo(?:code)?|aktionscode)\b/i,
  /\bhappy\s*hour\b/i,
  /\b(?:nur|only|um|for)\s+\d{1,3}(?:[,.]\d{1,2})?\s*(?:€|euro|eur)\b/i,
  /\b(?:ab|für|fuer|only)\s+\d{1,3}(?:[,.]\d{1,2})?\s*(?:€|euro|eur)\b/i,
  /\b(?:opening|eröffnung|eroeffnung)\s+(?:offer|deal|aktion|special)\b/i,
];

const SOFT_PROMO_PATTERNS = [
  /\b(?:aktion|angebot|deal|special|sale)\b/i,
  /\b(?:studenten|student|lunch|mittags)[-\s]?(?:deal|angebot|menü|menue)\b/i,
];

const EXCLUDED_PATTERNS = [
  /\b(?:gewinnspiel|verlosung|giveaway|sweepstake|zu gewinnen|win a)\b/i,
  /\b(?:gratis versand|kostenlose lieferung|free shipping)\b/i,
  /\b(?:job|stellenangebot|wohnung|immobilie|hotelzimmer)\b/i,
  /\b(?:affiliate|influencer gesucht|creator gesucht)\b/i,
];

const VIENNA_PATTERNS = [
  /\bwien\b/i,
  /\bvienna\b/i,
  /\b(?:1010|1020|1030|1040|1050|1060|1070|1080|1090|1100|1110|1120|1130|1140|1150|1160|1170|1180|1190|1200|1210|1220|1230)\b/,
  /\b(?:innere stadt|leopoldstadt|landstraße|landstrasse|wieden|margareten|mariahilf|neubau|josefstadt|alsergrund|favoriten|meidling|hietzing|penzing|rudolfsheim|ottakring|hernals|währing|waehring|döbling|doebling|brigittenau|floridsdorf|donaustadt|liesing)\b/i,
];

const CATEGORY_HINTS = [
  { category: 'kaffee', pattern: /\b(?:kaffee|coffee|cafe|espresso|latte|matcha|boba|bubble tea)\b/i },
  { category: 'essen', pattern: /\b(?:essen|food|restaurant|pizza|burger|kebab|kebap|döner|doener|sushi|ramen|brunch|eis|gelato|bakery|bäckerei)\b/i },
  { category: 'fitness', pattern: /\b(?:fitness|gym|yoga|pilates|training|workout|probetraining)\b/i },
  { category: 'beauty', pattern: /\b(?:beauty|kosmetik|friseur|salon|wellness|massage)\b/i },
  { category: 'shopping', pattern: /\b(?:shopping|store|shop|mode|fashion|sale|gutschein)\b/i },
  { category: 'kultur', pattern: /\b(?:kino|museum|theater|kultur|ausstellung)\b/i },
];

function cleanText(value, max = 2400) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function parseList(value, fallback = []) {
  const items = Array.isArray(value)
    ? value
    : String(value || '').split(/[\n,;]/g);
  const normalized = items.map((item) => cleanText(item, 160)).filter(Boolean);
  return normalized.length ? [...new Set(normalized)] : [...fallback];
}

function numberEnv(env, name, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const value = Number(env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function booleanEnv(env, name, fallback = false) {
  const value = cleanText(env[name], 20).toLowerCase();
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value);
}

function toIso(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function stableHash(value) {
  let hash = 2166136261;
  for (const char of String(value || '')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tempPath, filePath);
}

function endOfDayIso(dateText) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateText || ''))) return '';
  return `${dateText}T23:59:59.999Z`;
}

function shortTtlIso(now, hours) {
  return new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();
}

export function buildConfig(env = process.env, now = new Date()) {
  const verifiedAccounts = new Set(
    parseList(env.META_INSTAGRAM_VERIFIED_ACCOUNTS).map((item) => item.replace(/^@/, '').toLowerCase())
  );
  return {
    graphVersion: cleanText(env.META_GRAPH_VERSION || env.INSTAGRAM_GRAPH_VERSION || 'v24.0', 20),
    adLibraryToken: cleanText(env.META_AD_LIBRARY_ACCESS_TOKEN || '', 700),
    instagramAccessToken: cleanText(env.INSTAGRAM_ACCESS_TOKEN || env.META_INSTAGRAM_ACCESS_TOKEN || '', 700),
    instagramUserId: cleanText(env.INSTAGRAM_USER_ID || env.IG_USER_ID || '', 100),
    adSearchTerms: parseList(env.META_AD_LIBRARY_SEARCH_TERMS, DEFAULT_AD_SEARCH_TERMS).slice(0, 30),
    hashtags: parseList(env.META_INSTAGRAM_HASHTAGS, DEFAULT_HASHTAGS)
      .map((item) => item.replace(/^#/, '').toLowerCase())
      .filter((item) => /^[a-z0-9_.äöüß]+$/i.test(item))
      .slice(0, 30),
    explicitAccounts: parseList(env.META_INSTAGRAM_ACCOUNTS)
      .map((item) => item.replace(/^@/, '').toLowerCase())
      .filter((item) => /^[a-z0-9._]{1,30}$/i.test(item)),
    verifiedAccounts,
    maxAccountsPerRun: numberEnv(env, 'META_INSTAGRAM_MAX_ACCOUNTS_PER_RUN', 20, 1, 100),
    mediaPerAccount: numberEnv(env, 'META_INSTAGRAM_MEDIA_PER_ACCOUNT', 6, 1, 30),
    mediaPerHashtag: numberEnv(env, 'META_INSTAGRAM_MEDIA_PER_HASHTAG', 20, 1, 50),
    maxAdPagesPerTerm: numberEnv(env, 'META_AD_LIBRARY_MAX_PAGES_PER_TERM', 2, 1, 10),
    maxAdAgeDays: numberEnv(env, 'META_AD_LIBRARY_MAX_AGE_DAYS', 30, 1, 365),
    seenTtlDays: numberEnv(env, 'META_INSTAGRAM_SEEN_TTL_DAYS', 7, 1, 45),
    maxDealsPerRun: numberEnv(env, 'META_INSTAGRAM_MAX_DEALS_PER_RUN', 40, 1, 200),
    maxOrganicAgeHours: numberEnv(env, 'META_INSTAGRAM_MAX_POST_AGE_HOURS', 72, 1, 168),
    maxOrganicAgeWithExpiryDays: numberEnv(env, 'META_INSTAGRAM_MAX_POST_AGE_WITH_EXPIRY_DAYS', 7, 1, 30),
    unknownExpiryTtlHours: numberEnv(env, 'META_INSTAGRAM_UNKNOWN_EXPIRY_TTL_HOURS', 72, 12, 168),
    requestTimeoutMs: numberEnv(env, 'META_INSTAGRAM_REQUEST_TIMEOUT_MS', 15000, 1000, 60000),
    maxRetries: numberEnv(env, 'META_INSTAGRAM_MAX_RETRIES', 3, 0, 6),
    shardIndex: numberEnv(env, 'META_INSTAGRAM_SHARD_INDEX', Math.floor(now.getUTCHours() / 2), 0, 10000),
    allowWatchlistAsViennaEvidence: booleanEnv(env, 'META_INSTAGRAM_ALLOW_WATCHLIST_VIENNA', false),
    requireConfiguredSource: booleanEnv(env, 'META_INSTAGRAM_REQUIRE_SOURCE', false),
    outputPath: cleanText(env.META_INSTAGRAM_OUTPUT_PATH, 500) || DEFAULT_OUTPUT_PATH,
    reportPath: cleanText(env.META_INSTAGRAM_REPORT_PATH, 500) || DEFAULT_REPORT_PATH,
    statePath: cleanText(env.META_INSTAGRAM_STATE_PATH, 500) || DEFAULT_STATE_PATH,
  };
}

function normalizedUsername(value) {
  return cleanText(value, 80).replace(/^@/, '').toLowerCase();
}

function hasViennaText(value) {
  const text = cleanText(value, 5000);
  return VIENNA_PATTERNS.some((pattern) => pattern.test(text));
}

function registryAccountIsVerified(account) {
  if (!account || typeof account !== 'object') return false;
  if (account.verifiedVienna === true || account.viennaVerified === true) return true;
  const evidence = [account.address, account.location, account.viennaEvidence, account.verificationEvidence]
    .flat()
    .filter(Boolean)
    .join(' ');
  return hasViennaText(evidence) && Boolean(cleanText(account.verifiedAt || account.viennaVerifiedAt, 80));
}

export function loadAccountCatalog(config, paths = {}) {
  const watchlist = readJson(paths.watchlistPath || WATCHLIST_PATH, {});
  const registry = readJson(paths.registryPath || MERCHANT_REGISTRY_PATH, {});
  const byUsername = new Map();

  function add(raw, origin) {
    const username = normalizedUsername(raw?.username || raw?.handle || raw);
    if (!username || !/^[a-z0-9._]{1,30}$/i.test(username)) return;
    const existing = byUsername.get(username) || {
      username,
      priority: 0,
      category: '',
      verifiedVienna: false,
      evidence: [],
      origins: [],
    };
    existing.priority = Math.max(existing.priority, Number(raw?.priority || raw?.priorityScore || 0));
    existing.category = cleanText(raw?.category || existing.category, 60);
    existing.verifiedVienna = existing.verifiedVienna || config.verifiedAccounts.has(username) || registryAccountIsVerified(raw);
    if (config.verifiedAccounts.has(username)) existing.evidence.push('env:verified-account');
    if (registryAccountIsVerified(raw)) existing.evidence.push('registry:verified-vienna');
    existing.origins.push(origin);
    byUsername.set(username, existing);
  }

  for (const account of Array.isArray(watchlist?.accounts) ? watchlist.accounts : []) add(account, 'watchlist');
  for (const account of Array.isArray(registry?.accounts) ? registry.accounts : []) add(account, 'registry');
  for (const username of config.explicitAccounts) add({ username, priority: 110 }, 'env');

  return [...byUsername.values()].sort((a, b) => b.priority - a.priority || a.username.localeCompare(b.username));
}

export function selectAccountShard(accounts, config) {
  if (!accounts.length) return [];
  const limit = Math.min(config.maxAccountsPerRun, accounts.length);
  const shardCount = Math.max(1, Math.ceil(accounts.length / limit));
  const shardIndex = config.shardIndex % shardCount;
  const start = shardIndex * limit;
  return [...accounts.slice(start, start + limit), ...accounts.slice(0, Math.max(0, start + limit - accounts.length))]
    .slice(0, limit);
}

function targetLocationNames(locations) {
  const names = [];
  const visit = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value === 'object') {
      const excluded = value.excluded === true || cleanText(value.excluded, 10).toLowerCase() === 'true';
      if (excluded) return;
      for (const [key, nested] of Object.entries(value)) {
        if (['name', 'region', 'city', 'location', 'label'].includes(key.toLowerCase())) visit(nested);
      }
      return;
    }
    names.push(cleanText(value, 200));
  };
  visit(locations);
  return names.filter(Boolean);
}

export function findViennaEvidence(candidate, account = null, config = {}) {
  const textParts = [
    candidate?.caption,
    candidate?.text,
  ].filter(Boolean);
  const text = textParts.join(' ');
  if (hasViennaText(text)) {
    return { verified: true, source: 'content', detail: cleanText(text.match(/.{0,40}(?:wien|vienna|1\d{3}).{0,60}/i)?.[0] || 'Wien-Signal im Inhalt', 140) };
  }

  const locations = targetLocationNames(candidate?.targetLocations);
  const viennaLocation = locations.find((name) => hasViennaText(name));
  if (viennaLocation) return { verified: true, source: 'meta-target-location', detail: viennaLocation };

  const username = normalizedUsername(candidate?.username || account?.username);
  if (account?.verifiedVienna || config.verifiedAccounts?.has?.(username)) {
    return { verified: true, source: 'verified-merchant-registry', detail: `@${username}` };
  }

  if (config.allowWatchlistAsViennaEvidence && account?.origins?.includes('watchlist') && account?.category !== 'discovery') {
    return { verified: true, source: 'configured-watchlist', detail: `@${username}` };
  }
  return { verified: false, source: '', detail: '' };
}

export function classifyPromotion(text) {
  const normalized = cleanText(text, 6000);
  if (!normalized || EXCLUDED_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { accepted: false, type: '', reason: normalized ? 'excluded-promotion-type' : 'missing-text' };
  }
  const strong = PROMO_PATTERNS.some((pattern) => pattern.test(normalized));
  const soft = SOFT_PROMO_PATTERNS.some((pattern) => pattern.test(normalized));
  const hasConcreteNumber = /(?:\d{1,3}\s*%|\d{1,3}(?:[,.]\d{1,2})?\s*(?:€|euro|eur)|\b\d\s*\+\s*\d\b)/i.test(normalized);
  if (!strong && !(soft && hasConcreteNumber)) return { accepted: false, type: '', reason: 'no-concrete-offer' };

  let type = 'rabatt';
  if (/\b(?:gratis|kostenlos)\b/i.test(normalized) || CONCRETE_FREE_PATTERN.test(normalized)) type = 'gratis';
  if (/\b(?:1\s*\+\s*1|2\s*(?:f(?:ü|u|ue)r|for)\s*1|bogo)\b/i.test(normalized)) type = 'bogo';
  return { accepted: true, type, reason: '' };
}

function inferCategory(text) {
  const explicit = CATEGORY_HINTS.find((hint) => hint.pattern.test(text));
  return normalizeCategoryForScraper(explicit?.category || '', [text]) || explicit?.category || 'wien';
}

function inferTitle(text, brand, promotion) {
  const lines = String(text || '').split(/[\n|]/).map((line) => cleanText(line, 180)).filter(Boolean);
  const withSignal = lines.find((line) => PROMO_PATTERNS.some((pattern) => pattern.test(line))) || lines[0] || `${brand} Instagram-Angebot`;
  const withoutBrand = withSignal.replace(new RegExp(`^${String(brand || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\s*[:–-]?\s*`, 'i'), '');
  const fallback = promotion.type === 'gratis' ? `Gratis-Angebot bei ${brand}` : `Aktuelles Angebot bei ${brand}`;
  return cleanText(withoutBrand || fallback, 140);
}

function expiryFromText(text, now, fallbackStop, ttlHours, referenceDate = now) {
  const shape = parseExpiryShape(text, {
    now,
    contextText: text,
    referenceDate,
    timeZone: 'Europe/Vienna',
  });
  const shapeExpiry = endOfDayIso(shape?.validUntil || shape?.validOn || '');
  const stop = toIso(fallbackStop);
  if (shapeExpiry) {
    const shapeStart = shape?.validFrom || shape?.validOn || '';
    return {
      expires: shapeExpiry,
      validFrom: shapeStart ? endOfDayIso(shapeStart).replace('23:59:59.999', '00:00:00.000') : '',
      validUntil: shapeExpiry,
      expirySource: 'content-date',
      expiryKind: shape?.kind || 'date',
      dateConfidence: shape?.confidence || 'medium',
    };
  }
  if (stop && new Date(stop).getTime() >= now.getTime()) {
    return { expires: stop, validFrom: '', validUntil: stop, expirySource: 'meta-delivery-stop', expiryKind: 'date', dateConfidence: 'high' };
  }
  const ttl = shortTtlIso(now, ttlHours);
  return { expires: ttl, validFrom: '', validUntil: ttl, expirySource: 'short-review-ttl', expiryKind: 'review-ttl', dateConfidence: 'low' };
}

function explicitExpiryRejection(expiry, now) {
  if (!expiry || expiry.expirySource === 'short-review-ttl') return '';
  const validFromMs = Date.parse(expiry.validFrom || '');
  if (Number.isFinite(validFromMs) && validFromMs > now.getTime()) return 'offer-not-started';
  const expiryMs = Date.parse(expiry.expires || '');
  if (Number.isFinite(expiryMs) && expiryMs < now.getTime()) return 'offer-expired';
  return '';
}

function isOrganicFresh(sourcePublishedAt, expiry, now, config) {
  const publishedMs = Date.parse(sourcePublishedAt || '');
  if (!Number.isFinite(publishedMs) || publishedMs > now.getTime() + 10 * 60 * 1000) return false;
  const ageMs = now.getTime() - publishedMs;
  if (ageMs <= config.maxOrganicAgeHours * 60 * 60 * 1000) return true;
  const expiryMs = Date.parse(expiry?.expires || '');
  const hasExplicitFutureExpiry = expiry?.expirySource !== 'short-review-ttl' && Number.isFinite(expiryMs) && expiryMs >= now.getTime();
  return ageMs <= config.maxOrganicAgeWithExpiryDays * DAY_MS && hasExplicitFutureExpiry;
}

function buildDealBase({ id, brand, title, description, type, category, url, pubDate, pubDateSource, expiry, viennaEvidence, now, source, originSource, evidence }) {
  const qualityScore = Math.min(100,
    62 +
    (viennaEvidence.source === 'meta-target-location' ? 12 : 8) +
    (expiry.expirySource !== 'short-review-ttl' ? 10 : 0) +
    (type === 'gratis' || type === 'bogo' ? 6 : 3) +
    (pubDate ? 5 : 0)
  );
  return {
    id,
    brand: cleanText(brand, 100) || 'Instagram',
    title: cleanText(title, 140),
    description: cleanText(description, 500),
    type,
    category,
    source,
    originSource,
    url,
    expires: expiry.expires,
    validFrom: expiry.validFrom,
    validUntil: expiry.validUntil,
    expirySource: expiry.expirySource,
    expiresSource: expiry.expirySource,
    expiryKind: expiry.expiryKind,
    dateConfidence: expiry.dateConfidence,
    distance: 'Wien',
    location: viennaEvidence.detail || 'Wien',
    city: 'Wien',
    postalCode: cleanText(viennaEvidence.detail, 200).match(/\b(1(?:0[1-9]|1\d|2[0-3])0)\b/)?.[1] || '',
    viennaVerified: true,
    viennaEvidence,
    sourcePublishedAt: pubDate,
    sourcePublishedAtSource: pubDateSource,
    pubDate,
    pubDateSource,
    discoveredAt: now.toISOString(),
    evidence,
    qualityScore,
    reviewTier: qualityScore >= 88 ? 'high' : 'medium',
    hot: qualityScore >= 88,
    isNew: true,
    priority: Math.max(5, 25 - Math.round(qualityScore / 5)),
    votes: 1,
  };
}

export function normalizeAdLibraryItem(raw, config, now = new Date()) {
  const text = [
    ...(Array.isArray(raw?.ad_creative_bodies) ? raw.ad_creative_bodies : []),
    ...(Array.isArray(raw?.ad_creative_link_titles) ? raw.ad_creative_link_titles : []),
    ...(Array.isArray(raw?.ad_creative_link_descriptions) ? raw.ad_creative_link_descriptions : []),
    ...(Array.isArray(raw?.ad_creative_link_captions) ? raw.ad_creative_link_captions : []),
  ].map((part) => cleanText(part, 1800)).filter(Boolean).join('\n');
  const promotion = classifyPromotion(text);
  if (!promotion.accepted) return { deal: null, rejection: promotion.reason };

  const deliveryStart = toIso(raw?.ad_delivery_start_time || raw?.ad_creation_time);
  const startMs = Date.parse(deliveryStart || '');
  if (!Number.isFinite(startMs)) return { deal: null, rejection: 'missing-ad-delivery-date' };
  if (startMs > now.getTime() + 10 * 60 * 1000) return { deal: null, rejection: 'ad-not-started' };
  if (now.getTime() - startMs > config.maxAdAgeDays * DAY_MS) return { deal: null, rejection: 'ad-too-old' };
  const stopMs = Date.parse(raw?.ad_delivery_stop_time || '');
  if (Number.isFinite(stopMs) && stopMs < now.getTime()) return { deal: null, rejection: 'ad-inactive' };

  const viennaEvidence = findViennaEvidence({
    text,
    caption: text,
    pageName: raw?.page_name,
    targetLocations: raw?.target_locations,
  }, null, config);
  if (!viennaEvidence.verified) return { deal: null, rejection: 'missing-vienna-evidence' };

  const adId = cleanText(raw?.id, 120);
  const snapshotUrl = cleanText(raw?.ad_snapshot_url, 1000);
  if (!adId || !/^https?:\/\//i.test(snapshotUrl)) return { deal: null, rejection: 'missing-ad-snapshot-url' };
  // Meta snapshot URLs may embed the API token. Persist and post only the
  // public Ad Library permalink, never the credential-bearing response URL.
  const url = `https://www.facebook.com/ads/library/?id=${encodeURIComponent(adId)}`;
  const brand = cleanText(raw?.page_name, 100) || 'Instagram Anzeige';
  const expiry = expiryFromText(text, now, raw?.ad_delivery_stop_time, config.unknownExpiryTtlHours, deliveryStart);
  const expiryRejection = explicitExpiryRejection(expiry, now);
  if (expiryRejection) return { deal: null, rejection: expiryRejection };
  const category = inferCategory(text);
  const title = inferTitle(text, brand, promotion);
  const deal = buildDealBase({
    id: `meta-ad-${adId || stableHash(url)}`,
    brand,
    title,
    description: text,
    type: promotion.type,
    category,
    url,
    pubDate: deliveryStart,
    pubDateSource: 'meta-ad-delivery-start',
    expiry,
    viennaEvidence,
    now,
    source: 'Instagram Anzeige',
    originSource: 'Meta Ad Library API',
    evidence: {
      metaAdId: cleanText(raw?.id, 120),
      pageId: cleanText(raw?.page_id, 120),
      platforms: Array.isArray(raw?.publisher_platforms) ? raw.publisher_platforms : [],
      targetLocations: raw?.target_locations || [],
    },
  });
  return { deal, rejection: '' };
}

export function normalizeGraphMediaItem(raw, context, config, now = new Date()) {
  const caption = cleanText(raw?.caption, 4000);
  const promotion = classifyPromotion(caption);
  if (!promotion.accepted) return { deal: null, rejection: promotion.reason };
  const sourcePublishedAt = toIso(raw?.timestamp);
  if (!sourcePublishedAt) return { deal: null, rejection: 'missing-source-published-at' };

  const account = context?.account || null;
  const viennaEvidence = findViennaEvidence({
    caption,
    // A hashtag is a discovery hint, not proof that the actual offer is in Vienna.
    sourceName: context?.sourceType === 'account' ? context?.sourceName : '',
    username: raw?.username || account?.username,
  }, account, config);
  if (!viennaEvidence.verified) return { deal: null, rejection: 'missing-vienna-evidence' };
  const expiry = expiryFromText(caption, now, '', config.unknownExpiryTtlHours, sourcePublishedAt);
  const expiryRejection = explicitExpiryRejection(expiry, now);
  if (expiryRejection) return { deal: null, rejection: expiryRejection };
  if (!isOrganicFresh(sourcePublishedAt, expiry, now, config)) return { deal: null, rejection: 'post-too-old' };

  const url = cleanText(raw?.permalink, 1000);
  if (!/^https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv)\//i.test(url)) {
    return { deal: null, rejection: 'missing-instagram-permalink' };
  }
  const username = normalizedUsername(raw?.username || account?.username);
  const brand = cleanText(raw?.name, 100) || (username ? `@${username}` : cleanText(context?.sourceName, 100)) || 'Instagram';
  const category = inferCategory(caption);
  const title = inferTitle(caption, brand, promotion);
  const deal = buildDealBase({
    id: `meta-ig-${cleanText(raw?.id, 120) || stableHash(url)}`,
    brand,
    title,
    description: caption,
    type: promotion.type,
    category,
    url,
    pubDate: sourcePublishedAt,
    pubDateSource: 'instagram-graph-timestamp',
    expiry,
    viennaEvidence,
    now,
    source: 'Instagram',
    originSource: context?.sourceType === 'hashtag' ? 'Meta Instagram Hashtag API' : 'Meta Instagram Business Discovery',
    evidence: {
      mediaId: cleanText(raw?.id, 120),
      username,
      sourceType: cleanText(context?.sourceType, 30),
      sourceName: cleanText(context?.sourceName, 100),
    },
  });
  if (username) deal.ownerUsername = username;
  return { deal, rejection: '' };
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    if (url.searchParams.has('access_token')) url.searchParams.set('access_token', '[redacted]');
    return url.toString();
  } catch {
    return String(value || '').replace(/access_token=[^&\s]+/gi, 'access_token=[redacted]');
  }
}

function safeErrorMessage(error, config) {
  let message = cleanText(error?.message || error, 1200);
  for (const secret of [config?.adLibraryToken, config?.instagramAccessToken].filter(Boolean)) {
    message = message.split(secret).join('[redacted]');
    try {
      message = message.split(encodeURIComponent(secret)).join('[redacted]');
    } catch {
      // The raw replacement above still protects non-URL error messages.
    }
  }
  return message
    .replace(/([?&](?:access_token|token|client_secret)=)[^&\s"']+/gi, '$1[redacted]')
    .slice(0, 400);
}

function retryDelayMs(response, attempt) {
  const retryAfter = Number(response?.headers?.get?.('retry-after') || 0);
  if (retryAfter > 0) return retryAfter * 1000;
  return Math.min(30000, 1000 * (2 ** attempt)) + Math.floor(Math.random() * 500);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchMetaJson(url, config, fetchImpl = fetch) {
  let lastError;
  for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(config.requestTimeoutMs),
      });
      const text = await response.text();
      let payload = {};
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        payload = { raw: cleanText(text, 500) };
      }

      if (response.ok) {
        return {
          payload,
          usage: {
            app: cleanText(response.headers.get('x-app-usage'), 500),
            business: cleanText(response.headers.get('x-business-use-case-usage'), 500),
          },
        };
      }

      const error = new Error(`Meta API ${response.status} for ${safeUrl(url)}: ${cleanText(payload?.error?.message || payload?.raw || 'request failed', 300)}`);
      error.status = response.status;
      error.code = payload?.error?.code;
      error.retryAfter = response.headers.get('retry-after') || '';
      lastError = error;
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt >= config.maxRetries) throw error;
      await sleep(retryDelayMs(response, attempt));
    } catch (error) {
      lastError = error;
      if (attempt >= config.maxRetries || (error?.status && ![429, 500, 502, 503, 504].includes(error.status))) throw error;
      await sleep(Math.min(30000, 1000 * (2 ** attempt)) + Math.floor(Math.random() * 500));
    }
  }
  throw lastError || new Error(`Meta API request failed: ${safeUrl(url)}`);
}

function adLibraryUrl(config, searchTerm) {
  const url = new URL(`https://graph.facebook.com/${config.graphVersion}/ads_archive`);
  url.searchParams.set('access_token', config.adLibraryToken);
  url.searchParams.set('ad_reached_countries', JSON.stringify(['AT']));
  url.searchParams.set('ad_active_status', 'ACTIVE');
  url.searchParams.set('ad_type', 'ALL');
  url.searchParams.set('publisher_platforms', JSON.stringify(['INSTAGRAM']));
  url.searchParams.set('search_terms', searchTerm);
  url.searchParams.set('search_type', 'KEYWORD_UNORDERED');
  url.searchParams.set('limit', '100');
  url.searchParams.set('fields', [
    'id',
    'page_id',
    'page_name',
    'ad_creation_time',
    'ad_delivery_start_time',
    'ad_delivery_stop_time',
    'ad_creative_bodies',
    'ad_creative_link_captions',
    'ad_creative_link_descriptions',
    'ad_creative_link_titles',
    'ad_snapshot_url',
    'publisher_platforms',
    'target_locations',
    'eu_total_reach',
  ].join(','));
  return url.toString();
}

async function collectAdLibrary(config, now, fetchImpl) {
  const raw = [];
  const errors = [];
  const usage = [];
  for (const term of config.adSearchTerms) {
    let next = adLibraryUrl(config, term);
    for (let page = 0; page < config.maxAdPagesPerTerm && next; page += 1) {
      try {
        const response = await fetchMetaJson(next, config, fetchImpl);
        usage.push(response.usage);
        for (const item of Array.isArray(response.payload?.data) ? response.payload.data : []) {
          raw.push({ ...item, _searchTerm: term });
        }
        next = cleanText(response.payload?.paging?.next, 3000);
      } catch (error) {
        errors.push({ term, status: Number(error?.status || 0), code: error?.code || '', message: safeErrorMessage(error, config) });
        next = '';
      }
    }
  }
  return { raw, errors, usage };
}

function instagramHashtagSearchUrl(config, tag) {
  const url = new URL(`https://graph.facebook.com/${config.graphVersion}/ig_hashtag_search`);
  url.searchParams.set('user_id', config.instagramUserId);
  url.searchParams.set('q', tag);
  url.searchParams.set('access_token', config.instagramAccessToken);
  return url.toString();
}

function instagramHashtagMediaUrl(config, hashtagId) {
  const url = new URL(`https://graph.facebook.com/${config.graphVersion}/${hashtagId}/recent_media`);
  url.searchParams.set('user_id', config.instagramUserId);
  url.searchParams.set('fields', 'id,caption,media_type,permalink,timestamp,like_count,comments_count');
  url.searchParams.set('limit', String(config.mediaPerHashtag));
  url.searchParams.set('access_token', config.instagramAccessToken);
  return url.toString();
}

function instagramBusinessDiscoveryUrl(config, username) {
  const url = new URL(`https://graph.facebook.com/${config.graphVersion}/${config.instagramUserId}`);
  url.searchParams.set('fields', `business_discovery.username(${username}){username,name,media.limit(${config.mediaPerAccount}){id,caption,media_type,permalink,timestamp,like_count,comments_count}}`);
  url.searchParams.set('access_token', config.instagramAccessToken);
  return url.toString();
}

async function collectInstagramGraph(config, accountCatalog, state, fetchImpl) {
  const raw = [];
  const errors = [];
  const usage = [];
  const hashtagIds = { ...(state?.hashtagIds || {}) };
  const selectedAccounts = selectAccountShard(accountCatalog, config);

  for (const account of selectedAccounts) {
    try {
      const response = await fetchMetaJson(instagramBusinessDiscoveryUrl(config, account.username), config, fetchImpl);
      usage.push(response.usage);
      const business = response.payload?.business_discovery || {};
      const media = Array.isArray(business?.media?.data) ? business.media.data : [];
      for (const item of media) {
        raw.push({
          item: { ...item, username: business.username || account.username, name: business.name || '' },
          context: { sourceType: 'account', sourceName: `@${account.username}`, account },
        });
      }
    } catch (error) {
      errors.push({ source: `@${account.username}`, status: Number(error?.status || 0), code: error?.code || '', message: safeErrorMessage(error, config) });
    }
  }

  for (const tag of config.hashtags) {
    try {
      let hashtagId = cleanText(hashtagIds[tag], 100);
      if (!hashtagId) {
        const search = await fetchMetaJson(instagramHashtagSearchUrl(config, tag), config, fetchImpl);
        usage.push(search.usage);
        hashtagId = cleanText(search.payload?.data?.[0]?.id, 100);
        if (hashtagId) hashtagIds[tag] = hashtagId;
      }
      if (!hashtagId) {
        errors.push({ source: `#${tag}`, status: 0, code: 'hashtag-not-found', message: 'Meta returned no hashtag id.' });
        continue;
      }
      const response = await fetchMetaJson(instagramHashtagMediaUrl(config, hashtagId), config, fetchImpl);
      usage.push(response.usage);
      for (const item of Array.isArray(response.payload?.data) ? response.payload.data : []) {
        raw.push({ item, context: { sourceType: 'hashtag', sourceName: `#${tag}`, account: null } });
      }
    } catch (error) {
        errors.push({ source: `#${tag}`, status: Number(error?.status || 0), code: error?.code || '', message: safeErrorMessage(error, config) });
    }
  }

  return { raw, errors, usage, hashtagIds, selectedAccounts };
}

function incrementReason(rejections, reason) {
  const key = cleanText(reason, 100) || 'unknown';
  rejections[key] = (rejections[key] || 0) + 1;
}

function chooseBetterDeal(existing, candidate) {
  if (!existing) return candidate;
  if (Number(candidate.qualityScore || 0) !== Number(existing.qualityScore || 0)) {
    return Number(candidate.qualityScore || 0) > Number(existing.qualityScore || 0) ? candidate : existing;
  }
  const candidateExpiry = Date.parse(candidate.expires || '') || 0;
  const existingExpiry = Date.parse(existing.expires || '') || 0;
  if (candidateExpiry !== existingExpiry) return candidateExpiry > existingExpiry ? candidate : existing;
  return Date.parse(candidate.pubDate || '') > Date.parse(existing.pubDate || '') ? candidate : existing;
}

function canonicalDealKey(deal) {
  return canonicalInstagramPostKey(deal.url) || deal.id;
}

function dedupeDeals(deals) {
  const byKey = new Map();
  for (const deal of deals) {
    const key = canonicalDealKey(deal);
    byKey.set(key, chooseBetterDeal(byKey.get(key), deal));
  }
  return [...byKey.values()].sort((a, b) =>
    Number(b.qualityScore || 0) - Number(a.qualityScore || 0) ||
    Date.parse(b.pubDate || '') - Date.parse(a.pubDate || '')
  );
}

function pruneSeenIds(seenIds, now, ttlDays = 7) {
  const cutoff = now.getTime() - ttlDays * DAY_MS;
  return Object.fromEntries(Object.entries(seenIds || {}).filter(([, timestamp]) => {
    const ts = Date.parse(timestamp || '');
    return Number.isFinite(ts) && ts >= cutoff;
  }).slice(-5000));
}

export async function runMetaInstagramCollector(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const env = options.env || process.env;
  const config = options.config || buildConfig(env, now);
  const fetchImpl = options.fetchImpl || fetch;
  const state = readJson(config.statePath, { version: 1, hashtagIds: {}, seenIds: {} });
  const previousPayload = readJson(config.outputPath, null);
  const lastGoodPayload = previousPayload && Array.isArray(previousPayload.deals)
    ? previousPayload
    : null;
  const accountCatalog = loadAccountCatalog(config, options.paths || {});
  const configured = {
    adLibrary: Boolean(config.adLibraryToken),
    instagramGraph: Boolean(config.instagramAccessToken && config.instagramUserId),
  };

  const report = {
    generatedAt: now.toISOString(),
    source: 'meta-instagram',
    status: 'running',
    configured,
    accountCatalogSize: accountCatalog.length,
    selectedAccounts: [],
    sources: {
      adLibrary: { status: configured.adLibrary ? 'pending' : 'not-configured', fetched: 0, accepted: 0, errors: [] },
      instagramGraph: { status: configured.instagramGraph ? 'pending' : 'not-configured', fetched: 0, accepted: 0, errors: [] },
    },
    rejectionReasons: {},
    totalDeals: 0,
  };

  if (!configured.adLibrary && !configured.instagramGraph) {
    report.status = 'not-configured';
    report.message = 'Configure META_AD_LIBRARY_ACCESS_TOKEN and/or INSTAGRAM_ACCESS_TOKEN plus INSTAGRAM_USER_ID.';
    report.preservedDeals = lastGoodPayload?.deals?.length || 0;
    const payload = lastGoodPayload || { lastUpdated: now.toISOString(), source: 'meta-instagram', totalDeals: 0, deals: [] };
    if (options.write !== false) {
      writeJsonAtomic(config.reportPath, report);
    }
    return { payload, report, state, shouldFail: config.requireConfiguredSource };
  }

  const accepted = [];
  const nextState = {
    version: 1,
    updatedAt: now.toISOString(),
    hashtagIds: { ...(state?.hashtagIds || {}) },
    seenIds: pruneSeenIds(state?.seenIds || {}, now, config.seenTtlDays),
  };

  if (configured.adLibrary) {
    const result = await collectAdLibrary(config, now, fetchImpl);
    report.sources.adLibrary.fetched = result.raw.length;
    report.sources.adLibrary.errors = result.errors;
    report.sources.adLibrary.status = result.errors.length === config.adSearchTerms.length && !result.raw.length ? 'failed' : (result.errors.length ? 'degraded' : 'ok');
    for (const raw of result.raw) {
      const normalized = normalizeAdLibraryItem(raw, config, now);
      if (!normalized.deal) {
        incrementReason(report.rejectionReasons, normalized.rejection);
        continue;
      }
      accepted.push(normalized.deal);
      report.sources.adLibrary.accepted += 1;
    }
  }

  if (configured.instagramGraph) {
    const result = await collectInstagramGraph(config, accountCatalog, state, fetchImpl);
    nextState.hashtagIds = result.hashtagIds;
    report.selectedAccounts = result.selectedAccounts.map((account) => ({
      username: account.username,
      priority: account.priority,
      verifiedVienna: account.verifiedVienna,
    }));
    report.sources.instagramGraph.fetched = result.raw.length;
    report.sources.instagramGraph.errors = result.errors;
    const requestedSources = result.selectedAccounts.length + config.hashtags.length;
    report.sources.instagramGraph.status = result.errors.length >= requestedSources && !result.raw.length ? 'failed' : (result.errors.length ? 'degraded' : 'ok');
    for (const entry of result.raw) {
      const normalized = normalizeGraphMediaItem(entry.item, entry.context, config, now);
      if (!normalized.deal) {
        incrementReason(report.rejectionReasons, normalized.rejection);
        continue;
      }
      accepted.push(normalized.deal);
      report.sources.instagramGraph.accepted += 1;
    }
  }

  const allVerifiedDeals = dedupeDeals(accepted);
  // Previously observed rows move behind never-observed rows, but are never
  // suppressed. This rotates batches beyond the output cap without treating
  // collection as proof of Slack delivery.
  const rotatedDeals = [...allVerifiedDeals].sort((left, right) => {
    const leftSeen = Date.parse(nextState.seenIds[left.id] || '');
    const rightSeen = Date.parse(nextState.seenIds[right.id] || '');
    if (!Number.isFinite(leftSeen) && Number.isFinite(rightSeen)) return -1;
    if (Number.isFinite(leftSeen) && !Number.isFinite(rightSeen)) return 1;
    if (Number.isFinite(leftSeen) && Number.isFinite(rightSeen) && leftSeen !== rightSeen) return leftSeen - rightSeen;
    return 0;
  });
  const deals = rotatedDeals.slice(0, config.maxDealsPerRun);
  // This is an observation cache only. It must never suppress output because
  // collection is not proof that Slack delivery or durable queueing succeeded.
  for (const deal of deals) nextState.seenIds[deal.id] = now.toISOString();
  const sourceStatuses = Object.values(report.sources).filter((source) => source.status !== 'not-configured').map((source) => source.status);
  const allFailed = sourceStatuses.length > 0 && sourceStatuses.every((status) => status === 'failed');
  report.status = allFailed ? 'failed' : (sourceStatuses.includes('degraded') || sourceStatuses.includes('failed') ? 'degraded' : (deals.length ? 'ok' : 'legitimate-zero'));
  report.totalDeals = deals.length;
  report.verifiedBeforeLimit = allVerifiedDeals.length;
  report.outputLimit = config.maxDealsPerRun;
  report.freshPostsFetched = report.sources.instagramGraph.fetched;
  report.verifiedDeals = deals.length;
  report.message = deals.length
    ? `${deals.length} new, evidence-verified Vienna Instagram deals found.`
    : 'Collectors completed, but no new deal passed timestamp, Vienna and offer evidence.';

  const payload = {
    lastUpdated: now.toISOString(),
    source: 'meta-instagram',
    totalDeals: deals.length,
    meta: {
      status: report.status,
      configured,
      sourceCounts: {
        adLibrary: report.sources.adLibrary.accepted,
        instagramGraph: report.sources.instagramGraph.accepted,
      },
    },
    deals,
  };
  if (allFailed) {
    report.preservedDeals = lastGoodPayload?.deals?.length || 0;
    report.message = `All configured Meta sources failed; preserved ${report.preservedDeals} last-good deal(s).`;
    if (options.write !== false) writeJsonAtomic(config.reportPath, report);
    return {
      payload: lastGoodPayload || payload,
      report,
      state,
      shouldFail: true,
    };
  }
  if (options.write !== false) {
    writeJsonAtomic(config.outputPath, payload);
    writeJsonAtomic(config.reportPath, report);
    writeJsonAtomic(config.statePath, nextState);
  }
  return { payload, report, state: nextState, shouldFail: allFailed };
}

async function main() {
  const result = await runMetaInstagramCollector();
  console.log(`Meta Instagram collector: ${result.report.status}`);
  console.log(`  verified deals: ${result.report.totalDeals}`);
  console.log(`  ad library: ${result.report.sources.adLibrary.status} (${result.report.sources.adLibrary.fetched} fetched)`);
  console.log(`  instagram graph: ${result.report.sources.instagramGraph.status} (${result.report.sources.instagramGraph.fetched} fetched)`);
  if (result.shouldFail) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(`Meta Instagram collector failed: ${cleanText(error?.stack || error?.message || error, 2000)}`);
    process.exitCode = 1;
  });
}

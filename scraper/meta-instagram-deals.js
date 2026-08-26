import '../sentry/instrument.mjs';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { normalizeCategoryForScraper } from './category-utils.js';
import {
  canonicalInstagramPostKey,
  getPublicationEvidence,
} from './deal-evidence-utils.js';
import { parseExpiryShape } from './expiry-utils.js';
import { extractActiveOfferWindow, unicodeSafeTruncate } from './instagram-ai-validity-utils.js';
import {
  buildInstagramGraphEvidencePayload,
  loadInstagramGraphEvidence,
  writeInstagramGraphEvidence,
} from './instagram-graph-evidence.js';
import { enrichInstagramGraphMedia } from './instagram-media-evidence.js';
import { getNonGuaranteedPromotionReason } from './promotion-quality-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');

const DEFAULT_OUTPUT_PATH = path.join(DOCS_DIR, 'deals-pending-meta-instagram.json');
const DEFAULT_REPORT_PATH = path.join(DOCS_DIR, 'meta-instagram-report.json');
const DEFAULT_STATE_PATH = path.join(DOCS_DIR, 'meta-instagram-state.json');
const DEFAULT_GRAPH_EVIDENCE_PATH = path.join(DOCS_DIR, 'instagram-graph-post-evidence.json');
const WATCHLIST_PATH = path.join(DOCS_DIR, 'instagram-watchlist.json');
const MERCHANT_REGISTRY_PATH = path.join(DOCS_DIR, 'instagram-merchant-registry.json');
const CANDIDATE_ACCOUNT_PATHS = [
  path.join(DOCS_DIR, 'deals-pending-instagram.json'),
  path.join(DOCS_DIR, 'deals-pending-instagram-apify.json'),
  path.join(DOCS_DIR, 'deals-pending-instagram-ai.json'),
  path.join(DOCS_DIR, 'deals-pending-instagram-discovery.json'),
  path.join(DOCS_DIR, 'deals-pending-instagram-verified.json'),
  path.join(DOCS_DIR, 'deals-pending-wien-combined.json'),
  path.join(DOCS_DIR, 'deals-pending-gastro2.json'),
  path.join(DOCS_DIR, 'deals-pending-food3.json'),
  path.join(DOCS_DIR, 'deals-pending-firecrawl2.json'),
  path.join(DOCS_DIR, 'deals-pending-firecrawl4.json'),
  path.join(DOCS_DIR, 'deals-pending-firecrawl5.json'),
];

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
  'gratiswien',
  'gratisinwien',
  'wiengastro',
  'wienessen',
  'wienkaffee',
  'wienstreetfood',
  'wienaktion',
  'wienrabatt',
  'wiengutschein',
  'neueröffnungwien',
  'wienangebote',
  'wienangebot',
  'wiengratis',
  'viennadeals',
  'wienerdeals',
  'happyhourvienna',
  'wien',
  'vienna',
  'viennafood',
  'wienevents',
  'wientipps',
  'wienfamilie',
  'sommerinwien',
  'wienergastro',
  'essenwien',
  'viennaeats',
  'viennaevents',
  'viennarestaurants',
];

const CONCRETE_FREE_PATTERN = /(?<!gluten[- ])(?<!sugar[- ])(?<!lactose[- ])(?<!dairy[- ])(?<!alcohol[- ])(?<!caffeine[- ])(?<!cruelty[- ])(?<!plastic[- ])(?<!smoke[- ])(?<!tax[- ])(?<!risk[- ])(?<!fat[- ])(?<!nut[- ])(?<!gmo[- ])\bfree\b/i;

const PROMO_PATTERNS = [
  /\b1\s*\+\s*1\b/i,
  /\b2\s*(?:f(?:ü|u|ue)r|for)\s*1\b/i,
  /\bbogo\b/i,
  /(?:^|[^\d])-\s*\d{1,2}\s*%/i,
  /\b\d{1,2}\s*%\s*(?:rabatt(?:code)?|off|discount|nachlass|günstiger|guenstiger)\b/i,
  /\b\d{1,2}\s*%\s+auf\b/i,
  /\b(?:spar(?:e|st|en)?|save)\s+(?:dir\s+)?\d{1,2}\s*%\b/i,
  /(?:€\s*\d{1,3}(?:[,.]\d{1,2})?|\d{1,3}(?:[,.]\d{1,2})?\s*€)\s*(?:rabatt|gutschein|nachlass)\b/i,
  /\b(?:rabatt(?:code)?|discount|gutschein|voucher|coupon|promo(?:code)?|aktionscode)\b/i,
  /\bhappy\s*hour\b/i,
  /\b(?:nur|only|um|for)\s+\d{1,3}(?:[,.]\d{1,2})?\s*(?:€(?!\w)|euro\b|eur\b)/i,
  /\b(?:für|fuer)\s+\d{1,3}(?:[,.]\d{1,2})?\s*(?:€(?!\w)|euro\b|eur\b)/i,
  /\b(?:opening|eröffnung|eroeffnung)\s+(?:offer|deal|aktion|special)\b/i,
  /\bgratis\b/i,
  /\bkostenlos(?:e|er|es|en)?\b/i,
  CONCRETE_FREE_PATTERN,
];

const SOFT_PROMO_PATTERNS = [
  /\b(?:aktion|angebot|deal|special|sale)\b/i,
  /\b(?:studenten|student|lunch|mittags)[-\s]?(?:deal|angebot|menü|menue)\b/i,
];

const EXCLUDED_PATTERNS = [
  /\b(?:gratis versand|kostenlose lieferung|free shipping)\b/i,
  /\b(?:job|stellenangebot|wohnung|immobilie|hotelzimmer)\b/i,
  /\b(?:affiliate|influencer gesucht|creator gesucht)\b/i,
  /\b(?:one|einer|eine|eins)\s+(?:(?:of (?:them|these)|davon)\s+)?(?:is|ist)\s+(?:(?:completely|komplett|völlig|voellig)\s+)?free\b/i,
];

const RECOMMENDATION_LANGUAGE_PATTERN = /\b(?:favou?rite|lieblings(?:restaurant|lokal|platz|spot|ort)|summer\s+spot|things\s+to\s+do|must[-\s]?visit|guide|tipps?|vibe|empfehl\w*|recommend\w*|save\s+(?:this|and)|send\s+this)\b/i;
const EXPLICIT_PROMOTION_BEYOND_GENERIC_FREE_PATTERN = /(?:\b\d{1,2}\s*%|\b1\s*[+&]\s*1\b|\b2\s*(?:für|fuer|for)\s*1\b|\b(?:rabatt|gutschein|coupon|deal|aktion|angebot|special|happy\s*hour)\b|\b(?:statt|nur\s+heute|today\s+only)\b|\b(?:gratis|kostenlos|free)\s+(?:zu|zum|bei|with)\b|\b(?:nur|only|um|für|fuer|for)\s+\d{1,3}(?:[,.]\d{1,2})?\s*(?:€(?!\w)|euro\b|eur\b))/i;

const SELF_SYNDICATION_PATTERNS = [
  /\boriginal[- ]?link\b.{0,140}\b(?:direkt\s+)?in\s+freefinder\b/i,
  /\balle aktuellen bedingungen\b.{0,180}\bfreefinder\b/i,
];

const OUTSIDE_VIENNA_LOCATION_PATTERN = /\b(?:in|bei|am|im|standort(?:e)?\s*:?|location\s*:?)\s+(?:st\.?\s*p(?:ö|oe)lten|graz|linz|salzburg|innsbruck|klagenfurt|eisenstadt|bregenz|wiener\s+neustadt|wr\.?\s+neustadt|krems|bratislava)\b/i;
const WIDE_AVAILABILITY_PATTERN = /\b(?:österreichweit|oesterreichweit|austria[- ]?wide|online|alle[nr]?\s+(?:filialen|standorten))\b/i;

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
  const cleaned = String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return unicodeSafeTruncate(cleaned, max);
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
    graphVersion: cleanText(env.META_GRAPH_VERSION || env.INSTAGRAM_GRAPH_VERSION || 'v26.0', 20),
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
    maxHashtagsPerRun: numberEnv(env, 'META_INSTAGRAM_MAX_HASHTAGS_PER_RUN', 12, 1, 30),
    mediaPerAccount: numberEnv(env, 'META_INSTAGRAM_MEDIA_PER_ACCOUNT', 6, 1, 30),
    mediaPerHashtag: numberEnv(env, 'META_INSTAGRAM_MEDIA_PER_HASHTAG', 20, 1, 50),
    maxAdPagesPerTerm: numberEnv(env, 'META_AD_LIBRARY_MAX_PAGES_PER_TERM', 2, 1, 10),
    maxAdAgeDays: numberEnv(env, 'META_AD_LIBRARY_MAX_AGE_DAYS', 30, 1, 365),
    seenTtlDays: numberEnv(env, 'META_INSTAGRAM_SEEN_TTL_DAYS', 7, 1, 45),
    maxDealsPerRun: numberEnv(env, 'META_INSTAGRAM_MAX_DEALS_PER_RUN', 40, 1, 200),
    maxOrganicAgeHours: numberEnv(env, 'META_INSTAGRAM_MAX_POST_AGE_HOURS', 72, 1, 168),
    maxOrganicAgeWithExpiryDays: numberEnv(env, 'META_INSTAGRAM_MAX_POST_AGE_WITH_EXPIRY_DAYS', 7, 1, 7),
    unknownExpiryTtlHours: numberEnv(env, 'META_INSTAGRAM_UNKNOWN_EXPIRY_TTL_HOURS', 72, 12, 168),
    requestTimeoutMs: numberEnv(env, 'META_INSTAGRAM_REQUEST_TIMEOUT_MS', 15000, 1000, 60000),
    maxRetries: numberEnv(env, 'META_INSTAGRAM_MAX_RETRIES', 3, 0, 6),
    shardIndex: numberEnv(env, 'META_INSTAGRAM_SHARD_INDEX', Math.floor(now.getUTCHours() / 2), 0, 10000),
    allowWatchlistAsViennaEvidence: booleanEnv(env, 'META_INSTAGRAM_ALLOW_WATCHLIST_VIENNA', false),
    requireConfiguredSource: booleanEnv(env, 'META_INSTAGRAM_REQUIRE_SOURCE', false),
    sourceFailureCooldownHours: numberEnv(env, 'META_INSTAGRAM_SOURCE_FAILURE_COOLDOWN_HOURS', 168, 1, 720),
    taggedMediaEnabled: booleanEnv(env, 'META_INSTAGRAM_TAGGED_MEDIA_ENABLED', false),
    mediaOcrEnabled: booleanEnv(env, 'META_INSTAGRAM_MEDIA_OCR_ENABLED', true),
    mediaMaxPostsPerRun: numberEnv(env, 'META_INSTAGRAM_MEDIA_MAX_POSTS_PER_RUN', 18, 0, 60),
    mediaMaxAssetsPerPost: numberEnv(env, 'META_INSTAGRAM_MEDIA_MAX_ASSETS_PER_POST', 3, 1, 10),
    mediaMaxVideoFrames: numberEnv(env, 'META_INSTAGRAM_MEDIA_MAX_VIDEO_FRAMES', 4, 1, 12),
    mediaMaxBytes: numberEnv(env, 'META_INSTAGRAM_MEDIA_MAX_BYTES', 25 * 1024 * 1024, 1024 * 1024, 100 * 1024 * 1024),
    mediaDownloadTimeoutMs: numberEnv(env, 'META_INSTAGRAM_MEDIA_DOWNLOAD_TIMEOUT_MS', 20000, 1000, 60000),
    mediaOcrConcurrency: numberEnv(env, 'META_INSTAGRAM_MEDIA_OCR_CONCURRENCY', 2, 1, 6),
    mediaOcrMaxTextChars: numberEnv(env, 'META_INSTAGRAM_MEDIA_OCR_MAX_TEXT_CHARS', 4000, 500, 12000),
    ocrTimeoutMs: numberEnv(env, 'META_INSTAGRAM_MEDIA_OCR_TIMEOUT_MS', 30000, 5000, 120000),
    mediaCacheTtlDays: numberEnv(env, 'META_INSTAGRAM_MEDIA_CACHE_TTL_DAYS', 7, 1, 30),
    mediaLlmEnabled: booleanEnv(env, 'META_INSTAGRAM_MEDIA_LLM_ENABLED', Boolean(cleanText(env.OPENAI_API_KEY, 700))),
    mediaVisionEnabled: booleanEnv(env, 'META_INSTAGRAM_MEDIA_VISION_ENABLED', Boolean(cleanText(env.OPENAI_API_KEY, 700))),
    mediaVisionMaxImagesPerPost: numberEnv(env, 'META_INSTAGRAM_MEDIA_VISION_MAX_IMAGES_PER_POST', 3, 1, 6),
    mediaVisionMaxImageBytes: numberEnv(env, 'META_INSTAGRAM_MEDIA_VISION_MAX_IMAGE_BYTES', 1_500_000, 128_000, 5_000_000),
    mediaVisionDetail: ['low', 'high', 'auto'].includes(cleanText(env.META_INSTAGRAM_MEDIA_VISION_DETAIL, 20).toLowerCase())
      ? cleanText(env.META_INSTAGRAM_MEDIA_VISION_DETAIL, 20).toLowerCase()
      : 'high',
    mediaLlmModel: cleanText(env.META_INSTAGRAM_MEDIA_LLM_MODEL || env.OPENAI_MODEL || 'gpt-4.1-mini', 100),
    mediaLlmMaxCallsPerRun: numberEnv(env, 'META_INSTAGRAM_MEDIA_LLM_MAX_CALLS_PER_RUN', 8, 0, 30),
    mediaLlmMinOcrChars: numberEnv(env, 'META_INSTAGRAM_MEDIA_LLM_MIN_OCR_CHARS', 20, 5, 500),
    mediaLlmMinConfidence: numberEnv(env, 'META_INSTAGRAM_MEDIA_LLM_MIN_CONFIDENCE', 0.82, 0.5, 1),
    mediaLlmTimeoutMs: numberEnv(env, 'META_INSTAGRAM_MEDIA_LLM_TIMEOUT_MS', 30000, 5000, 120000),
    openAiApiKey: cleanText(env.OPENAI_API_KEY, 700),
    outputPath: cleanText(env.META_INSTAGRAM_OUTPUT_PATH, 500) || DEFAULT_OUTPUT_PATH,
    reportPath: cleanText(env.META_INSTAGRAM_REPORT_PATH, 500) || DEFAULT_REPORT_PATH,
    statePath: cleanText(env.META_INSTAGRAM_STATE_PATH, 500) || DEFAULT_STATE_PATH,
    graphEvidencePath: cleanText(env.META_INSTAGRAM_GRAPH_EVIDENCE_PATH, 500) || DEFAULT_GRAPH_EVIDENCE_PATH,
  };
}

function normalizedUsername(value) {
  return cleanText(value, 80).replace(/^@/, '').toLowerCase();
}

function hasViennaText(value) {
  const text = cleanText(value, 5000);
  return VIENNA_PATTERNS.some((pattern) => pattern.test(text));
}

function textWithoutHashtags(value) {
  return cleanText(value, 5000).replace(/#[\p{L}\p{N}_.-]+/gu, ' ');
}

function hasConflictingOutsideViennaLocation(value) {
  const prose = textWithoutHashtags(value);
  if (!OUTSIDE_VIENNA_LOCATION_PATTERN.test(prose)) return false;
  if (WIDE_AVAILABILITY_PATTERN.test(prose)) return false;
  return !hasViennaText(prose);
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

function hasInstagramCandidateEvidence(deal = {}) {
  const values = [
    deal?.url,
    deal?.post_url,
    deal?.postUrl,
    deal?.profileUrl,
    deal?.instagramProfileUrl,
  ].map((value) => cleanText(value, 500));
  if (values.some((value) => /(?:^|\.)instagram\.com\//i.test(value.replace(/^https?:\/\//i, '')))) return true;
  return /(?:instagram|meta instagram|business discovery)/i.test([
    deal?.source,
    deal?.originSource,
    deal?.sourceName,
    deal?.pubDateSource,
    deal?.sourcePublishedAtSource,
  ].map((value) => cleanText(value, 300)).join(' '));
}

export function loadAccountCatalog(config, paths = {}, state = {}) {
  const watchlist = readJson(paths.watchlistPath || WATCHLIST_PATH, {});
  const registry = readJson(paths.registryPath || MERCHANT_REGISTRY_PATH, {});
  const blockedUsernames = new Set((Array.isArray(registry?.accounts) ? registry.accounts : [])
    .filter((account) => account?.blockedByModeration === true)
    .map((account) => normalizedUsername(account?.username))
    .filter(Boolean));
  const byUsername = new Map();

  function add(raw, origin) {
    const username = normalizedUsername(raw?.username || raw?.handle || raw);
    if (!username || blockedUsernames.has(username) || !/^[a-z0-9._]{1,30}$/i.test(username)) return;
    const existing = byUsername.get(username) || {
      username,
      priority: 0,
      category: '',
      verifiedVienna: false,
      evidence: [],
      origins: [],
      lastCandidateAt: '',
      approvedDeals: 0,
      postedDeals: 0,
      rejectedDeals: 0,
      approvalRate: 0,
    };
    existing.priority = Math.max(existing.priority, Number(raw?.priority || raw?.priorityScore || 0));
    existing.category = cleanText(raw?.category || existing.category, 60);
    existing.verifiedVienna = existing.verifiedVienna || config.verifiedAccounts.has(username) || registryAccountIsVerified(raw);
    existing.approvedDeals = Math.max(existing.approvedDeals, Number(raw?.approvedDeals || raw?.liveOccurrences || 0));
    existing.postedDeals = Math.max(existing.postedDeals, Number(raw?.postedDeals || raw?.postedOccurrences || 0));
    existing.rejectedDeals = Math.max(existing.rejectedDeals, Number(raw?.rejectedDeals || raw?.rejectedOccurrences || 0));
    existing.approvalRate = Math.max(existing.approvalRate, Number(raw?.approvalRate || 0));
    const candidateAt = toIso(raw?.lastCandidateAt || raw?.sourcePublishedAt || raw?.pubDate);
    if (candidateAt && Date.parse(candidateAt) > (Date.parse(existing.lastCandidateAt) || 0)) {
      existing.lastCandidateAt = candidateAt;
    }
    if (config.verifiedAccounts.has(username)) existing.evidence.push('env:verified-account');
    if (registryAccountIsVerified(raw)) existing.evidence.push('registry:verified-vienna');
    existing.origins.push(origin);
    byUsername.set(username, existing);
  }

  for (const account of Array.isArray(watchlist?.accounts) ? watchlist.accounts : []) add(account, 'watchlist');
  for (const account of Array.isArray(registry?.accounts) ? registry.accounts : []) add(account, 'registry');
  for (const account of Object.values(state?.discoveredAccounts || {})) add(account, 'graph-discovery');
  const candidatePaths = Array.isArray(paths.candidatePaths) ? paths.candidatePaths : CANDIDATE_ACCOUNT_PATHS;
  for (const candidatePath of candidatePaths) {
    const payload = readJson(candidatePath, {});
    const deals = Array.isArray(payload) ? payload : (Array.isArray(payload?.deals) ? payload.deals : []);
    for (const deal of deals) {
      const username = normalizedUsername(
        deal?.ownerUsername
        || deal?.evidence?.username
        || deal?.media?.username
        || String(deal?.sourceName || '').replace(/^@/, '')
      );
      const publication = getPublicationEvidence(deal);
      if (username && hasInstagramCandidateEvidence(deal)) add({
        username,
        priority: 104,
        category: deal?.category || '',
        sourcePublishedAt: publication.sourcePublishedAt,
      }, `candidate:${path.basename(candidatePath)}`);

      for (const mentionedUsername of extractMentionedUsernames(deal)) {
        if (mentionedUsername === username) continue;
        add({
          username: mentionedUsername,
          priority: 82,
          category: deal?.category || '',
          sourcePublishedAt: publication.sourcePublishedAt,
        }, `mention:${path.basename(candidatePath)}`);
      }
    }
  }
  for (const username of config.explicitAccounts) add({ username, priority: 110 }, 'env');

  return [...byUsername.values()].sort((a, b) => b.priority - a.priority || a.username.localeCompare(b.username));
}

export function extractMentionedUsernames(deal = {}) {
  const text = [
    deal?.caption,
    deal?.postCaption,
    deal?.metaGraphCaption,
    deal?.description,
    deal?.text,
    deal?.evidence?.caption,
  ].map((value) => cleanText(value, 5000)).filter(Boolean).join(' ');
  const usernames = new Set();
  for (const match of text.matchAll(/(^|[^a-z0-9._])@([a-z0-9._]{2,30})\b/gi)) {
    const username = normalizedUsername(match[2]);
    if (!username || ['instagram', 'freefinder', 'freefinderwien'].includes(username)) continue;
    usernames.add(username);
    if (usernames.size >= 6) break;
  }
  const withoutLinks = text
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\bwww\.\S+/gi, ' ')
    .replace(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi, ' ');
  for (const match of withoutLinks.matchAll(/(^|[^a-z0-9._])([a-z0-9_][a-z0-9._]{1,27}\.(?:wien|vienna|at))\b/gi)) {
    const username = normalizedUsername(match[2]);
    if (!username || /^(?:wien|vienna)\.(?:wien|vienna|at)$/.test(username)) continue;
    usernames.add(username);
    if (usernames.size >= 6) break;
  }
  return [...usernames];
}

export function selectAccountShard(accounts, config, state = {}, now = new Date()) {
  if (!accounts.length) return [];
  const limit = Math.min(config.maxAccountsPerRun, accounts.length);
  const selected = [];
  const seen = new Set();
  const add = (account) => {
    if (!account || seen.has(account.username) || selected.length >= limit) return;
    seen.add(account.username);
    selected.push(account);
  };
  const recentCutoff = now.getTime() - 8 * DAY_MS;
  const recentCandidates = accounts
    .filter((account) => (Date.parse(account.lastCandidateAt || '') || 0) >= recentCutoff)
    .sort((left, right) => Date.parse(right.lastCandidateAt) - Date.parse(left.lastCandidateAt));
  recentCandidates.slice(0, Math.min(8, Math.ceil(limit / 3))).forEach(add);

  const finalApprovalYield = accounts
    .filter((account) => Number(account.approvedDeals || 0) > 0)
    .sort((left, right) => (
      Number(right.approvalRate || 0) - Number(left.approvalRate || 0)
      || Number(right.approvedDeals || 0) - Number(left.approvedDeals || 0)
      || Number(left.rejectedDeals || 0) - Number(right.rejectedDeals || 0)
    ));
  finalApprovalYield.slice(0, Math.min(4, Math.ceil(limit / 6))).forEach(add);

  const performance = state?.accountPerformance || {};
  const highYield = accounts
    .filter((account) => Number(performance[account.username]?.recentNewAccepted || 0) > 0)
    .sort((left, right) => {
      const leftStats = performance[left.username] || {};
      const rightStats = performance[right.username] || {};
      const leftRate = Number(leftStats.recentNewAccepted || 0) / Math.max(1, Number(leftStats.recentFetched || 0));
      const rightRate = Number(rightStats.recentNewAccepted || 0) / Math.max(1, Number(rightStats.recentFetched || 0));
      return rightRate - leftRate || Number(rightStats.recentNewAccepted || 0) - Number(leftStats.recentNewAccepted || 0);
    });
  highYield.slice(0, Math.min(4, Math.ceil(limit / 6))).forEach(add);

  const rotating = accounts.filter((account) => !seen.has(account.username));
  const start = rotating.length ? (config.shardIndex * Math.max(1, limit - selected.length)) % rotating.length : 0;
  for (let offset = 0; offset < rotating.length && selected.length < limit; offset += 1) {
    add(rotating[(start + offset) % rotating.length]);
  }
  return selected;
}

export function selectHashtagShard(hashtags, config, state = {}) {
  const unique = [...new Set((hashtags || []).map((tag) => cleanText(tag, 80).replace(/^#/, '').toLowerCase()).filter(Boolean))];
  if (unique.length === 0) return [];
  const limit = Math.min(Math.max(1, Number(config.maxHashtagsPerRun || unique.length)), unique.length);
  if (unique.length <= limit) return unique;

  const selected = [];
  const seen = new Set();
  const add = (tag) => {
    if (!tag || seen.has(tag) || selected.length >= limit) return;
    seen.add(tag);
    selected.push(tag);
  };
  const performance = state?.hashtagPerformance || {};
  const highYield = unique
    .filter((tag) => Number(performance[tag]?.recentNewAccepted || 0) > 0)
    .sort((left, right) => {
      const leftStats = performance[left] || {};
      const rightStats = performance[right] || {};
      const leftRate = Number(leftStats.recentNewAccepted || 0) / Math.max(1, Number(leftStats.recentFetched || 0));
      const rightRate = Number(rightStats.recentNewAccepted || 0) / Math.max(1, Number(rightStats.recentFetched || 0));
      return rightRate - leftRate || Number(rightStats.recentNewAccepted || 0) - Number(leftStats.recentNewAccepted || 0);
    });
  highYield.slice(0, Math.min(4, Math.ceil(limit / 3))).forEach(add);

  const rotating = unique.filter((tag) => !seen.has(tag));
  const remaining = limit - selected.length;
  const start = rotating.length ? (Number(config.shardIndex || 0) * Math.max(1, remaining)) % rotating.length : 0;
  for (let offset = 0; offset < rotating.length && selected.length < limit; offset += 1) {
    add(rotating[(start + offset) % rotating.length]);
  }
  return selected;
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
  if (!normalized) {
    return { accepted: false, type: '', reason: 'missing-text' };
  }
  if (getNonGuaranteedPromotionReason(normalized) || EXCLUDED_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { accepted: false, type: '', reason: normalized ? 'excluded-promotion-type' : 'missing-text' };
  }
  if (RECOMMENDATION_LANGUAGE_PATTERN.test(normalized)
      && !EXPLICIT_PROMOTION_BEYOND_GENERIC_FREE_PATTERN.test(normalized)) {
    return { accepted: false, type: '', reason: 'general-recommendation' };
  }
  // Pattern order is intentional: explicit savings beat regular prices and
  // secondary free-trial language in a long social caption.
  const firstMatch = (patterns) => patterns.map((pattern) => normalized.match(pattern)).find(Boolean);
  const strongMatch = firstMatch(PROMO_PATTERNS);
  const softMatch = firstMatch(SOFT_PROMO_PATTERNS);
  const strong = Boolean(strongMatch);
  const soft = Boolean(softMatch);
  const hasConcreteNumber = /(?:\d{1,3}\s*%|\d{1,3}(?:[,.]\d{1,2})?\s*(?:€|euro|eur)|\b\d\s*\+\s*\d\b)/i.test(normalized);
  if (!strong && !(soft && hasConcreteNumber)) return { accepted: false, type: '', reason: 'no-concrete-offer' };

  const bogoMatch = normalized.match(/\b(?:1\s*\+\s*1|2\s*(?:f(?:ü|u|ue)r|for)\s*1|bogo)\b/i);
  let type = 'rabatt';
  if (strongMatch && (/\b(?:gratis|kostenlos)\b/i.test(strongMatch[0]) || CONCRETE_FREE_PATTERN.test(strongMatch[0]))) {
    type = 'gratis';
  }
  if (bogoMatch) type = 'bogo';
  return { accepted: true, type, reason: '', evidence: cleanText(bogoMatch?.[0] || strongMatch?.[0] || softMatch?.[0], 120) };
}

function inferCategory(text) {
  const explicit = CATEGORY_HINTS.find((hint) => hint.pattern.test(text));
  return normalizeCategoryForScraper(explicit?.category || '', [text]) || explicit?.category || 'wien';
}

function inferTitle(text, brand, promotion) {
  const segments = String(text || '')
    .split(/(?:\r?\n+|\|+|(?<=[.!?])\s+)/)
    .map((segment) => cleanText(segment, 180))
    .filter(Boolean);
  const signalPatterns = [...PROMO_PATTERNS, ...SOFT_PROMO_PATTERNS];
  const withSignal = segments.find((segment) => signalPatterns.some((pattern) => pattern.test(segment)))
    || segments[0]
    || `${brand} Instagram-Angebot`;
  const escapedBrand = String(brand || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const withoutBrand = withSignal.replace(new RegExp(`^${escapedBrand}\\s*[:–-]?\\s*`, 'i'), '');
  const fallback = promotion.type === 'gratis' ? `Gratis-Angebot bei ${brand}` : `Aktuelles Angebot bei ${brand}`;
  return cleanText(withoutBrand || fallback, 140);
}

function expiryFromText(text, now, fallbackStop, ttlHours, referenceDate = now) {
  const activeWindow = extractActiveOfferWindow(text, { now, pubDate: referenceDate });
  const shape = activeWindow?.endDate
    ? {
        kind: activeWindow.kind,
        validFrom: activeWindow.startDate?.toISOString().slice(0, 10) || '',
        validUntil: activeWindow.endDate.toISOString().slice(0, 10),
        confidence: 'high',
      }
    : parseExpiryShape(text, {
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
  deal.promotionEvidence = promotion.evidence;
  return { deal, rejection: '' };
}

export function normalizeGraphMediaItem(raw, context, config, now = new Date()) {
  const caption = cleanText(raw?.caption, 4000);
  const captionProse = textWithoutHashtags(caption);
  if (SELF_SYNDICATION_PATTERNS.some((pattern) => pattern.test(caption))) {
    return { deal: null, rejection: 'self-syndicated-deal' };
  }
  if (hasConflictingOutsideViennaLocation(caption)) {
    return { deal: null, rejection: 'non-vienna-location' };
  }
  const mediaEvidence = raw?._mediaEvidence && typeof raw._mediaEvidence === 'object' ? raw._mediaEvidence : {};
  const ocrText = cleanText(mediaEvidence.ocrText, config.mediaOcrMaxTextChars || 4000);
  const ai = mediaEvidence.ai && typeof mediaEvidence.ai === 'object' ? mediaEvidence.ai : null;
  const aiConfidenceThreshold = Number(config.mediaLlmMinConfidence || 0.82);
  const aiConfidence = Number(ai?.confidence || 0);
  const captionPromotion = classifyPromotion(captionProse);
  const ocrPromotion = classifyPromotion(ocrText);
  const trustedAiOffer = ai?.isDeal === true
    && aiConfidence >= aiConfidenceThreshold
    && ai.exclusion === 'none'
      ? cleanText(ai.offerText, 500)
      : '';
  const trustedAiLocation = trustedAiOffer ? cleanText(ai.locationText, 240) : '';
  const trustedAiValidity = trustedAiOffer ? cleanText(ai.validityText, 240) : '';
  // OCR occasionally turns decorative text into a plausible percentage. If
  // the caption has no offer and the evidence classifier confidently rejects
  // that OCR-only signal, do not let the noisy text create a deal by itself.
  if (!captionPromotion.accepted
      && ocrPromotion.accepted
      && ai?.isDeal === false
      && aiConfidence >= aiConfidenceThreshold) {
    return { deal: null, rejection: 'media-ai-rejected-offer' };
  }
  const promotionText = [captionProse, ocrText ? `Bildtext: ${ocrText}` : '', trustedAiOffer ? `AI-Angebotsbeleg: ${trustedAiOffer}` : '']
    .filter(Boolean)
    .join('\n');
  const promotion = classifyPromotion(promotionText);
  if (!promotion.accepted) return { deal: null, rejection: promotion.reason };
  const contentText = [
    caption,
    ocrText ? `Bildtext: ${ocrText}` : '',
    trustedAiOffer ? `AI-Angebotsbeleg: ${trustedAiOffer}` : '',
    trustedAiLocation ? `AI-Ortsbeleg: ${trustedAiLocation}` : '',
    trustedAiValidity ? `AI-Gültigkeitsbeleg: ${trustedAiValidity}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const sourcePublishedAt = toIso(raw?.timestamp);
  if (!sourcePublishedAt) return { deal: null, rejection: 'missing-source-published-at' };

  const account = context?.account || null;
  const viennaEvidence = findViennaEvidence({
    caption: [captionProse, ocrText, trustedAiLocation].filter(Boolean).join(' '),
    // A hashtag is a discovery hint, not proof that the actual offer is in Vienna.
    sourceName: context?.sourceType === 'account' ? context?.sourceName : '',
    username: raw?.username || account?.username,
  }, account, config);
  if (!viennaEvidence.verified) return { deal: null, rejection: 'missing-vienna-evidence' };
  const expiry = expiryFromText(contentText, now, '', config.unknownExpiryTtlHours, sourcePublishedAt);
  const expiryRejection = explicitExpiryRejection(expiry, now);
  if (expiryRejection) return { deal: null, rejection: expiryRejection };
  if (!isOrganicFresh(sourcePublishedAt, expiry, now, config)) return { deal: null, rejection: 'post-too-old' };

  const url = cleanText(raw?.permalink, 1000);
  if (!/^https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv)\//i.test(url)) {
    return { deal: null, rejection: 'missing-instagram-permalink' };
  }
  const username = normalizedUsername(raw?.username || account?.username);
  const brand = cleanText(raw?.name, 100) || (username ? `@${username}` : cleanText(context?.sourceName, 100)) || 'Instagram';
  const category = inferCategory(contentText);
  const title = inferTitle(promotionText, brand, promotion);
  const deal = buildDealBase({
    id: `meta-ig-${cleanText(raw?.id, 120) || stableHash(url)}`,
    brand,
    title,
    description: contentText,
    type: promotion.type,
    category,
    url,
    pubDate: sourcePublishedAt,
    pubDateSource: 'instagram-graph-timestamp',
    expiry,
    viennaEvidence,
    now,
    source: 'Instagram',
    originSource: context?.sourceType === 'hashtag'
      ? 'Meta Instagram Hashtag API'
      : (context?.sourceType === 'tagged' ? 'Meta Instagram Tagged Media API' : 'Meta Instagram Business Discovery'),
    evidence: {
      mediaId: cleanText(raw?.id, 120),
      username,
      sourceType: cleanText(context?.sourceType, 30),
      sourceName: cleanText(context?.sourceName, 100),
      mediaEvidence: {
        ocrText,
        assetCount: Number(mediaEvidence.assetCount || 0),
        imageCount: Number(mediaEvidence.imageCount || 0),
        videoFrameCount: Number(mediaEvidence.videoFrameCount || 0),
        ai: ai ? {
          isDeal: ai.isDeal === true,
          confidence: Number(ai.confidence || 0),
          offerText: cleanText(ai.offerText, 500),
          locationText: cleanText(ai.locationText, 240),
          validityText: cleanText(ai.validityText, 240),
          exclusion: cleanText(ai.exclusion, 60),
        } : null,
      },
    },
  });
  deal.promotionEvidence = promotion.evidence;
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
  for (const secret of [config?.adLibraryToken, config?.instagramAccessToken, config?.openAiApiKey].filter(Boolean)) {
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

export function isGlobalMetaGraphError(error) {
  const status = Number(error?.status || 0);
  const code = Number(error?.code || 0);
  const message = cleanText(error?.message || error, 1000);
  return [401, 403, 429].includes(status)
    || status >= 500
    || [4, 10, 17, 32, 190, 200].includes(code)
    || /(?:invalid|expired|malformed).{0,30}(?:oauth|access token)|rate limit|too many calls|permission/i.test(message);
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

function instagramManagedPagesUrl(config) {
  const url = new URL(`https://graph.facebook.com/${config.graphVersion}/me/accounts`);
  url.searchParams.set('fields', 'id,name,access_token,tasks,instagram_business_account{id,username}');
  url.searchParams.set('access_token', config.instagramAccessToken);
  return url.toString();
}

function instagramLinkedPageUrl(config) {
  const url = new URL(`https://graph.facebook.com/${config.graphVersion}/me`);
  url.searchParams.set('fields', 'id,name,instagram_business_account{id,username}');
  url.searchParams.set('access_token', config.instagramAccessToken);
  return url.toString();
}

async function discoverInstagramGraphIdentity(config, fetchImpl) {
  const errors = [];
  const attempts = [
    {
      source: 'facebook-managed-pages',
      url: instagramManagedPagesUrl(config),
      select(payload) {
        const pages = Array.isArray(payload?.data) ? payload.data : [];
        const page = pages.find((entry) => cleanText(entry?.instagram_business_account?.id, 100));
        if (!page) return null;
        return {
          userId: cleanText(page.instagram_business_account.id, 100),
          username: cleanText(page.instagram_business_account.username, 100),
          accessToken: cleanText(page.access_token, 700) || config.instagramAccessToken,
        };
      },
    },
    {
      source: 'facebook-page-token',
      url: instagramLinkedPageUrl(config),
      select(payload) {
        const userId = cleanText(payload?.instagram_business_account?.id, 100);
        if (!userId) return null;
        return {
          userId,
          username: cleanText(payload.instagram_business_account.username, 100),
          accessToken: config.instagramAccessToken,
        };
      },
    },
  ];

  for (const attempt of attempts) {
    try {
      const response = await fetchMetaJson(attempt.url, config, fetchImpl);
      const identity = attempt.select(response.payload);
      if (identity?.userId) return { ...identity, source: attempt.source, errors };
      errors.push({
        source: attempt.source,
        status: 200,
        code: 'instagram-account-not-linked',
        message: 'Meta returned no linked Instagram professional account.',
      });
    } catch (error) {
      errors.push({
        source: attempt.source,
        status: Number(error?.status || 0),
        code: error?.code || '',
        message: safeErrorMessage(error, config),
      });
    }
  }

  return { userId: '', username: '', accessToken: '', source: '', errors };
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

const BASIC_INSTAGRAM_MEDIA_FIELDS = 'id,caption,media_type,permalink,timestamp,like_count,comments_count';
const OCR_INSTAGRAM_MEDIA_FIELDS = `${BASIC_INSTAGRAM_MEDIA_FIELDS},media_product_type,media_url,thumbnail_url,children{media_type,media_url,thumbnail_url}`;

function instagramHashtagMediaUrl(config, hashtagId, includeMedia = true) {
  const url = new URL(`https://graph.facebook.com/${config.graphVersion}/${hashtagId}/recent_media`);
  url.searchParams.set('user_id', config.instagramUserId);
  url.searchParams.set('fields', includeMedia ? OCR_INSTAGRAM_MEDIA_FIELDS : BASIC_INSTAGRAM_MEDIA_FIELDS);
  url.searchParams.set('limit', String(config.mediaPerHashtag));
  url.searchParams.set('access_token', config.instagramAccessToken);
  return url.toString();
}

function instagramBusinessDiscoveryUrl(config, username, includeMedia = true) {
  const url = new URL(`https://graph.facebook.com/${config.graphVersion}/${config.instagramUserId}`);
  const fields = includeMedia ? OCR_INSTAGRAM_MEDIA_FIELDS : BASIC_INSTAGRAM_MEDIA_FIELDS;
  url.searchParams.set('fields', `business_discovery.username(${username}){username,name,media.limit(${config.mediaPerAccount}){${fields}}}`);
  url.searchParams.set('access_token', config.instagramAccessToken);
  return url.toString();
}

function instagramTaggedMediaUrl(config, includeMedia = true) {
  const url = new URL(`https://graph.facebook.com/${config.graphVersion}/${config.instagramUserId}/tags`);
  url.searchParams.set('fields', includeMedia ? OCR_INSTAGRAM_MEDIA_FIELDS : BASIC_INSTAGRAM_MEDIA_FIELDS);
  url.searchParams.set('limit', String(Math.max(config.mediaPerHashtag, 25)));
  url.searchParams.set('access_token', config.instagramAccessToken);
  return url.toString();
}

export async function fetchInstagramBusinessDiscoveryMedia(config, account, fetchImpl = fetch) {
  const username = normalizedUsername(account?.username || account);
  if (!username) throw new Error('A valid Instagram Business Discovery username is required.');
  const response = await fetchGraphMediaWithFallback(
    instagramBusinessDiscoveryUrl(config, username, true),
    instagramBusinessDiscoveryUrl(config, username, false),
    config,
    fetchImpl,
  );
  const business = response.payload?.business_discovery || {};
  const resolvedAccount = typeof account === 'object' && account
    ? account
    : { username };
  const media = Array.isArray(business?.media?.data) ? business.media.data : [];
  return {
    entries: media.map((item) => ({
      item: { ...item, username: business.username || username, name: business.name || '' },
      context: { sourceType: 'account', sourceName: `@${username}`, account: resolvedAccount },
    })),
    usage: response.usage,
    username: normalizedUsername(business.username || username),
    name: cleanText(business.name, 100),
  };
}

async function fetchGraphMediaWithFallback(primaryUrl, fallbackUrl, config, fetchImpl) {
  try {
    return await fetchMetaJson(primaryUrl, config, fetchImpl);
  } catch (error) {
    if (Number(error?.code || 0) !== 100) throw error;
    return fetchMetaJson(fallbackUrl, config, fetchImpl);
  }
}

function pruneSourceFailures(value, now) {
  const maxAge = 30 * DAY_MS;
  const pruneGroup = (group) => Object.fromEntries(Object.entries(group || {}).filter(([, failure]) => {
    const timestamp = Date.parse(failure?.lastAt || '');
    return Number.isFinite(timestamp) && now.getTime() - timestamp <= maxAge;
  }).slice(-500));
  return {
    accounts: pruneGroup(value?.accounts),
    hashtags: pruneGroup(value?.hashtags),
  };
}

function sourceOnCooldown(failure, now) {
  const until = Date.parse(failure?.cooldownUntil || '');
  return Number.isFinite(until) && until > now.getTime();
}

function clearSourceFailure(failures, group, key) {
  delete failures[group][key];
}

function recordSourceFailure(failures, group, key, error, config, now) {
  const code = cleanText(error?.code, 80) || `http-${Number(error?.status || 0)}`;
  if (!['24', '100', '110', 'hashtag-not-found'].includes(code)) return;
  const previous = failures[group][key] || {};
  const count = Number(previous.count || 0) + 1;
  const baseHours = code === '110' || code === 'hashtag-not-found'
    ? config.sourceFailureCooldownHours
    : Math.min(config.sourceFailureCooldownHours, 72);
  const cooldownHours = Math.min(720, baseHours * (2 ** Math.min(3, count - 1)));
  failures[group][key] = {
    count,
    code,
    lastAt: now.toISOString(),
    cooldownHours,
    cooldownUntil: new Date(now.getTime() + cooldownHours * 60 * 60 * 1000).toISOString(),
  };
}

async function collectInstagramGraph(config, accountCatalog, state, now, fetchImpl) {
  const raw = [];
  const errors = [];
  const usage = [];
  const hashtagIds = { ...(state?.hashtagIds || {}) };
  const sourceFailures = pruneSourceFailures(state?.sourceFailures, now);
  const availableAccounts = accountCatalog.filter((account) => !sourceOnCooldown(sourceFailures.accounts[account.username], now));
  const selectedAccounts = selectAccountShard(availableAccounts, config, state, now);
  const availableHashtags = config.hashtags.filter((tag) => !sourceOnCooldown(sourceFailures.hashtags[tag], now));
  const selectedHashtags = selectHashtagShard(availableHashtags, config, state);
  const skippedAccounts = accountCatalog.length - availableAccounts.length;
  const skippedHashtags = config.hashtags.length - availableHashtags.length;
  let taggedAttempted = false;
  let globalError = null;

  for (const account of selectedAccounts) {
    try {
      const response = await fetchInstagramBusinessDiscoveryMedia(config, account, fetchImpl);
      usage.push(response.usage);
      raw.push(...response.entries);
      clearSourceFailure(sourceFailures, 'accounts', account.username);
    } catch (error) {
      const errorRow = { source: `@${account.username}`, status: Number(error?.status || 0), code: error?.code || '', message: safeErrorMessage(error, config) };
      errors.push(errorRow);
      if (isGlobalMetaGraphError(error)) {
        globalError = errorRow;
        break;
      }
      recordSourceFailure(sourceFailures, 'accounts', account.username, error, config, now);
    }
  }

  if (config.taggedMediaEnabled && !globalError) {
    taggedAttempted = true;
    try {
      const response = await fetchGraphMediaWithFallback(
        instagramTaggedMediaUrl(config, true),
        instagramTaggedMediaUrl(config, false),
        config,
        fetchImpl,
      );
      usage.push(response.usage);
      for (const item of Array.isArray(response.payload?.data) ? response.payload.data : []) {
        raw.push({ item, context: { sourceType: 'tagged', sourceName: 'FreeFinder tagged media', account: null } });
      }
    } catch (error) {
      const errorRow = { source: 'tagged-media', status: Number(error?.status || 0), code: error?.code || '', message: safeErrorMessage(error, config) };
      errors.push(errorRow);
      if (isGlobalMetaGraphError(error)) globalError = errorRow;
    }
  }

  for (const tag of selectedHashtags) {
    if (globalError) break;
    try {
      let hashtagId = cleanText(hashtagIds[tag], 100);
      if (!hashtagId) {
        const search = await fetchMetaJson(instagramHashtagSearchUrl(config, tag), config, fetchImpl);
        usage.push(search.usage);
        hashtagId = cleanText(search.payload?.data?.[0]?.id, 100);
        if (hashtagId) hashtagIds[tag] = hashtagId;
      }
      if (!hashtagId) {
        const error = { source: `#${tag}`, status: 0, code: 'hashtag-not-found', message: 'Meta returned no hashtag id.' };
        errors.push(error);
        recordSourceFailure(sourceFailures, 'hashtags', tag, error, config, now);
        continue;
      }
      const response = await fetchGraphMediaWithFallback(
        instagramHashtagMediaUrl(config, hashtagId, true),
        instagramHashtagMediaUrl(config, hashtagId, false),
        config,
        fetchImpl,
      );
      usage.push(response.usage);
      for (const item of Array.isArray(response.payload?.data) ? response.payload.data : []) {
        raw.push({ item, context: { sourceType: 'hashtag', sourceName: `#${tag}`, account: null } });
      }
      clearSourceFailure(sourceFailures, 'hashtags', tag);
    } catch (error) {
      const errorRow = { source: `#${tag}`, status: Number(error?.status || 0), code: error?.code || '', message: safeErrorMessage(error, config) };
      errors.push(errorRow);
      if (isGlobalMetaGraphError(error)) {
        globalError = errorRow;
        break;
      }
      recordSourceFailure(sourceFailures, 'hashtags', tag, error, config, now);
      if ([24, 100].includes(Number(error?.code || 0))) delete hashtagIds[tag];
    }
  }

  return {
    raw,
    errors,
    usage,
    hashtagIds,
    selectedAccounts,
    selectedHashtags,
    sourceFailures,
    skippedAccounts,
    skippedHashtags,
    taggedAttempted,
    globalError,
  };
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

function pruneDiscoveredAccounts(discoveredAccounts, now, ttlDays = 90) {
  const cutoff = now.getTime() - ttlDays * DAY_MS;
  const entries = Object.entries(discoveredAccounts || {})
    .filter(([username, account]) => {
      const timestamp = Date.parse(account?.lastCandidateAt || account?.lastSeenAt || '');
      return /^[a-z0-9._]{1,30}$/i.test(username) && Number.isFinite(timestamp) && timestamp >= cutoff;
    })
    .sort(([, left], [, right]) => (
      (Date.parse(right?.lastCandidateAt || right?.lastSeenAt || '') || 0)
      - (Date.parse(left?.lastCandidateAt || left?.lastSeenAt || '') || 0)
    ))
    .slice(0, 750);
  return Object.fromEntries(entries);
}

function learnGraphAccounts(discoveredAccounts, entry, outcome, now, observedThisRun) {
  const item = entry?.item || {};
  const context = entry?.context || {};
  const publishedAt = toIso(item.timestamp);
  const publishedMs = Date.parse(publishedAt || '');
  if (!Number.isFinite(publishedMs) || publishedMs > now.getTime() + DAY_MS || publishedMs < now.getTime() - 7 * DAY_MS) return;

  const caption = cleanText(item.caption, 5000);
  const relevant = Boolean(outcome?.deal) || hasViennaText(textWithoutHashtags(caption));
  if (!relevant) return;

  const remember = (rawUsername, priority, kind) => {
    const username = normalizedUsername(rawUsername);
    if (!username || !/^[a-z0-9._]{1,30}$/i.test(username)) return;
    if (['instagram', 'freefinder', 'freefinderwien', 'wien', 'vienna'].includes(username)) return;
    const prior = discoveredAccounts[username] || {};
    const origin = `${kind}:${cleanText(context.sourceName || context.sourceType, 80)}`;
    discoveredAccounts[username] = {
      username,
      priority: Math.max(Number(prior.priority || 0), priority),
      category: cleanText(outcome?.deal?.category || prior.category, 60),
      firstSeenAt: toIso(prior.firstSeenAt) || now.toISOString(),
      lastSeenAt: now.toISOString(),
      lastCandidateAt: publishedMs > (Date.parse(prior.lastCandidateAt || '') || 0)
        ? publishedAt
        : cleanText(prior.lastCandidateAt, 80),
      seenCount: Number(prior.seenCount || 0) + 1,
      origins: [...new Set([...(Array.isArray(prior.origins) ? prior.origins : []), origin])].slice(-8),
    };
    observedThisRun.add(username);
  };

  const selectedAccount = normalizedUsername(context?.account?.username);
  const owner = normalizedUsername(item.username || (context.sourceType === 'account' ? selectedAccount : ''));
  if (owner && owner !== selectedAccount) remember(owner, outcome?.deal ? 98 : 62, 'owner');
  for (const username of extractMentionedUsernames({ caption })) {
    if (username === owner || username === selectedAccount) continue;
    remember(username, outcome?.deal ? 88 : 68, 'mention');
  }
}

function updateAccountPerformance(previous, selectedAccounts, outcomes, now) {
  const cutoff = now.getTime() - 180 * DAY_MS;
  const next = Object.fromEntries(Object.entries(previous || {}).filter(([, stats]) => {
    const timestamp = Date.parse(stats?.lastRunAt || '');
    return Number.isFinite(timestamp) && timestamp >= cutoff;
  }));
  for (const account of selectedAccounts || []) {
    const username = normalizedUsername(account.username);
    if (!username) continue;
    const prior = next[username] || {};
    const run = outcomes.get(username) || { fetched: 0, accepted: 0, newAccepted: 0 };
    next[username] = {
      runs: Number(prior.runs || 0) + 1,
      fetched: Number(prior.fetched || 0) + run.fetched,
      accepted: Number(prior.accepted || 0) + run.accepted,
      newAccepted: Number(prior.newAccepted || 0) + run.newAccepted,
      recentFetched: Number((Number(prior.recentFetched || 0) * 0.75 + run.fetched).toFixed(3)),
      recentAccepted: Number((Number(prior.recentAccepted || 0) * 0.75 + run.accepted).toFixed(3)),
      recentNewAccepted: Number((Number(prior.recentNewAccepted || 0) * 0.75 + run.newAccepted).toFixed(3)),
      lastRunAt: now.toISOString(),
      lastAcceptedAt: run.accepted > 0 ? now.toISOString() : cleanText(prior.lastAcceptedAt, 80),
      lastNewAcceptedAt: run.newAccepted > 0 ? now.toISOString() : cleanText(prior.lastNewAcceptedAt, 80),
    };
  }
  return Object.fromEntries(Object.entries(next).slice(-500));
}

function updateHashtagPerformance(previous, selectedHashtags, outcomes, now) {
  const cutoff = now.getTime() - 180 * DAY_MS;
  const next = Object.fromEntries(Object.entries(previous || {}).filter(([, stats]) => {
    const timestamp = Date.parse(stats?.lastRunAt || '');
    return Number.isFinite(timestamp) && timestamp >= cutoff;
  }));
  for (const tag of selectedHashtags || []) {
    const prior = next[tag] || {};
    const run = outcomes.get(tag) || { fetched: 0, accepted: 0, newAccepted: 0 };
    next[tag] = {
      runs: Number(prior.runs || 0) + 1,
      fetched: Number(prior.fetched || 0) + run.fetched,
      accepted: Number(prior.accepted || 0) + run.accepted,
      newAccepted: Number(prior.newAccepted || 0) + run.newAccepted,
      recentFetched: Number((Number(prior.recentFetched || 0) * 0.75 + run.fetched).toFixed(3)),
      recentAccepted: Number((Number(prior.recentAccepted || 0) * 0.75 + run.accepted).toFixed(3)),
      recentNewAccepted: Number((Number(prior.recentNewAccepted || 0) * 0.75 + run.newAccepted).toFixed(3)),
      lastRunAt: now.toISOString(),
      lastAcceptedAt: run.accepted > 0 ? now.toISOString() : cleanText(prior.lastAcceptedAt, 80),
      lastNewAcceptedAt: run.newAccepted > 0 ? now.toISOString() : cleanText(prior.lastNewAcceptedAt, 80),
    };
  }
  return Object.fromEntries(Object.entries(next).slice(-100));
}

export async function runMetaInstagramCollector(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const env = options.env || process.env;
  const config = { ...(options.config || buildConfig(env, now)) };
  const fetchImpl = options.fetchImpl || fetch;
  const state = readJson(config.statePath, {
    version: 4,
    hashtagIds: {},
    seenIds: {},
    acceptedSeenIds: {},
    mediaEvidence: {},
    sourceFailures: {},
    accountPerformance: {},
    hashtagPerformance: {},
    discoveredAccounts: {},
  });
  const previousSeenIds = pruneSeenIds(state?.seenIds || {}, now, config.seenTtlDays);
  const previousAcceptedSeenIds = pruneSeenIds({
    ...(state?.seenIds || {}),
    ...(state?.acceptedSeenIds || {}),
  }, now, config.seenTtlDays);
  const previousDiscoveredAccounts = pruneDiscoveredAccounts(state?.discoveredAccounts, now);
  const previousPayload = readJson(config.outputPath, null);
  const previousGraphEvidence = loadInstagramGraphEvidence(config.graphEvidencePath).payload;
  const lastGoodPayload = previousPayload && Array.isArray(previousPayload.deals)
    ? previousPayload
    : null;
  const accountCatalog = loadAccountCatalog(config, options.paths || {}, {
    ...state,
    discoveredAccounts: previousDiscoveredAccounts,
  });
  const configured = {
    adLibrary: Boolean(config.adLibraryToken),
    instagramGraph: Boolean(config.instagramAccessToken),
  };

  const report = {
    generatedAt: now.toISOString(),
    source: 'meta-instagram',
    status: 'running',
    configured,
    accountCatalogSize: accountCatalog.length,
    selectedAccounts: [],
    selectedHashtags: [],
    discoveryBudget: {
      maxAccountsPerRun: config.maxAccountsPerRun,
      mediaPerAccount: config.mediaPerAccount,
      hashtagPoolSize: config.hashtags.length,
      maxHashtagsPerRun: config.maxHashtagsPerRun,
      mediaPerHashtag: config.mediaPerHashtag,
    },
    sources: {
      adLibrary: { status: configured.adLibrary ? 'pending' : 'not-configured', fetched: 0, accepted: 0, newAccepted: 0, errors: [] },
      instagramGraph: { status: configured.instagramGraph ? 'pending' : 'not-configured', fetched: 0, accepted: 0, newAccepted: 0, errors: [] },
    },
    rejectionReasons: {},
    graphEvidence: { status: configured.instagramGraph ? 'pending' : 'not-configured', observed: 0, retained: 0, blocked: 0 },
    accountDiscovery: { stored: Object.keys(previousDiscoveredAccounts).length, observedThisRun: 0, newThisRun: 0 },
    totalDeals: 0,
  };

  if (!configured.adLibrary && !configured.instagramGraph) {
    report.status = 'not-configured';
    report.message = 'Configure META_AD_LIBRARY_ACCESS_TOKEN and/or INSTAGRAM_ACCESS_TOKEN.';
    report.preservedDeals = lastGoodPayload?.deals?.length || 0;
    const payload = lastGoodPayload || { lastUpdated: now.toISOString(), source: 'meta-instagram', totalDeals: 0, deals: [] };
    if (options.write !== false) {
      writeJsonAtomic(config.reportPath, report);
    }
    return { payload, report, state, shouldFail: config.requireConfiguredSource };
  }

  if (configured.instagramGraph && !config.instagramUserId) {
    const identity = await discoverInstagramGraphIdentity(config, fetchImpl);
    if (identity.userId) {
      config.instagramUserId = identity.userId;
      config.instagramAccessToken = identity.accessToken || config.instagramAccessToken;
      report.sources.instagramGraph.identity = {
        status: 'ok',
        source: identity.source,
        username: identity.username,
      };
    } else {
      report.sources.instagramGraph.status = 'failed';
      report.sources.instagramGraph.identity = {
        status: 'failed',
        source: 'automatic-discovery',
      };
      report.sources.instagramGraph.errors.push(...identity.errors);
    }
  }

  const accepted = [];
  const graphEvidenceEntries = [];
  const discoveredThisRun = new Set();
  const nextState = {
    version: 4,
    updatedAt: now.toISOString(),
    hashtagIds: { ...(state?.hashtagIds || {}) },
    seenIds: { ...previousSeenIds },
    acceptedSeenIds: { ...previousAcceptedSeenIds },
    mediaEvidence: { ...(state?.mediaEvidence || {}) },
    sourceFailures: pruneSourceFailures(state?.sourceFailures, now),
    accountPerformance: { ...(state?.accountPerformance || {}) },
    hashtagPerformance: { ...(state?.hashtagPerformance || {}) },
    discoveredAccounts: { ...previousDiscoveredAccounts },
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
      if (!previousAcceptedSeenIds[normalized.deal.id]) report.sources.adLibrary.newAccepted += 1;
    }
  }

  if (configured.instagramGraph && config.instagramUserId) {
    const result = await collectInstagramGraph(config, accountCatalog, state, now, fetchImpl);
    nextState.hashtagIds = result.hashtagIds;
    nextState.sourceFailures = result.sourceFailures;
    report.selectedAccounts = result.selectedAccounts.map((account) => ({
      username: account.username,
      priority: account.priority,
      verifiedVienna: account.verifiedVienna,
      approvedDeals: Number(account.approvedDeals || 0),
      rejectedDeals: Number(account.rejectedDeals || 0),
    }));
    report.selectedHashtags = result.selectedHashtags;
    report.sources.instagramGraph.skippedCooldown = {
      accounts: result.skippedAccounts,
      hashtags: result.skippedHashtags,
    };
    report.sources.instagramGraph.fetched = result.raw.length;
    report.sources.instagramGraph.errors = result.errors;
    report.sources.instagramGraph.globalError = result.globalError || null;
    const requestedSources = result.selectedAccounts.length
      + result.selectedHashtags.length
      + (result.taggedAttempted ? 1 : 0);
    report.sources.instagramGraph.status = result.globalError && !result.raw.length
      ? 'failed'
      : (requestedSources === 0
          ? ((result.skippedAccounts || result.skippedHashtags) ? 'degraded' : 'ok')
          : (result.errors.length >= requestedSources && !result.raw.length ? 'failed' : (result.errors.length ? 'degraded' : 'ok')));
    const media = await (options.enrichGraphMedia || enrichInstagramGraphMedia)(result.raw, config, now, {
      cache: state?.mediaEvidence,
      mediaFetchImpl: options.mediaFetchImpl,
      openAiFetchImpl: options.openAiFetchImpl,
      execFileImpl: options.execFileImpl,
      tools: options.mediaTools,
      analyzeItem: options.analyzeMediaItem,
      classifyOcr: options.classifyOcr,
    });
    nextState.mediaEvidence = media.cache;
    report.sources.instagramGraph.mediaEvidence = media.report;
    const accountOutcomes = new Map(result.selectedAccounts.map((account) => [account.username, { fetched: 0, accepted: 0, newAccepted: 0 }]));
    const hashtagOutcomes = new Map(result.selectedHashtags.map((tag) => [tag, { fetched: 0, accepted: 0, newAccepted: 0 }]));
    for (const entry of media.entries) {
      const normalized = normalizeGraphMediaItem(entry.item, entry.context, config, now);
      graphEvidenceEntries.push({ entry, outcome: normalized });
      learnGraphAccounts(nextState.discoveredAccounts, entry, normalized, now, discoveredThisRun);
      const isNewAccepted = Boolean(normalized.deal && !previousAcceptedSeenIds[normalized.deal.id]);
      const accountUsername = normalizedUsername(entry.context?.account?.username || (entry.context?.sourceType === 'account' ? entry.item?.username : ''));
      if (accountUsername && accountOutcomes.has(accountUsername)) {
        const outcome = accountOutcomes.get(accountUsername);
        outcome.fetched += 1;
        if (normalized.deal) outcome.accepted += 1;
        if (isNewAccepted) outcome.newAccepted += 1;
      }
      const hashtag = entry.context?.sourceType === 'hashtag'
        ? cleanText(entry.context?.sourceName, 80).replace(/^#/, '').toLowerCase()
        : '';
      if (hashtag && hashtagOutcomes.has(hashtag)) {
        const outcome = hashtagOutcomes.get(hashtag);
        outcome.fetched += 1;
        if (normalized.deal) outcome.accepted += 1;
        if (isNewAccepted) outcome.newAccepted += 1;
      }
      if (!normalized.deal) {
        incrementReason(report.rejectionReasons, normalized.rejection);
        continue;
      }
      accepted.push(normalized.deal);
      report.sources.instagramGraph.accepted += 1;
      if (isNewAccepted) report.sources.instagramGraph.newAccepted += 1;
    }
    nextState.accountPerformance = updateAccountPerformance(
      state?.accountPerformance,
      result.selectedAccounts,
      accountOutcomes,
      now,
    );
    report.sources.instagramGraph.accountYield = Object.fromEntries(result.selectedAccounts.map((account) => {
      const stats = nextState.accountPerformance[account.username] || {};
      return [account.username, {
        recentFetched: Number(stats.recentFetched || 0),
        recentAccepted: Number(stats.recentAccepted || 0),
        recentNewAccepted: Number(stats.recentNewAccepted || 0),
      }];
    }));
    nextState.hashtagPerformance = updateHashtagPerformance(
      state?.hashtagPerformance,
      result.selectedHashtags,
      hashtagOutcomes,
      now,
    );
    report.sources.instagramGraph.hashtagYield = Object.fromEntries(result.selectedHashtags.map((tag) => {
      const stats = nextState.hashtagPerformance[tag] || {};
      return [tag, {
        recentFetched: Number(stats.recentFetched || 0),
        recentAccepted: Number(stats.recentAccepted || 0),
        recentNewAccepted: Number(stats.recentNewAccepted || 0),
      }];
    }));
    nextState.discoveredAccounts = pruneDiscoveredAccounts(nextState.discoveredAccounts, now);
    report.accountDiscovery = {
      stored: Object.keys(nextState.discoveredAccounts).length,
      observedThisRun: discoveredThisRun.size,
      newThisRun: [...discoveredThisRun].filter((username) => !previousDiscoveredAccounts[username]).length,
    };
  }

  const graphEvidence = buildInstagramGraphEvidencePayload(graphEvidenceEntries, {
    now,
    previous: previousGraphEvidence,
    retentionDays: Math.max(14, config.maxOrganicAgeWithExpiryDays * 2),
  });
  report.graphEvidence = {
    status: configured.instagramGraph
      ? (graphEvidenceEntries.length ? 'ok' : 'preserved')
      : 'not-configured',
    observed: graphEvidenceEntries.length,
    retained: graphEvidence.totalPosts,
    blocked: graphEvidence.blockedPosts,
  };

  const allVerifiedDeals = dedupeDeals(accepted);
  for (const deal of allVerifiedDeals) nextState.acceptedSeenIds[deal.id] = now.toISOString();
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
  const newDeals = deals.filter((deal) => !previousAcceptedSeenIds[deal.id]);
  // This is an observation cache only. It must never suppress output because
  // collection is not proof that Slack delivery or durable queueing succeeded.
  for (const deal of deals) nextState.seenIds[deal.id] = now.toISOString();
  const sourceStatuses = Object.values(report.sources).filter((source) => source.status !== 'not-configured').map((source) => source.status);
  const allFailed = sourceStatuses.length > 0 && sourceStatuses.every((status) => status === 'failed');
  report.status = allFailed ? 'failed' : (sourceStatuses.includes('degraded') || sourceStatuses.includes('failed') ? 'degraded' : (deals.length ? 'ok' : 'legitimate-zero'));
  report.totalDeals = deals.length;
  report.newDeals = newDeals.length;
  report.repeatedDeals = deals.length - newDeals.length;
  report.newVerifiedBeforeLimit = allVerifiedDeals.filter((deal) => !previousAcceptedSeenIds[deal.id]).length;
  report.verifiedBeforeLimit = allVerifiedDeals.length;
  report.outputLimit = config.maxDealsPerRun;
  report.freshPostsFetched = report.sources.instagramGraph.fetched;
  report.verifiedDeals = deals.length;
  report.message = deals.length
    ? `${deals.length} evidence-verified Vienna Instagram deals found (${newDeals.length} net-new, ${deals.length - newDeals.length} previously observed).`
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
      newDeals: newDeals.length,
      repeatedDeals: deals.length - newDeals.length,
    },
    deals,
  };
  if (allFailed) {
    report.preservedDeals = lastGoodPayload?.deals?.length || 0;
    report.message = `All configured Meta sources failed; preserved ${report.preservedDeals} last-good deal(s).`;
    const sourceFailuresChanged = JSON.stringify(nextState.sourceFailures) !== JSON.stringify(pruneSourceFailures(state?.sourceFailures, now));
    const failedState = sourceFailuresChanged
      ? { ...state, version: 4, updatedAt: now.toISOString(), sourceFailures: nextState.sourceFailures }
      : state;
    if (options.write !== false) {
      writeJsonAtomic(config.reportPath, report);
      if (sourceFailuresChanged) writeJsonAtomic(config.statePath, failedState);
    }
    return {
      payload: lastGoodPayload || payload,
      report,
      state: failedState,
      graphEvidence: previousGraphEvidence,
      shouldFail: true,
    };
  }
  if (options.write !== false) {
    writeJsonAtomic(config.outputPath, payload);
    writeJsonAtomic(config.reportPath, report);
    writeJsonAtomic(config.statePath, nextState);
    if (configured.instagramGraph) writeInstagramGraphEvidence(graphEvidence, config.graphEvidencePath);
  }
  return { payload, report, state: nextState, graphEvidence, shouldFail: allFailed };
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

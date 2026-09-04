import '../sentry/instrument.mjs';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

import { normalizeCategoryForScraper } from './category-utils.js';
import { advanceDealLifecycle } from './deal-lifecycle.js';
import { inferPreferredBrand } from './deal-normalization-utils.js';
import { resolveInstagramPostEntities } from './instagram-entity-resolution.js';
import { extractActiveOfferWindow, unicodeSafeTruncate } from './instagram-ai-validity-utils.js';
import {
  classifySocialMediaEvidenceWithOpenAI,
  enrichInstagramGraphMedia,
  extractInstagramMediaAssets,
} from './instagram-media-evidence.js';
import {
  extractBirthdayEntryOffer,
  getEditorialRoundupPromotionReason,
  getInboundForeignTravelPromotionReason,
  getInfrastructureOnlyPromotionReason,
  getLeadGenerationOnlyPromotionReason,
  getMembershipOnlyPromotionReason,
  getNonOfferContentReason,
  getNonGuaranteedPromotionReason,
} from './promotion-quality-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const OUTPUT_PATH = path.join(DOCS_DIR, 'deals-pending-tiktok.json');
const REPORT_PATH = path.join(DOCS_DIR, 'tiktok-scanner-report.json');
const MEDIA_CACHE_PATH = path.join(DOCS_DIR, 'tiktok-media-evidence-cache.json');

const DAY_MS = 24 * 60 * 60 * 1000;
const CONFIG = {
  maxAgeDays: Math.min(7, Math.max(1, Number(process.env.TIKTOK_MAX_AGE_DAYS || 7) || 7)),
  maxPostsToVisit: Number(process.env.TIKTOK_MAX_POSTS || 120),
  maxDeals: Number(process.env.TIKTOK_MAX_DEALS || 50),
  minScore: Number(process.env.TIKTOK_MIN_SCORE || 58),
  apiSearchPages: Number(process.env.TIKTOK_SEARCH_PAGES || 3),
  apiSearchCount: Number(process.env.TIKTOK_SEARCH_COUNT || 30),
  maxApiCandidates: Number(process.env.TIKTOK_MAX_API_CANDIDATES || 1200),
};

const SEARCH_QUERIES = [
  'site:tiktok.com/@ wien gratis heute',
  'site:tiktok.com/@ wien nur heute gratis',
  'site:tiktok.com/@ wien gratis essen',
  'site:tiktok.com/@ wien gratis kaffee',
  'site:tiktok.com/@ wien gratis drink',
  'site:tiktok.com/@ wien gratis eintritt',
  'site:tiktok.com/@ wien kostenlos eintritt',
  'site:tiktok.com/@ wien gratis event',
  'site:tiktok.com/@ vienna free entry',
  'site:tiktok.com/@ vienna free drinks',
  'site:tiktok.com/@ wien gratis pizza burger kebab',
  'site:tiktok.com/@ wien neueröffnung gratis',
  'site:tiktok.com/@ wien eröffnung gratis essen',
  'site:tiktok.com/@ wien döner 1+1',
  'site:tiktok.com/@ wien opening free food',
  'site:tiktok.com/@ vienna free coffee',
  'site:tiktok.com/@ vienna free food',
  'site:tiktok.com/@ wien 1+1 restaurant',
  'site:tiktok.com/@ wien 2 für 1 essen',
  'site:tiktok.com/@ wien happy hour deal',
  'site:tiktok.com/@ wien rabatt gutschein',
  'site:tiktok.com/@ wien gratis probetraining',
  'site:tiktok.com/@ wien gratis goodie bag',
  'site:tiktok.com/@ wien kostenlos aktion',
  'site:tiktok.com/@ tiktok wien gratis',
];

const CORE_TIKTOK_API_KEYWORDS = [
  'wien gratis heute',
  'wien nur heute gratis',
  'wien kostenlos heute',
  'wien gratis essen',
  'wien gratis kaffee',
  'wien gratis drink',
  'wien gratis drinks',
  'wien gratis eintritt',
  'wien kostenlos eintritt',
  'wien gratis event',
  'wien gratis festival',
  'wien gratis museum',
  'wien free entry',
  'vienna free entry',
  'vienna free admission',
  'vienna free drinks',
  'wien gratis pizza',
  'wien gratis burger',
  'wien gratis kebab',
  'wien döner gratis',
  'wien döner 1+1',
  'wien 1+1 döner',
  'wien pizza 1+1',
  'wien neueröffnung gratis',
  'wien eröffnung gratis essen',
  'wien neueröffnung döner',
  'wien opening free food',
  'vienna opening free food',
  'vienna free coffee',
  'vienna free food',
  'wien 1+1 restaurant',
  'wien 2 für 1 essen',
  'wien happy hour deal',
  'wien rabatt gutschein',
  'wien 50 rabatt',
  'wien gratis probetraining',
  'wien gratis goodie bag',
  'wien kostenlos aktion',
];

const TIKTOK_SEED_ACCOUNT_KEYWORDS = [
  'dahabdoener gratis',
  'fitnessunionwien kostenlos',
  'viennas_joy gratis',
  'viennas joy free entry',
  'kseniainvienna free drinks',
  'foodiewien gratis',
  'foodiewien deal',
  'eatinvienna gratis',
  'eatinvienna deal',
  'tasteofvienna gratis',
  'foodspots_vienna gratis',
  'robert.erobert wien gratis',
  'shaysfoodblog wien gratis',
  'neotaste wien deal',
  'bestekorpe wien gratis',
  'wienerkebapmehmetusta gratis',
  'tastyfoodvienna gratis',
  'dishthedirt vienna free',
];

const GERMAN_MONTHS = [
  'januar', 'februar', 'märz', 'april', 'mai', 'juni',
  'juli', 'august', 'september', 'oktober', 'november', 'dezember',
];
const ENGLISH_MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

export function buildTikTokApiKeywords(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Vienna',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(now).filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
  const year = parts.year;
  const monthIndex = parts.month - 1;
  const day = parts.day;
  const nextMonthIndex = (monthIndex + 1) % 12;
  const nextYear = monthIndex === 11 ? year + 1 : year;
  const currentGermanMonth = GERMAN_MONTHS[monthIndex];
  const currentEnglishMonth = ENGLISH_MONTHS[monthIndex];
  const nextGermanMonth = GERMAN_MONTHS[nextMonthIndex];
  const nextEnglishMonth = ENGLISH_MONTHS[nextMonthIndex];
  const currentQueries = [
    `wien gratis ${day} ${currentGermanMonth} ${year}`,
    `wien deal ${day} ${currentGermanMonth} ${year}`,
    `wien gratis ${currentGermanMonth} ${year}`,
    `wien aktion ${currentGermanMonth} ${year}`,
    `wien rabatt ${currentGermanMonth} ${year}`,
    `wien 1+1 ${currentGermanMonth} ${year}`,
    `wien neueröffnung ${currentGermanMonth} ${year}`,
    `vienna deals ${currentEnglishMonth} ${year}`,
    `vienna free ${currentEnglishMonth} ${year}`,
    `wien gratis ${nextGermanMonth} ${nextYear}`,
    `wien deal ${nextGermanMonth} ${nextYear}`,
    `vienna deals ${nextEnglishMonth} ${nextYear}`,
    'wien dieses wochenende gratis',
  ];
  return [...new Set([...currentQueries, ...CORE_TIKTOK_API_KEYWORDS, ...TIKTOK_SEED_ACCOUNT_KEYWORDS])];
}

const TIKTOK_API_KEYWORDS = buildTikTokApiKeywords();

const VIENNA_PATTERNS = [
  /\bwien\b/i,
  /\bvienna\b/i,
  /\b1(?:0[1-9]0|1[0-9]0|2[0-3]0)\b/i,
  /\binnere stadt|leopoldstadt|landstraße|landstrasse|wieden|margareten|mariahilf|neubau|josefstadt|alsergrund|favoriten|meidling|hietzing|penzing|rudolfsheim|ottakring|hernals|währing|waehring|döbling|doebling|brigittenau|floridsdorf|donaustadt|liesing\b/i,
];

const CONFLICT_LOCATION_PATTERNS = [
  /\bgraz\b/i,
  /\blinz\b/i,
  /\bsalzburg\b/i,
  /\binnsbruck\b/i,
  /\bklagenfurt\b/i,
  /\bst\.?\s*pölten\b/i,
  /\bst\.?\s*poelten\b/i,
  /\btirol\b/i,
  /\bvorarlberg\b/i,
  /\bkärnten\b/i,
  /\bkaernten\b/i,
  /\bmünchen\b/i,
  /\bmunich\b/i,
  /\bberlin\b/i,
  /\bhamburg\b/i,
  /\bzürich\b/i,
  /\bzurich\b/i,
  /\bvalencia\b/i,
  /\bgading\s+serpong\b/i,
  /\bjakarta\b/i,
  /\blos\s+angeles\b/i,
  /\bsan\s+(?:francisco|diego|jose)\b/i,
  /\bnew\s+york\b/i,
  /\b(?:chicago|miami|boston|seattle|houston|dallas|las\s+vegas)\b/i,
  /\bvienna\s*,?\s*(?:va|virginia)\b/i,
  /\b(?:northern\s+virginia|reston|gainesville|warrenton|arlington|mclean|fairfax)\b/i,
  /(?:#dmv\b|\bwashington\s*,?\s*d\.?c\.?\b)/i,
  /\bindonesien\b/i,
  /\bindonesia\b/i,
  /\bunited\s+states\b/i,
  /\bvereinigte\s+staaten\b/i,
  /\bu\.?s\.?a\.?\b/i,
];

const STRONG_DEAL_PATTERNS = [
  /\bgratis\b/i,
  /\bkostenlos(?:e|er|es|en)?\b/i,
  /\bfree\b/i,
  /\beintritt\s+frei\b/i,
  /\bfreier\s+eintritt\b/i,
  /\b0\s*€/i,
  /\b1\s*\+\s*1\b/i,
  /\b2\s*(?:für|fuer)\s*1\b/i,
  /\bbogo\b/i,
  /\b\d{1,2}\s*%\s*(?:rabatt|discount|off)\b/i,
  /\b(?:rabatt|gutschein|coupon|voucher|deal|aktion|happy hour|goodie bag)\b/i,
  /\bneueröffnung|neueroeffnung|opening offer|opening deal\b/i,
];

const FALSE_POSITIVE_PATTERNS = [
  /\bgewinnspiel\b/i,
  /\bverlosung\b/i,
  /\bjob\b/i,
  /\bno ink needed\b/i,
  /\bstudyhacks?\b/i,
  /\bamazonfinds?\b/i,
  /\bwie gratis\?/i,
  /\bjetzt kostenlos testen\b/i,
  /\bnotidesk\b/i,
  /\bfinden statt suchen\b/i,
  /\bgeschenke,\s*restaurants\s*&\s*aktivitäten\b/i,
  /\banzeige\b/i,
  /\bgar\s*kein\b/i,
  /\bgarkein\b/i,
  /\bkein\s+\w+\s+enthalten\b/i,
  /\bjemanden gefunden der hilft\b/i,
  /\bwohnung\b/i,
  /\bhotelzimmer\b/i,
  /\bairbnb\b/i,
  /\bkostenlos stornieren\b/i,
  /\bthings to do\b/i,
  /\bwochenendtipps\b/i,
  /\bwir zeigen dir\b/i,
  /\bwir haben für euch\b/i,
  /\bgesammelt\b/i,
  /\bwas in wien geht\b/i,
  /\b(?:amount\s+of|so\s+many|viele|zahlreiche)\s+(?:free|gratis|kostenlose\w*)\s+(?:events?|veranstaltungen?)\b/i,
  /\bfree\s+events?\s+happening\s+all\s+the\s+time\b/i,
];

const NON_DEAL_CONTENT_RULES = [
  {
    reason: 'rhetorische Gratis-Aussage ohne kostenlosen Deal',
    pattern: /\b(?:fast|quasi|beinahe|almost|nearly)\s+(?:gratis|kostenlos|free)\b/i,
  },
  {
    reason: 'reguläre Altersstaffel statt Sonderaktion',
    pattern: /\b(?:children|kids|kinder)\b[^.!?]{0,45}\b(?:under|unter|bis)\s*\d{1,2}\b[^.!?]{0,35}\b(?:free|gratis|kostenlos)\b[^.!?]{0,100}\b\d{1,2}\s*[-–]\s*\d{1,2}\s*(?:years?|jahre?)?\b[^.!?]{0,30}\b\d{1,3}\s*(?:€|eur\b|euro\b)/i,
  },
  {
    reason: 'kostenlose Infrastruktur statt Deal',
    pattern: /\b(?:(?:gratis|kostenlos(?:e|er|es|en)?|free)\s+(?:kunden[- ]?)?(?:parkpl[aä]tze?|parking|toiletten?|wcs?|ladestationen?|charging\s+stations?)|(?:parkpl[aä]tze?|parking|toiletten?|wcs?|ladestationen?|charging\s+stations?)\s+(?:gratis|kostenlos|free))\b/i,
  },
  {
    reason: 'kostenlose Infrastruktur statt Deal',
    pattern: /\b(?:pissoirs?|urinals?|klos?|(?:public|öffentlich\w*)\s+(?:toilets?|toiletten?|wcs?|drinking[- ]?water|trinkwasser|wasser(?:brunnen|stationen?))|drinking[- ]?water\s+(?:fountains?|stations?)|water\s+(?:fountains?|stations?)|trinkwasserbrunnen)\b/i,
  },
  {
    reason: 'persönliche Kulanz statt öffentlich nutzbarem Deal',
    pattern: /\b(?:(?:gratis|kostenlos(?:e|er|es|en)?|free)\b.{0,100}\b(?:als\s+ersatz|entschädigung|entschaedigung|wiedergutmachung)|(?:als\s+ersatz|entschädigung|entschaedigung|wiedergutmachung)\b.{0,100}\b(?:gratis|kostenlos|free))\b/i,
  },
  {
    reason: 'allgemeine Event-Sammlung statt konkretem Deal',
    pattern: /\bdein(?:e|en)?\s+(?:gratis\s*\/\s*)?pay\s+as\s+you\s+wish\s+woch(?:en)?ende\b.{0,140}\b(?:von\s+mir\s+für\s+dich|events?|flohmarkt|rave)\b/i,
  },
  {
    reason: 'allgemeiner Reiseguide statt konkretem Deal',
    pattern: /\b(?:travel\s+bucket\s+list|top\s+(?:vienna\s+)?spots?|first\s+trip|vienna\s+guide|save\s+this\s+post\s+for\s+(?:your\s+)?itinerary|cosa\s+si\s+pu[oò]\s+vedere\s+a\s+vienna\s+gratis)\b/i,
  },
  {
    reason: 'allgemeine Empfehlung statt konkretem Deal',
    pattern: /\b(?:stand\s+schon\s+so\s+lange\s+auf\s+meiner\s+liste|wirklich\s+nur\s+empfehlen|kann(?:'|’)?s?\s+euch\s+wirklich\s+empfehlen)\b/i,
  },
];

const FREEFINDER_SELF_ACCOUNT_KEYS = new Set([
  'freefinder',
  'freefinderat',
  'freefinderwien',
]);

const FOREIGN_LOCATION_HANDLE_PATTERNS = [
  /valencia/i,
];

const CATEGORY_RULES = [
  { category: 'kaffee', logo: '☕', pattern: /\b(kaffee|coffee|cafe|café|matcha|espresso|latte|cappuccino|drink|drinks|getränk|getraenk|mocktail|mocktails|bubble tea|boba)\b/i },
  { category: 'essen', logo: '🍽️', pattern: /\b(essen|food|restaurant|pizza|burger|kebab|kebap|döner|doener|sushi|ramen|brunch|croissant|wrap|falafel|eis|gelato|snack|schokolade|chocolate|erdbeer\w*|strawberr(?:y|ies)|dessert|chocoberry)\b/i },
  { category: 'fitness', logo: '💪', pattern: /\b(fitness|gym|probetraining|workout|yoga|pilates|training)\b/i },
  { category: 'beauty', logo: '💄', pattern: /\b(beauty|kosmetik|make.?up|parfum|goodie bag|haare|friseur|barber)\b/i },
  { category: 'kultur', logo: '🎟️', pattern: /\b(kino|ticket|eintritt|entry|admission|museum|theater|konzert|festival|event|ausstellung|mittelalterfest|stift|klosterneuburg|prater)\b/i },
  { category: 'shopping', logo: '🛍️', pattern: /\b(shop|store|shopping|sale|gutschein|coupon|rabattcode|fashion|sneaker)\b/i },
];

const MONTH_NAMES = new Map([
  ['jänner', 1],
  ['jaenner', 1],
  ['januar', 1],
  ['februar', 2],
  ['märz', 3],
  ['maerz', 3],
  ['april', 4],
  ['mai', 5],
  ['maj', 5],
  ['maja', 5],
  ['juni', 6],
  ['juli', 7],
  ['august', 8],
  ['september', 9],
  ['oktober', 10],
  ['november', 11],
  ['dezember', 12],
]);

function cleanText(value = '', max = 1600) {
  const cleaned = String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return unicodeSafeTruncate(cleaned, max);
}

function boundedNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Math.max(minimum, Math.min(maximum, Number.isFinite(number) ? number : fallback));
}

function booleanEnv(env, name, fallback) {
  const raw = cleanText(env?.[name], 20).toLowerCase();
  if (!raw) return fallback;
  return !['0', 'false', 'no', 'off'].includes(raw);
}

export function buildTikTokMediaConfig(env = process.env) {
  const openAiApiKey = cleanText(env.OPENAI_API_KEY, 700);
  const mediaLlmEnabled = booleanEnv(env, 'TIKTOK_MEDIA_LLM_ENABLED', Boolean(openAiApiKey)) && Boolean(openAiApiKey);
  const mediaVisionEnabled = booleanEnv(env, 'TIKTOK_MEDIA_VISION_ENABLED', mediaLlmEnabled) && mediaLlmEnabled;
  const mediaMaxAgeHours = boundedNumber(env.TIKTOK_MEDIA_MAX_AGE_HOURS, 72, 12, 168);
  return {
    maxOrganicAgeWithExpiryDays: mediaMaxAgeHours / 24,
    mediaMaxAgeHours,
    mediaOcrEnabled: booleanEnv(env, 'TIKTOK_MEDIA_OCR_ENABLED', mediaLlmEnabled) && mediaLlmEnabled,
    mediaMaxPostsPerRun: boundedNumber(env.TIKTOK_MEDIA_MAX_POSTS_PER_RUN, 16, 0, 30),
    mediaMaxAssetsPerPost: boundedNumber(env.TIKTOK_MEDIA_MAX_ASSETS_PER_POST, 2, 1, 4),
    mediaMaxVideoFrames: boundedNumber(env.TIKTOK_MEDIA_MAX_VIDEO_FRAMES, 2, 1, 6),
    mediaMaxBytes: boundedNumber(env.TIKTOK_MEDIA_MAX_BYTES, 25 * 1024 * 1024, 1024 * 1024, 50 * 1024 * 1024),
    mediaDownloadTimeoutMs: boundedNumber(env.TIKTOK_MEDIA_DOWNLOAD_TIMEOUT_MS, 20000, 3000, 60000),
    mediaOcrConcurrency: boundedNumber(env.TIKTOK_MEDIA_OCR_CONCURRENCY, 2, 1, 4),
    mediaOcrMaxTextChars: boundedNumber(env.TIKTOK_MEDIA_OCR_MAX_TEXT_CHARS, 4000, 500, 8000),
    ocrTimeoutMs: boundedNumber(env.TIKTOK_MEDIA_OCR_TIMEOUT_MS, 30000, 5000, 90000),
    mediaTesseractTimeoutMs: boundedNumber(env.TIKTOK_MEDIA_TESSERACT_TIMEOUT_MS, 8000, 2000, 30000),
    mediaCacheTtlDays: boundedNumber(env.TIKTOK_MEDIA_CACHE_TTL_DAYS, 7, 1, 14),
    mediaLlmEnabled,
    mediaVisionEnabled,
    mediaVisionMaxImagesPerPost: boundedNumber(env.TIKTOK_MEDIA_VISION_MAX_IMAGES_PER_POST, 3, 1, 4),
    mediaVisionMaxImageBytes: boundedNumber(env.TIKTOK_MEDIA_VISION_MAX_IMAGE_BYTES, 1_500_000, 128_000, 3_000_000),
    mediaVisionDetail: ['low', 'high', 'auto'].includes(cleanText(env.TIKTOK_MEDIA_VISION_DETAIL, 20).toLowerCase())
      ? cleanText(env.TIKTOK_MEDIA_VISION_DETAIL, 20).toLowerCase()
      : 'high',
    mediaLlmModel: cleanText(env.TIKTOK_MEDIA_LLM_MODEL || env.OPENAI_MODEL || 'gpt-4.1-mini', 100),
    mediaLlmMaxCallsPerRun: boundedNumber(env.TIKTOK_MEDIA_LLM_MAX_CALLS_PER_RUN, 12, 0, 20),
    mediaLlmConcurrency: boundedNumber(env.TIKTOK_MEDIA_LLM_CONCURRENCY, 2, 1, 4),
    mediaLlmMinOcrChars: boundedNumber(env.TIKTOK_MEDIA_LLM_MIN_OCR_CHARS, 12, 5, 200),
    mediaLlmMinConfidence: boundedNumber(env.TIKTOK_MEDIA_LLM_MIN_CONFIDENCE, 0.84, 0.5, 1),
    mediaLlmTimeoutMs: boundedNumber(env.TIKTOK_MEDIA_LLM_TIMEOUT_MS, 30000, 5000, 90000),
    mediaRequestHeaders: {
      referer: 'https://www.tiktok.com/',
      'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
    },
    openAiApiKey,
  };
}

function readJson(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function loadTikTokMediaCache(filePath = MEDIA_CACHE_PATH) {
  const payload = readJson(filePath);
  const cache = payload?.mediaEvidence || payload;
  return cache && typeof cache === 'object' ? cache : {};
}

function writeJsonAtomic(filePath, value) {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tempPath, filePath);
}

function rejectionReasonCounts(rejected) {
  const counts = {};
  for (const item of rejected) {
    const reason = cleanText(item?.reason, 160) || 'unbekannt';
    counts[reason] = (counts[reason] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((left, right) => right[1] - left[1]));
}

function summarizeTikTokRejection(url, data = {}, reason = '', keyword = '') {
  const publication = parseDateFromPost(data);
  return {
    url: normalizeTikTokVideoUrl(url || data.url || data.finalUrl),
    keyword: cleanText(keyword, 180),
    reason: cleanText(reason, 240),
    title: cleanText(data.title, 500),
    description: cleanText(data.description, 1200),
    ownerUsername: cleanText(data.accountHandle, 80),
    pubDate: publication?.date?.toISOString() || '',
    pubDateSource: cleanText(publication?.source, 120),
    mediaType: cleanText(data.mediaType, 40),
  };
}

function stableHash(value = '') {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
    hash >>>= 0;
  }
  return hash.toString(36);
}

function normalizeTikTokVideoUrl(value = '') {
  const raw = cleanText(value, 1200);
  if (!raw) return '';

  let candidate = raw;
  try {
    const parsed = new URL(raw);
    const redirect = parsed.searchParams.get('uddg') || parsed.searchParams.get('url') || parsed.searchParams.get('u');
    if (redirect) candidate = decodeURIComponent(redirect);
  } catch {}

  const decoded = candidate
    .replace(/\\u002F/g, '/')
    .replace(/&amp;/g, '&');
  const match = decoded.match(/https?:\/\/(?:www\.|m\.)?tiktok\.com\/@([A-Za-z0-9._-]{2,40})\/video\/(\d{8,30})/i);
  if (!match) return '';
  return `https://www.tiktok.com/@${match[1]}/video/${match[2]}`;
}

function extractViennaEvidence(text) {
  const signal = cleanText(text, 2600);
  if (CONFLICT_LOCATION_PATTERNS.some((pattern) => pattern.test(signal))) return '';
  const match = VIENNA_PATTERNS
    .map((pattern) => signal.match(pattern))
    .find(Boolean);
  if (!match || !Number.isFinite(match.index)) return '';
  const start = Math.max(0, match.index - 90);
  const end = Math.min(signal.length, match.index + match[0].length + 90);
  return cleanText(signal.slice(start, end), 220);
}

function withoutNonOfferFreeTerms(value) {
  return cleanText(value, 2600)
    .replace(/\b(?:(?:gratis|kostenlos(?:e[rmns]?|en)?|free)\s+(?:lieferung|versand|zustellung|shipping|delivery)|(?:lieferung|versand|zustellung|shipping|delivery)\s+(?:gratis|kostenlos|free))(?:\s+(?:in|nach|innerhalb)\s+[^.!?,;]{0,60})?/gi, ' ')
    .replace(/\b(?:gluten|sugar|zucker|alcohol|alkohol|dairy|lactose|laktose|cruelty|fat|caffeine|koffein|plastic|smoke|tax|risk|nut|gmo)[-\s]?free\b/gi, ' ')
    .replace(/\b(?:feel\s+free|free[-\s]?flow)\b/gi, ' ');
}

function hasSpecificViennaEvidence(text) {
  const signal = cleanText(text, 2600).replace(/#[\w.äöüß-]+/gi, ' ');
  return /\b1(?:0[1-9]0|1[0-9]0|2[0-3]0)\b/i.test(signal)
    || /\b(?:wien|vienna)\s*,?\s*(?:österreich|oesterreich|austria)\b/i.test(signal)
    || /\b(?:innere stadt|leopoldstadt|landstraße|landstrasse|wieden|margareten|mariahilf|neubau|josefstadt|alsergrund|favoriten|meidling|hietzing|penzing|rudolfsheim|ottakring|hernals|währing|waehring|döbling|doebling|brigittenau|floridsdorf|donaustadt|liesing)\b/i.test(signal);
}

function hasStrongDealSignal(text) {
  const signal = cleanText(text, 2600);
  const offerText = withoutNonOfferFreeTerms(signal).replace(/#[\w.äöüß-]+/gi, ' ');
  if (!extractBirthdayEntryOffer(offerText)
      && !STRONG_DEAL_PATTERNS.some((pattern) => pattern.test(offerText))) return false;
  if (FALSE_POSITIVE_PATTERNS.some((pattern) => pattern.test(signal))) return false;
  return true;
}

function getTikTokContentQualityReason(text) {
  const signal = cleanText(text, 2600);
  const signalWithoutNonOfferFreeTerms = withoutNonOfferFreeTerms(signal);
  const hasShippingBenefit = /\b(?:(?:gratis|kostenlos(?:e[rmns]?|en)?|free)\s+(?:lieferung|versand|zustellung|shipping|delivery)|(?:lieferung|versand|zustellung|shipping|delivery)\s+(?:gratis|kostenlos|free))\b/i.test(signal);
  if (hasShippingBenefit
      && !extractBirthdayEntryOffer(signalWithoutNonOfferFreeTerms)
      && !STRONG_DEAL_PATTERNS.some((pattern) => pattern.test(signalWithoutNonOfferFreeTerms))) {
    return 'nur Gratis-Lieferung/Versand, kein eigentlicher Deal';
  }
  const nonDealRule = NON_DEAL_CONTENT_RULES.find((rule) => rule.pattern.test(signal));
  if (nonDealRule) return nonDealRule.reason;
  return getNonOfferContentReason(signal)
    || getNonGuaranteedPromotionReason(signal)
    || getEditorialRoundupPromotionReason(signal)
    || getInboundForeignTravelPromotionReason(signal)
    || getInfrastructureOnlyPromotionReason(signal)
    || getMembershipOnlyPromotionReason(signal)
    || getLeadGenerationOnlyPromotionReason(signal);
}

function inferType(text) {
  const signal = withoutNonOfferFreeTerms(text);
  if (/\b1\s*\+\s*1\b|\b2\s*(?:für|fuer)\s*1\b|\bbogo\b/i.test(signal)) return 'bogo';
  if (extractBirthdayEntryOffer(signal)) return 'rabatt';
  if (/\bgratis\b|\bkostenlos|\bfree\b|\b0\s*€/i.test(signal)) return 'gratis';
  return 'rabatt';
}

function isDysonStylingOffer(text) {
  const signal = cleanText(text, 2200);
  return /\bdyson\b/i.test(signal)
    && /\b(?:styling\s+tour|styling\s+pop[- ]?up|pop[- ]?up|hair\s+(?:styled|styling)|haarstyling|haare?\b[^.!?]{0,50}\bstylen)\b/i.test(signal);
}

function inferCategoryAndLogo(text, type) {
  if (isDysonStylingOffer(text)) {
    return { category: 'beauty', logo: '💇' };
  }
  if (/\b(?:afro\s+)?dance\s+class\b|\b(?:afro[- ]?)?tanzkurs\b/i.test(text)) {
    return { category: 'freizeit', logo: '💃' };
  }
  if (/\b(eintritt|entry|admission|festival|event|museum|garten|botanisch|stadtpark|stift|klosterneuburg)\b/i.test(text)) {
    return { category: 'kultur', logo: '🎟️' };
  }
  const concreteFoodIndex = text.search(/\b(?:pizza|burger|kebab|kebap|döner|doener|sushi|ramen|pasta|taco|falafel|croissant|eis|gelato|dessert|all[-\s]?you[-\s]?can[-\s]?eat)\b/i);
  const concreteDrinkIndex = text.search(/\b(?:kaffee|coffee|cafe|café|matcha|espresso|latte|cappuccino|drink|drinks|getränk|getraenk|mocktail|cocktail|bubble\s*tea|boba)\b/i);
  if (concreteFoodIndex >= 0 && (concreteDrinkIndex < 0 || concreteFoodIndex < concreteDrinkIndex)) {
    return { category: 'essen', logo: '🍽️' };
  }
  if (concreteDrinkIndex >= 0) return { category: 'kaffee', logo: '☕' };
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(text)) return { category: rule.category, logo: rule.logo };
  }
  if (type === 'gratis') return { category: 'gratis', logo: '🎁' };
  return { category: 'shopping', logo: '🎯' };
}

function extractBrand(text, accountHandle) {
  const signal = cleanText(text, 800);
  if (/^woa(?:\.vienna)?$/i.test(String(accountHandle || '').replace(/^@/, '').trim())) {
    return 'WOA';
  }
  const knownProviders = [
    { pattern: /\bdatri\s+boxing\b/i, name: 'Datri Boxing' },
    { pattern: /\bchocoberry\b/i, name: 'Chocoberry' },
    { pattern: /\bcafe\s+milano\b/i, name: 'Cafe Milano' },
    { pattern: /\bdyson(?:\s+dach)?\b/i, name: 'Dyson' },
    { pattern: /\bsipsy\b/i, name: 'SIPSY' },
    { pattern: /\bsoundcube\b/i, name: 'Soundcube' },
    { pattern: /\bpalace\s+of\s+justice\b/i, name: 'Palace of Justice Vienna' },
    { pattern: /@wukvienna\b|\bwuk\s+vienna\b/i, name: 'WUK Wien' },
  ];
  const knownProvider = knownProviders.find((provider) => provider.pattern.test(signal));
  if (knownProvider) return knownProvider.name;
  const knownVenue = signal.match(/\b(Stift Klosterneuburg|Silent Disco Austria|Dahab Döner|Fitness Union Wien|Botanischer Garten Wien|Botanische(?:r|n)? Garten|Filipino Food Festival Austria|FilipinoFoodFestivalAustria|Genuss-Festival Wien|GENUSS-FESTIVAL VIENNA|Zlatno Ćoše|Zlatno Cose)\b/i);
  if (knownVenue?.[1]) return cleanText(knownVenue[1], 80);

  const patterns = [
    /\bbei\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß0-9&'. -]{2,45})/i,
    /\bvon\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß0-9&'. -]{2,45})/i,
    /\bbeim?\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß0-9&'. -]{2,45})/i,
    /^([A-ZÄÖÜ][A-Za-zÄÖÜäöüß0-9&'. -]{2,45})\s+(?:schenkt|gibt|macht|startet|eröffnet|eroeffnet)/i,
  ];
  for (const pattern of patterns) {
    const match = signal.match(pattern);
    if (!match?.[1]) continue;
    const candidate = cleanText(match[1], 80).replace(/[.!?:;].*$/, '').trim();
    if (!isWeakBrandCandidate(candidate)) return candidate;
  }
  return accountHandle ? `@${accountHandle}` : 'TikTok Wien';
}

function isWeakBrandCandidate(value) {
  const normalized = cleanText(value, 120).toLowerCase();
  if (!normalized) return true;
  if (normalized.split(/\s+/).length > 5) return true;
  return /\b(wien entfernt|vienna entfernt|könnt|koennt|kannst|euch|ihr|meinem|besuch|heute|morgen|nur|gratis|kostenlos|free|angebot|deal|zeitreise|mit|statt|aussehen|immer wieder|platzkonzerten)\b/i.test(normalized)
    || /^am\s+\d/i.test(normalized);
}

function buildOfferTitle(text, brand, type) {
  const signal = cleanText(text, 1200);
  const venueMatch = signal.match(/\b(?:beim?|bei)\s+(Stift Klosterneuburg)\b/i);
  const venue = cleanText(venueMatch?.[1] || '', 80);
  const birthdayEntryOffer = extractBirthdayEntryOffer(signal);
  if (birthdayEntryOffer && type === 'rabatt') {
    return `Birthday-Special: Eintritt um ${birthdayEntryOffer.amount} €${brand ? ` bei ${brand}` : ''}`;
  }
  if (/\bgratis(?:es|er|en)?\s+all[-\s]?you[-\s]?can[-\s]?eat\b/i.test(signal)
      && /\bschüler(?::innen|innen)?\b/i.test(signal)) {
    return `Gratis All-you-can-eat für Schüler:innen${brand ? ` bei ${brand}` : ''}`;
  }
  if (/\b(?:sunset\s+cinema|cinemagic)\b/i.test(signal)
      && /\b(?:gratis|kostenlos(?:e|er|es|en)?|free)\b/i.test(signal)
      && /\bopen[- ]?air[- ]?kino\b/i.test(signal)) {
    return /\bweghuberpark\b/i.test(signal)
      ? 'Gratis Open-Air-Kino Sunset Cinema im Weghuberpark'
      : 'Gratis Open-Air-Kino Sunset Cinema';
  }
  if (isDysonStylingOffer(signal) && /\b(?:gratis|kostenlos(?:e|er|es|en)?|free)\b/i.test(signal)) {
    return /\bfree\s+drinks?|gratis(?:e|en)?\s+getränke?|kostenlose\s+getränke?/i.test(signal)
      ? 'Gratis Haarstyling und Drinks beim Dyson Pop-up'
      : 'Gratis Haarstyling beim Dyson Pop-up';
  }
  if (/\bsoundcube\b/i.test(signal)
      && /\b(?:kids?[’']?\s+)?(?:afro\s+)?dance\s+class\b|\b(?:afro[- ]?)?tanzkurs\b/i.test(signal)
      && /\b(?:gratis|kostenlos(?:e|er|es|en)?|free)\b/i.test(signal)) {
    return /\bkids?[’']?|\bkinder\b|\bage\s*\(?\s*7\s*[-–]\s*12/i.test(signal)
      ? 'Kostenloser Afro-Dance-Kurs für Kinder im Soundcube'
      : 'Kostenloser Afro-Dance-Kurs im Soundcube';
  }
  if (/\bsipsy\b/i.test(signal)
      && /\blaunch\s+party\b/i.test(signal)
      && /\b(?:kostenlose\w*|gratis|free)\s+mocktails?\b/i.test(signal)) {
    return 'Gratis Mocktails bei der SIPSY Launch Party';
  }
  if (/\bcafe\s+milano\b/i.test(signal) && /\bhappy\s+hour\b/i.test(signal) && /\b(?:pool|billard)\b[^.!?]{0,24}\b(?:free|gratis|kostenlos)\b/i.test(signal)) {
    return 'Tägliche Happy Hour und gratis Billard bei Cafe Milano';
  }
  if (/\bpalace\s+of\s+justice\b/i.test(signal) && /\b(?:free\s+to\s+enter|free\s+entry|eintritt\s+frei|kostenlos(?:er)?\s+eintritt)\b/i.test(signal)) {
    return 'Gratis Eintritt im Justizpalast Wien';
  }
  if (/\bfilm\s*festival\b/i.test(signal) && /\brathausplatz\b/i.test(signal) && /\bgratis(?:e[nr]?)?\s+veranstaltung|\bkostenlos|\bfree\b/i.test(signal)) {
    return 'Gratis Film Festival am Rathausplatz';
  }
  if (/@wukvienna\b|\bwuk\s+vienna\b/i.test(signal) && /\bgratis(?:e[nr]?)?\s+open[- ]?air[- ]?konzerte?\b/i.test(signal)) {
    return 'Gratis Open-Air-Konzerte beim WUK';
  }
  if (/\bgenuss[-\s]?festival\b/i.test(signal) && /\b(?:eintritt|frei|gratis|kostenlos|free)\b/i.test(signal)) {
    return 'Gratis Eintritt Genuss-Festival Stadtpark';
  }
  if (/\bfilipino\s*food\s*festival\b|FilipinoFoodFestivalAustria/i.test(signal) && /\b(?:eintritt\s+frei|freier\s+eintritt|eintritt\s+(?:ist\s+)?gratis|gratis(?:er|en)?\s+eintritt|free\s+(?:entry|admission))\b/i.test(signal)) {
    return 'Gratis Eintritt Filipino Food Festival';
  }
  if (/\bbotanische(?:r|n)?\s+garten\b/i.test(signal) && /\b(?:eintritt\s+frei|freier\s+eintritt|eintritt\s+(?:ist\s+)?gratis|kostenlos|free\s+(?:entry|admission))\b/i.test(signal)) {
    return 'Gratis Eintritt Botanischer Garten Wien';
  }
  if (/\bzlatno\s+(?:ćoše|cose)\b/i.test(signal) && /\bgratis\s+(?:pe[čc]enje|essen|food)\b/i.test(signal)) {
    return 'Gratis Essen bei Zlatno Ćoše';
  }
  if (/\bmittelalterfest\b/i.test(signal) && /\b(?:eintritt\s+(?:ist\s+)?gratis|gratis(?:er|en)?\s+eintritt|free\s+(?:entry|admission))\b/i.test(signal)) {
    return `Gratis Eintritt Mittelalterfest${venue ? ` ${venue}` : ''}`;
  }
  if (/\b(?:eintritt\s+frei|freier\s+eintritt|eintritt\s+(?:ist\s+)?gratis|gratis(?:er|en)?\s+eintritt|free\s+(?:entry|admission))\b/i.test(signal)) {
    return `Gratis Eintritt${brand ? ` bei ${brand}` : ''}`;
  }

  const items = 'all[-\\s]?you[-\\s]?can[-\\s]?eat|kaffee|coffee|drink|drinks|getränk|getraenk|pizza|burger|kebab|kebap|döner|doener|sushi|ramen|pasta|eis|gelato|eintritt|entry|admission|ticket|kino|goodie bag|probetraining|brunch|croissant|matcha|boba|bubble tea';
  let match = signal.match(new RegExp(`\\b(?:gratis|kostenlos(?:e|er|es|en)?|free)\\s+(?:einen?|eine|ein)?\\s*(${items})`, 'i'));
  if (match) return `Gratis ${cleanText(match[1], 40).replace(/^./, (c) => c.toUpperCase())}${brand ? ` bei ${brand}` : ''}`;
  match = signal.match(new RegExp(`\\b(${items})\\s+(?:ist\\s+)?(?:gratis|kostenlos(?:e|er|es|en)?|free)\\b`, 'i'));
  if (match) return `Gratis ${cleanText(match[1], 40).replace(/^./, (c) => c.toUpperCase())}${brand ? ` bei ${brand}` : ''}`;
  match = signal.match(/\b(1\s*\+\s*1|2\s*(?:für|fuer)\s*1|bogo)\b[^.!?]{0,55}/i);
  if (match) return cleanText(match[0], 90).replace(/\b2\s*fuer\s*1\b/i, '2 für 1');
  match = signal.match(/\b(\d{1,2})\s*%\s*(?:rabatt|discount|off)?[^.!?]{0,45}/i);
  if (match) return cleanText(match[0], 90);

  const first = signal
    .replace(/#[\w.äöüß-]+/gi, ' ')
    .replace(/@\w[\w.-]+/g, ' ')
    .split(/[.!?\n]/)[0]
    .trim();
  if (first.length >= 10 && first.length <= 92) return first;
  return `${brand || 'TikTok'} Angebot`;
}

function parseDateFromPost(data) {
  const candidates = [];
  const add = (source, value) => {
    const text = cleanText(value, 120);
    if (!text) return;
    if (/^\d{10}$/.test(text)) {
      candidates.push({ source, date: new Date(Number(text) * 1000) });
      return;
    }
    if (/^\d{13}$/.test(text)) {
      candidates.push({ source, date: new Date(Number(text)) });
      return;
    }
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) candidates.push({ source, date: parsed });
  };

  add('time.datetime', data.timeDateTime);
  add('jsonLd.uploadDate', data.jsonLdUploadDate);
  add('jsonLd.datePublished', data.jsonLdDatePublished);
  for (const createTime of data.createTimes || []) add('script.createTime', createTime);

  const valid = candidates.filter((item) => item.date instanceof Date && !Number.isNaN(item.date.getTime()));
  valid.sort((a, b) => b.date.getTime() - a.date.getTime());
  return valid[0] || null;
}

function ageDays(date, now = new Date()) {
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / DAY_MS));
}

function isCurrentPost(date, now = new Date()) {
  if (date.getTime() > now.getTime() + 2 * 60 * 60 * 1000) return false;
  const ageMs = now.getTime() - date.getTime();
  return ageMs >= 0 && ageMs <= CONFIG.maxAgeDays * DAY_MS;
}

function endOfViennaDay(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day, 21, 59, 59, 999));
}

function monthFromName(value) {
  return MONTH_NAMES.get(cleanText(value, 40).toLowerCase()) || 0;
}

function parseExplicitOfferEndDate(text, referenceDate = new Date()) {
  const signal = cleanText(text, 1600).toLowerCase();
  const year = referenceDate.getUTCFullYear();

  let match = signal.match(/\b(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)?\s*,?\s*(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\.?\s*(?:bis|to|[-–])\s*(?:(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\s*,?\s*)?(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/i);
  if (match) {
    const startMonth = Number(match[2]);
    const endMonth = Number(match[5]);
    let parsedYear = match[6]
      ? (Number(match[6]) < 100 ? 2000 + Number(match[6]) : Number(match[6]))
      : (match[3] ? (Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3])) : year);
    if (!match[6] && endMonth < startMonth) parsedYear += 1;
    return endOfViennaDay(parsedYear, endMonth, Number(match[4]));
  }

  match = signal.match(/\b(?:bis|gültig bis|gueltig bis|nur bis|noch bis)\s+(?:(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\s*,?\s*)?(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/i);
  if (match) {
    const parsedYear = match[3] ? (Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3])) : year;
    return endOfViennaDay(parsedYear, Number(match[2]), Number(match[1]));
  }

  match = signal.match(/\b(?:von\s+)?(\d{1,2})\.\s*[-–]\s*(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/i);
  if (match) {
    const parsedYear = match[4] ? (Number(match[4]) < 100 ? 2000 + Number(match[4]) : Number(match[4])) : year;
    return endOfViennaDay(parsedYear, Number(match[3]), Number(match[2]));
  }

  match = signal.match(/\b\d{1,2}[./]\d{1,2}\.?\s*(?:and|und|bis|to)\s*(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/i);
  if (match) {
    const parsedYear = match[3] ? (Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3])) : year;
    return endOfViennaDay(parsedYear, Number(match[2]), Number(match[1]));
  }

  match = signal.match(/\b(?:von\s+)?(\d{1,2})\.?\s*(?:bis|[-–])\s*(\d{1,2})\.?\s*(jänner|jaenner|januar|februar|märz|maerz|april|mai|maj|maja|juni|juli|august|september|oktober|november|dezember)\b/i);
  if (match) {
    const month = monthFromName(match[3]);
    if (month) return endOfViennaDay(year, month, Number(match[2]));
  }

  match = signal.match(/\b(\d{1,2})\.\s*&\s*(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/i);
  if (match) {
    const parsedYear = match[4] ? (Number(match[4]) < 100 ? 2000 + Number(match[4]) : Number(match[4])) : year;
    return endOfViennaDay(parsedYear, Number(match[3]), Number(match[2]));
  }

  match = signal.match(/\b(?:am|nur am|samstag|sonntag|montag|dienstag|mittwoch|donnerstag|freitag|subotu)?\s*(\d{1,2})\.?\s*(jänner|jaenner|januar|februar|märz|maerz|april|mai|maj|maja|juni|juli|august|september|oktober|november|dezember)\b/i);
  if (match) {
    const month = monthFromName(match[2]);
    if (month) return endOfViennaDay(year, month, Number(match[1]));
  }

  match = signal.match(/\b(?:am|nur am)\s+(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/i);
  if (match) {
    const parsedYear = match[3] ? (Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3])) : year;
    return endOfViennaDay(parsedYear, Number(match[2]), Number(match[1]));
  }

  return null;
}

function endOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

function endOfWeekendForPost(postDate) {
  const day = postDate.getUTCDay();
  const daysUntilSunday = (7 - day) % 7;
  const sunday = new Date(Date.UTC(postDate.getUTCFullYear(), postDate.getUTCMonth(), postDate.getUTCDate() + daysUntilSunday, 23, 59, 59, 999));
  return sunday;
}

function firstSundayOfMonth(date) {
  const first = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 23, 59, 59, 999));
  const offset = (7 - first.getUTCDay()) % 7;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1 + offset, 23, 59, 59, 999));
}

function isExplicitlyExpired(text, postDate = null, now = new Date()) {
  const signal = cleanText(text, 1600);
  const endDate = parseExplicitOfferEndDate(text, now);
  if (endDate && endDate.getTime() < now.getTime() - 2 * 60 * 60 * 1000) return true;

  if (postDate instanceof Date && !Number.isNaN(postDate.getTime())) {
    if (/\bnur(?:\s+noch)?\s+heute\b/i.test(signal) && endOfUtcDay(postDate).getTime() < now.getTime()) return true;
    if (/\bmorgen\b/i.test(signal)) {
      const tomorrow = new Date(Date.UTC(postDate.getUTCFullYear(), postDate.getUTCMonth(), postDate.getUTCDate() + 1, 23, 59, 59, 999));
      if (tomorrow.getTime() < now.getTime()) return true;
    }
    if (/\bdieses wochenende\b/i.test(signal) && endOfWeekendForPost(postDate).getTime() < now.getTime()) return true;
    if (/\bersten?\s+sonntag\s+des\s+monats\b/i.test(signal) && firstSundayOfMonth(postDate).getTime() < now.getTime()) return true;
  }
  return false;
}

function viennaIsoDay(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Vienna',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function dateFromNumericDayMonth(day, month, referenceDate, explicitYear = '') {
  const numericDay = Number(day);
  const numericMonth = Number(month);
  if (numericDay < 1 || numericDay > 31 || numericMonth < 1 || numericMonth > 12) return null;
  let year = explicitYear
    ? (Number(explicitYear) < 100 ? 2000 + Number(explicitYear) : Number(explicitYear))
    : referenceDate.getUTCFullYear();
  if (!explicitYear && numericMonth < referenceDate.getUTCMonth() + 1 - 6) year += 1;
  const endDate = endOfViennaDay(year, numericMonth, numericDay);
  if (endDate.getUTCDate() !== numericDay || endDate.getUTCMonth() + 1 !== numericMonth) return null;
  return endDate;
}

function extractTikTokFallbackOfferWindow(text, referenceDate = new Date()) {
  const signal = cleanText(text, 2600);
  const namedSingleOfferDate = signal.match(/\b(?:am|nur\s+am)\s+(?:(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\s*,?\s*(?:den\s+)?)?(\d{1,2})\.?\s*(jänner|jaenner|januar|februar|märz|maerz|april|mai|maj|maja|juni|juli|august|september|oktober|november|dezember)(?:\s+(\d{4}))?\b[^.!?]{0,120}\b(?:gratis|kostenlos|1\s*\+\s*1|2\s*(?:für|fuer)\s*1)\b/i);
  if (namedSingleOfferDate) {
    const endDate = dateFromNumericDayMonth(
      namedSingleOfferDate[1],
      monthFromName(namedSingleOfferDate[2]),
      referenceDate,
      namedSingleOfferDate[3],
    );
    if (endDate) return { kind: 'single-date', startDate: endDate, endDate, evidence: namedSingleOfferDate[0] };
  }

  const singleOfferDate = signal.match(/\b(?:am|nur\s+am)\s+(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b[^.!?]{0,120}\b(?:gratis|kostenlos|1\s*\+\s*1|2\s*(?:für|fuer)\s*1)\b/i)
    || signal.match(/\b(?:gratis|kostenlos|1\s*\+\s*1|2\s*(?:für|fuer)\s*1)\b[^.!?]{0,120}\b(?:am|nur\s+am)\s+(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b/i);
  if (singleOfferDate) {
    const endDate = dateFromNumericDayMonth(singleOfferDate[1], singleOfferDate[2], referenceDate, singleOfferDate[3]);
    if (endDate) return { kind: 'single-date', startDate: endDate, endDate, evidence: singleOfferDate[0] };
  }

  const programIndex = signal.search(/\b(?:programm|termine|dates)\s*:/i);
  if (programIndex < 0) return null;
  const programText = signal.slice(programIndex, programIndex + 700);
  const dates = [...programText.matchAll(/\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b/g)]
    .map((match) => dateFromNumericDayMonth(match[1], match[2], referenceDate, match[3]))
    .filter(Boolean)
    .sort((left, right) => left.getTime() - right.getTime());
  if (!dates.length) return null;
  return {
    kind: dates.length > 1 ? 'date-list' : 'single-date',
    startDate: dates[0],
    endDate: dates[dates.length - 1],
    evidence: programText,
  };
}

function extractExpiryText(text) {
  const signal = cleanText(text, 1200);
  const explicit = signal.match(/\b(?:bis|gültig bis|gueltig bis|nur bis|noch bis)\s+(\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)/i);
  if (explicit) return explicit[0];
  const range = signal.match(/\b(?:von\s+)?\d{1,2}\.\s*[-–]\s*\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?/i);
  if (range) return range[0];
  const englishRange = signal.match(/\b\d{1,2}[./]\d{1,2}\.?\s*(?:and|und|bis|to)\s*\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?/i);
  if (englishRange) return englishRange[0];
  const monthRange = signal.match(/\b(?:von\s+)?\d{1,2}\.?\s*(?:bis|[-–])\s*\d{1,2}\.?\s*(?:Jänner|Jaenner|Januar|Februar|März|Maerz|April|Mai|Maj|Maja|Juni|Juli|August|September|Oktober|November|Dezember)\b/i);
  if (monthRange) return monthRange[0];
  const splitRange = signal.match(/\b\d{1,2}\.\s*&\s*\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?/i);
  if (splitRange) return splitRange[0];
  const monthSingle = signal.match(/\b(?:am|nur am|Samstag|Sonntag|Montag|Dienstag|Mittwoch|Donnerstag|Freitag|subotu)?\s*\d{1,2}\.?\s*(?:Jänner|Jaenner|Januar|Februar|März|Maerz|April|Mai|Maj|Maja|Juni|Juli|August|September|Oktober|November|Dezember)\b/i);
  if (monthSingle) return monthSingle[0];
  const single = signal.match(/\b(?:am|nur am)\s+\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?/i);
  if (single) return single[0];
  if (/\bnur heute\b/i.test(signal)) return 'Nur heute';
  if (/\bdieses wochenende\b/i.test(signal)) return 'Dieses Wochenende';
  if (/\bdiese woche\b/i.test(signal)) return 'Diese Woche';
  return 'Kurzfristig / siehe TikTok';
}

async function prepareTikTokSession(context) {
  const page = await context.newPage();
  await page.goto('https://www.tiktok.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2200);
  return page;
}

function normalizeTikTokApiItem(raw) {
  const item = raw?.item || raw?.item_info?.item_struct || raw?.aweme_info || raw;
  if (!item?.id || !item?.author?.uniqueId) return null;
  const accountHandle = item.author.uniqueId;
  const url = `https://www.tiktok.com/@${accountHandle}/video/${item.id}`;
  const createTime = Number(item.createTime || item.create_time || 0);
  const video = item.video && typeof item.video === 'object' ? item.video : {};
  const thumbnailUrl = cleanText(video.originCover || video.cover || video.dynamicCover, 1600);
  const mediaUrl = cleanText(video.playAddr || video.downloadAddr || video.play_addr?.url_list?.[0], 1600);
  return {
    url,
    finalUrl: url,
    accountHandle,
    title: item.desc || '',
    description: item.desc || '',
    bodyText: [
      item.desc,
      item.author?.nickname,
      item.author?.signature,
      ...(item.textExtra || []).map((entry) => entry.hashtagName || ''),
    ].filter(Boolean).join(' '),
    timeDateTime: createTime > 0 ? new Date(createTime * 1000).toISOString() : '',
    createTimes: createTime > 0 ? [String(createTime)] : [],
    stats: item.stats || {},
    mediaType: mediaUrl ? 'VIDEO' : (thumbnailUrl ? 'IMAGE' : ''),
    mediaUrl,
    thumbnailUrl,
  };
}

async function fetchTikTokApiCandidates(page) {
  const rows = [];
  const errors = [];
  const seenUrls = new Set();
  for (const keyword of TIKTOK_API_KEYWORDS) {
    for (let pageIndex = 0; pageIndex < CONFIG.apiSearchPages; pageIndex += 1) {
      const offset = pageIndex * CONFIG.apiSearchCount;
      try {
        const result = await page.evaluate(async ({ keyword, offset, count }) => {
          const url = `/api/search/general/full/?keyword=${encodeURIComponent(keyword)}&offset=${offset}&count=${count}`;
          const response = await fetch(url, {
            headers: { accept: 'application/json,text/plain,*/*' },
          });
          const text = await response.text();
          if (!response.ok) return { ok: false, status: response.status, text: text.slice(0, 200) };
          if (!text) return { ok: false, status: response.status, text: '' };
          try {
            return { ok: true, status: response.status, body: JSON.parse(text) };
          } catch {
            return { ok: false, status: response.status, text: text.slice(0, 200) };
          }
        }, { keyword, offset, count: CONFIG.apiSearchCount });

        if (!result.ok) {
          errors.push({ keyword, offset, status: result.status, error: result.text || 'empty response' });
          continue;
        }
        const batch = result.body?.data || [];
        for (const row of batch) {
          const normalized = normalizeTikTokApiItem(row);
          if (!normalized || seenUrls.has(normalized.url)) continue;
          seenUrls.add(normalized.url);
          rows.push({ keyword, offset, data: normalized });
          if (rows.length >= CONFIG.maxApiCandidates) return { rows, errors };
        }
        if (batch.length === 0) break;
      } catch (error) {
        errors.push({ keyword, offset, error: error.message });
      }
      await page.waitForTimeout(350);
    }
  }
  return { rows, errors };
}

async function discoverTikTokLinksViaDuckDuckGo() {
  const links = new Set();
  const errors = [];
  for (const query of SEARCH_QUERIES) {
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const response = await fetch(url, {
        headers: {
          'user-agent': 'Mozilla/5.0 (compatible; FreeFinderTikTokScanner/1.0; +https://freefinder.app)',
          'accept-language': 'de-AT,de;q=0.9,en;q=0.8',
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      const hrefMatches = [...html.matchAll(/href=["']([^"']+)["']/gi)];
      for (const match of hrefMatches) {
        const normalized = normalizeTikTokVideoUrl(match[1]);
        if (normalized) links.add(normalized);
      }
    } catch (error) {
      errors.push({ query, error: error.message });
    }
  }
  return { links: [...links], errors };
}

async function extractTikTokPostData(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
  await page.waitForTimeout(1800);

  return page.evaluate(() => {
    const meta = (selector) => document.querySelector(selector)?.getAttribute('content') || '';
    const bodyText = document.body?.innerText || '';
    const scriptText = Array.from(document.querySelectorAll('script'))
      .map((node) => node.textContent || '')
      .join('\n')
      .slice(0, 1200000);
    const createTimes = Array.from(scriptText.matchAll(/"createTime"\s*:\s*"?(\d{10})"?/g)).map((match) => match[1]);
    let jsonLdUploadDate = '';
    let jsonLdDatePublished = '';
    for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
      try {
        const parsed = JSON.parse(script.textContent || '{}');
        const entries = Array.isArray(parsed) ? parsed : [parsed];
        for (const entry of entries) {
          jsonLdUploadDate ||= entry.uploadDate || '';
          jsonLdDatePublished ||= entry.datePublished || '';
        }
      } catch {}
    }

    const accountMatch = location.pathname.match(/\/@([^/]+)\//);
    return {
      finalUrl: location.href,
      accountHandle: accountMatch?.[1] || '',
      title: meta('meta[property="og:title"]') || meta('meta[name="twitter:title"]') || document.title || '',
      description: meta('meta[property="og:description"]') || meta('meta[name="description"]') || meta('meta[name="twitter:description"]') || '',
      bodyText,
      timeDateTime: document.querySelector('time[datetime]')?.getAttribute('datetime') || '',
      jsonLdUploadDate,
      jsonLdDatePublished,
      createTimes: [...new Set(createTimes)].slice(0, 8),
      mediaType: meta('meta[property="og:video"]') ? 'VIDEO' : (meta('meta[property="og:image"]') ? 'IMAGE' : ''),
      mediaUrl: meta('meta[property="og:video"]') || meta('meta[property="og:video:url"]') || '',
      thumbnailUrl: meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]') || '',
    };
  });
}

function trustedTikTokMediaEvidence(data, minimumConfidence = 0.84) {
  const evidence = data?._mediaEvidence && typeof data._mediaEvidence === 'object' ? data._mediaEvidence : null;
  const ai = evidence?.ai && typeof evidence.ai === 'object' ? evidence.ai : null;
  if (ai?.isDeal !== true || Number(ai.confidence || 0) < minimumConfidence || ai.exclusion !== 'none') {
    return { evidence, ai: null };
  }
  const offerText = cleanText(ai.offerText, 500);
  if (!offerText) return { evidence, ai: null };
  return {
    evidence,
    ai: {
      isDeal: true,
      confidence: Number(ai.confidence || 0),
      offerText,
      locationText: cleanText(ai.locationText, 240),
      validityText: cleanText(ai.validityText, 240),
      exclusion: 'none',
    },
  };
}

export function buildDealFromPost(url, data, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const dateCandidate = parseDateFromPost(data);
  if (!dateCandidate) {
    return { deal: null, reason: 'kein echtes TikTok-Post-Datum gefunden' };
  }
  if (!isCurrentPost(dateCandidate.date, now)) {
    return { deal: null, reason: `TikTok-Post älter als ${CONFIG.maxAgeDays} Tage (${dateCandidate.date.toISOString().slice(0, 10)})` };
  }
  const accountKey = cleanText(data.accountHandle, 80).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (FREEFINDER_SELF_ACCOUNT_KEYS.has(accountKey)) {
    return { deal: null, reason: 'FreeFinder-Eigenpost statt neuer Deal-Quelle' };
  }

  const originalOfferSignal = [
    data.title,
    data.description,
  ].map((part) => cleanText(part, 1800)).filter(Boolean).join(' ');
  const originalContextSignal = [
    originalOfferSignal,
    data.bodyText,
  ].map((part) => cleanText(part, 1800)).filter(Boolean).join(' ');
  const accountHandle = cleanText(data.accountHandle, 80);
  if (FOREIGN_LOCATION_HANDLE_PATTERNS.some((pattern) => pattern.test(accountHandle))
      && !hasSpecificViennaEvidence(originalOfferSignal)) {
    return { deal: null, reason: 'kein belastbarer Wiener Ortsbeleg bei auswärtigem Account' };
  }
  const media = trustedTikTokMediaEvidence(data, Number(options.mediaMinConfidence || 0.84));
  const offerSignal = [
    originalOfferSignal,
    media.ai?.offerText ? `Bildangebot: ${media.ai.offerText}` : '',
    media.ai?.validityText ? `Bildgültigkeit: ${media.ai.validityText}` : '',
  ].filter(Boolean).join(' ');
  const contextSignal = [
    offerSignal,
    originalContextSignal,
    media.ai?.locationText ? `Bildort: ${media.ai.locationText}` : '',
  ].map((part) => cleanText(part, 1800)).filter(Boolean).join(' ');

  const originalViennaEvidence = extractViennaEvidence(originalContextSignal);
  const viennaEvidenceDetail = extractViennaEvidence(contextSignal);
  if (!viennaEvidenceDetail) return { deal: null, reason: 'kein eindeutiges Wien-Signal' };
  const contentQualityReason = getTikTokContentQualityReason(offerSignal);
  if (contentQualityReason) return { deal: null, reason: contentQualityReason };
  if (!hasStrongDealSignal(offerSignal)) return { deal: null, reason: 'kein starkes Gratis-/Deal-Signal' };
  if (isExplicitlyExpired(offerSignal, dateCandidate.date, now)) return { deal: null, reason: 'explizites/relatives Aktionsdatum ist abgelaufen' };

  const offerWindow = extractActiveOfferWindow(offerSignal, {
    pubDate: dateCandidate.date,
    now,
  }) || extractTikTokFallbackOfferWindow(offerSignal, dateCandidate.date);
  if (offerWindow?.endDate && viennaIsoDay(offerWindow.endDate) < viennaIsoDay(now)) {
    return { deal: null, reason: `explizites Aktionsdatum ist abgelaufen (${viennaIsoDay(offerWindow.endDate)})` };
  }

  const type = inferType(offerSignal);
  const { category, logo } = inferCategoryAndLogo(offerSignal, type);
  const extractedBrand = extractBrand(offerSignal, data.accountHandle);
  const entities = resolveInstagramPostEntities({
    ownerUsername: data.accountHandle,
    caption: offerSignal,
    account: {
      username: data.accountHandle,
      accountType: data.sourceAccountType || '',
    },
  });
  const inferredBrand = inferPreferredBrand({
    brand: extractedBrand,
    title: offerSignal,
    description: offerSignal,
    ownerUsername: data.accountHandle,
    url,
  }) || extractedBrand;
  const brand = extractedBrand === 'WOA' ? extractedBrand : inferredBrand;
  const title = buildOfferTitle(offerSignal, brand, type);
  const score = buildQualityScore(offerSignal, dateCandidate.date, type, category, now);
  if (score < CONFIG.minScore) return { deal: null, reason: `Score zu niedrig (${score})` };
  const validFrom = offerWindow?.startDate?.toISOString().slice(0, 10) || '';
  const validUntil = offerWindow?.endDate?.toISOString().slice(0, 10) || '';
  const postalCode = contextSignal.match(/\b(1(?:0[1-9]|1\d|2[0-3])0)\b/)?.[1] || '';

  const mediaEvidence = media.evidence ? {
    ...media.evidence,
    ...(media.ai ? { ai: media.ai } : {}),
  } : null;
  const rawDeal = {
      id: `tiktok-${stableHash(`${url}|${dateCandidate.date.toISOString()}|${title}`)}`,
      brand,
      logo,
      title,
      description: cleanText([
        data.description || data.title,
        media.ai?.offerText ? `Bildbeleg: ${media.ai.offerText}.` : '',
        `Quelle: TikTok @${data.accountHandle}.`,
      ].filter(Boolean).join(' '), 500),
      type,
      category,
      source: 'TikTok Scanner',
      originSource: 'tiktok-deals-scanner',
      url,
      expires: validUntil || extractExpiryText(offerSignal),
      validFrom,
      validUntil,
      expiryKind: offerWindow?.kind || '',
      expirySource: offerWindow ? 'tiktok-post-caption' : '',
      dateConfidence: offerWindow ? 'high' : '',
      distance: postalCode ? `${postalCode} Wien` : 'Wien',
      city: postalCode ? 'Wien' : '',
      postalCode,
      viennaEvidence: {
        verified: true,
        source: originalViennaEvidence ? 'tiktok-post' : 'tiktok-media-ai',
        detail: viennaEvidenceDetail,
      },
      ownerUsername: entities.ownerUsername,
      sourceAccountType: entities.ownerRole,
      scoutUsername: entities.scoutUsername,
      merchantUsername: entities.merchantUsername,
      merchantName: brand,
      promotionEvidence: media.ai?.offerText || '',
      evidence: {
        ...(mediaEvidence ? { mediaEvidence } : {}),
        entityResolution: entities,
      },
      hot: type === 'gratis' || type === 'bogo',
      isNew: true,
      votes: type === 'gratis' || type === 'bogo' ? 3 : 2,
      priority: type === 'gratis' || type === 'bogo' ? 5 : 4,
      qualityScore: score,
      pubDate: dateCandidate.date.toISOString(),
      pubDateSource: dateCandidate.source,
      sourcePublishedAt: dateCandidate.date.toISOString(),
      sourcePublishedAtSource: dateCandidate.source,
  };
  const discovered = advanceDealLifecycle(rawDeal, 'discovered', { at: options.discoveredAt });
  return {
    deal: advanceDealLifecycle(discovered, 'extracted', { at: now }),
    reason: '',
  };
}

function buildQualityScore(signal, postDate, type, category, now = new Date()) {
  const concreteSignal = withoutNonOfferFreeTerms(signal);
  let score = 0;
  if (type === 'gratis') score += 34;
  else if (type === 'bogo') score += 30;
  else score += 18;

  if (/\bgratis|kostenlos|free|0\s*€/i.test(concreteSignal)) score += 16;
  if (/\b1\s*\+\s*1|2\s*(?:für|fuer)\s*1|bogo/i.test(signal)) score += 14;
  if (/\b\d{1,2}\s*%\s*(?:rabatt|discount|off)\b/i.test(signal)) score += 16;
  if (type === 'rabatt' && extractBirthdayEntryOffer(signal)) score += 32;
  if (/\bkaffee|coffee|pizza|burger|drink|goodie|ticket|probetraining/i.test(signal)) score += 10;
  if (category === 'kaffee' || category === 'essen') score += 8;
  if (/\bnur heute|heute|morgen|wochenende|diese woche|neueröffnung|neueroeffnung|opening/i.test(signal)) score += 8;
  const age = ageDays(postDate, now);
  if (age <= 1) score += 16;
  else if (age <= 3) score += 12;
  else if (age <= 7) score += 8;
  return score;
}

function tikTokMediaItem(candidate) {
  const data = candidate?.data || {};
  const url = cleanText(candidate?.url || data.url || data.finalUrl, 1200);
  const dateCandidate = parseDateFromPost(data);
  const videoId = url.match(/\/video\/(\d{8,30})/i)?.[1] || stableHash(url);
  const mediaType = cleanText(data.mediaType, 40).toUpperCase();
  return {
    id: `tiktok-media-${videoId}`,
    caption: cleanText([data.title, data.description].filter(Boolean).join(' '), 4000),
    media_type: mediaType || (data.mediaUrl ? 'VIDEO' : 'IMAGE'),
    media_url: cleanText(data.mediaUrl, 1800),
    thumbnail_url: cleanText(data.thumbnailUrl, 1800),
    timestamp: dateCandidate?.date?.toISOString() || '',
    permalink: url,
  };
}

function isTikTokMediaRescueCandidate(candidate, config, now) {
  const data = candidate?.data || {};
  const initial = candidate?.initial || buildDealFromPost(candidate?.url || data.url, data, { now });
  if (!['kein eindeutiges Wien-Signal', 'kein starkes Gratis-/Deal-Signal'].includes(initial?.reason)) return false;
  const dateCandidate = parseDateFromPost(data);
  if (!dateCandidate) return false;
  const ageMs = now.getTime() - dateCandidate.date.getTime();
  if (ageMs < -10 * 60 * 1000 || ageMs > config.mediaMaxAgeHours * 60 * 60 * 1000) return false;
  const originalText = cleanText([data.title, data.description].filter(Boolean).join(' '), 3600);
  if (CONFLICT_LOCATION_PATTERNS.some((pattern) => pattern.test(originalText))) return false;
  if (FALSE_POSITIVE_PATTERNS.some((pattern) => pattern.test(originalText))) return false;
  if (getTikTokContentQualityReason(originalText)) return false;
  if (isExplicitlyExpired(originalText, dateCandidate.date, now)) return false;
  return extractInstagramMediaAssets(tikTokMediaItem(candidate)).length > 0;
}

function hasTikTokFoodDrinkSignal(value) {
  return /\b(?:restaurant|gastro|essen|food|lunch|brunch|frühstück|fruehstueck|pizza|burger|kebab|kebap|döner|doener|sushi|ramen|pasta|cafe|café|coffee|kaffee|matcha|cocktail|spritz|drink|bier|wein|eis|gelato|dessert|bakery|bäckerei|buffet|all\s+you\s+can\s+eat)\b/i.test(cleanText(value, 5000));
}

function tikTokCandidateHandle(candidate) {
  const configured = cleanText(candidate?.data?.accountHandle, 80).replace(/^@/, '');
  if (configured) return configured;
  const url = cleanText(candidate?.url || candidate?.data?.url || candidate?.data?.finalUrl, 1200);
  return cleanText(url.match(/tiktok\.com\/@([^/]+)/i)?.[1], 80);
}

function compactTikTokMediaRescueCandidates(candidates) {
  const compact = [];
  const seenContent = new Set();
  for (const candidate of candidates) {
    const data = candidate?.data || {};
    const content = cleanText(data.title || data.description, 1800)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '');
    const key = content.length >= 20 ? `${tikTokCandidateHandle(candidate).toLowerCase()}|${content}` : '';
    if (key && seenContent.has(key)) continue;
    if (key) seenContent.add(key);
    compact.push(candidate);
  }
  return compact;
}

function tikTokMediaPriorityContext(candidate, now) {
  const data = candidate?.data || {};
  const text = cleanText([data.title, data.description].filter(Boolean).join(' '), 5000);
  const handle = tikTokCandidateHandle(candidate);
  const hasFoodDrink = hasTikTokFoodDrinkSignal(text);
  const hasVienna = Boolean(extractViennaEvidence(text));
  const localAccount = /(?:[._]at|wien|vienna|austria|oesterreich)$/i.test(handle);
  const reason = cleanText(candidate?.initial?.reason, 160)
    || buildDealFromPost(candidate?.url || data.url, data, { now }).reason;
  let mediaPriorityBoost = 0;
  if (hasFoodDrink) mediaPriorityBoost += 180;
  if (hasVienna) mediaPriorityBoost += 120;
  if (localAccount) mediaPriorityBoost += 70;
  if (reason === 'kein starkes Gratis-/Deal-Signal') mediaPriorityBoost += 30;
  if (reason === 'kein eindeutiges Wien-Signal' && !hasFoodDrink && !hasVienna && !localAccount) {
    mediaPriorityBoost -= 220;
  }
  return {
    mediaPriorityBoost,
    account: {
      username: handle,
      verifiedVienna: hasVienna,
      category: hasFoodDrink ? 'food' : '',
    },
  };
}

function shouldClassifyTikTokRescueEvidence({ entry, evidence }, now = new Date()) {
  const candidate = entry?.candidate || {};
  const reason = candidate?.initial?.reason || buildDealFromPost(candidate.url, candidate.data || {}, { now }).reason;
  const originalText = cleanText([candidate.data?.title, candidate.data?.description].filter(Boolean).join(' '), 3600);
  const combinedText = cleanText(`${originalText} ${evidence?.ocrText || ''}`, 5000);
  const hasDeal = hasStrongDealSignal(combinedText);
  const hasVienna = reason === 'kein starkes Gratis-/Deal-Signal'
    || Boolean(extractViennaEvidence(combinedText));
  const hasFoodDrink = hasTikTokFoodDrinkSignal(combinedText);
  const localAccount = /(?:[._]at|wien|vienna|austria|oesterreich)$/i.test(cleanText(candidate.data?.accountHandle, 80));

  if (reason === 'kein eindeutiges Wien-Signal') {
    return hasDeal && (hasVienna || hasFoodDrink || localAccount);
  }
  if (reason === 'kein starkes Gratis-/Deal-Signal') {
    return hasVienna && (hasDeal || hasFoodDrink);
  }
  return false;
}

function emptyTikTokMediaReport(status, error = '') {
  return {
    status,
    rescueCandidates: 0,
    eligible: 0,
    deduplicatedEligible: 0,
    duplicateCandidatesSkipped: 0,
    selected: 0,
    cached: 0,
    analyzed: 0,
    withOcrText: 0,
    withVisionImages: 0,
    aiCalls: 0,
    visionCalls: 0,
    aiAccepted: 0,
    aiSkippedLowIntent: 0,
    aiSkippedUnrecoverable: 0,
    aiAcceptedUnusable: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    rescuedDeals: 0,
    errors: error ? [cleanText(error, 180)] : [],
  };
}

export async function rescueTikTokMediaCandidates(candidates, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const env = options.env || process.env;
  const config = options.config || buildTikTokMediaConfig(env);
  const cache = options.cache && typeof options.cache === 'object' ? options.cache : {};
  const unique = new Map();
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const url = normalizeTikTokVideoUrl(candidate?.url || candidate?.data?.url || candidate?.data?.finalUrl);
    if (!url || unique.has(url)) continue;
    unique.set(url, { ...candidate, url });
  }
  const eligible = [...unique.values()].filter((candidate) => isTikTokMediaRescueCandidate(candidate, config, now));
  const analysisCandidates = compactTikTokMediaRescueCandidates(eligible);
  if (!config.mediaLlmEnabled || (!config.mediaOcrEnabled && !config.mediaVisionEnabled)) {
    return {
      deals: [],
      rescuedUrls: new Set(),
      evidenceByUrl: new Map(),
      cache,
      report: {
        ...emptyTikTokMediaReport('disabled'),
        rescueCandidates: unique.size,
        eligible: eligible.length,
        deduplicatedEligible: analysisCandidates.length,
        duplicateCandidatesSkipped: eligible.length - analysisCandidates.length,
      },
    };
  }

  const entries = analysisCandidates.map((candidate) => {
    const priority = tikTokMediaPriorityContext(candidate, now);
    return {
      item: tikTokMediaItem(candidate),
      context: {
        sourceType: 'tiktok',
        sourceName: `@${tikTokCandidateHandle(candidate)}`,
        account: priority.account,
        mediaPriorityBoost: priority.mediaPriorityBoost,
      },
      candidate,
    };
  });
  let media;
  try {
    media = await (options.enrichMedia || enrichInstagramGraphMedia)(entries, config, now, {
      cache,
      mediaFetchImpl: options.mediaFetchImpl,
      openAiFetchImpl: options.openAiFetchImpl,
      execFileImpl: options.execFileImpl,
      tools: options.mediaTools,
      analyzeItem: options.analyzeMediaItem,
      shouldClassifyEvidence: (payload) => shouldClassifyTikTokRescueEvidence(payload, now),
      classifyOcr: options.classifyMedia || ((input, classifierConfig, classifierOptions) => (
        classifySocialMediaEvidenceWithOpenAI({ ...input, platform: 'TikTok' }, classifierConfig, classifierOptions)
      )),
    });
  } catch (error) {
    return {
      deals: [],
      rescuedUrls: new Set(),
      evidenceByUrl: new Map(),
      cache,
      report: {
        ...emptyTikTokMediaReport('degraded', error?.message || error),
        rescueCandidates: unique.size,
        eligible: eligible.length,
        deduplicatedEligible: analysisCandidates.length,
        duplicateCandidatesSkipped: eligible.length - analysisCandidates.length,
      },
    };
  }

  const deals = [];
  const rescuedUrls = new Set();
  const evidenceByUrl = new Map();
  let aiAcceptedUnusable = 0;
  for (const entry of media.entries) {
    if (entry.item?._mediaEvidence) {
      evidenceByUrl.set(normalizeTikTokVideoUrl(entry.candidate.url), entry.item._mediaEvidence);
    }
    if (!entry.item?._mediaEvidence) continue;
    const data = { ...entry.candidate.data, _mediaEvidence: entry.item._mediaEvidence };
    const rebuilt = buildDealFromPost(entry.candidate.url, data, {
      now,
      mediaMinConfidence: config.mediaLlmMinConfidence,
    });
    if (!rebuilt.deal) {
      const ai = entry.item._mediaEvidence.ai;
      if (ai?.isDeal
          && Number(ai.confidence || 0) >= config.mediaLlmMinConfidence
          && ai.exclusion === 'none'
          && cleanText(ai.offerText, 500)) {
        aiAcceptedUnusable += 1;
      }
      continue;
    }
    deals.push(rebuilt.deal);
    rescuedUrls.add(entry.candidate.url);
  }

  return {
    deals,
    rescuedUrls,
    evidenceByUrl,
    cache: media.cache,
    report: {
      ...media.report,
      rescueCandidates: unique.size,
      eligible: eligible.length,
      deduplicatedEligible: analysisCandidates.length,
      duplicateCandidatesSkipped: eligible.length - analysisCandidates.length,
      rescuedDeals: deals.length,
      aiAcceptedUnusable,
    },
  };
}

export function createPlaywrightMediaFetch(context, options = {}) {
  if (!context?.request?.get) throw new Error('Playwright browser context request API is unavailable');
  const timeoutMs = Math.max(3000, Number(options.timeoutMs || 25000));
  return async (url, init = {}) => {
    const headers = Object.fromEntries(Object.entries(init.headers || {})
      .map(([key, value]) => [key, String(value || '')])
      .filter(([, value]) => value));
    const response = await context.request.get(url, {
      headers,
      timeout: timeoutMs,
      failOnStatusCode: false,
    });
    return new Response(await response.body(), {
      status: response.status(),
      headers: response.headers(),
    });
  };
}

function normalizeOfferKeyText(value = '') {
  return cleanText(value, 200)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9+% ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function semanticDealKey(deal) {
  const eventKey = knownEventDealKey(deal);
  if (eventKey) return eventKey;
  const brand = normalizeOfferKeyText(deal.brand);
  const title = normalizeOfferKeyText(deal.title);
  if (!brand || !title) return '';
  return `${brand}|${title}`;
}

function normalizedDealDay(value = '') {
  const match = cleanText(value, 80).match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  return match?.[1] || '';
}

function knownEventDealKey(deal) {
  const signal = [deal.brand, deal.title, deal.description].filter(Boolean).join(' ');
  if (!isDysonStylingOffer(signal)) return '';
  const validUntil = normalizedDealDay(deal.validUntil || deal.expires);
  if (!validUntil) return '';
  const validFrom = normalizedDealDay(deal.validFrom) || validUntil;
  return `event|dyson-styling|${validFrom}|${validUntil}`;
}

function dealEvidenceRichness(deal) {
  const signal = [deal.title, deal.description, deal.promotionEvidence].filter(Boolean).join(' ');
  const evidencePatterns = [
    /\bfree\s+drinks?|gratis(?:e|en)?\s+getränke?|kostenlose\s+getränke?/i,
    /\b(?:free\s+)?goodies?\b/i,
    /\b(?:rathausplatz|1(?:0[1-9]|1\d|2[0-3])0\s+wien)\b/i,
    /\b(?:26\s*[-–]\s*29\s+august|gültig|gueltig|valid)\b/i,
  ];
  return evidencePatterns.reduce((score, pattern) => score + (pattern.test(signal) ? 1 : 0), 0);
}

function hasSpecificExpiry(deal) {
  const expires = cleanText(deal.expires);
  return Boolean(expires && !/^kurzfristig\b/i.test(expires));
}

function pickBetterDeal(existing, candidate) {
  const existingSpecificExpiry = hasSpecificExpiry(existing);
  const candidateSpecificExpiry = hasSpecificExpiry(candidate);
  if (existingSpecificExpiry !== candidateSpecificExpiry) return candidateSpecificExpiry ? candidate : existing;

  const existingEventKey = knownEventDealKey(existing);
  if (existingEventKey && existingEventKey === knownEventDealKey(candidate)) {
    const existingRichness = dealEvidenceRichness(existing);
    const candidateRichness = dealEvidenceRichness(candidate);
    if (existingRichness !== candidateRichness) return candidateRichness > existingRichness ? candidate : existing;
  }

  if ((candidate.qualityScore || 0) !== (existing.qualityScore || 0)) {
    return (candidate.qualityScore || 0) > (existing.qualityScore || 0) ? candidate : existing;
  }

  return Date.parse(candidate.pubDate || '') > Date.parse(existing.pubDate || '') ? candidate : existing;
}

export function dedupeTikTokDeals(deals) {
  const byUrl = new Map();
  const bySemanticKey = new Map();
  for (const deal of deals) {
    const semanticKey = semanticDealKey(deal);
    if (semanticKey) {
      const existing = bySemanticKey.get(semanticKey);
      bySemanticKey.set(semanticKey, existing ? pickBetterDeal(existing, deal) : deal);
      continue;
    }

    const existing = byUrl.get(deal.url);
    byUrl.set(deal.url, existing ? pickBetterDeal(existing, deal) : deal);
  }

  return [...new Set([...bySemanticKey.values(), ...byUrl.values()])]
    .sort((left, right) => right.qualityScore - left.qualityScore || Date.parse(right.pubDate) - Date.parse(left.pubDate))
    .slice(0, CONFIG.maxDeals);
}

async function main() {
  const scannerStartedAt = Date.now();
  const timings = {
    apiDiscoveryMs: 0,
    searchDiscoveryMs: 0,
    mediaRescueMs: 0,
    totalScannerMs: 0,
  };
  console.log('🎵 TIKTOK DEAL SCANNER (STRICT CURRENT)');
  console.log('========================================');
  console.log(` freshness: max ${CONFIG.maxAgeDays} Tage, ohne Post-Datum blockiert`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'de-AT',
    timezoneId: 'Europe/Vienna',
  });

  const deals = [];
  const rejected = [];
  const rescuePool = [];
  const mediaConfig = buildTikTokMediaConfig(process.env);
  let mediaRescue = null;
  let discovery = { links: [], errors: [] };
  let apiDiscovery = { rows: [], errors: [] };
  try {
    const apiDiscoveryStartedAt = Date.now();
    const apiPage = await prepareTikTokSession(context);
    apiDiscovery = await fetchTikTokApiCandidates(apiPage);
    timings.apiDiscoveryMs = Date.now() - apiDiscoveryStartedAt;
    console.log(`🔎 TikTok API candidates: ${apiDiscovery.rows.length}`);
    for (const item of apiDiscovery.rows) {
      const { deal, reason } = buildDealFromPost(item.data.url, item.data);
      if (deal) {
        deals.push(deal);
        console.log(`  ✅ ${deal.title}`);
      } else {
        rejected.push(summarizeTikTokRejection(item.data.url, item.data, reason, item.keyword));
        rescuePool.push({ url: item.data.url, data: item.data, keyword: item.keyword, initial: { deal, reason } });
      }
    }

    const searchDiscoveryStartedAt = Date.now();
    discovery = await discoverTikTokLinksViaDuckDuckGo();
    const knownUrls = new Set(apiDiscovery.rows.map((item) => item.data.url));
    const urls = discovery.links.filter((url) => !knownUrls.has(url)).slice(0, CONFIG.maxPostsToVisit);
    console.log(`🔎 search-engine videos: ${discovery.links.length}, visiting fallback: ${urls.length}`);
    const page = apiPage;
    for (const url of urls) {
      try {
        const data = await extractTikTokPostData(page, url);
        const { deal, reason } = buildDealFromPost(url, data);
        if (deal) {
          deals.push(deal);
          console.log(`  ✅ ${deal.title}`);
        } else {
          rejected.push(summarizeTikTokRejection(url, data, reason));
          rescuePool.push({ url, data, initial: { deal, reason } });
        }
      } catch (error) {
        rejected.push(summarizeTikTokRejection(url, {}, error.message));
      }
      await page.waitForTimeout(500);
    }
    timings.searchDiscoveryMs = Date.now() - searchDiscoveryStartedAt;

    const mediaRescueStartedAt = Date.now();
    try {
      mediaRescue = await rescueTikTokMediaCandidates(rescuePool, {
        config: mediaConfig,
        cache: loadTikTokMediaCache(),
        mediaFetchImpl: createPlaywrightMediaFetch(context, {
          timeoutMs: mediaConfig.mediaDownloadTimeoutMs,
        }),
      });
    } finally {
      timings.mediaRescueMs += Date.now() - mediaRescueStartedAt;
    }
  } finally {
    await context.close();
    await browser.close();
  }

  if (!mediaRescue) {
    const mediaRescueStartedAt = Date.now();
    try {
      mediaRescue = await rescueTikTokMediaCandidates(rescuePool, {
        config: mediaConfig,
        cache: loadTikTokMediaCache(),
      });
    } finally {
      timings.mediaRescueMs += Date.now() - mediaRescueStartedAt;
    }
  }
  deals.push(...mediaRescue.deals);
  const finalRejected = rejected
    .filter((item) => !mediaRescue.rescuedUrls.has(normalizeTikTokVideoUrl(item.url)))
    .map((item) => {
      const mediaEvidence = mediaRescue.evidenceByUrl.get(normalizeTikTokVideoUrl(item.url));
      return mediaEvidence ? { ...item, mediaEvidence } : item;
    });
  if (mediaRescue.deals.length > 0) {
    console.log(`  🖼️ ${mediaRescue.deals.length} TikTok-Deal(s) aus Bild-/Videobelegen gerettet`);
  }

  const finalDeals = dedupeTikTokDeals(deals);
  timings.totalScannerMs = Date.now() - scannerStartedAt;
  const payload = {
    lastUpdated: new Date().toISOString(),
    source: 'tiktok-deals-scanner',
    totalDeals: finalDeals.length,
    maxAgeDays: CONFIG.maxAgeDays,
    mediaRescued: mediaRescue.deals.length,
    deals: finalDeals,
  };
  const report = {
    lastUpdated: payload.lastUpdated,
    config: CONFIG,
    searchQueries: SEARCH_QUERIES,
    apiKeywords: TIKTOK_API_KEYWORDS,
    discovered: discovery.links.length,
    apiCandidates: apiDiscovery.rows.length,
    accepted: finalDeals.length,
    initialRejected: rejected.length,
    finalRejected: finalRejected.length,
    rejectionReasons: rejectionReasonCounts(finalRejected),
    mediaConfig: {
      maxAgeHours: mediaConfig.mediaMaxAgeHours,
      tesseractTimeoutMs: mediaConfig.mediaTesseractTimeoutMs,
      maxPostsPerRun: mediaConfig.mediaMaxPostsPerRun,
      maxVideoFrames: mediaConfig.mediaMaxVideoFrames,
      maxLlmCallsPerRun: mediaConfig.mediaLlmMaxCallsPerRun,
      llmConcurrency: mediaConfig.mediaLlmConcurrency,
      minConfidence: mediaConfig.mediaLlmMinConfidence,
      model: mediaConfig.mediaLlmModel,
      visionDetail: mediaConfig.mediaVisionDetail,
      visionMaxImages: mediaConfig.mediaVisionMaxImagesPerPost,
      llmEnabled: mediaConfig.mediaLlmEnabled,
      visionEnabled: mediaConfig.mediaVisionEnabled,
    },
    mediaEvidence: mediaRescue.report,
    timings,
    discoveryErrors: discovery.errors,
    apiErrors: apiDiscovery.errors,
    rejected: finalRejected.slice(0, 250),
  };

  writeJsonAtomic(OUTPUT_PATH, payload);
  writeJsonAtomic(REPORT_PATH, report);
  writeJsonAtomic(MEDIA_CACHE_PATH, {
    version: 1,
    updatedAt: payload.lastUpdated,
    mediaEvidence: mediaRescue.cache,
  });
  console.log(`💾 ${finalDeals.length} Deals → ${OUTPUT_PATH}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error('❌ tiktok deal scanner failed:', error);
    process.exit(1);
  });
}

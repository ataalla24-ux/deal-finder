import '../sentry/instrument.mjs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { inspectDealUrlHealth, isVagueExpiry, normalizeDealExpiry, shouldSkipUrlExpiryLookup } from './expiry-utils.js';
import {
  filterModeratedDeals,
  loadDealModeration,
} from './deal-moderation-utils.js';
import {
  buildFallbackDescription,
  cleanUiNoiseText,
  inferPreferredBrand,
  isExpiredDealRecord,
  isFalsePositiveFreeDeal,
  isGenericJunkDeal,
  normalizeDealRecord,
  sanitizeExpiryText,
} from './deal-normalization-utils.js';
import {
  configuredNewDealWindowHours,
  normalizeDealFreshnessFlags,
} from './deal-freshness-utils.js';
import { alignNativeWeeklyDealRotation } from './native-weekly-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const DEALS_PATH = path.join(DOCS_DIR, 'deals.json');
const WEEKLY_DEAL_PATH = path.join(DOCS_DIR, 'deal-of-the-week.json');
const VALIDATION_REPORT_PATH = path.join(DOCS_DIR, 'live-deal-validation-report.json');
const REVIEW_CANDIDATES_PATH = path.join(DOCS_DIR, 'live-deal-review-candidates.json');
const DEAL_CANDIDATES_INDEX_PATH = path.join(DOCS_DIR, 'deal-candidates-index.json');
const LIVE_DEAL_EDITS_PATH = path.join(DOCS_DIR, 'live-deal-edits.json');
const CHURCH_FILES = [
  path.join(ROOT, 'docs', 'deals-pending-church-gemeinde.json'),
  path.join(ROOT, 'docs', 'deals-pending-church-gottesdienste.json'),
  path.join(ROOT, 'docs', 'deals-pending-church-events.json'),
];

const REMOVE_IDS = new Set([
  'community:4ef92a64-5860-408f-af8f-ad47f7ead8dc',
  'g2-18jns35',
  'freikirche-0-20260308',
  'freikirche-1-20260308',
  'freikirche-2-20260308',
  'events-2-20260308',
  'events-7-20260308',
  'gottesdienste-24-20260308',
  'gottesdienste-26-20260308',
  'gemeinde-0-20260308',
  'gemeinde-1-20260308',
  'gottesdienste-0-20260308',
]);

const LEGACY_CHURCH_ID_PATTERNS = [
  /^(hillsong-vienna|cig-wien|icf-wien|jesuszentrum)-(kirche|gottesdienste|events)-20260308$/i,
];
const EXPIRED_DEAL_URL_PATTERNS = [
  /instagram\.com\/(?:reel|p)\/DXWur6dDL0h/i,
  /tiktok\.com\/@eatinvienna\/video\/7630833927053233430/i,
  /tiktok\.com\/@planetmatters\/video\/7634961057521437975/i,
  /tiktok\.com\/@viennas_joy\/video\/7635566976642911510/i,
];
const FORCE_KEEP_IDS = new Set([
  'g2-17at53u',
  'igx-ovlm4t',
  'icf-wien-kirche-20260406',
  'joe-omv-viva-free-taste-6qmpsq',
  'joe-omv-viva-free-taste-flur7',
  'joe-omv-viva-free-taste-l62fzo',
  'joe-omv-viva-free-taste-xipghf',
  'joe-omv-146t7m4',
  'joe-omv-1jfthhz',
  'icf-wien-events-20260413',
  'jesuszentrum-kirche-20260413',
  'jesuszentrum-gottesdienste-20260413',
  'hillsong-vienna-kirche-20260413',
  'hillsong-vienna-gottesdienste-20260413',
  'hillsong-vienna-events-20260413',
  'cig-wien-kirche-20260413',
  'cig-wien-gottesdienste-20260413',
  'cig-wien-events-20260413',
  'icf-wien-gottesdienste-20260413',
  'jesuszentrum-events-20260413',
]);
const PROTECTED_LIVE_RESTORE_IDS = new Set([
  'joe-omv-viva-free-taste-6qmpsq',
  'joe-omv-viva-free-taste-flur7',
  'joe-omv-viva-free-taste-l62fzo',
  'joe-omv-viva-free-taste-xipghf',
]);
const OMV_VIVA_FREE_TASTE_URLS = new Map([
  ['joe-omv-viva-free-taste-6qmpsq', 'https://www.joe-club.at/partner/omv#coconut-strawberry-sunset'],
  ['joe-omv-viva-free-taste-flur7', 'https://www.joe-club.at/partner/omv#sunny-orange-espresso'],
  ['joe-omv-viva-free-taste-l62fzo', 'https://www.joe-club.at/partner/omv#sparkling-espresso-tonic'],
  ['joe-omv-viva-free-taste-xipghf', 'https://www.joe-club.at/partner/omv#iced-matcha-latte'],
]);
const FORCE_KEEP_DYNAMIC_IDS = new Set();
const FORCE_KEEP_DYNAMIC_URLS = new Set();

const MAX_LIVE_URL_HEALTH_CHECKS = Number(process.env.MAX_LIVE_URL_HEALTH_CHECKS || 180);
const MAX_LIVE_URL_EXPIRY_REFRESHES = Number(process.env.MAX_LIVE_URL_EXPIRY_REFRESHES || 120);
const MAX_LIVE_CONTENT_ENRICHMENTS = Number(process.env.MAX_LIVE_CONTENT_ENRICHMENTS || 120);
const MAX_OPAQUE_SOCIAL_AGE_DAYS = Number(process.env.MAX_LIVE_OPAQUE_SOCIAL_AGE_DAYS || 14);
const MAX_SOCIAL_POST_AGE_DAYS = Number(process.env.MAX_LIVE_SOCIAL_POST_AGE_DAYS || process.env.DEAL_VALIDITY_MAX_AGE_DAYS || 7);
const MAX_EXPIRED_REVIEW_GRACE_DAYS = Number(process.env.MAX_LIVE_EXPIRED_REVIEW_GRACE_DAYS || 7);
const APPLY_LIVE_VALIDATION = process.env.LIVE_DEAL_VALIDATION_APPLY === '1';
const LIVE_DEAL_REMOVALS_ENABLED = process.env.LIVE_DEAL_REMOVALS_ENABLED === '1';
const CAN_REMOVE_LIVE_DEALS = APPLY_LIVE_VALIDATION && LIVE_DEAL_REMOVALS_ENABLED;
const FLIGHT_DEAL_PATTERN = /\b(flug|flüge|flight|flights|hin\s*&\s*zurück|hin\s+und\s+zurück|ryanair|wizz\s*air|wizzair|iata)\b/i;
const GENERIC_DESCRIPTION_PATTERN = /^(free|gratis|rabatt|discount|deal|angebot|aktion|promo|special|event|post|reel|instagram|coupon|gutschein|gewinnspiel|new|neu)$/i;
const FOOD_SIGNAL_PATTERN = /\b(eis\w*|eissalon\w*|ice cream|gelato|kaffee\w*|coffee|cafe|café|pizza\w*|burger\w*|döner\w*|doener\w*|kebab\w*|sushi|ramen|brunch|croissant|drink|drinks|getränk\w*|getraenk\w*|cocktail\w*|bistro|restaurant|snack|schnitzel|falafel|bowl|popcorn|wein\w*|vino|fleisch\w*|meat|steak|bbq|grill\w*|bäckerei|backerei|bakery|krapfen\w*|schoko\w*|erdbeer\w*|dessert\w*)\b/i;
const COFFEE_SIGNAL_PATTERN = /\b(kaffee|coffee|espresso|latte|cappuccino|cafe|café)\b/i;
const SOURCE_PREFIX_PATTERN = /\s+(?:auf|on)\s+(?:instagram|tiktok)\s*:\s*/i;
const WEAK_TITLE_PATTERN = /^(free|gratis|deal|angebot|aktion|promo|special|event|instagram|tiktok|new|neu)$/i;

function hasUsefulWords(text) {
  const words = cleanText(text).split(/\s+/).filter(Boolean);
  return words.length >= 3;
}

function isSocialUrl(url = '') {
  return /instagram\.com|tiktok\.com/i.test(cleanText(url));
}

function socialPostAgeDays(deal, now = new Date()) {
  const pubDateMs = Date.parse(cleanText(deal?.pubDate || ''));
  if (!Number.isFinite(pubDateMs)) return null;
  return (now.getTime() - pubDateMs) / (1000 * 60 * 60 * 24);
}

function expiredDealAgeDays(deal, now = new Date()) {
  const expiresMs = Date.parse(cleanText(deal?.expires || ''));
  if (!Number.isFinite(expiresMs)) return null;
  return (now.getTime() - expiresMs) / (1000 * 60 * 60 * 24);
}

function hasCurrentExpiryEvidence(deal, now = new Date()) {
  const expiresMs = Date.parse(cleanText(deal?.expires || ''));
  if (Number.isFinite(expiresMs)) return expiresMs >= now.getTime();

  for (const field of ['validOn', 'validUntil']) {
    const value = cleanText(deal?.[field] || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) continue;
    const endOfDayMs = Date.parse(`${value}T23:59:59.999Z`);
    if (Number.isFinite(endOfDayMs) && endOfDayMs >= now.getTime()) return true;
  }

  const expiryText = cleanText([
    deal?.expiryDisplayText,
    deal?.expiresOriginal,
    deal?.validity_date,
  ].filter(Boolean).join(' ')).toLowerCase();
  if (!expiryText) return false;
  if (/\b(kurzfristig|siehe\s+(?:post|tiktok|instagram)|laut quelle|k\.a\.?|unbekannt|nicht angegeben)\b/i.test(expiryText)) {
    return false;
  }
  return /\b(dauerhaft|laufend|jederzeit|bei jedem besuch|geburtstag|jeden\b|wöchentlich|woechentlich|monatlich|regelm[aä]ßig|regelmaessig)\b/i.test(expiryText);
}

function hasReliableSocialPubDate(deal = {}) {
  const source = cleanText(deal.pubDateSource || '').toLowerCase();
  if (/^url\./i.test(source)) return true;
  if ([
    'socialpostdate',
    'profiletimeline',
    'derivedpubdate',
    'firecrawlagentrun',
    'time.datetime',
    'url.contextpublished',
  ].includes(source)) {
    return true;
  }

  const signal = cleanText([deal.originSource, deal.source].filter(Boolean).join(' ')).toLowerCase();
  return /(tiktok-deals-scanner|instagram(?:\s|-|_)|firecrawl food #3|firecrawl instagram|firecrawl gastro|apify)/i.test(signal);
}

function hasRunBudget(used, limit) {
  if (!Number.isFinite(limit)) return true;
  return used < Math.max(0, limit);
}

function isFlightDeal(deal = {}) {
  const id = cleanText(deal.id || '');
  if (/^flight-/i.test(id)) return true;

  const signal = [
    deal.category,
    deal.source,
    deal.originSource,
    deal.brand,
    deal.title,
    deal.description,
    deal.url,
  ].map(cleanText).filter(Boolean).join(' ');

  return FLIGHT_DEAL_PATTERN.test(signal);
}

function normalizeSocialPostKey(url = '') {
  const text = cleanText(url).toLowerCase();
  if (!isSocialUrl(text)) return '';
  return text.replace(/\/+$/, '/');
}

function reviewCandidateKey(deal = {}) {
  const id = cleanText(deal.id || '');
  if (id) return `id:${id}`;
  const url = normalizeUrlForCompare(deal.url || '');
  return url ? `url:${url}` : '';
}

function compactReviewCandidate(deal = {}, reason = '', details = {}, now = new Date()) {
  return {
    id: cleanText(deal.id || ''),
    title: cleanText(deal.title || deal.brand || '?'),
    brand: cleanText(deal.brand || ''),
    category: cleanText(deal.category || ''),
    type: cleanText(deal.type || ''),
    url: cleanText(deal.url || ''),
    pubDate: cleanText(deal.pubDate || ''),
    expires: cleanText(deal.expires || ''),
    expiresOriginal: cleanText(deal.expiresOriginal || ''),
    expiresSource: cleanText(deal.expiresSource || ''),
    expiresPrecision: cleanText(deal.expiresPrecision || ''),
    dateConfidence: cleanText(deal.dateConfidence || ''),
    reason: cleanText(reason),
    details,
    queuedAt: now.toISOString(),
  };
}

function isStrongInvalidHealth(deal, health) {
  if (!health?.invalid) return false;
  const reason = cleanText(health.reason || '');
  if (reason === 'Ungültige Ziel-URL') return true;
  if (/HTTP\s+(404|410|451)\b/i.test(reason)) return true;
  if (/angebot abgelaufen|aktion beendet|deal beendet|offer expired/i.test(reason)) return true;
  if (isSocialUrl(deal?.url || health?.finalUrl || '')) return false;
  return /seite nicht gefunden|inhalt nicht mehr verfügbar|seite oder account nicht gefunden/i.test(reason);
}

function isStrongExpiredDealEvidence(deal) {
  const source = cleanText(deal.expiresSource || '').toLowerCase();
  const precision = cleanText(deal.expiresPrecision || '').toLowerCase();
  const confidence = cleanText(deal.dateConfidence || '').toLowerCase();
  const fromUrl = Boolean(deal.expiresDetectedFromUrl || source === 'url');
  const exactDay = precision === 'day';
  const highConfidence = confidence === 'high';

  if (fromUrl) return exactDay && highConfidence;
  if (source === 'text') return exactDay && highConfidence;
  return false;
}

function shouldQueueExpiredDealForReview(deal, now = new Date()) {
  if (!isExpiredDealRecord(deal, now)) return false;
  if (isSocialUrl(deal.url || '')) {
    const ageDays = socialPostAgeDays(deal, now);
    if (Number.isFinite(ageDays) && ageDays > MAX_SOCIAL_POST_AGE_DAYS && hasReliableSocialPubDate(deal)) {
      return false;
    }
    return !isStrongExpiredDealEvidence(deal);
  }
  const expiredAgeDays = expiredDealAgeDays(deal, now);
  if (Number.isFinite(expiredAgeDays) && expiredAgeDays > MAX_EXPIRED_REVIEW_GRACE_DAYS) {
    return false;
  }
  return !isStrongExpiredDealEvidence(deal);
}

function looksAddressLike(value = '') {
  const text = cleanUiNoiseText(value).toLowerCase();
  if (!text) return false;
  return /\d/.test(text) || /(gasse|straße|strasse|platz|weg|allee)\b/i.test(text);
}

function isSourceLikeBrandValue(value = '') {
  return /^(instagram|tiktok|social media)$/i.test(cleanUiNoiseText(value));
}

function stripQuotedWrapper(value = '') {
  const text = cleanText(value);
  return text.replace(/^["'“”]+|["'“”]+$/g, '').trim();
}

function extractSocialSnippet(value = '') {
  const text = cleanText(value);
  if (!text) return '';
  const parts = text.split(SOURCE_PREFIX_PATTERN);
  const candidate = parts.length > 1 ? parts.slice(1).join(' ') : text;
  return stripQuotedWrapper(candidate)
    .replace(/@\S+/g, ' ')
    .replace(/[•·|]/g, ' ')
    .replace(/\b(?:\p{Extended_Pictographic}|\uFE0F)\b/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tidySocialSummary(value = '', maxLength = 96) {
  const text = extractSocialSnippet(value)
    .replace(/\s*-\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;
  const shortened = text.slice(0, maxLength);
  const lastSpace = shortened.lastIndexOf(' ');
  return `${shortened.slice(0, lastSpace > 48 ? lastSpace : maxLength).trim()}...`;
}

function extractSocialHandle(value = '') {
  const match = cleanText(value).match(/@([a-z0-9._]{3,40})/i);
  return match ? match[1] : '';
}

function prettifySocialHandle(handle = '') {
  const text = cleanText(handle)
    .replace(/[._]+/g, ' ')
    .replace(/\b\d{2,4}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  return text
    .split(' ')
    .map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : '')
    .join(' ')
    .trim();
}

function localizeFreeText(value = '') {
  const text = cleanText(value);
  if (!text) return '';
  return text
    .replace(/^free in\s+/i, 'Gratis in ')
    .replace(/^free bei\s+/i, 'Gratis bei ')
    .replace(/^free\b/i, 'Gratis')
    .replace(/\bfree\b/gi, 'gratis');
}

function collapseRepeatedBrandLocation(value = '', brand = '', location = '') {
  const text = cleanText(value);
  if (!text) return '';
  const normalizedBrand = cleanUiNoiseText(brand).toLowerCase();
  const normalizedLocation = cleanUiNoiseText(location).toLowerCase();
  if (!normalizedBrand || normalizedBrand !== normalizedLocation) return text;
  const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`\\bbei\\s+${escaped}\\s+in\\s+${escaped}\\b`, 'i'), `bei ${brand}`);
}

function buildSocialTitleFallback(deal) {
  const brand = cleanUiNoiseText(deal.brand || '');
  if (!brand) return '';
  if (deal.type === 'gratis') return `Gratis bei ${brand}`;
  if (deal.type === 'bogo') return `1+1 bei ${brand}`;
  if (deal.type === 'rabatt') return `${brand}: Rabatt`;
  return brand;
}

function scoreNormalizedDeal(deal) {
  let score = 0;
  const brand = cleanUiNoiseText(deal.brand || '');
  const title = cleanUiNoiseText(deal.title || '');
  const description = cleanUiNoiseText(deal.description || '');
  const category = cleanUiNoiseText(deal.category || '').toLowerCase();
  const pubDateSource = cleanUiNoiseText(deal.pubDateSource || '');

  if (brand && !isSourceLikeBrandValue(brand)) score += 12;
  if (brand && !looksAddressLike(brand)) score += 8;
  if (title && !WEAK_TITLE_PATTERN.test(title)) score += 10;
  if (hasUsefulWords(description)) score += 8;
  if (FOOD_SIGNAL_PATTERN.test(`${title} ${description}`)) score += 10;
  if (category === 'essen' || category === 'kaffee') score += 8;
  if (pubDateSource) score += 4;
  score += Math.min(description.length, 160) / 40;
  score += Math.min(title.length, 100) / 30;

  if (isSourceLikeBrandValue(brand)) score -= 12;
  if (looksAddressLike(brand)) score -= 8;
  if (WEAK_TITLE_PATTERN.test(title)) score -= 8;
  if (category === 'kultur' || category === 'events' || category === 'reisen') score -= 6;

  return score;
}

function pickBetterNormalizedDeal(current, candidate) {
  const currentScore = scoreNormalizedDeal(current);
  const candidateScore = scoreNormalizedDeal(candidate);
  if (candidateScore !== currentScore) {
    return candidateScore > currentScore ? candidate : current;
  }

  const currentPubDate = Date.parse(cleanText(current.pubDate || '')) || 0;
  const candidatePubDate = Date.parse(cleanText(candidate.pubDate || '')) || 0;
  if (candidatePubDate !== currentPubDate) {
    return candidatePubDate > currentPubDate ? candidate : current;
  }

  const currentApproved = Date.parse(cleanText(current.approvedAt || '')) || 0;
  const candidateApproved = Date.parse(cleanText(candidate.approvedAt || '')) || 0;
  if (candidateApproved !== currentApproved) {
    return candidateApproved > currentApproved ? candidate : current;
  }

  return candidate;
}

function dedupeNormalizedLiveDeals(deals) {
  const deduped = [];
  const byId = new Map();
  const bySocialPost = new Map();

  for (const deal of deals) {
    let existingIndex = -1;
    const socialPostKey = normalizeSocialPostKey(deal.url || '');
    if (socialPostKey && bySocialPost.has(socialPostKey)) {
      existingIndex = bySocialPost.get(socialPostKey);
    }

    const id = cleanText(deal.id || '');
    if (existingIndex === -1 && id && byId.has(id)) {
      existingIndex = byId.get(id);
    }

    if (existingIndex >= 0) {
      const merged = pickBetterNormalizedDeal(deduped[existingIndex], deal);
      deduped[existingIndex] = merged;
      const mergedId = cleanText(merged.id || '');
      const mergedSocialPostKey = normalizeSocialPostKey(merged.url || '');
      if (mergedId) byId.set(mergedId, existingIndex);
      if (mergedSocialPostKey) bySocialPost.set(mergedSocialPostKey, existingIndex);
      continue;
    }

    const nextIndex = deduped.length;
    deduped.push(deal);
    if (id) byId.set(id, nextIndex);
    if (socialPostKey) bySocialPost.set(socialPostKey, nextIndex);
  }

  return deduped;
}

function detectOfferLabel(text = '') {
  const signal = cleanText(text).toLowerCase();
  if (/(eis|gelato|ice cream|cone)/.test(signal)) return 'Eis';
  if (/(kaffee|coffee|espresso|latte|cappuccino|matcha)/.test(signal)) return 'Kaffee';
  if (/(pizza)/.test(signal)) return 'Pizza';
  if (/(burger)/.test(signal)) return 'Burger';
  if (/(döner|doener|kebab)/.test(signal)) return 'Döner';
  if (/(sushi)/.test(signal)) return 'Sushi';
  if (/(drink|cocktail|getränk|getraenk)/.test(signal)) return 'Getränk';
  if (/(croissant|krapfen|brioche|pastry)/.test(signal)) return 'Gebäck';
  if (/(popcorn)/.test(signal)) return 'Popcorn';
  return '';
}

function buildNaturalSocialDescription(deal, socialDescription = '') {
  const brand = cleanUiNoiseText(deal.brand || '');
  const location = cleanUiNoiseText(deal.distance || '');
  const locationDistinct = location && location.toLowerCase() !== brand.toLowerCase() ? location : '';
  const offerLabel = detectOfferLabel(`${deal.title || ''} ${socialDescription || ''}`);
  if (deal.type === 'gratis') {
    if (offerLabel && brand && locationDistinct) return `Gratis ${offerLabel} bei ${brand} in ${locationDistinct}`;
    if (offerLabel && brand) return `Gratis ${offerLabel} bei ${brand}`;
    if (brand && locationDistinct) return `Gratis bei ${brand} in ${locationDistinct}`;
  }
  if (deal.type === 'bogo') {
    if (offerLabel && brand && locationDistinct) return `1+1 ${offerLabel} bei ${brand} in ${locationDistinct}`;
    if (brand && locationDistinct) return `1+1 Angebot bei ${brand} in ${locationDistinct}`;
  }
  if (deal.type === 'rabatt' && brand && locationDistinct && /^grand opening discount$/i.test(cleanUiNoiseText(deal.title || ''))) {
    return `Grand Opening Rabatt bei ${brand} in ${locationDistinct}`;
  }
  return '';
}

function normalizeSocialDeal(deal) {
  if (!isSocialUrl(deal.url)) return deal;

  const next = { ...deal };
  const editedFields = getSlackEditedFieldSet(next);
  const socialTitle = tidySocialSummary(next.title, 96);
  const socialDescription = localizeFreeText(tidySocialSummary(next.description, 160));
  const inferredBrand = cleanUiNoiseText(inferPreferredBrand(next));
  const handleBrand = prettifySocialHandle(extractSocialHandle(`${next.title || ''} ${next.description || ''}`));
  const combinedText = [next.brand, socialTitle, socialDescription, next.distance].filter(Boolean).join(' ');

  if (isSourceLikeBrandValue(next.brand) && handleBrand && !isSourceLikeBrandValue(handleBrand)) {
    next.brand = handleBrand;
  } else if (isSourceLikeBrandValue(next.brand) && inferredBrand && !isSourceLikeBrandValue(inferredBrand)) {
    next.brand = inferredBrand;
  }

  if (!editedFields.has('title')) {
    if (/^(instagram|tiktok)$/i.test(cleanUiNoiseText(next.title)) || /(?:auf|on)\s+(?:instagram|tiktok)\s*:/i.test(next.title || '')) {
      if (socialTitle && !/^(instagram|tiktok)$/i.test(cleanUiNoiseText(socialTitle))) {
        next.title = socialTitle;
      } else {
        const fallbackTitle = buildSocialTitleFallback(next);
        if (fallbackTitle) next.title = fallbackTitle;
      }
    } else if ((next.title || '').includes('&#') && socialTitle) {
      next.title = socialTitle;
    }
  }

  if (!editedFields.has('description')) {
    if (isWeakDescription(next.description)) {
      const fallbackDescription = buildFallbackDescription({
        ...next,
        brand: next.brand,
        title: next.title,
        category: next.category,
        type: next.type,
      });
      next.description = buildNaturalSocialDescription(next, socialDescription) || socialDescription || fallbackDescription || localizeFreeText(next.description);
    } else if (socialDescription && /(?:auf|on)\s+(?:instagram|tiktok)\s*:/i.test(next.description || '')) {
      next.description = buildNaturalSocialDescription(next, socialDescription) || socialDescription;
    } else {
      next.description = buildNaturalSocialDescription(next, socialDescription) || localizeFreeText(next.description);
    }
    next.description = collapseRepeatedBrandLocation(next.description, next.brand, next.distance);
  }

  if (!editedFields.has('title') && isWeakTitle(next.title)) {
    const fallbackTitle = buildSocialTitleFallback(next);
    if (fallbackTitle) next.title = fallbackTitle;
  }

  if (!editedFields.has('category') && (next.category === 'kultur' || next.category === 'events' || next.category === 'reisen' || next.category === 'shopping' || next.category === 'beauty') && FOOD_SIGNAL_PATTERN.test(combinedText)) {
    next.category = COFFEE_SIGNAL_PATTERN.test(combinedText) ? 'kaffee' : 'essen';
  }

  return next;
}

function inferSocialPubDateSource(deal) {
  if (!isSocialUrl(deal.url)) return '';
  const existing = cleanText(deal.pubDateSource || '');
  if (existing) return existing;

  const signal = cleanText([deal.originSource, deal.source, deal.url].filter(Boolean).join(' ')).toLowerCase();
  if (!deal.pubDate) return '';
  if (signal.includes('firecrawl food #3')) return 'firecrawlAgentRun';
  if (signal.includes('instagram discovery')) return 'profileTimeline';
  if (
    signal.includes('firecrawl key 3') ||
    signal.includes('firecrawl consumables') ||
    signal.includes('firecrawl instagram direct #4') ||
    signal.includes('firecrawl instagram gastro #5') ||
    signal.includes('instagram web') ||
    signal.includes('instagram daily sync')
  ) {
    return 'socialPostDate';
  }
  if (deal.slackTs) return 'slackImported';
  return 'derivedPubDate';
}

function isOpaqueSocialShellHealth(health, url = '') {
  if (!isSocialUrl(url)) return false;
  const title = cleanUiNoiseText(health?.contentHints?.title || '').toLowerCase();
  const description = cleanUiNoiseText(health?.contentHints?.description || '');
  if (description) return false;
  return title === 'instagram' || title === 'tiktok make your day' || title === 'tiktok - make your day';
}

function shouldDropOpaqueSocialShellDeal(deal, health, now) {
  if (!isOpaqueSocialShellHealth(health, health?.finalUrl || deal?.url || '')) return false;
  const pubDateMs = Date.parse(cleanText(deal?.pubDate || ''));
  if (!Number.isFinite(pubDateMs)) return true;
  const ageDays = (now.getTime() - pubDateMs) / (1000 * 60 * 60 * 24);
  return ageDays >= MAX_OPAQUE_SOCIAL_AGE_DAYS;
}

function isoDateOnly(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function applyVerifiedSocialPublicationDate(deal, health) {
  if (!isSocialUrl(deal?.url || '')) return { deal, changed: false };
  const publicationDate = cleanText(health?.dateHints?.publicationDate || '');
  const publicationMs = Date.parse(publicationDate);
  if (!Number.isFinite(publicationMs)) return { deal, changed: false };

  const source = cleanText(health?.dateHints?.publicationDateSource || 'urlPublicationDate');
  const next = {
    ...deal,
    pubDate: new Date(publicationMs).toISOString(),
    pubDateSource: `url.${source}`,
  };
  return {
    deal: next,
    changed: next.pubDate !== cleanText(deal.pubDate || '') || next.pubDateSource !== cleanText(deal.pubDateSource || ''),
  };
}

function getSocialPostFreshnessRemovalReason(deal, now) {
  if (!isSocialUrl(deal?.url || '')) return '';
  const pubDateText = cleanText(deal?.pubDate || '');
  const source = cleanText(deal?.pubDateSource || '');

  if (!hasReliableSocialPubDate(deal)) {
    return '';
  }
  const ageDays = socialPostAgeDays(deal, now);
  if (!Number.isFinite(ageDays)) {
    return '';
  }
  if (ageDays < -1.5) {
    return `Social-Postdatum liegt in der Zukunft (${isoDateOnly(pubDateText)})`;
  }

  if (ageDays > MAX_SOCIAL_POST_AGE_DAYS && !hasCurrentExpiryEvidence(deal, now)) {
    const expiryText = cleanText(deal?.expiryDisplayText || deal?.expiresOriginal || deal?.expires || '');
    const suffix = expiryText && isVagueExpiry(expiryText) ? ', kein konkretes Ablaufdatum' : '';
    return `Social-Post älter als ${MAX_SOCIAL_POST_AGE_DAYS} Tage (${isoDateOnly(pubDateText)}, ${source || 'unbekannte Quelle'}${suffix})`;
  }
  return '';
}

function stripSiteSuffix(value) {
  const text = cleanText(value);
  if (!text) return '';
  return text
    .replace(/\s+[|·•-]\s+(instagram|facebook|tiktok|x|twitter|threads)$/i, '')
    .replace(/\s+[|·•-]\s+[^|·•-]{0,24}$/i, (suffix) => /\b(wien|vienna|gratis|free|deal|angebot|aktion|rezept|news|blog)\b/i.test(suffix) ? suffix : '')
    .trim();
}

function isWeakDescription(value) {
  const text = cleanText(value);
  if (!text) return true;
  if (GENERIC_DESCRIPTION_PATTERN.test(text)) return true;
  if (text.length <= 16 && !hasUsefulWords(text)) return true;
  if (/^(instagram|freefinder)\s*\/\s*(free|gratis|deal|angebot)$/i.test(text)) return true;
  return false;
}

function isWeakTitle(value) {
  const text = cleanText(value);
  if (!text) return true;
  if (GENERIC_DESCRIPTION_PATTERN.test(text)) return true;
  return text.length <= 12 && !hasUsefulWords(text);
}

function getSlackEditedFieldSet(deal) {
  const fields = Array.isArray(deal?.slackEditedFields) ? deal.slackEditedFields : [];
  return new Set(fields.map((field) => cleanText(field)).filter(Boolean));
}

function isSlackEditedField(deal, field) {
  return getSlackEditedFieldSet(deal).has(field);
}

function normalizeHintText(value, maxLength = 180) {
  const text = stripSiteSuffix(value)
    .replace(/\b(jetzt|heute|aktuell|neu)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;
  const shortened = text.slice(0, maxLength);
  const lastSpace = shortened.lastIndexOf(' ');
  return `${shortened.slice(0, lastSpace > 80 ? lastSpace : maxLength).trim()}...`;
}

function maybeEnrichDealCopy(deal, contentHints = {}) {
  const hintTitle = normalizeHintText(contentHints.title || '', 120);
  const hintDescription = normalizeHintText(contentHints.description || '', 180);
  let changed = false;

  if (!isSlackEditedField(deal, 'description') && isWeakDescription(deal.description)) {
    const candidateDescription = [hintDescription, hintTitle]
      .find((candidate) => candidate && !GENERIC_DESCRIPTION_PATTERN.test(candidate) && candidate.toLowerCase() !== cleanText(deal.description).toLowerCase());
    if (candidateDescription) {
      deal.description = candidateDescription;
      changed = true;
    }
  }

  if (!isSlackEditedField(deal, 'title') && isWeakTitle(deal.title)) {
    const candidateTitle = [hintTitle, hintDescription]
      .map((candidate) => normalizeHintText(candidate, 96))
      .find((candidate) => candidate && !GENERIC_DESCRIPTION_PATTERN.test(candidate) && candidate.toLowerCase() !== cleanText(deal.title).toLowerCase());
    if (candidateTitle) {
      deal.title = candidateTitle;
      changed = true;
    }
  }

  return changed;
}

function isGenericCategory(value = '') {
  return new Set(['', 'wien', 'gratis', 'shopping', 'kultur', 'events', 'reisen']).has(cleanUiNoiseText(value).toLowerCase());
}

function collectBundleDeals(bundle) {
  if (Array.isArray(bundle)) return bundle;
  if (Array.isArray(bundle?.deals)) return bundle.deals;
  if (Array.isArray(bundle?.candidates)) return bundle.candidates;
  return [];
}

function buildSupplementalUrl(rawDeal = {}) {
  return normalizeTargetUrl(rawDeal.url || rawDeal.postUrl || rawDeal.post_url || rawDeal.link || '');
}

function mergeSupplementalSocialDeal(deal, supplementalDeal) {
  if (!supplementalDeal) return deal;

  const next = { ...deal };
  let changed = false;
  const currentScore = scoreNormalizedDeal(deal);
  const supplementalScore = scoreNormalizedDeal(supplementalDeal);
  const currentBrand = cleanUiNoiseText(next.brand || '');
  const currentTitle = cleanUiNoiseText(next.title || '');
  const currentDescription = cleanUiNoiseText(next.description || '');
  const currentCategory = cleanUiNoiseText(next.category || '').toLowerCase();
  const editedFields = getSlackEditedFieldSet(next);

  const assignIfBetter = (key, value, predicate = true) => {
    const text = cleanText(value);
    if (!predicate || !text) return;
    if (editedFields.has(key)) return;
    if (cleanText(next[key] || '') === text) return;
    next[key] = value;
    changed = true;
  };

  assignIfBetter(
    'brand',
    supplementalDeal.brand,
    !currentBrand || isSourceLikeBrandValue(currentBrand) || looksAddressLike(currentBrand),
  );

  assignIfBetter(
    'title',
    supplementalDeal.title,
    isWeakTitle(next.title) || /bei instagram$/i.test(currentTitle) || supplementalScore > currentScore + 6,
  );

  assignIfBetter(
    'description',
    supplementalDeal.description,
    isWeakDescription(next.description) || /bei instagram\b/i.test(currentDescription) || supplementalScore > currentScore + 6,
  );

  assignIfBetter(
    'category',
    supplementalDeal.category,
    isGenericCategory(currentCategory) || ((supplementalDeal.category === 'essen' || supplementalDeal.category === 'kaffee') && FOOD_SIGNAL_PATTERN.test(`${next.title} ${next.description} ${supplementalDeal.title} ${supplementalDeal.description}`)),
  );

  assignIfBetter(
    'distance',
    supplementalDeal.distance,
    !cleanText(next.distance || '') || cleanText(next.distance || '').toLowerCase().startsWith('wien'),
  );

  assignIfBetter('type', supplementalDeal.type, !cleanText(next.type || ''));
  assignIfBetter('pubDate', supplementalDeal.pubDate, !cleanText(next.pubDate || ''));
  assignIfBetter('pubDateSource', supplementalDeal.pubDateSource, !cleanText(next.pubDateSource || ''));
  assignIfBetter('expires', supplementalDeal.expires, !cleanText(next.expires || ''));
  assignIfBetter('expiresOriginal', supplementalDeal.expiresOriginal, !cleanText(next.expiresOriginal || ''));
  assignIfBetter('expiresPrecision', supplementalDeal.expiresPrecision, !cleanText(next.expiresPrecision || ''));
  assignIfBetter('expiresSource', supplementalDeal.expiresSource, !cleanText(next.expiresSource || ''));
  assignIfBetter('expiryKind', supplementalDeal.expiryKind, !cleanText(next.expiryKind || ''));
  assignIfBetter('validUntil', supplementalDeal.validUntil, !cleanText(next.validUntil || ''));

  return changed ? next : deal;
}

function cleanText(value) {
  if (!value) return '';
  return String(value)
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);/g, (_, num) => {
      const code = Number.parseInt(num, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTargetUrl(value) {
  const text = cleanText(value);
  if (!text) return '';
  return text;
}

function normalizeVariantTargetUrl(deal = {}) {
  const variantUrl = OMV_VIVA_FREE_TASTE_URLS.get(cleanText(deal.id || ''));
  return variantUrl || normalizeTargetUrl(deal.url);
}

function normalizeUrlForCompare(value) {
  const text = normalizeTargetUrl(value);
  if (!text) return '';
  try {
    const parsed = new URL(text);
    if (parsed.pathname !== '/' && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return text.replace(/\/+$/, '');
  }
}

function getChurchCuratedIds(churchDeals) {
  return new Set(churchDeals.map((deal) => deal.id).filter(Boolean));
}

function isCuratedChurchDeal(deal = {}) {
  const category = cleanText(deal.category || '').toLowerCase();
  const source = cleanText(deal.source || '').toLowerCase();
  const signal = cleanText([
    deal.brand,
    deal.title,
    deal.description,
    deal.category,
    deal.source,
  ].filter(Boolean).join(' ')).toLowerCase();
  return source.includes('freikirchen wien') ||
    ['kirche', 'gottesdienste', 'gemeinde', 'freikirche'].includes(category) ||
    /\b(gottesdienst|gottesdienste|freikirche|kirche|christlich|hillsong|icf|jesuszentrum|cig\s+wien|gemeinde)\b/i.test(signal);
}

function liveFeedSortRank(deal = {}) {
  return isCuratedChurchDeal(deal) ? 95 : 0;
}

function compareLiveFeedDeals(a, b) {
  const rankDelta = liveFeedSortRank(a) - liveFeedSortRank(b);
  if (rankDelta !== 0) return rankDelta;

  const aTime = Date.parse(a.pubDate || '') || 0;
  const bTime = Date.parse(b.pubDate || '') || 0;
  if (aTime !== bTime) return bTime - aTime;

  const aPriority = Number.isFinite(Number(a.priority)) ? Number(a.priority) : 99;
  const bPriority = Number.isFinite(Number(b.priority)) ? Number(b.priority) : 99;
  if (aPriority !== bPriority) return aPriority - bPriority;

  return cleanText(a.title || a.brand || '').localeCompare(cleanText(b.title || b.brand || ''));
}

function normalizeChurchDealForLiveFeed(deal = {}) {
  if (!isCuratedChurchDeal(deal)) return { ...deal };
  const category = cleanText(deal.category || '').toLowerCase();
  return {
    ...deal,
    type: category === 'events' ? 'event' : 'info',
    hot: false,
  };
}

function shouldDropExplicitlyRemovedDeal(deal) {
  const url = cleanText(deal?.url || deal?.post_url || '');
  return REMOVE_IDS.has(deal.id)
    || EXPIRED_DEAL_URL_PATTERNS.some((pattern) => pattern.test(url))
    || LEGACY_CHURCH_ID_PATTERNS.some((pattern) => pattern.test(String(deal?.id || '')));
}

function shouldForceKeepDeal(deal) {
  const id = cleanText(deal?.id || '');
  if (FORCE_KEEP_IDS.has(id) || FORCE_KEEP_DYNAMIC_IDS.has(id)) return true;
  const url = normalizeUrlForCompare(deal?.url || '');
  return Boolean(url && FORCE_KEEP_DYNAMIC_URLS.has(url));
}

function fixPubDateFromSlackTs(deal, now) {
  if (!deal?.slackTs) return deal;
  const slackTs = Number(String(deal.slackTs).split('.')[0]);
  if (!Number.isFinite(slackTs) || slackTs <= 0) return deal;

  const slackDate = new Date(slackTs * 1000);
  const pubDate = Date.parse(deal.pubDate || '');
  if (
    Number.isNaN(pubDate) ||
    Math.abs(pubDate - slackDate.getTime()) > 1000 * 60 * 60 * 24 * 3 ||
    pubDate > now.getTime() + 1000 * 60 * 60 * 36
  ) {
    return { ...deal, pubDate: slackDate.toISOString() };
  }

  return deal;
}

function resetUnsafeUrlExpiry(deal) {
  const raw = cleanText(deal.expiresOriginal || deal.expires || '');
  if (
    deal.expiresSource === 'url' &&
    shouldSkipUrlExpiryLookup(deal, deal.url || '', raw)
  ) {
    const next = { ...deal };
    if (raw) {
      next.expires = raw;
      next.expiresOriginal = raw;
      next.expiresPrecision = 'unknown';
      next.expiresSource = 'raw';
    } else {
      next.expires = '';
      next.expiresPrecision = '';
      next.expiresSource = '';
    }
    delete next.expiresDetectedFromUrl;
    return next;
  }

  return deal;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function loadDynamicForceKeepDeals() {
  FORCE_KEEP_DYNAMIC_IDS.clear();
  FORCE_KEEP_DYNAMIC_URLS.clear();

  try {
    const store = await readJson(LIVE_DEAL_EDITS_PATH);
    const edits = Array.isArray(store?.edits) ? store.edits : [];
    for (const edit of edits) {
      if (!edit || edit.hidden === true || edit.forceKeep !== true) continue;
      const id = cleanText(edit.dealId || edit.id || edit.restoreDeal?.id || '');
      if (id) FORCE_KEEP_DYNAMIC_IDS.add(id);
      const url = normalizeUrlForCompare(edit.url || edit.restoreDeal?.url || '');
      if (url) FORCE_KEEP_DYNAMIC_URLS.add(url);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn(`Could not read live deal force-keep edits: ${error.message}`);
    }
  }
}

async function loadCuratedChurchDeals() {
  const bundles = await Promise.all(CHURCH_FILES.map((filePath) => readJson(filePath)));
  return bundles.flatMap((bundle) => Array.isArray(bundle?.deals) ? bundle.deals : []);
}

async function loadSupplementalSocialIndex() {
  const supplementalByUrl = new Map();
  const pendingFiles = (await readdir(DOCS_DIR))
    .filter((name) => /^deals-pending-.*\.json$/i.test(name))
    .map((name) => path.join(DOCS_DIR, name));
  const sourceFiles = [DEAL_CANDIDATES_INDEX_PATH, ...pendingFiles];

  for (const filePath of sourceFiles) {
    let bundle;
    try {
      bundle = await readJson(filePath);
    } catch {
      continue;
    }

    for (const rawDeal of collectBundleDeals(bundle)) {
      const url = buildSupplementalUrl(rawDeal);
      const socialPostKey = normalizeSocialPostKey(url);
      if (!socialPostKey) continue;

      let candidate = normalizeDealRecord({ ...rawDeal, url });
      candidate = normalizeSocialDeal(candidate);
      const inferredPubDateSource = inferSocialPubDateSource(candidate);
      if (inferredPubDateSource && !cleanText(candidate.pubDateSource || '')) {
        candidate.pubDateSource = inferredPubDateSource;
      }

      const existing = supplementalByUrl.get(socialPostKey);
      if (!existing || pickBetterNormalizedDeal(existing, candidate) === candidate) {
        supplementalByUrl.set(socialPostKey, candidate);
      }
    }
  }

  return supplementalByUrl;
}

async function loadProtectedLiveDealRestores() {
  const protectedDealsById = new Map();
  const pendingFiles = (await readdir(DOCS_DIR))
    .filter((name) => /^deals-pending-.*\.json$/i.test(name))
    .map((name) => path.join(DOCS_DIR, name));
  const sourceFiles = [DEAL_CANDIDATES_INDEX_PATH, ...pendingFiles];

  for (const filePath of sourceFiles) {
    let bundle;
    try {
      bundle = await readJson(filePath);
    } catch {
      continue;
    }

    for (const rawDeal of collectBundleDeals(bundle)) {
      const id = cleanText(rawDeal?.id || '');
      if (!PROTECTED_LIVE_RESTORE_IDS.has(id)) continue;

      const candidate = normalizeDealRecord({
        ...rawDeal,
        id,
        url: normalizeVariantTargetUrl({ id, url: rawDeal.url || rawDeal.postUrl || rawDeal.post_url || rawDeal.link || '' }),
        type: 'gratis',
        category: 'kaffee',
        hot: true,
        forceRestored: true,
      });
      const existing = protectedDealsById.get(id);
      if (!existing || pickBetterNormalizedDeal(existing, candidate) === candidate) {
        protectedDealsById.set(id, candidate);
      }
    }
  }

  return protectedDealsById;
}

async function main() {
  const now = new Date();
  const urlCache = new Map();
  const linkHealthCache = new Map();
  const dealsDoc = await readJson(DEALS_PATH);
  await loadDynamicForceKeepDeals();
  const supplementalSocialByUrl = await loadSupplementalSocialIndex();
  const protectedLiveDealRestores = await loadProtectedLiveDealRestores();
  const totalBefore = Array.isArray(dealsDoc.deals) ? dealsDoc.deals.length : 0;
  const churchDeals = await loadCuratedChurchDeals();
  const curatedChurchIds = getChurchCuratedIds(churchDeals);

  const remaining = [];
  const seenIds = new Set();
  const removed = [];
  const reviewCandidatesByKey = new Map();
  let linkChecksUsed = 0;
  let brokenLinkRemovals = 0;
  let opaqueSocialShellRemovals = 0;
  let invalidLinkReviewCandidates = 0;
  let opaqueSocialShellReviewCandidates = 0;
  let socialPostDateRemovals = 0;
  let socialPostDateFixes = 0;
  let expiryUrlChecksUsed = 0;
  let urlVerifiedExpiryHits = 0;
  let expiredByVerifiedDateRemovals = 0;
  let expiredReviewCandidates = 0;
  let contentEnrichments = 0;
  let socialPubDateSourceFixes = 0;
  let socialPolishFixes = 0;
  let duplicateCollapses = 0;
  let protectedLiveDealRestoresCount = 0;
  let flightUrlCheckSkips = 0;
  let moderationRemovals = 0;
  let freshnessFlagUpdates = 0;
  let freshDealCount = 0;

  function markRemoved(deal, reason) {
    removed.push({
      id: deal?.id || '',
      title: cleanText(deal?.title || deal?.brand || '?'),
      brand: cleanText(deal?.brand || ''),
      description: cleanText(deal?.description || ''),
      category: cleanText(deal?.category || ''),
      type: cleanText(deal?.type || ''),
      logo: cleanText(deal?.logo || ''),
      distance: cleanText(deal?.distance || deal?.location || deal?.address || ''),
      url: cleanText(deal?.url || ''),
      source: cleanText(deal?.source || ''),
      originSource: cleanText(deal?.originSource || deal?.source || ''),
      pubDate: cleanText(deal?.pubDate || ''),
      expires: cleanText(deal?.expires || ''),
      expiresOriginal: cleanText(deal?.expiresOriginal || deal?.expires || ''),
      expiresPrecision: cleanText(deal?.expiresPrecision || ''),
      expiresSource: cleanText(deal?.expiresSource || ''),
      expiresDetectedFromUrl: Boolean(deal?.expiresDetectedFromUrl),
      validOn: cleanText(deal?.validOn || ''),
      validFrom: cleanText(deal?.validFrom || ''),
      validUntil: cleanText(deal?.validUntil || ''),
      expiryKind: cleanText(deal?.expiryKind || ''),
      expiryDisplayText: cleanText(deal?.expiryDisplayText || ''),
      qualityScore: Number(deal?.qualityScore) || 0,
      votes: Number(deal?.votes) || 1,
      priority: Number(deal?.priority) || 3,
      hot: Boolean(deal?.hot),
      isNew: Boolean(deal?.isNew),
      slackTs: cleanText(deal?.slackTs || ''),
      slackThreadTs: cleanText(deal?.slackThreadTs || ''),
      approvedAt: cleanText(deal?.approvedAt || ''),
      removedAutomatically: !/^Moderation:|^Explizit entfernter Deal$/i.test(reason),
      reason,
    });
    if (!CAN_REMOVE_LIVE_DEALS) {
      markForReview(deal, `Auto-Entfernung pausiert: ${reason}`);
    }
  }

  function shouldRemoveDeal(deal, reason) {
    markRemoved(deal, reason);
    return CAN_REMOVE_LIVE_DEALS;
  }

  function markForReview(deal, reason, details = {}) {
    const key = reviewCandidateKey(deal);
    if (!key) return;
    const existing = reviewCandidatesByKey.get(key);
    const candidate = compactReviewCandidate(deal, reason, details, now);
    if (existing) {
      reviewCandidatesByKey.set(key, {
        ...existing,
        reason: Array.from(new Set([existing.reason, candidate.reason].filter(Boolean))).join(' + '),
        details: {
          ...existing.details,
          ...candidate.details,
        },
      });
      return;
    }
    reviewCandidatesByKey.set(key, candidate);
  }

  async function verifyDealUrl(deal) {
    if (isFlightDeal(deal)) {
      flightUrlCheckSkips += 1;
      return null;
    }
    const url = cleanText(deal?.url || '');
    if (!url || !/^https?:\/\//i.test(url)) return null;
    const cached = linkHealthCache.has(url);
    if (!cached && !hasRunBudget(linkChecksUsed, MAX_LIVE_URL_HEALTH_CHECKS)) {
      return null;
    }
    let result = linkHealthCache.get(url);
    if (!cached) {
      result = await inspectDealUrlHealth(url, { timeoutMs: process.env.URL_CHECK_TIMEOUT_MS });
      linkHealthCache.set(url, result);
      linkChecksUsed += 1;
    }
    return result || null;
  }

  for (const original of dealsDoc.deals || []) {
    if (!original || typeof original !== 'object') continue;
    const forceKeep = shouldForceKeepDeal(original);
    if (!forceKeep && shouldDropExplicitlyRemovedDeal(original)) {
      if (shouldRemoveDeal(original, 'Explizit entfernter Deal')) continue;
    }
    if (!forceKeep && curatedChurchIds.has(original.id)) {
      markRemoved(original, 'Wird durch kuratierten Kirche-/Event-Eintrag ersetzt');
      continue;
    }

    let deal = { ...original };
    deal.url = normalizeVariantTargetUrl(deal);
    deal = fixPubDateFromSlackTs(deal, now);
    deal = resetUnsafeUrlExpiry(deal);
    deal = normalizeDealRecord(deal);
    const supplementalSocial = supplementalSocialByUrl.get(normalizeSocialPostKey(deal.url || ''));
    if (supplementalSocial) {
      const mergedSocial = mergeSupplementalSocialDeal(deal, supplementalSocial);
      if (mergedSocial !== deal) {
        deal = normalizeDealRecord(mergedSocial);
      }
    }
    const beforePolish = JSON.stringify({
      brand: deal.brand,
      title: deal.title,
      description: deal.description,
      category: deal.category,
      pubDateSource: deal.pubDateSource,
    });
    deal = normalizeSocialDeal(deal);
    const inferredPubDateSource = inferSocialPubDateSource(deal);
    if (inferredPubDateSource && inferredPubDateSource !== cleanText(deal.pubDateSource || '')) {
      deal.pubDateSource = inferredPubDateSource;
      socialPubDateSourceFixes += 1;
    }
    const afterPolish = JSON.stringify({
      brand: deal.brand,
      title: deal.title,
      description: deal.description,
      category: deal.category,
      pubDateSource: deal.pubDateSource,
    });
    if (beforePolish !== afterPolish) {
      socialPolishFixes += 1;
    }
    const rawExpiry = cleanText(
      deal.expires ||
      deal.expiresOriginal ||
      deal.end_date ||
      deal.validity_date ||
      ''
    );
    const skipUrlChecksForDeal = isFlightDeal(deal);
    const expiryCacheHit = deal.url ? urlCache.has(deal.url) : false;
    const allowExpiryUrlLookup = Boolean(
      !skipUrlChecksForDeal &&
      deal.url &&
      !shouldSkipUrlExpiryLookup(deal, deal.url || '', rawExpiry) &&
      (expiryCacheHit || hasRunBudget(expiryUrlChecksUsed, MAX_LIVE_URL_EXPIRY_REFRESHES))
    );
    const expiryCacheSizeBefore = urlCache.size;
    const hadUrlDerivedExpiry = Boolean(deal.expiresDetectedFromUrl);

    await normalizeDealExpiry(deal, {
      now,
      allowUrlLookup: allowExpiryUrlLookup,
      forceUrlLookup: true,
      urlCache,
    });

    if (allowExpiryUrlLookup && deal.url && !expiryCacheHit && urlCache.size > expiryCacheSizeBefore) {
      expiryUrlChecksUsed += 1;
    }
    if (!hadUrlDerivedExpiry && deal.expiresDetectedFromUrl) {
      urlVerifiedExpiryHits += 1;
    }
    deal.expires = sanitizeExpiryText(deal.expires);

    const health = await verifyDealUrl(deal);
    if (!forceKeep && health?.invalid) {
      if (isStrongInvalidHealth(deal, health)) {
        brokenLinkRemovals += 1;
        if (shouldRemoveDeal(deal, `Ziellink ungültig: ${health.reason}`)) continue;
      }
      invalidLinkReviewCandidates += 1;
      markForReview(deal, 'Ziellink prüfen: nicht eindeutig ungültig', {
        healthReason: cleanText(health.reason || ''),
        status: health.status || null,
        finalUrl: cleanText(health.finalUrl || ''),
      });
    }
    if (health?.finalUrl) {
      const currentUrl = normalizeUrlForCompare(deal.url);
      const finalUrl = normalizeUrlForCompare(health.finalUrl);
      if (finalUrl && finalUrl !== currentUrl) {
        deal.url = health.finalUrl;
      }
    }
    const socialDateUpdate = applyVerifiedSocialPublicationDate(deal, health);
    if (socialDateUpdate.changed) {
      deal = normalizeDealRecord(socialDateUpdate.deal);
      socialPostDateFixes += 1;
    }
    const socialFreshnessRemovalReason = getSocialPostFreshnessRemovalReason(deal, now);
    if (!forceKeep && socialFreshnessRemovalReason) {
      socialPostDateRemovals += 1;
      if (shouldRemoveDeal(deal, socialFreshnessRemovalReason)) continue;
    }
    if (!forceKeep && shouldDropOpaqueSocialShellDeal(deal, health, now)) {
      opaqueSocialShellReviewCandidates += 1;
      markForReview(deal, 'Social-Post öffentlich nicht eindeutig verifizierbar', {
        healthReason: cleanText(health?.reason || ''),
        status: health?.status || null,
        finalUrl: cleanText(health?.finalUrl || ''),
      });
    }
    if (!skipUrlChecksForDeal && health?.contentHints && hasRunBudget(contentEnrichments, MAX_LIVE_CONTENT_ENRICHMENTS)) {
      const enriched = maybeEnrichDealCopy(deal, health.contentHints);
      if (enriched) {
        contentEnrichments += 1;
        const polished = normalizeSocialDeal(deal);
        if (JSON.stringify(polished) !== JSON.stringify(deal)) {
          deal = polished;
          socialPolishFixes += 1;
        }
        const enrichedPubDateSource = inferSocialPubDateSource(deal);
        if (enrichedPubDateSource && enrichedPubDateSource !== cleanText(deal.pubDateSource || '')) {
          deal.pubDateSource = enrichedPubDateSource;
          socialPubDateSourceFixes += 1;
        }
      }
    }
    if (!forceKeep && isGenericJunkDeal(deal)) {
      if (shouldRemoveDeal(deal, 'Generischer Junk-Deal')) continue;
    }
    if (!forceKeep && isFalsePositiveFreeDeal(deal)) {
      if (shouldRemoveDeal(deal, 'False Positive Free Deal')) continue;
    }
    if (isExpiredDealRecord(deal, now)) {
      if (!forceKeep && shouldQueueExpiredDealForReview(deal, now)) {
        expiredReviewCandidates += 1;
        markForReview(deal, 'Ablaufdatum unsicher - bitte manuell prüfen', {
          expires: cleanText(deal.expires || ''),
          expiresOriginal: cleanText(deal.expiresOriginal || ''),
          expiresSource: cleanText(deal.expiresSource || ''),
          expiresPrecision: cleanText(deal.expiresPrecision || ''),
          dateConfidence: cleanText(deal.dateConfidence || ''),
          expiresDetectedFromUrl: Boolean(deal.expiresDetectedFromUrl),
        });
      } else if (deal.expiresDetectedFromUrl || deal.expiresSource === 'url') {
        expiredByVerifiedDateRemovals += 1;
        if (shouldRemoveDeal(deal, 'Deal laut Zielseite abgelaufen')) continue;
      } else {
        if (shouldRemoveDeal(deal, 'Deal abgelaufen')) continue;
      }
    }
    if (!deal.id) {
      if (shouldRemoveDeal(deal, 'Deal ohne ID')) continue;
    }
    if (seenIds.has(deal.id)) {
      if (shouldRemoveDeal(deal, 'Doppelte Deal-ID')) continue;
    }

    seenIds.add(deal.id);
    remaining.push(deal);
  }

  for (const [id, restoreDeal] of protectedLiveDealRestores.entries()) {
    let deal = normalizeDealRecord({ ...restoreDeal });
    deal.url = normalizeVariantTargetUrl(deal);
    deal = resetUnsafeUrlExpiry(deal);
    await normalizeDealExpiry(deal, {
      now,
      allowUrlLookup: false,
      forceUrlLookup: false,
      urlCache,
    });
    deal.expires = sanitizeExpiryText(deal.expires);

    if (isExpiredDealRecord(deal, now)) {
      if (shouldRemoveDeal(deal, 'Geschützter OMV-VIVA-Deal abgelaufen')) continue;
    }
    if (!deal.id) continue;

    seenIds.add(deal.id);
    remaining.push(deal);
    protectedLiveDealRestoresCount += 1;
  }

  for (const churchDeal of churchDeals) {
    const normalizedChurchDeal = normalizeDealRecord(normalizeChurchDealForLiveFeed(churchDeal));
    const churchRawExpiry = cleanText(
      normalizedChurchDeal.expires ||
      normalizedChurchDeal.expiresOriginal ||
      normalizedChurchDeal.end_date ||
      normalizedChurchDeal.validity_date ||
      ''
    );
    const churchSkipUrlChecks = isFlightDeal(normalizedChurchDeal);
    const churchExpiryCacheHit = normalizedChurchDeal.url ? urlCache.has(normalizedChurchDeal.url) : false;
    const churchAllowExpiryUrlLookup = Boolean(
      !churchSkipUrlChecks &&
      normalizedChurchDeal.url &&
      !shouldSkipUrlExpiryLookup(normalizedChurchDeal, normalizedChurchDeal.url || '', churchRawExpiry) &&
      (churchExpiryCacheHit || hasRunBudget(expiryUrlChecksUsed, MAX_LIVE_URL_EXPIRY_REFRESHES))
    );
    const churchExpiryCacheSizeBefore = urlCache.size;
    const churchHadUrlDerivedExpiry = Boolean(normalizedChurchDeal.expiresDetectedFromUrl);

    await normalizeDealExpiry(normalizedChurchDeal, {
      now,
      allowUrlLookup: churchAllowExpiryUrlLookup,
      forceUrlLookup: true,
      urlCache,
    });

    if (churchAllowExpiryUrlLookup && normalizedChurchDeal.url && !churchExpiryCacheHit && urlCache.size > churchExpiryCacheSizeBefore) {
      expiryUrlChecksUsed += 1;
    }
    if (!churchHadUrlDerivedExpiry && normalizedChurchDeal.expiresDetectedFromUrl) {
      urlVerifiedExpiryHits += 1;
    }
    normalizedChurchDeal.expires = sanitizeExpiryText(normalizedChurchDeal.expires);
    if (isFalsePositiveFreeDeal(normalizedChurchDeal)) {
      if (shouldRemoveDeal(normalizedChurchDeal, 'False Positive Church Deal')) continue;
    }
    if (isExpiredDealRecord(normalizedChurchDeal, now)) {
      if (shouldQueueExpiredDealForReview(normalizedChurchDeal, now)) {
        expiredReviewCandidates += 1;
        markForReview(normalizedChurchDeal, 'Kirchen-/Event-Ablaufdatum unsicher - bitte manuell prüfen', {
          expires: cleanText(normalizedChurchDeal.expires || ''),
          expiresOriginal: cleanText(normalizedChurchDeal.expiresOriginal || ''),
          expiresSource: cleanText(normalizedChurchDeal.expiresSource || ''),
          expiresPrecision: cleanText(normalizedChurchDeal.expiresPrecision || ''),
          dateConfidence: cleanText(normalizedChurchDeal.dateConfidence || ''),
          expiresDetectedFromUrl: Boolean(normalizedChurchDeal.expiresDetectedFromUrl),
        });
      } else if (normalizedChurchDeal.expiresDetectedFromUrl || normalizedChurchDeal.expiresSource === 'url') {
        expiredByVerifiedDateRemovals += 1;
        if (shouldRemoveDeal(normalizedChurchDeal, 'Kirchen-/Event-Deal laut Zielseite abgelaufen')) continue;
      } else {
        if (shouldRemoveDeal(normalizedChurchDeal, 'Kirchen-/Event-Deal abgelaufen')) continue;
      }
    }
    if (!normalizedChurchDeal.id) {
      if (shouldRemoveDeal(normalizedChurchDeal, 'Kirchen-/Event-Deal ohne ID')) continue;
    }
    if (seenIds.has(normalizedChurchDeal.id)) {
      if (shouldRemoveDeal(normalizedChurchDeal, 'Doppelte Kirchen-/Event-ID')) continue;
    }
    seenIds.add(normalizedChurchDeal.id);
    remaining.push(normalizedChurchDeal);
  }

  const dedupedRemaining = dedupeNormalizedLiveDeals(remaining);
  duplicateCollapses = remaining.length - dedupedRemaining.length;

  const moderation = loadDealModeration();
  const moderationFilter = filterModeratedDeals(dedupedRemaining, moderation);
  moderationRemovals = moderationFilter.removed.length;
  for (const deal of moderationFilter.removed) {
    markRemoved(deal, `Moderation: ${deal.reason}`);
  }

  const finalRemaining = CAN_REMOVE_LIVE_DEALS ? moderationFilter.deals : dedupedRemaining;
  const freshness = normalizeDealFreshnessFlags(finalRemaining, { now });
  finalRemaining.splice(0, finalRemaining.length, ...freshness.deals);
  freshnessFlagUpdates = freshness.changed;
  freshDealCount = freshness.freshCount;
  const reviewCandidateSourceDeals = APPLY_LIVE_VALIDATION ? finalRemaining : (Array.isArray(dealsDoc.deals) ? dealsDoc.deals : []);
  const finalDealKeys = new Set(reviewCandidateSourceDeals.map((deal) => reviewCandidateKey(deal)).filter(Boolean));
  const reviewCandidates = Array.from(reviewCandidatesByKey.values())
    .filter((candidate) => finalDealKeys.has(reviewCandidateKey(candidate)))
    .sort((a, b) => {
      const aTime = Date.parse(a.pubDate || '') || 0;
      const bTime = Date.parse(b.pubDate || '') || 0;
      return bTime - aTime;
    });

  finalRemaining.sort(compareLiveFeedDeals);

  let nativeWeeklyAlignment = { reason: 'not_run' };
  try {
    const weeklyPick = await readJson(WEEKLY_DEAL_PATH);
    const aligned = alignNativeWeeklyDealRotation({ deals: finalRemaining }, weeklyPick, { now });
    nativeWeeklyAlignment = aligned.report;
    if (aligned.changed && Array.isArray(aligned.bundle?.deals)) {
      finalRemaining.splice(0, finalRemaining.length, ...aligned.bundle.deals);
    }
  } catch (error) {
    nativeWeeklyAlignment = { reason: 'error', message: cleanText(error?.message || error) };
  }

  const removalReasons = removed.reduce((acc, entry) => {
    acc[entry.reason] = (acc[entry.reason] || 0) + 1;
    return acc;
  }, {});

  if (APPLY_LIVE_VALIDATION) {
    dealsDoc.deals = finalRemaining;
    dealsDoc.totalDeals = finalRemaining.length;
    dealsDoc.lastUpdated = now.toISOString();
    await writeFile(DEALS_PATH, JSON.stringify(dealsDoc, null, 2) + '\n', 'utf8');
  }

  await writeFile(REVIEW_CANDIDATES_PATH, JSON.stringify({
    checkedAt: now.toISOString(),
    totalCandidates: reviewCandidates.length,
    candidates: reviewCandidates.slice(0, 200),
  }, null, 2) + '\n', 'utf8');
  await writeFile(VALIDATION_REPORT_PATH, JSON.stringify({
    checkedAt: now.toISOString(),
    apply: APPLY_LIVE_VALIDATION,
    removalsEnabled: LIVE_DEAL_REMOVALS_ENABLED,
    removalsPaused: !CAN_REMOVE_LIVE_DEALS,
    totalBefore,
    totalAfter: APPLY_LIVE_VALIDATION ? finalRemaining.length : totalBefore,
    removedCount: CAN_REMOVE_LIVE_DEALS ? removed.length : 0,
    wouldRemoveCount: removed.length,
    duplicateCollapses,
    moderationRemovals,
    freshnessWindowHours: configuredNewDealWindowHours(),
    freshnessFlagUpdates,
    freshDealCount,
    brokenLinkRemovals,
    opaqueSocialShellRemovals,
    invalidLinkReviewCandidates,
    opaqueSocialShellReviewCandidates,
    socialPostDateRemovals,
    socialPostDateFixes,
    maxSocialPostAgeDays: MAX_SOCIAL_POST_AGE_DAYS,
    expiredByVerifiedDateRemovals,
    expiredReviewCandidates,
    reviewCandidateCount: reviewCandidates.length,
    socialPubDateSourceFixes,
    linkChecksUsed,
    maxLinkChecks: MAX_LIVE_URL_HEALTH_CHECKS,
    expiryUrlChecksUsed,
    maxExpiryUrlChecks: MAX_LIVE_URL_EXPIRY_REFRESHES,
    urlVerifiedExpiryHits,
    contentEnrichments,
    maxContentEnrichments: MAX_LIVE_CONTENT_ENRICHMENTS,
    flightUrlCheckSkips,
    protectedLiveDealRestores: protectedLiveDealRestoresCount,
    socialPolishFixes,
    nativeWeeklyAlignment,
    removalReasons,
    reviewCandidates: reviewCandidates.slice(0, 100),
    removed: removed.slice(0, 200),
  }, null, 2) + '\n', 'utf8');

  console.log(`Normalized live deals: ${APPLY_LIVE_VALIDATION ? finalRemaining.length : totalBefore}`);
  console.log(`Live validation apply: ${APPLY_LIVE_VALIDATION ? 'enabled' : 'disabled'}`);
  console.log(`Live deal removals: ${CAN_REMOVE_LIVE_DEALS ? 'enabled' : 'paused'}`);
  console.log(`${CAN_REMOVE_LIVE_DEALS ? 'Removed' : 'Would remove'} deals: ${removed.length}`);
  console.log(`Duplicate collapses: ${duplicateCollapses}`);
  console.log(`Moderation removals: ${moderationRemovals}`);
  console.log(`Fresh deal flags: ${freshDealCount} new, ${freshnessFlagUpdates} updated within ${configuredNewDealWindowHours()}h window`);
  console.log(`Broken link removals: ${brokenLinkRemovals}`);
  console.log(`Opaque social shell removals: ${opaqueSocialShellRemovals}`);
  console.log(`Invalid link review candidates: ${invalidLinkReviewCandidates}`);
  console.log(`Opaque social shell review candidates: ${opaqueSocialShellReviewCandidates}`);
  console.log(`Expired review candidates: ${expiredReviewCandidates}`);
  console.log(`Review candidates kept live: ${reviewCandidates.length}`);
  console.log(`Social post date removals: ${socialPostDateRemovals}`);
  console.log(`Social post date fixes: ${socialPostDateFixes}`);
  console.log(`Social pubDateSource fixes applied: ${socialPubDateSourceFixes}`);
  console.log(`Link health checks: ${linkChecksUsed}/${MAX_LIVE_URL_HEALTH_CHECKS}`);
  console.log(`Expiry refresh checks: ${expiryUrlChecksUsed}/${MAX_LIVE_URL_EXPIRY_REFRESHES}`);
  console.log(`Expiry dates refreshed from URL: ${urlVerifiedExpiryHits}`);
  console.log(`Descriptions enriched from target pages: ${contentEnrichments}/${MAX_LIVE_CONTENT_ENRICHMENTS}`);
  console.log(`Flight URL checks skipped: ${flightUrlCheckSkips}`);
  console.log(`Social polish fixes applied: ${socialPolishFixes}`);
}

main().catch((error) => {
  console.error('normalize-live-deals failed:', error);
  process.exitCode = 1;
});

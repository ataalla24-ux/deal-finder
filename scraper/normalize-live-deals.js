import '../sentry/instrument.mjs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { inspectDealUrlHealth, normalizeDealExpiry, shouldSkipUrlExpiryLookup } from './expiry-utils.js';
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const DEALS_PATH = path.join(DOCS_DIR, 'deals.json');
const VALIDATION_REPORT_PATH = path.join(DOCS_DIR, 'live-deal-validation-report.json');
const DEAL_CANDIDATES_INDEX_PATH = path.join(DOCS_DIR, 'deal-candidates-index.json');
const CHURCH_FILES = [
  path.join(ROOT, 'docs', 'deals-pending-church-gemeinde.json'),
  path.join(ROOT, 'docs', 'deals-pending-church-gottesdienste.json'),
  path.join(ROOT, 'docs', 'deals-pending-church-events.json'),
];

const REMOVE_IDS = new Set([
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

const MAX_LIVE_URL_HEALTH_CHECKS = Number(process.env.MAX_LIVE_URL_HEALTH_CHECKS || 180);
const MAX_LIVE_URL_EXPIRY_REFRESHES = Number(process.env.MAX_LIVE_URL_EXPIRY_REFRESHES || 120);
const MAX_LIVE_CONTENT_ENRICHMENTS = Number(process.env.MAX_LIVE_CONTENT_ENRICHMENTS || 120);
const MAX_OPAQUE_SOCIAL_AGE_DAYS = Number(process.env.MAX_LIVE_OPAQUE_SOCIAL_AGE_DAYS || 14);
const GENERIC_DESCRIPTION_PATTERN = /^(free|gratis|rabatt|discount|deal|angebot|aktion|promo|special|event|post|reel|instagram|coupon|gutschein|gewinnspiel|new|neu)$/i;
const FOOD_SIGNAL_PATTERN = /\b(eis\w*|ice cream|gelato|kaffee\w*|coffee|cafe|café|pizza\w*|burger\w*|döner\w*|doener\w*|kebab\w*|sushi|ramen|brunch|croissant|drink|drinks|getränk\w*|getraenk\w*|cocktail\w*|bistro|restaurant|snack|schnitzel|falafel|bowl|popcorn|wein\w*|vino|fleisch\w*|meat|steak|bbq|grill\w*|bäckerei|backerei|bakery|krapfen\w*)\b/i;
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

function normalizeSocialPostKey(url = '') {
  const text = cleanText(url).toLowerCase();
  if (!isSocialUrl(text)) return '';
  return text.replace(/\/+$/, '/');
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

  if (!editedFields.has('category') && (next.category === 'kultur' || next.category === 'events' || next.category === 'reisen' || next.category === 'shopping') && FOOD_SIGNAL_PATTERN.test(combinedText)) {
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

function shouldDropLegacyChurchDeal(deal) {
  return REMOVE_IDS.has(deal.id) || LEGACY_CHURCH_ID_PATTERNS.some((pattern) => pattern.test(String(deal?.id || '')));
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

async function main() {
  const now = new Date();
  const urlCache = new Map();
  const linkHealthCache = new Map();
  const dealsDoc = await readJson(DEALS_PATH);
  const supplementalSocialByUrl = await loadSupplementalSocialIndex();
  const totalBefore = Array.isArray(dealsDoc.deals) ? dealsDoc.deals.length : 0;
  const churchDeals = await loadCuratedChurchDeals();
  const curatedChurchIds = getChurchCuratedIds(churchDeals);

  const remaining = [];
  const seenIds = new Set();
  const removed = [];
  let linkChecksUsed = 0;
  let brokenLinkRemovals = 0;
  let opaqueSocialShellRemovals = 0;
  let expiryUrlChecksUsed = 0;
  let urlVerifiedExpiryHits = 0;
  let expiredByVerifiedDateRemovals = 0;
  let contentEnrichments = 0;
  let socialPubDateSourceFixes = 0;
  let socialPolishFixes = 0;
  let duplicateCollapses = 0;

  function markRemoved(deal, reason) {
    removed.push({
      id: deal?.id || '',
      title: cleanText(deal?.title || deal?.brand || '?'),
      category: cleanText(deal?.category || ''),
      url: cleanText(deal?.url || ''),
      reason,
    });
  }

  async function verifyDealUrl(deal) {
    const url = cleanText(deal?.url || '');
    if (!url || !/^https?:\/\//i.test(url)) return null;
    const cached = linkHealthCache.has(url);
    if (!cached && linkChecksUsed >= MAX_LIVE_URL_HEALTH_CHECKS) {
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
    if (shouldDropLegacyChurchDeal(original)) {
      markRemoved(original, 'Legacy-Kircheneintrag entfernt');
      continue;
    }
    if (curatedChurchIds.has(original.id)) {
      markRemoved(original, 'Wird durch kuratierten Kirche-/Event-Eintrag ersetzt');
      continue;
    }

    let deal = { ...original };
    deal.url = normalizeTargetUrl(deal.url);
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
      deal.expiresOriginal ||
      deal.expires ||
      deal.end_date ||
      deal.validity_date ||
      ''
    );
    const expiryCacheHit = deal.url ? urlCache.has(deal.url) : false;
    const allowExpiryUrlLookup = Boolean(
      deal.url &&
      !shouldSkipUrlExpiryLookup(deal, deal.url || '', rawExpiry) &&
      (expiryCacheHit || expiryUrlChecksUsed < MAX_LIVE_URL_EXPIRY_REFRESHES)
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
    if (health?.invalid) {
      brokenLinkRemovals += 1;
      markRemoved(deal, `Ziellink ungültig: ${health.reason}`);
      continue;
    }
    if (health?.finalUrl) {
      const currentUrl = normalizeUrlForCompare(deal.url);
      const finalUrl = normalizeUrlForCompare(health.finalUrl);
      if (finalUrl && finalUrl !== currentUrl) {
        deal.url = health.finalUrl;
      }
    }
    if (shouldDropOpaqueSocialShellDeal(deal, health, now)) {
      brokenLinkRemovals += 1;
      opaqueSocialShellRemovals += 1;
      markRemoved(deal, 'Social-Post nicht mehr öffentlich verifizierbar');
      continue;
    }
    if (health?.contentHints && contentEnrichments < MAX_LIVE_CONTENT_ENRICHMENTS) {
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
    if (isGenericJunkDeal(deal)) {
      markRemoved(deal, 'Generischer Junk-Deal');
      continue;
    }
    if (isFalsePositiveFreeDeal(deal)) {
      markRemoved(deal, 'False Positive Free Deal');
      continue;
    }
    if (isExpiredDealRecord(deal, now)) {
      if (deal.expiresDetectedFromUrl || deal.expiresSource === 'url') {
        expiredByVerifiedDateRemovals += 1;
        markRemoved(deal, 'Deal laut Zielseite abgelaufen');
      } else {
        markRemoved(deal, 'Deal abgelaufen');
      }
      continue;
    }
    if (!deal.id) {
      markRemoved(deal, 'Deal ohne ID');
      continue;
    }
    if (seenIds.has(deal.id)) {
      markRemoved(deal, 'Doppelte Deal-ID');
      continue;
    }

    seenIds.add(deal.id);
    remaining.push(deal);
  }

  for (const churchDeal of churchDeals) {
    const normalizedChurchDeal = normalizeDealRecord({ ...churchDeal });
    const churchRawExpiry = cleanText(
      normalizedChurchDeal.expiresOriginal ||
      normalizedChurchDeal.expires ||
      normalizedChurchDeal.end_date ||
      normalizedChurchDeal.validity_date ||
      ''
    );
    const churchExpiryCacheHit = normalizedChurchDeal.url ? urlCache.has(normalizedChurchDeal.url) : false;
    const churchAllowExpiryUrlLookup = Boolean(
      normalizedChurchDeal.url &&
      !shouldSkipUrlExpiryLookup(normalizedChurchDeal, normalizedChurchDeal.url || '', churchRawExpiry) &&
      (churchExpiryCacheHit || expiryUrlChecksUsed < MAX_LIVE_URL_EXPIRY_REFRESHES)
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
      markRemoved(normalizedChurchDeal, 'False Positive Church Deal');
      continue;
    }
    if (isExpiredDealRecord(normalizedChurchDeal, now)) {
      if (normalizedChurchDeal.expiresDetectedFromUrl || normalizedChurchDeal.expiresSource === 'url') {
        expiredByVerifiedDateRemovals += 1;
        markRemoved(normalizedChurchDeal, 'Kirchen-/Event-Deal laut Zielseite abgelaufen');
      } else {
        markRemoved(normalizedChurchDeal, 'Kirchen-/Event-Deal abgelaufen');
      }
      continue;
    }
    if (!normalizedChurchDeal.id) {
      markRemoved(normalizedChurchDeal, 'Kirchen-/Event-Deal ohne ID');
      continue;
    }
    if (seenIds.has(normalizedChurchDeal.id)) {
      markRemoved(normalizedChurchDeal, 'Doppelte Kirchen-/Event-ID');
      continue;
    }
    seenIds.add(normalizedChurchDeal.id);
    remaining.push(normalizedChurchDeal);
  }

  const dedupedRemaining = dedupeNormalizedLiveDeals(remaining);
  duplicateCollapses = remaining.length - dedupedRemaining.length;

  dedupedRemaining.sort((a, b) => {
    const aTime = Date.parse(a.pubDate || '') || 0;
    const bTime = Date.parse(b.pubDate || '') || 0;
    return bTime - aTime;
  });

  dealsDoc.deals = dedupedRemaining;
  dealsDoc.totalDeals = dedupedRemaining.length;
  dealsDoc.lastUpdated = now.toISOString();

  const removalReasons = removed.reduce((acc, entry) => {
    acc[entry.reason] = (acc[entry.reason] || 0) + 1;
    return acc;
  }, {});

  await writeFile(DEALS_PATH, JSON.stringify(dealsDoc, null, 2) + '\n', 'utf8');
  await writeFile(VALIDATION_REPORT_PATH, JSON.stringify({
    checkedAt: now.toISOString(),
    totalBefore,
    totalAfter: dedupedRemaining.length,
    removedCount: removed.length,
    duplicateCollapses,
    brokenLinkRemovals,
    opaqueSocialShellRemovals,
    expiredByVerifiedDateRemovals,
    socialPubDateSourceFixes,
    linkChecksUsed,
    maxLinkChecks: MAX_LIVE_URL_HEALTH_CHECKS,
    expiryUrlChecksUsed,
    maxExpiryUrlChecks: MAX_LIVE_URL_EXPIRY_REFRESHES,
    urlVerifiedExpiryHits,
    contentEnrichments,
    maxContentEnrichments: MAX_LIVE_CONTENT_ENRICHMENTS,
    socialPolishFixes,
    removalReasons,
    removed: removed.slice(0, 200),
  }, null, 2) + '\n', 'utf8');

  console.log(`Normalized live deals: ${dedupedRemaining.length}`);
  console.log(`Removed deals: ${removed.length}`);
  console.log(`Duplicate collapses: ${duplicateCollapses}`);
  console.log(`Broken link removals: ${brokenLinkRemovals}`);
  console.log(`Opaque social shell removals: ${opaqueSocialShellRemovals}`);
  console.log(`Social pubDateSource fixes applied: ${socialPubDateSourceFixes}`);
  console.log(`Link health checks: ${linkChecksUsed}/${MAX_LIVE_URL_HEALTH_CHECKS}`);
  console.log(`Expiry refresh checks: ${expiryUrlChecksUsed}/${MAX_LIVE_URL_EXPIRY_REFRESHES}`);
  console.log(`Expiry dates refreshed from URL: ${urlVerifiedExpiryHits}`);
  console.log(`Descriptions enriched from target pages: ${contentEnrichments}/${MAX_LIVE_CONTENT_ENRICHMENTS}`);
  console.log(`Social polish fixes applied: ${socialPolishFixes}`);
}

main().catch((error) => {
  console.error('normalize-live-deals failed:', error);
  process.exitCode = 1;
});

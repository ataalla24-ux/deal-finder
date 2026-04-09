import { readFile, writeFile } from 'node:fs/promises';
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
const DEALS_PATH = path.join(ROOT, 'docs', 'deals.json');
const VALIDATION_REPORT_PATH = path.join(ROOT, 'docs', 'live-deal-validation-report.json');
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
const GENERIC_DESCRIPTION_PATTERN = /^(free|gratis|rabatt|discount|deal|angebot|aktion|promo|special|event|post|reel|instagram|coupon|gutschein|gewinnspiel|new|neu)$/i;
const FOOD_SIGNAL_PATTERN = /\b(eis\w*|ice cream|gelato|kaffee\w*|coffee|cafe|café|pizza\w*|burger\w*|döner\w*|doener\w*|kebab\w*|sushi|ramen|brunch|croissant|drink|drinks|getränk\w*|getraenk\w*|cocktail\w*|bistro|restaurant|snack|schnitzel|falafel|bowl|popcorn|wein\w*|vino|fleisch\w*|meat|steak|bbq|grill\w*|bäckerei|backerei|bakery|krapfen\w*)\b/i;
const COFFEE_SIGNAL_PATTERN = /\b(kaffee|coffee|espresso|latte|cappuccino|cafe|café)\b/i;
const SOURCE_PREFIX_PATTERN = /\s+(?:auf|on)\s+(?:instagram|tiktok)\s*:\s*/i;

function hasUsefulWords(text) {
  const words = cleanText(text).split(/\s+/).filter(Boolean);
  return words.length >= 3;
}

function isSocialUrl(url = '') {
  return /instagram\.com|tiktok\.com/i.test(cleanText(url));
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

function buildSocialTitleFallback(deal) {
  const brand = cleanUiNoiseText(deal.brand || '');
  if (!brand) return '';
  if (deal.type === 'gratis') return `Gratis bei ${brand}`;
  if (deal.type === 'bogo') return `1+1 bei ${brand}`;
  if (deal.type === 'rabatt') return `${brand}: Rabatt`;
  return brand;
}

function normalizeSocialDeal(deal) {
  if (!isSocialUrl(deal.url)) return deal;

  const next = { ...deal };
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

  if (isWeakDescription(next.description)) {
    const fallbackDescription = buildFallbackDescription({
      ...next,
      brand: next.brand,
      title: next.title,
      category: next.category,
      type: next.type,
    });
    next.description = socialDescription || fallbackDescription || localizeFreeText(next.description);
  } else if (socialDescription && /(?:auf|on)\s+(?:instagram|tiktok)\s*:/i.test(next.description || '')) {
    next.description = socialDescription;
  } else {
    next.description = localizeFreeText(next.description);
  }

  if (isWeakTitle(next.title)) {
    const fallbackTitle = buildSocialTitleFallback(next);
    if (fallbackTitle) next.title = fallbackTitle;
  }

  if ((next.category === 'kultur' || next.category === 'events' || next.category === 'reisen' || next.category === 'shopping') && FOOD_SIGNAL_PATTERN.test(combinedText)) {
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

  if (isWeakDescription(deal.description)) {
    const candidateDescription = [hintDescription, hintTitle]
      .find((candidate) => candidate && !GENERIC_DESCRIPTION_PATTERN.test(candidate) && candidate.toLowerCase() !== cleanText(deal.description).toLowerCase());
    if (candidateDescription) {
      deal.description = candidateDescription;
      changed = true;
    }
  }

  if (isWeakTitle(deal.title)) {
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

async function main() {
  const now = new Date();
  const urlCache = new Map();
  const linkHealthCache = new Map();
  const dealsDoc = await readJson(DEALS_PATH);
  const totalBefore = Array.isArray(dealsDoc.deals) ? dealsDoc.deals.length : 0;
  const churchDeals = await loadCuratedChurchDeals();
  const curatedChurchIds = getChurchCuratedIds(churchDeals);

  const remaining = [];
  const seenIds = new Set();
  const removed = [];
  let linkChecksUsed = 0;
  let brokenLinkRemovals = 0;
  let expiryUrlChecksUsed = 0;
  let urlVerifiedExpiryHits = 0;
  let expiredByVerifiedDateRemovals = 0;
  let contentEnrichments = 0;
  let socialPubDateSourceFixes = 0;
  let socialPolishFixes = 0;

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

  remaining.sort((a, b) => {
    const aTime = Date.parse(a.pubDate || '') || 0;
    const bTime = Date.parse(b.pubDate || '') || 0;
    return bTime - aTime;
  });

  dealsDoc.deals = remaining;
  dealsDoc.totalDeals = remaining.length;
  dealsDoc.lastUpdated = now.toISOString();

  const removalReasons = removed.reduce((acc, entry) => {
    acc[entry.reason] = (acc[entry.reason] || 0) + 1;
    return acc;
  }, {});

  await writeFile(DEALS_PATH, JSON.stringify(dealsDoc, null, 2) + '\n', 'utf8');
  await writeFile(VALIDATION_REPORT_PATH, JSON.stringify({
    checkedAt: now.toISOString(),
    totalBefore,
    totalAfter: remaining.length,
    removedCount: removed.length,
    brokenLinkRemovals,
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

  console.log(`Normalized live deals: ${remaining.length}`);
  console.log(`Removed deals: ${removed.length}`);
  console.log(`Broken link removals: ${brokenLinkRemovals}`);
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

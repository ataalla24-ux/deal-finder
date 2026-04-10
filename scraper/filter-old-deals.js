// ============================================
// 🗑️ FILTER OLD DEALS - Post-Processing
// Entfernt abgelaufene/alte Deals aus allen pending files
// Läuft NACH Scrapern, VOR slack-notify
// ============================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { inspectDealUrlHealth, normalizeDealExpiry, parseExpiryDetails, shouldVerifyExpiryAgainstUrl } from './expiry-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const docsDir = path.join(__dirname, '..', 'docs');

const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const NOW = new Date();
const TWO_WEEKS_AGO = new Date(NOW.getTime() - TWO_WEEKS_MS);
const SEVEN_DAYS_AGO = new Date(NOW.getTime() - SEVEN_DAYS_MS);
const MAX_URL_EXPIRY_CHECKS = 120;
const MAX_SOCIAL_PUBDATE_CHECKS = Number(process.env.MAX_FILTER_SOCIAL_PUBDATE_CHECKS || 80);
const SOCIAL_PUBDATE_TIMEOUT_MS = Number(process.env.SOCIAL_FRESHNESS_TIMEOUT_MS || 8000);
const TRUSTED_IG_PUBDATE_SOURCES = new Set(['ldDate', 'timeDatetime', 'igScriptTimestamp', 'socialPostDate', 'profileTimeline', 'targetUrlHints']);
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

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanText(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function isSocialUrl(url = '') {
  return /https?:\/\/(?:www\.)?(instagram|tiktok)\.com\//i.test(cleanText(url));
}

function parseDateCandidatesFromText(text) {
  const t = cleanText(text);
  if (!t) return [];
  const out = [];

  for (const match of t.matchAll(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g)) {
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0));
    if (!Number.isNaN(date.getTime())) out.push(date.getTime());
  }

  for (const match of t.matchAll(/\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b/g)) {
    const year = String(match[3]).length === 2 ? Number(`20${match[3]}`) : Number(match[3]);
    const date = new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[1]), 12, 0, 0));
    if (!Number.isNaN(date.getTime())) out.push(date.getTime());
  }

  const monthPattern = '(j[aä]nner|januar|februar|m[aä]rz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember|january|february|march|april|may|june|july|august|september|october|november|december)';
  const dayMonthYearRegex = new RegExp(`\\b(\\d{1,2})\\.?\\s+${monthPattern}\\s*(\\d{4})?\\b`, 'gi');
  for (const match of t.matchAll(dayMonthYearRegex)) {
    const month = MONTH_MAP[String(match[2] || '').toLowerCase()];
    const year = match[3] ? Number(match[3]) : NOW.getUTCFullYear();
    const date = new Date(Date.UTC(year, month, Number(match[1]), 12, 0, 0));
    if (month !== undefined && !Number.isNaN(date.getTime())) out.push(date.getTime());
  }

  const monthDayYearRegex = new RegExp(`\\b${monthPattern}\\s+(\\d{1,2}),?\\s*(\\d{4})?\\b`, 'gi');
  for (const match of t.matchAll(monthDayYearRegex)) {
    const month = MONTH_MAP[String(match[1] || '').toLowerCase()];
    const year = match[3] ? Number(match[3]) : NOW.getUTCFullYear();
    const date = new Date(Date.UTC(year, month, Number(match[2]), 12, 0, 0));
    if (month !== undefined && !Number.isNaN(date.getTime())) out.push(date.getTime());
  }

  return out;
}

function extractRelativeAgeDays(text) {
  const normalized = cleanText(text).toLowerCase();
  if (!normalized) return null;
  const match = normalized.match(/(\d+)\s*(weeks?|wochen|days?|tage|months?|monate|years?|jahre?n?|y|w|d|m)\b/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const unit = match[2].toLowerCase();
  if (unit.startsWith('w') || unit.includes('woch')) return amount * 7;
  if (unit.startsWith('d') || unit.includes('tag')) return amount;
  if (unit.startsWith('m') || unit.includes('monat')) return amount * 30;
  if (unit.startsWith('y') || unit.includes('jahr') || unit.includes('year')) return amount * 365;
  return null;
}

function extractSocialHintTimestamp(text, nowMs = Date.now()) {
  const explicitDates = parseDateCandidatesFromText(text);
  if (explicitDates.length > 0) return Math.max(...explicitDates);

  const ageDays = extractRelativeAgeDays(text);
  if (Number.isFinite(ageDays)) return nowMs - ageDays * SEVEN_DAYS_MS / 7;

  return null;
}

function getEffectivePubDateValue(deal = {}) {
  return cleanText(deal.verifiedTargetPubDate || deal.pubDate || '');
}

async function enrichSocialTargetPubDate(deal, cache) {
  if (!isSocialUrl(deal?.url)) return false;
  const url = cleanText(deal.url);
  if (!url) return false;

  let cached = cache.get(url);
  if (cached === undefined) {
    const health = await inspectDealUrlHealth(url, { timeoutMs: SOCIAL_PUBDATE_TIMEOUT_MS });
    const hintText = [
      health?.contentHints?.description,
      health?.contentHints?.title,
    ].map(cleanText).filter(Boolean).join(' ');
    const ts = extractSocialHintTimestamp(hintText, Date.now());
    cached = Number.isFinite(ts) ? { iso: new Date(ts).toISOString(), source: 'targetUrlHints' } : null;
    cache.set(url, cached);
  }

  if (!cached?.iso) return false;

  deal.verifiedTargetPubDate = cached.iso;
  deal.verifiedTargetPubDateSource = cached.source;
  const currentPubDate = Date.parse(cleanText(deal.pubDate || ''));
  const verifiedPubDate = Date.parse(cached.iso);
  if (
    !Number.isFinite(currentPubDate) ||
    currentPubDate < SEVEN_DAYS_AGO.getTime() ||
    Math.abs(currentPubDate - verifiedPubDate) > 1000 * 60 * 60 * 24 * 3
  ) {
    deal.pubDate = cached.iso;
    deal.pubDateSource = cached.source;
  }

  return true;
}

function isViennaDeal(deal) {
  const haystack = [
    deal.distance,
    deal.location,
    deal.description,
    deal.title,
    deal.brand,
  ]
    .map(normalizeText)
    .join(' ');

  return haystack.includes('wien') || haystack.includes('vienna') || /\b1\d{3}\b/.test(haystack);
}

// ============================================
// Deal-Alter prüfen
// ============================================

function isExpiredOrOld(deal) {
  const sourceText = String(deal.source || '').toLowerCase();
  const isInstagramDeal = sourceText.includes('instagram');
  const isStrictRecentSocialDeal =
    sourceText.includes('firecrawl gastro #2') ||
    sourceText.includes('firecrawl food #3') ||
    sourceText.includes('firecrawl consumables') ||
    sourceText.includes('firecrawl instagram direct #4') ||
    sourceText.includes('firecrawl instagram gastro #5');
  const effectivePubDateSource = String(deal.verifiedTargetPubDateSource || deal.pubDateSource || '');
  const usesTrustedInstagramPubDate = TRUSTED_IG_PUBDATE_SOURCES.has(effectivePubDateSource);

  if (isInstagramDeal && !isStrictRecentSocialDeal && !usesTrustedInstagramPubDate) {
    return { expired: true, reason: 'Instagram-Deal ohne vertrauenswürdige pubDateSource' };
  }

  if (isStrictRecentSocialDeal) {
    const url = String(deal.url || '').toLowerCase();
    if (!(url.includes('instagram.com') || url.includes('tiktok.com'))) {
      return { expired: true, reason: 'Firecrawl Social Deal ohne Instagram- oder TikTok-URL' };
    }
    const effectivePubDate = getEffectivePubDateValue(deal);
    if (!effectivePubDate) {
      return { expired: true, reason: 'Firecrawl Social Deal ohne pubDate' };
    }
    const pub = new Date(effectivePubDate);
    if (isNaN(pub) || pub < SEVEN_DAYS_AGO) {
      return { expired: true, reason: `pubDate "${effectivePubDate}" ist älter als 7 Tage oder ungültig` };
    }
    if (!isViennaDeal(deal)) {
      return { expired: true, reason: 'Firecrawl Social Deal ohne klaren Wien-Bezug' };
    }
  }

  if (isStrictRecentSocialDeal) {
    return { expired: false };
  }

  const dateFields = [
    deal.validity_date,
    deal.end_date,
    deal.expires,
    deal.start_date,
  ].filter(Boolean);

  for (const field of dateFields) {
    const parsed = parseExpiryDetails(field, { now: NOW })?.date;
    if (parsed instanceof Date && parsed < NOW) {
      return { expired: true, reason: `"${field}" → ${parsed.toLocaleDateString('de-AT')} ist abgelaufen` };
    }
  }

  // pubDate-Check: Auch wenn Scraper Date.now() setzen,
  // filtere alles raus was definitiv älter als 2 Wochen ist
  const effectivePubDate = getEffectivePubDateValue(deal);
  if (effectivePubDate && !isStrictRecentSocialDeal) {
    const pub = new Date(effectivePubDate);
    if (!isNaN(pub) && pub < TWO_WEEKS_AGO) {
      return { expired: true, reason: `pubDate "${effectivePubDate}" → ${pub.toLocaleDateString('de-AT')} ist älter als 2 Wochen` };
    }
  }

  return { expired: false };
}

// ============================================
// MAIN
// ============================================

async function main() {
  console.log('🗑️  FILTER OLD DEALS');
  console.log('='.repeat(40));
  console.log(`📅 Heute: ${NOW.toLocaleDateString('de-AT')}`);
  console.log(`📅 Ablaufdatum-Filter: expires/validity < heute, pubDate-Filter: < ${TWO_WEEKS_AGO.toLocaleDateString('de-AT')}`);
  console.log();

  if (!fs.existsSync(docsDir)) {
    console.log('⚠️ docs/ Verzeichnis nicht gefunden');
    process.exit(0);
  }

  const files = fs.readdirSync(docsDir).filter((f) => {
    if (!f.startsWith('deals-pending-') || !f.endsWith('.json')) return false;
    if (f === 'deals-pending-instagram-web.json') return false;
    if (f === 'deals-pending-instagram-discovery.json') return false;
    return true;
  });

  if (files.length === 0) {
    console.log('📭 Keine pending Deal-Dateien gefunden');
    process.exit(0);
  }

  let totalBefore = 0;
  let totalAfter = 0;
  let totalRemoved = 0;
  let urlChecksUsed = 0;
  let urlExpiryHits = 0;
  const urlExpiryCache = new Map();
  const socialPubDateCache = new Map();
  let socialPubDateChecksUsed = 0;
  let socialPubDateHits = 0;

  for (const file of files) {
    const filePath = path.join(docsDir, file);
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const deals = data.deals || [];
      const before = deals.length;
      totalBefore += before;

      const freshDeals = [];
      const removedDeals = [];

      for (const deal of deals) {
        const rawExpiry = String(deal.expires || deal.end_date || deal.validity_date || '').trim();
        const wantsUrlLookup = shouldVerifyExpiryAgainstUrl(deal, { now: NOW });
        const cacheHadUrl = deal.url ? urlExpiryCache.has(deal.url) : false;
        const allowUrlLookup = wantsUrlLookup && (cacheHadUrl || urlChecksUsed < MAX_URL_EXPIRY_CHECKS);
        const hadUrlExpiry = Boolean(deal.expiresDetectedFromUrl);

        await normalizeDealExpiry(deal, {
          now: NOW,
          urlCache: urlExpiryCache,
          allowUrlLookup,
        });

        if (allowUrlLookup && deal.url && !cacheHadUrl && urlExpiryCache.has(deal.url)) {
          urlChecksUsed += 1;
        }
        if (!hadUrlExpiry && deal.expiresDetectedFromUrl) {
          urlExpiryHits += 1;
        }

        if (isSocialUrl(deal.url) && socialPubDateChecksUsed < MAX_SOCIAL_PUBDATE_CHECKS) {
          socialPubDateChecksUsed += 1;
          if (await enrichSocialTargetPubDate(deal, socialPubDateCache)) {
            socialPubDateHits += 1;
          }
        }

        const check = isExpiredOrOld(deal);
        if (check.expired) {
          removedDeals.push({ title: deal.title || deal.brand || '?', reason: check.reason });
        } else {
          freshDeals.push(deal);
        }
      }

      const removed = before - freshDeals.length;
      totalRemoved += removed;
      totalAfter += freshDeals.length;

      // Update file
      data.deals = freshDeals;
      data.totalDeals = freshDeals.length;
      data.filteredAt = NOW.toISOString();
      data.removedCount = removed;
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

      console.log(`📂 ${file}: ${before} → ${freshDeals.length} (${removed} entfernt)`);
      for (const r of removedDeals.slice(0, 5)) {
        console.log(`   🗑️  ${r.title.substring(0, 40)} — ${r.reason}`);
      }
      if (removedDeals.length > 5) {
        console.log(`   ... und ${removedDeals.length - 5} weitere`);
      }
    } catch (e) {
      console.log(`❌ ${file}: ${e.message}`);
    }
  }

  console.log();
  console.log(`🔎 URL-Expiry checks: ${urlChecksUsed}/${MAX_URL_EXPIRY_CHECKS}, Treffer: ${urlExpiryHits}`);
  console.log(`🧭 Social pubDate checks: ${socialPubDateChecksUsed}/${MAX_SOCIAL_PUBDATE_CHECKS}, Treffer: ${socialPubDateHits}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📊 GESAMT: ${totalBefore} → ${totalAfter} Deals (${totalRemoved} entfernt)`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });

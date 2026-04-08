import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { inspectDealUrlHealth, normalizeDealExpiry, shouldSkipUrlExpiryLookup } from './expiry-utils.js';
import {
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

function cleanText(value) {
  if (!value) return '';
  return String(value).replace(/\s+/g, ' ').trim();
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
    deal = fixPubDateFromSlackTs(deal, now);
    deal = resetUnsafeUrlExpiry(deal);
    deal = normalizeDealRecord(deal);
    await normalizeDealExpiry(deal, { now, allowUrlLookup: true, urlCache });
    deal.expires = sanitizeExpiryText(deal.expires);

    const health = await verifyDealUrl(deal);
    if (health?.invalid) {
      brokenLinkRemovals += 1;
      markRemoved(deal, `Ziellink ungültig: ${health.reason}`);
      continue;
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
      markRemoved(deal, 'Deal abgelaufen');
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
    await normalizeDealExpiry(normalizedChurchDeal, { now, allowUrlLookup: true, urlCache });
    normalizedChurchDeal.expires = sanitizeExpiryText(normalizedChurchDeal.expires);
    if (isFalsePositiveFreeDeal(normalizedChurchDeal)) {
      markRemoved(normalizedChurchDeal, 'False Positive Church Deal');
      continue;
    }
    if (isExpiredDealRecord(normalizedChurchDeal, now)) {
      markRemoved(normalizedChurchDeal, 'Kirchen-/Event-Deal abgelaufen');
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
    linkChecksUsed,
    maxLinkChecks: MAX_LIVE_URL_HEALTH_CHECKS,
    removalReasons,
    removed: removed.slice(0, 200),
  }, null, 2) + '\n', 'utf8');

  console.log(`Normalized live deals: ${remaining.length}`);
  console.log(`Removed deals: ${removed.length}`);
  console.log(`Broken link removals: ${brokenLinkRemovals}`);
  console.log(`Link health checks: ${linkChecksUsed}/${MAX_LIVE_URL_HEALTH_CHECKS}`);
}

main().catch((error) => {
  console.error('normalize-live-deals failed:', error);
  process.exitCode = 1;
});

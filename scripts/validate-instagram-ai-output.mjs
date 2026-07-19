import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  loadDealModeration,
  moderationReasonForDeal,
} from '../scraper/deal-moderation-utils.js';
import { canonicalInstagramPostKey } from '../scraper/deal-evidence-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const OUTPUT_PATH = path.join(ROOT, 'docs', 'deals-pending-instagram-ai.json');
const REPORT_PATH = path.join(ROOT, 'docs', 'instagram-ai-report.json');
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const FRESH_PRIORITY_HOURS = 72;
const ABSOLUTE_MAX_POST_AGE_DAYS = 7;
const MAX_FUTURE_CLOCK_SKEW_MS = 10 * 60 * 1000;
const SYNTHETIC_DATE_SOURCE = /(?:agent[-_ ]?run|instagram[-_ ]?ai[-_ ]?agent|firecrawl.*run|current[-_ ]?language|discover(?:ed|y)|crawl(?:ed|er)?(?:at|time)?|scrap(?:ed|er)?(?:at|time)?|generated(?:at|time)?|communitysubmission|submittedat|import(?:ed|er)?(?:at|time)?)/i;
const FALSE_POSITIVE = /\b(?:gewinnspiel|verlosung|giveaway|win a|zu gewinnen|gratis versand|kostenlose lieferung|free shipping|things to do|wochenendtipps|top \d+)\b/i;
const VIENNA_NEGATION = /(?:\b(?:nicht|kein(?:e|en)?|not|no)\s+(?:(?:in|f(?:ü|ue)r)\s+)?(?:wien|vienna)\b|\b(?:wien|vienna)\s+(?:ausgenommen|ausgeschlossen|excluded|excepted|nicht\s+(?:dabei|verf(?:ü|ue)gbar|g(?:ü|ue)ltig))\b|\b(?:except|au(?:ß|ss)er)\s+(?:wien|vienna)\b)/i;
const VIENNA_POSTCODE_OR_ADDRESS = /\b1(?:0[1-9]0|1[0-9]0|2[0-3]0)\b|\b(?:stra(?:ß|ss)e|gasse|platz|weg|ring|allee|kai|markt|zeile|promenade)\b/i;

function isTrustedDateSource(value) {
  const source = String(value || '').trim();
  if (!source || SYNTHETIC_DATE_SOURCE.test(source)) return false;

  const compact = source.toLowerCase().replace(/[^a-z0-9]/g, '');
  const hasProvider = /(?:instagram|apify|meta|graph)/.test(compact);
  const hasConcreteTimestampProvenance = /(?:timestamp|datetime|timetext|datepublished|datecreated|publishedat|uploaddate|takenat|postmetadata|postdate|posttime)/.test(compact);
  const trustedStandalone = /^(?:timedatetime|datepublished|lddatepublished|lddatecreated|lduploaddate|articledatepublished)$/.test(compact);
  return (hasProvider && hasConcreteTimestampProvenance) || trustedStandalone;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function canonicalPostKey(value = '') {
  return canonicalInstagramPostKey(value);
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseValidityStart(value) {
  const text = String(value || '').trim();
  const dateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dateOnly) return parseDate(text);
  const date = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 0, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function localDayStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function validateViennaEvidence(deal, label, errors) {
  const evidence = deal.evidence?.viennaEvidence;
  if (!evidence || typeof evidence !== 'object') {
    errors.push(`${label} has no structured Vienna evidence`);
    return;
  }
  const source = String(evidence.source || '');
  const value = String(evidence.value || '');
  const topLevelEvidence = deal.viennaEvidence;
  if (![
    'instagram-post',
    'structured-location',
    'merchant-registry',
    'verified-account-watchlist',
  ].includes(source)) {
    errors.push(`${label} has unsupported Vienna evidence source: ${source || 'missing'}`);
  }
  if (evidence.verified !== true) errors.push(`${label} Vienna evidence is not explicitly verified`);
  if (!value) errors.push(`${label} has empty Vienna evidence`);
  if (['instagram-post', 'structured-location'].includes(source) && !/\b(?:wien|vienna|1(?:0[1-9]0|1[0-9]0|2[0-3]0))\b/i.test(value)) {
    errors.push(`${label} post evidence does not contain a Vienna location`);
  }
  if (source === 'structured-location' && !VIENNA_POSTCODE_OR_ADDRESS.test(value)) {
    errors.push(`${label} structured Vienna evidence has no postcode or address`);
  }
  if (!['instagram-post', 'structured-location'].includes(source) && !/@[a-z0-9._]{2,40}/i.test(value)) {
    errors.push(`${label} account evidence has no Instagram username`);
  }
  if (!topLevelEvidence || typeof topLevelEvidence !== 'object' || topLevelEvidence.verified !== true) {
    errors.push(`${label} has no verified top-level Vienna evidence`);
  } else if (
    String(topLevelEvidence.source || '') !== source
    || String(topLevelEvidence.value || '') !== value
  ) {
    errors.push(`${label} top-level Vienna evidence differs from evidence.viennaEvidence`);
  }
  if (deal.viennaVerified !== true || !/^(?:wien|vienna)$/i.test(String(deal.city || '').trim())) {
    errors.push(`${label} has no verified Vienna city fields`);
  }

  const locationSignal = [
    deal.title,
    deal.description,
    deal.evidence?.textSample,
  ].filter(Boolean).join(' ');
  if (VIENNA_NEGATION.test(locationSignal)) {
    errors.push(`${label} explicitly excludes Vienna`);
  }
  if (!String(deal.distance || '').trim()) errors.push(`${label} has no distance derived from Vienna evidence`);
}

function validateInstagramAiPayload(output, report = {}, options = {}) {
  const errors = [];
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const moderation = options.moderation || { blockedIds: new Set(), blockedUrls: new Set(), blockedSignatures: new Set() };
  const configuredMax = Number(
    report.config?.maxAgeDays
    ?? options.maxAgeDays
    ?? process.env.INSTAGRAM_AI_MAX_AGE_DAYS
    ?? ABSOLUTE_MAX_POST_AGE_DAYS,
  );
  const maxAgeDays = Math.min(
    ABSOLUTE_MAX_POST_AGE_DAYS,
    Number.isFinite(configuredMax) && configuredMax >= 0 ? configuredMax : ABSOLUTE_MAX_POST_AGE_DAYS,
  );
  const deals = Array.isArray(output?.deals) ? output.deals : [];
  const rejectedRows = [
    ...(Array.isArray(report.rejected) ? report.rejected : []),
    ...(Array.isArray(report.terminalRejected) ? report.terminalRejected : []),
  ];
  const rejectedKeys = new Set(rejectedRows.map((row) => canonicalPostKey(row.url)).filter(Boolean));
  const seenKeys = new Set();
  const seenIds = new Set();

  if (Number(output?.totalDeals) !== deals.length) {
    errors.push(`totalDeals=${output?.totalDeals} but deals.length=${deals.length}`);
  }

  for (const deal of deals) {
    const label = deal.url || deal.title || deal.id || 'unknown deal';
    const key = canonicalPostKey(deal.url);
    if (!key) {
      errors.push(`${label} has no canonical Instagram post/reel URL`);
    } else if (seenKeys.has(key)) {
      errors.push(`${label} duplicates another Instagram post URL`);
    } else {
      seenKeys.add(key);
    }

    if (!deal.id) errors.push(`${label} has no id`);
    else if (seenIds.has(deal.id)) errors.push(`${label} duplicates id ${deal.id}`);
    else seenIds.add(deal.id);

    if (deal.rejected || deal.rejectionReason) errors.push(`${label} is marked rejected but present in deals`);
    if (key && rejectedKeys.has(key)) errors.push(`${label} is present in both deals and the rejection report`);

    const pubDate = parseDate(deal.pubDate);
    const sourcePublishedAt = parseDate(deal.sourcePublishedAt);
    if (!pubDate) errors.push(`${label} has no valid pubDate`);
    if (!sourcePublishedAt) errors.push(`${label} has no valid sourcePublishedAt`);
    if (pubDate && sourcePublishedAt && Math.abs(pubDate.getTime() - sourcePublishedAt.getTime()) > 1000) {
      errors.push(`${label} pubDate differs from sourcePublishedAt`);
    }

    const pubDateSource = String(deal.pubDateSource || '');
    const sourcePublishedAtSource = String(deal.sourcePublishedAtSource || '');
    if (!isTrustedDateSource(pubDateSource)) {
      errors.push(`${label} has untrusted pubDateSource: ${pubDateSource || 'missing'}`);
    }
    if (!isTrustedDateSource(sourcePublishedAtSource)) {
      errors.push(`${label} has untrusted sourcePublishedAtSource: ${sourcePublishedAtSource || 'missing'}`);
    }
    if (pubDateSource && sourcePublishedAtSource && pubDateSource !== sourcePublishedAtSource) {
      errors.push(`${label} pubDateSource differs from sourcePublishedAtSource`);
    }
    if (String(deal.evidence?.postDateSource || '') !== pubDateSource) {
      errors.push(`${label} evidence.postDateSource differs from pubDateSource`);
    }

    if (pubDate) {
      const ageMs = now.getTime() - pubDate.getTime();
      if (ageMs < -MAX_FUTURE_CLOCK_SKEW_MS) errors.push(`${label} pubDate is implausibly in the future`);
      const ageHours = Math.max(0, ageMs / HOUR_MS);
      if (ageHours > maxAgeDays * 24) {
        errors.push(`${label} is ${(ageHours / 24).toFixed(2)} days old, max is ${maxAgeDays}`);
      } else if (ageHours > FRESH_PRIORITY_HOURS) {
        const explicitEnd = parseDate(deal.evidence?.explicitOfferEnd);
        const explicitSource = String(deal.evidence?.explicitOfferDateSource || '');
        if (!explicitEnd || explicitEnd.getTime() < localDayStart(now).getTime()) {
          errors.push(`${label} is older than 72 hours without a future explicit offer end`);
        }
        if (!explicitSource) errors.push(`${label} is older than 72 hours without date evidence text`);
      }
    }

    const validFromRaw = String(deal.validFrom || '').trim();
    const validFrom = parseValidityStart(validFromRaw);
    if (validFromRaw && !validFrom) {
      errors.push(`${label} has invalid validFrom`);
    } else if (validFrom && validFrom.getTime() > now.getTime()) {
      errors.push(`${label} is not active until ${validFrom.toISOString()}`);
    }

    const explicitEnd = parseDate(deal.evidence?.explicitOfferEnd);
    if (explicitEnd) {
      const expires = parseDate(deal.expires);
      if (!String(deal.evidence?.explicitOfferDateSource || '')) {
        errors.push(`${label} has an evidenced offer end without evidence text`);
      }
      if (!expires || Math.abs(expires.getTime() - explicitEnd.getTime()) > DAY_MS) {
        errors.push(`${label} expires does not match the evidenced offer end`);
      }
    }

    const text = [
      deal.brand,
      deal.title,
      deal.description,
      deal.url,
      deal.evidence?.textSample,
    ].filter(Boolean).join(' ');
    if (FALSE_POSITIVE.test(text)) errors.push(`${label} contains giveaway/shipping/guide false-positive language`);
    if (/\bneotaste\b/i.test(text)) errors.push(`${label} contains blocked NeoTaste signal`);

    validateViennaEvidence(deal, label, errors);

    const moderationReason = moderationReasonForDeal(deal, moderation);
    if (moderationReason) errors.push(`${label} is blocked by moderation: ${moderationReason}`);
  }

  return { errors, deals, maxAgeDays };
}

function runCli() {
  const output = readJson(OUTPUT_PATH);
  const report = fs.existsSync(REPORT_PATH) ? readJson(REPORT_PATH) : {};
  const result = validateInstagramAiPayload(output, report, { moderation: loadDealModeration() });
  if (result.errors.length > 0) {
    for (const message of result.errors) console.error(`instagram-ai output invalid: ${message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Instagram AI output valid: ${result.deals.length} deals, max age ${result.maxAgeDays} days`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) runCli();

export {
  canonicalPostKey,
  validateInstagramAiPayload,
};

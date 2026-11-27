import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  loadDealModeration,
  moderationReasonForDeal,
} from '../scraper/deal-moderation-utils.js';
import { canonicalInstagramPostKey } from '../scraper/deal-evidence-utils.js';
import { evaluateInstagramOfferTiming } from '../scraper/instagram-ai-validity-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const OUTPUT_PATH = path.join(ROOT, 'docs', 'deals-pending-instagram-ai.json');
const REPORT_PATH = path.join(ROOT, 'docs', 'instagram-ai-report.json');
const DAY_MS = 24 * 60 * 60 * 1000;
const ABSOLUTE_MAX_POST_AGE_DAYS = 7;
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

function validateViennaEvidence(deal, reject) {
  const evidence = deal.evidence?.viennaEvidence;
  if (!evidence || typeof evidence !== 'object') {
    reject('vienna-evidence', `has no structured Vienna evidence`);
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
    reject('vienna-evidence', `has unsupported Vienna evidence source: ${source || 'missing'}`);
  }
  if (evidence.verified !== true) reject('vienna-evidence', `Vienna evidence is not explicitly verified`);
  if (!value) reject('vienna-evidence', `has empty Vienna evidence`);
  if (['instagram-post', 'structured-location'].includes(source)
      && !/\b(?:wien|vienna|1(?:0[1-9]0|1[0-9]0|2[0-3]0))\b/i.test(value)) {
    reject('vienna-evidence', `post evidence does not contain a Vienna location`);
  }
  if (source === 'structured-location' && !VIENNA_POSTCODE_OR_ADDRESS.test(value)) {
    reject('vienna-evidence', `structured Vienna evidence has no postcode or address`);
  }
  if (!['instagram-post', 'structured-location'].includes(source)
      && !/@[a-z0-9._]{2,40}/i.test(value)) {
    reject('vienna-evidence', `account evidence has no Instagram username`);
  }
  if (!topLevelEvidence || typeof topLevelEvidence !== 'object' || topLevelEvidence.verified !== true) {
    reject('vienna-evidence', `has no verified top-level Vienna evidence`);
  } else if (
    String(topLevelEvidence.source || '') !== source
    || String(topLevelEvidence.value || '') !== value
  ) {
    reject('vienna-evidence', `top-level Vienna evidence differs from evidence.viennaEvidence`);
  }
  if (deal.viennaVerified !== true || !/^(?:wien|vienna)$/i.test(String(deal.city || '').trim())) {
    reject('vienna-evidence', `has no verified Vienna city fields`);
  }

  const locationSignal = [
    deal.title,
    deal.description,
    deal.evidence?.textSample,
  ].filter(Boolean).join(' ');
  if (VIENNA_NEGATION.test(locationSignal)) {
    reject('vienna-evidence', `explicitly excludes Vienna`);
  }
  if (!String(deal.distance || '').trim()) {
    reject('vienna-evidence', `has no distance derived from Vienna evidence`);
  }
}

function validationContext(report, options) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const moderation = options.moderation || {
    blockedIds: new Set(),
    blockedUrls: new Set(),
    blockedSignatures: new Set(),
  };
  const configuredMaxAgeDays = Number(
    report.config?.maxAgeDays
    ?? options.maxAgeDays
    ?? process.env.INSTAGRAM_AI_MAX_AGE_DAYS
    ?? ABSOLUTE_MAX_POST_AGE_DAYS,
  );
  const maxAgeDays = Math.min(
    ABSOLUTE_MAX_POST_AGE_DAYS,
    Number.isFinite(configuredMaxAgeDays) && configuredMaxAgeDays >= 0
      ? configuredMaxAgeDays
      : ABSOLUTE_MAX_POST_AGE_DAYS,
  );
  const activeOfferMaxAgeDays = maxAgeDays;
  const configuredFutureSkewMinutes = Number(
    report.config?.publicationFutureSkewMinutes
    ?? options.publicationFutureSkewMinutes
    ?? process.env.INSTAGRAM_AI_PUBLICATION_FUTURE_SKEW_MINUTES
    ?? 10,
  );
  const publicationFutureSkewMinutes = Number.isFinite(configuredFutureSkewMinutes)
    && configuredFutureSkewMinutes >= 0
    ? configuredFutureSkewMinutes
    : 10;
  return { now, moderation, maxAgeDays, activeOfferMaxAgeDays, publicationFutureSkewMinutes };
}

function validateFinishedDeal(deal, context) {
  const { now, moderation, maxAgeDays, activeOfferMaxAgeDays, publicationFutureSkewMinutes } = context;
  const errors = [];
  const reject = (code, message) => errors.push({ code, message });
  if (!deal || typeof deal !== 'object' || Array.isArray(deal)) {
    reject('invalid-row', 'is not a deal record');
    return errors;
  }
  if (!canonicalPostKey(deal.url)) reject('invalid-identity', 'has no canonical Instagram post/reel URL');
  if (!deal.id) reject('invalid-identity', 'has no id');
  if (deal.rejected || deal.rejectionReason) reject('marked-rejected', 'is marked rejected but present in deals');

  const pubDate = parseDate(deal.pubDate);
  const sourcePublishedAt = parseDate(deal.sourcePublishedAt);
  if (!pubDate) reject('publication-date', `has no valid pubDate`);
  if (!sourcePublishedAt) reject('publication-date', `has no valid sourcePublishedAt`);
  if (pubDate && sourcePublishedAt
      && Math.abs(pubDate.getTime() - sourcePublishedAt.getTime()) > 1000) {
    reject('publication-date', `pubDate differs from sourcePublishedAt`);
  }

  const pubDateSource = String(deal.pubDateSource || '');
  const sourcePublishedAtSource = String(deal.sourcePublishedAtSource || '');
  if (!isTrustedDateSource(pubDateSource)) {
    reject('publication-provenance', `has untrusted pubDateSource: ${pubDateSource || 'missing'}`);
  }
  if (!isTrustedDateSource(sourcePublishedAtSource)) {
    reject('publication-provenance', `has untrusted sourcePublishedAtSource: ${sourcePublishedAtSource || 'missing'}`);
  }
  if (pubDateSource && sourcePublishedAtSource && pubDateSource !== sourcePublishedAtSource) {
    reject('publication-provenance', `pubDateSource differs from sourcePublishedAtSource`);
  }
  if (String(deal.evidence?.postDateSource || '') !== pubDateSource) {
    reject('publication-provenance', `evidence.postDateSource differs from pubDateSource`);
  }

  if (pubDate) {
    const sourceOfferEvidence = [
      deal.title,
      deal.description,
      deal.expiryDisplayText,
      deal.expires,
      deal.evidence?.offerDateSignal,
      deal.evidence?.offerTiming?.matchedText,
      deal.evidence?.textSample,
    ].filter(Boolean).join(' ');
    const offerTiming = evaluateInstagramOfferTiming({
      signal: sourceOfferEvidence,
      pubDate,
      now,
      maxAgeDays,
      activeOfferMaxAgeDays,
      futureSkewMinutes: publicationFutureSkewMinutes,
    });
    const ageDays = Math.max(0, (now.getTime() - pubDate.getTime()) / DAY_MS);
    if (ageDays > maxAgeDays && !offerTiming.eligibleByAge) {
      reject('post-too-old', `is ${ageDays.toFixed(2)} days old; hard social-post max is ${maxAgeDays}`);
    }
    if (offerTiming.expired) reject('offer-expired', `has expired source offer evidence`);
    if (offerTiming.futurePublication) reject('post-in-future', `pubDate is implausibly in the future`);
  }

  const validFromRaw = String(deal.validFrom || '').trim();
  const validFrom = parseValidityStart(validFromRaw);
  if (validFromRaw && !validFrom) {
    reject('offer-date-mismatch', `has invalid validFrom`);
  }

  const explicitEnd = parseDate(deal.evidence?.explicitOfferEnd);
  if (explicitEnd) {
    const expires = parseDate(deal.expires);
    if (!String(deal.evidence?.explicitOfferDateSource || '')) {
      reject('offer-date-mismatch', `has an evidenced offer end without evidence text`);
    }
    if (!expires || Math.abs(expires.getTime() - explicitEnd.getTime()) > DAY_MS) {
      reject('offer-date-mismatch', `expires does not match the evidenced offer end`);
    }
  }

  const text = [
    deal.brand,
    deal.title,
    deal.description,
    deal.url,
    deal.evidence?.textSample,
  ].filter(Boolean).join(' ');
  if (FALSE_POSITIVE.test(text)) {
    reject('blocked-offer', `contains giveaway/shipping/guide false-positive language`);
  }
  if (/\bneotaste\b/i.test(text)) reject('blocked-offer', `contains blocked NeoTaste signal`);

  validateViennaEvidence(deal, reject);

  const moderationReason = moderationReasonForDeal(deal, moderation);
  if (moderationReason) reject('moderated-offer', `is blocked by moderation: ${moderationReason}`);
  return errors;
}

function partitionInstagramAiDeals(deals, report = {}, options = {}) {
  const context = validationContext(report, options);
  const eligible = [];
  const quarantine = { count: 0, reasons: {} };
  for (const deal of deals) {
    const failures = validateFinishedDeal(deal, context);
    if (!failures.length) {
      eligible.push(deal);
      continue;
    }
    quarantine.count += 1;
    for (const code of new Set(failures.map((failure) => failure.code))) {
      quarantine.reasons[code] = (quarantine.reasons[code] || 0) + 1;
    }
  }
  return { deals: eligible, quarantine };
}

function validateInstagramAiPayload(output, report = {}, options = {}) {
  const errors = [];
  const context = validationContext(report, options);
  const deals = Array.isArray(output?.deals) ? output.deals : [];
  const rejectedRows = [
    ...(Array.isArray(report.rejected) ? report.rejected : []),
    ...(Array.isArray(report.terminalRejected) ? report.terminalRejected : []),
  ];
  const rejectedKeys = new Set(rejectedRows.map((row) => canonicalPostKey(row?.url)).filter(Boolean));
  const seenKeys = new Set();
  const seenIds = new Set();

  if (!Array.isArray(output?.deals)) errors.push('deals is not an array');
  if (Number(output?.totalDeals) !== deals.length) {
    errors.push(`totalDeals=${output?.totalDeals} but deals.length=${deals.length}`);
  }

  for (const deal of deals) {
    const label = deal?.url || deal?.title || deal?.id || 'unknown deal';
    const key = canonicalPostKey(deal?.url);
    if (key) {
      if (seenKeys.has(key)) errors.push(`${label} duplicates another Instagram post URL`);
      seenKeys.add(key);
    }
    if (deal?.id) {
      if (seenIds.has(deal.id)) errors.push(`${label} duplicates id ${deal.id}`);
      seenIds.add(deal.id);
    }
    if (key && rejectedKeys.has(key)) {
      errors.push(`${label} is present in both deals and the rejection report`);
    }
    for (const failure of validateFinishedDeal(deal, context)) {
      errors.push(`${label} ${failure.message}`);
    }
  }

  return { errors, deals, maxAgeDays: context.maxAgeDays, activeOfferMaxAgeDays: context.activeOfferMaxAgeDays };
}

function runCli() {
  const output = readJson(OUTPUT_PATH);
  const report = fs.existsSync(REPORT_PATH) ? readJson(REPORT_PATH) : {};
  const result = validateInstagramAiPayload(output, report, { moderation: loadDealModeration() });
  if (result.errors.length > 0) {
    for (const message of result.errors) {
      console.error(`instagram-ai output invalid: ${message}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(
    `Instagram AI output valid: ${result.deals.length} deals, hard max age ${result.maxAgeDays} days`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) runCli();

export {
  canonicalPostKey,
  partitionInstagramAiDeals,
  validateInstagramAiPayload,
};

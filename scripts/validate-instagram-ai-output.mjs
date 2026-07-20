import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  loadDealModeration,
  moderationReasonForDeal,
} from '../scraper/deal-moderation-utils.js';
import { evaluateInstagramOfferTiming } from '../scraper/instagram-ai-validity-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const OUTPUT_PATH = path.join(ROOT, 'docs', 'deals-pending-instagram-ai.json');
const REPORT_PATH = path.join(ROOT, 'docs', 'instagram-ai-report.json');
const DAY_MS = 24 * 60 * 60 * 1000;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function fail(message) {
  console.error(`instagram-ai output invalid: ${message}`);
  process.exitCode = 1;
}

const output = readJson(OUTPUT_PATH);
const report = fs.existsSync(REPORT_PATH) ? readJson(REPORT_PATH) : {};
const maxAgeDays = Number(report.config?.maxAgeDays || process.env.INSTAGRAM_AI_MAX_AGE_DAYS || 7);
const activeOfferMaxAgeDays = Number(
  report.config?.activeOfferMaxAgeDays
  || process.env.INSTAGRAM_AI_ACTIVE_OFFER_MAX_AGE_DAYS
  || 45
);
const publicationFutureSkewMinutes = Number(
  report.config?.publicationFutureSkewMinutes
  || process.env.INSTAGRAM_AI_PUBLICATION_FUTURE_SKEW_MINUTES
  || 10
);
const deals = Array.isArray(output.deals) ? output.deals : [];
const now = new Date();
const moderation = loadDealModeration();

if (Number(output.totalDeals) !== deals.length) {
  fail(`totalDeals=${output.totalDeals} but deals.length=${deals.length}`);
}

for (const deal of deals) {
  const label = deal.url || deal.title || deal.id || 'unknown deal';
  const pubDate = new Date(deal.pubDate || '');
  if (Number.isNaN(pubDate.getTime())) {
    fail(`${label} has no valid pubDate`);
    continue;
  }

  const pubDateSource = String(deal.pubDateSource || deal.evidence?.postDateSource || '');
  if (!pubDateSource) {
    fail(`${label} has no publication-date provenance`);
  } else if (/agent-run|current-language|synthetic|fallback/i.test(pubDateSource)) {
    fail(`${label} uses synthetic pubDate source ${pubDateSource}`);
  }

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
    const detail = ageDays > activeOfferMaxAgeDays
      ? `active-offer max is ${activeOfferMaxAgeDays}`
      : 'no currently active explicit period/end date or recurring weekday schedule in source evidence';
    fail(`${label} is ${ageDays.toFixed(2)} days old; ${detail}`);
  }
  if (offerTiming.expired) {
    fail(`${label} has expired source offer evidence`);
  }
  if (offerTiming.notStarted) {
    fail(`${label} has a future offer period that has not started`);
  }
  if (offerTiming.futurePublication) {
    fail(`${label} has a publication date more than ${publicationFutureSkewMinutes} minutes in the future`);
  }

  const text = [
    deal.brand,
    deal.title,
    deal.description,
    deal.url,
    deal.evidence?.textSample,
  ].filter(Boolean).join(' ').toLowerCase();
  if (text.includes('neotaste')) {
    fail(`${label} contains blocked NeoTaste signal`);
  }

  const moderationReason = moderationReasonForDeal(deal, moderation);
  if (moderationReason) {
    fail(`${label} is blocked by moderation: ${moderationReason}`);
  }
}

if (process.exitCode) process.exit();

console.log(`Instagram AI output valid: ${deals.length} deals, max age ${maxAgeDays} days (${activeOfferMaxAgeDays} with active-offer proof)`);

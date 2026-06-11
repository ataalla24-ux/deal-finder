import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  loadDealModeration,
  moderationReasonForDeal,
} from '../scraper/deal-moderation-utils.js';

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
const maxExplicitValidityAgeDays = Number(
  report.config?.maxExplicitValidityAgeDays
  || process.env.INSTAGRAM_AI_MAX_EXPLICIT_VALIDITY_AGE_DAYS
  || 21,
);
const deals = Array.isArray(output.deals) ? output.deals : [];
const validationNow = Date.parse(output.lastUpdated || report.generatedAt || report.lastUpdated || '') || Date.now();
const validationDate = new Date(validationNow);
const moderation = loadDealModeration();

function endOfUtcDay(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
}

function parseExpiryDate(value) {
  const text = String(value || '').trim();
  if (!text) return null;

  const direct = new Date(text);
  if (!Number.isNaN(direct.getTime())) return direct;

  const match = text.match(/([0-3]?\d)[./]([01]?\d)(?:[./](20\d{2}))?/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]) || validationDate.getUTCFullYear();
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;

  const parsed = endOfUtcDay(year, month, day);
  if (parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  return parsed;
}

function hasCurrentOrFutureExpiry(deal) {
  const expiry = parseExpiryDate(deal.validUntil || deal.expires);
  if (!expiry) return false;

  const todayStart = Date.UTC(
    validationDate.getUTCFullYear(),
    validationDate.getUTCMonth(),
    validationDate.getUTCDate(),
  );
  return expiry.getUTCFullYear() === validationDate.getUTCFullYear()
    && expiry.getTime() >= todayStart;
}

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

  if (pubDate.getUTCFullYear() !== validationDate.getUTCFullYear()) {
    fail(`${label} is not from current year (${pubDate.toISOString().slice(0, 10)})`);
  }

  const ageDays = Math.max(0, (validationNow - pubDate.getTime()) / DAY_MS);
  if (ageDays > maxAgeDays) {
    const hasExplicitValidity = ageDays <= maxExplicitValidityAgeDays && hasCurrentOrFutureExpiry(deal);
    if (!hasExplicitValidity) {
      fail(`${label} is ${ageDays.toFixed(2)} days old, max is ${maxAgeDays} without current explicit expiry`);
    }
  }

  const validUntil = parseExpiryDate(deal.validUntil || deal.expires);
  if (!validUntil) {
    fail(`${label} has no valid validUntil/expires`);
  } else {
    const todayStart = Date.UTC(
      validationDate.getUTCFullYear(),
      validationDate.getUTCMonth(),
      validationDate.getUTCDate(),
    );
    if (validUntil.getUTCFullYear() !== validationDate.getUTCFullYear()) {
      fail(`${label} validUntil is not current year (${validUntil.toISOString().slice(0, 10)})`);
    }
    if (validUntil.getTime() < todayStart) {
      fail(`${label} validUntil is expired (${validUntil.toISOString().slice(0, 10)})`);
    }
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

console.log(`Instagram AI output valid: ${deals.length} deals, max age ${maxAgeDays} days / explicit validity ${maxExplicitValidityAgeDays} days`);

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
const deals = Array.isArray(output.deals) ? output.deals : [];
const now = Date.now();
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

  const ageDays = Math.max(0, (now - pubDate.getTime()) / DAY_MS);
  if (ageDays > maxAgeDays) {
    fail(`${label} is ${ageDays.toFixed(2)} days old, max is ${maxAgeDays}`);
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

console.log(`Instagram AI output valid: ${deals.length} deals, max age ${maxAgeDays} days`);

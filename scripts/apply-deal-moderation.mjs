#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  filterModeratedDeals,
  loadDealModeration,
  moderationCounts,
} from '../scraper/deal-moderation-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const REPORT_PATH = path.join(DOCS_DIR, 'deal-moderation-report.json');
const DEAL_MODERATION_APPLY = process.env.DEAL_MODERATION_APPLY === '1';
const LIVE_DEAL_REMOVALS_ENABLED = process.env.LIVE_DEAL_REMOVALS_ENABLED === '1';
const CAN_REMOVE_LIVE_DEALS = DEAL_MODERATION_APPLY && LIVE_DEAL_REMOVALS_ENABLED;

const DEFAULT_TARGETS = [
  'deals.json',
  ...fs.readdirSync(DOCS_DIR)
    .filter((file) => file.startsWith('deals-pending-') && file.endsWith('.json'))
    .sort((left, right) => left.localeCompare(right)),
];

function cleanText(value) {
  return String(value || '').trim();
}

function parseArgs(argv) {
  const files = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--files') continue;
    files.push(cleanText(arg));
  }
  return files.length > 0 ? files : DEFAULT_TARGETS;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return { error: error.message };
  }
}

function dealArrayFromBundle(bundle) {
  if (Array.isArray(bundle)) return bundle;
  if (Array.isArray(bundle?.deals)) return bundle.deals;
  return null;
}

function writeBundle(filePath, original, deals) {
  let next;
  if (Array.isArray(original)) {
    next = deals;
  } else {
    const timestamp = new Date().toISOString();
    next = {
      ...original,
      deals,
      totalDeals: deals.length,
    };
    if ('lastUpdated' in next) next.lastUpdated = timestamp;
    if ('updatedAt' in next) next.updatedAt = timestamp;
  }
  fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`);
}

const moderation = loadDealModeration();
const targetFiles = parseArgs(process.argv.slice(2));
const report = {
  checkedAt: new Date().toISOString(),
  moderationUpdatedAt: cleanText(moderation.updatedAt),
  apply: CAN_REMOVE_LIVE_DEALS,
  applyRequested: DEAL_MODERATION_APPLY,
  removalsEnabled: LIVE_DEAL_REMOVALS_ENABLED,
  removalsPaused: !CAN_REMOVE_LIVE_DEALS,
  files: [],
  removedCount: 0,
  wouldRemoveCount: 0,
  removalReasons: {},
  removed: [],
};

for (const target of targetFiles) {
  const relative = target.startsWith('docs/') ? target : path.join('docs', target);
  const filePath = path.join(ROOT, relative);
  if (!fs.existsSync(filePath)) continue;

  const parsed = readJson(filePath);
  if (parsed?.error) {
    report.files.push({ file: relative, error: parsed.error });
    continue;
  }

  const deals = dealArrayFromBundle(parsed);
  if (!deals) {
    report.files.push({ file: relative, before: 0, after: 0, removed: 0, skipped: 'no deals array' });
    continue;
  }

  const result = filterModeratedDeals(deals, moderation);
  if (CAN_REMOVE_LIVE_DEALS && result.removed.length > 0) {
    writeBundle(filePath, parsed, result.deals);
  }

  report.files.push({
    file: relative,
    before: deals.length,
    after: CAN_REMOVE_LIVE_DEALS ? result.deals.length : deals.length,
    removed: CAN_REMOVE_LIVE_DEALS ? result.removed.length : 0,
    wouldRemove: result.removed.length,
  });
  report.removedCount += CAN_REMOVE_LIVE_DEALS ? result.removed.length : 0;
  report.wouldRemoveCount += result.removed.length;
  report.removed.push(...result.removed.map((item) => ({ ...item, file: relative })));
}

report.removalReasons = moderationCounts(report.removed);
report.removed = report.removed.slice(0, 300);
fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

console.log(`Deal moderation ${CAN_REMOVE_LIVE_DEALS ? 'applied' : 'paused'}: ${report.removedCount} removed, ${report.wouldRemoveCount} would remove across ${report.files.length} files`);

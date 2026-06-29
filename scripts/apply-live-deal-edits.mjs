#!/usr/bin/env node
import path from 'path';
import { fileURLToPath } from 'url';

import {
  applyLiveDealEditsToBundle,
  loadLiveDealEditStore,
  readJson,
  writeJson,
} from './live-deal-edits-lib.mjs';
import { alignNativeWeeklyDealRotation } from '../scraper/native-weekly-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DEFAULT_DEALS_PATH = path.join(ROOT, 'docs', 'deals.json');
const DEFAULT_EDITS_PATH = path.join(ROOT, 'docs', 'live-deal-edits.json');
const DEFAULT_REPORT_PATH = path.join(ROOT, 'docs', 'live-deal-edit-report.json');
const DEFAULT_WEEKLY_PATH = path.join(ROOT, 'docs', 'deal-of-the-week.json');

const checkedAt = new Date().toISOString();
const dealsPath = process.env.LIVE_DEALS_PATH || DEFAULT_DEALS_PATH;
const editsPath = process.env.LIVE_DEAL_EDITS_PATH || DEFAULT_EDITS_PATH;
const reportPath = process.env.LIVE_DEAL_EDIT_REPORT_PATH || DEFAULT_REPORT_PATH;
const store = loadLiveDealEditStore(editsPath);

if (!store.edits.length) {
  console.log('No persistent live deal edits to apply');
  process.exit(0);
}

const bundle = readJson(dealsPath);
const result = applyLiveDealEditsToBundle(bundle, store, { checkedAt });
let nextBundle = result.bundle;
let changed = result.changed;
const weeklyPick = readJson(DEFAULT_WEEKLY_PATH, null);
const weeklyAlignment = alignNativeWeeklyDealRotation(nextBundle, weeklyPick, { now: new Date(checkedAt) });
if (weeklyAlignment.changed) {
  nextBundle = weeklyAlignment.bundle;
  changed = true;
}

if (changed) {
  writeJson(dealsPath, nextBundle);
  writeJson(reportPath, {
    ...result.report,
    afterCount: Array.isArray(nextBundle?.deals) ? nextBundle.deals.length : result.report.afterCount,
    nativeWeeklyAlignment: weeklyAlignment.report,
    mode: 'replay',
  });
}

console.log(`Persistent live deal edits replay: ${result.report.appliedCount}/${result.report.editCount} applied, ${result.report.missingCount} not currently live, weekly ${weeklyAlignment.report.reason}`);

#!/usr/bin/env node
import path from 'path';
import { fileURLToPath } from 'url';

import {
  applyLiveDealEditsToBundle,
  cleanText,
  loadLiveDealEditStore,
  normalizeLiveDealEdit,
  parseLiveDealEditPayload,
  payloadValue,
  readJson,
  saveLiveDealEditStore,
  upsertLiveDealEdit,
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

const nowIso = new Date().toISOString();
const payload = parseLiveDealEditPayload(process.env.LIVE_DEAL_EDIT_PAYLOAD);
const dealId = cleanText(payloadValue(payload, 'dealId', 'LIVE_DEAL_EDIT_ID'));
if (!dealId) {
  throw new Error('Missing live deal edit id');
}

const rawEdit = {
  dealId,
  url: payloadValue(payload, 'url', 'LIVE_DEAL_EDIT_URL'),
  title: payloadValue(payload, 'title', 'LIVE_DEAL_EDIT_TITLE'),
  brand: payloadValue(payload, 'brand', 'LIVE_DEAL_EDIT_BRAND'),
  description: payloadValue(payload, 'description', 'LIVE_DEAL_EDIT_DESCRIPTION'),
  category: payloadValue(payload, 'category', 'LIVE_DEAL_EDIT_CATEGORY'),
  type: payloadValue(payload, 'type', 'LIVE_DEAL_EDIT_TYPE'),
  distance: payloadValue(payload, 'distance', 'LIVE_DEAL_EDIT_DISTANCE'),
  pubDate: payloadValue(payload, 'pubDate', 'LIVE_DEAL_EDIT_PUB_DATE'),
  expires: payloadValue(payload, 'expires', 'LIVE_DEAL_EDIT_EXPIRES'),
  expiresOriginal: payloadValue(payload, 'expiresOriginal', 'LIVE_DEAL_EDIT_EXPIRES_ORIGINAL'),
  expiryKind: payloadValue(payload, 'expiryKind', 'LIVE_DEAL_EDIT_EXPIRY_KIND'),
  validOn: payloadValue(payload, 'validOn', 'LIVE_DEAL_EDIT_VALID_ON'),
  validFrom: payloadValue(payload, 'validFrom', 'LIVE_DEAL_EDIT_VALID_FROM'),
  validUntil: payloadValue(payload, 'validUntil', 'LIVE_DEAL_EDIT_VALID_UNTIL'),
  expiryDisplayText: payloadValue(payload, 'expiryDisplayText', 'LIVE_DEAL_EDIT_EXPIRY_DISPLAY_TEXT'),
  pinnedRank: payloadValue(payload, 'pinnedRank', 'LIVE_DEAL_EDIT_PINNED_RANK'),
  hidden: payloadValue(payload, 'hidden', 'LIVE_DEAL_EDIT_HIDDEN'),
  editedBy: cleanText(payloadValue(payload, 'editedBy', 'LIVE_DEAL_EDIT_BY')) || 'live-review',
};

const dealsPath = process.env.LIVE_DEALS_PATH || DEFAULT_DEALS_PATH;
const editsPath = process.env.LIVE_DEAL_EDITS_PATH || DEFAULT_EDITS_PATH;
const reportPath = process.env.LIVE_DEAL_EDIT_REPORT_PATH || DEFAULT_REPORT_PATH;
const liveDealRemovalsEnabled = process.env.LIVE_DEAL_REMOVALS_ENABLED === '1';
const edit = normalizeLiveDealEdit(rawEdit, { nowIso });
if (!edit) throw new Error('Invalid live deal edit');

const existingStore = loadLiveDealEditStore(editsPath);
const nextStore = upsertLiveDealEdit(existingStore, edit, nowIso);
saveLiveDealEditStore(editsPath, nextStore, nowIso);

const bundle = readJson(dealsPath);
const result = applyLiveDealEditsToBundle(bundle, nextStore, { checkedAt: nowIso, allowRemovals: liveDealRemovalsEnabled });
let nextBundle = result.bundle;
let changed = result.changed;
const weeklyPick = readJson(DEFAULT_WEEKLY_PATH, null);
const weeklyAlignment = alignNativeWeeklyDealRotation(nextBundle, weeklyPick, { now: new Date(nowIso) });
if (weeklyAlignment.changed) {
  nextBundle = weeklyAlignment.bundle;
  changed = true;
}
if (changed) {
  writeJson(dealsPath, nextBundle);
}
writeJson(reportPath, {
  ...result.report,
  afterCount: Array.isArray(nextBundle?.deals) ? nextBundle.deals.length : result.report.afterCount,
  nativeWeeklyAlignment: weeklyAlignment.report,
  mode: 'single-edit',
  dealId,
  editedBy: edit.editedBy,
  hidden: edit.hidden,
});

const applied = result.report.applied.find((item) => item.dealId === dealId);
if (!applied && !result.report.missing.some((item) => item.dealId === dealId)) {
  console.log(`Live deal edit stored for ${dealId}: no visible changes needed`);
} else if (applied) {
  console.log(`Live deal edit stored and applied for ${dealId}: ${applied.changedFields.join(', ') || 'no changes'}`);
} else {
  console.log(`Live deal edit stored for ${dealId}: deal is not currently live`);
}

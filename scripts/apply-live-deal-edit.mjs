#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DEFAULT_DEALS_PATH = path.join(ROOT, 'docs', 'deals.json');
const DEFAULT_REPORT_PATH = path.join(ROOT, 'docs', 'live-deal-edit-report.json');

function cleanText(value) {
  return String(value ?? '').trim();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function dealArrayFromBundle(bundle) {
  if (Array.isArray(bundle)) return bundle;
  if (Array.isArray(bundle?.deals)) return bundle.deals;
  return null;
}

function parsePayload() {
  const raw = cleanText(process.env.LIVE_DEAL_EDIT_PAYLOAD);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    throw new Error(`LIVE_DEAL_EDIT_PAYLOAD is not valid JSON: ${error.message}`);
  }
}

function payloadValue(payload, key, envName) {
  if (Object.prototype.hasOwnProperty.call(payload, key)) return payload[key];
  if (envName && Object.prototype.hasOwnProperty.call(process.env, envName)) return process.env[envName];
  return undefined;
}

function parseBoolean(value) {
  if (value === true) return true;
  if (value === false) return false;
  const text = cleanText(value).toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(text);
}

function normalizePinnedRank(value) {
  const text = cleanText(value);
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function parseGermanDate(value) {
  const text = cleanText(value);
  const match = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function parseIsoDate(value) {
  const text = cleanText(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function calendarDate(value) {
  const parsed = parseIsoDate(value) || parseGermanDate(value);
  if (!parsed) return cleanText(value);
  return `${parsed.year}-${pad2(parsed.month)}-${pad2(parsed.day)}`;
}

function displayDate(value) {
  const parsed = parseIsoDate(value) || parseGermanDate(value);
  if (!parsed) return cleanText(value);
  return `${pad2(parsed.day)}.${pad2(parsed.month)}.${parsed.year}`;
}

function isoDateTime(value, endOfDay = false) {
  const text = cleanText(value);
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return text;
  const parsed = parseIsoDate(text) || parseGermanDate(text);
  if (!parsed) return text;
  const time = endOfDay ? '23:59:59.999Z' : '12:00:00.000Z';
  return `${parsed.year}-${pad2(parsed.month)}-${pad2(parsed.day)}T${time}`;
}

function setIfPresent(target, source, field, options = {}) {
  if (!Object.prototype.hasOwnProperty.call(source, field)) return false;
  const raw = source[field];
  const value = options.normalize ? options.normalize(raw) : cleanText(raw);
  if (options.skipEmpty !== false && value === '') return false;
  if (JSON.stringify(target[field] ?? '') === JSON.stringify(value)) return false;
  target[field] = value;
  return true;
}

function isEmptyDisplayDate(value) {
  const text = cleanText(value).toLowerCase();
  return !text || ['k.a.', 'ka', 'n/a', 'unbekannt'].includes(text);
}

function writeBundle(filePath, original, deals) {
  const timestamp = new Date().toISOString();
  let next;
  if (Array.isArray(original)) {
    next = deals;
  } else {
    next = {
      ...original,
      deals,
      totalDeals: deals.length,
    };
    if ('lastUpdated' in next) next.lastUpdated = timestamp;
    if ('updatedAt' in next) next.updatedAt = timestamp;
  }
  writeJson(filePath, next);
}

const payload = parsePayload();
const dealId = cleanText(payloadValue(payload, 'dealId', 'LIVE_DEAL_EDIT_ID'));
if (!dealId) {
  throw new Error('Missing live deal edit id');
}

const hidden = parseBoolean(payloadValue(payload, 'hidden', 'LIVE_DEAL_EDIT_HIDDEN'));
const editedBy = cleanText(payloadValue(payload, 'editedBy', 'LIVE_DEAL_EDIT_BY')) || 'live-review';
const dealsPath = process.env.LIVE_DEALS_PATH || DEFAULT_DEALS_PATH;
const reportPath = process.env.LIVE_DEAL_EDIT_REPORT_PATH || DEFAULT_REPORT_PATH;
const bundle = readJson(dealsPath);
const deals = dealArrayFromBundle(bundle);
if (!deals) {
  throw new Error(`${path.relative(ROOT, dealsPath)} does not contain a deals array`);
}

const index = deals.findIndex((deal) => cleanText(deal?.id) === dealId);
const report = {
  checkedAt: new Date().toISOString(),
  dealId,
  editedBy,
  hidden,
  found: index >= 0,
  changedFields: [],
  beforeCount: deals.length,
  afterCount: deals.length,
};

if (index < 0) {
  writeJson(reportPath, report);
  throw new Error(`Deal not found: ${dealId}`);
}

let nextDeals = deals;
if (hidden) {
  nextDeals = deals.filter((deal) => cleanText(deal?.id) !== dealId);
  report.changedFields.push('hidden');
} else {
  const next = { ...deals[index] };
  const source = {
    title: payloadValue(payload, 'title', 'LIVE_DEAL_EDIT_TITLE'),
    brand: payloadValue(payload, 'brand', 'LIVE_DEAL_EDIT_BRAND'),
    description: payloadValue(payload, 'description', 'LIVE_DEAL_EDIT_DESCRIPTION'),
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
  };

  const changed = [];
  if (setIfPresent(next, source, 'title')) changed.push('title');
  if (setIfPresent(next, source, 'brand')) changed.push('brand');
  if (setIfPresent(next, source, 'description')) changed.push('description');
  if (setIfPresent(next, source, 'distance')) changed.push('distance');
  if (setIfPresent(next, source, 'pubDate', { normalize: (value) => isoDateTime(value, false) })) changed.push('pubDate');
  if (setIfPresent(next, source, 'expires', { normalize: (value) => isoDateTime(value, true) })) changed.push('expires');
  if (setIfPresent(next, source, 'expiresOriginal')) changed.push('expiresOriginal');
  if (setIfPresent(next, source, 'expiryKind')) changed.push('expiryKind');
  if (setIfPresent(next, source, 'validOn', { normalize: calendarDate })) changed.push('validOn');
  if (setIfPresent(next, source, 'validFrom', { normalize: calendarDate })) changed.push('validFrom');
  if (setIfPresent(next, source, 'validUntil', { normalize: calendarDate })) changed.push('validUntil');
  if (setIfPresent(next, source, 'expiryDisplayText')) changed.push('expiryDisplayText');

  const pinnedRank = normalizePinnedRank(source.pinnedRank);
  if (pinnedRank !== null && next.pinnedRank !== pinnedRank) {
    next.pinnedRank = pinnedRank;
    changed.push('pinnedRank');
  }

  if (cleanText(source.expires)) {
    const parsedExpiry = parseIsoDate(source.expires) || parseGermanDate(source.expires);
    if (parsedExpiry) {
      const nextValidUntil = calendarDate(source.expires);
      const nextDisplayDate = displayDate(source.expires);
      if (next.validUntil !== nextValidUntil) {
        next.validUntil = nextValidUntil;
        changed.push('validUntil');
      }
      if (next.expiryKind !== 'end') {
        next.expiryKind = 'end';
        changed.push('expiryKind');
      }
      if (isEmptyDisplayDate(next.expiryDisplayText) || isEmptyDisplayDate(source.expiryDisplayText)) {
        next.expiryDisplayText = nextDisplayDate;
        changed.push('expiryDisplayText');
      }
    }
  } else if (Object.prototype.hasOwnProperty.call(source, 'expiryKind') && cleanText(source.expiryKind) === '' && next.expiryKind) {
    delete next.expiryKind;
    changed.push('expiryKind');
  }

  const uniqueChanged = [...new Set(changed)];
  if (uniqueChanged.length > 0) {
    next.liveEditedAt = report.checkedAt;
    next.liveEditedBy = editedBy;
    next.liveEditedFields = uniqueChanged;
    nextDeals = deals.map((deal, dealIndex) => (dealIndex === index ? next : deal));
    report.changedFields.push(...uniqueChanged);
  }
}

report.afterCount = nextDeals.length;
if (report.changedFields.length > 0) {
  writeBundle(dealsPath, bundle, nextDeals);
}
writeJson(reportPath, report);

console.log(`Live deal edit applied for ${dealId}: ${report.changedFields.join(', ') || 'no changes'}`);

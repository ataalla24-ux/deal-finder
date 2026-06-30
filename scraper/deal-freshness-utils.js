import { cleanText } from './deal-normalization-utils.js';

const DEFAULT_NEW_DEAL_WINDOW_HOURS = 72;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

function configuredNewDealWindowHours() {
  const value = Number(process.env.NEW_DEAL_WINDOW_HOURS || DEFAULT_NEW_DEAL_WINDOW_HOURS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_NEW_DEAL_WINDOW_HOURS;
}

function parseDealTimestamp(value) {
  const timestamp = Date.parse(cleanText(value || ''));
  return Number.isFinite(timestamp) ? timestamp : null;
}

function parseDealEndTimestamp(value) {
  const text = cleanText(value || '');
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return Date.parse(`${text}T23:59:59.999Z`);
  }
  return parseDealTimestamp(text);
}

function hasExpiredFreshnessDate(deal = {}, now = new Date()) {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return false;

  for (const field of ['expires', 'validUntil', 'validOn']) {
    const timestamp = parseDealEndTimestamp(deal[field]);
    if (timestamp !== null && timestamp < nowMs) return true;
  }
  return false;
}

function dealFreshnessTimestamp(deal = {}) {
  const pubDate = parseDealTimestamp(deal.pubDate);
  if (pubDate !== null) return { field: 'pubDate', timestamp: pubDate };

  const approvedAt = parseDealTimestamp(deal.approvedAt);
  if (approvedAt !== null) return { field: 'approvedAt', timestamp: approvedAt };

  return { field: '', timestamp: null };
}

function isDealNewByDate(deal = {}, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const windowHours = Number.isFinite(Number(options.windowHours))
    ? Number(options.windowHours)
    : configuredNewDealWindowHours();
  if (hasExpiredFreshnessDate(deal, now)) return false;

  const { timestamp } = dealFreshnessTimestamp(deal);
  if (timestamp === null || !Number.isFinite(now.getTime())) return false;

  const ageMs = now.getTime() - timestamp;
  return ageMs >= -MAX_FUTURE_SKEW_MS && ageMs <= windowHours * 60 * 60 * 1000;
}

function applyDealFreshnessFlag(deal = {}, options = {}) {
  return {
    ...deal,
    isNew: isDealNewByDate(deal, options),
  };
}

function normalizeDealFreshnessFlags(deals = [], options = {}) {
  let changed = 0;
  let freshCount = 0;
  const normalized = deals.map((deal) => {
    const next = applyDealFreshnessFlag(deal, options);
    if (Boolean(deal?.isNew) !== next.isNew) changed += 1;
    if (next.isNew) freshCount += 1;
    return next;
  });
  return { deals: normalized, changed, freshCount };
}

export {
  DEFAULT_NEW_DEAL_WINDOW_HOURS,
  applyDealFreshnessFlag,
  configuredNewDealWindowHours,
  dealFreshnessTimestamp,
  hasExpiredFreshnessDate,
  isDealNewByDate,
  normalizeDealFreshnessFlags,
};

import { isFoodDrinkSource } from './food-discovery-utils.js';
import { inferInstagramAccountRole } from './instagram-entity-resolution.js';

const HOUR = 3600000;
const time = (value) => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
const manual = (account, scout = false) => ({
  approved: Number((scout ? account.scoutApprovedDeals : account.manualApprovedDeals) || 0),
  rejected: Number((scout ? account.scoutRejectedDeals : account.manualRejectedDeals) || 0),
});

export function accountRescanHours(account, stats = {}, now = new Date()) {
  const scout = ['creator', 'discovery', 'platform'].includes(inferInstagramAccountRole(account));
  const feedback = manual(account, scout);
  const opening = time(account.nextOpeningAt);
  if (isFoodDrinkSource(account) && opening >= +now - 24 * HOUR && opening <= +now + 7 * 24 * HOUR) return 1;
  if (feedback.rejected >= 3 && feedback.approved === 0) return 7 * 24;
  if (feedback.approved > 0) return scout ? 6 : Number(stats.recentNewAccepted || 0) > 0.1 ? 2 : 4;
  if (Number(stats.recentNewAccepted || 0) > 0.1) return scout ? 6 : 4;
  if (Number(stats.runs || 0) >= 8 && !Number(stats.accepted || 0)) return 72;
  if (Number(stats.runs || 0) >= 3 && !Number(stats.newAccepted || 0)) return 24;
  return 12;
}

function quality(account, stats = {}) {
  const feedback = manual(account, ['creator', 'discovery', 'platform'].includes(inferInstagramAccountRole(account)));
  const sample = feedback.approved + feedback.rejected;
  const approval = (feedback.approved + 2) / (sample + 4);
  const yieldRate = (Number(stats.recentNewAccepted || 0) + 1) / (Number(stats.recentFetched || 0) + 25);
  const linked = account.discoveryEvidenceKind === 'directory-and-website-link' ? 8 : 0;
  const targeted = /kebab|kebap|d[o\u00f6]ner|doener|burger|falafel|coffee|kaffee|caf[e\u00e9]|bakery|bowl/i.test([
    account.username, account.name, ...(account.merchants || []).map((item) => `${item.merchant} ${item.cuisine || ''} ${item.kind || ''}`),
  ].join(' ')) ? 5 : 0;
  return approval * (sample / (sample + 5)) * 50 + Math.min(10, yieldRate * 100)
    + Math.min(15, Number(account.priority || 0) / 10) + linked + targeted;
}

function districtDiverse(accounts) {
  const buckets = new Map();
  for (const account of accounts) {
    const postcode = account.postcode || account.merchants?.find((item) => item.postcode)?.postcode || 'unknown';
    if (!buckets.has(postcode)) buckets.set(postcode, []);
    buckets.get(postcode).push(account);
  }
  const result = [];
  while ([...buckets.values()].some((items) => items.length)) {
    for (const items of buckets.values()) if (items.length) result.push(items.shift());
  }
  return result;
}

export function selectCoverageAccounts(accounts, config, state = {}, now = new Date()) {
  const limit = Math.max(0, Math.min(accounts.length, Number(config.maxAccountsPerRun || 0)));
  const performance = state.accountPerformance || {};
  const stats = (account) => performance[account.username] || {};
  const last = (account) => time(stats(account).lastRunAt);
  const due = accounts.filter((account) => !last(account) || +now - last(account) >= accountRescanHours(account, stats(account), now) * HOUR);
  const first = (account) => !last(account);
  const food = due.filter(isFoodDrinkSource);
  const foodTarget = Math.min(food.length, Math.ceil(limit * Number(config.foodAccountShare ?? 0.9)));
  const isScout = (account) => ['creator', 'discovery', 'platform'].includes(inferInstagramAccountRole(account));
  const compareQuality = (a, b) => quality(b, stats(b)) - quality(a, stats(a)) || last(a) - last(b) || a.username.localeCompare(b.username);
  const oldest = (a, b) => last(a) - last(b) || compareQuality(a, b);
  const cold = districtDiverse(food.filter((account) => first(account) && !isScout(account)).sort(compareQuality));
  const proven = food.filter((account) => !first(account) && !isScout(account)
    && (manual(account).approved > 0 || Number(stats(account).recentNewAccepted || 0) > 0.1)).sort(compareQuality);
  const scouts = food.filter(isScout).sort(oldest);
  const coldSlots = Math.min(cold.length, Math.ceil(foodTarget * 0.55));
  const provenSlots = Math.min(proven.length, Math.floor(foodTarget * 0.30));
  const scoutSlots = Math.min(scouts.length, Math.floor(foodTarget * 0.10));
  const lanes = [cold.slice(0, coldSlots), proven.slice(0, provenSlots), scouts.slice(0, scoutSlots)];
  const selected = [];
  const seen = new Set();
  const add = (account, lane) => {
    if (!account || seen.has(account.username) || selected.length >= limit) return;
    seen.add(account.username);
    selected.push({ ...account, selectionLane: lane, rescanHours: accountRescanHours(account, stats(account), now) });
  };
  // Interleave the reservations: a small remaining quota must not spend every
  // admitted call on incumbents before it reaches a new merchant or a scout.
  while (lanes.some((items) => items.length)) {
    for (let index = 0; index < lanes.length; index += 1) add(lanes[index].shift(), ['first-check', 'proven-food', 'food-scout'][index]);
  }
  for (const account of districtDiverse(food.filter((item) => !seen.has(item.username)).sort(oldest))) {
    if (selected.length >= foodTarget) break;
    add(account, first(account) ? 'first-check' : 'food-rotation');
  }
  for (const account of due.filter((item) => !seen.has(item.username)).sort(oldest)) add(account, isFoodDrinkSource(account) ? 'food-rotation' : 'other-rotation');
  return selected;
}

export function selectCoverageHashtags(hashtags, config, state = {}, now = new Date()) {
  const performance = state.hashtagPerformance || {};
  const score = (tag) => {
    const stats = performance[tag] || {};
    const sample = Number(stats.recentFetched || 0);
    const yieldRate = (Number(stats.recentNewAccepted || 0) + 1) / (sample + 25);
    return yieldRate * Math.min(1, sample / 25) * 100
      + (isFoodDrinkSource(tag) ? 8 : 0) + (/gratis|aktion|rabatt|gutschein|angebot|deal|happyhour|er[o\u00f6]ffnung/i.test(tag) ? 5 : 0);
  };
  const due = [...new Set(hashtags)].filter((tag) => {
    const stats = performance[tag] || {};
    const hours = Number(stats.recentNewAccepted || 0) > 0.1 ? 3 : Number(stats.recentFetched || 0) > 0 ? 12 : 24;
    return !time(stats.lastRunAt) || +now - time(stats.lastRunAt) >= hours * HOUR;
  });
  const ranked = due.sort((a, b) => score(b) - score(a) || a.localeCompare(b));
  const limit = Math.max(0, Number(config.maxHashtagsPerRun || 0));
  const selected = ranked.slice(0, Math.max(0, limit - 2));
  const broad = new Set(['wien', 'vienna']);
  const remaining = due.filter((tag) => !selected.includes(tag)).sort((a, b) => time(performance[a]?.lastRunAt) - time(performance[b]?.lastRunAt) || score(b) - score(a));
  for (const tag of remaining) {
    if (selected.length >= limit) break;
    if (broad.has(tag) && selected.some((item) => broad.has(item))) continue;
    selected.push(tag);
  }
  return selected;
}

export function accountCoverageSummary(accounts, performance, now = new Date()) {
  const checked = accounts.filter((account) => time(performance?.[account.username]?.lastRunAt));
  const directory = accounts.filter((account) => account.origins?.includes('vienna-directory'));
  const recent = (account) => time(performance?.[account.username]?.lastRunAt) >= +now - 7 * 24 * HOUR;
  return {
    totalAccounts: accounts.length, checkedAccounts: checked.length,
    uncheckedAccounts: accounts.length - checked.length, checkedLast7Days: checked.filter(recent).length,
    directoryAccounts: directory.length, directoryCheckedLast7Days: directory.filter(recent).length,
    directoryUnchecked: directory.filter((account) => !time(performance?.[account.username]?.lastRunAt)).length,
  };
}

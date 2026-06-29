const VIENNA_DAY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Vienna',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function cleanText(value) {
  return String(value ?? '').trim();
}

function normalizeText(value) {
  return cleanText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function splitWords(value) {
  return normalizeText(value).split(/[^a-z0-9]+/).filter(Boolean);
}

function hasToken(value, tokens = [], prefixes = []) {
  const words = splitWords(value);
  return words.some((word) => tokens.includes(word) || prefixes.some((prefix) => word.startsWith(prefix)));
}

function containsAny(value, tokens = []) {
  const text = normalizeText(value);
  return tokens.some((token) => text.includes(normalizeText(token)));
}

function signalText(deal = {}) {
  return normalizeText([
    deal.brand,
    deal.title,
    deal.description,
    deal.category,
    deal.source,
    deal.placeText,
  ].filter(Boolean).join(' '));
}

function isChurchOrReligiousDeal(deal = {}) {
  const category = normalizeText(deal.category);
  const source = signalText(deal);
  return ['gottesdienste', 'kirche', 'gemeinde'].includes(category)
    || containsAny(source, ['gottesdienst', 'messe', 'kirche', 'freikirche', 'christlich', 'hillsong', 'icf', 'jesuszentrum', 'cig', 'gemeinde']);
}

function hasCoffeeSignal(value) {
  return hasToken(value, ['kaffee', 'coffee', 'espresso', 'latte', 'matcha', 'cafe', 'mccafe']);
}

function hasFoodSignal(value) {
  return hasToken(
    value,
    [
      'essen', 'food', 'restaurant', 'wolt', 'foodora', 'doner', 'doener', 'kebab',
      'falafel', 'bowl', 'sushi', 'ramen', 'schnitzel', 'sandwich', 'brunch', 'snack',
      'croissant', 'cheesecake', 'dessert', 'eis', 'cola', 'drink', 'drinks', 'getraenk',
    ],
    ['pizza', 'burger', 'eissalon', 'schoko', 'erdbeer', 'pancake', 'waffel', 'kuchen', 'torte'],
  );
}

function isFoodOrDrinkDeal(deal = {}) {
  if (isChurchOrReligiousDeal(deal)) return false;
  const category = normalizeText(deal.category);
  const source = signalText(deal);
  return category === 'essen'
    || category === 'kaffee'
    || hasFoodSignal(source)
    || hasCoffeeSignal(source);
}

function isFreeDeal(deal = {}) {
  return normalizeText(deal.type) === 'gratis' || /gratis/i.test(cleanText(deal.title));
}

function dailyDealPercent(deal = {}) {
  const match = signalText(deal).match(/\b([1-9][0-9])\s*%/);
  return match ? Number(match[1]) : 0;
}

function isStrongDailyDiscount(deal = {}) {
  const source = signalText(deal);
  const type = normalizeText(deal.type);
  return dailyDealPercent(deal) >= 40
    || containsAny(source, ['1+1', '2+1', '2 fur 1', '2 fuer 1', 'buy one get one', 'bogo', 'halber preis', '50 prozent', '60 prozent', '70 prozent'])
    || (type === 'rabatt' && containsAny(source, ['stark', 'mega', 'top', 'deal des tages', 'wochenangebot', 'nur heute', 'kostenlos testen']));
}

function voteCount(deal = {}) {
  const value = Number(deal.votes ?? deal.voteCount ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function dailyDealScore(deal = {}) {
  let score = 0;
  if (isFoodOrDrinkDeal(deal)) score += 120;
  if (isStrongDailyDiscount(deal)) score += 90 + dailyDealPercent(deal);
  if (deal.hot) score += 25;
  if (deal.isNew) score += 8;
  if (isFreeDeal(deal)) score += 18;
  score += Math.min(25, voteCount(deal));
  return score;
}

function getViennaDateParts(input = Date.now()) {
  const date = input instanceof Date ? input : new Date(input || Date.now());
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const parts = VIENNA_DAY_FORMATTER.formatToParts(date);
  const partMap = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = Number(partMap.year || 0);
  const month = Number(partMap.month || 0);
  const day = Number(partMap.day || 0);
  return year && month && day ? { year, month, day } : null;
}

function getViennaDayOfMonth(input = Date.now()) {
  return getViennaDateParts(input)?.day || 1;
}

function getViennaWeekKey(input = Date.now()) {
  const date = input instanceof Date ? input : new Date(input || Date.now());
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Vienna',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(date);
  const partMap = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = Number(partMap.year || 0);
  const month = Number(partMap.month || 0);
  const day = Number(partMap.day || 0);
  const weekdayOffset = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[String(partMap.weekday || '')];
  if (!year || !month || !day || typeof weekdayOffset !== 'number') return '';
  const monday = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  monday.setUTCDate(monday.getUTCDate() - weekdayOffset);
  return `${monday.getUTCFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, '0')}-${String(monday.getUTCDate()).padStart(2, '0')}`;
}

function getViennaWeekOfYear(input = Date.now()) {
  const parts = getViennaDateParts(input);
  if (!parts) return 1;
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

function selectNativeDailyDeal(deals = [], now = new Date()) {
  const candidates = deals
    .filter((deal) => !isChurchOrReligiousDeal(deal) && (isFoodOrDrinkDeal(deal) || isStrongDailyDiscount(deal)))
    .map((deal) => ({ deal, score: dailyDealScore(deal) }))
    .sort((left, right) => right.score - left.score || cleanText(left.deal.id).localeCompare(cleanText(right.deal.id)));
  if (!candidates.length) return null;
  const rotationCount = Math.min(candidates.length, 7);
  return candidates[getViennaDayOfMonth(now) % rotationCount]?.deal || null;
}

function weeklySource(deals = [], excludedId = '') {
  const featured = deals.filter((deal) => (deal.hot || isFreeDeal(deal)) && isFoodOrDrinkDeal(deal));
  const fallback = deals.filter(isFoodOrDrinkDeal);
  const base = featured.length ? featured : fallback;
  const source = base.filter((deal) => cleanText(deal.id) !== excludedId);
  return source.length ? source : base;
}

function dealArrayFromBundle(bundle) {
  if (Array.isArray(bundle)) return bundle;
  if (Array.isArray(bundle?.deals)) return bundle.deals;
  return null;
}

function withDeals(bundle, deals) {
  if (Array.isArray(bundle)) return deals;
  return {
    ...bundle,
    deals,
    totalDeals: deals.length,
  };
}

function alignNativeWeeklyDealRotation(bundle, weeklyPick = {}, options = {}) {
  const deals = dealArrayFromBundle(bundle);
  const targetId = cleanText(weeklyPick?.dealId || weeklyPick?.id || options.dealId || '');
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  if (!deals || !targetId) return { changed: false, bundle, report: { reason: 'missing_deals_or_target' } };
  if (cleanText(weeklyPick?.week) && cleanText(weeklyPick.week) !== getViennaWeekKey(now)) {
    return { changed: false, bundle, report: { reason: 'weekly_pick_not_current' } };
  }

  const target = deals.find((deal) => cleanText(deal.id) === targetId);
  if (!target) return { changed: false, bundle, report: { reason: 'target_not_live', targetId } };
  if (!isFoodOrDrinkDeal(target)) return { changed: false, bundle, report: { reason: 'target_not_food_or_drink', targetId } };

  const daily = selectNativeDailyDeal(deals, now);
  const excludedId = cleanText(daily?.id || '');
  const source = weeklySource(deals, excludedId);
  const week = getViennaWeekOfYear(now);
  const targetIndex = source.length ? week % source.length : 0;
  const currentIndex = source.findIndex((deal) => cleanText(deal.id) === targetId);

  if (currentIndex === targetIndex) {
    return {
      changed: false,
      bundle,
      report: { reason: 'already_aligned', targetId, currentIndex, targetIndex, sourceCount: source.length, week, excludedId },
    };
  }

  const withoutTarget = deals.filter((deal) => cleanText(deal.id) !== targetId);
  const sourceWithoutTarget = weeklySource(withoutTarget, excludedId);
  const beforeDeal = sourceWithoutTarget[targetIndex] || null;
  let insertAt = withoutTarget.length;
  if (beforeDeal) {
    insertAt = withoutTarget.findIndex((deal) => cleanText(deal.id) === cleanText(beforeDeal.id));
  } else if (sourceWithoutTarget.length) {
    const last = sourceWithoutTarget[sourceWithoutTarget.length - 1];
    const lastIndex = withoutTarget.findIndex((deal) => cleanText(deal.id) === cleanText(last.id));
    insertAt = lastIndex >= 0 ? lastIndex + 1 : withoutTarget.length;
  }
  if (insertAt < 0) insertAt = withoutTarget.length;

  const nextDeals = [...withoutTarget];
  nextDeals.splice(insertAt, 0, target);
  const nextBundle = withDeals(bundle, nextDeals);
  const nextSource = weeklySource(nextDeals, excludedId);
  const nextIndex = nextSource.findIndex((deal) => cleanText(deal.id) === targetId);

  return {
    changed: true,
    bundle: nextBundle,
    report: {
      reason: 'aligned',
      targetId,
      previousIndex: currentIndex,
      targetIndex,
      nextIndex,
      sourceCount: nextSource.length,
      week,
      excludedId,
    },
  };
}

export {
  alignNativeWeeklyDealRotation,
  getViennaWeekKey,
  getViennaWeekOfYear,
  isFoodOrDrinkDeal,
  selectNativeDailyDeal,
  weeklySource,
};

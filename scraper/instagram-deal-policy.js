const DAY_MS = 24 * 60 * 60 * 1000;

export const INSTAGRAM_DEAL_POLICY_DEFAULTS = {
  maxAgeDaysWithoutExplicitValidity: 7,
  maxAgeDaysWithExplicitValidity: 14,
  reviewValidityDays: 14,
  futurePostGraceHours: 2,
  requireCurrentYear: true,
  requireInstagramUrl: true,
  requireViennaSignal: true,
  requireDealSignal: true,
  blockGiveaways: true,
  minSlackScore: 75,
};

const VIENNA_PATTERNS = [
  /\bwien\b/i,
  /\bvienna\b/i,
  /\bwiener\b/i,
  /\b(?:1010|1020|1030|1040|1050|1060|1070|1080|1090|1100|1110|1120|1130|1140|1150|1160|1170|1180|1190|1200|1210|1220|1230)\b/i,
  /\b(?:innere stadt|leopoldstadt|landstrasse|landstraße|wieden|margareten|mariahilf|neubau|josefstadt|alsergrund|favoriten|meidling|hietzing|penzing|rudolfsheim|ottakring|hernals|waehring|währing|doebling|döbling|brigittenau|floridsdorf|donaustadt|liesing)\b/i,
];

const DEAL_PATTERNS = [
  /\bgratis\b/i,
  /\bkostenlos(?:e|er|es|en)?\b/i,
  /\bfree(?:bie| food| coffee| drink| entrance| entry)?\b/i,
  /\b0\s*(?:€|euro|eur)\b/i,
  /\b1\s*\+\s*1\b/i,
  /\b2\s*(?:for|fuer|fur)\s*1\b/i,
  /\bbogo\b/i,
  /\b(?:rabatt|discount|gutschein|coupon|voucher|deal|aktion|angebot|promo|happy hour|student(?:en)?deal)\b/i,
  /\b(?:neueröffnung|neueroeffnung|eröffnung|eroeffnung|opening offer|opening deal|grand opening)\b/i,
  /\b\d{1,2}\s*%\s*(?:rabatt|off|discount)\b/i,
  /\b(?:nur|only|um|for just|for only)\s+\d{1,2}(?:[,.]\d{1,2})?\s*(?:€|euro|eur)?\b/i,
];

const FOOD_DRINK_PATTERNS = [
  /\b(?:essen|food|restaurant|pizza|burger|kebab|kebap|döner|doener|sushi|ramen|falafel|brunch|croissant|bakery|dessert|eis|gelato|ice cream|snack)\b/i,
  /\b(?:kaffee|coffee|cafe|café|espresso|latte|matcha|drink|drinks|cocktail|bar|bubble tea|boba)\b/i,
];

const GIVEAWAY_PATTERNS = [
  /\b(?:gewinnspiel|verlosung|giveaway|zu gewinnen|win a|tagge|kommentiere|comment to win)\b/i,
];

const BLOCKED_CONTEXT_PATTERNS = [
  /\b(?:civil action network|rathausklub|gemeinderat|stadtrat|partei|politik|politisch)\b/i,
  /\b(?:kinderarmut|kindergrundsicherung|armuts-?\s*oder\s+ausgrenzungsgefährdet|schulsozialarbeit)\b/i,
  /\b(?:kostenlose\s+kindergärten|gratis\s+mittagessen|ganztägige\s+bildung|lernförderung)\b/i,
  /\b(?:bewegung,\s*begegnung\s+und\s+gemeinschaft|mitmachen\s+oder\s+einfach\s+zuschauen|vogelweidpark)\b/i,
  /\b(?:demo|demonstration|kundgebung|petition|ehrenamt|volunteer)\b/i,
];

const SEASONAL_CUTOFFS = [
  { label: 'muttertag', pattern: /\b(?:muttertag|mother'?s day)\b/i, month: 5, day: 31 },
  { label: 'valentinstag', pattern: /\b(?:valentinstag|valentine'?s day)\b/i, month: 2, day: 16 },
  { label: 'ostern', pattern: /\b(?:ostern|oster|easter)\b/i, month: 4, day: 30 },
  { label: 'black-friday', pattern: /\b(?:black friday|cyber monday)\b/i, month: 12, day: 7 },
  { label: 'advent-weihnachten', pattern: /\b(?:advent|weihnacht|christmas|nikolo|nikolaus)\b/i, month: 12, day: 27 },
];

const TEXTUAL_EXPIRY_PLACEHOLDER = /^(?:unbekannt|kurzfristig(?:\s*\/.*)?|siehe.*|n\/a|na|null|undefined)$/i;

function cleanText(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDate(value) {
  const raw = cleanText(value);
  if (!raw) return null;

  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct;

  const numeric = raw.match(/\b([0-3]?\d)[./-]([01]?\d)(?:[./-](20\d{2}|\d{2}))?\b/);
  if (numeric) {
    const now = new Date();
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    const yearRaw = numeric[3];
    const year = yearRaw ? (yearRaw.length === 2 ? Number(`20${yearRaw}`) : Number(yearRaw)) : now.getFullYear();
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
      if (date.getUTCMonth() === month - 1 && date.getUTCDate() === day) return date;
    }
  }

  return null;
}

function toIsoEndOfDay(date) {
  const parsed = date instanceof Date ? new Date(date) : parseDate(date);
  if (!parsed || Number.isNaN(parsed.getTime())) return '';
  parsed.setUTCHours(23, 59, 59, 999);
  return parsed.toISOString();
}

function toIso(value) {
  const parsed = parseDate(value);
  return parsed ? parsed.toISOString() : '';
}

function addDaysEndOfDay(value, days) {
  const parsed = value instanceof Date ? new Date(value) : parseDate(value);
  if (!parsed || Number.isNaN(parsed.getTime())) return '';
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return toIsoEndOfDay(parsed);
}

function currentYear(now) {
  return now.getFullYear();
}

function cutoffDateForYear(now, month, day) {
  return new Date(Date.UTC(currentYear(now), month - 1, day, 23, 59, 59, 999));
}

function blockedContextReason(text) {
  const match = BLOCKED_CONTEXT_PATTERNS.find((pattern) => pattern.test(text));
  return match ? 'blocked-non-commercial-context' : '';
}

function staleSeasonalReason(text, now) {
  const stale = SEASONAL_CUTOFFS.find((entry) => entry.pattern.test(text) && now.getTime() > cutoffDateForYear(now, entry.month, entry.day).getTime());
  return stale ? `stale-seasonal:${stale.label}` : '';
}

function dateOnly(value) {
  return toIso(value).slice(0, 10);
}

function isInstagramPostUrl(value) {
  try {
    const url = new URL(String(value || ''));
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (host !== 'instagram.com') return false;
    return /^\/(?:p|reel|tv)\/[^/]+\/?/i.test(url.pathname);
  } catch {
    return false;
  }
}

function firstUsableExpiry(deal) {
  if (/^pubDate\+\d+d-review-window$/i.test(cleanText(deal.validUntilSource))) {
    return '';
  }
  const candidates = [deal.validUntil, deal.expires, deal.expiry, deal.endDate];
  for (const candidate of candidates) {
    const text = cleanText(candidate);
    if (!text || TEXTUAL_EXPIRY_PLACEHOLDER.test(text)) continue;
    const parsed = parseDate(text);
    if (parsed) return toIsoEndOfDay(parsed);
  }
  return '';
}

export function buildInstagramPolicyText(deal = {}) {
  return [
    deal.brand,
    deal.title,
    deal.description,
    deal.distance,
    deal.location,
    deal.category,
    deal.type,
    deal.expires,
    deal.validUntil,
    deal.url,
    deal.evidence?.textSample,
    deal.evidence?.ocrText,
    deal.ocrText,
  ].map(cleanText).filter(Boolean).join(' ');
}

export function getInstagramDealSignals(deal = {}) {
  const text = buildInstagramPolicyText(deal);
  return {
    hasInstagramUrl: isInstagramPostUrl(deal.url),
    hasViennaSignal: VIENNA_PATTERNS.some((pattern) => pattern.test(text)),
    hasDealSignal: DEAL_PATTERNS.some((pattern) => pattern.test(text)),
    hasFoodDrinkSignal: FOOD_DRINK_PATTERNS.some((pattern) => pattern.test(text)),
    isGiveaway: GIVEAWAY_PATTERNS.some((pattern) => pattern.test(text)),
    blockedContextReason: blockedContextReason(text),
  };
}

export function normalizeInstagramDealDates(deal = {}, options = {}) {
  const config = { ...INSTAGRAM_DEAL_POLICY_DEFAULTS, ...options };
  const now = options.now instanceof Date ? options.now : new Date();
  const pubDate = parseDate(deal.pubDate || deal.postPublishedAt || deal.createdAt || '');
  if (!pubDate) {
    return { ok: false, reason: 'missing-pubDate', deal };
  }

  if (config.requireCurrentYear && pubDate.getFullYear() !== currentYear(now)) {
    return { ok: false, reason: `old-post-year:${dateOnly(pubDate)}`, deal };
  }

  if (pubDate.getTime() > now.getTime() + config.futurePostGraceHours * 60 * 60 * 1000) {
    return { ok: false, reason: `future-pubDate:${dateOnly(pubDate)}`, deal };
  }

  const explicitValidUntil = firstUsableExpiry(deal);
  const validUntilDate = explicitValidUntil ? parseDate(explicitValidUntil) : null;
  const ageDays = Math.max(0, (now.getTime() - pubDate.getTime()) / DAY_MS);

  if (validUntilDate) {
    if (config.requireCurrentYear && validUntilDate.getFullYear() !== currentYear(now)) {
      return { ok: false, reason: `old-expiry-year:${dateOnly(validUntilDate)}`, deal };
    }
    if (validUntilDate.getTime() < now.getTime() - config.futurePostGraceHours * 60 * 60 * 1000) {
      return { ok: false, reason: `expired:${dateOnly(validUntilDate)}`, deal };
    }
    if (ageDays > config.maxAgeDaysWithExplicitValidity) {
      return { ok: false, reason: `stale-with-explicit-validity:${ageDays.toFixed(1)}d`, deal };
    }

    return {
      ok: true,
      reason: '',
      ageDays,
      deal: {
        ...deal,
        pubDate: pubDate.toISOString(),
        expires: explicitValidUntil,
        validUntil: explicitValidUntil,
        validUntilSource: deal.validUntilSource || 'explicit',
      },
    };
  }

  if (ageDays > config.maxAgeDaysWithoutExplicitValidity) {
    return { ok: false, reason: `stale-without-explicit-validity:${ageDays.toFixed(1)}d`, deal };
  }

  const reviewValidUntil = addDaysEndOfDay(pubDate, config.reviewValidityDays);
  return {
    ok: true,
    reason: '',
    ageDays,
    deal: {
      ...deal,
      pubDate: pubDate.toISOString(),
      expires: reviewValidUntil,
      validUntil: reviewValidUntil,
      validUntilSource: `pubDate+${config.reviewValidityDays}d-review-window`,
    },
  };
}

export function applyInstagramDealPolicy(deal = {}, options = {}) {
  const config = { ...INSTAGRAM_DEAL_POLICY_DEFAULTS, ...options };
  const signals = getInstagramDealSignals(deal);

  if (config.requireInstagramUrl && !signals.hasInstagramUrl) {
    return { ok: false, reason: 'missing-instagram-post-url', deal, signals };
  }
  if (config.blockGiveaways && signals.isGiveaway) {
    return { ok: false, reason: 'giveaway-blocked', deal, signals };
  }
  if (signals.blockedContextReason) {
    return { ok: false, reason: signals.blockedContextReason, deal, signals };
  }
  if (config.requireViennaSignal && !signals.hasViennaSignal) {
    return { ok: false, reason: 'missing-vienna-signal', deal, signals };
  }
  if (config.requireDealSignal && !signals.hasDealSignal) {
    return { ok: false, reason: 'missing-deal-signal', deal, signals };
  }

  const seasonalReason = staleSeasonalReason(buildInstagramPolicyText(deal), config.now instanceof Date ? config.now : new Date());
  if (seasonalReason) {
    return { ok: false, reason: seasonalReason, deal, signals };
  }

  const dateResult = normalizeInstagramDealDates(deal, config);
  if (!dateResult.ok) return { ...dateResult, signals };

  const qualityScore = Number(dateResult.deal.qualityScore || 0);
  const slackEligible = Boolean(
    signals.hasInstagramUrl
      && signals.hasViennaSignal
      && signals.hasDealSignal
      && dateResult.deal.validUntil
      && qualityScore >= config.minSlackScore
  );

  return {
    ok: true,
    reason: '',
    ageDays: dateResult.ageDays,
    signals,
    deal: {
      ...dateResult.deal,
      instagramPolicyVersion: '2026-06-freshness-v1',
      instagramPolicy: {
        ageDays: Number(dateResult.ageDays.toFixed(2)),
        hasViennaSignal: signals.hasViennaSignal,
        hasDealSignal: signals.hasDealSignal,
        hasFoodDrinkSignal: signals.hasFoodDrinkSignal,
      },
      slackEligible,
    },
  };
}

export function filterInstagramDealsWithPolicy(deals = [], options = {}) {
  const accepted = [];
  const rejected = [];
  const reasonCounts = {};

  for (const rawDeal of deals) {
    const result = applyInstagramDealPolicy(rawDeal, options);
    if (result.ok) {
      accepted.push(result.deal);
    } else {
      const reason = result.reason || 'unknown';
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
      rejected.push({
        reason,
        title: cleanText(rawDeal?.title, 140),
        brand: cleanText(rawDeal?.brand, 100),
        url: rawDeal?.url || '',
        pubDate: rawDeal?.pubDate || '',
        expires: rawDeal?.expires || '',
      });
    }
  }

  return {
    deals: accepted,
    rejected,
    reasonCounts: Object.fromEntries(Object.entries(reasonCounts).sort((left, right) => right[1] - left[1])),
  };
}

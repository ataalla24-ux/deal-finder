const URL_CHECK_UA = 'Mozilla/5.0 (compatible; FreeFinderBot/1.0; +https://freefinder.wien)';
const DAY_MS = 24 * 60 * 60 * 1000;

const MONTH_MAP = {
  'jänner': 0, 'januar': 0, 'january': 0, 'jan': 0,
  'februar': 1, 'february': 1, 'feb': 1,
  'märz': 2, 'maerz': 2, 'march': 2, 'mar': 2, 'mär': 2,
  'april': 3, 'apr': 3,
  'mai': 4, 'may': 4,
  'juni': 5, 'june': 5, 'jun': 5,
  'juli': 6, 'july': 6, 'jul': 6,
  'august': 7, 'aug': 7,
  'september': 8, 'sep': 8, 'sept': 8,
  'oktober': 9, 'october': 9, 'okt': 9, 'oct': 9,
  'november': 10, 'nov': 10,
  'dezember': 11, 'december': 11, 'dez': 11, 'dec': 11,
};

const URL_EXPIRY_BLOCK_HOSTS = new Set([
  'instagram.com',
  'www.instagram.com',
  'tiktok.com',
  'www.tiktok.com',
  'preisjaeger.at',
  'www.preisjaeger.at',
  'gutscheine.at',
  'www.gutscheine.at',
  'facebook.com',
  'www.facebook.com',
  'x.com',
  'www.x.com',
  'twitter.com',
  'www.twitter.com',
  'slack.com',
  'www.slack.com',
]);

const DEAD_LINK_PATTERNS = [
  { pattern: /\b404\b/, reason: '404-Seite' },
  { pattern: /page not found/i, reason: 'Seite nicht gefunden' },
  { pattern: /seite nicht gefunden/i, reason: 'Seite nicht gefunden' },
  { pattern: /page isn['’]t available/i, reason: 'Seite nicht verfügbar' },
  { pattern: /sorry,\s*this page isn['’]t available/i, reason: 'Seite nicht verfügbar' },
  { pattern: /content isn['’]t available/i, reason: 'Inhalt nicht verfügbar' },
  { pattern: /not available anymore/i, reason: 'Inhalt nicht mehr verfügbar' },
  { pattern: /nicht mehr verf[üu]gbar/i, reason: 'Inhalt nicht mehr verfügbar' },
  { pattern: /post is unavailable/i, reason: 'Beitrag nicht verfügbar' },
  { pattern: /video currently unavailable/i, reason: 'Video nicht verfügbar' },
  { pattern: /couldn['’]t find this (page|account)/i, reason: 'Seite oder Account nicht gefunden' },
  { pattern: /angebot abgelaufen/i, reason: 'Angebot abgelaufen' },
  { pattern: /offer expired/i, reason: 'Angebot abgelaufen' },
  { pattern: /aktion beendet/i, reason: 'Aktion beendet' },
  { pattern: /deal (has )?ended/i, reason: 'Deal beendet' },
];

function cleanText(value) {
  if (!value) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function isIsoDateExpiry(value) {
  return /^\d{4}-\d{1,2}-\d{1,2}(?:\b|t)/i.test(cleanText(value));
}

function confidenceRank(confidence) {
  if (confidence === 'high') return 3;
  if (confidence === 'medium') return 2;
  if (confidence === 'low') return 1;
  return 0;
}

function clearStructuredExpiryFields(deal) {
  delete deal.expiryKind;
  delete deal.expiryDisplayText;
  delete deal.validOn;
  delete deal.validFrom;
  delete deal.validUntil;
  delete deal.dateConfidence;
}

function toIsoDateString(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isoDateFromMs(ms) {
  if (!Number.isFinite(ms)) return '';
  const date = new Date(ms);
  return toIsoDateString(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function endOfUtcDay(year, monthIndex, day) {
  return new Date(Date.UTC(year, monthIndex, day, 23, 59, 59, 999));
}

function endOfUtcMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0, 23, 59, 59, 999));
}

function inferYearlessEndYear(month, day, now, options = {}) {
  const currentYear = now.getUTCFullYear();
  if (!options.crossesYear) return currentYear;
  const startMonth = Number(options.startMonth || 12);
  const startDay = Number(options.startDay || 1);
  const upcomingStart = Date.UTC(currentYear, startMonth - 1, startDay);
  const nowMs = now.getTime();
  // A Dec→Jan caption shortly before or during the range describes the
  // upcoming January. Earlier in the year it conservatively stays in the
  // current year so an old range cannot be revived for many months.
  if (nowMs >= upcomingStart || upcomingStart - nowMs <= 45 * 24 * 60 * 60 * 1000) {
    return currentYear + 1;
  }
  return currentYear;
}

function inferYearlessSingleYear(month, day, now) {
  const currentYear = now.getUTCFullYear();
  const currentDate = endOfUtcDay(currentYear, Number(month) - 1, Number(day));
  const nextDate = endOfUtcDay(currentYear + 1, Number(month) - 1, Number(day));
  if (currentDate < now && nextDate.getTime() - now.getTime() <= 45 * 24 * 60 * 60 * 1000) {
    return currentYear + 1;
  }
  return currentYear;
}

export function isVagueExpiry(value) {
  const text = cleanText(value).toLowerCase();
  if (!text) return true;
  if (isIsoDateExpiry(text)) return false;
  return /^(siehe|unbekannt|dauerhaft|unbegrenzt|jederzeit|laufend|ongoing|k\.a\.?|tbd|coming soon|bei eröffnung|bei eroeffnung|regelm[aä]ßig|regelmaessig|immer|permanent\b|kurzfristig\b|laut quelle\b|nicht angegeben\b|gutschein[-\s]?abh[aä]ngig\b|frühjahr\b|fruehjahr\b|season opening\b)/i.test(text)
    || /(siehe details|siehe website|siehe webseite|siehe post|siehe tiktok|siehe instagram|check website|not specified|unknown unknown|zeiten auf webseite pr[üu]fen|aktuelle termine auf webseite|ganzt[aä]gig|\(neotaste deal\)|\(7 days rolling\)|g[üu]ltig 2 tage vor oder nach dem geburtstag)/i.test(text)
    || isScheduleOnlyExpiry(text)
    || isPartOfDayExpiry(text);
}

function isRecurringChurchLikeExpiry(value) {
  const text = cleanText(value).toLowerCase();
  if (!text) return false;
  return /^(regelm[aä]ßig|regelmaessig|zeiten auf webseite pr[üu]fen|aktuelle termine auf webseite|so \d{1,2}:\d{2} uhr|jeden\b|jeden sonntag\b|jeden dienstag\b|jeden mittwoch\b|jeden donnerstag\b|jeden freitag\b|jeden samstag\b)/i.test(text);
}

function isScheduleOnlyExpiry(value) {
  const text = cleanText(value).toLowerCase();
  if (!text) return false;
  const hasExplicitDate =
    /\b\d{4}-\d{1,2}-\d{1,2}(?:\b|t)/i.test(text) ||
    /\b\d{1,2}\.\d{1,2}\.(?:\d{2,4})?\b/.test(text) ||
    /\b\d{1,2}\.\s*[-–]\s*\d{1,2}\.\d{1,2}\.\d{4}\b/.test(text) ||
    /\b(j[aä]nner|januar|februar|m[aä]rz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\s+\d{4}\b/.test(text) ||
    /\b\d{1,2}\.?\s+(j[aä]nner|januar|februar|m[aä]rz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\b/.test(text);
  if (hasExplicitDate) return false;
  return /^(mo|di|mi|do|fr|sa|so|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)/i.test(text)
    || /\b(mo|di|mi|do|fr|sa|so)(?:\s*[-–&/]\s*(mo|di|mi|do|fr|sa|so))+/i.test(text)
    || /\b\d{1,2}:\d{2}\s*(?:uhr)?\b/i.test(text) && !/\b(bis|endet|gültig|gueltig|läuft|laeuft|nur heute|morgen)\b/i.test(text);
}

function isPartOfDayExpiry(value) {
  const text = cleanText(value).toLowerCase();
  if (!text) return false;
  return /\b(vormittag|nachmittag|abend|morgens|mittags|abends|ganzt[aä]gig)\b/i.test(text);
}

function isChurchDomain(hostname = '') {
  const host = hostname.toLowerCase();
  return [
    'hillsong.com',
    'www.hillsong.com',
    'cigwien.at',
    'www.cigwien.at',
    'icf-wien.at',
    'www.icf-wien.at',
    'jesuszentrum.at',
    'www.jesuszentrum.at',
    'cgw.at',
    'www.cgw.at',
    'fcgwien.at',
    'www.fcgwien.at',
    'feg.at',
    'www.feg.at',
  ].includes(host);
}

export function shouldSkipUrlExpiryLookup(deal = {}, url = '', raw = '') {
  if (!url || typeof url !== 'string') return true;

  try {
    const parsedUrl = new URL(url);
    if (URL_EXPIRY_BLOCK_HOSTS.has(parsedUrl.hostname.toLowerCase())) return true;
  } catch {
    return true;
  }

  const category = cleanText(deal.category || '').toLowerCase();
  if (category === 'kirche' || category === 'gottesdienste') return true;
  if ((category === 'events' || category === 'gemeinde') && isRecurringChurchLikeExpiry(raw)) return true;

  if (isRecurringChurchLikeExpiry(raw)) return true;
  return false;
}

export function shouldVerifyExpiryAgainstUrl(deal = {}, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const raw = cleanText(
    deal.expires ||
    deal.expiresOriginal ||
    deal.end_date ||
    deal.validity_date ||
    ''
  );
  const url = cleanText(deal.url);
  if (!url || !/^https?:\/\//i.test(url)) return false;
  if (shouldSkipUrlExpiryLookup(deal, url, raw)) return false;
  if (!raw) return true;
  if (isVagueExpiry(raw)) return true;

  const parsed = parseExpiryDetails(raw, { now });
  if (!parsed?.date || parsed.precision !== 'day') return true;

  const contextText = [
    deal?.title,
    deal?.description,
    deal?.category,
    deal?.type,
  ].filter(Boolean).join(' ');
  const shape = parseExpiryShape(raw, { now, contextText });
  return confidenceRank(shape.confidence) < 3 || shape.kind === 'unknown';
}

function parseIsoLike(text) {
  const direct = Date.parse(text);
  if (!Number.isNaN(direct) && /^\d{4}-\d{1,2}-\d{1,2}/.test(text)) {
    const m = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    return {
      date: endOfUtcDay(Number(m[1]), Number(m[2]) - 1, Number(m[3])),
      precision: 'day',
      source: 'text',
    };
  }
  return null;
}

function parseDmyRange(text, now) {
  let m = text.match(/\b\d{1,2}\.\d{1,2}\.\d{4}\s*[-–]\s*(\d{1,2})\.(\d{1,2})\.(\d{4})\b/);
  if (m) {
    return {
      date: endOfUtcDay(Number(m[3]), Number(m[2]) - 1, Number(m[1])),
      precision: 'day',
      source: 'text',
    };
  }

  m = text.match(/\b\d{1,2}\.\d{1,2}\.\s*[-–]\s*(\d{1,2})\.(\d{1,2})\.(\d{4})\b/);
  if (m) {
    return {
      date: endOfUtcDay(Number(m[3]), Number(m[2]) - 1, Number(m[1])),
      precision: 'day',
      source: 'text',
    };
  }

  m = text.match(/\b\d{1,2}\.-(\d{1,2})\.(\d{1,2})\.(\d{4})\b/);
  if (m) {
    return {
      date: endOfUtcDay(Number(m[3]), Number(m[2]) - 1, Number(m[1])),
      precision: 'day',
      source: 'text',
    };
  }

  // Fully written yearless range, e.g. "12.07.–25.07.".
  m = text.match(/\b(\d{1,2})\.(\d{1,2})\.\s*[-–]\s*(\d{1,2})\.(\d{1,2})\.?(?!\d|\.\d)/);
  if (m) {
    const startMonth = Number(m[2]);
    const endMonth = Number(m[4]);
    const endYear = inferYearlessEndYear(endMonth, m[3], now, {
      crossesYear: startMonth > endMonth,
      startMonth,
      startDay: Number(m[1]),
    });
    return {
      date: endOfUtcDay(endYear, Number(m[4]) - 1, Number(m[3])),
      precision: 'day',
      source: 'text',
    };
  }

  // Compact social-caption notation: "12.–25.07.". The first number is the
  // start day, so this must be parsed before a generic single-date matcher.
  m = text.match(/\b(\d{1,2})\.\s*[-–]\s*(\d{1,2})\.(\d{1,2})\.?(?!\d|\.\d)/);
  if (m) {
    const endMonth = Number(m[3]);
    const crossesMonth = Number(m[1]) > Number(m[2]);
    const startMonth = crossesMonth ? (endMonth === 1 ? 12 : endMonth - 1) : endMonth;
    const endYear = inferYearlessEndYear(endMonth, m[2], now, {
      crossesYear: crossesMonth && endMonth === 1,
      startMonth,
      startDay: Number(m[1]),
    });
    return {
      date: endOfUtcDay(endYear, Number(m[3]) - 1, Number(m[2])),
      precision: 'day',
      source: 'text',
    };
  }

  return null;
}

function parseMonthNameRange(text) {
  const monthPattern = '(j[aä]nner|januar|februar|m[aä]rz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember|january|february|march|april|may|june|july|august|september|october|november|december)';
  const regex = new RegExp(`\\b\\d{1,2}\\.?\\s*[-–]\\s*(\\d{1,2})\\.?\\s+${monthPattern}\\s*(\\d{4})\\b`, 'i');
  const m = text.match(regex);
  if (!m) return null;
  const month = MONTH_MAP[m[2].toLowerCase()];
  if (month === undefined) return null;
  return {
    date: endOfUtcDay(Number(m[3]), month, Number(m[1])),
    precision: 'day',
    source: 'text',
  };
}

function parseDmy(text, now) {
  let m = text.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b/);
  if (m) {
    const year = String(m[3]).length === 2 ? Number(`20${m[3]}`) : Number(m[3]);
    return {
      date: endOfUtcDay(year, Number(m[2]) - 1, Number(m[1])),
      precision: 'day',
      source: 'text',
    };
  }

  m = text.match(/\b(\d{1,2})\.(\d{1,2})(?:\.(?!\d)|(?![\d.]))/);
  if (m) {
    const year = inferYearlessSingleYear(Number(m[2]), Number(m[1]), now);
    return {
      date: endOfUtcDay(year, Number(m[2]) - 1, Number(m[1])),
      precision: 'day',
      source: 'text',
    };
  }

  return null;
}

function parseNamedDate(text, now) {
  const monthPattern = '(j[aä]nner|januar|februar|m[aä]rz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember|january|february|march|april|may|june|july|august|september|october|november|december)';
  let m = text.match(new RegExp(`\\b(\\d{1,2})\\.?\\s+${monthPattern}\\s*(\\d{4})?\\b`, 'i'));
  if (m) {
    const month = MONTH_MAP[m[2].toLowerCase()];
    if (month !== undefined) {
      const year = m[3] ? Number(m[3]) : inferYearlessSingleYear(month + 1, Number(m[1]), now);
      return {
        date: endOfUtcDay(year, month, Number(m[1])),
        precision: 'day',
        source: 'text',
      };
    }
  }

  m = text.match(new RegExp(`\\b${monthPattern}\\s+(\\d{1,2}),?\\s*(\\d{4})?\\b`, 'i'));
  if (m) {
    const month = MONTH_MAP[m[1].toLowerCase()];
    if (month !== undefined) {
      const year = m[3] ? Number(m[3]) : inferYearlessSingleYear(month + 1, Number(m[2]), now);
      return {
        date: endOfUtcDay(year, month, Number(m[2])),
        precision: 'day',
        source: 'text',
      };
    }
  }

  return null;
}

function parseMonthOnly(text, now) {
  const monthPattern = '(j[aä]nner|januar|februar|m[aä]rz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember|january|february|march|april|may|june|july|august|september|october|november|december)';
  const m = text.match(new RegExp(`\\b(?:im\\s+|bis\\s+ende\\s+)?${monthPattern}\\s*(\\d{4})\\b`, 'i'));
  if (!m) return null;
  const month = MONTH_MAP[m[1].toLowerCase()];
  if (month === undefined) return null;
  return {
    date: endOfUtcMonth(Number(m[2]), month),
    precision: 'month',
    source: 'text',
  };
}

function stripScheduleSuffix(text) {
  return cleanText(text)
    .replace(/\s+(während öffnungszeiten|regelmäßige?n? zeiten|regular hours|nicht angegeben|not specified|siehe details|see details)$/i, '')
    .replace(/\s+(mo|di|mi|do|fr|sa|so)(?:\s*[-–&/]\s*(mo|di|mi|do|fr|sa|so))+\s*,?\s*\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}.*$/i, '')
    .replace(/\s+(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\s*\d{1,2}:\d{2}.*$/i, '')
    .replace(/\s+(fr|sa|so|mo|di|mi|do)\s+\d{1,2}:\d{2}.*$/i, '')
    .trim();
}

function isolateLeadingExpiryToken(text) {
  const normalized = stripScheduleSuffix(text);
  const patterns = [
    /^(\d{1,2}\.\s*[-–]\s*\d{1,2}\.\d{1,2}\.\d{4})\b/i,
    /^(\d{1,2}\.\d{1,2}\.\d{4}\s*[-–]\s*\d{1,2}\.\d{1,2}\.\d{4})\b/i,
    /^(\d{1,2}\.\d{1,2}\.\s*[-–]\s*\d{1,2}\.\d{1,2}\.\d{4})\b/i,
    /^(\d{1,2}\.\d{1,2}\.\s*[-–]\s*\d{1,2}\.\d{1,2}\.)/i,
    /^(\d{1,2}\.\s*[-–]\s*\d{1,2}\.\d{1,2}\.)/i,
    /^((?:j[aä]nner|januar|februar|m[aä]rz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\s+\d{4})\b/i,
    /^(\d{1,2}\.\d{1,2}\.\d{2,4})\b/i,
    /^(\d{1,2}\.\d{1,2}\.)\b/i,
    /^(\d{1,2}\.?\s+(?:j[aä]nner|januar|februar|m[aä]rz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)(?:\s+\d{4})?)\b/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) return cleanText(match[1]);
  }

  return normalized;
}

export function parseExpiryDetails(value, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const text = cleanText(value);
  if (!text) return null;

  if (isVagueExpiry(text)) return null;

  const withoutPrefixes = isolateLeadingExpiryToken(
    text.replace(/^(gültig\s*bis|einlösbar\s*bis|aktion\s*bis|angebot\s*bis|läuft\s*bis|nur\s*bis|endet\s*am|gültig\s*am|nur\s*am|am|bis)\s*[:\-]?\s*/i, '')
  );

  return (
    parseIsoLike(withoutPrefixes) ||
    parseDmyRange(withoutPrefixes, now) ||
    parseMonthNameRange(withoutPrefixes) ||
    parseDmy(withoutPrefixes, now) ||
    parseNamedDate(withoutPrefixes, now) ||
    parseMonthOnly(withoutPrefixes, now)
  );
}

export function parseExpiryShape(value, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const referenceDate = options.referenceDate instanceof Date
    ? options.referenceDate
    : (options.referenceDate ? new Date(options.referenceDate) : now);
  const dateInferenceNow = Number.isNaN(referenceDate.getTime()) ? now : referenceDate;
  const raw = cleanText(value);
  if (!raw) return { kind: 'unknown', raw: '' };

  const contextText = cleanText(options.contextText || '');
  const text = raw.toLowerCase();
  const signalText = [raw, contextText].filter(Boolean).join(' ').toLowerCase();
  const monthPattern = '(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)';
  const explicitDateMatches = text.match(/\b(\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}(?:[./-]\d{2,4})?|\d{1,2}-\d{1,2}-\d{2,4})\b/g) || [];
  const uniqueExplicitDates = new Set(explicitDateMatches);
  const hasSingleExplicitDate = uniqueExplicitDates.size === 1;
  const hasDateRange = /\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\s*[-–]\s*\d{1,2}[./-]\d{1,2}/.test(text);
  const hasTimeOnlyEndSignal = /\bbis\s+\d{1,2}:\d{2}\b/.test(text);
  const hasEventishSignal =
    /\b(eröffnung|eroeffnung|opening|launch|after work|event|brunch|verkostung|tasting|festival)\b/.test(signalText) ||
    /\(\s*\d+\s*(stunde|stunden|hour|hours|tag|tage)\b/.test(signalText);
  const hasSingleDaySignal =
    /\b(gültig am|gueltig am|nur heute|heute|morgen)\b/.test(signalText) ||
    /\bam\s+\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b/.test(signalText) ||
    /\bam\s+\d{1,2}\.?\s+(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\b/.test(signalText) ||
    /\b(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/.test(signalText);
  const monthMap = {
    januar: 1, februar: 2, 'märz': 3, maerz: 3, april: 4, mai: 5, juni: 6,
    juli: 7, august: 8, september: 9, oktober: 10, november: 11, dezember: 12,
  };

  const buildIso = (year, month, day) => toIsoDateString(Number(year), Number(month), Number(day));
  const referenceParts = (() => {
    if (Number.isNaN(referenceDate.getTime())) return null;
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: options.timeZone || 'UTC',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(referenceDate);
      const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
      return { year: Number(byType.year), month: Number(byType.month), day: Number(byType.day) };
    } catch {
      return { year: referenceDate.getUTCFullYear(), month: referenceDate.getUTCMonth() + 1, day: referenceDate.getUTCDate() };
    }
  })();

  if (referenceParts && /\b(?:nur heute|today only|heute only)\b/.test(text)) {
    return {
      kind: 'single',
      raw,
      validOn: buildIso(referenceParts.year, referenceParts.month, referenceParts.day),
      confidence: 'high',
    };
  }

  if (referenceParts && /\b(?:nur morgen|tomorrow only)\b/.test(text)) {
    const tomorrow = new Date(Date.UTC(
      referenceParts.year,
      referenceParts.month - 1,
      referenceParts.day + 1,
    ));
    return {
      kind: 'single',
      raw,
      validOn: buildIso(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate()),
      confidence: 'high',
    };
  }

  if (isVagueExpiry(raw) || isRecurringChurchLikeExpiry(raw)) {
    return { kind: 'recurring', raw, confidence: 'low' };
  }

  if (/\bjeden\s+(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/.test(text) ||
      /\bwöchentlich\b|\bwoechentlich\b|\bmonatlich\b|\bregelmäßig\b|\bregelm[aä](?:ß|ss)ig\b/.test(text) ||
      /\bsolange vorrat reicht\b|\bsolange der vorrat reicht\b|\btba\b|\bvariiert\b/.test(text)) {
    return { kind: 'recurring', raw, confidence: 'low' };
  }

  let m = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})\s*[-–]\s*(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (m) {
    const startYear = m[3].length === 2 ? `20${m[3]}` : m[3];
    const endYear = m[6].length === 2 ? `20${m[6]}` : m[6];
    return {
      kind: 'range',
      raw,
      validFrom: buildIso(startYear, m[2], m[1]),
      validUntil: buildIso(endYear, m[5], m[4]),
      confidence: 'high',
    };
  }

  m = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*[-–]\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    const startYear = m[3].length === 2 ? `20${m[3]}` : m[3];
    const endYear = m[6].length === 2 ? `20${m[6]}` : m[6];
    return {
      kind: 'range',
      raw,
      validFrom: buildIso(startYear, m[2], m[1]),
      validUntil: buildIso(endYear, m[5], m[4]),
      confidence: 'high',
    };
  }

  m = text.match(/(\d{1,2})\.(\d{1,2})\.\s*[-–]\s*(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (m) {
    const endYear = Number(m[5].length === 2 ? `20${m[5]}` : m[5]);
    const startMonth = Number(m[2]);
    const endMonth = Number(m[4]);
    const startYear = startMonth > endMonth || (startMonth === endMonth && Number(m[1]) > Number(m[3]))
      ? endYear - 1
      : endYear;
    return {
      kind: 'range',
      raw,
      validFrom: buildIso(startYear, startMonth, m[1]),
      validUntil: buildIso(endYear, endMonth, m[3]),
      confidence: 'high',
    };
  }

  m = text.match(/(\d{1,2})\.(\d{1,2})\.\s*[-–]\s*(\d{1,2})\.(\d{1,2})\.?(?!\d|\.\d)/);
  if (m) {
    const startMonth = Number(m[2]);
    const endMonth = Number(m[4]);
    const crossesYear = startMonth > endMonth;
    const endYear = inferYearlessEndYear(endMonth, m[3], dateInferenceNow, { crossesYear, startMonth, startDay: Number(m[1]) });
    const startYear = crossesYear ? endYear - 1 : endYear;
    return {
      kind: 'range',
      raw,
      validFrom: buildIso(startYear, m[2], m[1]),
      validUntil: buildIso(endYear, m[4], m[3]),
      confidence: 'high',
    };
  }

  m = text.match(/(\d{1,2})\.\s*[-–]\s*(\d{1,2})\.(\d{1,2})\.?(?!\d|\.\d)/);
  if (m) {
    const crossesMonth = Number(m[1]) > Number(m[2]);
    const endMonth = Number(m[3]);
    const startMonth = crossesMonth ? (endMonth === 1 ? 12 : endMonth - 1) : endMonth;
    const crossesYear = crossesMonth && endMonth === 1;
    const endYear = inferYearlessEndYear(endMonth, m[2], dateInferenceNow, { crossesYear, startMonth, startDay: Number(m[1]) });
    const startYear = crossesMonth && endMonth === 1 ? endYear - 1 : endYear;
    return {
      kind: 'range',
      raw,
      validFrom: buildIso(startYear, startMonth, m[1]),
      validUntil: buildIso(endYear, endMonth, m[2]),
      confidence: 'high',
    };
  }

  m = text.match(/(\d{1,2})\.\s*[-–]\s*(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (m) {
    const endYear = Number(m[4].length === 2 ? `20${m[4]}` : m[4]);
    const endMonth = Number(m[3]);
    const crossesMonth = Number(m[1]) > Number(m[2]);
    const startMonth = crossesMonth ? (endMonth === 1 ? 12 : endMonth - 1) : endMonth;
    const startYear = crossesMonth && endMonth === 1 ? endYear - 1 : endYear;
    return {
      kind: 'range',
      raw,
      validFrom: buildIso(startYear, startMonth, m[1]),
      validUntil: buildIso(endYear, endMonth, m[2]),
      confidence: 'high',
    };
  }

  m = text.match(/(anfang|mitte|ende)\s+(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\s+(\d{4})/i);
  if (m) {
    const year = Number(m[3]);
    const month = monthMap[m[2]];
    const startDay = m[1] === 'anfang' ? 1 : m[1] === 'mitte' ? 10 : 20;
    const endDay = m[1] === 'anfang' ? 10 : m[1] === 'mitte' ? 20 : new Date(year, month, 0).getDate();
    return {
      kind: 'approx-range',
      raw,
      validFrom: buildIso(year, month, startDay),
      validUntil: buildIso(year, month, endDay),
      confidence: 'medium',
    };
  }

  const hasNamedDay = new RegExp(`\\b\\d{1,2}\\.?(?:\\s+|\\.)${monthPattern}\\b`, 'i').test(text);
  if (!hasNamedDay && !hasSingleExplicitDate) {
    m = text.match(new RegExp(`${monthPattern}\\s+(\\d{4})`, 'i'));
  } else {
    m = null;
  }
  if (m) {
    const year = Number(m[2]);
    const month = monthMap[m[1]];
    return {
      kind: 'month',
      raw,
      validFrom: buildIso(year, month, 1),
      validUntil: buildIso(year, month, new Date(year, month, 0).getDate()),
      confidence: 'medium',
    };
  }

  const hasStrongEndSignal = /\b(gültig bis|gueltig bis|endet|endet am|letzter tag|deadline|frist|einlösbar bis|einloesbar bis|aktion bis|läuft bis|laeuft bis|nur bis|bis)\b/.test(signalText);
  const hasEndSignal = hasStrongEndSignal || (/\bbis\b/.test(text) && (!hasSingleExplicitDate || hasDateRange || !hasTimeOnlyEndSignal));
  const hasRealStartSignal = /\b(gültig ab|gueltig ab|startet|startet am|abholung ab|verfügbar ab|verfuegbar ab|ab eröffnung|ab eroeffnung|öffnet am|oeffnet am)\b/.test(signalText);
  const hasTimeOnlyStartSignal = /\bab\s+\d{1,2}:\d{2}\b/.test(signalText);
  const hasStartSignal = !hasEndSignal && (hasRealStartSignal || hasTimeOnlyStartSignal);
  const hasSingleDayTimeWindow = hasSingleExplicitDate && hasTimeOnlyEndSignal;
  const hasSingleDateEventSignal = hasSingleExplicitDate && hasEventishSignal && !hasStrongEndSignal && !hasRealStartSignal;

  const directTokenMatch =
    raw.match(/\b\d{4}-\d{1,2}-\d{1,2}\b/) ||
    raw.match(/\b\d{1,2}\.\d{1,2}\.\d{2,4}\b/) ||
    raw.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/) ||
    raw.match(new RegExp(`\\b\\d{1,2}\\.?(?:\\s+|\\.)${monthPattern}(?:\\s+\\d{4})?\\b`, 'i'));

  const parsed = parseExpiryDetails(directTokenMatch ? directTokenMatch[0] : raw, { now: dateInferenceNow });
  const parsedIso = parsed?.date ? isoDateFromMs(parsed.date.getTime()) : '';
  if (!parsedIso) {
    return { kind: 'unknown', raw, confidence: 'low' };
  }

  if (hasStartSignal) {
    return { kind: 'start', raw, validFrom: parsedIso, confidence: 'high' };
  }
  if (hasSingleDayTimeWindow) {
    return { kind: 'single', raw, validOn: parsedIso, confidence: 'high' };
  }
  if (hasEndSignal) {
    return { kind: 'end', raw, validUntil: parsedIso, confidence: 'high' };
  }
  if (hasSingleDaySignal) {
    return { kind: 'single', raw, validOn: parsedIso, confidence: 'medium' };
  }
  if (hasSingleDateEventSignal) {
    return { kind: 'single', raw, validOn: parsedIso, confidence: 'medium' };
  }
  if (hasSingleExplicitDate) {
    return { kind: 'end', raw, validUntil: parsedIso, confidence: 'medium' };
  }
  return { kind: 'end', raw, validUntil: parsedIso, confidence: 'low' };
}

function applyStructuredExpiryFields(deal, value, options = {}) {
  clearStructuredExpiryFields(deal);
  const contextText = [
    options.contextText,
    deal?.title,
    deal?.description,
    deal?.category,
    deal?.type,
  ].filter(Boolean).join(' ');
  const shape = parseExpiryShape(value, { ...options, contextText });
  deal.expiryKind = shape.kind || 'unknown';
  deal.expiryDisplayText = shape.raw || cleanText(value);
  if (shape.validOn) deal.validOn = shape.validOn;
  if (shape.validFrom) deal.validFrom = shape.validFrom;
  if (shape.validUntil) deal.validUntil = shape.validUntil;
  if (shape.confidence) deal.dateConfidence = shape.confidence;
}

function repairImplausiblePastExpiry(parsed, raw, deal, now) {
  if (!parsed?.date) return null;

  const text = cleanText(raw);
  const m = text.match(/^\s*(\d{1,2})[./](\d{1,2})[./](19\d{2}|20\d{2})\s*$/);
  if (!m) return null;

  const parsedYear = parsed.date.getUTCFullYear();
  const referenceMs = Date.parse(cleanText(deal?.pubDate || deal?.approvedAt || ''));
  const referenceDate = Number.isFinite(referenceMs) ? new Date(referenceMs) : now;
  const referenceYear = referenceDate.getUTCFullYear();

  if (parsedYear >= 2010 || referenceYear < 2020 || referenceYear - parsedYear < 5) {
    return null;
  }

  const day = Number(m[1]);
  const month = Number(m[2]);
  return {
    date: endOfUtcDay(referenceYear, month - 1, day),
    precision: parsed.precision || 'day',
    source: parsed.source || 'text',
    displayText: `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${referenceYear}`,
  };
}

function extractWestfieldExpiry(text, now) {
  const range = text.match(/\b\d{1,2}\s+[A-Za-zäöüÄÖÜ]+\s+\d{4}\s*[—-]\s*(\d{1,2}\s+[A-Za-zäöüÄÖÜ]+\s+\d{4})\b/);
  if (!range) return null;
  const parsed = parseExpiryDetails(range[1], { now });
  return parsed?.date ? { ...parsed, source: 'url' } : null;
}

function extractNeotasteExpiry(text) {
  if (/90\s*days?|7\s*days?\s*rolling|rolling validity|neotaste deal/i.test(text)) {
    return null;
  }
  return null;
}

export function extractExpiryDateFromHtml(html, options = {}) {
  if (!html) return null;
  const now = options.now instanceof Date ? options.now : new Date();
  const hostname = cleanText(options.hostname || '').toLowerCase();
  const text = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (hostname.includes('westfield.com')) {
    const westfield = extractWestfieldExpiry(text, now);
    if (westfield) return westfield;
  }

  if (hostname.includes('neotaste.com')) {
    const neotaste = extractNeotasteExpiry(text);
    if (neotaste) return neotaste;
    return null;
  }

  if (isChurchDomain(hostname)) {
    return null;
  }

  const phrasePatterns = [
    {
      kind: 'end',
      label: 'gültig bis',
      regex: /(?:gültig\s*bis|einlösbar\s*bis|aktion\s*bis|angebot\s*bis|läuft\s*bis|laeuft\s*bis|nur\s*bis|endet\s*am|end(?:s|et)?\s*(?:on)?|until)\s*[:\-]?\s*([^.!,;\n]{4,90})/gi,
    },
    {
      kind: 'single',
      label: 'gültig am',
      regex: /(?:gültig\s*am|einlösbar\s*am|aktion\s*am|angebot\s*am|nur\s*am|event\s*am|opening\s*on)\s*[:\-]?\s*([^.!,;\n]{4,90})/gi,
    },
    {
      kind: 'start',
      label: 'gültig ab',
      regex: /(?:gültig\s*ab|einlösbar\s*ab|aktion\s*ab|angebot\s*ab|verfügbar\s*ab|verfuegbar\s*ab|startet\s*(?:am|ab)?|available\s*from)\s*[:\-]?\s*([^.!,;\n]{4,90})/gi,
    },
  ];

  for (const pattern of phrasePatterns) {
    let m;
    while ((m = pattern.regex.exec(text)) !== null) {
      const parsed = parseExpiryDetails(m[1], { now });
      if (parsed?.date) {
        return {
          ...parsed,
          source: 'url',
          rawText: cleanText(m[1]),
          shapeText: `${pattern.label} ${cleanText(m[1])}`,
          kindHint: pattern.kind,
        };
      }
    }
  }

  const broadMatches = text.match(/\b\d{4}-\d{1,2}-\d{1,2}\b|\b\d{1,2}\.\d{1,2}\.\d{2,4}\b|\b\d{1,2}\.\s*(?:j[aä]nner|januar|februar|m[aä]rz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\s*\d{0,4}\b|\b(?:j[aä]nner|januar|februar|m[aä]rz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\s+\d{4}\b/gi) || [];
  for (const token of broadMatches.slice(0, 25)) {
    const parsed = parseExpiryDetails(token, { now });
    if (parsed?.date) {
      return {
        ...parsed,
        source: 'url',
        rawText: cleanText(token),
        shapeText: cleanText(token),
      };
    }
  }

  return null;
}

export async function fetchExpiryFromUrl(url, options = {}) {
  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return null;
  let hostname = '';
  try {
    hostname = new URL(url).hostname;
  } catch {
    hostname = '';
  }
  const timeoutMs = Number(options.timeoutMs || process.env.URL_CHECK_TIMEOUT_MS || 7000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'user-agent': URL_CHECK_UA,
        'accept': 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const ctype = (res.headers.get('content-type') || '').toLowerCase();
    if (!ctype.includes('text/html') && !ctype.includes('application/xhtml+xml')) return null;
    const html = await res.text();
    return extractExpiryDateFromHtml(html, { ...options, hostname });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function detectDeadLinkReason(html, options = {}) {
  const text = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20000);

  if (!text) return '';

  const hostname = cleanText(options.hostname || '').toLowerCase();
  const lowered = text.toLowerCase();

  if ((hostname.includes('instagram.com') || hostname.includes('tiktok.com')) && /log in|anmelden|sign up|registrieren/.test(lowered)) {
    return '';
  }

  for (const entry of DEAD_LINK_PATTERNS) {
    if (entry.pattern.test(text)) return entry.reason;
  }

  return '';
}

function detectProtectionInterstitial(html, options = {}) {
  const text = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20000)
    .toLowerCase();

  if (!text) return '';

  const hostname = cleanText(options.hostname || '').toLowerCase();

  if (
    /vercel security checkpoint|we're verifying your browser|verify your browser|enable javascript to continue/.test(text)
  ) {
    return 'Security Checkpoint';
  }

  if (
    /just a moment|checking your browser|verify you are human|captcha|unusual traffic|access denied/.test(text)
  ) {
    return hostname || 'Browser Verification';
  }

  return '';
}

function shouldTreatHttpStatusAsTransient(status) {
  return [401, 403, 408, 409, 423, 425, 429, 500, 502, 503, 504].includes(Number(status || 0));
}

function shouldTreatHttpStatusAsInvalid(status) {
  return [404, 410, 451].includes(Number(status || 0));
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&#(\d+);/g, (_, code) => {
      const point = Number(code);
      return Number.isInteger(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const point = Number.parseInt(code, 16);
      return Number.isInteger(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : _;
    })
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#x2F;/gi, '/')
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function cleanHtmlText(value) {
  return decodeHtmlEntities(String(value || ''))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitleFromHtml(html) {
  const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return cleanHtmlText(match?.[1] || '');
}

function extractMetaTagContent(html, attrName, attrValue) {
  const tags = String(html || '').match(/<meta\b[^>]*>/gi) || [];
  const attrPattern = new RegExp(`${attrName}\\s*=\\s*["']${attrValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'i');
  for (const tag of tags) {
    if (!attrPattern.test(tag)) continue;
    const contentMatch = tag.match(/content\s*=\s*["']([^"']+)["']/i);
    if (contentMatch?.[1]) return cleanHtmlText(contentMatch[1]);
  }
  return '';
}

function extractMetaTagContents(html, attrName, attrValue) {
  const tags = String(html || '').match(/<meta\b[^>]*>/gi) || [];
  const escaped = attrValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const attrPattern = new RegExp(`${attrName}\\s*=\\s*["']${escaped}["']`, 'i');
  const values = [];
  for (const tag of tags) {
    if (!attrPattern.test(tag)) continue;
    const contentMatch = tag.match(/content\s*=\s*["']([^"']+)["']/i);
    if (contentMatch?.[1]) values.push(cleanHtmlText(contentMatch[1]));
  }
  return values.filter(Boolean);
}

function extractTagAttribute(tag, attribute) {
  const escaped = attribute.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(tag || '').match(new RegExp(`${escaped}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return cleanHtmlText(match?.[1] || '');
}

function extractTimeDatetimeCandidates(html) {
  const tags = String(html || '').match(/<time\b[^>]*>/gi) || [];
  return tags
    .map((tag) => extractTagAttribute(tag, 'datetime'))
    .filter(Boolean)
    .map((value) => ({ value, source: 'timeDatetime', priority: 70 }));
}

function parseJsonLdPayload(payload) {
  const text = String(payload || '')
    .trim()
    .replace(/^\s*<!--/, '')
    .replace(/-->\s*$/, '')
    .replace(/^\s*<!\[CDATA\[/, '')
    .replace(/\]\]>\s*$/, '');

  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function collectJsonLdDateCandidates(node, candidates = []) {
  if (!node || typeof node !== 'object') return candidates;
  if (Array.isArray(node)) {
    for (const item of node) collectJsonLdDateCandidates(item, candidates);
    return candidates;
  }

  for (const [key, value] of Object.entries(node)) {
    const lowerKey = key.toLowerCase();
    if (typeof value === 'string') {
      if (lowerKey === 'datepublished') {
        candidates.push({ value, source: 'ldDatePublished', priority: 100, kind: 'publication' });
      } else if (lowerKey === 'datecreated') {
        candidates.push({ value, source: 'ldDateCreated', priority: 90, kind: 'publication' });
      } else if (lowerKey === 'uploaddate') {
        candidates.push({ value, source: 'ldUploadDate', priority: 88, kind: 'publication' });
      } else if (lowerKey === 'datemodified') {
        candidates.push({ value, source: 'ldDateModified', priority: 72, kind: 'publication' });
      } else if (lowerKey === 'startdate') {
        candidates.push({ value, source: 'ldStartDate', priority: 95, kind: 'target-start' });
      } else if (lowerKey === 'enddate') {
        candidates.push({ value, source: 'ldEndDate', priority: 94, kind: 'target-end' });
      } else if (lowerKey === 'validthrough') {
        candidates.push({ value, source: 'ldValidThrough', priority: 97, kind: 'target-end' });
      }
    }
    collectJsonLdDateCandidates(value, candidates);
  }

  return candidates;
}

function extractJsonLdDateCandidates(html) {
  const scripts = String(html || '').match(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  const candidates = [];

  for (const script of scripts) {
    const payloadMatch = script.match(/<script\b[^>]*>([\s\S]*?)<\/script>/i);
    const parsed = parseJsonLdPayload(payloadMatch?.[1] || '');
    if (!parsed) continue;
    collectJsonLdDateCandidates(parsed, candidates);
  }

  return candidates;
}

function normalizeDateCandidate(candidate, options = {}) {
  const raw = cleanText(candidate?.value || '');
  if (!raw) return null;
  const ts = Date.parse(raw);
  if (!Number.isFinite(ts)) return null;
  const nowMs = options.now instanceof Date ? options.now.getTime() : Date.now();
  const maxFutureMs = Number(options.maxFutureMs || DAY_MS);
  if (ts > nowMs + maxFutureMs) return null;
  return {
    ...candidate,
    raw,
    ts,
    iso: new Date(ts).toISOString(),
  };
}

function pickBestDateCandidate(candidates, options = {}) {
  const preferLatest = options.preferLatest === true;
  const normalized = candidates
    .map((candidate) => normalizeDateCandidate(candidate, options))
    .filter(Boolean);

  normalized.sort((a, b) => {
    const priorityDiff = Number(b.priority || 0) - Number(a.priority || 0);
    if (priorityDiff !== 0) return priorityDiff;
    return preferLatest ? b.ts - a.ts : a.ts - b.ts;
  });

  return normalized[0] || null;
}

function buildStructuredTargetDateHint(input = {}, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const targetDateSource = cleanText(input.source || 'url');
  const targetDateRaw = cleanText(input.rawText || input.date || '');
  const targetDateKind = cleanText(input.kind || '');
  const validOn = cleanText(input.validOn || '');
  const validFrom = cleanText(input.validFrom || '');
  const validUntil = cleanText(input.validUntil || '');

  if (validOn || validFrom || validUntil) {
    return {
      targetDateSource,
      targetDateRaw,
      targetDateKind: targetDateKind || (validOn ? 'single' : (validFrom && validUntil ? 'range' : (validFrom ? 'start' : 'end'))),
      validOn,
      validFrom,
      validUntil,
    };
  }

  let parsed = parseExpiryDetails(targetDateRaw, { now });
  if (!parsed && cleanText(input.date || '')) {
    parsed = parseExpiryDetails(cleanText(input.date), { now });
  }
  const parsedIso = parsed?.date ? isoDateFromMs(parsed.date.getTime()) : '';
  if (!parsedIso) return null;

  const shape = parseExpiryShape(targetDateRaw || parsedIso, { now });
  return {
    targetDateSource,
    targetDateRaw: targetDateRaw || parsedIso,
    targetDateKind: cleanText(shape.kind || targetDateKind || 'end'),
    validOn: cleanText(shape.validOn || (targetDateKind === 'single' ? parsedIso : '')),
    validFrom: cleanText(shape.validFrom || (targetDateKind === 'start' ? parsedIso : '')),
    validUntil: cleanText(shape.validUntil || (!shape.validOn && !shape.validFrom ? parsedIso : '')),
  };
}

function detectFocusedDateContextHint(text, options = {}) {
  const raw = cleanText(text);
  if (!raw) return null;
  const now = options.now instanceof Date ? options.now : new Date();
  const monthPattern = '(j[aä]nner|januar|februar|m[aä]rz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember|january|february|march|april|may|june|july|august|september|october|november|december)';

  let match = raw.match(new RegExp(`\\b(?:von|from)\\s+(\\d{1,2})\\.?\\s*(?:bis|to|[-–])\\s*(\\d{1,2})\\.?\\s+${monthPattern}\\s*(\\d{4})?\\b`, 'i'));
  if (match) {
    const month = MONTH_MAP[String(match[3] || '').toLowerCase()];
    const year = match[4] ? Number(match[4]) : now.getUTCFullYear();
    if (month !== undefined) {
      return buildStructuredTargetDateHint({
        source: 'focusedContext',
        rawText: cleanText(match[0]),
        kind: 'range',
        validFrom: toIsoDateString(year, month + 1, Number(match[1])),
        validUntil: toIsoDateString(year, month + 1, Number(match[2])),
      }, { now });
    }
  }

  match = raw.match(new RegExp(`\\b(?:am|on)\\s+(\\d{1,2})\\.?\\s+${monthPattern}\\s*(\\d{4})?\\b`, 'i'));
  if (match) {
    const month = MONTH_MAP[String(match[2] || '').toLowerCase()];
    const year = match[3] ? Number(match[3]) : now.getUTCFullYear();
    if (month !== undefined) {
      return buildStructuredTargetDateHint({
        source: 'focusedContext',
        rawText: cleanText(match[0]),
        kind: 'single',
        date: toIsoDateString(year, month + 1, Number(match[1])),
      }, { now });
    }
  }

  return null;
}

function extractContextPublicationDate(text, options = {}) {
  const raw = cleanText(text);
  if (!raw) return null;
  const now = options.now instanceof Date ? options.now : new Date();
  const monthPattern = '(j[aä]nner|januar|februar|m[aä]rz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember|january|february|march|april|may|june|july|august|september|october|november|december)';
  const patterns = [
    new RegExp(`\\b(?:on|am|posted\\s+on)\\s+(${monthPattern}\\s+\\d{1,2},?\\s*\\d{4}|\\d{1,2}\\.\\d{1,2}\\.\\d{2,4}|\\d{1,2}\\.?\\s+${monthPattern}\\s*\\d{4})\\b`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    const token = cleanText(match?.[1] || '');
    if (!token) continue;
    const parsed = parseExpiryDetails(token, { now });
    if (parsed?.date) {
      return {
        value: parsed.date.toISOString(),
        source: 'contextPublished',
        priority: 112,
      };
    }
  }

  return null;
}

function alignTargetHintWithPublicationYear(targetDateHint, publicationIso) {
  if (!targetDateHint || !publicationIso) return targetDateHint;
  const publicationDate = new Date(publicationIso);
  if (Number.isNaN(publicationDate.getTime())) return targetDateHint;

  const raw = cleanText(targetDateHint.targetDateRaw);
  const publicationYear = publicationDate.getUTCFullYear();
  const fields = ['validOn', 'validFrom', 'validUntil'];
  const fieldValues = fields.map((field) => cleanText(targetDateHint[field])).filter(Boolean);
  if (fieldValues.length === 0) return targetDateHint;

  const rawContainsPublicationYear = raw.includes(String(publicationYear));
  const allCurrentYears = fieldValues.map((value) => Number(String(value).slice(0, 4))).filter(Number.isFinite);
  if (!rawContainsPublicationYear || allCurrentYears.some((year) => year === publicationYear)) {
    return targetDateHint;
  }

  const publicationMonth = publicationDate.getUTCMonth() + 1;
  const publicationDay = publicationDate.getUTCDate();
  const alignIso = (value) => {
    const match = cleanText(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return cleanText(value);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const year = month < publicationMonth || (month === publicationMonth && day + 1 < publicationDay)
      ? publicationYear + 1
      : publicationYear;
    return toIsoDateString(year, month, day);
  };

  return {
    ...targetDateHint,
    validOn: cleanText(targetDateHint.validOn) ? alignIso(targetDateHint.validOn) : '',
    validFrom: cleanText(targetDateHint.validFrom) ? alignIso(targetDateHint.validFrom) : '',
    validUntil: cleanText(targetDateHint.validUntil) ? alignIso(targetDateHint.validUntil) : '',
  };
}

export function extractTargetPageDateHints(html, options = {}) {
  if (!html) return {};
  const now = options.now instanceof Date ? options.now : new Date();
  const pageHints = extractDealPageHints(html);
  const contextPublicationCandidate = extractContextPublicationDate(
    cleanText([pageHints.description, pageHints.title].filter(Boolean).join(' ')),
    { now }
  );

  const publicationCandidates = [
    ...extractMetaTagContents(html, 'property', 'article:published_time').map((value) => ({ value, source: 'articlePublished', priority: 110 })),
    ...extractMetaTagContents(html, 'property', 'og:published_time').map((value) => ({ value, source: 'ogPublishedTime', priority: 108 })),
    ...extractMetaTagContents(html, 'name', 'parsely-pub-date').map((value) => ({ value, source: 'parselyPubDate', priority: 106 })),
    ...extractMetaTagContents(html, 'itemprop', 'datePublished').map((value) => ({ value, source: 'itempropDatePublished', priority: 104 })),
    ...extractMetaTagContents(html, 'itemprop', 'dateCreated').map((value) => ({ value, source: 'itempropDateCreated', priority: 100 })),
    ...extractMetaTagContents(html, 'property', 'article:modified_time').map((value) => ({ value, source: 'articleModified', priority: 78 })),
    ...extractMetaTagContents(html, 'property', 'og:updated_time').map((value) => ({ value, source: 'ogUpdatedTime', priority: 74 })),
    ...extractTimeDatetimeCandidates(html),
  ];
  if (contextPublicationCandidate) publicationCandidates.push(contextPublicationCandidate);

  const jsonLdCandidates = extractJsonLdDateCandidates(html);
  for (const candidate of jsonLdCandidates) {
    if (candidate.kind === 'publication') publicationCandidates.push(candidate);
  }

  const publication = pickBestDateCandidate(publicationCandidates, {
    now,
    maxFutureMs: 2 * DAY_MS,
    preferLatest: false,
  });

  let targetDateHint = null;
  const focusedDateContext = cleanText([pageHints.description, pageHints.title].filter(Boolean).join(' '));
  const focusedContextHint = detectFocusedDateContextHint(focusedDateContext, { now });
  const focusedShape = focusedDateContext
    ? parseExpiryShape(focusedDateContext, { now, contextText: pageHints.title })
    : { kind: 'unknown' };
  const hintHtml = [pageHints.title, pageHints.description]
    .filter(Boolean)
    .map((value) => `<p>${value}</p>`)
    .join('');

  if (focusedContextHint) {
    targetDateHint = focusedContextHint;
  }

  const htmlHint = extractExpiryDateFromHtml(hintHtml || html, options) || extractExpiryDateFromHtml(html, options);
  if (!targetDateHint && htmlHint?.date) {
    const shouldUseFocusedContext = ['single', 'range', 'start', 'end', 'month', 'approx-range'].includes(cleanText(focusedShape.kind));
    targetDateHint = buildStructuredTargetDateHint({
      source: htmlHint.source || 'url',
      rawText: cleanText(
        (shouldUseFocusedContext && focusedDateContext)
          ? focusedDateContext
          : (htmlHint.shapeText || htmlHint.rawText || isoDateFromMs(htmlHint.date.getTime()))
      ),
      kind: cleanText(htmlHint.kindHint || focusedShape.kind || ''),
      date: htmlHint.date.toISOString(),
    }, { now });
  }

  if (!targetDateHint) {
    const jsonLdStarts = jsonLdCandidates.filter((candidate) => candidate.kind === 'target-start');
    const jsonLdEnds = jsonLdCandidates.filter((candidate) => candidate.kind === 'target-end');
    const bestStart = pickBestDateCandidate(jsonLdStarts, { now, maxFutureMs: 365 * DAY_MS, preferLatest: false });
    const bestEnd = pickBestDateCandidate(jsonLdEnds, { now, maxFutureMs: 365 * DAY_MS, preferLatest: true });

    if (bestStart && bestEnd) {
      targetDateHint = buildStructuredTargetDateHint({
        source: `${bestStart.source}+${bestEnd.source}`,
        rawText: `${bestStart.raw} – ${bestEnd.raw}`,
        kind: 'range',
        validFrom: isoDateFromMs(bestStart.ts),
        validUntil: isoDateFromMs(bestEnd.ts),
      }, { now });
    } else if (bestEnd) {
      targetDateHint = buildStructuredTargetDateHint({
        source: bestEnd.source,
        rawText: bestEnd.raw,
        kind: 'end',
        date: bestEnd.iso,
      }, { now });
    } else if (bestStart) {
      targetDateHint = buildStructuredTargetDateHint({
        source: bestStart.source,
        rawText: bestStart.raw,
        kind: 'single',
        date: bestStart.iso,
      }, { now });
    }
  }

  const hostname = cleanText(options.hostname || '').toLowerCase();
  if (hostname.includes('instagram.com') || hostname.includes('tiktok.com') || hostname.includes('facebook.com')) {
    targetDateHint = alignTargetHintWithPublicationYear(targetDateHint, cleanText(publication?.iso || ''));
  }

  return {
    publicationDate: cleanText(publication?.iso || ''),
    publicationDateSource: cleanText(publication?.source || ''),
    ...(targetDateHint || {}),
  };
}

function extractFirstHeading(html) {
  const match = String(html || '').match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  return cleanHtmlText(match?.[1] || '');
}

function extractHeadings(html, limit = 5) {
  const matches = String(html || '').matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi);
  const headings = [];
  const seen = new Set();
  for (const match of matches) {
    const heading = cleanHtmlText(match?.[1] || '');
    const key = heading.toLowerCase();
    if (!heading || seen.has(key)) continue;
    headings.push(heading);
    seen.add(key);
    if (headings.length >= limit) break;
  }
  return headings;
}

function extractVisibleTextSnippet(html, maxLength = 1200) {
  const stripped = String(html || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  return cleanHtmlText(stripped).slice(0, maxLength);
}

function extractDealPageHints(html) {
  const description =
    extractMetaTagContent(html, 'property', 'og:description') ||
    extractMetaTagContent(html, 'name', 'description') ||
    extractMetaTagContent(html, 'name', 'twitter:description');

  const title =
    extractMetaTagContent(html, 'property', 'og:title') ||
    extractMetaTagContent(html, 'name', 'twitter:title') ||
    extractTitleFromHtml(html) ||
    extractFirstHeading(html);

  const headings = extractHeadings(html);

  return {
    title: cleanHtmlText(title),
    description: cleanHtmlText(description),
    heading: headings[0] || '',
    headings,
    textSnippet: extractVisibleTextSnippet(html),
  };
}

export async function inspectDealUrlHealth(url, options = {}) {
  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    return { invalid: true, reason: 'Ungültige Ziel-URL' };
  }

  const timeoutMs = Number(options.timeoutMs || process.env.URL_CHECK_TIMEOUT_MS || 7000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'user-agent': URL_CHECK_UA,
        accept: 'text/html,application/xhtml+xml,*/*',
      },
      redirect: 'follow',
      signal: controller.signal,
    });

    const finalUrl = response.url || url;
    const status = Number(response.status || 0);
    const contentType = cleanText(response.headers.get('content-type') || '').toLowerCase();
    const hostname = (() => {
      try {
        return new URL(finalUrl).hostname;
      } catch {
        return '';
      }
    })();

    if (!response.ok) {
      if (shouldTreatHttpStatusAsInvalid(status)) {
        return {
          invalid: true,
          reason: `HTTP ${status}`,
          status,
          finalUrl,
        };
      }

      if (contentType.includes('text/html') || contentType.includes('application/xhtml+xml')) {
        const html = await response.text();
        const protectionReason = detectProtectionInterstitial(html, { hostname });
        if (protectionReason) {
          return {
            invalid: false,
            transientError: true,
            blockedByProtection: true,
            reason: protectionReason,
            status,
            finalUrl,
          };
        }
      }

      if (shouldTreatHttpStatusAsTransient(status)) {
        return {
          invalid: false,
          transientError: true,
          status,
          finalUrl,
          reason: `HTTP ${status}`,
        };
      }

      return {
        invalid: true,
        reason: `HTTP ${status}`,
        status,
        finalUrl,
      };
    }

    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      return {
        invalid: false,
        status,
        finalUrl,
        checkedAt: new Date().toISOString(),
      };
    }

    const html = await response.text();
    const protectionReason = detectProtectionInterstitial(html, { hostname });
    if (protectionReason) {
      return {
        invalid: false,
        transientError: true,
        blockedByProtection: true,
        reason: protectionReason,
        status,
        finalUrl,
      };
    }

    const deadReason = detectDeadLinkReason(html, { hostname });

    if (deadReason) {
      return {
        invalid: true,
        reason: deadReason,
        status,
        finalUrl,
      };
    }

    const contentHints = extractDealPageHints(html);
    const dateHints = extractTargetPageDateHints(html, { ...options, hostname });

    return {
      invalid: false,
      status,
      finalUrl,
      contentHints,
      dateHints,
      checkedAt: new Date().toISOString(),
    };
  } catch {
    return {
      invalid: false,
      transientError: true,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function normalizeDealExpiry(deal, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const allowUrlLookup = options.allowUrlLookup !== false;
  const forceUrlLookup = options.forceUrlLookup === true;
  const originalExpiryText = cleanText(deal.expiresOriginal || '');
  const raw = cleanText(
    deal.expires ||
    deal.expiresOriginal ||
    deal.end_date ||
    deal.validity_date ||
    ''
  );
  const url = cleanText(deal.url);

  if (raw) {
    deal.expiresOriginal = deal.expiresOriginal || raw;
  }

  const initialParsed = parseExpiryDetails(raw, { now });
  const repairedParsed = repairImplausiblePastExpiry(initialParsed, raw, deal, now);
  const parsed = repairedParsed || initialParsed;
  if (repairedParsed?.displayText) {
    deal.expiresOriginal = repairedParsed.displayText;
  }
  const shouldCheckUrl = Boolean(
    allowUrlLookup &&
    url &&
    (
      forceUrlLookup
        ? !shouldSkipUrlExpiryLookup(deal, url, raw)
        : shouldVerifyExpiryAgainstUrl(deal, { now })
    )
  );

  if (shouldCheckUrl) {
    const cache = options.urlCache;
    let fetched = cache?.get(url);
    if (fetched === undefined) {
      fetched = await fetchExpiryFromUrl(url, options);
      if (cache) cache.set(url, fetched || null);
    }
    if (fetched?.date) {
      deal.expires = fetched.date.toISOString();
      deal.expiresPrecision = fetched.precision || 'day';
      deal.expiresSource = fetched.source || 'url';
      deal.expiresDetectedFromUrl = true;
      const contextText = [
        deal?.title,
        deal?.description,
        deal?.category,
        deal?.type,
      ].filter(Boolean).join(' ');
      const rawShape = parseExpiryShape(deal.expiresOriginal || raw || '', { now, contextText });
      const fetchedShapeSource = cleanText(fetched.shapeText || fetched.rawText || isoDateFromMs(fetched.date.getTime()));
      const fetchedShape = parseExpiryShape(fetchedShapeSource, { now, contextText });
      const useFetchedStructure =
        !parsed?.date ||
        isVagueExpiry(raw) ||
        rawShape.kind === 'unknown' ||
        confidenceRank(fetchedShape.confidence) > confidenceRank(rawShape.confidence) ||
        Boolean(fetched.kindHint) ||
        fetchedShape.kind !== rawShape.kind;
      applyStructuredExpiryFields(
        deal,
        useFetchedStructure ? fetchedShapeSource : (deal.expiresOriginal || raw || deal.expires),
        { now, contextText }
      );
      if (useFetchedStructure) {
        deal.expiryDisplayText = fetchedShapeSource;
        deal.dateConfidence = fetchedShape.confidence || deal.dateConfidence || 'medium';
      }
      return deal;
    }
  }

  if (parsed?.date) {
    const parsedExistingExpiry = raw && raw === cleanText(deal.expires || '');
    const keepUrlSource = parsedExistingExpiry && (
      Boolean(deal.expiresDetectedFromUrl) ||
      cleanText(deal.expiresSource || '').toLowerCase() === 'url'
    );
    deal.expires = parsed.date.toISOString();
    deal.expiresPrecision = parsed.precision || 'day';
    deal.expiresSource = keepUrlSource ? 'url' : (parsed.source || 'text');
    if (keepUrlSource) {
      deal.expiresDetectedFromUrl = true;
    }
    const displaySource = repairedParsed?.displayText || (originalExpiryText && !isVagueExpiry(originalExpiryText)
      ? originalExpiryText
      : (raw || deal.expires));
    applyStructuredExpiryFields(deal, displaySource, { now });
    return deal;
  }

  deal.expires = '';
  deal.expiresPrecision = '';
  deal.expiresSource = '';
  applyStructuredExpiryFields(deal, deal.expiresOriginal || raw || '', { now });
  return deal;
}

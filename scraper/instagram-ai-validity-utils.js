const DAY_MS = 24 * 60 * 60 * 1000;

const MONTHS = {
  januar: 0,
  janner: 0,
  jaenner: 0,
  january: 0,
  jan: 0,
  februar: 1,
  february: 1,
  feb: 1,
  marz: 2,
  maerz: 2,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  mai: 4,
  may: 4,
  juni: 5,
  june: 5,
  jun: 5,
  juli: 6,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  oktober: 9,
  october: 9,
  okt: 9,
  oct: 9,
  november: 10,
  nov: 10,
  dezember: 11,
  december: 11,
  dez: 11,
  dec: 11,
};

const MONTH_PATTERN = Object.keys(MONTHS)
  .sort((left, right) => right.length - left.length)
  .join('|');
const DATE_LINK_PATTERN = '(?:-|bis|to|through|until|und|and|&)';
const WEEKDAY_PATTERN = '(?:mo(?:ntag)?s?|di(?:enstag)?s?|mi(?:ttwoch)?s?|do(?:nnerstag)?s?|fr(?:eitag)?s?|sa(?:mstag)?s?|so(?:nntag)?s?|mon(?:day)?s?|tue(?:sday)?s?|wed(?:nesday)?s?|thu(?:rsday)?s?|fri(?:day)?s?|sat(?:urday)?s?|sun(?:day)?s?)';

function finiteDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value || '');
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeSignal(value = '') {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00df/g, 'ss')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function validNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function utcDayStart(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function utcDayEnd(year, month, day) {
  const date = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
  return date;
}

function utcMonthEnd(year, month) {
  return new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
}

function yearForYearlessMonth(month, referenceDate) {
  const referenceYear = referenceDate.getUTCFullYear();
  const referenceMonth = referenceDate.getUTCMonth();
  // Only infer a year rollover around New Year. This avoids resurrecting a
  // July post saying "bis Jänner" as an offer ending next year.
  if (referenceMonth >= 10 && month <= 1) return referenceYear + 1;
  return referenceYear;
}

function parseYear(value, month, referenceDate) {
  return value ? Number(value) : yearForYearlessMonth(month, referenceDate);
}

function buildWindow(kind, startDate, endDate, evidence) {
  if ((!endDate && kind !== 'ongoing') || (kind.includes('range') && !startDate)) return null;
  return {
    kind,
    startDate: startDate || null,
    endDate,
    evidence: String(evidence || '').trim(),
  };
}

function parseIsoRange(text) {
  const regex = /\b(20\d{2})-(\d{2})-(\d{2})\s*(?:-|bis|to|through|until)\s*(20\d{2})-(\d{2})-(\d{2})\b/i;
  const match = text.match(regex);
  if (!match) return null;
  return buildWindow(
    'range',
    utcDayEnd(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
    utcDayEnd(Number(match[4]), Number(match[5]) - 1, Number(match[6])),
    match[0]
  );
}

function parseOpenEndedStart(text, referenceDate) {
  const isoRegex = /\b(20\d{2})-(\d{2})-(\d{2})\s*(?:bis\s+auf\s+weiteres|until\s+further\s+notice|ongoing)\b/i;
  let match = text.match(isoRegex);
  if (match) {
    return buildWindow(
      'ongoing',
      utcDayEnd(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
      null,
      match[0]
    );
  }

  const numericRegex = /\b([0-3]?\d)[./]([01]?\d)(?:[./](20\d{2}))?\.?\s*(?:bis\s+auf\s+weiteres|until\s+further\s+notice|ongoing)\b/i;
  match = text.match(numericRegex);
  if (match) {
    const month = Number(match[2]) - 1;
    return buildWindow(
      'ongoing',
      utcDayEnd(parseYear(match[3], month, referenceDate), month, Number(match[1])),
      null,
      match[0]
    );
  }

  const namedRegex = new RegExp(`\\b([0-3]?\\d)\\.?\\s+(${MONTH_PATTERN})(?:\\s+(20\\d{2}))?\\s*(?:bis\\s+auf\\s+weiteres|until\\s+further\\s+notice|ongoing)\\b`, 'i');
  match = text.match(namedRegex);
  if (!match) return null;
  const month = MONTHS[match[2]];
  return buildWindow(
    'ongoing',
    utcDayEnd(parseYear(match[3], month, referenceDate), month, Number(match[1])),
    null,
    match[0]
  );
}

function parseNumericRange(text, referenceDate) {
  const regex = /\b([0-3]?\d)[./]([01]?\d)(?:[./](20\d{2}))?\.?\s*(?:-|bis|to|through|until)\s*([0-3]?\d)[./]([01]?\d)(?:[./](20\d{2}))?\.?\b/i;
  const match = text.match(regex);
  if (!match) return null;

  const startMonth = Number(match[2]) - 1;
  const endMonth = Number(match[5]) - 1;
  let endYear = parseYear(match[6], endMonth, referenceDate);
  let startYear = match[3] ? Number(match[3]) : endYear;
  if (!match[3] && startMonth > endMonth) startYear -= 1;
  if (!match[6] && match[3]) endYear = startMonth > endMonth ? startYear + 1 : startYear;

  return buildWindow(
    'range',
    utcDayEnd(startYear, startMonth, Number(match[1])),
    utcDayEnd(endYear, endMonth, Number(match[4])),
    match[0]
  );
}

function parseCompactNamedRange(text, referenceDate) {
  const regex = new RegExp(`\\b([0-3]?\\d)\\.?\\s*(?:-|bis|to|through|until)\\s*([0-3]?\\d)\\.?\\s+(${MONTH_PATTERN})(?:\\s+(20\\d{2}))?\\b`, 'i');
  const match = text.match(regex);
  if (!match) return null;
  const month = MONTHS[match[3]];
  const year = parseYear(match[4], month, referenceDate);
  return buildWindow(
    'range',
    utcDayEnd(year, month, Number(match[1])),
    utcDayEnd(year, month, Number(match[2])),
    match[0]
  );
}

function parseNamedDayRange(text, referenceDate) {
  const regex = new RegExp(`\\b([0-3]?\\d)\\.?\\s+(${MONTH_PATTERN})(?:\\s+(20\\d{2}))?\\s*${DATE_LINK_PATTERN}\\s*([0-3]?\\d)\\.?\\s+(${MONTH_PATTERN})(?:\\s+(20\\d{2}))?\\b`, 'i');
  const match = text.match(regex);
  if (!match) return null;

  const startMonth = MONTHS[match[2]];
  const endMonth = MONTHS[match[5]];
  let endYear = parseYear(match[6], endMonth, referenceDate);
  let startYear = match[3] ? Number(match[3]) : endYear;
  if (!match[3] && startMonth > endMonth) startYear -= 1;
  if (!match[6] && match[3]) endYear = startMonth > endMonth ? startYear + 1 : startYear;

  return buildWindow(
    'range',
    utcDayEnd(startYear, startMonth, Number(match[1])),
    utcDayEnd(endYear, endMonth, Number(match[4])),
    match[0]
  );
}

function parseMonthRange(text, referenceDate) {
  const regex = new RegExp(`\\b(${MONTH_PATTERN})(?:\\s+(20\\d{2}))?\\s*${DATE_LINK_PATTERN}\\s*(${MONTH_PATTERN})(?:\\s+(20\\d{2}))?\\b`, 'i');
  const match = text.match(regex);
  if (!match) return null;

  const startMonth = MONTHS[match[1]];
  const endMonth = MONTHS[match[3]];
  let endYear = parseYear(match[4], endMonth, referenceDate);
  let startYear = match[2] ? Number(match[2]) : endYear;
  if (!match[2] && startMonth > endMonth) startYear -= 1;
  if (!match[4] && match[2]) endYear = startMonth > endMonth ? startYear + 1 : startYear;

  return buildWindow(
    'month-range',
    utcDayEnd(startYear, startMonth, 1),
    utcMonthEnd(endYear, endMonth),
    match[0]
  );
}

function parseExplicitSingleDate(text, referenceDate) {
  const numericRegex = /\b(?:nur\s+am|aktion\s+am|angebot\s+am|deal\s+am|g(?:ü|u)ltig\s+am|only\s+on)\s+([0-3]?\d)[./]([01]?\d)(?:[./](20\d{2}))?\.?\b/i;
  let match = text.match(numericRegex);
  if (match) {
    const month = Number(match[2]) - 1;
    const year = parseYear(match[3], month, referenceDate);
    const endDate = utcDayEnd(year, month, Number(match[1]));
    return endDate ? buildWindow('single', endDate, endDate, match[0]) : null;
  }

  const namedRegex = new RegExp(`\\b(?:nur\\s+am|aktion\\s+am|angebot\\s+am|deal\\s+am|g(?:u|ü)ltig\\s+am|only\\s+on)\\s+([0-3]?\\d)\\.?\\s+(${MONTH_PATTERN})(?:\\s+(20\\d{2}))?\\b`, 'i');
  match = text.match(namedRegex);
  if (!match) return null;
  const month = MONTHS[match[2]];
  const year = parseYear(match[3], month, referenceDate);
  const endDate = utcDayEnd(year, month, Number(match[1]));
  return endDate ? buildWindow('single', endDate, endDate, match[0]) : null;
}

function parseEventSingleDate(text, referenceDate) {
  const eventSignal = '(?:strassenfest|festival|event|veranstaltung|konzert|concert|fest|aktionstag|opening|eroeffnung)';
  const numericDate = '([0-3]?\\d)[./]([01]?\\d)(?:[./](20\\d{2}))?\\.?';
  const namedDate = `([0-3]?\\d)\\.?\\s+(${MONTH_PATTERN})(?:\\s+(20\\d{2}))?`;
  const numericRegexes = [
    new RegExp(`\\bam\\s+${numericDate}[^!?]{0,120}\\b${eventSignal}\\b`, 'i'),
    new RegExp(`\\b${eventSignal}\\b[^!?]{0,120}\\bam\\s+${numericDate}`, 'i'),
  ];
  for (const regex of numericRegexes) {
    const match = text.match(regex);
    if (!match) continue;
    const offset = regex === numericRegexes[0] ? 1 : 1;
    const month = Number(match[offset + 1]) - 1;
    const year = parseYear(match[offset + 2], month, referenceDate);
    const endDate = utcDayEnd(year, month, Number(match[offset]));
    if (endDate) return buildWindow('single', endDate, endDate, match[0]);
  }

  const namedRegexes = [
    new RegExp(`\\bam\\s+${namedDate}[^!?]{0,120}\\b${eventSignal}\\b`, 'i'),
    new RegExp(`\\b${eventSignal}\\b[^!?]{0,120}\\bam\\s+${namedDate}`, 'i'),
  ];
  for (const regex of namedRegexes) {
    const match = text.match(regex);
    if (!match) continue;
    const month = MONTHS[match[2]];
    const year = parseYear(match[3], month, referenceDate);
    const endDate = utcDayEnd(year, month, Number(match[1]));
    if (endDate) return buildWindow('single', endDate, endDate, match[0]);
  }
  return null;
}

function parseExplicitEnd(text, referenceDate) {
  const namedDayRegex = new RegExp(`\\b(?:bis|gueltig bis|valid until|until|through)(?:\\s+zum|\\s+ende)?\\s+([0-3]?\\d)\\.?\\s+(${MONTH_PATTERN})(?:\\s+(20\\d{2}))?\\b`, 'i');
  let match = text.match(namedDayRegex);
  if (match) {
    const month = MONTHS[match[2]];
    const year = parseYear(match[3], month, referenceDate);
    return buildWindow('end', null, utcDayEnd(year, month, Number(match[1])), match[0]);
  }

  const numericRegex = /\b(?:bis|gueltig bis|valid until|until|through)\s+(?:zum\s+)?([0-3]?\d)[./]([01]?\d)(?:[./](20\d{2}))?\.?\b/i;
  match = text.match(numericRegex);
  if (match) {
    const month = Number(match[2]) - 1;
    const year = parseYear(match[3], month, referenceDate);
    return buildWindow('end', null, utcDayEnd(year, month, Number(match[1])), match[0]);
  }

  const monthEndRegex = new RegExp(`\\b(?:bis|gueltig bis|valid until|until|through)(?:\\s+(?:zum|the))?\\s+(?:ende|end of)?\\s*(${MONTH_PATTERN})(?:\\s+(20\\d{2}))?\\b`, 'i');
  match = text.match(monthEndRegex);
  if (match) {
    const month = MONTHS[match[1]];
    const year = parseYear(match[2], month, referenceDate);
    return buildWindow('month-end', null, utcMonthEnd(year, month), match[0]);
  }

  return null;
}

function parseOfferMonth(text, referenceDate) {
  const regex = new RegExp(`\\b(?:(?:aktion|angebot|deal|special|happy hour)\\s+(?:im|in)|(?:im|den ganzen|throughout)\\s+)(${MONTH_PATTERN})(?:\\s+(20\\d{2}))?\\b`, 'i');
  const match = text.match(regex);
  if (!match) return null;
  const month = MONTHS[match[1]];
  const year = parseYear(match[2], month, referenceDate);
  return buildWindow('month', utcDayEnd(year, month, 1), utcMonthEnd(year, month), match[0]);
}

export function extractActiveOfferWindow(signal, options = {}) {
  const text = normalizeSignal(signal);
  if (!text) return null;
  const referenceDate = finiteDate(options.pubDate) || finiteDate(options.now) || new Date();
  return (
    parseIsoRange(text)
    || parseOpenEndedStart(text, referenceDate)
    || parseNumericRange(text, referenceDate)
    || parseCompactNamedRange(text, referenceDate)
    || parseNamedDayRange(text, referenceDate)
    || parseMonthRange(text, referenceDate)
    || parseExplicitEnd(text, referenceDate)
    || parseEventSingleDate(text, referenceDate)
    || parseExplicitSingleDate(text, referenceDate)
    || parseOfferMonth(text, referenceDate)
  );
}

export function hasRecurringWeekdaySchedule(signal) {
  const text = normalizeSignal(signal);
  if (!text) return false;
  const weekdayRange = new RegExp(`\\b${WEEKDAY_PATTERN}\\s*(?:-|bis|to|through)\\s*${WEEKDAY_PATTERN}\\b`, 'i');
  const repeatedWeekday = new RegExp(`\\b(?:jeden|jede|jeder|every)\\s+${WEEKDAY_PATTERN}\\b`, 'i');
  return weekdayRange.test(text)
    || repeatedWeekday.test(text)
    || /\b(?:wochentags|werktags|weekdays|taeglich|daily|alltags)\b/i.test(text);
}

export function hasRecurringOfferSchedule(signal) {
  const text = normalizeSignal(signal);
  if (!text) return false;
  const schedulePattern = new RegExp(
    `(?:\\b${WEEKDAY_PATTERN}\\s*(?:-|bis|to|through)\\s*${WEEKDAY_PATTERN}\\b|\\b(?:jeden|jede|jeder|every)\\s+${WEEKDAY_PATTERN}\\b|\\b(?:wochentags|werktags|weekdays|taeglich|daily|regelmaessig|weekly|woechentlich|monatlich)\\b|\\b(?:bis\\s+auf\\s+weiteres|until\\s+further\\s+notice|ongoing)\\b)`,
    'i'
  );
  const offerPattern = /(?:\b(?:gratis|kostenlos|kostenfrei|umsonst|free|rabatt|deal|aktion|angebot|special|happy hour|bogo)\b|\b1\s*[+&]\s*1\b|\b\d+\s*%|\bstatt\s+(?:€\s*)?\d)/i;
  return text
    .split(/[.!?;\n]+/)
    .some((segment) => schedulePattern.test(segment) && offerPattern.test(segment));
}

export function hasViennaInstagramEvidence(signal) {
  const text = normalizeSignal(signal);
  if (!text) return false;
  return /\b(?:wien|vienna)\b/.test(text)
    || /(?:^|[^\d])(1(?:0[1-9]0|1[0-9]0|2[0-3]0))(?:\b|[^\d])/.test(text)
    || /\b(?:innere stadt|leopoldstadt|landstrasse|wieden|margareten|mariahilf|neubau|josefstadt|alsergrund|favoriten|meidling|hietzing|penzing|rudolfsheim|ottakring|hernals|waehring|doebling|brigittenau|floridsdorf|donaustadt|liesing)\b/.test(text)
    || /[@#][a-z0-9._-]*(?:wien|vienna)\b/.test(text)
    || /\brotenturmstrasse\b/.test(text);
}

export function isYesterdayOnlyOffer(signal) {
  const text = normalizeSignal(signal);
  if (!text || !/\b(?:gestern|yesterday)\b/.test(text)) return false;
  if (/\b(?:nur|ausschliesslich|only)\s+(?:noch\s+)?(?:gestern|yesterday)\b|\b(?:gestern|yesterday)\s+(?:nur|only)\b/.test(text)) {
    return true;
  }
  if (
    /\b(?:gestern|yesterday)\s+(?:war\s+)?(?:die\s+)?(?:eroffnung|eroeffnung|opening)|\b(?:gestern|yesterday)\s+(?:eroffnet|eroeffnet|opened)\b/.test(text)
    && /\b(?:ab heute|ab sofort|starting today|from today)\b/.test(text)
  ) {
    return false;
  }

  const offerSignal = '(?:gratis|kostenlos|free|1\\s*\\+\\s*1|rabatt|aktion|angebot|deal|special|happy hour)';
  const pastOffer = new RegExp(
    `(?:\\b(?:gestern|yesterday)\\b\\s+(?:gab es|war(?:en)?|kostete|bekam(?:st|en)?|erhielt(?:st|en)?|was|were|had)\\b[^.!?]{0,60}\\b${offerSignal}\\b|\\b${offerSignal}\\b[^.!?]{0,45}\\b(?:war|waren|lief|gab es|was|were)\\s+(?:gestern|yesterday)\\b)`,
    'i'
  );
  return pastOffer.test(text);
}

export function evaluateInstagramOfferTiming(options = {}) {
  const now = finiteDate(options.now) || new Date();
  const pubDate = finiteDate(options.pubDate);
  const maxAgeDays = validNumber(options.maxAgeDays, 7);
  const activeOfferMaxAgeDays = Math.max(maxAgeDays, validNumber(options.activeOfferMaxAgeDays, 45));
  const futureSkewMinutes = validNumber(options.futureSkewMinutes, 10);
  const signal = String(options.signal || '');
  const offerWindow = extractActiveOfferWindow(signal, { pubDate, now });
  const recurring = hasRecurringOfferSchedule(signal);
  const yesterdayOnly = isYesterdayOnlyOffer(signal);
  const todayStart = utcDayStart(now).getTime();
  const todayEnd = utcDayEnd(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()).getTime();
  const explicitExpired = Boolean(offerWindow?.endDate && offerWindow.endDate.getTime() < todayStart);
  const notStarted = Boolean(offerWindow?.startDate && offerWindow.startDate.getTime() > todayEnd);
  const activeExplicitWindow = Boolean(offerWindow && !explicitExpired && !notStarted);
  const futurePublication = Boolean(pubDate && pubDate.getTime() > now.getTime() + futureSkewMinutes * 60 * 1000);
  const ageDays = pubDate ? Math.max(0, (now.getTime() - pubDate.getTime()) / DAY_MS) : null;
  const withinFreshWindow = ageDays !== null && !futurePublication && ageDays <= maxAgeDays;
  const withinActiveOfferLimit = ageDays !== null && !futurePublication && ageDays <= activeOfferMaxAgeDays;
  const activeEvidence = activeExplicitWindow || recurring;
  const expired = explicitExpired || yesterdayOnly;

  return {
    ageDays,
    maxAgeDays,
    activeOfferMaxAgeDays,
    futureSkewMinutes,
    withinFreshWindow,
    withinActiveOfferLimit,
    offerWindow,
    recurring,
    yesterdayOnly,
    explicitExpired,
    notStarted,
    futurePublication,
    activeExplicitWindow,
    activeEvidence,
    expired,
    eligibleByAge: Boolean(pubDate && !futurePublication && !expired && !notStarted && (withinFreshWindow || (withinActiveOfferLimit && activeEvidence))),
  };
}

function sanitizeUnicode(value = '') {
  const input = String(value || '');
  let output = '';
  for (let index = 0; index < input.length; index += 1) {
    const unit = input.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = input.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        output += input[index] + input[index + 1];
        index += 1;
      } else {
        output += '\ufffd';
      }
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      output += '\ufffd';
    } else {
      output += input[index];
    }
  }
  return output;
}

export function unicodeSafeTruncate(value = '', maxLength = Infinity) {
  const text = sanitizeUnicode(value);
  if (!Number.isFinite(maxLength)) return text;
  let end = Math.max(0, Math.floor(maxLength));
  if (text.length <= end) return text;
  if (
    end > 0
    && text.charCodeAt(end - 1) >= 0xd800
    && text.charCodeAt(end - 1) <= 0xdbff
    && text.charCodeAt(end) >= 0xdc00
    && text.charCodeAt(end) <= 0xdfff
  ) {
    end -= 1;
  }
  return text.slice(0, end);
}

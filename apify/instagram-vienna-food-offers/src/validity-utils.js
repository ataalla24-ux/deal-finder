const DAY_MS = 24 * 60 * 60 * 1000;

export function stripInstagramMetaDescriptionPrefix(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  const colonIndex = text.indexOf(':');
  if (colonIndex < 0) return text;
  const prefix = text.slice(0, colonIndex);
  if (!/(?:\blikes?\b|\bcomments?\b|\bon\s+instagram\b|\bauf\s+instagram\b)/i.test(prefix)) return text;
  return text.slice(colonIndex + 1).trim().replace(/^['"]|['"]$/g, '').trim();
}

export function inferCaptionDateYear(monthIndex, day, now = new Date(), preferredYear = null) {
  if (Number.isInteger(preferredYear)) return preferredYear;
  const currentYear = now.getUTCFullYear();
  const currentDate = new Date(Date.UTC(currentYear, monthIndex, day, 23, 59, 59, 999));
  const nextDate = new Date(Date.UTC(currentYear + 1, monthIndex, day, 23, 59, 59, 999));
  return currentDate < now && nextDate.getTime() - now.getTime() <= 45 * DAY_MS
    ? currentYear + 1
    : currentYear;
}

function validUtcDate(year, month, day, endOfDay = false) {
  const date = new Date(Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0,
  ));
  return date.getUTCFullYear() === Number(year)
    && date.getUTCMonth() === Number(month) - 1
    && date.getUTCDate() === Number(day)
    ? date
    : null;
}

function normalizeYear(value) {
  if (!value) return null;
  return String(value).length === 2 ? Number(`20${value}`) : Number(value);
}

function inferCrossYearEnd(startMonth, startDay, endMonth, endDay, now) {
  const crossesYear = startMonth > endMonth;
  if (!crossesYear) return now.getUTCFullYear();
  const currentYear = now.getUTCFullYear();
  const upcomingStart = validUtcDate(currentYear, startMonth, startDay);
  return upcomingStart && (now >= upcomingStart || upcomingStart.getTime() - now.getTime() <= 45 * DAY_MS)
    ? currentYear + 1
    : currentYear;
}

export function extractCaptionDateRange(text, now = new Date(), maxFutureValidityDays = 120, referenceDate = now) {
  const normalized = String(text || '');
  let match = normalized.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})?\s*[-–]\s*(\d{1,2})\.(\d{1,2})\.(\d{2,4})?/);
  let startDay;
  let startMonth;
  let startYear;
  let endDay;
  let endMonth;
  let endYear;

  if (match) {
    startDay = Number(match[1]);
    startMonth = Number(match[2]);
    startYear = normalizeYear(match[3]);
    endDay = Number(match[4]);
    endMonth = Number(match[5]);
    endYear = normalizeYear(match[6]);
  } else {
    match = normalized.match(/\b(\d{1,2})\.\s*[-–]\s*(\d{1,2})\.(\d{1,2})\.(\d{2,4})?/);
    if (!match) return null;
    startDay = Number(match[1]);
    endDay = Number(match[2]);
    endMonth = Number(match[3]);
    endYear = normalizeYear(match[4]);
    startMonth = startDay > endDay ? (endMonth === 1 ? 12 : endMonth - 1) : endMonth;
  }

  if (!endYear && startYear) {
    endYear = startYear + (startMonth > endMonth ? 1 : 0);
  }
  if (!endYear) endYear = inferCrossYearEnd(startMonth, startDay, endMonth, endDay, referenceDate);
  if (!startYear) {
    startYear = startMonth > endMonth || (startMonth === endMonth && startDay > endDay)
      ? endYear - 1
      : endYear;
  }

  const validFrom = validUtcDate(startYear, startMonth, startDay);
  const validUntil = validUtcDate(endYear, endMonth, endDay, true);
  if (!validFrom || !validUntil || validFrom > validUntil) return null;
  if (validUntil.getTime() - now.getTime() > maxFutureValidityDays * DAY_MS) {
    return { explicit: true, validFrom: validFrom.toISOString(), validUntil: null, isFuture: validFrom > now };
  }
  return {
    explicit: true,
    validFrom: validFrom.toISOString(),
    validUntil: validUntil.toISOString(),
    isFuture: validFrom > now,
  };
}

function datePartsInVienna(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Vienna',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(byType.year), month: Number(byType.month), day: Number(byType.day) };
}

export function calendarDateKeyInVienna(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = datePartsInVienna(date);
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function isCalendarDateAfter(value, now = new Date()) {
  const explicitKey = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  return Boolean(explicitKey && explicitKey > calendarDateKeyInVienna(now));
}

export function isCalendarDateBefore(value, now = new Date()) {
  const explicitKey = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  return Boolean(explicitKey && explicitKey < calendarDateKeyInVienna(now));
}

function anchoredDay(referenceDate, offsetDays = 0) {
  const parts = datePartsInVienna(referenceDate);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day + offsetDays, 12, 0, 0, 0));
}

function endOfUtcCalendarDay(date) {
  const result = new Date(date);
  result.setUTCHours(23, 59, 59, 999);
  return result.toISOString();
}

export function relativeCaptionValidity(text, now = new Date(), postPublishedAt = '') {
  const normalized = String(text || '').toLowerCase();
  const parsedPostDate = new Date(postPublishedAt);
  const anchor = Number.isNaN(parsedPostDate.getTime()) ? now : parsedPostDate;

  if (/\b(?:nur heute|today only|heute only)\b/.test(normalized)) {
    const day = anchoredDay(anchor);
    return { explicit: true, validFrom: null, validUntil: endOfUtcCalendarDay(day), isFuture: day > now };
  }
  if (/\b(?:nur morgen|tomorrow only)\b/.test(normalized)) {
    const day = anchoredDay(anchor, 1);
    return {
      explicit: true,
      validFrom: new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate())).toISOString(),
      validUntil: endOfUtcCalendarDay(day),
      isFuture: day > now,
    };
  }
  return null;
}

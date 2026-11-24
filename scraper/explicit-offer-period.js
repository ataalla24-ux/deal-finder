const DAY_MS = 24 * 60 * 60 * 1000;

export function endOfUtcDay(year, monthIndex, day) {
  const date = new Date(Date.UTC(year, monthIndex, day, 23, 59, 59, 999));
  if (
    date.getUTCFullYear() !== Number(year)
    || date.getUTCMonth() !== Number(monthIndex)
    || date.getUTCDate() !== Number(day)
  ) {
    return new Date(Number.NaN);
  }
  return date;
}

// Interpret only the explicit date-picker grammar, never a publication date or
// yearless caption. Intl supplies Vienna's DST offsets; ambiguous clocks fail closed.
export function viennaInstant(day, time) {
  const formatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const wall = Date.parse(`${day}T${time}:00Z`);
  const stamps = new Set();
  for (const delta of [-DAY_MS, 0, DAY_MS]) {
    const sample = wall + delta;
    const parts = Object.fromEntries(formatter.formatToParts(new Date(sample)).map(p => [p.type, p.value]));
    const displayed = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
    const offset = Date.parse(`${displayed}:00Z`) - sample;
    const candidate = wall - offset;
    const actual = Object.fromEntries(formatter.formatToParts(new Date(candidate)).map(p => [p.type, p.value]));
    if (`${actual.year}-${actual.month}-${actual.day}T${actual.hour}:${actual.minute}` === `${day}T${time}`) stamps.add(candidate);
  }
  return stamps.size === 1 ? new Date([...stamps][0]).toISOString() : '';
}

export function parseExplicitOfferPeriod(raw) {
  const text = String(raw || '').replace(/\s+/g, ' ').trim();
  const match = text.match(/^(\d{1,2})\.(\d{1,2})\.(20\d{2})(?:,\s*(\d{2}:\d{2}))?(?:\s+bis\s+(\d{1,2})\.(\d{1,2})\.(20\d{2})(?:,\s*(\d{2}:\d{2}))?)?(?:\s+Uhr)?$/);
  if (!match) return null;
  const [, d, m, y, startTime, ed, em, ey, endTime] = match;
  // A bare date retains its existing end-date semantics.
  if (!ed && !startTime) return null;
  const start = endOfUtcDay(+y, +m - 1, +d);
  const end = ed ? endOfUtcDay(+ey, +em - 1, +ed) : start;
  const error = { error: 'Aktionszeitraum ungültig oder Uhrzeit nicht eindeutig (Europe/Vienna)' };
  if (!Number.isFinite(+start) || !Number.isFinite(+end) || start > end
      || Boolean(startTime) !== Boolean(ed ? endTime : startTime)
      || [startTime, endTime].filter(Boolean).some(t => !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t))) return error;
  const first = start.toISOString().slice(0, 10), last = end.toISOString().slice(0, 10);
  const startsAt = startTime ? viennaInstant(first, startTime) : '';
  const expires = startTime ? viennaInstant(last, ed ? endTime : startTime) : end.toISOString();
  if (!expires || (startTime && (!startsAt || startsAt > expires))) return error;
  return { kind: first === last ? 'single' : 'range', validFrom: first, validUntil: last,
    ...(first === last ? { validOn: first } : {}), expires };
}

// A source clock belongs only to its matching offer period. Calendar-only
// periods, review timers and a different selected day must retain their semantics.
export function matchingTimedOfferPeriod(literal, validFrom, validUntil) {
  if (!validUntil || !/\d{2}:\d{2}/.test(literal || '')) return null;
  const period = parseExplicitOfferPeriod(literal);
  if (!period?.expires || period.validUntil !== String(validUntil).slice(0, 10)
      || (validFrom && period.validFrom !== String(validFrom).slice(0, 10))) return null;
  return period;
}

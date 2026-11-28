import { parseExplicitOfferPeriod, viennaInstant } from '../scraper/explicit-offer-period.js';

const clean = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
const fold = value => clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss').toLowerCase();
const date = '\\d{1,2}\\.\\d{1,2}\\.20\\d{2}';
const clock = '(?:[01]?\\d|2[0-3])(?::[0-5]\\d)?';
const embeddedRange = new RegExp(`\\bam\\s+(${date})\\s+von\\s+(${clock})\\s*(?:Uhr\\s*)?bis\\s+(${clock})\\s*(?:Uhr)?(?![\\d:])`, 'giu');
const canonicalRange = new RegExp(`\\b(${date}),\\s*(${clock})\\s*(?:Uhr\\s*)?bis\\s+(${date}),\\s*(${clock})\\s*(?:Uhr)?(?![\\d:])`, 'giu');
const benefit = /\b(?:gratis|kostenlos|rabatt|gutschein|coupon)\b|\d\s*(?:%|€|euro\b)|\b\d\s*\+\s*\d\b/i;
const event = /\b(?:aktion|aktionszeitraum|eroffnung|eroeffnung|eroffnungsangebot|eroeffnungsangebot|grand opening|feiern)\b/;
const uncertain = /\b(?:nicht|kein\w*|not|no|nie|niemals|jeden?|jede\w*|every|immer|taglich|taeglich|wochent\w*|monatlich|jahrlich|jaehrlich|weekly|daily|monthly|annually|recurring|dauerhaft|unbefristet|verlanger\w*|verlaenger\w*|extended|weiterhin|danach|fortgesetzt|lauft weiter|geht weiter|auch morgen|nachsten tag|folgenden tag|uber mitternacht|bis auf weiteres|voraussichtlich|eventuell|vermutlich|geplant|offnungszeiten|oeffnungszeiten|geoffnet|geoeffnet|offen|opening hours|opening times|gewinnspiel|giveaway|teilnahmeschluss|einsendeschluss|repost\w*|regram\w*|reshare\w*|throwback|archiv\w*|ruckblick|rueckblick|letztes jahr|last year)\b|#tbt\b/;
const extraTiming = /\b20\d{2}-\d{2}-\d{2}\b|\b\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?\b|\b\d{1,2}\.?\s+(?:januar|janner|jaenner|februar|marz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\b|\b\d{1,2}:\d{2}\b|\b\d{1,2}\s*uhr\b|\b(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)s?\b|\b(?:am|on|vom|von|bis|ab|um|from|until)\s+\d{1,2}\b/;
const fullClock = value => value.includes(':') ? value.padStart(5, '0') : `${value.padStart(2, '0')}:00`;

const eventMonths = {
  january: 1, januar: 1, janner: 1, ocak: 1, february: 2, februar: 2, subat: 2,
  march: 3, marz: 3, mart: 3, april: 4, nisan: 4, may: 5, mai: 5, mayis: 5,
  june: 6, juni: 6, haziran: 6, july: 7, juli: 7, temmuz: 7, august: 8, agustos: 8,
  september: 9, eylul: 9, october: 10, oktober: 10, ekim: 10,
  november: 11, kasim: 11, december: 12, dezember: 12, aralik: 12,
};
const eventFold = value => fold(value).replace(/ı/g, 'i');
const explicitClockZone = value => /\b(?:utc|gmt|mez|mesz|cet|cest|pst|pdt|est|edt|timezone|time zone|zeitzone|all times|saat dilimi|turkiye saati|turkey time|vienna time|wiener zeit)\b|\b(?:Europe|America|Asia)\/|\+\d{2}:?\d{2}\b|(?:^|\s)-\d{2}:?\d{2}\b|\b20\d{2}-\d{2}-\d{2}T[^\s]*-\d{2}:?\d{2}\b/i.test(clean(value));
const eventWindow = /\b(?:between|von|saat)\s*:?\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s*(?:[–—-]|bis|and|to)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?(?:\s*uhr)?\b/g;
const eventUnsafe = /\b(?:jeden?|jede\w*|every|daily|weekly|monthly|(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)s|(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)s|taglich|taeglich|wochentlich|her\s+(?:gun|hafta)|nicht|not|kein\w*|degil|belki|en az|mindestens|at least|extended|verlanger\w*|verlaenger\w*|uzat\w*|weiterhin|fortgesetzt|continues?|continuing|ongoing|danach|afterwards|tomorrow|morgen|next|dauerhaft|unbefristet|opening hours|opening times|offnungszeiten|oeffnungszeiten|repost\w*|reshare\w*|regram\w*|throwback|last year|letztes jahr|voraussichtlich|eventuell|probably|maybe|planned|geplant|gewinnspiel|giveaway|teilnahmeschluss|einsendeschluss)\b/;
const eventBenefit = /(?:\b(?:gratis|kostenlos|rabatt|gutschein|coupon|ucretsiz)\b|\d\s*(?:€|euro\b|%))/;
const eventWeekdays = { sunday: 0, sonntag: 0, pazar: 0, monday: 1, montag: 1, pazartesi: 1,
  tuesday: 2, dienstag: 2, sali: 2, wednesday: 3, mittwoch: 3, carsamba: 3,
  thursday: 4, donnerstag: 4, persembe: 4, friday: 5, freitag: 5, cuma: 5,
  saturday: 6, samstag: 6, cumartesi: 6 };

// A finite opening window cannot end a price/offer which explicitly continues.
export const hasContinuingOfferTiming = value => /\b(?:devam\s+(?:ed\w*|et\w*)|yarin(?:\s+da)?|(?:etkinlik|acilis)(?:tan|ten)?\s+sonra|surmeye\s+devam|(?:lauft|geht)\s+weiter|auch\s+morgen|(?:remains?|still|also)\s+(?:available|valid|active)|(?:after|beyond)\s+(?:the\s+)?(?:opening\s+)?event)\b/.test(eventFold(value));

function eventClock(hour, minute = '00', meridiem = '') {
  let h = Number(hour);
  if (!/^[0-5]\d$/.test(minute) || (meridiem ? h < 1 || h > 12 : h > 23)) return '';
  if (meridiem) h = h % 12 + (meridiem === 'pm' ? 12 : 0);
  return `${String(h).padStart(2, '0')}:${minute}`;
}

function eventCalendarMentions(value) {
  // A dotted clock inside a recognized range is not a short calendar date.
  const text = eventFold(value).replace(eventWindow, ' '), found = [];
  for (const [, first, last, month, year] of text.matchAll(/\b(\d{1,2})\.?\s*[–—-]\s*(\d{1,2})[./](\d{1,2})(?:[./](\d+))?/g)) {
    for (const day of [first, last]) found.push({ year: year || '', month: month.padStart(2, '0'), day: day.padStart(2, '0') });
  }
  for (const [, year, month, day] of text.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) found.push({ year, month, day });
  for (const [, day, month, year] of text.matchAll(/\b(\d{1,2})[./](\d{1,2})(?:[./](\d+))?(?!\d)/g)) {
    found.push({ year: year || '', month: month.padStart(2, '0'), day: day.padStart(2, '0') });
  }
  const names = Object.keys(eventMonths).join('|');
  for (const [, day, month, year] of text.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th|\\.)?\\s+(${names})\\b(?:\\s+(\\d+)(?![:\\d]))?`, 'g'))) {
    found.push({ year: year || '', month: String(eventMonths[month]).padStart(2, '0'), day: day.padStart(2, '0') });
  }
  for (const [, month, day, year] of text.matchAll(new RegExp(`\\b(${names})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?!\\s*:)(?:,?\\s+(\\d+)(?![:\\d]))?`, 'g'))) {
    found.push({ year: year || '', month: String(eventMonths[month]).padStart(2, '0'), day: day.padStart(2, '0') });
  }
  return found;
}

function normalizedEventClocks(value) {
  return eventFold(value).replace(eventWindow, (raw, h, m, ap, eh, em, eap) =>
    `von ${eventClock(h, m, ap) || 'INVALID'} bis ${eventClock(eh, em, eap) || 'INVALID'}`)
    .replace(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/g, (_, h, m, ap) => eventClock(h, m, ap) || 'INVALID');
}

/**
 * Caller supplies a separately identified original, including its independently
 * corroborated publication clock. This only recognizes an existing stored
 * calendar day and a unique bounded event window. A legacy end-of-day value may
 * be replaced as removal evidence, never persisted as an invented date patch.
 */
export function assessOriginalEventClockEnd(deal, sourceText, { publishedAt, contextTexts = [] } = {}) {
  const text = clean(sourceText), normalized = eventFold(text);
  const end = deal?.validOn || deal?.validUntil;
  if (!text || text.length > 16000 || !/^20\d{2}-\d{2}-\d{2}$/.test(end || '')
    || !['single', 'end', 'range'].includes(deal.expiryKind)
    || [deal.validFrom, deal.validOn, deal.validUntil].some(day => day && day !== end)
    || !Number.isFinite(Date.parse(publishedAt))
    || !eventBenefit.test(normalized)) return null;
  const publishedDay = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna', dateStyle: 'short' }).format(new Date(publishedAt));
  const daysAhead = (Date.parse(end) - Date.parse(publishedDay)) / 86400000;
  if (daysAhead < 0 || daysAhead > 14) return null;
  const dates = eventCalendarMentions(text);
  const contexts = [text, ...contextTexts].filter(Boolean);
  const agrees = ({ year, month, day }) => `${month}-${day}` === end.slice(5) && (!year || year === end.slice(0, 4));
  const weekday = new Date(`${end}T12:00:00Z`).getUTCDay();
  const weekdays = new RegExp(`\\b(?:${Object.keys(eventWeekdays).join('|')})\\b`, 'g');
  if (!dates.length || dates.some(date => !agrees(date))
    || contexts.some(value => typeof value !== 'string' || explicitClockZone(value) || eventUnsafe.test(eventFold(value)) || hasContinuingOfferTiming(value)
      || [...eventFold(value).matchAll(weekdays)].some(([name]) => eventWeekdays[name] !== weekday)
      || /\b(?:bis|until|at|saat)\s+[a-z]+\s*(?:am|pm|uhr)\b/.test(eventFold(value))
      || eventCalendarMentions(value).some(date => !agrees(date)))) return null;
  const windows = [...normalized.matchAll(eventWindow)];
  if (!windows.length) return null;
  const clocks = windows.map(([, h, m, ap, eh, em, eap]) => {
    if (Boolean(ap) !== Boolean(eap)) return null;
    const start = eventClock(h, m, ap), end = eventClock(eh, em, eap);
    return start && end && start < end ? { start, end } : null;
  });
  if (clocks.some(clock => !clock) || new Set(clocks.map(clock => `${clock.start}-${clock.end}`)).size !== 1) return null;
  // The time must govern this offer or its explicitly advertised opening event.
  // An unrelated training/renovation window beside a price is insufficient.
  if (windows.every(match => {
    const before = normalized.slice(0, match.index).split(/[!?;]|\.(?=\s)/).at(-1);
    const after = normalized.slice(match.index + match[0].length).split(/[!?;]|\.(?=\s)/)[0];
    return !eventBenefit.test(`${before} ${after}`)
      && !(/\b(?:eroffnung\w*|eroeffnung\w*|grand opening|acilis\w*)\b/.test(before)
        && eventBenefit.test(normalized.slice(match.index, match.index + match[0].length + 400)));
  })) return null;
  const [{ start, end: finish }] = clocks;
  const [year, month, day] = end.split('-');
  const quote = `${day}.${month}.${year}, ${start} bis ${day}.${month}.${year}, ${finish} Uhr`;
  const period = parseExplicitOfferPeriod(quote);
  if (!period?.expires || ![Date.parse(period.expires), Date.parse(`${end}T23:59:59.999Z`)].includes(Date.parse(deal.expires))
    || hasConflictingOfferClock(quote, contexts.map(normalizedEventClocks))) return null;
  return { quote, ...period, sourceText: text, originalPostPublishedAt: new Date(publishedAt).toISOString() };
}

const reviewedTimingUnsafe = value => {
  const text = eventFold(value).replace(/\bzu jedem\s+(?!(?:tag|wochentag|werktag|wochenende|monat|jahr)\b)/g, 'zu ');
  return explicitClockZone(value) || hasContinuingOfferTiming(value)
    || eventUnsafe.test(text.replace(/\b(?:nicht|not|kein\w*)\b/g, ''))
    || /\b(?:nicht|not|no|kein\w*)\s+(?:(?:nur|only|mehr)\s+)?(?:am|on|bis|until|gultig|gueltig|valid|angebot|aktion|offer|deal|campaign|promotion|ending)\b/.test(text);
};
const allEventClocks = value => normalizedEventClocks(value)
  .replace(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/g, (_, h, m, ap) => eventClock(h, m, ap) || 'INVALID');
const exactEventDay = (day, month, year) => {
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const stamp = Date.parse(`${date}T12:00:00Z`);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === date ? date : '';
};
const nearOriginalPublication = (start, end, publishedAt) => {
  if (!Number.isFinite(Date.parse(publishedAt))) return false;
  const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna', dateStyle: 'short' }).format(new Date(publishedAt));
  return start >= day && (Date.parse(end) - Date.parse(day)) / 86400000 <= 14;
};

/** Reviewed receipt only: two explicitly dated consecutive event days, one shared window. */
export function assessReviewedTwoDayEventEnd(deal, sourceText, { publishedAt, contextTexts = [] } = {}) {
  const text = eventFold(sourceText), start = deal.validFrom, end = deal.validUntil;
  if (deal.expiryKind !== 'range' || deal.validOn || !start || !end
    || Date.parse(end) - Date.parse(start) !== 86400000 || !nearOriginalPublication(start, end, publishedAt)
    || !/\b(?:free|gratis|kostenlos)\b/.test(text)) return null;
  const names = Object.keys(eventMonths).join('|'), weekdays = Object.keys(eventWeekdays).join('|');
  const pair = new RegExp(`\\b(${weekdays}),?\\s+(${names})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*&\\s*(${weekdays}),?\\s+(${names})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'g');
  const dates = [...text.matchAll(pair)];
  if (dates.length !== 1) return null;
  const [, firstWeekday, firstMonth, firstDay, lastWeekday, lastMonth, lastDay] = dates[0];
  if (exactEventDay(firstDay, eventMonths[firstMonth], start.slice(0, 4)) !== start
    || exactEventDay(lastDay, eventMonths[lastMonth], end.slice(0, 4)) !== end
    || eventWeekdays[firstWeekday] !== new Date(`${start}T12:00:00Z`).getUTCDay()
    || eventWeekdays[lastWeekday] !== new Date(`${end}T12:00:00Z`).getUTCDay()) return null;
  const window = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*[–—-]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/g;
  const windows = [...text.matchAll(window)];
  if (windows.length !== 1 || windows[0].index < dates[0].index + dates[0][0].length
    || windows[0].index - dates[0].index - dates[0][0].length > 20) return null;
  const [, h, m, ap, eh, em, eap] = windows[0], from = eventClock(h, m, ap), until = eventClock(eh, em, eap);
  if (!from || !until || from >= until) return null;
  const calendar = day => `${day.slice(8)}.${day.slice(5, 7)}.${day.slice(0, 4)}`;
  const quote = `${calendar(start)}, ${from} bis ${calendar(end)}, ${until} Uhr`;
  const period = parseExplicitOfferPeriod(quote), context = [sourceText, ...contextTexts].filter(Boolean);
  if (!period?.expires || Date.parse(period.expires) !== Date.parse(deal.expires)
    || context.some(value => typeof value !== 'string' || reviewedTimingUnsafe(value)
      || eventCalendarMentions(value).some(({ year, month, day }) => ![start, end].some(bound =>
        bound.slice(5) === `${month}-${day}` && (!year || year === bound.slice(0, 4)))))
    || hasConflictingOfferClock(quote, context.map(allEventClocks))) return null;
  return { quote, ...period, sourceText: clean(sourceText), proofKind: 'two-day-event' };
}

/** Reviewed receipt only: an explicit full-year finite German daily campaign. */
export function assessReviewedDailyCampaignEnd(deal, sourceText, { publishedAt, contextTexts = [] } = {}) {
  const text = eventFold(sourceText), start = deal.validFrom, end = deal.validUntil;
  if (deal.expiryKind !== 'range' || deal.validOn || !start || !end || start >= end
    || Date.parse(end) - Date.parse(start) > 7 * 86400000 || !nearOriginalPublication(start, end, publishedAt)) return null;
  const weekday = 'montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag';
  const pattern = new RegExp(`\\bvon\\s+(${weekday}),?\\s+(\\d{1,2})\\.(\\d{1,2})\\.(?:(20\\d{2}))?\\s+bis\\s+(${weekday}),?\\s+(\\d{1,2})\\.(\\d{1,2})\\.(20\\d{2}),?\\s+taglich\\s+von\\s+(\\d{1,2})(?::(\\d{2}))?\\s+bis\\s+(\\d{1,2})(?::(\\d{2}))?\\s*uhr\\b`, 'g');
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== 1 || !eventBenefit.test(text)) return null;
  const [literal, sw, sd, sm, sy, ew, ed, em, ey, sh, smin, eh, emin] = matches[0];
  if (exactEventDay(sd, sm, sy || ey) !== start || exactEventDay(ed, em, ey) !== end
    || eventWeekdays[sw] !== new Date(`${start}T12:00:00Z`).getUTCDay()
    || eventWeekdays[ew] !== new Date(`${end}T12:00:00Z`).getUTCDay()) return null;
  const from = eventClock(sh, smin), until = eventClock(eh, emin);
  if (!from || !until || from >= until) return null;
  const quote = `${sd}.${sm}.${sy || ey}, ${from} bis ${ed}.${em}.${ey}, ${until} Uhr`;
  const period = parseExplicitOfferPeriod(quote), context = [sourceText, ...contextTexts].filter(Boolean);
  if (!period?.expires || Date.parse(period.expires) !== Date.parse(deal.expires)
    || context.some(value => reviewedTimingUnsafe(eventFold(value).replace(/\btaglich\b/g, ''))
      || eventCalendarMentions(value).some(({ year, month, day }) => ![start, end].some(bound =>
        bound.slice(5) === `${month}-${day}` && (!year || year === bound.slice(0, 4)))))
    || hasConflictingOfferClock(quote, context.map(allEventClocks))) return null;
  return { quote, ...period, sourceText: clean(sourceText), literal, proofKind: 'daily-campaign' };
}

/** Reviewed receipt only: "one day only" and a full-year date with one clock range. */
export function assessReviewedOneDayWindowEnd(deal, sourceText, options = {}) {
  if (!/\bnur einen tag lang\b/.test(eventFold(sourceText))) return null;
  const normalize = value => clean(value)
    // "Jede Pizzaschnitte" is a product condition. Scheduling words stay intact.
    .replace(/\bjede[nmrs]?\s+(?!(?:Tag|Woche|Monat|Jahr|Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag)\b)/giu, '')
    .replace(/\b(\d{1,2}:\d{2})\s*[–—-]\s*(\d{1,2}:\d{2})\s*Uhr\b/giu, 'von $1 bis $2 Uhr');
  const result = assessOriginalEventClockEnd(deal, normalize(sourceText), {
    ...options, contextTexts: (options.contextTexts || []).map(normalize),
  });
  return result && { ...result, sourceText: clean(sourceText), proofKind: 'one-day-window' };
}

/** Reviewed receipt only: a literal dated "all day" action, near its original post. */
export function assessReviewedWholeDayEnd(deal, sourceText, { publishedAt, contextTexts = [] } = {}) {
  const end = deal.validOn || deal.validUntil;
  if (!['single', 'end'].includes(deal.expiryKind) || !end
    || [deal.validFrom, deal.validOn, deal.validUntil].some(day => day && day !== end)
    || !nearOriginalPublication(end, end, publishedAt)
    || !/(?:\bgratis\b|\bkostenlos\b|\b\d\s*\+\s*\d\b)/.test(eventFold(sourceText))) return null;
  const matches = [...clean(sourceText).matchAll(/\b(\d{1,2})\.(\d{1,2})(?:\.(20\d{2}))?,?\s*den ganzen Tag\b/gi)];
  if (matches.length !== 1) return null;
  const [quote, day, month, year] = matches[0];
  if (exactEventDay(day, month, year || end.slice(0, 4)) !== end) return null;
  const lastMinute = viennaInstant(end, '23:59');
  if (!lastMinute || Date.parse(deal.expires) !== Date.parse(lastMinute) + 59999) return null;
  if ([sourceText, ...contextTexts].filter(Boolean).some(value => reviewedTimingUnsafe(value)
    || /\b\d{1,2}:\d{2}\b|\b\d{1,2}\s*uhr\b/.test(eventFold(value))
    || eventCalendarMentions(value).some(date => `${date.month}-${date.day}` !== end.slice(5)
      || date.year && date.year !== end.slice(0, 4)))) return null;
  return { quote, kind: 'single', validFrom: end, validOn: end, validUntil: end,
    expires: new Date(deal.expires).toISOString(), sourceText: clean(sourceText), proofKind: 'whole-day' };
}

/** Caller first validates the private image receipt, original page and image hashes. */
export function assessReviewedOriginalMediaEventEnd(deal, sourceText, media, { publishedAt, contextTexts = [] } = {}) {
  const day = deal.validOn || deal.validUntil;
  if (media?.kind !== 'reviewed-original-post-image' || media.reviewMethod !== 'visual-original-image'
    || !['single', 'end'].includes(deal.expiryKind) || !day
    || [deal.validFrom, deal.validOn, deal.validUntil].some(value => value && value !== day)
    || !nearOriginalPublication(day, day, publishedAt) || !/\bfree tasting\b/.test(eventFold(sourceText))) return null;
  const match = clean(media.ocrText).match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{2}:\d{2})\s*[–—-]\s*(\d{2}:\d{2})\s+MAISONNAYA$/i);
  if (!match) return null;
  const [, weekday, d, monthName, from, until] = match;
  const month = eventMonths[monthName.toLowerCase()];
  const weekdayNumber = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }[weekday.toLowerCase()];
  if (exactEventDay(d, month, day.slice(0, 4)) !== day || from >= until
    || weekdayNumber !== new Date(`${day}T12:00:00Z`).getUTCDay()) return null;
  const quote = `${d}.${month}.${day.slice(0, 4)}, ${from} bis ${d}.${month}.${day.slice(0, 4)}, ${until} Uhr`;
  const period = parseExplicitOfferPeriod(quote);
  const context = [sourceText, media.ocrText, deal.metaGraphOcrText, ...contextTexts].filter(Boolean);
  if (!period?.expires || Date.parse(period.expires) !== Date.parse(deal.expires)
    || context.some(value => reviewedTimingUnsafe(value) || eventCalendarMentions(value).some(date =>
      `${date.month}-${date.day}` !== day.slice(5) || date.year && date.year !== day.slice(0, 4)))
    || hasConflictingOfferClock(quote, context.map(allEventClocks))) return null;
  return { quote, ...period, sourceText: clean(sourceText), proofKind: 'original-media-window' };
}

/** Reviewed receipt only: a full-year action header plus a literal first-N limit. */
export function assessReviewedSingleActionDayEnd(deal, sourceText, { publishedAt, contextTexts = [] } = {}) {
  const text = eventFold(sourceText), day = deal.validOn;
  if (deal.expiryKind !== 'single' || !day || [deal.validFrom, deal.validUntil].some(value => value && value !== day)
    || !nearOriginalPublication(day, day, publishedAt)) return null;
  const header = /\b\d+(?:[.,]\d+)?\s*(?:€|euro)\s+([a-z][a-z -]{1,35}?)\s+aktion\s*:\s*(\d{1,2})\.(\d{1,2})\.(20\d{2})\s+ab\s+(\d{1,2})(?::(\d{2}))?\s*uhr\b/g;
  const headers = [...text.matchAll(header)], limits = [...text.matchAll(/\bdie aktion gilt nur fur die ersten (\d{1,5}) gaste\b/g)];
  if (headers.length !== 1 || limits.length !== 1 || Number(limits[0][1]) < 1) return null;
  const [quote, product, d, m, y, h, minute] = headers[0];
  const clock = eventClock(h, minute);
  if (!clock || exactEventDay(d, m, y) !== day
    || !eventFold(deal.title).includes(product.trim()) || !eventFold(deal.description).includes(product.trim())) return null;
  const until = viennaInstant(day, '23:59');
  if (!until || Date.parse(deal.expires) !== Date.parse(until) + 59999) return null;
  let badOpening = false;
  const removeSeparateOpening = value => eventFold(value).replace(/\bunser(?:e[rns]?)? neu(?:er|e|es) [^.!?;]{1,150}? eroffnet am [^!?;]{1,55}?[!?]/g, opening => {
    const dates = eventCalendarMentions(opening);
    if (!opening.includes(eventFold(deal.brand)) || dates.length !== 1
      || Date.parse(exactEventDay(dates[0].day, dates[0].month, dates[0].year || day.slice(0, 4))) !== Date.parse(day) - 86400000) badOpening = true;
    return ' ';
  });
  const context = [sourceText, ...contextTexts].filter(Boolean).map(removeSeparateOpening);
  const canonical = `${d}.${m}.${y}, ${clock} bis ${d}.${m}.${y}, 23:59 Uhr`;
  if (badOpening || context.some(value => reviewedTimingUnsafe(value)
    || eventCalendarMentions(value).some(date => `${date.month}-${date.day}` !== day.slice(5) || date.year && date.year !== y))
    || hasConflictingOfferClock(canonical, context.map(allEventClocks))) return null;
  const literalHeader = [...String(sourceText).matchAll(new RegExp(header.source, 'gi'))][0]?.[0];
  if (!literalHeader) return null;
  return { quote: literalHeader, kind: 'single',
    validFrom: day, validUntil: day, validOn: day, expires: new Date(deal.expires).toISOString(), sourceText: clean(sourceText), proofKind: 'single-action-day' };
}

/**
 * The caller must supply an independently validated original source paragraph.
 * This parser deliberately never falls back to the deal's edited description.
 * A unique, literal full-year offer window corroborates an already stored end;
 * it cannot supply a missing end, infer a year or extend an offer.
 */
export function assessEmbeddedClockRangeEnd(deal, sourceText) {
  const text = clean(sourceText);
  if (!text || text.length > 16000 || !deal || deal.expiryKind !== 'single'
    || !Number.isFinite(Date.parse(deal.expires)) || !(deal.validOn || deal.validUntil)
    || uncertain.test(fold(text))) return null;

  const matches = [
    ...text.matchAll(embeddedRange),
    ...text.matchAll(canonicalRange),
  ];
  if (matches.length !== 1) return null;
  const match = matches[0];
  const sameDay = match.length === 4;
  const [, firstDay, startClock] = match;
  const lastDay = sameDay ? firstDay : match[3];
  const endClock = sameDay ? match[3] : match[4];
  if (firstDay !== lastDay) return null;

  const quote = match[0].trim();
  const remaining = text.slice(0, match.index) + ' ' + text.slice(match.index + match[0].length);
  if (extraTiming.test(fold(remaining))) return null;
  const prefix = text.slice(0, match.index).split(/[.!?;]/).at(-1);
  const suffix = text.slice(match.index + match[0].length).split(/[.!?;]/)[0];
  const clause = fold(`${prefix} ${suffix}`);
  // The window must govern a benefit, or the opening/offer event advertising
  // that benefit. Mere shop hours beside an otherwise unrelated price fail.
  if (!benefit.test(clause) && !(event.test(clause) && benefit.test(text.slice(match.index, match.index + match[0].length + 700)))) return null;

  const period = parseExplicitOfferPeriod(`${firstDay}, ${fullClock(startClock)} bis ${lastDay}, ${fullClock(endClock)} Uhr`);
  if (!period?.expires || period.kind !== 'single'
    || Date.parse(period.expires) !== Date.parse(deal.expires)
    || !(Date.parse(viennaInstant(period.validFrom, fullClock(startClock))) < Date.parse(period.expires))) return null;
  for (const field of ['validFrom', 'validUntil', 'validOn']) {
    if (deal[field] && deal[field] !== period[field]) return null;
  }
  return { quote, ...period };
}

function clockTokens(value) {
  const text = fold(value);
  const result = [];
  let malformed = false;
  const append = (hour, minute = '00', role = '') => {
    if (!/^(?:[01]?\d|2[0-3])$/.test(hour) || !/^[0-5]\d$/.test(minute)) { malformed = true; return; }
    result.push({ time: `${hour.padStart(2, '0')}:${minute}`, role });
  };
  for (const match of text.matchAll(/\b(\d{1,2}):(\d{1,2})(?!\d)/g)) append(match[1], match[2]);
  for (const match of text.matchAll(/\b(\d{1,2})(?:[.:](\d{1,2}))?\s*uhr\b/g)) append(match[1], match[2]);
  // Captions also use whole hours without the suffix: "endet um 20".
  // A number beginning a calendar date or a price is not a clock token.
  const markers = /\b(endet\s+um|ends?\s+at|bis|until|von|from|ab|um|at)\s+(\d{1,2})(?:[:.](\d{1,2}))?(?!\d)/g;
  for (const match of text.matchAll(markers)) {
    const tail = text.slice(match.index + match[0].length);
    if (/^\s*(?:€|eur(?:o)?\b|%)/.test(tail)
      || /^\.20\d{2}\b/.test(tail)
      || /^\.?\s+(?:januar|janner|jaenner|februar|marz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\b/.test(tail)) continue;
    if (match[0].includes('.') && !/^\s*uhr\b/.test(tail)) continue;
    append(match[2], match[3], /^(?:endet|ends?|bis|until)/.test(match[1]) ? 'end'
      : /^(?:von|from|ab)$/.test(match[1]) ? 'start' : '');
  }
  if (/\b(?:um|bis|von|ab|at|until|from)\s+[a-z]+\s*uhr\b/.test(text)
    || /\b(?:endet\s+um|ends?\s+at)\s+(?!\d)[a-z]+\b/.test(text)) malformed = true;
  return { result, malformed };
}

function calendarTokens(value) {
  const text = fold(value), result = [];
  for (const [, year, month, day] of text.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) result.push({ year, month, day });
  for (const match of text.matchAll(/\b(\d{1,2})[./](\d{1,2})(?:[./](20\d{2}))?(?!\d)/g)) {
    if (/^\s*uhr\b/.test(text.slice(match.index + match[0].length))) continue;
    result.push({ year: match[3] || '', month: match[2].padStart(2, '0'), day: match[1].padStart(2, '0') });
  }
  const months = { januar: 1, janner: 1, jaenner: 1, februar: 2, marz: 3, maerz: 3, april: 4,
    mai: 5, juni: 6, juli: 7, august: 8, september: 9, oktober: 10, november: 11, dezember: 12 };
  const named = new RegExp(`\\b(\\d{1,2})\\.?\\s+(${Object.keys(months).join('|')})\\b(?:\\s+(20\\d{2}))?`, 'g');
  for (const [, day, month, year] of text.matchAll(named)) {
    result.push({ year: year || '', month: String(months[month]).padStart(2, '0'), day: day.padStart(2, '0') });
  }
  return result;
}

/** Additional original/OCR/editorial fragments cannot contradict a proven window. */
export function hasConflictingOfferClock(confirmedQuote, contextTexts) {
  const confirmed = clockTokens(confirmedQuote);
  if (confirmed.malformed || confirmed.result.length < 2 || explicitClockZone(confirmedQuote) || !Array.isArray(contextTexts)) return true;
  const allowed = new Set(confirmed.result.map(row => row.time));
  const start = confirmed.result[0].time;
  // The explicit times occur before marker-derived duplicates in clockTokens.
  const quoted = clean(confirmedQuote);
  const direct = [...quoted.matchAll(/\b(\d{1,2}):(\d{2})(?!\d)/g)];
  const end = direct.length >= 2 ? `${direct.at(-1)[1].padStart(2, '0')}:${direct.at(-1)[2]}`
    : confirmed.result.findLast(row => row.role === 'end')?.time;
  if (!end) return true;
  const days = calendarTokens(confirmedQuote);
  if (!days.length) return true;
  for (const value of contextTexts) {
    if (value === undefined || value === null || value === '') continue;
    if (typeof value !== 'string' || explicitClockZone(value)) return true;
    const tokens = clockTokens(value);
    if (tokens.malformed || tokens.result.some(row => !allowed.has(row.time)
      || row.role === 'end' && row.time !== end || row.role === 'start' && row.time !== start)) return true;
    if (calendarTokens(value).some(other => !days.some(day => other.month === day.month && other.day === day.day
      && (!other.year || other.year === day.year)))) return true;
  }
  return false;
}

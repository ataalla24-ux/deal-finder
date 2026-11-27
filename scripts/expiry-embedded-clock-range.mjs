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
      || /^\s+(?:januar|janner|jaenner|februar|marz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\b/.test(tail)) continue;
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
  if (confirmed.malformed || confirmed.result.length < 2 || !Array.isArray(contextTexts)) return true;
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
    if (typeof value !== 'string') return true;
    const tokens = clockTokens(value);
    if (tokens.malformed || tokens.result.some(row => !allowed.has(row.time)
      || row.role === 'end' && row.time !== end || row.role === 'start' && row.time !== start)) return true;
    if (calendarTokens(value).some(other => !days.some(day => other.month === day.month && other.day === day.day
      && (!other.year || other.year === day.year)))) return true;
  }
  return false;
}

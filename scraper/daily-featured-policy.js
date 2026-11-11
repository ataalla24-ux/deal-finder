import { discoveryRejection, foodDiscoveryPriority } from './deal-discovery-policy.js';

const text = value => String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss').toLowerCase();
const clock = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit',
  day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const weekdays = ['so|sonntag', 'mo|montag', 'di|dienstag', 'mi|mittwoch', 'do|donnerstag', 'fr|freitag', 'sa|samstag'];
const weekdayIndex = word => weekdays.findIndex(day => day.split('|').includes(word));
const dayNames = weekdays.join('|');
const weekdayRange = new RegExp(`\\b(${dayNames})(?:s)?\\.?\\s*(?:[-\u2013\u2014]|bis)\\s*(${dayNames})(?:s)?\\b`, 'g');
const weekdayWord = /\b(sonntag|montag|dienstag|mittwoch|donnerstag|freitag|samstag)s?\b/g;
const time = '(\\d{1,2})(?:[:.](\\d{2}))?';
const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
const boundedPeriods = new Set(['end', 'range', 'single', 'single_date', 'date', 'fixed']);
const cents = value => Math.round(Number(value.replace(',', '.')) * 100);
const money = '(\\d{1,4}(?:[,.]\\d{1,2})?)\\s*(?:\u20ac|eur\\b)';
const privateOffer = /\b(?:personalisier\w*|personlich\w*|privat\w*|personalised|personalized|invite.only|nur fur ausgewahlte (?:konten|kunden|nutzer))\b/;

function viennaTime(now) {
  const p = Object.fromEntries(clock.formatToParts(now).map(part => [part.type, part.value]));
  const day = `${p.year}-${p.month}-${p.day}`;
  return { day, weekday: new Date(`${day}T12:00:00Z`).getUTCDay(), minute: Number(p.hour) * 60 + Number(p.minute) };
}

export function dailyAvailabilityReason(deal, now, { verified = false } = {}) {
  if (deal.hidden || ['expired', 'invalid', 'removed'].includes(deal.status) || ['expired', 'invalid'].includes(deal.validity?.status)) return 'removed_or_expired';
  const { day, weekday, minute } = viennaTime(now);
  const starts = [deal.validFrom, deal.validOn, deal.validity?.startDate].filter(Boolean);
  const ends = [deal.validUntil, deal.validOn, deal.expires, deal.validity?.expiryDate].filter(Boolean);
  const calendarDay = value => {
    if (!dayPattern.test(value) || !Number.isFinite(Date.parse(value))) return false;
    return new Date(value).toISOString().slice(0, 10) === value;
  };
  if (starts.some(value => calendarDay(value) ? value > day : Date.parse(value) > +now)) return 'not_started';
  if (ends.some(value => calendarDay(value) ? value < day : Date.parse(value) <= +now)) return 'expired';
  if (verified && (deal.dateConfidence !== 'high' || !boundedPeriods.has(deal.expiryKind) || ![deal.validUntil, deal.validOn].some(calendarDay)
    || [...starts, ...ends].some(value => !calendarDay(value) && (dayPattern.test(value) || !Number.isFinite(Date.parse(value)))))) return 'unverified_dates';
  if (verified && deal.validOn && [deal.validFrom, deal.validUntil].some(value => value && value !== deal.validOn)) return 'conflicting_dates';
  const terms = text([deal.title, deal.description, deal.expiryDisplayText].filter(Boolean).join(' '));
  if (/\b(?:heute|today)\b/.test(terms) && /\b(?:nur heute|only today)\b/.test(terms)
    && deal.validOn !== day && !(deal.validFrom === day && deal.validUntil === day)) return 'unverified_today_only';
  if (verified && /(?:nicht bestatigt|nicht verifizierbar|nicht mehr einlosbar|bereits abgelaufen|vollstandig ausverkauft|bereits ausverkauft)/.test(terms)) return 'unverified_availability';

  const rangeDays = [...terms.matchAll(weekdayRange)].map(([, start, end]) => {
    const first = weekdayIndex(start), last = weekdayIndex(end);
    return (weekday - first + 7) % 7 <= (last - first + 7) % 7;
  });
  const singleDays = [...terms.replace(weekdayRange, ' ').matchAll(weekdayWord)].map(([, name]) => weekdayIndex(name));
  if ((rangeDays.length && !rangeDays.every(Boolean)) || (singleDays.length && !singleDays.includes(weekday))
    || (/\bwerktags\b/.test(terms) && [0, 6].includes(weekday))
    || (/\b(?:am wochenende|samstags? und sonntags?)\b/.test(terms) && ![0, 6].includes(weekday))) return 'wrong_weekday';
  if (/\b(?:ausser|nicht (?:am|an)|ausgenommen)\s+(?:sonntag|montag|dienstag|mittwoch|donnerstag|freitag|samstag|feiertag)/.test(terms)) return 'unclear_schedule';
  const lastTimes = [...terms.matchAll(new RegExp(`(?:\\b(?:bis(?: spatestens)?|vor)|[-\u2013\u2014])\\s*(?:${time}\\s*uhr\\b|(\\d{1,2}):([0-5]\\d)\\b)`, 'g'))]
    .map(([, hour, min, clockHour, clockMin]) => [Number(hour ?? clockHour), Number(min ?? clockMin ?? 0)])
    .filter(([hour, min]) => hour <= 24 && min < 60 && (hour < 24 || min === 0))
    .map(([hour, min]) => hour * 60 + min);
  if (lastTimes.some(end => end <= minute)) return 'ended_today';
  if (verified && /\bhappy hour\b/.test(terms) && !lastTimes.length) return 'unclear_schedule';
  return '';
}

export function dailyFeaturedValue(deal) {
  const title = text(deal.title);
  const terms = [title, text(deal.description)].join(' ');
  if (!deal.id || !title || deal.campaignId || deal.isBusinessAdvertisement || deal.pipelineLifecycle?.manualDecision === 'rejected'
    || privateOffer.test(terms) || discoveryRejection(deal) || !foodDiscoveryPriority(deal)) return 0;

  const threshold = terms.match(new RegExp(`\\b(?:ab|mindestbestellwert(?: von)?)\\s*${money}`));
  const minimum = threshold ? cents(threshold[1]) : 0;
  const pricePair = title.match(new RegExp(`${money}\\s+statt\\s+${money}`))
    || terms.match(new RegExp(`${money}\\s+statt\\s+${money}`));
  const euroOff = terms.match(new RegExp(`${money}\\s+(?:rabatt|gunstiger|ersparnis)\\b`));
  const pair = title.match(/\b([123])\s*\+\s*1\b|\b([234])\s+(?:\w+\s+){0,4}zum preis von\s+([123])\b/);
  const guaranteedPercent = title.match(/\b(100|\d{1,2})(?:\s*[-\u2013\u2014]\s*(?:100|\d{1,2}))?\s*%\s*(?:rabatt|auf|gunstiger|weniger|ersparnis|sparen)\b/);
  const percentIsCeiling = /\b(?:bis zu|maximal|up to)\b/.test(title);
  let value = 0;
  if (pricePair && cents(pricePair[2]) > cents(pricePair[1])) {
    const savings = cents(pricePair[2]) - cents(pricePair[1]);
    value = 100 * savings / cents(pricePair[2]) + Math.min(24, savings / 50);
  } else if (pair && (!pair[3] || Number(pair[2]) === Number(pair[3]) + 1)) {
    value = 100 / (pair[1] ? Number(pair[1]) + 1 : Number(pair[2])) + 8;
    if (/gunstigere\w*|cheaper/.test(terms)) value -= 8;
  } else if (euroOff) {
    const savings = cents(euroOff[1]);
    if (minimum > 0 && savings > minimum) return 0;
    value = (minimum > 0 ? Math.min(70, 100 * savings / minimum) : 24) + Math.min(24, savings / 50);
  } else if (guaranteedPercent && !percentIsCeiling) {
    value = Number(guaranteedPercent[1]);
  } else if (percentIsCeiling && guaranteedPercent) {
    value = 10;
  } else if (/\b(?:gratis|kostenlos|free)\b/.test(title)) {
    value = minimum > 0 || /\b(?:beim kauf|zu jeder|als zugabe|zu einer bestellung|zum hauptgericht)\b/.test(terms) ? 28
      : /\b(?:kaffee|latte|espresso|cappuccino|tee|getrank|getraenk)\b/.test(title) ? 57 : 82;
  }
  if (/\b(?:neukund\w*|erstbestell\w*|erste\w* bestellung)\b/.test(terms)) value -= 14;
  if (/\b(?:mitglied\w*|vorteilsclub|jo app|mit jo|bonuspunkt\w*|magenta.kund\w*|drei.kund\w*)\b/.test(terms)) value -= 9;
  if (/\b(?:app.coupon\w*|nur in der app|nur in .*app|uber foodora|uber wolt|uber lieferando)\b/.test(terms)) value -= 4;
  if (/\b(?:erst nach|am selben tag.*einkauf|einkauf ab)\b/.test(terms)) value -= 10;
  return Math.max(0, Math.round((value - Math.min(12, minimum / 250)) * 100) / 100);
}

export function rankDailyFeaturedDeals(deals, now, { recentDealIds = new Set(), currentId = '' } = {}) {
  return deals.flatMap(deal => {
    if (dailyAvailabilityReason(deal, now, { verified: true })) return [];
    const value = dailyFeaturedValue(deal);
    return value > 0 ? [{ deal, value }] : [];
  }).sort((a, b) => b.value - a.value
    || Number(b.deal.id === currentId) - Number(a.deal.id === currentId)
    || Number(recentDealIds.has(a.deal.id)) - Number(recentDealIds.has(b.deal.id))
    || a.deal.id.localeCompare(b.deal.id));
}

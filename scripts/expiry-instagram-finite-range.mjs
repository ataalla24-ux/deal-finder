import { canonicalInstagramPostKey, decodeInstagramShortcodeDate } from '../scraper/deal-evidence-utils.js';

const dayMs = 86400000;
const viennaDay = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna', dateStyle: 'short' });
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const fold = value => clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss').toLowerCase();
const originalPostUrl = /^https:\/\/(?:www\.)?instagram\.com\/(?:p|reel|reels|tv)\/[A-Za-z0-9_-]{5,20}\/?(?:\?[^#\s]*)?$/;
const yearSource = /^(?:url\.instagramShortcode|instagram-graph-timestamp)$/;
const monthNames = 'januar janner februar marz april mai juni juli august september oktober november dezember'.split(' ');
const months = [1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const calendarMonths = monthNames.join('|');
const weekday = '(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)';
const weekdays = new RegExp(`\\b(?:jeden\\s+${weekday}\\s+bis\\s+${weekday}|${weekday}s\\s+bis\\s+${weekday}s)\\b`);
const numericDate = '(\\d{1,2})\\.(\\d{1,2})\\.(20\\d{2})?';
const numericRange = new RegExp(`\\b(?:von|vom)\\s+${numericDate}\\s+bis\\s+${numericDate}(?![./\\d])`, 'g');
const continuation = /\b(?:repost\w*|regram\w*|reshare\w*|throwback|ruckblick|rueckblick|archivaufnahme|letztes jahr|last year|geplant|voraussichtlich|eventuell|vermutlich|dauerhaft|unbefristet|geburtstag|birthday|bis auf weiteres|verlanger\w*|verlaenger\w*|extended|weiterhin|danach|fortgesetzt|lauft weiter|geht weiter|auch morgen|nachsten tag|folgenden tag|ab sofort|teilnahmeschluss|einsendeschluss|gewinnspiel|giveaway|offnungszeiten|oeffnungszeiten)\b|#tbt\b|\b(?:nicht|not)\s+(?:mehr\s+)?(?:nur|am|vom|von|bis|gultig|gueltig|valid|only)\b|\bab\s+(?:dem\s+)?\d{1,2}\./;

function exactDay(value) {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(value || '')) return '';
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value ? value : '';
}

function dateWithYear(day, month, year) {
  return exactDay(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
}

function dateMentionsAgree(text, start, end) {
  const matchesPeriod = (day, month, year) => [start, end].some(bound =>
    (!year || bound.slice(0, 4) === year) && bound.slice(5) ===
      `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  const iso = [...text.matchAll(/\b20\d{2}-\d{2}-\d{2}\b/g)];
  const numeric = [...text.matchAll(/\b(\d{1,2})\.(\d{1,2})\.(?:(\d{2,4})(?!\d))?/g)];
  const numericEnds = [...text.matchAll(/\bbis\s+(\d{1,2})\.(\d{1,2})(?!\d)/g)];
  const named = [...text.matchAll(new RegExp(`\\b(\\d{1,2})\\.?\\s+(${calendarMonths})\\b\\.?(?:\\s+(\\d{2,4})(?![:.\\d]))?`, 'g'))];
  const compactRanges = [...text.matchAll(new RegExp(`\\b(?:von|vom)\\s+(\\d{1,2})\\.?\\s+bis\\s+(\\d{1,2})\\.?\\s+(${calendarMonths})\\b`, 'g'))];
  return iso.every(([date]) => date === start || date === end)
    && numeric.every(([, day, month, year]) => matchesPeriod(day, month, year))
    && numericEnds.every(([, day, month]) => dateWithYear(day, month, end.slice(0, 4)) === end)
    && named.every(([, day, month, year]) => matchesPeriod(day, months[monthNames.indexOf(month)], year))
    && compactRanges.every(([, from, to, month]) => {
      const monthNumber = String(months[monthNames.indexOf(month)]).padStart(2, '0');
      return start.slice(5) === `${monthNumber}-${from.padStart(2, '0')}`
        && end.slice(5) === `${monthNumber}-${to.padStart(2, '0')}`;
    });
}

export function assessInstagramFiniteRangeEnd(deal, latest, now = new Date()) {
  const url = deal.evidencePostUrl || deal.url;
  const storedExpired = deal.metaGraphAccepted === false && deal.metaGraphBlockingReason === 'offer-expired';
  if (!originalPostUrl.test(url || '') || (deal.metaGraphBlockingReason && !storedExpired) || deal.validOn
    || !['end', 'range'].includes(deal.expiryKind) || deal.dateConfidence !== 'high') return null;
  const key = canonicalInstagramPostKey(url);
  const decoded = decodeInstagramShortcodeDate(url);
  const original = deal.evidence?.originalPost;
  const refs = [deal.url, original?.url, original?.postUrl, original?.permalink, deal.postVerification?.originalPostUrl]
    .filter(Boolean);
  if (!decoded || +decoded > +now || refs.some(ref => !originalPostUrl.test(ref) || canonicalInstagramPostKey(ref) !== key)) return null;
  if ([deal, deal.evidence, original, latest].some(record => record && (record.isRepost || record.isReshare || record.repost
    || record.reshare || record.repostedFrom || record.resharedFrom || record.isOriginal === false
    || /story|repost|reshare/i.test(record.mediaProductType || '')))) return null;

  const verified = Date.parse(latest ? latest.verifiedAt : deal.metaGraphVerifiedAt);
  const approved = Date.parse(deal.approvedAt);
  if (!Number.isFinite(verified) || verified < +decoded - 60000 || verified > +now
    || !Number.isFinite(approved) || approved < +decoded - 60000 || approved > +now) return null;
  const mediaId = latest?.mediaId || deal.metaGraphMediaId;
  if (!/^\d{10,}$/.test(String(mediaId || ''))) return null;
  if (latest) {
    const sourceReadable = latest.graphAccepted === true && !latest.blockingReason
      || latest.graphAccepted === false && latest.blockingReason === 'offer-expired';
    if (!sourceReadable || !/^\d{10,}$/.test(String(latest.mediaId || ''))
      || !originalPostUrl.test(latest.url || '') || canonicalInstagramPostKey(latest.url) !== key
      || deal.metaGraphMediaId && String(latest.mediaId) !== String(deal.metaGraphMediaId)
      || verified < (Date.parse(deal.metaGraphVerifiedAt) || 0)
      || latest.sourcePublishedAtSource !== 'instagram-graph-timestamp') return null;
  } else {
    // A location-only rejection of the verified caption cannot invalidate the
    // calendar text for an already approved, identified original.
    const locationOnly = deal.metaGraphAccepted === false && deal.metaGraphRejection === 'missing-vienna-evidence'
      && !deal.metaGraphBlockingReason && /^[A-Za-z0-9._]+$/.test(deal.ownerUsername || '') && approved >= verified;
    if (deal.metaGraphVerified !== true || (deal.metaGraphAccepted !== true && !storedExpired && !locationOnly)) return null;
  }

  const publishedDay = viennaDay.format(decoded);
  const recordClock = yearSource.test(deal.sourcePublishedAtSource || '') ? deal.sourcePublishedAt : '';
  const clocks = [recordClock, ...(latest ? [latest.sourcePublishedAt] : [])];
  if (clocks.some(value => {
    const time = new Date(value || '');
    return !Number.isFinite(+time) || +time > +now || Math.abs(+time - +decoded) > 60000 || viennaDay.format(time) !== publishedDay;
  })) return null;
  const discovered = Date.parse(deal.discoveredAt);
  if (Number.isFinite(discovered) && discovered - +decoded > 14 * dayMs) return null;

  const caption = clean(latest ? latest.caption : deal.metaGraphCaption);
  const normalizedCaption = fold(caption);
  const ranges = [...normalizedCaption.matchAll(numericRange)];
  if (ranges.length !== 1) return null;
  const range = ranges[0];
  const offerClause = normalizedCaption.slice(range.index + range[0].length).split(/[.!?;]/, 1)[0];
  if (!weekdays.test(offerClause)) return null;
  const [, fromDay, fromMonth, fromYear, untilDay, untilMonth, untilYear] = range;
  const end = exactDay(deal.validUntil);
  if (!end) return null;
  const endYear = end.slice(0, 4);
  const startYear = fromYear || String(Number(endYear) - Number(Number(fromMonth) > Number(untilMonth)));
  const start = dateWithYear(fromDay, fromMonth, startYear);
  if (!start || start > end || dateWithYear(untilDay, untilMonth, untilYear || endYear) !== end
    || (Date.parse(end) - Date.parse(start)) / dayMs > 31
    || end < publishedDay || (Date.parse(end) - Date.parse(publishedDay)) / dayMs > 14
    || (Date.parse(start) - Date.parse(publishedDay)) / dayMs > 14
    || (deal.validFrom && deal.validFrom !== start)
    || (deal.validity?.expiryDate && clean(deal.validity.expiryDate).slice(0, 10) !== end)) return null;

  const context = [caption, latest?.ocrText || (!latest && deal.metaGraphOcrText), deal.title, deal.description,
    deal.expiryDisplayText, deal.expiresOriginal];
  if (context.some(value => {
    const normalized = fold(value);
    const links = clean(value).match(/https?:\/\/(?:www\.)?instagram\.com\/[^\s<>]+/gi) || [];
    return continuation.test(normalized) || !dateMentionsAgree(normalized, start, end)
      || links.some(link => canonicalInstagramPostKey(link) !== key);
  })) return null;
  return { end, evidence: [caption], originalPostPublishedAt: decoded.toISOString() };
}

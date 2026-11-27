import { decodeInstagramShortcodeDate } from '../scraper/deal-evidence-utils.js';
import { readApprovedExpiryEvidence } from './approved-expiry-evidence.mjs';

const dayMs = 86400000;
const viennaDay = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna', dateStyle: 'short' });
const fold = value => String(value || '').replace(/\s+/g, ' ').trim().normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss').toLowerCase();
const benefit = /\b(?:gratis|kostenlos|rabatt|gutschein|coupon)\b|\d\s*(?:%|€|euro\b)|\b\d\s*\+\s*\d\b/i;
const ambiguous = /\b(?:nicht|kein\w*|not|no|nie|niemals|jeden?|jede\w*|every|immer|taglich|taeglich|wochent\w*|monatlich|jahrlich|jaehrlich|weekly|daily|monthly|annually|recurring|regelmassig|regelmaessig|daueraktion|dauerhaft|unbefristet|verlanger\w*|verlaenger\w*|extended|weiterhin|danach|fortgesetzt|lauft weiter|geht weiter|auch morgen|morgen|tomorrow|nachste\w*|naechste\w*|next|folgenden tag|uber mitternacht|bis|until|through|voraussichtlich|eventuell|vermutlich|geplant|offnungszeiten|oeffnungszeiten|opening hours|gewinnspiel|giveaway|teilnahmeschluss|einsendeschluss|repost\w*|regram\w*|reshare\w*|throwback|archiv\w*|ruckblick|rueckblick|letztes jahr|last year)\b|#tbt\b/;
// This narrow relative-day path leaves other calendar/clock wording to the
// explicit-period parsers; a mixed statement must not turn into a guessed end.
const otherTiming = /\b20\d{2}-\d{2}-\d{2}\b|\b\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?\b|\b\d{1,2}\.?\s+(?:januar|janner|jaenner|februar|marz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\b|\b\d{1,2}:\d{2}\b|\b\d{1,2}\s*uhr\b|\b(?:am|on|vom|von|ab|from)\s+\d{1,2}\b|\bum\s+\d{1,2}\b(?!\s*(?:€|euro\b|%))|\b(?:montags|dienstags|mittwochs|donnerstags|freitags|samstags|sonntags|mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays)\b/;
const weekdays = { montag: 1, monday: 1, dienstag: 2, tuesday: 2, mittwoch: 3, wednesday: 3,
  donnerstag: 4, thursday: 4, freitag: 5, friday: 5, samstag: 6, saturday: 6, sonntag: 0, sunday: 0 };
const weekdayPattern = new RegExp(`\\b(?:${Object.keys(weekdays).join('|')})\\b`, 'g');

function publicationClock(deal) {
  let url;
  try { url = new URL(deal.url); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  if (['instagram.com', 'www.instagram.com'].includes(url.hostname)
    && /^\/(?:p|reel|reels|tv)\/[A-Za-z0-9_-]{5,20}\/?$/.test(url.pathname)
    && ['url.instagramShortcode', 'instagram-graph-timestamp'].includes(deal.sourcePublishedAtSource)) {
    return decodeInstagramShortcodeDate(deal.url);
  }
  if (['tiktok.com', 'www.tiktok.com'].includes(url.hostname)
    && deal.sourcePublishedAtSource === 'url.tiktokVideoId') {
    const id = url.pathname.match(/^\/@[^/]+\/video\/(\d{15,22})\/?$/)?.[1];
    if (id) {
      const stamp = Number(BigInt(id) >> 32n) * 1000;
      const decoded = new Date(stamp);
      if (Number.isFinite(stamp) && decoded >= new Date('2016-01-01T00:00:00Z')) return decoded;
    }
  }
  return null;
}

/** Corroborate an existing single-day end from an approved original's "today". */
export function assessOriginalTodayEnd(deal, { now = new Date() } = {}) {
  const receipt = readApprovedExpiryEvidence(deal, { now });
  const decoded = receipt && publicationClock(deal);
  if (!decoded || !Number.isFinite(+now) || +decoded > +now || deal.expiryKind !== 'single'
    || !/^20\d{2}-\d{2}-\d{2}$/.test(deal.validOn || '')) return null;
  const day = viennaDay.format(decoded);
  if (deal.validOn !== day || deal.validFrom && deal.validFrom !== day || deal.validUntil && deal.validUntil !== day
    || Date.parse(deal.expires) !== Date.parse(`${day}T23:59:59.999Z`)) return null;

  const stored = Date.parse(deal.sourcePublishedAt);
  const approved = Date.parse(deal.approvedAt || deal.pipelineLifecycle?.manualDecisionAt);
  const verified = Date.parse(receipt.verifiedAt);
  if (!Number.isFinite(stored) || Math.abs(stored - +decoded) > 60000
    || viennaDay.format(new Date(stored)) !== day
    || [approved, verified].some(clock => !Number.isFinite(clock) || clock < +decoded
      || clock > +now || clock - +decoded > 14 * dayMs)) return null;

  const original = deal.evidence?.originalPost;
  if ([deal, deal.evidence, original].some(row => row && (row.isRepost || row.isReshare || row.repost
    || row.reshare || row.repostedFrom || row.resharedFrom || row.isOriginal === false
    || /story|repost|reshare/i.test(row.mediaProductType || '')))) return null;

  const source = fold(receipt.sourceText);
  const context = [receipt.sourceText, deal.title, deal.description, deal.metaGraphCaption, deal.metaGraphOcrText];
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  if (!/\b(?:nur heute|only today)\b/.test(source) || !benefit.test(source)
    || context.some(text => ambiguous.test(fold(text)) || otherTiming.test(fold(text))
      || [...fold(text).matchAll(weekdayPattern)].some(([name]) => weekdays[name] !== weekday))) return null;
  return { end: day, evidence: [receipt.sourceText], originalPostPublishedAt: decoded.toISOString() };
}

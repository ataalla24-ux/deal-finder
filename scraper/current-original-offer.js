import { extractActiveOfferWindow } from './instagram-ai-validity-utils.js';

const DAY = 86400000;
const dayKey = date => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna' }).format(date);

// Narrow exception: no model prose, crawler timestamp, OCR alone or review TTL.
export function currentOriginalOffer(deal, now = new Date()) {
  if (deal?.metaGraphVerified !== true || !deal.metaGraphMediaId
    || !/^https:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv)\/[\w-]+\/?(?:\?.*)?$/.test(deal.url || '')
    || deal.sourcePublishedAtSource !== 'instagram-graph-timestamp'
    || deal.sourceAccountType !== 'merchant') return null;
  const published = Date.parse(deal.sourcePublishedAt);
  const verified = Date.parse(deal.metaGraphVerifiedAt);
  if (!Number.isFinite(published) || !Number.isFinite(verified)
    || published > +now || published < +now - 90 * DAY
    || verified < +now - 36 * 3600000 || verified > +now) return null;
  const text = String(deal.metaGraphCaption || '');
  if (/\brepost|throwback|rückblick|rueckblick|vergangen|abgelaufen|beendet|ausverkauft|sold out|nicht mehr gültig|nicht mehr gueltig/i.test(text)
    || deal.isRepost === true || deal.metaGraphIsRepost === true) return null;
  const window = extractActiveOfferWindow(text, { pubDate: new Date(published), now });
  if (!window?.endDate || !/\b20\d{2}\b/.test(window.evidence || '')) return null;
  const end = window.endDate.toISOString().slice(0, 10);
  const start = window.startDate?.toISOString().slice(0, 10) || '';
  const today = dayKey(now);
  if (end < today || start && start > today) return null;
  const recordedEnd = String(deal.validUntil || '').slice(0, 10);
  if (recordedEnd && recordedEnd !== end) return null;
  if (deal.metaGraphBlockingReason && deal.metaGraphBlockingReason !== 'post-too-old') return null;
  return { validUntil: end, matchedText: window.evidence, verifiedAt: deal.metaGraphVerifiedAt,
    sourcePublishedAt: deal.sourcePublishedAt, ageDays: (+now - published) / DAY };
}

export function graphOriginalRecord(item, context, now) {
  return { url: item.permalink, sourcePublishedAt: item.timestamp,
    sourcePublishedAtSource: 'instagram-graph-timestamp', metaGraphVerified: true,
    metaGraphVerifiedAt: now.toISOString(), metaGraphMediaId: String(item.id || ''),
    metaGraphCaption: item.caption || '', metaGraphIsRepost: item.is_repost === true,
    sourceAccountType: context?.account?.accountType || '' };
}

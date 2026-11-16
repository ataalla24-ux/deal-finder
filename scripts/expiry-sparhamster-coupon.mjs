import { load } from 'cheerio';
import { extractTargetPageDateHints, parseExpiryShape, sparhamsterCouponRoundPath } from '../scraper/expiry-utils.js';

const clean = value => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
const brand = /mcdonald['’]?s\b/i;
const item = String.raw`([\p{L}\p{N}][\p{L}\p{N} -]{1,60}?)`;
const amount = String.raw`(\d{1,3}(?:[,.]\d{2})?)`;
const points = String.raw`([1-9]\d{0,3})\s*m['’]?s`;
const feedCoupon = new RegExp(String.raw`^([1-9]\d?)\s+${item}\s+(?:für|um)\s+${amount}\s*€\s*(?:\+|plus)\s*${points}$`, 'iu');
const sourceCoupon = new RegExp(String.raw`^([1-9]\d?)\s*[x×]\s+${item}\s+(?:für|um)\s+${amount}\s*€\s*\(mit\s+${points}\)$`, 'iu');
const couponExtension = /\b(?:verlängert|verlaengert|ersetzt|ausgenommen|abweichend|bis auf weiteres|voraussichtlich|weiterhin (?:gültig|verfügbar))\b|\bnicht\s+(?:abgelaufen|mehr gültig|gültig bis)\b/i;
const dateLabel = String.raw`(?:20\d{2}-\d{2}-\d{2}|\d{1,2}\.\s*\d{1,2}\.?(?:\s*20\d{2})?|\d{1,2}\.\s+\p{L}+(?:\s+20\d{2})?)`;
const endClaim = new RegExp(String.raw`\bbis\s+(?:(?:einschließlich|inklusive|zum)\s+)?(${dateLabel})(?![\p{L}\d.])`, 'giu');

function calendarDay(value) {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(value || '')) return null;
  const stamp = Date.parse(`${value}T12:00:00Z`);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value ? value : null;
}

function couponKey(value, pattern) {
  const match = clean(value).match(pattern);
  if (!match) return null;
  const [, count, name, price, loyaltyPoints] = match;
  if (/\b(?:kein\w*|nicht|statt|minus|ohne)\b/i.test(name)) return null;
  const cents = Math.round(Number(price.replace(',', '.')) * 100);
  if (cents <= 0) return null;
  const product = name.toLocaleLowerCase('de').replace(/^klassiker nach wahl$/, 'klassiker');
  return JSON.stringify([Number(count), product, cents, Number(loyaltyPoints)]);
}

function dealEnd(deal) {
  const end = calendarDay(deal.validUntil);
  if (!end || !['end', 'range'].includes(deal.expiryKind)) return null;
  if (deal.validFrom && (!calendarDay(deal.validFrom) || deal.validFrom > end)) return null;
  if ([deal.validOn, deal.validity?.expiryDate].some(value => value && value !== end)) return null;
  if (deal.expires && (!Number.isFinite(Date.parse(deal.expires)) || String(deal.expires).slice(0, 10) !== end)) return null;
  return end;
}

export function supportsSparhamsterCouponExpiry(deal) {
  if (!deal?.url || sparhamsterCouponRoundPath(deal.url) !== '/mcdonalds-gutscheine-oesterreich') return false;
  const url = new URL(deal.url);
  return !url.search && !url.hash
    && /^mcdonald['’]?s$/i.test(clean(deal.brand))
    && ![deal.sourceUrl, deal.evidencePostUrl, deal.validity?.finalUrl].some(value => value && value !== deal.url)
    && Boolean(dealEnd(deal) && couponKey(deal.title, feedCoupon));
}

const sourceEndClaims = (value, now) => [...value.matchAll(endClaim)].map(([, label]) =>
  /\b20\d{2}\b/.test(label) ? calendarDay(parseExpiryShape(`bis ${label}`, { now }).validUntil) : null);

// The evergreen article URL identifies the source, while the round in its
// current heading and terms must agree with the exact coupon in the feed.
export function assessSparhamsterCouponEnd(deal, response, { now = new Date() } = {}) {
  if (!supportsSparhamsterCouponExpiry(deal)
    || response?.status !== 200 || response.url !== deal.url || !/text\/html/i.test(response.headers?.['content-type'] || '')
    || typeof response.body !== 'string' || !response.body || response.body.length > 2_000_000) return null;
  const $ = load(response.body);
  const canonical = $('link[rel="canonical"]');
  try {
    if (canonical.length !== 1 || new URL(canonical.attr('href'), deal.url).href !== deal.url) return null;
  } catch {
    return null;
  }
  const { couponRound } = extractTargetPageDateHints(response.body, { sourceUrl: deal.url, now });
  const end = dealEnd(deal);
  if (couponRound?.validUntil !== end) return null;
  if (deal.validity?.sourceDateSource === 'url.couponRoundUpdatedAt'
    && Date.parse(deal.validity.sourceDate) !== Date.parse(couponRound.updatedAt)) return null;

  $('script, style, template, [hidden], [inert], [aria-hidden="true"]').remove();
  $('[style]').filter((_, element) => /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\b/i.test($(element).attr('style') || '')).remove();
  const main = $('main');
  const cardWrap = main.find('.sh-deal-detail-card-wrap');
  const heading = cardWrap.find('h1.sh-deal-detail-card__heading');
  const card = cardWrap.find('article.sh-deal-detail-card--top');
  const badge = card.find('.sh-deal-grid-card-badge-tag').filter((_, el) => /^abgelaufen$/i.test(clean($(el).text())));
  const button = card.find('.sh-deal-grid-card-btn--expired-link').filter((_, el) => /^angebot abgelaufen$/i.test(clean($(el).text())));
  if (main.length !== 1 || cardWrap.length !== 1 || heading.length !== 1 || card.length !== 1
    || !card.hasClass('expired') || badge.length !== 1 || button.length !== 1
    || couponExtension.test(clean(card.text()))) return null;

  const content = cardWrap.next('.sh-deal-detail-text-wrap').find('.sh-deal-detail-text__inner');
  if (content.length !== 1) return null;
  // The bonus-club and FAQ sections are evergreen and independent of the
  // coupon list. Keep only the campaign at the top of this exact article.
  const children = content.children().toArray();
  const afterCampaign = children.findIndex(child => /^h[2-6]$/i.test(child.tagName));
  const campaign = $(children.slice(0, afterCampaign < 0 ? children.length : afterCampaign));
  const list = campaign.filter('ul, ol');
  const terms = campaign.filter('blockquote');
  const listHeading = clean(list.prev('p').text());
  const intro = clean(list.prev('p').prev('p').text());
  const termsText = clean(terms.text());
  if (list.length !== 1 || terms.length !== 1 || !brand.test(listHeading)
    || !/\b(?:gutscheine|coupons)\b.*:\s*$/i.test(listHeading)
    || !brand.test(intro) || !/\b(?:gutscheine|coupons) in der app\b/i.test(intro)
    || !/\bsind diese gültig[.!]?\s*$/i.test(intro) || !/\bgültig bis\b/i.test(termsText)) return null;
  const campaignText = campaign.toArray().map(el => clean($(el).text())).join(' ');
  if (couponExtension.test(campaignText)
    || ![intro, termsText].every(value => sourceEndClaims(value, now).includes(end))
    || sourceEndClaims(campaignText, now).some(date => date !== end)) return null;

  const wanted = couponKey(deal.title, feedCoupon);
  const matching = list.children('li').filter((_, element) => couponKey($(element).text(), sourceCoupon) === wanted);
  if (matching.length !== 1) return null;
  return { end, evidenceText: [clean(heading.text()), clean(button.text()), clean(matching.text()), `Gültig bis ${end}`].join(' · ') };
}

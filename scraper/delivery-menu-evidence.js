import { load } from 'cheerio';
import { parseExpiryShape } from './expiry-utils.js';
import { stripEnrichmentNotice } from './deal-enrichment-state.js';

// Deliberately bind each restaurant, ordering channel and approved benefit.
// A restaurant menu or a section called "Deals" does not confirm the promotion.
const offers = {
  'g2-acp99i': { url: 'https://wolt.com/de-at/aut/vienna/restaurant/dont-call-it-pizza',
    brand: 'Don’t Call It Pizza', title: '7 EUR Rabatt auf Bestellungen über 16 EUR', venue: /^don.t call it pizza 1120$/i,
    benefit: /(?<![\d.,])(?:7(?:[,.]00)?\s*(?:€|EUR)|€\s*7(?:[,.]00)?)\s*(?:Rabatt|off)|(?:spare|save)\s*(?:€\s*7|7\s*(?:€|EUR))/i,
    terms: /(?:[üu]ber|over|more than)\s*(?:(?:€|EUR)\s*16(?:[,.]00)?(?![\d.,])|16(?:[,.]00)?\s*(?:€|EUR))/i },
  'g2-oyxgdj': { url: 'https://www.lieferando.at/speisekarte/kitchen-23-1230', brand: 'Kitchen 23',
    title: '30 % auf ausgewählte Super-Deals', venue: /^kitchen 23(?:\s*(?:[-–|]\s*)?(?:1230|wien))?$/i,
    benefit: /(?<![\d.,])30\s*%\s*(?:Rabatt|discount|off|auf)\b/i, terms: /(?:ausgewählte|selected)\s+super[ -]?deals/i },
  'g2-1kg4kae': { url: 'https://www.lieferando.at/en/menu/bk-lc-wien-lugner-city', brand: 'Lieferando',
    title: '1+1 gratis: ausgewählte Burger und Nuggets bei Lieferando', venue: /^burger king\b.*(?:lugner city|gablenzgasse)/i,
    benefit: /\b1\s*\+\s*1\b|buy one[, ]+get one(?: free)?/i, terms: /whopper jr\.?|crispy chicken|(?:hd|plant[- ]based)\s+(?:chicken\s+)?nuggets/i },
};
const clean = text => String(text || '').replace(/\s+/g, ' ').trim();
const normalize = text => clean(text).normalize('NFC').toLowerCase();
const menuUrl = /^https:\/\/(?:wolt\.com\/(?:de-at|de|en)\/aut\/vienna\/restaurant\/|www\.lieferando\.at\/(?:speisekarte|en\/menu)\/)[a-z0-9]+(?:-[a-z0-9]+)*$/;
const promotion = /\b\d+\s*(?:%\s*(?:Rabatt|auf|off|discount)|\+\s*\d+)\b|\b(?:Gratis|Cashback)\b|(?:Rabatt|Gutschein|discount)\b.{0,18}(?:€|EUR)|(?:€|EUR)\s*(?:Rabatt|Gutschein|off)\b/i;

function approvedDescription(deal) {
  let text = clean(stripEnrichmentNotice(deal.description));
  for (const address of [deal.distance, deal.address].map(clean).filter(Boolean)) {
    for (const separator of [' – ', ' - ']) if (text.endsWith(separator + address)) text = text.slice(0, -(separator + address).length);
  }
  // Generic pages must repeat an independently specified benefit AND substantive
  // original conditions or product wording. A price or a title/address preview is insufficient.
  return normalize(text) !== normalize(deal.title) && text.length >= 35 && text.length <= 1000 ? text : '';
}
export function isReviewedDeliveryMenu(deal) {
  const offer = offers[deal?.id];
  if (offer) return deal.url === offer.url && deal.brand === offer.brand && deal.title === offer.title;
  return !!deal?.id && Number.isFinite(Date.parse(deal.approvedAt)) && menuUrl.test(deal.url)
    && /\b1(?:0[1-9]|1\d|2[0-3])0\s+Wien\b/i.test(clean(deal.distance || deal.address))
    && clean(deal.brand).length >= 3 && !/^(?:wolt|lieferando|unbekannt)$/i.test(clean(deal.brand))
    && promotion.test(clean(deal.title)) && !!approvedDescription(deal);
}
export function matchesDeliveryOffer(deal, text, now = new Date()) {
  if (!isReviewedDeliveryMenu(deal) || typeof text !== 'string' || text.length < 40 || text.length > 1800) return false;
  if (/abgelaufen|beendet|früher|vergangen|previously|ended|nicht (?:mehr )?(?:verfügbar|gültig)|(?:derzeit|aktuell) nicht|kein(?:e[nr]?)? (?:Rabatt|Aktion)|expired|withdrawn|sold out|not (?:currently )?(?:available|valid)/i.test(text)) return false;
  const timing = parseExpiryShape(text, { now });
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna' }).format(now);
  const end = timing.validUntil || timing.validOn;
  if (end && end < today || timing.validFrom && timing.validFrom > today) return false;
  const spec = offers[deal.id];
  if (spec) return spec.benefit.test(text) && spec.terms.test(text);
  const title = normalize(deal.title), body = normalize(approvedDescription(deal)), card = normalize(text);
  return card.startsWith(title + ' ' + body);
}
export function extractDeliveryOffer(deal, html, finalUrl, now = new Date()) {
  if (!isReviewedDeliveryMenu(deal) || finalUrl !== deal.url || typeof html !== 'string' || Buffer.byteLength(html) > 4000000) return null;
  const $ = load(html);
  $('script,style,noscript,template,svg,nav,footer,[hidden],[aria-hidden=true]').remove();
  $('[style]').filter((_, e) => /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test($(e).attr('style'))).remove();
  const heading = $('main h1'), canonical = $('link[rel=canonical]');
  const offer = offers[deal.id];
  const venue = clean(heading.text());
  if (heading.length !== 1 || !(offer ? offer.venue.test(venue) : normalize(venue) === normalize(deal.brand)) ||
      canonical.length !== 1 || canonical.attr('href') !== finalUrl) return null;
  const found = new Set();
  const markers = '[data-qa*="promotion"],[data-qa*="offer"],[data-test-id*="promotion"],[data-test-id*="offer"],article,section';
  $('main').find(markers).each((_, el) => {
    const card = $(el);
    // A container that also includes the ordinary menu or several promotions is ambiguous.
    if (card.find('article,section').length || card.find('h2,h3,h4').length > 1) return;
    if (offer && card.is('article,section') && !/rabatt|angebot|deals?|aktion|promotion|1\s*\+\s*1|discount/i.test(card.find('h2,h3,h4').first().text())) return;
    if (!offer && normalize(card.find('h2,h3,h4').text()) !== normalize(deal.title)) return;
    const copy = card.clone();
    copy.find('br').replaceWith(' '); copy.find('p,li,div,h2,h3,h4,span').append(' ');
    const text = clean(copy.text());
    if (matchesDeliveryOffer(deal, text, now)) found.add(text);
  });
  return found.size === 1 ? [...found][0] : null;
}

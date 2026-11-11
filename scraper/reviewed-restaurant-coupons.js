import fs from 'node:fs';
import crypto from 'node:crypto';

const { documents } = JSON.parse(fs.readFileSync(new URL('../reviews/restaurant-coupon-documents.json', import.meta.url)));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
export const MOEMAX_RESTAURANT = 'https://www.moemax.at/c/unserrestaurant';

export function allowedRestaurantCouponAsset(value, kind) {
  try {
    const u = new URL(value);
    return kind === 'pdf' && u.protocol === 'https:' && u.hostname === 'moemax.a.bigcontent.io'
      && !u.port && !u.username && !u.password && !u.search && !u.hash
      && /^\/v1\/static\/[a-zA-Z0-9_-]+\/at_dvat[a-zA-Z0-9_-]+\.pdf$/.test(u.pathname);
  } catch { return false; }
}

// Reviewed facts are usable only while the current merchant page still links
// this exact document and freshly downloaded bytes match the reviewed PDF.
export function reviewedRestaurantCards(asset) {
  const document = documents.find(d => d.url === asset.url && d.sha256 === asset.sha256);
  if (!document || !allowedRestaurantCouponAsset(asset.url, asset.kind))
    throw new Error('coupon-document-needs-review');
  return document.offers.map((offer, index) => ({
    format: 'reviewed-restaurant-v1', index,
    sha256: hash(JSON.stringify({ document: document.sha256, offer, index })),
    title: offer.title,
    // Keep full product choice and every required condition, not just price.
    footer: `${offer.product} für ${offer.price} €. Restaurantangebot gültig vom ${document.validFrom.split('-').reverse().join('.')} bis ${document.validUntil.split('-').reverse().join('.')}. ${document.terms} Allergene: ${offer.allergens}.`,
    locationSource: document.locationSource,
    locations: document.viennaRestaurants,
  }));
}

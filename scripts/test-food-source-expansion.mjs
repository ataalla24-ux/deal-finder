import assert from 'node:assert/strict';
import fs from 'node:fs';
import { POWER_FOOD_SOURCES, isAllowedFoodUrl } from '../scraper/power-food-sources.js';
import { extractFoodOffers } from '../scraper/power-food-extraction.js';
import { inferInstagramAccountRole } from '../scraper/instagram-entity-resolution.js';

const kfc = POWER_FOOD_SOURCES.find(source => source.name === 'KFC');
assert.equal(isAllowedFoodUrl('https://kfc.co.at/', kfc), true);
assert.equal(isAllowedFoodUrl('https://www.kfc.co.at/', kfc), true);
assert.equal(isAllowedFoodUrl('https://kfc.co.at.evil.test/', kfc), false);
assert.equal(isAllowedFoodUrl('https://kfc.com/', kfc), false);
const nordsee = POWER_FOOD_SOURCES.find(source => source.name === 'NORDSEE');
assert.equal(isAllowedFoodUrl('https://www.nordsee.com/at/coupons/pdf', nordsee), false);
const caption = 'Unser Preiskracher: Crispy Cheese Burger mit Käse, Gurkerl und Ketchup um 1,70 Euro';
const banner = `<main><section><img alt="${caption}">
  <img alt="Aktion: Burger und Bier um 4 Euro">
  <a href="/karriere"><img alt="Aktion: Burger um 1 Euro"></a>
  <img alt="Aktion: Burger um 1 Euro, nur in Linz">
  <img alt="Aktion: Burger um 1 Euro, bis 01.01.2020"></section></main>`;
const imageOffers = extractFoodOffers(banner, kfc);
assert.equal(imageOffers.deals.length, 1);
assert.equal(imageOffers.deals[0].title, caption);
assert.equal(imageOffers.deals[0].description, caption);
assert.equal(imageOffers.deals[0].evidence.extractionMethod, 'official-image-alt');
assert.equal(imageOffers.deals[0].reviewRequired, true);
assert.equal(imageOffers.deals[0].evidence.locationScope, '');
assert.deepEqual(imageOffers.deals[0].missingFields, ['Ort', 'Ablauf']);
assert.equal(imageOffers.deals[0].validUntil, undefined, 'do not invent an expiry');
assert.equal(extractFoodOffers(banner, { ...kfc, imageOfferSelector: undefined }).deals.length, 0,
  'image captions are opt-in per verified merchant');

const watchlist = JSON.parse(fs.readFileSync(new URL('../docs/instagram-watchlist.json', import.meta.url)));
assert.equal(new Set(watchlist.accounts.map(a => a.username)).size, watchlist.accounts.length);
const additions = watchlist.accounts.filter(a => a.evidenceUrl);
assert.ok(additions.length >= 14);
for (const account of additions) {
  assert.equal(inferInstagramAccountRole(account), 'merchant');
  assert.equal(new URL(account.evidenceUrl).protocol, 'https:');
  assert.ok(account.priority <= 70, 'new leads must not displace proven priority sources');
  assert.notEqual(account.verifiedVienna, true, 'profile ownership is not offer location evidence');
}
for (const username of ['ciosgrill', 'corner_xvi', 'foodiewien', 'tastyfood.vienna']) {
  assert.ok(watchlist.accounts.some(a => a.username === username && a.priority >= 96));
}
assert.notEqual(inferInstagramAccountRole(watchlist.accounts.find(a => a.username === 'foodiewien')), 'merchant');
const now = new Date('2026-10-02T12:00:00Z');
const hummel = POWER_FOOD_SOURCES.find(s => s.name === 'Cafe Hummel');
const html = '<div class="x-card-outer"><h4>Early Hummel Aktion</h4><p>Montag bis Freitag von 08:00 bis 09:00 Uhr kostet jeder Kaffee nur €2,50.</p></div>';
const parsed = extractFoodOffers(html, hummel, { now });
assert.equal(parsed.deals.length, 1);
assert.match(parsed.deals[0].description, /08:00 bis 09:00/);
assert.match(parsed.deals[0].distance, /1080 Wien/);
assert.equal(parsed.deals[0].type, 'rabatt');
assert.equal(extractFoodOffers('<div class="x-card-outer"><h4>Free WiFi</h4><p>Kostenloses WLAN beim Kaffee.</p></div>', hummel, { now }).deals.length, 0);
assert.equal(extractFoodOffers(html.replace('€2,50.', '€2,50. Gültig bis 01.10.2026.'), hummel, { now }).deals.length, 0);
const wunder = POWER_FOOD_SOURCES.find(s => s.name === 'Wunderkammer Wien');
assert.equal(isAllowedFoodUrl('https://www.marriott.com/de/hotels/other/dining/', wunder), false);
assert.equal(isAllowedFoodUrl('https://www.marriott.com.evil.test/de/hotels/viehw-renaissance-vienna-schonbrunn-hotel/dining/', wunder), false);
const cocktail = extractFoodOffers('<div class="cd-cl__heading"><h3>Happy Hour</h3><p>Täglich von 17.00 bis 20.00 Uhr: Beim Kauf eines ausgewählten Cocktails erhalten Sie einen zweiten gratis dazu. Preise 7,50 bis 12,00 EUR.</p></div>', wunder, { now });
assert.equal(cocktail.deals.length, 0, 'alcohol is excluded from discovery');
assert.equal(cocktail.rejected[0].reason, 'alcohol-offer');
// Synthetic non-alcoholic counterpart retains the original billing/timing checks.
const mocktail = extractFoodOffers('<div class="cd-cl__heading"><h3>Happy Hour</h3><p>Täglich von 17.00 bis 20.00 Uhr: Beim Kauf eines ausgewählten Mocktails erhalten Sie einen zweiten gratis dazu. Preise 7,50 bis 12,00 EUR.</p></div>', wunder, { now });
assert.equal(mocktail.deals.length, 1);
assert.notEqual(mocktail.deals[0].type, 'gratis', 'paid first drink must not become unconditional free drink');
assert.match(mocktail.deals[0].description, /Beim Kauf/);
assert.equal(mocktail.deals[0].evidence.offerTiming.kind, 'recurring');

const welt = POWER_FOOD_SOURCES.find(s => s.name === 'Weltcafe');
assert.ok(welt, 'include a verified local coffee offer source');
const widget = text => `<div class="elementor-widget-heading"><h1>${text}</h1></div>`;
const coffeePage = `<main><div>${widget('HAPPY HOUR')}${widget('Alle Longdrinks 7,90 Euro')}${widget('Tägliches Angebot: KAFFEE UND KUCHEN')}${widget('Veganer Apfelkuchen und Cappuccino oder Schoko-Kuchen und Cappuccino 7,90 Euro')}</div></main>`;
const coffeeOffers = extractFoodOffers(coffeePage, welt, { now });
assert.equal(coffeeOffers.deals.length, 1);
assert.match(coffeeOffers.deals[0].description, /Apfelkuchen.*7,90/);
assert.doesNotMatch(coffeeOffers.deals[0].description, /Longdrinks/);
assert.match(coffeeOffers.deals[0].address, /1090 Wien/);
assert.equal(extractFoodOffers(`<main>${widget('Tägliches Angebot: KAFFEE UND KUCHEN')}</main>`, welt, { now }).deals.length, 0);
assert.equal(extractFoodOffers(coffeePage.replace('Cappuccino 7,90', 'Cappuccino und Bier 7,90'), welt, { now }).deals.length, 0);
const maria = POWER_FOOD_SOURCES.find(s => s.name === 'Gasthaus Maria');
assert.ok(maria);
const schnitzel = extractFoodOffers('<div id="m3402"><p>Mitt\u00adwoch ist Schnit\u00adzeltag:</p><p>ab 16:00 Uhr</p><p>Schweineschnitzel mit Kartoffelsalat um 8,20 Euro</p><p>Für Stammgäste ist das 12. Menü gratis</p></div>', maria, { now });
assert.equal(schnitzel.deals.length, 1);
assert.equal(schnitzel.deals[0].type, 'rabatt', 'loyalty benefit does not make the paid meal free');
assert.match(schnitzel.deals[0].description, /12\. Menü gratis/);
assert.equal(schnitzel.deals[0].evidence.offerTiming.recurring, true);
assert.doesNotMatch(schnitzel.deals[0].description, /\u00ad/);
const salieri = POWER_FOOD_SOURCES.find(s => s.name === 'Salieri');
assert.ok(salieri);
assert.equal(isAllowedFoodUrl('https://www.salieri.at.evil.test/', salieri), false);

const frank = POWER_FOOD_SOURCES.find(s => s.name === 'Lets be Frank');
assert.ok(frank, 'include the official Vienna specials, not general restaurant reviews');
const frankCard = (heading, text) => `<div class="lbf-content-text-block"><h2>${heading}</h2><div><p>${text}</p></div></div>`;
const frankHtml = frankCard('Wednesday Burger Special', 'Every Wednesday · 5:00–9:30 PM. All burgers for just €9.90. Sides and drinks are not included.')
  + frankCard('Late Night Dinner Special', 'Every day · 9:30–10:30 PM. Enjoy 30% off our regular à la carte food menu. Offer valid exclusively for reservations made through our website. Discount applies to food only. Drinks are not included.')
  + frankCard('Apéro Hour', 'Every day · 5:00–7:00 PM. Prosecco Spritz for just €5.00.')
  + frankCard('3-Course Menu', 'Every day · €39 per person. Includes Prosecco or house beer.');
const frankOffers = extractFoodOffers(frankHtml, frank, { now });
assert.equal(frankOffers.deals.length, 2, 'keep only the two independent food offers');
assert.equal(frankOffers.rejected.filter(r => r.reason === 'alcohol-offer').length, 2);
for (const offer of frankOffers.deals) {
  assert.equal(offer.evidence.offerTiming.recurring, true, 'English weekday schedules are not crawl dates');
  assert.equal(offer.validUntil, undefined, 'do not invent an expiry for a weekly special');
  assert.equal(offer.reviewRequired, true);
  assert.equal(offer.votes, 0, 'newly collected offers have no user votes');
  assert.match(offer.address, /1150 Wien/);
}
assert.match(frankOffers.deals.find(d => /30%/.test(d.description)).description, /exclusively for reservations.*Drinks are not included/);
assert.match(frankOffers.deals.find(d => /9\.90/.test(d.description)).description, /Sides and drinks are not included/);
assert.equal(extractFoodOffers(frankHtml.replace('Every Wednesday', 'Every Wednesday, bis 01.10.2026'), frank, { now }).deals.length, 1);
assert.equal(isAllowedFoodUrl('https://letsbefrank.at.evil.test/specials/', frank), false);

const mussty = POWER_FOOD_SOURCES.find(s => s.name === 'Mussty');
assert.ok(mussty, 'include dedicated official lunch offers');
const lunchCard = (dish, price) => `<div class="elementor-top-column"><div class="elementor-widget-wrap"><section class="elementor-inner-section"><h2>${dish} MENU</h2><h3>€${price}</h3></section><div class="elementor-widget-text-editor">Auswahl. 0.25L Soda/Zitrone oder Apfelsaft gespritzt Inkl.</div></div></div>`;
const lunchHeading = '<div class="elementor-element-2d78f329"><h2>MITTAGS ANGEBOTE!</h2></div>';
const lunchHtml = lunchHeading + ['PASTA', 'BURGER', 'PIZZA', 'SANDWICH'].map((dish, i) => lunchCard(dish, i === 3 ? '8,90' : '9,90')).join('');
const lunchOffers = extractFoodOffers(lunchHtml, mussty, { now });
assert.equal(lunchOffers.deals.length, 4);
assert.equal(new Set(lunchOffers.deals.map(d => d.id)).size, 4);
for (const offer of lunchOffers.deals) {
  assert.match(offer.description, /0.25L.*Inkl/);
  assert.match(offer.description, /^MITTAGS ANGEBOTE!/);
  assert.equal(offer.validUntil, undefined);
  assert.equal(offer.evidence.offerTiming.recurring, false, 'do not manufacture specific weekdays or lunch times');
  assert.match(offer.address, /1100 Wien/);
  assert.equal(offer.reviewRequired, true);
}
assert.equal(extractFoodOffers(lunchHtml.replaceAll('Soda/Zitrone', 'Bier'), mussty, { now }).deals.length, 0);
assert.equal(extractFoodOffers(lunchHtml.replaceAll('€9,90', '').replaceAll('€8,90', ''), mussty, { now }).deals.length, 0);
assert.equal(extractFoodOffers('<main><h2>Pizza MENU</h2><p>€9,90</p></main>', mussty, { now }).deals.length, 0, 'layout drift must not become a generic whole-page menu scrape');
assert.equal(isAllowedFoodUrl('https://www.mussty.at.evil.test/spezialangebot/', mussty), false);
assert.equal(extractFoodOffers(lunchHtml.replace(lunchHeading, ''), mussty, { now }).deals.length, 0, 'a lost shared condition must fail closed');
assert.equal(extractFoodOffers(lunchHtml.replace('MITTAGS ANGEBOTE!', 'GEÄNDERTE ANGEBOTE!'), mussty, { now }).deals.length, 0);
assert.equal(extractFoodOffers(lunchHeading + lunchHtml, mussty, { now }).deals.length, 0, 'ambiguous shared conditions are not safe to join');
console.log('Food source expansion checks passed');

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
console.log('Food source expansion checks passed');

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

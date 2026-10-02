import assert from 'node:assert/strict';
import fs from 'node:fs';
import { POWER_FOOD_SOURCES, isAllowedFoodUrl } from '../scraper/power-food-sources.js';
import { extractFoodOffers } from '../scraper/power-food-extraction.js';
import { inferInstagramAccountRole } from '../scraper/instagram-entity-resolution.js';

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
assert.equal(cocktail.deals.length, 1);
assert.notEqual(cocktail.deals[0].type, 'gratis', 'paid first drink must not become unconditional free drink');
assert.match(cocktail.deals[0].description, /Beim Kauf/);
assert.equal(cocktail.deals[0].evidence.offerTiming.kind, 'recurring');
console.log('Food source expansion checks passed');

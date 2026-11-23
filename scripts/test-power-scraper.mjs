import assert from 'node:assert/strict';

import {
  extractDealsFromHTML,
  hasConcretePowerDealSignal,
  shouldUseBrowserFallback,
} from '../scraper/power-scraper.js';

const source = {
  name: 'Test Cafe',
  url: 'https://example.com/deals',
  brand: 'Test Cafe',
  logo: 'TC',
  category: 'kaffee',
};

assert.equal(hasConcretePowerDealSignal('Angebote'), false);
assert.equal(hasConcretePowerDealSignal('Jetzt Aktionen entdecken'), false);
assert.equal(hasConcretePowerDealSignal('20 % Rabatt auf Kaffee'), true);
assert.equal(hasConcretePowerDealSignal('Zweiter Kaffee gratis'), true);
assert.equal(hasConcretePowerDealSignal('iPhone ab 949 EUR'), false);
assert.equal(hasConcretePowerDealSignal('Qualifiziert für Angebot: MacBook ab 1.289 EUR'), false);
assert.equal(hasConcretePowerDealSignal('Kostenlose Ressourcen für Lehrkräfte'), false);
assert.equal(hasConcretePowerDealSignal('Entdecke Tools von der ersten Zeile Code bis zu deiner ersten App'), false);
assert.equal(hasConcretePowerDealSignal('Matcha nur 2,50 EUR', source), true);
assert.equal(shouldUseBrowserFallback(new Error('HTTP 403')), false);
assert.equal(shouldUseBrowserFallback(new Error('HTTP 429')), false);
assert.equal(shouldUseBrowserFallback(new Error('Timeout after 8000ms')), true);
assert.equal(shouldUseBrowserFallback(new Error('HTTP 404')), false);

const deals = extractDealsFromHTML(`
  <a href="/angebote">Angebote</a>
  <a href="/sale">20 % Rabatt auf alle Kaffees</a>
  <a href="/shipping">Gratis Versand</a>
  <a href='/matcha'><span>Matcha</span> <strong>nur 2,50 EUR</strong></a>
`, source);

assert.equal(deals.length, 2);
assert.deepEqual(deals.map((deal) => deal.title).sort(), [
  '20 % Rabatt auf alle Kaffees',
  'Matcha nur 2,50 EUR',
]);
assert.ok(deals.every((deal) => deal.discoveredAt));
assert.ok(deals.every((deal) => !deal.pubDate));

const mediaSource = {name: 'MediaMarkt', brand: 'MediaMarkt', category: 'technik', url: 'https://www.mediamarkt.at/de/campaign/prospekte-angebote'};
for (const text of ['Kostenlos anmelden', 'Jetzt kostenlos registrieren', 'Kostenlose Anmeldung',
  'GRATIS "Basic-Lieferung" im Markt & online', 'GRATIS „Basic-Lieferung“ im Markt & online',
  'GRATIS &quot;Basic-Lieferung&quot; im Markt &amp; online']) {
  assert.equal(hasConcretePowerDealSignal(text, mediaSource), false, text);
}
assert.equal(hasConcretePowerDealSignal('Kostenlos anmelden und 10% Rabatt in der App sichern', mediaSource), true);
assert.equal(hasConcretePowerDealSignal('KitchenAid Küchenmaschine kaufen und Gratis Zubehör sichern!', mediaSource), true);
assert.equal(hasConcretePowerDealSignal('10% in der App', mediaSource), true);
assert.equal(hasConcretePowerDealSignal('10 % Rabatt auf die Küchenmaschine plus GRATIS „Basic-Lieferung“', mediaSource), true);
assert.equal(hasConcretePowerDealSignal('Gratis Zubehör zur Küchenmaschine und GRATIS „Basic-Lieferung“', mediaSource), true);

// Exact raw titles/URLs from Power run 45185714023, reconstructed as minimal links.
const mediaHtml = `
  <a href="/de/campaign/kitchenaid-zubehoer">KitchenAid Küchenmaschine kaufen und Gratis Zubehör sichern!</a>
  <a href="/de/myaccount/guest-newsletter">Kostenlos anmelden</a>
  <a href="/de/service/lieferung-montage#basic-lieferung">GRATIS &quot;Basic-Lieferung&quot; im Markt &amp; online ( Link führt auf eine externe Website )</a>
  <a href="/de/campaign/abverkauf-restposten">10% in der App</a>
`;
const mediaDeals = extractDealsFromHTML(mediaHtml, mediaSource);
assert.deepEqual(mediaDeals.map(deal => deal.title).sort(), ['10% in der App', 'KitchenAid Küchenmaschine kaufen und Gratis Zubehör sichern!']);
assert.deepEqual(mediaDeals.map(deal => deal.url).sort(), [
  'https://www.mediamarkt.at/de/campaign/abverkauf-restposten',
  'https://www.mediamarkt.at/de/campaign/kitchenaid-zubehoer',
]);

console.log('power scraper tests passed');

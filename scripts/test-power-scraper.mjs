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
assert.equal(shouldUseBrowserFallback(new Error('HTTP 403')), true);
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

console.log('power scraper tests passed');

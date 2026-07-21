import assert from 'node:assert/strict';

import {
  extractVoucherCards,
  parseDeals,
  safeGutscheineUrl,
} from '../scraper/gutscheine-scraper.js';

const now = new Date('2026-07-20T12:00:00.000Z');

const woltCard = `
  <div class="block bg-white flex flex-col" data-voucher-id="voucher-id:217530">
    <div class="p-4 flex">
      <div><img alt="Wolt Logo" title="Wolt Gutscheine"></div>
      <div>
        <h3 class="text-lg"><strong>4€ Wolt Gutschein</strong> für Neukunden (bis zu 3x einlösbar)</h3>
        <div><span>Gutschein anzeigen</span></div>
      </div>
    </div>
    <div class="footer"><span>Gültig bis: 31.07.2026</span></div>
  </div>`;

const dysonCard = `<div data-voucher-id='voucher-id:473662' class='block bg-white flex flex-col'>
    <div class="p-4 flex">
      <div><img alt="Dyson Österreich Logo" title="Dyson Gutscheine"></div>
      <div>
        <h3 class="text-lg">300€ Rabatt auf Dyson Spot+Scrub™ Ai Saugroboter mit Wischfunktion</h3>
        <a href="https://evil.example/redirect?code=473662">Zum Angebot</a>
      </div>
    </div>
    <div class="footer"><span>Gültig bis: 26.07.2026</span></div>
  </div>`;

// These are deliberately adjacent: the old page-wide regex joined Wolt's title
// to Dyson's following card and assigned Dyson's expiry to Wolt.
const fixture = `
  <a href="/wolt?code=217530&amp;utm_source=list">Wolt Details</a>
  ${woltCard}${dysonCard}
  <div class="block bg-white flex flex-col" data-voucher-id="voucher-id:217530">
    <img alt="Wrong duplicate Logo" title="Wrong duplicate Gutscheine">
    <h3>99% Falsches Duplikat</h3>
    <span>Gültig bis: 01.01.2099</span>
  </div>
  <div data-voucher-id="voucher-id:999999" class="search-result-item flex">
    <img alt="Search Result Logo" title="Search Result Gutscheine">
    <span>20€ Rabatt aus der Seitenleiste</span>
  </div>
  <div class="block bg-white flex flex-col" data-voucher-id="voucher-id:888888">
    <img alt="Broken Logo" title="Broken Gutscheine">
    <h3 class="text-lg">300 Rabatt ohne Währung oder Prozent</h3>
  </div>`;

const cards = extractVoucherCards(fixture);
assert.deepEqual(
  cards.map(card => card.voucherId),
  ['217530', '473662', '217530', '888888'],
  'only full flex-col voucher cards are extracted; sidebar search results are ignored',
);

const deals = parseDeals(fixture, { now });
assert.equal(deals.length, 2, 'duplicate voucher IDs are emitted only once');

const wolt = deals.find(deal => deal.voucherId === '217530');
assert.ok(wolt, 'Wolt voucher is present');
assert.equal(wolt.brand, 'Wolt');
assert.equal(wolt.title, '4€ Wolt Gutschein für Neukunden (bis zu 3x einlösbar)');
assert.equal(wolt.expires, 'Bis 31.07.2026');
assert.equal(wolt.url, 'https://www.gutscheine.at/wolt?code=217530&utm_source=list');
assert.equal(wolt.pubDate, now.toISOString());
assert.doesNotMatch(wolt.title, /Dyson/i, 'the following card cannot leak into Wolt');

const dyson = deals.find(deal => deal.voucherId === '473662');
assert.ok(dyson, 'Dyson voucher is present');
assert.equal(dyson.brand, 'Dyson');
assert.equal(dyson.title, '300€ Rabatt auf Dyson Spot+Scrub™ Ai Saugroboter mit Wischfunktion');
assert.equal(dyson.expires, 'Bis 26.07.2026');
assert.equal(dyson.url, 'https://www.gutscheine.at/dyson', 'unsafe links fall back to the local shop URL');
assert.doesNotMatch(dyson.title, /Wolt/i, 'the previous card cannot leak into Dyson');
assert.equal(deals.some(deal => deal.voucherId === '888888'), false, 'amounts without currency or percent are not invented as deals');

const seenVoucherIds = new Set();
assert.equal(parseDeals(woltCard, { now, seenVoucherIds }).length, 1);
assert.equal(parseDeals(woltCard, { now, seenVoucherIds }).length, 0, 'dedupe works across separately fetched pages');

assert.equal(safeGutscheineUrl('javascript:alert(1)'), '');
assert.equal(safeGutscheineUrl('https://evil.example/wolt?code=217530'), '');
assert.equal(safeGutscheineUrl('/wolt?code=217530'), 'https://www.gutscheine.at/wolt?code=217530');

console.log('✅ Gutscheine.at card parser fixture passed');

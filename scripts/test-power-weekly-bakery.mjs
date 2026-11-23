import assert from 'node:assert/strict';
import test from 'node:test';
import { POWER_FOOD_SOURCES } from '../scraper/power-food-sources.js';
import { extractFoodOffers } from '../scraper/power-food-extraction.js';
import { verifyOfficialFoodDeal } from '../scraper/power-food-verification.js';
import { validateDealsForSlack } from '../scraper/deal-validity-agent.js';

const source = POWER_FOOD_SOURCES.find(s => s.name === 'Der Mann');
const pageUrl = 'https://www.dermann.at/aktion/apfel-dinkelstreusel-2/';
const now = new Date('2026-11-23T12:00:00Z');
const name = 'Apfel-Dinkelstreusel';
const page = { '@type': 'WebPage', '@id': pageUrl, url: pageUrl, name: name + ' - Bäckerei Der Mann',
  datePublished: '2026-11-15T23:05:39+00:00' };
const text = 'Unser Apfel-Dinkelstreusel. Vom 16. bis zum 29. November erhalten Sie dieses Gebäck in allen Filialen von Montag bis Samstag, ausgenommen an Feiertage, um 26 % vergünstigt für nur 2,81 €.';
function fixture(record = page, copy = text) {
  return `<script type="application/ld+json">${JSON.stringify({ '@graph': [record] })}</script>
    <main><div class="produktbeschreibung"><h1>${name}</h1><p>${copy}</p></div></main>`;
}
const parse = (html, at = now) => extractFoodOffers(html, source, { now: at, pageUrl }).deals;

test('already-fetched product detail produces one dated, re-verifiable food offer', async () => {
  const html = fixture();
  const [row] = parse(html);
  assert.equal(row.title, 'Apfel-Dinkelstreusel für 2,81 € (−26 %)');
  assert.equal(row.description, text);
  assert.equal(row.validFrom, '2026-11-16');
  assert.equal(row.validUntil, '2026-11-29');
  assert.equal(row.evidence.locationScope, 'merchant-branches');
  assert.equal(row.evidence.locationEvidenceUrl, 'https://www.dermann.at/filiale/naschmarkt-11-14/');
  assert.equal(row.address, undefined);
  assert.equal(row.reviewRequired, true);
  const requests = [];
  const fetchPage = async url => {
    requests.push(url);
    return { status: 200, finalUrl: url, html };
  };
  const validation = await validateDealsForSlack([row], {
    now, requireVienna: true, fetchOfficialFoodPage: fetchPage,
    inspectDealUrlHealth: async () => ({ valid: true, status: 200 }),
  });
  assert.deepEqual(validation.allowedDeals.map(d => d.id), [row.id]);
  assert.deepEqual(requests, [pageUrl]);
  const changed = await verifyOfficialFoodDeal(row, { now,
    fetchPage: async () => ({ status: 200, finalUrl: pageUrl, html: html.replace('2,81', '3,50') }) });
  assert.equal(changed.ok, false);
});

test('archived promotions never revive with the current clock or another page’s year', () => {
  assert.deepEqual(parse(fixture(), new Date('2026-11-30T11:00:00Z')), []);
  assert.deepEqual(parse(fixture(), new Date('2027-11-23T11:00:00Z')), []);
  for (const metadata of [{ ...page, datePublished: null }, { ...page, url: source.url },
    { ...page, datePublished: '2026-11-03T12:00:00Z' }, { ...page, name: 'Andere Seite' }]) {
    assert.deepEqual(parse(fixture(metadata)), []);
  }
});

test('withdrawals, missing eligibility, additional conditions and conflicting ranges are held', () => {
  for (const change of [
    text.replace('Unser', 'Aktion beendet. Unser'), text.replace('in allen Filialen', 'nur in Graz'),
    text.replace('in allen Filialen', 'nicht in allen Filialen'), text.replace('16. bis', '30. bis'),
    text.replace('29. November', '31. November'), text.replace('26 % vergünstigt für nur', 'regulär für'),
  ]) assert.deepEqual(parse(fixture(page, change)), []);
  assert.deepEqual(parse(fixture().replace('</main>', '<small>Nur mit App.</small></main>')), []);
  assert.deepEqual(parse(fixture().replace('class="produktbeschreibung"', 'hidden class="produktbeschreibung"')), []);
});

test('other bakery offer formats keep their existing discovery path', () => {
  const html = '<main><div class="produktbeschreibung"><h1>Gratis Dinkelweckerl</h1><p>Gratis Dinkelweckerl in Wien. Aktion bis 29.11.2026.</p></div></main>';
  const result = extractFoodOffers(html, source, { now, pageUrl: 'https://www.dermann.at/aktion/anderes-weckerl/' });
  assert.equal(result.deals.length, 1);
  assert.equal(result.deals[0].evidence.extractionMethod, 'semantic-block');
});

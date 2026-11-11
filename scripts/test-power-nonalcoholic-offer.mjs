import assert from 'node:assert/strict';
import test from 'node:test';
import { extractFoodOffers } from '../scraper/power-food-extraction.js';
import { POWER_FOOD_SOURCES } from '../scraper/power-food-sources.js';
import { verifyOfficialFoodDeal } from '../scraper/power-food-verification.js';
import { validateDealsForSlack } from '../scraper/deal-validity-agent.js';
import { discoveryRejection } from '../scraper/deal-discovery-policy.js';
import { normalizeDeal } from '../scraper/slack-notify.js';

const source = POWER_FOOD_SOURCES.find(s => s.name === "MABEL'S No90");
const now = new Date('2026-11-11T13:00:00Z');
const html = `<section id="karte-highlights">
  <div class="highlight-row-heading"><div><h3>Aus unserer Bar</h3>
    <p>Tägliche Happy Hour von 18–20 Uhr: Cocktails 4 € und Mocktails 2 € billiger.</p>
  </div><div class="highlight-controls"><button aria-label="Vorheriges Getränk"></button></div></div>
  <article><h4>Mojito</h4><p>Rum Cocktail Happy Hour 7,90 €</p></article>
</section><section><div class="location-card"><h2>So finden Sie uns</h2>
  <p>Laxenburger Straße 90<br>1100 Wien · Ecke Troststraße</p>
</div></section>`;
const parse = (text = html, config = source, pageUrl = source.url) =>
  extractFoodOffers(text, config, { now, pageUrl });
const isolated = result => result.deals.filter(d =>
  d.evidence.extractionMethod === 'official-nonalcoholic-happy-hour');

test('independent alcohol-free discount keeps hours, real location and original evidence', () => {
  const [deal] = isolated(parse());
  assert.ok(deal);
  assert.equal(deal.title, '2 € Rabatt auf Mocktails (18–20 Uhr)');
  assert.equal(deal.description, 'Tägliche Happy Hour von 18–20 Uhr: Mocktails 2 € billiger.');
  assert.equal(deal.address, 'Laxenburger Straße 90, 1100 Wien');
  assert.equal(deal.evidence.locationScope, 'merchant-address');
  assert.equal(deal.evidence.locationEvidenceUrl, 'https://mabels.at/');
  assert.equal(deal.evidence.offerTiming.recurring, true);
  assert.equal(deal.validUntil, undefined);
  assert.equal(deal.reviewRequired, true);
  assert.match(deal.evidence.originalOfferText, /Cocktails 4 € und Mocktails 2 €/);
  assert.equal(discoveryRejection(deal), '');
  assert.ok(parse().rejected.some(r => r.reason === 'alcohol-offer'));
});

test('amount and hours are read from the page, not fixed promotional facts', () => {
  const [deal] = isolated(parse(html.replace('18–20', '17–19').replace('Mocktails 2 €', 'Mocktails 1,50 €')));
  assert.equal(deal.title, '1,50 € Rabatt auf Mocktails (17–19 Uhr)');
});

test('additional conditions, conflicting blocks and changed venue are held', () => {
  const heading = html.match(/<div class="highlight-row-heading">[\s\S]*?<\/button><\/div><\/div>/)[0];
  for (const changed of [
    html.replace('billiger.', 'billiger. Nur mit Clubkarte.'),
    html.replace('</p>\n  </div>', '</p><p>Nur bei Kauf eines Burgers.</p>\n  </div>'),
    html.replace('18–20', '21–18'),
    html.replace('18–20', '18–25'),
    html.replace('Mocktails 2 €', 'Mocktails 0 €'),
    html.replace('Mocktails 2 €', 'Mocktails ab 2 €'),
    html.replace('und Mocktails', 'beim Kauf von Mocktails'),
    html.replace('Laxenburger Straße 90', 'Laxenburger Straße 91'),
    html.replace('1100 Wien', '8010 Graz'),
    html + '<div class="location-card"><p>Andere Filiale, 1020 Wien</p></div>',
    html.replace('</section><section>', `${heading}</section><section>`),
    html.replace('id="karte-highlights"', 'id="changed-layout"'),
  ]) assert.equal(isolated(parse(changed)).length, 0, changed);
});

test('projection is not applied to other merchants or menu subpages', () => {
  assert.equal(isolated(parse(html, { ...source, nonAlcoholicHappyHour: undefined })).length, 0);
  assert.equal(isolated(parse(html, { ...source, allowedHosts: ['example.com'] }, 'https://example.com/')).length, 0);
  assert.equal(isolated(parse(html, source, 'https://mabels.at/cocktails.html')).length, 0);
  assert.equal(discoveryRejection({ title: 'Cocktails und Mocktails 2 € billiger' }), 'alcohol-offer');
});

test('ordinary verifier re-extracts and rejects later source changes', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected network request in offline test'); });
  const [deal] = isolated(parse());
  const fetchPage = async () => ({ html, finalUrl: source.url });
  const verified = await verifyOfficialFoodDeal(deal, { now, fetchPage });
  assert.equal(verified.ok, true);
  assert.equal(verified.current, true);
  assert.equal((await verifyOfficialFoodDeal(normalizeDeal(deal, 'power'), { now, fetchPage })).ok, true);
  const changed = await verifyOfficialFoodDeal(deal, {
    now, fetchPage: async () => ({ html: html.replace('Mocktails 2 €', 'Mocktails 1 €'), finalUrl: source.url }),
  });
  assert.equal(changed.ok, false);
  const validation = await validateDealsForSlack([deal], {
    now, fetchOfficialFoodPage: fetchPage,
    inspectDealUrlHealth: async url => ({ status: 200, finalUrl: url, dateHints: {} }),
  });
  assert.equal(validation.allowedDeals.length, 1);
});

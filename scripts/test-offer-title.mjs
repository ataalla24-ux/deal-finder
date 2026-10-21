import assert from 'node:assert/strict';
import { concreteFoodOfferTitle, stripSlackEmojiCodes } from '../scraper/offer-title-utils.js';
import { normalizeDealRecord } from '../scraper/deal-normalization-utils.js';
import { inspectDealContentQuality } from '../scraper/deal-content-quality-utils.js';
import { extractDealsFromThreadMessages } from '../scraper/slack-digest-utils.js';
import { polishLiveDealTitles } from './polish-live-deal-titles.mjs';
import { applyCardEditorial } from '../scraper/deal-card-editor.js';

const description = 'Wien, macht euch bereit für diesen Deal! :rotating_light: Bei Box 16 gibt es nur diese Woche das absolute Döner-Highlight. :point_right::skin-tone-3: Chicken Döner für unglaubliche 3,50€! :point_right::skin-tone-3: Steak Döner bestellen = 1 eiskalter Ayran GRATIS dazu! Nur bis Samstag.';
const original = { id: 'fixture', brand: '1160 Wien', title: 'Wien, macht euch bereit für diesen Deal', description, category: 'essen', distance: '1160 Wien', url: 'https://www.tiktok.com/@box16kebap.more1/video/7689014394830867734' };
const fixed = normalizeDealRecord(original);
assert.equal(fixed.title, 'Chicken Döner für 3,50 €');
assert.equal(fixed.brand, 'Box 16');
assert.equal(fixed.distance, '1160 Wien');
assert.match(fixed.description, /Steak Döner bestellen = 1 eiskalter Ayran GRATIS dazu/);
assert.match(fixed.description, /Nur bis Samstag/);
assert.doesNotMatch(fixed.description, /:point_right:|:skin-tone-3:|:rotating_light:/);
assert.deepEqual(normalizeDealRecord(fixed), fixed);
assert.equal(concreteFoodOfferTitle('Aufgepasst! Kaffee für 2.50 Euro!'), 'Kaffee für 2.50 Euro');
assert.equal(concreteFoodOfferTitle('Aufgepasst! Pizza gratis nur für Neukunden!'), 'Pizza gratis nur für Neukunden');
assert.equal(concreteFoodOfferTitle('Aufgepasst! Steak Döner bestellen ='), '');
assert.equal(concreteFoodOfferTitle('Pizza nicht gratis!'), '');
assert.equal(concreteFoodOfferTitle('Wien, macht euch bereit! Bald mehr.'), '');
assert.equal(stripSlackEmojiCodes('https://example.com 12:30 Uhr :fire:'), 'https://example.com 12:30 Uhr');
assert.equal(normalizeDealRecord({ ...original, title: '1+1 Burger nur mit App' }).title, '1+1 Burger nur mit App');
assert.equal(normalizeDealRecord({ ...original, liveEditedFields: ['title'], title: 'Manuell bestätigter Titel' }).title, 'Manuell bestätigter Titel');
const codes = inspectDealContentQuality(original).map(x => x.code);
for (const code of ['promotional-title', 'location-as-merchant', 'social-noise']) assert.ok(codes.includes(code), code);
const fullCaption = description.replace(':rotating_light:', '🚨').replaceAll(':point_right::skin-tone-3:', '👉🏼');
const message = { ts: '1790282328.083369', text: `*1. ${original.title}*\nMarke/Restaurant: 1160 Wien\nOrt: 1160 Wien\nDeal-ID: fixture\nBeschreibung: ${description.slice(0, description.indexOf('Chicken'))}` };
const [imported] = extractDealsFromThreadMessages([message], { pendingQueue: [{ ...original, description: fullCaption }] });
assert.equal(imported.title, 'Chicken Döner für 3,50 €');
assert.match(imported.description, /Steak Döner bestellen = 1 eiskalter Ayran GRATIS dazu/);
assert.equal(imported.brand, 'Box 16');
console.log('Offer-title regression checks passed');

const editorialCases = [
  {
    title: 'Kommentiere „PIZZA“ und folge uns – wir schicken dir deinen Gutschein direkt per DM.',
    description: 'Die zweite Pizza übernehmen wir! Kommentiere „PIZZA“ und folge uns – wir schicken dir deinen Gutschein direkt per DM. Die günstigere Pizza ist gratis. 1 Gutschein pro Person. Nur vor Ort, bis 31.10.2026.',
    expected: 'Zweite Pizza gratis mit Gutschein',
  },
  {
    title: 'Große Aktion: 2 + 1 Döner GRATIS auf alle Dönersorten Wo',
    description: 'Große Aktion: 2 + 1 Döner GRATIS auf alle Dönersorten🔥 📍Wo?: Rußbergstraße 9. Nur vom 19.10. bis 25.10.',
    expected: '2+1 Döner gratis auf alle Dönersorten',
  },
  {
    title: 'Zu JEDEM DÖNER gibt’s ein leckeres TIRAMISU GRATIS',
    description: 'Zu JEDEM DÖNER gibt’s ein leckeres TIRAMISU GRATIS! Vom 21.10. bis 04.11.',
    expected: 'Gratis Tiramisu zu jedem Döner',
  },
  {
    title: '🎉🎉🎉 GRAND OPENING AM 01.11.2026 Wir feiern Neueröffnung und die ersten 50 Personen essen GRATIS!',
    description: 'Folge unserem Account. Nur am 01.11.2026 für die ersten 50 Personen.',
    expected: 'Gratis Essen für die ersten 50 Personen am 01.11.2026',
  },
];
for (const item of editorialCases) {
  const source = { id: 'editorial', brand: 'Testrestaurant', category: 'essen', title: item.title, description: item.description, expires: '2026-11-01T23:59:59Z', url: 'https://example.test/offer' };
  const result = normalizeDealRecord(source);
  assert.equal(result.title, item.expected);
  assert.ok(result.description.includes(item.description), 'Keep complete conditions');
  assert.equal(result.expires, source.expires);
  assert.deepEqual(normalizeDealRecord(result), result, 'Editorial cleanup must be idempotent');
  assert.equal(normalizeDealRecord({ ...source, liveEditedFields: ['title'] }).title, item.title);
}
for (const title of ['Bis zu 50 % Rabatt auf ausgewählte Menüs', '1+1 Pizza nur für Neukunden mit App', 'Gratis Pizza ab 20 € Bestellwert', 'Pizza nicht mehr gratis', 'GRATIS WASSER nur beim Kauf eines Menüs']) {
  const source = { title, description: 'Pizza gratis! Kaffee für 2 €.', brand: 'Testrestaurant' };
  assert.equal(normalizeDealRecord(source).title, title, 'Do not replace a factual title with another offer');
}
assert.equal(normalizeDealRecord({title:'Kommentiere PIZZA!', description:'Die zweite Pizza übernehmen wir nicht. Die günstigere Pizza ist nicht gratis.', brand:'Testrestaurant'}).title, 'Kommentiere PIZZA!');
assert.equal(normalizeDealRecord({title:'Große Aktion: 2+1 Döner Wo', description:'Keine Adresse genannt.', brand:'Testrestaurant'}).title, 'Große Aktion: 2+1 Döner Wo');
assert.ok(inspectDealContentQuality({title:'Kommentiere PIZZA und folge uns', brand:'Testrestaurant'}).some(issue => issue.code === 'social-instruction-title'));
assert.ok(inspectDealContentQuality({title:'2+1 Döner', brand:'Wo?: Rußbergstraße 9'}).some(issue => issue.code === 'location-as-merchant'));
const before = { lastUpdated: '2026-10-21T00:00:00Z', deals: editorialCases.map((item, index) => ({ id: String(index), title: item.title, description: item.description, expires: '2026-11-01', url: 'https://example.test/' + index })) };
before.deals.push({ ...before.deals[0], id: 'manual', liveEditedFields: ['title'] });
before.deals.push({ ...before.deals[1], id: 'manual-description', description: 'Explicitly reviewed conditions', liveEditedFields: ['description'] });
const result = polishLiveDealTitles(before);
assert.equal(result.changes.length, 4);
assert.deepEqual(polishLiveDealTitles(result.bundle).changes, []);
assert.deepEqual(result.bundle.deals.map(deal => deal.id), before.deals.map(deal => deal.id));
result.bundle.deals.forEach((deal, index) => {
  for (const field of Object.keys(before.deals[index]).filter(key => !['title', 'description'].includes(key))) assert.deepEqual(deal[field], before.deals[index][field]);
});
assert.deepEqual(result.bundle.deals.slice(-2), before.deals.slice(-2));
const captionDeal = { title: 'Aktion', description: 'Kommentiere PIZZA und folge uns für einen Gutschein.' };
assert.equal(applyCardEditorial(captionDeal, { title: captionDeal.description, titleEvidence: captionDeal.description }, { titleVerified: true }).title, captionDeal.title);
console.log('Editorial offer-title checks passed');

import assert from 'node:assert/strict';
import { buildSlackMessage, filterDuplicateDealsInRun, normalizeDeal } from '../scraper/slack-notify.js';
import { polishOfferTitle } from '../scraper/offer-title-utils.js';
import { selectCoverageAccounts } from '../scraper/instagram-source-scheduler.js';
import { buildConfig, normalizeGraphMediaItem } from '../scraper/meta-instagram-deals.js';

const description = 'PRODUKT DER WOCHE! Unsere Lane Kekse – ganz oder gemahlen (300 g) gibt’s jetzt zum Aktionspreis! Nur 2,12 € statt 3,69 €! Gültig bis 31.10.2026. Nur solange der Vorrat reicht.';
assert.equal(polishOfferTitle('🤩 Nur 2,12 € statt 3,69 €!', description), '300 g Lane Kekse: 2,12 € statt 3,69 €');
assert.equal(polishOfferTitle('Nur 2,12 € statt 3,69 €!', description + ' Nur bei einem Einkauf ab 100 €.'), 'Nur 2,12 € statt 3,69 €!');
assert.equal(polishOfferTitle('Nur 2,12 € statt 3,69 €!', description + ' Unsere Cracker (200 g) gibt es ebenfalls zum Aktionspreis.'), 'Nur 2,12 € statt 3,69 €!');
const meter = '1 Meter Österreich: 50% off, now 26 € instead of 52 €, for 3 persons (8,67 € per person)';
assert.equal(polishOfferTitle(meter), '1 Meter Österreich: 26 € statt 52 € für 3 Personen');
const normalized = normalizeDeal({ id: 'new', title: '🤩 Nur 2,12 € statt 3,69 €!', description }, 'test');
assert.equal(normalized.title, '300 g Lane Kekse: 2,12 € statt 3,69 €');
const manual = { ...normalized, title: 'Unser freigegebener Titel', liveEditedFields: ['title'] };
assert.equal(normalizeDeal(manual, 'test').title, manual.title);
for (const protection of [{ liveEditedFields: ['title'] }, { editedInSlack: true }, { approvedAt: '2026-10-28T12:00:00Z' }]) {
  const protectedDeal = { ...normalized, ...protection, title: 'Nur 2,12 € statt 3,69 €!' };
  assert.equal(normalizeDeal(protectedDeal, 'test').title, protectedDeal.title, 'do not rewrite manually reviewed copy');
}

const review = buildSlackMessage({ id: 'review', title: 'Testangebot', brand: 'Cafe', description: 'Text '.repeat(70) + 'Nur für Mitglieder, nur bei Abholung und ab 20 € Mindestbestellung.',
  address: 'Testgasse 1, 1070 Wien', distance: 'Wien', pubDate: '2026-10-28T12:00:00Z',
  expires: '2026-11-01', expiryKind: 'review-ttl', expirySource: 'short-review-ttl' }, 1, {});
assert.match(review, /Nur für Mitglieder, nur bei Abholung und ab 20 € Mindestbestellung/);
assert.match(review, /Ort: Testgasse 1, 1070 Wien/);
assert.match(review, /Quellendatum: 28\.10\.2026/);
assert.match(review, /Gültig bis: k\.A\./);
assert.match(review, /Interne Prüffrist: 1\.11\.2026.*kein Angebotsende/);
assert.doesNotMatch(review, /Angebotsdatum:|Gültig bis: 1\.11\.2026/);

const official = { id: 'official', brand: 'IKEA', title: 'IKEA Family: Kindermenü gratis zum Hauptgericht ab 4,99 €',
  description: 'Vom 23.10. bis 2.11.2026 bekommen pro erwachsenem IKEA Family Mitglied, das ein warmes Hauptgericht ab 4,99 € konsumiert, maximal zwei Kinder bis 12 Jahre je ein Kindermenü gratis dazu. Nur im schwedischen Restaurant.',
  url: 'https://www.ikea.com/at/de/food/', validUntil: '2026-11-02' };
const duplicate = { id: 'discovered', brand: 'IKEA', title: 'Bis zu 2 Gratis-Kindermenüs (bis 12 Jahre) je Kind bei Bestellung eines warmen Hauptgerichts ab 4,99 €; IKEA Family',
  description: 'Teilnehmende IKEA Einrichtungshäuser in Österreich, darunter Wien Nord',
  expiresOriginal: '23.10.2026–02.11.2026 nicht angegeben', url: 'https://www.ikea.com/at/de/stores/neu-im-einrichtungshaus/' };
assert.equal(filterDuplicateDealsInRun([official, duplicate]).deals.length, 1);
for (const different of [
  { ...duplicate, title: duplicate.title.replace('4,99', '9,99') },
  { ...duplicate, title: duplicate.title.replace('bis 12', 'bis 10') },
  { ...duplicate, title: duplicate.title.replace('2 Gratis', '1 Gratis') },
  { ...duplicate, title: duplicate.title.replace('; IKEA Family', '') },
  { ...duplicate, expiresOriginal: '23.10.2026–02.12.2026' },
  { ...duplicate, expiresOriginal: '' },
  { ...duplicate, description: 'Nur in der Filiale Wien Nord.' },
  { ...duplicate, url: 'https://www.ikea.com/de/de/food/' },
]) assert.equal(filterDuplicateDealsInRun([official, different]).deals.length, 2, JSON.stringify(different));

const now = new Date('2026-10-29T12:00:00Z');
let mediaNumber = (BigInt(now.getTime()) - 1314220021300n) << 23n;
let shortcode = '';
while (mediaNumber > 0n) {
  shortcode = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[Number(mediaNumber % 64n)] + shortcode;
  mediaNumber /= 64n;
}
const cachedMeter = normalizeGraphMediaItem({ id: 'meter', timestamp: now.toISOString(),
  permalink: `https://www.instagram.com/p/${shortcode}/`,
  caption: 'Heimliche Rabattaktion im Centimeter Wien: Papa auf Urlaub, Sohn halbiert diese Woche die Preise!',
  _mediaEvidence: { ocrText: '1 Meter Österreich: die beliebtesten Speisen auf einer Platte. Statt 52 € jetzt 26 € für 3 Personen in Wien. Tisch reservieren.',
    ai: { isDeal: true, confidence: 0.95, exclusion: 'none', offerText: meter, locationText: 'Centimeter Wien' } } },
  { sourceType: 'account', sourceName: '@centimeter', account: { username: 'centimeter', category: 'food', verifiedVienna: true } },
  buildConfig({}, now), now);
assert(cachedMeter.deal, JSON.stringify(cachedMeter));
assert.equal(cachedMeter.deal.category, 'essen', 'a holiday in a restaurant caption is not a travel offer');
assert.equal(cachedMeter.deal.title, '1 Meter Österreich: 26 € statt 52 € für 3 Personen');
const food = { username: 'cafe', category: 'food', accountType: 'merchant' };
const others = Array.from({ length: 30 }, (_, i) => ({ username: `other${i}`, category: 'shopping' }));
const accounts = [food, ...others];
const chosen = selectCoverageAccounts(accounts, { maxAccountsPerRun: 20, foodAccountShare: 0.9 }, {}, now);
assert.equal(chosen.filter(x => x.selectionLane === 'other-rotation').length, 2, 'unspent food reservations must not become a broad non-food scan');
assert(chosen.some(x => x.username === 'cafe'));
const cooling = selectCoverageAccounts(accounts, { maxAccountsPerRun: 20, foodAccountShare: 0.9 },
  { accountPerformance: { cafe: { lastRunAt: now.toISOString() } } }, now);
assert(!cooling.some(x => x.username === 'cafe'), 'do not bypass source intervals to fill food slots');
assert.equal(selectCoverageAccounts(others, { maxAccountsPerRun: 20, foodAccountShare: 0 }, {}, now).length, 20);
assert.equal(selectCoverageAccounts(others, { maxAccountsPerRun: 20, foodAccountShare: 1 }, {}, now).length, 0);
assert.equal(selectCoverageAccounts(others, { maxAccountsPerRun: 30, foodAccountShare: 0.9, maxNonFoodAccounts: 2 }, {}, now).length, 2, 'backfill cannot expand the original non-food allowance');
console.log('PASS: clear source-backed titles, honest Slack dates, campaign duplicates and food quota reservations');

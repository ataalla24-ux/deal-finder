import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildConfig, classifyPromotion, retainMetaOutbox } from '../scraper/meta-instagram-deals.js';
import { compareSlackDeals } from '../scraper/slack-notify.js';
import { validateDealsForSlack } from '../scraper/deal-validity-agent.js';
import { getRejectionReason } from '../scraper/instagram-ai-agent.js';
import { retryQueuedEditorial } from '../scraper/card-editor-retry.js';

const now = new Date('2026-10-20T10:00:00Z');
const alcohol = [
  'Gratis Spritzer & Bier',
  '10 EUR Eintritt + 1 Bier oder Spritzer GRATIS bis 00:00 Uhr!',
  'Wiesn-Schnitzel mit Pommes und 6er-Tragerl Stiegl Bier fuer 10 EUR',
  'Happy Hour: Cocktails 4 EUR und Mocktails 2 EUR billiger.',
  'Gratis Weinverkostung in Wien',
  '1+1 gratis Spritzgetraenke',
  'Gratis Gin Tonic zur Pizza',
  '50% auf Longdrinks',
  'Gratis Bier und alkoholfreie Cocktails',
  'Gratis Bier, alkoholfreie Cocktails',
];
for (const text of alcohol) {
  assert.equal(classifyPromotion(text).accepted, false, `alcohol must be excluded: ${text}`);
  assert.equal(getRejectionReason({}, text, 100), 'alcohol-offer', 'AI rescue cannot override policy');
}

const { discoveryRejection, filterDiscoveryDeals, foodDiscoveryPriority } = await import('../scraper/deal-discovery-policy.js');
assert(buildConfig({}, now).adSearchTerms.every(t => !discoveryRejection(t)));
assert.deepEqual(buildConfig({ META_AD_LIBRARY_SEARCH_TERMS: 'Wien gratis Bier,Wien gratis Kaffee' }, now).adSearchTerms, ['Wien gratis Kaffee']);
for (const text of alcohol) assert.equal(discoveryRejection(text), 'alcohol-offer', text);
for (const text of [
  'Gratis Kaffee in Wien', '1+1 Pizza gratis', 'Gratis Ayran zum Doener',
  'Mocktails 2 EUR guenstiger', 'Alkoholfreie Cocktails 1+1 gratis',
  'Bier (alkoholfrei) 1+1 gratis', 'Alkoholfreies Bier gratis',
  'Alcohol-free beer 1+1', 'Non-alcoholic cocktails 50% off',
  'Bier 0,0% gratis', '0.0% Bier gratis', 'Bier ohne Alkohol gratis',
  'Kaffee gratis, kein Alkohol', 'Schnitzel vom Schwein um 5 EUR',
  'Pizza bei Weingartenallee 22', 'Gratis Haarschnitt in Wien',
  'Gratis Museumseintritt am Sonntag', 'Gratis Kaffee bei kostenloser Besichtigung',
  'Kommt heute rum, Pizza 1+1 gratis!', '20% aufs Essen, ausgenommen Bier und Wein',
]) assert.equal(discoveryRejection(text), '', text);
assert.equal(discoveryRejection({ title: 'Google rankt Seiten. Coaching und Workshops.', socialFoodReview: true }), 'non-food-review');
assert.equal(discoveryRejection({ title: '50% Rabatt aufs Essen', socialFoodReview: true }), '');
assert.equal(discoveryRejection({ title: 'Restaurant-Gutschein: 20% Rabatt', socialFoodReview: true }), '');
assert.equal(discoveryRejection({ title: 'Vollmilch 3,5 % um 25 % billiger', socialFoodReview: true }), '');
assert.equal(discoveryRejection({ title: 'Neues Dessert: 1+1 gratis', socialFoodReview: true }), '');
assert.equal(discoveryRejection({ title: 'Gratis Museumseintritt am Sonntag', category: 'kultur' }), '');
assert.equal(discoveryRejection({ title: 'Pizza 1+1 gratis', brand: 'Bier und Wein Bar', address: 'Weingasse 1' }), '');
for (const text of [
  'Kostenloses 30-minuetiges Erstgespraech fuer Teamcoaching',
  'Kostenlose Besichtigung fuer Musterwohnungsraeumung in Wien',
  'BUWOG auf der Erste Wohnmesse: gratis Ticket sichern und zu Wohnungen beraten lassen',
  'Jaresi Reservierungssoftware fuer Restaurants: Free-Tarif ohne Gebuehr pro Gast',
  'Gratis Webseiten-Check fuer Selbststaendige',
]) assert.equal(discoveryRejection(text), 'business-lead-generation', text);
assert.equal(foodDiscoveryPriority({ title: '1+1 Pizza gratis', category: 'shopping' }), 1);
assert.equal(foodDiscoveryPriority({ title: 'Gratis Eintritt zum Konzert', category: 'essen' }), 0);
assert.equal(foodDiscoveryPriority({ title: 'Cocktails 50% guenstiger', category: 'essen' }), 0);
for (const title of ['Alkoholfreies Bier gratis', 'Non-alcoholic cocktails 50% off', 'Bier 0,0% gratis']) {
  assert.equal(foodDiscoveryPriority({ title }), 1, 'explicit alcohol-free drinks remain food candidates');
}
const sorted = [
  { title: 'Gratis Museumseintritt', qualityScore: 99 },
  { title: 'Gratis Kaffee', qualityScore: 80 },
].sort(compareSlackDeals);
assert.equal(sorted[0].title, 'Gratis Kaffee');

const pending = [
  { id: 'food', title: 'Gratis Kaffee' },
  { id: 'alcohol', title: 'Gratis Bier', socialFoodReview: true },
  { id: 'lead', title: 'Kostenlose Besichtigung fuer eine Wohnung', firecrawlReview: true },
];
const baseline = JSON.stringify(pending);
const filtered = filterDiscoveryDeals(pending);
assert.deepEqual(filtered.deals.map(d => d.id), ['food']);
assert.deepEqual(filtered.reasonCounts, { 'alcohol-offer': 1, 'business-lead-generation': 1 });
assert.equal(JSON.stringify(pending), baseline, 'filter must not edit stored evidence or Slack history');
let editorCalls = 0;
await retryQueuedEditorial([{ title: 'Gratis Bier', cardEditorial: {}, slackTs: '1', slackThreadTs: '1' }], {
  enabled: true,
  editCard: async d => { editorCalls++; return d; },
  isUntouched: async () => { editorCalls++; return true; },
  updateMessage: async () => { editorCalls++; return true; },
  persist: async () => { editorCalls++; },
});
assert.equal(editorCalls, 0, 'excluded old cards must not spend editorial quota or update Slack');

const legacy = { id: 'meta-ig-123', title: 'Gratis Bier', pubDate: now.toISOString() };
assert.deepEqual(retainMetaOutbox([], [legacy], now), []);
const validated = await validateDealsForSlack([{
  ...legacy, description: 'Gratis Bier am 20.10.2026 in 1070 Wien.',
  brand: 'Test', url: 'https://example.com/angebot', category: 'essen', type: 'gratis',
  validUntil: '2026-10-20', distance: '1070 Wien',
}], { now, inspectDealUrlHealth: async () => ({ status: 200, contentHints: {}, dateHints: {} }) });
assert.equal(validated.allowedDeals.length, 0, 'older Slack cards must also fail approval');
assert(validated.results[0].decision.reasons.some(r => r.includes('alcohol-offer')));
const source = fs.readFileSync(new URL('../scraper/slack-notify.js', import.meta.url), 'utf8');
assert.match(source, /filterDiscoveryDeals\(\s*\[\.\.\.pendingDeals, \.\.\.key4ReviewDeals, \.\.\.socialFoodArtifactDeals\]/);
assert.match(source, /freshDeals\.sort\(compareSlackDeals\)/);
console.log('Food discovery policy: alcohol, harmless exceptions, real Slack lead spam, food priority, all dispatch lanes and old-card approval passed.');

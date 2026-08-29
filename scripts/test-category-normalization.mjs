import assert from 'node:assert/strict';

import { normalizeCategoryForScraper } from '../scraper/category-utils.js';
import { normalizeDealRecord } from '../scraper/deal-normalization-utils.js';

assert.equal(
  normalizeCategoryForScraper('shopping', [
    'Gratis 2. Schnitzel mit Schulzeugnis',
    'Centimeter Wien',
  ]),
  'essen',
  'Schnitzel deals should normalize from shopping to food',
);

assert.equal(
  normalizeDealRecord({
    brand: 'lisa.maria.b',
    ownerUsername: 'lisa.maria.b',
    title: 'Indoor-Minigolf mitten in Wien',
    description: '10% Rabatt bei Balls & Clubs.',
    category: 'essen',
    type: 'rabatt',
  }).category,
  'freizeit',
  'strong activity evidence should override a wrong food category',
);

assert.equal(
  normalizeDealRecord({
    brand: 'Bezirksvorstehung Mariahilf',
    title: 'Gratis Sport- und Spielefest für Kids im Esterhazypark',
    category: 'essen',
    type: 'gratis',
  }).category,
  'freizeit',
  'sport and games events should not remain in the food category',
);

assert.equal(
  normalizeDealRecord({
    brand: 'EVO Fitness',
    title: '7 Tage kostenloses Probetraining',
    category: 'essen',
    type: 'gratis',
  }).category,
  'fitness',
  'strong fitness evidence should override a wrong food category',
);

assert.equal(
  normalizeDealRecord({
    brand: 'Afterfive',
    title: 'Gratis-Eintritt zum Open-Air-Event: Volksgarten Pavillon',
    description: 'Free Entry, Drinks und House Music am 11.09.2026 im Volksgarten Pavillon Wien.',
    category: 'essen',
    type: 'gratis',
  }).category,
  'kultur',
  'Afterfive free-entry events must not be categorized as food because of drink mentions',
);

assert.equal(
  normalizeCategoryForScraper('shopping', [
    'Tomochan Ramen',
    'Gratis Ramen',
  ]),
  'essen',
  'Ramen deals should normalize from shopping to food',
);

assert.equal(
  normalizeDealRecord({
    brand: 'Centimeter_vienna',
    title: 'Gratis 2. Schnitzel mit Schulzeugnis',
    description: 'Gratis 2. Schnitzel mit Schulzeugnis in Wien',
    category: 'shopping',
    type: 'gratis',
  }).category,
  'essen',
  'normalizeDealRecord should correct food deals before they reach the live feed',
);

assert.equal(
  normalizeDealRecord({
    brand: 'OMV VIVA',
    title: 'Gratis Coconut Strawberry Sunset testen',
    description: '',
    category: 'supermarkt',
    type: 'gratis',
    distance: 'OMV Stationen Wien',
  }).category,
  'kaffee',
  'OMV VIVA drink deals should normalize to the drink/coffee category',
);

assert.equal(
  normalizeDealRecord({
    brand: 'OMV VIVA',
    title: 'OMV VIVA: 50% auf Sandwiches',
    description: '',
    category: 'supermarkt',
    type: 'rabatt',
    distance: 'OMV Stationen Wien',
  }).category,
  'essen',
  'OMV VIVA sandwich deals should not stay in supermarket',
);

assert.equal(
  normalizeCategoryForScraper('shopping', [
    '1+1 Aktion auf Schokoerdbeeren',
    'Beim Kauf eines Bechers gibt es einen zweiten kostenlos dazu',
    'Chocoberry Wien',
  ]),
  'essen',
  'Schokoerdbeeren should normalize from shopping to food',
);

assert.equal(
  normalizeCategoryForScraper('beauty', [
    'Gratis Eis in teilnehmenden Eissalons',
    'Raiffeisen RaiffEIStag in Wien, NÖ und Burgenland',
  ]),
  'essen',
  'ice cream deals should normalize from beauty to food',
);

assert.equal(
  normalizeCategoryForScraper('shopping', [
    'Gratis Eis in teilnehmenden Eissalons',
    'Raiffeisen RaiffEIStag in Wien, NÖ und Burgenland',
  ]),
  'essen',
  'ice cream deals should normalize from shopping to food',
);

assert.notEqual(
  normalizeCategoryForScraper('events', [
    'Hillsong Vienna Events',
    'Community genießen und unserer Stadt dienen',
    'Freikirchen Wien',
  ]),
  'essen',
  'Hillsong event copy must not match food via genießen',
);

assert.equal(
  normalizeCategoryForScraper('events', [
    'Hillsong Vienna Events',
    'Events oder gemeinsam im Gottesdienst',
  ]),
  'events',
  'Church event entries should stay events, not Gottesdienste',
);

assert.equal(
  normalizeCategoryForScraper('events', [
    'CIG Wien Events',
    'Community und Treffen',
  ]),
  'events',
  'CIG event entries should stay events',
);

console.log('Category normalization checks passed.');

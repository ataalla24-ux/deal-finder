import assert from 'node:assert/strict';

import { normalizeCategoryForScraper } from '../scraper/category-utils.js';

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

console.log('Category normalization checks passed.');

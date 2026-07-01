import assert from 'node:assert/strict';

import { normalizeDealRecord } from '../scraper/deal-normalization-utils.js';

function expectNormalizedLogo(name, rawDeal, expected) {
  const normalized = normalizeDealRecord(rawDeal);
  for (const [key, value] of Object.entries(expected)) {
    if (key === 'logoUrlIncludes') {
      assert.match(normalized.logoUrl || '', value, `${name}: logoUrl`);
    } else {
      assert.equal(normalized[key], value, `${name}: ${key}`);
    }
  }
}

expectNormalizedLogo(
  'cached FreeFinder brand logo is preserved',
  {
    brand: 'CIG Wien',
    logo: '⛪',
    logoUrl: 'https://freefinder.at/assets/brand-logos/cig-wien-cigwien-at.png',
    title: 'CIG Wien',
    description:
      '⛪ CIG Wien - Christliche Internationale Gemeinde / Kirche - CIG - Christliche Internationale Gemeinde Wien. Evangelikale, zweisprachige Kirche in Wien.',
    type: 'gratis',
    category: 'kirche',
    source: 'Freikirchen Wien',
    url: 'https://www.cigwien.at',
    distance: 'Leebgasse 34, 1100 Wien',
  },
  {
    logo: '⛪',
    logoUrl: 'https://freefinder.at/assets/brand-logos/cig-wien-cigwien-at.png',
  },
);

expectNormalizedLogo(
  'CIG church text does not trigger Eis fallback',
  {
    brand: 'CIG Wien',
    logo: '⛪',
    logoUrl: 'https://www.google.com/s2/favicons?sz=128&domain_url=https://www.cigwien.at',
    title: 'CIG Wien',
    description:
      '⛪ CIG Wien - Christliche Internationale Gemeinde / Kirche - CIG - Christliche Internationale Gemeinde Wien. Evangelikale, zweisprachige Kirche in Wien.',
    type: 'gratis',
    category: 'kirche',
    source: 'Freikirchen Wien',
    url: 'https://www.cigwien.at',
    distance: 'Leebgasse 34, 1100 Wien',
  },
  {
    logo: '⛪',
    logoUrlIncludes: /cigwien\.at/,
  },
);

expectNormalizedLogo(
  'dominant title brand beats wrong submitted provider',
  {
    brand: "Dunkin'",
    title: 'Starbucks Austria gratis Kaffee am Geburtstag',
    description: 'Gratis Kaffee im Starbucks Store.',
    type: 'gratis',
    category: 'kaffee',
    url: 'https://www.instagram.com/reel/example/',
  },
  {
    brand: 'Starbucks',
    logo: '☕',
    logoUrlIncludes: /starbucks\.at/,
  },
);

expectNormalizedLogo(
  'wrong cached logo is replaced when brand is corrected',
  {
    brand: "Dunkin'",
    logoUrl: 'https://freefinder.at/assets/brand-logos/dunkin-dunkin-at.png',
    title: 'Starbucks Austria gratis Kaffee am Geburtstag',
    description: 'Gratis Kaffee im Starbucks Store.',
    type: 'gratis',
    category: 'kaffee',
    url: 'https://www.instagram.com/reel/example/',
  },
  {
    brand: 'Starbucks',
    logo: '☕',
    logoUrlIncludes: /starbucks\.at/,
  },
);

expectNormalizedLogo(
  'known brand ignores publisher favicon',
  {
    brand: 'Westfield Club',
    logo: '🛍️',
    logoUrl: 'https://www.google.com/s2/favicons?sz=128&domain_url=https://kurier.at',
    title: '1+1 Gratis Pancake-Kaffee Combo',
    description: 'Westfield Club Angebot in der SCS.',
    type: 'bogo',
    category: 'shopping',
    source: 'Vienna Promo Radar',
    url: 'https://news.google.com/rss/articles/example',
  },
  {
    brand: 'Westfield Club',
    logo: '🛍️',
    logoUrlIncludes: /westfield\.com/,
  },
);

expectNormalizedLogo(
  'direct unknown provider host can supply logo',
  {
    brand: 'Rooni Restaurant',
    title: 'Gratis Ramen zur Eröffnung',
    description: 'Rooni Restaurant Wien',
    type: 'gratis',
    category: 'essen',
    url: 'https://rooni.at/menu',
  },
  {
    logo: '🍜',
    logoUrlIncludes: /rooni\.at/,
  },
);

expectNormalizedLogo(
  'source-like social host is not used as brand logo',
  {
    brand: 'krimskramsmensch',
    title: 'Ramen Deal in Wien',
    description: 'Instagram Reel mit Food-Angebot',
    type: 'rabatt',
    category: 'essen',
    url: 'https://www.instagram.com/reel/DZ4k5fCOVAK/',
  },
  {
    logo: '🍜',
    logoUrl: '',
  },
);

expectNormalizedLogo(
  'submitted social handle brand is prettified and gets cached domain logo',
  {
    id: 'community:0dac331a-eeb2-42e8-b2bb-e8f1e2aa5007',
    brand: 'Centimeter_vienna',
    title: 'Gratis 2. Schnitzel mit Schulzeugnis',
    description: '1.7 - 7.7: Bestelle ein Schnitzel, das 2. gibt es gratis dazu.',
    type: 'gratis',
    category: 'essen',
    url: 'https://www.instagram.com/reel/example/',
  },
  {
    brand: 'Centimeter Wien',
    logo: '🍽️',
    logoUrlIncludes: /centimeter\.at/,
  },
);

expectNormalizedLogo(
  'OMV VIVA variants keep the cafe brand instead of generic OMV',
  {
    id: 'joe-omv-viva-free-taste-flur7',
    brand: 'OMV',
    logoUrl: 'https://freefinder.at/assets/brand-logos/omv-viva-omv-at.png',
    title: 'Gratis Sunny Orange Espresso testen',
    description: 'Gratis • Gratis Sunny Orange Espresso testen • OMV Stationen Wien • 2026-08-30T23:59:59.999Z',
    type: 'gratis',
    category: 'kaffee',
    url: 'https://www.joe-club.at/partner/omv#sunny-orange-espresso',
  },
  {
    brand: 'OMV VIVA',
    description: '',
    logoUrl: 'https://freefinder.at/assets/brand-logos/omv-viva-omv-at.png',
  },
);

expectNormalizedLogo(
  'mojibake text is repaired in visible fields',
  {
    brand: 'Therme Wien',
    title: '50% Rabatt bei Therme Wien',
    description: '50% Rabatt bei Therme Wien für Drei Kunden',
    type: 'rabatt',
    category: 'kultur',
    url: 'https://www.drei.at/de/dreiplus/ersparnisse/therme-wien/',
    distance: 'Ãsterreich',
    expiryDisplayText: 'regelmÃ¤Ãig / laut Quelle',
  },
  {
    brand: 'Therme Wien',
    distance: 'Österreich',
    expiryDisplayText: '',
    logoUrlIncludes: /thermewien\.at/,
  },
);

console.log('Deal logo normalization checks passed.');

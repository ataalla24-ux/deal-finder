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

console.log('Deal logo normalization checks passed.');

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
  'social creator is replaced by the merchant named in the title',
  {
    brand: 'Shaysfoodblog',
    ownerUsername: 'shaysfoodblog',
    title: '1+1 bei Burgerking nur bei der Foodora bis zum 31.08.',
    description: 'Burger Deal über foodora.',
    type: 'bogo',
    category: 'essen',
    url: 'https://www.instagram.com/reel/example/',
  },
  {
    brand: 'Burger King',
    logo: '🍔',
    logoUrlIncludes: /burgerking\.at/,
  },
);

expectNormalizedLogo(
  'generic benefit copy is replaced by the provider from its target URL',
  {
    brand: 'attraktive Preise warten',
    title: '1+1 gratis bei attraktive Preise warten',
    description: '',
    type: 'bogo',
    category: 'technik',
    url: 'https://www.magenta.at/magenta-moments',
  },
  {
    brand: 'Magenta Moments',
    title: '1+1 gratis bei Magenta Moments',
    logoUrlIncludes: /magenta\.at/,
  },
);

expectNormalizedLogo(
  'generic online location is replaced by the product brand',
  {
    brand: 'Online / Österreich',
    title: '130€ Umdenkbonus + 5€ Gutschein extra',
    description: 'Aktuelle Top AEG Gutscheine',
    type: 'gratis',
    category: 'shopping',
    url: 'https://www.gutscheine.at/aeg',
  },
  {
    brand: 'AEG',
    title: '130 € Umdenkbonus + 5 € Gutschein extra',
    type: 'gutschein',
  },
);

expectNormalizedLogo(
  'creator handle is replaced by a venue named in the title',
  {
    brand: '@kseniainvienna',
    title: 'Film Festival am Rathausplatz',
    type: 'gratis',
    category: 'kultur',
    url: 'https://www.tiktok.com/@kseniainvienna/video/example',
  },
  {
    brand: 'Film Festival am Rathausplatz',
    logo: '🎬',
  },
);

expectNormalizedLogo(
  'English numeric BOGO copy is normalized',
  {
    brand: 'Vienna Marriott Cascade Bar',
    title: 'Happy Hour: Buy 1 get 1 free drink (für 12,50€)',
    description: 'free',
    type: 'gratis',
    category: 'essen',
    url: 'https://www.viennamarriott-restaurants.com/en/cascade-bar',
  },
  {
    title: 'Happy Hour: 1+1 Drink (für 12,50 €)',
    type: 'bogo',
    description: '',
  },
);

expectNormalizedLogo(
  'coupon boilerplate does not turn a percentage discount into a free deal',
  {
    brand: 'Oral-B',
    title: '10% Gutschein für alles',
    description: 'Aktuelle Gutscheine, frisch geprüft & kostenlos sichern.',
    type: 'gratis',
    category: 'shopping',
    url: 'https://www.gutscheine.at/oral-b',
  },
  {
    type: 'rabatt',
    logo: '🏷️',
    description: '',
  },
);

expectNormalizedLogo(
  'euro coupon remains a voucher despite free aggregator boilerplate',
  {
    brand: 'TUI',
    title: '40 € TUI Coupon für Top-Reiseziele',
    description: 'Aktuelle Gutscheine, frisch geprüft & kostenlos sichern.',
    type: 'gratis',
    category: 'reisen',
    url: 'https://www.gutscheine.at/tui',
  },
  {
    type: 'gutschein',
    description: '',
  },
);

expectNormalizedLogo(
  'generic benefit-page call to action is not shown as a deal description',
  {
    brand: 'Nordsee',
    title: '1+1 Wrap gratis bei Nordsee',
    description: 'Hier erfährst du mehr über deinen Vorteil bei Nordsee >> informieren',
    type: 'bogo',
    category: 'essen',
    url: 'https://www.drei.at/de/dreiplus/ersparnisse/nordsee/',
  },
  {
    description: '',
  },
);

expectNormalizedLogo(
  'written Pizzamann buy-two-get-one copy is BOGO and expiry text is deduplicated',
  {
    brand: 'Pizzamann',
    title: 'Gratis Extra-Pizza jeden Donnerstag bei Pizzamann',
    description: 'Beim Kauf von 2 Pizzen ist die günstigere gratis dazu. >> Mehr erfahren',
    type: 'freebie',
    category: 'essen',
    expiresOriginal: 'jeden Donnerstag Donnerstag',
    url: 'https://www.drei.at/de/dreiplus/ersparnisse/pizza-mann/',
  },
  {
    type: 'bogo',
    description: 'Beim Kauf von 2 Pizzen ist die günstigere gratis dazu.',
    expiresOriginal: 'jeden Donnerstag',
  },
);

expectNormalizedLogo(
  'truncated Pizzamann qualifier is removed and 2 plus 1 is BOGO',
  {
    brand: 'Pizzamann',
    title: 'Jeden Donnerstag: 2 Pizzen kaufen, 1 Pizza gratis (für Drei',
    description: 'Beim Kauf von 2 Pizzen ist 1 Pizza gratis.',
    type: 'freebie',
    category: 'essen',
    url: 'https://www.drei.at/de/business/vorteile/pizzamann/',
  },
  {
    title: 'Jeden Donnerstag: 2 Pizzen kaufen, 1 Pizza gratis',
    type: 'bogo',
  },
);

expectNormalizedLogo(
  'social creator is replaced by the merchant named in the description',
  {
    brand: 'lisa.maria.b',
    ownerUsername: 'lisa.maria.b',
    title: 'Indoor-Minigolf mitten in Wien',
    description: '10% Rabattcode LISAMARIA bei ballsandclubs.austria.',
    type: 'rabatt',
    category: 'essen',
    url: 'https://www.instagram.com/reel/example/',
  },
  {
    brand: 'Balls & Clubs',
    category: 'freizeit',
    logo: '⛳',
    logoUrlIncludes: /ballsandclubs\.at/,
  },
);

expectNormalizedLogo(
  'visible HTML entities are decoded',
  {
    brand: 'Lieferando',
    title: 'Gratis Lieferando+',
    description: '3 Monate keine Liefergeb&uuml;hren &amp; gratis Zustellung',
    type: 'gratis',
    category: 'essen',
    url: 'https://www.lieferando.at/',
  },
  {
    description: '3 Monate keine Liefergebühren & gratis Zustellung',
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
  'KFC on a Lieferando target keeps the KFC emblem',
  {
    brand: 'KFC Wien',
    logo: '🛵',
    logoUrl: 'https://freefinder.at/assets/brand-logos/kfc-wien-lieferando-at.png',
    title: '2 for 1 Deal (Buy one get one free)',
    description: 'KFC Standorte in Wien',
    type: 'bogo',
    category: 'essen',
    url: 'https://www.lieferando.at/en/menu/kfc-wien-millennium-city',
  },
  {
    brand: 'KFC',
    logo: '🍗',
    logoUrl: 'https://freefinder.at/assets/brand-logos/kfc-wien-kfc-at.png',
  },
);

expectNormalizedLogo(
  'Lieferando uses its cached high resolution emblem',
  {
    brand: 'Lieferando',
    title: 'Gratis Lieferando+ für 90 Tage',
    description: 'Exklusiv für Drei Kund:innen.',
    type: 'gratis',
    category: 'essen',
    url: 'https://www.drei.at/de/dreiplus/ersparnisse/lieferando/',
  },
  {
    brand: 'Lieferando',
    logo: '🛵',
    logoUrl: 'https://freefinder.at/assets/brand-logos/lieferando-lieferando-at.png',
  },
);

expectNormalizedLogo(
  'Vapiano uses its cached official emblem',
  {
    brand: 'Vapiano',
    title: '1+1 gratis Pizza (Studentenrabatt)',
    description: 'Vapiano Wien Studentenrabatt.',
    type: 'bogo',
    category: 'essen',
    url: 'https://www.vapiano.at/',
  },
  {
    brand: 'Vapiano',
    logo: '🍝',
    logoUrl: 'https://freefinder.at/assets/brand-logos/vapiano-vapiano-at.png',
  },
);

expectNormalizedLogo(
  'OMV VIVA uses its cropped official emblem',
  {
    brand: 'OMV VIVA',
    title: 'Gratis Iced Matcha Latte testen',
    description: 'Gratis in OMV Stationen Wien testen.',
    type: 'gratis',
    category: 'kaffee',
    url: 'https://www.joe-club.at/partner/omv',
  },
  {
    brand: 'OMV VIVA',
    logo: '⛽',
    logoUrl: 'https://freefinder.at/assets/brand-logos/omv-viva-omv-at.png',
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

expectNormalizedLogo(
  'Intersport is not mistaken for SPAR',
  {
    brand: 'Intersport',
    title: 'Bikeleasing mit FIRMENRADL und spare bis zu 42 %',
    description: 'Aktuelles Angebot von Intersport.',
    type: 'rabatt',
    category: 'sport',
    source: 'Intersport',
    url: 'https://www.intersport.at/firmenradl/',
  },
  {
    brand: 'Intersport',
    logo: '⛷️',
    logoUrlIncludes: /intersport\.at/,
  },
);

expectNormalizedLogo(
  'the verb sparen does not replace the Apple brand with SPAR',
  {
    brand: 'Apple',
    title: 'AppleCare+ für Studierende',
    description: 'Qualifizierte Studierende und Lehrkräfte sparen bis zu 10 %.',
    type: 'rabatt',
    category: 'technik',
    source: 'Apple Store',
    url: 'https://www.apple.com/at-edu/shop/',
  },
  {
    brand: 'Apple',
    logo: '🍎',
    logoUrlIncludes: /apple\.com/,
  },
);

console.log('Deal logo normalization checks passed.');

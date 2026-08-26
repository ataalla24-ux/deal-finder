import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { normalizeDealRecord } from '../scraper/deal-normalization-utils.js';
import { repairCachedLogoReference } from './cache-deal-logos.mjs';

const logoTestDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deal-logo-cache-'));
await fs.writeFile(path.join(logoTestDir, 'present.png'), Buffer.from([1, 2, 3]));
const logoBaseUrl = 'https://freefinder.at/assets/brand-logos';
const presentCachedLogo = await repairCachedLogoReference({
  brand: 'Present',
  logoUrl: `${logoBaseUrl}/present.png`,
}, { logoDir: logoTestDir, publicBaseUrl: logoBaseUrl });
assert.equal(presentCachedLogo.invalid, false);
const missingCachedLogo = await repairCachedLogoReference({
  brand: 'Missing',
  logoUrl: `${logoBaseUrl}/missing.png`,
}, { logoDir: logoTestDir, publicBaseUrl: logoBaseUrl });
assert.equal(missingCachedLogo.invalid, true);
assert.equal(missingCachedLogo.deal.logoUrl, '', 'a missing cached logo is cleared instead of aborting approvals');
const unsafeCachedLogo = await repairCachedLogoReference({
  brand: 'Unsafe',
  logoUrl: `${logoBaseUrl}/..%2Fsecret.png`,
}, { logoDir: logoTestDir, publicBaseUrl: logoBaseUrl });
assert.equal(unsafeCachedLogo.invalid, true);
assert.equal(unsafeCachedLogo.deal.logoUrl, '');
await fs.rm(logoTestDir, { recursive: true, force: true });

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
    logoUrlIncludes: /brand-logos\/cig-wien-cigwien-at\.png$/,
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
    logoUrlIncludes: /brand-logos\/starbucks-starbucks-at\.png$/,
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
    logoUrlIncludes: /brand-logos\/burger-king-burgerking-at\.png$/,
  },
);

expectNormalizedLogo(
  'delivery platform logo does not replace an unknown restaurant emblem',
  {
    brand: 'Duru Juicy Kebabs',
    title: '1+1 deals, -30% discounts',
    description: 'Wolt makes it incredibly easy for you to discover and get what you want. Delivered to your home and office',
    type: 'bogo',
    category: 'essen',
    distance: 'Vienna, Austria',
    logoUrl: 'https://www.google.com/s2/favicons?sz=256&domain_url=https://wolt.com',
    url: 'https://wolt.com/de/aut/vienna/restaurant/duru-juicy-kebabs',
  },
  {
    brand: 'Duru Juicy Kebabs',
    title: '1+1-Angebote und 30% Rabatt bei Duru Juicy Kebabs',
    description: '',
    distance: 'Wien',
    type: 'bogo',
    logo: '🌯',
    logoUrl: '',
  },
);

expectNormalizedLogo(
  'social handle fragments before a pinned street address are removed',
  {
    brand: 'Balls & Clubs',
    title: '10% Rabatt auf Indoor-Minigolf bei Balls & Clubs',
    type: 'rabatt',
    category: 'freizeit',
    distance: 'ballsandclubs.austria 📍 Wollzeile 16, 1010 Wien',
  },
  {
    distance: 'Wollzeile 16, 1010 Wien',
  },
);

expectNormalizedLogo(
  'English BOGO title and multi-location text are localized',
  {
    brand: 'Burger King',
    title: '1+1 Crispy Chicken Sandwich Free',
    description: 'Two sandwiches for the price of one.',
    type: 'bogo',
    category: 'essen',
    distance: 'Multiple locations in Vienna',
  },
  {
    title: '1+1 Crispy Chicken Sandwich bei Burger King',
    distance: 'Mehrere Standorte in Wien',
  },
);

expectNormalizedLogo(
  'truncated scraped descriptions are hidden',
  {
    brand: 'Lieferando',
    title: '10 € Rabatt ab 20 € Bestellwert',
    description: 'Bei Lieferando gibt es 10 € Rabatt für Neukunden (ab 20 €',
    type: 'rabatt',
    category: 'essen',
  },
  {
    description: '',
  },
);

expectNormalizedLogo(
  'generic offer overview copy is not shown as a deal description',
  {
    brand: 'IKEA',
    title: 'Frühstück für 1 Euro',
    description: 'Entdecke die besten Angebote bei IKEA Österreich. Spare bei Möbeln, Deko und Haushaltsgeräten – alle laufenden Aktionen auf einen Blick!',
    type: 'rabatt',
    category: 'essen',
  },
  {
    description: '',
  },
);

expectNormalizedLogo(
  'description that only repeats title, validity and location is hidden',
  {
    brand: 'Alfies',
    title: '10 € Rabatt bei Alfies mit Code LISAMARIA10',
    description: '10€ Rabatt bei Alfies mit Code LISAMARIA10, gültig bis 26. August 2026 in Wien.',
    type: 'rabatt',
    category: 'supermarkt',
    distance: 'Wien',
    expiresOriginal: '2026-08-26',
  },
  {
    description: '',
  },
);

expectNormalizedLogo(
  'known brands use bundled high-resolution emblems',
  {
    brand: 'IKEA Restaurant',
    title: 'Frühstück für 1 Euro',
    type: 'rabatt',
    category: 'essen',
    url: 'https://www.ikea.com/at/de/stores/restaurant/',
  },
  {
    brand: 'IKEA',
    logoUrlIncludes: /brand-logos\/ikea-restaurant-ikea-com\.png$/,
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
    logoUrlIncludes: /brand-logos\/magenta-moments-magenta-at\.png$/,
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
    logoUrlIncludes: /brand-logos\/pizzamann-pizzamann-at\.png$/,
  },
);

expectNormalizedLogo(
  'Ryanair uses its bundled high-resolution app emblem',
  {
    brand: 'Ryanair',
    title: 'Flüge ab 19,99 €',
    type: 'rabatt',
    category: 'reisen',
    url: 'https://www.ryanair.com/at/de',
  },
  {
    logoUrlIncludes: /brand-logos\/ryanair-ryanair-com\.png$/,
  },
);

expectNormalizedLogo(
  'Wolt uses its bundled high-resolution app emblem',
  {
    brand: 'Wolt',
    title: '12 € Gutschein bei Wolt',
    type: 'gutschein',
    category: 'essen',
    url: 'https://wolt.com/de/aut/vienna',
  },
  {
    logoUrlIncludes: /brand-logos\/wolt-wolt-com\.png$/,
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
    logoUrlIncludes: /brand-logos\/balls-and-clubs-ballsandclubs-at\.png$/,
    description: '18 abwechslungsreiche Indoor-Minigolf-Bahnen in der Wollzeile 16, 1010 Wien; Online-Reservierung empfohlen.',
  },
);

expectNormalizedLogo(
  'merchant brand polluted with a repeated promo code is repaired',
  {
    brand: 'Balls&Clubs Minigolf Wien mit Code LISAMARIA',
    title: '10% Rabatt auf Indoor-Minigolf bei Balls&Clubs Minigolf Wien mit Code LISAMARIA mit Code LISAMARIA',
    description: '18 abwechslungsreiche Indoor-Minigolf-Bahnen in der Wollzeile 16, 1010 Wien; Online-Reservierung empfohlen.',
    type: 'rabatt',
    category: 'freizeit',
    url: 'https://www.instagram.com/reel/example/',
  },
  {
    brand: 'Balls & Clubs',
    title: '10% Rabatt auf Indoor-Minigolf bei Balls & Clubs mit Code LISAMARIA',
    logo: '⛳',
    logoUrlIncludes: /brand-logos\/balls-and-clubs-ballsandclubs-at\.png$/,
  },
);

expectNormalizedLogo(
  'known truncated Foodsharing copy is replaced with a complete sentence',
  {
    brand: 'Foodsharing',
    title: 'GRATIS Lebensmittel abholen',
    description: 'Auf foodsharing.de kannst du deine Lebensmittel vor dem Verfall an soziale Einrichtungen oder andere Personen',
    type: 'gratis',
    category: 'essen',
    url: 'https://foodsharing.at/',
  },
  {
    description: 'Über foodsharing.at kannst du Lebensmittel kostenlos retten, teilen und abholen.',
  },
);

expectNormalizedLogo(
  'serialized object placeholders are not user-facing descriptions',
  {
    brand: 'OMV VIVA',
    title: 'Gratis Iced Matcha Latte testen',
    description: '[object Object]',
    type: 'gratis',
    category: 'kaffee',
  },
  {
    description: '',
  },
);

expectNormalizedLogo(
  'generic coupon directory copy is not used as a deal description',
  {
    brand: 'Lieferando',
    title: '12 € Rabatt auf erste Bestellung (Neukunden)',
    description: 'Alle aktuellen Lieferando Gutscheine & Rabatte auf GuteGutscheine.at einlösen und sofort profitieren: Lieferando.at Gutschein: 10% Rabatt mit derm Stempelkarten-Programm.',
    type: 'rabatt',
    category: 'essen',
  },
  {
    description: '',
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
    logoUrlIncludes: /brand-logos\/starbucks-starbucks-at\.png$/,
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
    logoUrlIncludes: /brand-logos\/westfield-club-westfield-com\.png$/,
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
  'Joom is not confused with the similarly named joe club',
  {
    id: 'gs-17484',
    brand: 'joo',
    title: '10% Gutschein für alles bei joo',
    type: 'rabatt',
    category: 'supermarkt',
    url: 'https://www.gutscheine.at/joom',
    logoUrl: 'https://freefinder.at/assets/brand-logos/joo-joe-club-at.png',
  },
  {
    brand: 'Joom',
    title: '10% Gutschein für alles bei Joom',
    category: 'shopping',
    logo: '🛒',
    logoUrlIncludes: /domain_url=https:\/\/joom\.com$/,
  },
);

expectNormalizedLogo(
  'joe club URLs still resolve to the full loyalty-club brand',
  {
    brand: 'jö Bonus Club',
    title: 'Neue Vorteile im jö Bonus Club',
    type: 'rabatt',
    category: 'supermarkt',
    url: 'https://www.joe-club.at/vorteile',
  },
  {
    brand: 'jö Bonus Club',
    logo: '💳',
    logoUrlIncludes: /domain_url=https:\/\/joe-club\.at$/,
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
    logoUrlIncludes: /brand-logos\/centimeter-vienna-centimeter-at\.png$/,
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
    logoUrlIncludes: /brand-logos\/therme-wien-thermewien-at\.png$/,
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

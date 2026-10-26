import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// Indices reference the existing native DealsHomeImages atlas, not merchant photos.
export const photoDefinitions = {
  kebab: [0, 'Döner im Fladenbrot'],
  pizza: [1, 'Pizza Margherita'],
  burger: [2, 'Burger'],
  coffee: [4, 'Tasse Kaffee'],
  bakery: [5, 'Gebäck'],
  sushi: [6, 'Sushi'],
  bowl: [7, 'Bowl mit Gemüse'],
  schnitzel: [8, 'Schnitzel'],
  fish: [9, 'Fisch mit Pommes'],
  dessert: [10, 'Kuchen'],
  groceries: [11, 'Lebensmittel'],
  fashion: [12, 'Kleidung'],
  furniture: [13, 'Wohnzimmer'],
  cinema: [14, 'Kinosaal'],
  fitness: [17, 'Fitnessausrüstung'],
  gift: [18, 'Geschenk'],
  restaurant: [19, 'Gedeckter Restauranttisch'],
  'pizza-alternative': [21, 'Pizza Margherita'],
  'crispy-chicken': [25, 'Crispy-Chicken-Burger'],
  espresso: [26, 'Espresso'],
  latte: [27, 'Milchkaffee'],
  baguette: [29, 'Baguette'],
  breakfast: [30, 'Frühstück'],
  'asian-restaurant': [31, 'Gedeckter Tisch in einem asiatischen Restaurant'],
  'casual-restaurant': [32, 'Gedeckter Restauranttisch'],
  'indian-restaurant': [33, 'Gedeckter Tisch in einem indischen Restaurant'],
  takeaway: [34, 'Mitnahmeverpackungen'],
  delivery: [35, 'Lieferverpackungen und Liefertasche'],
  carwash: [47, 'Autowäsche'],
  mattress: [67, 'Bett und Matratze'],
  riesenrad: [71, 'Riesenrad'],
  museum: [72, 'Ausstellung in einem Museum'],
  thermal: [75, 'Schwimmbecken'],
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(ROOT, 'docs/assets/deal-photos');
const catalogPath = path.join(directory, 'sources.json');
const catalog = fs.existsSync(catalogPath) ? JSON.parse(fs.readFileSync(catalogPath, 'utf8')).photos : {};
const normalize = value => String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/ß/g, 'ss');

export function photoKey(deal) {
  const title = normalize(deal.title);
  const brand = normalize(deal.brand);
  const text = `${title} ${brand}`;
  const has = expression => expression.test(text);
  let pool;
  if (has(/\b(therme|thermalbad)\b/)) return 'thermal';
  if (has(/\b(riesenrad)\b/)) return 'riesenrad';
  if (has(/\b(museum|tussauds)\b/)) return 'museum';
  if (has(/\b(kino|kinotickets?|cinema)\b/)) return 'cinema';
  if (has(/topwash|autowasche/)) return 'carwash';
  if (has(/\b(crispy chicken|chicken sandwich)\b/)) return 'crispy-chicken';
  if (/\b(kebap|kebab|doner|doener)\b/.test(title)) return 'kebab';
  if (/\b(pizza|pizzen)\b/.test(title)) pool = ['pizza', 'pizza-alternative'];
  else if (/\b(burger|cheeseburger|hamburger)\b/.test(title)) return 'burger';
  else if (/\b(fr[uü]hstuck|breakfast)\b/.test(title)) return 'breakfast';
  else if (/\b(schnitzel)\b/.test(title)) return 'schnitzel';
  else if (/\b(sushi|maki|nigiri)\b/.test(title)) return 'sushi';
  else if (/\b(bowl|bowls|poke|salat)\b/.test(title)) return 'bowl';
  else if (/\b(baguette|baguettes)\b/.test(title)) return 'baguette';
  else if (/\b(fisch|fish)\b/.test(title) || brand.includes('nordsee')) return 'fish';
  else if (/\b(kaffee|coffee|espresso|cappuccino|latte|heissgetrank|heissgetranke)\b/.test(title)) pool = ['coffee', 'espresso', 'latte'];
  else if (/\b(cheesecake|kasekuchen|kuchen|torte)\b/.test(title)) return 'dessert';
  else if (/\b(croissant|croissants|semmel|geback)\b/.test(title)) return 'bakery';
  else if (brand.includes('ganesha')) return 'indian-restaurant';
  else if (/hitomi|\bebi\b/.test(brand)) return 'asian-restaurant';
  else if (has(/\b(lebensmittel|foodsharing)\b/)) return 'groceries';
  else if (has(/\b(matratze|matratzen)\b/)) return 'mattress';
  else if (has(/\b(teppich|teppiche|mobel|sofa)\b/)) return 'furniture';
  else if (/\b(kleidung|fashion|mode|jeans|schuhe)\b/.test(title) || brand === 'shein') return 'fashion';
  else if (has(/\b(fitness|yoga|probetraining)\b/)) return 'fitness';
  else if (/lieferando|foodora|wolt/.test(brand)) pool = ['takeaway', 'delivery'];
  else if (['essen', 'kaffee', 'food'].includes(normalize(deal.category)) || /restaurant|buffet|brunch/.test(text)) pool = ['restaurant', 'casual-restaurant'];
  else return 'gift';
  // Stable IDs keep a motif unchanged when filters, ordering or feed size change.
  const index = createHash('sha256').update(String(deal.id || `${brand}:${title}`)).digest().readUInt32BE(0);
  return pool[index % pool.length];
}

export function dealPhoto(deal) {
  const key = photoKey(deal);
  const metadata = catalog?.[key];
  if (!metadata || ![metadata.width, metadata.height, metadata.thumbWidth].every(value => Number.isInteger(value) && value > 0)) return null;
  if (![`${key}.webp`, `${key}-160.webp`].every(file => fs.existsSync(path.join(directory, file)))) return null;
  return { key, src: `/assets/deal-photos/${key}.webp`,
    srcset: `/assets/deal-photos/${key}-160.webp ${metadata.thumbWidth}w, /assets/deal-photos/${key}.webp ${metadata.width}w`,
    width: metadata.width, height: metadata.height, alt: `Symbolfoto: ${photoDefinitions[key][1]}` };
}

function cleanText(value) {
  if (!value) return '';
  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const CATEGORY_ALIASES = {
  church: 'kirche',
  christlich: 'kirche',
  christlichevents: 'events',
  gemeinde: 'kirche',
  restaurant: 'essen',
  gastro: 'essen',
  food: 'essen',
  cafe: 'kaffee',
  'café': 'kaffee',
  coffee: 'kaffee',
  supermarket: 'supermarkt',
  market: 'supermarkt',
  lebensmittel: 'supermarkt',
  drogerie: 'beauty',
  kosmetik: 'beauty',
  fashion: 'shopping',
  mode: 'shopping',
  tech: 'technik',
  elektronik: 'technik',
  stream: 'streaming',
  culture: 'kultur',
  museum: 'kultur',
  festival: 'kultur',
  travel: 'reisen',
  urlaub: 'reisen',
  transport: 'reisen',
};

const WEAK_CATEGORIES = new Set(['', 'wien', 'gratis', 'shopping']);

const CHRISTIAN_KEYWORDS = [
  'kirche', 'gemeinde', 'pfarre', 'pfarr', 'gottesdienst', 'messe', 'anbetung',
  'bibel', 'jesus', 'christ', 'christlich', 'evangelisch', 'katholisch', 'freikirche',
  'jugendgottesdienst', 'lobpreis', 'andacht', 'segnung', 'worship', 'himmelsstürmer',
  'himmelsstuermer', 'christlicher event', 'gebetsabend', 'glaubensabend'
];

const SERVICE_KEYWORDS = [
  'gottesdienst', 'messe', 'hl. messe', 'liturgie', 'beichte', 'vesper',
  'sonntag', 'samstag', 'werktag', 'uhr'
];

const CHRISTIAN_EVENT_KEYWORDS = [
  'event', 'abend', 'worship', 'konzert', 'festival', 'treffen', 'jugendabend',
  'lobpreisabend', 'gebetsabend', 'anbetungsabend', 'himmelsstürmer', 'himmelsstuermer'
];

const CATEGORY_HINTS = {
  kaffee: [
    'kaffee', 'coffee', 'cafe', 'café', 'espresso', 'latte', 'cappuccino',
    'starbucks', 'tchibo', 'nespresso', 'mccafe'
  ],
  essen: [
    'restaurant', 'essen', 'food', 'pizza', 'burger', 'kebab', 'kebap', 'döner',
    'doener', 'falafel', 'wrap', 'brunch', 'buffet', 'snack', 'cocktail',
    'drink', 'mittag', 'menü', 'menue', 'mcdonald', 'burger king', 'subway',
    'domino', 'kfc', 'vapiano', 'lieferando', 'mjam', 'uber eats', 'croissant',
    'frühstück', 'fruehstueck'
  ],
  supermarkt: [
    'supermarkt', 'lebensmittel', 'einkauf', 'gutscheinheft', 'jö', 'joe',
    'spar', 'billa', 'hofer', 'lidl', 'penny', 'libro', 'unimarkt', 'adeg'
  ],
  fitness: [
    'fitness', 'gym', 'workout', 'probetraining', 'studio', 'fitinn', 'mcfit',
    'clever fit', 'john harris', 'crossfit', 'yoga'
  ],
  reisen: [
    'flug', 'flight', 'hotel', 'reise', 'urlaub', 'wizz', 'ryanair', 'oebb',
    'öbb', 'bahn', 'rail', 'ticket', 'klimaticket', 'airbnb', 'booking'
  ],
  kultur: [
    'museum', 'ausstellung', 'kino', 'theater', 'konzert', 'festival',
    'vernissage', 'lesung', 'kunst', 'kabarett', 'oper'
  ],
  streaming: [
    'spotify', 'netflix', 'disney+', 'prime video', 'youtube premium', 'deezer',
    'streaming', 'hörbuch', 'hoerbuch', 'podcast'
  ],
  technik: [
    'iphone', 'ipad', 'macbook', 'airpods', 'apple', 'samsung', 'playstation',
    'xbox', 'smartphone', 'tablet', 'laptop', 'mediamarkt', 'saturn', 'a1',
    'magenta', 'drei'
  ],
  beauty: [
    'parfum', 'make-up', 'kosmetik', 'beauty', 'pflege', 'sephora', 'douglas',
    'dm', 'bipa', 'müller', 'mueller', 'friseur'
  ],
  shopping: [
    'gutschein', 'rabattcode', 'coupon', 'sale', 'shop', 'shopping', 'amazon',
    'zalando', 'about you', 'ikea', 'möbel', 'moebel'
  ]
};

function buildSignalText(parts = []) {
  return parts.map((part) => cleanText(part)).filter(Boolean).join(' ').toLowerCase();
}

function isChristianText(text) {
  return CHRISTIAN_KEYWORDS.some((token) => text.includes(token));
}

function hasServiceContext(text) {
  return SERVICE_KEYWORDS.some((token) => text.includes(token));
}

function isChristianEvent(text) {
  return CHRISTIAN_EVENT_KEYWORDS.some((token) => text.includes(token));
}

function inferCategoryFromText(parts = []) {
  const text = buildSignalText(parts);
  if (!text) return null;

  if (isChristianText(text)) {
    if (hasServiceContext(text)) return 'gottesdienste';
    if (isChristianEvent(text)) return 'events';
    return 'kirche';
  }

  if (CATEGORY_HINTS.kaffee.some((token) => text.includes(token))) return 'kaffee';
  if (CATEGORY_HINTS.essen.some((token) => text.includes(token))) return 'essen';
  if (CATEGORY_HINTS.supermarkt.some((token) => text.includes(token))) return 'supermarkt';
  if (CATEGORY_HINTS.fitness.some((token) => text.includes(token))) return 'fitness';
  if (CATEGORY_HINTS.reisen.some((token) => text.includes(token))) return 'reisen';
  if (CATEGORY_HINTS.kultur.some((token) => text.includes(token))) return 'kultur';
  if (CATEGORY_HINTS.streaming.some((token) => text.includes(token))) return 'streaming';
  if (CATEGORY_HINTS.technik.some((token) => text.includes(token))) return 'technik';
  if (CATEGORY_HINTS.beauty.some((token) => text.includes(token))) return 'beauty';
  if (CATEGORY_HINTS.shopping.some((token) => text.includes(token))) return 'shopping';

  return null;
}

function normalizeCategoryForScraper(rawCategory, parts = []) {
  const original = cleanText(rawCategory).toLowerCase();
  const category = CATEGORY_ALIASES[original] || original;
  const inferred = inferCategoryFromText([category, ...parts]);
  const text = buildSignalText([category, ...parts]);

  if (category === 'gottesdienste' || (isChristianText(text) && hasServiceContext(text))) return 'gottesdienste';
  if (category === 'kirche') return 'kirche';
  if (category === 'events') return isChristianText(text) ? 'events' : (inferred || 'kultur');

  if (WEAK_CATEGORIES.has(category) && inferred) return inferred;
  if (category === 'shopping' && inferred && inferred !== 'shopping') return inferred;

  return category || inferred || 'wien';
}

export {
  cleanText,
  inferCategoryFromText,
  normalizeCategoryForScraper,
};

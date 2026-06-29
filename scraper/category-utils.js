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
  'himmelsstuermer', 'christlicher event', 'gebetsabend', 'glaubensabend',
  'hillsong', 'icf', 'jesuszentrum', 'cig'
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
    'matcha', 'tee', 'tea', 'chai', 'starbucks', 'tchibo', 'nespresso', 'mccafe'
  ],
  essen: [
    'restaurant', 'essen', 'food', 'pizza', 'burger', 'kebab', 'kebap', 'döner',
    'doener', 'doner', 'falafel', 'wrap', 'brunch', 'buffet', 'snack', 'cocktail',
    'drink', 'drinks', 'getränk', 'getraenk', 'cola', 'saft', 'smoothie', 'tonic',
    'boba', 'bubble tea', 'sandwich', 'schnitzel', 'ramen', 'donburi', 'nudeln',
    'noodles', 'curry', 'steak', 'bbq', 'grill', 'fleisch', 'mittag', 'menü',
    'menue', 'mcdonald', 'burger king', 'subway', 'domino', 'kfc', 'vapiano',
    'lieferando', 'mjam', 'uber eats', 'croissant',
    'frühstück', 'fruehstueck', 'eis', 'eissalon', 'gelato', 'ice cream',
    'dessert', 'schoko', 'schokolade', 'erdbeer', 'erdbeere', 'erdbeeren',
    'chocoberry', 'waffel', 'pancake', 'kuchen', 'torte', 'bäckerei', 'backerei',
    'bakery', 'krapfen'
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasTerm(text, token) {
  const term = cleanText(token).toLowerCase();
  if (!term) return false;
  if (/^[\p{L}\p{N}]+$/u.test(term)) {
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(term)}($|[^\\p{L}\\p{N}])`, 'iu').test(text);
  }
  return text.includes(term);
}

function hasAnyTerm(text, tokens = []) {
  return tokens.some((token) => hasTerm(text, token));
}

function isChristianText(text) {
  return hasAnyTerm(text, CHRISTIAN_KEYWORDS);
}

function hasServiceContext(text) {
  return hasAnyTerm(text, SERVICE_KEYWORDS);
}

function isChristianEvent(text) {
  return hasAnyTerm(text, CHRISTIAN_EVENT_KEYWORDS);
}

function inferCategoryFromText(parts = []) {
  const text = buildSignalText(parts);
  if (!text) return null;

  if (isChristianText(text)) {
    if (hasServiceContext(text)) return 'gottesdienste';
    if (isChristianEvent(text)) return 'events';
    return 'kirche';
  }

  if (hasAnyTerm(text, CATEGORY_HINTS.kaffee)) return 'kaffee';
  if (hasAnyTerm(text, CATEGORY_HINTS.essen)) return 'essen';
  if (hasAnyTerm(text, CATEGORY_HINTS.supermarkt)) return 'supermarkt';
  if (hasAnyTerm(text, CATEGORY_HINTS.fitness)) return 'fitness';
  if (hasAnyTerm(text, CATEGORY_HINTS.reisen)) return 'reisen';
  if (hasAnyTerm(text, CATEGORY_HINTS.kultur)) return 'kultur';
  if (hasAnyTerm(text, CATEGORY_HINTS.streaming)) return 'streaming';
  if (hasAnyTerm(text, CATEGORY_HINTS.technik)) return 'technik';
  if (hasAnyTerm(text, CATEGORY_HINTS.beauty)) return 'beauty';
  if (hasAnyTerm(text, CATEGORY_HINTS.shopping)) return 'shopping';

  return null;
}

function normalizeCategoryForScraper(rawCategory, parts = []) {
  const original = cleanText(rawCategory).toLowerCase();
  const category = CATEGORY_ALIASES[original] || original;
  const inferred = inferCategoryFromText([category, ...parts]);
  const text = buildSignalText([category, ...parts]);

  if (category === 'events') return isChristianText(text) ? 'events' : (inferred || 'kultur');
  if (category === 'gottesdienste' || (isChristianText(text) && hasServiceContext(text))) return 'gottesdienste';
  if (category === 'kirche') return 'kirche';

  if (WEAK_CATEGORIES.has(category) && inferred) return inferred;
  if (['shopping', 'beauty', 'kultur', 'reisen'].includes(category) && (inferred === 'essen' || inferred === 'kaffee')) return inferred;
  if (category === 'shopping' && inferred && inferred !== 'shopping') return inferred;

  return category || inferred || 'wien';
}

export {
  cleanText,
  inferCategoryFromText,
  normalizeCategoryForScraper,
};

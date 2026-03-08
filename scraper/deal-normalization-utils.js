const BRAND_RULES = [
  { key: 'mcdonald', name: "McDonald's", logo: '🍟', category: 'essen' },
  { key: 'burger king', name: 'Burger King', logo: '🍔', category: 'essen' },
  { key: 'starbucks', name: 'Starbucks', logo: '☕', category: 'kaffee' },
  { key: 'tchibo', name: 'Tchibo', logo: '☕', category: 'kaffee' },
  { key: 'nespresso', name: 'Nespresso', logo: '☕', category: 'kaffee' },
  { key: 'intimissimi', name: 'Intimissimi', logo: '🧦', category: 'shopping' },
  { key: 'bipa', name: 'BIPA', logo: '💄', category: 'beauty' },
  { key: 'dm', name: 'dm', logo: '🧴', category: 'beauty' },
  { key: 'muller', name: 'Muller', logo: '💋', category: 'beauty' },
  { key: 'mueller', name: 'Muller', logo: '💋', category: 'beauty' },
  { key: 'spar', name: 'SPAR', logo: '🛒', category: 'supermarkt' },
  { key: 'billa', name: 'BILLA', logo: '🛒', category: 'supermarkt' },
  { key: 'hofer', name: 'HOFER', logo: '🛒', category: 'supermarkt' },
  { key: 'lidl', name: 'Lidl', logo: '🛒', category: 'supermarkt' },
  { key: 'ikea', name: 'IKEA', logo: '🪑', category: 'shopping' },
  { key: 'rooni', name: 'Rooni Restaurant', logo: '🍽️', category: 'essen' },
  { key: 'omv', name: 'OMV', logo: '⛽', category: 'shopping' },
  { key: 'joe', name: 'joo', logo: '🎁', category: 'supermarkt' },
  { key: 'joo', name: 'joo', logo: '🎁', category: 'supermarkt' },
  { key: 'wolt', name: 'Wolt', logo: '🛵', category: 'essen' },
  { key: 'lieferando', name: 'Lieferando', logo: '🛵', category: 'essen' },
  { key: 'uber eats', name: 'Uber Eats', logo: '🛵', category: 'essen' },
  { key: 'all4golf', name: 'ALL4GOLF', logo: '⛳', category: 'shopping' },
  { key: 'spee', name: 'Spee', logo: '🧺', category: 'shopping' },
  { key: 'preisjaeger', name: 'Preisjaeger', logo: '🎯', category: 'shopping', source: true },
  { key: 'wien deals', name: 'Wien Deals', logo: '🎯', category: 'shopping', source: true },
  { key: 'instagram', name: 'Instagram', logo: '📸', category: 'shopping', source: true },
  { key: 'tiktok', name: 'TikTok', logo: '🎵', category: 'shopping', source: true },
];

const SOURCE_LIKE_BRANDS = [
  /^preisjaeger$/i,
  /^wien deals$/i,
  /^instagram$/i,
  /^tiktok$/i,
  /^slack digest$/i,
  /^restaurant \(wien\)$/i,
  /^gemeinde$/i,
  /^kirche$/i,
];

const GENERIC_TITLES = [
  /^neueste gutscheine$/i,
  /^rabatt$/i,
  /^gewinnspiel$/i,
  /^giveaway$/i,
  /^gratis$/i,
  /^deal$/i,
];

const GENERIC_CATEGORIES = new Set(['', 'wien', 'gratis', 'shopping']);

function cleanText(value) {
  if (!value) return '';
  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanUiNoiseText(value) {
  let text = cleanText(value);
  if (!text) return '';
  const junkPatterns = [
    /\balle anzeigen\b/gi,
    /\bkategorien\b/gi,
    /\bapp\b/gi,
    /\bap\b/gi,
  ];
  junkPatterns.forEach((pattern) => {
    text = text.replace(pattern, ' ');
  });
  return text.replace(/\s+/g, ' ').replace(/^[,:\-–\s]+|[,:\-–\s]+$/g, '').trim();
}

function normalizeAscii(value) {
  return cleanUiNoiseText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function findBrandRule(signal) {
  const normalized = normalizeAscii(signal);
  return BRAND_RULES.find((rule) => normalized.includes(rule.key));
}

function isLikelyGenericLocation(value) {
  const text = cleanUiNoiseText(value);
  if (!text) return true;
  if (/^(wien|vienna|online|österreich|osterreich|ganz wien|restaurant \(wien\)|gemeinde|kirche)$/i.test(text)) return true;
  if (/^\d{4}\s+wien/i.test(text)) return false;
  if (/,/.test(text) || /\b(straße|strasse|gasse|platz|weg|ring|allee|bezirk)\b/i.test(text)) return false;
  return text.length <= 4;
}

function isSourceLikeBrand(value) {
  const text = cleanUiNoiseText(value);
  if (!text) return true;
  return SOURCE_LIKE_BRANDS.some((pattern) => pattern.test(text));
}

function extractBracketBrand(title) {
  const match = cleanUiNoiseText(title).match(/^\[([^\]]{2,40})\]/);
  return match ? cleanUiNoiseText(match[1]) : '';
}

function extractBeiBrand(title) {
  const match = cleanUiNoiseText(title).match(/\bbei\s+([A-Za-z0-9À-ÿ&' .\-]{2,50})$/i);
  return match ? cleanUiNoiseText(match[1]) : '';
}

function extractFromDistance(distance) {
  const text = cleanUiNoiseText(distance);
  if (!text) return '';
  const candidate = cleanUiNoiseText(text.split(',')[0]);
  if (!candidate || isLikelyGenericLocation(candidate)) return '';
  return candidate;
}

function inferPreferredBrand(deal = {}) {
  const explicitBrand = cleanUiNoiseText(deal.brand || '');
  if (explicitBrand && !isSourceLikeBrand(explicitBrand) && !isLikelyGenericLocation(explicitBrand)) {
    return explicitBrand;
  }

  const bracketBrand = extractBracketBrand(deal.title);
  if (bracketBrand) return bracketBrand;

  const titleSignal = cleanUiNoiseText(deal.title || '');
  const knownInTitle = findBrandRule(titleSignal);
  if (knownInTitle && !knownInTitle.source) return knownInTitle.name;

  const beiBrand = extractBeiBrand(titleSignal);
  if (beiBrand && !isSourceLikeBrand(beiBrand) && !isLikelyGenericLocation(beiBrand)) {
    return beiBrand;
  }

  const distanceBrand = extractFromDistance(deal.distance);
  if (distanceBrand) return distanceBrand;

  const descriptionSignal = cleanUiNoiseText(deal.description || '');
  const knownInDescription = findBrandRule(descriptionSignal);
  if (knownInDescription && !knownInDescription.source) return knownInDescription.name;

  return explicitBrand || '';
}

function inferLogo(deal = {}, brand = '') {
  const combined = [brand, deal.title, deal.description, deal.distance, deal.url, deal.category, deal.type]
    .filter(Boolean)
    .join(' ');
  const known = findBrandRule(combined);
  if (known && !known.source) return known.logo;

  const type = cleanUiNoiseText(deal.type || '').toLowerCase();
  const category = cleanUiNoiseText(deal.category || '').toLowerCase();
  if (category === 'kaffee') return '☕';
  if (category === 'essen') return '🍽️';
  if (category === 'supermarkt') return '🛒';
  if (category === 'fitness') return '💪';
  if (category === 'reisen') return '✈️';
  if (category === 'kultur') return '🎭';
  if (category === 'beauty') return '💄';
  if (category === 'technik') return '📱';
  if (category === 'kirche') return '⛪';
  if (category === 'gottesdienste') return '🕊️';
  if (category === 'events') return '🎫';
  if (type === 'gewinnspiel') return '🎉';
  if (type === 'bogo') return '🔁';
  if (type === 'gratis') return '🎁';
  return '🎯';
}

function inferPreferredType(deal = {}) {
  const combined = cleanUiNoiseText([
    deal.title,
    deal.description,
    deal.brand,
    deal.distance,
    deal.url,
    deal.type,
  ].filter(Boolean).join(' ')).toLowerCase();

  if (/\b(gewinnspiel|giveaway|verlosen|zu gewinnen|chance auf|gl[üu]cksrad)\b/i.test(combined)) {
    return 'gewinnspiel';
  }

  if (/\b(1\+1|2for1|2 for 1|buy one get one|bogo|4 f[üu]r 3|3\+3|4\+2|mix&match|2x .+ \+ 1 gratis)\b/i.test(combined)) {
    return 'bogo';
  }

  if (/\b(rabatt|discount|gutschein|voucher|verg[üu]nstig|bonus|sale|aktion)\b/i.test(combined) || /(^|[^0-9])\d{1,2}\s?%/.test(combined)) {
    if (!/\b(gratis|kostenlos|free entry|eintritt frei|ohne kaufzwang)\b/i.test(combined)) {
      return 'rabatt';
    }
  }

  if (/\b(gratis|kostenlos|free|freebie|ohne kaufzwang|eintritt frei|pay what you want|welcome gift)\b/i.test(combined)) {
    return 'gratis';
  }

  return cleanUiNoiseText(deal.type || '').toLowerCase();
}

function isGenericJunkDeal(deal = {}) {
  const title = cleanUiNoiseText(deal.title || '');
  if (GENERIC_TITLES.some((pattern) => pattern.test(title))) return true;
  if (isSourceLikeBrand(deal.brand || '') && /^gratis (wrap|burger|pizza|kebab|eintritt|essen|kaffee)$/i.test(title) && !cleanUiNoiseText(deal.description || '')) {
    return true;
  }
  return false;
}

function normalizeDealRecord(deal = {}) {
  const title = cleanUiNoiseText(deal.title || '');
  const description = cleanUiNoiseText(deal.description || '');
  const brand = inferPreferredBrand({ ...deal, title, description });
  const type = inferPreferredType({ ...deal, title, description, brand });
  const known = findBrandRule([brand, title, description, deal.distance, deal.url].filter(Boolean).join(' '));
  const currentCategory = cleanUiNoiseText(deal.category || '').toLowerCase();
  const category = known?.category && (GENERIC_CATEGORIES.has(currentCategory) || (currentCategory === 'shopping' && known.category !== 'shopping'))
    ? known.category
    : currentCategory;
  return {
    ...deal,
    title,
    description,
    brand: brand || cleanUiNoiseText(deal.brand || ''),
    type: type || cleanUiNoiseText(deal.type || '').toLowerCase(),
    category: category || currentCategory,
    logo: inferLogo({ ...deal, title, description, type, category }, brand),
  };
}

export {
  cleanText,
  cleanUiNoiseText,
  inferPreferredBrand,
  inferLogo,
  isSourceLikeBrand,
  isGenericJunkDeal,
  normalizeDealRecord,
  isLikelyGenericLocation,
  inferPreferredType,
};

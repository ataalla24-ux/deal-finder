const BRAND_RULES = [
  { key: 'mcdonald', name: "McDonald's", logo: '🍟', category: 'essen', domain: 'mcdonalds.at' },
  { key: 'burger king', name: 'Burger King', logo: '🍔', category: 'essen', domain: 'burgerking.at' },
  { key: 'starbucks', name: 'Starbucks', logo: '☕', category: 'kaffee', domain: 'starbucks.com' },
  { key: 'tchibo', name: 'Tchibo', logo: '☕', category: 'kaffee', domain: 'tchibo.at' },
  { key: 'nespresso', name: 'Nespresso', logo: '☕', category: 'kaffee', domain: 'nespresso.com' },
  { key: 'sephora', name: 'SEPHORA', logo: '💄', category: 'beauty', domain: 'sephora.at' },
  { key: 'thalia', name: 'Thalia', logo: '📚', category: 'shopping', domain: 'thalia.at' },
  { key: 'intimissimi', name: 'Intimissimi', logo: '🧦', category: 'shopping', domain: 'intimissimi.com' },
  { key: 'bipa', name: 'BIPA', logo: '💄', category: 'beauty', domain: 'bipa.at' },
  { key: 'dm', name: 'dm', logo: '🧴', category: 'beauty', domain: 'dm.at' },
  { key: 'muller', name: 'Muller', logo: '💋', category: 'beauty', domain: 'mueller.at' },
  { key: 'mueller', name: 'Muller', logo: '💋', category: 'beauty', domain: 'mueller.at' },
  { key: 'spar', name: 'SPAR', logo: '🛒', category: 'supermarkt', domain: 'spar.at' },
  { key: 'billa', name: 'BILLA', logo: '🛒', category: 'supermarkt', domain: 'billa.at' },
  { key: 'hofer', name: 'HOFER', logo: '🛒', category: 'supermarkt', domain: 'hofer.at' },
  { key: 'lidl', name: 'Lidl', logo: '🛒', category: 'supermarkt', domain: 'lidl.at' },
  { key: 'ikea', name: 'IKEA', logo: '🪑', category: 'shopping', domain: 'ikea.com' },
  { key: 'botanischer garten', name: 'Botanischer Garten der Universität Wien', logo: '🌿', category: 'kultur' },
  { key: 'shell', name: 'Shell Österreich', logo: '⛽', category: 'kaffee', domain: 'shell.at' },
  { key: 'european street food festival', name: 'European Street Food Festival', logo: '🌮', category: 'essen' },
  { key: 'vienna coffee festival', name: 'Vienna Coffee Festival', logo: '☕', category: 'kaffee' },
  { key: 'rooni', name: 'Rooni Restaurant', logo: '🍜', category: 'essen' },
  { key: 'leopoldauer alm', name: 'Leopoldauer Alm', logo: '🍖', category: 'essen' },
  { key: 'jala falafel', name: 'Jala Falafel', logo: '🧆', category: 'essen' },
  { key: 'burgallio', name: 'Burgallio', logo: '🍔', category: 'essen' },
  { key: 'cavallo', name: 'Cavallo Vienna', logo: '🍝', category: 'essen' },
  { key: 'tybah', name: 'Tybah Pizzeria-Ristorante', logo: '🍕', category: 'essen' },
  { key: 'eismacher', name: 'Der Eismacher', logo: '🍨', category: 'essen' },
  { key: 'ben & jerry', name: "Ben & Jerry's", logo: '🍦', category: 'essen' },
  { key: 'donauturm', name: 'Donauturm', logo: '🗼', category: 'kultur' },
  { key: 'genuss-festival', name: 'Genuss-Festival Wien', logo: '🧀', category: 'essen' },
  { key: 'momax', name: 'mömax Restaurant', logo: '🛋️', category: 'essen' },
  { key: 'mömax', name: 'mömax Restaurant', logo: '🛋️', category: 'essen' },
  { key: 'vapiano', name: 'Vapiano', logo: '🍝', category: 'essen' },
  { key: 'grill heaven', name: 'Grill Heaven Wien', logo: '🔥', category: 'essen' },
  { key: 'ori fusion', name: 'Ori Fusion Kitchen', logo: '🥢', category: 'essen' },
  { key: 'das lugeck', name: 'Das Lugeck', logo: '🍽️', category: 'essen' },
  { key: 'whatseat', name: 'WhatsEat', logo: '🍽️', category: 'essen' },
  { key: 'coffee u-boot', name: 'Coffee U-Boot 1060', logo: '☕', category: 'kaffee' },
  { key: 'wolke pizza', name: 'WOLKE Pizza', logo: '🍕', category: 'essen' },
  { key: 'makotoya', name: 'Ramen Makotoya', logo: '🍜', category: 'essen' },
  { key: 'crepes', name: "Mama's Crêpes & Shakes", logo: '🥞', category: 'essen' },
  { key: 'crêpes', name: "Mama's Crêpes & Shakes", logo: '🥞', category: 'essen' },
  { key: 'rafas', name: 'RAFAS', logo: '🥐', category: 'essen' },
  { key: 'chasen brew', name: 'Chasen Brew', logo: '🍵', category: 'kaffee' },
  { key: 'wiener eistraum', name: 'Wiener Eistraum', logo: '⛸️', category: 'events' },
  { key: 'peter hahn', name: 'Peter Hahn', logo: '👗', category: 'shopping' },
  { key: 'pneus online', name: 'Pneus Online', logo: '🛞', category: 'shopping' },
  { key: 'omv', name: 'OMV', logo: '⛽', category: 'shopping', domain: 'omv.at' },
  { key: 'joe', name: 'joo', logo: '💳', category: 'supermarkt', domain: 'joe-club.at' },
  { key: 'joo', name: 'joo', logo: '💳', category: 'supermarkt', domain: 'joe-club.at' },
  { key: 'wolt', name: 'Wolt', logo: '🛵', category: 'essen', domain: 'wolt.com' },
  { key: 'lieferando', name: 'Lieferando', logo: '🛵', category: 'essen', domain: 'lieferando.at' },
  { key: 'uber eats', name: 'Uber Eats', logo: '🛵', category: 'essen', domain: 'ubereats.com' },
  { key: 'all4golf', name: 'ALL4GOLF', logo: '⛳', category: 'shopping', domain: 'all4golf.de' },
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

const SOURCE_LIKE_HOSTS = [
  /(^|\.)instagram\.com$/i,
  /(^|\.)tiktok\.com$/i,
  /(^|\.)facebook\.com$/i,
  /(^|\.)x\.com$/i,
  /(^|\.)twitter\.com$/i,
  /(^|\.)slack\.com$/i,
  /(^|\.)preisjaeger\./i,
];

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

function extractHostFromUrl(url) {
  try {
    const host = new URL(String(url)).hostname.toLowerCase().replace(/^www\./, '');
    return host;
  } catch {
    return '';
  }
}

function isSourceLikeHost(host) {
  if (!host) return true;
  return SOURCE_LIKE_HOSTS.some((pattern) => pattern.test(host));
}

function buildLogoUrl(host) {
  if (!host || isSourceLikeHost(host)) return '';
  return `https://www.google.com/s2/favicons?sz=128&domain_url=https://${host}`;
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

function inferLogoUrl(deal = {}, brand = '') {
  const combined = [brand, deal.title, deal.description, deal.distance, deal.url, deal.post_url, deal.source]
    .filter(Boolean)
    .join(' ');
  const known = findBrandRule(combined);
  if (known?.domain) return buildLogoUrl(known.domain);

  const directHost = extractHostFromUrl(deal.logoUrl || deal.image || deal.imageUrl || deal.url || deal.post_url);
  if (directHost && !isSourceLikeHost(directHost)) return buildLogoUrl(directHost);

  return '';
}

function inferLogo(deal = {}, brand = '') {
  const combined = [brand, deal.title, deal.description, deal.distance, deal.url, deal.category, deal.type]
    .filter(Boolean)
    .join(' ');
  const known = findBrandRule(combined);
  if (known && !known.source) return known.logo;

  const signal = normalizeAscii(combined);
  const type = cleanUiNoiseText(deal.type || '').toLowerCase();
  const category = cleanUiNoiseText(deal.category || '').toLowerCase();
  if (/(pizza)/.test(signal)) return '🍕';
  if (/(burger)/.test(signal)) return '🍔';
  if (/(kebab|doner|döner|falafel|wrap)/.test(signal)) return '🌯';
  if (/(ramen|noodle)/.test(signal)) return '🍜';
  if (/(crepe|crepes|crêpe|crêpes|waffel|shake)/.test(signal)) return '🥞';
  if (/(croissant|brioche|pastry|bakery)/.test(signal)) return '🥐';
  if (/(ice cream|eis|gelato|cone)/.test(signal)) return '🍦';
  if (/(kaffee|coffee|espresso|latte|matcha|tea)/.test(signal)) return '☕';
  if (/(ticket|festival|museum|concert|ausstellung|show)/.test(signal)) return '🎫';
  if (/(garten|botanisch|park)/.test(signal)) return '🌿';
  if (/(book|buch|thalia)/.test(signal)) return '📚';
  if (category === 'kaffee') return '☕';
  if (category === 'essen') return '🍴';
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
  if (type === 'freebie') return '✨';
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
  ].filter(Boolean).join(' ')).toLowerCase();

  if (/\b(gewinnspiel|giveaway|verlosen|zu gewinnen|chance auf|gl[üu]cksrad)\b/i.test(combined)) {
    return 'gewinnspiel';
  }

  if (/\b(1\+1|2for1|2 for 1|2f[üu]r1|2 f[üu]r 1|buy one get one|bogo|4 f[üu]r 3|3\+3|4\+2|mix&match|2x .+ \+ 1 gratis)\b/i.test(combined)) {
    return 'bogo';
  }

  if (/\b(freebie|willkommensgeschenk|welcome gift|welcome bonus|goodie bag|gratis[- ]?beigabe|gratis dazu|2 go bons|app-vorteil|bonusclub-vorteil)\b/i.test(combined)) {
    return 'freebie';
  }

  if (/\b(rabatt|discount|gutschein|voucher|verg[üu]nstig(?:t|te|ten|ter|tes)?|sale|aktion)\b/i.test(combined) || /(^|[^0-9])\d{1,2}\s?%/.test(combined)) {
    if (!/\b(gratis|kostenlos|free entry|eintritt frei|ohne kaufzwang)\b/i.test(combined)) {
      return 'rabatt';
    }
  }

  if (/\b(gratis|kostenlos|free|ohne kaufzwang|eintritt frei|pay what you want)\b/i.test(combined)) {
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

function buildFallbackDescription(deal = {}) {
  const title = cleanUiNoiseText(deal.title || '');
  const brand = cleanUiNoiseText(deal.brand || '');
  const location = cleanUiNoiseText(deal.distance || deal.location || '');
  const type = cleanUiNoiseText(deal.type || '').toLowerCase();
  const category = cleanUiNoiseText(deal.category || '').toLowerCase();

  if (/gratis/i.test(title) || type === 'gratis') {
    return [title, location].filter(Boolean).join(' in ');
  }
  if (type === 'bogo') {
    return [title, '1+1 bzw. Kombi-Aktion', location].filter(Boolean).join(' • ');
  }
  if (type === 'rabatt') {
    return [title, location].filter(Boolean).join(' • ');
  }
  if (type === 'freebie') {
    return [title, 'Bonus/Freebie', location].filter(Boolean).join(' • ');
  }
  if (type === 'gewinnspiel') {
    return [title, 'Gewinnspiel', location].filter(Boolean).join(' • ');
  }
  return [brand, title, location, category].filter(Boolean).join(' • ');
}

function sanitizeExpiryText(value) {
  const raw = cleanUiNoiseText(value || '');
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}t/i.test(raw) || /^\d{4}-\d{2}-\d{2}T/.test(raw)) return raw;

  let text = raw
    .replace(/\bunknown\b/gi, ' ')
    .replace(/\bnot specified\b/gi, ' ')
    .replace(/\bsiehe details\b/gi, ' ')
    .replace(/\bsee details\b/gi, ' ')
    .replace(/\bsiehe website\b/gi, ' ')
    .replace(/\bregular hours\b/gi, ' ')
    .replace(/\bw[aä]hrend [a-zäöüß ]*öffnungszeiten\b/gi, ' ')
    .replace(/\bvia neotaste\b/gi, ' ')
    .replace(/\bongoing\b/gi, ' ')
    .replace(/\blaufende? aktion\b/gi, ' ')
    .replace(/\blaufend\b/gi, ' ')
    .replace(/\bnicht angegeben\b/gi, ' ')
    .replace(/\bzeiten auf webseite prüfen\b/gi, ' ')
    .replace(/\baktuelle termine auf webseite\b/gi, ' ')
    .replace(/\bsiehe webseite\b/gi, ' ')
    .replace(/\bimmer\b/gi, ' ')
    .replace(/\bpermanent nach vereinbarung\b/gi, ' ')
    .replace(/\bfrühjahr 20\d{2}\b/gi, ' ')
    .replace(/\bfruehjahr 20\d{2}\b/gi, ' ')
    .replace(/\bseason opening 20\d{2}\b/gi, ' ')
    .replace(/\(neotaste deal\)/gi, ' ')
    .replace(/\(7 days rolling\)/gi, ' ')
    .replace(/\bgültig 2 tage vor oder nach dem geburtstag\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[,:\-–\s]+|[,:\-–\s]+$/g, '')
    .trim();

  if (!text || /^(regelm[aä]ßig|t[aä]glich|jeden sonntag|jeden dienstag|monatlich)$/i.test(text)) return '';
  if (/^(mo|di|mi|do|fr|sa|so|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)/i.test(text)) return '';
  if (/\b(vormittag|nachmittag|abend|morgens|mittags|abends)\b/i.test(text)) return '';
  return text;
}

function isExpiredDealRecord(deal = {}, now = new Date()) {
  const expires = cleanText(deal.expires || '');
  if (!expires) return false;
  const parsed = Date.parse(expires);
  if (!Number.isNaN(parsed)) return parsed < now.getTime();
  return false;
}

function isFalsePositiveFreeDeal(deal = {}) {
  const signal = normalizeAscii([deal.title, deal.description, deal.brand].filter(Boolean).join(' '));
  const category = cleanUiNoiseText(deal.category || '').toLowerCase();
  if (/eintritt kostenpflichtig/.test(signal)) return true;
  if (/kinder bis 12 gratis/.test(signal)) return true;
  if (/\b(museum|museen|ausstellung|vernissage|galerie|fuehrung|fuhrung|tour)\b/.test(signal)) return true;
  if (/\beintritt\b/.test(signal) && !/\b(gottesdienst|kirche|gemeinde)\b/.test(signal)) return true;
  if (/(kultur|events?|gratis|wien)/.test(category) && /\b(fuehrung|fuhrung|tour|museum|ausstellung)\b/.test(signal)) return true;
  return false;
}

function normalizeDealRecord(deal = {}) {
  const title = cleanUiNoiseText(deal.title || '');
  let description = cleanUiNoiseText(deal.description || '');
  const brand = inferPreferredBrand({ ...deal, title, description });
  const type = inferPreferredType({ ...deal, title, description, brand });
  const known = findBrandRule([brand, title, description, deal.distance, deal.url, deal.post_url].filter(Boolean).join(' '));
  const currentCategory = cleanUiNoiseText(deal.category || '').toLowerCase();
  const category = known?.category && (GENERIC_CATEGORIES.has(currentCategory) || (currentCategory === 'shopping' && known.category !== 'shopping'))
    ? known.category
    : currentCategory;
  const sanitizedExpires = sanitizeExpiryText(deal.expires);
  if (!description) {
    description = buildFallbackDescription({ ...deal, title, brand, type, category });
  }
  return {
    ...deal,
    title,
    description,
    brand: brand || cleanUiNoiseText(deal.brand || ''),
    type: type || cleanUiNoiseText(deal.type || '').toLowerCase(),
    category: category || currentCategory,
    expires: sanitizedExpires,
    logo: inferLogo({ ...deal, title, description, type, category }, brand),
    logoUrl: inferLogoUrl({ ...deal, title, description, type, category }, brand),
  };
}

export {
  buildFallbackDescription,
  cleanText,
  cleanUiNoiseText,
  inferPreferredBrand,
  inferLogo,
  inferLogoUrl,
  isSourceLikeBrand,
  isGenericJunkDeal,
  isExpiredDealRecord,
  isFalsePositiveFreeDeal,
  normalizeDealRecord,
  isLikelyGenericLocation,
  inferPreferredType,
  sanitizeExpiryText,
};

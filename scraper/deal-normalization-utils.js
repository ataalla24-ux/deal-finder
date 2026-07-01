import { normalizeCategoryForScraper } from './category-utils.js';

const BRAND_RULES = [
  { key: 'centimeter_vienna', name: 'Centimeter Wien', logo: '🍽️', category: 'essen', domain: 'centimeter.at' },
  { key: 'centimeter vienna', name: 'Centimeter Wien', logo: '🍽️', category: 'essen', domain: 'centimeter.at' },
  { key: 'centimeter', name: 'Centimeter Wien', logo: '🍽️', category: 'essen', domain: 'centimeter.at' },
  { key: 'chocoberry', name: 'Chocoberry', logo: '🍓', category: 'essen', domain: 'chocoberry.at' },
  { key: 'aida', name: 'AIDA', logo: '🍦', category: 'essen', domain: 'aida.at' },
  { key: 'tomochan', name: 'Tomochan Ramen', logo: '🍜', category: 'essen' },
  { key: 'apapika', name: 'Apapika', logo: '🍲', category: 'essen', domain: 'apapika.com' },
  { key: 'honu tiki', name: 'Honu Tiki Bowls', logo: '🥗', category: 'essen', domain: 'honutikibowls.com' },
  { key: 'öh mensa', name: 'ÖH Mensa Wien', logo: '🍽️', category: 'essen', domain: 'oeh.ac.at' },
  { key: 'oeh mensa', name: 'ÖH Mensa Wien', logo: '🍽️', category: 'essen', domain: 'oeh.ac.at' },
  { key: 'oh mensa', name: 'ÖH Mensa Wien', logo: '🍽️', category: 'essen', domain: 'oeh.ac.at' },
  { key: 'raiffeisen raiffeistag', name: 'Raiffeisen RaiffEIStag', logo: '🍦', category: 'essen', domain: 'raiffeisen.at' },
  { key: 'mcdonald', name: "McDonald's", logo: '🍟', category: 'essen', domain: 'mcdonalds.at' },
  { key: 'burger king', name: 'Burger King', logo: '🍔', category: 'essen', domain: 'burgerking.at' },
  { key: 'starbucks', name: 'Starbucks', logo: '☕', category: 'kaffee', domain: 'starbucks.at' },
  { key: 'foodora', name: 'foodora', logo: '🍴', category: 'essen', domain: 'foodora.at' },
  { key: 'domino', name: "Domino's Pizza", logo: '🍕', category: 'essen', domain: 'dominos.at' },
  { key: 'dunkin', name: "Dunkin'", logo: '☕', category: 'kaffee', domain: 'dunkin.at' },
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
  { key: 'xxxlutz', name: 'XXXLutz', logo: '🪑', category: 'shopping', domain: 'xxxlutz.at' },
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
  { key: 'ben & jerry', name: "Ben & Jerry's", logo: '🍦', category: 'essen', domain: 'benjerry.at' },
  { key: 'nordsee', name: 'NORDSEE', logo: '🐟', category: 'essen', domain: 'nordsee.com' },
  { key: 'donauturm', name: 'Donauturm', logo: '🗼', category: 'kultur' },
  { key: 'genuss-festival', name: 'Genuss-Festival Wien', logo: '🧀', category: 'essen' },
  { key: 'momax', name: 'mömax Restaurant', logo: '🛋️', category: 'essen' },
  { key: 'mömax', name: 'mömax Restaurant', logo: '🛋️', category: 'essen' },
  { key: 'vapiano', name: 'Vapiano', logo: '🍝', category: 'essen', domain: 'vapiano.at' },
  { key: 'too good to go', name: 'Too Good To Go', logo: '🍴', category: 'essen', domain: 'toogoodtogo.com' },
  { key: 'grill heaven', name: 'Grill Heaven Wien', logo: '🔥', category: 'essen' },
  { key: 'gigafit', name: 'GigaFit', logo: '💪', category: 'fitness' },
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
  { key: 'donauinselfest', name: 'Donauinselfest', logo: '🎸', category: 'kultur', preferFallback: true },
  { key: 'foodsharing', name: 'Foodsharing', logo: '🍴', category: 'essen', domain: 'foodsharing.at' },
  { key: 'peter hahn', name: 'Peter Hahn', logo: '👗', category: 'shopping' },
  { key: 'pneus online', name: 'Pneus Online', logo: '🛞', category: 'shopping' },
  { key: 'omv viva', name: 'OMV VIVA', logo: '⛽', category: 'shopping', domain: 'omv.at' },
  { key: 'omv maxxmotion', name: 'OMV MaxxMotion', logo: '⛽', category: 'shopping', domain: 'omv.at' },
  { key: 'omv', name: 'OMV', logo: '⛽', category: 'shopping', domain: 'omv.at' },
  { key: 'spotify', name: 'Spotify', logo: '🎵', category: 'streaming', domain: 'spotify.com' },
  { key: 'evo fitness', name: 'EVO Fitness', logo: '💪', category: 'fitness', domain: 'evofitness.at' },
  { key: 'joe', name: 'joo', logo: '💳', category: 'supermarkt', domain: 'joe-club.at' },
  { key: 'joo', name: 'joo', logo: '💳', category: 'supermarkt', domain: 'joe-club.at' },
  { key: 'wolt', name: 'Wolt', logo: '🛵', category: 'essen', domain: 'wolt.com' },
  { key: 'lieferando', name: 'Lieferando', logo: '🛵', category: 'essen', domain: 'lieferando.at' },
  { key: 'uber eats', name: 'Uber Eats', logo: '🛵', category: 'essen', domain: 'ubereats.com' },
  { key: 'all4golf', name: 'ALL4GOLF', logo: '⛳', category: 'shopping', domain: 'all4golf.de' },
  { key: 'therme wien', name: 'Therme Wien', logo: '💧', category: 'wellness', domain: 'thermewien.at' },
  { key: 'madame tussauds', name: 'Madame Tussauds Wien', logo: '🎭', category: 'kultur', domain: 'madametussauds.com' },
  { key: 'spee', name: 'Spee', logo: '🧺', category: 'shopping' },
  { key: 'westfield', name: 'Westfield Club', logo: '🛍️', category: 'shopping', domain: 'westfield.com' },
  { key: 'ryanair', name: 'Ryanair', logo: '✈️', category: 'reisen', domain: 'ryanair.com' },
  { key: 'wizz air', name: 'Wizz Air', logo: '✈️', category: 'reisen', domain: 'wizzair.com' },
  { key: 'wizz', name: 'Wizz Air', logo: '✈️', category: 'reisen', domain: 'wizzair.com' },
  { key: 'oebb', name: 'ÖBB', logo: '🚂', category: 'reisen', domain: 'oebb.at' },
  { key: 'öbb', name: 'ÖBB', logo: '🚂', category: 'reisen', domain: 'oebb.at' },
  { key: 'flixbus', name: 'FlixBus', logo: '🚌', category: 'reisen', domain: 'flixbus.at' },
  { key: 'booking', name: 'Booking.com', logo: '🏨', category: 'reisen', domain: 'booking.com' },
  { key: 'airbnb', name: 'Airbnb', logo: '🏠', category: 'reisen', domain: 'airbnb.com' },
  { key: 'expedia', name: 'Expedia', logo: '✈️', category: 'reisen', domain: 'expedia.at' },
  { key: 'tui', name: 'TUI', logo: '✈️', category: 'reisen', domain: 'tui.at' },
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
const TRAVEL_SIGNAL_PATTERN = /\b(flug|flight|hotel|reise|urlaub|trip|ryanair|wizz|wizzair|oebb|obb|flixbus|booking|airbnb|sparschiene|bahnticket|railjet|zugticket)\b/i;

const SOURCE_LIKE_HOSTS = [
  /(^|\.)instagram\.com$/i,
  /(^|\.)tiktok\.com$/i,
  /(^|\.)facebook\.com$/i,
  /(^|\.)x\.com$/i,
  /(^|\.)twitter\.com$/i,
  /(^|\.)slack\.com$/i,
  /(^|\.)preisjaeger\./i,
  /(^|\.)1000thingsmagazine\.com$/i,
  /(^|\.)1000things\.at$/i,
  /(^|\.)heute\.at$/i,
  /(^|\.)vienna\.at$/i,
  /(^|\.)falstaff\./i,
  /(^|\.)events\.at$/i,
  /(^|\.)viennawurstelstand\.com$/i,
  /(^|\.)restauranttester\./i,
];

function cleanText(value) {
  if (!value) return '';
  return repairMojibake(String(value))
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function repairMojibake(value) {
  const text = String(value || '');
  if (!/[ÃÂâð]/.test(text)) return text;

  try {
    const repaired = Buffer.from(text, 'latin1').toString('utf8');
    const originalNoise = (text.match(/[ÃÂâð]/g) || []).length;
    const repairedNoise = (repaired.match(/[ÃÂâð]/g) || []).length;
    return repairedNoise < originalNoise ? repaired : text;
  } catch {
    return text;
  }
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
  return text
    .replace(/\bBestellunge\b/gi, 'Bestellung')
    .replace(/\*{3,}/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[,:\-–\s]+|[,:\-–\s]+$/g, '')
    .trim();
}

function normalizeAscii(value) {
  return cleanUiNoiseText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function findBrandRule(signal) {
  const normalized = normalizeAscii(signal);
  const escapedWordMatch = (key) => {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'i');
  };
  return BRAND_RULES.find((rule) => escapedWordMatch(rule.key).test(normalized))
    || BRAND_RULES.find((rule) => normalized.includes(rule.key));
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

function buildLogoUrl(host, { allowSourceLike = false } = {}) {
  if (!host || (!allowSourceLike && isSourceLikeHost(host))) return '';
  return `https://www.google.com/s2/favicons?sz=256&domain_url=https://${host}`;
}

function normalizeBrandKey(value) {
  return cleanUiNoiseText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
}

function isGoogleFaviconUrl(url) {
  return /https?:\/\/(?:www\.)?google\.com\/s2\/favicons/i.test(String(url || ''));
}

function isCachedBrandLogoUrl(url) {
  try {
    const parsed = new URL(String(url || ''));
    return /(^|\.)freefinder\.at$/i.test(parsed.hostname) && /\/assets\/brand-logos\//i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function extractGoogleFaviconTargetHost(url) {
  if (!isGoogleFaviconUrl(url)) return '';
  try {
    const parsed = new URL(String(url));
    const rawTarget = parsed.searchParams.get('domain_url') || parsed.searchParams.get('domain') || '';
    if (!rawTarget) return '';
    const targetUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(rawTarget) ? rawTarget : `https://${rawTarget}`;
    return extractHostFromUrl(targetUrl);
  } catch {
    return '';
  }
}

function extractLogoTargetHost(url) {
  return isGoogleFaviconUrl(url) ? extractGoogleFaviconTargetHost(url) : extractHostFromUrl(url);
}

function getHostKey(host) {
  const parts = cleanUiNoiseText(String(host || '').replace(/^www\./i, '')).split('.').filter(Boolean);
  if (!parts.length) return '';
  const root = parts.length > 1 ? parts[parts.length - 2] : parts[0];
  return normalizeBrandKey(root);
}

function cachedBrandLogoMatches(logoUrl, brand = '', known = null) {
  if (!isCachedBrandLogoUrl(logoUrl)) return false;
  let fileKey = '';
  try {
    const parsed = new URL(String(logoUrl));
    const filename = decodeURIComponent(parsed.pathname.split('/').pop() || '').replace(/\.[a-z0-9]+$/i, '');
    fileKey = normalizeBrandKey(filename);
  } catch {
    return false;
  }
  if (!fileKey) return false;

  const candidateKeys = [
    brand,
    known?.name,
    known?.key,
    known?.domain ? getHostKey(known.domain) : '',
  ].map(normalizeBrandKey).filter(Boolean);

  return candidateKeys.some((key) => fileKey.includes(key) || key.includes(fileKey));
}

function brandMatchesHost(brand, host) {
  const brandKey = normalizeBrandKey(brand);
  const hostKey = getHostKey(host);
  if (!brandKey || !hostKey) return false;
  return brandKey === hostKey || brandKey.includes(hostKey) || hostKey.includes(brandKey);
}

function hostMatchesKnownDomain(host, known = null) {
  const knownHost = extractHostFromUrl(known?.domain ? `https://${known.domain}` : '');
  if (!host || !knownHost) return false;
  return host === knownHost || host.endsWith(`.${knownHost}`) || brandMatchesHost(known?.name || known?.key || '', host);
}

function shouldUseHostLogo(deal = {}, brand = '', host = '', known = null) {
  if (!host || isSourceLikeHost(host)) return false;
  if (known?.preferFallback || known?.source) return false;
  if (known?.domain) return hostMatchesKnownDomain(host, known);

  const candidateBrand = brand || cleanUiNoiseText(deal.brand || '');
  if (!candidateBrand || isSourceLikeBrand(candidateBrand) || isLikelyGenericLocation(candidateBrand)) return false;
  return brandMatchesHost(candidateBrand, host);
}

function shouldUseLogoImage(deal = {}, brand = '', logoUrl = '', known = null) {
  if (!logoUrl) return false;
  const host = extractLogoTargetHost(logoUrl);
  if (!host) return false;
  return shouldUseHostLogo(deal, brand, host, known);
}

function hasSignalTerm(signal, pattern) {
  return new RegExp(`(?:^|[^a-z0-9])(?:${pattern})(?=$|[^a-z0-9])`, 'i').test(signal);
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

function brandRuleMatchesBrand(rule, brand) {
  if (!rule || !brand) return false;
  const brandKey = normalizeAscii(brand);
  const ruleKey = normalizeAscii(rule.key || '');
  const ruleName = normalizeAscii(rule.name || '');
  return Boolean(
    brandKey &&
      ((ruleKey && (brandKey === ruleKey || brandKey.includes(ruleKey) || ruleKey.includes(brandKey))) ||
        (ruleName && (brandKey === ruleName || brandKey.includes(ruleName) || ruleName.includes(brandKey))))
  );
}

function titleHasDominantBrandRule(title, rule) {
  if (!rule) return false;
  const text = normalizeAscii(title);
  if (!text) return false;

  const keys = [rule.key, rule.name]
    .map((value) => normalizeAscii(value || ''))
    .filter((value, index, all) => value && all.indexOf(value) === index);

  return keys.some((key) => {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return (
      new RegExp(`^${escaped}(?:\\b|\\s|:|-)`).test(text) ||
      new RegExp(`\\bbei\\s+${escaped}(?:\\b|\\s|:|-)`).test(text)
    );
  });
}

function sameBrandText(a, b) {
  const first = normalizeAscii(a);
  const second = normalizeAscii(b);
  return Boolean(first && second && first === second);
}

function replaceBrandMention(text, fromBrand, toBrand) {
  const value = cleanUiNoiseText(text);
  const from = cleanUiNoiseText(fromBrand);
  const to = cleanUiNoiseText(toBrand);
  if (!value || !from || !to || sameBrandText(from, to)) return value;

  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return value.replace(new RegExp(escaped, 'gi'), to).replace(/\s+/g, ' ').trim();
}

function inferPreferredBrand(deal = {}) {
  const explicitBrand = cleanUiNoiseText(deal.brand || '');
  const idSignal = cleanUiNoiseText(deal.id || '');
  const logoSignal = cleanUiNoiseText(deal.logoUrl || '');
  if (/joe-omv-viva|omv-viva/i.test(`${idSignal} ${logoSignal}`)) {
    return 'OMV VIVA';
  }

  const titleSignal = cleanUiNoiseText(deal.title || '');
  const knownInExplicitBrand = findBrandRule(explicitBrand);
  const knownInTitle = findBrandRule(titleSignal);

  if (
    knownInTitle &&
    !knownInTitle.source &&
    titleHasDominantBrandRule(titleSignal, knownInTitle) &&
    !brandRuleMatchesBrand(knownInTitle, explicitBrand)
  ) {
    return knownInTitle.name;
  }

  if (knownInExplicitBrand && !knownInExplicitBrand.source) {
    return knownInExplicitBrand.name;
  }

  if (explicitBrand && !isSourceLikeBrand(explicitBrand) && !isLikelyGenericLocation(explicitBrand)) {
    return explicitBrand;
  }

  const bracketBrand = extractBracketBrand(deal.title);
  if (bracketBrand) return bracketBrand;

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
  if (deal.logoUrl && cachedBrandLogoMatches(deal.logoUrl, brand || deal.brand, known)) return deal.logoUrl;
  if (known?.domain && !known?.preferFallback) return buildLogoUrl(known.domain, { allowSourceLike: true });
  if (deal.logoUrl && shouldUseLogoImage(deal, brand, deal.logoUrl, known)) return deal.logoUrl;

  const directHost = extractHostFromUrl(deal.image || deal.imageUrl || deal.url || deal.post_url);
  if (shouldUseHostLogo(deal, brand, directHost, known)) return buildLogoUrl(directHost);

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
  if (hasSignalTerm(signal, 'ice cream|eis|eiscreme|gelato|cone')) return '🍦';
  if (hasSignalTerm(signal, 'kaffee|coffee|espresso|latte|matcha|tea|tee')) return '☕';
  if (hasSignalTerm(signal, 'ticket|festival|museum|concert|ausstellung|show')) return '🎫';
  if (hasSignalTerm(signal, 'garten|botanisch|park')) return '🌿';
  if (hasSignalTerm(signal, 'book|buch|thalia')) return '📚';
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

function normalizeDescriptionKey(value = '') {
  return cleanUiNoiseText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' und ')
    .replace(/[^\p{L}\p{N}%€]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function descriptionMetadataWords(deal = {}) {
  const base = [
    'gratis',
    'kostenlos',
    'rabatt',
    'aktion',
    'angebot',
    'deal',
    'bzw',
    'bogo',
    'kombination',
    'kombi',
    'wien',
    'online',
    'osterreich',
    'österreich',
    'standort',
    'standorte',
    'station',
    'stationen',
    'filiale',
    'filialen',
    'app',
    'bei',
    'in',
    'auf',
    'bis',
    'ca',
    'am',
    'laut',
    'quelle',
  ];
  return new Set([
    ...base,
    ...normalizeDescriptionKey([deal.brand, deal.distance, deal.location, deal.category, deal.type].filter(Boolean).join(' ')).split(' '),
  ].filter(Boolean));
}

function isRedundantDescription(description = '', deal = {}) {
  const titleKey = normalizeDescriptionKey(deal.title || '');
  const descriptionKey = normalizeDescriptionKey(description);
  if (!titleKey || !descriptionKey) return false;
  if (descriptionKey === titleKey) return true;

  const metadata = descriptionMetadataWords(deal);
  const descriptionWords = descriptionKey.split(' ').filter((word) => word.length > 1 || /^\d+$/.test(word));
  if (descriptionWords.length > 0 && descriptionWords.every((word) => metadata.has(word) || /^\d+$/.test(word))) {
    return true;
  }

  const residue = descriptionKey.replace(titleKey, ' ').replace(/\s+/g, ' ').trim();
  if (!residue) return true;
  const residueWords = residue.split(' ').filter((word) => word.length > 1 || /^\d+$/.test(word));
  return residueWords.length > 0 && residueWords.every((word) => metadata.has(word) || /^\d{4}$/.test(word));
}

function cleanDescriptionForDisplay(description = '', deal = {}) {
  let text = cleanUiNoiseText(description);
  if (!text) return '';

  const brand = cleanUiNoiseText(deal.brand || '');
  if (brand) {
    const escapedBrand = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text
      .replace(new RegExp(`^[^\\p{L}\\p{N}]{0,4}\\s*${escapedBrand}\\s*[-–:]\\s*`, 'iu'), '')
      .trim();
  }

  const titleKey = normalizeDescriptionKey(deal.title || '');
  const rawDescriptionKey = normalizeDescriptionKey(text);
  if (titleKey && rawDescriptionKey.includes(titleKey) && /laut screenshot|screenshot ist|den vorteil/i.test(text)) {
    return '';
  }

  text = text
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z\b/gi, ' ')
    .replace(/\bGratis\s*[•|-]\s*Gratis\b/gi, 'Gratis')
    .replace(/\s*[•|]\s*/g, ' • ')
    .replace(/\s+/g, ' ')
    .replace(/^[•,:\-–\s]+|[•,:\-–\s]+$/g, '')
    .trim();

  if (brand) {
    const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(`^${escaped}\\s*:\\s*`, 'i'), '').trim();
  }

  const title = cleanUiNoiseText(deal.title || '');
  if (title) {
    const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const compacted = text
      .replace(new RegExp(`^${escapedTitle}\\s*`, 'i'), '')
      .replace(/^[,.:;\-–\s]+/, '')
      .trim();
    if (compacted && compacted.length < text.length && compacted.split(/\s+/).length <= 8) {
      text = compacted.replace(/^(für|fur)\b/i, 'Für');
    }
  }

  const parts = text.split(/\s+•\s+/).map(cleanUiNoiseText).filter(Boolean);
  if (parts.length > 1) {
    const metadata = descriptionMetadataWords(deal);
    const filtered = parts.filter((part) => {
      if (isRedundantDescription(part, deal)) return false;
      const key = normalizeDescriptionKey(part);
      if (!key) return false;
      const words = key.split(' ').filter(Boolean);
      return !words.every((word) => metadata.has(word) || /^\d{4}$/.test(word));
    });
    text = filtered.join(' • ');
  }

  if (isRedundantDescription(text, deal)) return '';
  return text;
}

function sanitizeExpiryText(value) {
  const raw = cleanUiNoiseText(value || '');
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}t/i.test(raw) || /^\d{4}-\d{2}-\d{2}T/.test(raw)) return raw;

  let text = raw
    .replace(/\bunknown\b/gi, ' ')
    .replace(/\bk\.?\s*a\.?\b/gi, ' ')
    .replace(/\bnot specified\b/gi, ' ')
    .replace(/\bnicht spezifiziert\b/gi, ' ')
    .replace(/\bsiehe details\b/gi, ' ')
    .replace(/\bsee details\b/gi, ' ')
    .replace(/\bsiehe website\b/gi, ' ')
    .replace(/\bsiehe coupons(?: in)?\b/gi, ' ')
    .replace(/\bsiehe mensa-?öffnungszeiten\b/gi, ' ')
    .replace(/\bsiehe mensa-?oeffnungszeiten\b/gi, ' ')
    .replace(/\bregular hours\b/gi, ' ')
    .replace(/\bw[aä]hrend [a-zäöüß ]*öffnungszeiten\b/gi, ' ')
    .replace(/\bvia neotaste\b/gi, ' ')
    .replace(/\bongoing\b/gi, ' ')
    .replace(/\blaufende? aktion\b/gi, ' ')
    .replace(/\blaufend\b/gi, ' ')
    .replace(/\bnicht angegeben\b/gi, ' ')
    .replace(/\bzeiten auf webseite prüfen\b/gi, ' ')
    .replace(/\baktuelle termine auf webseite\b/gi, ' ')
    .replace(/\blaut quelle\b/gi, ' ')
    .replace(/laut\s+j[öo]/gi, ' ')
    .replace(/\bsiehe webseite\b/gi, ' ')
    .replace(/\bimmer\b/gi, ' ')
    .replace(/\bpermanent nach vereinbarung\b/gi, ' ')
    .replace(/\bfrühjahr 20\d{2}\b/gi, ' ')
    .replace(/\bfruehjahr 20\d{2}\b/gi, ' ')
    .replace(/\bseason opening 20\d{2}\b/gi, ' ')
    .replace(/\(neotaste deal\)/gi, ' ')
    .replace(/\(7 days rolling\)/gi, ' ')
    .replace(/\bw\+\s*weeks\b/gi, ' ')
    .replace(/\bgültig 2 tage vor oder nach dem geburtstag\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[,.:;\/\-–\s]+|[,.:;\/\-–\s]+$/g, '')
    .trim();

  if (/^[.\/:;\-–\s]*$/.test(text)) return '';
  if (/^\d{4}$/.test(text)) return '';
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
  const explicitBrand = cleanUiNoiseText(deal.brand || '');
  const brand = inferPreferredBrand({ ...deal, title, description });
  const type = inferPreferredType({ ...deal, title, description, brand });
  const known = findBrandRule([brand, title, description, deal.distance, deal.url, deal.post_url].filter(Boolean).join(' '));
  const currentCategory = cleanUiNoiseText(deal.category || '').toLowerCase();
  const categorySignal = [brand, title, description, deal.distance, deal.url, deal.post_url, currentCategory].filter(Boolean).join(' ');
  const hasTravelSignal = TRAVEL_SIGNAL_PATTERN.test(normalizeAscii(categorySignal));
  const brandWasCorrected = explicitBrand && brand && !sameBrandText(explicitBrand, brand);
  let category = known?.category && (brandWasCorrected || GENERIC_CATEGORIES.has(currentCategory) || (currentCategory === 'shopping' && known.category !== 'shopping'))
    ? known.category
    : currentCategory;

  if ((currentCategory === 'freizeit' || GENERIC_CATEGORIES.has(currentCategory)) && hasTravelSignal) {
    category = 'reisen';
  }

  category = normalizeCategoryForScraper(category || currentCategory, [
    brand,
    title,
    description,
    deal.distance,
    deal.url,
    deal.post_url,
    type,
    deal.source,
    deal.originSource,
  ]);

  const categoryAsciiSignal = normalizeAscii(categorySignal);
  if (/\bomv\b/.test(categoryAsciiSignal)) {
    if (hasSignalTerm(categoryAsciiSignal, 'kaffee|coffee|espresso|latte|matcha|cappuccino')) {
      category = 'kaffee';
    } else if (hasSignalTerm(categoryAsciiSignal, 'drink|getraenk|getrank|tonic|sunset|orange|strawberry|coconut|sandwich|sandwiches|meal|snack')) {
      category = 'essen';
    }
  }

  const sanitizedExpires = sanitizeExpiryText(deal.expires);
  if (brandWasCorrected) {
    description = replaceBrandMention(description, explicitBrand, brand);
  }
  description = cleanDescriptionForDisplay(description, {
    ...deal,
    brand,
    title,
    type,
    category,
  });

  if (!description) {
    description = '';
  }
  return {
    ...deal,
    title,
    description,
    brand: brand || cleanUiNoiseText(deal.brand || ''),
    type: type || cleanUiNoiseText(deal.type || '').toLowerCase(),
    category: category || currentCategory,
    expires: sanitizedExpires,
    expiresOriginal: sanitizeExpiryText(deal.expiresOriginal),
    expiryDisplayText: sanitizeExpiryText(deal.expiryDisplayText),
    distance: cleanUiNoiseText(deal.distance || ''),
    location: cleanUiNoiseText(deal.location || ''),
    logo: inferLogo({ ...deal, title, description, type, category }, brand),
    logoUrl: inferLogoUrl({ ...deal, title, description, type, category }, brand),
  };
}

export {
  buildFallbackDescription,
  cleanDescriptionForDisplay,
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

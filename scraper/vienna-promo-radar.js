import '../sentry/instrument.mjs';
import fs from 'fs';
import {
  cleanText,
  cleanUiNoiseText,
  isExpiredDealRecord,
  isFalsePositiveFreeDeal,
  isGenericJunkDeal,
  normalizeDealRecord,
  sanitizeExpiryText,
} from './deal-normalization-utils.js';
import { normalizeCategoryForScraper } from './category-utils.js';

const OUTPUT_PATH = 'docs/deals-pending-vienna-promo-radar.json';
const FEED_LANGUAGE = 'de';
const FEED_REGION = 'AT';
const FEED_EDITION = 'AT:de';
const REQUEST_TIMEOUT_MS = 15000;
const MAX_RESULTS_PER_QUERY = 14;
const MAX_DEALS_OUTPUT = 18;
const MIN_QUALITY_SCORE = 56;
const DAY_MS = 24 * 60 * 60 * 1000;

const SEARCH_PACKS = [
  {
    query: 'wien gratis kaffee aktion eroeffnung',
    category: 'kaffee',
    logo: '☕',
    required: [/\b(kaffee|coffee|cafe|cappuccino|espresso|starbucks|getraenk|drink)\b/i],
  },
  {
    query: 'wien gratis getraenk aktion standort',
    category: 'kaffee',
    logo: '☕',
    required: [/\b(kaffee|coffee|cafe|drink|getraenk|bar|starbucks)\b/i],
  },
  {
    query: 'wien gratis burger pizza kebab aktion',
    category: 'essen',
    logo: '🍔',
    required: [/\b(burger|pizza|kebab|kebap|doener|doner|restaurant|food|drink)\b/i],
  },
  {
    query: 'wien 1+1 brunch restaurant deal',
    category: 'essen',
    logo: '🍽️',
    required: [/\b(1\s*\+\s*1|bogo|2\s*f(?:u|ue)?r\s*1|brunch|restaurant|cocktail|drink)\b/i],
  },
  {
    query: 'wien gratis eis freebie neueroeffnung',
    category: 'essen',
    logo: '🍦',
    required: [/\b(eis|gelato|ice cream|dessert|sundae|cone)\b/i],
  },
  {
    query: 'wien gratis probetraining fitness',
    category: 'fitness',
    logo: '💪',
    required: [/\b(probetraining|fitness|gym|studio|workout|yoga|pilates|holmes place|gigafit|fitinn|mcfit)\b/i],
  },
  {
    query: 'wien beauty gratis goodie bag eroeffnung',
    category: 'beauty',
    logo: '💄',
    required: [/\b(beauty|kosmetik|parfum|make[- ]?up|goodie|sephora|bipa|dm|mueller|muller)\b/i],
  },
  {
    query: 'wien supermarkt gratis verkostung aktion',
    category: 'supermarkt',
    logo: '🛒',
    required: [/\b(supermarkt|spar|billa|hofer|lidl|penny|verkostung|produktprobe|probier|verkauf)\b/i],
  },
  {
    query: 'wien shopping eroeffnung goodie bag aktion',
    category: 'shopping',
    logo: '🛍️',
    required: [/\b(store|shopping|goodie|sale|eroeffnung|opening|gutschein)\b/i],
  },
  {
    query: 'wien technik gratis zugabe aktion',
    category: 'technik',
    logo: '📱',
    required: [/\b(technik|tech|samsung|apple|mediamarkt|saturn|zugabe|launch|eroeffnung)\b/i],
  },
  {
    query: 'wien gratis anreise klimaticket',
    category: 'reisen',
    logo: '✈️',
    required: [/\b(reise|flug|hotel|gutschein|anreise|oebb|klimaticket|bahn|ryanair|wizz)\b/i],
  },
];

const VIENNA_PATTERNS = [
  /\bwien\b/i,
  /\bvienna\b/i,
  /\b1\d{3}\b/i,
];

const CONFLICT_LOCATION_PATTERNS = [
  /\binnsbruck\b/i,
  /\bgraz\b/i,
  /\bsalzburg\b/i,
  /\blinz\b/i,
  /\bklagenfurt\b/i,
  /\bvorarlberg\b/i,
  /\btirol\b/i,
  /\bkaernten\b/i,
  /\bkarnten\b/i,
  /\bniederoesterreich\b/i,
  /\boberoesterreich\b/i,
  /\bst\.?\s*poelten\b/i,
  /\bspittal\b/i,
  /\bdornbirn\b/i,
  /\bsteyr\b/i,
  /\binnviertel\b/i,
];

const STRONG_PROMO_PATTERNS = [
  /\bgratis\b/i,
  /\bkostenlos\b/i,
  /\bfree\b/i,
  /\b1\s*\+\s*1\b/i,
  /\bbogo\b/i,
  /\b2\s*f(?:u|ue)?r\s*1\b/i,
  /\bgoodie(?:-|\s)?bag\b/i,
  /\bfreebie\b/i,
  /\bprobetraining\b/i,
  /\bgratis[-\s]?getraenk\b/i,
  /\bgratis[-\s]?kaffee\b/i,
  /\bwillkommensgeschenk\b/i,
  /\bgratis[-\s]?aktion\b/i,
];

const SOFT_PROMO_PATTERNS = [
  /\brabatt\b/i,
  /\bdiscount\b/i,
  /\bgutschein\b/i,
  /\bvoucher\b/i,
  /\bdeal\b/i,
  /\bangebot(?:e|en)?\b/i,
  /\baktion\b/i,
  /\bbonus\b/i,
  /(^|[^0-9])\d{1,2}\s?%/i,
];

const CURRENT_SIGNAL_PATTERNS = [
  /\bheute\b/i,
  /\bjetzt\b/i,
  /\bnur\b/i,
  /\bneu(?:e|en|er|es)?\b/i,
  /\bstartet\b/i,
  /\bgestartet\b/i,
  /\boeffnet\b/i,
  /\beroeffnet\b/i,
  /\beroeffnung\b/i,
  /\bopening\b/i,
  /\bbis\b/i,
  /\bwochenende\b/i,
  /\bdiese(?:r|s|n)?\b/i,
];

const NEGATIVE_PATTERNS = [
  /\bwohnmobil\b/i,
  /\bwohnung\b/i,
  /\bimmobil/i,
  /\bmiete\b/i,
  /\bjob\b/i,
  /\bstellen/i,
  /\bbetrug/i,
  /\bwarnung/i,
  /\bterror/i,
  /\banklage/i,
  /\bprozess/i,
  /\bentlassen/i,
  /\bgeschichte\b/i,
  /\bkommentar\b/i,
  /\bsprechstunde\b/i,
  /\bguide\b/i,
  /\btipps?\b/i,
  /\bdie besten\b/i,
  /\bfrauenwoche\b/i,
  /\bmuseum\b/i,
  /\bausstellung\b/i,
  /\bkonzert\b/i,
  /\bfestival\b/i,
  /\bgewinnspiel\b/i,
  /\barchivmeldung\b/i,
  /\bwatchlist\b/i,
];

const TRUSTED_SOURCE_PATTERNS = [
  /(^|\.)5min\.at$/i,
  /(^|\.)heute\.at$/i,
  /(^|\.)meinbezirk\.at$/i,
  /(^|\.)vienna\.at$/i,
  /(^|\.)wien\.orf\.at$/i,
  /(^|\.)kurier\.at$/i,
  /(^|\.)krone\.at$/i,
  /(^|\.)derstandard\.at$/i,
  /(^|\.)standard\.at$/i,
  /(^|\.)gaultmillau\.at$/i,
  /(^|\.)goodnight\.at$/i,
  /(^|\.)gastroportal\.at$/i,
  /(^|\.)oe24\.at$/i,
];

function decodeHtmlEntities(value) {
  if (!value) return '';
  return String(value)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&uuml;/gi, 'ue')
    .replace(/&ouml;/gi, 'oe')
    .replace(/&auml;/gi, 'ae')
    .replace(/&szlig;/gi, 'ss')
    .replace(/&#(\d+);/g, (_, code) => {
      const num = Number(code);
      return Number.isFinite(num) ? String.fromCharCode(num) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const num = Number.parseInt(code, 16);
      return Number.isFinite(num) ? String.fromCharCode(num) : '';
    });
}

function cleanSignal(value) {
  return cleanUiNoiseText(decodeHtmlEntities(value || ''))
    .replace(/\s+/g, ' ')
    .trim();
}

function fetchText(url) {
  return fetch(url, {
    headers: {
      'Accept': 'application/rss+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8',
      'Accept-Language': 'de-AT,de;q=0.9,en;q=0.8',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.text();
  });
}

function getTag(block, tagName) {
  const match = block.match(new RegExp(`<${tagName}(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  return cleanSignal(match?.[1] || '');
}

function parseRssItems(xml) {
  const items = [];
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];
  for (const block of blocks) {
    const sourceMatch = block.match(/<source(?:\s+url="([^"]+)")?>([\s\S]*?)<\/source>/i);
    items.push({
      title: getTag(block, 'title'),
      link: getTag(block, 'link'),
      pubDate: getTag(block, 'pubDate'),
      description: getTag(block, 'description'),
      sourceUrl: cleanSignal(sourceMatch?.[1] || ''),
      sourceName: cleanSignal(sourceMatch?.[2] || ''),
    });
  }
  return items;
}

function stableHash(value) {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
    hash >>>= 0;
  }
  return hash.toString(36);
}

function dealId(prefix, brand, title, url) {
  return `${prefix}-${stableHash(`${brand}|${title}|${url}`)}`;
}

function stripPublisherSuffix(title, sourceName) {
  const cleanTitle = cleanSignal(title);
  const cleanSource = cleanSignal(sourceName);
  if (!cleanSource) return cleanTitle;
  const suffixPattern = new RegExp(`\\s+-\\s+${cleanSource.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  return cleanTitle
    .replace(/^werbung\s*-\s*/i, '')
    .replace(suffixPattern, '')
    .trim();
}

function hasViennaSignal(value) {
  return VIENNA_PATTERNS.some((pattern) => pattern.test(value));
}

function hasLocationConfidence(value, pack) {
  if (hasViennaSignal(value)) return true;
  if (!String(pack.query || '').toLowerCase().includes('wien')) return false;
  return !CONFLICT_LOCATION_PATTERNS.some((pattern) => pattern.test(value));
}

function getHost(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isTrustedSource(host) {
  if (!host) return false;
  if (TRUSTED_SOURCE_PATTERNS.some((pattern) => pattern.test(host))) return true;
  return host.endsWith('.at');
}

function inferType(signal) {
  if (/\b(1\s*\+\s*1|2\s*f(?:u|ue)?r\s*1|2 for 1|bogo)\b/i.test(signal)) return 'bogo';
  if (/\b(probetraining|goodie(?:-|\s)?bag|freebie|willkommensgeschenk|welcome gift|gratis[-\s]?zugabe)\b/i.test(signal)) return 'freebie';
  if (/\b(gratis|kostenlos|free)\b/i.test(signal)) return 'gratis';
  if (/\b(rabatt|discount|gutschein|voucher|angebot(?:e|en)?|deal|bonus)\b/i.test(signal) || /(^|[^0-9])\d{1,2}\s?%/i.test(signal)) return 'rabatt';
  return '';
}

function badgeForType(type) {
  if (type === 'gratis') return 'gratis';
  if (type === 'bogo') return 'limited';
  if (type === 'freebie') return 'limited';
  return 'limited';
}

function extractBrandCandidate(title) {
  const patterns = [
    /\bmit d(?:er|em)\s+([A-Z][A-Za-z0-9&' .-]{1,40}?)(?:\s+(?:ab|bis|fuer|für|in|und|mit|:)|$)/i,
    /:\s*([A-Z][A-Za-z0-9&' .-]{1,60}?)\s+(?:eroeffnet|eröffnet|oeffnet|öffnet|startet|feiert|bietet|laedt|lädt|schenkt)/,
    /\bbei\s+([A-Z][A-Za-z0-9&' .-]{1,60})/i,
    /\b([A-Z][A-Za-z0-9&' .-]{1,60}?)\s+(?:eroeffnet|eröffnet|oeffnet|öffnet|startet|feiert|schenkt|bietet|laedt|lädt)\b/,
  ];
  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match?.[1]) return cleanSignal(match[1]);
  }
  return '';
}

function looksLikePublisherBrand(value, sourceName) {
  const brand = cleanSignal(value).toLowerCase();
  const publisher = cleanSignal(sourceName).toLowerCase();
  if (!brand) return true;
  if (publisher && brand === publisher) return true;
  if (brand.startsWith('wien • ')) return true;
  if (/\b(zeitung|meinbezirk|orf|heute|kurier|krone|land)\b/i.test(brand)) return true;
  return false;
}

function extractExpiryText(signal) {
  const explicit = signal.match(/\b(?:bis|gueltig bis|noch bis|nur bis|until)\s+([0-3]?\d\.[01]?\d(?:\.\d{2,4})?)/i);
  if (explicit?.[0]) return sanitizeExpiryText(explicit[0]);
  if (/\bnur heute\b/i.test(signal)) return 'Nur heute';
  if (/\bdieses wochenende\b/i.test(signal)) return 'Dieses Wochenende';
  if (/\bdiese woche\b/i.test(signal)) return 'Diese Woche';
  return '';
}

function ageDays(pubDate) {
  const ts = Date.parse(pubDate);
  if (Number.isNaN(ts)) return null;
  return Math.max(0, Math.floor((Date.now() - ts) / DAY_MS));
}

function maxAgeForCandidate(signal, type, category) {
  if (/\b(probetraining|free trial|testmonat|schnuppertraining)\b/i.test(signal)) return 120;
  if (category === 'reisen') return 75;
  if (/\b(eroeffnet|oeffnet|eroeffnung|opening|heute|wochenende|goodie|gratis[-\s]?getraenk|gratis[-\s]?kaffee)\b/i.test(signal)) return 21;
  if (type === 'bogo') return 30;
  if (type === 'freebie') return 60;
  if (type === 'rabatt') return 45;
  return 35;
}

function buildDescription(title, sourceName, expires) {
  return [title, expires, sourceName].filter(Boolean).join(' • ');
}

function buildLogoUrl(sourceUrl) {
  const host = getHost(sourceUrl);
  if (!host) return '';
  return `https://www.google.com/s2/favicons?sz=128&domain_url=https://${host}`;
}

function buildQualityScore({
  type,
  trustedSource,
  strongPromo,
  softPromo,
  currentSignal,
  categoryMatch,
  brandFound,
  articleAgeDays,
  explicitExpiry,
}) {
  let score = 0;
  if (type === 'gratis') score += 34;
  else if (type === 'bogo') score += 30;
  else if (type === 'freebie') score += 26;
  else if (type === 'rabatt') score += 18;

  if (strongPromo) score += 18;
  else if (softPromo) score += 8;
  if (currentSignal) score += 10;
  if (categoryMatch) score += 12;
  if (brandFound) score += 8;
  if (trustedSource) score += 8;
  if (explicitExpiry) score += 4;

  if (articleAgeDays !== null) {
    if (articleAgeDays <= 3) score += 12;
    else if (articleAgeDays <= 7) score += 10;
    else if (articleAgeDays <= 14) score += 7;
    else if (articleAgeDays <= 30) score += 4;
  }

  return Math.round(score);
}

function normalizeDealTitle(title, type) {
  const cleanTitle = cleanSignal(title);
  if (!cleanTitle) return '';
  if (type === 'gratis' && !/^gratis:/i.test(cleanTitle)) return `GRATIS: ${cleanTitle}`;
  if (type === 'bogo' && !/^(1\+1|bogo):/i.test(cleanTitle)) return `1+1: ${cleanTitle}`;
  if (type === 'freebie' && !/^freebie:/i.test(cleanTitle)) return `FREEBIE: ${cleanTitle}`;
  return cleanTitle;
}

function createCandidate(item, pack) {
  const titleCore = stripPublisherSuffix(item.title, item.sourceName);
  const sourceName = cleanSignal(item.sourceName || '');
  const sourceUrl = cleanSignal(item.sourceUrl || '');
  const host = getHost(sourceUrl);
  const signal = [titleCore, item.description, sourceName].filter(Boolean).join(' ');
  const normalizedSignal = cleanSignal(signal);
  const type = inferType(normalizedSignal);
  const articleAgeDays = ageDays(item.pubDate);
  const category = normalizeCategoryForScraper(pack.category, [titleCore, item.description, sourceName]);
  const maxAgeDays = maxAgeForCandidate(normalizedSignal, type, category);
  const strongPromo = STRONG_PROMO_PATTERNS.some((pattern) => pattern.test(normalizedSignal));
  const softPromo = strongPromo || SOFT_PROMO_PATTERNS.some((pattern) => pattern.test(normalizedSignal));
  const categoryMatch = pack.required.some((pattern) => pattern.test(normalizedSignal));
  const currentSignal = CURRENT_SIGNAL_PATTERNS.some((pattern) => pattern.test(normalizedSignal));

  if (!hasLocationConfidence(normalizedSignal, pack)) return null;
  if (!softPromo) return null;
  if (!categoryMatch) return null;
  if (!type) return null;
  if (NEGATIVE_PATTERNS.some((pattern) => pattern.test(normalizedSignal))) return null;
  if (articleAgeDays === null || articleAgeDays > maxAgeDays) return null;

  const expiryText = extractExpiryText(normalizedSignal);
  const brand = extractBrandCandidate(titleCore);
  const qualityScore = buildQualityScore({
    type,
    trustedSource: isTrustedSource(host),
    strongPromo,
    softPromo,
    currentSignal,
    categoryMatch,
    brandFound: Boolean(brand),
    articleAgeDays,
    explicitExpiry: Boolean(expiryText),
  });

  if (qualityScore < MIN_QUALITY_SCORE) return null;

  let deal = {
    id: dealId('vpr', brand || sourceName || 'wien', titleCore, item.link || sourceUrl || titleCore),
    brand,
    logo: pack.logo,
    logoUrl: buildLogoUrl(sourceUrl),
    title: normalizeDealTitle(titleCore, type),
    description: buildDescription(titleCore, sourceName, expiryText),
    type,
    badge: badgeForType(type),
    category,
    source: 'Vienna Promo Radar',
    originSource: 'Google News RSS',
    url: item.link || sourceUrl,
    expires: expiryText,
    distance: sourceName ? `Wien • ${sourceName}` : 'Wien',
    hot: type === 'gratis' || type === 'bogo',
    isNew: true,
    qualityScore,
    pubDate: new Date(Date.parse(item.pubDate)).toISOString(),
    publisher: sourceName,
    publisherUrl: sourceUrl,
    evidence: 'google-news-rss',
    newsQuery: pack.query,
  };

  deal = normalizeDealRecord(deal);
  if (looksLikePublisherBrand(deal.brand, sourceName)) {
    deal.brand = brand || extractBrandCandidate(titleCore) || sourceName || 'Wien Promo';
  }
  deal.logo = pack.logo;
  deal.logoUrl = buildLogoUrl(sourceUrl) || deal.logoUrl;
  if (isGenericJunkDeal(deal)) return null;
  if (deal.type === 'gratis' && isFalsePositiveFreeDeal(deal)) return null;
  if (isExpiredDealRecord(deal)) return null;

  deal.expires = sanitizeExpiryText(deal.expires || '');
  return deal;
}

function feedUrl(query) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${FEED_LANGUAGE}&gl=${FEED_REGION}&ceid=${encodeURIComponent(FEED_EDITION)}`;
}

async function main() {
  console.log('========================================');
  console.log('VIENNA PROMO RADAR');
  console.log(new Date().toLocaleString('de-AT'));
  console.log('========================================');

  const seenKeys = new Set();
  const collectedDeals = [];

  for (const pack of SEARCH_PACKS) {
    try {
      console.log(`Searching: ${pack.query}`);
      const xml = await fetchText(feedUrl(pack.query));
      const items = parseRssItems(xml).slice(0, MAX_RESULTS_PER_QUERY);
      console.log(`  Feed items: ${items.length}`);

      for (const item of items) {
        const candidate = createCandidate(item, pack);
        if (!candidate) continue;

        const dedupeKey = [
          cleanSignal(candidate.brand || ''),
          cleanSignal(candidate.title || ''),
          cleanSignal(candidate.publisher || ''),
          candidate.pubDate ? candidate.pubDate.slice(0, 10) : '',
        ].join('|');

        if (seenKeys.has(dedupeKey)) continue;
        seenKeys.add(dedupeKey);
        collectedDeals.push(candidate);
        console.log(`  + ${candidate.title} [${candidate.qualityScore}]`);
      }
    } catch (error) {
      console.log(`  Error: ${error.message}`);
    }
  }

  const finalDeals = collectedDeals
    .sort((left, right) => {
      if ((right.qualityScore || 0) !== (left.qualityScore || 0)) {
        return (right.qualityScore || 0) - (left.qualityScore || 0);
      }
      return new Date(right.pubDate || 0).getTime() - new Date(left.pubDate || 0).getTime();
    })
    .slice(0, MAX_DEALS_OUTPUT);

  const payload = {
    lastUpdated: new Date().toISOString(),
    source: 'vienna-promo-radar-v1',
    totalDeals: finalDeals.length,
    deals: finalDeals,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2));

  console.log('----------------------------------------');
  console.log(`Candidates kept: ${finalDeals.length}`);
  console.log(`Output: ${OUTPUT_PATH}`);
  console.log('Done.');
}

main().catch((error) => {
  console.error(`Fatal: ${error.message}`);
  process.exit(0);
});

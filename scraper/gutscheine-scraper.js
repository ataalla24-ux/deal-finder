import '../sentry/instrument.mjs';
// ============================================
// FREEFINDER WIEN - GUTSCHEINE.AT SCRAPER
// Scraped aktuelle Gutscheine & Rabattcodes
// Braucht KEIN API-Key (direkt HTTP fetch)
// Output: docs/deals-pending-gutscheine.json
// ============================================

import https from 'https';
import fs from 'fs';
import { pathToFileURL } from 'url';

// ============================================
// CONFIG
// ============================================

const PAGES_TO_SCRAPE = [
  { url: 'https://www.gutscheine.at/neue-gutscheine', name: 'Neueste' },
  { url: 'https://www.gutscheine.at/beste-gutscheine', name: 'Beste' },
  { url: 'https://www.gutscheine.at/exklusive-gutscheine', name: 'Exklusive' },
];

// Nur Shops die für Wien-User relevant sind (AT-fokussiert)
const RELEVANT_CATEGORIES = {
  // Essen & Trinken
  'hellofresh': { category: 'essen', logo: '🥗' },
  'mjam': { category: 'essen', logo: '🍕' },
  'wolt': { category: 'essen', logo: '🍔' },
  'lieferando': { category: 'essen', logo: '🍕' },
  'dominos': { category: 'essen', logo: '🍕' },
  'subway': { category: 'essen', logo: '🥪' },
  'mcdonalds': { category: 'essen', logo: '🍟' },
  'burger king': { category: 'essen', logo: '🍔' },

  // Supermärkte & Drogerie
  'billa': { category: 'supermarkt', logo: '🛒' },
  'spar': { category: 'supermarkt', logo: '🛒' },
  'hofer': { category: 'supermarkt', logo: '🛒' },
  'lidl': { category: 'supermarkt', logo: '🛒' },
  'penny': { category: 'supermarkt', logo: '🛒' },
  'bipa': { category: 'beauty', logo: '💇' },
  'dm': { category: 'beauty', logo: '💄' },
  'müller': { category: 'beauty', logo: '🧴' },
  'douglas': { category: 'beauty', logo: '💄' },
  'marionnaud': { category: 'beauty', logo: '💄' },
  'notino': { category: 'beauty', logo: '🧴' },

  // Mode & Schuhe (beliebt in AT)
  'zalando': { category: 'mode', logo: '👟' },
  'about you': { category: 'mode', logo: '👗' },
  'h&m': { category: 'mode', logo: '👕' },
  'hm': { category: 'mode', logo: '👕' },
  'c&a': { category: 'mode', logo: '👕' },
  'deichmann': { category: 'mode', logo: '👟' },
  'humanic': { category: 'mode', logo: '👟' },
  'snipes': { category: 'mode', logo: '👟' },
  'nike': { category: 'mode', logo: '👟' },
  'adidas': { category: 'mode', logo: '👟' },
  'puma': { category: 'mode', logo: '👟' },
  'kastner': { category: 'mode', logo: '👗' },
  'peek': { category: 'mode', logo: '👗' },
  'tom tailor': { category: 'mode', logo: '👕' },
  'levi': { category: 'mode', logo: '👖' },
  'emp': { category: 'mode', logo: '👕' },

  // Technik
  'mediamarkt': { category: 'technik', logo: '📺' },
  'saturn': { category: 'technik', logo: '📺' },
  'cyberport': { category: 'technik', logo: '💻' },
  'conrad': { category: 'technik', logo: '🔧' },
  'alternate': { category: 'technik', logo: '💻' },
  'samsung': { category: 'technik', logo: '📱' },
  'apple': { category: 'technik', logo: '📱' },
  'huawei': { category: 'technik', logo: '📱' },
  'medion': { category: 'technik', logo: '💻' },
  'lenovo': { category: 'technik', logo: '💻' },

  // Wohnen & Möbel
  'ikea': { category: 'shopping', logo: '🪑' },
  'xxxlutz': { category: 'shopping', logo: '🛋️' },
  'mömax': { category: 'shopping', logo: '🛋️' },
  'obi': { category: 'shopping', logo: '🔨' },

  // Reisen
  'tui': { category: 'reisen', logo: '✈️' },
  'expedia': { category: 'reisen', logo: '✈️' },
  'booking': { category: 'reisen', logo: '🏨' },
  'hofer reisen': { category: 'reisen', logo: '✈️' },
  'sixt': { category: 'reisen', logo: '🚗' },

  // Sport & Fitness
  'hervis': { category: 'fitness', logo: '🏃' },
  'intersport': { category: 'fitness', logo: '⚽' },
  'gigasport': { category: 'fitness', logo: '🏃' },

  // Bücher & Medien
  'thalia': { category: 'shopping', logo: '📚' },

  // Haustiere
  'fressnapf': { category: 'shopping', logo: '🐕' },
  'zooplus': { category: 'shopping', logo: '🐾' },

  // Amazon
  'amazon': { category: 'shopping', logo: '📦' },

  // Kaffee
  'tchibo': { category: 'kaffee', logo: '☕' },
  'nespresso': { category: 'kaffee', logo: '☕' },

  // Weitere bekannte Marken
  'asos': { category: 'mode', logo: '👗' },
  'mango': { category: 'mode', logo: '👗' },
  'zara': { category: 'mode', logo: '👗' },
  'new yorker': { category: 'mode', logo: '👕' },
  'jack & jones': { category: 'mode', logo: '👕' },
  'reebok': { category: 'mode', logo: '👟' },
  'under armour': { category: 'mode', logo: '👟' },
  'the north face': { category: 'mode', logo: '🧥' },
  'columbia': { category: 'mode', logo: '🧥' },
  'asics': { category: 'mode', logo: '👟' },
  'new balance': { category: 'mode', logo: '👟' },
  'vans': { category: 'mode', logo: '👟' },
  'converse': { category: 'mode', logo: '👟' },
  'timberland': { category: 'mode', logo: '👢' },
  'dr. martens': { category: 'mode', logo: '👢' },
  'dr martens': { category: 'mode', logo: '👢' },
  'lego': { category: 'shopping', logo: '🧱' },
  'dyson': { category: 'technik', logo: '🔌' },
  'philips': { category: 'technik', logo: '🔌' },
  'bosch': { category: 'technik', logo: '🔧' },
  'acer': { category: 'technik', logo: '💻' },
  'asus': { category: 'technik', logo: '💻' },
  'dell': { category: 'technik', logo: '💻' },
  'hp': { category: 'technik', logo: '💻' },
  'sony': { category: 'technik', logo: '🎮' },
  'xbox': { category: 'technik', logo: '🎮' },
  'playstation': { category: 'technik', logo: '🎮' },
  'nintendo': { category: 'technik', logo: '🎮' },
  'swarovski': { category: 'shopping', logo: '💎' },
  'pandora': { category: 'shopping', logo: '💍' },
  'yves rocher': { category: 'beauty', logo: '🌿' },
  'parfumdreams': { category: 'beauty', logo: '🧴' },
  'flaconi': { category: 'beauty', logo: '🧴' },
  'lookfantastic': { category: 'beauty', logo: '💄' },
  'otto': { category: 'shopping', logo: '📦' },
  'universal': { category: 'shopping', logo: '📦' },
  'quelle': { category: 'shopping', logo: '📦' },
  'bonprix': { category: 'mode', logo: '👗' },
  'about you': { category: 'mode', logo: '👗' },
  'shein': { category: 'mode', logo: '👗' },
  'temu': { category: 'shopping', logo: '📦' },
  'hellofresh': { category: 'essen', logo: '🥗' },
  'bergfreunde': { category: 'fitness', logo: '🏔️' },
  'decathlon': { category: 'fitness', logo: '🏃' },
  'costa': { category: 'reisen', logo: '🚢' },
  'ryanair': { category: 'reisen', logo: '✈️' },
  'wizz air': { category: 'reisen', logo: '✈️' },
  'flixbus': { category: 'reisen', logo: '🚌' },
  'öbb': { category: 'reisen', logo: '🚂' },
  'lampenwelt': { category: 'shopping', logo: '💡' },
  'home24': { category: 'shopping', logo: '🛋️' },
  'westwing': { category: 'shopping', logo: '🛋️' },
  'ravensburger': { category: 'shopping', logo: '🧩' },
};

// ============================================
// FETCH HTML
// ============================================

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'de-AT,de;q=0.9,en;q=0.8',
      },
      timeout: 15000,
    }, res => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchPage(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ============================================
// PARSE DEALS FROM HTML
// ============================================

const HTML_ENTITIES = {
  amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"',
  auml: 'ä', Auml: 'Ä', ouml: 'ö', Ouml: 'Ö', uuml: 'ü', Uuml: 'Ü', szlig: 'ß',
  euro: '€', ndash: '–', mdash: '—', hellip: '…', trade: '™', reg: '®', copy: '©',
};

function decodeCodePoint(value) {
  try {
    return Number.isInteger(value) && value >= 0 && value <= 0x10ffff
      ? String.fromCodePoint(value)
      : '';
  } catch {
    return '';
  }
}

function decodeHtml(value = '') {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => decodeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal) => decodeCodePoint(parseInt(decimal, 10)))
    .replace(/&([a-z]+);/gi, (match, name) => HTML_ENTITIES[name] ?? match);
}

function htmlToText(fragment = '') {
  return decodeHtml(String(fragment)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function getAttribute(tag, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\b${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = String(tag).match(pattern);
  return decodeHtml(match?.[1] ?? match?.[2] ?? match?.[3] ?? '');
}

function extractBalancedDiv(html, startIndex) {
  const divTag = /<\/?div\b[^>]*>/gi;
  divTag.lastIndex = startIndex;
  let depth = 0;
  let match;

  while ((match = divTag.exec(html)) !== null) {
    if (/^<div\b/i.test(match[0])) {
      if (!/\/\s*>$/.test(match[0])) depth += 1;
    } else {
      depth -= 1;
    }
    if (depth === 0) return html.slice(startIndex, divTag.lastIndex);
  }
  return '';
}

function extractVoucherCards(html) {
  const cards = [];
  const openingDiv = /<div\b[^>]*\bdata-voucher-id\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)[^>]*>/gi;
  let match;

  while ((match = openingDiv.exec(html)) !== null) {
    const className = getAttribute(match[0], 'class');
    if (!/(?:^|\s)flex-col(?:\s|$)/i.test(className) || /(?:^|\s)search-result-item(?:\s|$)/i.test(className)) continue;

    const voucherId = getAttribute(match[0], 'data-voucher-id').replace(/^voucher-id:/i, '').trim();
    if (!/^[a-z0-9_-]+$/i.test(voucherId)) continue;

    const cardHtml = extractBalancedDiv(html, match.index);
    if (!cardHtml) continue;
    cards.push({ voucherId, html: cardHtml });
    openingDiv.lastIndex = match.index + cardHtml.length;
  }
  return cards;
}

function cleanBrand(value) {
  let brand = htmlToText(value);
  for (let i = 0; i < 3; i++) {
    brand = brand
      .replace(/\s+(?:Gutscheine?|Gutscheincodes?|Logo)$/i, '')
      .replace(/\s+Österreich$/i, '')
      .trim();
  }
  return brand;
}

function extractBrand(cardHtml) {
  const images = cardHtml.match(/<img\b[^>]*>/gi) || [];
  for (const attribute of ['title', 'alt']) {
    for (const image of images) {
      const brand = cleanBrand(getAttribute(image, attribute));
      if (brand.length >= 2 && brand.length <= 80) return brand;
    }
  }
  return '';
}

function slugifyBrand(brand) {
  return brand.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function safeGutscheineUrl(rawHref) {
  if (!rawHref) return '';
  try {
    const url = new URL(decodeHtml(rawHref), 'https://www.gutscheine.at/');
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    if (!['http:', 'https:'].includes(url.protocol) || hostname !== 'gutscheine.at') return '';
    return url.toString();
  } catch {
    return '';
  }
}

function buildVoucherHrefMap(html) {
  const hrefsByVoucherId = new Map();
  const quotedUrl = /(?:href\s*=\s*)?["']([^"']*\?[^"']*\bcode=([a-z0-9_-]+)[^"']*)["']/gi;
  let match;
  while ((match = quotedUrl.exec(html)) !== null) {
    const safeUrl = safeGutscheineUrl(match[1]);
    if (!safeUrl) continue;
    const code = new URL(safeUrl).searchParams.get('code');
    if (code === match[2] && !hrefsByVoucherId.has(code)) hrefsByVoucherId.set(code, safeUrl);
  }
  return hrefsByVoucherId;
}

function resolveVoucherUrl(cardHtml, voucherId, brand, hrefsByVoucherId) {
  const anchors = cardHtml.match(/<a\b[^>]*\bhref\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)[^>]*>/gi) || [];
  for (const anchor of anchors) {
    const safeUrl = safeGutscheineUrl(getAttribute(anchor, 'href'));
    if (!safeUrl) continue;
    const code = new URL(safeUrl).searchParams.get('code');
    if (!code || code === voucherId) return safeUrl;
  }
  if (hrefsByVoucherId.has(voucherId)) return hrefsByVoucherId.get(voucherId);

  const slug = slugifyBrand(brand);
  return slug ? `https://www.gutscheine.at/${slug}` : 'https://www.gutscheine.at/';
}

function getCategory(brand) {
  const brandLower = brand.toLocaleLowerCase('de-AT');
  for (const [key, value] of Object.entries(RELEVANT_CATEGORIES)) {
    if (brandLower === key || brandLower.includes(key)) return value;
  }
  return { category: 'shopping', logo: '🏷️' };
}

function getOfferValue(title) {
  const percent = title.match(/(\d{1,3}(?:[,.]\d+)?)\s*%/);
  if (percent) return { amount: Number(percent[1].replace(',', '.')), unit: '%' };
  const euro = title.match(/(?:€\s*(\d{1,4}(?:[,.]\d+)?)|(\d{1,4}(?:[,.]\d+)?)\s*€)/);
  if (euro) return { amount: Number((euro[1] || euro[2]).replace(',', '.')), unit: '€' };
  return { amount: 0, unit: '' };
}

function hasConcreteVoucherSignal(title) {
  return /(?:€\s*\d{1,4}(?:[,.]\d+)?|\d{1,4}(?:[,.]\d+)?\s*(?:€|%))/.test(title)
    || /\b(?:1\s*[+&]\s*1|\d+\s+für\s+\d+|gratis|kostenlos|versandkostenfrei)\b/i.test(title);
}

function getQualityScore(title, brand, offer) {
  let score = 30;
  if (offer.unit === '%') {
    score += Math.min(offer.amount / 2, 30);
    if (offer.amount >= 50) score += 15;
  } else if (offer.unit === '€') {
    score += Math.min(offer.amount, 30);
    if (offer.amount >= 20) score += 15;
  } else if (/\b(?:gratis|kostenlos|versandkostenfrei|\d+\s+für\s+\d+)\b/i.test(title)) {
    score += 10;
  }
  if (RELEVANT_CATEGORIES[brand.toLocaleLowerCase('de-AT')]) score += 10;
  return Math.round(score);
}

function parseDeals(html, options = {}) {
  const deals = [];
  const seenVoucherIds = options.seenVoucherIds || new Set();
  const hrefsByVoucherId = buildVoucherHrefMap(html);
  const pubDate = (options.now instanceof Date ? options.now : new Date()).toISOString();

  for (const card of extractVoucherCards(html)) {
    if (seenVoucherIds.has(card.voucherId)) continue;
    const brand = extractBrand(card.html);
    const titleMatch = card.html.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i);
    const title = htmlToText(titleMatch?.[1] || '');
    if (!brand || !title || !hasConcreteVoucherSignal(title)) continue;

    const expiryMatch = htmlToText(card.html).match(/Gültig\s+bis:\s*(\d{1,2}\.\d{1,2}\.\d{4})/i);
    const expires = expiryMatch ? `Bis ${expiryMatch[1]}` : 'Siehe Website';
    const { category, logo } = getCategory(brand);
    const offer = getOfferValue(title);
    const url = resolveVoucherUrl(card.html, card.voucherId, brand, hrefsByVoucherId);

    seenVoucherIds.add(card.voucherId);
    deals.push({
      id: `gs-${card.voucherId}`,
      voucherId: card.voucherId,
      brand,
      logo,
      title: title.substring(0, 120),
      description: `${logo} ${brand}: ${title}`.substring(0, 180),
      type: 'rabatt',
      badge: 'limited',
      category,
      source: 'Gutscheine.at',
      url,
      expires,
      distance: 'Online / Österreich',
      hot: offer.amount >= 20 || (offer.unit === '€' && offer.amount >= 10),
      isNew: true,
      qualityScore: getQualityScore(title, brand, offer),
      pubDate,
    });
  }
  return deals;
}

// ============================================
// MAIN
// ============================================


async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🏷️  GUTSCHEINE.AT SCRAPER');
  console.log(`📅 ${new Date().toLocaleString('de-AT')}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const allDeals = [];
  const seenVoucherIds = new Set();

  for (const page of PAGES_TO_SCRAPE) {
    try {
      console.log(`🔍 Scrape: ${page.name} (${page.url})`);
      const html = await fetchPage(page.url);
      console.log(`   📄 ${(html.length / 1024).toFixed(0)} KB geladen`);

      const deals = parseDeals(html, { seenVoucherIds });
      console.log(`   ✅ ${deals.length} Deals extrahiert`);

      for (const d of deals) {
        console.log(`      ${d.logo} ${d.title} (Score: ${d.qualityScore})`);
      }

      allDeals.push(...deals);
    } catch (error) {
      console.log(`   ❌ Fehler: ${error.message}`);
    }
  }

  // Sort by quality score
  const finalDeals = allDeals
    .slice()
    .sort((a, b) => (b.qualityScore || 0) - (a.qualityScore || 0));

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 ERGEBNIS:');
  console.log(`   🔍 Seiten gescraped:   ${PAGES_TO_SCRAPE.length}`);
  console.log(`   📦 Deals extrahiert:   ${allDeals.length}`);
  console.log(`   ✅ Eindeutige Voucher: ${finalDeals.length}`);
  if (finalDeals.length > 0) {
    console.log(`   🏆 Bester Deal:        ${finalDeals[0].title}`);
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Write to pending file for Slack approval
  const outputPath = 'docs/deals-pending-gutscheine.json';
  const output = {
    lastUpdated: new Date().toISOString(),
    source: 'gutscheine.at',
    totalDeals: finalDeals.length,
    deals: finalDeals,
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`💾 ${finalDeals.length} Deals → ${outputPath}`);
  console.log('📱 Warten auf Slack-Approval...\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => {
    console.error('❌ Fatal:', err.message);
    process.exitCode = 0; // Keep the scheduled workflow alive, as before.
  });
}

export {
  buildVoucherHrefMap,
  extractVoucherCards,
  main,
  parseDeals,
  safeGutscheineUrl,
};

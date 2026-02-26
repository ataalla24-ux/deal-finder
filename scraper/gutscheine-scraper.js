// ============================================
// FREEFINDER WIEN - GUTSCHEINE.AT SCRAPER
// Scraped aktuelle Gutscheine & Rabattcodes
// Braucht KEIN API-Key (direkt HTTP fetch)
// Output: docs/deals-pending-gutscheine.json
// ============================================

import https from 'https';
import fs from 'fs';

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

// Bekannte Marken → ALLES durchlassen (kein Mindest-Rabatt)
// Unbekannte Marken → kleiner Mindest-Filter
const MIN_DISCOUNT_PERCENT = 5;   // Nur für UNBEKANNTE Marken
const MIN_DISCOUNT_EURO = 3;      // Nur für UNBEKANNTE Marken

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

function parseDeals(html) {
  const deals = [];

  // Strategy: Extract deal blocks from the HTML
  // gutscheine.at renders deals as cards with structured data
  // We look for patterns like:
  //   Brand from: title="BRAND Gutscheine" or alt="BRAND Logo"
  //   Discount from: <strong> tags containing % or €
  //   Expiry from: "Gültig bis: DD.MM.YYYY"
  //   Link from: href="/shop-slug"

  // ---- Method 1: Parse structured deal cards ----
  
  // Find all deal-like blocks: look for discount patterns near brand mentions
  // Pattern: "XX% [Brand] Gutschein" or "XX€ [Brand] Gutschein"
  const dealPatterns = [
    // "10% Rabattcode für ..." or "20€ Gutschein für ..."
    /(?:(\d{1,3})%\s+(?:Rabatt(?:code)?|Gutschein))\s+(?:für\s+)?(.{3,60}?)(?:\n|$|Gutschein anzeigen|Zum Angebot)/gi,
    // "XX€ BRAND Gutschein"
    /(\d{1,3})€\s+(\w[\w\s&.'-]{1,30}?)\s*Gutschein/gi,
    // "XX% BRAND Gutschein für ..."
    /(\d{1,3})%\s+(\w[\w\s&.'-]{1,30}?)\s*Gutschein(?:\s+für\s+(.{3,50}))?/gi,
    // "Bis zu XX% Rabatt"
    /[Bb]is zu\s+(\d{1,3})%\s+(?:Rabatt|Nachlass)\s+(?:auf\s+)?(?:alles\s+)?(?:bei\s+)?(\w[\w\s&.'-]{1,30})/gi,
  ];

  // Extract brand names from image alt texts
  const brandFromImages = {};
  const imgRegex = /(?:alt|title)="(\w[\w\s&.'-]+?)\s*(?:Logo|Gutscheine?)"/gi;
  let imgMatch;
  while ((imgMatch = imgRegex.exec(html)) !== null) {
    const brand = imgMatch[1].trim();
    if (brand.length > 1 && brand.length < 40) {
      brandFromImages[brand.toLowerCase()] = brand;
    }
  }

  // Strip HTML for text analysis
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ');

  // Find expiry dates
  const expiryMap = new Map();
  const expiryRegex = /Gültig bis:\s*(\d{1,2}\.\d{1,2}\.\d{4})/gi;
  let expiryMatch;
  while ((expiryMatch = expiryRegex.exec(text)) !== null) {
    expiryMap.set(expiryMatch.index, expiryMatch[1]);
  }

  // ---- Method 2: More robust - scan for "XX% ... Gutschein/Rabatt" blocks ----
  
  const blockRegex = /(\d{1,3})\s*(%|€)\s+([\w\s&.'-]{2,35}?)\s*(?:Gutschein(?:code)?|Rabatt(?:code)?|Nachlass|Ersparnis)\s*(?:für\s+)?([^]*?)?(?=\d{1,3}\s*(?:%|€)\s+\w|\s*(?:Mehr anzeigen|Die besten Shops|$))/gi;
  
  // Simpler approach: find all "XX% BRAND" or "XX€ BRAND" patterns
  const simpleRegex = /(\d{1,3})\s*(%|€)\s+([\w\s&.'-]{2,35}?)\s*(?:Gutschein(?:code)?|Rabatt(?:code)?|Nachlass|Ersparnis)/gi;
  let match;
  const seenDeals = new Set();

  while ((match = simpleRegex.exec(text)) !== null) {
    const amount = parseInt(match[1]);
    const unit = match[2]; // % or €
    let brand = match[3].trim();

    // Clean brand name
    brand = brand.replace(/^\s*(für|bei|auf|von|im)\s+/i, '').trim();
    
    // Skip junk
    if (brand.length < 2 || brand.length > 35) continue;
    if (/^(Rabatt|alle|die|der|das|für|bei|auf)\s*$/i.test(brand)) continue;

    // Check minimum discount
    // Bekannte Marken: ALLES durchlassen!
    const brandLower = brand.toLowerCase().replace(/^\s*(für|bei|auf|von|im)\s+/i, '');
    const isKnownBrand = Object.keys(RELEVANT_CATEGORIES).some(key => 
      brandLower.includes(key) || key.includes(brandLower)
    );
    
    if (!isKnownBrand) {
      // Nur unbekannte Marken filtern
      if (unit === '%' && amount < MIN_DISCOUNT_PERCENT) continue;
      if (unit === '€' && amount < MIN_DISCOUNT_EURO) continue;
    }
    if (amount > 95 && unit === '%') continue; // Probably fake

    // Deduplicate
    const dedupeKey = `${brand.toLowerCase()}-${amount}${unit}`;
    if (seenDeals.has(dedupeKey)) continue;
    seenDeals.add(dedupeKey);

    // Find closest expiry date (within 500 chars after the match)
    let expires = 'Siehe Website';
    for (const [idx, date] of expiryMap) {
      if (idx > match.index && idx < match.index + 500) {
        expires = `Bis ${date}`;
        
        // Check if deal is already expired
        const [day, month, year] = date.split('.');
        const expiryDate = new Date(year, month - 1, day);
        if (expiryDate < new Date()) {
          expires = null; // Mark as expired, skip later
        }
        break;
      }
    }

    // Skip expired deals
    if (expires === null) continue;

    // Look for a description after the brand/discount
    const afterMatch = text.substring(match.index, match.index + 200);
    const descMatch = afterMatch.match(/(?:für|auf)\s+(.{5,60})(?=\s*(?:Gutschein anzeigen|Zum Angebot|Geprüft|Gültig|$))/i);
    const extraDesc = descMatch ? descMatch[1].trim() : '';

    // Determine category from brand (brandLower already set above)
    let category = 'shopping';
    let logo = '🏷️';
    
    for (const [key, val] of Object.entries(RELEVANT_CATEGORIES)) {
      if (brandLower.includes(key) || key.includes(brandLower)) {
        category = val.category;
        logo = val.logo;
        break;
      }
    }

    // Build the deal title
    let title = '';
    if (unit === '%') {
      title = `${amount}% Rabatt bei ${brand}`;
    } else {
      title = `${amount}€ Gutschein bei ${brand}`;
    }
    if (extraDesc && extraDesc.length > 5) {
      title += ` – ${extraDesc.substring(0, 40)}`;
    }
    title = title.substring(0, 70);

    // Build description
    let description = `${logo} ${brand}: `;
    if (unit === '%') {
      description += `${amount}% Rabatt`;
    } else {
      description += `${amount}€ Gutschein`;
    }
    if (extraDesc) {
      description += ` – ${extraDesc.substring(0, 60)}`;
    }
    description = description.substring(0, 120);

    // Build URL
    const shopSlug = brand.toLowerCase()
      .replace(/[^a-z0-9äöüß]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    const url = `https://www.gutscheine.at/${shopSlug}`;

    // Quality score: higher discount = higher score, % bonus for gratis/big discounts
    let qualityScore = 30; // base
    if (unit === '%') {
      qualityScore += Math.min(amount / 2, 30);
      if (amount >= 50) qualityScore += 15;
    } else {
      qualityScore += Math.min(amount, 30);
      if (amount >= 20) qualityScore += 15;
    }
    // Bonus for known popular AT brands
    if (RELEVANT_CATEGORIES[brandLower]) qualityScore += 10;

    deals.push({
      id: dealId('gs', shopName || shopSlug, deal.title || '', deal.url || ''),
      brand: brand,
      logo: logo,
      title: title,
      description: description,
      type: 'rabatt',
      badge: 'limited',
      category: category,
      source: 'Gutscheine.at',
      url: url,
      expires: expires,
      distance: 'Online / Österreich',
      hot: amount >= 20 || (unit === '€' && amount >= 10),
      isNew: true,
      qualityScore: Math.round(qualityScore),
      pubDate: new Date().toISOString(),
    });
  }

  // ---- Pass 2: "Gratis Versand", "Sale", "Aktion" Deals von bekannten Marken ----
  const gratisPatterns = [
    /(?:Gratis|Kostenlos(?:e[rn]?)?|Free)\s+(?:Versand|Lieferung|Zustellung|Rücksendung)(?:\s+(?:bei|ab|für)\s+)?([\w\s&.'-]{2,30})/gi,
    /([\w\s&.'-]{2,30}?)(?:\s*Gutscheine?)?\s*(?:Gratis|Kostenlos(?:e[rn]?)?)\s+(?:Versand|Lieferung)/gi,
    /[Bb]is zu\s+(\d{1,3})%\s+(?:Rabatt\s+)?(?:im\s+)?Sale\s+(?:bei\s+)?([\w\s&.'-]{2,30})/gi,
    /([\w\s&.'-]{2,30}?)\s+(?:Sale|Outlet):\s+[Bb]is zu\s+(\d{1,3})%/gi,
  ];

  for (const pattern of gratisPatterns) {
    let m;
    while ((m = pattern.exec(text)) !== null) {
      // Extract brand (might be in different capture groups)
      let saleBrand = (m[1] || m[2] || '').trim();
      saleBrand = saleBrand.replace(/^\s*(bei|für|von|im|auf)\s+/i, '').trim();
      if (saleBrand.length < 2 || saleBrand.length > 30) continue;

      const saleBrandLower = saleBrand.toLowerCase();
      const isKnown = Object.keys(RELEVANT_CATEGORIES).some(key =>
        saleBrandLower.includes(key) || key.includes(saleBrandLower)
      );
      if (!isKnown) continue; // Nur bekannte Marken für diese Deals

      const dedupeKey2 = `gratis-${saleBrandLower}`;
      if (seenDeals.has(dedupeKey2)) continue;
      seenDeals.add(dedupeKey2);

      const matched = m[0].trim().substring(0, 60);
      let cat2 = 'shopping', logo2 = '🏷️';
      for (const [key, val] of Object.entries(RELEVANT_CATEGORIES)) {
        if (saleBrandLower.includes(key) || key.includes(saleBrandLower)) {
          cat2 = val.category;
          logo2 = val.logo;
          break;
        }
      }

      const slug2 = saleBrand.toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

      deals.push({
        id: dealId('gs', slug2, deal.title || deal.code || '', deal.affiliateUrl || deal.url || ''),
        brand: saleBrand,
        logo: logo2,
        title: matched,
        description: `${logo2} ${saleBrand}: ${matched}`,
        type: 'rabatt',
        badge: 'limited',
        category: cat2,
        source: 'Gutscheine.at',
        url: `https://www.gutscheine.at/${slug2}`,
        expires: 'Siehe Website',
        distance: 'Online / Österreich',
        hot: false,
        isNew: true,
        qualityScore: 20,
        pubDate: new Date().toISOString(),
      });
    }
  }

  return deals;
}

// ============================================
// MAIN
// ============================================


// ============================================
// STABILE DEAL-ID (Hash statt Date.now/random)
// ============================================
function stableHash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash = hash >>> 0;
  }
  return hash.toString(36);
}
function dealId(prefix, brand, title, url) {
  const key = (brand || '') + '|' + (title || '') + '|' + (url || '');
  return prefix + '-' + stableHash(key);
}

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🏷️  GUTSCHEINE.AT SCRAPER');
  console.log(`📅 ${new Date().toLocaleString('de-AT')}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const allDeals = [];

  for (const page of PAGES_TO_SCRAPE) {
    try {
      console.log(`🔍 Scrape: ${page.name} (${page.url})`);
      const html = await fetchPage(page.url);
      console.log(`   📄 ${(html.length / 1024).toFixed(0)} KB geladen`);

      const deals = parseDeals(html);
      console.log(`   ✅ ${deals.length} Deals extrahiert`);

      for (const d of deals) {
        console.log(`      ${d.logo} ${d.title} (Score: ${d.qualityScore})`);
      }

      allDeals.push(...deals);
    } catch (error) {
      console.log(`   ❌ Fehler: ${error.message}`);
    }
  }

  // Deduplicate across pages
  const unique = [];
  const seen = new Set();
  for (const deal of allDeals) {
    const key = `${deal.brand.toLowerCase()}-${deal.title.substring(0, 20).toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(deal);
    }
  }

  // Sort by quality score
  unique.sort((a, b) => (b.qualityScore || 0) - (a.qualityScore || 0));

  // Limit to top 100 deals (more for Slack selection)
  const finalDeals = unique.slice(0, 100);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 ERGEBNIS:');
  console.log(`   🔍 Seiten gescraped:   ${PAGES_TO_SCRAPE.length}`);
  console.log(`   📦 Deals extrahiert:   ${allDeals.length}`);
  console.log(`   ✅ Nach Filter:        ${finalDeals.length}`);
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

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Fatal:', err.message);
    process.exit(0); // Exit 0 to not fail workflow
  });

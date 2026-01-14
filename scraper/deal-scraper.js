// deal-scraper.js
// Dieses Script scraped Deal-Websites und speichert die Ergebnisse als JSON

const https = require('https');
const http = require('http');
const fs = require('fs');

// ============================================
// CONFIGURATION
// ============================================

const SOURCES = [
  {
    name: 'Preisjäger',
    url: 'https://www.preisjaeger.at/rss/alle',
    type: 'rss',
    country: 'at'
  },
  {
    name: 'MyDealz',
    url: 'https://www.mydealz.de/rss/alle',
    type: 'rss',
    country: 'de'
  },
  {
    name: 'Preispirat',
    url: 'https://www.preispirat.at/feed/',
    type: 'rss',
    country: 'at'
  }
];

// Basis-Deals die immer verfügbar sind
const BASE_DEALS = [
  {
    id: "base-1",
    brand: "jö Bonus Club",
    title: "50% auf OMV VIVA Kaffee",
    description: "Mit 75 Ös erhältst du 50% Rabatt auf alle VIVA-Kaffeespezialitäten an OMV Tankstellen.",
    type: "rabatt",
    source: "jö App / OMV",
    url: "https://www.joe-club.at",
    expires: "Unbegrenzt",
    hot: true,
    category: "food",
    countries: ["at"],
    tags: ["kaffee", "omv", "jö", "tankstelle"]
  },
  {
    id: "base-2",
    brand: "jö Bonus Club",
    title: "Bis zu 20% Rabattsammler",
    description: "Einmal pro Monat bis zu 20% auf einen gesamten Einkauf bei BILLA, BILLA PLUS, BIPA oder ZGONC.",
    type: "rabatt",
    source: "jö App",
    url: "https://www.joe-club.at",
    expires: "Monatlich",
    hot: true,
    category: "retail",
    countries: ["at"],
    tags: ["billa", "bipa", "jö", "einkauf", "supermarkt"]
  },
  {
    id: "base-3",
    brand: "IKEA Family",
    title: "Gratis Kaffee oder Tee",
    description: "Als IKEA Family Mitglied bekommst du kostenlosen Kaffee, Tee oder heiße Schokolade im Restaurant!",
    type: "gratis",
    source: "IKEA Restaurant",
    url: "https://www.ikea.com/at/de/ikea-family/",
    expires: "Unbegrenzt",
    hot: true,
    category: "food",
    countries: ["at", "de", "ch"],
    tags: ["kaffee", "ikea", "gratis", "tee", "restaurant"]
  },
  {
    id: "base-4",
    brand: "McDonald's",
    title: "Gratis Kaffee oder Cola",
    description: "Nach jedem Einkauf Feedback geben und Gratis-Getränk erhalten. Bis zu 5x pro Monat möglich!",
    type: "gratis",
    source: "mcdonalds.de/deinfeedback",
    url: "https://www.mcdonalds.de/deinfeedback",
    expires: "Unbegrenzt",
    hot: true,
    category: "food",
    countries: ["at", "de", "ch"],
    tags: ["kaffee", "cola", "mcdonalds", "gratis", "feedback"]
  },
  {
    id: "base-5",
    brand: "Starbucks",
    title: "Gratis Geburtstagsgetränk",
    description: "Bei Starbucks Rewards anmelden und am Geburtstag ein kostenloses Getränk nach Wahl erhalten.",
    type: "gratis",
    source: "Starbucks App",
    url: "https://www.starbucks.at/de/rewards",
    expires: "Unbegrenzt",
    hot: true,
    category: "food",
    countries: ["at", "de", "ch"],
    tags: ["kaffee", "starbucks", "geburtstag", "gratis"]
  },
  {
    id: "base-6",
    brand: "Lidl Plus",
    title: "Wöchentliche Gratis-Coupons",
    description: "Jede Woche neue exklusive Gutscheine in der App. Rabattsammler für bis zu 20% auf den Einkauf!",
    type: "rabatt",
    source: "Lidl Plus App",
    url: "https://www.lidl.at/c/lidl-plus/s10012352",
    expires: "Wöchentlich neu",
    hot: true,
    category: "retail",
    countries: ["at", "de", "ch"],
    tags: ["lidl", "supermarkt", "gutschein", "einkauf"]
  },
  {
    id: "base-7",
    brand: "Douglas",
    title: "2 Gratis-Proben",
    description: "Bei jeder Bestellung ab 10€ kannst du 2 Gratis-Proben im Warenkorb auswählen.",
    type: "gratis",
    source: "douglas.at",
    url: "https://www.douglas.at",
    expires: "Unbegrenzt",
    hot: true,
    category: "beauty",
    countries: ["at", "de"],
    tags: ["douglas", "parfum", "beauty", "probe", "gratis"]
  },
  {
    id: "base-8",
    brand: "Spotify",
    title: "3 Monate Premium gratis",
    description: "Neukunden erhalten 3 Monate Spotify Premium kostenlos. Danach 10,99€/Monat, jederzeit kündbar.",
    type: "testabo",
    source: "spotify.com",
    url: "https://www.spotify.com/at/premium/",
    expires: "Für Neukunden",
    hot: true,
    category: "entertainment",
    countries: ["at", "de", "ch"],
    tags: ["spotify", "musik", "streaming", "gratis"]
  },
  {
    id: "base-9",
    brand: "Amazon Prime",
    title: "30 Tage gratis testen",
    description: "Prime-Mitgliedschaft 30 Tage kostenlos testen. Inkl. Prime Video, schneller Versand und mehr.",
    type: "testabo",
    source: "amazon.at",
    url: "https://www.amazon.de/prime",
    expires: "Für Neukunden",
    hot: true,
    category: "entertainment",
    countries: ["at", "de", "ch"],
    tags: ["amazon", "prime", "video", "streaming"]
  },
  {
    id: "base-10",
    brand: "ÖBB",
    title: "Gratis Fahrt am Geburtstag",
    description: "Mit ÖBB Vorteilscard am Geburtstag kostenlos 2. Klasse in ganz Österreich fahren.",
    type: "gratis",
    source: "oebb.at",
    url: "https://www.oebb.at",
    expires: "Am Geburtstag",
    hot: true,
    category: "travel",
    countries: ["at"],
    tags: ["geburtstag", "öbb", "bahn", "zug", "gratis"]
  },
  {
    id: "base-11",
    brand: "Wien Museum",
    title: "Gratis Eintritt unter 19",
    description: "Für alle unter 19 Jahren ist der Eintritt ins Wien Museum am Karlsplatz gratis!",
    type: "gratis",
    source: "wienmuseum.at",
    url: "https://www.wienmuseum.at",
    expires: "Unbegrenzt",
    hot: true,
    category: "events",
    countries: ["at"],
    cities: ["wien"],
    tags: ["wien", "museum", "gratis", "kultur", "jugend"]
  },
  {
    id: "base-12",
    brand: "Belvedere",
    title: "Gratis Eintritt unter 19",
    description: "Das Belvedere mit Klimts 'Der Kuss' ist für unter 19-Jährige gratis!",
    type: "gratis",
    source: "belvedere.at",
    url: "https://www.belvedere.at",
    expires: "Unbegrenzt",
    hot: true,
    category: "events",
    countries: ["at"],
    cities: ["wien"],
    tags: ["wien", "museum", "gratis", "klimt", "kunst"]
  },
  {
    id: "base-13",
    brand: "Stadt Wien",
    title: "Gratis Wickelrucksack",
    description: "Für Wiener Familien: Gratis Wickelrucksack mit Inhalt bei MA11 oder Geburtsklinik abholen.",
    type: "gratis",
    source: "wien.gv.at",
    url: "https://www.wien.gv.at",
    expires: "Unbegrenzt",
    hot: true,
    category: "baby",
    countries: ["at"],
    cities: ["wien"],
    tags: ["baby", "wien", "gratis", "familie"]
  },
  {
    id: "base-14",
    brand: "Donauturm Wien",
    title: "Gratis am Geburtstag",
    description: "Am Geburtstag (oder 4 Tage davor/danach) gratis auf den Donauturm inkl. Rutsche!",
    type: "gratis",
    source: "donauturm.at",
    url: "https://www.donauturm.at",
    expires: "Am Geburtstag ±4 Tage",
    hot: false,
    category: "events",
    countries: ["at"],
    cities: ["wien"],
    tags: ["geburtstag", "wien", "gratis", "aussicht"]
  },
  {
    id: "base-15",
    brand: "Zalando",
    title: "Gratis Versand & 100 Tage Retoure",
    description: "Gratis Versand ab 24,90€ und 100 Tage kostenlose Rückgabe bei Zalando.",
    type: "gratis",
    source: "zalando.at",
    url: "https://www.zalando.at",
    expires: "Unbegrenzt",
    hot: false,
    category: "fashion",
    countries: ["at", "de", "ch"],
    tags: ["zalando", "mode", "versand", "gratis"]
  }
];

// ============================================
// HELPER FUNCTIONS
// ============================================

function fetch(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    
    const request = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DealFinder/1.0)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*'
      },
      timeout: 15000
    }, (response) => {
      // Handle redirects
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        fetch(response.headers.location).then(resolve).catch(reject);
        return;
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => resolve(data));
    });
    
    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy();
      reject(new Error('Timeout'));
    });
  });
}

function parseRSS(xml, sourceName, country) {
  const deals = [];
  
  // Simple XML parsing with regex (works for RSS feeds)
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  
  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    
    const title = extractTag(itemXml, 'title');
    const description = extractTag(itemXml, 'description');
    const link = extractTag(itemXml, 'link');
    const pubDate = extractTag(itemXml, 'pubDate');
    
    if (!title) continue;
    
    // Determine deal type
    let type = 'rabatt';
    const lowerTitle = title.toLowerCase();
    if (lowerTitle.includes('gratis') || lowerTitle.includes('kostenlos') || lowerTitle.includes('free') || lowerTitle.includes('geschenkt')) {
      type = 'gratis';
    } else if (lowerTitle.includes('cashback') || lowerTitle.includes('geld zurück')) {
      type = 'cashback';
    } else if (lowerTitle.includes('testabo') || lowerTitle.includes('probeabo') || lowerTitle.includes('testen')) {
      type = 'testabo';
    }
    
    // Determine category
    let category = 'retail';
    if (/essen|food|kaffee|burger|pizza|restaurant|lieferando|mjam/i.test(lowerTitle)) {
      category = 'food';
    } else if (/netflix|spotify|disney|stream|gaming|playstation|xbox/i.test(lowerTitle)) {
      category = 'entertainment';
    } else if (/beauty|parfum|douglas|sephora|kosmetik/i.test(lowerTitle)) {
      category = 'beauty';
    } else if (/nike|adidas|zalando|mode|fashion|schuhe|kleidung/i.test(lowerTitle)) {
      category = 'fashion';
    } else if (/reise|flug|hotel|urlaub|bahn|zug/i.test(lowerTitle)) {
      category = 'travel';
    } else if (/tech|handy|laptop|tablet|smartphone/i.test(lowerTitle)) {
      category = 'tech';
    }
    
    // Check if hot deal
    const hot = lowerTitle.includes('hot') || lowerTitle.includes('🔥') || lowerTitle.includes('top');
    
    // Extract brand from title
    let brand = sourceName;
    const brandMatch = title.match(/^([A-Za-zäöüÄÖÜß0-9&\-\.]+)[\s:]/);
    if (brandMatch) {
      brand = brandMatch[1];
    }
    
    // Clean description
    let cleanDesc = description
      .replace(/<[^>]*>/g, '') // Remove HTML
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .trim();
    
    if (cleanDesc.length > 150) {
      cleanDesc = cleanDesc.substring(0, 147) + '...';
    }
    
    deals.push({
      id: `${sourceName.toLowerCase()}-${Date.now()}-${deals.length}`,
      brand: brand.substring(0, 30),
      title: title.substring(0, 80),
      description: cleanDesc || title,
      type,
      source: sourceName,
      url: link || '',
      expires: 'Begrenzt',
      hot,
      category,
      countries: country === 'at' ? ['at'] : country === 'de' ? ['de', 'at'] : [country],
      tags: extractTags(title + ' ' + cleanDesc),
      pubDate: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
      isNew: true
    });
  }
  
  return deals;
}

function extractTag(xml, tagName) {
  // Try CDATA first
  const cdataRegex = new RegExp(`<${tagName}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tagName}>`, 'i');
  const cdataMatch = xml.match(cdataRegex);
  if (cdataMatch) return cdataMatch[1].trim();
  
  // Regular tag
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

function extractTags(text) {
  const keywords = text.toLowerCase()
    .replace(/[^a-zäöüß0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && w.length < 20);
  
  return [...new Set(keywords)].slice(0, 10);
}

// ============================================
// MAIN SCRAPER
// ============================================

async function scrapeAllSources() {
  console.log('🚀 Starting deal scraper...\n');
  
  const allDeals = [...BASE_DEALS];
  const errors = [];
  
  for (const source of SOURCES) {
    console.log(`📡 Fetching ${source.name}...`);
    
    try {
      const xml = await fetch(source.url);
      const deals = parseRSS(xml, source.name, source.country);
      
      console.log(`   ✅ Found ${deals.length} deals\n`);
      allDeals.push(...deals);
    } catch (error) {
      console.log(`   ❌ Error: ${error.message}\n`);
      errors.push({ source: source.name, error: error.message });
    }
  }
  
  // Remove duplicates based on title similarity
  const uniqueDeals = [];
  const seenTitles = new Set();
  
  for (const deal of allDeals) {
    const normalizedTitle = deal.title.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 30);
    if (!seenTitles.has(normalizedTitle)) {
      seenTitles.add(normalizedTitle);
      uniqueDeals.push(deal);
    }
  }
  
  // Sort: hot deals first, then by date
  uniqueDeals.sort((a, b) => {
    if (a.hot && !b.hot) return -1;
    if (!a.hot && b.hot) return 1;
    if (a.pubDate && b.pubDate) {
      return new Date(b.pubDate) - new Date(a.pubDate);
    }
    return 0;
  });
  
  // Create output
  const output = {
    lastUpdated: new Date().toISOString(),
    totalDeals: uniqueDeals.length,
    sources: SOURCES.map(s => s.name),
    errors,
    deals: uniqueDeals
  };
  
  // Save to file
  fs.writeFileSync('deals.json', JSON.stringify(output, null, 2));
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ Scraping complete!`);
  console.log(`   📦 Total deals: ${uniqueDeals.length}`);
  console.log(`   💾 Saved to: deals.json`);
  console.log(`   ⏰ Time: ${new Date().toLocaleString('de-AT')}`);
  if (errors.length > 0) {
    console.log(`   ⚠️  Errors: ${errors.length}`);
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  return output;
}

// Run
scrapeAllSources().catch(console.error);

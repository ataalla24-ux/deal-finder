// ============================================
// BASIC SCRAPER - Special Deals & Events
// Scraped einmalige Aktionen, Events, Neueröffnungen
// ============================================

import https from 'https';
import http from 'http';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================
// QUELLEN FÜR SPECIAL DEALS
// ============================================
const SOURCES = [
  // KULTUR & MUSEEN
  { name: 'Wien Museum', url: 'https://www.wienmuseum.at/', type: 'html', brand: 'Wien Museum', logo: '🏛️', category: 'kultur' },
  { name: 'Kunsthistorisches Museum', url: 'https://www.khm.at/', type: 'html', brand: 'KHM', logo: '🏛️', category: 'kultur' },
  { name: 'Belvedere', url: 'https://www.belvedere.at/', type: 'html', brand: 'Belvedere', logo: '🏛️', category: 'kultur' },
  { name: 'Albertina', url: 'https://www.albertina.at/', type: 'html', brand: 'Albertina', logo: '🏛️', category: 'kultur' },
  { name: 'Technisches Museum', url: 'https://www.tmw.at/', type: 'html', brand: 'TMW', logo: '🔬', category: 'kultur' },
  { name: 'Naturhistorisches Museum', url: 'https://www.nhm-wien.ac.at/', type: 'html', brand: 'NHM', logo: '🦕', category: 'kultur' },
  { name: 'MuseumsQuartier', url: 'https://www.mqw.at/', type: 'html', brand: 'MQ', logo: '🏛️', category: 'kultur' },
  { name: 'Wien Info Events', url: 'https://www.wien.info/de/kunst-kultur', type: 'html', brand: 'Wien Info', logo: '🎭', category: 'kultur' },
  
  // EVENTS & FESTIVALS
  { name: 'Wiener Festwochen', url: 'https://www.festwochen.at/', type: 'html', brand: 'Festwochen', logo: '🎭', category: 'events' },
  { name: 'Impulstanz', url: 'https://www.impulstanz.com/', type: 'html', brand: 'Impulstanz', logo: '💃', category: 'events' },
  { name: 'Film Festival', url: 'https://www.filmfestival-rathausplatz.at/', type: 'html', brand: 'Rathausplatz', logo: '🎬', category: 'events' },
  { name: 'Wien Eventkalender', url: 'https://www.wien.gv.at/kultur-freizeit/veranstaltungen/', type: 'html', brand: 'Wien', logo: '📅', category: 'events' },
  { name: 'Oeticket Blog', url: 'https://www.oeticket.com/magazine/', type: 'html', brand: 'Oeticket', logo: '🎟️', category: 'events' },
  
  // FOOD & GASTRO
  { name: '1000things Wien', url: 'https://www.1000things.at/blog/', type: 'html', brand: '1000things', logo: '🍔', category: 'essen' },
  { name: 'Vienna Wurstelstand', url: 'https://www.viennawurstelstand.com/', type: 'html', brand: 'Wurstelstand', logo: '🌭', category: 'essen' },
  { name: 'Falstaff Wien', url: 'https://www.falstaff.com/at/news', type: 'html', brand: 'Falstaff', logo: '🍽️', category: 'essen' },
  { name: 'TheFork Magazin', url: 'https://www.thefork.at/blog', type: 'html', brand: 'TheFork', logo: '🍽️', category: 'essen' },
  { name: 'Lieferservice.at Blog', url: 'https://www.lieferando.at/blog', type: 'html', brand: 'Lieferando', logo: '🍕', category: 'essen' },
  { name: 'Wolt Blog', url: 'https://wolt.com/de/blog', type: 'html', brand: 'Wolt', logo: '🍔', category: 'essen' },

  // GRATIS & GUTSCHEINE
  { name: 'Willhaben', url: 'https://www.willhaben.at/iad/gratis/', type: 'html', brand: 'Willhaben', logo: '📦', category: 'gratis' },
  { name: 'Gratisproben', url: 'https://www.gratisproben.net/oesterreich/', type: 'html', brand: 'Gratisproben', logo: '🆓', category: 'gratis' },
  { name: 'Gutscheine.at', url: 'https://www.gutscheine.at/neue-gutscheine', type: 'html', brand: 'Gutscheine.at', logo: '🏷️', category: 'shopping' },
  { name: 'Preisjaeger', url: 'https://www.preisjaeger.at/', type: 'html', brand: 'Preisjaeger', logo: '🏷️', category: 'shopping' },
  { name: 'Spar Aktionen', url: 'https://www.spar.at/aktionen', type: 'html', brand: 'SPAR', logo: '🛒', category: 'supermarkt' },
  { name: 'Hofer Angebote', url: 'https://www.hofer.at/de/angebote.html', type: 'html', brand: 'HOFER', logo: '🛒', category: 'supermarkt' },
  { name: 'Lidl Aktionen', url: 'https://www.lidl.at/c/angebote/s10008806', type: 'html', brand: 'Lidl', logo: '🛒', category: 'supermarkt' },

  // CHRISTLICHE EVENTS & HILFE
  { name: 'Erzdioezese Wien', url: 'https://www.erzdioezese-wien.at/site/home/veranstaltungen', type: 'html', brand: 'Kirche Wien', logo: '⛪', category: 'events' },
  { name: 'Loretto Wien', url: 'https://www.loretto.at/', type: 'html', brand: 'Loretto', logo: '🙏', category: 'events' },
  { name: 'Caritas Wien', url: 'https://www.caritas-wien.at/', type: 'html', brand: 'Caritas', logo: '🤝', category: 'events' },
  { name: 'VinziRast', url: 'https://www.vinzirast.at/', type: 'html', brand: 'VinziRast', logo: '🍲', category: 'events' },
];

const DEAL_REGEX = /gratis|free|kostenlos|rabatt|aktion|angebot|sale|deal|gutschein|eintritt|ermäßigung|sparen|[1-9]\d?%|[1-9]\s?€/i;

function stableHash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i += 1) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash >>>= 0;
  }
  return hash.toString(36);
}

function dealId(source, content) {
  return `basic-${stableHash(`${source}|${content}`)}`;
}

// ============================================
// HELPER: Fetch
// ============================================
function fetchHTML(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const req = protocol.get(url, {
      timeout: 10000,
      rejectUnauthorized: false,
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; FreeFinderBot/1.0; +https://freefinder.wien)',
      },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const nextUrl = new URL(res.headers.location, url).toString();
        resolve(fetchHTML(nextUrl));
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ============================================
// EXTRACTOR
// ============================================
function extractDeals(html, source) {
  const deals = [];
  const text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                   .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  
  // Find headings and links
  const patterns = [
    /<h[1-3][^>]*>([^<]+)<\/h[1-3]>/gi,
    /<a[^>]*>([^<]{10,100})<\/a>/gi,
    /<p[^>]*>([^<]{20,200})<\/p>/gi,
  ];
  
  const found = new Set();
  
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const content = match[1].trim().replace(/\s+/g, ' ');
      
      // Filter for deal-like content
      if (DEAL_REGEX.test(content) &&
          content.length > 15 && !found.has(content)) {
        found.add(content);
        
        const isGratis = content.match(/gratis|free|kostenlos|0€/i);
        
        deals.push({
          id: dealId(source.name, content),
          brand: source.brand,
          logo: source.logo,
          title: content.substring(0, 80),
          description: `${source.name}: ${content}`,
          type: isGratis ? 'gratis' : 'rabatt',
          category: source.category,
          source: source.name,
          url: source.url,
          expires: 'Siehe Webseite',
          distance: 'Wien',
          hot: content.match(/gratis|free/i) ? true : false,
          isNew: true,
          priority: 2,
          votes: 1,
          qualityScore: 40,
          pubDate: new Date().toISOString()
        });
      }
    }
  }
  
  return deals.slice(0, 7);
}

// ============================================
// MAIN
// ============================================
async function main() {
  console.log('📌 BASIC SCRAPER - Special Deals');
  console.log('='.repeat(40));
  
  const allDeals = [];
  
  for (const source of SOURCES) {
    try {
      console.log(`🌐 ${source.name}...`);
      const html = await fetchHTML(source.url);
      const deals = extractDeals(html, source);
      allDeals.push(...deals);
      console.log(`   → ${deals.length} Deals`);
    } catch (e) {
      console.log(`   ❌ ${e.message}`);
    }
  }
  
  // Deduplicate
  const unique = [];
  const seen = new Set();
  for (const deal of allDeals) {
    const key = (deal.title || '').toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 25);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(deal);
    }
  }
  
  // Output
  const output = {
    lastUpdated: new Date().toISOString(),
    source: 'basic-scraper',
    totalDeals: unique.length,
    deals: unique
  };
  
  const outPath = path.join(__dirname, '..', 'docs', 'deals-pending-basic1.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  
  console.log('\n' + '='.repeat(40));
  console.log(`✅ ${unique.length} Basic Deals gespeichert`);
}

main().catch(console.error);

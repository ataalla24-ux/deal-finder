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
  // WIEN & KULTUR
  { name: 'Wien Museum', url: 'https://www.wienmuseum.at/', type: 'html', brand: 'Wien Museum', logo: '🏛️', category: 'kultur' },
  { name: 'Kunsthistorisches Museum', url: 'https://www.khm.at/', type: 'html', brand: 'KHM', logo: '🏛️', category: 'kultur' },
  { name: 'Belvedere', url: 'https://www.belvedere.at/', type: 'html', brand: 'Belvedere', logo: '🏛️', category: 'kultur' },
  { name: 'Albertina', url: 'https://www.albertina.at/', type: 'html', brand: 'Albertina', logo: '🏛️', category: 'kultur' },
  { name: 'Technisches Museum', url: 'https://www.tmw.at/', type: 'html', brand: 'TMW', logo: '🔬', category: 'kultur' },
  { name: ' Naturhistorisches Museum', url: 'https://www.nhm-wien.at/', type: 'html', brand: 'NHM', logo: '🦕', category: 'kultur' },
  
  // EVENT & FESTIVALS
  { name: 'Wiener Festwochen', url: 'https://www.festwochen.at/', type: 'html', brand: 'Festwochen', logo: '🎭', category: 'events' },
  { name: 'Impulstanz', url: 'https://www.impulstanz.com/', type: 'html', brand: 'Impulstanz', logo: '💃', category: 'events' },
  { name: 'Film Festival', url: 'https://www.filmfestival-rathausplatz.at/', type: 'html', brand: 'Rathausplatz', logo: '🎬', category: 'events' },
  
  // SPECIALS
  { name: 'Willhaben', url: 'https://www.willhaben.at/iad/gratis/', type: 'html', brand: 'Willhaben', logo: '📦', category: 'gratis' },
  { name: 'Gratisproben', url: 'https://www.gratisproben.net/oesterreich/', type: 'html', brand: 'Gratisproben', logo: '🆓', category: 'gratis' },
];

// ============================================
// HELPER: Fetch
// ============================================
function fetchHTML(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const req = protocol.get(url, { timeout: 10000, rejectUnauthorized: false }, (res) => {
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
      if (content.match(/gratis|free|rabatt|aktion|angebot|sale|deal|€|eintritt|ermäßigung|50%|30%|20%/i) && 
          content.length > 15 && !found.has(content)) {
        found.add(content);
        
        const isGratis = content.match(/gratis|free|kostenlos|0€/i);
        
        deals.push({
          id: `basic-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
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
  
  return deals.slice(0, 5);
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

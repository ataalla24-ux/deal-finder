// ============================================
// 🍕🔥 FIRECRAWL GASTRO AGENT #2
// Fokus: Gastronomie - Mahlzeiten unter €3, 50%+ Rabatt, Döner €1,99
// ============================================

import Firecrawl from '@mendable/firecrawl-js';
import { z } from 'zod';
import fs from 'fs';

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY1 || process.env.FIRECRAWL_API_KEY;

if (!FIRECRAWL_API_KEY) {
  console.error('❌ FIRECRAWL_API_KEY1 oder FIRECRAWL_API_KEY nicht gesetzt!');
  process.exit(1);
}

const firecrawl = new Firecrawl({ apiKey: FIRECRAWL_API_KEY });

// ============================================
// SEITEN
// ============================================

const SCRAPE_URLS = [
  'https://www.instagram.com/explore/tags/gratiswien/',
  'https://www.instagram.com/explore/tags/wienfood/',
  'https://www.instagram.com/explore/tags/wienesse/',
  'https://www.instagram.com/explore/tags/aktionwien/',
  'https://www.instagram.com/explore/tags/schnäppchenwien/',
  'https://www.1000things.at/',
  'https://www.meinbezirk.at/',
];

// ============================================
// SCHEMA
// ============================================

const gastroSchema = z.object({
  deals: z.array(z.object({
    category: z.string(),
    category_citation: z.string().optional(),
        brand_or_store: z.string(),
        brand_or_store_citation: z.string().optional(),
    item_given_away: z.string(),
    item_given_away_citation: z.string().optional(),
    location: z.string(),
    location_citation: z.string().optional(),
    validity_date: z.string(),
    validity_date_citation: z.string().optional(),
    validity_time: z.string(),
    validity_time_citation: z.string().optional(),
    post_url: z.string(),
    post_url_citation: z.string().optional(),
  })),
});

// ============================================
// PROMPT
// ============================================

const PROMPT = `Extrahiere aktuelle und zukünftige Deals in Wien mit höchster Priorität auf Gastronomie-Angebote (Essen & Trinken).

Suche gezielt nach:
- Starken Rabatten wie Mahlzeiten unter €3
- Mindestens 50% Preisnachlass (z.B. 1,99€ Döner, 1+1 Aktionen)
- Kostenlose Freebies
- Neueröffnungen mit Gratis-Aktionen
- Starke Rabatte allgemein

Suche primär auf Instagram nach den ersten 50-100 Deals und ergänze diese durch Funde aus dem restlichen Web (z.B. 1000things, meinbezirk.at).

Erfasse für jeden Deal:
  – Den genauen Namen des Restaurants/Geschäfts/Unternehmens (brand_or_store – NICHT die Website-Domain!)
- Kategorie
- Was genau verschenkt/rabattiert wird
- Den Standort
- Datum und Uhrzeit der Gültigkeit
- Die direkte URL zum ursprünglichen Post oder Web-Beitrag`;

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

function parseGermanDate(str) {
  if (!str || typeof str !== 'string') return null;
  const s = str.trim();
  let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0));
  m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (m) {
    const year = m[3].length === 2 ? Number(`20${m[3]}`) : Number(m[3]);
    return new Date(Date.UTC(year, Number(m[2]) - 1, Number(m[1]), 12, 0, 0));
  }
  return null;
}

function isNotTooOld(dateObj) {
  if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return true;
  const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
  return dateObj.getTime() >= twoWeeksAgo;
}

async function main() {
  console.log('🍕🔥 FIRECRAWL GASTRO AGENT #2');
  console.log('='.repeat(40));
  console.log(`📅 ${new Date().toLocaleString('de-AT')}`);
  console.log();

  const allDeals = [];
  const seenUrls = new Set();
  
  console.log(`🔍 Scrape ${SCRAPE_URLS.length} Seiten (Gastro Focus)...`);
  
  for (let i = 0; i < SCRAPE_URLS.length; i++) {
    const url = SCRAPE_URLS[i];
    const source = new URL(url).hostname.replace('www.', '');
    
    console.log(`   [${i + 1}/${SCRAPE_URLS.length}] ${source}...`);
    
    try {
      const result = await firecrawl.agent({
          url: url,
        prompt: PROMPT,
        schema: gastroSchema,
        model: 'spark-1-pro',
      });
      
      if (result && result.data) {
        let data = result.data;
        
        if (typeof data === 'string') {
          try {
            data = JSON.parse(data);
          } catch (e) {}
        }
        
        if (data && data.deals && Array.isArray(data.deals)) {
          console.log(`      → ${data.deals.length} Deals gefunden`);
          
          for (const d of data.deals) {
            const postUrl = d.post_url || '';
            
            if (postUrl && seenUrls.has(postUrl)) continue;
            if (postUrl) seenUrls.add(postUrl);
            if (!postUrl) continue;
            
            const isGratis = /gratis|kostenlos|free|0€|umsonst/i.test(d.item_given_away || '');
            const validityDate = parseGermanDate(d.validity_date || '');
            if (!isNotTooOld(validityDate)) continue;
            const brand = d.brand_or_store || source;
            const title = d.item_given_away?.substring(0, 60) || 'Gastro Deal';
            const pubDate = validityDate ? validityDate.toISOString() : new Date().toISOString();
            
            allDeals.push({
              id: dealId('g2', brand, title, postUrl),
              brand,
              title,
              description: `${d.item_given_away} – ${d.location}`.trim(),
              type: isGratis ? 'gratis' : 'rabatt',
              category: 'essen',
              source: 'Firecrawl Gastro #2',
              url: postUrl,
              expires: `${d.validity_date || ''} ${d.validity_time || ''}`.trim(),
              distance: d.location || 'Wien',
              hot: true,
              isNew: true,
              priority: isGratis ? 2 : 3,
              votes: 1,
              qualityScore: 65,
              pubDate,
            });
          }
        }
      }
    } catch (e) {
      console.log(`      → Error: ${e.message}`);
    }
    
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log();
  console.log('📊 ERGEBNIS:');
  console.log(`   📦 Deals: ${allDeals.length}`);
  
    // Deduplizierung nach URL
    const dedupeUrls = new Set();
    const dedupedDeals = allDeals.filter(d => { const url = (d.url || '').trim(); if (!url || dedupeUrls.has(url)) return false; dedupeUrls.add(url); return true; });
    console.log(`🔄 ${allDeals.length - dedupedDeals.length} URL-Duplikate entfernt`);
    const finalDeals = dedupedDeals.slice(0, 100);
  
  const outputPath = 'docs/deals-pending-gastro2.json';
  const output = {
    lastUpdated: new Date().toISOString(),
    source: 'gastro2',
    totalDeals: finalDeals.length,
    deals: finalDeals,
  };
  
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`💾 ${finalDeals.length} Deals → ${outputPath}`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });

// ============================================
// 🍔🔥 FIRECRAWL FOOD & DRINK AGENT #3
// Spezialisiert auf Food & Drink Deals von Instagram & TikTok
// ============================================

import Firecrawl from '@mendable/firecrawl-js';
import { z } from 'zod';
import fs from 'fs';

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY2 || process.env.FIRECRAWL_API_KEY;

if (!FIRECRAWL_API_KEY) {
  console.error('❌ FIRECRAWL_API_KEY2 oder FIRECRAWL_API_KEY nicht gesetzt!');
  process.exit(1);
}

const firecrawl = new Firecrawl({ apiKey: FIRECRAWL_API_KEY });

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

// ============================================
// SEITEN - Instagram & TikTok
// ============================================

const SCRAPE_URLS = [
  'https://www.instagram.com/explore/tags/gratiswien/',
  'https://www.instagram.com/explore/tags/wienfood/',
  'https://www.instagram.com/explore/tags/kaffeewien/',
];

// ============================================
// SCHEMA
// ============================================

const foodSchema = z.object({
  food_and_drink_offers: z.array(z.object({
    offer_type: z.string(),
    offer_type_citation: z.string().optional(),
    description: z.string(),
    description_citation: z.string().optional(),
    discount_value: z.string(),
    discount_value_citation: z.string().optional(),
    location: z.string(),
    location_citation: z.string().optional(),
    platform_source: z.string(),
    platform_source_citation: z.string().optional(),
    start_date: z.string(),
    start_date_citation: z.string().optional(),
    end_date: z.string(),
    end_date_citation: z.string().optional(),
    source_url: z.string(),
    source_url_citation: z.string().optional(),
  })),
});

// ============================================
// PROMPT
// ============================================

const TODAY = new Date().toLocaleDateString('de-AT');
const CUTOFF = new Date(Date.now() - 14*24*60*60*1000).toLocaleDateString('de-AT');

const PROMPT = `Heute ist ${TODAY}.
WICHTIG: Ignoriere ALLE Posts und Angebote die älter als 14 Tage sind. Nur Deals die nach dem ${CUTOFF} gepostet wurden.

Extrahiere aktuelle und zukünftige Angebote für kostenlose oder stark vergünstigte Speisen und Getränke in Wien von Instagram und TikTok. Berücksichtige:
1. Kostenlose Angebote (Neueröffnungen, Treueaktionen, Story-Deals)
2. 'Buy One Get One Free' (BOGO) Aktionen
3. Rabatte von mindestens 30%

Schließe Angebote aus, die bereits abgelaufen sind.

Suche systematisch nach verschiedenen Kategorien (z.B. Cafés, Streetfood, Restaurants, Bars).

WICHTIG: Jede 'source_url' darf nur genau einmal in der Liste vorkommen. Entferne alle Duplikate basierend auf der URL, auch wenn dadurch die Gesamtzahl von 100 Deals nicht erreicht wird.

Gib alle Ergebnisse in einer einzigen Liste aus.`;

// ============================================
// EMOJI-FUNKTION
// ============================================
function getEmoji(deal) {
  const text = `${deal.title || ''} ${deal.description || ''} ${deal.offer_type || ''} ${deal.category || ''}`.toLowerCase();
  const emojiMap = [
    [/kaffee|coffee|latte/, '☕'], [/pizza/, '🍕'], [/burger/, '🍔'], [/kebab|döner|falafel/, '🥙'],
    [/sushi/, '🍣'], [/eis|gelato/, '🍦'], [/bier|beer/, '🍺'], [/wein|wine/, '🍷'],
    [/cocktail|drink/, '🍸'], [/restaurant|essen|food/, '🍽️'], [/gratis|free|kostenlos/, '🎁'],
    [/fitness|gym/, '💪'], [/kino|film|konzert/, '🎬'], [/museum|kultur/, '🏛️'],
    [/eintritt/, '🎟️'], [/gutschein|rabatt|sale/, '🏷️'], [/shop|shopping/, '🛍️'],
    [/supermarkt/, '🛒'], [/beauty|kosmetik/, '💄'], [/tech|handy/, '📱'],
  ];
  for (const [regex, emoji] of emojiMap) if (regex.test(text)) return emoji;
  return '🎯';
}

function getCategory(deal) {
  // Source-basierte Kategorie
  const source = (deal.source || '').toLowerCase();
  if (source.includes('kirchen') || source.includes('kirche')) return 'kirche';
  if (source.includes('gemeinde')) return 'gemeinde';
  if (source.includes('gottesdienst')) return 'gottesdienste';
  
  // Text-basierte Kategorie
  const text = `${deal.title || ''} ${deal.description || ''} ${deal.offer_type || ''}`.toLowerCase();
  const map = [
    [/kaffee|coffee|latte/, 'kaffee'],
    [/pizza|burger|kebab|döner|falafel|sushi|eis|restaurant|imbiss|bier|wein|cocktail|food|meal|essen/, 'essen'],
    [/gratis|free|kostenlos/, 'gratis'],
    [/fitness|gym|workout|sport/, 'fitness'],
    [/kino|film|konzert|event|eintritt|ticket/, 'events'],
    [/museum|ausstellung|kultur/, 'kultur'],
    [/gutschein|rabatt|sale|shopping|shop/, 'shopping'],
    [/supermarkt/, 'supermarkt'],
    [/beauty|kosmetik|parfum|dm|bipa/, 'beauty'],
    [/tech|handy|laptop|elektronik/, 'technik'],
    [/streaming|netflix|spotify/, 'streaming'],
    [/möbel|wohnung/, 'wohnen'],
    [/fahrrad|rad/, 'mobilität'],
    [/zug|bahn|öbb/, 'mobilität'],
    [/flug|hotel|urlaub/, 'reisen'],
    [/wien|vienna/, 'wien'],
  ];
  for (const [regex, cat] of map) if (regex.test(text)) return cat;
  return 'essen';
}

// ============================================
// DATUM-FILTER: Abgelaufene Deals rausfiltern
// ============================================
function parseGermanDate(str) {
  if (!str || typeof str !== 'string') return null;
  str = str.trim();
  if (/^(siehe|unbekannt|dauerhaft|unbegrenzt|jederzeit|laufend)/i.test(str)) return null;
  let m = str.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(parseInt(m[1]), parseInt(m[2])-1, parseInt(m[3]));
  m = str.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) return new Date(parseInt(m[3]), parseInt(m[2])-1, parseInt(m[1]));
  m = str.match(/(\d{1,2})\.(\d{1,2})\./);
  if (m) return new Date(new Date().getFullYear(), parseInt(m[2])-1, parseInt(m[1]));
  return null;
}

function isExpiredDeal(deal) {
  const twoWeeksAgo = new Date(Date.now() - 14*24*60*60*1000);
  const fields = [deal.validity_date, deal.end_date, deal.expires].filter(Boolean);
  for (const f of fields) {
    const d = parseGermanDate(f);
    if (d && d < twoWeeksAgo) return true;
  }
  return false;
}

// ============================================
// MAIN
// ============================================

async function main() {
  console.log('🍔🔥 FIRECRAWL FOOD & DRINK AGENT #3');
  console.log('='.repeat(40));
  console.log(`📅 ${new Date().toLocaleString('de-AT')}`);
  console.log();

  const allDeals = [];
  const seenUrls = new Set();
  
  console.log(`🔍 Scrape ${SCRAPE_URLS.length} Seiten (Instagram & TikTok)...`);
  
  for (let i = 0; i < SCRAPE_URLS.length; i++) {
    const url = SCRAPE_URLS[i];
    const source = new URL(url).hostname.replace('www.', '');
    
    console.log(`   [${i + 1}/${SCRAPE_URLS.length}] ${source}...`);
    
    try {
      const result = await firecrawl.agent({
        url: url,
        prompt: PROMPT,
        schema: foodSchema,
        model: 'spark-1-pro',
      });
      
      if (result && result.data) {
        let data = result.data;
        
        if (typeof data === 'string') {
          try {
            data = JSON.parse(data);
          } catch (e) {}
        }
        
        if (data && data.food_and_drink_offers && Array.isArray(data.food_and_drink_offers)) {
          console.log(`      → ${data.food_and_drink_offers.length} Angebote gefunden`);
          
          for (const d of data.food_and_drink_offers) {
            const sourceUrl = d.source_url || '';
            
            // Skip duplicates
            if (sourceUrl && seenUrls.has(sourceUrl)) {
              console.log(`      → Duplikat übersprungen: ${sourceUrl.substring(0, 30)}...`);
              continue;
            }
            if (sourceUrl) seenUrls.add(sourceUrl);
            
            const isGratis = /gratis|kostenlos|free|0€|0 €|umsonst/i.test(d.offer_type || d.description || '');
            const isBogo = /bogo|buy one|get one|2 for/i.test(d.description || '');
            
            allDeals.push({
              id: dealId('food3', source, d.was, d.source_url),
              brand: d.platform_source || source,
              title: d.offer_type?.substring(0, 60) || 'Food Deal',
              logo: getEmoji({ title: d.offer_type, description: d.description, category: 'essen' }),
              description: d.description || `${d.offer_type} - ${d.location}`,
              type: isGratis ? 'gratis' : (isBogo ? 'bogo' : 'rabatt'),
              category: getCategory({ title: d.offer_type, description: d.description }),
              source: 'Firecrawl Food #3',
              url: sourceUrl,
              expires: d.end_date || 'Unbekannt',
              distance: d.location || 'Wien',
              hot: true,
              isNew: true,
              priority: isGratis ? 2 : 4,
              votes: 1,
              qualityScore: 65,
              pubDate: new Date().toISOString(),
            });
          }
        } else {
          console.log(`      → Keine strukturierten Angebote`);
        }
      }
    } catch (e) {
      console.log(`      → Error: ${e.message}`);
    }
    
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log();
  console.log('📊 ERGEBNIS:');
  console.log(`   🔍 Seiten: ${SCRAPE_URLS.length}`);
  console.log(`   📦 Deals: ${allDeals.length}`);
  
  // Filter abgelaufene Deals
  const beforeFilter = allDeals.length;
  const filteredDeals = allDeals.filter(d => !isExpiredDeal(d));
  console.log(`🗑️ ${beforeFilter - filteredDeals.length} abgelaufene Deals entfernt`);

// Deduplizierung nach URL
    const dedupeUrls = new Set();
    const dedupedDeals = filteredDeals.filter(d => {
          const url = (d.url || '').trim();
          if (!url || dedupeUrls.has(url)) return false;
          dedupeUrls.add(url);
          return true;
    });
    console.log(`🔄 ${filteredDeals.length - dedupedDeals.length} URL-Duplikate entfernt`);
        const finalDeals = dedupedDeals.slice(0, 100);
    console.log(`  ✅ Final: ${finalDeals.length}`);
    console.log('='.repeat(40));
  // Write to file
  const outputPath = 'docs/deals-pending-food3.json';
  const output = {
    lastUpdated: new Date().toISOString(),
    source: 'firecrawl-food3',
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

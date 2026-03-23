// ============================================
// 🔥 FIRECRAWL CONSUMABLES AGENT - Food & Coffee Focus
// Speziell für kostenloses Essen, Getränke, Coffee
// ============================================

import Firecrawl from '@mendable/firecrawl-js';
import { z } from 'zod';
import fs from 'fs';

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY3 || process.env.FIRECRAWL_API_KEY;

if (!FIRECRAWL_API_KEY) {
  console.error('❌ FIRECRAWL_API_KEY3 oder FIRECRAWL_API_KEY nicht gesetzt!');
  process.exit(1);
}

const firecrawl = new Firecrawl({ apiKey: FIRECRAWL_API_KEY });

async function runAgent(payload) {
  return firecrawl.agent(payload);
}

function isRateOrCreditError(message) {
  const m = (message || '').toLowerCase();
  return m.includes('insufficient credits') || m.includes('rate limit exceeded');
}

function isInstagramUrl(url) {
  return (url || '').includes('instagram.com');
}

// ============================================
// SEITEN - Fokus auf Food/Coffee/Consumables
// ============================================

const SCRAPE_URLS = [
  // Instagram - Coffee & Food Wien
  'https://www.instagram.com/explore/tags/gratiswien/',
  'https://www.instagram.com/explore/tags/wienfood/',
  'https://www.instagram.com/explore/tags/kaffeewien/',
  'https://www.instagram.com/explore/tags/coffeevienna/',
  'https://www.instagram.com/explore/tags/freecoffeeVienna/',
  'https://www.instagram.com/explore/tags/gratisessenwien/',
  'https://www.instagram.com/explore/tags/eröffnungwien/',
  'https://www.instagram.com/explore/tags/neueröffnungwien/',
  'https://www.instagram.com/explore/tags/wiengratis/',
  'https://www.instagram.com/explore/tags/foodiewien/',
  'https://www.instagram.com/explore/tags/wiendeals/',
  'https://www.instagram.com/explore/tags/wienrabatt/',
  'https://www.instagram.com/explore/tags/wienaktion/',
  'https://www.instagram.com/explore/tags/wiengratis/',
  'https://www.instagram.com/explore/tags/wienkostenlos/',
  
  // Twitter/X - Wiener Deals
  'https://x.com/gratiswien',
  'https://x.com/wiendeals',
  'https://x.com/wiengratis',
  
  // Gastro
  'https://www.falstaff.at/',
  'https://www.diegourmet.at/',
  'https://www.restaurant-radar.at/',
  'https://www.meinbezirk.at/',
  
  // Deals
  'https://www.gutscheine.at/',
  'https://www.preisjaeger.at/',
  'https://www.gratisproben.net/oesterreich/',
];

// ============================================
// SCHEMA - Mit source_url Pflichtfeld
// ============================================

const consumablesSchema = z.object({
  deals: z.array(z.object({
    item_given_away: z.string().describe("What exactly is being given away or offered for free (e.g. 'Gratis Döner', 'Free Coffee')"),
    company_name: z.string().describe("The name of the company, restaurant, or brand offering the deal"),
    company_name_citation: z.string().optional(),
    full_address: z.string().describe("The complete street address with postal code and city (e.g. 'Hernalser Gürtel 43, 1170 Wien')"),
    full_address_citation: z.string().optional(),
    category: z.string().describe("Category: Food, Coffee, Drink, Dessert, Beauty, Shopping, Event, or General"),
    category_citation: z.string().optional(),
    location: z.string().describe("Short location name or area (e.g. 'OAKBERRY Wien' or '1010 Wien')"),
    location_citation: z.string().optional(),
    validity_date: z.string().describe("The date(s) when the deal is valid (e.g. '15.03.2026' or '15.-20.03.2026')"),
    validity_date_citation: z.string().optional(),
    validity_time: z.string().describe("The time(s) when the deal is valid (e.g. '10:00-14:00' or 'ab 11:00')"),
    validity_time_citation: z.string().optional(),
    deal_description: z.string().describe("A short, clear description of the deal in 1-2 sentences in German"),
    deal_description_citation: z.string().optional(),
    source_url: z.string().describe("The direct URL to the specific Instagram post or blog article"),
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

Extrahiere mindestens 50-100 aktuelle und zukünftige kostenlose Deals und Freebies in Wien für die nächsten 3 Monate.

Suche primär auf Instagram nach Beiträgen zu Gratis-Aktionen, Neueröffnungen und Werbegeschenken.

Setze den Fokus stark auf 'Consumables', insbesondere:
- Kostenlosen Kaffee
- Food-Samples
- Gratis-Essen bei Neueröffnungen
- Gastronomie-Aktionen

Ergänze die Instagram-Funde durch relevante Wiener Lifestyle-Blogs und Event-Seiten.

Für JEDEN Deal erfasse ALLE folgenden Informationen so vollständig wie möglich:
- item_given_away: Was genau wird verschenkt? (z.B. 'Gratis Döner', '1+1 Açaí Bowl')
- company_name: Name des Unternehmens/Restaurants/Cafés (z.B. 'OAKBERRY', 'BE HALAL')
- full_address: Vollständige Adresse mit PLZ und Stadt (z.B. 'Maysedergasse 2, 1010 Wien')
- category: Kategorie (Food, Coffee, Drink, Dessert, Beauty, Shopping, Event, General)
- location: Kurzname oder Bezirk (z.B. '1010 Wien' oder 'Hernals')
- validity_date: Genaues Datum (z.B. '15.03.2026')
- validity_time: Genaue Uhrzeit (z.B. '10:00-14:00')
- deal_description: Kurze Beschreibung auf Deutsch in 1-2 Sätzen
- source_url: Die direkte URL zum Instagram-Post oder Blog-Beitrag

WICHTIG: Gib bei jedem Feld die Information so genau und vollständig wie möglich an. Wenn keine genaue Adresse verfügbar ist, gib den Bezirk oder die Gegend an.`;

// ============================================
// EMOJI-FUNKTION
// ============================================
function getEmoji(deal) {
  const text = `${deal.title || ''} ${deal.description || ''} ${deal.item_given_away || ''} ${deal.category || ''}`.toLowerCase();
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
  if (source.includes('gemeinde')) return 'kirche';
  if (source.includes('gottesdienst')) return 'gottesdienste';
  
  // Text-basierte Kategorie
  const text = `${deal.title || ''} ${deal.description || ''} ${deal.item_given_away || ''}`.toLowerCase();
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
  const now = new Date();
  const fields = [deal.validity_date, deal.end_date, deal.expires].filter(Boolean);
  for (const f of fields) {
    const d = parseGermanDate(f);
    if (d && d < now) return true;
  }
  return false;
}

function isNotTooOld(dateObj) {
  if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return true;
  const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
  return dateObj.getTime() >= twoWeeksAgo;
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
  console.log('🔥 FIRECRAWL CONSUMABLES AGENT');
  console.log('='.repeat(40));
  console.log(`📅 ${new Date().toLocaleString('de-AT')}`);
  console.log();

  const allDeals = [];
  
  console.log(`🔍 Scrape ${SCRAPE_URLS.length} Seiten (Consumables Focus)...`);
  
  for (let i = 0; i < SCRAPE_URLS.length; i++) {
    const url = SCRAPE_URLS[i];
    const source = new URL(url).hostname.replace('www.', '');
    
    console.log(`   [${i + 1}/${SCRAPE_URLS.length}] ${source}...`);
    
    try {
      const result = await runAgent({
        url: url,
        prompt: PROMPT,
        schema: consumablesSchema,
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
            const isFood = (d.category || '').toLowerCase().includes('food');
            const sourceUrl = d.source_url || '';
            if (!sourceUrl) continue;
            const validityDate = parseGermanDate(d.validity_date || '');
            if (!isNotTooOld(validityDate)) continue;
            const brand = d.company_name || source;
            const title = d.item_given_away?.substring(0, 80) || 'Deal';
            const pubDate = validityDate ? validityDate.toISOString() : new Date().toISOString();
            
            allDeals.push({
              id: dealId('cs', brand, title, sourceUrl),
              brand,
              title,
              logo: getEmoji({ title: d.item_given_away, description: d.deal_description, category: d.category }),
              description: d.deal_description || d.item_given_away || '',
              type: 'gratis',
              category: getCategory({ title: d.item_given_away, description: d.deal_description }),
              source: 'Firecrawl Consumables',
              url: sourceUrl,
              expires: (d.validity_date || '') + (d.validity_time ? ' ' + d.validity_time : ''),
              distance: d.company_name ? (d.company_name + (d.full_address ? ', ' + d.full_address : d.location ? ', ' + d.location : ', Wien')) : (d.full_address || d.location || 'Wien'),
              hot: true,
              isNew: true,
              priority: isFood ? 3 : 5,
              votes: 1,
              qualityScore: 60,
              pubDate,
            });
          }
        } else {
          console.log(`      → Keine strukturierten Deals`);
        }
      }
    } catch (e) {
      console.log(`      → Error: ${e.message}`);
      if (isRateOrCreditError(e.message)) {
        console.log('      → Stoppe Run frühzeitig wegen API-Limit/Credits');
        break;
      }
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
    const seenUrls = new Set();
    const dedupedDeals = filteredDeals.filter(d => {
          const url = (d.url || '').trim();
          if (!url || seenUrls.has(url)) return false;
          seenUrls.add(url);
          return true;
    });
    console.log(`🔄 ${filteredDeals.length - dedupedDeals.length} URL-Duplikate entfernt`);

    const finalDeals = dedupedDeals.slice(0, 150);
  
  console.log(`   ✅ Final: ${finalDeals.length}`);
  console.log('='.repeat(40));
  
  // Write to separate file
  const outputPath = 'docs/deals-pending-firecrawl2.json';
  const output = {
    lastUpdated: new Date().toISOString(),
    source: 'firecrawl-consumables',
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

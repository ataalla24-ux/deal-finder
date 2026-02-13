// ============================================
// FREEFINDER WIEN - GOOGLE DEALS SCRAPER V3
// NUR echte Gratis-Deals & extrem günstige Angebote
// Keine "Entdeckt" Platzhalter!
// ============================================

import https from 'https';
import fs from 'fs';

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY || '';

if (!GOOGLE_PLACES_API_KEY) {
  console.log('⚠️  GOOGLE_PLACES_API_KEY nicht gesetzt');
  process.exit(0);
}

// ============================================
// Suchbegriffe — sehr spezifisch auf echte Deals
// ============================================

const DEAL_SEARCHES = [
  { query: 'gratis kebab wien neueröffnung', category: 'essen', logo: '🥙' },
  { query: 'gratis kaffee wien aktion', category: 'kaffee', logo: '☕' },
  { query: 'gratis essen wien eröffnung', category: 'essen', logo: '🍽️' },
  { query: '1 euro kebab wien', category: 'essen', logo: '🥙' },
  { query: '2 euro kebab wien', category: 'essen', logo: '🥙' },
  { query: '1 euro pizza wien', category: 'essen', logo: '🍕' },
  { query: 'gratis döner wien', category: 'essen', logo: '🥙' },
  { query: 'gratis burger wien aktion', category: 'essen', logo: '🍔' },
  { query: 'gratis eis wien aktion', category: 'essen', logo: '🍦' },
  { query: 'kostenlos essen wien neueröffnung', category: 'essen', logo: '🆕' },
  { query: 'eröffnungsangebot gratis wien', category: 'essen', logo: '🆕' },
  { query: 'gratis probetraining wien', category: 'fitness', logo: '💪' },
  { query: '1+1 gratis wien essen', category: 'essen', logo: '🎁' },
];

// ============================================
// Keywords die WIRKLICH auf einen Deal hindeuten
// ============================================

// Ein Deal MUSS eines dieser Wörter enthalten UND im richtigen Kontext stehen
const STRONG_DEAL_PATTERNS = [
  // "gratis kebab" / "gratis kaffee" etc. — Produkt direkt nach gratis
  /gratis\s+(kebab|kebap|döner|pizza|burger|kaffee|coffee|eis|wrap|falafel|getränk|drink|menü|essen|food|meal|croissant|semmel|brot)/i,
  // "kostenlos ... essen/probieren"
  /kostenlos\w*\s+\w*\s*(essen|probieren|kosten|testen|abholen|mitnehmen)/i,
  // "1 euro kebab" / "2€ pizza" etc.
  /[12]\s*[€euro]\s*(kebab|kebap|döner|pizza|burger|kaffee|eis|wrap|falafel)/i,
  /(kebab|kebap|döner|pizza|burger|kaffee|eis|wrap|falafel)\s*(um|für|nur)\s*[12]\s*[€euro]/i,
  // "1+1 gratis"
  /1\s*\+\s*1\s*gratis/i,
  // "eröffnung" + "gratis"
  /(eröffnung|opening)\s.*gratis|gratis\s.*(eröffnung|opening)/i,
  // "free food" / "free kebab"
  /free\s+(food|kebab|kebap|döner|pizza|burger|coffee|ice cream|meal)/i,
  // Spezifische Preisangebote
  /(kebab|kebap|döner|pizza|burger)\s*(ab|um|für|nur)\s*€?\s*[0-2][.,]\d{2}/i,
];

// False positives ausfiltern
const FALSE_POSITIVE_PATTERNS = [
  /dieser service ist .* kostenlos/i,
  /app .* kostenlos/i,
  /download .* gratis/i,
  /eintritt .* frei/i,
  /wifi .* gratis/i,
  /wlan .* gratis/i,
  /kostenlos.* park/i,
  /gratis.* wasser$/i,
  /newsletter/i,
  /abbestell/i,
  /kostenlos stornieren/i,
  /versandkostenfrei/i,
  /gratis versand/i,
  /gratis lieferung/i,
  /zustellung .* gratis/i,
];

// Blacklist Orte
const BLACKLIST = [
  'apartment', 'airbnb', 'hotel', 'hostel', 'wohnung',
  'immobilie', 'booking', 'ferienwohnung', 'residence',
  'makler', 'real estate', 'miete', 'kaufen', 'lodging'
];

// ============================================
// HTTP Fetch (clean, no browser UA for APIs)
// ============================================

function fetchJSON(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'Accept': 'application/json' },
      timeout
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (data.trim().startsWith('<')) {
          reject(new Error('HTML statt JSON — API Key Problem'));
          return;
        }
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON Parse Error')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function fetchHTML(url, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : require('http');
    const req = protocol.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'de-AT,de;q=0.9,en;q=0.8'
      },
      timeout
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchHTML(res.headers.location, timeout).then(resolve).catch(reject);
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
// Google Places Text Search
// ============================================

async function searchPlaces(query) {
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&location=48.2082,16.3738&radius=15000&key=${GOOGLE_PLACES_API_KEY}&language=de`;
  const data = await fetchJSON(url);
  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    throw new Error(`API: ${data.status} — ${data.error_message || ''}`);
  }
  return data.results || [];
}

async function getPlaceDetails(placeId) {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,website,formatted_phone_number,opening_hours,editorial_summary,reviews&key=${GOOGLE_PLACES_API_KEY}&language=de`;
  const data = await fetchJSON(url);
  return (data.status === 'OK' && data.result) ? data.result : null;
}

// ============================================
// Website nach ECHTEN Deals durchsuchen
// ============================================

async function scrapeForRealDeals(websiteUrl) {
  try {
    const html = await fetchHTML(websiteUrl);
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\s+/g, ' ')
      .toLowerCase();

    // Check gegen false positives
    for (const fp of FALSE_POSITIVE_PATTERNS) {
      // Wir zählen false positives, aber brechen nicht ab
    }

    // Suche nach starken Deal-Patterns
    for (const pattern of STRONG_DEAL_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        // Prüfe ob es ein false positive ist
        const context = text.substring(Math.max(0, match.index - 50), match.index + match[0].length + 50);
        const isFalsePositive = FALSE_POSITIVE_PATTERNS.some(fp => fp.test(context));
        if (!isFalsePositive) {
          // Extrahiere den Satz
          const start = text.lastIndexOf('.', match.index) + 1;
          const end = text.indexOf('.', match.index + match[0].length);
          const sentence = text.substring(start, end > 0 ? end : start + 120).trim();
          
          // Preis extrahieren
          const priceMatch = context.match(/(\d+[.,]?\d*)\s*€|€\s*(\d+[.,]?\d*)/);
          const price = priceMatch ? parseFloat((priceMatch[1] || priceMatch[2]).replace(',', '.')) : null;
          
          const isGratis = /gratis|kostenlos|free|geschenkt|umsonst/.test(match[0]);
          
          return {
            found: true,
            dealText: sentence.substring(0, 120),
            price: price,
            isGratis: isGratis,
            isCheap: price !== null && price <= 3
          };
        }
      }
    }

    return { found: false };
  } catch (e) {
    return { found: false };
  }
}

// ============================================
// Reviews nach echten Deals durchsuchen
// ============================================

function checkReviewsForDeals(reviews) {
  if (!reviews || !Array.isArray(reviews)) return { found: false };

  // Nur Reviews der letzten 6 Monate berücksichtigen
  const sixMonthsAgo = Date.now() / 1000 - (180 * 24 * 3600);

  for (const review of reviews) {
    if (review.time && review.time < sixMonthsAgo) continue;
    
    const text = (review.text || '').toLowerCase();

    for (const pattern of STRONG_DEAL_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        const context = text.substring(Math.max(0, match.index - 50), match.index + match[0].length + 50);
        const isFalsePositive = FALSE_POSITIVE_PATTERNS.some(fp => fp.test(context));
        if (!isFalsePositive) {
          const start = text.lastIndexOf('.', match.index) + 1;
          const end = text.indexOf('.', match.index + match[0].length);
          const sentence = text.substring(start, end > 0 ? end : start + 120).trim();
          const isGratis = /gratis|kostenlos|free|geschenkt|umsonst/.test(match[0]);
          return { found: true, dealText: sentence.substring(0, 120), isGratis };
        }
      }
    }
  }

  return { found: false };
}

// ============================================
// Bezirk & Logo helpers
// ============================================

function extractDistrict(address) {
  const match = address.match(/(\d{4})\s*Wien/);
  if (match) {
    const bezirk = parseInt(match[1].substring(1, 3));
    return `${bezirk}. Bezirk`;
  }
  return address.split(',')[0] || 'Wien';
}

function getLogo(name, types, fallback) {
  const n = name.toLowerCase();
  if (n.includes('kebab') || n.includes('kebap') || n.includes('döner')) return '🥙';
  if (n.includes('pizza')) return '🍕';
  if (n.includes('burger')) return '🍔';
  if (n.includes('sushi')) return '🍣';
  if (n.includes('kaffee') || n.includes('coffee') || n.includes('café') || n.includes('cafe')) return '☕';
  if (n.includes('eis') || n.includes('gelato')) return '🍦';
  if (n.includes('fitness') || n.includes('gym')) return '💪';
  return fallback || '🎁';
}

// ============================================
// MAIN
// ============================================

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📍 GOOGLE DEALS SCRAPER V3');
  console.log(`📅 ${new Date().toLocaleString('de-AT')}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🎯 NUR echte Gratis-Deals & extrem günstige Angebote!\n');

  const dealsPath = 'docs/deals.json';
  if (fs.existsSync(dealsPath)) {
    fs.copyFileSync(dealsPath, 'docs/deals.backup.json');
  }

  const allDeals = [];
  const seenPlaces = new Set();
  let apiCalls = 0;
  const MAX_API_CALLS = 25;

  // Rotiere Suchen nach Wochentag
  const dayOfWeek = new Date().getDay();
  const offset = (dayOfWeek * 4) % DEAL_SEARCHES.length;
  const activeSearches = [];
  for (let i = 0; i < 8 && i < DEAL_SEARCHES.length; i++) {
    activeSearches.push(DEAL_SEARCHES[(offset + i) % DEAL_SEARCHES.length]);
  }

  console.log(`🔍 ${activeSearches.length} Suchen:\n`);

  for (const search of activeSearches) {
    if (apiCalls >= MAX_API_CALLS) {
      console.log(`⚠️  API-Limit erreicht`);
      break;
    }

    try {
      console.log(`🔍 "${search.query}"...`);
      apiCalls++;

      const places = await searchPlaces(search.query);
      if (places.length === 0) {
        console.log(`   → 0 Ergebnisse`);
        continue;
      }

      console.log(`   → ${places.length} Orte, prüfe auf echte Deals...`);

      for (const place of places.slice(0, 5)) {
        if (seenPlaces.has(place.place_id)) continue;
        
        const name = (place.name || '').toLowerCase();
        const addr = (place.vicinity || place.formatted_address || '').toLowerCase();
        
        // Blacklist
        if (BLACKLIST.some(b => (name + ' ' + addr).includes(b))) continue;
        const types = place.types || [];
        if (['lodging', 'real_estate_agency'].some(t => types.includes(t))) continue;

        seenPlaces.add(place.place_id);

        // Details holen
        let websiteDeal = { found: false };
        let reviewDeal = { found: false };

        if (apiCalls < MAX_API_CALLS) {
          apiCalls++;
          const details = await getPlaceDetails(place.place_id);

          if (details?.website) {
            websiteDeal = await scrapeForRealDeals(details.website);
          }
          if (details?.reviews) {
            reviewDeal = checkReviewsForDeals(details.reviews);
          }
        }

        // ✅ STRENGE VALIDIERUNG: Nur wenn ein STRONG_DEAL_PATTERN matched
        if (!websiteDeal.found && !reviewDeal.found) continue;

        const dealSource = websiteDeal.found ? websiteDeal : reviewDeal;
        const isGratis = dealSource.isGratis || false;
        const isCheap = websiteDeal.found && websiteDeal.isCheap;
        const address = place.vicinity || place.formatted_address || 'Wien';
        const district = extractDistrict(address);
        const logo = getLogo(place.name, place.types, search.logo);

        let title = '';
        if (isGratis) {
          title = `GRATIS: ${dealSource.dealText || place.name}`;
        } else if (isCheap && websiteDeal.price) {
          title = `Ab €${websiteDeal.price}: ${dealSource.dealText || place.name}`;
        } else {
          title = `DEAL: ${dealSource.dealText || place.name}`;
        }
        title = title.substring(0, 70);

        const deal = {
          id: `gd-${place.place_id.substring(0, 10)}-${Date.now().toString(36)}`,
          brand: place.name,
          logo: logo,
          title: title,
          description: `${place.name} (${district}): ${(dealSource.dealText || '').substring(0, 100)}`,
          type: isGratis ? 'gratis' : 'rabatt',
          badge: isGratis ? 'gratis' : 'limited',
          category: search.category,
          source: 'Google Deals',
          url: `https://www.google.com/maps/place/?q=place_id:${place.place_id}`,
          expires: 'Siehe Website',
          distance: district,
          hot: isGratis,
          isNew: true,
          isGoogleDeal: true,
          priority: isGratis ? 2 : 3,
          votes: Math.min(Math.round((place.user_ratings_total || 0) / 20), 30),
          pubDate: new Date().toISOString()
        };

        allDeals.push(deal);
        console.log(`   ✅ DEAL: ${logo} ${title}`);

        await new Promise(r => setTimeout(r, 200));
      }
    } catch (error) {
      console.log(`   ❌ Fehler: ${error.message}`);
    }
  }

  const finalDeals = allDeals.slice(0, 10);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 ERGEBNIS:');
  console.log(`   🔍 Suchen:           ${activeSearches.length}`);
  console.log(`   📍 Orte geprüft:     ${seenPlaces.size}`);
  console.log(`   ✅ Echte Deals:      ${finalDeals.length}`);
  console.log(`   📡 API Calls:        ${apiCalls}/${MAX_API_CALLS}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Merge in deals.json
  if (fs.existsSync(dealsPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(dealsPath, 'utf8'));

      // Alle alten Google-Deals entfernen
      existing.deals = existing.deals.filter(d => {
        if (d.id?.startsWith('places-')) return false;
        if (d.source === 'Google Places') return false;
        if (d.isGoogleDeal) return false;
        return true;
      });

      // Neue echte Deals hinzufügen
      if (finalDeals.length > 0) {
        const existingTitles = new Set(
          existing.deals.map(d => d.title.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 25))
        );

        let added = 0;
        for (const deal of finalDeals) {
          const key = deal.title.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 25);
          if (!existingTitles.has(key)) {
            existing.deals.push(deal);
            existingTitles.add(key);
            added++;
          }
        }
        console.log(`✅ ${added} neue echte Deals eingefügt`);
      } else {
        console.log('ℹ️  Keine neuen Deals gefunden — alte Google-Deals entfernt');
      }

      // Sortieren
      existing.deals.sort((a, b) => {
        if ((a.priority || 99) !== (b.priority || 99)) return (a.priority || 99) - (b.priority || 99);
        if (a.hot && !b.hot) return -1;
        if (!a.hot && b.hot) return 1;
        return 0;
      });

      existing.totalDeals = existing.deals.length;
      existing.lastUpdated = new Date().toISOString();

      fs.writeFileSync(dealsPath, JSON.stringify(existing, null, 2));
      console.log(`📊 Gesamt: ${existing.totalDeals} Deals`);
    } catch (e) {
      console.log(`❌ Merge fehlgeschlagen: ${e.message}`);
      if (fs.existsSync('docs/deals.backup.json')) {
        fs.copyFileSync('docs/deals.backup.json', dealsPath);
        console.log('🔄 Backup wiederhergestellt');
      }
    }
  }

  if (fs.existsSync('docs/deals.backup.json')) {
    fs.unlinkSync('docs/deals.backup.json');
  }

  console.log('\n✅ Google Deals Scraper V3 abgeschlossen!');
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal:', err.message);
    if (fs.existsSync('docs/deals.backup.json') && fs.existsSync('docs/deals.json')) {
      fs.copyFileSync('docs/deals.backup.json', 'docs/deals.json');
    }
    process.exit(0);
  });

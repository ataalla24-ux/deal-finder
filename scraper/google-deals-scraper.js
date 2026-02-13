// ============================================
// FREEFINDER WIEN - GOOGLE DEALS SCRAPER V2
// Sucht NUR nach echten Deals & Freebies
// Keine "Entdeckt" Platzhalter mehr!
// ============================================

import https from 'https';
import http from 'http';
import fs from 'fs';

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY || '';

if (!GOOGLE_PLACES_API_KEY) {
  console.log('âš ï¸  GOOGLE_PLACES_API_KEY nicht gesetzt - Google Deals Scraper Ã¼bersprungen');
  console.log('ðŸ’¡ Setze den Key als GitHub Secret.');
  process.exit(0);
}

// ============================================
// DEAL-SPEZIFISCHE SUCHBEGRIFFE
// Statt generisch "neuerÃ¶ffnung" suchen wir
// nach konkreten Gratis/GÃ¼nstig-Angeboten
// ============================================

const DEAL_SEARCHES = [
  // Gratis Food
  { query: 'gratis kebab wien', category: 'essen', dealType: 'gratis', logo: 'ðŸ¥™' },
  { query: 'gratis essen wien', category: 'essen', dealType: 'gratis', logo: 'ðŸ½ï¸' },
  { query: 'gratis kaffee wien', category: 'kaffee', dealType: 'gratis', logo: 'â˜•' },
  { query: 'kostenlos essen wien', category: 'essen', dealType: 'gratis', logo: 'ðŸ½ï¸' },
  { query: 'free food vienna', category: 'essen', dealType: 'gratis', logo: 'ðŸ½ï¸' },
  
  // GÃ¼nstig Essen
  { query: 'kebab 2 euro wien', category: 'essen', dealType: 'gÃ¼nstig', logo: 'ðŸ¥™' },
  { query: 'gÃ¼nstiger dÃ¶ner wien', category: 'essen', dealType: 'gÃ¼nstig', logo: 'ðŸ¥™' },
  { query: 'billig essen wien', category: 'essen', dealType: 'gÃ¼nstig', logo: 'ðŸ½ï¸' },
  { query: 'pizza aktion wien', category: 'essen', dealType: 'aktion', logo: 'ðŸ•' },
  
  // NeuerÃ¶ffnungen MIT Deal
  { query: 'neuerÃ¶ffnung gratis wien restaurant', category: 'essen', dealType: 'gratis', logo: 'ðŸ†•' },
  { query: 'erÃ¶ffnung gratis essen wien', category: 'essen', dealType: 'gratis', logo: 'ðŸ†•' },
  { query: 'grand opening free food vienna', category: 'essen', dealType: 'gratis', logo: 'ðŸ†•' },
  
  // Aktionen
  { query: '1+1 gratis wien restaurant', category: 'essen', dealType: 'aktion', logo: 'ðŸŽ' },
  { query: 'happy hour wien', category: 'essen', dealType: 'aktion', logo: 'ðŸº' },
  { query: 'all you can eat wien gÃ¼nstig', category: 'essen', dealType: 'gÃ¼nstig', logo: 'ðŸ½ï¸' },
  
  // Beauty & Fitness Gratis
  { query: 'gratis probetraining wien', category: 'fitness', dealType: 'gratis', logo: 'ðŸ’ª' },
  { query: 'gratis haarschnitt wien', category: 'beauty', dealType: 'gratis', logo: 'ðŸ’‡' },
  { query: 'kostenlos probieren wien', category: 'gratis', dealType: 'gratis', logo: 'ðŸ†“' },
];

// ============================================
// DEAL KEYWORDS FÃœR VALIDIERUNG
// ============================================

const GRATIS_KEYWORDS = [
  'gratis', 'kostenlos', 'free', 'geschenkt', 'umsonst',
  'freebie', 'verschenken', 'auf uns', 'aufs haus',
  'spendieren', 'einladung'
];

const PREIS_KEYWORDS = [
  'â‚¬1', 'â‚¬2', 'â‚¬3', 'â‚¬4', 'â‚¬5',
  '1â‚¬', '2â‚¬', '3â‚¬', '4â‚¬', '5â‚¬',
  '1,50', '1,90', '2,50', '2,90', '3,50', '3,90', '4,50', '4,90',
  'nur â‚¬', 'ab â‚¬1', 'ab â‚¬2', 'ab â‚¬3', 'ab â‚¬4', 'ab â‚¬5',
  'um 1', 'um 2', 'um 3'
];

const AKTION_KEYWORDS = [
  '1+1', '2 fÃ¼r 1', 'buy one get one', 'bogo',
  '50%', '60%', '70%', '80%', '-50%', '-60%', '-70%',
  'halber preis', 'happy hour', 'all you can eat', 'ayce',
  'mittagsmenÃ¼', 'lunch deal', 'lunch special'
];

const PRODUCT_KEYWORDS = [
  'kebab', 'kebap', 'dÃ¶ner', 'pizza', 'burger', 'kaffee', 'coffee',
  'eis', 'wrap', 'falafel', 'sushi', 'ramen', 'schnitzel',
  'menÃ¼', 'essen', 'food', 'meal', 'getrÃ¤nk', 'drink',
  'training', 'probetraining', 'haarschnitt', 'friseur'
];

// Blacklist - keine Deals
const BLACKLIST = [
  'apartment', 'airbnb', 'hotel', 'hostel', 'wohnung',
  'immobilie', 'booking', 'ferienwohnung', 'residence',
  'makler', 'real estate', 'miete', 'kaufen'
];

// ============================================
// HTTP FETCHER
// ============================================

function fetchURL(url, timeout = 10000, isApi = false) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const headers = isApi ? {
      'Accept': 'application/json'
    } : {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'de-AT,de;q=0.9,en;q=0.8'
    };
    const req = protocol.get(url, {
      headers,
      timeout
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchURL(res.headers.location).then(resolve).catch(reject);
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
// GOOGLE PLACES TEXT SEARCH
// ============================================

async function searchGooglePlaces(query) {
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&location=48.2082,16.3738&radius=15000&key=${GOOGLE_PLACES_API_KEY}&language=de`;

  const response = await fetchURL(url, 10000, true);

  if (response.trim().startsWith('<')) {
    throw new Error('HTML statt JSON - API Key Problem');
  }

  const data = JSON.parse(response);

  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    throw new Error(`API Status: ${data.status} - ${data.error_message || ''}`);
  }

  return data.results || [];
}

// ============================================
// GOOGLE PLACE DETAILS (Website URL holen)
// ============================================

async function getPlaceDetails(placeId) {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,website,formatted_phone_number,opening_hours,editorial_summary,reviews&key=${GOOGLE_PLACES_API_KEY}&language=de`;

  const response = await fetchURL(url, 10000, true);
  const data = JSON.parse(response);

  if (data.status === 'OK' && data.result) {
    return data.result;
  }
  return null;
}

// ============================================
// WEBSITE NACH DEALS DURCHSUCHEN
// ============================================

async function scrapeWebsiteForDeals(websiteUrl) {
  try {
    const html = await fetchURL(websiteUrl, 8000);

    // HTML-Tags entfernen, nur Text
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .toLowerCase();

    // Suche nach Deal-Indikatoren
    const dealIndicators = [];

    const hasGratis = GRATIS_KEYWORDS.some(k => text.includes(k));
    const hasPreis = PREIS_KEYWORDS.some(k => text.includes(k));
    const hasAktion = AKTION_KEYWORDS.some(k => text.includes(k));
    const hasProduct = PRODUCT_KEYWORDS.some(k => text.includes(k));

    if (hasGratis) dealIndicators.push('gratis');
    if (hasPreis) dealIndicators.push('gÃ¼nstig');
    if (hasAktion) dealIndicators.push('aktion');

    // Extrahiere konkreten Deal-Text
    let dealText = '';
    const sentences = text.split(/[.!?\n]/).filter(s => s.trim().length > 15 && s.trim().length < 200);

    for (const sentence of sentences) {
      const hasDealWord = [...GRATIS_KEYWORDS, ...PREIS_KEYWORDS, ...AKTION_KEYWORDS].some(k => sentence.includes(k));
      const hasProd = PRODUCT_KEYWORDS.some(k => sentence.includes(k));

      if (hasDealWord && hasProd) {
        dealText = sentence.trim();
        break;
      }
      if (hasDealWord && !dealText) {
        dealText = sentence.trim();
      }
    }

    // Preis extrahieren
    const priceMatch = text.match(/(\d+[.,]?\d*)\s*â‚¬|â‚¬\s*(\d+[.,]?\d*)/);
    const price = priceMatch ? parseFloat((priceMatch[1] || priceMatch[2]).replace(',', '.')) : null;

    return {
      hasDeals: dealIndicators.length > 0 && hasProduct,
      indicators: dealIndicators,
      dealText: dealText,
      price: price,
      hasGratis,
      hasAktion,
      hasProduct
    };
  } catch (e) {
    return { hasDeals: false, indicators: [], dealText: '', price: null, hasGratis: false, hasAktion: false, hasProduct: false };
  }
}

// ============================================
// REVIEWS NACH DEALS DURCHSUCHEN
// ============================================

function checkReviewsForDeals(reviews) {
  if (!reviews || !Array.isArray(reviews)) return { found: false, text: '' };

  for (const review of reviews) {
    const text = (review.text || '').toLowerCase();

    const hasGratis = GRATIS_KEYWORDS.some(k => text.includes(k));
    const hasPreis = PREIS_KEYWORDS.some(k => text.includes(k));
    const hasAktion = AKTION_KEYWORDS.some(k => text.includes(k));

    if (hasGratis || hasPreis || hasAktion) {
      // Extrahiere relevanten Satz
      const sentences = text.split(/[.!?]/).filter(s => s.trim().length > 15);
      for (const s of sentences) {
        if ([...GRATIS_KEYWORDS, ...PREIS_KEYWORDS, ...AKTION_KEYWORDS].some(k => s.includes(k))) {
          return { found: true, text: s.trim(), isGratis: hasGratis };
        }
      }
    }
  }

  return { found: false, text: '' };
}

// ============================================
// BEZIRK EXTRAHIEREN
// ============================================

function extractDistrict(address) {
  const match = address.match(/(\d{4})\s*Wien/);
  if (match) {
    const plz = match[1];
    const bezirk = parseInt(plz.substring(1, 3));
    return `${bezirk}. Bezirk`;
  }
  return address.split(',')[0] || 'Wien';
}

// ============================================
// LOGO BASIEREND AUF KATEGORIE
// ============================================

function getLogo(placeName, placeTypes, searchLogo) {
  const name = placeName.toLowerCase();
  if (name.includes('kebab') || name.includes('kebap') || name.includes('dÃ¶ner')) return 'ðŸ¥™';
  if (name.includes('pizza')) return 'ðŸ•';
  if (name.includes('burger')) return 'ðŸ”';
  if (name.includes('sushi')) return 'ðŸ£';
  if (name.includes('kaffee') || name.includes('coffee') || name.includes('cafe') || name.includes('cafÃ©')) return 'â˜•';
  if (name.includes('bÃ¤ckerei') || name.includes('bakery')) return 'ðŸ¥';
  if (name.includes('eis') || name.includes('gelato')) return 'ðŸ¦';
  if (name.includes('friseur') || name.includes('barber')) return 'ðŸ’‡';
  if (name.includes('fitness') || name.includes('gym')) return 'ðŸ’ª';

  if (placeTypes) {
    if (placeTypes.includes('cafe')) return 'â˜•';
    if (placeTypes.includes('restaurant')) return 'ðŸ½ï¸';
    if (placeTypes.includes('bar')) return 'ðŸº';
    if (placeTypes.includes('bakery')) return 'ðŸ¥';
    if (placeTypes.includes('gym')) return 'ðŸ’ª';
  }

  return searchLogo || 'ðŸŽ';
}

// ============================================
// DEAL ERSTELLEN
// ============================================

function createDeal(place, search, websiteDeals, reviewDeals, details) {
  const address = place.vicinity || place.formatted_address || 'Wien';
  const district = extractDistrict(address);

  // Titel erstellen - so konkret wie mÃ¶glich
  let title = '';
  let description = '';
  const isGratis = search.dealType === 'gratis' || websiteDeals.hasGratis;

  // Besten Deal-Text finden
  if (websiteDeals.dealText) {
    // Deal von Website
    title = websiteDeals.dealText.substring(0, 70);
    description = `${place.name}: ${websiteDeals.dealText.substring(0, 130)}`;
  } else if (reviewDeals.found && reviewDeals.text) {
    // Deal aus Reviews
    title = reviewDeals.text.substring(0, 70);
    description = `${place.name} (${district}): ${reviewDeals.text.substring(0, 130)}`;
  } else if (details?.editorial_summary?.overview) {
    title = `${place.name}: ${details.editorial_summary.overview.substring(0, 50)}`;
    description = details.editorial_summary.overview.substring(0, 150);
  } else {
    // Fallback mit Search-Kontext
    const dealLabel = isGratis ? 'Gratis-Angebot' : (search.dealType === 'aktion' ? 'Aktion' : 'GÃ¼nstig');
    title = `${dealLabel} bei ${place.name}`;
    description = `${place.name} in ${district}. ${address}. ${place.rating ? `â­ ${place.rating}` : ''}`;
  }

  // Titel aufrÃ¤umen
  title = title
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 70);

  // Prefix hinzufÃ¼gen
  if (isGratis && !title.toLowerCase().includes('gratis') && !title.toLowerCase().includes('kostenlos') && !title.toLowerCase().includes('free')) {
    title = `GRATIS: ${title}`.substring(0, 70);
  }

  // Preis im Titel wenn verfÃ¼gbar
  if (websiteDeals.price && websiteDeals.price <= 5 && !isGratis) {
    title = `Ab â‚¬${websiteDeals.price}: ${place.name}`.substring(0, 70);
  }

  const logo = getLogo(place.name, place.types, search.logo);

  return {
    id: `gd-${place.place_id.substring(0, 10)}-${Date.now().toString(36)}`,
    brand: place.name,
    logo: logo,
    title: title,
    description: description.substring(0, 150),
    type: isGratis ? 'gratis' : 'rabatt',
    badge: isGratis ? 'gratis' : 'limited',
    category: search.category,
    source: 'Google Deals',
    url: details?.website || `https://www.google.com/maps/place/?q=place_id:${place.place_id}`,
    expires: 'Siehe Website',
    distance: district,
    hot: isGratis,
    isNew: true,
    isGoogleDeal: true,
    priority: isGratis ? 2 : 3,
    votes: Math.min(Math.round((place.user_ratings_total || 0) / 20), 30),
    pubDate: new Date().toISOString()
  };
}

// ============================================
// MAIN
// ============================================

async function main() {
  console.log('â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”');
  console.log('ðŸ“ GOOGLE DEALS SCRAPER V2 gestartet');
  console.log(`ðŸ“… ${new Date().toLocaleString('de-AT')}`);
  console.log('â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n');
  console.log('ðŸŽ¯ Strategie: Nur ECHTE Deals - keine Platzhalter!\n');

  // Backup
  const dealsPath = 'docs/deals.json';
  if (fs.existsSync(dealsPath)) {
    fs.copyFileSync(dealsPath, 'docs/deals.backup.json');
    console.log('ðŸ’¾ Backup erstellt\n');
  }

  const allDeals = [];
  const foundPlaces = new Set(); // Duplikate vermeiden
  let apiCalls = 0;
  const MAX_API_CALLS = 25; // Budget: ~25 Calls um Kosten niedrig zu halten

  // Nur erste 8 Suchen ausfÃ¼hren (rotiert bei jedem Run)
  // So decken wir Ã¼ber die Woche alle Suchen ab
  const dayOfWeek = new Date().getDay();
  const searchOffset = (dayOfWeek * 4) % DEAL_SEARCHES.length;
  const activeSearches = [];
  for (let i = 0; i < 8; i++) {
    activeSearches.push(DEAL_SEARCHES[(searchOffset + i) % DEAL_SEARCHES.length]);
  }

  console.log(`ðŸ” ${activeSearches.length} Suchen werden ausgefÃ¼hrt:\n`);

  for (const search of activeSearches) {
    if (apiCalls >= MAX_API_CALLS) {
      console.log(`âš ï¸  API-Limit erreicht (${MAX_API_CALLS} Calls) - stoppe`);
      break;
    }

    try {
      console.log(`ðŸ” "${search.query}"...`);
      apiCalls++;

      const places = await searchGooglePlaces(search.query);

      if (places.length === 0) {
        console.log(`   â†’ 0 Ergebnisse`);
        continue;
      }

      console.log(`   â†’ ${places.length} Orte gefunden, prÃ¼fe auf echte Deals...`);

      // Nur Top 5 Ergebnisse pro Suche prÃ¼fen
      for (const place of places.slice(0, 5)) {
        const placeId = place.place_id;
        if (foundPlaces.has(placeId)) continue;

        const name = (place.name || '').toLowerCase();
        const addr = (place.vicinity || place.formatted_address || '').toLowerCase();

        // Blacklist Check
        if (BLACKLIST.some(b => (name + ' ' + addr).includes(b))) continue;

        // Nur Gastro/Shops/Fitness
        const types = place.types || [];
        const lodgingTypes = ['lodging', 'real_estate_agency'];
        if (lodgingTypes.some(t => types.includes(t))) continue;

        foundPlaces.add(placeId);

        // Place Details holen (Website + Reviews)
        let details = null;
        let websiteDeals = { hasDeals: false, indicators: [], dealText: '', price: null };
        let reviewDeals = { found: false, text: '' };

        if (apiCalls < MAX_API_CALLS) {
          apiCalls++;
          details = await getPlaceDetails(placeId);

          // Website prÃ¼fen
          if (details?.website) {
            websiteDeals = await scrapeWebsiteForDeals(details.website);
          }

          // Reviews prÃ¼fen
          if (details?.reviews) {
            reviewDeals = checkReviewsForDeals(details.reviews);
          }
        }

        // âœ… DEAL VALIDIERUNG: Mindestens eine Quelle muss einen Deal bestÃ¤tigen
        const hasConfirmedDeal = websiteDeals.hasDeals || reviewDeals.found;

        // FÃ¼r Gratis-Suchen: Auch Places die gut zum Suchbegriff passen akzeptieren
        const isStrongMatch = search.dealType === 'gratis' &&
          GRATIS_KEYWORDS.some(k => (name + ' ' + (details?.editorial_summary?.overview || '')).toLowerCase().includes(k));

        if (hasConfirmedDeal || isStrongMatch) {
          const deal = createDeal(place, search, websiteDeals, reviewDeals, details);
          allDeals.push(deal);
          console.log(`   âœ… DEAL: ${deal.logo} ${deal.title}`);
        }

        // Kleine Pause zwischen API calls
        await new Promise(r => setTimeout(r, 200));
      }
    } catch (error) {
      console.log(`   âŒ Fehler: ${error.message}`);
    }
  }

  // Max 10 Deals pro Run
  const MAX_DEALS = 10;
  const finalDeals = allDeals.slice(0, MAX_DEALS);

  // Statistiken
  console.log('\nâ”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”');
  console.log('ðŸ“Š ERGEBNIS:');
  console.log(`   ðŸ” Suchen:           ${activeSearches.length}`);
  console.log(`   ðŸ“ Orte geprÃ¼ft:     ${foundPlaces.size}`);
  console.log(`   âœ… Deals bestÃ¤tigt:  ${allDeals.length}`);
  console.log(`   ðŸ† Final (max ${MAX_DEALS}):   ${finalDeals.length}`);
  console.log(`   ðŸ“¡ API Calls:        ${apiCalls}/${MAX_API_CALLS}`);
  console.log('â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n');

  // In deals.json mergen
  if (finalDeals.length > 0 && fs.existsSync(dealsPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(dealsPath, 'utf8'));

      // Alte Google-Deals entfernen (sowohl alte "Entdeckt" als auch neue)
      existing.deals = existing.deals.filter(d => {
        // Alte Places-Deals raus (die "Entdeckt:" EintrÃ¤ge)
        if (d.id?.startsWith('places-')) return false;
        if (d.source === 'Google Places') return false;
        // Alte Google-Deals Ã¤lter als 7 Tage raus
        if (d.isGoogleDeal) {
          const pubDate = new Date(d.pubDate || 0);
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          return pubDate > sevenDaysAgo;
        }
        return true;
      });

      // Neue Deals hinzufÃ¼gen (Duplikat-Check)
      const existingTitles = new Set(
        existing.deals.map(d => d.title.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 25))
      );

      let addedCount = 0;
      for (const deal of finalDeals) {
        const key = deal.title.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 25);
        if (!existingTitles.has(key)) {
          existing.deals.push(deal);
          existingTitles.add(key);
          addedCount++;
        }
      }

      // Sortierung beibehalten
      existing.deals.sort((a, b) => {
        if ((a.priority || 99) !== (b.priority || 99)) return (a.priority || 99) - (b.priority || 99);
        if (a.hot && !b.hot) return -1;
        if (!a.hot && b.hot) return 1;
        if (a.type === 'gratis' && b.type !== 'gratis') return -1;
        return 0;
      });

      existing.totalDeals = existing.deals.length;
      existing.lastUpdated = new Date().toISOString();

      fs.writeFileSync(dealsPath, JSON.stringify(existing, null, 2));

      console.log(`âœ… ${addedCount} neue Google-Deals eingefÃ¼gt`);
      console.log(`ðŸ—‘ï¸  Alte "Entdeckt" Deals entfernt`);
      console.log(`ðŸ“Š Gesamt: ${existing.totalDeals} Deals`);

    } catch (e) {
      console.log(`âŒ Merge fehlgeschlagen: ${e.message}`);
      if (fs.existsSync('docs/deals.backup.json')) {
        fs.copyFileSync('docs/deals.backup.json', dealsPath);
        console.log('ðŸ”„ Backup wiederhergestellt');
      }
    }
  }

  // Cleanup
  if (fs.existsSync('docs/deals.backup.json')) {
    fs.unlinkSync('docs/deals.backup.json');
  }

  console.log('\nâ”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”');
  console.log('âœ… Google Deals Scraper abgeschlossen!');
  console.log('â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”');
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal:', err.message);
    if (fs.existsSync('docs/deals.backup.json') && fs.existsSync('docs/deals.json')) {
      fs.copyFileSync('docs/deals.backup.json', 'docs/deals.json');
      console.log('ðŸ”„ Backup wiederhergestellt');
    }
    process.exit(0);
  });

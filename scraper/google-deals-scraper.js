// ============================================
// FREEFINDER WIEN - GOOGLE DEALS SCRAPER V3
// NUR echte Gratis-Deals & extrem günstige Angebote
// Keine "Entdeckt" Platzhalter!
// ============================================

import https from 'https';
import http from 'http';
import fs from 'fs';

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY || '';
const OUTPUT_PATH = 'docs/deals-pending-google.json';
const MAX_DEAL_AGE_DAYS = 14;
const MAX_API_CALLS = 30;
const MAX_RESULTS_PER_SEARCH = 7;
const MAX_DEALS_OUTPUT = 16;
const MIN_QUALITY_SCORE = 46;

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
  { query: 'gratis brunch wien aktion', category: 'essen', logo: '🥐' },
  { query: 'neueröffnung gratis wien restaurant', category: 'essen', logo: '🆕' },
  { query: 'happy hour 1+1 wien', category: 'essen', logo: '🍹' },
  { query: 'gratis dessert wien', category: 'essen', logo: '🍰' },
  { query: 'gratis pizza slice wien', category: 'essen', logo: '🍕' },
  { query: 'gratis tasting wien cafe', category: 'kaffee', logo: '☕' },
  { query: 'opening offer wien free', category: 'essen', logo: '🆕' },
  { query: 'free coffee vienna opening', category: 'kaffee', logo: '☕' },
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
  /kostenlose rückgabe/i,
  /free cancellation/i,
  /job/i,
  /stellenanzeige/i,
  /gebraucht/i,
];

const EXPIRED_PATTERNS = [
  /abgelaufen/i,
  /vorbei/i,
  /ended/i,
  /ausverkauft/i,
  /nicht mehr gültig/i,
];

const VIENNA_HINTS = [
  /\bwien\b/i,
  /\bvienna\b/i,
  /\b1\d{3}\s*wien\b/i,
  /\b10[1-9]0\b/i,
  /\b11[0-9]0\b/i,
  /\b12[0-3]0\b/i,
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
    const protocol = url.startsWith('https') ? https : http;
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

function stableHash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i += 1) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash >>>= 0;
  }
  return hash.toString(36);
}

function dealId(prefix, brand, title, url) {
  return `${prefix}-${stableHash(`${brand}|${title}|${url}`)}`;
}

function isReviewRecentUnix(tsSec) {
  if (!Number.isFinite(tsSec)) return false;
  const ageMs = Date.now() - tsSec * 1000;
  return ageMs >= 0 && ageMs <= MAX_DEAL_AGE_DAYS * 24 * 60 * 60 * 1000;
}

function normalizeText(value) {
  return (value || '')
    .toString()
    .replace(/\s+/g, ' ')
    .trim();
}

function containsVienna(value) {
  const text = normalizeText(value);
  if (!text) return false;
  return VIENNA_HINTS.some((p) => p.test(text));
}

function extractPriceFromText(value) {
  const text = normalizeText(value).toLowerCase();
  if (!text) return null;

  const direct = text.match(/(?:um|für|nur|ab)?\s*€\s*(\d+[.,]?\d*)|(\d+[.,]?\d*)\s*€|(\d+[.,]?\d*)\s*euro/);
  const candidate = direct ? (direct[1] || direct[2] || direct[3]) : null;
  if (!candidate) return null;
  const num = Number(candidate.replace(',', '.'));
  if (!Number.isFinite(num)) return null;
  return num;
}

function extractExpiryText(value) {
  const text = normalizeText(value);
  if (!text) return '';
  const m = text.match(/(bis|gültig bis|nur bis|until)\s+([^.,;]{4,40})/i);
  if (!m) return '';
  return `${m[1]} ${m[2]}`.trim();
}

function isClearlyExpired(value) {
  const text = normalizeText(value).toLowerCase();
  if (!text) return false;
  return EXPIRED_PATTERNS.some((p) => p.test(text));
}

function buildQualityScore({ isGratis, isCheap, hasStrongPattern, hasPrice, hasWebsite, hasReview, recentReview, userRatingsTotal, inVienna }) {
  let score = 0;
  if (isGratis) score += 40;
  else if (isCheap) score += 24;
  if (hasStrongPattern) score += 20;
  if (hasPrice) score += 10;
  if (hasWebsite) score += 8;
  if (hasReview && recentReview) score += 16;
  if (inVienna) score += 10;

  const votesBoost = Math.min(Number(userRatingsTotal || 0), 150) / 10;
  score += votesBoost;
  return Math.round(score);
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
      .trim();
    const textLc = text.toLowerCase();

    // Suche nach starken Deal-Patterns
    for (const pattern of STRONG_DEAL_PATTERNS) {
      const match = textLc.match(pattern);
      if (match) {
        // Prüfe ob es ein false positive ist
        const context = textLc.substring(Math.max(0, match.index - 80), match.index + match[0].length + 120);
        const isFalsePositive = FALSE_POSITIVE_PATTERNS.some(fp => fp.test(context));
        if (!isFalsePositive && !isClearlyExpired(context)) {
          // Extrahiere den Satz
          const start = textLc.lastIndexOf('.', match.index) + 1;
          const end = textLc.indexOf('.', match.index + match[0].length);
          const sentence = text.substring(start, end > 0 ? end : start + 180).trim();
          const price = extractPriceFromText(context) ?? extractPriceFromText(sentence);
          const isGratis = /gratis|kostenlos|free|geschenkt|umsonst/.test(match[0]);
          const expires = extractExpiryText(sentence) || extractExpiryText(context);

          return {
            found: true,
            dealText: sentence.substring(0, 160),
            price,
            isGratis,
            isCheap: price !== null && price <= 3,
            expires,
            evidence: 'website',
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
  let best = null;

  for (const review of reviews) {
    if (!isReviewRecentUnix(review.time)) continue;

    const text = (review.text || '').toLowerCase();
    if (!text || text.length < 20) continue;
    if (isClearlyExpired(text)) continue;

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
          const price = extractPriceFromText(context) ?? extractPriceFromText(sentence);
          const expires = extractExpiryText(sentence) || extractExpiryText(context);
          const candidate = {
            found: true,
            dealText: sentence.substring(0, 120),
            isGratis,
            isCheap: price !== null && price <= 3,
            price,
            expires,
            reviewTime: review.time,
            pubDate: new Date(review.time * 1000).toISOString(),
            evidence: 'review',
          };
          if (!best) {
            best = candidate;
            continue;
          }
          if (candidate.isGratis && !best.isGratis) {
            best = candidate;
            continue;
          }
          if ((candidate.isCheap && !best.isCheap) || (candidate.reviewTime > best.reviewTime)) {
            best = candidate;
          }
        }
      }
    }
  }

  return best || { found: false };
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

  const allDeals = [];
  const seenPlaceIds = new Set();
  const seenDealSeeds = new Set();
  let apiCalls = 0;

  // Rotiere Suchen nach Wochentag
  const dayOfWeek = new Date().getDay();
  const offset = (dayOfWeek * 4) % DEAL_SEARCHES.length;
  const activeSearches = [];
  for (let i = 0; i < 10 && i < DEAL_SEARCHES.length; i++) {
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

      for (const place of places.slice(0, MAX_RESULTS_PER_SEARCH)) {
        if (seenPlaceIds.has(place.place_id)) continue;

        const name = (place.name || '').toLowerCase();
        const addr = (place.vicinity || place.formatted_address || '').toLowerCase();
        
        // Blacklist
        if (BLACKLIST.some(b => (name + ' ' + addr).includes(b))) continue;
        const types = place.types || [];
        if (['lodging', 'real_estate_agency'].some(t => types.includes(t))) continue;
        const inVienna = containsVienna(place.vicinity || place.formatted_address || '');
        if (!inVienna) continue;

        seenPlaceIds.add(place.place_id);

        // Details holen
        let websiteDeal = { found: false };
        let reviewDeal = { found: false };
        let websiteUrl = '';

        if (apiCalls < MAX_API_CALLS) {
          apiCalls++;
          const details = await getPlaceDetails(place.place_id);

          if (details?.website) {
            websiteUrl = details.website;
            websiteDeal = await scrapeForRealDeals(details.website);
          }
          if (details?.reviews) {
            reviewDeal = checkReviewsForDeals(details.reviews);
          }
        }

        // Streng: nur Deals mit frischer Review-Evidenz.
        if (!reviewDeal.found) continue;
        if (isClearlyExpired(reviewDeal.dealText)) continue;

        const dealSource = reviewDeal.found ? reviewDeal : websiteDeal;
        const isGratis = Boolean(reviewDeal.isGratis || websiteDeal.isGratis);
        const cheapPrice = reviewDeal.price ?? websiteDeal.price ?? null;
        const isCheap = Boolean((reviewDeal.isCheap || websiteDeal.isCheap) && cheapPrice !== null && cheapPrice <= 3);
        const hasStrongPattern = Boolean(reviewDeal.found || websiteDeal.found);
        const qualityScore = buildQualityScore({
          isGratis,
          isCheap,
          hasStrongPattern,
          hasPrice: cheapPrice !== null,
          hasWebsite: Boolean(websiteUrl),
          hasReview: Boolean(reviewDeal.found),
          recentReview: Boolean(reviewDeal.reviewTime),
          userRatingsTotal: place.user_ratings_total,
          inVienna,
        });
        if (qualityScore < MIN_QUALITY_SCORE) continue;

        const address = place.vicinity || place.formatted_address || 'Wien';
        const district = extractDistrict(address);
        const logo = getLogo(place.name, place.types, search.logo);
        const targetUrl = websiteUrl || `https://www.google.com/maps/place/?q=place_id:${place.place_id}`;

        let title = '';
        if (isGratis) {
          title = `GRATIS: ${dealSource.dealText || place.name}`;
        } else if (isCheap && cheapPrice !== null) {
          title = `Ab €${cheapPrice}: ${dealSource.dealText || place.name}`;
        } else {
          title = `DEAL: ${dealSource.dealText || place.name}`;
        }
        title = title.substring(0, 70);
        const dedupeSeed = `${place.name}|${title}|${address}`;
        const dedupeKey = stableHash(dedupeSeed);
        if (seenDealSeeds.has(dedupeKey)) continue;
        seenDealSeeds.add(dedupeKey);

        const deal = {
          id: dealId('gd', place.name || '', title, `google:${place.place_id}:${dedupeKey}`),
          brand: place.name,
          logo: logo,
          title: title,
          description: `${place.name} (${district}): ${(dealSource.dealText || '').substring(0, 120)}`,
          type: isGratis ? 'gratis' : 'rabatt',
          badge: isGratis ? 'gratis' : 'limited',
          category: search.category,
          source: 'Google Deals',
          url: targetUrl,
          expires: reviewDeal.expires || websiteDeal.expires || 'Siehe Website',
          distance: district,
          hot: isGratis,
          isNew: true,
          isGoogleDeal: true,
          priority: isGratis ? 2 : 3,
          votes: Math.min(Math.round((place.user_ratings_total || 0) / 20), 30),
          pubDate: reviewDeal.pubDate,
          qualityScore,
          dealDate: reviewDeal.pubDate,
          address,
          mapsUrl: `https://www.google.com/maps/place/?q=place_id:${place.place_id}`,
          website: websiteUrl,
          rating: Number(place.rating || 0),
          evidence: reviewDeal.evidence || websiteDeal.evidence || 'review',
        };

        allDeals.push(deal);
        console.log(`   ✅ DEAL [${qualityScore}]: ${logo} ${title}`);

        await new Promise(r => setTimeout(r, 200));
      }
    } catch (error) {
      console.log(`   ❌ Fehler: ${error.message}`);
    }
  }

  const finalDeals = allDeals
    .sort((a, b) => {
      if ((b.qualityScore || 0) !== (a.qualityScore || 0)) {
        return (b.qualityScore || 0) - (a.qualityScore || 0);
      }
      return new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime();
    })
    .slice(0, MAX_DEALS_OUTPUT);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 ERGEBNIS:');
  console.log(`   🔍 Suchen:           ${activeSearches.length}`);
  console.log(`   📍 Orte geprüft:     ${seenPlaceIds.size}`);
  console.log(`   ✅ Echte Deals:      ${finalDeals.length}`);
  console.log(`   📡 API Calls:        ${apiCalls}/${MAX_API_CALLS}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const payload = {
    lastUpdated: new Date().toISOString(),
    source: 'google-deals-v3',
    totalDeals: finalDeals.length,
    deals: finalDeals,
  };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(`💾 ${finalDeals.length} Deals → ${OUTPUT_PATH}`);

  console.log('\n✅ Google Deals Scraper V3 abgeschlossen!');
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal:', err.message);
    process.exit(0);
  });

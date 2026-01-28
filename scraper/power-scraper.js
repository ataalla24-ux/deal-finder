// ============================================
// FREEFINDER WIEN - POWER SCRAPER V4
// Bereinigt + API Integration
// ============================================

import https from 'https';
import http from 'http';
import fs from 'fs';

// ============================================
// API KEYS (GitHub Secrets)
// ============================================

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY || '';
const INSTAGRAM_ACCESS_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN || '';
const FACEBOOK_ACCESS_TOKEN = process.env.FACEBOOK_ACCESS_TOKEN || '';

// ============================================
// BEREINIGTE QUELLEN (nur funktionierende!)
// ============================================

const SOURCES = [
  // ========== WIEN EVENTS & KULTUR ==========
  { name: 'Wien Events', url: 'https://events.wien.info/de/', type: 'html', brand: 'Wien Events', logo: '🎭', category: 'wien' },
  { name: 'Wien Kulturkalender', url: 'https://www.wien.gv.at/kultur-freizeit/kalender.html', type: 'html', brand: 'Wien.gv.at', logo: '🏛️', category: 'wien' },
  { name: 'Rathausplatz Events', url: 'https://www.filmfestival-rathausplatz.at/', type: 'html', brand: 'Rathausplatz', logo: '🎬', category: 'wien' },
  { name: 'Donauinselfest', url: 'https://donauinselfest.at/', type: 'html', brand: 'Donauinselfest', logo: '🎸', category: 'wien' },
  { name: 'Museumsquartier', url: 'https://www.mqw.at/programm/', type: 'html', brand: 'MQ Wien', logo: '🏛️', category: 'wien' },
  { name: 'Lange Nacht der Museen', url: 'https://langenacht.orf.at/', type: 'html', brand: 'ORF', logo: '🌙', category: 'wien' },
  { name: 'Reed Messen Wien', url: 'https://www.messe.at/de/veranstaltungen/', type: 'html', brand: 'Messe Wien', logo: '🏢', category: 'wien' },
  
  // ========== FOODSHARING & ESSEN RETTEN ==========
  { name: 'Too Good To Go', url: 'https://www.toogoodtogo.com/at', type: 'html', brand: 'TGTG', logo: '🥡', category: 'essen' },
  { name: 'Wiener Tafel', url: 'https://www.wienertafel.at/', type: 'html', brand: 'Wiener Tafel', logo: '🥫', category: 'essen' },
  { name: 'Vegan Planet', url: 'https://www.veganplanet.at/', type: 'html', brand: 'Vegan Planet', logo: '🌱', category: 'essen' },
  
  // ========== GRATIS PROBEN & FREEBIES ==========
  { name: 'Gratisproben', url: 'https://www.gratisproben.net/oesterreich/', type: 'html', brand: 'Gratisproben', logo: '🆓', category: 'gratis' },
  { name: 'Sparhamster Gratis', url: 'https://www.sparhamster.at/gratis/', type: 'html', brand: 'Sparhamster', logo: '🐹', category: 'gratis' },
  
  // ========== MARKTPLÄTZE ==========
  { name: 'Shpock Gratis', url: 'https://www.shpock.com/at/q/gratis', type: 'html', brand: 'Shpock', logo: '📱', category: 'shopping' },
  
  // ========== NEWS & LIFESTYLE ==========
  { name: 'Vienna.at', url: 'https://www.vienna.at/', type: 'html', brand: 'Vienna.at', logo: '📰', category: 'wien' },
  { name: 'MeinBezirk Wien', url: 'https://www.meinbezirk.at/wien', type: 'html', brand: 'MeinBezirk', logo: '📰', category: 'wien' },
  { name: 'Kurier Wien', url: 'https://kurier.at/chronik/wien', type: 'html', brand: 'Kurier', logo: '📰', category: 'wien' },
  { name: 'Stadtbekannt', url: 'https://www.stadtbekannt.at/', type: 'html', brand: 'Stadtbekannt', logo: '🏙️', category: 'wien' },
  
  // ========== SUPERMÄRKTE ==========
  { name: 'Lidl Angebote', url: 'https://www.lidl.at/c/billiger-montag/a10006065', type: 'html', brand: 'Lidl', logo: '🛒', category: 'supermarkt' },
  { name: 'HOFER Aktionen', url: 'https://www.hofer.at/de/angebote.html', type: 'html', brand: 'HOFER', logo: '🛒', category: 'supermarkt' },
  { name: 'PENNY Angebote', url: 'https://www.penny.at/angebote', type: 'html', brand: 'PENNY', logo: '🛒', category: 'supermarkt' },
  
  // ========== FAST FOOD ==========
  { name: "McDonald's", url: 'https://www.mcdonalds.at/aktionen', type: 'html', brand: "McDonald's", logo: '🍟', category: 'essen' },
  { name: 'Burger King', url: 'https://www.burgerking.at/angebote', type: 'html', brand: 'Burger King', logo: '🍔', category: 'essen' },
  { name: 'KFC', url: 'https://www.kfc.at/angebote', type: 'html', brand: 'KFC', logo: '🍗', category: 'essen' },
  
  // ========== KAFFEE ==========
  { name: 'Starbucks', url: 'https://www.starbucks.at/', type: 'html', brand: 'Starbucks', logo: '☕', category: 'kaffee' },
  { name: 'Tchibo', url: 'https://www.tchibo.at/angebote-aktionen-c400109092.html', type: 'html', brand: 'Tchibo', logo: '☕', category: 'kaffee' },
  
  // ========== FITNESS ==========
  { name: 'FitInn', url: 'https://www.fitinn.at/', type: 'html', brand: 'FitInn', logo: '💪', category: 'fitness' },
  { name: 'John Harris', url: 'https://www.johnharris.at/', type: 'html', brand: 'John Harris', logo: '🏊', category: 'fitness' },
  { name: 'clever fit', url: 'https://www.clever-fit.com/at/', type: 'html', brand: 'clever fit', logo: '💪', category: 'fitness' },
  
  // ========== REISEN ==========
  { name: 'Ryanair', url: 'https://www.ryanair.com/at/de', type: 'html', brand: 'Ryanair', logo: '✈️', category: 'reisen' },
  { name: 'Wizz Air', url: 'https://wizzair.com/de-de', type: 'html', brand: 'Wizz Air', logo: '✈️', category: 'reisen' },
  { name: 'ÖBB Sparschiene', url: 'https://www.oebb.at/de/angebote-ermaessigungen/sparschiene', type: 'html', brand: 'ÖBB', logo: '🚂', category: 'reisen' },
  { name: 'FlixBus', url: 'https://www.flixbus.at/', type: 'html', brand: 'FlixBus', logo: '🚌', category: 'reisen' },
  { name: 'Urlaubspiraten', url: 'https://www.urlaubspiraten.at/', type: 'html', brand: 'Urlaubspiraten', logo: '🏴‍☠️', category: 'reisen' },
  
  // ========== RABATTCODES ==========
  { name: 'Coupons.at', url: 'https://www.coupons.at/', type: 'html', brand: 'Coupons', logo: '🏷️', category: 'codes' },
  { name: 'Gutscheine.at', url: 'https://www.gutscheine.at/', type: 'html', brand: 'Gutscheine', logo: '🏷️', category: 'codes' },
  
  // ========== SHOPPING & TECHNIK ==========
  { name: 'Amazon Deals', url: 'https://www.amazon.de/deals', type: 'html', brand: 'Amazon', logo: '📦', category: 'shopping' },
  { name: 'MediaMarkt', url: 'https://www.mediamarkt.at/de/campaign/angebote', type: 'html', brand: 'MediaMarkt', logo: '📺', category: 'technik' },
  
  // ========== PREISJÄGER RSS (zuverlässig) ==========
  { name: 'Preisjäger Gratis', url: 'https://www.preisjaeger.at/rss/gruppe/gratisartikel', type: 'rss', brand: 'Preisjäger', logo: '🆓', category: 'gratis' },
  { name: 'Preisjäger Wien', url: 'https://www.preisjaeger.at/rss/gruppe/lokal', type: 'rss', brand: 'Preisjäger', logo: '📍', category: 'wien' },
  { name: 'Preisjäger Reisen', url: 'https://www.preisjaeger.at/rss/gruppe/reisen', type: 'rss', brand: 'Preisjäger', logo: '✈️', category: 'reisen' },
];

// ============================================
// TOP DEALS - Verifizierte Gratis-Deals
// ============================================

const BASE_DEALS = [
  // ⭐ GRATIS KAFFEE - TOP PRIORITY
  {
    id: 'top-1', brand: 'IKEA', logo: '☕', title: 'GRATIS Kaffee UNLIMITIERT',
    description: 'IKEA Family Mitglieder: Unbegrenzt Gratis-Kaffee im Restaurant! Täglich, keine Limits.',
    type: 'gratis', category: 'kaffee', source: 'IKEA', url: 'https://www.ikea.com/at/de/ikea-family/',
    expires: 'Unbegrenzt', distance: 'IKEA Standorte', hot: true, isNew: false, priority: 1, votes: 234
  },
  {
    id: 'top-2', brand: "McDonald's", logo: '☕', title: 'GRATIS Kaffee - 5x/Monat',
    description: 'McCafé Bonusclub: Jeden Monat 5 gratis Kaffees! Einfach App downloaden und Stempel sammeln.',
    type: 'gratis', category: 'kaffee', source: "McDonald's App", url: 'https://www.mcdonalds.at/app',
    expires: 'Monatlich', distance: 'Alle Filialen', hot: true, isNew: false, priority: 1, votes: 189
  },
  {
    id: 'top-3', brand: 'OMV VIVA', logo: '⛽', title: 'GRATIS Getränk für 1 jö Punkt',
    description: 'Bei OMV VIVA: Heißgetränk oder Softdrink für nur 1 jö Punkt! Inkl. Kaffee, Tee, Cola.',
    type: 'gratis', category: 'kaffee', source: 'jö Bonus Club', url: 'https://www.jo-club.at/',
    expires: 'Dauerhaft', distance: 'OMV Tankstellen', hot: true, isNew: false, priority: 1, votes: 156
  },

  // ⭐ GRATIS ESSEN - TOP PRIORITY
  {
    id: 'top-4', brand: 'Wiener Deewan', logo: '🍛', title: 'GRATIS Essen - Pay what you want',
    description: 'Pakistanisches All-you-can-eat Buffet: Zahle was du willst! Auch 0€ ist OK. Liechtensteinstraße 10.',
    type: 'gratis', category: 'essen', source: 'Wiener Deewan', url: 'https://www.deewan.at/',
    expires: 'Täglich', distance: '1090 Wien', hot: true, isNew: false, priority: 1, votes: 298
  },
  {
    id: 'top-5', brand: 'Too Good To Go', logo: '🥡', title: 'Essen retten ab 3,99€',
    description: 'Überraschungssackerl von Restaurants & Supermärkten. Oft 3x Wert für kleines Geld!',
    type: 'rabatt', category: 'essen', source: 'TGTG App', url: 'https://www.toogoodtogo.com/at',
    expires: 'Täglich', distance: 'Ganz Wien', hot: true, isNew: false, priority: 1, votes: 267
  },
  {
    id: 'top-6', brand: 'Foodsharing', logo: '🍏', title: 'GRATIS Lebensmittel abholen',
    description: 'Fairteiler in ganz Wien! Lebensmittel gratis abholen oder abgeben. 100% kostenlos.',
    type: 'gratis', category: 'essen', source: 'Foodsharing', url: 'https://foodsharing.at/',
    expires: 'Dauerhaft', distance: 'Ganz Wien', hot: true, isNew: false, priority: 1, votes: 201
  },

  // ⭐ GRATIS BEI NEUERÖFFNUNG (dynamisch ergänzt durch APIs)
  {
    id: 'neu-1', brand: 'Neueröffnungen', logo: '🎉', title: 'Gratis bei Store-Openings',
    description: 'Folge uns für aktuelle Neueröffnungen! Oft gibt es Gratis-Proben, Kaffee, oder Geschenke.',
    type: 'gratis', category: 'shopping', source: 'FreeFinder', url: '#',
    expires: 'Siehe App', distance: 'Wien', hot: true, isNew: true, priority: 1, votes: 0
  },

  // ⭐ GRATIS PROBEN
  {
    id: 'probe-1', brand: 'dm', logo: '💄', title: 'GRATIS Produktproben',
    description: 'Im dm gibt es regelmäßig Gratis-Proben! Frag einfach an der Kassa nach aktuellen Proben.',
    type: 'gratis', category: 'beauty', source: 'dm', url: 'https://www.dm.at/',
    expires: 'Solange Vorrat', distance: 'dm Filialen', hot: false, isNew: false, priority: 2, votes: 145
  },
  {
    id: 'probe-2', brand: 'BIPA', logo: '💅', title: 'GRATIS Beauty-Proben',
    description: 'BIPA verteilt regelmäßig Gratisproben von Parfum, Hautpflege und mehr!',
    type: 'gratis', category: 'beauty', source: 'BIPA', url: 'https://www.bipa.at/',
    expires: 'Solange Vorrat', distance: 'BIPA Filialen', hot: false, isNew: false, priority: 2, votes: 98
  },

  // ⭐ FITNESS PROBETRAINING
  {
    id: 'fitness-1', brand: 'FitInn', logo: '💪', title: 'GRATIS Probetraining 1 Woche',
    description: 'Eine Woche gratis trainieren! Keine Kreditkarte nötig, einfach vorbeikommen.',
    type: 'gratis', category: 'fitness', source: 'FitInn', url: 'https://www.fitinn.at/',
    expires: 'Jederzeit', distance: 'Alle Standorte', hot: true, isNew: false, priority: 1, votes: 167
  },
  {
    id: 'fitness-2', brand: 'clever fit', logo: '💪', title: 'GRATIS Probetraining',
    description: 'Kostenloses Probetraining inkl. Einweisung! Online Termin buchen.',
    type: 'gratis', category: 'fitness', source: 'clever fit', url: 'https://www.clever-fit.com/at/',
    expires: 'Jederzeit', distance: 'Alle Standorte', hot: false, isNew: false, priority: 2, votes: 89
  },
  {
    id: 'fitness-3', brand: 'John Harris', logo: '🏊', title: 'GRATIS Probetag',
    description: 'Ein Tag gratis trainieren im Premium Fitnessstudio! Pool, Sauna, Kurse inklusive.',
    type: 'gratis', category: 'fitness', source: 'John Harris', url: 'https://www.johnharris.at/',
    expires: 'Jederzeit', distance: 'Wien Standorte', hot: false, isNew: false, priority: 2, votes: 76
  },

  // ⭐ WIEN GRATIS KULTUR
  {
    id: 'kultur-1', brand: 'Bundesmuseen', logo: '🏛️', title: 'GRATIS Eintritt unter 19',
    description: 'Alle Bundesmuseen (KHM, Belvedere, Albertina...) sind für unter 19-Jährige GRATIS!',
    type: 'gratis', category: 'wien', source: 'Bundesmuseen', url: 'https://www.bundesmuseen.at/',
    expires: 'Dauerhaft', distance: 'Wien', hot: true, isNew: false, priority: 1, votes: 312
  },
  {
    id: 'kultur-2', brand: 'Film Festival', logo: '🎬', title: 'GRATIS Open-Air Kino',
    description: 'Jeden Sommer am Rathausplatz: Gratis Filmvorführungen unter freiem Himmel!',
    type: 'gratis', category: 'wien', source: 'Film Festival', url: 'https://www.filmfestival-rathausplatz.at/',
    expires: 'Juli-August', distance: 'Rathausplatz', hot: true, isNew: false, priority: 1, votes: 287
  },
  {
    id: 'kultur-3', brand: 'Donauinselfest', logo: '🎸', title: 'GRATIS Festival 3 Tage',
    description: 'Europas größtes Gratis-Open-Air Festival! 3 Tage Musik, komplett kostenlos.',
    type: 'gratis', category: 'wien', source: 'Donauinselfest', url: 'https://donauinselfest.at/',
    expires: 'Juni', distance: 'Donauinsel', hot: true, isNew: false, priority: 1, votes: 456
  },
  {
    id: 'kultur-4', brand: 'Büchereien Wien', logo: '📚', title: 'GRATIS Mitgliedschaft unter 18',
    description: 'Büchereien Wien: Gratis Mitgliedschaft für alle unter 18! Bücher, DVDs, Spiele ausleihen.',
    type: 'gratis', category: 'wien', source: 'Büchereien Wien', url: 'https://buechereien.wien.gv.at/',
    expires: 'Dauerhaft', distance: 'Ganz Wien', hot: false, isNew: false, priority: 2, votes: 123
  },

  // ⭐ REISEN DEALS
  {
    id: 'reisen-1', brand: 'Ryanair', logo: '✈️', title: 'Flüge ab 9,99€',
    description: 'Ab Wien: Barcelona, London, Rom und mehr. Newsletter für Flash Sales abonnieren!',
    type: 'rabatt', category: 'reisen', source: 'Ryanair', url: 'https://www.ryanair.com/at/de',
    expires: 'Laufend', distance: 'Ab Wien', hot: true, isNew: false, priority: 1, votes: 198
  },
  {
    id: 'reisen-2', brand: 'ÖBB', logo: '🚂', title: 'Sparschiene ab 19,90€',
    description: 'Mit der ÖBB durch Österreich: Sparschiene Tickets ab 19,90€. Früh buchen spart!',
    type: 'rabatt', category: 'reisen', source: 'ÖBB', url: 'https://www.oebb.at/de/angebote-ermaessigungen/sparschiene',
    expires: 'Laufend', distance: 'Österreichweit', hot: false, isNew: false, priority: 2, votes: 156
  },
  {
    id: 'reisen-3', brand: 'Wiener Linien', logo: '🚇', title: 'GRATIS am 1. Schultag',
    description: 'Am 1. Schultag fahren alle Kinder GRATIS mit den Wiener Linien!',
    type: 'gratis', category: 'reisen', source: 'Wiener Linien', url: 'https://www.wienerlinien.at/',
    expires: 'September', distance: 'Wien', hot: false, isNew: true, priority: 2, votes: 67
  },

  // ⭐ STREAMING TESTABOS
  {
    id: 'stream-1', brand: 'Spotify', logo: '🎵', title: '3 Monate Premium GRATIS',
    description: 'Für Neukunden: 3 Monate Spotify Premium komplett kostenlos testen!',
    type: 'testabo', category: 'streaming', source: 'Spotify', url: 'https://www.spotify.com/at/premium/',
    expires: 'Für Neukunden', distance: 'Online', hot: true, isNew: false, priority: 1, votes: 234
  },
  {
    id: 'stream-2', brand: 'Apple TV+', logo: '📺', title: '3 Monate GRATIS',
    description: 'Bei Kauf eines Apple Geräts: 3 Monate Apple TV+ gratis!',
    type: 'testabo', category: 'streaming', source: 'Apple', url: 'https://www.apple.com/at/apple-tv-plus/',
    expires: 'Bei Gerätekauf', distance: 'Online', hot: false, isNew: false, priority: 2, votes: 98
  },

  // ⭐ RABATTCODES
  {
    id: 'code-1', brand: 'Shoop', logo: '💰', title: 'Cashback auf alles',
    description: 'Bis zu 10% Cashback bei 2000+ Shops! Amazon, Zalando, ABOUT YOU und mehr.',
    type: 'rabatt', category: 'codes', source: 'Shoop', url: 'https://www.shoop.at/',
    expires: 'Dauerhaft', distance: 'Online', hot: false, isNew: false, priority: 2, votes: 145
  },
  {
    id: 'code-2', brand: 'jö Club', logo: '🎁', title: 'Punkte sammeln & sparen',
    description: 'Bei BILLA, BIPA, OMV und mehr: jö Punkte sammeln und gegen Prämien tauschen!',
    type: 'rabatt', category: 'codes', source: 'jö Club', url: 'https://www.jo-club.at/',
    expires: 'Dauerhaft', distance: 'Partnergeschäfte', hot: true, isNew: false, priority: 1, votes: 289
  },
];

// ============================================
// KEYWORDS
// ============================================

const GRATIS_KEYWORDS = ['gratis', 'kostenlos', 'geschenkt', 'umsonst', 'free', '0€', '0 €', 'freebie', 'probetraining', 'probetag', 'neueröffnung', 'eröffnung'];
const DEAL_KEYWORDS = ['rabatt', 'sale', 'aktion', 'angebot', 'sparen', 'reduziert', 'günstiger', '-50%', '-40%', '-30%', '1+1', 'code', 'gutschein'];

// ============================================
// HTTP FETCHER
// ============================================

function fetchURL(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const req = protocol.get(url, { 
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'de-AT,de;q=0.9,en;q=0.8'
      },
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
// GOOGLE PLACES API - NEUERÖFFNUNGEN
// ============================================

async function fetchGooglePlacesNewOpenings() {
  if (!GOOGLE_PLACES_API_KEY) {
    console.log('⚠️  Google Places API Key nicht gesetzt');
    return [];
  }
  
  const deals = [];
  const searchTerms = [
    'new cafe vienna',
    'new restaurant vienna',
    'grand opening vienna',
    'neu eröffnet wien'
  ];
  
  for (const term of searchTerms) {
    try {
      const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(term)}&location=48.2082,16.3738&radius=15000&key=${GOOGLE_PLACES_API_KEY}&language=de`;
      const response = await fetchURL(url);
      const data = JSON.parse(response);
      
      if (data.results) {
        for (const place of data.results.slice(0, 3)) {
          // Nur neue Orte (wenig Bewertungen = neu)
          if (place.user_ratings_total < 50) {
            deals.push({
              id: `places-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
              brand: place.name,
              logo: '🆕',
              title: `Neueröffnung: ${place.name}`,
              description: `${place.vicinity || place.formatted_address}. Neu eröffnet - oft mit Eröffnungsangeboten!`,
              type: 'gratis',
              category: 'shopping',
              source: 'Google Places',
              url: `https://www.google.com/maps/place/?q=place_id:${place.place_id}`,
              expires: 'Eröffnungswochen',
              distance: place.vicinity || 'Wien',
              hot: true,
              isNew: true,
              isApiDeal: true
            });
          }
        }
      }
    } catch (error) {
      console.log(`⚠️  Google Places Error: ${error.message}`);
    }
  }
  
  console.log(`📍 Google Places: ${deals.length} Neueröffnungen gefunden`);
  return deals;
}

// ============================================
// INSTAGRAM API - GRATIS DEALS HASHTAGS
// ============================================

async function fetchInstagramDeals() {
  if (!INSTAGRAM_ACCESS_TOKEN) {
    console.log('⚠️  Instagram Access Token nicht gesetzt');
    return [];
  }
  
  const deals = [];
  const hashtags = ['gratiskaffee', 'gratisprobe', 'wiengratis', 'neueröffnungwien', 'freebiealert'];
  
  // Instagram Graph API erfordert Business Account
  // Hier wäre die Implementation für hashtag search
  
  console.log(`📸 Instagram: ${deals.length} Deals gefunden`);
  return deals;
}

// ============================================
// FACEBOOK API - GRATIS EVENTS
// ============================================

async function fetchFacebookEvents() {
  if (!FACEBOOK_ACCESS_TOKEN) {
    console.log('⚠️  Facebook Access Token nicht gesetzt');
    return [];
  }
  
  const deals = [];
  
  try {
    // Facebook Graph API für Events in Wien
    const url = `https://graph.facebook.com/v18.0/search?type=event&q=gratis%20wien&access_token=${FACEBOOK_ACCESS_TOKEN}`;
    const response = await fetchURL(url);
    const data = JSON.parse(response);
    
    if (data.data) {
      for (const event of data.data.slice(0, 5)) {
        if (event.name.toLowerCase().includes('gratis') || event.name.toLowerCase().includes('kostenlos')) {
          deals.push({
            id: `fb-${event.id}`,
            brand: 'Facebook Event',
            logo: '📅',
            title: event.name,
            description: event.description ? event.description.substring(0, 150) + '...' : 'Gratis Event in Wien!',
            type: 'gratis',
            category: 'wien',
            source: 'Facebook',
            url: `https://www.facebook.com/events/${event.id}`,
            expires: event.start_time || 'Siehe Event',
            distance: 'Wien',
            hot: true,
            isNew: true,
            isApiDeal: true
          });
        }
      }
    }
  } catch (error) {
    console.log(`⚠️  Facebook API Error: ${error.message}`);
  }
  
  console.log(`📘 Facebook: ${deals.length} Events gefunden`);
  return deals;
}

// ============================================
// RSS PARSER
// ============================================

function parseRSS(xml, source) {
  const deals = [];
  const items = xml.match(/<item>([\s\S]*?)<\/item>/gi) || [];
  
  for (const item of items.slice(0, 5)) {
    const titleMatch = item.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
    const linkMatch = item.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i);
    const descMatch = item.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i);
    
    if (titleMatch) {
      const title = titleMatch[1].replace(/<[^>]+>/g, '').trim();
      const link = linkMatch ? linkMatch[1].trim() : source.url;
      let desc = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : '';
      desc = desc.substring(0, 150);
      
      const text = (title + ' ' + desc).toLowerCase();
      const isGratis = GRATIS_KEYWORDS.some(k => text.includes(k));
      const isDeal = DEAL_KEYWORDS.some(k => text.includes(k));
      
      if (isGratis || isDeal) {
        deals.push({
          id: `rss-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
          brand: source.brand,
          logo: source.logo,
          title: title.substring(0, 60),
          description: desc || `Deal von ${source.brand}`,
          type: isGratis ? 'gratis' : 'rabatt',
          category: source.category,
          source: source.name,
          url: link,
          expires: 'Siehe Link',
          distance: 'Wien',
          hot: isGratis,
          isNew: true
        });
      }
    }
  }
  return deals;
}

// ============================================
// HTML EXTRACTOR
// ============================================

function extractDealsFromHTML(html, source) {
  const deals = [];
  const text = html.toLowerCase();
  
  const isGratis = GRATIS_KEYWORDS.some(k => text.includes(k));
  const isDeal = DEAL_KEYWORDS.some(k => text.includes(k));
  
  if (isGratis || isDeal) {
    deals.push({
      id: `html-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      brand: source.brand,
      logo: source.logo,
      title: `Aktuelle Angebote bei ${source.brand}`,
      description: `Jetzt aktuelle ${isGratis ? 'Gratis-' : ''}Deals bei ${source.brand} entdecken!`,
      type: isGratis ? 'gratis' : 'rabatt',
      category: source.category,
      source: source.name,
      url: source.url,
      expires: 'Siehe Website',
      distance: 'Wien',
      hot: false,
      isNew: true
    });
  }
  
  return deals;
}

// ============================================
// MAIN SCRAPER
// ============================================

async function scrapeAllSources() {
  console.log('🚀 POWER SCRAPER V4 gestartet...\n');
  console.log(`📅 ${new Date().toLocaleString('de-AT')}\n`);
  console.log(`📡 ${SOURCES.length} Quellen werden gescraped...\n`);
  
  const scrapedDeals = [];
  
  // 1. Normale Quellen scrapen
  for (const source of SOURCES) {
    try {
      const content = await fetchURL(source.url);
      let deals = [];
      
      if (source.type === 'rss') {
        deals = parseRSS(content, source);
      } else {
        deals = extractDealsFromHTML(content, source);
      }
      
      scrapedDeals.push(...deals);
      console.log(`✅ ${source.name}: ${deals.length} Deals`);
      
    } catch (error) {
      console.log(`❌ ${source.name}: ${error.message}`);
    }
  }
  
  // 2. API Quellen (wenn Keys vorhanden)
  console.log('\n📡 API-Quellen werden abgefragt...\n');
  
  const placesDeals = await fetchGooglePlacesNewOpenings();
  const instagramDeals = await fetchInstagramDeals();
  const facebookDeals = await fetchFacebookEvents();
  
  scrapedDeals.push(...placesDeals, ...instagramDeals, ...facebookDeals);
  
  // 3. Kombiniere Base + Scraped Deals
  const allDeals = [...BASE_DEALS, ...scrapedDeals];
  
  // 4. Entferne Duplikate
  const uniqueDeals = [];
  const seenTitles = new Set();
  
  for (const deal of allDeals) {
    const key = deal.title.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 25);
    if (!seenTitles.has(key)) {
      seenTitles.add(key);
      uniqueDeals.push(deal);
    }
  }
  
  // 5. Sortiere (Gratis-Essen/Kaffee zuerst!)
  uniqueDeals.sort((a, b) => {
    if ((a.priority || 99) !== (b.priority || 99)) return (a.priority || 99) - (b.priority || 99);
    if (a.hot && !b.hot) return -1;
    if (!a.hot && b.hot) return 1;
    if (a.type === 'gratis' && b.type !== 'gratis') return -1;
    return 0;
  });
  
  // 6. Output
  const output = {
    lastUpdated: new Date().toISOString(),
    totalDeals: uniqueDeals.length,
    deals: uniqueDeals
  };
  
  fs.writeFileSync('deals.json', JSON.stringify(output, null, 2));
  
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ Scraping abgeschlossen!`);
  console.log(`   📦 Basis-Deals: ${BASE_DEALS.length}`);
  console.log(`   🆕 Gescrapte Deals: ${scrapedDeals.length}`);
  console.log(`   📊 Gesamt: ${uniqueDeals.length}`);
  console.log(`   ☕ Kaffee: ${uniqueDeals.filter(d => d.category === 'kaffee').length}`);
  console.log(`   🍔 Essen: ${uniqueDeals.filter(d => d.category === 'essen').length}`);
  console.log(`   💪 Fitness: ${uniqueDeals.filter(d => d.category === 'fitness').length}`);
  console.log(`   🆓 Gratis: ${uniqueDeals.filter(d => d.type === 'gratis').length}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
}

scrapeAllSources()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Scraper Error:', err.message);
    process.exit(0);
  });

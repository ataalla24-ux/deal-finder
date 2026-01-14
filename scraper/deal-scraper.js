// deal-scraper-live.js
// Scraped echte österreichische Quellen für aktuelle Deals
// Läuft alle 2 Stunden via GitHub Actions

const https = require('https');
const http = require('http');
const fs = require('fs');

// ============================================
// QUELLEN - Echte österreichische Websites
// ============================================

const SOURCES = [
  {
    name: 'BILLA Aktionen',
    url: 'https://www.billa.at/unsere-aktionen/aktionen',
    type: 'html',
    brand: 'BILLA',
    logo: '🟠',
    category: 'supermarkt'
  },
  {
    name: 'Lidl Angebote',
    url: 'https://www.lidl.at/c/billiger-montag/a10039437',
    type: 'html',
    brand: 'Lidl',
    logo: '🔵',
    category: 'supermarkt'
  },
  {
    name: 'SPAR Aktionen',
    url: 'https://www.spar.at/angebote',
    type: 'html',
    brand: 'SPAR',
    logo: '🟢',
    category: 'supermarkt'
  },
  {
    name: 'HOFER Aktionen',
    url: 'https://www.hofer.at/de/angebote.html',
    type: 'html',
    brand: 'HOFER',
    logo: '🔴',
    category: 'supermarkt'
  },
  {
    name: 'OMV Aktionen',
    url: 'https://www.omv.at/de',
    type: 'html',
    brand: 'OMV',
    logo: '⛽',
    category: 'kaffee'
  },
  {
    name: 'McDonald\'s Österreich',
    url: 'https://www.mcdonalds.at/produkte/aktionen',
    type: 'html',
    brand: "McDonald's",
    logo: '🍟',
    category: 'essen'
  },
  {
    name: 'dm Angebote',
    url: 'https://www.dm.at/angebote',
    type: 'html',
    brand: 'dm',
    logo: '🧴',
    category: 'drogerie'
  },
  {
    name: 'BIPA Aktionen',
    url: 'https://www.bipa.at/aktionen',
    type: 'html',
    brand: 'BIPA',
    logo: '💄',
    category: 'drogerie'
  },
  {
    name: 'MediaMarkt Angebote',
    url: 'https://www.mediamarkt.at/de/campaign/angebote.html',
    type: 'html',
    brand: 'MediaMarkt',
    logo: '📺',
    category: 'tech'
  },
  // RSS Feeds (einfacher zu parsen)
  {
    name: 'Preisjäger',
    url: 'https://www.preisjaeger.at/rss/freebies',
    type: 'rss',
    brand: 'Preisjäger',
    logo: '🎁',
    category: 'gratis'
  },
  {
    name: 'Preisjäger Gratis',
    url: 'https://www.preisjaeger.at/rss/freebies?keywords=gratis',
    type: 'rss',
    brand: 'Preisjäger',
    logo: '🆓',
    category: 'gratis'
  },
  // WIEN NEWS & NEUERÖFFNUNGEN
  {
    name: 'Reddit Wien',
    url: 'https://www.reddit.com/r/wien/.rss',
    type: 'rss',
    brand: 'Reddit r/wien',
    logo: '🔴',
    category: 'wien'
  },
  {
    name: 'Reddit Austria',
    url: 'https://www.reddit.com/r/Austria/.rss',
    type: 'rss',
    brand: 'Reddit r/Austria',
    logo: '🔴',
    category: 'shopping'
  }
];

// ============================================
// BASIS DEALS - Immer verfügbar
// ============================================

const BASE_DEALS = [
  // ========== NEU ENTDECKT - JÄNNER 2026 ==========
  { id: "new-1", brand: "Haus der Geschichte", logo: "🏛️", title: "Gratis jeden Donnerstag 18-20 Uhr", description: "Ab 2026 jeden Donnerstagabend kostenloser Eintritt ins hdgö! Gesponsert von UNIQA.", type: "gratis", category: "wien", source: "hdgö", url: "https://www.hdgoe.at", expires: "Jeden Donnerstag", hot: true, isNew: true },
  { id: "new-2", brand: "ÖBB Veganuary", logo: "🚂", title: "Vegan Vurstsemmel um €2,90", description: "Im Jänner: Vegane 'Feiner Extra' Vurstsemmel im Zug + Gewinnspiele mit Klimaticket!", type: "rabatt", category: "essen", source: "ÖBB", url: "https://www.oebb.at", expires: "Jänner 2026", hot: true, isNew: true },
  { id: "new-3", brand: "Veganer Würstelstand", logo: "🌭", title: "Wiener Würstelstand komplett vegan", description: "Mike Lanner stellt seine 2 Würstelstände im Jänner komplett auf pflanzlich um!", type: "rabatt", category: "essen", source: "Veganuary Wien", url: "https://www.1000things.at", expires: "Jänner 2026", hot: true, isNew: true },
  { id: "new-4", brand: "IKEA", logo: "🪑", title: "Neue Flexbullar Bällchen", description: "Neu im Veganuary: Flexbullar - Mischung aus Fleisch und pflanzlich im IKEA Restaurant.", type: "rabatt", category: "essen", source: "IKEA", url: "https://www.ikea.at", expires: "Jänner 2026", hot: false, isNew: true },
  { id: "new-5", brand: "Vegane Gesellschaft", logo: "🥗", title: "Gratis Gewinnspiel Veganuary", description: "Jede vegane Speise in Wiener Gastro fotografieren & einreichen = Gewinnchance!", type: "gratis", category: "essen", source: "Vegane Gesellschaft", url: "https://www.vegan.at", expires: "Jänner 2026", hot: true, isNew: true },
  { id: "new-6", brand: "Verein MUT", logo: "🥫", title: "Gratis Lebensmittel", description: "Gerettete Lebensmittel kostenlos im 4. Bezirk. Mo, Di, Do, Fr 10-15:30 Uhr mit MUT-Karte.", type: "gratis", category: "supermarkt", source: "Verein MUT", url: "https://verein-mut.eu", expires: "Unbegrenzt", hot: true, isNew: true },
  { id: "new-7", brand: "Gastro.News", logo: "🍽️", title: "Wintergenusswoche", description: "Restaurant-Deals & Kostproben vom 2.-8.2.2026 in vielen Wiener Lokalen.", type: "rabatt", category: "essen", source: "Gastro.News", url: "https://www.gastro.news/deals", expires: "Februar 2026", hot: false, isNew: true },
  { id: "new-8", brand: "Kübey", logo: "🥙", title: "Neueröffnung Anatolische Tapas", description: "Neues Restaurant mit anatolischen Tapas - Soft Opening Aktionen!", type: "rabatt", category: "essen", source: "Falter", url: "https://www.falter.at", expires: "Jänner 2026", hot: false, isNew: true },
  { id: "new-9", brand: "Ciao Ragazzi", logo: "🍕", title: "Neapolitanische Pizza Seestadt", description: "Neue authentische Pizza in der Seestadt - 48h gereifter Teig, 500°C Ofen!", type: "rabatt", category: "essen", source: "1000things", url: "https://www.1000things.at", expires: "Neu eröffnet", hot: false, isNew: true },
  { id: "new-10", brand: "Lanz Lamian", logo: "🍜", title: "Handgezogene Nudeln im 1. Bezirk", description: "Neues Lokal mit traditionellen chinesischen Lanzhou Nudeln - echtes Soulfood!", type: "rabatt", category: "essen", source: "Falter", url: "https://www.falter.at", expires: "Neu eröffnet", hot: false, isNew: true },
  { id: "new-11", brand: "Hong Kong Cafe", logo: "🥡", title: "Günstiges Hong Kong Soulfood", description: "Neues Café mit günstigem Essen wie in den Cha Chaan Tengs - viele vegane Optionen!", type: "rabatt", category: "essen", source: "Falter", url: "https://www.falter.at", expires: "Neu eröffnet", hot: false, isNew: true },
  { id: "new-12", brand: "Krawall Bar", logo: "🍸", title: "Neue Bar in Neubau", description: "3 Stockwerke: Deli für Sandwiches, Cocktailbar, Separee - neu in der Zollergasse!", type: "rabatt", category: "essen", source: "Falter", url: "https://www.falter.at", expires: "Neu eröffnet", hot: false, isNew: true },

  // ========== JÖ BONUS CLUB ==========
  { id: "joe-1", brand: "jö Bonus Club", logo: "🟡", title: "50% auf OMV VIVA Kaffee", description: "Mit 75 Ös 50% auf alle Kaffeespezialitäten bei OMV VIVA.", type: "rabatt", category: "kaffee", source: "jö App", url: "https://www.joe-club.at", expires: "Unbegrenzt", hot: true },
  { id: "joe-2", brand: "jö Bonus Club", logo: "🟡", title: "OMV VIVA Winterdrink für 1 Ö", description: "Cinnamon Pumpkin Latte oder Blushed Toffee Latte für nur 1 Ö!", type: "gratis", category: "kaffee", source: "jö App", url: "https://www.joe-club.at", expires: "Winter 2026", hot: true },
  { id: "joe-3", brand: "jö Bonus Club", logo: "🟡", title: "50% auf OMV Sandwich", description: "Mit 100 Ös 50% auf alle Sandwiches im VIVA Shop.", type: "rabatt", category: "essen", source: "jö App", url: "https://www.joe-club.at", expires: "Unbegrenzt", hot: false },
  { id: "joe-4", brand: "jö Bonus Club", logo: "🟡", title: "20% Rabattsammler BILLA", description: "Jeden Monat bis zu 20% auf einen kompletten BILLA Einkauf.", type: "rabatt", category: "supermarkt", source: "jö App", url: "https://www.joe-club.at", expires: "Monatlich", hot: true },
  { id: "joe-5", brand: "jö Bonus Club", logo: "🟡", title: "20% Rabattsammler BIPA", description: "Jeden Monat bis zu 20% auf einen kompletten BIPA Einkauf.", type: "rabatt", category: "drogerie", source: "jö App", url: "https://www.joe-club.at", expires: "Monatlich", hot: true },
  { id: "joe-6", brand: "jö Bonus Club", logo: "🟡", title: "30% auf OMV TopWash", description: "Mit 150 Ös 30% auf alle TopWash Autowäschen.", type: "rabatt", category: "mobilität", source: "jö App", url: "https://www.joe-club.at", expires: "Unbegrenzt", hot: false },
  { id: "joe-7", brand: "jö Bonus Club", logo: "🟡", title: "Ös sammeln bei BILLA", description: "1 Ö pro Euro Einkauf bei BILLA sammeln.", type: "cashback", category: "supermarkt", source: "jö App", url: "https://www.joe-club.at", expires: "Unbegrenzt", hot: false },
  { id: "joe-8", brand: "jö Bonus Club", logo: "🟡", title: "Ös sammeln bei foodora", description: "Bei jeder foodora Bestellung Ös sammeln.", type: "cashback", category: "lieferung", source: "jö App", url: "https://www.joe-club.at", expires: "Unbegrenzt", hot: true },
  { id: "joe-9", brand: "jö Bonus Club", logo: "🟡", title: "Ös sammeln bei LIBRO", description: "Bei LIBRO Bücher kaufen und Ös sammeln.", type: "cashback", category: "shopping", source: "jö App", url: "https://www.joe-club.at", expires: "Unbegrenzt", hot: false },
  { id: "joe-10", brand: "jö Bonus Club", logo: "🟡", title: "Ös sammeln bei PAGRO", description: "Bei PAGRO Diskont Ös sammeln.", type: "cashback", category: "shopping", source: "jö App", url: "https://www.joe-club.at", expires: "Unbegrenzt", hot: false },

  // SUPERMÄRKTE
  { id: "billa-1", brand: "BILLA", logo: "🟠", title: "-25% Pickerl", description: "Jeden Donnerstag neue -25% Rabatt-Pickerl auf ausgewählte Produkte.", type: "rabatt", category: "supermarkt", source: "BILLA", url: "https://www.billa.at", expires: "Wöchentlich", hot: true },
  { id: "billa-2", brand: "BILLA", logo: "🟠", title: "1+1 Gratis Aktionen", description: "Viele Produkte 1+1 Gratis bis 4.2.2026!", type: "gratis", category: "supermarkt", source: "BILLA", url: "https://www.billa.at", expires: "4.2.2026", hot: true },
  { id: "lidl-1", brand: "Lidl", logo: "🔵", title: "Lidl Plus Coupons", description: "Wöchentlich neue Rabatt-Coupons in der Lidl Plus App.", type: "rabatt", category: "supermarkt", source: "Lidl Plus", url: "https://www.lidl.at", expires: "Wöchentlich", hot: true },
  { id: "lidl-2", brand: "Lidl", logo: "🔵", title: "Lidl Plus Sofortgewinne", description: "Nach jedem Einkauf digitale Sofortgewinne erhalten!", type: "gratis", category: "supermarkt", source: "Lidl Plus", url: "https://www.lidl.at", expires: "Unbegrenzt", hot: false },
  { id: "spar-1", brand: "SPAR", logo: "🟢", title: "SPAR Plus Karte", description: "Personalisierte Rabatte mit der SPAR Plus Karte.", type: "rabatt", category: "supermarkt", source: "SPAR", url: "https://www.spar.at", expires: "Unbegrenzt", hot: false },
  { id: "hofer-1", brand: "HOFER", logo: "🔴", title: "Hofer App Coupons", description: "Exklusive Angebote in der Hofer App.", type: "rabatt", category: "supermarkt", source: "Hofer", url: "https://www.hofer.at", expires: "Wöchentlich", hot: false },

  // KAFFEE & ESSEN
  { id: "mcd-1", brand: "McDonald's", logo: "🍟", title: "Gratis Kaffee Feedback", description: "Nach Einkauf Feedback geben = Gratis Kaffee oder Cola. 5x/Monat!", type: "gratis", category: "kaffee", source: "McDonald's", url: "https://www.mcdonalds.at", expires: "5x/Monat", hot: true },
  { id: "mcd-2", brand: "McDonald's", logo: "🍟", title: "App Gutscheine", description: "Wöchentlich neue Coupons in der McDonald's App.", type: "rabatt", category: "essen", source: "McDonald's App", url: "https://www.mcdonalds.at", expires: "Wöchentlich", hot: false },
  { id: "sbux-1", brand: "Starbucks", logo: "☕", title: "Gratis Geburtstagsdrink", description: "Am Geburtstag ein Gratis-Getränk nach Wahl!", type: "gratis", category: "kaffee", source: "Starbucks", url: "https://www.starbucks.at", expires: "Am Geburtstag", hot: true },
  { id: "sbux-2", brand: "Starbucks", logo: "☕", title: "150 Sterne = Gratis Drink", description: "Sterne sammeln, bei 150 gibt's ein Freigetränk.", type: "gratis", category: "kaffee", source: "Starbucks", url: "https://www.starbucks.at", expires: "Unbegrenzt", hot: false },
  { id: "ikea-1", brand: "IKEA", logo: "🪑", title: "Gratis Kaffee Family", description: "IKEA Family: Unbegrenzt Gratis-Kaffee oder Tee im Restaurant!", type: "gratis", category: "kaffee", source: "IKEA", url: "https://www.ikea.at", expires: "Unbegrenzt", hot: true },
  { id: "bk-1", brand: "Burger King", logo: "🍔", title: "App Coupons", description: "Exklusive Gutscheine in der Burger King App.", type: "rabatt", category: "essen", source: "Burger King", url: "https://www.burgerking.at", expires: "Wöchentlich", hot: false },
  { id: "sub-1", brand: "Subway", logo: "🥪", title: "Subcard Gratis Cookie", description: "Bei Anmeldung einen Gratis-Cookie geschenkt.", type: "gratis", category: "essen", source: "Subway", url: "https://www.subway.at", expires: "Einmalig", hot: false },

  // DROGERIE
  { id: "dm-1", brand: "dm", logo: "🧴", title: "Babyclub Geschenk", description: "Gratis Greifring + Gutscheine bei dm Babyclub Anmeldung.", type: "gratis", category: "drogerie", source: "dm", url: "https://www.dm.at", expires: "Bei Anmeldung", hot: true },
  { id: "dm-2", brand: "dm", logo: "🧴", title: "Glückskind Proben", description: "Gratis Babyproben für Schwangere.", type: "gratis", category: "drogerie", source: "dm", url: "https://www.dm.at", expires: "Bei Anmeldung", hot: false },
  { id: "doug-1", brand: "Douglas", logo: "💜", title: "2 Gratis-Proben", description: "Bei jeder Bestellung ab €10 zwei kostenlose Beauty-Proben.", type: "gratis", category: "drogerie", source: "Douglas", url: "https://www.douglas.at", expires: "Unbegrenzt", hot: true },
  { id: "doug-2", brand: "Douglas", logo: "💜", title: "Geburtstags-Überraschung", description: "Beauty Card Mitglieder erhalten Geburtstagsgeschenk.", type: "gratis", category: "drogerie", source: "Douglas", url: "https://www.douglas.at", expires: "Am Geburtstag", hot: false },

  // WIEN SPEZIAL
  { id: "wien-1", brand: "Wien Museum", logo: "🏛️", title: "Gratis unter 19", description: "Freier Eintritt für alle unter 19 Jahren.", type: "gratis", category: "wien", source: "Wien Museum", url: "https://www.wienmuseum.at", expires: "Unbegrenzt", hot: true },
  { id: "wien-2", brand: "Belvedere", logo: "🖼️", title: "Gratis unter 19", description: "Klimts 'Der Kuss' kostenlos für unter 19-Jährige.", type: "gratis", category: "wien", source: "Belvedere", url: "https://www.belvedere.at", expires: "Unbegrenzt", hot: true },
  { id: "wien-3", brand: "Albertina", logo: "🎨", title: "Gratis unter 19", description: "Weltberühmte Kunstsammlung gratis.", type: "gratis", category: "wien", source: "Albertina", url: "https://www.albertina.at", expires: "Unbegrenzt", hot: false },
  { id: "wien-4", brand: "NHM Wien", logo: "🦕", title: "Gratis unter 19", description: "Naturhistorisches Museum kostenlos.", type: "gratis", category: "wien", source: "NHM", url: "https://www.nhm-wien.ac.at", expires: "Unbegrenzt", hot: false },
  { id: "wien-5", brand: "KHM Wien", logo: "👑", title: "Gratis unter 19", description: "Kunsthistorisches Museum gratis.", type: "gratis", category: "wien", source: "KHM", url: "https://www.khm.at", expires: "Unbegrenzt", hot: false },
  { id: "wien-6", brand: "Stadt Wien", logo: "👶", title: "Gratis Wickelrucksack", description: "Baby-Willkommenspaket für Wiener Familien.", type: "gratis", category: "wien", source: "Wien", url: "https://www.wien.gv.at", expires: "Bei Geburt", hot: true },
  { id: "wien-7", brand: "Wiener Linien", logo: "🚇", title: "Gratis WLAN", description: "Kostenloses WLAN in allen U-Bahn-Stationen.", type: "gratis", category: "wien", source: "Wiener Linien", url: "https://www.wienerlinien.at", expires: "Unbegrenzt", hot: false },
  { id: "wien-8", brand: "Büchereien Wien", logo: "📚", title: "Gratis unter 18", description: "Kostenlose Mitgliedschaft für unter 18-Jährige.", type: "gratis", category: "wien", source: "Büchereien Wien", url: "https://www.buechereien.wien.at", expires: "Unbegrenzt", hot: false },
  { id: "wien-9", brand: "Donauturm", logo: "🗼", title: "Gratis Geburtstag", description: "Am Geburtstag (±4 Tage) gratis auf den Donauturm.", type: "gratis", category: "wien", source: "Donauturm", url: "https://www.donauturm.at", expires: "Geburtstag", hot: false },
  { id: "wien-10", brand: "Prater", logo: "🎡", title: "Gratis Eintritt", description: "Der Wiener Prater ist kostenlos begehbar.", type: "gratis", category: "wien", source: "Prater", url: "https://www.praterwien.com", expires: "Unbegrenzt", hot: false },

  // MOBILITÄT
  { id: "obb-1", brand: "ÖBB", logo: "🚂", title: "Gratis Geburtstag", description: "Mit Vorteilscard am Geburtstag gratis 2. Klasse fahren.", type: "gratis", category: "mobilität", source: "ÖBB", url: "https://www.oebb.at", expires: "Geburtstag", hot: true },
  { id: "obb-2", brand: "ÖBB", logo: "🚂", title: "Sparschiene ab €19", description: "Günstige Zugtickets bei früher Buchung.", type: "rabatt", category: "mobilität", source: "ÖBB", url: "https://www.oebb.at", expires: "Bei Buchung", hot: false },

  // STREAMING
  { id: "spot-1", brand: "Spotify", logo: "🎵", title: "3 Monate gratis", description: "Premium für Neukunden 3 Monate kostenlos.", type: "testabo", category: "streaming", source: "Spotify", url: "https://www.spotify.com", expires: "Neukunden", hot: true },
  { id: "amz-1", brand: "Amazon Prime", logo: "📦", title: "30 Tage gratis", description: "Prime Video & schneller Versand kostenlos testen.", type: "testabo", category: "streaming", source: "Amazon", url: "https://www.amazon.de/prime", expires: "Neukunden", hot: true },
  { id: "nflx-1", brand: "Netflix", logo: "🎬", title: "Werbefinanziert ab €4,99", description: "Günstigstes Netflix Abo mit Werbung.", type: "rabatt", category: "streaming", source: "Netflix", url: "https://www.netflix.com", expires: "Immer", hot: false },

  // LIEFERSERVICES
  { id: "food-1", brand: "foodora", logo: "🛵", title: "Neukunden Rabatt", description: "Rabatt auf erste Bestellungen für Neukunden.", type: "rabatt", category: "lieferung", source: "foodora", url: "https://www.foodora.at", expires: "Neukunden", hot: true },
  { id: "mjam-1", brand: "Mjam", logo: "🍕", title: "Neukunden Rabatt", description: "Willkommensrabatt für Neukunden.", type: "rabatt", category: "lieferung", source: "Mjam", url: "https://www.mjam.at", expires: "Neukunden", hot: false },

  // MODE
  { id: "zal-1", brand: "Zalando", logo: "👟", title: "Gratis Versand", description: "Ab €24,90 kostenloser Versand.", type: "gratis", category: "mode", source: "Zalando", url: "https://www.zalando.at", expires: "Unbegrenzt", hot: false },
  { id: "zal-2", brand: "Zalando", logo: "👟", title: "100 Tage Retoure", description: "100 Tage kostenlose Rückgabe.", type: "gratis", category: "mode", source: "Zalando", url: "https://www.zalando.at", expires: "Unbegrenzt", hot: false },
  { id: "hm-1", brand: "H&M", logo: "👕", title: "10% Welcome", description: "10% Rabatt bei Newsletter-Anmeldung.", type: "rabatt", category: "mode", source: "H&M", url: "https://www.hm.com/at", expires: "Einmalig", hot: false },

  // FINANZEN
  { id: "n26-1", brand: "N26", logo: "📱", title: "Gratis Konto", description: "Kostenloses Online-Konto ohne Gebühren.", type: "gratis", category: "finanzen", source: "N26", url: "https://www.n26.com", expires: "Unbegrenzt", hot: true },
  { id: "shoop-1", brand: "Shoop", logo: "💵", title: "Cashback", description: "Geld zurück beim Online-Shopping.", type: "cashback", category: "finanzen", source: "Shoop", url: "https://www.shoop.at", expires: "Unbegrenzt", hot: true }
];

// ============================================
// HELPER FUNCTIONS
// ============================================

function fetch(url, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'de-AT,de;q=0.9,en;q=0.8'
      },
      timeout: timeout
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetch(res.headers.location, timeout).then(resolve).catch(reject);
        return;
      }
      
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function parseRSS(xml, source) {
  const deals = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  
  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1];
    
    const title = extractTag(item, 'title');
    const description = extractTag(item, 'description');
    const link = extractTag(item, 'link');
    const pubDate = extractTag(item, 'pubDate');
    
    if (!title) continue;
    
    // Filter für Gratis/Freebies
    const lowerTitle = title.toLowerCase();
    const lowerDesc = description.toLowerCase();
    const isGratis = lowerTitle.includes('gratis') || lowerTitle.includes('kostenlos') || 
                     lowerTitle.includes('free') || lowerTitle.includes('geschenkt') ||
                     lowerDesc.includes('gratis') || lowerDesc.includes('kostenlos');
    
    let type = 'rabatt';
    if (isGratis) type = 'gratis';
    else if (lowerTitle.includes('cashback')) type = 'cashback';
    else if (lowerTitle.includes('testabo') || lowerTitle.includes('probe')) type = 'testabo';
    
    // Kategorie bestimmen
    let category = 'shopping';
    if (/kaffee|coffee|latte|cappuccino/i.test(lowerTitle)) category = 'kaffee';
    else if (/billa|spar|lidl|hofer|penny|supermarkt/i.test(lowerTitle)) category = 'supermarkt';
    else if (/burger|pizza|essen|food|mcdonald|restaurant/i.test(lowerTitle)) category = 'essen';
    else if (/dm|bipa|douglas|beauty|kosmetik/i.test(lowerTitle)) category = 'drogerie';
    else if (/netflix|spotify|disney|stream|gaming/i.test(lowerTitle)) category = 'streaming';
    
    // Brand extrahieren
    let brand = source.brand;
    const brandMatch = title.match(/^([A-Za-zäöüÄÖÜß0-9&\-\.]+)[\s:]/);
    if (brandMatch) brand = brandMatch[1];
    
    // Description säubern
    let cleanDesc = description
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim();
    
    if (cleanDesc.length > 150) cleanDesc = cleanDesc.substring(0, 147) + '...';
    
    deals.push({
      id: `rss-${Date.now()}-${deals.length}`,
      brand: brand.substring(0, 25),
      logo: source.logo,
      title: title.substring(0, 80),
      description: cleanDesc || title,
      type,
      category,
      source: source.name,
      url: link || '',
      expires: 'Begrenzt',
      hot: isGratis,
      isNew: true,
      pubDate: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString()
    });
  }
  
  return deals;
}

function extractTag(xml, tag) {
  const cdataRegex = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i');
  const cdataMatch = xml.match(cdataRegex);
  if (cdataMatch) return cdataMatch[1].trim();
  
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

function extractDealsFromHTML(html, source) {
  const deals = [];
  
  // Suche nach typischen Deal-Patterns in HTML
  // Gratis/Kostenlos erwähnungen
  const gratisPatterns = [
    /gratis[^<]{0,100}/gi,
    /kostenlos[^<]{0,100}/gi,
    /0\s*€[^<]{0,50}/gi,
    /geschenkt[^<]{0,100}/gi,
    /1\+1\s*gratis/gi,
    /free[^<]{0,50}/gi
  ];
  
  gratisPatterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const context = match[0].replace(/<[^>]*>/g, '').trim();
      if (context.length > 10 && context.length < 200) {
        deals.push({
          id: `html-${source.brand}-${Date.now()}-${deals.length}`,
          brand: source.brand,
          logo: source.logo,
          title: `Aktion bei ${source.brand}`,
          description: context.substring(0, 150),
          type: 'gratis',
          category: source.category,
          source: source.name,
          url: source.url,
          expires: 'Begrenzt',
          hot: true,
          isNew: true,
          pubDate: new Date().toISOString()
        });
      }
    }
  });
  
  return deals.slice(0, 5); // Max 5 pro Quelle
}

// ============================================
// MAIN SCRAPER
// ============================================

async function scrapeAllSources() {
  console.log('🚀 Starting Wien Deals Scraper...\n');
  console.log(`📅 ${new Date().toLocaleString('de-AT')}\n`);
  
  const scrapedDeals = [];
  const errors = [];
  
  for (const source of SOURCES) {
    console.log(`📡 Scraping: ${source.name}...`);
    
    try {
      const content = await fetch(source.url);
      
      let deals = [];
      if (source.type === 'rss') {
        deals = parseRSS(content, source);
      } else {
        deals = extractDealsFromHTML(content, source);
      }
      
      console.log(`   ✅ ${deals.length} Deals gefunden\n`);
      scrapedDeals.push(...deals);
      
    } catch (error) {
      console.log(`   ❌ Fehler: ${error.message}\n`);
      errors.push({ source: source.name, error: error.message });
    }
  }
  
  // Kombiniere Basis-Deals + gescrapte Deals
  const allDeals = [...BASE_DEALS, ...scrapedDeals];
  
  // Duplikate entfernen
  const uniqueDeals = [];
  const seenTitles = new Set();
  
  for (const deal of allDeals) {
    const key = deal.title.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 30);
    if (!seenTitles.has(key)) {
      seenTitles.add(key);
      uniqueDeals.push(deal);
    }
  }
  
  // Sortieren: Hot zuerst, dann neue, dann nach Datum
  uniqueDeals.sort((a, b) => {
    if (a.hot && !b.hot) return -1;
    if (!a.hot && b.hot) return 1;
    if (a.isNew && !b.isNew) return -1;
    if (!a.isNew && b.isNew) return 1;
    return 0;
  });
  
  // Output erstellen
  const output = {
    lastUpdated: new Date().toISOString(),
    totalDeals: uniqueDeals.length,
    baseDeals: BASE_DEALS.length,
    scrapedDeals: scrapedDeals.length,
    sources: SOURCES.map(s => s.name),
    errors,
    deals: uniqueDeals
  };
  
  // Speichern
  fs.writeFileSync('deals.json', JSON.stringify(output, null, 2));
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ Scraping abgeschlossen!`);
  console.log(`   📦 Basis-Deals: ${BASE_DEALS.length}`);
  console.log(`   🆕 Neue Deals: ${scrapedDeals.length}`);
  console.log(`   📊 Gesamt: ${uniqueDeals.length}`);
  console.log(`   💾 Gespeichert: deals.json`);
  if (errors.length > 0) {
    console.log(`   ⚠️  Fehler: ${errors.length}`);
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  return output;
}

// Run
scrapeAllSources().catch(console.error);

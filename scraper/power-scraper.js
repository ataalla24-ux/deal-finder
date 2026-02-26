// ============================================
// FREEFINDER WIEN - POWER SCRAPER V5 (AKTUALISIERT)
// Für aktuelle Deals in Wien
// ============================================

import https from 'https';
import http from 'http';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================
// STATISCHE BASIS-DEALS (Dauerhaft gültig)
// Stand: Februar 2026
// ============================================
const BASE_DEALS = [
  // ☕ KAFFEE & FRÜHSTÜCK
  {
    id: 'top-1', brand: 'IKEA', logo: '☕', title: 'GRATIS Kaffee UNLIMITIERT',
    description: 'IKEA Family Mitglieder: Unbegrenzt Gratis-Kaffee & Tee im Restaurant',
    type: 'gratis', category: 'kaffee', source: 'IKEA Family', url: 'https://www.ikea.com/at/de/ikea-family/',
    expires: 'Unbegrenzt', distance: 'IKEA Wien Nord & Vösendorf', hot: true, isNew: false, priority: 1, votes: 1203
  },
  {
    id: 'top-2', brand: "McDonald's", logo: '☕', title: 'GRATIS Kaffee - 5x/Monat',
    description: 'McCafé Bonusclub: Jeden Monat 5 gratis Kaffees! Einfach App downloaden.',
    type: 'gratis', category: 'kaffee', source: "McDonald's App", url: 'https://www.mcdonalds.at/app',
    expires: 'Monatlich 5 Stück', distance: '50+ Filialen Wien', hot: true, isNew: false, priority: 1, votes: 623
  },
  {
    id: 'top-3', brand: 'IKEA', logo: '☕', title: 'GRATIS Frühstück für Kinder',
    description: 'IKEA Restaurant: Kinder unter 12 eat free bei jedem Einkauf',
    type: 'gratis', category: 'essen', source: 'IKEA', url: 'https://www.ikea.com/at/de/ikea-family/',
    expires: 'Dauerhaft', distance: 'IKEA Wien Nord & Vösendorf', hot: true, isNew: false, priority: 1, votes: 456
  },

  // 🍛 ESSEN & LEBENSMITTEL
  {
    id: 'top-4', brand: 'Wiener Deewan', logo: '🍛', title: 'GRATIS Essen - Pay what you want',
    description: 'Pakistanisches All-you-can-eat Buffet: Zahle was du willst! Auch 0€ ist OK.',
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
    description: 'Fairteiler in ganz Wien! Lebensmittel gratis abholen oder abgeben.',
    type: 'gratis', category: 'essen', source: 'Foodsharing', url: 'https://foodsharing.at/',
    expires: 'Dauerhaft', distance: 'Ganz Wien', hot: true, isNew: false, priority: 1, votes: 201
  },
  {
    id: 'top-7', brand: 'Wiener Tafel', logo: '🥫', title: 'GRATIS Lebensmittel (Bedürftige)',
    description: 'Gerettete Lebensmittel kostenlos bei sozialen Ausgabestellen in Wien.',
    type: 'gratis', category: 'essen', source: 'Wiener Tafel', url: 'https://www.wienertafel.at/',
    expires: 'Dauerhaft', distance: 'Ausgabestellen Wien', hot: false, isNew: false, priority: 2, votes: 234
  },

  // 🍔 FAST FOOD APP AKTIONEN
  {
    id: 'app-1', brand: "McDonald's", logo: '🍟', title: 'GRATIS Cheeseburger bei App-Download',
    description: "McDonald's App neu installieren = Gratis Cheeseburger als Willkommensgeschenk!",
    type: 'gratis', category: 'essen', source: "McDonald's App", url: 'https://www.mcdonalds.at/app',
    expires: 'Für Neukunden', distance: 'Alle Filialen', hot: true, isNew: true, priority: 1, votes: 534
  },
  {
    id: 'app-2', brand: 'Burger King', logo: '🍔', title: 'GRATIS Whopper am Geburtstag',
    description: 'Burger King App: Am Geburtstag bekommst du einen Gratis-Whopper!',
    type: 'gratis', category: 'essen', source: 'Burger King App', url: 'https://www.burgerking.at/',
    expires: 'Am Geburtstag', distance: 'Alle Filialen Wien', hot: false, isNew: false, priority: 2, votes: 389
  },
  {
    id: 'app-3', brand: 'Starbucks', logo: '☕', title: 'GRATIS Getränk am Geburtstag',
    description: 'Starbucks Rewards: Am Geburtstag jedes Getränk gratis!',
    type: 'gratis', category: 'kaffee', source: 'Starbucks Rewards', url: 'https://www.starbucks.at/',
    expires: 'Am Geburtstag', distance: '15+ Starbucks Wien', hot: false, isNew: false, priority: 2, votes: 412
  },

  // 🎓 STUDENTEN
  {
    id: 'stud-1', brand: 'Uni Mensen', logo: '🎓', title: 'Warme Mahlzeit ab 2,20€',
    description: 'Alle Wiener Uni-Mensen: Vollwertige Mahlzeit für Studenten ab 2,20€!',
    type: 'rabatt', category: 'essen', source: 'Mensen Wien', url: 'https://www.mensen.at/',
    expires: 'Mit Studentenausweis', distance: '20+ Mensen Wien', hot: false, isNew: false, priority: 2, votes: 456
  },

  // 💪 FITNESS PROBETRAINING
  {
    id: 'fit-1', brand: 'FitInn', logo: '💪', title: 'GRATIS Probetraining 1 Woche',
    description: 'Eine Woche gratis trainieren! Keine Kreditkarte nötig.',
    type: 'gratis', category: 'fitness', source: 'FitInn', url: 'https://www.fitinn.at/',
    expires: 'Jederzeit', distance: 'Alle Standorte', hot: true, isNew: false, priority: 1, votes: 167
  },
  {
    id: 'fit-2', brand: 'clever fit', logo: '💪', title: 'GRATIS Probetraining',
    description: 'Kostenloses Probetraining inkl. Einweisung!',
    type: 'gratis', category: 'fitness', source: 'clever fit', url: 'https://www.clever-fit.com/at/',
    expires: 'Jederzeit', distance: 'Alle Standorte', hot: false, isNew: false, priority: 2, votes: 89
  },
  {
    id: 'fit-3', brand: 'John Harris', logo: '🏊', title: 'GRATIS Probetag',
    description: 'Ein Tag gratis trainieren im Premium Fitnessstudio!',
    type: 'gratis', category: 'fitness', source: 'John Harris', url: 'https://www.johnharris.at/',
    expires: 'Jederzeit', distance: 'Wien Standorte', hot: false, isNew: false, priority: 2, votes: 76
  },

  // 🏛️ KULTUR & MUSEEN
  {
    id: 'kult-1', brand: 'Bundesmuseen', logo: '🏛️', title: 'GRATIS Eintritt unter 19',
    description: 'Alle Bundesmuseen (KHM, Belvedere, Albertina...) sind für unter 19-Jährige!',
    type: 'gratis', category: 'kultur', source: 'Bundesmuseen', url: 'https://www.bundesmuseen.at/',
    expires: 'Dauerhaft', distance: 'Wien', hot: true, isNew: false, priority: 1, votes: 312
  },
  {
    id: 'kult-2', brand: 'Kunsthistorisches Museum', logo: '🏛️', title: 'GRATIS Eintritt jeden 1. Sonntag',
    description: 'KHM: Jeden ersten Sonntag im Monat freier Eintritt!',
    type: 'gratis', category: 'kultur', source: 'KHM', url: 'https://www.khm.at/',
    expires: '1. Sonntag/Monat', distance: 'Innere Stadt', hot: true, isNew: false, priority: 1, votes: 234
  },
  {
    id: 'kult-3', brand: 'Belvedere', logo: '🏛️', title: 'GRATIS Eintritt jeden 1. Sonntag',
    description: 'Oberes & Unteres Belvedere: Jeden ersten Sonntag frei!',
    type: 'gratis', category: 'kultur', source: 'Belvedere', url: 'https://www.belvedere.at/',
    expires: '1. Sonntag/Monat', distance: '3. Bezirk', hot: true, isNew: false, priority: 1, votes: 189
  },
  {
    id: 'kult-4', brand: 'Wien Museum', logo: '🏛️', title: 'GRATIS Dauerausstellung',
    description: 'Wien Museum am Karlsplatz: Dauerausstellung immer kostenlos!',
    type: 'gratis', category: 'kultur', source: 'Wien Museum', url: 'https://www.wienmuseum.at/',
    expires: 'Dauerhaft', distance: 'Karlsplatz', hot: true, isNew: true, priority: 1, votes: 156
  },

  // 👶 FAMILIE & KINDER
  {
    id: 'fam-1', brand: 'IKEA', logo: '👶', title: 'KINDER ESSEN FREE',
    description: 'IKEA: Kinder unter 12 essen gratis bei Begleitung eines Erwachsenen',
    type: 'gratis', category: 'essen', source: 'IKEA', url: 'https://www.ikea.com/at/de/ikea-family/',
    expires: 'Dauerhaft', distance: 'IKEA Wien', hot: true, isNew: false, priority: 1, votes: 345
  },
  {
    id: 'fam-2', brand: 'Zoom Kindermuseum', logo: '🎨', title: 'GRATIS für Kinder unter 6',
    description: 'Zoom Kindermuseum: Geschwisterkinder unter 6 sind immer gratis!',
    type: 'gratis', category: 'kultur', source: 'Zoom', url: 'https://www.zoom-kindermuseum.at/',
    expires: 'Dauerhaft', distance: 'Museumsquartier', hot: false, isNew: false, priority: 2, votes: 123
  },

  // 🛒 SUPERMÄRKTE
  {
    id: 'super-1', brand: 'Lidl', logo: '🛒', logo: '🛒', title: 'Wochenangebote',
    description: 'Lidl Wien: Aktuelle Wochenangebote jeden Montag!',
    type: 'rabatt', category: 'supermarkt', source: 'Lidl', url: 'https://www.lidl.at/',
    expires: 'Wöchentlich', distance: 'Filialen Wien', hot: true, isNew: true, priority: 2, votes: 234
  },
  {
    id: 'super-2', brand: 'Hofer', logo: '🛒', title: 'Aktionen',
    description: 'Hofer: Wöchentliche Specials und Aktionen',
    type: 'rabatt', category: 'supermarkt', source: 'Hofer', url: 'https://www.hofer.at/',
    expires: 'Wöchentlich', distance: 'Filialen Wien', hot: true, isNew: true, priority: 2, votes: 198
  },

  // 🎁 PROBEN & PROBEABOS
  {
    id: 'probe-1', brand: 'dm', logo: '💄', title: 'GRATIS Produktproben',
    description: 'Im dm gibt es regelmäßig Gratis-Proben! Frag an der Kassa.',
    type: 'gratis', category: 'beauty', source: 'dm', url: 'https://www.dm.at/',
    expires: 'Solange Vorrat', distance: 'dm Filialen', hot: false, isNew: false, priority: 2, votes: 145
  },
  {
    id: 'probe-2', brand: 'BIPA', logo: '💅', title: 'GRATIS Beauty-Proben',
    description: 'BIPA verteilt regelmäßig Gratisproben!',
    type: 'gratis', category: 'beauty', source: 'BIPA', url: 'https://www.bipa.at/',
    expires: 'Solange Vorrat', distance: 'BIPA Filialen', hot: false, isNew: false, priority: 2, votes: 98
  },
  {
    id: 'probe-3', brand: 'Müller', logo: '🛍️', title: 'GRATIS Proben',
    description: 'Müller: Verschiedene Gratisproben bei Einkauf!',
    type: 'gratis', category: 'beauty', source: 'Müller', url: 'https://www.mueller.at/',
    expires: 'Solange Vorrat', distance: 'Müller Filialen', hot: false, isNew: false, priority: 2, votes: 76
  },

  // 🎬 EVENTS (AKTUELL)
  {
    id: 'event-1', brand: 'P动作', logo: '🎬', title: 'Gratis Film Vorschau',
    description: 'Filmfestivals & Preview-Vorführungen - oft kostenlos!',
    type: 'gratis', category: 'kultur', source: 'Wien Events', url: 'https://events.wien.info/de/',
    expires: 'laufend', distance: 'Wien', hot: true, isNew: true, priority: 2, votes: 234
  },
  {
    id: 'event-2', brand: 'City Bike', logo: '🚴', title: 'GRATIS Fahrrad ausborgen',
    description: 'City Bikes in Wien: Erste Stunde gratis!',
    type: 'gratis', category: 'mobilität', source: 'City Bike', url: 'https://www.citybikewien.at/',
    expires: 'Dauerhaft', distance: 'Ganz Wien', hot: false, isNew: false, priority: 2, votes: 167
  },
  {
    id: 'event-3', brand: 'WC', logo: '🚻', title: 'GRATIS öffentliche Toiletten',
    description: 'U-Bahn Stationen & öffentliche Gebäude: Kostenlose Nutzung',
    type: 'gratis', category: 'service', source: 'Stadt Wien', url: 'https://www.wien.gv.at/',
    expires: 'Dauerhaft', distance: 'Ganz Wien', hot: false, isNew: false, priority: 3, votes: 89
  },
];

// ============================================
// QUELLEN (funktionierende)
// ============================================
const SOURCES = [
  // KULTUR & EVENTS
  { name: 'Wien Events', url: 'https://events.wien.info/de/', type: 'html', brand: 'Wien Events', logo: '🎭', category: 'kultur' },
  { name: 'Wien Kulturkalender', url: 'https://www.wien.gv.at/kultur-freizeit/kalender.html', type: 'html', brand: 'Wien.gv.at', logo: '🏛️', category: 'kultur' },
  { name: 'Museumsquartier', url: 'https://www.mqw.at/programm/', type: 'html', brand: 'MQ Wien', logo: '🏛️', category: 'kultur' },
  
  // FOOD SHARING
  { name: 'Too Good To Go', url: 'https://www.toogoodtogo.com/at', type: 'html', brand: 'TGTG', logo: '🥡', category: 'essen' },
  { name: 'Foodsharing Wien', url: 'https://foodsharing.de/places/14125', type: 'html', brand: 'Foodsharing', logo: '🍞', category: 'essen' },
  { name: 'Foodsharing AT', url: 'https://foodsharing.at/', type: 'html', brand: 'Foodsharing AT', logo: '🥖', category: 'essen' },
  
  // SUPERMÄRKTE
  { name: 'Lidl Angebote', url: 'https://www.lidl.at/c/billiger-montag/a10006065', type: 'html', brand: 'Lidl', logo: '🛒', category: 'supermarkt' },
  { name: 'HOFER Aktionen', url: 'https://www.hofer.at/de/angebote.html', type: 'html', brand: 'HOFER', logo: '🛒', category: 'supermarkt' },
  { name: 'BILLA Plus', url: 'https://www.billa.at/aktionen', type: 'html', brand: 'BILLA', logo: '🛒', category: 'supermarkt' },
  
  // FAST FOOD
  { name: "McDonald's", url: 'https://www.mcdonalds.at/aktionen', type: 'html', brand: "McDonald's", logo: '🍟', category: 'essen' },
  { name: 'Burger King', url: 'https://www.burgerking.at/angebote', type: 'html', brand: 'Burger King', logo: '🍔', category: 'essen' },
  { name: 'KFC', url: 'https://www.kfc.at/angebote', type: 'html', brand: 'KFC', logo: '🍗', category: 'essen' },
  { name: 'Subway', url: 'https://www.subway.at/de/angebote', type: 'html', brand: 'Subway', logo: '🥪', category: 'essen' },
  
  // FITNESS
  { name: 'FitInn', url: 'https://www.fitinn.at/', type: 'html', brand: 'FitInn', logo: '💪', category: 'fitness' },
  { name: 'John Harris', url: 'https://www.johnharris.at/', type: 'html', brand: 'John Harris', logo: '🏊', category: 'fitness' },
  { name: 'clever fit', url: 'https://www.clever-fit.com/at/', type: 'html', brand: 'clever fit', logo: '💪', category: 'fitness' },
  
  // SHOPPING
  { name: 'MediaMarkt', url: 'https://www.mediamarkt.at/de/campaign/angebote', type: 'html', brand: 'MediaMarkt', logo: '📺', category: 'technik' },
  { name: 'Saturn', url: 'https://www.saturn.at/de/campaign/angebote', type: 'html', brand: 'Saturn', logo: '📻', category: 'technik' },
  { name: 'H&M', url: 'https://www.hm.com/at/de/angebote/', type: 'html', brand: 'H&M', logo: '👕', category: 'mode' },
  { name: 'Zara', url: 'https://www.zara.com/at/de/sale', type: 'html', brand: 'Zara', logo: '👗', category: 'mode' },
  
  // RABATTCODES
  { name: 'Gutscheine.at', url: 'https://www.gutscheine.at/', type: 'html', brand: 'Gutscheine', logo: '🏷️', category: 'rabatt' },
  { name: 'Coupons.at', url: 'https://www.coupons.at/', type: 'html', brand: 'Coupons', logo: '🏷️', category: 'rabatt' },
  
  // REISEN
  { name: 'ÖBB Sparschiene', url: 'https://www.oebb.at/de/angebote-ermaessigungen/sparschiene', type: 'html', brand: 'ÖBB', logo: '🚂', category: 'reisen' },
  
  // ============================================
  // ERWEITERTE QUELLEN - WIEN
  // ============================================
  
  // ESSEN & TRINKEN
  { name: 'Vapiano', url: 'https://www.vapiano.at/aktionen/', type: 'html', brand: 'Vapiano', logo: '🍝', category: 'essen' },
  { name: 'Nordsee', url: 'https://www.nordsee.at/aktionen/', type: 'html', brand: 'Nordsee', logo: '🐟', category: 'essen' },
  { name: 'Wienerwald', url: 'https://www.wienerwald.at/aktionen/', type: 'html', brand: 'Wienerwald', logo: '🍗', category: 'essen' },
  { name: 'Dean&David', url: 'https://www.deananddavid.at/aktionen/', type: 'html', brand: 'Dean&David', logo: '🥗', category: 'essen' },
  { name: 'Brot', url: 'https://www.brot.cz/', type: 'html', brand: 'Brot', logo: '🥖', category: 'essen' },
  { name: 'Joe & the Juice', url: 'https://www.joeandthejuice.at/', type: 'html', brand: 'Joe & the Juice', logo: '🧃', category: 'essen' },
  { name: 'Bubbles', url: 'https://www.bubbles.at/aktionen/', type: 'html', brand: 'Bubbles', logo: '🍾', category: 'essen' },
  { name: 'My Indigo', url: 'https://www.myindigo.at/aktionen/', type: 'html', brand: 'My Indigo', logo: '🍜', category: 'essen' },
  
  // KAFFEE & BÄCKEREI
  { name: 'Anpflanzl', url: 'https://www.anpflanzl.at/', type: 'html', brand: 'Anpflanzl', logo: '☕', category: 'kaffee' },
  { name: 'Biquadri', url: 'https://www.biquadri.at/', type: 'html', brand: 'Biquadri', logo: '☕', category: 'kaffee' },
  { name: 'Caffè Latte', url: 'https://www.caffè-latte.at/', type: 'html', brand: 'Caffè Latte', logo: '☕', category: 'kaffee' },
  { name: 'Ströck', url: 'https://www.stroeck.at/', type: 'html', brand: 'Ströck', logo: '🥯', category: 'essen' },
  { name: 'Der Mann', url: 'https://www.dermann.at/', type: 'html', brand: 'Der Mann', logo: '🥐', category: 'essen' },
  { name: 'Backwerk', url: 'https://www.backwerk.at/', type: 'html', brand: 'Backwerk', logo: '🥨', category: 'essen' },
  
  // SUPERMÄRKTE SPEZIAL
  { name: 'Penny', url: 'https://www.penny.at/aktionen', type: 'html', brand: 'Penny', logo: '🛒', category: 'supermarkt' },
  { name: 'Spar', url: 'https://www.spar.at/aktionen/', type: 'html', brand: 'Spar', logo: '🛒', category: 'supermarkt' },
  { name: 'Merkur', url: 'https://www.merkur.at/aktionen/', type: 'html', brand: 'Merkur', logo: '🛒', category: 'supermarkt' },
  { name: 'Billa', url: 'https://www.billa.at/aktionen/', type: 'html', brand: 'Billa', logo: '🛒', category: 'supermarkt' },
  { name: 'Unimarkt', url: 'https://www.unimarkt.at/aktionen/', type: 'html', brand: 'Unimarkt', logo: '🛒', category: 'supermarkt' },
  
  // BEAUTY & DROGERIE
  { name: 'dm', url: 'https://www.dm.at/aktionen', type: 'html', brand: 'dm', logo: '💄', category: 'beauty' },
  { name: 'BIPA', url: 'https://www.bipa.at/aktionen/', type: 'html', brand: 'BIPA', logo: '💅', category: 'beauty' },
  { name: 'Müller', url: 'https://www.mueller.at/aktionen/', type: 'html', brand: 'Müller', logo: '🛍️', category: 'beauty' },
  { name: 'Douglas', url: 'https://www.douglas.at/aktionen/', type: 'html', brand: 'Douglas', logo: '✨', category: 'beauty' },
  { name: 'Sephora', url: 'https://www.sephora.at/aktionen/', type: 'html', brand: 'Sephora', logo: '💄', category: 'beauty' },
  
  // SHOPPING MODE
  { name: 'About You', url: 'https://www.aboutyou.at/sale/', type: 'html', brand: 'About You', logo: '👗', category: 'mode' },
  { name: 'New Yorker', url: 'https://www.newyorker.at/aktionen/', type: 'html', brand: 'New Yorker', logo: '👕', category: 'mode' },
  { name: 'C&A', url: 'https://www.cunda.at/', type: 'html', brand: 'C&A', logo: '👖', category: 'mode' },
  { name: 'H&M', url: 'https://www.hm.com/at/de/angebote/', type: 'html', brand: 'H&M', logo: '👕', category: 'mode' },
  { name: 'Primark', url: 'https://www.primark.com/at/de/', type: 'html', brand: 'Primark', logo: '👚', category: 'mode' },
  { name: 'Deichmann', url: 'https://www.deichmann.at/aktionen/', type: 'html', brand: 'Deichmann', logo: '👟', category: 'mode' },
  
  // TECHNIK & ELEKTRONIK
  { name: 'Cyberport', url: 'https://www.cyberport.at/', type: 'html', brand: 'Cyberport', logo: '💻', category: 'technik' },
  { name: 'Conrad', url: 'https://www.conrad.at/', type: 'html', brand: 'Conrad', logo: '🔌', category: 'technik' },
  { name: 'Gravis', url: 'https://www.gravis.at/', type: 'html', brand: 'Gravis', logo: '📱', category: 'technik' },
  { name: 'Apple Store', url: 'https://www.apple.com/at-edu/shop/', type: 'html', brand: 'Apple', logo: '🍎', category: 'technik' },
  
  // SPORT
  { name: 'Decathlon', url: 'https://www.decathlon.at/', type: 'html', brand: 'Decathlon', logo: '⚽', category: 'sport' },
  { name: 'Hervis', url: 'https://www.hervis.at/', type: 'html', brand: 'Hervis', logo: '🏋️', category: 'sport' },
  { name: 'Sportscheck', url: 'https://www.sportscheck.at/', type: 'html', brand: 'Sportscheck', logo: '🏃', category: 'sport' },
  { name: 'Intersport', url: 'https://www.intersport.at/', type: 'html', brand: 'Intersport', logo: '⛷️', category: 'sport' },
  
  // SPIELWAREN
  { name: 'Hamster', url: 'https://www.hamster.at/', type: 'html', brand: 'Hamster', logo: '🧸', category: 'spielzeug' },
  { name: 'Toy City', url: 'https://www.toycity.at/', type: 'html', brand: 'Toy City', logo: '🎮', category: 'spielzeug' },
  
  // EINRICHTUNG
  { name: 'XXXLutz', url: 'https://www.xxxlutz.at/', type: 'html', brand: 'XXXLutz', logo: '🛋️', category: 'moebel' },
  { name: 'Möbelix', url: 'https://www.moebelix.at/', type: 'html', brand: 'Möbelix', logo: '🛋️', category: 'moebel' },
  { name: 'Kika', url: 'https://www.kika.at/', type: 'html', brand: 'Kika', logo: '🏠', category: 'moebel' },
  { name: 'Lego Store', url: 'https://www.lego.com/at-de/', type: 'html', brand: 'LEGO', logo: '🧱', category: 'spielzeug' },
  
  // BUCH & BILDUNG
  { name: 'Thalia', url: 'https://www.thalia.at/', type: 'html', brand: 'Thalia', logo: '📖', category: 'bildung' },
  { name: 'Libro', url: 'https://www.libro.at/', type: 'html', brand: 'Libro', logo: '📚', category: 'bildung' },
  { name: 'Mayersche', url: 'https://www.mayersche.at/', type: 'html', brand: 'Mayersche', logo: '📕', category: 'bildung' },
  
  // GUTSCHEIN-PORTALE
  { name: 'Gratiscode', url: 'https://www.gratiscode.at/', type: 'html', brand: 'Gratiscode', logo: '🎁', category: 'rabatt' },
  { name: 'Sparheld', url: 'https://www.sparheld.at/', type: 'html', brand: 'Sparheld', logo: '💰', category: 'rabatt' },
  { name: 'Deals', url: 'https://www.deals.at/', type: 'html', brand: 'Deals', logo: '🏷️', category: 'rabatt' },
  { name: 'Bares', url: 'https://www.bares.at/', type: 'html', brand: 'Bares', logo: '💶', category: 'rabatt' },
  
  // MOBILITÄT
  { name: 'City Bike', url: 'https://www.citybikewien.at/', type: 'html', brand: 'City Bike', logo: '🚴', category: 'mobilitaet' },
  { name: 'WienMobil', url: 'https://www.wienmobil.at/', type: 'html', brand: 'WienMobil', logo: '🚌', category: 'mobilitaet' },
  { name: 'TMI Rent', url: 'https://www.tmi-rent.at/', type: 'html', brand: 'TMI Rent', logo: '🚗', category: 'mobilitaet' },
  
  // WELLNESS & SPA
  { name: 'Therme Wien', url: 'https://www.thermewien.at/', type: 'html', brand: 'Therme Wien', logo: '♨️', category: 'wellness' },
  { name: 'Diana Bad', url: 'https://www.dianabad.at/', type: 'html', brand: 'Diana Bad', logo: '🏊', category: 'wellness' },
  { name: 'Kombibad', url: 'https://www.kombibad.at/', type: 'html', brand: 'Kombibad', logo: '🧖', category: 'wellness' },
  { name: 'La pura', url: 'https://www.lapura.at/', type: 'html', brand: 'La Pura', logo: '💆', category: 'wellness' },
  
  // FREIZEIT & VERANSTALTUNGEN
  { name: 'Erlebniswelt', url: 'https://www.erlebniswelt.at/', type: 'html', brand: 'Erlebniswelt', logo: '🎢', category: 'freizeit' },
  { name: 'Tiergarten Schönbrunn', url: 'https://www.zoovienna.at/', type: 'html', brand: 'Tiergarten', logo: '🦁', category: 'freizeit' },
  { name: 'Haus des Meeres', url: 'https://www.hausdesmeeres.at/', type: 'html', brand: 'Haus des Meeres', logo: '🐠', category: 'freizeit' },
  { name: 'Schloss Schönbrunn', url: 'https://www.schoenbrunn.at/', type: 'html', brand: 'Schönbrunn', logo: '🏰', category: 'freizeit' },
];

// ============================================
// HELPER: Fetch HTML
// ============================================
function fetchHTML(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, { timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject).setTimeout(10000, () => reject(new Error('Timeout')));
  });
}

// ============================================
// HELFER: Extract Deals from HTML (simplified)
// ============================================
function extractDealsFromHTML(html, source) {
  const deals = [];
  
  // Simple extraction - look for links with deal-like text
  const linkRegex = /<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const url = match[1];
    const text = match[2].trim();
    
    if (text.length > 10 && !url.includes('javascript') && !url.includes('cookie')) {
      // Only include if it looks like a deal
      if (text.match(/gratis|rabatt|aktion|angebot|sale|deal|free|günstig|€|%/i)) {
        deals.push({
          id: `ps-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          brand: source.brand,
          logo: source.logo,
          title: text.substring(0, 80),
          description: `${source.name} - ${text}`,
          type: text.toLowerCase().includes('gratis') || text.toLowerCase().includes('free') ? 'gratis' : 'rabatt',
          category: source.category,
          source: source.name,
          url: url.startsWith('http') ? url : source.url,
          expires: 'Siehe Webseite',
          distance: 'Wien',
          hot: false,
          isNew: true,
          priority: 3,
          votes: 1,
          qualityScore: 30,
          pubDate: new Date().toISOString()
        });
      }
    }
  }
  
  return deals.slice(0, 10); // Max 10 deals per source
}

// ============================================
// MAIN
// ============================================
async function main() {
  console.log('🚀 POWER SCRAPER V5 - AKTUALISIERT');
  console.log('📅', new Date().toLocaleDateString('de-AT'));
  console.log('='.repeat(40));
  
  console.log(`📊 ${BASE_DEALS.length} Basis-Deals geladen`);
  
  // Scrape dynamic sources
  console.log(`\n📡 Scraping ${SOURCES.length} Quellen...\n`);
  
  const scrapedDeals = [];
  
  for (const source of SOURCES) {
    try {
      console.log(`🌐 ${source.name}...`);
      const html = await fetchHTML(source.url);
      const deals = extractDealsFromHTML(html, source);
      scrapedDeals.push(...deals);
      console.log(`   → ${deals.length} Deals gefunden`);
    } catch (error) {
      console.log(`   ❌ ${error.message}`);
    }
  }
  
  // Combine base + scraped
  const allDeals = [...BASE_DEALS, ...scrapedDeals];
  
  // Remove duplicates
  const uniqueDeals = [];
  const seen = new Set();
  for (const deal of allDeals) {
    const key = (deal.title || '').toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 30);
    if (!seen.has(key)) {
      seen.add(key);
      uniqueDeals.push(deal);
    }
  }
  
  // Sort: gratis first, then hot, then priority
  uniqueDeals.sort((a, b) => {
    if (a.type === 'gratis' && b.type !== 'gratis') return -1;
    if (a.type !== 'gratis' && b.type === 'gratis') return 1;
    if (a.hot && !b.hot) return -1;
    if (!a.hot && b.hot) return 1;
    return (a.priority || 99) - (b.priority || 99);
  });
  
  // Output
  const output = {
    lastUpdated: new Date().toISOString(),
    source: 'power-scraper-v5',
    totalDeals: uniqueDeals.length,
    deals: uniqueDeals
  };
  
  const outputPath = path.join(__dirname, '..', 'docs', 'deals-pending-power.json');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  
  console.log('\n' + '='.repeat(40));
  console.log(`✅ ${uniqueDeals.length} Deals gespeichert`);
  console.log(`📁 ${outputPath}`);
  console.log(`🔥 ${uniqueDeals.filter(d => d.hot).length} Hot Deals`);
  console.log(`🆓 ${uniqueDeals.filter(d => d.type === 'gratis').length} Gratis Deals`);
}

main().catch(console.error);

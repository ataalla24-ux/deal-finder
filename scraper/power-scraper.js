import '../sentry/instrument.mjs';
// ============================================
// FREEFINDER WIEN - POWER SCRAPER V5 (AKTUALISIERT)
// Für aktuelle Deals in Wien
// ============================================

import crypto from 'crypto';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import {
  cleanUiNoiseText,
  isGenericJunkDeal,
  normalizeDealRecord,
} from './deal-normalization-utils.js';
import {
  buildPipelineRunReport,
  writeFailedPipelineRunReport,
  writePipelineRunReport,
} from './pipeline-run-report-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INCLUDE_BASE_DEALS = String(process.env.POWER_INCLUDE_BASE_DEALS || '1') !== '0';
const FETCH_TIMEOUT_MS = Math.max(3000, Number(process.env.POWER_FETCH_TIMEOUT_MS || 12000));
const FETCH_CONCURRENCY = Math.max(1, Math.min(12, Number(process.env.POWER_FETCH_CONCURRENCY || 6)));
const MAX_HTML_BYTES = Math.max(250000, Number(process.env.POWER_MAX_HTML_BYTES || 2500000));
const MAX_DEALS_PER_SOURCE = Math.max(1, Math.min(25, Number(process.env.POWER_MAX_DEALS_PER_SOURCE || 10)));
const SOURCE_KEY = 'power';
const SOURCE_LABEL = 'Power Scraper';
const OUTPUT_PATH = 'docs/deals-pending-power.json';
const RUN_STARTED_AT = new Date();
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
    id: 'super-1', brand: 'Lidl', logo: '🛒', title: 'Wochenangebote',
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
    id: 'event-1', brand: 'Filmfest Wien', logo: '🎬', title: 'Gratis Film Vorschau',
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

const DISABLED_SOURCE_NAMES = new Set([
  'Wien Kulturkalender',
  'Lidl Angebote',
  "McDonald's",
  'clever fit',
  'ÖBB Sparschiene',
  'Vapiano',
  'Penny',
  'Merkur',
  'BIPA',
  'Anpflanzl',
  'Biquadri',
  'Caffè Latte',
  'Gravis',
  'Hamster',
  'Toy City',
  'Mayersche',
  'Gratiscode',
  'TMI Rent',
  'Diana Bad',
  'Kombibad',
  'Haus des Meeres',
  'Subway',
  'Brot',
  'Bubbles',
  'Backwerk',
  'C&A',
  'Kika',
  'Bares',
  'La pura',
]);

const ACTIVE_SOURCES = SOURCES.filter((source) => !DISABLED_SOURCE_NAMES.has(source.name));

// ============================================
// HELPER: Fetch HTML
// ============================================
async function readLimitedText(response, maxBytes = MAX_HTML_BYTES) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    text += decoder.decode(value, { stream: true });
    if (bytes >= maxBytes) {
      await reader.cancel('Power Scraper HTML byte limit reached');
      break;
    }
  }
  text += decoder.decode();
  return text;
}

async function fetchHTML(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs || FETCH_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'FreeFinder Power Scraper/5.2 (+https://github.com/ataalla24-ux/deal-finder)',
        'accept-language': 'de-AT,de;q=0.9,en;q=0.8',
        accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (contentType && !/(?:text\/html|application\/xhtml\+xml)/i.test(contentType)) {
      throw new Error(`Unsupported content type: ${contentType}`);
    }
    const html = await readLimitedText(response, Number(options.maxBytes || MAX_HTML_BYTES));
    return { html, finalUrl: response.url || url, bytes: Buffer.byteLength(html) };
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`Timeout after ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function stableDealId(parts) {
  const hash = crypto.createHash('sha1').update(parts.filter(Boolean).join('|')).digest('hex').slice(0, 12);
  return `power-${hash}`;
}

function resolveDealUrl(rawUrl, sourceUrl) {
  const value = cleanUiNoiseText(rawUrl);
  if (!value || /^javascript:/i.test(value)) return '';
  try {
    return new URL(value, sourceUrl).toString();
  } catch {
    return '';
  }
}

function buildQualityScore(title, source) {
  const text = cleanUiNoiseText(title).toLowerCase();
  let score = 26;
  if (/(gratis|kostenlos|free|1\+1|bogo|geschenk)/i.test(text)) score += 28;
  else if (/(rabatt|sale|aktion|angebot|deal|coupon|gutschein|voucher|%|€)/i.test(text)) score += 16;
  if (['essen', 'kaffee', 'supermarkt', 'fitness', 'kultur'].includes(source.category)) score += 10;
  if (text.length >= 18 && text.length <= 84) score += 8;
  if (/(lieferung|versand)/i.test(text)) score -= 24;
  if (/(überblick|jetzt entdecken|sommer|winter|urlaubsangebote)/i.test(text)) score -= 20;
  if (source.category === 'technik') score -= 10;
  if (source.category === 'reisen') score -= 6;
  return Math.max(20, Math.min(86, score));
}

function normalizePowerDeal(deal, sourceLabel) {
  const normalized = normalizeDealRecord({
    ...deal,
    source: deal.source || sourceLabel,
    qualityScore: Number(deal.qualityScore || 0),
    discoveredAt: deal.discoveredAt || new Date().toISOString(),
  });

  return {
    ...normalized,
    id: deal.id || stableDealId([normalized.brand, normalized.title, normalized.url, normalized.source]),
    source: deal.source || sourceLabel,
    qualityScore: Number(normalized.qualityScore || deal.qualityScore || 42),
    votes: Number(normalized.votes || deal.votes || 1),
    priority: Number(deal.priority || 3),
    discoveredAt: deal.discoveredAt || new Date().toISOString(),
  };
}

function cleanPowerText(value) {
  return cleanUiNoiseText(String(value || '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&euro;|&#8364;/gi, '€'));
}

function hasConcretePowerDealSignal(value, source = {}) {
  const text = cleanPowerText(value);
  if (!text || /^(?:angebote?|aktionen?|deals?|sale|gutscheine?|coupons?|mehr erfahren|jetzt entdecken)$/i.test(text)) {
    return false;
  }
  if (/\b(?:(?:gratis|kostenlos(?:e[rmns]?|en)?|free)\s+(?:versand|lieferung|shipping|delivery|abholung|filialabholung|retoure|rücksendung|ruecksendung|gravur|ressourcen|resource|tools?)|(?:versand|lieferung|shipping|delivery|abholung|retoure|rücksendung|ruecksendung)\s+(?:gratis|kostenlos|free))\b/i.test(text)) {
    return false;
  }
  const explicitPromotion = /(?:\b(?:gratis|kostenlos(?:e[rmns]?|en)?|kostenfrei|free)\b|\b1\s*[+&]\s*1\b|\b2\s*(?:für|fuer|for)\s*1\b|\b\d{1,2}\s*%\s*(?:rabatt|off|discount)?\b|\b(?:statt|reduziert\s+von)\s*(?:€\s*)?\d{1,3}(?:[,.]\d{1,2})?\b)/i;
  const explicitCouponCode = /\b(?:mit\s+(?:dem\s+)?code|use\s+code|gutscheincode|aktionscode|couponcode)\s*[:\-]?\s*[a-z0-9][a-z0-9_-]{2,}\b/i;
  if (explicitPromotion.test(text) || explicitCouponCode.test(text)) return true;

  const localFoodCategory = /^(?:essen|kaffee|supermarkt)$/i.test(cleanPowerText(source.category));
  const localFoodPrice = /\b(?:nur|um|für|fuer|ab\s+\d+\s+stück|ab\s+\d+\s+stueck)\s*(?:je\s*)?(?:€\s*)?\d{1,2}(?:[,.]\d{1,2})?\s*(?:€|euro|eur)?\b/i;
  const namedPromotionPrice = /\b(?:aktion|angebot|deal|special|kombiaktion|kaffeejause|bäckerjause|baeckerjause)\b[^.!?]{0,100}(?:€\s*)?\d{1,3}(?:[,.]\d{1,2})?/i;
  return localFoodCategory && (namedPromotionPrice.test(text) || localFoodPrice.test(text));
}

// ============================================
// HELFER: Extract Deals from HTML (simplified)
// ============================================
function extractDealsFromHTML(html, source) {
  const deals = [];
  
  // Simple extraction - look for links with deal-like text
  const linkRegex = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const url = resolveDealUrl(match[1] || match[2] || match[3], source.url);
    const text = cleanPowerText(match[4]);
    
    if (text.length > 10 && url && !url.includes('cookie')) {
      if (hasConcretePowerDealSignal(text, source)) {
        const candidate = normalizePowerDeal({
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
          qualityScore: buildQualityScore(text, source),
          discoveredAt: new Date().toISOString(),
        }, source.name);

        const persistedEvidence = [candidate.title, candidate.description].filter(Boolean).join(' ');
        if (hasConcretePowerDealSignal(persistedEvidence, source) && !isGenericJunkDeal(candidate)) {
          deals.push(candidate);
        }
      }
    }
  }
  
  return deals
    .sort((a, b) => (b.qualityScore || 0) - (a.qualityScore || 0))
    .slice(0, MAX_DEALS_PER_SOURCE);
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function dedupeDeals(deals) {
  const byKey = new Map();
  for (const deal of deals) {
    const key = `${cleanUiNoiseText(deal.url).toLowerCase()}|${cleanUiNoiseText(deal.title).toLowerCase()}`;
    if (!key || key === '|') continue;
    const current = byKey.get(key);
    if (!current || Number(deal.qualityScore || 0) > Number(current.qualityScore || 0)) byKey.set(key, deal);
  }
  return [...byKey.values()];
}

// ============================================
// MAIN
// ============================================
async function main() {
  const startedAt = RUN_STARTED_AT;
  console.log('🚀 POWER SCRAPER V5 - AKTUALISIERT');
  console.log('📅', new Date().toLocaleDateString('de-AT'));
  console.log('='.repeat(40));
  
  if (INCLUDE_BASE_DEALS) {
    console.log(`📊 ${BASE_DEALS.length} Basis-Deals geladen`);
  } else {
    console.log('📊 Daily-Modus ohne statische Basis-Deals');
  }
  
  // Scrape dynamic sources
  console.log(`\n📡 Scraping ${ACTIVE_SOURCES.length} Quellen...\n`);
  
  const sourceResults = await mapWithConcurrency(ACTIVE_SOURCES, FETCH_CONCURRENCY, async (source) => {
    const sourceStartedAt = Date.now();
    try {
      console.log(`🌐 ${source.name}...`);
      const response = await fetchHTML(source.url);
      const html = response.html;
      const deals = extractDealsFromHTML(html, source);
      console.log(`   → ${deals.length} Deals gefunden`);
      return {
        source: source.name,
        url: source.url,
        finalUrl: response.finalUrl,
        status: 'ok',
        deals: deals.length,
        bytes: response.bytes,
        durationMs: Date.now() - sourceStartedAt,
        rows: deals,
      };
    } catch (error) {
      console.log(`   ❌ ${error.message}`);
      return {
        source: source.name,
        url: source.url,
        status: 'error',
        deals: 0,
        durationMs: Date.now() - sourceStartedAt,
        error: error.message,
        rows: [],
      };
    }
  });
  const scrapedDeals = sourceResults.flatMap((result) => result.rows);
  
  const normalizedBaseDeals = INCLUDE_BASE_DEALS
    ? BASE_DEALS
        .map((deal) => normalizePowerDeal({
          ...deal,
          qualityScore: Number(deal.qualityScore || 72),
          discoveredAt: deal.discoveredAt || new Date().toISOString(),
        }, 'power-scraper-v5'))
    : [];

  // Combine base + scraped
  const allDeals = dedupeDeals([...normalizedBaseDeals, ...scrapedDeals]);
  
  // Sort: freebies first, then hot, then quality, then priority
  allDeals.sort((a, b) => {
    if (a.type === 'gratis' && b.type !== 'gratis') return -1;
    if (a.type !== 'gratis' && b.type === 'gratis') return 1;
    if (a.hot && !b.hot) return -1;
    if (!a.hot && b.hot) return 1;
    if ((b.qualityScore || 0) !== (a.qualityScore || 0)) return (b.qualityScore || 0) - (a.qualityScore || 0);
    return (a.priority || 99) - (b.priority || 99);
  });

  const finalDeals = allDeals;
  
  // Output
  const output = {
    lastUpdated: new Date().toISOString(),
    source: 'power-scraper-v5',
    totalDeals: finalDeals.length,
    deals: finalDeals
  };
  
  const outputPath = path.join(__dirname, '..', 'docs', 'deals-pending-power.json');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  const reportPath = path.join(__dirname, '..', 'docs', 'power-scraper-report.json');
  const sourceReport = sourceResults.map(({ rows, ...result }) => result);
  const report = {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    config: {
      includeBaseDeals: INCLUDE_BASE_DEALS,
      sourceCount: ACTIVE_SOURCES.length,
      concurrency: FETCH_CONCURRENCY,
      timeoutMs: FETCH_TIMEOUT_MS,
      maxHtmlBytes: MAX_HTML_BYTES,
      maxDealsPerSource: MAX_DEALS_PER_SOURCE,
    },
    summary: {
      healthySources: sourceReport.filter((result) => result.status === 'ok').length,
      failedSources: sourceReport.filter((result) => result.status === 'error').length,
      rawDeals: scrapedDeals.length,
      acceptedDeals: finalDeals.length,
    },
    sources: sourceReport,
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  const failedSources = sourceReport.filter((result) => result.status === 'error');
  writePipelineRunReport(buildPipelineRunReport({
    sourceKey: SOURCE_KEY,
    sourceLabel: SOURCE_LABEL,
    status: failedSources.length > 0 ? 'completed-with-errors' : 'completed',
    startedAt,
    finishedAt: new Date(),
    outputFile: OUTPUT_PATH,
    rawCandidates: scrapedDeals.length,
    normalizedCandidates: finalDeals.length,
    verifiedCandidates: 0,
    acceptedDeals: finalDeals.length,
    errors: failedSources.map((result) => `${result.source}: ${result.error}`),
    diagnostics: {
      healthySources: sourceReport.filter((result) => result.status === 'ok').length,
      failedSources: failedSources.length,
      sourceCount: ACTIVE_SOURCES.length,
      concurrency: FETCH_CONCURRENCY,
      timeoutMs: FETCH_TIMEOUT_MS,
    },
  }));
  
  console.log('\n' + '='.repeat(40));
  console.log(`✅ ${finalDeals.length} Deals gespeichert`);
  console.log(`📁 ${outputPath}`);
  console.log(`📝 ${reportPath}`);
  console.log(`🔥 ${finalDeals.filter(d => d.hot).length} Hot Deals`);
  console.log(`🆓 ${finalDeals.filter(d => d.type === 'gratis').length} Gratis Deals`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      writeFailedPipelineRunReport({
        sourceKey: SOURCE_KEY,
        sourceLabel: SOURCE_LABEL,
        startedAt: RUN_STARTED_AT,
        outputFile: OUTPUT_PATH,
        error,
      });
      console.error('❌ power-scraper fehlgeschlagen:', error);
      process.exit(1);
    });
}

export {
  extractDealsFromHTML,
  fetchHTML,
  hasConcretePowerDealSignal,
};

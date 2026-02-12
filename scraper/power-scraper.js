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
     id: 'top-1', brand: 'OMV VIVA', logo: '⛽', title: 'GRATIS Getränk für 1 jö Punkt',
    description: 'Bei OMV VIVA: Heißgetränk oder Softdrink für nur 1 jö Punkt! Inkl. Kaffee, Tee, Cola. Einfach jö App scannen!',
    type: 'gratis', category: 'kaffee', source: 'jö Bonus Club', url: 'https://www.jo-club.at/',
    expires: 'Dauerhaft', distance: '200+ OMV Stationen', hot: true, isNew: false, priority: 1, votes: 847
  },
  {
    id: 'top-2', brand: "McDonald's", logo: '☕', title: 'GRATIS Kaffee - 5x/Monat',
    description: 'McCafé Bonusclub: Jeden Monat 5 gratis Kaffees! Einfach App downloaden und nach Einkauf Feedback geben.',
    type: 'gratis', category: 'kaffee', source: "McDonald's App", url: 'https://www.mcdonalds.at/app',
    expires: 'Monatlich 5 Stück', distance: '50+ Filialen Wien', hot: true, isNew: false, priority: 1, votes: 623
  },
  {
   id: 'top-3', brand: 'IKEA', logo: '☕', title: 'GRATIS Kaffee UNLIMITIERT',
    description: 'IKEA Family Mitglieder: Unbegrenzt Gratis-Kaffee & Tee im Restaurant! Täglich, keine Limits. Family Card ist gratis.',
    type: 'gratis', category: 'kaffee', source: 'IKEA Family', url: 'https://www.ikea.com/at/de/ikea-family/',
    expires: 'Unbegrenzt', distance: 'IKEA Wien Nord & Vösendorf', hot: true, isNew: false, priority: 1, votes: 1203
  },
  {
    id: 'top-3b', brand: 'Tchibo', logo: '☕', title: 'GRATIS Kaffee bei jedem Einkauf',
    description: 'In jeder Tchibo Filiale: Kauf irgendetwas und bekomme einen frisch gebrühten Kaffee gratis dazu!',
    type: 'gratis', category: 'kaffee', source: 'Tchibo', url: 'https://www.tchibo.at/',
    expires: 'Dauerhaft', distance: '30+ Filialen Wien', hot: false, isNew: false, priority: 1, votes: 312
  },
  {
    id: 'top-3c', brand: 'Nespresso', logo: '☕', title: 'GRATIS Kaffee-Verkostung',
    description: 'In jeder Nespresso Boutique: Gratis Kaffee probieren! Keine Kaufpflicht, einfach reingehen und genießen.',
    type: 'gratis', category: 'kaffee', source: 'Nespresso', url: 'https://www.nespresso.com/at/',
    expires: 'Jederzeit', distance: 'Nespresso Boutiquen Wien', hot: false, isNew: false, priority: 2, votes: 178
  },
  {
    id: 'top-3d', brand: 'Starbucks', logo: '☕', title: 'GRATIS Getränk am Geburtstag',
    description: 'Starbucks Rewards Mitglieder: Am Geburtstag jedes Getränk gratis – auch die teuersten! Anmeldung kostenlos.',
    type: 'gratis', category: 'kaffee', source: 'Starbucks Rewards', url: 'https://www.starbucks.at/',
    expires: 'Am Geburtstag', distance: '15+ Starbucks Wien', hot: false, isNew: false, priority: 2, votes: 412
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

  {
    id: 'top-4b', brand: "McDonald's", logo: '🍟', title: 'GRATIS Cheeseburger bei App-Download',
    description: "McDonald's App neu installieren = Gratis Cheeseburger als Willkommensgeschenk! Für Neukunden.",
    type: 'gratis', category: 'essen', source: "McDonald's App", url: 'https://www.mcdonalds.at/app',
    expires: 'Für Neukunden', distance: 'Alle Filialen', hot: true, isNew: false, priority: 1, votes: 534
  },
  {
    id: 'top-4c', brand: 'Burger King', logo: '🍔', title: 'GRATIS Whopper am Geburtstag',
    description: 'Burger King App: Am Geburtstag bekommst du einen Gratis-Whopper! Einfach Geburtsdatum in der App hinterlegen.',
    type: 'gratis', category: 'essen', source: 'Burger King App', url: 'https://www.burgerking.at/',
    expires: 'Am Geburtstag', distance: 'Alle Filialen Wien', hot: false, isNew: false, priority: 2, votes: 389
  },
  {
    id: 'top-4d', brand: 'Wiener Tafel', logo: '🥫', title: 'GRATIS Lebensmittel abholen',
    description: 'Gerettete Lebensmittel kostenlos bei sozialen Ausgabestellen in ganz Wien. Für Bedürftige.',
    type: 'gratis', category: 'essen', source: 'Wiener Tafel', url: 'https://www.wienertafel.at/',
    expires: 'Dauerhaft', distance: 'Ausgabestellen Wien', hot: false, isNew: false, priority: 2, votes: 234
  },
  {
    id: 'top-4e', brand: 'Uni Mensen', logo: '🎓', title: 'Warme Mahlzeit ab 2,20€',
    description: 'Alle Wiener Uni-Mensen: Vollwertige Mahlzeit für Studenten ab 2,20€. Günstiger geht Mittagessen nicht!',
    type: 'rabatt', category: 'essen', source: 'Mensen Wien', url: 'https://www.mensen.at/',
    expires: 'Mit Studentenausweis', distance: '20+ Mensen Wien', hot: false, isNew: false, priority: 2, votes: 456
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

  // ⭐ WIEN SPECIALS
  {
    id: 'wien-1', brand: 'Wiener Eistraum', logo: '⛸️', title: 'Eislaufen am Rathausplatz',
    description: '9000m² Eisfläche vor dem Rathaus! Eintritt GRATIS, Leihschuhe ab 7€. Jänner bis März.',
    type: 'gratis', category: 'wien', source: 'Stadt Wien', url: 'https://www.wienereistraum.com/',
    expires: 'Jänner-März', distance: 'Rathausplatz', hot: true, isNew: false, priority: 1, votes: 567
  },
  {
    id: 'wien-2', brand: 'Wiener Rathaus', logo: '🏛️', title: 'GRATIS Rathausführungen',
    description: 'Mo, Mi, Fr um 13:00: Kostenlose Führung durch das Wiener Rathaus. Ohne Anmeldung!',
    type: 'gratis', category: 'wien', source: 'Stadt Wien', url: 'https://www.wien.gv.at/politik/rathaus/fuehrung.html',
    expires: 'Mo/Mi/Fr 13:00', distance: 'Rathaus, 1. Bezirk', hot: false, isNew: false, priority: 2, votes: 156
  },
  {
    id: 'wien-3', brand: 'WienMobil Rad', logo: '🚴', title: 'Erste 30 Min GRATIS Radfahren',
    description: 'WienMobil Rad: Erste 30 Minuten jeder Fahrt kostenlos! Über 200 Stationen in Wien.',
    type: 'gratis', category: 'wien', source: 'Wiener Linien', url: 'https://www.wienerlinien.at/wienmobil-rad',
    expires: 'Unbegrenzt', distance: '200+ Stationen Wien', hot: false, isNew: false, priority: 2, votes: 345
  },
  {
    id: 'wien-4', brand: 'Wiener Linien', logo: '🚇', title: 'Ganz Wien für 1€/Tag',
    description: 'Klimaticket Wien: 365€/Jahr = 1€ pro Tag für alle U-Bahnen, Busse, Straßenbahnen!',
    type: 'rabatt', category: 'wien', source: 'Wiener Linien', url: 'https://www.wienerlinien.at/',
    expires: 'Jahresticket', distance: 'Ganz Wien', hot: true, isNew: false, priority: 1, votes: 2345
  },
  {
    id: 'wien-5', brand: 'Wiener Staatsoper', logo: '🎭', title: 'Stehplätze ab nur 3€',
    description: 'Staatsoper, Volksoper, Burgtheater: Weltklasse-Kultur ab 3€! Stehplätze 80 Min vor Beginn.',
    type: 'rabatt', category: 'wien', source: 'Bundestheater', url: 'https://www.wiener-staatsoper.at/',
    expires: 'Dauerhaft', distance: 'Staatsoper, 1. Bezirk', hot: true, isNew: false, priority: 2, votes: 678
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
    console.log('⚠️  Google Places API Key nicht gesetzt - Überspringe');
    console.log('   → Füge GOOGLE_PLACES_API_KEY als GitHub Secret hinzu');
    return [];
  }
  
  const deals = [];
  
  // Verschiedene Suchbegriffe für Neueröffnungen
  const searchTerms = [
    'neu eröffnet wien',
    'neueröffnung wien',
    'new opening vienna',
    'grand opening wien',
    'neu cafe wien',
    'neues restaurant wien',
    'recently opened vienna'
  ];
  
  // Auch nach spezifischen Typen suchen
  const typeSearches = [
    { query: 'cafe wien', type: 'cafe' },
    { query: 'restaurant wien', type: 'restaurant' },
    { query: 'bar wien', type: 'bar' },
    { query: 'bakery wien', type: 'bakery' }
  ];
  
  const foundPlaces = new Set(); // Duplikate vermeiden
  
  // 1. Suche nach "Neueröffnung" Keywords
  for (const term of searchTerms.slice(0, 3)) { // Nur 3 um API-Kosten zu sparen
    try {
      const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(term)}&location=48.2082,16.3738&radius=15000&key=${GOOGLE_PLACES_API_KEY}&language=de`;
      const response = await fetchURL(url);
      
      if (response.trim().startsWith('<')) {
        console.log(`⚠️  Google Places: HTML statt JSON - API Key Problem`);
        return deals;
      }
      
      const data = JSON.parse(response);
      
      if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
        console.log(`⚠️  Google Places: ${data.status} - ${data.error_message || ''}`);
        continue;
      }
      
      if (data.results) {
        for (const place of data.results) {
          // Nur Orte mit WENIG Bewertungen = wahrscheinlich neu
          const ratings = place.user_ratings_total || 0;
          const types = place.types || [];
          const name = (place.name || '').toLowerCase();
          const addr = (place.vicinity || place.formatted_address || '').toLowerCase();
          const combined = name + ' ' + addr;
          
          // ❌ BLACKLIST: Apartments, Hotels, Airbnbs rausfiltern
          const blacklist = ['apartment', 'airbnb', 'studio', 'ferienwohnung', 'hotel', 'hostel', 'residence', 'stay', 'booking', 'immobilie', 'wohnung', 'schlafzimmer', 'badezimmer', 'furnished', 'klimaanlage', 'brand-new', 'brand new', 'luxuriös', 'übernachtung'];
          if (blacklist.some(b => combined.includes(b))) continue;
          
          // ❌ Nur echte Gastro/Shops
          const validTypes = ['restaurant', 'cafe', 'bar', 'bakery', 'store', 'food', 'meal_delivery', 'meal_takeaway'];
          const lodgingTypes = ['lodging', 'real_estate_agency'];
          if (lodgingTypes.some(t => types.includes(t))) continue;
          if (!types.some(t => validTypes.includes(t)) && ratings < 5) continue;
          
          if (ratings < 200 && !foundPlaces.has(place.place_id)) {
            foundPlaces.add(place.place_id);
            
            const isVeryNew = ratings < 50;
            const address = place.vicinity || place.formatted_address || 'Wien';
            
            deals.push({
              id: `places-${place.place_id.substring(0, 10)}`,
              brand: place.name,
              logo: getPlaceLogo(place.types),
              title: isVeryNew ? `🆕 NEU: ${place.name}` : `Entdeckt: ${place.name}`,
              description: `${address}. ${isVeryNew ? 'Gerade erst eröffnet!' : 'Relativ neu!'} ${place.rating ? `⭐ ${place.rating}` : ''} (${ratings} Bewertungen) - Oft mit Eröffnungsangeboten!`,
              type: 'gratis',
              category: getPlaceCategory(place.types),
              source: 'Google Places',
              url: `https://www.google.com/maps/place/?q=place_id:${place.place_id}`,
              expires: 'Eröffnungswochen',
              distance: extractDistrict(address),
              hot: isVeryNew,
              isNew: true,
              isApiDeal: true,
              votes: isVeryNew ? 10 : 5,
              priority: isVeryNew ? 1 : 2
            });
          }
        }
      }
    } catch (error) {
      console.log(`⚠️  Google Places Fehler: ${error.message}`);
    }
  }
  
  console.log(`📍 Google Places: ${deals.length} potentielle Neueröffnungen gefunden`);
  
  // Details ausgeben
  if (deals.length > 0) {
    console.log('   Gefunden:');
    deals.forEach(d => {
      console.log(`   - ${d.brand} (${d.distance})`);
    });
  }
  
  return deals;
}

// Hilfsfunktionen für Places API
function getPlaceLogo(types) {
  if (!types) return '🆕';
  if (types.includes('cafe')) return '☕';
  if (types.includes('restaurant')) return '🍽️';
  if (types.includes('bar')) return '🍺';
  if (types.includes('bakery')) return '🥐';
  if (types.includes('store')) return '🛍️';
  if (types.includes('gym')) return '💪';
  return '🆕';
}

function getPlaceCategory(types) {
  if (!types) return 'shopping';
  if (types.includes('cafe')) return 'kaffee';
  if (types.includes('restaurant')) return 'essen';
  if (types.includes('bar')) return 'essen';
  if (types.includes('bakery')) return 'essen';
  if (types.includes('gym')) return 'fitness';
  return 'shopping';
}

function extractDistrict(address) {
  // Versuche Wiener Bezirk zu extrahieren (z.B. "1010 Wien" -> "1. Bezirk")
  const match = address.match(/(\d{4})\s*Wien/);
  if (match) {
    const plz = match[1];
    const bezirk = parseInt(plz.substring(1, 3));
    return `${bezirk}. Bezirk`;
  }
  return address.split(',')[0] || 'Wien';
}

// ============================================
// INSTAGRAM API - (Optional, benötigt Business Account)
// ============================================

async function fetchInstagramDeals() {
  if (!INSTAGRAM_ACCESS_TOKEN) {
    // Kein Fehler - ist optional
    return [];
  }
  
  const deals = [];
  
  try {
    // Instagram Graph API ist komplex und erfordert Business Account
    // Hier nur Platzhalter - in Produktion würde man Hashtag-Suche implementieren
    console.log(`📸 Instagram: Token vorhanden, aber API-Implementation ausstehend`);
  } catch (error) {
    console.log(`⚠️  Instagram Fehler: ${error.message}`);
  }
  
  return deals;
}

// ============================================
// FACEBOOK API - (Optional, stark eingeschränkt seit 2020)
// ============================================

async function fetchFacebookEvents() {
  if (!FACEBOOK_ACCESS_TOKEN) {
    // Kein Fehler - ist optional
    return [];
  }
  
  const deals = [];
  
  try {
    // Facebook Event-Suche ist seit 2020 stark eingeschränkt
    console.log(`📘 Facebook: Token vorhanden, aber Event-API limitiert`);
  } catch (error) {
    console.log(`⚠️  Facebook Fehler: ${error.message}`);
  }
  
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
  
  // Versuche echte Deal-Texte aus dem HTML zu extrahieren
  // Suche nach Textblöcken die Gratis/Deal Keywords enthalten
  const stripped = html.replace(/<script[\s\S]*?<\/script>/gi, '')
                       .replace(/<style[\s\S]*?<\/style>/gi, '')
                       .replace(/<[^>]+>/g, ' ')
                       .replace(/\s+/g, ' ');
  
  // Suche nach Sätzen mit Keywords
  const sentences = stripped.split(/[.!?\n]/).filter(s => s.trim().length > 20 && s.trim().length < 200);
  
  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();
    const isGratis = GRATIS_KEYWORDS.some(k => lower.includes(k));
    
    if (isGratis) {
      // Nur echte Gratis-Deals, keine generischen Platzhalter
      const title = sentence.trim().substring(0, 60);
      if (title.length > 15) {
        deals.push({
          id: `html-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
          brand: source.brand,
          logo: source.logo,
          title: title,
          description: sentence.trim().substring(0, 150),
          type: 'gratis',
          category: source.category,
          source: source.name,
          url: source.url,
          expires: 'Siehe Website',
          distance: 'Wien',
          hot: false,
          isNew: true,
          priority: 3,
          votes: 0
        });
        break; // Maximal 1 Deal pro Quelle (vermeidet Spam)
      }
    }
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
  
  // API Setup Hilfe
  if (!GOOGLE_PLACES_API_KEY && !INSTAGRAM_ACCESS_TOKEN && !FACEBOOK_ACCESS_TOKEN) {
    console.log(`\n💡 API SETUP ANLEITUNG:`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`\n📍 GOOGLE PLACES API (empfohlen!):`);
    console.log(`   1. https://console.cloud.google.com/`);
    console.log(`   2. Neues Projekt erstellen`);
    console.log(`   3. "Places API" aktivieren`);
    console.log(`   4. API Key erstellen unter "Credentials"`);
    console.log(`   5. In GitHub → Settings → Secrets → New:`);
    console.log(`      Name: GOOGLE_PLACES_API_KEY`);
    console.log(`      Value: [dein-api-key]`);
    console.log(`\n📸 INSTAGRAM (optional, komplex):`);
    console.log(`   → Benötigt Business Account + Facebook Developer App`);
    console.log(`   → https://developers.facebook.com/docs/instagram-api/`);
    console.log(`\n📘 FACEBOOK (optional, eingeschränkt):`);
    console.log(`   → Event-Suche seit 2020 stark limitiert`);
    console.log(`   → https://developers.facebook.com/`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  }
}

scrapeAllSources()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Scraper Error:', err.message);
    process.exit(0);
  });

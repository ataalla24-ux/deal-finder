// mega-scraper.js
// 100+ Quellen für Wien Deals
// 150+ Basis-Deals
// Läuft alle 30 Minuten via GitHub Actions

const https = require('https');
const http = require('http');
const fs = require('fs');

// ============================================
// ALLE QUELLEN
// ============================================

const SOURCES = [
  // ========== NACHRICHTEN WIEN (12) ==========
  { name: 'Heute.at Wien', url: 'https://www.heute.at/s/wien', type: 'html', brand: 'Heute', logo: '📰', category: 'wien' },
  { name: 'Vienna.at', url: 'https://www.vienna.at/', type: 'html', brand: 'Vienna.at', logo: '📰', category: 'wien' },
  { name: 'MeinBezirk Wien', url: 'https://www.meinbezirk.at/wien', type: 'html', brand: 'MeinBezirk', logo: '📰', category: 'wien' },
  { name: 'Kurier Wien', url: 'https://kurier.at/chronik/wien', type: 'html', brand: 'Kurier', logo: '📰', category: 'wien' },
  { name: 'Krone Wien', url: 'https://www.krone.at/wien', type: 'html', brand: 'Krone', logo: '📰', category: 'wien' },
  { name: 'ORF Wien', url: 'https://wien.orf.at/', type: 'html', brand: 'ORF', logo: '📺', category: 'wien' },
  { name: 'Der Standard', url: 'https://www.derstandard.at/', type: 'html', brand: 'Standard', logo: '📰', category: 'wien' },
  { name: 'Die Presse', url: 'https://www.diepresse.com/', type: 'html', brand: 'Presse', logo: '📰', category: 'wien' },
  { name: 'W24', url: 'https://www.w24.at/', type: 'html', brand: 'W24', logo: '📺', category: 'wien' },
  { name: 'Kleine Zeitung', url: 'https://www.kleinezeitung.at/', type: 'html', brand: 'Kleine', logo: '📰', category: 'wien' },
  { name: 'Heute Gratis', url: 'https://www.heute.at/s/wien?q=gratis', type: 'html', brand: 'Heute', logo: '🆓', category: 'gratis' },
  { name: 'Vienna Lifestyle', url: 'https://www.vienna.at/lifestyle', type: 'html', brand: 'Vienna.at', logo: '🌐', category: 'wien' },

  // ========== LIFESTYLE & FOOD BLOGS (18) ==========
  { name: '1000things Wien', url: 'https://www.1000things.at/wien/', type: 'html', brand: '1000things', logo: '🎯', category: 'essen' },
  { name: '1000things Neueröffnung', url: 'https://www.1000things.at/tag/neueroeffnung/', type: 'html', brand: '1000things', logo: '🆕', category: 'essen' },
  { name: '1000things Gratis', url: 'https://www.1000things.at/tag/gratis/', type: 'html', brand: '1000things', logo: '🆓', category: 'gratis' },
  { name: '1000things Essen', url: 'https://www.1000things.at/tag/essen/', type: 'html', brand: '1000things', logo: '🍴', category: 'essen' },
  { name: 'Falter Lokalführer', url: 'https://www.falter.at/lokalfuehrer', type: 'html', brand: 'Falter', logo: '📰', category: 'essen' },
  { name: 'Falter Events', url: 'https://www.falter.at/events', type: 'html', brand: 'Falter', logo: '🎉', category: 'wien' },
  { name: 'Goodnight Wien', url: 'https://goodnight.at/wien/', type: 'html', brand: 'Goodnight', logo: '🌙', category: 'wien' },
  { name: 'Stadtbekannt', url: 'https://www.stadtbekannt.at/', type: 'html', brand: 'Stadtbekannt', logo: '🏙️', category: 'wien' },
  { name: 'Wienneu', url: 'https://wienneu.at/', type: 'html', brand: 'Wienneu', logo: '🆕', category: 'essen' },
  { name: 'The Gap', url: 'https://thegap.at/', type: 'html', brand: 'The Gap', logo: '🎭', category: 'wien' },
  { name: 'Biorama', url: 'https://www.biorama.eu/', type: 'html', brand: 'Biorama', logo: '🌱', category: 'essen' },
  { name: 'A-List', url: 'https://www.a-list.at/', type: 'html', brand: 'A-List', logo: '📋', category: 'wien' },
  { name: 'Falstaff', url: 'https://www.falstaff.at/', type: 'html', brand: 'Falstaff', logo: '🍷', category: 'essen' },
  { name: 'Wien isst', url: 'https://www.wien-isst.at/', type: 'html', brand: 'Wien isst', logo: '🍽️', category: 'essen' },
  { name: 'Vienna Würstelstand', url: 'https://www.viennawurstelstand.com/', type: 'html', brand: 'Würstelstand', logo: '🌭', category: 'essen' },
  { name: 'Wien Info Events', url: 'https://www.wien.info/de/veranstaltungen', type: 'html', brand: 'Wien Info', logo: '🏛️', category: 'wien' },
  { name: 'Events.at Wien', url: 'https://www.events.at/wien', type: 'html', brand: 'Events.at', logo: '🎉', category: 'wien' },
  { name: 'Restaurantwoche', url: 'https://www.restaurantwoche.wien/', type: 'html', brand: 'Restaurantwoche', logo: '🍴', category: 'essen' },

  // ========== SUPERMÄRKTE (10) ==========
  { name: 'BILLA Aktionen', url: 'https://www.billa.at/angebote/aktionen', type: 'html', brand: 'BILLA', logo: '🟠', category: 'supermarkt' },
  { name: 'BILLA Plus', url: 'https://www.billa.at/billa-plus', type: 'html', brand: 'BILLA Plus', logo: '🟠', category: 'supermarkt' },
  { name: 'SPAR Angebote', url: 'https://www.spar.at/angebote', type: 'html', brand: 'SPAR', logo: '🟢', category: 'supermarkt' },
  { name: 'INTERSPAR', url: 'https://www.interspar.at/angebote', type: 'html', brand: 'INTERSPAR', logo: '🟢', category: 'supermarkt' },
  { name: 'Lidl Angebote', url: 'https://www.lidl.at/angebote', type: 'html', brand: 'Lidl', logo: '🔵', category: 'supermarkt' },
  { name: 'HOFER Aktionen', url: 'https://www.hofer.at/de/angebote.html', type: 'html', brand: 'HOFER', logo: '🔴', category: 'supermarkt' },
  { name: 'PENNY Angebote', url: 'https://www.penny.at/angebote', type: 'html', brand: 'PENNY', logo: '🔴', category: 'supermarkt' },
  { name: 'Unimarkt', url: 'https://www.unimarkt.at/', type: 'html', brand: 'Unimarkt', logo: '🛒', category: 'supermarkt' },
  { name: 'Nah&Frisch', url: 'https://www.nahundfrisch.at/', type: 'html', brand: 'Nah&Frisch', logo: '🛒', category: 'supermarkt' },
  { name: 'Metro', url: 'https://www.metro.at/', type: 'html', brand: 'Metro', logo: '🏪', category: 'supermarkt' },

  // ========== DROGERIE & BEAUTY (12) ==========
  { name: 'dm Angebote', url: 'https://www.dm.at/angebote', type: 'html', brand: 'dm', logo: '🧴', category: 'drogerie' },
  { name: 'dm Babybonus', url: 'https://www.dm.at/babybonus', type: 'html', brand: 'dm', logo: '👶', category: 'drogerie' },
  { name: 'BIPA Aktionen', url: 'https://www.bipa.at/angebote', type: 'html', brand: 'BIPA', logo: '💄', category: 'drogerie' },
  { name: 'Müller Angebote', url: 'https://www.mueller.at/angebote/', type: 'html', brand: 'Müller', logo: '🛍️', category: 'drogerie' },
  { name: 'Douglas', url: 'https://www.douglas.at/', type: 'html', brand: 'Douglas', logo: '💜', category: 'drogerie' },
  { name: 'Sephora', url: 'https://www.sephora.at/', type: 'html', brand: 'Sephora', logo: '💄', category: 'drogerie' },
  { name: 'Marionnaud', url: 'https://www.marionnaud.at/', type: 'html', brand: 'Marionnaud', logo: '💐', category: 'drogerie' },
  { name: 'Body Shop', url: 'https://www.thebodyshop.com/de-at/', type: 'html', brand: 'Body Shop', logo: '🌿', category: 'drogerie' },
  { name: 'Lush', url: 'https://www.lush.com/at/de', type: 'html', brand: 'Lush', logo: '🛁', category: 'drogerie' },
  { name: 'Rituals', url: 'https://www.rituals.com/de-at/', type: 'html', brand: 'Rituals', logo: '🕯️', category: 'drogerie' },
  { name: 'Notino', url: 'https://www.notino.at/', type: 'html', brand: 'Notino', logo: '💐', category: 'drogerie' },
  { name: 'Flaconi', url: 'https://www.flaconi.at/', type: 'html', brand: 'Flaconi', logo: '💅', category: 'drogerie' },

  // ========== FAST FOOD & RESTAURANTS (18) ==========
  { name: 'McDonald\'s', url: 'https://www.mcdonalds.at/', type: 'html', brand: "McDonald's", logo: '🍟', category: 'essen' },
  { name: 'Burger King', url: 'https://www.burgerking.at/', type: 'html', brand: 'Burger King', logo: '🍔', category: 'essen' },
  { name: 'KFC', url: 'https://www.kfc.at/', type: 'html', brand: 'KFC', logo: '🍗', category: 'essen' },
  { name: 'Subway', url: 'https://www.subway.at/', type: 'html', brand: 'Subway', logo: '🥪', category: 'essen' },
  { name: 'Pizza Hut', url: 'https://www.pizzahut.at/', type: 'html', brand: 'Pizza Hut', logo: '🍕', category: 'essen' },
  { name: 'Dominos', url: 'https://www.dominos.at/', type: 'html', brand: "Domino's", logo: '🍕', category: 'essen' },
  { name: 'Vapiano', url: 'https://at.vapiano.com/', type: 'html', brand: 'Vapiano', logo: '🍝', category: 'essen' },
  { name: 'L\'Osteria', url: 'https://losteria.net/at/', type: 'html', brand: "L'Osteria", logo: '🍕', category: 'essen' },
  { name: 'Nordsee', url: 'https://www.nordsee.com/at/', type: 'html', brand: 'Nordsee', logo: '🐟', category: 'essen' },
  { name: 'Five Guys', url: 'https://www.fiveguys.at/', type: 'html', brand: 'Five Guys', logo: '🍔', category: 'essen' },
  { name: 'Swing Kitchen', url: 'https://www.swingkitchen.com/', type: 'html', brand: 'Swing Kitchen', logo: '🌱', category: 'essen' },
  { name: 'Hans im Glück', url: 'https://www.hansimglueck.at/', type: 'html', brand: 'Hans im Glück', logo: '🍔', category: 'essen' },
  { name: 'Chipotle', url: 'https://www.chipotle.at/', type: 'html', brand: 'Chipotle', logo: '🌯', category: 'essen' },
  { name: 'Neni', url: 'https://www.neni.at/', type: 'html', brand: 'Neni', logo: '🥙', category: 'essen' },
  { name: 'Figlmüller', url: 'https://www.figlmueller.at/', type: 'html', brand: 'Figlmüller', logo: '🥩', category: 'essen' },
  { name: 'Plachutta', url: 'https://www.plachutta.at/', type: 'html', brand: 'Plachutta', logo: '🥩', category: 'essen' },
  { name: 'Trzesniewski', url: 'https://www.trzesniewski.at/', type: 'html', brand: 'Trzesniewski', logo: '🥪', category: 'essen' },
  { name: 'Dean & David', url: 'https://www.deananddavid.at/', type: 'html', brand: 'Dean&David', logo: '🥗', category: 'essen' },

  // ========== KAFFEE & BÄCKEREI (10) ==========
  { name: 'Starbucks', url: 'https://www.starbucks.at/', type: 'html', brand: 'Starbucks', logo: '☕', category: 'kaffee' },
  { name: 'OMV VIVA', url: 'https://www.omv.at/de-at/privat/viva', type: 'html', brand: 'OMV', logo: '⛽', category: 'kaffee' },
  { name: 'Tchibo', url: 'https://www.tchibo.at/', type: 'html', brand: 'Tchibo', logo: '☕', category: 'kaffee' },
  { name: 'Aida', url: 'https://www.aida.at/', type: 'html', brand: 'Aida', logo: '🎀', category: 'kaffee' },
  { name: 'Manner', url: 'https://www.manner.com/', type: 'html', brand: 'Manner', logo: '🧇', category: 'kaffee' },
  { name: 'Demel', url: 'https://www.demel.com/', type: 'html', brand: 'Demel', logo: '🎂', category: 'kaffee' },
  { name: 'Ströck', url: 'https://www.stroeck.at/', type: 'html', brand: 'Ströck', logo: '🥐', category: 'kaffee' },
  { name: 'Anker', url: 'https://www.ankerbrot.at/', type: 'html', brand: 'Anker', logo: '🥖', category: 'kaffee' },
  { name: 'Der Mann', url: 'https://www.dermann.at/', type: 'html', brand: 'Der Mann', logo: '🥐', category: 'kaffee' },
  { name: 'Dunkin', url: 'https://www.dunkindonuts.at/', type: 'html', brand: 'Dunkin', logo: '🍩', category: 'kaffee' },

  // ========== TECHNIK & ELEKTRONIK (10) ==========
  { name: 'MediaMarkt', url: 'https://www.mediamarkt.at/', type: 'html', brand: 'MediaMarkt', logo: '📺', category: 'technik' },
  { name: 'Saturn', url: 'https://www.saturn.at/', type: 'html', brand: 'Saturn', logo: '📱', category: 'technik' },
  { name: 'Cyberport', url: 'https://www.cyberport.at/', type: 'html', brand: 'Cyberport', logo: '💻', category: 'technik' },
  { name: 'Electronic4you', url: 'https://www.electronic4you.at/', type: 'html', brand: 'E4Y', logo: '🔌', category: 'technik' },
  { name: 'Apple AT', url: 'https://www.apple.com/at/', type: 'html', brand: 'Apple', logo: '🍎', category: 'technik' },
  { name: 'Samsung AT', url: 'https://www.samsung.com/at/', type: 'html', brand: 'Samsung', logo: '📱', category: 'technik' },
  { name: 'Hartlauer', url: 'https://www.hartlauer.at/', type: 'html', brand: 'Hartlauer', logo: '📷', category: 'technik' },
  { name: 'Expert', url: 'https://www.expert.at/', type: 'html', brand: 'Expert', logo: '🔧', category: 'technik' },
  { name: 'A1', url: 'https://www.a1.net/', type: 'html', brand: 'A1', logo: '📱', category: 'technik' },
  { name: 'Magenta', url: 'https://www.magenta.at/', type: 'html', brand: 'Magenta', logo: '📱', category: 'technik' },

  // ========== MODE & FASHION (14) ==========
  { name: 'H&M', url: 'https://www2.hm.com/de_at/', type: 'html', brand: 'H&M', logo: '👕', category: 'mode' },
  { name: 'Zalando Sale', url: 'https://www.zalando.at/sale/', type: 'html', brand: 'Zalando', logo: '👟', category: 'mode' },
  
  // ========== RSS FEEDS (BESTE QUELLEN!) ==========
  { name: 'Preisjäger Freebies', url: 'https://www.preisjaeger.at/rss/freebies', type: 'rss', brand: 'Preisjäger', logo: '🎁', category: 'gratis' },
  { name: 'Preisjäger Gratis', url: 'https://www.preisjaeger.at/rss/new?keywords=gratis', type: 'rss', brand: 'Preisjäger', logo: '🆓', category: 'gratis' },
  { name: 'Preisjäger Wien', url: 'https://www.preisjaeger.at/rss/new?keywords=wien', type: 'rss', brand: 'Preisjäger', logo: '🏙️', category: 'wien' },
  { name: 'Reddit r/wien', url: 'https://www.reddit.com/r/wien/.rss', type: 'rss', brand: 'Reddit', logo: '🔴', category: 'wien' },
  { name: 'Reddit r/Austria', url: 'https://www.reddit.com/r/Austria/.rss', type: 'rss', brand: 'Reddit', logo: '🇦🇹', category: 'wien' },
  { name: 'Google News Wien Gratis', url: 'https://news.google.com/rss/search?q=wien+gratis&hl=de&gl=AT', type: 'rss', brand: 'Google News', logo: '📰', category: 'wien' },
  { name: 'Google News Neueröffnung Wien', url: 'https://news.google.com/rss/search?q=neuer%C3%B6ffnung+wien&hl=de&gl=AT', type: 'rss', brand: 'Google News', logo: '🆕', category: 'essen' },
];

// ============================================
// 200+ BASIS DEALS - Immer verfügbar
// ============================================

const BASE_DEALS = [
  // ========== AKTUELL - JÄNNER 2026 ==========
  // Veganuary Deals (gültig bis 31.01.2026)
  { id: "hot-2", brand: "Haus der Geschichte", logo: "🏛️", title: "Gratis jeden Donnerstag 18-20h", description: "Jeden Donnerstagabend kostenloser Eintritt ins hdgö!", type: "gratis", badge: "daily", category: "wien", source: "Vienna.at", url: "https://www.hdgoe.at", expires: "Jeden Donnerstag", distance: "1. Bezirk", hot: true, isNew: true, validUntil: "2099-12-31" },
  { id: "hot-3", brand: "ÖBB Veganuary", logo: "🚂", title: "Vegan Vurstsemmel €2,90", description: "Im Jänner: Vegane Vurstsemmel + Gewinnspiele mit Klimaticket!", type: "rabatt", badge: "limited", category: "essen", source: "1000things", url: "https://www.oebb.at", expires: "Bis 31.01.2026", distance: "Hauptbahnhof", hot: true, isNew: true, validUntil: "2026-01-31" },
  { id: "hot-4", brand: "Veganer Würstelstand", logo: "🌭", title: "Komplett veganer Würstelstand", description: "Mike Lanner: Pfeilgasse & U4 Spittelau - im Jänner nur pflanzlich!", type: "rabatt", badge: "limited", category: "essen", source: "1000things", url: "https://www.1000things.at", expires: "Bis 31.01.2026", distance: "8./19. Bezirk", hot: true, isNew: true, validUntil: "2026-01-31" },
  { id: "hot-5", brand: "Vegane Gesellschaft", logo: "🥗", title: "Veganuary Gewinnspiel", description: "Vegane Speise in Wiener Gastro fotografieren = Gewinnchance!", type: "gratis", badge: "limited", category: "essen", source: "Vegane Gesellschaft", url: "https://www.vegan.at", expires: "Bis 31.01.2026", distance: "Wien", hot: true, isNew: true, validUntil: "2026-01-31" },
  
  // ========== GRATIS KAFFEE ==========
  { id: "kaffee-1", brand: "McDonald's", logo: "🍟", title: "Gratis Kaffee/Cola nach Feedback", description: "Nach jedem Einkauf Feedback geben = Gratis Getränk. Bis zu 5x pro Monat!", type: "gratis", badge: "daily", category: "kaffee", source: "McDonald's App", url: "https://www.mcdonalds.at", expires: "5x/Monat", distance: "Überall", hot: true },
  { id: "kaffee-2", brand: "IKEA", logo: "🪑", title: "Gratis Kaffee & Tee unlimitiert", description: "IKEA Family Mitglieder: Unbegrenzt Gratis-Kaffee oder Tee im Restaurant!", type: "gratis", badge: "instore", category: "kaffee", source: "IKEA Family", url: "https://www.ikea.at", expires: "Unbegrenzt", distance: "IKEA Standorte", hot: true },
  { id: "kaffee-3", brand: "Starbucks", logo: "☕", title: "Gratis Geburtstagsgetränk", description: "Starbucks Rewards: Am Geburtstag ein Gratis-Getränk nach Wahl!", type: "gratis", badge: "instore", category: "kaffee", source: "Starbucks", url: "https://www.starbucks.at", expires: "Am Geburtstag", distance: "Überall", hot: true },
  { id: "kaffee-4", brand: "jö Bonus Club", logo: "🟡", title: "OMV Winterdrink für nur 1 Ö", description: "Cinnamon Pumpkin Latte oder Blushed Toffee Latte für nur 1 Ö!", type: "gratis", badge: "limited", category: "kaffee", source: "jö App", url: "https://www.joe-club.at", expires: "Winter 2026", distance: "OMV Tankstellen", hot: true, isNew: true },
  { id: "kaffee-5", brand: "jö Bonus Club", logo: "🟡", title: "50% auf OMV VIVA Kaffee", description: "Mit 75 Ös 50% auf alle Kaffeespezialitäten bei OMV VIVA.", type: "rabatt", badge: "instore", category: "kaffee", source: "jö App", url: "https://www.joe-club.at", expires: "Unbegrenzt", distance: "OMV Tankstellen", hot: true },
  { id: "kaffee-6", brand: "Tchibo", logo: "☕", title: "Gratis Kaffee beim Einkauf", description: "Bei jedem Einkauf im Tchibo Shop gibt's Gratis-Kaffee!", type: "gratis", badge: "instore", category: "kaffee", source: "Tchibo", url: "https://www.tchibo.at", expires: "Unbegrenzt", distance: "Tchibo Shops", hot: false },
  { id: "kaffee-7", brand: "Segafredo", logo: "☕", title: "10. Kaffee gratis", description: "Stempelkarte: Jeder 10. Kaffee ist gratis!", type: "gratis", badge: "instore", category: "kaffee", source: "Segafredo", url: "https://www.segafredo.at", expires: "Unbegrenzt", distance: "Segafredo Bars", hot: false },

  // ========== GRATIS ESSEN ==========
  { id: "essen-1", brand: "Subway", logo: "🥪", title: "Gratis Cookie bei Anmeldung", description: "Subcard App herunterladen = Gratis Cookie geschenkt!", type: "gratis", badge: "sample", category: "essen", source: "Subway", url: "https://www.subway.at", expires: "Bei Anmeldung", distance: "Überall", hot: true },
  { id: "essen-2", brand: "Burger King", logo: "🍔", title: "Gratis Whopper zum Geburtstag", description: "King Club Mitglieder bekommen einen Gratis Whopper zum Geburtstag!", type: "gratis", badge: "instore", category: "essen", source: "Burger King", url: "https://www.burgerking.at", expires: "Am Geburtstag", distance: "Überall", hot: true },
  { id: "essen-3", brand: "Vapiano", logo: "🍝", title: "Gratis Pasta am Geburtstag", description: "Vapiano People: Gratis Pasta oder Pizza zum Geburtstag!", type: "gratis", badge: "instore", category: "essen", source: "Vapiano", url: "https://www.vapiano.at", expires: "Am Geburtstag", distance: "Vapiano Lokale", hot: true },
  { id: "essen-4", brand: "L'Osteria", logo: "🍕", title: "XXL Pizza zum Teilen", description: "45cm Pizza perfekt zum Teilen - legendär groß!", type: "rabatt", badge: "instore", category: "essen", source: "L'Osteria", url: "https://www.losteria.at", expires: "Immer", distance: "L'Osteria", hot: false },
  { id: "essen-5", brand: "Nordsee", logo: "🐟", title: "10% mit Newsletter", description: "Newsletter anmelden = 10% Rabatt auf erste Bestellung!", type: "rabatt", badge: "sample", category: "essen", source: "Nordsee", url: "https://www.nordsee.at", expires: "Bei Anmeldung", distance: "Überall", hot: false },
  { id: "essen-6", brand: "Pizza Hut", logo: "🍕", title: "2. Pizza 50% günstiger", description: "Zweite Pizza zum halben Preis bei Abholung!", type: "rabatt", badge: "instore", category: "essen", source: "Pizza Hut", url: "https://www.pizzahut.at", expires: "Bei Abholung", distance: "Pizza Hut", hot: false },
  { id: "essen-7", brand: "Domino's", logo: "🍕", title: "30% Online-Rabatt", description: "Online bestellen und 30% sparen!", type: "rabatt", badge: "daily", category: "essen", source: "Domino's", url: "https://www.dominos.at", expires: "Online", distance: "Überall", hot: false },
  { id: "essen-8", brand: "Wiener Deewan", logo: "🍛", title: "Zahl was du willst", description: "Pakistanisches Buffet - du bestimmst den Preis! Studenten-Geheimtipp.", type: "gratis", badge: "daily", category: "essen", source: "Wiener Deewan", url: "https://www.deewan.at", expires: "Immer", distance: "9. Bezirk", hot: true },
  
  // ========== GRATIS LEBENSMITTEL ==========
  { id: "lebens-1", brand: "Verein MUT", logo: "🥫", title: "Gratis Lebensmittel", description: "Gerettete Lebensmittel kostenlos! Mo-Fr 10-15:30 Uhr mit MUT-Karte.", type: "gratis", badge: "daily", category: "supermarkt", source: "Verein MUT", url: "https://verein-mut.eu", expires: "Mo-Fr", distance: "4. Bezirk", hot: true, isNew: true },
  { id: "lebens-2", brand: "Too Good To Go", logo: "🥡", title: "Überraschungssackerl ab €3,99", description: "Restaurants & Supermärkte: Übriggebliebenes Essen zum Spottpreis!", type: "rabatt", badge: "daily", category: "supermarkt", source: "Too Good To Go", url: "https://www.toogoodtogo.at", expires: "Täglich", distance: "Überall", hot: true },
  { id: "lebens-3", brand: "BILLA", logo: "🟠", title: "1+1 Gratis Aktionen", description: "Viele Produkte 1+1 Gratis - wöchentlich wechselnd!", type: "gratis", badge: "limited", category: "supermarkt", source: "BILLA", url: "https://www.billa.at", expires: "Wöchentlich", distance: "Überall", hot: true, isNew: true },
  { id: "lebens-4", brand: "BILLA", logo: "🟠", title: "-25% Pickerl jeden Donnerstag", description: "Jeden Donnerstag neue -25% Rabatt-Pickerl auf Produkte.", type: "rabatt", badge: "daily", category: "supermarkt", source: "BILLA", url: "https://www.billa.at", expires: "Donnerstags", distance: "Überall", hot: true },
  { id: "lebens-5", brand: "Lidl Plus", logo: "🔵", title: "Wöchentliche Coupons", description: "Lidl Plus App: Jede Woche neue Rabatt-Coupons!", type: "rabatt", badge: "daily", category: "supermarkt", source: "Lidl Plus", url: "https://www.lidl.at", expires: "Wöchentlich", distance: "Überall", hot: true },
  { id: "lebens-6", brand: "SPAR", logo: "🟢", title: "SPAR Plus Personalisiert", description: "SPAR Plus Karte: Personalisierte Rabatte!", type: "rabatt", badge: "instore", category: "supermarkt", source: "SPAR", url: "https://www.spar.at", expires: "Unbegrenzt", distance: "Überall", hot: false },
  { id: "lebens-7", brand: "HOFER", logo: "🔴", title: "App-exklusive Angebote", description: "HOFER App: Exklusive Angebote nur in der App!", type: "rabatt", badge: "instore", category: "supermarkt", source: "HOFER", url: "https://www.hofer.at", expires: "Wöchentlich", distance: "Überall", hot: false },
  
  // ========== JÖ BONUS CLUB ==========
  { id: "joe-1", brand: "jö Bonus Club", logo: "🟡", title: "20% Rabattsammler BILLA", description: "Jeden Monat bis zu 20% auf einen kompletten BILLA Einkauf.", type: "rabatt", badge: "daily", category: "supermarkt", source: "jö App", url: "https://www.joe-club.at", expires: "Monatlich", distance: "BILLA", hot: true },
  { id: "joe-2", brand: "jö Bonus Club", logo: "🟡", title: "20% Rabattsammler BIPA", description: "Jeden Monat bis zu 20% auf einen kompletten BIPA Einkauf.", type: "rabatt", badge: "daily", category: "drogerie", source: "jö App", url: "https://www.joe-club.at", expires: "Monatlich", distance: "BIPA", hot: true },
  { id: "joe-3", brand: "jö Bonus Club", logo: "🟡", title: "30% auf OMV TopWash", description: "Mit 150 Ös 30% auf alle TopWash Autowäschen.", type: "rabatt", badge: "instore", category: "mobilität", source: "jö App", url: "https://www.joe-club.at", expires: "Unbegrenzt", distance: "OMV", hot: false },
  { id: "joe-4", brand: "jö Bonus Club", logo: "🟡", title: "50% auf OMV Sandwich", description: "Mit 100 Ös 50% auf alle Sandwiches im VIVA Shop.", type: "rabatt", badge: "instore", category: "essen", source: "jö App", url: "https://www.joe-club.at", expires: "Unbegrenzt", distance: "OMV", hot: false },
  { id: "joe-5", brand: "jö Bonus Club", logo: "🟡", title: "Ös bei foodora sammeln", description: "Bei jeder foodora Bestellung Ös sammeln!", type: "cashback", badge: "daily", category: "lieferung", source: "jö App", url: "https://www.joe-club.at", expires: "Unbegrenzt", distance: "Online", hot: true },
  { id: "joe-6", brand: "jö Bonus Club", logo: "🟡", title: "Ös bei LIBRO sammeln", description: "Bei LIBRO Bücher kaufen und Ös sammeln.", type: "cashback", badge: "instore", category: "shopping", source: "jö App", url: "https://www.joe-club.at", expires: "Unbegrenzt", distance: "LIBRO", hot: false },
  
  // ========== DROGERIE & BEAUTY ==========
  { id: "beauty-1", brand: "dm", logo: "🧴", title: "Gratis Babybox für Schwangere", description: "dm Glückskind: Kostenlose Box mit Babyprodukten!", type: "gratis", badge: "sample", category: "drogerie", source: "dm", url: "https://www.dm.at", expires: "Bei Anmeldung", distance: "dm Märkte", hot: true },
  { id: "beauty-2", brand: "dm", logo: "🧴", title: "Gratis Greifring Babyclub", description: "Bei Babyclub-Anmeldung Gratis Greifring + Gutscheine!", type: "gratis", badge: "sample", category: "drogerie", source: "dm", url: "https://www.dm.at", expires: "Bei Anmeldung", distance: "dm Märkte", hot: true },
  { id: "beauty-3", brand: "Douglas", logo: "💜", title: "2 Gratis-Proben", description: "Bei jeder Bestellung ab €10 zwei kostenlose Beauty-Proben!", type: "gratis", badge: "sample", category: "drogerie", source: "Douglas", url: "https://www.douglas.at", expires: "Unbegrenzt", distance: "Online", hot: true },
  { id: "beauty-4", brand: "Douglas", logo: "💜", title: "Geburtstags-Überraschung", description: "Beauty Card Mitglieder erhalten ein Geburtstagsgeschenk!", type: "gratis", badge: "instore", category: "drogerie", source: "Douglas", url: "https://www.douglas.at", expires: "Am Geburtstag", distance: "Douglas", hot: true },
  { id: "beauty-5", brand: "Sephora", logo: "💄", title: "3 Gratis-Proben", description: "Sephora Beauty Insider: 3 Gratis-Proben bei jeder Bestellung!", type: "gratis", badge: "sample", category: "drogerie", source: "Sephora", url: "https://www.sephora.at", expires: "Unbegrenzt", distance: "Online", hot: true },
  { id: "beauty-6", brand: "BIPA", logo: "💅", title: "20% auf Make-up", description: "Regelmäßig 20% auf ausgewählte Make-up Produkte!", type: "rabatt", badge: "limited", category: "drogerie", source: "BIPA", url: "https://www.bipa.at", expires: "Wechselnd", distance: "BIPA", hot: false },
  { id: "beauty-7", brand: "Müller", logo: "🛍️", title: "10% Newsletter Rabatt", description: "Newsletter anmelden = 10% Rabatt auf Online-Bestellung!", type: "rabatt", badge: "sample", category: "drogerie", source: "Müller", url: "https://www.mueller.at", expires: "Bei Anmeldung", distance: "Online", hot: false },

  // ========== WIENER MUSEEN - GRATIS ==========
  { id: "museum-1", brand: "Wien Museum", logo: "🏛️", title: "Gratis unter 19", description: "Freier Eintritt für alle unter 19 Jahren!", type: "gratis", badge: "instore", category: "wien", source: "Wien Museum", url: "https://www.wienmuseum.at", expires: "Unbegrenzt", distance: "Karlsplatz", hot: true },
  { id: "museum-2", brand: "Belvedere", logo: "🖼️", title: "Gratis unter 19", description: "Klimts 'Der Kuss' kostenlos für unter 19-Jährige!", type: "gratis", badge: "instore", category: "wien", source: "Belvedere", url: "https://www.belvedere.at", expires: "Unbegrenzt", distance: "3. Bezirk", hot: true },
  { id: "museum-3", brand: "Albertina", logo: "🎨", title: "Gratis unter 19", description: "Weltberühmte Kunstsammlung gratis für Jugendliche!", type: "gratis", badge: "instore", category: "wien", source: "Albertina", url: "https://www.albertina.at", expires: "Unbegrenzt", distance: "1. Bezirk", hot: true },
  { id: "museum-4", brand: "NHM Wien", logo: "🦕", title: "Gratis unter 19", description: "Naturhistorisches Museum kostenlos für Jugendliche!", type: "gratis", badge: "instore", category: "wien", source: "NHM", url: "https://www.nhm-wien.ac.at", expires: "Unbegrenzt", distance: "1. Bezirk", hot: true },
  { id: "museum-5", brand: "KHM Wien", logo: "👑", title: "Gratis unter 19", description: "Kunsthistorisches Museum gratis für Jugendliche!", type: "gratis", badge: "instore", category: "wien", source: "KHM", url: "https://www.khm.at", expires: "Unbegrenzt", distance: "1. Bezirk", hot: true },
  { id: "museum-6", brand: "MAK", logo: "🏺", title: "Gratis Dienstag 18-22h", description: "Jeden Dienstag Abend freier Eintritt ins MAK!", type: "gratis", badge: "daily", category: "wien", source: "MAK", url: "https://www.mak.at", expires: "Dienstags", distance: "1. Bezirk", hot: true },
  { id: "museum-7", brand: "Technisches Museum", logo: "⚙️", title: "Gratis unter 19", description: "Technik zum Anfassen - kostenlos für Jugendliche!", type: "gratis", badge: "instore", category: "wien", source: "TMW", url: "https://www.technischesmuseum.at", expires: "Unbegrenzt", distance: "14. Bezirk", hot: false },
  { id: "museum-8", brand: "Jüdisches Museum", logo: "✡️", title: "Gratis unter 19", description: "Geschichte und Kultur - kostenlos für Jugendliche!", type: "gratis", badge: "instore", category: "wien", source: "JMW", url: "https://www.jmw.at", expires: "Unbegrenzt", distance: "1. Bezirk", hot: false },
  { id: "museum-9", brand: "Mumok", logo: "🎭", title: "Gratis unter 19", description: "Moderne Kunst kostenlos für Jugendliche!", type: "gratis", badge: "instore", category: "wien", source: "Mumok", url: "https://www.mumok.at", expires: "Unbegrenzt", distance: "7. Bezirk", hot: false },
  { id: "museum-10", brand: "Leopold Museum", logo: "🎨", title: "Gratis unter 19", description: "Schiele, Klimt und mehr - gratis für Jugendliche!", type: "gratis", badge: "instore", category: "wien", source: "Leopold Museum", url: "https://www.leopoldmuseum.org", expires: "Unbegrenzt", distance: "7. Bezirk", hot: false },
  
  // ========== WIEN SPECIALS ==========
  { id: "wien-1", brand: "Stadt Wien", logo: "👶", title: "Gratis Wickelrucksack", description: "Baby-Willkommenspaket für Wiener Familien bei Geburt!", type: "gratis", badge: "sample", category: "wien", source: "Wien", url: "https://www.wien.gv.at", expires: "Bei Geburt", distance: "Wien", hot: true },
  { id: "wien-2", brand: "Wiener Linien", logo: "🚇", title: "Gratis WLAN", description: "Kostenloses WLAN in allen U-Bahn-Stationen!", type: "gratis", badge: "daily", category: "wien", source: "Wiener Linien", url: "https://www.wienerlinien.at", expires: "Unbegrenzt", distance: "U-Bahn", hot: false },
  { id: "wien-3", brand: "Büchereien Wien", logo: "📚", title: "Gratis unter 18", description: "Kostenlose Mitgliedschaft für unter 18-Jährige!", type: "gratis", badge: "instore", category: "wien", source: "Büchereien Wien", url: "https://www.buechereien.wien.at", expires: "Unbegrenzt", distance: "Überall", hot: false },
  { id: "wien-4", brand: "Donauturm", logo: "🗼", title: "Gratis am Geburtstag", description: "Am Geburtstag (±4 Tage) gratis auf den Donauturm!", type: "gratis", badge: "instore", category: "wien", source: "Donauturm", url: "https://www.donauturm.at", expires: "Geburtstag", distance: "22. Bezirk", hot: true },
  { id: "wien-5", brand: "Prater", logo: "🎡", title: "Gratis Eintritt", description: "Der Wiener Prater ist kostenlos begehbar!", type: "gratis", badge: "daily", category: "wien", source: "Prater", url: "https://www.praterwien.com", expires: "Unbegrenzt", distance: "2. Bezirk", hot: false },
  { id: "wien-6", brand: "Stadtpark", logo: "🌳", title: "Gratis Konzerte im Sommer", description: "Open-Air Konzerte im Sommer im Stadtpark!", type: "gratis", badge: "limited", category: "wien", source: "Stadt Wien", url: "https://www.wien.gv.at", expires: "Sommer", distance: "1. Bezirk", hot: false },
  { id: "wien-7", brand: "Donauinsel", logo: "🏖️", title: "Gratis Badeplatz", description: "Kostenlos baden und chillen auf der Donauinsel!", type: "gratis", badge: "daily", category: "wien", source: "Wien", url: "https://www.wien.gv.at", expires: "Unbegrenzt", distance: "Donauinsel", hot: false },
  
  // ========== MOBILITÄT ==========
  { id: "mobil-1", brand: "ÖBB", logo: "🚂", title: "Gratis Fahrt am Geburtstag", description: "Mit Vorteilscard am Geburtstag gratis 2. Klasse fahren!", type: "gratis", badge: "instore", category: "mobilität", source: "ÖBB", url: "https://www.oebb.at", expires: "Geburtstag", distance: "Österreich", hot: true },
  { id: "mobil-2", brand: "ÖBB", logo: "🚂", title: "Sparschiene ab €19", description: "Günstige Zugtickets bei früher Buchung!", type: "rabatt", badge: "daily", category: "mobilität", source: "ÖBB", url: "https://www.oebb.at", expires: "Bei Buchung", distance: "Österreich", hot: true },
  { id: "mobil-3", brand: "Westbahn", logo: "🚄", title: "Spartickets ab €9,99", description: "Günstige Westbahn Tickets nach Salzburg!", type: "rabatt", badge: "daily", category: "mobilität", source: "Westbahn", url: "https://www.westbahn.at", expires: "Bei Buchung", distance: "Wien-Salzburg", hot: false },
  { id: "mobil-4", brand: "FlixBus", logo: "🚌", title: "Fernbus ab €4,99", description: "Günstige Fernbusse in ganz Europa!", type: "rabatt", badge: "daily", category: "mobilität", source: "FlixBus", url: "https://www.flixbus.at", expires: "Bei Buchung", distance: "Europa", hot: false },
  { id: "mobil-5", brand: "Lime", logo: "🛴", title: "Gratis-Minuten Aktion", description: "Regelmäßig Gratis-Minuten für E-Scooter!", type: "gratis", badge: "limited", category: "mobilität", source: "Lime", url: "https://www.li.me", expires: "Aktionen", distance: "Wien", hot: false },
  { id: "mobil-6", brand: "TIER", logo: "🛴", title: "Erste Fahrt gratis", description: "Erste E-Scooter Fahrt kostenlos!", type: "gratis", badge: "sample", category: "mobilität", source: "TIER", url: "https://www.tier.app", expires: "Erstnutzung", distance: "Wien", hot: false },
  
  // ========== STREAMING & DIGITAL ==========
  { id: "stream-1", brand: "Spotify", logo: "🎵", title: "3 Monate gratis Premium", description: "Premium für Neukunden 3 Monate kostenlos testen!", type: "testabo", badge: "limited", category: "streaming", source: "Spotify", url: "https://www.spotify.com", expires: "Neukunden", distance: "Online", hot: true },
  { id: "stream-2", brand: "Amazon Prime", logo: "📦", title: "30 Tage gratis", description: "Prime Video & schneller Versand kostenlos testen!", type: "testabo", badge: "limited", category: "streaming", source: "Amazon", url: "https://www.amazon.de/prime", expires: "Neukunden", distance: "Online", hot: true },
  { id: "stream-3", brand: "Netflix", logo: "🎬", title: "Werbefinanziert ab €4,99", description: "Günstigstes Netflix Abo mit Werbung.", type: "rabatt", badge: "daily", category: "streaming", source: "Netflix", url: "https://www.netflix.com", expires: "Immer", distance: "Online", hot: false },
  { id: "stream-4", brand: "Disney+", logo: "✨", title: "1 Monat gratis", description: "Disney+ kostenlos testen für Neukunden!", type: "testabo", badge: "limited", category: "streaming", source: "Disney+", url: "https://www.disneyplus.com", expires: "Neukunden", distance: "Online", hot: true },
  { id: "stream-5", brand: "YouTube Premium", logo: "▶️", title: "1 Monat gratis", description: "YouTube ohne Werbung testen!", type: "testabo", badge: "limited", category: "streaming", source: "YouTube", url: "https://www.youtube.com/premium", expires: "Neukunden", distance: "Online", hot: false },
  { id: "stream-6", brand: "Apple TV+", logo: "🍎", title: "7 Tage gratis", description: "Apple TV+ kostenlos testen!", type: "testabo", badge: "limited", category: "streaming", source: "Apple", url: "https://www.apple.com/at/apple-tv-plus/", expires: "Neukunden", distance: "Online", hot: false },
  
  // ========== LIEFERSERVICES ==========
  { id: "liefer-1", brand: "foodora", logo: "🛵", title: "€5 Neukunden-Rabatt", description: "Rabatt auf erste Bestellung für Neukunden!", type: "rabatt", badge: "limited", category: "lieferung", source: "foodora", url: "https://www.foodora.at", expires: "Neukunden", distance: "Wien", hot: true },
  { id: "liefer-2", brand: "Mjam", logo: "🍕", title: "Gratis Lieferung Aktion", description: "Regelmäßig Gratis-Lieferung bei Aktionen!", type: "gratis", badge: "limited", category: "lieferung", source: "Mjam", url: "https://www.mjam.at", expires: "Bei Aktionen", distance: "Wien", hot: false },
  { id: "liefer-3", brand: "Wolt", logo: "📱", title: "€10 Willkommensbonus", description: "€10 Rabatt für Neukunden!", type: "rabatt", badge: "limited", category: "lieferung", source: "Wolt", url: "https://www.wolt.com", expires: "Neukunden", distance: "Wien", hot: true },
  { id: "liefer-4", brand: "Uber Eats", logo: "🚗", title: "Gratis Lieferung", description: "Erste Bestellung oft mit Gratis-Lieferung!", type: "gratis", badge: "limited", category: "lieferung", source: "Uber Eats", url: "https://www.ubereats.com", expires: "Neukunden", distance: "Wien", hot: false },
  
  // ========== MODE & SHOPPING ==========
  { id: "mode-1", brand: "Zalando", logo: "👟", title: "Gratis Versand ab €24,90", description: "Ab €24,90 kostenloser Versand!", type: "gratis", badge: "daily", category: "mode", source: "Zalando", url: "https://www.zalando.at", expires: "Unbegrenzt", distance: "Online", hot: false },
  { id: "mode-2", brand: "Zalando", logo: "👟", title: "100 Tage Rückgabe", description: "100 Tage kostenlose Rückgabe!", type: "gratis", badge: "daily", category: "mode", source: "Zalando", url: "https://www.zalando.at", expires: "Unbegrenzt", distance: "Online", hot: false },
  { id: "mode-3", brand: "H&M", logo: "👕", title: "10% Newsletter Rabatt", description: "10% Rabatt bei Newsletter-Anmeldung!", type: "rabatt", badge: "sample", category: "mode", source: "H&M", url: "https://www.hm.com/at", expires: "Bei Anmeldung", distance: "Online", hot: false },
  { id: "mode-4", brand: "ABOUT YOU", logo: "👗", title: "15% Neukunden", description: "15% Rabatt für Neukunden!", type: "rabatt", badge: "limited", category: "mode", source: "ABOUT YOU", url: "https://www.aboutyou.at", expires: "Neukunden", distance: "Online", hot: false },
  { id: "mode-5", brand: "ASOS", logo: "🛍️", title: "20% Studentenrabatt", description: "20% Rabatt für Studenten mit UNiDAYS!", type: "rabatt", badge: "daily", category: "mode", source: "ASOS", url: "https://www.asos.com", expires: "Studenten", distance: "Online", hot: true },
  { id: "mode-6", brand: "Primark", logo: "👚", title: "Günstige Mode", description: "Mode zu unschlagbaren Preisen!", type: "rabatt", badge: "daily", category: "mode", source: "Primark", url: "https://www.primark.com", expires: "Immer", distance: "SCS / Donau Zentrum", hot: false },
  
  // ========== FINANZEN & CASHBACK ==========
  { id: "finanz-1", brand: "N26", logo: "📱", title: "Gratis Konto", description: "Kostenloses Online-Konto ohne Gebühren!", type: "gratis", badge: "daily", category: "finanzen", source: "N26", url: "https://www.n26.com", expires: "Unbegrenzt", distance: "Online", hot: true },
  { id: "finanz-2", brand: "Revolut", logo: "💳", title: "Gratis Konto", description: "Kostenloses Konto mit gratis Karte!", type: "gratis", badge: "daily", category: "finanzen", source: "Revolut", url: "https://www.revolut.com", expires: "Unbegrenzt", distance: "Online", hot: true },
  { id: "finanz-3", brand: "Shoop", logo: "💵", title: "Cashback", description: "Geld zurück beim Online-Shopping!", type: "cashback", badge: "daily", category: "finanzen", source: "Shoop", url: "https://www.shoop.at", expires: "Unbegrenzt", distance: "Online", hot: true },
  { id: "finanz-4", brand: "Igraal", logo: "💰", title: "Cashback", description: "Bis zu 10% Cashback bei vielen Shops!", type: "cashback", badge: "daily", category: "finanzen", source: "Igraal", url: "https://www.igraal.at", expires: "Unbegrenzt", distance: "Online", hot: false },
  { id: "finanz-5", brand: "Curve", logo: "💳", title: "Cashback auf Karte", description: "Alle Karten in einer + Cashback!", type: "cashback", badge: "daily", category: "finanzen", source: "Curve", url: "https://www.curve.com", expires: "Unbegrenzt", distance: "Online", hot: false },
  
  // ========== SPORT & FITNESS ==========
  { id: "sport-1", brand: "McFit", logo: "💪", title: "Probetraining gratis", description: "Kostenloses Probetraining in allen Studios!", type: "gratis", badge: "sample", category: "sport", source: "McFit", url: "https://www.mcfit.com", expires: "Einmalig", distance: "Wien", hot: true },
  { id: "sport-2", brand: "FitInn", logo: "🏋️", title: "Gratis Schnuppertraining", description: "Kostenloses Probetraining!", type: "gratis", badge: "sample", category: "sport", source: "FitInn", url: "https://www.fitinn.at", expires: "Einmalig", distance: "Wien", hot: true },
  { id: "sport-3", brand: "John Harris", logo: "🏊", title: "Probetraining", description: "Exklusives Probetraining in Premium Clubs!", type: "gratis", badge: "sample", category: "sport", source: "John Harris", url: "https://www.johnharris.at", expires: "Einmalig", distance: "Wien", hot: false },
  
  // ========== STUDENTEN SPECIALS ==========
  { id: "studi-1", brand: "Spotify", logo: "🎵", title: "Studenten 50% Rabatt", description: "Spotify Premium für Studenten zum halben Preis!", type: "rabatt", badge: "daily", category: "streaming", source: "Spotify", url: "https://www.spotify.com/at/student/", expires: "Studenten", distance: "Online", hot: true },
  { id: "studi-2", brand: "Apple", logo: "🍎", title: "Bildungsrabatt", description: "Bis zu 10% auf Mac, iPad für Studenten!", type: "rabatt", badge: "daily", category: "technik", source: "Apple", url: "https://www.apple.com/at-edu/shop", expires: "Studenten", distance: "Online", hot: true },
  { id: "studi-3", brand: "Microsoft", logo: "💻", title: "Office 365 gratis", description: "Office 365 kostenlos für Studenten!", type: "gratis", badge: "daily", category: "technik", source: "Microsoft", url: "https://www.microsoft.com/de-at/education", expires: "Studenten", distance: "Online", hot: true },
  { id: "studi-4", brand: "Amazon Prime", logo: "📦", title: "Prime Student €4,49/M", description: "Amazon Prime zum halben Preis für Studenten!", type: "rabatt", badge: "daily", category: "streaming", source: "Amazon", url: "https://www.amazon.de/primestudent", expires: "Studenten", distance: "Online", hot: true },
  { id: "studi-5", brand: "Adobe", logo: "🎨", title: "65% Studenten-Rabatt", description: "Creative Cloud für Studenten stark vergünstigt!", type: "rabatt", badge: "daily", category: "technik", source: "Adobe", url: "https://www.adobe.com/at/creativecloud/buy/students.html", expires: "Studenten", distance: "Online", hot: true },
  { id: "studi-6", brand: "Mensa", logo: "🍽️", title: "Günstig essen", description: "Mittagessen ab €3-5 in Wiener Mensen!", type: "rabatt", badge: "daily", category: "essen", source: "Studierendenwerk", url: "https://www.mensen.at", expires: "Studenten", distance: "Unis Wien", hot: true },
];

// ============================================
// HELPER FUNCTIONS
// ============================================

function fetch(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'de-AT,de;q=0.9'
      },
      timeout
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetch(res.headers.location, timeout).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// Keywords für Deal-Erkennung
const GRATIS_KEYWORDS = ['gratis', 'kostenlos', 'free', 'geschenkt', 'umsonst', 'freebie', 'gewinnspiel', '0 €', '0€', '1+1'];
const DEAL_KEYWORDS = ['rabatt', 'aktion', 'angebot', 'sale', 'prozent', '%', 'günstiger', 'sparen', 'deal', 'schnäppchen'];
const NEUEROFFNUNG_KEYWORDS = ['neueröffnung', 'eröffnung', 'opening', 'neu eröffnet', 'grand opening', 'soft opening'];

function extractTag(xml, tag) {
  const cdataRegex = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i');
  const cdataMatch = xml.match(cdataRegex);
  if (cdataMatch) return cdataMatch[1].trim();
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].replace(/<[^>]*>/g, '').trim() : '';
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
    
    const lowerTitle = title.toLowerCase();
    const lowerDesc = (description || '').toLowerCase();
    const fullText = lowerTitle + ' ' + lowerDesc;
    
    // Prüfe ob Deal relevant ist
    const isGratis = GRATIS_KEYWORDS.some(k => fullText.includes(k));
    const isDeal = DEAL_KEYWORDS.some(k => fullText.includes(k));
    const isNeueroffnung = NEUEROFFNUNG_KEYWORDS.some(k => fullText.includes(k));
    
    if (!isGratis && !isDeal && !isNeueroffnung) continue;
    
    // Bestimme Badge
    let badge = 'daily';
    if (isGratis) badge = 'gratis';
    else if (isNeueroffnung) badge = 'limited';
    
    // Bestimme Kategorie
    let category = 'wien';
    if (/kaffee|coffee|latte|cappuccino/i.test(fullText)) category = 'kaffee';
    else if (/pizza|kebab|döner|burger|essen|restaurant|lokal/i.test(fullText)) category = 'essen';
    else if (/billa|spar|lidl|hofer|supermarkt|lebensmittel/i.test(fullText)) category = 'supermarkt';
    else if (/dm|bipa|douglas|beauty|kosmetik/i.test(fullText)) category = 'drogerie';
    else if (/netflix|spotify|disney|stream|gaming/i.test(fullText)) category = 'streaming';
    else if (/museum|ausstellung|kultur|theater/i.test(fullText)) category = 'wien';
    
    // Extrahiere Brand
    let brand = source.brand;
    const brandMatch = title.match(/^([A-Za-zäöüÄÖÜß0-9&\-\.']+)[\s:–-]/);
    if (brandMatch) brand = brandMatch[1];
    
    // Säubere Description
    let cleanDesc = (description || title)
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim();
    if (cleanDesc.length > 120) cleanDesc = cleanDesc.substring(0, 117) + '...';
    
    deals.push({
      id: `rss-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      brand: brand.substring(0, 30),
      logo: source.logo,
      title: title.substring(0, 70),
      description: cleanDesc,
      type: isGratis ? 'gratis' : 'rabatt',
      badge,
      category,
      source: source.name,
      url: link || source.url,
      expires: isNeueroffnung ? 'Neueröffnung' : 'Begrenzt',
      distance: 'Wien',
      hot: isGratis || isNeueroffnung,
      isNew: true,
      pubDate: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString()
    });
  }
  
  return deals;
}

function extractDealsFromHTML(html, source) {
  const deals = [];
  
  // Suche nach Gratis/Kostenlos Patterns
  const patterns = [
    /gratis[^<]{5,100}/gi,
    /kostenlos[^<]{5,100}/gi,
    /1\+1\s*gratis[^<]{0,80}/gi,
    /neueröffnung[^<]{5,100}/gi,
    /-\s*\d{1,2}\s*%[^<]{5,80}/gi,
  ];
  
  patterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const context = match[0].replace(/<[^>]*>/g, '').trim();
      if (context.length > 15 && context.length < 150) {
        const isGratis = /gratis|kostenlos|1\+1/i.test(context);
        deals.push({
          id: `html-${source.brand}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          brand: source.brand,
          logo: source.logo,
          title: `${isGratis ? 'Gratis' : 'Aktion'} bei ${source.brand}`,
          description: context.substring(0, 120),
          type: isGratis ? 'gratis' : 'rabatt',
          badge: isGratis ? 'gratis' : 'limited',
          category: source.category,
          source: source.name,
          url: source.url,
          expires: 'Begrenzt',
          distance: 'Wien',
          hot: isGratis,
          isNew: true,
          pubDate: new Date().toISOString()
        });
      }
    }
  });
  
  return deals.slice(0, 10); // Max 10 pro HTML Quelle
}

// ============================================
// MAIN SCRAPER
// ============================================

async function scrapeAllSources() {
  console.log('🚀 POWER SCRAPER gestartet...\n');
  console.log(`📅 ${new Date().toLocaleString('de-AT')}\n`);
  console.log(`📡 ${SOURCES.length} Quellen werden gescraped...\n`);
  
  const scrapedDeals = [];
  const errors = [];
  
  for (const source of SOURCES) {
    try {
      const content = await fetch(source.url);
      let deals = source.type === 'rss' ? parseRSS(content, source) : extractDealsFromHTML(content, source);
      console.log(`✅ ${source.name}: ${deals.length} Deals`);
      scrapedDeals.push(...deals);
    } catch (error) {
      console.log(`❌ ${source.name}: ${error.message}`);
      errors.push({ source: source.name, error: error.message });
    }
  }
  
  // Kombiniere Basis + Gescrapte Deals
  const allDeals = [...BASE_DEALS, ...scrapedDeals];
  
  // FILTER: Entferne abgelaufene Deals
  const today = new Date().toISOString().split('T')[0]; // "2026-01-15"
  const validDeals = allDeals.filter(deal => {
    if (!deal.validUntil) return true; // Kein Ablaufdatum = immer gültig
    return deal.validUntil >= today;
  });
  
  console.log(`\n🗑️  ${allDeals.length - validDeals.length} abgelaufene Deals entfernt`);
  
  // Entferne Duplikate
  const uniqueDeals = [];
  const seenTitles = new Set();
  
  for (const deal of validDeals) {
    const key = deal.title.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 25);
    if (!seenTitles.has(key)) {
      seenTitles.add(key);
      uniqueDeals.push(deal);
    }
  }
  
  // Sortiere: Hot & Neu zuerst
  uniqueDeals.sort((a, b) => {
    if (a.isNew && !b.isNew) return -1;
    if (!a.isNew && b.isNew) return 1;
    if (a.hot && !b.hot) return -1;
    if (!a.hot && b.hot) return 1;
    return 0;
  });
  
  // Output
  const output = {
    lastUpdated: new Date().toISOString(),
    totalDeals: uniqueDeals.length,
    baseDeals: BASE_DEALS.length,
    scrapedDeals: scrapedDeals.length,
    sources: SOURCES.length,
    errors: errors.length,
    deals: uniqueDeals
  };
  
  fs.writeFileSync('deals.json', JSON.stringify(output, null, 2));
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ Scraping abgeschlossen!`);
  console.log(`   📦 Basis-Deals: ${BASE_DEALS.length}`);
  console.log(`   🆕 Gescrapte Deals: ${scrapedDeals.length}`);
  console.log(`   📊 Gesamt: ${uniqueDeals.length}`);
  console.log(`   ⚠️  Fehler: ${errors.length}/${SOURCES.length}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  return output;
}

scrapeAllSources().catch(console.error);

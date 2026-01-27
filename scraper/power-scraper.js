// ============================================
// FREEFINDER WIEN - MEGA POWER SCRAPER V3
// Mit Fitness, Reisen, Rabattcodes, Shopping
// ============================================

import https from 'https';
import http from 'http';
import fs from 'fs';

// ============================================
// ALLE QUELLEN (150+)
// ============================================

const SOURCES = [
  // ========== WIEN EVENTS & KULTUR ==========
  { name: 'Wien Events', url: 'https://events.wien.info/de/', type: 'html', brand: 'Wien Events', logo: '🎭', category: 'wien' },
  { name: 'Wien Kulturkalender', url: 'https://www.wien.gv.at/kultur-freizeit/kalender.html', type: 'html', brand: 'Wien.gv.at', logo: '🏛️', category: 'wien' },
  { name: 'Wien Konzerte', url: 'https://www.wien.gv.at/kultur-freizeit/musik.html', type: 'html', brand: 'Wien Musik', logo: '🎵', category: 'wien' },
  { name: 'Rathausplatz Events', url: 'https://www.filmfestival-rathausplatz.at/', type: 'html', brand: 'Rathausplatz', logo: '🎬', category: 'wien' },
  { name: 'Donauinselfest', url: 'https://donauinselfest.at/', type: 'html', brand: 'Donauinselfest', logo: '🎸', category: 'wien' },
  { name: 'Museumsquartier', url: 'https://www.mqw.at/programm/', type: 'html', brand: 'MQ Wien', logo: '🏛️', category: 'wien' },
  { name: 'Lange Nacht der Museen', url: 'https://langenacht.orf.at/', type: 'html', brand: 'ORF', logo: '🌙', category: 'wien' },
  { name: 'Wien Straßenfeste', url: 'https://www.stadt-wien.at/freizeit/feste-maerkte.html', type: 'html', brand: 'Stadt Wien', logo: '🎪', category: 'wien' },
  
  // ========== FOODSHARING & LEBENSMITTEL RETTEN ==========
  { name: 'Foodsharing Wien', url: 'https://foodsharing.at/', type: 'html', brand: 'Foodsharing', logo: '🍏', category: 'essen' },
  { name: 'Foodsharing Fairteiler', url: 'https://foodsharing.at/karte', type: 'html', brand: 'Fairteiler', logo: '📍', category: 'essen' },
  { name: 'Too Good To Go', url: 'https://www.toogoodtogo.com/at', type: 'html', brand: 'TGTG', logo: '🥡', category: 'essen' },
  { name: 'Wiener Tafel', url: 'https://www.wienertafel.at/', type: 'html', brand: 'Wiener Tafel', logo: '🥫', category: 'essen' },
  
  // ========== GRATIS PROBEN & FREEBIES ==========
  { name: 'Produkttester', url: 'https://www.produkttester.com/', type: 'html', brand: 'Produkttester', logo: '🎁', category: 'gratis' },
  { name: 'Gratisproben', url: 'https://www.gratisproben.net/oesterreich/', type: 'html', brand: 'Gratisproben', logo: '🆓', category: 'gratis' },
  { name: 'Sparhamster Gratis', url: 'https://www.sparhamster.at/gratis/', type: 'html', brand: 'Sparhamster', logo: '🐹', category: 'gratis' },
  { name: 'Schnäppchenfee', url: 'https://www.schnaeppchenfee.at/?s=gratis', type: 'html', brand: 'Schnäppchenfee', logo: '🧚', category: 'gratis' },
  
  // ========== MESSEN & EVENTS MIT FREEBIES ==========
  { name: 'Reed Messen Wien', url: 'https://www.messe.at/de/veranstaltungen/', type: 'html', brand: 'Messe Wien', logo: '🏢', category: 'wien' },
  { name: 'Wiener Messen', url: 'https://www.wienermessen.at/', type: 'html', brand: 'Wiener Messen', logo: '📅', category: 'wien' },
  { name: 'Vegan Planet', url: 'https://www.veganplanet.at/', type: 'html', brand: 'Vegan Planet', logo: '🌱', category: 'essen' },
  
  // ========== STORE ERÖFFNUNGEN ==========
  { name: 'Google News Eröffnung Wien', url: 'https://news.google.com/rss/search?q=Wien+Er%C3%B6ffnung+Neuer%C3%B6ffnung+gratis&hl=de&gl=AT', type: 'rss', brand: 'Eröffnungen', logo: '🆕', category: 'shopping' },
  { name: 'Google News Store Opening', url: 'https://news.google.com/rss/search?q=Wien+Store+Opening+Geschenke&hl=de&gl=AT', type: 'rss', brand: 'Openings', logo: '🎉', category: 'shopping' },
  
  // ========== ONLINE MARKTPLÄTZE ==========
  { name: 'Willhaben Gratis', url: 'https://www.willhaben.at/iad/kaufen-und-verkaufen/gratis', type: 'html', brand: 'Willhaben', logo: '🏷️', category: 'shopping' },
  { name: 'Facebook Marketplace', url: 'https://www.facebook.com/marketplace/wien/free/', type: 'html', brand: 'FB Marketplace', logo: '📘', category: 'shopping' },
  { name: 'Shpock Gratis', url: 'https://www.shpock.com/at/q/gratis', type: 'html', brand: 'Shpock', logo: '📱', category: 'shopping' },
  
  // ========== SOCIAL MEDIA DEALS ==========
  { name: 'Reddit Wien Gratis', url: 'https://www.reddit.com/r/wien/search.rss?q=gratis+OR+kostenlos&restrict_sr=on&sort=new', type: 'rss', brand: 'Reddit Wien', logo: '🔴', category: 'wien' },
  { name: 'Google News Sampling Wien', url: 'https://news.google.com/rss/search?q=Wien+Sampling+Aktion+Promotion+gratis&hl=de&gl=AT', type: 'rss', brand: 'Promotions', logo: '🎁', category: 'gratis' },
  { name: 'Google News Messe Wien Gratis', url: 'https://news.google.com/rss/search?q=Messe+Wien+gratis+Eintritt&hl=de&gl=AT', type: 'rss', brand: 'Messe News', logo: '🏢', category: 'wien' },
  
  // ========== ORIGINAL SOURCES ==========
  // NEWS & LIFESTYLE
  { name: 'Vienna.at', url: 'https://www.vienna.at/', type: 'html', brand: 'Vienna.at', logo: '📰', category: 'wien' },
  { name: 'MeinBezirk Wien', url: 'https://www.meinbezirk.at/wien', type: 'html', brand: 'MeinBezirk', logo: '📰', category: 'wien' },
  { name: 'Kurier Wien', url: 'https://kurier.at/chronik/wien', type: 'html', brand: 'Kurier', logo: '📰', category: 'wien' },
  { name: 'Stadtbekannt', url: 'https://www.stadtbekannt.at/', type: 'html', brand: 'Stadtbekannt', logo: '🏙️', category: 'wien' },
  
  // SUPERMÄRKTE
  { name: 'Lidl Angebote', url: 'https://www.lidl.at/c/billiger-montag/a10006065', type: 'html', brand: 'Lidl', logo: '🛒', category: 'supermarkt' },
  { name: 'HOFER Aktionen', url: 'https://www.hofer.at/de/angebote.html', type: 'html', brand: 'HOFER', logo: '🛒', category: 'supermarkt' },
  { name: 'PENNY Angebote', url: 'https://www.penny.at/angebote', type: 'html', brand: 'PENNY', logo: '🛒', category: 'supermarkt' },
  
  // FAST FOOD
  { name: "McDonald's", url: 'https://www.mcdonalds.at/aktionen', type: 'html', brand: "McDonald's", logo: '🍟', category: 'essen' },
  { name: 'Burger King', url: 'https://www.burgerking.at/angebote', type: 'html', brand: 'Burger King', logo: '🍔', category: 'essen' },
  { name: 'KFC', url: 'https://www.kfc.at/angebote', type: 'html', brand: 'KFC', logo: '🍗', category: 'essen' },
  
  // KAFFEE
  { name: 'Starbucks', url: 'https://www.starbucks.at/', type: 'html', brand: 'Starbucks', logo: '☕', category: 'kaffee' },
  { name: 'Tchibo', url: 'https://www.tchibo.at/angebote-aktionen-c400109092.html', type: 'html', brand: 'Tchibo', logo: '☕', category: 'kaffee' },
  
  // FITNESS - NEU!
  { name: 'FitInn', url: 'https://www.fitinn.at/', type: 'html', brand: 'FitInn', logo: '💪', category: 'fitness' },
  { name: 'McFIT', url: 'https://www.mcfit.com/at/', type: 'html', brand: 'McFIT', logo: '💪', category: 'fitness' },
  { name: 'John Harris', url: 'https://www.johnharris.at/', type: 'html', brand: 'John Harris', logo: '🏊', category: 'fitness' },
  { name: 'clever fit', url: 'https://www.clever-fit.com/at/', type: 'html', brand: 'clever fit', logo: '💪', category: 'fitness' },
  { name: 'EVO Fitness', url: 'https://www.evofitness.at/', type: 'html', brand: 'EVO Fitness', logo: '🏃', category: 'fitness' },
  { name: 'Holmes Place', url: 'https://www.holmesplace.at/', type: 'html', brand: 'Holmes Place', logo: '🏋️', category: 'fitness' },
  
  // REISEN - NEU!
  { name: 'Ryanair', url: 'https://www.ryanair.com/at/de', type: 'html', brand: 'Ryanair', logo: '✈️', category: 'reisen' },
  { name: 'Wizz Air', url: 'https://wizzair.com/de-de', type: 'html', brand: 'Wizz Air', logo: '✈️', category: 'reisen' },
  { name: 'Eurowings', url: 'https://www.eurowings.com/at', type: 'html', brand: 'Eurowings', logo: '✈️', category: 'reisen' },
  { name: 'ÖBB Sparschiene', url: 'https://www.oebb.at/de/angebote-ermaessigungen/sparschiene', type: 'html', brand: 'ÖBB', logo: '🚂', category: 'reisen' },
  { name: 'FlixBus', url: 'https://www.flixbus.at/', type: 'html', brand: 'FlixBus', logo: '🚌', category: 'reisen' },
  { name: 'Hofer Reisen', url: 'https://reisen.hofer.at/', type: 'html', brand: 'Hofer Reisen', logo: '🏖️', category: 'reisen' },
  { name: 'Urlaubspiraten', url: 'https://www.urlaubspiraten.at/', type: 'html', brand: 'Urlaubspiraten', logo: '🏴‍☠️', category: 'reisen' },
  
  // RABATTCODES - NEU!
  { name: 'Gutscheinpony', url: 'https://www.gutscheinpony.at/', type: 'html', brand: 'Gutscheinpony', logo: '🏷️', category: 'codes' },
  { name: 'Coupons.at', url: 'https://www.coupons.at/', type: 'html', brand: 'Coupons', logo: '🏷️', category: 'codes' },
  { name: 'Gutscheine.at', url: 'https://www.gutscheine.at/', type: 'html', brand: 'Gutscheine', logo: '🏷️', category: 'codes' },
  
  // SHOPPING - NEU!
  { name: 'Amazon Deals', url: 'https://www.amazon.de/deals', type: 'html', brand: 'Amazon', logo: '📦', category: 'shopping' },
  { name: 'eBay Deals', url: 'https://www.ebay.at/deals', type: 'html', brand: 'eBay', logo: '🛒', category: 'shopping' },
  { name: 'Willhaben', url: 'https://www.willhaben.at/', type: 'html', brand: 'Willhaben', logo: '🏷️', category: 'shopping' },
  
  // TECHNIK
  { name: 'MediaMarkt', url: 'https://www.mediamarkt.at/de/campaign/angebote', type: 'html', brand: 'MediaMarkt', logo: '📺', category: 'technik' },
  { name: 'Saturn', url: 'https://www.saturn.at/de/campaign/angebote', type: 'html', brand: 'Saturn', logo: '📺', category: 'technik' },
  
  // PREISJÄGER RSS
  { name: 'Preisjäger Gratis', url: 'https://www.preisjaeger.at/rss/gruppe/gratisartikel', type: 'rss', brand: 'Preisjäger', logo: '🆓', category: 'gratis' },
  { name: 'Preisjäger Wien', url: 'https://www.preisjaeger.at/rss/gruppe/lokal', type: 'rss', brand: 'Preisjäger', logo: '📍', category: 'wien' },
  { name: 'Preisjäger Reisen', url: 'https://www.preisjaeger.at/rss/gruppe/reisen', type: 'rss', brand: 'Preisjäger', logo: '✈️', category: 'reisen' },
  
  // GOOGLE NEWS
  { name: 'Google News Wien Gratis', url: 'https://news.google.com/rss/search?q=Wien+gratis+OR+kostenlos&hl=de&gl=AT', type: 'rss', brand: 'Google News', logo: '📰', category: 'wien' },
  { name: 'Google News Fitness Gratis', url: 'https://news.google.com/rss/search?q=%C3%96sterreich+Fitnessstudio+gratis+Probetraining&hl=de&gl=AT', type: 'rss', brand: 'Google News', logo: '💪', category: 'fitness' },
  { name: 'Google News Flug Angebot', url: 'https://news.google.com/rss/search?q=Wien+Flug+Angebot+billig&hl=de&gl=AT', type: 'rss', brand: 'Google News', logo: '✈️', category: 'reisen' },
  { name: 'Google News Rabattcode', url: 'https://news.google.com/rss/search?q=%C3%96sterreich+Rabattcode+Gutschein&hl=de&gl=AT', type: 'rss', brand: 'Google News', logo: '🏷️', category: 'codes' },
  { name: 'Google News Neueröffnung', url: 'https://news.google.com/rss/search?q=Wien+Neuer%C3%B6ffnung+Er%C3%B6ffnung&hl=de&gl=AT', type: 'rss', brand: 'Google News', logo: '🆕', category: 'shopping' },
  
  // REDDIT
  { name: 'Reddit r/wien', url: 'https://www.reddit.com/r/wien/.rss', type: 'rss', brand: 'Reddit', logo: '🔴', category: 'wien' },
  { name: 'Reddit r/Austria', url: 'https://www.reddit.com/r/Austria/.rss', type: 'rss', brand: 'Reddit', logo: '🔴', category: 'wien' },
];

// ============================================
// KEYWORDS
// ============================================

const GRATIS_KEYWORDS = ['gratis', 'kostenlos', 'geschenkt', 'umsonst', 'free', '0€', '0 €', 'freebie', 'probetraining', 'probetag'];
const DEAL_KEYWORDS = ['rabatt', 'sale', 'aktion', 'angebot', 'sparen', 'reduziert', 'günstiger', '-50%', '-40%', '-30%', '1+1', 'code', 'gutschein'];
const REISEN_KEYWORDS = ['flug', 'flüge', 'hotel', 'urlaub', 'reise', 'last minute', 'sparschiene', 'nightjet'];
const FITNESS_KEYWORDS = ['fitness', 'gym', 'probetraining', 'probetag', 'fitnessstudio', 'training'];

// ============================================
// BASIS DEALS - ALLE KATEGORIEN
// ============================================

const BASE_DEALS = [
  // ========== TOP DEALS ==========
  { id: "top-1", brand: "OMV VIVA", logo: "⛽", title: "Gratis Getränk für nur 1 Ö!", description: "☕ Winterdrink für nur 1 jö Punkt", type: "gratis", category: "kaffee", source: "jö App", url: "https://www.joe-club.at/vorteile", expires: "Winter 2026", distance: "OMV Tankstellen", hot: true, isNew: true, priority: 1, votes: 0 },
  { id: "top-2", brand: "IKEA", logo: "🪑", title: "Gratis Kaffee & Tee UNLIMITIERT", description: "☕ IKEA Family: Unbegrenzt Gratis-Kaffee im Restaurant", type: "gratis", category: "kaffee", source: "IKEA Family", url: "https://www.ikea.com/at/de/ikea-family/", expires: "Unbegrenzt", distance: "IKEA Wien Nord, Vösendorf", hot: true, priority: 1, votes: 0 },
  { id: "top-3", brand: "Wiener Deewan", logo: "🍛", title: "Zahl was du willst!", description: "🍛 Pakistanisches Buffet - DU bestimmst den Preis (auch €0)!", type: "gratis", category: "essen", source: "Wiener Deewan", url: "https://www.deewan.at", expires: "Mo-Sa 11-23h", distance: "Liechtensteinstr. 10, 1090", hot: true, priority: 1, votes: 0 },
  { id: "top-4", brand: "McDonald's", logo: "🍟", title: "5x Gratis Kaffee pro Monat", description: "☕ Feedback geben in der App = Gratis McCafé oder Soft Drink", type: "gratis", category: "kaffee", source: "McDonald's App", url: "https://www.mcdonalds.at/app", expires: "5x/Monat", distance: "Alle Filialen", hot: true, priority: 1, votes: 0 },
  { id: "top-5", brand: "Verein MUT", logo: "🥫", title: "Gratis Lebensmittel abholen", description: "🆓 Gerettete Lebensmittel komplett kostenlos", type: "gratis", category: "supermarkt", source: "Verein MUT", url: "https://verein-mut.eu/standorte/", expires: "Mo-Fr 9-17h", distance: "Wiedner Hauptstr. 60-62, 1040", hot: true, priority: 1, votes: 0 },
  { id: "top-6", brand: "Foodsharing", logo: "🍏", title: "Gratis Lebensmittel retten", description: "🆓 Übriggebliebene Lebensmittel gratis abholen", type: "gratis", category: "supermarkt", source: "Foodsharing", url: "https://foodsharing.at/karte", expires: "Täglich", distance: "Fairteiler Wien", hot: true, priority: 1, votes: 0 },
  { id: "top-8", brand: "dm Friseur", logo: "💇", title: "Gratis Kinderhaarschnitt", description: "💇 Kinder unter 10: Komplett gratis Haarschnitt", type: "gratis", category: "beauty", source: "dm Friseurstudio", url: "https://www.dm.at/services/friseurstudio", expires: "Mit Termin", distance: "dm Friseurstudios Wien", hot: true, priority: 1, votes: 0 },
  { id: "top-9", brand: "Bundesmuseen", logo: "🏛️", title: "Gratis Eintritt unter 19!", description: "🆓 Belvedere, KHM, NHM, Albertina - ALLE gratis unter 19!", type: "gratis", category: "wien", source: "Bundesmuseen", url: "https://www.bundesmuseen.at/freier-eintritt/", expires: "Für unter 19", distance: "Alle Bundesmuseen", hot: true, priority: 1, votes: 0 },
  { id: "top-7", brand: "Too Good To Go", logo: "🥡", title: "Essen retten ab €3,99", description: "🍔 Überraschungssackerl - Wert €12+ für nur €3,99", type: "rabatt", category: "essen", source: "Too Good To Go App", url: "https://www.toogoodtogo.com/at", expires: "Täglich neu", distance: "500+ Partner Wien", hot: true, priority: 2, votes: 0 },

  // ========== WIEN EVENTS & KULTUR - NEU! ==========
  { id: "event-1", brand: "Film Festival Rathausplatz", logo: "🎬", title: "Gratis Open-Air Kino", description: "🎬 Jeden Sommer: Gratis Filme & Konzerte am Rathausplatz!", type: "gratis", category: "wien", source: "Wien Kultur", url: "https://www.filmfestival-rathausplatz.at/", expires: "Juli-September", distance: "Rathausplatz, 1010", hot: true, isNew: true, priority: 1, votes: 0 },
  { id: "event-2", brand: "Donauinselfest", logo: "🎸", title: "Gratis Open-Air Festival", description: "🎸 Europas größtes Gratis-Musikfestival! 3 Tage, 0€!", type: "gratis", category: "wien", source: "Donauinselfest", url: "https://donauinselfest.at/", expires: "Juni 2026", distance: "Donauinsel", hot: true, isNew: true, priority: 1, votes: 0 },
  { id: "event-3", brand: "Lange Nacht der Museen", logo: "🌙", title: "Alle Museen 1 Ticket", description: "🏛️ 1 Nacht, 100+ Museen, 1 günstiges Ticket!", type: "rabatt", category: "wien", source: "ORF", url: "https://langenacht.orf.at/", expires: "Oktober 2026", distance: "Ganz Wien", hot: true, votes: 0 },
  { id: "event-4", brand: "Wiener Festwochen", logo: "🎭", title: "Gratis Eröffnung", description: "🎭 Gratis Eröffnungskonzert am Rathausplatz!", type: "gratis", category: "wien", source: "Festwochen", url: "https://www.festwochen.at/", expires: "Mai 2026", distance: "Rathausplatz, 1010", hot: true, votes: 0 },
  { id: "event-5", brand: "Museumsquartier", logo: "🏛️", title: "Gratis Führungen", description: "🏛️ Regelmäßig kostenlose Führungen im MQ!", type: "gratis", category: "wien", source: "MQ Wien", url: "https://www.mqw.at/programm/", expires: "Laufend", distance: "Museumsquartier, 1070", hot: true, votes: 0 },
  { id: "event-6", brand: "Wien Silvesterpfad", logo: "🎆", title: "Gratis Silvesterparty", description: "🎆 Gratis Open-Air Silvester in der Wiener Innenstadt!", type: "gratis", category: "wien", source: "Wien Tourismus", url: "https://www.wien.info/de/musik-buehne-events/silvester", expires: "31. Dezember", distance: "Innere Stadt, 1010", hot: true, votes: 0 },
  { id: "event-7", brand: "Straßenfeste Wien", logo: "🎪", title: "Gratis Straßenfeste", description: "🎪 Bezirksfeste, Grätzlfeste - gratis Unterhaltung!", type: "gratis", category: "wien", source: "Stadt Wien", url: "https://www.wien.gv.at/freizeit/feste/", expires: "Ganzjährig", distance: "Verschiedene Bezirke", hot: true, votes: 0 },

  // ========== FOODSHARING & LEBENSMITTEL - NEU! ==========
  { id: "food-1", brand: "Foodsharing Fairteiler", logo: "📍", title: "Gratis Lebensmittel 24/7", description: "🍏 Offene Kühlschränke in ganz Wien - nimm was du brauchst!", type: "gratis", category: "essen", source: "Foodsharing", url: "https://foodsharing.at/karte", expires: "Immer offen", distance: "50+ Fairteiler Wien", hot: true, isNew: true, priority: 1, votes: 0 },
  { id: "food-2", brand: "Wiener Tafel", logo: "🥫", title: "Gratis Lebensmittel", description: "🥫 Lebensmittelhilfe für Bedürftige - komplett kostenlos!", type: "gratis", category: "essen", source: "Wiener Tafel", url: "https://www.wienertafel.at/", expires: "Für Bedürftige", distance: "Wien", hot: true, votes: 0 },
  { id: "food-3", brand: "SoMa Märkte", logo: "🛒", title: "Lebensmittel -70%", description: "🛒 Soziale Märkte: Lebensmittel bis 70% günstiger!", type: "rabatt", category: "supermarkt", source: "SoMa", url: "https://www.soma.or.at/", expires: "Mit SoMa-Ausweis", distance: "Mehrere Standorte", hot: true, votes: 0 },

  // ========== GRATIS PROBEN & FREEBIES - NEU! ==========
  { id: "freebie-1", brand: "dm Gratisproben", logo: "🧴", title: "Gratis Kosmetikproben", description: "🧴 Bei dm oft Gratisproben von Marken mitnehmen!", type: "gratis", category: "beauty", source: "dm", url: "https://www.dm.at/", expires: "Solange Vorrat", distance: "Alle dm Filialen", hot: true, isNew: true, votes: 0 },
  { id: "freebie-2", brand: "Sephora Proben", logo: "💄", title: "3 Gratis Samples", description: "💄 Bei jeder Online-Bestellung 3 Luxusproben gratis!", type: "gratis", category: "beauty", source: "Sephora", url: "https://www.sephora.at/", expires: "Bei Bestellung", distance: "Online", hot: true, isNew: true, votes: 0 },
  { id: "freebie-3", brand: "Douglas Proben", logo: "💋", title: "Gratis Parfumproben", description: "💋 In Douglas Filialen Parfumproben kostenlos!", type: "gratis", category: "beauty", source: "Douglas", url: "https://www.douglas.at/", expires: "Im Store", distance: "Douglas Filialen", hot: true, votes: 0 },
  { id: "freebie-4", brand: "Nespresso", logo: "☕", title: "Gratis Kaffee Tasting", description: "☕ Kostenlose Kaffeeverkostung in jeder Boutique!", type: "gratis", category: "kaffee", source: "Nespresso", url: "https://www.nespresso.com/at/", expires: "Im Store", distance: "Nespresso Boutiquen", hot: true, votes: 0 },
  { id: "freebie-5", brand: "Tchibo Proben", logo: "☕", title: "Gratis Kaffeeproben", description: "☕ Neue Sorten oft als Gratisproben!", type: "gratis", category: "kaffee", source: "Tchibo", url: "https://www.tchibo.at/", expires: "Bei Aktionen", distance: "Tchibo Filialen", hot: true, votes: 0 },

  // ========== MESSEN & SAMPLING EVENTS - NEU! ==========
  { id: "messe-1", brand: "Vegan Planet Messe", logo: "🌱", title: "Gratis Proben & Verkostung", description: "🌱 Veganmesse Wien: Hunderte Gratisproben!", type: "gratis", category: "essen", source: "Vegan Planet", url: "https://www.veganplanet.at/", expires: "Herbst 2026", distance: "MQ Wien", hot: true, isNew: true, votes: 0 },
  { id: "messe-2", brand: "Ferien-Messe Wien", logo: "✈️", title: "Gratis Reise-Goodies", description: "✈️ Gratis Reiseführer, Proben und Gewinnspiele!", type: "gratis", category: "reisen", source: "Messe Wien", url: "https://www.ferien-messe.at/", expires: "Jänner 2026", distance: "Messe Wien", hot: true, votes: 0 },
  { id: "messe-3", brand: "Sampling Aktionen", logo: "🎁", title: "Gratis Produktproben", description: "🎁 In Shopping-Centern oft Sampling-Aktionen!", type: "gratis", category: "shopping", source: "Promotions", url: "https://www.scs.at/", expires: "Laufend", distance: "SCS, Donauzentrum, etc.", hot: true, votes: 0 },

  // ========== ONLINE MARKTPLÄTZE GRATIS - NEU! ==========
  { id: "market-1", brand: "Willhaben Gratis", logo: "🆓", title: "Gratis Abzugeben", description: "🆓 Menschen verschenken Dinge - komplett gratis!", type: "gratis", category: "shopping", source: "Willhaben", url: "https://www.willhaben.at/iad/kaufen-und-verkaufen/marktplatz?sfId=742f4164-fd4a-4176-8be1-b5a0c86e4030&rows=30&isNavigation=true&keyword=gratis", expires: "Täglich neu", distance: "Wien & Umgebung", hot: true, isNew: true, priority: 1, votes: 0 },
  { id: "market-2", brand: "Facebook Marketplace", logo: "📘", title: "Gratis Artikel", description: "📘 Kostenlose Artikel in deiner Nähe!", type: "gratis", category: "shopping", source: "Facebook", url: "https://www.facebook.com/marketplace/category/free/", expires: "Täglich neu", distance: "Wien", hot: true, votes: 0 },
  { id: "market-3", brand: "Shpock Gratis", logo: "📱", title: "Verschenkt Artikel", description: "📱 Gratis-Kategorie: Leute verschenken Sachen!", type: "gratis", category: "shopping", source: "Shpock", url: "https://www.shpock.com/", expires: "Täglich neu", distance: "Wien", hot: true, votes: 0 },

  // ========== FITNESS - NEU! ==========
  { id: "fitness-1", brand: "FitInn", logo: "💪", title: "1 Woche gratis trainieren", description: "🏋️ 7 Tage kostenloses Probetraining in allen Studios!", type: "gratis", category: "fitness", source: "FitInn", url: "https://www.fitinn.at/probetraining", expires: "Für Neukunden", distance: "20+ Studios Wien", hot: true, isNew: true, priority: 1, votes: 0 },
  { id: "fitness-2", brand: "McFIT", logo: "💪", title: "Gratis Probetraining", description: "🏋️ Kostenloser Probetag mit vollem Zugang!", type: "gratis", category: "fitness", source: "McFIT", url: "https://www.mcfit.com/at/probetraining/", expires: "Für Neukunden", distance: "5 Studios Wien", hot: true, isNew: true, votes: 0 },
  { id: "fitness-3", brand: "John Harris", logo: "🏊", title: "3 Tage gratis testen", description: "🏋️ Premium Fitness: 3 Tage gratis inkl. Wellness!", type: "gratis", category: "fitness", source: "John Harris", url: "https://www.johnharris.at/probetraining/", expires: "Für Neukunden", distance: "6 Clubs Wien", hot: true, votes: 0 },
  { id: "fitness-4", brand: "clever fit", logo: "💪", title: "Gratis Probetraining", description: "🏋️ Kostenloses Probetraining + Beratung!", type: "gratis", category: "fitness", source: "clever fit", url: "https://www.clever-fit.com/probetraining/", expires: "Für Neukunden", distance: "10+ Studios Wien", hot: true, votes: 0 },
  { id: "fitness-5", brand: "EVO Fitness", logo: "🏃", title: "7 Tage gratis testen", description: "🏋️ Moderne EGYM Geräte - 1 Woche kostenlos!", type: "gratis", category: "fitness", source: "EVO Fitness", url: "https://www.evofitness.at/probetraining/", expires: "Für Neukunden", distance: "Wien 1., 3., 22.", hot: true, votes: 0 },

  // ========== REISEN - NEU! ==========
  { id: "reisen-1", brand: "Ryanair", logo: "✈️", title: "Flüge ab €9,99", description: "✈️ Mallorca, Barcelona, Rom ab €9,99!", type: "rabatt", category: "reisen", source: "Ryanair", url: "https://www.ryanair.com/at/de", expires: "Flash Sale", distance: "Ab Wien-Schwechat", hot: true, isNew: true, priority: 1, votes: 0 },
  { id: "reisen-2", brand: "Wizz Air", logo: "✈️", title: "20% auf alle Flüge", description: "✈️ Code WIZZ20: 20% auf alle Flüge!", type: "rabatt", category: "reisen", source: "Wizz Air", url: "https://wizzair.com/de-de", expires: "Zeitlich begrenzt", distance: "Ab Wien", hot: true, isNew: true, code: "WIZZ20", votes: 0 },
  { id: "reisen-3", brand: "ÖBB Nightjet", logo: "🚂", title: "Nachtzug ab €29,90", description: "🛏️ Im Schlaf nach Venedig, Rom, Hamburg!", type: "rabatt", category: "reisen", source: "ÖBB Nightjet", url: "https://www.oebb.at/de/reiseplanung-services/im-zug/nightjet", expires: "Frühbucher", distance: "Ab Wien Hbf", hot: true, votes: 0 },
  { id: "reisen-4", brand: "Booking.com", logo: "🏨", title: "Genius 15% Rabatt", description: "🏨 Gratis Genius Mitglied = 15% auf Hotels!", type: "rabatt", category: "reisen", source: "Booking.com", url: "https://www.booking.com/genius.html", expires: "Für Mitglieder", distance: "Weltweit", hot: true, votes: 0 },
  { id: "reisen-5", brand: "FlixBus", logo: "🚌", title: "Busreisen ab €4,99", description: "🚌 München, Prag, Budapest ab €4,99!", type: "rabatt", category: "reisen", source: "FlixBus", url: "https://www.flixbus.at", expires: "Frühbucher", distance: "Ab Wien", hot: true, votes: 0 },
  { id: "reisen-6", brand: "Hofer Reisen", logo: "🏖️", title: "Last Minute ab €199", description: "🏖️ Türkei, Griechenland ab €199 All-Inclusive!", type: "rabatt", category: "reisen", source: "Hofer Reisen", url: "https://reisen.hofer.at", expires: "Last Minute", distance: "Ab Wien", hot: true, votes: 0 },
  { id: "reisen-7", brand: "Eurowings", logo: "✈️", title: "Städtetrips ab €29,99", description: "✈️ London, Paris, Barcelona ab €29,99!", type: "rabatt", category: "reisen", source: "Eurowings", url: "https://www.eurowings.com/at", expires: "Aktionsangebote", distance: "Ab Wien", hot: true, votes: 0 },

  // ========== RABATTCODES - NEU! ==========
  { id: "codes-1", brand: "ABOUT YOU", logo: "👗", title: "-15% Code WELCOME15", description: "👗 15% Rabatt auf erste Bestellung!", type: "rabatt", category: "codes", source: "ABOUT YOU", url: "https://www.aboutyou.at", expires: "Für Neukunden", distance: "Online", hot: true, isNew: true, priority: 1, code: "WELCOME15", votes: 0 },
  { id: "codes-2", brand: "HelloFresh", logo: "🥗", title: "Bis zu €90 Rabatt", description: "🥗 Bis zu €90 auf erste 4 Kochboxen!", type: "rabatt", category: "codes", source: "HelloFresh", url: "https://www.hellofresh.at/plans", expires: "Für Neukunden", distance: "Lieferung", hot: true, isNew: true, code: "Auto-aktiviert", votes: 0 },
  { id: "codes-3", brand: "Uber Eats", logo: "🍔", title: "€15 Rabatt", description: "🍔 Code ERSTBESTELLEN: €15 auf erste Bestellung!", type: "rabatt", category: "codes", source: "Uber Eats", url: "https://www.ubereats.com/at", expires: "Für Neukunden", distance: "Wien", hot: true, code: "ERSTBESTELLEN", votes: 0 },
  { id: "codes-4", brand: "Lieferando", logo: "🛵", title: "25% Rabatt", description: "🛵 Code 25RABATT: 25% auf Bestellung (MBW €15)!", type: "rabatt", category: "codes", source: "Lieferando", url: "https://www.lieferando.at", expires: "Begrenzt", distance: "Wien", hot: true, code: "25RABATT", votes: 0 },
  { id: "codes-5", brand: "Zalando", logo: "👟", title: "-10% Newsletter", description: "👟 Newsletter = 10% Rabatt per Email!", type: "rabatt", category: "codes", source: "Zalando", url: "https://www.zalando.at/newsletter/", expires: "Bei Anmeldung", distance: "Online", hot: true, code: "Per Email", votes: 0 },
  { id: "codes-6", brand: "SHEIN", logo: "👚", title: "-15% Code SHEIN15", description: "👚 15% auf alles mit Code SHEIN15!", type: "rabatt", category: "codes", source: "SHEIN", url: "https://at.shein.com", expires: "Begrenzt", distance: "Online", hot: true, code: "SHEIN15", votes: 0 },
  { id: "codes-7", brand: "MediaMarkt", logo: "📺", title: "€10 Newsletter Gutschein", description: "📺 Newsletter = €10 Gutschein!", type: "rabatt", category: "codes", source: "MediaMarkt", url: "https://www.mediamarkt.at/de/newsletter-anmeldung", expires: "Bei Anmeldung", distance: "Online + Store", hot: true, code: "Per Email", votes: 0 },
  { id: "codes-8", brand: "Mjam", logo: "🍕", title: "-30% erste Bestellung", description: "🍕 30% Neukunden-Rabatt in der App!", type: "rabatt", category: "codes", source: "Mjam App", url: "https://www.mjam.at", expires: "Für Neukunden", distance: "Wien", hot: true, code: "In App", votes: 0 },

  // ========== SHOPPING / MARKTPLÄTZE - NEU! ==========
  { id: "schnapp-1", brand: "Amazon", logo: "📦", title: "Tagesangebote bis -70%", description: "📦 Tägliche Blitzangebote - nur kurz verfügbar!", type: "rabatt", category: "shopping", source: "Amazon Angebote", url: "https://www.amazon.de/deals", expires: "Täglich neu", distance: "Online", hot: true, isNew: true, priority: 1, votes: 0 },
  { id: "schnapp-2", brand: "eBay", logo: "🛒", title: "WOW! Angebote", description: "🛒 Tägliche WOW-Deals mit extremen Rabatten!", type: "rabatt", category: "shopping", source: "eBay", url: "https://www.ebay.at/deals", expires: "Täglich neu", distance: "Online", hot: true, votes: 0 },
  { id: "schnapp-3", brand: "Willhaben", logo: "🏷️", title: "Gratis inserieren", description: "🏷️ Bis 5 Anzeigen komplett gratis!", type: "gratis", category: "shopping", source: "Willhaben", url: "https://www.willhaben.at", expires: "Unbegrenzt", distance: "Österreich", hot: true, votes: 0 },
  { id: "schnapp-4", brand: "Shpock", logo: "📱", title: "Second Hand Schnäppchen", description: "📱 Gebrauchtes oft 80% günstiger!", type: "rabatt", category: "shopping", source: "Shpock", url: "https://www.shpock.com/at", expires: "Täglich neu", distance: "Wien", hot: true, votes: 0 },

  // ========== STORE ERÖFFNUNGEN ==========
  { id: "eroeffnung-1", brand: "Action", logo: "🏪", title: "Neueröffnung Gratis-Aktionen", description: "🎁 Bei Neueröffnungen: Gratis Goodie Bags!", type: "gratis", category: "shopping", source: "Action", url: "https://www.action.com/de-at/filialen/", expires: "Bei Eröffnung", distance: "Neue Filialen Wien", hot: true, isNew: true, votes: 0 },
  { id: "eroeffnung-2", brand: "Primark", logo: "👕", title: "Store Opening Goodies", description: "🎁 Gratis Stofftaschen & Gutscheine bei Eröffnung!", type: "gratis", category: "shopping", source: "Primark", url: "https://www.primark.com/de-at/stores", expires: "Bei Eröffnung", distance: "SCS, Donauzentrum", hot: true, votes: 0 },

  // ========== KAFFEE ==========
  { id: "kaffee-2", brand: "Tchibo", logo: "☕", title: "Gratis Kaffee beim Einkauf", description: "☕ Bei jedem Einkauf: Gratis-Kaffee!", type: "gratis", category: "kaffee", source: "Tchibo", url: "https://www.tchibo.at/filialen/", expires: "Unbegrenzt", distance: "Tchibo Filialen", hot: true, votes: 0 },
  { id: "kaffee-3", brand: "Segafredo", logo: "☕", title: "10. Kaffee gratis", description: "☕ Stempelkarte: Jeder 10. Kaffee gratis!", type: "gratis", category: "kaffee", source: "Segafredo", url: "https://www.segafredo.at/standorte/", expires: "Mit Stempelkarte", distance: "Segafredo Wien", hot: false, votes: 0 },
  { id: "kaffee-4", brand: "Shell", logo: "⛽", title: "Gratis Kaffee Clubsmart", description: "☕ Mit Punkten Gratis-Kaffee holen!", type: "gratis", category: "kaffee", source: "Shell Clubsmart", url: "https://www.shell.at/autofahrer/shell-clubsmart.html", expires: "Mit Punkten", distance: "Shell Tankstellen", hot: false, votes: 0 },
  { id: "kaffee-5", brand: "Starbucks", logo: "☕", title: "Gratis Geburtstagsdrink", description: "🎂 Rewards Mitglieder: Gratis Drink am Geburtstag!", type: "gratis", category: "kaffee", source: "Starbucks Rewards", url: "https://www.starbucks.at/rewards", expires: "Am Geburtstag", distance: "Starbucks Wien", hot: true, votes: 0 },

  // ========== ESSEN ==========
  { id: "essen-1", brand: "McDonald's", logo: "🍟", title: "Gratis Cheeseburger bei Registrierung", description: "🍔 App registrieren = Gratis Cheeseburger!", type: "gratis", category: "essen", source: "McDonald's App", url: "https://www.mcdonalds.at/app", expires: "Für Neukunden", distance: "Alle Filialen", hot: true, votes: 0 },
  { id: "essen-3", brand: "Domino's", logo: "🍕", title: "2. Pizza 50%", description: "🍕 Bei Abholung: Zweite Pizza halber Preis!", type: "rabatt", category: "essen", source: "Domino's", url: "https://www.dominos.at/angebote", expires: "Bei Abholung", distance: "Domino's Wien", hot: false, votes: 0 },
  { id: "essen-4", brand: "NORDSEE", logo: "🐟", title: "Gratis Backfisch Häppchen", description: "🐟 Newsletter = Gratis Backfisch Gutschein!", type: "gratis", category: "essen", source: "NORDSEE", url: "https://www.nordsee.com/de/newsletter/", expires: "Bei Anmeldung", distance: "NORDSEE Filialen", hot: true, votes: 0 },

  // ========== SUPERMARKT ==========
  { id: "super-1", brand: "BILLA", logo: "🛒", title: "BILLA Bonus Gutscheine", description: "🛒 Wöchentlich personalisierte Rabatte in der App!", type: "rabatt", category: "supermarkt", source: "BILLA App", url: "https://www.billa.at/plus", expires: "Wöchentlich", distance: "Alle BILLA", hot: true, votes: 0 },
  { id: "super-2", brand: "SPAR", logo: "🛒", title: "25% auf Obst & Gemüse", description: "🥦 Jeden Samstag: 25% auf frisches O&G!", type: "rabatt", category: "supermarkt", source: "SPAR", url: "https://www.spar.at/angebote", expires: "Jeden Samstag", distance: "Alle SPAR", hot: true, votes: 0 },
  { id: "super-3", brand: "HOFER", logo: "🛒", title: "Super Samstag", description: "🛒 Jeden Samstag: Extreme Rabatte!", type: "rabatt", category: "supermarkt", source: "HOFER", url: "https://www.hofer.at/de/angebote.html", expires: "Jeden Samstag", distance: "Alle HOFER", hot: true, votes: 0 },
  { id: "super-4", brand: "Lidl", logo: "🛒", title: "Lidl Plus App Deals", description: "🛒 Exklusive Coupons in der Lidl Plus App!", type: "rabatt", category: "supermarkt", source: "Lidl Plus", url: "https://www.lidl.at/lidl-plus", expires: "In App", distance: "Alle Lidl", hot: true, votes: 0 },

  // ========== BEAUTY ==========
  { id: "beauty-1", brand: "dm", logo: "💄", title: "10% für Studenten", description: "💄 Mit Studentenausweis: 10% auf fast alles!", type: "rabatt", category: "beauty", source: "dm", url: "https://www.dm.at/tipps-und-trends/dm-aktionen", expires: "Mit Ausweis", distance: "Alle dm", hot: false, votes: 0 },
  { id: "beauty-4", brand: "Sephora", logo: "💋", title: "2 Gratis Samples", description: "💄 Bei jeder Bestellung: 2 Gratis Samples!", type: "gratis", category: "beauty", source: "Sephora", url: "https://www.sephora.at/geschenke", expires: "Bei Bestellung", distance: "Online", hot: true, votes: 0 },

  // ========== STREAMING ==========
  { id: "stream-1", brand: "Amazon Prime", logo: "📺", title: "30 Tage gratis", description: "📺 Prime Video + Lieferung + Music gratis!", type: "testabo", category: "streaming", source: "Amazon Prime", url: "https://www.amazon.de/prime", expires: "Für Neukunden", distance: "Online", hot: true, votes: 0 },
  { id: "stream-2", brand: "Spotify", logo: "🎵", title: "1 Monat Premium gratis", description: "🎵 Spotify Premium 1 Monat kostenlos!", type: "testabo", category: "streaming", source: "Spotify", url: "https://www.spotify.com/at/premium/", expires: "Für Neukunden", distance: "Online", hot: true, votes: 0 },
  { id: "stream-4", brand: "Disney+", logo: "🏰", title: "Disney+ ab €5,99", description: "🏰 Günstigstes Abo mit Werbung!", type: "rabatt", category: "streaming", source: "Disney+", url: "https://www.disneyplus.com/de-at", expires: "Unbegrenzt", distance: "Online", hot: false, votes: 0 },
  { id: "stream-5", brand: "YouTube Premium", logo: "▶️", title: "1 Monat gratis", description: "▶️ Keine Werbung + Music - 1 Monat gratis!", type: "testabo", category: "streaming", source: "YouTube", url: "https://www.youtube.com/premium", expires: "Für Neukunden", distance: "Online", hot: false, votes: 0 },

  // ========== TECHNIK ==========
  { id: "tech-1", brand: "Apple Education", logo: "🍎", title: "Bildungsrabatt 10%", description: "🍎 Studenten: 10% auf Mac und iPad!", type: "rabatt", category: "technik", source: "Apple Education", url: "https://www.apple.com/at-edu/shop", expires: "Mit Nachweis", distance: "Online", hot: true, votes: 0 },
  { id: "tech-2", brand: "Samsung", logo: "📱", title: "Trade-In bis €600", description: "📱 Altes Handy eintauschen = bis €600 sparen!", type: "rabatt", category: "technik", source: "Samsung Trade-In", url: "https://www.samsung.com/at/offer/trade-in/", expires: "Bei Trade-In", distance: "Online", hot: true, votes: 0 },
  { id: "tech-3", brand: "MediaMarkt", logo: "📺", title: "0% Finanzierung", description: "📺 Jetzt kaufen, später zahlen - 0% Zinsen!", type: "rabatt", category: "technik", source: "MediaMarkt", url: "https://www.mediamarkt.at/de/shop/finanzierung", expires: "Ab €299", distance: "MediaMarkt", hot: false, votes: 0 },

  // ========== MODE ==========
  { id: "mode-1", brand: "H&M", logo: "👕", title: "10% H&M Member", description: "👕 Member werden: 10% Willkommensrabatt!", type: "rabatt", category: "mode", source: "H&M Member", url: "https://www2.hm.com/de_at/member/info.html", expires: "Bei Anmeldung", distance: "H&M Wien", hot: true, votes: 0 },

  // ========== MOBILITÄT ==========
  { id: "mobil-1", brand: "Wiener Linien", logo: "🚇", title: "Jahreskarte €365", description: "🚇 Ganz Wien um nur €1/Tag!", type: "rabatt", category: "mobilität", source: "Wiener Linien", url: "https://www.wienerlinien.at/jahreskarte", expires: "Ganzjährig", distance: "Wien", hot: true, votes: 0 },
  { id: "mobil-2", brand: "ÖBB", logo: "🚂", title: "Sparschiene ab €9,90", description: "🚂 Bahntickets ab €9,90!", type: "rabatt", category: "mobilität", source: "ÖBB", url: "https://www.oebb.at/de/angebote-ermaessigungen/sparschiene", expires: "Frühbucher", distance: "Österreich", hot: true, votes: 0 },
  { id: "mobil-3", brand: "Bolt", logo: "🛴", title: "Gratis Freifahrt", description: "🛴 Erste E-Scooter Fahrt gratis!", type: "gratis", category: "mobilität", source: "Bolt", url: "https://bolt.eu/de-at/scooters/", expires: "Für Neukunden", distance: "Wien", hot: true, votes: 0 },
  { id: "mobil-4", brand: "Lime", logo: "🛴", title: "50% erste Fahrt", description: "🛴 50% auf erste E-Scooter Fahrt!", type: "rabatt", category: "mobilität", source: "Lime", url: "https://www.li.me/de/home", expires: "Für Neukunden", distance: "Wien", hot: false, votes: 0 },

  // ========== WIEN ==========
  { id: "wien-2", brand: "Haus der Geschichte", logo: "🏛️", title: "Gratis jeden Donnerstag", description: "🏛️ Jeden Do 18-20h: Freier Eintritt!", type: "gratis", category: "wien", source: "hdgö", url: "https://www.hdgoe.at/besuchen", expires: "Jeden Do 18-20h", distance: "Heldenplatz, 1010", hot: true, votes: 0 },
  { id: "wien-4", brand: "Zoom Kindermuseum", logo: "👶", title: "Gratis unter 3", description: "👶 Kinder unter 3: Freier Eintritt!", type: "gratis", category: "wien", source: "Zoom", url: "https://www.kindermuseum.at/besuchen/tickets_preise", expires: "Unter 3 Jahre", distance: "MuseumsQuartier", hot: true, votes: 0 },
  { id: "wien-5", brand: "Büchereien Wien", logo: "📚", title: "Gratis Bibliotheksausweis", description: "📚 Unter 18: Gratis Bücher, DVDs, E-Books!", type: "gratis", category: "wien", source: "Büchereien Wien", url: "https://buechereien.wien.gv.at/B%C3%BCchereien-Wien/Anmeldung", expires: "Unter 18", distance: "Alle Büchereien", hot: true, votes: 0 },

  // ========== FINANZEN ==========
  { id: "wien-3", brand: "Erste Bank", logo: "🏦", title: "Gratis Konto unter 27", description: "💳 Kostenloses Girokonto für unter 27!", type: "gratis", category: "finanzen", source: "Erste Bank", url: "https://www.sparkasse.at/erstebank/privatkunden/konto-karten/girokonto-jugend", expires: "Bis 27 Jahre", distance: "Alle Filialen", hot: true, votes: 0 },
];

// ============================================
// HTTP FETCHER
// ============================================

function fetchURL(url, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const req = protocol.get(url, { 
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'de-AT,de;q=0.9,en;q=0.8'
      },
      timeout: timeout
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchURL(res.headers.location, timeout).then(resolve).catch(reject);
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

// ============================================
// RSS PARSER
// ============================================

// Bereinigt Text von HTML, Links und unerwünschten Zeichen
function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/<a[^>]*>.*?<\/a>/gi, '')           // Entferne komplette <a> Tags mit Inhalt
    .replace(/<[^>]*>/g, '')                      // Entferne alle anderen HTML-Tags
    .replace(/&lt;a\s+href[^&]*&gt;/gi, '')      // Entferne escaped <a href...>
    .replace(/&lt;[^&]*&gt;/g, '')               // Entferne alle escaped HTML-Tags
    .replace(/https?:\/\/[^\s<>"]+/gi, '')       // Entferne alle URLs
    .replace(/&nbsp;/g, ' ')                      // Ersetze &nbsp;
    .replace(/&amp;/g, '&')                       // Ersetze &amp;
    .replace(/&quot;/g, '"')                      // Ersetze &quot;
    .replace(/&#\d+;/g, '')                       // Entferne HTML-Entities
    .replace(/\s+/g, ' ')                         // Mehrfache Leerzeichen zusammenfassen
    .trim();
}

function parseRSS(xml, source) {
  const deals = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  
  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1];
    const titleRaw = (item.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/i) || [])[1] || '';
    const link = (item.match(/<link>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/link>/i) || [])[1] || '';
    const descRaw = (item.match(/<description>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/description>/is) || [])[1] || '';
    const pubDate = (item.match(/<pubDate>(.*?)<\/pubDate>/i) || [])[1] || '';
    
    // Bereinige Title und Description
    const title = cleanText(titleRaw);
    const desc = cleanText(descRaw);
    
    // Überspringe wenn nach Bereinigung zu kurz
    if (title.length < 10) continue;
    
    const text = `${title} ${desc}`.toLowerCase();
    const isGratis = GRATIS_KEYWORDS.some(k => text.includes(k));
    const isDeal = DEAL_KEYWORDS.some(k => text.includes(k));
    const isReisen = REISEN_KEYWORDS.some(k => text.includes(k));
    const isFitness = FITNESS_KEYWORDS.some(k => text.includes(k));
    
    if (isGratis || isDeal || isReisen || isFitness) {
      let category = source.category;
      if (isFitness) category = 'fitness';
      if (isReisen) category = 'reisen';
      
      // Erstelle eine saubere Beschreibung
      let cleanDesc = desc.substring(0, 120);
      if (cleanDesc.length < 20) {
        cleanDesc = `Aktuelles Angebot: ${title}`;
      }
      
      deals.push({
        id: `rss-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        brand: source.brand,
        logo: source.logo,
        title: title.substring(0, 80),
        description: cleanDesc,
        type: isGratis ? 'gratis' : 'rabatt',
        category: category,
        source: source.name,
        url: link || source.url,
        expires: 'Siehe Website',
        distance: 'Wien',
        hot: isGratis,
        isNew: true,
        pubDate: pubDate,
        votes: 0
      });
    }
  }
  
  return deals.slice(0, 5);
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
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].substring(0, 60) : source.name;
    
    deals.push({
      id: `html-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      brand: source.brand,
      logo: source.logo,
      title: `Aktuelle Angebote bei ${source.brand}`,
      description: `Jetzt aktuelle Deals und Angebote bei ${source.brand} entdecken!`,
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
// OUTDATED FILTER
// ============================================

function isOutdatedDeal(deal) {
  if (deal.id.startsWith('top-') || deal.id.startsWith('fitness-') || deal.id.startsWith('reisen-') || deal.id.startsWith('codes-')) {
    return false;
  }
  
  if (deal.pubDate) {
    const pubDate = new Date(deal.pubDate);
    const daysSincePub = (Date.now() - pubDate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSincePub > 14) return true;
  }
  
  return false;
}

// ============================================
// MAIN SCRAPER
// ============================================

async function scrapeAllSources() {
  console.log('🚀 POWER SCRAPER V3 gestartet...\n');
  console.log(`📅 ${new Date().toLocaleString('de-AT')}\n`);
  console.log(`📡 ${SOURCES.length} Quellen werden gescraped...\n`);
  
  const scrapedDeals = [];
  const errors = [];
  
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
      errors.push(source.name);
      console.log(`❌ ${source.name}: ${error.message}`);
    }
  }
  
  // Kombiniere Base + Scraped Deals
  const allDeals = [...BASE_DEALS, ...scrapedDeals];
  
  // Filter abgelaufene Deals
  const validDeals = allDeals.filter(d => !isOutdatedDeal(d));
  
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
  
  // Sortiere
  uniqueDeals.sort((a, b) => {
    if ((a.priority || 99) !== (b.priority || 99)) return (a.priority || 99) - (b.priority || 99);
    if (a.hot && !b.hot) return -1;
    if (!a.hot && b.hot) return 1;
    if (a.type === 'gratis' && b.type !== 'gratis') return -1;
    return 0;
  });
  
  // Output
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
  console.log(`   💪 Fitness: ${uniqueDeals.filter(d => d.category === 'fitness').length}`);
  console.log(`   ✈️  Reisen: ${uniqueDeals.filter(d => d.category === 'reisen').length}`);
  console.log(`   🏷️  Codes: ${uniqueDeals.filter(d => d.category === 'codes').length}`);
  console.log(`   🛍️  Shopping: ${uniqueDeals.filter(d => d.category === 'shopping').length}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
}

scrapeAllSources()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Scraper Error:', err.message);
    process.exit(0);
  });

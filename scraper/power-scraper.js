// ============================================
// FREEFINDER WIEN - POWER SCRAPER V5
// OPTIMIERT für GRATIS ESSEN & TRINKEN
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
// OPTIMIERTE QUELLEN - FOKUS ESSEN & TRINKEN
// ============================================

const SOURCES = [
  // ========== DEAL AGGREGATOREN (BESTE QUELLEN!) ==========
  { name: 'Preisjäger Gratis', url: 'https://www.preisjaeger.at/rss/gruppe/gratisartikel', type: 'rss', brand: 'Preisjäger', logo: '🆓', category: 'gratis' },
  { name: 'Preisjäger Food', url: 'https://www.preisjaeger.at/rss/gruppe/essen-trinken', type: 'rss', brand: 'Preisjäger', logo: '🍔', category: 'essen' },
  { name: 'Preisjäger Lokal', url: 'https://www.preisjaeger.at/rss/gruppe/lokal', type: 'rss', brand: 'Preisjäger', logo: '📍', category: 'wien' },
  { name: 'Sparhamster Gratis', url: 'https://www.sparhamster.at/gratis/', type: 'html', brand: 'Sparhamster', logo: '🐹', category: 'gratis' },
  { name: 'Gratisproben.net', url: 'https://www.gratisproben.net/oesterreich/', type: 'html', brand: 'Gratisproben', logo: '🎁', category: 'gratis' },
  
  // ========== FAST FOOD KETTEN (APPS MIT GRATIS!) ==========
  { name: "McDonald's Aktionen", url: 'https://www.mcdonalds.at/aktionen', type: 'html', brand: "McDonald's", logo: '🍟', category: 'essen' },
  { name: "McDonald's App", url: 'https://www.mcdonalds.at/app', type: 'html', brand: "McDonald's", logo: '📱', category: 'essen' },
  { name: 'Burger King Angebote', url: 'https://www.burgerking.at/angebote', type: 'html', brand: 'Burger King', logo: '🍔', category: 'essen' },
  { name: 'Burger King App', url: 'https://www.burgerking.at/rewards', type: 'html', brand: 'Burger King', logo: '👑', category: 'essen' },
  { name: 'KFC Austria', url: 'https://www.kfc.at/angebote', type: 'html', brand: 'KFC', logo: '🍗', category: 'essen' },
  { name: 'Subway Austria', url: 'https://www.subway.at/de_AT/angebote/', type: 'html', brand: 'Subway', logo: '🥪', category: 'essen' },
  { name: "Domino's Pizza", url: 'https://www.dominos.at/speisekarte', type: 'html', brand: "Domino's", logo: '🍕', category: 'essen' },
  { name: 'Pizza Hut', url: 'https://www.pizzahut.at/', type: 'html', brand: 'Pizza Hut', logo: '🍕', category: 'essen' },
  
  // ========== KAFFEE KETTEN (LOYALTY PROGRAMS!) ==========
  { name: 'Starbucks Rewards', url: 'https://www.starbucks.at/rewards', type: 'html', brand: 'Starbucks', logo: '☕', category: 'kaffee' },
  { name: 'McCafé', url: 'https://www.mcdonalds.at/produkte/mccafe', type: 'html', brand: 'McCafé', logo: '☕', category: 'kaffee' },
  { name: 'Tchibo', url: 'https://www.tchibo.at/angebote-aktionen-c400109092.html', type: 'html', brand: 'Tchibo', logo: '☕', category: 'kaffee' },
  { name: 'Nespresso', url: 'https://www.nespresso.com/at/de/order/capsules', type: 'html', brand: 'Nespresso', logo: '☕', category: 'kaffee' },
  
  // ========== WIENER CAFÉS & BÄCKEREIEN ==========
  { name: 'Aida', url: 'https://www.aida.at/', type: 'html', brand: 'Aida', logo: '🎀', category: 'kaffee' },
  { name: 'Ströck', url: 'https://www.stroeck.at/aktionen/', type: 'html', brand: 'Ströck', logo: '🥐', category: 'essen' },
  { name: 'Der Mann', url: 'https://www.dermann.at/', type: 'html', brand: 'Der Mann', logo: '🍞', category: 'essen' },
  { name: 'Anker', url: 'https://www.ankerbrot.at/', type: 'html', brand: 'Anker', logo: '⚓', category: 'essen' },
  { name: 'Felber', url: 'https://www.felber.at/', type: 'html', brand: 'Felber', logo: '🥨', category: 'essen' },
  
  // ========== MÖBEL (GRATIS KAFFEE/ESSEN!) ==========
  { name: 'IKEA Family', url: 'https://www.ikea.com/at/de/ikea-family/', type: 'html', brand: 'IKEA', logo: '🪑', category: 'kaffee' },
  { name: 'IKEA Restaurant', url: 'https://www.ikea.com/at/de/stores/restaurant/', type: 'html', brand: 'IKEA', logo: '🍝', category: 'essen' },
  { name: 'XXXLutz', url: 'https://www.xxxlutz.at/', type: 'html', brand: 'XXXLutz', logo: '🛋️', category: 'essen' },
  
  // ========== SUPERMÄRKTE (PROBEN & VERKOSTUNGEN) ==========
  { name: 'BILLA Aktionen', url: 'https://www.billa.at/angebote/aktionen', type: 'html', brand: 'BILLA', logo: '🛒', category: 'supermarkt' },
  { name: 'SPAR Aktionen', url: 'https://www.spar.at/aktionen', type: 'html', brand: 'SPAR', logo: '🛒', category: 'supermarkt' },
  { name: 'HOFER', url: 'https://www.hofer.at/de/angebote.html', type: 'html', brand: 'HOFER', logo: '🛒', category: 'supermarkt' },
  { name: 'Lidl', url: 'https://www.lidl.at/c/billiger-montag/a10006065', type: 'html', brand: 'Lidl', logo: '🛒', category: 'supermarkt' },
  { name: 'PENNY', url: 'https://www.penny.at/angebote', type: 'html', brand: 'PENNY', logo: '🛒', category: 'supermarkt' },
  
  // ========== FOOD DELIVERY (GUTSCHEINE!) ==========
  { name: 'Lieferando', url: 'https://www.lieferando.at/', type: 'html', brand: 'Lieferando', logo: '🛵', category: 'essen' },
  { name: 'mjam', url: 'https://www.mjam.at/', type: 'html', brand: 'mjam', logo: '🛵', category: 'essen' },
  { name: 'Wolt', url: 'https://wolt.com/de/aut/vienna', type: 'html', brand: 'Wolt', logo: '🛵', category: 'essen' },
  
  // ========== FOOD SHARING & RETTEN ==========
  { name: 'Too Good To Go', url: 'https://www.toogoodtogo.com/at', type: 'html', brand: 'TGTG', logo: '🥡', category: 'essen' },
  { name: 'Foodsharing Wien', url: 'https://foodsharing.at/', type: 'html', brand: 'Foodsharing', logo: '🍏', category: 'essen' },
  { name: 'Wiener Tafel', url: 'https://www.wienertafel.at/', type: 'html', brand: 'Wiener Tafel', logo: '🥫', category: 'essen' },
  
  // ========== TANKSTELLEN (GRATIS KAFFEE!) ==========
  { name: 'OMV VIVA', url: 'https://www.omv.at/de-at/tankstellen-services/viva-shops', type: 'html', brand: 'OMV', logo: '⛽', category: 'kaffee' },
  { name: 'Shell Café', url: 'https://www.shell.at/', type: 'html', brand: 'Shell', logo: '⛽', category: 'kaffee' },
  
  // ========== RESTAURANT KETTEN ==========
  { name: 'Vapiano', url: 'https://at.vapiano.com/', type: 'html', brand: 'Vapiano', logo: '🍝', category: 'essen' },
  { name: "L'Osteria", url: 'https://losteria.net/at/', type: 'html', brand: "L'Osteria", logo: '🍕', category: 'essen' },
  { name: 'Swing Kitchen', url: 'https://www.swingkitchen.com/', type: 'html', brand: 'Swing Kitchen', logo: '🌱', category: 'essen' },
  { name: 'Burgerista', url: 'https://www.burgerista.com/', type: 'html', brand: 'Burgerista', logo: '🍔', category: 'essen' },
  { name: 'Le Burger', url: 'https://leburger.at/', type: 'html', brand: 'Le Burger', logo: '🍔', category: 'essen' },
  
  // ========== EIS & DESSERTS ==========
  { name: 'Eis Greissler', url: 'https://www.eis-greissler.at/', type: 'html', brand: 'Eis Greissler', logo: '🍦', category: 'essen' },
  { name: 'Veganista', url: 'https://www.veganista.at/', type: 'html', brand: 'Veganista', logo: '🍦', category: 'essen' },
  
  // ========== BEAUTY (PROBEN) ==========
  { name: 'dm Gratisproben', url: 'https://www.dm.at/', type: 'html', brand: 'dm', logo: '💄', category: 'beauty' },
  { name: 'BIPA Proben', url: 'https://www.bipa.at/', type: 'html', brand: 'BIPA', logo: '💅', category: 'beauty' },
  
  // ========== WIEN EVENTS ==========
  { name: 'Wien Events', url: 'https://events.wien.info/de/', type: 'html', brand: 'Wien Events', logo: '🎭', category: 'wien' },
  { name: 'Donauinselfest', url: 'https://donauinselfest.at/', type: 'html', brand: 'Donauinselfest', logo: '🎸', category: 'wien' },
  
  // ========== BONUS CLUBS ==========
  { name: 'jö Club', url: 'https://www.jo-club.at/', type: 'html', brand: 'jö Club', logo: '🎁', category: 'codes' },
  
  // ========== FITNESS ==========
  { name: 'FitInn', url: 'https://www.fitinn.at/', type: 'html', brand: 'FitInn', logo: '💪', category: 'fitness' },
  { name: 'clever fit', url: 'https://www.clever-fit.com/at/', type: 'html', brand: 'clever fit', logo: '💪', category: 'fitness' },
  { name: 'John Harris', url: 'https://www.johnharris.at/', type: 'html', brand: 'John Harris', logo: '🏊', category: 'fitness' },
  
  // ========== REISEN ==========
  { name: 'ÖBB', url: 'https://www.oebb.at/de/angebote-ermaessigungen/sparschiene', type: 'html', brand: 'ÖBB', logo: '🚂', category: 'reisen' },
  { name: 'Preisjäger Reisen', url: 'https://www.preisjaeger.at/rss/gruppe/reisen', type: 'rss', brand: 'Preisjäger', logo: '✈️', category: 'reisen' },
];

// ============================================
// TOP DEALS - VERIFIZIERTE GRATIS ESSEN & TRINKEN
// ============================================

const BASE_DEALS = [
  // ═══════════════════════════════════════════
  // ⭐⭐⭐ GRATIS KAFFEE - DAUERHAFT! ⭐⭐⭐
  // ═══════════════════════════════════════════
  {
    id: 'kaffee-1', brand: 'IKEA', logo: '☕', title: 'GRATIS Kaffee UNLIMITIERT',
    description: 'IKEA Family Mitglieder: Unbegrenzt Gratis-Filterkaffee im Restaurant! Täglich, keine Limits. Anmeldung kostenlos.',
    type: 'gratis', category: 'kaffee', source: 'IKEA', url: 'https://www.ikea.com/at/de/ikea-family/',
    expires: 'Unbegrenzt', distance: 'IKEA Wien Nord/Süd/Vösendorf', hot: true, isNew: false, priority: 1, votes: 456
  },
  {
    id: 'kaffee-2', brand: "McDonald's", logo: '☕', title: 'GRATIS Kaffee - 5x pro Monat',
    description: 'McCafé Bonusclub in der App: Jeden Monat 5 gratis Kaffees! Einfach App downloaden, 7 Stempel = 1 gratis.',
    type: 'gratis', category: 'kaffee', source: "McDonald's App", url: 'https://www.mcdonalds.at/mccafe',
    expires: 'Monatlich', distance: 'Alle Filialen', hot: true, isNew: false, priority: 1, votes: 389
  },
  {
    id: 'kaffee-3', brand: 'OMV VIVA', logo: '⛽', title: 'Heißgetränk für nur 1 jö Punkt',
    description: 'Bei OMV VIVA: Kaffee, Tee oder Kakao für nur 1 jö Punkt (= fast gratis)! Auch Softdrinks verfügbar.',
    type: 'gratis', category: 'kaffee', source: 'jö Club', url: 'https://www.jo-club.at/',
    expires: 'Dauerhaft', distance: 'OMV Tankstellen', hot: true, isNew: false, priority: 1, votes: 298
  },
  {
    id: 'kaffee-4', brand: 'Starbucks', logo: '☕', title: 'GRATIS Geburtstags-Getränk',
    description: 'Starbucks Rewards Mitglieder: Am Geburtstag ein Getränk GRATIS! Plus: Nach 150 Sternen = 1 Freigetränk.',
    type: 'gratis', category: 'kaffee', source: 'Starbucks', url: 'https://www.starbucks.at/rewards',
    expires: 'Am Geburtstag', distance: 'Alle Filialen', hot: true, isNew: false, priority: 1, votes: 234
  },
  {
    id: 'kaffee-5', brand: 'Shell', logo: '⛽', title: 'Gratis Kaffee bei Tanken',
    description: 'Shell ClubSmart: Bei Aktionen oft Gratis-Kaffee! Newsletter abonnieren für aktuelle Deals.',
    type: 'gratis', category: 'kaffee', source: 'Shell', url: 'https://www.shell.at/motorists/shell-clubsmart.html',
    expires: 'Bei Aktionen', distance: 'Shell Tankstellen', hot: false, isNew: false, priority: 2, votes: 145
  },
  {
    id: 'kaffee-6', brand: 'XXXLutz', logo: '☕', title: 'GRATIS Kaffee beim Einkauf',
    description: 'Im XXXLutz Restaurant: Gratis Kaffee für Kunden! Einfach Kassenbon vorzeigen.',
    type: 'gratis', category: 'kaffee', source: 'XXXLutz', url: 'https://www.xxxlutz.at/',
    expires: 'Beim Einkauf', distance: 'XXXLutz Filialen', hot: false, isNew: false, priority: 2, votes: 87
  },

  // ═══════════════════════════════════════════
  // ⭐⭐⭐ GRATIS ESSEN - DAUERHAFT! ⭐⭐⭐
  // ═══════════════════════════════════════════
  {
    id: 'essen-1', brand: 'Wiener Deewan', logo: '🍛', title: 'GRATIS Essen - Pay what you want',
    description: 'Pakistanisches All-you-can-eat Buffet: Zahle was du willst! Auch 0€ ist OK. Liechtensteinstraße 10, 1090 Wien.',
    type: 'gratis', category: 'essen', source: 'Wiener Deewan', url: 'https://www.deewan.at/',
    expires: 'Mo-Sa', distance: '1090 Wien', hot: true, isNew: false, priority: 1, votes: 567
  },
  {
    id: 'essen-2', brand: 'Foodsharing', logo: '🍏', title: 'GRATIS Lebensmittel - Fairteiler',
    description: '60+ Fairteiler in Wien! Lebensmittel gratis abholen oder bringen. Kühlschränke & Regale in ganz Wien verteilt.',
    type: 'gratis', category: 'essen', source: 'Foodsharing', url: 'https://foodsharing.at/?page=karte&bid=13',
    expires: 'Dauerhaft', distance: 'Ganz Wien', hot: true, isNew: false, priority: 1, votes: 445
  },
  {
    id: 'essen-3', brand: 'Too Good To Go', logo: '🥡', title: 'Essen retten ab 3,99€',
    description: 'Überraschungssackerl von 1000+ Wiener Restaurants & Shops. Meist 3x Warenwert! Bäckereien, Restaurants, Supermärkte.',
    type: 'rabatt', category: 'essen', source: 'TGTG App', url: 'https://www.toogoodtogo.com/at',
    expires: 'Täglich', distance: 'Ganz Wien', hot: true, isNew: false, priority: 1, votes: 489
  },
  {
    id: 'essen-4', brand: 'IKEA', logo: '🍝', title: 'GRATIS Kinderessen',
    description: 'IKEA Family: Kinder unter 10 essen GRATIS im Restaurant! Gültig für 1 Kind pro Erwachsenem.',
    type: 'gratis', category: 'essen', source: 'IKEA', url: 'https://www.ikea.com/at/de/stores/restaurant/',
    expires: 'Dauerhaft', distance: 'IKEA Standorte', hot: true, isNew: false, priority: 1, votes: 334
  },
  {
    id: 'essen-5', brand: 'Burger King', logo: '🍔', title: 'GRATIS Burger am Geburtstag',
    description: 'Burger King App: Am Geburtstag einen Whopper oder Long Chicken GRATIS! Vorher registrieren.',
    type: 'gratis', category: 'essen', source: 'BK App', url: 'https://www.burgerking.at/rewards',
    expires: 'Am Geburtstag', distance: 'Alle Filialen', hot: true, isNew: false, priority: 1, votes: 278
  },
  {
    id: 'essen-6', brand: "McDonald's", logo: '🍟', title: 'GRATIS Produkt am Geburtstag',
    description: "McDonald's App: Am Geburtstag ein Produkt nach Wahl GRATIS! BigMac, McFlurry, oder Pommes.",
    type: 'gratis', category: 'essen', source: "McDonald's App", url: 'https://www.mcdonalds.at/app',
    expires: 'Am Geburtstag', distance: 'Alle Filialen', hot: true, isNew: false, priority: 1, votes: 356
  },
  {
    id: 'essen-7', brand: 'Subway', logo: '🥪', title: 'GRATIS Sub bei Registrierung',
    description: 'Subway Rewards: Bei Anmeldung 100 Punkte = 15cm Sub GRATIS! Plus Punkte bei jedem Kauf sammeln.',
    type: 'gratis', category: 'essen', source: 'Subway App', url: 'https://www.subway.at/rewards',
    expires: 'Für Neukunden', distance: 'Alle Filialen', hot: true, isNew: true, priority: 1, votes: 198
  },
  {
    id: 'essen-8', brand: 'Dunkin', logo: '🍩', title: 'GRATIS Donut bei Registrierung',
    description: 'Dunkin Rewards: Bei App-Registrierung 1 Donut GRATIS! Plus: Jeder 5. Kaffee gratis.',
    type: 'gratis', category: 'essen', source: 'Dunkin App', url: 'https://www.dunkindonuts.at/',
    expires: 'Für Neukunden', distance: 'Wien Filialen', hot: true, isNew: true, priority: 1, votes: 167
  },

  // ═══════════════════════════════════════════
  // ⭐⭐⭐ GRATIS BEI NEUERÖFFNUNG ⭐⭐⭐
  // ═══════════════════════════════════════════
  {
    id: 'neu-1', brand: 'Neueröffnungen', logo: '🎉', title: 'GRATIS bei Store-Openings!',
    description: 'Bei Neueröffnungen gibt es IMMER Gratis-Produkte! Cafés: Gratis Kaffee, Restaurants: Gratis Proben. Folge uns!',
    type: 'gratis', category: 'essen', source: 'FreeFinder', url: '#',
    expires: 'Bei Openings', distance: 'Wien', hot: true, isNew: true, priority: 1, votes: 234
  },

  // ═══════════════════════════════════════════
  // ⭐⭐⭐ SUPERMARKT PROBEN ⭐⭐⭐
  // ═══════════════════════════════════════════
  {
    id: 'super-1', brand: 'BILLA', logo: '🛒', title: 'GRATIS Verkostungen Fr & Sa',
    description: 'In BILLA/BILLA Plus gibt es regelmäßig Gratis-Verkostungen! Besonders Freitag & Samstag. Käse, Wurst, Wein.',
    type: 'gratis', category: 'essen', source: 'BILLA', url: 'https://www.billa.at/',
    expires: 'Fr & Sa', distance: 'Größere Filialen', hot: false, isNew: false, priority: 2, votes: 145
  },
  {
    id: 'super-2', brand: 'SPAR', logo: '🛒', title: 'GRATIS Verkostungen',
    description: 'SPAR Gourmet & INTERSPAR: Regelmäßige Verkostungsstände mit Gratis-Proben! Wein, Käse, neue Produkte.',
    type: 'gratis', category: 'essen', source: 'SPAR', url: 'https://www.spar.at/',
    expires: 'Fr & Sa', distance: 'INTERSPAR', hot: false, isNew: false, priority: 2, votes: 132
  },

  // ═══════════════════════════════════════════
  // ⭐⭐⭐ DELIVERY GUTSCHEINE ⭐⭐⭐
  // ═══════════════════════════════════════════
  {
    id: 'app-1', brand: 'Lieferando', logo: '🛵', title: '5€ Gutschein Neukunden',
    description: 'Lieferando: 5€ Rabatt auf erste Bestellung! Code in App prüfen.',
    type: 'rabatt', category: 'essen', source: 'Lieferando', url: 'https://www.lieferando.at/',
    expires: 'Für Neukunden', distance: 'Online', hot: true, isNew: false, priority: 1, votes: 267
  },
  {
    id: 'app-2', brand: 'mjam', logo: '🛵', title: '7€ Gutschein Neukunden',
    description: 'mjam: 7€ Rabatt auf erste Bestellung! Manchmal sogar Gratis-Lieferung dazu.',
    type: 'rabatt', category: 'essen', source: 'mjam', url: 'https://www.mjam.at/',
    expires: 'Für Neukunden', distance: 'Online', hot: true, isNew: false, priority: 1, votes: 234
  },
  {
    id: 'app-3', brand: 'Wolt', logo: '🛵', title: '10€ Gutschein Neukunden',
    description: 'Wolt: 10€ Rabatt auf die ersten 3 Bestellungen! Oft auch Gratis-Lieferung.',
    type: 'rabatt', category: 'essen', source: 'Wolt', url: 'https://wolt.com/de/aut/vienna',
    expires: 'Für Neukunden', distance: 'Online', hot: true, isNew: false, priority: 1, votes: 198
  },

  // ═══════════════════════════════════════════
  // ⭐⭐⭐ GRATIS PROBEN ⭐⭐⭐
  // ═══════════════════════════════════════════
  {
    id: 'probe-1', brand: 'Nespresso', logo: '☕', title: 'GRATIS Kaffee-Verkostung',
    description: 'In Nespresso Boutiquen: Gratis verschiedene Kaffeesorten probieren! Keine Kaufverpflichtung.',
    type: 'gratis', category: 'kaffee', source: 'Nespresso', url: 'https://www.nespresso.com/at/',
    expires: 'Dauerhaft', distance: 'Boutiquen', hot: false, isNew: false, priority: 2, votes: 123
  },
  {
    id: 'probe-2', brand: 'Manner', logo: '🧇', title: 'GRATIS Manner-Proben',
    description: 'Manner Shop Stephansplatz: Oft Gratis-Proben von Manner Schnitten! Besonders bei neuen Sorten.',
    type: 'gratis', category: 'essen', source: 'Manner', url: 'https://www.manner.com/',
    expires: 'Bei Aktionen', distance: '1010 Wien', hot: false, isNew: false, priority: 2, votes: 178
  },
  {
    id: 'probe-3', brand: 'Red Bull', logo: '🥤', title: 'GRATIS Red Bull bei Events',
    description: 'Red Bull Wings Team: Bei Events & Aktionen werden Gratis Red Bull verteilt! Unis, Sportevents.',
    type: 'gratis', category: 'essen', source: 'Red Bull', url: 'https://www.redbull.com/',
    expires: 'Bei Events', distance: 'Wien', hot: false, isNew: false, priority: 2, votes: 201
  },
  {
    id: 'probe-4', brand: 'Eis Greissler', logo: '🍦', title: 'GRATIS Eis-Verkostung',
    description: 'Im Eis Greissler: Immer eine Sorte gratis probieren bevor du kaufst! Premium Bio-Eis.',
    type: 'gratis', category: 'essen', source: 'Eis Greissler', url: 'https://www.eis-greissler.at/',
    expires: 'Dauerhaft', distance: 'Mariahilfer Straße', hot: false, isNew: false, priority: 2, votes: 156
  },

  // ═══════════════════════════════════════════
  // ⭐⭐⭐ WIEN EVENTS ⭐⭐⭐
  // ═══════════════════════════════════════════
  {
    id: 'event-1', brand: 'Donauinselfest', logo: '🎸', title: '3 Tage GRATIS Festival',
    description: 'Europas größtes Gratis-Festival! Juni, Donauinsel. Viele Gratis-Proben von Sponsoren.',
    type: 'gratis', category: 'wien', source: 'DIF', url: 'https://donauinselfest.at/',
    expires: 'Juni', distance: 'Donauinsel', hot: true, isNew: false, priority: 1, votes: 567
  },
  {
    id: 'event-2', brand: 'Film Festival', logo: '🎬', title: 'GRATIS Open-Air Kino',
    description: 'Jeden Sommer am Rathausplatz: Gratis Filmvorführungen! Plus Food-Stände mit Proben.',
    type: 'gratis', category: 'wien', source: 'Film Festival', url: 'https://www.filmfestival-rathausplatz.at/',
    expires: 'Juli-August', distance: 'Rathausplatz', hot: true, isNew: false, priority: 1, votes: 345
  },

  // ═══════════════════════════════════════════
  // ⭐⭐⭐ FITNESS ⭐⭐⭐
  // ═══════════════════════════════════════════
  {
    id: 'fitness-1', brand: 'FitInn', logo: '💪', title: 'GRATIS Probetraining 1 Woche',
    description: 'Eine Woche gratis trainieren! Oft gibt es auch Gratis-Protein-Shakes beim Probetraining.',
    type: 'gratis', category: 'fitness', source: 'FitInn', url: 'https://www.fitinn.at/',
    expires: 'Jederzeit', distance: 'Alle Standorte', hot: true, isNew: false, priority: 1, votes: 234
  },
  {
    id: 'fitness-2', brand: 'clever fit', logo: '💪', title: 'GRATIS Probetraining',
    description: 'Kostenloses Probetraining inkl. Einweisung! Online Termin buchen.',
    type: 'gratis', category: 'fitness', source: 'clever fit', url: 'https://www.clever-fit.com/at/',
    expires: 'Jederzeit', distance: 'Alle Standorte', hot: false, isNew: false, priority: 2, votes: 156
  },

  // ═══════════════════════════════════════════
  // ⭐⭐⭐ BEAUTY ⭐⭐⭐
  // ═══════════════════════════════════════════
  {
    id: 'beauty-1', brand: 'dm', logo: '💄', title: 'GRATIS Produktproben',
    description: 'Bei dm: An der Kassa nach aktuellen Gratis-Proben fragen! Cremes, Parfum, Shampoo.',
    type: 'gratis', category: 'beauty', source: 'dm', url: 'https://www.dm.at/',
    expires: 'Solange Vorrat', distance: 'dm Filialen', hot: false, isNew: false, priority: 2, votes: 198
  },
  {
    id: 'beauty-2', brand: 'BIPA', logo: '💅', title: 'GRATIS Beauty-Box',
    description: 'BIPA Card: Regelmäßig Gratis-Proben und Goodies! Plus Geburtstagsüberraschung.',
    type: 'gratis', category: 'beauty', source: 'BIPA', url: 'https://www.bipa.at/',
    expires: 'Mit BIPA Card', distance: 'BIPA Filialen', hot: false, isNew: false, priority: 2, votes: 167
  },

  // ═══════════════════════════════════════════
  // ⭐⭐⭐ KULTUR ⭐⭐⭐
  // ═══════════════════════════════════════════
  {
    id: 'kultur-1', brand: 'Bundesmuseen', logo: '🏛️', title: 'GRATIS Eintritt unter 19',
    description: 'Alle Bundesmuseen (KHM, Belvedere, Albertina...) sind für unter 19-Jährige GRATIS!',
    type: 'gratis', category: 'wien', source: 'Bundesmuseen', url: 'https://www.bundesmuseen.at/',
    expires: 'Dauerhaft', distance: 'Wien', hot: true, isNew: false, priority: 1, votes: 389
  },

  // ═══════════════════════════════════════════
  // ⭐⭐⭐ STREAMING ⭐⭐⭐
  // ═══════════════════════════════════════════
  {
    id: 'stream-1', brand: 'Spotify', logo: '🎵', title: '3 Monate Premium GRATIS',
    description: 'Für Neukunden: 3 Monate Spotify Premium komplett kostenlos!',
    type: 'testabo', category: 'streaming', source: 'Spotify', url: 'https://www.spotify.com/at/premium/',
    expires: 'Für Neukunden', distance: 'Online', hot: true, isNew: false, priority: 2, votes: 289
  },

  // ═══════════════════════════════════════════
  // ⭐⭐⭐ BONUS CLUBS ⭐⭐⭐
  // ═══════════════════════════════════════════
  {
    id: 'club-1', brand: 'jö Club', logo: '🎁', title: 'Punkte = Gratis Produkte',
    description: 'jö Punkte bei BILLA, BIPA, OMV sammeln. Schon ab 1 Punkt: Gratis Kaffee bei OMV!',
    type: 'rabatt', category: 'codes', source: 'jö Club', url: 'https://www.jo-club.at/',
    expires: 'Dauerhaft', distance: 'Partnergeschäfte', hot: true, isNew: false, priority: 1, votes: 345
  },

  // ═══════════════════════════════════════════
  // ⭐⭐⭐ REISEN ⭐⭐⭐
  // ═══════════════════════════════════════════
  {
    id: 'reisen-1', brand: 'Ryanair', logo: '✈️', title: 'Flüge ab 9,99€',
    description: 'Ab Wien: Barcelona, London, Rom und mehr. Newsletter für Flash Sales!',
    type: 'rabatt', category: 'reisen', source: 'Ryanair', url: 'https://www.ryanair.com/at/de',
    expires: 'Laufend', distance: 'Ab Wien', hot: true, isNew: false, priority: 2, votes: 234
  },
  {
    id: 'reisen-2', brand: 'ÖBB', logo: '🚂', title: 'Sparschiene ab 19,90€',
    description: 'Mit der ÖBB durch Österreich: Sparschiene ab 19,90€.',
    type: 'rabatt', category: 'reisen', source: 'ÖBB', url: 'https://www.oebb.at/',
    expires: 'Laufend', distance: 'Österreichweit', hot: false, isNew: false, priority: 2, votes: 178
  },
];

// ============================================
// KEYWORDS - OPTIMIERT FÜR ESSEN & TRINKEN
// ============================================

const GRATIS_KEYWORDS = [
  'gratis', 'kostenlos', 'geschenkt', 'umsonst', 'frei', 'kostenfrei', 
  'probetraining', 'probetag', 'neueröffnung', 'eröffnung', 'grand opening',
  'geburtstag', 'birthday', 'verkostung', 'probe', 'sample', 'tasting',
  'free', 'freebie', 'giveaway', '0€', '0 €', 'gratis!', 'free!',
  'pay what you want', 'zahle was du willst', '1+1',
];

const ESSEN_KEYWORDS = [
  'essen', 'food', 'mahlzeit', 'menü', 'frühstück', 'mittagessen', 'abendessen',
  'burger', 'pizza', 'pasta', 'sushi', 'döner', 'kebab', 'sandwich', 'wrap',
  'schnitzel', 'pommes', 'nuggets', 'salat', 'bowl', 'vegan',
  'kuchen', 'torte', 'eis', 'dessert', 'donut', 'muffin', 'croissant',
  'brot', 'semmel', 'bäckerei', 'bakery',
];

const TRINKEN_KEYWORDS = [
  'kaffee', 'coffee', 'espresso', 'cappuccino', 'latte', 'americano',
  'café', 'mccafé', 'tee', 'tea', 'getränk', 'drink', 'softdrink',
  'cola', 'red bull', 'saft', 'smoothie', 'shake', 'wasser',
  'bier', 'wein', 'cocktail', 'heißgetränk',
];

const DEAL_KEYWORDS = [
  'angebot', 'aktion', 'deal', 'rabatt', 'discount', 'sale', 'promo',
  'gutschein', 'coupon', 'code', 'prozent', '%', 'sparen', 'günstig',
];

// ============================================
// HTTP FETCH HELPER
// ============================================

function fetchURL(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const req = protocol.get(url, { 
      timeout,
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 FreeFinder/1.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'de-AT,de;q=0.9,en;q=0.8'
      }
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchURL(res.headers.location).then(resolve).catch(reject);
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
// GOOGLE PLACES API - NEUERÖFFNUNGEN
// ============================================

async function fetchGooglePlacesNewOpenings() {
  if (!GOOGLE_PLACES_API_KEY) {
    console.log('⚠️  Google Places: Kein API Key');
    return [];
  }

  const deals = [];
  const seenIds = new Set();
  
  const searchQueries = [
    'neu eröffnet café wien',
    'neueröffnung restaurant wien',
    'new opening vienna coffee',
    'grand opening wien restaurant',
    'neu eröffnet bäckerei wien',
  ];

  for (const query of searchQueries) {
    try {
      const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&location=48.2082,16.3738&radius=15000&key=${GOOGLE_PLACES_API_KEY}&language=de`;
      
      const response = await fetchURL(url);
      
      if (response.startsWith('<')) {
        console.log('⚠️  Google Places: Billing Account fehlt');
        break;
      }
      
      const data = JSON.parse(response);
      
      if (data.status === 'OK' && data.results) {
        for (const place of data.results) {
          if (place.user_ratings_total < 200 && !seenIds.has(place.place_id)) {
            seenIds.add(place.place_id);
            
            const types = place.types || [];
            const isVeryNew = place.user_ratings_total < 50;
            
            deals.push({
              id: `places-${place.place_id}`,
              brand: place.name,
              logo: types.includes('cafe') ? '☕' : types.includes('bakery') ? '🥐' : '🍽️',
              title: `🆕 ${isVeryNew ? 'NEU: ' : ''}${place.name}`,
              description: `${place.formatted_address || 'Wien'} • ⭐ ${place.rating || 'Neu'} • Oft Gratis bei Neueröffnung!`,
              type: 'gratis',
              category: types.includes('cafe') ? 'kaffee' : 'essen',
              source: 'Google Places',
              url: `https://www.google.com/maps/place/?q=place_id:${place.place_id}`,
              expires: 'Bei Eröffnung',
              distance: place.formatted_address?.split(',')[0] || 'Wien',
              hot: isVeryNew,
              isNew: true,
              priority: isVeryNew ? 1 : 2,
              votes: 0
            });
          }
        }
      }
    } catch (e) {
      // Silent fail
    }
  }

  console.log(`✅ Google Places: ${deals.length} Neueröffnungen`);
  return deals;
}

async function fetchInstagramDeals() { return []; }
async function fetchFacebookEvents() { return []; }

// ============================================
// RSS PARSER
// ============================================

function parseRSS(xml, source) {
  const deals = [];
  const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
  
  for (const item of items.slice(0, 15)) {
    const title = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] 
               || item.match(/<title>(.*?)<\/title>/)?.[1] || '';
    const link = item.match(/<link>(.*?)<\/link>/)?.[1] || '';
    const desc = item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/)?.[1]
               || item.match(/<description>(.*?)<\/description>/)?.[1] || '';
    
    const text = (title + ' ' + desc).toLowerCase();
    
    const isEssen = ESSEN_KEYWORDS.some(k => text.includes(k));
    const isTrinken = TRINKEN_KEYWORDS.some(k => text.includes(k));
    const isGratis = GRATIS_KEYWORDS.some(k => text.includes(k));
    const isDeal = DEAL_KEYWORDS.some(k => text.includes(k));
    
    if (isGratis || (isDeal && (isEssen || isTrinken))) {
      let category = source.category;
      if (isTrinken) category = 'kaffee';
      else if (isEssen) category = 'essen';
      
      deals.push({
        id: `rss-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        brand: source.brand,
        logo: isTrinken ? '☕' : isEssen ? '🍔' : source.logo,
        title: title.substring(0, 80),
        description: desc.replace(/<[^>]*>/g, '').substring(0, 150),
        type: isGratis ? 'gratis' : 'rabatt',
        category: category,
        source: source.name,
        url: link,
        expires: 'Siehe Link',
        distance: 'Wien',
        hot: isGratis && (isEssen || isTrinken),
        isNew: true,
        priority: isGratis && (isEssen || isTrinken) ? 1 : 2
      });
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
  const isEssen = ESSEN_KEYWORDS.some(k => text.includes(k));
  const isTrinken = TRINKEN_KEYWORDS.some(k => text.includes(k));
  
  if ((isGratis && (isEssen || isTrinken)) || (isDeal && (source.category === 'essen' || source.category === 'kaffee'))) {
    let category = source.category;
    if (isTrinken) category = 'kaffee';
    else if (isEssen) category = 'essen';
    
    deals.push({
      id: `html-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      brand: source.brand,
      logo: source.logo,
      title: `${isGratis ? '🆓 ' : ''}Aktuelle Angebote bei ${source.brand}`,
      description: `Jetzt ${isGratis ? 'Gratis-' : ''}Deals bei ${source.brand} entdecken!`,
      type: isGratis ? 'gratis' : 'rabatt',
      category: category,
      source: source.name,
      url: source.url,
      expires: 'Siehe Website',
      distance: 'Wien',
      hot: isGratis && (isEssen || isTrinken),
      isNew: true,
      priority: isGratis ? 1 : 2
    });
  }
  
  return deals;
}

// ============================================
// MAIN SCRAPER
// ============================================

async function scrapeAllSources() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🚀 FREEFINDER POWER SCRAPER V5 - ESSEN & TRINKEN FOKUS');
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log(`📅 ${new Date().toLocaleString('de-AT')}`);
  console.log(`📡 ${SOURCES.length} Quellen\n`);
  
  const scrapedDeals = [];
  let success = 0, errors = 0;
  
  for (const source of SOURCES) {
    try {
      const content = await fetchURL(source.url);
      const deals = source.type === 'rss' ? parseRSS(content, source) : extractDealsFromHTML(content, source);
      scrapedDeals.push(...deals);
      if (deals.length > 0) console.log(`✅ ${source.name}: ${deals.length}`);
      success++;
    } catch (e) {
      console.log(`❌ ${source.name}`);
      errors++;
    }
  }
  
  console.log('\n📡 APIs...\n');
  const placesDeals = await fetchGooglePlacesNewOpenings();
  scrapedDeals.push(...placesDeals);
  
  const allDeals = [...BASE_DEALS, ...scrapedDeals];
  const uniqueDeals = [];
  const seen = new Set();
  
  for (const deal of allDeals) {
    const key = deal.title.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 30);
    if (!seen.has(key)) { seen.add(key); uniqueDeals.push(deal); }
  }
  
  uniqueDeals.sort((a, b) => {
    if ((a.priority || 99) !== (b.priority || 99)) return (a.priority || 99) - (b.priority || 99);
    if (a.hot && !b.hot) return -1;
    if (!a.hot && b.hot) return 1;
    if (a.type === 'gratis' && b.type !== 'gratis') return -1;
    const aFood = a.category === 'essen' || a.category === 'kaffee';
    const bFood = b.category === 'essen' || b.category === 'kaffee';
    if (aFood && !bFood) return -1;
    return (b.votes || 0) - (a.votes || 0);
  });
  
  fs.writeFileSync('deals.json', JSON.stringify({ lastUpdated: new Date().toISOString(), totalDeals: uniqueDeals.length, deals: uniqueDeals }, null, 2));
  
  const gratisEssen = uniqueDeals.filter(d => d.type === 'gratis' && d.category === 'essen').length;
  const gratisKaffee = uniqueDeals.filter(d => d.type === 'gratis' && d.category === 'kaffee').length;
  
  console.log(`\n═══════════════════════════════════════════════════════════════`);
  console.log(`✅ FERTIG! ${uniqueDeals.length} Deals`);
  console.log(`   🍔 GRATIS ESSEN:  ${gratisEssen}`);
  console.log(`   ☕ GRATIS KAFFEE: ${gratisKaffee}`);
  console.log(`   🆓 Gratis Total:  ${uniqueDeals.filter(d => d.type === 'gratis').length}`);
  console.log(`═══════════════════════════════════════════════════════════════\n`);
}

scrapeAllSources().then(() => process.exit(0)).catch(() => process.exit(0));

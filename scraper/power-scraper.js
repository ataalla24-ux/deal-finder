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
  { name: 'Preisjäger Kaffee', url: 'https://www.preisjaeger.at/rss/new?keywords=kaffee', type: 'rss', brand: 'Preisjäger', logo: '☕', category: 'kaffee' },
  { name: 'Preisjäger Essen', url: 'https://www.preisjaeger.at/rss/new?keywords=essen', type: 'rss', brand: 'Preisjäger', logo: '🍔', category: 'essen' },
  { name: 'Preisjäger 1+1', url: 'https://www.preisjaeger.at/rss/new?keywords=1%2B1', type: 'rss', brand: 'Preisjäger', logo: '🎁', category: 'supermarkt' },
  { name: 'Preisjäger Neueröffnung', url: 'https://www.preisjaeger.at/rss/new?keywords=er%C3%B6ffnung', type: 'rss', brand: 'Preisjäger', logo: '🆕', category: 'essen' },
  { name: 'MyDealz Freebies', url: 'https://www.mydealz.de/rss/freebies', type: 'rss', brand: 'MyDealz', logo: '🔥', category: 'gratis' },
  { name: 'Reddit r/wien', url: 'https://www.reddit.com/r/wien/.rss', type: 'rss', brand: 'Reddit', logo: '🔴', category: 'wien' },
  { name: 'Reddit r/Austria', url: 'https://www.reddit.com/r/Austria/.rss', type: 'rss', brand: 'Reddit', logo: '🇦🇹', category: 'wien' },
  { name: 'Reddit r/austriandeals', url: 'https://www.reddit.com/r/austriandeals/.rss', type: 'rss', brand: 'Reddit', logo: '💰', category: 'gratis' },
  
  // ========== GOOGLE NEWS SEARCHES ==========
  { name: 'Google News Wien Gratis', url: 'https://news.google.com/rss/search?q=wien+gratis&hl=de&gl=AT', type: 'rss', brand: 'Google', logo: '📰', category: 'wien' },
  { name: 'Google News Neueröffnung', url: 'https://news.google.com/rss/search?q=neuer%C3%B6ffnung+wien&hl=de&gl=AT', type: 'rss', brand: 'Google', logo: '🆕', category: 'essen' },
  { name: 'Google News Gratis Kaffee', url: 'https://news.google.com/rss/search?q=gratis+kaffee+wien&hl=de&gl=AT', type: 'rss', brand: 'Google', logo: '☕', category: 'kaffee' },
  { name: 'Google News Gratis Essen', url: 'https://news.google.com/rss/search?q=gratis+essen+wien&hl=de&gl=AT', type: 'rss', brand: 'Google', logo: '🍕', category: 'essen' },
  { name: 'Google News Opening Wien', url: 'https://news.google.com/rss/search?q=opening+wien+restaurant&hl=de&gl=AT', type: 'rss', brand: 'Google', logo: '🎉', category: 'essen' },
  { name: 'Google News Döner Gratis', url: 'https://news.google.com/rss/search?q=d%C3%B6ner+gratis+wien&hl=de&gl=AT', type: 'rss', brand: 'Google', logo: '🥙', category: 'essen' },
  { name: 'Google News Friseur Gratis', url: 'https://news.google.com/rss/search?q=gratis+haarschnitt+wien&hl=de&gl=AT', type: 'rss', brand: 'Google', logo: '💇', category: 'beauty' },
  { name: 'Google News Aktion Wien', url: 'https://news.google.com/rss/search?q=aktion+wien+gratis&hl=de&gl=AT', type: 'rss', brand: 'Google', logo: '💥', category: 'wien' },
  
  // ========== SOCIAL MEDIA (öffentliche Feeds) ==========
  { name: 'Instagram Wien Hashtag', url: 'https://www.picuki.com/tag/wiengratis', type: 'html', brand: 'Instagram', logo: '📸', category: 'gratis' },
  { name: 'Instagram Neueröffnung', url: 'https://www.picuki.com/tag/neuer%C3%B6ffnungwien', type: 'html', brand: 'Instagram', logo: '📸', category: 'essen' },
  { name: 'Instagram Freebie Wien', url: 'https://www.picuki.com/tag/freebiewien', type: 'html', brand: 'Instagram', logo: '📸', category: 'gratis' },
  
  // ========== FACEBOOK (via RSS Bridge / öffentliche Seiten) ==========
  { name: 'FB Gratis in Wien', url: 'https://www.facebook.com/gratisinwien/', type: 'html', brand: 'Facebook', logo: '📘', category: 'gratis' },
  { name: 'FB Wiener Schnäppchen', url: 'https://www.facebook.com/wienerschnaeppchen/', type: 'html', brand: 'Facebook', logo: '📘', category: 'gratis' },
  { name: 'FB Wien isst', url: 'https://www.facebook.com/wienisst/', type: 'html', brand: 'Facebook', logo: '📘', category: 'essen' },
  { name: 'FB 1000things Wien', url: 'https://www.facebook.com/1000thingsinvienna/', type: 'html', brand: 'Facebook', logo: '📘', category: 'wien' },
  { name: 'FB Freebie Austria', url: 'https://www.facebook.com/freebieaustria/', type: 'html', brand: 'Facebook', logo: '📘', category: 'gratis' },
  { name: 'FB Deals Wien', url: 'https://www.facebook.com/dealswien/', type: 'html', brand: 'Facebook', logo: '📘', category: 'gratis' },
  { name: 'FB Gastro Wien', url: 'https://www.facebook.com/gastrowien/', type: 'html', brand: 'Facebook', logo: '📘', category: 'essen' },
  { name: 'FB Vegan Wien', url: 'https://www.facebook.com/veganwien/', type: 'html', brand: 'Facebook', logo: '📘', category: 'essen' },
  
  // ========== TIKTOK (via öffentliche Viewer) ==========
  { name: 'TikTok Wien Gratis', url: 'https://www.tiktok.com/tag/wiengratis', type: 'html', brand: 'TikTok', logo: '🎵', category: 'gratis' },
  { name: 'TikTok Freebie Wien', url: 'https://www.tiktok.com/tag/freebiewien', type: 'html', brand: 'TikTok', logo: '🎵', category: 'gratis' },
  { name: 'TikTok Wien Essen', url: 'https://www.tiktok.com/tag/wienessen', type: 'html', brand: 'TikTok', logo: '🎵', category: 'essen' },
  { name: 'TikTok Döner Wien', url: 'https://www.tiktok.com/tag/dönerwien', type: 'html', brand: 'TikTok', logo: '🎵', category: 'essen' },
  { name: 'TikTok Neueröffnung Wien', url: 'https://www.tiktok.com/tag/neueröffnungwien', type: 'html', brand: 'TikTok', logo: '🎵', category: 'essen' },
  
  // ========== BEAUTY & FRISEUR ==========
  { name: 'Treatwell Wien', url: 'https://www.treatwell.at/orte/wien/', type: 'html', brand: 'Treatwell', logo: '💇', category: 'beauty' },
  { name: 'Groupon Wien Beauty', url: 'https://www.groupon.at/local/wien/beauty-und-wellness', type: 'html', brand: 'Groupon', logo: '💅', category: 'beauty' },
  { name: 'Groupon Wien Essen', url: 'https://www.groupon.at/local/wien/restaurants', type: 'html', brand: 'Groupon', logo: '🍽️', category: 'essen' },
];

// ============================================
// 200+ BASIS DEALS - Immer verfügbar
// ============================================

const BASE_DEALS = [
  // ========== 🔥 TOP DEALS - DIE BESTEN ZUERST ==========
  { id: "top-1", brand: "OMV VIVA", logo: "⛽", title: "Gratis Getränk für nur 1 Ö!", description: "Winterdrink (Cinnamon Latte oder Toffee Latte) für nur 1 jö Punkt! Fast geschenkt!", type: "gratis", badge: "limited", category: "kaffee", source: "jö App", url: "https://www.joe-club.at", expires: "Winter 2026", distance: "OMV Tankstellen", hot: true, isNew: true, priority: 1 },
  { id: "top-2", brand: "IKEA", logo: "🪑", title: "Gratis Kaffee & Tee UNLIMITIERT", description: "IKEA Family Mitglieder: Unbegrenzt Gratis-Kaffee oder Tee! Einfach Karte zeigen.", type: "gratis", badge: "daily", category: "kaffee", source: "IKEA Family", url: "https://www.ikea.at", expires: "Unbegrenzt", distance: "IKEA Standorte", hot: true, priority: 1 },
  { id: "top-3", brand: "Wiener Deewan", logo: "🍛", title: "Zahl was du willst!", description: "Pakistanisches Buffet - DU bestimmst den Preis! Auch €0 ist okay. Studenten-Geheimtipp!", type: "gratis", badge: "daily", category: "essen", source: "Wiener Deewan", url: "https://www.deewan.at", expires: "Täglich", distance: "9. Bezirk", hot: true, priority: 1 },
  { id: "top-4", brand: "McDonald's", logo: "🍟", title: "5x Gratis Kaffee pro Monat", description: "Nach jedem Einkauf Feedback in der App = Gratis Kaffee oder Cola!", type: "gratis", badge: "daily", category: "kaffee", source: "McDonald's App", url: "https://www.mcdonalds.at", expires: "5x/Monat", distance: "Überall", hot: true, priority: 1 },
  { id: "top-5", brand: "Verein MUT", logo: "🥫", title: "Gratis Lebensmittel abholen", description: "Gerettete Lebensmittel komplett kostenlos! Mo-Fr 10-15:30, keine Fragen.", type: "gratis", badge: "daily", category: "supermarkt", source: "Verein MUT", url: "https://verein-mut.eu", expires: "Mo-Fr", distance: "4. Bezirk", hot: true, priority: 1 },
  { id: "top-6", brand: "Foodsharing", logo: "🍏", title: "Gratis Lebensmittel retten", description: "Übriggebliebene Lebensmittel von Supermärkten gratis abholen!", type: "gratis", badge: "daily", category: "supermarkt", source: "Foodsharing", url: "https://foodsharing.at", expires: "Täglich", distance: "Überall", hot: true, priority: 1 },
  { id: "top-7", brand: "Too Good To Go", logo: "🥡", title: "Essen retten ab €3,99", description: "Überraschungssackerl von Restaurants & Bäckereien - Wert €12+ für nur €3,99!", type: "rabatt", badge: "daily", category: "essen", source: "Too Good To Go", url: "https://www.toogoodtogo.at", expires: "Täglich", distance: "Überall", hot: true, priority: 2 },
  { id: "top-8", brand: "dm Friseur", logo: "💇", title: "Gratis Kinderhaarschnitt", description: "Kinder unter 10: Komplett gratis Haarschnitt beim dm Friseur!", type: "gratis", badge: "instore", category: "beauty", source: "dm", url: "https://www.dm.at", expires: "Mit Termin", distance: "dm Friseur", hot: true, priority: 1 },
  
  // ========== GRATIS MUSEEN (unter 19 Jahre) ==========
  { id: "top-9", brand: "Alle Bundesmuseen", logo: "🏛️", title: "Gratis Eintritt unter 19!", description: "Belvedere, KHM, NHM, Albertina, Mumok, MAK - ALLE gratis für unter 19-Jährige!", type: "gratis", badge: "daily", category: "wien", source: "Bundesmuseen", url: "https://www.bundesmuseen.at", expires: "Unter 19", distance: "Wien", hot: true, priority: 1 },
  
  // ========== AKTUELL - JÄNNER 2026 ==========
  { id: "hot-2", brand: "Haus der Geschichte", logo: "🏛️", title: "Gratis jeden Donnerstag 18-20h", description: "Jeden Donnerstagabend kostenloser Eintritt ins hdgö!", type: "gratis", badge: "daily", category: "wien", source: "Vienna.at", url: "https://www.hdgoe.at", expires: "Jeden Donnerstag", distance: "1. Bezirk", hot: true, isNew: true, validUntil: "2099-12-31" },
  { id: "hot-3", brand: "ÖBB Veganuary", logo: "🚂", title: "Vegan Vurstsemmel €2,90", description: "Im Jänner: Vegane Vurstsemmel + Gewinnspiele mit Klimaticket!", type: "rabatt", badge: "limited", category: "essen", source: "1000things", url: "https://www.oebb.at", expires: "Bis 31.01.2026", distance: "Hauptbahnhof", hot: true, isNew: true, validUntil: "2026-01-31" },
  
  // ========== GRATIS KAFFEE ==========
  { id: "kaffee-3", brand: "Starbucks", logo: "☕", title: "Gratis Geburtstagsgetränk", description: "Starbucks Rewards: Am Geburtstag ein Gratis-Getränk nach Wahl!", type: "gratis", badge: "instore", category: "kaffee", source: "Starbucks", url: "https://www.starbucks.at", expires: "Am Geburtstag", distance: "Überall", hot: true },
  { id: "kaffee-4", brand: "Tchibo", logo: "☕", title: "Gratis Kaffee beim Einkauf", description: "Bei jedem Einkauf im Tchibo Shop gibt's einen Gratis-Kaffee dazu!", type: "gratis", badge: "instore", category: "kaffee", source: "Tchibo", url: "https://www.tchibo.at", expires: "Unbegrenzt", distance: "Tchibo", hot: true },
  { id: "kaffee-5", brand: "Segafredo", logo: "☕", title: "10. Kaffee gratis", description: "Stempelkarte sammeln: Jeder 10. Kaffee ist gratis!", type: "gratis", badge: "instore", category: "kaffee", source: "Segafredo", url: "https://www.segafredo.at", expires: "Unbegrenzt", distance: "Segafredo", hot: false },
  { id: "kaffee-6", brand: "OMV VIVA", logo: "⛽", title: "50% auf Kaffee mit jö", description: "Mit 75 Ös 50% auf alle Kaffeespezialitäten bei OMV VIVA!", type: "rabatt", badge: "instore", category: "kaffee", source: "jö App", url: "https://www.joe-club.at", expires: "Unbegrenzt", distance: "OMV", hot: true },
  { id: "kaffee-7", brand: "Shell", logo: "⛽", title: "Gratis Kaffee Clubsmart", description: "Mit Clubsmart Punkten Gratis-Kaffee bei Shell Tankstellen!", type: "gratis", badge: "instore", category: "kaffee", source: "Shell", url: "https://www.shell.at", expires: "Mit Punkten", distance: "Shell", hot: false },
  { id: "kaffee-8", brand: "Dunkin'", logo: "🍩", title: "Gratis Donut bei Anmeldung", description: "DD Perks Newsletter: Gratis Donut bei Registrierung!", type: "gratis", badge: "sample", category: "kaffee", source: "Dunkin'", url: "https://www.dunkindonuts.at", expires: "Bei Anmeldung", distance: "Dunkin'", hot: true },
  { id: "kaffee-9", brand: "Costa Coffee", logo: "☕", title: "5. Kaffee gratis", description: "Costa Club App: Jeder 5. Kaffee ist kostenlos!", type: "gratis", badge: "instore", category: "kaffee", source: "Costa", url: "https://www.costa.at", expires: "Unbegrenzt", distance: "Costa", hot: false },
  { id: "kaffee-10", brand: "Backwerk", logo: "🥐", title: "Gratis Kaffee zum Gebäck", description: "Beim Kauf von 2 Gebäckstücken: 1 Kaffee gratis!", type: "gratis", badge: "instore", category: "kaffee", source: "Backwerk", url: "https://www.backwerk.at", expires: "Unbegrenzt", distance: "Backwerk", hot: false },
  { id: "kaffee-11", brand: "Ströck", logo: "🥐", title: "Treuekarte Kaffee", description: "10 Kaffees kaufen = 1 Kaffee gratis mit Treuekarte!", type: "gratis", badge: "instore", category: "kaffee", source: "Ströck", url: "https://www.stroeck.at", expires: "Unbegrenzt", distance: "Ströck", hot: false },
  { id: "kaffee-12", brand: "Anker", logo: "🥖", title: "Sammelpass Kaffee", description: "Kaffee-Sammelpass: 10. Kaffee geschenkt!", type: "gratis", badge: "instore", category: "kaffee", source: "Anker", url: "https://www.ankerbrot.at", expires: "Unbegrenzt", distance: "Anker", hot: false },
  { id: "kaffee-13", brand: "Der Mann", logo: "🥐", title: "Stempelkarte Kaffee", description: "Der Mann Stempelkarte: Jeder 10. Kaffee gratis!", type: "gratis", badge: "instore", category: "kaffee", source: "Der Mann", url: "https://www.dermann.at", expires: "Unbegrenzt", distance: "Der Mann", hot: false },
  { id: "kaffee-14", brand: "Aida", logo: "🎀", title: "Tortenstück + Kaffee Kombi", description: "Kaffee + Tortenstück ab €6,90 - Wiener Kaffeehaus Klassiker!", type: "rabatt", badge: "instore", category: "kaffee", source: "Aida", url: "https://www.aida.at", expires: "Unbegrenzt", distance: "Aida", hot: false },
  { id: "kaffee-15", brand: "McCafé", logo: "🍟", title: "Gratis Größen-Upgrade", description: "McCafé App: Regelmäßig Gratis-Upgrades auf größere Kaffees!", type: "gratis", badge: "limited", category: "kaffee", source: "McDonald's App", url: "https://www.mcdonalds.at", expires: "Mit App", distance: "McCafé", hot: true },
  { id: "kaffee-16", brand: "Nespresso", logo: "☕", title: "Gratis Kaffee Verkostung", description: "In jeder Nespresso Boutique: Gratis Kaffee-Verkostung!", type: "gratis", badge: "instore", category: "kaffee", source: "Nespresso", url: "https://www.nespresso.com/at", expires: "Unbegrenzt", distance: "Nespresso", hot: false },
  { id: "kaffee-17", brand: "Vapiano", logo: "🍝", title: "Gratis Espresso nach Essen", description: "Nach jedem Hauptgericht: Gratis Espresso!", type: "gratis", badge: "instore", category: "kaffee", source: "Vapiano", url: "https://www.vapiano.at", expires: "Unbegrenzt", distance: "Vapiano", hot: true },
  { id: "kaffee-18", brand: "BILLA", logo: "🟠", title: "Gratis Kaffee Automat", description: "BILLA Plus: Gratis Kaffee am Automaten für Stammkunden!", type: "gratis", badge: "instore", category: "kaffee", source: "BILLA", url: "https://www.billa.at", expires: "Mit Karte", distance: "BILLA Plus", hot: false },
  { id: "kaffee-19", brand: "Merkur", logo: "🟠", title: "Gratis Kaffee Ecke", description: "BILLA Plus (ex Merkur): Gratis Kaffee in der Kaffee-Ecke!", type: "gratis", badge: "instore", category: "kaffee", source: "BILLA Plus", url: "https://www.billa.at", expires: "Unbegrenzt", distance: "BILLA Plus", hot: false },
  { id: "kaffee-20", brand: "XXXLutz", logo: "🛋️", title: "Gratis Kaffee beim Shoppen", description: "Im XXXLutz Restaurant: Gratis Kaffee für Kunden!", type: "gratis", badge: "instore", category: "kaffee", source: "XXXLutz", url: "https://www.xxxlutz.at", expires: "Unbegrenzt", distance: "XXXLutz", hot: false },

  // ========== GRATIS ESSEN (30+) ==========
  { id: "essen-1", brand: "Subway", logo: "🥪", title: "Gratis Cookie bei Anmeldung", description: "Subcard App herunterladen = Gratis Cookie geschenkt!", type: "gratis", badge: "sample", category: "essen", source: "Subway", url: "https://www.subway.at", expires: "Bei Anmeldung", distance: "Überall", hot: true },
  { id: "essen-2", brand: "Burger King", logo: "🍔", title: "Gratis Whopper Geburtstag", description: "King Club: Gratis Whopper zum Geburtstag!", type: "gratis", badge: "instore", category: "essen", source: "Burger King", url: "https://www.burgerking.at", expires: "Geburtstag", distance: "Überall", hot: true },
  { id: "essen-3", brand: "Vapiano", logo: "🍝", title: "Gratis Pasta Geburtstag", description: "Vapiano People: Gratis Pasta oder Pizza zum Geburtstag!", type: "gratis", badge: "instore", category: "essen", source: "Vapiano", url: "https://www.vapiano.at", expires: "Geburtstag", distance: "Vapiano", hot: true },
  { id: "essen-4", brand: "Five Guys", logo: "🍔", title: "Unlimitierte Toppings", description: "Alle Burger-Toppings kostenlos und unlimitiert!", type: "gratis", badge: "daily", category: "essen", source: "Five Guys", url: "https://www.fiveguys.at", expires: "Immer", distance: "Five Guys", hot: true },
  { id: "essen-5", brand: "Wiener Deewan", logo: "🍛", title: "Zahl was du willst", description: "Pakistanisches Buffet - du bestimmst den Preis! Studenten-Geheimtipp.", type: "gratis", badge: "daily", category: "essen", source: "Wiener Deewan", url: "https://www.deewan.at", expires: "Immer", distance: "9. Bezirk", hot: true },
  { id: "essen-6", brand: "L'Osteria", logo: "🍕", title: "XXL Pizza 45cm", description: "Riesige 45cm Pizza perfekt zum Teilen!", type: "rabatt", badge: "instore", category: "essen", source: "L'Osteria", url: "https://www.losteria.at", expires: "Immer", distance: "L'Osteria", hot: false },
  { id: "essen-7", brand: "Pizza Hut", logo: "🍕", title: "2. Pizza 50%", description: "Zweite Pizza zum halben Preis bei Abholung!", type: "rabatt", badge: "instore", category: "essen", source: "Pizza Hut", url: "https://www.pizzahut.at", expires: "Abholung", distance: "Pizza Hut", hot: false },
  { id: "essen-8", brand: "Domino's", logo: "🍕", title: "30% Online-Rabatt", description: "Online bestellen und 30% sparen auf alle Pizzen!", type: "rabatt", badge: "daily", category: "essen", source: "Domino's", url: "https://www.dominos.at", expires: "Online", distance: "Überall", hot: false },
  { id: "essen-9", brand: "KFC", logo: "🍗", title: "Gratis Upgrade mit App", description: "KFC App: Regelmäßig Gratis-Upgrades auf größere Menüs!", type: "gratis", badge: "limited", category: "essen", source: "KFC App", url: "https://www.kfc.at", expires: "Mit App", distance: "KFC", hot: true },
  { id: "essen-10", brand: "Nordsee", logo: "🐟", title: "10% Newsletter Rabatt", description: "Newsletter anmelden = 10% auf erste Bestellung!", type: "rabatt", badge: "sample", category: "essen", source: "Nordsee", url: "https://www.nordsee.at", expires: "Anmeldung", distance: "Überall", hot: false },
  { id: "essen-11", brand: "Hans im Glück", logo: "🍔", title: "Burger-Upgrade gratis", description: "Bei Anmeldung zur Hans im Glück App: Gratis Burger-Upgrade!", type: "gratis", badge: "sample", category: "essen", source: "Hans im Glück", url: "https://www.hansimglueck.at", expires: "Anmeldung", distance: "Wien", hot: true },
  { id: "essen-12", brand: "Dean & David", logo: "🥗", title: "Gratis Topping", description: "Salat bestellen = 1 Gratis-Topping nach Wahl!", type: "gratis", badge: "instore", category: "essen", source: "Dean & David", url: "https://www.deananddavid.at", expires: "Immer", distance: "Wien", hot: false },
  { id: "essen-13", brand: "Swing Kitchen", logo: "🌱", title: "Vegan Burger Menü", description: "Vegane Burger zu fairen Preisen - 100% pflanzlich!", type: "rabatt", badge: "daily", category: "essen", source: "Swing Kitchen", url: "https://www.swingkitchen.com", expires: "Immer", distance: "Mehrere", hot: false },
  { id: "essen-14", brand: "Burgerista", logo: "🍔", title: "Loyalty Programm", description: "Punkte sammeln bei jedem Besuch = Gratis Burger!", type: "gratis", badge: "instore", category: "essen", source: "Burgerista", url: "https://www.burgerista.at", expires: "Mit Punkte", distance: "Wien", hot: false },
  { id: "essen-15", brand: "Akakiko", logo: "🍣", title: "Mittagsmenü ab €8,90", description: "Sushi Mittagsmenü zum günstigen Preis!", type: "rabatt", badge: "daily", category: "essen", source: "Akakiko", url: "https://www.akakiko.at", expires: "Mittags", distance: "Wien", hot: false },
  { id: "essen-16", brand: "Trzesniewski", logo: "🥪", title: "Wiener Brötchen Klassiker", description: "Original Wiener Brötchen ab €1,50!", type: "rabatt", badge: "daily", category: "essen", source: "Trzesniewski", url: "https://www.trzesniewski.at", expires: "Immer", distance: "1. Bezirk", hot: false },
  { id: "essen-17", brand: "Leberkas Pepi", logo: "🥩", title: "Leberkässemmel ab €3", description: "Beste Leberkässemmel Wiens ab €3!", type: "rabatt", badge: "daily", category: "essen", source: "Leberkas Pepi", url: "https://www.leberkaspepi.at", expires: "Immer", distance: "Wien", hot: true },
  { id: "essen-18", brand: "Bitzinger", logo: "🌭", title: "Würstel am Albertinaplatz", description: "Legendärer Würstelstand - Klassiker seit 1960!", type: "rabatt", badge: "daily", category: "essen", source: "Bitzinger", url: "https://www.bitzinger.at", expires: "Immer", distance: "1. Bezirk", hot: false },
  { id: "essen-19", brand: "Neni", logo: "🥙", title: "Levante Küche", description: "Orientalische Mezze zum Teilen - trendy!", type: "rabatt", badge: "daily", category: "essen", source: "Neni", url: "https://www.neni.at", expires: "Immer", distance: "25hours Hotel", hot: false },
  { id: "essen-20", brand: "Figlmüller", logo: "🥩", title: "Original Wiener Schnitzel", description: "Das größte Schnitzel Wiens - legendär!", type: "rabatt", badge: "daily", category: "essen", source: "Figlmüller", url: "https://www.figlmueller.at", expires: "Immer", distance: "1. Bezirk", hot: false },
  { id: "essen-21", brand: "Mensa", logo: "🍽️", title: "Mittagessen ab €3", description: "Studenten: Günstig essen in Wiener Mensen!", type: "rabatt", badge: "daily", category: "essen", source: "ÖH", url: "https://www.mensen.at", expires: "Mit Ausweis", distance: "Unis", hot: true },
  { id: "essen-22", brand: "McDonald's", logo: "🍟", title: "Gratis Pommes Geburtstag", description: "McDonald's App: Große Pommes gratis zum Geburtstag!", type: "gratis", badge: "instore", category: "essen", source: "McDonald's App", url: "https://www.mcdonalds.at", expires: "Geburtstag", distance: "Überall", hot: true },
  { id: "essen-23", brand: "Shake Shack", logo: "🍔", title: "Premium Burger", description: "NYC Burger Kette jetzt in Wien - probieren!", type: "rabatt", badge: "daily", category: "essen", source: "Shake Shack", url: "https://www.shakeshack.com", expires: "Immer", distance: "Wien Mitte", hot: false },
  { id: "essen-24", brand: "Wok to Walk", logo: "🥡", title: "Asiatisch schnell & günstig", description: "Fresh Wok ab €7,90 - selbst zusammenstellen!", type: "rabatt", badge: "daily", category: "essen", source: "Wok to Walk", url: "https://www.woktowalk.com", expires: "Immer", distance: "Wien", hot: false },
  { id: "essen-25", brand: "Taco Bell", logo: "🌮", title: "Taco Tuesday Deals", description: "Dienstags spezielle Taco-Angebote!", type: "rabatt", badge: "daily", category: "essen", source: "Taco Bell", url: "https://www.tacobell.at", expires: "Dienstags", distance: "Wien", hot: false },
  { id: "essen-26", brand: "Popeyes", logo: "🍗", title: "Neu in Wien!", description: "Berühmtes Fried Chicken aus Louisiana - neu!", type: "rabatt", badge: "limited", category: "essen", source: "Popeyes", url: "https://www.popeyes.at", expires: "Neu", distance: "Wien", hot: true, isNew: true },
  { id: "essen-27", brand: "Foodora", logo: "🛵", title: "Gratis Lieferung Aktion", description: "Regelmäßig Gratis-Lieferung für Neukunden!", type: "gratis", badge: "limited", category: "essen", source: "Foodora", url: "https://www.foodora.at", expires: "Aktionen", distance: "Wien", hot: true },
  { id: "essen-28", brand: "Mjam", logo: "🍕", title: "Neukunden €5 Rabatt", description: "Erste Bestellung mit €5 Rabatt!", type: "rabatt", badge: "limited", category: "essen", source: "Mjam", url: "https://www.mjam.at", expires: "Neukunden", distance: "Wien", hot: true },
  { id: "essen-29", brand: "Wolt", logo: "📱", title: "€10 Gutschein Neukunden", description: "€10 Rabatt auf die erste Wolt Bestellung!", type: "rabatt", badge: "limited", category: "essen", source: "Wolt", url: "https://www.wolt.com", expires: "Neukunden", distance: "Wien", hot: true },
  { id: "essen-30", brand: "Too Good To Go", logo: "🥡", title: "Sackerl ab €3,99", description: "Übriggebliebenes Essen retten - ab €3,99!", type: "rabatt", badge: "daily", category: "essen", source: "Too Good To Go", url: "https://www.toogoodtogo.at", expires: "Täglich", distance: "Überall", hot: true },

  // ========== GRATIS BEAUTY & HAARSCHNITTE (15+) ==========
  { id: "beauty-1", brand: "dm Friseur", logo: "💇", title: "Gratis Haarschnitt für Kinder", description: "dm Friseur: Kinder unter 10 Jahren gratis Haarschnitt (mit Termin)!", type: "gratis", badge: "instore", category: "beauty", source: "dm", url: "https://www.dm.at", expires: "Mit Termin", distance: "dm Friseur", hot: true },
  { id: "beauty-2", brand: "Friseurschule", logo: "💇", title: "Gratis Haarschnitt Modell", description: "Als Modell in Friseurschulen: Gratis Haarschnitt!", type: "gratis", badge: "daily", category: "beauty", source: "Friseurschulen", url: "https://www.google.com/search?q=friseurschule+wien+modell", expires: "Als Modell", distance: "Wien", hot: true },
  { id: "beauty-3", brand: "dm Babybox", logo: "👶", title: "Gratis Babybox für Schwangere", description: "dm Glückskind: Kostenlose Box mit Babyprodukten!", type: "gratis", badge: "sample", category: "beauty", source: "dm", url: "https://www.dm.at/glueckskind", expires: "Schwangere", distance: "dm", hot: true },
  { id: "beauty-4", brand: "dm Greifring", logo: "👶", title: "Gratis Greifring Babyclub", description: "Bei Babyclub-Anmeldung: Gratis Greifring + Gutscheine!", type: "gratis", badge: "sample", category: "beauty", source: "dm", url: "https://www.dm.at", expires: "Anmeldung", distance: "dm", hot: true },
  { id: "beauty-5", brand: "Douglas", logo: "💜", title: "2 Gratis-Proben", description: "Bei jeder Online-Bestellung ab €10: 2 Gratis Beauty-Proben!", type: "gratis", badge: "sample", category: "beauty", source: "Douglas", url: "https://www.douglas.at", expires: "Unbegrenzt", distance: "Online", hot: true },
  { id: "beauty-6", brand: "Douglas", logo: "💜", title: "Geburtstagsgeschenk", description: "Beauty Card: Gratis Geschenk zum Geburtstag!", type: "gratis", badge: "instore", category: "beauty", source: "Douglas", url: "https://www.douglas.at", expires: "Geburtstag", distance: "Douglas", hot: true },
  { id: "beauty-7", brand: "Sephora", logo: "💄", title: "3 Gratis-Proben", description: "Sephora Beauty Insider: 3 Gratis-Proben bei jeder Bestellung!", type: "gratis", badge: "sample", category: "beauty", source: "Sephora", url: "https://www.sephora.at", expires: "Unbegrenzt", distance: "Online", hot: true },
  { id: "beauty-8", brand: "Sephora", logo: "💄", title: "Geburtstagsgeschenk Set", description: "Beauty Insider: Gratis Geburtstagsset!", type: "gratis", badge: "instore", category: "beauty", source: "Sephora", url: "https://www.sephora.at", expires: "Geburtstag", distance: "Sephora", hot: true },
  { id: "beauty-9", brand: "Lush", logo: "🛁", title: "Gratis Proben im Store", description: "Im Lush Store: Immer Gratis-Proben zum Mitnehmen!", type: "gratis", badge: "sample", category: "beauty", source: "Lush", url: "https://www.lush.at", expires: "Unbegrenzt", distance: "Lush", hot: true },
  { id: "beauty-10", brand: "The Body Shop", logo: "🌿", title: "10% + Geburtstagsgeschenk", description: "Love Your Body Club: 10% Rabatt + Geburtstagsüberraschung!", type: "gratis", badge: "sample", category: "beauty", source: "Body Shop", url: "https://www.thebodyshop.at", expires: "Anmeldung", distance: "Body Shop", hot: false },
  { id: "beauty-11", brand: "Marionnaud", logo: "💐", title: "10€ Willkommensbonus", description: "Club Anmeldung: €10 Gutschein geschenkt!", type: "rabatt", badge: "sample", category: "beauty", source: "Marionnaud", url: "https://www.marionnaud.at", expires: "Anmeldung", distance: "Marionnaud", hot: true },
  { id: "beauty-12", brand: "Treatwell", logo: "💇", title: "Günstige Friseur-Termine", description: "Last-Minute Termine bei Friseuren oft stark reduziert!", type: "rabatt", badge: "daily", category: "beauty", source: "Treatwell", url: "https://www.treatwell.at", expires: "Last Minute", distance: "Wien", hot: true },
  { id: "beauty-13", brand: "Groupon", logo: "💅", title: "Beauty Deals bis -70%", description: "Friseur, Kosmetik, Massage stark reduziert!", type: "rabatt", badge: "limited", category: "beauty", source: "Groupon", url: "https://www.groupon.at", expires: "Wechselnd", distance: "Wien", hot: true },
  { id: "beauty-14", brand: "BIPA", logo: "💄", title: "20% auf Make-up", description: "Regelmäßig 20% auf ausgewählte Make-up Produkte!", type: "rabatt", badge: "limited", category: "beauty", source: "BIPA", url: "https://www.bipa.at", expires: "Wechselnd", distance: "BIPA", hot: false },
  { id: "beauty-15", brand: "Müller", logo: "🛍️", title: "10% Newsletter Rabatt", description: "Newsletter = 10% auf erste Online-Bestellung!", type: "rabatt", badge: "sample", category: "beauty", source: "Müller", url: "https://www.mueller.at", expires: "Anmeldung", distance: "Online", hot: false },

  // ========== SUPERMARKT DEALS (15+) ==========
  { id: "super-1", brand: "BILLA", logo: "🟠", title: "1+1 Gratis Aktionen", description: "Wöchentlich wechselnde 1+1 Gratis Produkte!", type: "gratis", badge: "limited", category: "supermarkt", source: "BILLA", url: "https://www.billa.at", expires: "Wöchentlich", distance: "Überall", hot: true },
  { id: "super-2", brand: "BILLA", logo: "🟠", title: "-25% Pickerl Donnerstag", description: "Jeden Donnerstag neue -25% Rabatt-Pickerl!", type: "rabatt", badge: "daily", category: "supermarkt", source: "BILLA", url: "https://www.billa.at", expires: "Donnerstags", distance: "Überall", hot: true },
  { id: "super-3", brand: "SPAR", logo: "🟢", title: "SPAR Plus Rabatte", description: "Personalisierte Rabatte mit SPAR Plus Karte!", type: "rabatt", badge: "instore", category: "supermarkt", source: "SPAR", url: "https://www.spar.at", expires: "Unbegrenzt", distance: "Überall", hot: false },
  { id: "super-4", brand: "Lidl Plus", logo: "🔵", title: "Wöchentliche Coupons", description: "Lidl Plus App: Jede Woche neue Rabatt-Coupons!", type: "rabatt", badge: "daily", category: "supermarkt", source: "Lidl Plus", url: "https://www.lidl.at", expires: "Wöchentlich", distance: "Überall", hot: true },
  { id: "super-5", brand: "HOFER", logo: "🔴", title: "App-exklusive Angebote", description: "HOFER App: Exklusive Rabatte nur in der App!", type: "rabatt", badge: "instore", category: "supermarkt", source: "HOFER", url: "https://www.hofer.at", expires: "Wöchentlich", distance: "Überall", hot: false },
  { id: "super-6", brand: "PENNY", logo: "🔴", title: "PENNY Kundenkarte", description: "Extra Rabatte mit der Kundenkarte sammeln!", type: "rabatt", badge: "instore", category: "supermarkt", source: "PENNY", url: "https://www.penny.at", expires: "Unbegrenzt", distance: "Überall", hot: false },
  { id: "super-7", brand: "Foodsharing", logo: "🍏", title: "Gratis Lebensmittel retten", description: "Übriggebliebene Lebensmittel gratis abholen!", type: "gratis", badge: "daily", category: "supermarkt", source: "Foodsharing", url: "https://foodsharing.at", expires: "Täglich", distance: "Überall", hot: true },
  { id: "super-8", brand: "Verein MUT", logo: "🥫", title: "Gratis Lebensmittel", description: "Gerettete Lebensmittel kostenlos! Mo-Fr 10-15:30.", type: "gratis", badge: "daily", category: "supermarkt", source: "Verein MUT", url: "https://verein-mut.eu", expires: "Mo-Fr", distance: "4. Bezirk", hot: true },

  // ========== JÖ BONUS CLUB (10+) ==========
  { id: "joe-1", brand: "jö Bonus Club", logo: "🟡", title: "20% Rabattsammler BILLA", description: "Jeden Monat bis zu 20% auf einen BILLA Einkauf!", type: "rabatt", badge: "daily", category: "supermarkt", source: "jö App", url: "https://www.joe-club.at", expires: "Monatlich", distance: "BILLA", hot: true },
  { id: "joe-2", brand: "jö Bonus Club", logo: "🟡", title: "20% Rabattsammler BIPA", description: "Jeden Monat bis zu 20% auf einen BIPA Einkauf!", type: "rabatt", badge: "daily", category: "beauty", source: "jö App", url: "https://www.joe-club.at", expires: "Monatlich", distance: "BIPA", hot: true },
  { id: "joe-3", brand: "jö Bonus Club", logo: "🟡", title: "Ös bei foodora sammeln", description: "Bei jeder foodora Bestellung Ös kassieren!", type: "cashback", badge: "daily", category: "essen", source: "jö App", url: "https://www.joe-club.at", expires: "Unbegrenzt", distance: "Online", hot: true },
  { id: "joe-4", brand: "jö Bonus Club", logo: "🟡", title: "50% auf OMV Sandwich", description: "Mit 100 Ös 50% auf alle Sandwiches!", type: "rabatt", badge: "instore", category: "essen", source: "jö App", url: "https://www.joe-club.at", expires: "Unbegrenzt", distance: "OMV", hot: false },
  { id: "joe-5", brand: "jö Bonus Club", logo: "🟡", title: "30% auf OMV TopWash", description: "Mit 150 Ös 30% auf Autowäsche!", type: "rabatt", badge: "instore", category: "mobilität", source: "jö App", url: "https://www.joe-club.at", expires: "Unbegrenzt", distance: "OMV", hot: false },

  // ========== MUSEEN GRATIS (15+) ==========
  { id: "museum-1", brand: "Wien Museum", logo: "🏛️", title: "Gratis unter 19", description: "Freier Eintritt für alle unter 19!", type: "gratis", badge: "instore", category: "wien", source: "Wien Museum", url: "https://www.wienmuseum.at", expires: "Unbegrenzt", distance: "Karlsplatz", hot: true },
  { id: "museum-2", brand: "Belvedere", logo: "🖼️", title: "Gratis unter 19", description: "Klimts 'Der Kuss' gratis für Jugendliche!", type: "gratis", badge: "instore", category: "wien", source: "Belvedere", url: "https://www.belvedere.at", expires: "Unbegrenzt", distance: "3. Bezirk", hot: true },
  { id: "museum-3", brand: "Albertina", logo: "🎨", title: "Gratis unter 19", description: "Weltberühmte Kunstsammlung kostenlos!", type: "gratis", badge: "instore", category: "wien", source: "Albertina", url: "https://www.albertina.at", expires: "Unbegrenzt", distance: "1. Bezirk", hot: true },
  { id: "museum-4", brand: "NHM", logo: "🦕", title: "Gratis unter 19", description: "Naturhistorisches Museum gratis!", type: "gratis", badge: "instore", category: "wien", source: "NHM", url: "https://www.nhm-wien.ac.at", expires: "Unbegrenzt", distance: "1. Bezirk", hot: true },
  { id: "museum-5", brand: "KHM", logo: "👑", title: "Gratis unter 19", description: "Kunsthistorisches Museum kostenlos!", type: "gratis", badge: "instore", category: "wien", source: "KHM", url: "https://www.khm.at", expires: "Unbegrenzt", distance: "1. Bezirk", hot: true },
  { id: "museum-6", brand: "MAK", logo: "🏺", title: "Gratis Dienstag 18-22h", description: "Jeden Dienstag Abend freier Eintritt!", type: "gratis", badge: "daily", category: "wien", source: "MAK", url: "https://www.mak.at", expires: "Dienstags", distance: "1. Bezirk", hot: true },
  { id: "museum-7", brand: "Technisches Museum", logo: "⚙️", title: "Gratis unter 19", description: "Technik zum Anfassen - kostenlos!", type: "gratis", badge: "instore", category: "wien", source: "TMW", url: "https://www.technischesmuseum.at", expires: "Unbegrenzt", distance: "14. Bezirk", hot: false },
  { id: "museum-8", brand: "Mumok", logo: "🎭", title: "Gratis unter 19", description: "Moderne Kunst kostenlos!", type: "gratis", badge: "instore", category: "wien", source: "Mumok", url: "https://www.mumok.at", expires: "Unbegrenzt", distance: "7. Bezirk", hot: false },
  { id: "museum-9", brand: "Leopold Museum", logo: "🎨", title: "Gratis unter 19", description: "Schiele, Klimt & mehr gratis!", type: "gratis", badge: "instore", category: "wien", source: "Leopold Museum", url: "https://www.leopoldmuseum.org", expires: "Unbegrenzt", distance: "7. Bezirk", hot: false },
  { id: "museum-10", brand: "Haus der Musik", logo: "🎵", title: "Gratis unter 3", description: "Kinder unter 3 gratis!", type: "gratis", badge: "instore", category: "wien", source: "Haus der Musik", url: "https://www.hausdermusik.com", expires: "Unbegrenzt", distance: "1. Bezirk", hot: false },

  // ========== WIEN SPECIALS (10+) ==========
  { id: "wien-1", brand: "Stadt Wien", logo: "👶", title: "Gratis Wickelrucksack", description: "Baby-Willkommenspaket für Wiener Familien!", type: "gratis", badge: "sample", category: "wien", source: "Wien", url: "https://www.wien.gv.at", expires: "Bei Geburt", distance: "Wien", hot: true },
  { id: "wien-2", brand: "Wiener Linien", logo: "🚇", title: "Gratis WLAN", description: "Kostenloses WLAN in allen U-Bahn-Stationen!", type: "gratis", badge: "daily", category: "wien", source: "Wiener Linien", url: "https://www.wienerlinien.at", expires: "Unbegrenzt", distance: "U-Bahn", hot: false },
  { id: "wien-3", brand: "Büchereien", logo: "📚", title: "Gratis unter 18", description: "Kostenlose Mitgliedschaft für Jugendliche!", type: "gratis", badge: "instore", category: "wien", source: "Büchereien Wien", url: "https://www.buechereien.wien.at", expires: "Unbegrenzt", distance: "Überall", hot: false },
  { id: "wien-4", brand: "Donauturm", logo: "🗼", title: "Gratis am Geburtstag", description: "Am Geburtstag (±4 Tage) gratis Auffahrt!", type: "gratis", badge: "instore", category: "wien", source: "Donauturm", url: "https://www.donauturm.at", expires: "Geburtstag", distance: "22. Bezirk", hot: true },
  { id: "wien-5", brand: "Prater", logo: "🎡", title: "Gratis Eintritt", description: "Der Wiener Prater ist immer kostenlos!", type: "gratis", badge: "daily", category: "wien", source: "Prater", url: "https://www.praterwien.com", expires: "Unbegrenzt", distance: "2. Bezirk", hot: false },
  { id: "wien-6", brand: "Schönbrunn", logo: "🏰", title: "Gratis Schlosspark", description: "Schlosspark Schönbrunn kostenlos besuchen!", type: "gratis", badge: "daily", category: "wien", source: "Schönbrunn", url: "https://www.schoenbrunn.at", expires: "Unbegrenzt", distance: "13. Bezirk", hot: false },
  { id: "wien-7", brand: "Donauinsel", logo: "🏖️", title: "Gratis Baden", description: "Gratis baden und relaxen auf der Donauinsel!", type: "gratis", badge: "daily", category: "wien", source: "Wien", url: "https://www.wien.gv.at", expires: "Unbegrenzt", distance: "Donauinsel", hot: false },

  // ========== MOBILITÄT (10+) ==========
  { id: "mobil-1", brand: "ÖBB", logo: "🚂", title: "Gratis Fahrt Geburtstag", description: "Mit Vorteilscard am Geburtstag gratis 2. Klasse!", type: "gratis", badge: "instore", category: "mobilität", source: "ÖBB", url: "https://www.oebb.at", expires: "Geburtstag", distance: "Österreich", hot: true },
  { id: "mobil-2", brand: "ÖBB", logo: "🚂", title: "Sparschiene ab €19", description: "Günstige Zugtickets bei früher Buchung!", type: "rabatt", badge: "daily", category: "mobilität", source: "ÖBB", url: "https://www.oebb.at", expires: "Früh buchen", distance: "Österreich", hot: true },
  { id: "mobil-3", brand: "Westbahn", logo: "🚄", title: "Spartickets ab €9,99", description: "Günstig nach Salzburg fahren!", type: "rabatt", badge: "daily", category: "mobilität", source: "Westbahn", url: "https://www.westbahn.at", expires: "Bei Buchung", distance: "Wien-Salzburg", hot: false },
  { id: "mobil-4", brand: "Nextbike", logo: "🚲", title: "30 Min gratis", description: "Erste 30 Minuten mit WienMobil Rad kostenlos!", type: "gratis", badge: "daily", category: "mobilität", source: "Nextbike", url: "https://www.nextbike.at", expires: "WienMobil", distance: "Wien", hot: true },
  { id: "mobil-5", brand: "Lime", logo: "🛴", title: "Gratis Minuten Aktion", description: "Regelmäßig Gratis-Minuten für E-Scooter!", type: "gratis", badge: "limited", category: "mobilität", source: "Lime", url: "https://www.li.me", expires: "Aktionen", distance: "Wien", hot: false },
  { id: "mobil-6", brand: "TIER", logo: "🛴", title: "Erste Fahrt gratis", description: "Erste E-Scooter Fahrt kostenlos!", type: "gratis", badge: "sample", category: "mobilität", source: "TIER", url: "https://www.tier.app", expires: "Erstnutzung", distance: "Wien", hot: false },

  // ========== STREAMING & DIGITAL (10+) ==========
  { id: "stream-1", brand: "Spotify", logo: "🎵", title: "3 Monate gratis Premium", description: "Neukunden: 3 Monate Premium kostenlos!", type: "testabo", badge: "limited", category: "streaming", source: "Spotify", url: "https://www.spotify.com", expires: "Neukunden", distance: "Online", hot: true },
  { id: "stream-2", brand: "Amazon Prime", logo: "📦", title: "30 Tage gratis", description: "Prime Video & Versand kostenlos testen!", type: "testabo", badge: "limited", category: "streaming", source: "Amazon", url: "https://www.amazon.de/prime", expires: "Neukunden", distance: "Online", hot: true },
  { id: "stream-3", brand: "Disney+", logo: "✨", title: "Probe-Abo", description: "Disney+ testen für Neukunden!", type: "testabo", badge: "limited", category: "streaming", source: "Disney+", url: "https://www.disneyplus.com", expires: "Neukunden", distance: "Online", hot: true },
  { id: "stream-4", brand: "YouTube Premium", logo: "▶️", title: "1 Monat gratis", description: "YouTube ohne Werbung testen!", type: "testabo", badge: "limited", category: "streaming", source: "YouTube", url: "https://www.youtube.com/premium", expires: "Neukunden", distance: "Online", hot: false },
  { id: "stream-5", brand: "Apple TV+", logo: "🍎", title: "7 Tage gratis", description: "Apple Originals kostenlos testen!", type: "testabo", badge: "limited", category: "streaming", source: "Apple", url: "https://www.apple.com/at/apple-tv-plus/", expires: "Neukunden", distance: "Online", hot: false },

  // ========== STUDENTEN SPECIALS (10+) ==========
  { id: "studi-1", brand: "Spotify", logo: "🎵", title: "Studenten 50% Rabatt", description: "Premium zum halben Preis für Studenten!", type: "rabatt", badge: "daily", category: "streaming", source: "Spotify", url: "https://www.spotify.com/at/student/", expires: "Studenten", distance: "Online", hot: true },
  { id: "studi-2", brand: "Apple", logo: "🍎", title: "Bildungsrabatt", description: "Bis zu 10% auf Mac, iPad für Studenten!", type: "rabatt", badge: "daily", category: "technik", source: "Apple", url: "https://www.apple.com/at-edu/shop", expires: "Studenten", distance: "Online", hot: true },
  { id: "studi-3", brand: "Microsoft", logo: "💻", title: "Office 365 gratis", description: "Office kostenlos für Studenten!", type: "gratis", badge: "daily", category: "technik", source: "Microsoft", url: "https://www.microsoft.com/de-at/education", expires: "Studenten", distance: "Online", hot: true },
  { id: "studi-4", brand: "Amazon Prime", logo: "📦", title: "Prime Student €4,49/M", description: "Prime zum halben Preis für Studenten!", type: "rabatt", badge: "daily", category: "streaming", source: "Amazon", url: "https://www.amazon.de/primestudent", expires: "Studenten", distance: "Online", hot: true },
  { id: "studi-5", brand: "GitHub", logo: "💻", title: "Student Developer Pack", description: "Gratis Tools & Domains für Studenten!", type: "gratis", badge: "daily", category: "technik", source: "GitHub", url: "https://education.github.com/pack", expires: "Studenten", distance: "Online", hot: true },
  { id: "studi-6", brand: "Notion", logo: "📝", title: "Plus gratis für Studenten", description: "Notion Plus komplett kostenlos!", type: "gratis", badge: "daily", category: "technik", source: "Notion", url: "https://www.notion.so/students", expires: "Studenten", distance: "Online", hot: true },
  { id: "studi-7", brand: "Figma", logo: "🎨", title: "Gratis für Studenten", description: "Figma Pro kostenlos!", type: "gratis", badge: "daily", category: "technik", source: "Figma", url: "https://www.figma.com/education/", expires: "Studenten", distance: "Online", hot: true },
  { id: "studi-8", brand: "Canva", logo: "🎨", title: "Pro gratis für Studenten", description: "Canva Pro kostenlos für Studenten!", type: "gratis", badge: "daily", category: "technik", source: "Canva", url: "https://www.canva.com/education/", expires: "Studenten", distance: "Online", hot: true },
  { id: "studi-9", brand: "ASOS", logo: "👕", title: "20% Studentenrabatt", description: "20% mit UNiDAYS Verifizierung!", type: "rabatt", badge: "daily", category: "mode", source: "ASOS", url: "https://www.asos.com", expires: "Studenten", distance: "Online", hot: true },

  // ========== CASHBACK & FINANZEN (8+) ==========
  { id: "finanz-1", brand: "Shoop", logo: "💵", title: "Cashback Online Shopping", description: "Geld zurück beim Online-Shopping!", type: "cashback", badge: "daily", category: "finanzen", source: "Shoop", url: "https://www.shoop.at", expires: "Unbegrenzt", distance: "Online", hot: true },
  { id: "finanz-2", brand: "TopCashback", logo: "💷", title: "Höchstes Cashback", description: "Oft das beste Cashback am Markt!", type: "cashback", badge: "daily", category: "finanzen", source: "TopCashback", url: "https://www.topcashback.de", expires: "Unbegrenzt", distance: "Online", hot: true },
  { id: "finanz-3", brand: "N26", logo: "📱", title: "Gratis Konto", description: "Kostenloses Online-Konto ohne Gebühren!", type: "gratis", badge: "daily", category: "finanzen", source: "N26", url: "https://www.n26.com", expires: "Unbegrenzt", distance: "Online", hot: true },
  { id: "finanz-4", brand: "Revolut", logo: "💳", title: "Gratis Konto + Karte", description: "Kostenloses Konto mit gratis Karte!", type: "gratis", badge: "daily", category: "finanzen", source: "Revolut", url: "https://www.revolut.com", expires: "Unbegrenzt", distance: "Online", hot: true },
  { id: "finanz-5", brand: "Trade Republic", logo: "📈", title: "Gratis Aktie", description: "Bei Depot-Eröffnung Gratis-Aktie bis €200!", type: "gratis", badge: "limited", category: "finanzen", source: "Trade Republic", url: "https://www.traderepublic.com", expires: "Neukunden", distance: "Online", hot: true },
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
const GRATIS_KEYWORDS = [
  'gratis', 'kostenlos', 'free', 'geschenkt', 'umsonst', 'freebie', 'gewinnspiel', 
  '0 €', '0€', '1+1', '2+1', 'gratisproben', 'probe', 'testen', 'geburtstag',
  'willkommensgeschenk', 'gutschein', 'voucher', 'freigetränk', 'frei ', 'for free'
];
const DEAL_KEYWORDS = [
  'rabatt', 'aktion', 'angebot', 'sale', 'prozent', '%', 'günstiger', 'sparen', 
  'deal', 'schnäppchen', 'reduziert', 'ermäßigt', 'billiger', 'preiswert',
  'sonderangebot', 'ausverkauf', 'abverkauf', 'minus', '-50', '-25', '-20', '-30',
  'happy hour', 'mittagsmenü', 'lunch deal', 'tagesgericht'
];
const NEUEROFFNUNG_KEYWORDS = [
  'neueröffnung', 'eröffnung', 'opening', 'neu eröffnet', 'grand opening', 
  'soft opening', 'neue filiale', 'neues lokal', 'neues restaurant', 'jetzt neu',
  'ab sofort', 'endlich da', 'neu in wien', 'premiere'
];
const WIEN_KEYWORDS = [
  'wien', 'vienna', 'wiener', '1010', '1020', '1030', '1040', '1050', '1060', 
  '1070', '1080', '1090', '1100', '1110', '1120', '1130', '1140', '1150',
  '1160', '1170', '1180', '1190', '1200', '1210', '1220', '1230',
  'favoriten', 'mariahilf', 'neubau', 'josefstadt', 'alsergrund', 'leopoldstadt',
  'landstraße', 'wieden', 'margareten', 'donaustadt', 'floridsdorf', 'meidling'
];

function extractTag(xml, tag) {
  const cdataRegex = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i');
  const cdataMatch = xml.match(cdataRegex);
  if (cdataMatch) return cdataMatch[1].trim();
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].replace(/<[^>]*>/g, '').trim() : '';
}

// ============================================
// INTELLIGENTE KATEGORISIERUNG
// ============================================

function detectCategory(text) {
  const t = text.toLowerCase();
  
  // Technik - ZUERST prüfen damit Apple/iPhone nicht in andere Kategorien fallen
  if (/iphone|ipad|macbook|apple\s?watch|airpod|samsung|galaxy|huawei|xiaomi|handy|smartphone|laptop|tablet|computer|pc|gaming|playstation|ps5|xbox|nintendo|switch|fernseher|tv|kopfhörer|headphone|monitor|drucker|kamera|gopro/i.test(t)) {
    return 'technik';
  }
  
  // Werkzeug/Baumarkt -> shopping (nicht essen!)
  if (/pattex|klebeband|werkzeug|bohrer|schrauben|baumarkt|obi|hornbach|bauhaus|ikea|möbel|regal|lampe|tisch|stuhl|bett|couch|sofa/i.test(t)) {
    return 'shopping';
  }
  
  // Kaffee
  if (/\bkaffee\b|coffee|latte|cappuccino|espresso|café|cafe|starbucks|mccafé|barista|melange/i.test(t)) {
    return 'kaffee';
  }
  
  // Essen - spezifische Food Keywords
  if (/pizza|kebab|döner|burger|essen\s|restaurant|lokal|gastro|grill|sushi|pasta|schnitzel|würstel|bäcker|konditor|torte|kuchen|menü|buffet|brunch|frühstück|mittagessen|abendessen|wok|asia|mexikan|indisch|thai|vietn|lieferung|delivery|mjam|lieferando/i.test(t)) {
    return 'essen';
  }
  
  // Supermarkt
  if (/billa|spar|interspar|lidl|hofer|penny|supermarkt|lebensmittel|unimarkt|merkur|nah.{0,3}frisch|aktion.*woche/i.test(t)) {
    return 'supermarkt';
  }
  
  // Beauty
  if (/dm\s|bipa|douglas|sephora|beauty|kosmetik|friseur|frisör|haarschnitt|nagel|make.?up|parfum|parfüm|creme|shampoo|duschgel|körperpflege|hautpflege|salon|wellness|spa|massage|gesichtspflege/i.test(t)) {
    return 'beauty';
  }
  
  // Streaming
  if (/netflix|spotify|disney\+|amazon\s?prime|youtube\s?premium|gaming|abo|subscription|stream|dazn|sky/i.test(t)) {
    return 'streaming';
  }
  
  // Mode
  if (/h&m|zara|zalando|fashion|mode|kleidung|schuhe|sneaker|jacke|hose|shirt|kleid|textil|bekleidung|outfit|nike|adidas|puma|c&a|peek|primark/i.test(t)) {
    return 'mode';
  }
  
  // Mobilität
  if (/wiener\s?linien|öbb|zug|bahn|bus\s|taxi|uber|bolt|scooter|e-scooter|rad|fahrrad|auto|tanken|tankstelle|omv|shell|bp|klimaticket|jahreskarte/i.test(t)) {
    return 'mobilität';
  }
  
  // Finanzen
  if (/bank|konto|kreditkarte|versicherung|kredit|sparkasse|erste\s?bank|raiffeisen|bawag|n26|finanz|crypto|bitcoin/i.test(t)) {
    return 'finanzen';
  }
  
  // Wien (Kultur, Events)
  if (/museum|ausstellung|kultur|theater|oper|konzert|event|wien\s|vienna|eintritt|kino|film|show|festival/i.test(t)) {
    return 'wien';
  }
  
  // Default: shopping für unbekannte Kategorien
  return 'shopping';
}

// Prüfe ob Deal relevant ist für FreeFinder
function isRelevantDeal(title, description) {
  const text = (title + ' ' + description).toLowerCase();
  
  // Ausschließen: Reine Preisvergleiche ohne echten Deal
  if (/preisvergleich.*\d{3,}€|mylem|idealo|geizhals/i.test(text)) {
    if (!/gratis|kostenlos|geschenkt|1\+1|2\+1|50%|60%|70%|80%|90%/i.test(text)) {
      return false;
    }
  }
  
  // Ausschließen: Sehr teure Produkte ohne echten Rabatt
  const priceMatch = text.match(/(\d{3,4})[,.]?\d{0,2}\s*€/);
  if (priceMatch) {
    const price = parseInt(priceMatch[1]);
    if (price > 300 && !/gratis|kostenlos|geschenkt|50%|60%|70%|80%|90%|stark reduziert/i.test(text)) {
      return false;
    }
  }
  
  return true;
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
    
    // Prüfe ob Deal wirklich relevant ist (keine teuren Preisvergleiche)
    if (!isRelevantDeal(title, description || '')) continue;
    
    // Bestimme Badge
    let badge = 'daily';
    if (isGratis) badge = 'gratis';
    else if (isNeueroffnung) badge = 'limited';
    
    // Bestimme Kategorie mit intelligenter Erkennung
    const category = detectCategory(fullText);
    
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
  const lowerHtml = html.toLowerCase();
  
  // Prüfe ob Wien-relevant (für Social Media wichtig)
  const isWienRelevant = WIEN_KEYWORDS.some(k => lowerHtml.includes(k.toLowerCase()));
  
  // Erweiterte Patterns für Deal-Erkennung
  const patterns = [
    /gratis[^<]{5,150}/gi,
    /kostenlos[^<]{5,150}/gi,
    /1\+1\s*gratis[^<]{0,100}/gi,
    /2\+1\s*gratis[^<]{0,100}/gi,
    /neueröffnung[^<]{5,150}/gi,
    /eröffnung[^<]{5,150}/gi,
    /opening[^<]{5,150}/gi,
    /-\s*\d{1,2}\s*%[^<]{5,100}/gi,
    /\d{1,2}\s*%\s*(rabatt|günstiger|sparen)[^<]{0,80}/gi,
    /gratis\s*(kaffee|essen|getränk|probe|haarschnitt|eintritt)[^<]{0,80}/gi,
    /free\s*(coffee|food|drink|sample)[^<]{0,80}/gi,
    /geschenkt[^<]{5,100}/gi,
    /freebie[^<]{5,100}/gi,
    /happy\s*hour[^<]{5,100}/gi,
    /gewinnspiel[^<]{5,100}/gi,
    /gutschein[^<]{5,100}/gi,
  ];
  
  patterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const context = match[0].replace(/<[^>]*>/g, '').trim();
      if (context.length > 10 && context.length < 200) {
        const isGratis = /gratis|kostenlos|1\+1|2\+1|free|geschenkt|freebie/i.test(context);
        const isNeueroffnung = /neueröffnung|eröffnung|opening|neu\s*eröffnet/i.test(context);
        
        // Für Social Media: nur Wien-relevante Posts
        if ((source.brand === 'Facebook' || source.brand === 'Instagram' || source.brand === 'TikTok') && !isWienRelevant) {
          continue;
        }
        
        // Prüfe ob Deal relevant ist (keine teuren Preisvergleiche)
        if (!isRelevantDeal(context, '')) continue;
        
        // Intelligente Kategorisierung basierend auf Inhalt
        const category = detectCategory(context);
        
        deals.push({
          id: `html-${source.brand}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          brand: source.brand,
          logo: source.logo,
          title: `${isNeueroffnung ? '🆕 Neueröffnung' : (isGratis ? '🎁 Gratis Deal' : '💰 Rabatt')} via ${source.brand}`,
          description: context.substring(0, 120),
          type: isGratis ? 'gratis' : 'rabatt',
          badge: isGratis ? 'gratis' : 'limited',
          category: category,
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
  const now = new Date();
  const today = now.toISOString().split('T')[0]; // "2026-01-16"
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-12
  
  // Monate für Erkennung veralteter Deals
  const oldMonths = ['januar', 'februar', 'märz', 'april', 'mai', 'juni', 
                     'juli', 'august', 'september', 'oktober', 'november', 'dezember',
                     'january', 'february', 'march', 'april', 'may', 'june',
                     'july', 'august', 'september', 'october', 'november', 'december'];
  
  const validDeals = allDeals.filter(deal => {
    // 1. Prüfe validUntil Datum
    if (deal.validUntil && deal.validUntil < today) {
      return false;
    }
    
    // 2. Prüfe auf alte Jahreszahlen im Titel/Description
    const text = `${deal.title} ${deal.description}`.toLowerCase();
    
    // Entferne Deals mit alten Jahren (2024, 2025 etc.)
    for (let year = 2020; year < currentYear; year++) {
      if (text.includes(year.toString())) {
        return false;
      }
    }
    
    // 3. Prüfe auf vergangene Monate im aktuellen Jahr
    // z.B. "August 2025" wenn wir Januar 2026 haben
    const yearInText = text.match(/20\d{2}/);
    if (yearInText) {
      const dealYear = parseInt(yearInText[0]);
      if (dealYear < currentYear) {
        return false; // Altes Jahr
      }
      if (dealYear === currentYear) {
        // Prüfe ob Monat vergangen ist
        for (let i = 0; i < currentMonth - 1; i++) {
          if (text.includes(oldMonths[i]) || text.includes(oldMonths[i + 12])) {
            return false; // Vergangener Monat
          }
        }
      }
    }
    
    // 4. Prüfe pubDate bei gescrapten Deals (max 7 Tage alt)
    if (deal.pubDate) {
      const pubDate = new Date(deal.pubDate);
      const daysDiff = (now - pubDate) / (1000 * 60 * 60 * 24);
      if (daysDiff > 7) {
        return false; // Älter als 7 Tage
      }
    }
    
    return true;
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
  
  // Sortiere: Priority > Gratis > Hot > Neu > Rest
  uniqueDeals.sort((a, b) => {
    // 1. Priority (niedrigere Zahl = höher)
    const prioA = a.priority || 99;
    const prioB = b.priority || 99;
    if (prioA !== prioB) return prioA - prioB;
    
    // 2. Echte Gratis-Deals (ohne viel Aufwand)
    const isRealFreeA = a.type === 'gratis' && !a.expires?.includes('Geburtstag') && !a.expires?.includes('10.');
    const isRealFreeB = b.type === 'gratis' && !b.expires?.includes('Geburtstag') && !b.expires?.includes('10.');
    if (isRealFreeA && !isRealFreeB) return -1;
    if (!isRealFreeA && isRealFreeB) return 1;
    
    // 3. Hot Deals
    if (a.hot && !b.hot) return -1;
    if (!a.hot && b.hot) return 1;
    
    // 4. Neue Deals
    if (a.isNew && !b.isNew) return -1;
    if (!a.isNew && b.isNew) return 1;
    
    // 5. Gratis vor Rabatt
    if (a.type === 'gratis' && b.type !== 'gratis') return -1;
    if (a.type !== 'gratis' && b.type === 'gratis') return 1;
    
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

// Führe Scraper aus - IMMER mit exit code 0
scrapeAllSources()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Scraper Error:', err.message);
    process.exit(0); // Trotzdem 0, damit GitHub Actions nicht fehlschlägt
  });

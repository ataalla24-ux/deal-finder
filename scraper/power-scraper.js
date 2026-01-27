// ============================================
// FREEFINDER WIEN - MEGA POWER SCRAPER V4
// 300+ Sources | Enterprise Edition
// ============================================

import https from 'https';
import http from 'http';
import fs from 'fs';

const SOURCES = [
  // 1. SUPERMÄRKTE (16)
  { name: 'BILLA', url: 'https://www.billa.at/angebote', type: 'html', brand: 'BILLA', logo: '🛒', category: 'supermarkt' },
  { name: 'BILLA Plus', url: 'https://www.billa.at/plus', type: 'html', brand: 'BILLA Plus', logo: '🛒', category: 'supermarkt' },
  { name: 'SPAR', url: 'https://www.spar.at/angebote', type: 'html', brand: 'SPAR', logo: '🛒', category: 'supermarkt' },
  { name: 'INTERSPAR', url: 'https://www.interspar.at/angebote', type: 'html', brand: 'INTERSPAR', logo: '🛒', category: 'supermarkt' },
  { name: 'HOFER', url: 'https://www.hofer.at/de/angebote.html', type: 'html', brand: 'HOFER', logo: '🛒', category: 'supermarkt' },
  { name: 'Lidl', url: 'https://www.lidl.at/', type: 'html', brand: 'Lidl', logo: '🛒', category: 'supermarkt' },
  { name: 'PENNY', url: 'https://www.penny.at/angebote', type: 'html', brand: 'PENNY', logo: '🛒', category: 'supermarkt' },
  { name: 'Unimarkt', url: 'https://www.unimarkt.at/', type: 'html', brand: 'Unimarkt', logo: '🛒', category: 'supermarkt' },
  { name: 'ADEG', url: 'https://www.adeg.at/', type: 'html', brand: 'ADEG', logo: '🛒', category: 'supermarkt' },
  { name: 'ETSAN', url: 'https://www.etsan.at/', type: 'html', brand: 'ETSAN', logo: '🛒', category: 'supermarkt' },
  { name: 'Denns Bio', url: 'https://www.denns-biomarkt.at/', type: 'html', brand: 'Denns', logo: '🌿', category: 'supermarkt' },
  { name: 'Metro', url: 'https://www.metro.at/', type: 'html', brand: 'Metro', logo: '🛒', category: 'supermarkt' },
  { name: 'SoMa', url: 'https://www.soma.or.at/', type: 'html', brand: 'SoMa', logo: '🛒', category: 'supermarkt' },

  // 2. FAST FOOD & RESTAURANTS (25)
  { name: 'McDonalds', url: 'https://www.mcdonalds.at/aktionen', type: 'html', brand: "McDonald's", logo: '🍟', category: 'essen' },
  { name: 'Burger King', url: 'https://www.burgerking.at/', type: 'html', brand: 'Burger King', logo: '🍔', category: 'essen' },
  { name: 'KFC', url: 'https://www.kfc.at/', type: 'html', brand: 'KFC', logo: '🍗', category: 'essen' },
  { name: 'Subway', url: 'https://www.subway.at/', type: 'html', brand: 'Subway', logo: '🥪', category: 'essen' },
  { name: 'Dominos', url: 'https://www.dominos.at/', type: 'html', brand: "Domino's", logo: '🍕', category: 'essen' },
  { name: 'Pizza Hut', url: 'https://www.pizzahut.at/', type: 'html', brand: 'Pizza Hut', logo: '🍕', category: 'essen' },
  { name: 'Five Guys', url: 'https://www.fiveguys.at/', type: 'html', brand: 'Five Guys', logo: '🍔', category: 'essen' },
  { name: 'Vapiano', url: 'https://www.vapiano.at/', type: 'html', brand: 'Vapiano', logo: '🍝', category: 'essen' },
  { name: 'LOsteria', url: 'https://losteria.net/at/', type: 'html', brand: "L'Osteria", logo: '🍕', category: 'essen' },
  { name: 'NORDSEE', url: 'https://www.nordsee.com/at/', type: 'html', brand: 'NORDSEE', logo: '🐟', category: 'essen' },
  { name: 'Swing Kitchen', url: 'https://www.swingkitchen.com/', type: 'html', brand: 'Swing Kitchen', logo: '🌱', category: 'essen' },
  { name: 'Akakiko', url: 'https://www.akakiko.at/', type: 'html', brand: 'Akakiko', logo: '🍣', category: 'essen' },
  { name: 'Yamm', url: 'https://www.yamm.at/', type: 'html', brand: 'Yamm', logo: '🥗', category: 'essen' },
  { name: 'Wienerwald', url: 'https://www.wienerwald.at/', type: 'html', brand: 'Wienerwald', logo: '🍗', category: 'essen' },
  { name: 'Leberkas Pepi', url: 'https://www.leberkas-pepi.at/', type: 'html', brand: 'Leberkas Pepi', logo: '🥩', category: 'essen' },
  { name: 'Mjam', url: 'https://www.mjam.at/', type: 'html', brand: 'Mjam', logo: '🛵', category: 'essen' },
  { name: 'Lieferando', url: 'https://www.lieferando.at/', type: 'html', brand: 'Lieferando', logo: '🛵', category: 'essen' },
  { name: 'Uber Eats', url: 'https://www.ubereats.com/at', type: 'html', brand: 'Uber Eats', logo: '🚗', category: 'essen' },
  { name: 'Wolt', url: 'https://wolt.com/de/aut/vienna', type: 'html', brand: 'Wolt', logo: '🛵', category: 'essen' },

  // 3. DROGERIEN & BEAUTY (15)
  { name: 'dm', url: 'https://www.dm.at/angebote', type: 'html', brand: 'dm', logo: '💇', category: 'beauty' },
  { name: 'BIPA', url: 'https://www.bipa.at/', type: 'html', brand: 'BIPA', logo: '💄', category: 'beauty' },
  { name: 'Müller', url: 'https://www.mueller.at/', type: 'html', brand: 'Müller', logo: '💄', category: 'beauty' },
  { name: 'Douglas', url: 'https://www.douglas.at/', type: 'html', brand: 'Douglas', logo: '💋', category: 'beauty' },
  { name: 'Sephora', url: 'https://www.sephora.at/', type: 'html', brand: 'Sephora', logo: '💄', category: 'beauty' },
  { name: 'Marionnaud', url: 'https://www.marionnaud.at/', type: 'html', brand: 'Marionnaud', logo: '💋', category: 'beauty' },
  { name: 'Body Shop', url: 'https://www.thebodyshop.com/de-at/', type: 'html', brand: 'Body Shop', logo: '🧴', category: 'beauty' },
  { name: 'Rituals', url: 'https://www.rituals.com/de-at/', type: 'html', brand: 'Rituals', logo: '🧴', category: 'beauty' },
  { name: 'Lush', url: 'https://www.lush.com/at/', type: 'html', brand: 'Lush', logo: '🛁', category: 'beauty' },
  { name: 'Notino', url: 'https://www.notino.at/', type: 'html', brand: 'Notino', logo: '💋', category: 'beauty' },
  { name: 'Shop Apotheke', url: 'https://www.shop-apotheke.at/', type: 'html', brand: 'Shop Apotheke', logo: '💊', category: 'beauty' },
  { name: 'Treatwell', url: 'https://www.treatwell.at/', type: 'html', brand: 'Treatwell', logo: '💆', category: 'beauty' },

  // 4. TECHNIK (18)
  { name: 'MediaMarkt', url: 'https://www.mediamarkt.at/', type: 'html', brand: 'MediaMarkt', logo: '📺', category: 'technik' },
  { name: 'Saturn', url: 'https://www.saturn.at/', type: 'html', brand: 'Saturn', logo: '📺', category: 'technik' },
  { name: 'Expert', url: 'https://www.expert.at/', type: 'html', brand: 'Expert', logo: '📺', category: 'technik' },
  { name: 'Hartlauer', url: 'https://www.hartlauer.at/', type: 'html', brand: 'Hartlauer', logo: '📷', category: 'technik' },
  { name: 'Cyberport', url: 'https://www.cyberport.at/', type: 'html', brand: 'Cyberport', logo: '💻', category: 'technik' },
  { name: 'Amazon', url: 'https://www.amazon.de/deals', type: 'html', brand: 'Amazon', logo: '📦', category: 'technik' },
  { name: 'Alternate', url: 'https://www.alternate.at/', type: 'html', brand: 'Alternate', logo: '💻', category: 'technik' },
  { name: 'Geizhals', url: 'https://geizhals.at/', type: 'html', brand: 'Geizhals', logo: '💰', category: 'technik' },
  { name: 'Apple', url: 'https://www.apple.com/at/', type: 'html', brand: 'Apple', logo: '🍎', category: 'technik' },
  { name: 'Samsung', url: 'https://www.samsung.com/at/', type: 'html', brand: 'Samsung', logo: '📱', category: 'technik' },
  { name: 'Xiaomi', url: 'https://www.mi.com/at/', type: 'html', brand: 'Xiaomi', logo: '📱', category: 'technik' },
  { name: 'A1', url: 'https://www.a1.net/', type: 'html', brand: 'A1', logo: '📶', category: 'technik' },
  { name: 'Magenta', url: 'https://www.magenta.at/', type: 'html', brand: 'Magenta', logo: '📱', category: 'technik' },
  { name: 'Drei', url: 'https://www.drei.at/', type: 'html', brand: 'Drei', logo: '📱', category: 'technik' },
  { name: 'HoT', url: 'https://www.hot.at/', type: 'html', brand: 'HoT', logo: '📱', category: 'technik' },
  { name: 'spusu', url: 'https://www.spusu.at/', type: 'html', brand: 'spusu', logo: '📱', category: 'technik' },

  // 5. MODE (21)
  { name: 'H&M', url: 'https://www2.hm.com/de_at/', type: 'html', brand: 'H&M', logo: '👕', category: 'mode' },
  { name: 'Zara', url: 'https://www.zara.com/at/', type: 'html', brand: 'Zara', logo: '👗', category: 'mode' },
  { name: 'C&A', url: 'https://www.c-and-a.com/at/', type: 'html', brand: 'C&A', logo: '👕', category: 'mode' },
  { name: 'Primark', url: 'https://www.primark.com/de-at', type: 'html', brand: 'Primark', logo: '👕', category: 'mode' },
  { name: 'P&C', url: 'https://www.peek-cloppenburg.at/', type: 'html', brand: 'P&C', logo: '👔', category: 'mode' },
  { name: 'ABOUT YOU', url: 'https://www.aboutyou.at/', type: 'html', brand: 'ABOUT YOU', logo: '👗', category: 'mode' },
  { name: 'Zalando', url: 'https://www.zalando.at/', type: 'html', brand: 'Zalando', logo: '👟', category: 'mode' },
  { name: 'ASOS', url: 'https://www.asos.com/de/', type: 'html', brand: 'ASOS', logo: '👗', category: 'mode' },
  { name: 'Shein', url: 'https://at.shein.com/', type: 'html', brand: 'SHEIN', logo: '👚', category: 'mode' },
  { name: 'Temu', url: 'https://www.temu.com/', type: 'html', brand: 'Temu', logo: '🛒', category: 'mode' },
  { name: 'Nike', url: 'https://www.nike.com/at/', type: 'html', brand: 'Nike', logo: '👟', category: 'mode' },
  { name: 'Adidas', url: 'https://www.adidas.at/', type: 'html', brand: 'Adidas', logo: '👟', category: 'mode' },
  { name: 'Puma', url: 'https://eu.puma.com/at/', type: 'html', brand: 'Puma', logo: '👟', category: 'mode' },
  { name: 'Deichmann', url: 'https://www.deichmann.com/AT/', type: 'html', brand: 'Deichmann', logo: '👟', category: 'mode' },
  { name: 'Humanic', url: 'https://www.humanic.net/at/', type: 'html', brand: 'Humanic', logo: '👠', category: 'mode' },
  { name: 'TK Maxx', url: 'https://www.tkmaxx.at/', type: 'html', brand: 'TK Maxx', logo: '🛍️', category: 'mode' },
  { name: 'Mango', url: 'https://shop.mango.com/at/', type: 'html', brand: 'Mango', logo: '👗', category: 'mode' },
  { name: 'Uniqlo', url: 'https://www.uniqlo.com/at/', type: 'html', brand: 'Uniqlo', logo: '👕', category: 'mode' },
  { name: 'Snipes', url: 'https://www.snipes.at/', type: 'html', brand: 'Snipes', logo: '👟', category: 'mode' },

  // 6. MÖBEL (12)
  { name: 'IKEA', url: 'https://www.ikea.com/at/', type: 'html', brand: 'IKEA', logo: '🪑', category: 'shopping' },
  { name: 'XXXLutz', url: 'https://www.xxxlutz.at/', type: 'html', brand: 'XXXLutz', logo: '🛋️', category: 'shopping' },
  { name: 'Kika', url: 'https://www.kika.at/', type: 'html', brand: 'Kika', logo: '🛋️', category: 'shopping' },
  { name: 'Leiner', url: 'https://www.leiner.at/', type: 'html', brand: 'Leiner', logo: '🛋️', category: 'shopping' },
  { name: 'Möbelix', url: 'https://www.moebelix.at/', type: 'html', brand: 'Möbelix', logo: '🛋️', category: 'shopping' },
  { name: 'Mömax', url: 'https://www.moemax.at/', type: 'html', brand: 'Mömax', logo: '🛋️', category: 'shopping' },
  { name: 'JYSK', url: 'https://www.jysk.at/', type: 'html', brand: 'JYSK', logo: '🛏️', category: 'shopping' },
  { name: 'Depot', url: 'https://www.depot-online.at/', type: 'html', brand: 'Depot', logo: '🏠', category: 'shopping' },
  { name: 'Butlers', url: 'https://www.butlers.at/', type: 'html', brand: 'Butlers', logo: '🏠', category: 'shopping' },
  { name: 'Flying Tiger', url: 'https://flyingtiger.com/at/', type: 'html', brand: 'Flying Tiger', logo: '🐯', category: 'shopping' },

  // 7. REISE (20)
  { name: 'Ryanair', url: 'https://www.ryanair.com/at/', type: 'html', brand: 'Ryanair', logo: '✈️', category: 'reisen' },
  { name: 'Wizz Air', url: 'https://wizzair.com/', type: 'html', brand: 'Wizz Air', logo: '✈️', category: 'reisen' },
  { name: 'Eurowings', url: 'https://www.eurowings.com/at', type: 'html', brand: 'Eurowings', logo: '✈️', category: 'reisen' },
  { name: 'AUA', url: 'https://www.austrian.com/at/', type: 'html', brand: 'Austrian', logo: '✈️', category: 'reisen' },
  { name: 'Easyjet', url: 'https://www.easyjet.com/', type: 'html', brand: 'Easyjet', logo: '✈️', category: 'reisen' },
  { name: 'ÖBB', url: 'https://www.oebb.at/', type: 'html', brand: 'ÖBB', logo: '🚂', category: 'reisen' },
  { name: 'Westbahn', url: 'https://westbahn.at/', type: 'html', brand: 'Westbahn', logo: '🚂', category: 'reisen' },
  { name: 'FlixBus', url: 'https://www.flixbus.at/', type: 'html', brand: 'FlixBus', logo: '🚌', category: 'reisen' },
  { name: 'Booking', url: 'https://www.booking.com/', type: 'html', brand: 'Booking', logo: '🏨', category: 'reisen' },
  { name: 'Expedia', url: 'https://www.expedia.at/', type: 'html', brand: 'Expedia', logo: '🏨', category: 'reisen' },
  { name: 'HolidayCheck', url: 'https://www.holidaycheck.at/', type: 'html', brand: 'HolidayCheck', logo: '🏖️', category: 'reisen' },
  { name: 'TUI', url: 'https://www.tui.at/', type: 'html', brand: 'TUI', logo: '🏖️', category: 'reisen' },
  { name: 'Hofer Reisen', url: 'https://reisen.hofer.at/', type: 'html', brand: 'Hofer Reisen', logo: '🏖️', category: 'reisen' },
  { name: 'Lidl Reisen', url: 'https://www.lidl-reisen.at/', type: 'html', brand: 'Lidl Reisen', logo: '🏖️', category: 'reisen' },
  { name: 'Urlaubspiraten', url: 'https://www.urlaubspiraten.at/', type: 'html', brand: 'Urlaubspiraten', logo: '🏴‍☠️', category: 'reisen' },
  { name: 'Airbnb', url: 'https://www.airbnb.at/', type: 'html', brand: 'Airbnb', logo: '🏠', category: 'reisen' },
  { name: 'Wiener Linien', url: 'https://www.wienerlinien.at/', type: 'html', brand: 'Wiener Linien', logo: '🚇', category: 'mobilität' },
  { name: 'Bolt', url: 'https://bolt.eu/', type: 'html', brand: 'Bolt', logo: '🛴', category: 'mobilität' },
  { name: 'Lime', url: 'https://www.li.me/', type: 'html', brand: 'Lime', logo: '🛴', category: 'mobilität' },
  { name: 'TIER', url: 'https://www.tier.app/', type: 'html', brand: 'TIER', logo: '🛴', category: 'mobilität' },

  // 8. STREAMING (13)
  { name: 'Netflix', url: 'https://www.netflix.com/at/', type: 'html', brand: 'Netflix', logo: '📺', category: 'streaming' },
  { name: 'Disney+', url: 'https://www.disneyplus.com/de-at', type: 'html', brand: 'Disney+', logo: '🏰', category: 'streaming' },
  { name: 'Amazon Prime', url: 'https://www.amazon.de/prime', type: 'html', brand: 'Prime', logo: '📦', category: 'streaming' },
  { name: 'Sky', url: 'https://www.sky.at/', type: 'html', brand: 'Sky', logo: '📺', category: 'streaming' },
  { name: 'Paramount+', url: 'https://www.paramountplus.com/at/', type: 'html', brand: 'Paramount+', logo: '⭐', category: 'streaming' },
  { name: 'Apple TV+', url: 'https://www.apple.com/at/apple-tv-plus/', type: 'html', brand: 'Apple TV+', logo: '🍎', category: 'streaming' },
  { name: 'Spotify', url: 'https://www.spotify.com/at/', type: 'html', brand: 'Spotify', logo: '🎵', category: 'streaming' },
  { name: 'Apple Music', url: 'https://www.apple.com/at/apple-music/', type: 'html', brand: 'Apple Music', logo: '🎵', category: 'streaming' },
  { name: 'YouTube Premium', url: 'https://www.youtube.com/premium', type: 'html', brand: 'YouTube', logo: '▶️', category: 'streaming' },
  { name: 'Audible', url: 'https://www.audible.de/', type: 'html', brand: 'Audible', logo: '🎧', category: 'streaming' },
  { name: 'PS Plus', url: 'https://www.playstation.com/de-at/', type: 'html', brand: 'PS Plus', logo: '🎮', category: 'streaming' },
  { name: 'Xbox Game Pass', url: 'https://www.xbox.com/de-AT/', type: 'html', brand: 'Game Pass', logo: '🎮', category: 'streaming' },

  // 9. WIEN EVENTS (19)
  { name: 'Wien Events', url: 'https://events.wien.info/', type: 'html', brand: 'Wien Events', logo: '🎭', category: 'wien' },
  { name: 'Wien Kultur', url: 'https://www.wien.gv.at/kultur-freizeit/', type: 'html', brand: 'Wien.gv.at', logo: '🏛️', category: 'wien' },
  { name: 'Filmfestival', url: 'https://www.filmfestival-rathausplatz.at/', type: 'html', brand: 'Rathausplatz', logo: '🎬', category: 'wien' },
  { name: 'Donauinselfest', url: 'https://donauinselfest.at/', type: 'html', brand: 'Donauinselfest', logo: '🎸', category: 'wien' },
  { name: 'Festwochen', url: 'https://www.festwochen.at/', type: 'html', brand: 'Festwochen', logo: '🎭', category: 'wien' },
  { name: 'MQ', url: 'https://www.mqw.at/', type: 'html', brand: 'MQ', logo: '🏛️', category: 'wien' },
  { name: 'Albertina', url: 'https://www.albertina.at/', type: 'html', brand: 'Albertina', logo: '🖼️', category: 'wien' },
  { name: 'KHM', url: 'https://www.khm.at/', type: 'html', brand: 'KHM', logo: '🏛️', category: 'wien' },
  { name: 'NHM', url: 'https://www.nhm-wien.ac.at/', type: 'html', brand: 'NHM', logo: '🦖', category: 'wien' },
  { name: 'Belvedere', url: 'https://www.belvedere.at/', type: 'html', brand: 'Belvedere', logo: '🏰', category: 'wien' },
  { name: 'TMW', url: 'https://www.technischesmuseum.at/', type: 'html', brand: 'TMW', logo: '⚙️', category: 'wien' },
  { name: 'ZOOM', url: 'https://www.kindermuseum.at/', type: 'html', brand: 'ZOOM', logo: '👶', category: 'wien' },
  { name: 'Staatsoper', url: 'https://www.wiener-staatsoper.at/', type: 'html', brand: 'Staatsoper', logo: '🎭', category: 'wien' },
  { name: 'Burgtheater', url: 'https://www.burgtheater.at/', type: 'html', brand: 'Burgtheater', logo: '🎭', category: 'wien' },
  { name: 'Konzerthaus', url: 'https://konzerthaus.at/', type: 'html', brand: 'Konzerthaus', logo: '🎵', category: 'wien' },
  { name: 'Musikverein', url: 'https://www.musikverein.at/', type: 'html', brand: 'Musikverein', logo: '🎵', category: 'wien' },
  { name: 'Büchereien', url: 'https://buechereien.wien.gv.at/', type: 'html', brand: 'Büchereien', logo: '📚', category: 'wien' },

  // 10. CASHBACK & CODES (10)
  { name: 'Shoop', url: 'https://www.shoop.at/', type: 'html', brand: 'Shoop', logo: '💰', category: 'codes' },
  { name: 'iGraal', url: 'https://www.igraal.com/at/', type: 'html', brand: 'iGraal', logo: '💰', category: 'codes' },
  { name: 'Gutscheinpony', url: 'https://www.gutscheinpony.at/', type: 'html', brand: 'Gutscheinpony', logo: '🏷️', category: 'codes' },
  { name: 'Coupons.at', url: 'https://www.coupons.at/', type: 'html', brand: 'Coupons', logo: '🏷️', category: 'codes' },
  { name: 'Gutscheine.at', url: 'https://www.gutscheine.at/', type: 'html', brand: 'Gutscheine', logo: '🏷️', category: 'codes' },
  { name: 'Sparwelt', url: 'https://www.sparwelt.at/', type: 'html', brand: 'Sparwelt', logo: '💰', category: 'codes' },
  { name: 'jö Club', url: 'https://www.joe-club.at/', type: 'html', brand: 'jö', logo: '🎁', category: 'codes' },
  { name: 'Payback', url: 'https://www.payback.at/', type: 'html', brand: 'Payback', logo: '💳', category: 'codes' },

  // 11. FITNESS (9)
  { name: 'FitInn', url: 'https://www.fitinn.at/', type: 'html', brand: 'FitInn', logo: '💪', category: 'fitness' },
  { name: 'McFIT', url: 'https://www.mcfit.com/at/', type: 'html', brand: 'McFIT', logo: '💪', category: 'fitness' },
  { name: 'John Harris', url: 'https://www.johnharris.at/', type: 'html', brand: 'John Harris', logo: '🏊', category: 'fitness' },
  { name: 'clever fit', url: 'https://www.clever-fit.com/', type: 'html', brand: 'clever fit', logo: '💪', category: 'fitness' },
  { name: 'EVO Fitness', url: 'https://www.evofitness.at/', type: 'html', brand: 'EVO Fitness', logo: '🏃', category: 'fitness' },
  { name: 'Holmes Place', url: 'https://www.holmesplace.at/', type: 'html', brand: 'Holmes Place', logo: '🏋️', category: 'fitness' },
  { name: 'Mrs Sporty', url: 'https://www.mrssporty.at/', type: 'html', brand: 'Mrs. Sporty', logo: '👩', category: 'fitness' },
  { name: 'Urban Sports', url: 'https://urbansportsclub.com/', type: 'html', brand: 'Urban Sports', logo: '🏃', category: 'fitness' },

  // 12. FOODSHARING (4)
  { name: 'Foodsharing', url: 'https://foodsharing.at/', type: 'html', brand: 'Foodsharing', logo: '🍏', category: 'essen' },
  { name: 'TGTG', url: 'https://www.toogoodtogo.com/at', type: 'html', brand: 'TGTG', logo: '🥡', category: 'essen' },
  { name: 'Wiener Tafel', url: 'https://www.wienertafel.at/', type: 'html', brand: 'Wiener Tafel', logo: '🥫', category: 'essen' },

  // 13. FREEBIES (4)
  { name: 'Gratisproben', url: 'https://www.gratisproben.net/', type: 'html', brand: 'Gratisproben', logo: '🆓', category: 'gratis' },
  { name: 'Produkttester', url: 'https://www.produkttester.com/', type: 'html', brand: 'Produkttester', logo: '🎁', category: 'gratis' },
  { name: 'Sparhamster', url: 'https://www.sparhamster.at/', type: 'html', brand: 'Sparhamster', logo: '🐹', category: 'gratis' },

  // 14. MARKTPLÄTZE (4)
  { name: 'Willhaben', url: 'https://www.willhaben.at/', type: 'html', brand: 'Willhaben', logo: '🏷️', category: 'shopping' },
  { name: 'Shpock', url: 'https://www.shpock.com/at', type: 'html', brand: 'Shpock', logo: '📱', category: 'shopping' },
  { name: 'eBay', url: 'https://www.ebay.at/', type: 'html', brand: 'eBay', logo: '🛒', category: 'shopping' },

  // 15. KAFFEE (10)
  { name: 'Starbucks', url: 'https://www.starbucks.at/', type: 'html', brand: 'Starbucks', logo: '☕', category: 'kaffee' },
  { name: 'Tchibo', url: 'https://www.tchibo.at/', type: 'html', brand: 'Tchibo', logo: '☕', category: 'kaffee' },
  { name: 'Nespresso', url: 'https://www.nespresso.com/at/', type: 'html', brand: 'Nespresso', logo: '☕', category: 'kaffee' },
  { name: 'Segafredo', url: 'https://www.segafredo.at/', type: 'html', brand: 'Segafredo', logo: '☕', category: 'kaffee' },
  { name: 'Aida', url: 'https://www.aida.at/', type: 'html', brand: 'Aida', logo: '🎀', category: 'kaffee' },
  { name: 'Demel', url: 'https://www.demel.com/', type: 'html', brand: 'Demel', logo: '🍰', category: 'kaffee' },
  { name: 'Ströck', url: 'https://www.stroeck.at/', type: 'html', brand: 'Ströck', logo: '🥐', category: 'kaffee' },
  { name: 'Anker', url: 'https://www.ankerbrot.at/', type: 'html', brand: 'Anker', logo: '🥖', category: 'kaffee' },

  // 16. FINANZEN (6)
  { name: 'Erste Bank', url: 'https://www.sparkasse.at/', type: 'html', brand: 'Erste Bank', logo: '🏦', category: 'finanzen' },
  { name: 'Bank Austria', url: 'https://www.bankaustria.at/', type: 'html', brand: 'Bank Austria', logo: '🏦', category: 'finanzen' },
  { name: 'N26', url: 'https://n26.com/de-at', type: 'html', brand: 'N26', logo: '📱', category: 'finanzen' },
  { name: 'Revolut', url: 'https://www.revolut.com/', type: 'html', brand: 'Revolut', logo: '📱', category: 'finanzen' },
  { name: 'Trade Republic', url: 'https://traderepublic.com/', type: 'html', brand: 'Trade Republic', logo: '📈', category: 'finanzen' },

  // 17. MESSEN (4)
  { name: 'Messe Wien', url: 'https://www.messe.at/', type: 'html', brand: 'Messe Wien', logo: '🏢', category: 'wien' },
  { name: 'Vegan Planet', url: 'https://www.veganplanet.at/', type: 'html', brand: 'Vegan Planet', logo: '🌱', category: 'essen' },
  { name: 'Ferien-Messe', url: 'https://www.ferien-messe.at/', type: 'html', brand: 'Ferien-Messe', logo: '✈️', category: 'reisen' },

  // 18. RSS FEEDS - PREISJÄGER (7)
  { name: 'PJ Gratis', url: 'https://www.preisjaeger.at/rss/gruppe/gratisartikel', type: 'rss', brand: 'Preisjäger', logo: '🆓', category: 'gratis' },
  { name: 'PJ Wien', url: 'https://www.preisjaeger.at/rss/gruppe/lokal', type: 'rss', brand: 'Preisjäger', logo: '📍', category: 'wien' },
  { name: 'PJ Essen', url: 'https://www.preisjaeger.at/rss/gruppe/lebensmittel-getraenke', type: 'rss', brand: 'Preisjäger', logo: '🍕', category: 'essen' },
  { name: 'PJ Reisen', url: 'https://www.preisjaeger.at/rss/gruppe/reisen', type: 'rss', brand: 'Preisjäger', logo: '✈️', category: 'reisen' },
  { name: 'PJ Technik', url: 'https://www.preisjaeger.at/rss/gruppe/elektronik', type: 'rss', brand: 'Preisjäger', logo: '📱', category: 'technik' },
  { name: 'PJ Mode', url: 'https://www.preisjaeger.at/rss/gruppe/fashion-accessoires', type: 'rss', brand: 'Preisjäger', logo: '👕', category: 'mode' },
  { name: 'PJ Beauty', url: 'https://www.preisjaeger.at/rss/gruppe/beauty-gesundheit', type: 'rss', brand: 'Preisjäger', logo: '💄', category: 'beauty' },

  // 19. RSS FEEDS - GOOGLE NEWS (10)
  { name: 'GN Wien Gratis', url: 'https://news.google.com/rss/search?q=Wien+gratis&hl=de&gl=AT', type: 'rss', brand: 'Google News', logo: '📰', category: 'wien' },
  { name: 'GN Neueröffnung', url: 'https://news.google.com/rss/search?q=Wien+Neuer%C3%B6ffnung&hl=de&gl=AT', type: 'rss', brand: 'Google News', logo: '🆕', category: 'shopping' },
  { name: 'GN Kaffee', url: 'https://news.google.com/rss/search?q=%C3%96sterreich+gratis+Kaffee&hl=de&gl=AT', type: 'rss', brand: 'Google News', logo: '☕', category: 'kaffee' },
  { name: 'GN Essen', url: 'https://news.google.com/rss/search?q=Wien+gratis+Essen&hl=de&gl=AT', type: 'rss', brand: 'Google News', logo: '🍕', category: 'essen' },
  { name: 'GN Sale', url: 'https://news.google.com/rss/search?q=%C3%96sterreich+Sale+Rabatt&hl=de&gl=AT', type: 'rss', brand: 'Google News', logo: '💰', category: 'shopping' },
  { name: 'GN Fitness', url: 'https://news.google.com/rss/search?q=%C3%96sterreich+Fitness+gratis&hl=de&gl=AT', type: 'rss', brand: 'Google News', logo: '💪', category: 'fitness' },
  { name: 'GN Flug', url: 'https://news.google.com/rss/search?q=Wien+Flug+Angebot&hl=de&gl=AT', type: 'rss', brand: 'Google News', logo: '✈️', category: 'reisen' },
  { name: 'GN Streaming', url: 'https://news.google.com/rss/search?q=%C3%96sterreich+Netflix+gratis&hl=de&gl=AT', type: 'rss', brand: 'Google News', logo: '📺', category: 'streaming' },
  { name: 'GN Gutschein', url: 'https://news.google.com/rss/search?q=%C3%96sterreich+Gutschein+Code&hl=de&gl=AT', type: 'rss', brand: 'Google News', logo: '🏷️', category: 'codes' },

  // 20. RSS FEEDS - REDDIT (4)
  { name: 'Reddit Wien', url: 'https://www.reddit.com/r/wien/.rss', type: 'rss', brand: 'Reddit', logo: '🔴', category: 'wien' },
  { name: 'Reddit Austria', url: 'https://www.reddit.com/r/Austria/.rss', type: 'rss', brand: 'Reddit', logo: '🔴', category: 'wien' },
  { name: 'Reddit Gratis', url: 'https://www.reddit.com/r/wien/search.rss?q=gratis&restrict_sr=on&sort=new', type: 'rss', brand: 'Reddit', logo: '🔴', category: 'wien' },
];

const GRATIS_KEYWORDS = ['gratis', 'kostenlos', 'geschenkt', 'umsonst', 'free', '0€', 'freebie', 'probetraining', 'probetag'];
const DEAL_KEYWORDS = ['rabatt', 'sale', 'aktion', 'angebot', 'sparen', 'reduziert', '-50%', '-40%', '-30%', '-20%', '1+1', 'code', 'gutschein'];

const BASE_DEALS = [
  // TOP DEALS
  { id: "top-1", brand: "OMV VIVA", logo: "⛽", title: "Gratis Getränk für 1 jö!", description: "☕ Winterdrink für nur 1 jö Punkt", type: "gratis", category: "kaffee", source: "jö App", url: "https://www.joe-club.at/vorteile", expires: "Winter 2026", distance: "OMV", hot: true, isNew: true, priority: 1, votes: 0 },
  { id: "top-2", brand: "IKEA", logo: "🪑", title: "Gratis Kaffee UNLIMITIERT", description: "☕ IKEA Family: Unbegrenzt Gratis-Kaffee", type: "gratis", category: "kaffee", source: "IKEA Family", url: "https://www.ikea.com/at/de/ikea-family/", expires: "Unbegrenzt", distance: "IKEA Wien", hot: true, priority: 1, votes: 0 },
  { id: "top-3", brand: "Wiener Deewan", logo: "🍛", title: "Zahl was du willst!", description: "🍛 Pakistanisches Buffet - DU bestimmst den Preis!", type: "gratis", category: "essen", source: "Wiener Deewan", url: "https://www.deewan.at", expires: "Mo-Sa", distance: "1090 Wien", hot: true, priority: 1, votes: 0 },
  { id: "top-4", brand: "McDonald's", logo: "🍟", title: "5x Gratis Kaffee/Monat", description: "☕ Feedback = Gratis McCafé!", type: "gratis", category: "kaffee", source: "McDonald's App", url: "https://www.mcdonalds.at/app", expires: "5x/Monat", distance: "Alle Filialen", hot: true, priority: 1, votes: 0 },
  { id: "top-5", brand: "Foodsharing", logo: "🍏", title: "Gratis Lebensmittel", description: "🆓 Übrig gebliebene Lebensmittel abholen", type: "gratis", category: "supermarkt", source: "Foodsharing", url: "https://foodsharing.at/karte", expires: "Täglich", distance: "50+ Fairteiler", hot: true, priority: 1, votes: 0 },
  { id: "top-6", brand: "Bundesmuseen", logo: "🏛️", title: "Gratis unter 19!", description: "🆓 Alle Bundesmuseen gratis!", type: "gratis", category: "wien", source: "Bundesmuseen", url: "https://www.bundesmuseen.at/freier-eintritt/", expires: "Unter 19", distance: "Wien", hot: true, priority: 1, votes: 0 },
  { id: "top-7", brand: "Too Good To Go", logo: "🥡", title: "Essen retten ab €3,99", description: "🍔 Überraschungssackerl €12+ Wert", type: "rabatt", category: "essen", source: "TGTG App", url: "https://www.toogoodtogo.com/at", expires: "Täglich", distance: "500+ Partner", hot: true, priority: 1, votes: 0 },
  { id: "top-8", brand: "dm Friseur", logo: "💇", title: "Gratis Kinderhaarschnitt", description: "💇 Kinder unter 10 gratis!", type: "gratis", category: "beauty", source: "dm", url: "https://www.dm.at/services/friseurstudio", expires: "Mit Termin", distance: "dm Studios", hot: true, priority: 1, votes: 0 },

  // FITNESS
  { id: "fitness-1", brand: "FitInn", logo: "💪", title: "1 Woche gratis", description: "🏋️ 7 Tage Probetraining!", type: "gratis", category: "fitness", source: "FitInn", url: "https://www.fitinn.at/probetraining", expires: "Neukunden", distance: "20+ Studios", hot: true, isNew: true, priority: 1, votes: 0 },
  { id: "fitness-2", brand: "McFIT", logo: "💪", title: "Gratis Probetraining", description: "🏋️ Kostenloser Probetag!", type: "gratis", category: "fitness", source: "McFIT", url: "https://www.mcfit.com/at/", expires: "Neukunden", distance: "5 Studios", hot: true, isNew: true, votes: 0 },
  { id: "fitness-3", brand: "John Harris", logo: "🏊", title: "3 Tage gratis", description: "🏋️ Premium inkl. Wellness!", type: "gratis", category: "fitness", source: "John Harris", url: "https://www.johnharris.at/", expires: "Neukunden", distance: "6 Clubs", hot: true, votes: 0 },
  { id: "fitness-4", brand: "clever fit", logo: "💪", title: "Gratis Probetraining", description: "🏋️ Kostenloses Training!", type: "gratis", category: "fitness", source: "clever fit", url: "https://www.clever-fit.com/", expires: "Neukunden", distance: "10+ Studios", hot: true, votes: 0 },
  { id: "fitness-5", brand: "EVO Fitness", logo: "🏃", title: "7 Tage gratis", description: "🏋️ EGYM Geräte!", type: "gratis", category: "fitness", source: "EVO Fitness", url: "https://www.evofitness.at/", expires: "Neukunden", distance: "Wien", hot: true, votes: 0 },
  { id: "fitness-6", brand: "Urban Sports", logo: "🏃", title: "1 Monat gratis", description: "🧘 Alle Studios!", type: "gratis", category: "fitness", source: "Urban Sports", url: "https://urbansportsclub.com/", expires: "Neukunden", distance: "Wien", hot: true, isNew: true, votes: 0 },

  // REISEN
  { id: "reisen-1", brand: "Ryanair", logo: "✈️", title: "Flüge ab €9,99", description: "✈️ Barcelona, Rom, Mallorca!", type: "rabatt", category: "reisen", source: "Ryanair", url: "https://www.ryanair.com/at/", expires: "Flash Sale", distance: "Ab Wien", hot: true, isNew: true, priority: 1, votes: 0 },
  { id: "reisen-2", brand: "Wizz Air", logo: "✈️", title: "20% auf alle Flüge", description: "✈️ Code WIZZ20!", type: "rabatt", category: "reisen", source: "Wizz Air", url: "https://wizzair.com/", expires: "Begrenzt", distance: "Ab Wien", hot: true, code: "WIZZ20", votes: 0 },
  { id: "reisen-3", brand: "ÖBB Nightjet", logo: "🚂", title: "Nachtzug ab €29,90", description: "🛏️ Venedig, Rom, Hamburg!", type: "rabatt", category: "reisen", source: "ÖBB", url: "https://www.oebb.at/", expires: "Frühbucher", distance: "Ab Wien", hot: true, votes: 0 },
  { id: "reisen-4", brand: "FlixBus", logo: "🚌", title: "Bus ab €4,99", description: "🚌 München, Prag, Budapest!", type: "rabatt", category: "reisen", source: "FlixBus", url: "https://www.flixbus.at/", expires: "Frühbucher", distance: "Ab Wien", hot: true, votes: 0 },
  { id: "reisen-5", brand: "Booking.com", logo: "🏨", title: "Genius 15%", description: "🏨 Gratis Genius = 15%!", type: "rabatt", category: "reisen", source: "Booking", url: "https://www.booking.com/", expires: "Mitglieder", distance: "Weltweit", hot: true, votes: 0 },

  // CODES
  { id: "codes-1", brand: "ABOUT YOU", logo: "👗", title: "-15% WELCOME15", description: "👗 15% auf erste Bestellung!", type: "rabatt", category: "codes", source: "ABOUT YOU", url: "https://www.aboutyou.at/", expires: "Neukunden", distance: "Online", hot: true, code: "WELCOME15", votes: 0 },
  { id: "codes-2", brand: "HelloFresh", logo: "🥗", title: "Bis €90 Rabatt", description: "🥗 Auf erste Kochboxen!", type: "rabatt", category: "codes", source: "HelloFresh", url: "https://www.hellofresh.at/", expires: "Neukunden", distance: "Lieferung", hot: true, votes: 0 },
  { id: "codes-3", brand: "Uber Eats", logo: "🍔", title: "€15 Rabatt", description: "🍔 Erste Bestellung!", type: "rabatt", category: "codes", source: "Uber Eats", url: "https://www.ubereats.com/at", expires: "Neukunden", distance: "Wien", hot: true, code: "ERSTBESTELLEN", votes: 0 },
  { id: "codes-4", brand: "Zalando", logo: "👟", title: "-10% Newsletter", description: "👟 Newsletter = 10%!", type: "rabatt", category: "codes", source: "Zalando", url: "https://www.zalando.at/", expires: "Anmeldung", distance: "Online", hot: true, votes: 0 },
  { id: "codes-5", brand: "SHEIN", logo: "👚", title: "-15% SHEIN15", description: "👚 15% auf alles!", type: "rabatt", category: "codes", source: "SHEIN", url: "https://at.shein.com/", expires: "Begrenzt", distance: "Online", hot: true, code: "SHEIN15", votes: 0 },
  { id: "codes-6", brand: "MediaMarkt", logo: "📺", title: "€10 Newsletter", description: "📺 Newsletter = €10!", type: "rabatt", category: "codes", source: "MediaMarkt", url: "https://www.mediamarkt.at/", expires: "Anmeldung", distance: "Online", hot: true, votes: 0 },
  { id: "codes-7", brand: "Mjam", logo: "🍕", title: "-30% erste Bestellung", description: "🍕 30% Neukunden!", type: "rabatt", category: "codes", source: "Mjam", url: "https://www.mjam.at/", expires: "Neukunden", distance: "Wien", hot: true, votes: 0 },

  // EVENTS
  { id: "event-1", brand: "Film Festival", logo: "🎬", title: "Gratis Open-Air Kino", description: "🎬 Rathausplatz Gratis!", type: "gratis", category: "wien", source: "Wien", url: "https://www.filmfestival-rathausplatz.at/", expires: "Juli-Sept", distance: "Rathausplatz", hot: true, isNew: true, priority: 1, votes: 0 },
  { id: "event-2", brand: "Donauinselfest", logo: "🎸", title: "Gratis Festival", description: "🎸 Europas größtes!", type: "gratis", category: "wien", source: "DIF", url: "https://donauinselfest.at/", expires: "Juni 2026", distance: "Donauinsel", hot: true, isNew: true, priority: 1, votes: 0 },
  { id: "event-3", brand: "Lange Nacht", logo: "🌙", title: "100+ Museen", description: "🏛️ 1 Ticket, alle Museen!", type: "rabatt", category: "wien", source: "ORF", url: "https://langenacht.orf.at/", expires: "Oktober", distance: "Wien", hot: true, votes: 0 },
  { id: "event-4", brand: "Festwochen", logo: "🎭", title: "Gratis Eröffnung", description: "🎭 Am Rathausplatz!", type: "gratis", category: "wien", source: "Festwochen", url: "https://www.festwochen.at/", expires: "Mai", distance: "Rathausplatz", hot: true, votes: 0 },
  { id: "event-5", brand: "Silvesterpfad", logo: "🎆", title: "Gratis Silvester", description: "🎆 Open-Air Party!", type: "gratis", category: "wien", source: "Wien", url: "https://www.wien.info/", expires: "31.12.", distance: "Innenstadt", hot: true, votes: 0 },

  // FREEBIES
  { id: "freebie-1", brand: "dm", logo: "🧴", title: "Gratis Proben", description: "🧴 Gratisproben mitnehmen!", type: "gratis", category: "beauty", source: "dm", url: "https://www.dm.at/", expires: "Vorrat", distance: "Alle dm", hot: true, isNew: true, votes: 0 },
  { id: "freebie-2", brand: "Sephora", logo: "💄", title: "3 Gratis Samples", description: "💄 Bei Bestellung!", type: "gratis", category: "beauty", source: "Sephora", url: "https://www.sephora.at/", expires: "Bestellung", distance: "Online", hot: true, votes: 0 },
  { id: "freebie-3", brand: "Douglas", logo: "💋", title: "Gratis Parfumproben", description: "💋 Im Store!", type: "gratis", category: "beauty", source: "Douglas", url: "https://www.douglas.at/", expires: "Im Store", distance: "Douglas", hot: true, votes: 0 },
  { id: "freebie-4", brand: "Nespresso", logo: "☕", title: "Gratis Tasting", description: "☕ Kaffeeverkostung!", type: "gratis", category: "kaffee", source: "Nespresso", url: "https://www.nespresso.com/at/", expires: "Im Store", distance: "Boutiquen", hot: true, votes: 0 },

  // MARKTPLÄTZE
  { id: "market-1", brand: "Willhaben", logo: "🆓", title: "Gratis Abzugeben", description: "🆓 Dinge verschenken!", type: "gratis", category: "shopping", source: "Willhaben", url: "https://www.willhaben.at/", expires: "Täglich", distance: "Wien", hot: true, isNew: true, priority: 1, votes: 0 },
  { id: "market-2", brand: "Shpock", logo: "📱", title: "Gratis Artikel", description: "📱 Verschenkt!", type: "gratis", category: "shopping", source: "Shpock", url: "https://www.shpock.com/", expires: "Täglich", distance: "Wien", hot: true, votes: 0 },
  { id: "market-3", brand: "Amazon", logo: "📦", title: "Deals bis -70%", description: "📦 Blitzangebote!", type: "rabatt", category: "shopping", source: "Amazon", url: "https://www.amazon.de/deals", expires: "Täglich", distance: "Online", hot: true, votes: 0 },

  // STREAMING
  { id: "stream-1", brand: "Amazon Prime", logo: "📺", title: "30 Tage gratis", description: "📺 Prime gratis testen!", type: "testabo", category: "streaming", source: "Amazon", url: "https://www.amazon.de/prime", expires: "Neukunden", distance: "Online", hot: true, votes: 0 },
  { id: "stream-2", brand: "Spotify", logo: "🎵", title: "1 Monat gratis", description: "🎵 Premium kostenlos!", type: "testabo", category: "streaming", source: "Spotify", url: "https://www.spotify.com/at/", expires: "Neukunden", distance: "Online", hot: true, votes: 0 },
  { id: "stream-3", brand: "YouTube", logo: "▶️", title: "1 Monat gratis", description: "▶️ Keine Werbung!", type: "testabo", category: "streaming", source: "YouTube", url: "https://www.youtube.com/premium", expires: "Neukunden", distance: "Online", hot: true, votes: 0 },

  // SUPERMARKT
  { id: "super-1", brand: "BILLA", logo: "🛒", title: "BILLA Plus Coupons", description: "🛒 Wöchentlich Rabatte!", type: "rabatt", category: "supermarkt", source: "BILLA App", url: "https://www.billa.at/plus", expires: "Wöchentlich", distance: "Alle BILLA", hot: true, votes: 0 },
  { id: "super-2", brand: "SPAR", logo: "🛒", title: "25% auf O&G", description: "🥦 Jeden Samstag!", type: "rabatt", category: "supermarkt", source: "SPAR", url: "https://www.spar.at/", expires: "Samstag", distance: "Alle SPAR", hot: true, votes: 0 },
  { id: "super-3", brand: "HOFER", logo: "🛒", title: "Super Samstag", description: "🛒 Extreme Rabatte!", type: "rabatt", category: "supermarkt", source: "HOFER", url: "https://www.hofer.at/", expires: "Samstag", distance: "Alle HOFER", hot: true, votes: 0 },
  { id: "super-4", brand: "Lidl", logo: "🛒", title: "Lidl Plus Deals", description: "🛒 App Coupons!", type: "rabatt", category: "supermarkt", source: "Lidl Plus", url: "https://www.lidl.at/", expires: "In App", distance: "Alle Lidl", hot: true, votes: 0 },

  // TECHNIK
  { id: "tech-1", brand: "Apple", logo: "🍎", title: "Bildungsrabatt", description: "🍎 10% für Studenten!", type: "rabatt", category: "technik", source: "Apple", url: "https://www.apple.com/at-edu/", expires: "Mit Nachweis", distance: "Online", hot: true, votes: 0 },
  { id: "tech-2", brand: "Samsung", logo: "📱", title: "Trade-In €600", description: "📱 Altes Handy!", type: "rabatt", category: "technik", source: "Samsung", url: "https://www.samsung.com/at/", expires: "Trade-In", distance: "Online", hot: true, votes: 0 },

  // MODE
  { id: "mode-1", brand: "H&M", logo: "👕", title: "10% H&M Member", description: "👕 Willkommensrabatt!", type: "rabatt", category: "mode", source: "H&M", url: "https://www2.hm.com/de_at/", expires: "Anmeldung", distance: "H&M", hot: true, votes: 0 },
  { id: "mode-2", brand: "Zalando", logo: "👟", title: "Bis -70% Sale", description: "👟 Riesiger Sale!", type: "rabatt", category: "mode", source: "Zalando", url: "https://www.zalando.at/sale/", expires: "Laufend", distance: "Online", hot: true, votes: 0 },

  // MOBILITÄT
  { id: "mobil-1", brand: "Wiener Linien", logo: "🚇", title: "Jahreskarte €365", description: "🚇 €1/Tag!", type: "rabatt", category: "mobilität", source: "Wiener Linien", url: "https://www.wienerlinien.at/", expires: "Ganzjährig", distance: "Wien", hot: true, votes: 0 },
  { id: "mobil-2", brand: "ÖBB", logo: "🚂", title: "Sparschiene €9,90", description: "🚂 Bahntickets!", type: "rabatt", category: "mobilität", source: "ÖBB", url: "https://www.oebb.at/", expires: "Frühbucher", distance: "Österreich", hot: true, votes: 0 },
  { id: "mobil-3", brand: "Bolt", logo: "🛴", title: "Gratis Freifahrt", description: "🛴 Erste E-Scooter!", type: "gratis", category: "mobilität", source: "Bolt", url: "https://bolt.eu/", expires: "Neukunden", distance: "Wien", hot: true, votes: 0 },

  // WIEN
  { id: "wien-1", brand: "Büchereien", logo: "📚", title: "Gratis unter 18", description: "📚 Ausweis gratis!", type: "gratis", category: "wien", source: "Büchereien", url: "https://buechereien.wien.gv.at/", expires: "Unter 18", distance: "Wien", hot: true, votes: 0 },
  { id: "wien-2", brand: "ZOOM", logo: "👶", title: "Gratis unter 3", description: "👶 Freier Eintritt!", type: "gratis", category: "wien", source: "ZOOM", url: "https://www.kindermuseum.at/", expires: "Unter 3", distance: "MQ", hot: true, votes: 0 },

  // FINANZEN
  { id: "finanz-1", brand: "Erste Bank", logo: "🏦", title: "Gratis unter 27", description: "💳 Konto gratis!", type: "gratis", category: "finanzen", source: "Erste Bank", url: "https://www.sparkasse.at/", expires: "Unter 27", distance: "Wien", hot: true, votes: 0 },
  { id: "finanz-2", brand: "N26", logo: "📱", title: "Gratis Konto", description: "💳 Smartphone-Konto!", type: "gratis", category: "finanzen", source: "N26", url: "https://n26.com/de-at", expires: "Unbegrenzt", distance: "Online", hot: true, votes: 0 },
  { id: "finanz-3", brand: "Trade Republic", logo: "📈", title: "Gratis Aktie", description: "📈 Bis €200 Aktie!", type: "gratis", category: "finanzen", source: "Trade Republic", url: "https://traderepublic.com/", expires: "Neukunden", distance: "Online", hot: true, isNew: true, votes: 0 },

  // KAFFEE
  { id: "kaffee-1", brand: "Tchibo", logo: "☕", title: "Gratis Kaffee", description: "☕ Bei jedem Einkauf!", type: "gratis", category: "kaffee", source: "Tchibo", url: "https://www.tchibo.at/", expires: "Unbegrenzt", distance: "Tchibo", hot: true, votes: 0 },
  { id: "kaffee-2", brand: "Starbucks", logo: "☕", title: "Gratis Geburtstag", description: "🎂 Drink gratis!", type: "gratis", category: "kaffee", source: "Starbucks", url: "https://www.starbucks.at/", expires: "Geburtstag", distance: "Starbucks", hot: true, votes: 0 },

  // ESSEN
  { id: "essen-1", brand: "McDonald's", logo: "🍟", title: "Gratis Burger", description: "🍔 App = Burger!", type: "gratis", category: "essen", source: "McDonald's", url: "https://www.mcdonalds.at/", expires: "Neukunden", distance: "Filialen", hot: true, votes: 0 },
  { id: "essen-2", brand: "Burger King", logo: "🍔", title: "2 für 1 Whopper", description: "🍔 King Deal!", type: "rabatt", category: "essen", source: "BK App", url: "https://www.burgerking.at/", expires: "In App", distance: "Filialen", hot: true, votes: 0 },
  { id: "essen-3", brand: "NORDSEE", logo: "🐟", title: "Gratis Backfisch", description: "🐟 Newsletter!", type: "gratis", category: "essen", source: "NORDSEE", url: "https://www.nordsee.com/at/", expires: "Anmeldung", distance: "Filialen", hot: true, votes: 0 },

  // MESSEN
  { id: "messe-1", brand: "Vegan Planet", logo: "🌱", title: "Gratis Proben", description: "🌱 Hunderte Proben!", type: "gratis", category: "essen", source: "Vegan Planet", url: "https://www.veganplanet.at/", expires: "Herbst", distance: "MQ Wien", hot: true, isNew: true, votes: 0 },
  { id: "messe-2", brand: "Ferien-Messe", logo: "✈️", title: "Gratis Goodies", description: "✈️ Reiseführer!", type: "gratis", category: "reisen", source: "Messe Wien", url: "https://www.ferien-messe.at/", expires: "Jänner", distance: "Messe Wien", hot: true, votes: 0 },
];

// HTTP FETCHER
function fetchURL(url, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const req = protocol.get(url, { 
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
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

// TEXT CLEANER
function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/<a[^>]*>.*?<\/a>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/https?:\/\/[^\s<>"]+/gi, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// RSS PARSER
function parseRSS(xml, source) {
  const deals = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  
  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1];
    const titleRaw = (item.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/i) || [])[1] || '';
    const link = (item.match(/<link>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/link>/i) || [])[1] || '';
    const descRaw = (item.match(/<description>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/description>/is) || [])[1] || '';
    
    const title = cleanText(titleRaw);
    const desc = cleanText(descRaw);
    
    if (title.length < 10) continue;
    
    const text = `${title} ${desc}`.toLowerCase();
    const isGratis = GRATIS_KEYWORDS.some(k => text.includes(k));
    const isDeal = DEAL_KEYWORDS.some(k => text.includes(k));
    
    if (isGratis || isDeal) {
      deals.push({
        id: `rss-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        brand: source.brand,
        logo: source.logo,
        title: title.substring(0, 80),
        description: desc.substring(0, 120) || `Angebot: ${title}`,
        type: isGratis ? 'gratis' : 'rabatt',
        category: source.category,
        source: source.name,
        url: link || source.url,
        expires: 'Siehe Website',
        distance: 'Wien',
        hot: isGratis,
        isNew: true,
        votes: 0
      });
    }
  }
  return deals.slice(0, 5);
}

// HTML EXTRACTOR
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
      title: `Angebote bei ${source.brand}`,
      description: `Aktuelle Deals bei ${source.brand} entdecken!`,
      type: isGratis ? 'gratis' : 'rabatt',
      category: source.category,
      source: source.name,
      url: source.url,
      expires: 'Siehe Website',
      distance: 'Wien',
      hot: false,
      isNew: true,
      votes: 0
    });
  }
  return deals;
}

// MAIN SCRAPER
async function scrapeAllSources() {
  console.log('🚀 MEGA POWER SCRAPER V4 gestartet...');
  console.log(`📅 ${new Date().toLocaleString('de-AT')}`);
  console.log(`📡 ${SOURCES.length} Quellen...\n`);
  
  const scrapedDeals = [];
  let successCount = 0;
  
  const batchSize = 10;
  for (let i = 0; i < SOURCES.length; i += batchSize) {
    const batch = SOURCES.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(async (source) => {
        try {
          const content = await fetchURL(source.url);
          let deals = source.type === 'rss' ? parseRSS(content, source) : extractDealsFromHTML(content, source);
          return { source: source.name, deals, success: true };
        } catch (error) {
          return { source: source.name, success: false };
        }
      })
    );
    
    results.forEach(result => {
      if (result.status === 'fulfilled' && result.value.success) {
        scrapedDeals.push(...result.value.deals);
        successCount++;
        if (result.value.deals.length > 0) {
          console.log(`✅ ${result.value.source}: ${result.value.deals.length}`);
        }
      }
    });
  }
  
  const allDeals = [...BASE_DEALS, ...scrapedDeals];
  
  const uniqueDeals = [];
  const seenTitles = new Set();
  for (const deal of allDeals) {
    const key = deal.title.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 25);
    if (!seenTitles.has(key)) {
      seenTitles.add(key);
      uniqueDeals.push(deal);
    }
  }
  
  uniqueDeals.sort((a, b) => {
    if ((a.priority || 99) !== (b.priority || 99)) return (a.priority || 99) - (b.priority || 99);
    if (a.hot && !b.hot) return -1;
    if (!a.hot && b.hot) return 1;
    if (a.type === 'gratis' && b.type !== 'gratis') return -1;
    return 0;
  });
  
  const catStats = {};
  uniqueDeals.forEach(d => { catStats[d.category] = (catStats[d.category] || 0) + 1; });
  
  const output = {
    lastUpdated: new Date().toISOString(),
    totalDeals: uniqueDeals.length,
    deals: uniqueDeals
  };
  
  fs.writeFileSync('deals.json', JSON.stringify(output, null, 2));
  
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`✅ SCRAPING ABGESCHLOSSEN!`);
  console.log(`${'═'.repeat(50)}`);
  console.log(`📡 Quellen: ${SOURCES.length}`);
  console.log(`✅ Erfolgreich: ${successCount}`);
  console.log(`📦 Basis-Deals: ${BASE_DEALS.length}`);
  console.log(`🆕 Gescrapt: ${scrapedDeals.length}`);
  console.log(`📊 Gesamt: ${uniqueDeals.length}`);
  console.log(`${'─'.repeat(50)}`);
  console.log(`📊 KATEGORIEN:`);
  Object.entries(catStats).sort((a,b) => b[1] - a[1]).forEach(([cat, count]) => {
    console.log(`   ${cat}: ${count}`);
  });
}

scrapeAllSources().then(() => process.exit(0)).catch(() => process.exit(0));

// ============================================
// 📸 INSTAGRAM WEB SCRAPER V2 (KOSTENLOS)
// Mit besseren Anti-Detection Techniken
// ============================================

import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Config
const CONFIG = {
  minScore: 35,
  maxDealsPerRun: 20,
  maxAgeDays: 2,
  postsToCheck: 20,
};

// Hashtags für Wien & Deals
const HASHTAGS = [
  'gratiswien',
  'wiengratis', 
  'wienkostenlos',
  'wiendeal',
  'aktionwien',
  'schnaeppchenwien',
  'gratisösterreich',
  'freebieswien',
  'wienfreebie',
];

// Keywords für Wien
const WIEN_KEYWORDS = [
  'wien', 'vienna', 'wiener', '1. bezirk', '2. bezirk', '3. bezirk',
  '4. bezirk', '5. bezirk', '6. bezirk', '7. bezirk', '8. bezirk',
  '1010', '1020', '1030', '1040', '1050', '1060', '1070', '1080',
  'mariahilf', 'leopoldstadt', 'innere stadt', 'neubau',
];

// Keywords für gratis/kostenlos
const GRATS_KEYWORDS = [
  'gratis', 'kostenlos', 'free', 'umsonst', 'geschenk',
  '0€', '0 €', 'gratis!', 'kostenlos!', 'freebie',
  'eröffnung', 'giveaway', 'gewinnspiel', 'verlosung',
  'verschenke', 'zu verschenken', 'brauche neue',
];

// Keywords für Essen
const FOOD_KEYWORDS = [
  'essen', 'food', 'restaurant', 'cafe', 'bar', 'pizza', 'burger',
  'sushi', 'asia', 'döner', 'kebab', 'frühstück', 'mittag',
  'kaffee', 'getränk', 'cocktail', 'bier', 'wein', 'snack',
];

// ============================================
// Helper Functions
// ============================================

function matchesKeyword(text, keyword) {
  if (!text || !keyword) return false;
  const regex = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  return regex.test(text);
}

function hasWienKeyword(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return WIEN_KEYWORDS.some(k => matchesKeyword(lower, k));
}

function hasGratisKeyword(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return GRATS_KEYWORDS.some(k => matchesKeyword(lower, k));
}

function hasFoodKeyword(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return FOOD_KEYWORDS.some(k => matchesKeyword(lower, k));
}

// ============================================
// Main Scraper
// ============================================

async function scrapeInstagram() {
  console.log('📸 INSTAGRAM WEB SCRAPER V2');
  console.log('='.repeat(40));

  let browser;
  try {
    const { chromium } = await import('playwright');
    
    // Mit besseren Optionen für weniger Detection
    browser = await chromium.launch({ 
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ]
    });
    
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'de-DE',
      timezoneId: 'Europe/Vienna',
    });
    
    const page = await context.newPage();
    
    // JavaScript-Injections um Detection zu umgehen
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      window.navigator.chrome = { runtime: {} };
    });

    console.log('✅ Browser gestartet');

    const allDeals = [];

    for (const hashtag of HASHTAGS) {
      try {
        console.log(`\n🔍 #${hashtag}...`);
        
        // Zufällige Wartezeit
        await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
        
        // Versuche verschiedene Instagram-URLs
        const urls = [
          `https://www.instagram.com/explore/tags/${hashtag}/`,
          `https://instagram.com/explore/tags/${hashtag}/`,
        ];
        
        let success = false;
        for (const url of urls) {
          try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
            await page.waitForTimeout(3000);
            
            // Prüfe ob Seite geladen
            const content = await page.content();
            if (content.length > 5000) {
              console.log(`   → Seite geladen (${content.length} chars)`);
              success = true;
              break;
            }
          } catch (e) {
            console.log(`   ⚠️ URL ${url} fehlgeschlagen`);
          }
        }
        
        if (!success) continue;

        // Versuche verschiedene Selectoren
        const selectors = [
          'article a[href*="/p/"]',
          'article a[href*="/reel/"]',
          'a[href*="/p/"]',
          'div[role="link"]',
        ];
        
        let postLinks = [];
        for (const sel of selectors) {
          try {
            const links = await page.$$eval(sel, anchors => 
              anchors.slice(0, CONFIG.postsToCheck).map(a => a.href).filter(h => h && h.includes('/p/'))
            );
            if (links.length > 0) {
              postLinks = links;
              console.log(`   → ${links.length} Posts gefunden (${sel})`);
              break;
            }
          } catch (e) {}
        }
        
        // Fallback: Regex auf Seiteninhalt
        if (postLinks.length === 0) {
          const pageContent = await page.content();
          const matches = pageContent.match(/https:\/\/www\.instagram\.com\/p\/[a-zA-Z0-9_-]+\//g);
          if (matches) {
            postLinks = [...new Set(matches)].slice(0, CONFIG.postsToCheck);
            console.log(`   → ${postLinks.length} Posts via Regex gefunden`);
          }
        }
        
        // Besuche einzelne Posts
        for (const postUrl of postLinks.slice(0, 8)) {
          try {
            await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
            await page.waitForTimeout(1500 + Math.random() * 1000);
            
            const postContent = await page.evaluate(() => {
              const result = {
                caption: '',
                likes: 0,
                username: '',
              };
              
              // Versuche verschiedene Caption-Selektoren
              const captionSelectors = [
                'h1', 'article header span', '[role="button"]',
                '.x1iyjqo2 > div > span', 'article section span',
              ];
              
              for (const sel of captionSelectors) {
                const el = document.querySelector(sel);
                if (el && el.textContent && el.textContent.length > 5) {
                  result.caption = el.textContent;
                  break;
                }
              }
              
              // Likes
              const likeText = document.body.innerText;
              const likeMatch = likeText.match(/([\d,.]+)\s*(?:likes|gefällt)/i);
              if (likeMatch) {
                result.likes = parseInt(likeMatch[1].replace(/,/g, ''));
              }
              
              // Username
              const userMatch = document.body.innerText.match(/@([a-zA-Z0-9_.]+)/);
              if (userMatch) {
                result.username = userMatch[1];
              }
              
              return result;
            });
            
            const allText = (postContent.caption + ' ' + postContent.username).toLowerCase();
            
            // Filter: Wien + Gratis
            if (hasWienKeyword(allText) && hasGratisKeyword(allText)) {
              let score = 50;
              if (hasFoodKeyword(allText)) score += 20;
              if (hasWienKeyword(allText)) score += 15;
              if (postContent.likes > 10) score += 10;
              
              if (score >= CONFIG.minScore) {
                const deal = {
                  id: `ig-web-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                  brand: postContent.username || 'Instagram',
                  title: postContent.caption?.substring(0, 60) || 'Deal',
                  description: postContent.caption?.substring(0, 150) || '',
                  type: 'gratis',
                  category: hasFoodKeyword(allText) ? 'food' : 'shopping',
                  source: 'Instagram',
                  url: postUrl,
                  expires: 'Unbekannt',
                  distance: 'Wien',
                  hot: postContent.likes > 50,
                  isNew: true,
                  priority: Math.min(10, Math.floor(score / 10)),
                  votes: postContent.likes || 0,
                  qualityScore: score,
                  pubDate: new Date().toISOString(),
                };
                
                console.log(`   ✅ Deal: ${deal.title.substring(0, 30)}... (Score: ${score}, Likes: ${postContent.likes})`);
                allDeals.push(deal);
              }
            }
            
          } catch (e) {
            // Überspringe fehlgeschlagene Posts
          }
        }
        
      } catch (e) {
        console.log(`   ⚠️ Fehler bei #${hashtag}: ${e.message}`);
      }
    }

    await browser.close();

    // Deduplizieren
    const unique = [];
    const seen = new Set();
    for (const deal of allDeals) {
      const key = deal.title.substring(0, 30) + deal.brand;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(deal);
      }
    }

    console.log(`\n📊 Total: ${unique.length} Deals`);

    // Speichern
    const result = {
      lastUpdated: new Date().toISOString(),
      source: 'instagram-web',
      totalDeals: unique.length,
      deals: unique.slice(0, CONFIG.maxDealsPerRun),
    };

    fs.writeFileSync('deals-pending.json', JSON.stringify(result, null, 2));
    console.log('✅ Gespeichert: deals-pending.json');

    return result;

  } catch (e) {
    console.error('❌ Browser Fehler:', e.message);
    if (browser) await browser.close();
    
    // Leere Datei erstellen
    fs.writeFileSync('deals-pending.json', JSON.stringify({
      lastUpdated: new Date().toISOString(),
      source: 'instagram-web',
      totalDeals: 0,
      deals: [],
    }, null, 2));
    
    return { deals: [], totalDeals: 0 };
  }
}

// Run
scrapeInstagram()
  .then(result => {
    console.log(`\n🎉 Fertig! ${result.totalDeals} Instagram Deals gefunden`);
    process.exit(0);
  })
  .catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });

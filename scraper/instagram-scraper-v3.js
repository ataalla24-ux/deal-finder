// ============================================
// 💯 COMPLETLY NEW VIENNA INSTAGRAM DEAL SCRAPER
// Focus: Only REAL free deals in Vienna
// ============================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const APIFY_API_TOKEN = process.env.APIFY_API_TOKEN || '';

if (!APIFY_API_TOKEN) {
  console.log('⚠️  APIFY_API_TOKEN nicht gesetzt - Instagram Scraper übersprungen');
  process.exit(0);
}

// ============================================
// Simple Apify API calls (without SDK)
// ============================================

async function callApifyActor(actorId, input) {
  try {
    // Start the actor
    const startRes = await fetch(`https://api.apify.com/v2/acts/${actorId}/runs?token=${APIFY_API_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, waitForFinish: 120 })
    });
    
    if (!startRes.ok) {
      console.log(`    → API Error: ${startRes.status}`);
      return [];
    }
    
    const startData = await startRes.json();
    
    if (!startData.data) {
      console.log(`    → No data returned`);
      return [];
    }
    
    const runId = startData.data.id;
    console.log(`    → Run started: ${runId}`);
    
    // Wait for completion
    let status = 'RUNNING';
    while (status === 'RUNNING' || status === 'READY') {
      await new Promise(r => setTimeout(r, 5000));
      const statusRes = await fetch(`https://api.apify.com/v2/acts/${actorId}/runs/${runId}?token=${APIFY_API_TOKEN}`);
      const statusData = await statusRes.json();
      status = statusData.data?.status || 'FAILED';
      console.log(`    → Status: ${status}`);
    }
    
    // Get results
    const datasetId = startData.data.defaultDatasetId;
    const resultsRes = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_API_TOKEN}&limit=500`);
    const items = await resultsRes.json();
    
    return items || [];
  } catch (e) {
    console.log(`    → Exception: ${e.message}`);
    return [];
  }
}

// ============================================
const CONFIG = {
  minScore: 40,
  maxDealsPerRun: 15,
  maxAgeDays: 5,
  postsPerHashtag: 25,
  postsPerAccount: 20,
};

// ============================================
// 🔥 STRATEGY 1: Vienna-Specific Hashtags ONLY
// These have Wien + Deal context together
// ============================================
const HASHTAGS = [
  // Wien-Specific (BEST)
  'gratiswien',              // ✅ Direkt Wien + Gratis
  'wiengratis',              // ✅ 
  'wienkostenlos',           // ✅
  'wiendeal',                // ✅
  'aktionwien',              // ✅ Wien + Aktion
  'schnäppchenwien',        // ✅
  
  // Food Wien
  'foodwien',                // ✅
  'wienfood',                // ✅
  'wienesse',                // ✅
  'wienfoodie',              // ✅
  
  // Generic Wien (with location check)
  'wien',
  'vienna',
  
  // Eröffnung (new openings often have free stuff)
  'neueröffnungwien',
  'eröffnungwien',
];

// ============================================
// 🔥 STRATEGY 2: Vienna Food/Deal Accounts
// These accounts post about Vienna deals
// ============================================
const ACCOUNTS = [
  'foodiewien',
  'wienfood',
  'wienisst',
  'wienerfood',
  'gratiswien',
  'wiendeals',
  'viennadeals',
  'wien.gutscheine',
  'wienrabatt',
];

// ============================================
// 🔥 STRATEGY 3: Strict Vienna Detection
// Must have EXPLICIT Vienna reference
// ============================================
const WIEN_KEYWORDS = [
  // City name
  'wien', 'vienna', 'wiener', 'viennese',
  // Bezirke (Districts)
  '1. bezirk', '2. bezirk', '3. bezirk', '4. bezirk', '5. bezirk',
  '6. bezirk', '7. bezirk', '8. bezirk', '9. bezirk', '10. bezirk',
  '11. bezirk', '12. bezirk', '13. bezirk', '14. bezirk', '15. bezirk',
  '16. bezirk', '17. bezirk', '18. bezirk', '19. bezirk', '20. bezirk',
  '21. bezirk', '22. bezirk', '23. bezirk',
  // PLZ (Postal codes)
  '1010 wien', '1020 wien', '1030 wien', '1040 wien', '1050 wien',
  '1060 wien', '1070 wien', '1080 wien', '1090 wien', '1100 wien',
  '1110 wien', '1120 wien', '1130 wien', '1140 wien', '1150 wien',
  '1160 wien', '1170 wien', '1180 wien', '1190 wien', '1200 wien',
  '1210 wien', '1220 wien', '1230 wien',
  // Short PLZ
  '1010', '1020', '1030', '1040', '1050', '1060', '1070', '1080', '1090', '1100',
  '1110', '1120', '1130', '1140', '1150', '1160', '1170', '1180', '1190', '1200',
  '1210', '1220', '1230',
  // Famous places
  'innere stadt', 'leopoldstadt', 'landstraße', 'wieden', 'margareten',
  'mariahilf', 'neubau', 'josefstadt', 'alsergrund', 'favoriten',
  'simmering', 'meidling', 'hietzing', 'penzing', 'ottakring',
  ' Hernals', 'währing', 'döbling', 'brigittenau', 'floridsdorf',
  'donaustadt', 'liesing',
];

// ============================================
// 🔥 STRATEGY 4: ONLY True Free Keywords
// Must have EXPLICIT free/deal context
// ============================================
const GRATiS_KEYWORDS = [
  // German
  'gratis', 'kostenlos', 'umsonst', 'frei', 'geschenk',
  '0€', '0 €', '0euro', 'null euro',
  'freier eintritt', 'eintritt frei',
  'gratisprobe', 'produkttest', 'testpaket',
  // English
  'free', 'freebie', 'free stuff', 'free sample', 'on the house',
];

// ============================================
// 🔥 STRATEGY 5: Food Keywords
// ============================================
const FOOD_KEYWORDS = [
  'kebab', 'döner', 'doner', 'pizza', 'burger', 'burrito', 'taco',
  'kaffee', 'coffee', 'cappuccino', 'latte', 'espresso',
  'eis', 'gelato', 'ice cream',
  'sushi', 'ramen', 'nudel', 'pasta', 'asian',
  'döner', 'shawarma', 'falafel', 'wrap',
  'salat', 'bowl', 'smoothie', 'juice',
  'bier', 'cocktail', 'wein', 'spritz',
  'frühstück', 'breakfast', 'brunch',
  'mittagessen', 'abendessen', 'dinner', 'lunch',
];

// ============================================
// 🔥 STRATEGY 6: REJECT Keywords (Gewinnspiele, Werbung)
// ============================================
const REJECT_KEYWORDS = [
  // Gewinnspiele (giveaways - NOT free!)
  'gewinnspiel', 'verlosung', 'giveaway', 'zu gewinnen', 'zu gewinnen',
  'verlosen', 'wir verlosen', 'teilnahmebedingungen', 'gewinnchance',
  'tag 3', 'tag 2', 'tag einen', 'markiere', 'markier',
  // Werbung / Sponsored
  'werbung', 'anzeige', 'sponsored', 'kooperation', 'gifted',
  'advertisement', 'ad', 'bezahlt', 'partnership',
  // Fake Free (mit Kauf)
  'gratis bei kauf', 'gratis dazu', 'gratis zu jedem', 'kostenlos bei',
  'gratis mit', 'gratis wenn', 'kostenlos nur für',
  // Other spam
  'follow for follow', 'f4f', 'like for like', 'l4l',
];

// ============================================
// Trusted Accounts (always allow)
// ============================================
const TRUSTED_ACCOUNTS = new Set([
  'foodiewien', 'wienfood', 'wienisst', 'wienerfood',
  'gratiswien', 'wiendeals', 'viennadeals',
  'wien.gutscheine', 'wienrabatt',
  'wienmuseum', 'kunsthistorisches', 'naturalhistoryvienna',
]);

// ============================================
// Helper Functions
// ============================================

function matchesKeyword(text, keyword) {
  if (!text || !keyword) return false;
  const regex = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  return regex.test(text);
}

function hasExplicitWienLocation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return WIEN_KEYWORDS.some(k => matchesKeyword(lower, k));
}

function hasGratisKeyword(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return GRATiS_KEYWORDS.some(k => matchesKeyword(lower, k));
}

function hasFoodKeyword(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return FOOD_KEYWORDS.some(k => matchesKeyword(lower, k));
}

function shouldReject(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return REJECT_KEYWORDS.some(k => matchesKeyword(lower, k));
}

// ============================================
// Main Scraper
// ============================================

async function main() {
  console.log('💯 NEW VIENNA INSTAGRAM DEAL SCRAPER v3');
  console.log('='.repeat(50));
  
  const allPosts = [];
  
  // ========================================
  // PHASE 1: Scrape from Hashtags
  // ========================================
  console.log('\n📍 Phase 1: Scrape from Vienna Hashtags...');
  
  for (const hashtag of HASHTAGS) {
    try {
      console.log(`  #${hashtag}...`);
      
      // Hashtag scraper
      const input = {
        hashtags: [hashtag],
        resultsPerHashtag: CONFIG.postsPerHashtag,
        searchType: 'posts',
      };
      
      const posts = await callApifyActor('apify~instagram-hashtag-scraper', input);
      
      if (posts && posts.length > 0) {
        console.log(`    → ${posts.length} posts`);
        allPosts.push(...posts);
      }
      
    } catch (e) {
      console.log(`    → Error: ${e.message}`);
    }
  }
  
  // ========================================
  // PHASE 2: Scrape from Accounts
  // ========================================
  console.log('\n📍 Phase 2: Scrape from Vienna Accounts...');
  
  for (const account of ACCOUNTS) {
    try {
      console.log(`  @${account}...`);
      
      // Account scraper
      const input = {
        usernames: [account],
        resultsPerAccount: CONFIG.postsPerAccount,
        searchType: 'posts',
      };
      
      const posts = await callApifyActor('apify~instagram-post-scraper', input);
      
      if (posts && posts.length > 0) {
        console.log(`    → ${posts.length} posts`);
        allPosts.push(...posts);
      }
      
    } catch (e) {
      console.log(`    → Error: ${e.message}`);
    }
  }
  
  // ========================================
  // PHASE 3: Deduplicate
  // ========================================
  console.log(`\n📍 Phase 3: Dedup...`);
  const uniquePosts = [];
  const seen = new Set();
  
  for (const post of allPosts) {
    const id = post.id || post.shortcode;
    if (!seen.has(id)) {
      seen.add(id);
      uniquePosts.push(post);
    }
  }
  
  console.log(`  → ${uniquePosts.length} unique posts`);
  
  // ========================================
  // PHASE 4: Validate & Score
  // ========================================
  console.log('\n📍 Phase 4: Validate & Score...');
  
  const approvedDeals = [];
  
  for (const post of uniquePosts) {
    // Build text to analyze
    const caption = post.caption || '';
    const altText = post.accessibilityCaption || '';
    const location = post.location?.name || '';
    const allText = `${caption} ${altText} ${location}`.toLowerCase();
    
    // === REJECT CHECK ===
    if (shouldReject(allText)) {
      continue; // Skip spam, gewinnspiele, etc.
    }
    
    // === WIEN CHECK (STRICT!) ===
    const isTrusted = TRUSTED_ACCOUNTS.has((post.ownerUsername || '').toLowerCase());
    const hasWien = hasExplicitWienLocation(allText);
    
    if (!isTrusted && !hasWien) {
      continue; // Skip if no Wien reference
    }
    
    // === GRATS CHECK (STRICT!) ===
    const hasGratis = hasGratisKeyword(allText);
    
    if (!hasGratis) {
      continue; // Skip if not explicitly free
    }
    
    // === SCORE ===
    let score = 0;
    
    // Base score for being a real gratis deal
    score += 50;
    
    // Food bonus
    if (hasFoodKeyword(allText)) score += 20;
    
    // Wien bonus
    if (hasWien) score += 15;
    
    // Trusted account bonus
    if (isTrusted) score += 10;
    
    // Freshness (age in hours)
    const postTime = new Date(post.timestamp || post.createdAt || Date.now());
    const hoursOld = (Date.now() - postTime.getTime()) / (1000 * 60 * 60);
    
    if (hoursOld < 12) score += 15;
    else if (hoursOld < 24) score += 12;
    else if (hoursOld < 48) score += 8;
    else if (hoursOld < 72) score += 5;
    
    // Minimum score
    if (score < CONFIG.minScore) {
      continue;
    }
    
    // === EXTRACT INFO ===
    const brand = post.ownerUsername || 'Unknown';
    const title = caption.substring(0, 80) || 'Gratis Deal';
    
    const deal = {
      id: `ig-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      brand: brand,
      logo: '📸',
      title: title.replace(/\n/g, ' '),
      description: location || 'Wien',
      type: 'gratis',
      category: hasFoodKeyword(allText) ? 'essen' : 'sonstiges',
      source: `Instagram @${post.ownerUsername}`,
      url: post.url || `https://instagram.com/p/${post.shortcode}/`,
      expires: 'Begrenzt',
      distance: location || 'Wien',
      hot: score > 70,
      isNew: true,
      isInstagramDeal: true,
      priority: 2,
      votes: Math.floor(score / 10),
      qualityScore: score,
      pubDate: new Date().toISOString(),
    };
    
    approvedDeals.push(deal);
    console.log(`  ✅ ${brand}: ${title.substring(0, 40)}... [Score: ${score}]`);
  }
  
  // ========================================
  // PHASE 5: Save
  // ========================================
  console.log(`\n📍 Phase 5: Save...`);
  
  // Load existing deals
  const dealsFile = path.join(__dirname, '..', 'docs', 'deals.json');
  let dealsData = { deals: [], totalDeals: 0 };
  
  if (fs.existsSync(dealsFile)) {
    try {
      dealsData = JSON.parse(fs.readFileSync(dealsFile, 'utf-8'));
    } catch (e) {}
  }
  
  // Add new Instagram deals (keep non-instagram)
  const existingDeals = dealsData.deals.filter(d => !d.isInstagramDeal);
  
  // Merge (keep existing Instagram if still valid)
  const newDeals = [...existingDeals, ...approvedDeals];
  
  // Sort by score
  newDeals.sort((a, b) => b.qualityScore - a.qualityScore);
  
  // Limit
  const limitedDeals = newDeals.slice(0, 100);
  
  const result = {
    deals: limitedDeals,
    totalDeals: limitedDeals.length,
    lastUpdate: new Date().toISOString(),
  };
  
  fs.writeFileSync(dealsFile, JSON.stringify(result, null, 2));
  
  console.log(`\n✅ FERTIG!`);
  console.log(`   Neue Deals: ${approvedDeals.length}`);
  console.log(`   Total: ${limitedDeals.length}`);
  
  // Output for GitHub Actions
  console.log(`\n📊 Summary:`);
  console.log(`   Posts analyzed: ${uniquePosts.length}`);
  console.log(`   Approved: ${approvedDeals.length}`);
}

// ESM export
export { main };

// Run directly (not via Apify.main which only works in Apify cloud)
main().catch(err => {
  console.error('Scraper failed:', err);
  process.exit(1);
});

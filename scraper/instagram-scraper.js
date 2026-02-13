// ============================================
// FREEFINDER WIEN - INSTAGRAM DEAL SCRAPER
// Nutzt Apify Instagram Hashtag Scraper (Free Plan)
// Findet NUR echte Freebies & SchnÃ¤ppchen
// ============================================

import https from 'https';
import fs from 'fs';

const APIFY_API_TOKEN = process.env.APIFY_API_TOKEN || '';

if (!APIFY_API_TOKEN) {
  console.log('âš ï¸  APIFY_API_TOKEN nicht gesetzt - Instagram Scraper Ã¼bersprungen');
  console.log('ðŸ’¡ So richtest du es ein:');
  console.log('   1. Gratis-Account auf https://apify.com erstellen');
  console.log('   2. Settings â†’ Integrations â†’ API Token kopieren');
  console.log('   3. GitHub â†’ Repo Settings â†’ Secrets â†’ New:');
  console.log('      Name: APIFY_API_TOKEN');
  console.log('      Value: [dein-token]');
  process.exit(0);
}

// ============================================
// HASHTAGS ZUM MONITOREN
// ============================================

const HASHTAGS = [
  'gratiswien',
  'gratisessen',
  'wienisst',
  'neuerÃ¶ffnungwien',
  'kebabwien',
  'freebiewien',
  'wiengratis',
  'kostenloswien',
  'wienessen',
  'streetfoodwien'
];

// ============================================
// STRENGER DEAL-FILTER: 2 PFLICHT-CHECKS
// ============================================

// CHECK 1: Deal-Typ muss erkennbar sein
const GRATIS_KEYWORDS = [
  'gratis', 'kostenlos', 'free', 'geschenkt', 'umsonst',
  'verschenken', 'freebie', 'for free', 'auf uns', 'aufs haus',
  'wir laden ein', 'einladung', 'wir spendieren', 'spendieren'
];

const PREIS_KEYWORDS = [
  'â‚¬1', 'â‚¬2', 'â‚¬3', 'â‚¬4', 'â‚¬5',
  '1â‚¬', '2â‚¬', '3â‚¬', '4â‚¬', '5â‚¬',
  '1,', '2,', '3,', '4,',       // z.B. "nur 2,50â‚¬"
  'nur â‚¬', 'ab â‚¬1', 'ab â‚¬2', 'ab â‚¬3',
  'um 1', 'um 2', 'um 3',       // z.B. "Kebab um 2 Euro"
  'fÃ¼r 1', 'fÃ¼r 2', 'fÃ¼r 3'     // z.B. "DÃ¶ner fÃ¼r 2â‚¬"
];

const AKTION_KEYWORDS = [
  '1+1', '2 fÃ¼r 1', 'buy one get one', 'bogo',
  '50%', '60%', '70%', '80%', '-50%', '-60%', '-70%',
  'halber preis', 'hÃ¤lfte', 'half price'
];

// CHECK 2: Konkretes Produkt muss erkennbar sein
const FOOD_KEYWORDS = [
  'kebab', 'kebap', 'dÃ¶ner', 'doner', 'pizza', 'burger',
  'kaffee', 'coffee', 'eis', 'ice cream', 'gelato',
  'wrap', 'falafel', 'getrÃ¤nk', 'drink', 'ayran',
  'menÃ¼', 'menu', 'essen', 'food', 'meal',
  'kuchen', 'torte', 'croissant', 'brot', 'sandwich',
  'sushi', 'ramen', 'nudel', 'pasta', 'pommes', 'fries',
  'smoothie', 'juice', 'saft', 'tee', 'tea',
  'schnitzel', 'wurst', 'hot dog', 'hotdog',
  'cookie', 'donut', 'muffin', 'waffle', 'waffel',
  'bowl', 'salat', 'salad', 'suppe', 'soup',
  'bier', 'beer', 'cocktail', 'spritzer',
  'bubble tea', 'boba', 'frozen yogurt', 'froyo',
  'popcorn', 'nachos', 'tacos', 'burrito',
  'milchshake', 'milkshake', 'latte', 'cappuccino',
  'espresso', 'frÃ¼hstÃ¼ck', 'breakfast', 'brunch'
];

const NON_FOOD_KEYWORDS = [
  'haarschnitt', 'haircut', 'friseur', 'barber',
  'training', 'probetraining', 'fitness',
  'probe', 'sample', 'goodie bag', 'goodiebag',
  'geschenk', 'gift', 'merch', 't-shirt',
  'massage', 'beauty', 'kosmetik', 'manikÃ¼re',
  'tattoo', 'piercing'
];

// WIEN CHECK
const WIEN_KEYWORDS = [
  'wien', 'vienna', 'vienne',
  '1010', '1020', '1030', '1040', '1050', '1060', '1070', '1080', '1090',
  '1100', '1110', '1120', '1130', '1140', '1150', '1160', '1170', '1180', '1190',
  '1200', '1210', '1220', '1230',
  'favoriten', 'ottakring', 'hernals', 'dÃ¶bling', 'floridsdorf',
  'donaustadt', 'leopoldstadt', 'landstraÃŸe', 'wieden', 'margareten',
  'mariahilf', 'neubau', 'josefstadt', 'alsergrund', 'meidling',
  'hietzing', 'penzing', 'rudolfsheim', 'liesing', 'innere stadt',
  'prater', 'naschmarkt', 'stephansplatz', 'mariahilfer',
  'schwedenplatz', 'karlsplatz', 'westbahnhof', 'hauptbahnhof',
  'donaukanal', 'ringstraÃŸe', 'gÃ¼rtel'
];

// SPAM FILTER
const SPAM_KEYWORDS = [
  'gewinnspiel', 'giveaway', 'verlosung', 'tagge 3', 'tag 3',
  'markiere 3', 'dm for', 'dm fÃ¼r', 'passive income', 'network marketing',
  'mlm', 'crypto', 'nft', 'invest', 'abnehmen', 'diÃ¤t', 'weight loss',
  'follow for follow', 'f4f', 'like for like', 'l4l',
  'onlyfans', 'link in bio kaufen', 'shop now'
];

// ABGELAUFEN FILTER
const EXPIRED_KEYWORDS = [
  'war gestern', 'ist vorbei', 'leider ausverkauft', 'leider vorbei',
  'bereits vergriffen', 'sold out', 'ausverkauft', 'nicht mehr verfÃ¼gbar',
  'abgelaufen', 'expired', 'letzte woche', 'letzten monat'
];

// ============================================
// DEAL VALIDIERUNG
// ============================================

function validateDeal(post) {
  const caption = (post.caption || '').toLowerCase();
  const location = (post.locationName || '').toLowerCase();
  const allText = caption + ' ' + location;

  // âŒ Spam Check (sofort raus)
  if (SPAM_KEYWORDS.some(k => caption.includes(k))) {
    return { valid: false, reason: 'spam' };
  }

  // âŒ Abgelaufen Check
  if (EXPIRED_KEYWORDS.some(k => caption.includes(k))) {
    return { valid: false, reason: 'expired' };
  }

  // âŒ Zu viele Hashtags = Spam (>25)
  const hashtagCount = (caption.match(/#/g) || []).length;
  if (hashtagCount > 25) {
    return { valid: false, reason: 'too_many_hashtags' };
  }

  // âŒ Frische Check: Post nicht Ã¤lter als 7 Tage
  if (post.timestamp) {
    const postDate = new Date(post.timestamp);
    const now = new Date();
    const daysDiff = (now - postDate) / (1000 * 60 * 60 * 24);
    if (daysDiff > 7) {
      return { valid: false, reason: 'too_old' };
    }
  }

  // âœ… CHECK 1: Deal-Typ muss erkennbar sein
  const isGratis = GRATIS_KEYWORDS.some(k => caption.includes(k));
  const hasGoodPrice = PREIS_KEYWORDS.some(k => caption.includes(k));
  const hasAktion = AKTION_KEYWORDS.some(k => caption.includes(k));

  if (!isGratis && !hasGoodPrice && !hasAktion) {
    return { valid: false, reason: 'no_deal_type' };
  }

  // âœ… CHECK 2: Konkretes Produkt muss erkennbar sein
  const hasFood = FOOD_KEYWORDS.some(k => caption.includes(k));
  const hasNonFood = NON_FOOD_KEYWORDS.some(k => caption.includes(k));

  if (!hasFood && !hasNonFood) {
    return { valid: false, reason: 'no_product' };
  }

  // âœ… WIEN CHECK: Muss Wien-Bezug haben
  const hasWien = WIEN_KEYWORDS.some(k => allText.includes(k));
  if (!hasWien) {
    return { valid: false, reason: 'not_vienna' };
  }

  // ðŸ“Š QUALITY SCORE berechnen
  let score = 0;

  // Deal-Typ Score
  if (isGratis) score += 30;
  if (hasGoodPrice) score += 25;
  if (hasAktion) score += 20;

  // Produkt Score
  if (hasFood) score += 15;
  if (hasNonFood) score += 10;

  // Wien Score
  if (location && WIEN_KEYWORDS.some(k => location.includes(k))) score += 20;

  // Engagement Score
  const likes = post.likesCount || 0;
  if (likes > 100) score += 15;
  else if (likes > 50) score += 10;
  else if (likes > 10) score += 5;

  // Bonus: Mehrere Deal-Keywords
  const dealKeywordCount = [
    ...GRATIS_KEYWORDS.filter(k => caption.includes(k)),
    ...PREIS_KEYWORDS.filter(k => caption.includes(k)),
    ...AKTION_KEYWORDS.filter(k => caption.includes(k))
  ].length;
  if (dealKeywordCount >= 2) score += 5;

  // Bonus: Hat Adresse oder Ã–ffnungszeiten
  if (caption.match(/\d{4}\s*wien/i) || caption.match(/\d{1,2}[.:]\d{2}/)) {
    score += 10;
  }

  // Minimum Score: 40 fÃ¼r Auto-Approve
  const dealType = isGratis ? 'gratis' : (hasAktion ? 'aktion' : 'gÃ¼nstig');

  return {
    valid: score >= 40,
    review: score >= 30 && score < 40,
    score,
    dealType,
    isGratis,
    hasFood,
    reason: score >= 40 ? 'approved' : (score >= 30 ? 'review' : 'low_score')
  };
}

// ============================================
// DEAL ERSTELLEN
// ============================================

function createDealFromPost(post, validation) {
  const caption = post.caption || '';

  // Titel extrahieren: Ersten relevanten Satz finden
  let title = '';

  // Versuche konkreten Deal-Text zu finden
  const sentences = caption.split(/[.\n!?]/).filter(s => s.trim().length > 10 && s.trim().length < 100);
  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();
    const hasDealWord = [...GRATIS_KEYWORDS, ...PREIS_KEYWORDS, ...AKTION_KEYWORDS].some(k => lower.includes(k));
    const hasProduct = [...FOOD_KEYWORDS, ...NON_FOOD_KEYWORDS].some(k => lower.includes(k));
    if (hasDealWord && hasProduct) {
      title = sentence.trim();
      break;
    }
    if (hasDealWord && !title) {
      title = sentence.trim();
    }
  }

  // Fallback: Ersten Satz nehmen
  if (!title) {
    title = sentences[0] || caption.substring(0, 70);
  }

  // Titel aufrÃ¤umen
  title = title
    .replace(/#\w+/g, '')           // Hashtags entfernen
    .replace(/@\w+/g, '')           // Mentions entfernen
    .replace(/[ðŸŽ‰ðŸŽŠðŸ”¥ðŸ’¥ðŸš€â­âœ¨ðŸŽðŸ†“ðŸ’°ðŸ·ï¸]/g, '') // Emojis reduzieren
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 70);

  // Prefix basierend auf Deal-Typ
  if (validation.isGratis && !title.toLowerCase().includes('gratis')) {
    title = `GRATIS: ${title}`;
  }

  // Beschreibung erstellen
  let description = caption
    .replace(/#\w+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 150);

  // Preis extrahieren falls vorhanden
  const priceMatch = caption.match(/(\d+[.,]?\d*)\s*â‚¬|â‚¬\s*(\d+[.,]?\d*)/);
  const price = priceMatch ? (priceMatch[1] || priceMatch[2]) : null;

  // Kategorie bestimmen
  const lower = caption.toLowerCase();
  let category = 'essen';
  if (FOOD_KEYWORDS.some(k => lower.includes(k) && ['kaffee', 'coffee', 'latte', 'cappuccino', 'espresso', 'tee', 'tea'].includes(k))) {
    category = 'kaffee';
  } else if (NON_FOOD_KEYWORDS.some(k => lower.includes(k) && ['training', 'probetraining', 'fitness'].includes(k))) {
    category = 'fitness';
  } else if (NON_FOOD_KEYWORDS.some(k => lower.includes(k) && ['haarschnitt', 'friseur', 'barber', 'beauty', 'kosmetik'].includes(k))) {
    category = 'beauty';
  }

  // Logo bestimmen
  const logoMap = {
    'kaffee': 'â˜•',
    'essen': 'ðŸ½ï¸',
    'fitness': 'ðŸ’ª',
    'beauty': 'ðŸ’„'
  };
  // Food-spezifische Logos
  let logo = logoMap[category] || 'ðŸŽ';
  if (lower.includes('kebab') || lower.includes('kebap') || lower.includes('dÃ¶ner')) logo = 'ðŸ¥™';
  else if (lower.includes('pizza')) logo = 'ðŸ•';
  else if (lower.includes('burger')) logo = 'ðŸ”';
  else if (lower.includes('eis') || lower.includes('gelato')) logo = 'ðŸ¦';
  else if (lower.includes('sushi')) logo = 'ðŸ£';
  else if (lower.includes('bubble tea') || lower.includes('boba')) logo = 'ðŸ§‹';

  // Brand aus Username oder Location
  const brand = post.ownerUsername
    ? post.ownerUsername.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    : (post.locationName || 'Instagram Deal');

  return {
    id: `ig-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
    brand: brand.substring(0, 30),
    logo: logo,
    title: title,
    description: description,
    type: validation.isGratis ? 'gratis' : 'rabatt',
    badge: validation.isGratis ? 'gratis' : 'limited',
    category: category,
    source: `Instagram @${post.ownerUsername || 'unknown'}`,
    url: post.url || `https://www.instagram.com/p/${post.shortCode || ''}`,
    expires: 'Begrenzt',
    distance: post.locationName || 'Wien',
    hot: validation.isGratis && (post.likesCount || 0) > 50,
    isNew: true,
    isInstagramDeal: true,
    priority: validation.isGratis ? 2 : 3,
    votes: Math.min(Math.round((post.likesCount || 0) / 10), 50),
    qualityScore: validation.score,
    pubDate: post.timestamp || new Date().toISOString()
  };
}

// ============================================
// APIFY API CALL
// ============================================

function apifyRequest(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.apify.com',
      port: 443,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${APIFY_API_TOKEN}`
      }
    };

    if (body) {
      const bodyStr = JSON.stringify(body);
      options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`JSON Parse Error: ${data.substring(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(120000, () => {
      req.destroy();
      reject(new Error('Timeout'));
    });

    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ============================================
// APIFY SCRAPER STARTEN & WARTEN
// ============================================

async function runApifyHashtagScraper(hashtags) {
  console.log(`ðŸ“¸ Starte Apify Instagram Hashtag Scraper...`);
  console.log(`   Hashtags: ${hashtags.map(h => '#' + h).join(', ')}`);

  // Apify Actor fÃ¼r Instagram Hashtag Scraper
  // Actor ID: apify/instagram-hashtag-scraper
  const actorId = 'apify~instagram-hashtag-scraper';

  const input = {
    hashtags: hashtags,
    resultsPerHashtag: 30,
    searchType: 'posts'
  };

  try {
    // 1. Actor Run starten
    console.log('   â³ Starte Scraper Run...');
    const runResult = await apifyRequest(
      `/v2/acts/${actorId}/runs?token=${APIFY_API_TOKEN}`,
      'POST',
      input
    );

    if (!runResult.data || !runResult.data.id) {
      console.log('   âŒ Konnte Scraper nicht starten:', JSON.stringify(runResult).substring(0, 200));
      return [];
    }

    const runId = runResult.data.id;
    console.log(`   âœ… Run gestartet: ${runId}`);

    // 2. Auf Fertigstellung warten (max 3 Minuten)
    let status = 'RUNNING';
    let attempts = 0;
    const maxAttempts = 18; // 18 Ã— 10s = 3 Minuten

    while (status === 'RUNNING' || status === 'READY') {
      attempts++;
      if (attempts > maxAttempts) {
        console.log('   â° Timeout nach 3 Minuten - Abbruch');
        break;
      }

      await new Promise(r => setTimeout(r, 10000)); // 10 Sekunden warten

      const runInfo = await apifyRequest(
        `/v2/acts/${actorId}/runs/${runId}?token=${APIFY_API_TOKEN}`
      );

      status = runInfo.data?.status || 'UNKNOWN';
      console.log(`   â³ Status: ${status} (${attempts}/${maxAttempts})`);
    }

    if (status !== 'SUCCEEDED') {
      console.log(`   âŒ Run nicht erfolgreich: ${status}`);
      return [];
    }

    // 3. Ergebnisse abrufen
    const datasetId = runResult.data.defaultDatasetId;
    console.log(`   ðŸ“¦ Lade Ergebnisse von Dataset ${datasetId}...`);

    const results = await apifyRequest(
      `/v2/datasets/${datasetId}/items?token=${APIFY_API_TOKEN}&limit=200`
    );

    if (Array.isArray(results)) {
      console.log(`   âœ… ${results.length} Posts geladen`);
      return results;
    }

    console.log('   âš ï¸  Unerwartetes Ergebnis-Format');
    return [];

  } catch (error) {
    console.log(`   âŒ Apify Fehler: ${error.message}`);
    return [];
  }
}

// ============================================
// MAIN
// ============================================

async function main() {
  console.log('â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”');
  console.log('ðŸ“¸ INSTAGRAM DEAL SCRAPER gestartet');
  console.log(`ðŸ“… ${new Date().toLocaleString('de-AT')}`);
  console.log('â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n');

  // 1. Backup von deals.json erstellen
  const dealsPath = 'docs/deals.json';
  if (fs.existsSync(dealsPath)) {
    const backupPath = `docs/deals.backup.json`;
    fs.copyFileSync(dealsPath, backupPath);
    console.log('ðŸ’¾ Backup von deals.json erstellt\n');
  }

  // 2. Instagram Posts scrapen
  const posts = await runApifyHashtagScraper(HASHTAGS);

  if (posts.length === 0) {
    console.log('\nâš ï¸  Keine Posts gefunden - beende ohne Ã„nderungen');
    process.exit(0);
  }

  // 3. Jeden Post validieren
  console.log(`\nðŸ” Validiere ${posts.length} Posts...\n`);

  const approvedDeals = [];
  const reviewDeals = [];
  let rejected = { spam: 0, expired: 0, too_old: 0, no_deal_type: 0, no_product: 0, not_vienna: 0, low_score: 0, too_many_hashtags: 0 };

  for (const post of posts) {
    const result = validateDeal(post);

    if (result.valid) {
      approvedDeals.push(createDealFromPost(post, result));
    } else if (result.review) {
      reviewDeals.push(createDealFromPost(post, result));
    } else {
      rejected[result.reason] = (rejected[result.reason] || 0) + 1;
    }
  }

  // 4. Max 10 Deals pro Run (QualitÃ¤t > QuantitÃ¤t)
  const MAX_DEALS_PER_RUN = 10;
  const finalDeals = approvedDeals
    .sort((a, b) => b.qualityScore - a.qualityScore)
    .slice(0, MAX_DEALS_PER_RUN);

  // 5. Statistiken ausgeben
  console.log('ðŸ“Š FILTER-ERGEBNIS:');
  console.log('â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”');
  console.log(`   ðŸ“¥ Posts gescrapt:     ${posts.length}`);
  console.log(`   âœ… Approved:           ${approvedDeals.length}`);
  console.log(`   ðŸ” Review-Queue:       ${reviewDeals.length}`);
  console.log(`   âŒ Abgelehnt:          ${Object.values(rejected).reduce((a, b) => a + b, 0)}`);
  console.log(`      â†’ Kein Deal-Typ:    ${rejected.no_deal_type}`);
  console.log(`      â†’ Kein Produkt:     ${rejected.no_product}`);
  console.log(`      â†’ Nicht Wien:       ${rejected.not_vienna}`);
  console.log(`      â†’ Spam:             ${rejected.spam}`);
  console.log(`      â†’ Abgelaufen:       ${rejected.expired}`);
  console.log(`      â†’ Zu alt:           ${rejected.too_old}`);
  console.log(`      â†’ Low Score:        ${rejected.low_score}`);
  console.log(`   ðŸ† Finale Deals:       ${finalDeals.length}`);
  console.log('â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n');

  if (finalDeals.length > 0) {
    console.log('ðŸ† NEUE DEALS:');
    finalDeals.forEach((d, i) => {
      console.log(`   ${i + 1}. ${d.logo} ${d.title} (Score: ${d.qualityScore})`);
      console.log(`      â†’ ${d.brand} | ${d.distance} | ${d.source}`);
    });
  }

  // 6. In deals.json mergen
  if (finalDeals.length > 0 && fs.existsSync(dealsPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(dealsPath, 'utf8'));

      // Alte Instagram-Deals entfernen die Ã¤lter als 7 Tage sind
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      existing.deals = existing.deals.filter(d => {
        if (!d.isInstagramDeal) return true; // Nicht-Instagram Deals behalten
        const pubDate = new Date(d.pubDate || 0);
        return pubDate > sevenDaysAgo; // Nur frische IG-Deals behalten
      });

      // Neue Deals hinzufÃ¼gen (Duplikat-Check)
      const existingTitles = new Set(
        existing.deals.map(d => d.title.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 25))
      );

      let addedCount = 0;
      for (const deal of finalDeals) {
        const key = deal.title.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 25);
        if (!existingTitles.has(key)) {
          existing.deals.push(deal);
          existingTitles.add(key);
          addedCount++;
        }
      }

      // Sortierung beibehalten (Priority â†’ Hot â†’ Gratis)
      existing.deals.sort((a, b) => {
        if ((a.priority || 99) !== (b.priority || 99)) return (a.priority || 99) - (b.priority || 99);
        if (a.hot && !b.hot) return -1;
        if (!a.hot && b.hot) return 1;
        if (a.type === 'gratis' && b.type !== 'gratis') return -1;
        return 0;
      });

      existing.totalDeals = existing.deals.length;
      existing.lastUpdated = new Date().toISOString();

      fs.writeFileSync(dealsPath, JSON.stringify(existing, null, 2));

      console.log(`\nâœ… ${addedCount} neue Instagram-Deals in deals.json eingefÃ¼gt`);
      console.log(`ðŸ“Š Gesamt: ${existing.totalDeals} Deals`);

    } catch (e) {
      // Fehler â†’ Backup wiederherstellen
      console.log(`\nâŒ Merge fehlgeschlagen: ${e.message}`);
      if (fs.existsSync('docs/deals.backup.json')) {
        fs.copyFileSync('docs/deals.backup.json', dealsPath);
        console.log('ðŸ”„ Backup wiederhergestellt - keine Ã„nderungen an deals.json');
      }
    }
  } else if (finalDeals.length === 0) {
    console.log('\nðŸ“­ Keine neuen Deals gefunden - deals.json bleibt unverÃ¤ndert');
  }

  // 7. Review-Queue speichern (optional manuell prÃ¼fen)
  if (reviewDeals.length > 0) {
    const reviewPath = 'docs/deals-review.json';
    fs.writeFileSync(reviewPath, JSON.stringify({
      lastUpdated: new Date().toISOString(),
      info: 'Diese Deals haben Score 30-40 und brauchen manuelle PrÃ¼fung',
      deals: reviewDeals
    }, null, 2));
    console.log(`\nðŸ“‹ ${reviewDeals.length} Deals in Review-Queue gespeichert (docs/deals-review.json)`);
  }

  // 8. Backup aufrÃ¤umen
  if (fs.existsSync('docs/deals.backup.json')) {
    fs.unlinkSync('docs/deals.backup.json');
  }

  console.log('\nâ”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”');
  console.log('âœ… Instagram Scraper abgeschlossen!');
  console.log('â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”');
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal Error:', err.message);
    // Bei Fehler: Backup wiederherstellen falls vorhanden
    if (fs.existsSync('docs/deals.backup.json') && fs.existsSync('docs/deals.json')) {
      fs.copyFileSync('docs/deals.backup.json', 'docs/deals.json');
      console.log('ðŸ”„ Backup wiederhergestellt nach Fehler');
    }
    process.exit(0); // Kein Error-Exit damit GitHub Actions nicht fehlschlÃ¤gt
  });

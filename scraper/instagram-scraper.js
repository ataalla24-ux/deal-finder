// ============================================
// FREEFINDER WIEN - INSTAGRAM DEAL SCRAPER v2
// Findet echte Freebies & Schnäppchen in Wien
// Qualitätsstandard: Wie Base-Deals (konkret, klar, nützlich)
// ============================================

import https from 'https';
import fs from 'fs';

const APIFY_API_TOKEN = process.env.APIFY_API_TOKEN || '';

if (!APIFY_API_TOKEN) {
  console.log('⚠️  APIFY_API_TOKEN nicht gesetzt - Instagram Scraper übersprungen');
  console.log('💡 So richtest du es ein:');
  console.log('   1. Gratis-Account auf https://apify.com erstellen');
  console.log('   2. Settings → Integrations → API Token kopieren');
  console.log('   3. GitHub → Repo Settings → Secrets → New:');
  console.log('      Name: APIFY_API_TOKEN');
  console.log('      Value: [dein-token]');
  process.exit(0);
}

// ============================================
// CONFIG
// ============================================

const CONFIG = {
  maxDealsPerRun: 5,
  minScore: 50,
  reviewMinScore: 35,
  maxAgeDays: 7,
  maxHashtags: 25,
  postsPerHashtag: 30,
  dealExpiryDays: 7,
};

// ============================================
// HASHTAGS - Optimiert für echte Wien-Deals
// ============================================

const HASHTAGS = [
  'gratiswien',
  'wiengratis',
  'kostenloswien',
  'freebiewien',
  'gratisessen',
  'wienisst',
  'streetfoodwien',
  'foodiewien',
  'neueröffnungwien',
  'newinvienna',
  'kebabwien',
  'pizzawien',
  'kaffeewien',
  'wienfrühstück',
];

// ============================================
// KEYWORD-LISTEN
// ============================================

const GRATIS_KEYWORDS = [
  'gratis', 'kostenlos', 'free', 'geschenkt', 'umsonst',
  'verschenken', 'freebie', 'for free', 'auf uns', 'aufs haus',
  'wir laden ein', 'einladung', 'wir spendieren', 'spendieren',
  'geht auf uns', 'gratis dazu', 'on the house',
  '0€', '0 €', 'null euro',
];

const PREIS_KEYWORDS = [
  '€1', '€2', '€3', '€4', '€5',
  '1€', '2€', '3€', '4€', '5€',
  '1,50', '1,90', '2,50', '2,90', '3,50', '3,90', '4,50', '4,90',
  'nur €', 'ab €1', 'ab €2', 'ab €3',
  'um 1', 'um 2', 'um 3',
  'für 1', 'für 2', 'für 3',
  'ab 1,', 'ab 2,', 'ab 3,',
];

const AKTION_KEYWORDS = [
  '1+1', '2 für 1', 'buy one get one', 'bogo',
  '50%', '60%', '70%', '80%', '-50%', '-60%', '-70%',
  'halber preis', 'hälfte', 'half price',
  'happy hour', 'mittagsmenü', 'lunch deal', 'lunch special',
  'eröffnungsangebot', 'neueröffnung',
];

const FOOD_KEYWORDS = [
  'kebab', 'kebap', 'döner', 'doner', 'pizza', 'burger',
  'kaffee', 'coffee', 'eis', 'ice cream', 'gelato',
  'wrap', 'falafel', 'getränk', 'drink', 'ayran',
  'menü', 'menu', 'essen', 'food', 'meal',
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
  'espresso', 'frühstück', 'breakfast', 'brunch',
  'margherita', 'marinara', 'calzone', 'focaccia',
  'hummus', 'shawarma', 'poke', 'açai', 'acai',
  'bagel', 'pretzel', 'brezel',
];

const NON_FOOD_KEYWORDS = [
  'haarschnitt', 'haircut', 'friseur', 'barber',
  'training', 'probetraining', 'fitness', 'yoga',
  'probe', 'sample', 'goodie bag', 'goodiebag',
  'geschenk', 'gift', 'merch', 't-shirt',
  'massage', 'beauty', 'kosmetik', 'maniküre',
  'tattoo', 'piercing', 'workshop', 'kurs',
];

const WIEN_KEYWORDS = [
  'wien', 'vienna', 'vienne',
  '1010', '1020', '1030', '1040', '1050', '1060', '1070', '1080', '1090',
  '1100', '1110', '1120', '1130', '1140', '1150', '1160', '1170', '1180', '1190',
  '1200', '1210', '1220', '1230',
  'favoriten', 'ottakring', 'hernals', 'döbling', 'floridsdorf',
  'donaustadt', 'leopoldstadt', 'landstraße', 'wieden', 'margareten',
  'mariahilf', 'neubau', 'josefstadt', 'alsergrund', 'meidling',
  'hietzing', 'penzing', 'rudolfsheim', 'liesing', 'innere stadt',
  'prater', 'naschmarkt', 'stephansplatz', 'mariahilfer',
  'schwedenplatz', 'karlsplatz', 'westbahnhof', 'hauptbahnhof',
  'donaukanal', 'ringstraße', 'gürtel', 'simmering', 'brigittenau', 'währing',
];

const SPAM_KEYWORDS = [
  'gewinnspiel', 'giveaway', 'verlosung', 'tagge 3', 'tag 3',
  'markiere 3', 'dm for', 'dm für', 'passive income', 'network marketing',
  'mlm', 'crypto', 'nft', 'invest', 'abnehmen', 'diät', 'weight loss',
  'follow for follow', 'f4f', 'like for like', 'l4l',
  'onlyfans', 'link in bio kaufen', 'shop now', 'swipe up',
  'affiliate', 'provision', 'nebenjob', 'homeoffice job',
  'dm me', 'dm uns', 'schreib uns eine dm',
];

const EXPIRED_KEYWORDS = [
  'war gestern', 'ist vorbei', 'leider ausverkauft', 'leider vorbei',
  'bereits vergriffen', 'sold out', 'ausverkauft', 'nicht mehr verfügbar',
  'abgelaufen', 'expired', 'letzte woche', 'letzten monat',
];

// ============================================
// DEAL VALIDIERUNG (Streng!)
// ============================================

function validateDeal(post) {
  const caption = (post.caption || '').toLowerCase();
  const location = (post.locationName || '').toLowerCase();
  const allText = caption + ' ' + location;

  if (SPAM_KEYWORDS.some(k => caption.includes(k)))
    return { valid: false, reason: 'spam' };

  if (EXPIRED_KEYWORDS.some(k => caption.includes(k)))
    return { valid: false, reason: 'expired' };

  const hashtagCount = (caption.match(/#/g) || []).length;
  if (hashtagCount > CONFIG.maxHashtags)
    return { valid: false, reason: 'too_many_hashtags' };

  if (post.timestamp) {
    const daysDiff = (Date.now() - new Date(post.timestamp).getTime()) / (1000 * 60 * 60 * 24);
    if (daysDiff > CONFIG.maxAgeDays)
      return { valid: false, reason: 'too_old' };
  }

  if (caption.length < 30)
    return { valid: false, reason: 'too_short' };

  // CHECK 1: Deal-Typ
  const gratisMatches = GRATIS_KEYWORDS.filter(k => caption.includes(k));
  const preisMatches = PREIS_KEYWORDS.filter(k => caption.includes(k));
  const aktionMatches = AKTION_KEYWORDS.filter(k => caption.includes(k));
  const isGratis = gratisMatches.length > 0;
  const hasGoodPrice = preisMatches.length > 0;
  const hasAktion = aktionMatches.length > 0;

  if (!isGratis && !hasGoodPrice && !hasAktion)
    return { valid: false, reason: 'no_deal_type' };

  // CHECK 2: Produkt
  const foodMatches = FOOD_KEYWORDS.filter(k => caption.includes(k));
  const nonFoodMatches = NON_FOOD_KEYWORDS.filter(k => caption.includes(k));
  const hasFood = foodMatches.length > 0;
  const hasNonFood = nonFoodMatches.length > 0;

  if (!hasFood && !hasNonFood)
    return { valid: false, reason: 'no_product' };

  // CHECK 3: Wien
  if (!WIEN_KEYWORDS.some(k => allText.includes(k)))
    return { valid: false, reason: 'not_vienna' };

  // QUALITY SCORE
  let score = 0;
  if (isGratis) score += 30;
  else if (hasGoodPrice) score += 25;
  else if (hasAktion) score += 20;
  if (gratisMatches.length + preisMatches.length + aktionMatches.length >= 2) score += 5;

  if (hasFood) score += 15;
  if (hasNonFood) score += 10;
  if (foodMatches.length >= 2) score += 5;

  if (location && WIEN_KEYWORDS.some(k => location.includes(k))) score += 15;
  if (allText.match(/1[0-2][0-9]0\s*wien/i)) score += 5;

  const likes = post.likesCount || 0;
  if (likes > 200) score += 15;
  else if (likes > 100) score += 12;
  else if (likes > 50) score += 8;
  else if (likes > 20) score += 5;

  if (caption.match(/\d{4}\s*wien/i)) score += 5;
  if (caption.match(/\d{1,2}[.:]\d{2}\s*(uhr|h\b)/i)) score += 5;

  const textWithoutHashtags = caption.replace(/#\w+/g, '').trim();
  if (textWithoutHashtags.length < 40) score -= 15;

  return {
    valid: score >= CONFIG.minScore,
    review: score >= CONFIG.reviewMinScore && score < CONFIG.minScore,
    score, isGratis, hasGoodPrice, hasAktion, hasFood, hasNonFood,
    foodMatches, nonFoodMatches,
    reason: score >= CONFIG.minScore ? 'approved' : (score >= CONFIG.reviewMinScore ? 'review' : 'low_score'),
  };
}

// ============================================
// TITEL-GENERIERUNG (Base-Deal-Standard!)
// Format: "GRATIS [Produkt]" / "[Preis] [Produkt]"
// ============================================

function findBestProduct(lower) {
  const products = [
    ['margherita', 'Margherita'], ['marinara', 'Marinara'], ['calzone', 'Calzone'],
    ['kebab', 'Kebab'], ['kebap', 'Kebap'], ['döner', 'Döner'],
    ['schnitzel', 'Schnitzel'], ['burger', 'Burger'], ['pizza', 'Pizza'],
    ['sushi', 'Sushi'], ['ramen', 'Ramen'], ['falafel', 'Falafel'],
    ['cappuccino', 'Cappuccino'], ['latte', 'Latte'], ['espresso', 'Espresso'],
    ['kaffee', 'Kaffee'], ['coffee', 'Kaffee'],
    ['croissant', 'Croissant'], ['bagel', 'Bagel'],
    ['smoothie', 'Smoothie'], ['bubble tea', 'Bubble Tea'], ['boba', 'Bubble Tea'],
    ['frozen yogurt', 'Frozen Yogurt'],
    ['eis', 'Eis'], ['gelato', 'Gelato'],
    ['cocktail', 'Cocktail'], ['spritzer', 'Spritzer'],
    ['bier', 'Bier'],
    ['wrap', 'Wrap'], ['burrito', 'Burrito'], ['tacos', 'Tacos'],
    ['frühstück', 'Frühstück'], ['brunch', 'Brunch'],
    ['bowl', 'Bowl'], ['salat', 'Salat'],
    ['sandwich', 'Sandwich'], ['suppe', 'Suppe'],
    ['kuchen', 'Kuchen'], ['torte', 'Torte'],
    ['donut', 'Donut'], ['muffin', 'Muffin'], ['waffel', 'Waffel'],
    ['pommes', 'Pommes'], ['hot dog', 'Hot Dog'],
    ['haarschnitt', 'Haarschnitt'], ['probetraining', 'Probetraining'],
    ['massage', 'Massage'], ['yoga', 'Yoga-Stunde'], ['workshop', 'Workshop'],
  ];

  for (const [kw, label] of products) {
    if (lower.includes(kw)) return label;
  }
  return 'Essen';
}

function generateTitle(post, validation) {
  const caption = post.caption || '';
  const lower = caption.toLowerCase();
  const product = findBestProduct(lower);

  if (validation.isGratis) {
    if (lower.includes('neueröffnung') || lower.includes('eröffnung') || lower.includes('opening'))
      return `GRATIS ${product} - Neueröffnung`;
    if (lower.includes('geburtstag') || lower.includes('birthday'))
      return `GRATIS ${product} am Geburtstag`;
    if (lower.includes('1+1') || lower.includes('2 für 1'))
      return `GRATIS ${product} - 1+1 Aktion`;
    if (lower.includes('gratis dazu') || lower.includes('dazu gratis'))
      return `GRATIS ${product} dazu`;
    if (lower.includes('spendieren') || lower.includes('auf uns') || lower.includes('aufs haus'))
      return `GRATIS ${product} aufs Haus`;
    return `GRATIS ${product}`;
  }

  if (validation.hasAktion) {
    if (lower.includes('1+1')) return `1+1 ${product} GRATIS`;
    if (lower.includes('happy hour')) return `Happy Hour: ${product} reduziert`;
    const pctMatch = lower.match(/(-?\d{2,3})%/);
    if (pctMatch) return `${pctMatch[0]} auf ${product}`;
    if (lower.includes('halber preis')) return `${product} zum halben Preis`;
    if (lower.includes('eröffnung')) return `Eröffnungsangebot: ${product}`;
    return `${product} Aktion`;
  }

  if (validation.hasGoodPrice) {
    const priceMatch = caption.match(/(\d+[.,]?\d*)\s*€|€\s*(\d+[.,]?\d*)/);
    if (priceMatch) {
      const price = priceMatch[1] || priceMatch[2];
      return `${product} um nur ${price}€`;
    }
    const umMatch = caption.match(/(um|für|nur|ab)\s+(\d+[.,]?\d*)\s*(euro|€)/i);
    if (umMatch) return `${product} ${umMatch[1]} ${umMatch[2]}€`;
    return `${product} zum Sonderpreis`;
  }

  return `${product} Deal`;
}

// ============================================
// BRAND-EXTRAKTION
// ============================================

function extractBrand(post) {
  if (post.ownerFullName && post.ownerFullName.length > 1) {
    return cleanBrand(post.ownerFullName);
  }
  if (post.ownerUsername) {
    return cleanBrand(
      post.ownerUsername.replace(/[._]/g, ' ').replace(/\b(wien|vienna|official|at)\b/gi, '').trim()
    );
  }
  if (post.locationName) return cleanBrand(post.locationName);
  return 'Instagram Deal';
}

function cleanBrand(name) {
  return name.replace(/\b\w/g, c => c.toUpperCase()).replace(/\s+/g, ' ').trim().substring(0, 25);
}

// ============================================
// BESCHREIBUNG (Base-Deal-Standard)
// ============================================

function generateDescription(post, validation, title) {
  const caption = post.caption || '';
  const brand = extractBrand(post);
  const location = post.locationName || '';

  let clean = caption.replace(/#\w+/g, '').replace(/@\w+/g, '').replace(/\n+/g, '. ').replace(/\s+/g, ' ').trim();
  const sentences = clean.split(/[.!?\n]/).map(s => s.trim()).filter(s => s.length > 15 && s.length < 200);

  let bestSentence = '';
  let bestScore = 0;

  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();
    let sc = 0;
    if ([...GRATIS_KEYWORDS, ...PREIS_KEYWORDS, ...AKTION_KEYWORDS].some(k => lower.includes(k))) sc += 3;
    if ([...FOOD_KEYWORDS, ...NON_FOOD_KEYWORDS].some(k => lower.includes(k))) sc += 2;
    if (lower.match(/\d{4}\s*wien/i)) sc += 2;
    if (lower.match(/(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|täglich)/i)) sc += 1;
    if (sentence.length > 20 && !title.toLowerCase().includes(sentence.toLowerCase().substring(0, 15))) sc += 1;
    if (sc > bestScore) { bestScore = sc; bestSentence = sentence; }
  }

  let desc = (bestSentence && bestScore >= 3) ? bestSentence : sentences.slice(0, 2).join('. ');

  if (location && !desc.toLowerCase().includes(location.toLowerCase().substring(0, 10))) {
    desc += ` | ${location}`;
  }

  if (desc.length > 130) desc = desc.substring(0, 127) + '...';

  return desc || `Deal von ${brand} in Wien. Mehr Info auf Instagram.`;
}

// ============================================
// ADRESSE EXTRAHIEREN
// ============================================

function extractLocation(post) {
  const caption = (post.caption || '').toLowerCase();
  const location = post.locationName || '';

  const plzMatch = caption.match(/(1[0-2]\d0)\s*wien/i);
  if (plzMatch) return `${plzMatch[1]} Wien`;

  const addrMatch = caption.match(/(\d+)\.\s*bezirk/i);
  if (addrMatch) return `${addrMatch[1]}. Bezirk Wien`;

  const bezirke = {
    'innere stadt': '1010', leopoldstadt: '1020', 'landstraße': '1030',
    wieden: '1040', margareten: '1050', mariahilf: '1060', neubau: '1070',
    josefstadt: '1080', alsergrund: '1090', favoriten: '1100', simmering: '1110',
    meidling: '1120', hietzing: '1130', penzing: '1140', rudolfsheim: '1150',
    ottakring: '1160', hernals: '1170', 'währing': '1180', 'döbling': '1190',
    brigittenau: '1200', floridsdorf: '1210', donaustadt: '1220', liesing: '1230',
  };

  const allText = caption + ' ' + location.toLowerCase();
  for (const [name, plz] of Object.entries(bezirke)) {
    if (allText.includes(name)) return `${plz} Wien`;
  }

  if (location) return location;
  return 'Wien';
}

// ============================================
// KATEGORIE & LOGO
// ============================================

function categorize(caption, validation) {
  const lower = caption.toLowerCase();

  const coffeeWords = ['kaffee', 'coffee', 'latte', 'cappuccino', 'espresso', 'café', 'cafe'];
  if (coffeeWords.some(k => lower.includes(k)) && !lower.includes('pizza') && !lower.includes('burger'))
    return { category: 'kaffee', logo: '☕' };

  if (lower.includes('kebab') || lower.includes('kebap') || lower.includes('döner')) return { category: 'essen', logo: '🥙' };
  if (lower.includes('pizza') || lower.includes('margherita')) return { category: 'essen', logo: '🍕' };
  if (lower.includes('burger')) return { category: 'essen', logo: '🍔' };
  if (lower.includes('sushi')) return { category: 'essen', logo: '🍣' };
  if (lower.includes('eis') || lower.includes('gelato')) return { category: 'essen', logo: '🍦' };
  if (lower.includes('bubble tea') || lower.includes('boba')) return { category: 'essen', logo: '🧋' };
  if (lower.includes('frühstück') || lower.includes('brunch')) return { category: 'essen', logo: '🥐' };
  if (lower.includes('bowl') || lower.includes('salat')) return { category: 'essen', logo: '🥗' };
  if (lower.includes('cocktail') || lower.includes('bier') || lower.includes('spritzer')) return { category: 'essen', logo: '🍺' };
  if (lower.includes('schnitzel')) return { category: 'essen', logo: '🍽️' };
  if (lower.includes('training') || lower.includes('fitness') || lower.includes('yoga')) return { category: 'fitness', logo: '💪' };
  if (lower.includes('friseur') || lower.includes('barber') || lower.includes('haarschnitt')) return { category: 'beauty', logo: '💈' };
  if (lower.includes('beauty') || lower.includes('kosmetik')) return { category: 'beauty', logo: '💄' };

  if (validation.hasFood) return { category: 'essen', logo: '🍽️' };
  return { category: 'shopping', logo: '🎁' };
}

// ============================================
// DEAL-OBJEKT ERSTELLEN
// ============================================

function createDeal(post, validation) {
  const caption = post.caption || '';
  const brand = extractBrand(post);
  const title = generateTitle(post, validation);
  const description = generateDescription(post, validation, title);
  const location = extractLocation(post);
  const { category, logo } = categorize(caption, validation);
  const likes = post.likesCount || 0;

  return {
    id: `ig-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    brand, logo, title, description,
    type: validation.isGratis ? 'gratis' : 'rabatt',
    category,
    source: `Instagram @${post.ownerUsername || 'unknown'}`,
    url: post.url || `https://www.instagram.com/p/${post.shortCode || ''}`,
    expires: 'Begrenzt',
    distance: location,
    hot: validation.isGratis && likes > 50,
    isNew: true, isInstagramDeal: true,
    priority: validation.isGratis ? 2 : 3,
    votes: Math.min(Math.round(likes / 10), 50),
    qualityScore: validation.score,
    pubDate: post.timestamp || new Date().toISOString(),
  };
}

// ============================================
// DUPLIKAT-CHECK (Streng!)
// ============================================

function isDuplicate(deal, existingDeals) {
  const normalize = s => s.toLowerCase().replace(/[^a-zäöüß0-9]/g, '').substring(0, 20);

  for (const existing of existingDeals) {
    // Gleicher IG-User
    if (existing.source && deal.source && existing.source === deal.source && existing.isInstagramDeal)
      return true;
    // Gleicher Brand bei IG-Deals
    if (existing.isInstagramDeal && existing.brand.toLowerCase() === deal.brand.toLowerCase())
      return true;
    // Titel-Ähnlichkeit
    if (normalize(existing.title) === normalize(deal.title))
      return true;
    // Brand schon in Base-Deals
    if (!existing.isInstagramDeal && existing.brand.toLowerCase() === deal.brand.toLowerCase())
      return true;
  }
  return false;
}

// ============================================
// APIFY API
// ============================================

function apifyRequest(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.apify.com', port: 443, path, method,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${APIFY_API_TOKEN}` },
    };
    if (body) options.headers['Content-Length'] = Buffer.byteLength(JSON.stringify(body));

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON Parse Error: ${data.substring(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('Timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runApifyHashtagScraper(hashtags) {
  console.log('📸 Starte Apify Instagram Hashtag Scraper...');
  console.log(`   Hashtags: ${hashtags.map(h => '#' + h).join(', ')}`);

  const actorId = 'apify~instagram-hashtag-scraper';
  const input = { hashtags, resultsPerHashtag: CONFIG.postsPerHashtag, searchType: 'posts' };

  try {
    console.log('   ⏳ Starte Scraper Run...');
    const runResult = await apifyRequest(
      `/v2/acts/${actorId}/runs?token=${APIFY_API_TOKEN}`, 'POST', input
    );

    if (!runResult.data || !runResult.data.id) {
      console.log('   ❌ Konnte Scraper nicht starten:', JSON.stringify(runResult).substring(0, 200));
      return [];
    }

    const runId = runResult.data.id;
    console.log(`   ✅ Run gestartet: ${runId}`);

    let status = 'RUNNING';
    let attempts = 0;
    while (status === 'RUNNING' || status === 'READY') {
      attempts++;
      if (attempts > 18) { console.log('   ⏰ Timeout - Abbruch'); break; }
      await new Promise(r => setTimeout(r, 10000));
      const runInfo = await apifyRequest(`/v2/acts/${actorId}/runs/${runId}?token=${APIFY_API_TOKEN}`);
      status = runInfo.data?.status || 'UNKNOWN';
      console.log(`   ⏳ Status: ${status} (${attempts}/18)`);
    }

    if (status !== 'SUCCEEDED') { console.log(`   ❌ Run: ${status}`); return []; }

    const datasetId = runResult.data.defaultDatasetId;
    console.log(`   📦 Lade Ergebnisse...`);
    const results = await apifyRequest(`/v2/datasets/${datasetId}/items?token=${APIFY_API_TOKEN}&limit=500`);

    if (Array.isArray(results)) { console.log(`   ✅ ${results.length} Posts geladen`); return results; }
    console.log('   ⚠️  Unerwartetes Format');
    return [];
  } catch (error) {
    console.log(`   ❌ Apify Fehler: ${error.message}`);
    return [];
  }
}

// ============================================
// MAIN
// ============================================

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📸 INSTAGRAM DEAL SCRAPER v2 gestartet');
  console.log(`📅 ${new Date().toLocaleString('de-AT')}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const dealsPath = 'docs/deals.json';
  if (fs.existsSync(dealsPath)) {
    fs.copyFileSync(dealsPath, 'docs/deals.backup.json');
    console.log('💾 Backup erstellt\n');
  }

  const posts = await runApifyHashtagScraper(HASHTAGS);
  if (posts.length === 0) { console.log('\n⚠️  Keine Posts - beende'); process.exit(0); }

  console.log(`\n🔍 Validiere ${posts.length} Posts...\n`);

  const approvedDeals = [];
  const reviewDeals = [];
  const rejected = {};

  for (const post of posts) {
    const result = validateDeal(post);
    if (result.valid) {
      const deal = createDeal(post, result);
      approvedDeals.push(deal);
      console.log(`   ✅ ${deal.logo} ${deal.title} [Score: ${result.score}]`);
      console.log(`      → ${deal.brand} | ${deal.distance}`);
    } else if (result.review) {
      reviewDeals.push(createDeal(post, result));
    } else {
      rejected[result.reason] = (rejected[result.reason] || 0) + 1;
    }
  }

  const totalRejected = Object.values(rejected).reduce((a, b) => a + b, 0);
  console.log('\n📊 ERGEBNIS:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`   📥 Posts:       ${posts.length}`);
  console.log(`   ✅ Approved:    ${approvedDeals.length}`);
  console.log(`   📝 Review:      ${reviewDeals.length}`);
  console.log(`   ❌ Abgelehnt:   ${totalRejected}`);
  for (const [reason, count] of Object.entries(rejected).sort((a, b) => b[1] - a[1])) {
    console.log(`      → ${reason}: ${count}`);
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (approvedDeals.length > 0 && fs.existsSync(dealsPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(dealsPath, 'utf8'));

      // Abgelaufene IG-Deals entfernen
      const expiryDate = new Date(Date.now() - CONFIG.dealExpiryDays * 24 * 60 * 60 * 1000);
      const before = existing.deals.length;
      existing.deals = existing.deals.filter(d => {
        if (!d.isInstagramDeal) return true;
        return new Date(d.pubDate || 0) > expiryDate;
      });
      const expired = before - existing.deals.length;
      if (expired > 0) console.log(`🗑️  ${expired} abgelaufene IG-Deals entfernt`);

      // Einfügen mit Duplikat-Check
      let added = 0;
      const sorted = approvedDeals.sort((a, b) => b.qualityScore - a.qualityScore).slice(0, CONFIG.maxDealsPerRun);

      for (const deal of sorted) {
        if (!isDuplicate(deal, existing.deals)) {
          existing.deals.push(deal);
          added++;
          console.log(`   ➕ ${deal.logo} ${deal.title}`);
        } else {
          console.log(`   ⏭️  Duplikat: ${deal.title}`);
        }
      }

      // Sortieren
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

      console.log(`\n✅ ${added} neue Instagram-Deals eingefügt`);
      console.log(`📊 Deals total: ${existing.totalDeals}`);
    } catch (e) {
      console.log(`\n❌ Merge fehlgeschlagen: ${e.message}`);
      if (fs.existsSync('docs/deals.backup.json')) {
        fs.copyFileSync('docs/deals.backup.json', dealsPath);
        console.log('🔄 Backup wiederhergestellt');
      }
    }
  } else {
    console.log('📭 Keine neuen Deals - deals.json unverändert');
  }

  if (reviewDeals.length > 0) {
    fs.writeFileSync('docs/deals-review.json', JSON.stringify({
      lastUpdated: new Date().toISOString(),
      info: 'Score 35-49: manuelle Prüfung nötig',
      deals: reviewDeals,
    }, null, 2));
    console.log(`📋 ${reviewDeals.length} Deals in Review-Queue`);
  }

  if (fs.existsSync('docs/deals.backup.json')) fs.unlinkSync('docs/deals.backup.json');

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ Instagram Scraper v2 fertig!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal Error:', err.message);
    if (fs.existsSync('docs/deals.backup.json') && fs.existsSync('docs/deals.json')) {
      fs.copyFileSync('docs/deals.backup.json', 'docs/deals.json');
      console.log('🔄 Backup wiederhergestellt');
    }
    process.exit(0);
  });

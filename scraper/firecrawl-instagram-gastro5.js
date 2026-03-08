// ============================================
// 📸🍽️ FIRECRAWL INSTAGRAM GASTRO AGENT #5
// Fokus: mindestens 30 aktuelle Wiener Gastro-Angebote nur aus Instagram
// ============================================

import Firecrawl from '@mendable/firecrawl-js';
import { z } from 'zod';
import fs from 'fs';

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY5 || process.env.FIRECRAWL_API_KEY;

if (!FIRECRAWL_API_KEY) {
  console.error('❌ FIRECRAWL_API_KEY5 oder FIRECRAWL_API_KEY nicht gesetzt!');
  process.exit(1);
}

const firecrawl = new Firecrawl({ apiKey: FIRECRAWL_API_KEY });

const offerSchema = z.object({
  offers: z.array(z.object({
    restaurant_name: z.string(),
    restaurant_name_citation: z.string().optional(),
    post_url: z.string().describe('The direct URL to the Instagram post.'),
    post_url_citation: z.string().optional(),
    offer_description: z.string(),
    offer_description_citation: z.string().optional(),
    offer_type: z.string(),
    offer_type_citation: z.string().optional(),
    valid_until: z.unknown().optional(),
    valid_until_citation: z.string().optional(),
    location: z.string().optional(),
    location_citation: z.string().optional(),
  })).default([]),
}).describe('Information about free food and drinks offers in Viennese gastronomy exclusively from Instagram');

function stableHash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash = hash >>> 0;
  }
  return hash.toString(36);
}

function dealId(brand, title, url) {
  return `fc5-${stableHash(`${brand}|${title}|${url}`)}`;
}

function normalizeText(value) {
  return (value || '').toString().replace(/\s+/g, ' ').trim();
}

function isInstagramPostUrl(url) {
  return /^https?:\/\/(www\.)?instagram\.com\/(p|reel)\//i.test(normalizeText(url));
}

function looksLikeGiveaway(text) {
  return /(gewinnspiel|giveaway|verlosen|zu gewinnen|tagge|markiere.*freund|kommentiere.*gewinnen|like.*comment)/i.test(text);
}

function normalizeValidUntil(value) {
  if (!value) return '';
  if (typeof value === 'string') return normalizeText(value);
  if (typeof value === 'object') {
    try {
      return normalizeText(JSON.stringify(value));
    } catch {
      return '';
    }
  }
  return normalizeText(String(value));
}

function inferType(offerType, description) {
  const haystack = `${offerType} ${description}`.toLowerCase();
  if (/(1\s*\+\s*1|buy one get one|bogo|2\s*für\s*1|gratis.*beigabe|app[- ]?vorteil|rabatt|coupon|gutschein)/i.test(haystack)) {
    return 'rabatt';
  }
  return 'gratis';
}

function inferCategory(description) {
  const haystack = description.toLowerCase();
  if (/(kaffee|coffee|espresso|latte|cappuccino|tee|matcha)/i.test(haystack)) return 'kaffee';
  return 'essen';
}

async function main() {
  console.log('📸🍽️ FIRECRAWL INSTAGRAM GASTRO AGENT #5');
  console.log('='.repeat(48));
  console.log(`📅 ${new Date().toLocaleString('de-AT')}`);
  console.log();

  const result = await firecrawl.agent({
    prompt: "Extrahiere mindestens 30 aktuelle Angebote für kostenlose Speisen und Getränke in der Wiener Gastronomie AUSSCHLIEẞLICH aus Instagram-Posts der letzten 7 Tage. \n\nPriorisierung:\n1. Höchste Priorität: Komplett kostenlose Angebote ohne Kaufzwang.\n2. Zweite Priorität: 'Buy One Get One Free' (1+1 gratis) Aktionen.\n3. Dritte Priorität: Gratis-Beigaben (z.B. kostenloser Kaffee zum Hauptgericht oder Vorteile für App-Nutzer).\n\nRegeln:\n- Nutze NUR Instagram als Quelle. Schließe Facebook, Preisjäger, Neotaste oder andere Webseiten explizit aus.\n- Schließe Gewinnspiele (Giveaways) explizit aus.\n- Nur Angebote in Wien.\n- Extrahiere nur Angebote, deren 'valid_until' in der Zukunft liegt oder nicht genannt wird.\n- Vermeide Duplikate.\n- Nutze Suchbegriffe wie 'gratis', 'kostenlos', 'free', '1+1' in Verbindung mit 'Wien' auf Instagram.",
    schema: offerSchema,
    model: 'spark-1-mini',
  });

  const rawOffers = result?.data?.offers || [];
  const deals = [];
  const seenUrls = new Set();

  console.log(`🔍 Agent returned ${rawOffers.length} Rohangebote`);

  for (const offer of rawOffers) {
    const restaurant = normalizeText(offer.restaurant_name) || 'Instagram Gastro';
    const postUrl = normalizeText(offer.post_url);
    const description = normalizeText(offer.offer_description);
    const offerType = normalizeText(offer.offer_type);
    const location = normalizeText(offer.location) || 'Wien';
    const validUntil = normalizeValidUntil(offer.valid_until);
    const combinedText = `${restaurant} ${description} ${offerType} ${location} ${validUntil}`;

    if (!postUrl || !isInstagramPostUrl(postUrl)) continue;
    if (seenUrls.has(postUrl)) continue;
    if (looksLikeGiveaway(combinedText)) continue;
    if (!/wien|vienna/i.test(location) && !/wien|vienna/i.test(combinedText)) continue;

    seenUrls.add(postUrl);

    const type = inferType(offerType, description);
    const category = inferCategory(`${offerType} ${description}`);
    const title = `${restaurant}: ${description || offerType || 'Instagram-Angebot'}`.slice(0, 140);
    const expires = validUntil || 'Kurzfristig / siehe Post';

    deals.push({
      id: dealId(restaurant, title, postUrl),
      brand: restaurant,
      title,
      description: [description, offerType, location].filter(Boolean).join(' | '),
      type,
      category,
      source: 'Firecrawl Instagram Gastro #5',
      url: postUrl,
      expires,
      distance: location,
      hot: true,
      isNew: true,
      priority: type === 'gratis' ? 1 : 2,
      votes: 1,
      qualityScore: 80,
      pubDate: new Date().toISOString(),
    });
  }

  console.log(`✅ Final: ${deals.length} Deals`);

  const output = {
    lastUpdated: new Date().toISOString(),
    source: 'firecrawl5',
    totalDeals: deals.length,
    deals,
  };

  const outputPath = 'docs/deals-pending-firecrawl5.json';
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`💾 ${deals.length} Deals → ${outputPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
  });

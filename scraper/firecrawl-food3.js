// ============================================
// 🍔🔥 FIRECRAWL FOOD AGENT #2
// Fokus: Instagram-Angebote für Essen & Getränke in Wien
// ============================================

import Firecrawl from '@mendable/firecrawl-js';
import { z } from 'zod';
import fs from 'fs';

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY2 || process.env.FIRECRAWL_API_KEY;

if (!FIRECRAWL_API_KEY) {
  console.error('❌ FIRECRAWL_API_KEY2 oder FIRECRAWL_API_KEY nicht gesetzt!');
  process.exit(1);
}

const firecrawl = new Firecrawl({ apiKey: FIRECRAWL_API_KEY });

const schema = z.object({
  offers: z.array(z.object({
    provider_name: z.string(),
    provider_name_citation: z.string().optional(),
    product_type: z.string(),
    product_type_citation: z.string().optional(),
    location: z.string(),
    location_citation: z.string().optional(),
    times: z.string(),
    times_citation: z.string().optional(),
    participation_conditions: z.string(),
    participation_conditions_citation: z.string().optional(),
    offer_type: z.string(),
    offer_type_citation: z.string().optional(),
    post_url: z.string(),
    post_url_citation: z.string().optional(),
  })).default([]),
});

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function stableHash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i += 1) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash >>>= 0;
  }
  return hash.toString(36);
}

function dealId(prefix, brand, title, url) {
  return `${prefix}-${stableHash(`${brand}|${title}|${url}`)}`;
}

function isInstagramPostUrl(url) {
  return /^https?:\/\/(www\.)?instagram\.com\/(p|reel)\//i.test(normalizeText(url));
}

function looksVienna(text) {
  return /(wien|vienna|\b10\d{2}\b|\b11\d{2}\b|\b12\d{2}\b)/i.test(text);
}

function inferType(offerType, details) {
  const haystack = `${normalizeText(offerType)} ${normalizeText(details)}`;
  if (/(gewinnspiel|giveaway|verlosung|zu gewinnen|tagge|markiere|kommentiere.*gewinn)/i.test(haystack)) {
    return 'event';
  }
  if (/(1\s*\+\s*1|2\s*für\s*1|2 for 1|buy one get one|bogo)/i.test(haystack)) {
    return 'bogo';
  }
  if (/(gratis|kostenlos|free|umsonst|0 ?€)/i.test(haystack)) {
    return 'gratis';
  }
  return 'rabatt';
}

function inferCategory(productType, details) {
  const haystack = `${normalizeText(productType)} ${normalizeText(details)}`;
  if (/(kaffee|coffee|espresso|latte|cappuccino|tee|matcha|drink|getränk|getraenk|smoothie|saft|cocktail|spritz|bier|beer|wein|wine)/i.test(haystack)) {
    return 'kaffee';
  }
  return 'essen';
}

function getEmoji(category, type, text) {
  if (type === 'bogo') return '1+1';
  if (type === 'event') return '🎉';
  if (category === 'kaffee') return '☕';
  if (/pizza/i.test(text)) return '🍕';
  if (/burger/i.test(text)) return '🍔';
  if (/kebab|döner|doener|falafel/i.test(text)) return '🥙';
  if (/eis|gelato/i.test(text)) return '🍦';
  return type === 'gratis' ? '🎁' : '🍽️';
}

async function main() {
  console.log('🍔🔥 FIRECRAWL FOOD AGENT #2');
  console.log('='.repeat(40));
  console.log(`📅 ${new Date().toLocaleString('de-AT')}`);
  console.log();

  const result = await firecrawl.agent({
    prompt: "Extrahiere aktuelle Angebote für kostenloses Essen und Getränke in Wien von Instagram, die maximal 7 Tage alt sind. Suche über relevante Hashtags und schließe sowohl Direktangebote als auch Gewinnspiele und 1+1 Gratis-Aktionen (Kaufzwang) ein. Erfasse Anbietername, Produktart, Standort, Uhrzeiten, Teilnahmebedingungen sowie die Unterscheidung zwischen Gewinnspiel und Direktangebot. Erfasse zwingend den direkten Link zum Instagram-Post im Feld 'post_url'. Es dürfen nur Instagram-Links (instagram.com/p/... oder instagram.com/reel/...) aufgenommen werden; ignoriere Angebote von anderen Plattformen wie TikTok oder News-Websites.",
    schema,
    model: 'spark-1-pro',
  });

  const rawOffers = result?.data?.offers || [];
  console.log(`📦 Rohangebote: ${rawOffers.length}`);

  const seenUrls = new Set();
  const deals = [];

  for (const offer of rawOffers) {
    const providerName = normalizeText(offer.provider_name) || 'Instagram';
    const productType = normalizeText(offer.product_type);
    const location = normalizeText(offer.location) || 'Wien';
    const times = normalizeText(offer.times);
    const conditions = normalizeText(offer.participation_conditions);
    const offerTypeText = normalizeText(offer.offer_type);
    const postUrl = normalizeText(offer.post_url);
    const combined = `${providerName} ${productType} ${location} ${times} ${conditions} ${offerTypeText}`;

    if (!postUrl || !isInstagramPostUrl(postUrl)) continue;
    if (seenUrls.has(postUrl)) continue;
    if (!looksVienna(combined)) continue;

    seenUrls.add(postUrl);

    const type = inferType(offerTypeText, `${productType} ${conditions}`);
    const category = inferCategory(productType, `${offerTypeText} ${conditions}`);
    const titleCore = productType || offerTypeText || 'Instagram-Angebot';
    const title = `${providerName}: ${titleCore}`.slice(0, 140);
    const description = [offerTypeText, productType, location, times, conditions]
      .filter(Boolean)
      .join(' | ')
      .slice(0, 400);

    deals.push({
      id: dealId('food3', providerName, title, postUrl),
      brand: providerName,
      title,
      logo: getEmoji(category, type, `${title} ${description}`),
      description: description || `${providerName} | ${location}`,
      type,
      category,
      source: 'Firecrawl Food #2',
      url: postUrl,
      expires: times || 'Siehe Post',
      distance: location,
      hot: type === 'gratis' || type === 'bogo',
      isNew: true,
      priority: type === 'gratis' ? 2 : type === 'bogo' ? 3 : 4,
      votes: 1,
      qualityScore: type === 'gratis' ? 72 : type === 'bogo' ? 70 : 58,
      pubDate: new Date().toISOString(),
      pubDateSource: 'firecrawlAgentRun',
    });
  }

  const output = {
    lastUpdated: new Date().toISOString(),
    source: 'firecrawl-food3',
    totalDeals: deals.length,
    deals,
  };

  fs.writeFileSync('docs/deals-pending-food3.json', JSON.stringify(output, null, 2));
  console.log(`✅ Final: ${deals.length} Deals`);
  console.log('💾 Deals → docs/deals-pending-food3.json');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
  });

// ============================================
// 📸🔥 FIRECRAWL INSTAGRAM DIRECT AGENT #4
// Fokus: aktuelle Gratis-/1+1-Angebote für Essen & Getränke in Wien
// ============================================

import Firecrawl from '@mendable/firecrawl-js';
import { z } from 'zod';
import fs from 'fs';

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY4 || process.env.FIRECRAWL_API_KEY;

if (!FIRECRAWL_API_KEY) {
  console.error('❌ FIRECRAWL_API_KEY4 oder FIRECRAWL_API_KEY nicht gesetzt!');
  process.exit(1);
}

const firecrawl = new Firecrawl({ apiKey: FIRECRAWL_API_KEY });

const offerSchema = z.object({
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
    offer_details: z.string().describe('Details zum Direktangebot oder der 1+1 Aktion (keine Gewinnspiele).'),
    offer_details_citation: z.string().optional(),
    post_url: z.string().describe('The direct URL to the Instagram post or reel.'),
    post_url_citation: z.string().optional(),
  })).default([]),
});

function stableHash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash = hash >>> 0;
  }
  return hash.toString(36);
}

function dealId(brand, title, url) {
  return `fc4-${stableHash(`${brand}|${title}|${url}`)}`;
}

function normalizeText(value) {
  return (value || '').toString().replace(/\s+/g, ' ').trim();
}

function isInstagramPostUrl(url) {
  return /^https?:\/\/(www\.)?instagram\.com\/(p|reel)\//i.test(normalizeText(url));
}

function looksLikeGiveaway(text) {
  return /(gewinnspiel|giveaway|verlosen|zu gewinnen|markiere.*freund|like.*comment|kommentiere.*gewinnen)/i.test(text);
}

function inferType(offerDetails, participationConditions) {
  const haystack = `${offerDetails} ${participationConditions}`;
  if (/(1\s*\+\s*1|2\s*für\s*1|kauf.*gratis|bonus|rabatt|-%|prozent|coupon|gutschein)/i.test(haystack)) {
    return 'rabatt';
  }
  return 'gratis';
}

function inferCategory(productType, offerDetails) {
  const haystack = `${productType} ${offerDetails}`.toLowerCase();
  if (/(kaffee|coffee|espresso|latte|cappuccino|tee|matcha|drink|getränk|smoothie|saft)/i.test(haystack)) {
    return 'kaffee';
  }
  return 'essen';
}

async function runAgent() {
  return firecrawl.agent({
    prompt: "Extrahiere aktuelle Angebote für kostenloses Essen und Getränke in Wien von Instagram, die maximal 7 Tage alt sind. Schließe Gewinnspiele (Giveaways) strikt aus. Konzentriere dich auf Direktangebote (z.B. 'Gratis-Kostprobe'), 1+1 Gratis-Aktionen (Kaufzwang), Neueröffnungen mit Gratis-Specials und zeitlich begrenzte Events. Erfasse Anbietername, Produktart, Standort, Uhrzeiten, Teilnahmebedingungen sowie das konkrete Angebot. Erfasse zwingend den direkten Link zum Instagram-Post im Feld 'post_url'. Es dürfen nur Instagram-Links (instagram.com/p/... oder instagram.com/reel/...) aufgenommen werden; ignoriere Angebote von anderen Plattformen.",
    schema: offerSchema,
    model: 'spark-1-pro',
  });
}

async function main() {
  console.log('📸🔥 FIRECRAWL INSTAGRAM DIRECT AGENT #4');
  console.log('='.repeat(48));
  console.log(`📅 ${new Date().toLocaleString('de-AT')}`);
  console.log();

  const result = await runAgent();
  const rawOffers = result?.data?.offers || [];
  const deals = [];
  const seenUrls = new Set();

  console.log(`🔍 Agent returned ${rawOffers.length} Rohangebote`);

  for (const offer of rawOffers) {
    const provider = normalizeText(offer.provider_name);
    const productType = normalizeText(offer.product_type);
    const location = normalizeText(offer.location) || 'Wien';
    const times = normalizeText(offer.times);
    const participation = normalizeText(offer.participation_conditions);
    const details = normalizeText(offer.offer_details);
    const postUrl = normalizeText(offer.post_url);
    const combinedText = `${provider} ${productType} ${location} ${times} ${participation} ${details}`;

    if (!postUrl || !isInstagramPostUrl(postUrl)) continue;
    if (seenUrls.has(postUrl)) continue;
    if (looksLikeGiveaway(combinedText)) continue;
    if (!/wien|vienna/i.test(location) && !/wien|vienna/i.test(combinedText)) continue;

    seenUrls.add(postUrl);

    const type = inferType(details, participation);
    const category = inferCategory(productType, details);
    const titleCore = details || productType || 'Instagram-Angebot';
    const title = `${provider}: ${titleCore}`.slice(0, 140);
    const descriptionParts = [
      productType,
      details,
      location,
      times ? `Zeit: ${times}` : '',
      participation ? `Bedingungen: ${participation}` : '',
    ].filter(Boolean);

    deals.push({
      id: dealId(provider || 'instagram', title, postUrl),
      brand: provider || 'Instagram',
      title,
      description: descriptionParts.join(' | '),
      type,
      category,
      source: 'Firecrawl Instagram Direct #4',
      url: postUrl,
      expires: times || 'Kurzfristig / siehe Post',
      distance: location,
      hot: true,
      isNew: true,
      priority: type === 'gratis' ? 2 : 3,
      votes: 1,
      qualityScore: 78,
      pubDate: new Date().toISOString(),
    });
  }

  console.log(`✅ Final: ${deals.length} Deals`);

  const output = {
    lastUpdated: new Date().toISOString(),
    source: 'firecrawl4',
    totalDeals: deals.length,
    deals,
  };

  const outputPath = 'docs/deals-pending-firecrawl4.json';
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`💾 ${deals.length} Deals → ${outputPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
  });

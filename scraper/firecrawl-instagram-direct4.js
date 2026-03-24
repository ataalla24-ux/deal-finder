// ============================================
// 📸🔥 FIRECRAWL INSTAGRAM DIRECT AGENT #4
// Fokus: aktuelle Gratis-/1+1-Angebote für Essen & Getränke in Wien
// ============================================

import Firecrawl from '@mendable/firecrawl-js';
import { z } from 'zod';
import fs from 'fs';

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY4 || process.env.FIRECRAWL_API_KEY;
const MAX_POST_AGE_DAYS = (() => {
  const parsed = Number(process.env.FC4_MAX_AGE_DAYS || 3);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
})();

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
    post_date: z.string().describe('The publish date of the Instagram post.'),
    post_date_citation: z.string().optional(),
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
  if (/(kaffee|coffee|espresso|latte|cappuccino|tee|matcha|drink|getränk|smoothie|saft|bubble tea|cocktail|spritz|beer|bier|wein|wine)/i.test(haystack)) {
    return 'kaffee';
  }
  return 'essen';
}

function parseGermanDate(str) {
  if (!str || typeof str !== 'string') return null;
  const s = str.trim();
  let m = s.match(/vor\s+(\d+)\s+tag/i);
  if (m) {
    const d = new Date();
    d.setDate(d.getDate() - Number(m[1]));
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0));
  }
  m = s.match(/(\d+)\s+d(?:ays?)?\s+ago/i);
  if (m) {
    const d = new Date();
    d.setDate(d.getDate() - Number(m[1]));
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0));
  }
  m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0));
  m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (m) {
    const year = m[3].length === 2 ? Number(`20${m[3]}`) : Number(m[3]);
    return new Date(Date.UTC(year, Number(m[2]) - 1, Number(m[1]), 12, 0, 0));
  }
  return null;
}

function isNotTooOld(dateObj) {
  if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return false;
  const cutoff = Date.now() - MAX_POST_AGE_DAYS * 24 * 60 * 60 * 1000;
  return dateObj.getTime() >= cutoff;
}

function isKey4Relevant(productType, offerDetails, participationConditions) {
  const haystack = `${productType} ${offerDetails} ${participationConditions}`.toLowerCase();
  const directSignals = /(kaffee|coffee|espresso|latte|cappuccino|matcha|tee|drink|getränk|smoothie|saft|bubble tea|cocktail|spritz|bier|beer|wein|wine|dessert|croissant|pastry|donut|cookie|cake|eis|gelato|ice cream|bakery|brunch|breakfast|frühstück|fruehstueck)/i.test(haystack);
  const promoSignals = /(opening|neueröffnung|neueroeffnung|eröffnung|eroeffnung|launch|soft opening|grand opening|welcome gift|goodie|gratisprobe|free sample|tasting|verkostung|app[- ]?bonus|download.*app|nur heute|only today|first \d+|erste[nr]? \d+|solange.*vorrat)/i.test(haystack);
  const freebieSignals = /(gratis|kostenlos|free|freebie|geschenkt|0 ?€|1\+1|2\s*für\s*1|2 for 1|bogo)/i.test(haystack);
  const heavyMealOnly = /(döner|doener|kebab|kebap|pizza|burger|sushi|restaurant deal|mittagessen|hauptspeise|meal deal)/i.test(haystack)
    && !directSignals
    && !promoSignals;

  if (heavyMealOnly) return false;
  return directSignals || (promoSignals && freebieSignals);
}

async function runAgent() {
  return firecrawl.agent({
    prompt: `Extrahiere aktuelle Wiener Instagram-Angebote, die maximal ${MAX_POST_AGE_DAYS} Tage alt sind. \n\nFokus von Key 4:\n- Coffee-, Drink-, Dessert-, Bakery- und Brunch-Freebies\n- Neueröffnungen mit Welcome Gift, Gratisprobe oder App-Bonus\n- kurzfristige Promo-Posts wie 'nur heute', 'erste 50 Kunden', 'solange der Vorrat reicht'\n- leichte Consumables und kleine Treats statt klassischer großer Gastro-Deals\n\nWICHTIG:\n- Nutze nur Instagram als Quelle.\n- Nur direkte Instagram-Post- oder Reel-URLs.\n- Schließe Gewinnspiele strikt aus.\n- Nur Wien.\n- Erfasse zwingend das Veröffentlichungsdatum im Feld 'post_date'. Wenn das Datum nicht belastbar erkennbar ist oder älter als ${MAX_POST_AGE_DAYS} Tage ist, lasse den Deal weg.\n- Priorisiere Coffee/Drink/Dessert/Openings/App-Freebies stärker als klassische Restaurantdeals.\n- Erfasse Anbietername, Produktart, Standort, Uhrzeiten, Teilnahmebedingungen, Angebotsdetails und den direkten Post-Link.`,
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
    const postDateRaw = normalizeText(offer.post_date);
    const times = normalizeText(offer.times);
    const participation = normalizeText(offer.participation_conditions);
    const details = normalizeText(offer.offer_details);
    const postUrl = normalizeText(offer.post_url);
    const combinedText = `${provider} ${productType} ${location} ${postDateRaw} ${times} ${participation} ${details}`;
    const postDate = parseGermanDate(postDateRaw);

    if (!postUrl || !isInstagramPostUrl(postUrl)) continue;
    if (seenUrls.has(postUrl)) continue;
    if (looksLikeGiveaway(combinedText)) continue;
    if (!/wien|vienna/i.test(location) && !/wien|vienna/i.test(combinedText)) continue;
    if (!postDate || !isNotTooOld(postDate)) continue;
    if (!isKey4Relevant(productType, details, participation)) continue;

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
      pubDate: postDate.toISOString(),
      pubDateSource: 'socialPostDate',
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

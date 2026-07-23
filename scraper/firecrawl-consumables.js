import '../sentry/instrument.mjs';
// ============================================
// 🔥 FIRECRAWL KEY 3 - INSTAGRAM CONSUMABLE OFFERS
// Breiter Intake ohne harte Freshness-/Promo-Gates
// ============================================

import Firecrawl from '@mendable/firecrawl-js';
import { z } from 'zod';
import fs from 'fs';
import { verifyFirecrawlDeals } from './firecrawl-post-verifier.js';

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY3 || process.env.FIRECRAWL_API_KEY;
const MAX_POST_AGE_DAYS = (() => {
  const parsed = Number(process.env.FC3_MAX_AGE_DAYS || 2);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2;
})();

if (!FIRECRAWL_API_KEY) {
  console.error('❌ FIRECRAWL_API_KEY3 oder FIRECRAWL_API_KEY nicht gesetzt!');
  process.exit(1);
}

const firecrawl = new Firecrawl({ apiKey: FIRECRAWL_API_KEY });

const key3Schema = z.object({
  posts: z.array(z.object({
    validity_period: z.string().describe('Date and time range the offer is valid for'),
    validity_period_citation: z.string().optional(),
    location: z.string().describe('Exact location of the event/restaurant in Vienna'),
    location_citation: z.string().optional(),
    food_and_drinks: z.string().describe('Type of food and drinks offered'),
    food_and_drinks_citation: z.string().optional(),
    original_post_url: z.string().describe('URL of the original Instagram post'),
    original_post_url_citation: z.string().optional(),
    post_timestamp: z.string().describe("The relative or absolute publication time like 'vor 5 Stunden'"),
    post_timestamp_citation: z.string().optional(),
    offer_type: z.string().describe('The specific type of deal found in the post'),
    offer_type_citation: z.string().optional(),
    owner_username: z.string().describe('The Instagram username that published the original post').optional(),
    owner_username_citation: z.string().optional(),
  })).default([]),
}).describe('Instagram posts about consumable offers with location, timing and direct post URLs');

function normalizeText(value) {
  return (value || '').toString().replace(/\s+/g, ' ').trim();
}

function stableHash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i += 1) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash = hash >>> 0;
  }
  return hash.toString(36);
}

function dealId(brand, title, url) {
  return `fc3-${stableHash(`${brand}|${title}|${url}`)}`;
}

function isInstagramPostUrl(url) {
  return /^https?:\/\/(www\.)?instagram\.com\/(p|reel)\//i.test(normalizeText(url));
}

function looksLikeGiveaway(text) {
  return /(gewinnspiel|giveaway|verlosen|zu gewinnen|markiere.*freund|tagge.*freund|kommentiere.*gewinnen|like.*comment)/i.test(text);
}

function hasRequiredOfferSignal(text) {
  return /(gratis|kostenlos|1\s*\+\s*1|2\s*für\s*1|2\s*for\s*1|bogo)/i.test(text);
}

function looksLikePureRestaurantIntro(text) {
  return /(neueröffnung|neueroeffnung|eröffnung|eroeffnung|opening)/i.test(text)
    && !hasRequiredOfferSignal(text);
}

function isViennaRelevant(text) {
  return /(wien|vienna|1010|1020|1030|1040|1050|1060|1070|1080|1090|1100|1110|1120|1130|1140|1150|1160|1170|1180|1190|1200|1210|1220|1230)/i.test(text);
}

function parsePostTimestamp(raw) {
  const text = normalizeText(raw).toLowerCase();
  if (!text) return null;

  let match = text.match(/vor\s+(\d+)\s+stund/i);
  if (match) {
    const d = new Date();
    d.setHours(d.getHours() - Number(match[1]));
    return d;
  }

  match = text.match(/(\d+)\s*h(?:ours?)?\s+ago/i);
  if (match) {
    const d = new Date();
    d.setHours(d.getHours() - Number(match[1]));
    return d;
  }

  match = text.match(/vor\s+(\d+)\s+tag/i);
  if (match) {
    const d = new Date();
    d.setDate(d.getDate() - Number(match[1]));
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0));
  }

  match = text.match(/(\d+)\s+d(?:ays?)?\s+ago/i);
  if (match) {
    const d = new Date();
    d.setDate(d.getDate() - Number(match[1]));
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0));
  }

  match = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0));

  match = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (match) {
    const year = match[3].length === 2 ? Number(`20${match[3]}`) : Number(match[3]);
    return new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[1]), 12, 0, 0));
  }

  return null;
}

function isFresh(dateObj) {
  if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return false;
  const cutoff = Date.now() - MAX_POST_AGE_DAYS * 24 * 60 * 60 * 1000;
  return dateObj.getTime() >= cutoff;
}

function inferType(offerType) {
  return /(1\s*\+\s*1|2\s*für\s*1|2\s*for\s*1|bogo)/i.test(offerType) ? 'bogo' : 'gratis';
}

function inferCategory(foodAndDrinks, offerType) {
  const haystack = `${foodAndDrinks} ${offerType}`.toLowerCase();
  if (/(kaffee|coffee|espresso|latte|cappuccino|tee|matcha|drink|cocktail|smoothie|bubble tea|bier|beer|wein|wine)/i.test(haystack)) {
    return 'kaffee';
  }
  return 'essen';
}

async function main() {
  console.log('🔥 FIRECRAWL KEY 3 - VERIFIED INSTAGRAM FREEBIES');
  console.log('='.repeat(52));
  console.log(`📅 ${new Date().toLocaleString('de-AT')}`);
  console.log();

  const result = await firecrawl.agent({
    prompt: `Extrahiere Instagram-Posts über Angebote rund um Essen und Getränke. Schließe keine Kandidaten wegen Alter, Giveaway-Charakter, Standort oder fehlender Signalwörter aus. Erfasse pro Post möglichst den Gültigkeitszeitraum, den Standort, die Art der Speisen/Getränke, die URL des Original-Posts, den Account-Handle sowie den Veröffentlichungszeitpunkt. Verwechsle das Veröffentlichungsdatum nicht mit dem Angebotszeitraum. Wenn Informationen unklar sind, gib trotzdem den Kandidaten mit den besten verfügbaren Feldern zurück.`,
    schema: key3Schema,
    model: 'spark-1-mini',
  });

  const rawPosts = result?.data?.posts || [];
  const deals = [];

  console.log(`🔍 Agent returned ${rawPosts.length} Rohposts`);

  for (const post of rawPosts) {
    const validityPeriod = normalizeText(post.validity_period);
    const location = normalizeText(post.location);
    const foodAndDrinks = normalizeText(post.food_and_drinks);
    const originalPostUrl = normalizeText(post.original_post_url);
    const postTimestampRaw = normalizeText(post.post_timestamp);
    const offerType = normalizeText(post.offer_type);
    const ownerUsername = normalizeText(post.owner_username).replace(/^@/, '').toLowerCase();

    if (!originalPostUrl || !isInstagramPostUrl(originalPostUrl)) continue;

    const brand = ownerUsername || location.split(',')[0] || 'Instagram';
    const titleCore = offerType || foodAndDrinks || 'Instagram Freebie';
    const title = `${brand}: ${titleCore}`.slice(0, 140);
    const type = inferType(offerType);
    const category = inferCategory(foodAndDrinks, offerType);
    deals.push({
      id: dealId(brand, title, originalPostUrl),
      brand,
      title,
      description: [foodAndDrinks, offerType, location].filter(Boolean).join(' | '),
      type,
      category,
      source: 'Firecrawl Key 3 - Consumables',
      url: originalPostUrl,
      expires: '',
      expiresOriginal: validityPeriod,
      expiryDisplayText: validityPeriod,
      distance: location,
      hot: true,
      isNew: true,
      priority: type === 'gratis' ? 1 : 2,
      votes: 1,
      qualityScore: type === 'gratis' ? 84 : 78,
      ownerUsername,
      reportedPostDate: postTimestampRaw,
    });
  }

  const verifiedDeals = await verifyFirecrawlDeals(deals, {
    sourceKey: 'firecrawl-key3-consumables',
  });

  console.log(`✅ Final: ${verifiedDeals.length} Deals`);

  const output = {
    lastUpdated: new Date().toISOString(),
    source: 'firecrawl3',
    totalDeals: verifiedDeals.length,
    deals: verifiedDeals,
  };

  const outputPath = 'docs/deals-pending-firecrawl2.json';
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`💾 ${verifiedDeals.length} Deals → ${outputPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
  });

import '../sentry/instrument.mjs';
// ============================================
// 📸🍽️ FIRECRAWL INSTAGRAM GASTRO AGENT #5
// Breiter Intake für Gastro-Angebote aus Instagram
// ============================================

import Firecrawl from '@mendable/firecrawl-js';
import { z } from 'zod';
import fs from 'fs';
import { verifyFirecrawlDeals } from './firecrawl-post-verifier.js';

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY5 || process.env.FIRECRAWL_API_KEY;
const MAX_POST_AGE_DAYS = (() => {
  const parsed = Number(process.env.FC5_MAX_AGE_DAYS || 1);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
})();

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
    post_date: z.string().describe('The publish date of the Instagram post.'),
    post_date_citation: z.string().optional(),
    offer_description: z.string(),
    offer_description_citation: z.string().optional(),
    offer_type: z.string(),
    offer_type_citation: z.string().optional(),
    valid_until: z.unknown().optional(),
    valid_until_citation: z.string().optional(),
    location: z.string().optional(),
    location_citation: z.string().optional(),
    owner_username: z.string().describe('Instagram username that published the original post').optional(),
    owner_username_citation: z.string().optional(),
  })).default([]),
}).describe('Information about gastro offers from Instagram posts');

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

async function main() {
  console.log('📸🍽️ FIRECRAWL INSTAGRAM GASTRO AGENT #5');
  console.log('='.repeat(48));
  console.log(`📅 ${new Date().toLocaleString('de-AT')}`);
  console.log();

  const result = await firecrawl.agent({
    prompt: `Extrahiere möglichst viele Gastro-Angebote aus Instagram-Posts. Schließe Kandidaten nicht wegen Alter, Standort, Giveaway-Charakter, unklarem Veröffentlichungsdatum oder unklarem Ablauf aus. Nutze nur Instagram als Quelle und gib für jeden Kandidaten nach Möglichkeit Restaurantname, Post-URL, Account-Handle, echtes Post-Datum, Beschreibung, Angebotstyp, Ablauf und Standort zurück. Verwechsle Veröffentlichungsdatum und Angebotszeitraum nicht. Im Zweifel lieber den Kandidaten trotzdem aufnehmen.`,
    schema: offerSchema,
    model: 'spark-1-mini',
  });

  const rawOffers = result?.data?.offers || [];
  const deals = [];

  console.log(`🔍 Agent returned ${rawOffers.length} Rohangebote`);

  for (const offer of rawOffers) {
    const restaurant = normalizeText(offer.restaurant_name) || 'Instagram Gastro';
    const postUrl = normalizeText(offer.post_url);
    const description = normalizeText(offer.offer_description);
    const offerType = normalizeText(offer.offer_type);
    const location = normalizeText(offer.location);
    const validUntil = normalizeValidUntil(offer.valid_until);
    const postDateRaw = normalizeText(offer.post_date);
    const ownerUsername = normalizeText(offer.owner_username).replace(/^@/, '').toLowerCase();

    if (!postUrl || !isInstagramPostUrl(postUrl)) continue;

    const type = inferType(offerType, description);
    const category = inferCategory(`${offerType} ${description}`);
    const title = `${restaurant}: ${description || offerType || 'Instagram-Angebot'}`.slice(0, 140);
    const expires = validUntil;

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
      expiresOriginal: validUntil,
      distance: location,
      hot: true,
      isNew: true,
      priority: type === 'gratis' ? 1 : 2,
      votes: 1,
      qualityScore: 80,
      ownerUsername,
      reportedPostDate: postDateRaw,
    });
  }

  const verifiedDeals = await verifyFirecrawlDeals(deals, {
    sourceKey: 'firecrawl-key5-instagram-gastro',
  });

  console.log(`✅ Final: ${verifiedDeals.length} Deals`);

  const output = {
    lastUpdated: new Date().toISOString(),
    source: 'firecrawl5',
    totalDeals: verifiedDeals.length,
    deals: verifiedDeals,
  };

  const outputPath = 'docs/deals-pending-firecrawl5.json';
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`💾 ${verifiedDeals.length} Deals → ${outputPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
  });

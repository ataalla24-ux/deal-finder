import '../sentry/instrument.mjs';
// ============================================
// 📸🔥 FIRECRAWL INSTAGRAM DIRECT AGENT #4
// Code-1 Agent: Instagram-only Free Food & Drink Offers
// ============================================

import Firecrawl from '@mendable/firecrawl-js';
import { z } from 'zod';
import fs from 'fs';
import { verifyFirecrawlDeals } from './firecrawl-post-verifier.js';

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY4 || process.env.FIRECRAWL_API_KEY;
const MAX_POST_AGE_DAYS = (() => {
  const parsed = Number(process.env.FC4_MAX_AGE_DAYS || 7);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 7;
})();

if (!FIRECRAWL_API_KEY) {
  console.error('❌ FIRECRAWL_API_KEY4 oder FIRECRAWL_API_KEY nicht gesetzt!');
  process.exit(1);
}

const firecrawl = new Firecrawl({ apiKey: FIRECRAWL_API_KEY });

const offerSchema = z.object({
  offers: z.array(z.object({
    restaurant_name: z.string(),
    restaurant_name_citation: z.string().describe('Source URL for restaurant_name').optional(),
    post_url: z.string(),
    post_url_citation: z.string().describe('Source URL for post_url').optional(),
    offer_description: z.string(),
    offer_description_citation: z.string().describe('Source URL for offer_description').optional(),
    offer_type: z.string(),
    offer_type_citation: z.string().describe('Source URL for offer_type').optional(),
    valid_until: z.string().describe("Das konkrete Datum oder 'nicht angegeben'. Falls ein relatives Datum wie 'nur heute' im Post steht, berechne das tatsächliche Datum basierend auf dem Post-Erstellungsdatum."),
    valid_until_citation: z.string().describe('Source URL for valid_until').optional(),
    is_currently_valid: z.boolean().describe('True, wenn das Angebot heute noch gültig ist oder kein Enddatum hat.'),
    is_currently_valid_citation: z.string().describe('Source URL for is_currently_valid').optional(),
    location: z.string(),
    location_citation: z.string().describe('Source URL for location').optional(),
    owner_username: z.string().describe('Instagram username that published the original post').optional(),
    owner_username_citation: z.string().optional(),
    post_date: z.string().describe('Publication date of the original Instagram post').optional(),
    post_date_citation: z.string().optional(),
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

function dealId(brand, title, url) {
  return `fc4-${stableHash(`${brand}|${title}|${url}`)}`;
}

function isInstagramPostUrl(url) {
  return /^https?:\/\/(www\.)?instagram\.com\/(p|reel)\//i.test(normalizeText(url));
}

function parseFlexibleDate(raw) {
  const text = normalizeText(raw);
  if (!text) return null;

  let match = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (match) {
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0));
    if (!Number.isNaN(date.getTime())) return date;
  }

  match = text.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b/);
  if (match) {
    const year = match[3].length === 2 ? Number(`20${match[3]}`) : Number(match[3]);
    const date = new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[1]), 12, 0, 0));
    if (!Number.isNaN(date.getTime())) return date;
  }

  match = text.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  if (match) {
    const date = new Date(Date.UTC(Number(match[3]), Number(match[1]) - 1, Number(match[2]), 12, 0, 0));
    if (!Number.isNaN(date.getTime())) return date;
  }

  match = text.match(/vor\s+(\d+)\s+stund/i);
  if (match) {
    const date = new Date();
    date.setHours(date.getHours() - Number(match[1]));
    return date;
  }

  match = text.match(/(\d+)\s*h(?:ours?)?\s*ago\b/i);
  if (match) {
    const date = new Date();
    date.setHours(date.getHours() - Number(match[1]));
    return date;
  }

  match = text.match(/vor\s+(\d+)\s+tag/i);
  if (match) {
    const date = new Date();
    date.setDate(date.getDate() - Number(match[1]));
    return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0));
  }

  match = text.match(/\b(\d+)\s*d(?:ays?)?\s*ago\b/i);
  if (match) {
    const date = new Date();
    date.setDate(date.getDate() - Number(match[1]));
    return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0));
  }

  if (/heute|today/i.test(text)) {
    return new Date();
  }

  if (/gestern|yesterday/i.test(text)) {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return date;
  }

  return null;
}

function isFreshPost(postDate) {
  if (!(postDate instanceof Date) || Number.isNaN(postDate.getTime())) return false;
  const cutoff = Date.now() - MAX_POST_AGE_DAYS * 24 * 60 * 60 * 1000;
  return postDate.getTime() >= cutoff;
}

function looksLikeGiveaway(text) {
  return /(gewinnspiel|giveaway|verlosung|zu gewinnen|markiere.*freund|tagge.*freund|kommentiere.*gewinnen|comment.*win)/i.test(text);
}

function isViennaRelevant(text) {
  return /(wien|vienna|\b10\d{2}\b|\b11\d{2}\b|\b12\d{2}\b)/i.test(text);
}

function inferType(offerType, description) {
  const haystack = `${normalizeText(offerType)} ${normalizeText(description)}`;
  if (/(1\s*\+\s*1|2\s*für\s*1|2 for 1|bogo|buy one get one)/i.test(haystack)) return 'bogo';
  if (/(rabatt|discount|voucher|gutschein|coupon|bonus)/i.test(haystack)) return 'rabatt';
  return 'gratis';
}

function inferCategory(offerType, description) {
  const haystack = `${normalizeText(offerType)} ${normalizeText(description)}`;
  if (/(kaffee|coffee|espresso|latte|cappuccino|tee|matcha|drink|getränk|getraenk|smoothie|saft|bubble tea|cocktail|spritz|bier|beer|wein|wine)/i.test(haystack)) {
    return 'kaffee';
  }
  return 'essen';
}

function isRelevantOffer(text) {
  return /(gratis|kostenlos|free|freebie|0 ?€|1\s*\+\s*1|2\s*für\s*1|2 for 1|bogo|verkostung|tasting|welcome gift|gratisprobe|free sample)/i.test(text);
}

async function runAgent() {
  const today = new Date().toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' });
  return firecrawl.agent({
    prompt: `Extrahiere mindestens 30 aktuelle Angebote für kostenlose Speisen und Getränke in der Wiener Gastronomie AUSSCHLIEẞLICH aus Instagram-Posts der letzten 7 Tage.

Heute ist ${today} in Wien.

Filter-Logik (STRENGSTENS BEACHTEN):
1. Entferne alle Angebote, deren Gültigkeit bereits abgelaufen ist (vergleiche 'valid_until' oder relative Zeitangaben wie 'nur heute' mit dem heutigen Datum).
2. Behalte Angebote ohne genanntes Enddatum bei, sofern sie nicht offensichtlich abgelaufen sind.

Priorisierung:
1. Höchste Priorität: Noch gültige Angebote mit konkretem oder implizitem Enddatum (z.B. 'bis morgen', 'gültig am [Datum in der Zukunft]').
2. Zweite Priorität: Angebote ohne genanntes Enddatum.
3. Dritte Priorität: 'Buy One Get One Free' (1+1 gratis) Aktionen.

Regeln:
- Nutze NUR Instagram als Quelle.
- Schließe Gewinnspiele (Giveaways) explizit aus.
- Nur Angebote in Wien.
- Vermeide Duplikate.
- Erfasse den Account-Handle und das echte Veröffentlichungsdatum des Original-Posts.
- Verwechsle Veröffentlichungsdatum, Aktionsbeginn und Aktionsende nicht.
- Nutze Suchbegriffe wie 'gratis', 'kostenlos', 'free', '1+1' in Verbindung mit 'Wien'.`,
    schema: offerSchema,
    model: 'spark-1-pro',
  });
}

async function main() {
  console.log('📸🔥 FIRECRAWL INSTAGRAM DIRECT AGENT #4');
  console.log('='.repeat(48));
  console.log(`📅 ${new Date().toLocaleString('de-AT')}`);
  console.log();

  const allDeals = [];

  console.log('🔍 Run Code-1 Instagram Direct Agent...');

  const result = await runAgent();
  const rawOffers = result?.data?.offers || [];
  console.log(`📦 Rohangebote: ${rawOffers.length}`);

  const seenPostUrls = new Set();

  for (const offer of rawOffers) {
    const restaurantName = normalizeText(offer.restaurant_name) || 'Instagram';
    const postUrl = normalizeText(offer.post_url);
    const offerDescription = normalizeText(offer.offer_description);
    const offerType = normalizeText(offer.offer_type);
    const validUntil = normalizeText(offer.valid_until);
    const location = normalizeText(offer.location);
    const ownerUsername = normalizeText(offer.owner_username).replace(/^@/, '').toLowerCase();
    const reportedPostDate = normalizeText(offer.post_date);
    const isCurrentlyValid = offer.is_currently_valid !== false;
    const combinedText = `${restaurantName} ${offerDescription} ${offerType} ${validUntil} ${location}`;

    if (!postUrl || !isInstagramPostUrl(postUrl)) continue;
    if (seenPostUrls.has(postUrl)) continue;
    if (!isCurrentlyValid) continue;
    if (looksLikeGiveaway(combinedText)) continue;
    if (!isRelevantOffer(combinedText)) continue;
    seenPostUrls.add(postUrl);

    const type = inferType(offerType, offerDescription);
    const category = inferCategory(offerType, offerDescription);
    const title = `${restaurantName}: ${offerDescription || offerType || 'Instagram-Angebot'}`.slice(0, 140);

    allDeals.push({
      id: dealId(restaurantName, title, postUrl),
      brand: restaurantName,
      title,
      description: [offerDescription, offerType, location].filter(Boolean).join(' | '),
      type,
      category,
      source: 'Firecrawl Instagram Direct #4',
      url: postUrl,
      expires: validUntil,
      expiresOriginal: validUntil,
      distance: location,
      hot: type === 'gratis' || type === 'bogo',
      isNew: true,
      priority: type === 'gratis' ? 2 : type === 'bogo' ? 3 : 4,
      votes: 1,
      qualityScore: type === 'gratis' ? 84 : type === 'bogo' ? 78 : 70,
      ownerUsername,
      reportedPostDate,
    });
  }

  const verifiedDeals = await verifyFirecrawlDeals(allDeals, {
    sourceKey: 'firecrawl-key4-instagram-direct',
  });

  const output = {
    lastUpdated: new Date().toISOString(),
    source: 'firecrawl4',
    totalDeals: verifiedDeals.length,
    deals: verifiedDeals,
  };

  fs.writeFileSync('docs/deals-pending-firecrawl4.json', JSON.stringify(output, null, 2));
  console.log(`✅ Final: ${verifiedDeals.length} Deals`);
  console.log(`💾 ${verifiedDeals.length} Deals → docs/deals-pending-firecrawl4.json`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
  });

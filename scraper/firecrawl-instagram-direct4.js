// ============================================
// 📸🔥 FIRECRAWL INSTAGRAM DIRECT AGENT #4
// Fokus: aktuelle kostenlose Speisen/Getränke in Wien
// ============================================

import Firecrawl from '@mendable/firecrawl-js';
import { z } from 'zod';
import fs from 'fs';

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY4 || process.env.FIRECRAWL_API_KEY;
const MAX_POST_AGE_DAYS = 7;
const OUTPUT_PATH = 'docs/deals-pending-firecrawl4.json';

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
    is_currently_valid: z.boolean().describe("True, wenn das Angebot heute noch gültig ist oder kein Enddatum hat."),
    is_currently_valid_citation: z.string().describe('Source URL for is_currently_valid').optional(),
    location: z.string(),
    location_citation: z.string().describe('Source URL for location').optional(),
    post_date: z.string().describe('Das Veröffentlichungsdatum des Instagram-Posts in ISO- oder DMY-Form, wenn erkennbar.'),
    post_date_citation: z.string().describe('Source URL for post_date').optional(),
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
    const date = new Date();
    return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0));
  }

  if (/gestern|yesterday/i.test(text)) {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0));
  }

  return null;
}

function isFreshPost(postDate) {
  if (!(postDate instanceof Date) || Number.isNaN(postDate.getTime())) return false;
  const cutoff = Date.now() - MAX_POST_AGE_DAYS * 24 * 60 * 60 * 1000;
  return postDate.getTime() >= cutoff;
}

function inferType(offerType, description) {
  const text = `${normalizeText(offerType)} ${normalizeText(description)}`.toLowerCase();
  if (/(1\s*\+\s*1|2\s*für\s*1|2 for 1|bogo|buy one get one|rabatt|discount|voucher|gutschein|coupon)/i.test(text)) {
    return /(1\s*\+\s*1|2\s*für\s*1|2 for 1|bogo|buy one get one)/i.test(text) ? 'bogo' : 'rabatt';
  }
  return 'gratis';
}

function inferCategory(description, offerType) {
  const text = `${normalizeText(description)} ${normalizeText(offerType)}`.toLowerCase();
  if (/(kaffee|coffee|espresso|latte|cappuccino|tee|matcha|drink|getränk|getraenk|smoothie|saft|bubble tea|cocktail|spritz|bier|beer|wein|wine)/i.test(text)) {
    return 'kaffee';
  }
  return 'essen';
}

function looksLikeGiveaway(text) {
  return /(gewinnspiel|giveaway|verlosung|zu gewinnen|markiere.*freund|tagge.*freund|comment.*win)/i.test(text);
}

function isViennaRelevant(location, description, restaurantName) {
  const text = `${normalizeText(location)} ${normalizeText(description)} ${normalizeText(restaurantName)}`.toLowerCase();
  return /wien|vienna|\b10\d{2}\b|\b11\d{2}\b|\b12\d{2}\b/.test(text);
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
- Nutze Suchbegriffe wie 'gratis', 'kostenlos', 'free', '1+1' in Verbindung mit 'Wien'.
- Liefere nur direkte Instagram-Post- oder Reel-URLs.
- Liefere das Veröffentlichungsdatum des Posts im Feld 'post_date'. Wenn das Post-Datum nicht belastbar erkennbar ist oder älter als 7 Tage ist, lasse den Eintrag weg.`,
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
    const restaurantName = normalizeText(offer.restaurant_name);
    const postUrl = normalizeText(offer.post_url);
    const offerDescription = normalizeText(offer.offer_description);
    const offerType = normalizeText(offer.offer_type);
    const validUntil = normalizeText(offer.valid_until);
    const isCurrentlyValid = Boolean(offer.is_currently_valid);
    const location = normalizeText(offer.location) || 'Wien';
    const postDateRaw = normalizeText(offer.post_date);
    const combinedText = `${restaurantName} ${offerDescription} ${offerType} ${validUntil} ${location}`;
    const postDate = parseFlexibleDate(postDateRaw);

    if (!restaurantName || !postUrl || !offerDescription) continue;
    if (!isInstagramPostUrl(postUrl)) continue;
    if (seenUrls.has(postUrl)) continue;
    if (looksLikeGiveaway(combinedText)) continue;
    if (!isViennaRelevant(location, offerDescription, restaurantName)) continue;
    if (!isCurrentlyValid) continue;
    if (!postDate || !isFreshPost(postDate)) continue;

    seenUrls.add(postUrl);

    const type = inferType(offerType, offerDescription);
    const category = inferCategory(offerDescription, offerType);
    const title = `${restaurantName}: ${offerDescription}`.slice(0, 140);

    deals.push({
      id: dealId(restaurantName, title, postUrl),
      brand: restaurantName,
      title,
      description: [
        offerDescription,
        location,
        validUntil ? `Gültig bis: ${validUntil}` : '',
      ].filter(Boolean).join(' | '),
      type,
      category,
      source: 'Firecrawl Instagram Direct #4',
      url: postUrl,
      expires: validUntil || 'nicht angegeben',
      distance: location,
      hot: type === 'gratis' || type === 'bogo',
      isNew: true,
      priority: type === 'gratis' ? 2 : type === 'bogo' ? 3 : 4,
      votes: 1,
      qualityScore: type === 'gratis' ? 86 : type === 'bogo' ? 78 : 72,
      pubDate: postDate.toISOString(),
      pubDateSource: 'socialPostDate',
    });
  }

  const output = {
    lastUpdated: new Date().toISOString(),
    source: 'firecrawl4',
    totalDeals: deals.length,
    deals,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`✅ Final: ${deals.length} Deals`);
  console.log(`💾 ${deals.length} Deals → ${OUTPUT_PATH}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
  });

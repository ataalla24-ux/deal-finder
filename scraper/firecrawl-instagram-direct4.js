import '../sentry/instrument.mjs';

import Firecrawl from '@mendable/firecrawl-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

import { verifyFirecrawlDeals } from './firecrawl-post-verifier.js';
import {
  dedupeKey4Deals,
  isRecentKey4PostUrl,
  KEY4_SEARCH_QUERIES,
  normalizeKey4Offer,
  qualifyKey4Deals,
  searchResultToKey4Offer,
} from './firecrawl-instagram-direct4-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const OUTPUT_PATH = path.join(ROOT, 'docs', 'deals-pending-firecrawl4.json');
const WATCHLIST_PATH = path.join(ROOT, 'docs', 'instagram-watchlist.json');
const REGISTRY_PATH = path.join(ROOT, 'docs', 'instagram-merchant-registry.json');

const MAX_POST_AGE_DAYS = Math.min(7, Math.max(1, Number(process.env.FC4_MAX_AGE_DAYS || 7) || 7));
const MIN_RAW_CANDIDATES = Math.max(1, Number(process.env.FC4_MIN_RAW_CANDIDATES || 12) || 12);
const MAX_DEALS = Math.max(1, Number(process.env.FC4_MAX_DEALS || 40) || 40);
const SEARCH_LIMIT = Math.max(1, Math.min(20, Number(process.env.FC4_SEARCH_LIMIT || 10) || 10));
const MAX_CREDITS_PER_AGENT = Math.max(100, Number(process.env.FC4_MAX_CREDITS_PER_AGENT || 900) || 900);

const offerSchema = z.object({
  offers: z.array(z.object({
    restaurant_name: z.string().optional(),
    restaurant_name_citation: z.string().optional(),
    post_url: z.string(),
    post_url_citation: z.string().optional(),
    offer_description: z.string().optional(),
    offer_description_citation: z.string().optional(),
    offer_type: z.string().optional(),
    offer_type_citation: z.string().optional(),
    valid_until: z.string().optional(),
    valid_until_citation: z.string().optional(),
    is_currently_valid: z.boolean().optional(),
    is_currently_valid_citation: z.string().optional(),
    location: z.string().optional(),
    location_citation: z.string().optional(),
    owner_username: z.string().optional(),
    owner_username_citation: z.string().optional(),
    post_date: z.string().optional(),
    post_date_citation: z.string().optional(),
  })).default([]),
});

const PRIMARY_PROMPT = `Finde möglichst viele konkrete kostenlose Angebote für Essen oder Getränke aus Instagram-Posts und Instagram-Reels in Wien.

Gesucht sind unter anderem:
- gratis oder kostenlose Speisen und Getränke
- 0-Euro-Angebote
- 1+1, 2-für-1, 2+1 oder Buy-one-get-one-free
- Gratis-Beigaben zu Essen oder Getränken
- kostenlose Kostproben, Verkostungen oder Welcome Drinks
- Neueröffnungen mit einem konkreten kostenlosen Gastro-Angebot

Sammle breit und gib auch Kandidaten zurück, wenn einzelne Angaben wie Enddatum, Standort oder Account-Handle fehlen. Filtere NICHT nach Alter und erfinde keine Daten. Wir prüfen Veröffentlichungsdatum, Jahr, Wien-Bezug und Gültigkeit anschließend aus der Original-Post-URL.

Regeln:
- Nur direkte URLs zu Instagram-Posts oder Reels, keine Profile, Hashtag-Seiten oder Suchseiten.
- Keine Gewinnspiele, Verlosungen, reinen Events oder bloß allgemein beworbene Restaurants.
- Das Angebot muss sich auf Essen oder Getränke beziehen.
- post_date ist ausschließlich das Veröffentlichungsdatum des Posts, nicht das Angebotsende.
- Gib die jeweilige Original-Post-URL auch als Citation für extrahierte Angaben zurück.`;

function focusedFallbackPrompt(profileHandles = []) {
  const accounts = profileHandles.length
    ? `Prüfe zusätzlich besonders die jüngsten Posts dieser Wiener Gastro- und Discovery-Accounts: ${profileHandles.map((value) => `@${value}`).join(', ')}.`
    : '';
  return `Suche gezielt nach direkten Instagram-Post- oder Reel-URLs mit kostenlosen Gastro-Angeboten in Wien.

Fokus:
- "gratis", "kostenlos", "0 €", "1+1", "2 für 1", "2+1", "aufs Haus"
- gratis Kaffee, Getränke, Essen, Dessert, Frühstück, Burger, Pizza, Döner, Eis oder Kostproben
- Neueröffnungen und kurzfristige Aktionen in Wiener Restaurants, Cafés, Bars und Bäckereien

${accounts}

Gib jeden plausiblen Kandidaten zurück, auch wenn noch Angaben fehlen. Keine Profile und keine Gewinnspiele. Erfinde kein Datum; liefere immer die direkte Original-Post-URL, damit der echte Instagram-Zeitstempel anschließend technisch geprüft werden kann.`;
}

function readJson(filePath, fallback = {}) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function extractOffers(result) {
  const data = result?.data;
  if (Array.isArray(data?.offers)) return data.offers;
  if (Array.isArray(data)) return data;
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      return Array.isArray(parsed?.offers) ? parsed.offers : [];
    } catch {
      return [];
    }
  }
  return [];
}

function loadPriorityProfileHandles(limit = 28) {
  const watchlist = readJson(WATCHLIST_PATH, {});
  const registry = readJson(REGISTRY_PATH, {});
  const accounts = [
    ...(Array.isArray(watchlist?.accounts) ? watchlist.accounts : []),
    ...(Array.isArray(registry?.accounts) ? registry.accounts : []),
  ];
  const byUsername = new Map();
  for (const account of accounts) {
    const username = String(account?.username || '').trim().replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9._]{2,40}$/.test(username)) continue;
    const accountType = String(account?.accountType || account?.category || 'merchant').toLowerCase();
    if (accountType === 'platform' || accountType === 'delivery') continue;
    const score = Number(account?.priorityScore ?? account?.priority ?? account?.confidence ?? 0) || 0;
    const existing = byUsername.get(username);
    if (!existing || score > existing.score) byUsername.set(username, { username, score });
  }
  return [...byUsername.values()]
    .sort((left, right) => right.score - left.score || left.username.localeCompare(right.username))
    .slice(0, limit)
    .map((entry) => entry.username);
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.max(1, Math.floor(concurrency)) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function runAgent(client, label, prompt, model) {
  const startedAt = Date.now();
  try {
    const result = await client.agent({
      prompt,
      schema: offerSchema,
      model,
      maxCredits: MAX_CREDITS_PER_AGENT,
      timeout: 12 * 60,
    });
    const offers = extractOffers(result);
    return {
      label,
      status: result?.status || (result?.success === false ? 'failed' : 'completed'),
      offers,
      error: String(result?.error || ''),
      creditsUsed: Number(result?.creditsUsed || 0),
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      label,
      status: 'failed',
      offers: [],
      error: String(error?.message || error),
      creditsUsed: 0,
      durationMs: Date.now() - startedAt,
    };
  }
}

async function searchInstagramPosts(client) {
  const rows = await mapWithConcurrency(KEY4_SEARCH_QUERIES, 2, async (query) => {
    try {
      const result = await client.search(query, {
        sources: ['web'],
        limit: SEARCH_LIMIT,
        tbs: 'qdr:w,sbd:1',
        location: 'Vienna, Austria',
        ignoreInvalidURLs: true,
        timeout: 45_000,
      });
      const webResults = Array.isArray(result?.web) ? result.web : [];
      return {
        query,
        status: 'completed',
        results: webResults,
        offers: webResults.map((item) => searchResultToKey4Offer(item, query)).filter(Boolean),
        error: '',
      };
    } catch (error) {
      return {
        query,
        status: 'failed',
        results: [],
        offers: [],
        error: String(error?.message || error),
      };
    }
  });
  return rows;
}

export async function discoverKey4RawOffers(options = {}) {
  const client = options.client;
  if (!client || typeof client.agent !== 'function' || typeof client.search !== 'function') {
    throw new Error('Key 4 discovery requires Firecrawl agent() and search() methods');
  }

  const primary = await runAgent(client, 'primary-broad-agent', PRIMARY_PROMPT, 'spark-1-pro');
  const searchRuns = await searchInstagramPosts(client);
  let rawOffers = [
    ...primary.offers.map((offer) => ({ ...offer, discoverySource: primary.label })),
    ...searchRuns.flatMap((run) => run.offers),
  ];

  const normalizedBeforeFallback = dedupeKey4Deals(rawOffers
    .map((offer) => normalizeKey4Offer(offer, {
      discoverySource: offer.discoverySource || 'firecrawl-search',
    }))
    .filter(Boolean));
  const discoveryNow = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const recentPostsBeforeFallback = normalizedBeforeFallback.filter((deal) => (
    isRecentKey4PostUrl(deal.url, {
      now: discoveryNow,
      maxAgeDays: MAX_POST_AGE_DAYS,
    })
  )).length;

  let fallback = null;
  if (recentPostsBeforeFallback < (Number(options.minRawCandidates) || MIN_RAW_CANDIDATES)) {
    const handles = Array.isArray(options.profileHandles)
      ? options.profileHandles
      : loadPriorityProfileHandles();
    fallback = await runAgent(
      client,
      'focused-profile-agent',
      focusedFallbackPrompt(handles),
      'spark-1-mini'
    );
    rawOffers = [
      ...rawOffers,
      ...fallback.offers.map((offer) => ({ ...offer, discoverySource: fallback.label })),
    ];
  }

  const normalizedDeals = dedupeKey4Deals(rawOffers
    .map((offer) => normalizeKey4Offer(offer, {
      discoverySource: offer.discoverySource || 'firecrawl-agent',
    }))
    .filter(Boolean));

  return {
    rawOffers,
    normalizedDeals,
    diagnostics: {
      primary: {
        status: primary.status,
        offers: primary.offers.length,
        error: primary.error,
        creditsUsed: primary.creditsUsed,
        durationMs: primary.durationMs,
      },
      searches: searchRuns.map((run) => ({
        query: run.query,
        status: run.status,
        resultCount: run.results.length,
        directPostCandidates: run.offers.length,
        error: run.error,
      })),
      fallback: fallback
        ? {
            status: fallback.status,
            offers: fallback.offers.length,
            error: fallback.error,
            creditsUsed: fallback.creditsUsed,
            durationMs: fallback.durationMs,
          }
        : null,
      rawOffers: rawOffers.length,
      distinctInstagramPosts: normalizedDeals.length,
      recentInstagramPostsBeforeFallback: recentPostsBeforeFallback,
    },
  };
}

function previousKey4Deals() {
  const previous = readJson(OUTPUT_PATH, {});
  return Array.isArray(previous?.deals)
    ? previous.deals.map((deal) => ({
        ...deal,
        carriedFromPreviousRun: true,
        discoveredBy: [
          ...(Array.isArray(deal.discoveredBy) ? deal.discoveredBy : []),
          'previous-key4-run',
        ],
      }))
    : [];
}

async function main() {
  const apiKey = process.env.FIRECRAWL_API_KEY4 || process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error('FIRECRAWL_API_KEY4 oder FIRECRAWL_API_KEY nicht gesetzt');

  const now = new Date();
  const client = new Firecrawl({ apiKey });
  console.log('📸🔥 FIRECRAWL KEY 4 – AKTUELLE GRATIS-GASTRO-DEALS');
  console.log('='.repeat(58));
  console.log(`📅 Wien: ${now.toLocaleString('de-AT', { timeZone: 'Europe/Vienna' })}`);
  console.log(`🛡️ Harte Grenze: Original-Post maximal ${MAX_POST_AGE_DAYS} Tage alt`);

  const discovery = await discoverKey4RawOffers({ client, now });
  console.log(`📦 Primär-Agent: ${discovery.diagnostics.primary.offers} Rohangebote`);
  console.log(`🔎 Suche: ${discovery.diagnostics.searches.reduce((sum, item) => sum + item.directPostCandidates, 0)} direkte Posts`);
  console.log(`🗓️ Davon vor Fallback sicher ≤ ${MAX_POST_AGE_DAYS} Tage: ${discovery.diagnostics.recentInstagramPostsBeforeFallback}`);
  if (discovery.diagnostics.fallback) {
    console.log(`🧭 Fallback-Agent: ${discovery.diagnostics.fallback.offers} Rohangebote`);
  }
  console.log(`🔗 Deduplizierte Instagram-Posts: ${discovery.normalizedDeals.length}`);

  const verifiedNewDeals = await verifyFirecrawlDeals(discovery.normalizedDeals, {
    sourceKey: 'firecrawl-key4-instagram-direct',
    now,
    networkMaxAgeDays: MAX_POST_AGE_DAYS,
  });

  const qualification = qualifyKey4Deals([
    ...verifiedNewDeals,
    ...previousKey4Deals(),
  ], {
    now,
    maxAgeDays: MAX_POST_AGE_DAYS,
    maxDeals: MAX_DEALS,
  });

  console.log(`✅ Verifizierte aktuelle Wien-Deals: ${qualification.deals.length}`);
  console.log(`🗑️ Abgelehnt: ${JSON.stringify(qualification.summary.rejectedByReason)}`);

  const output = {
    lastUpdated: now.toISOString(),
    source: 'firecrawl4',
    totalDeals: qualification.deals.length,
    constraints: {
      maximumPostAgeDays: MAX_POST_AGE_DAYS,
      location: 'Wien',
      offer: 'kostenlose Speisen/Getränke, 1+1/2für1 und kostenlose Gastro-Proben',
      publicationDateAuthority: 'Instagram original post timestamp or shortcode',
    },
    diagnostics: {
      ...discovery.diagnostics,
      qualification: qualification.summary,
    },
    deals: qualification.deals,
  };

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`💾 ${qualification.deals.length} Deals → docs/deals-pending-firecrawl4.json`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error('❌ Firecrawl Key 4 fehlgeschlagen:', error?.message || error);
    process.exit(1);
  });
}

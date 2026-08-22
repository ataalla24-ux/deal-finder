import '../sentry/instrument.mjs';
// ============================================
// 📸🍽️ FIRECRAWL INSTAGRAM GASTRO AGENT #5
// Frischer Intake für Gastro-Angebote aus Instagram
// ============================================

import Firecrawl from '@mendable/firecrawl-js';
import { z } from 'zod';
import fs from 'fs';
import {
  mergeFirecrawlDealHistory,
  readFirecrawlDealOutput,
  verifyFirecrawlDeals,
} from './firecrawl-post-verifier.js';
import {
  positiveInteger,
  runBoundedFirecrawlAgent,
} from './firecrawl-agent-utils.js';
import {
  buildPipelineRunReport,
  summarizeVerifiedDeals,
  writeFailedPipelineRunReport,
  writePipelineRunReport,
} from './pipeline-run-report-utils.js';

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY5 || process.env.FIRECRAWL_API_KEY;
const SOURCE_KEY = 'firecrawl5';
const SOURCE_LABEL = 'Firecrawl Key 5 - Instagram Gastro';
const OUTPUT_PATH = 'docs/deals-pending-firecrawl5.json';
const RUN_STARTED_AT = new Date();
const AGENT_TIMEOUT_SECONDS = positiveInteger(process.env.FIRECRAWL5_AGENT_TIMEOUT_SECONDS, 300);
const MAX_CREDITS = positiveInteger(process.env.FIRECRAWL5_MAX_CREDITS, 500);
const DISCOVERY_URLS = [
  'https://www.instagram.com/ciosgrill/',
  'https://www.instagram.com/corner_xvi/',
  'https://www.instagram.com/tokki_korean_bbq/',
  'https://www.instagram.com/sajado.bbq/',
  'https://www.instagram.com/mosquito_mexican/',
  'https://www.instagram.com/zushimarket/',
  'https://www.instagram.com/tastyfood.vienna/',
];
if (!FIRECRAWL_API_KEY) {
  const error = new Error('FIRECRAWL_API_KEY5 oder FIRECRAWL_API_KEY nicht gesetzt');
  writeFailedPipelineRunReport({
    sourceKey: SOURCE_KEY,
    sourceLabel: SOURCE_LABEL,
    startedAt: RUN_STARTED_AT,
    outputFile: OUTPUT_PATH,
    error,
  });
  console.error(`❌ ${error.message}!`);
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

async function main() {
  console.log('📸🍽️ FIRECRAWL INSTAGRAM GASTRO AGENT #5');
  console.log('='.repeat(48));
  console.log(`📅 ${new Date().toLocaleString('de-AT')}`);
  console.log();

  const previousOutput = readFirecrawlDealOutput(OUTPUT_PATH);
  const runErrors = [];
  let result = null;
  let agentCreditsUsed = 0;
  console.log(`💳 Maximal ${MAX_CREDITS} Credits; Abbruch nach ${AGENT_TIMEOUT_SECONDS}s`);
  try {
    result = await runBoundedFirecrawlAgent(firecrawl, {
      urls: DISCOVERY_URLS,
      prompt: `Prüfe alle angegebenen Wiener Gastro-Accounts und extrahiere möglichst viele konkrete Angebote aus ihren Instagram-Originalposts. Nimm nur Posts aus den letzten 7 Tagen auf und prüfe Tag, Monat und Jahr; zukünftig beginnende Aktionen sind erwünscht, sofern der Post selbst höchstens 7 Tage alt ist. Nutze nur direkte /p/...- oder /reel/...-Links und gib Restaurantname, Account-Handle, echtes Post-Datum, Beschreibung, konkreten Vorteil, Ablauf und exakten Wien-Standort zurück. Veröffentlichungsdatum und Angebotszeitraum niemals verwechseln. Alte Posts, Reposts ohne Original, Gewinnspiele, Empfehlungen, Gratis-Versand und unkonkrete Aktionen weglassen. Bei eindeutig frischem Originalpost darf ein unlesbares Detail leer bleiben, damit Graph API und Validator nachprüfen können.`,
      schema: offerSchema,
      model: 'spark-1-mini',
    }, {
      timeoutSeconds: AGENT_TIMEOUT_SECONDS,
      maxCredits: MAX_CREDITS,
    });
    agentCreditsUsed = Number(result?.creditsUsed || result?.credits_used || 0);
  } catch (error) {
    agentCreditsUsed = Number(error?.creditsUsed || 0);
    runErrors.push(error.message);
    console.log(`⚠️ Firecrawl Agent: ${error.message}`);
  }

  let resultData = result?.data || {};
  if (typeof resultData === 'string') {
    try {
      resultData = JSON.parse(resultData);
    } catch (error) {
      runErrors.push(`Ungültige Agent-Antwort: ${error.message}`);
      resultData = {};
    }
  }
  const rawOffers = Array.isArray(resultData?.offers) ? resultData.offers : [];
  const deals = [];
  const rejected = [];

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

    if (looksLikeGiveaway(`${description} ${offerType}`)) {
      rejected.push({
        reason: 'excluded-giveaway',
        deal: { title: description || offerType, brand: restaurant, url: postUrl },
      });
      continue;
    }

    if (!postUrl || !isInstagramPostUrl(postUrl)) {
      rejected.push({
        reason: 'invalid-original-post-url',
        deal: {
          title: description || offerType,
          brand: restaurant,
          url: postUrl,
        },
      });
      continue;
    }

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

  const history = mergeFirecrawlDealHistory(deals, previousOutput.deals, {
    now: RUN_STARTED_AT,
  });
  console.log(`🛡️ Fresh history: ${history.retainedPreviousDeals}/${history.previousDeals}; exact duplicates merged: ${history.duplicateCount}`);
  const verifiedDeals = await verifyFirecrawlDeals(history.deals, {
    sourceKey: 'firecrawl-key5-instagram-gastro',
    now: RUN_STARTED_AT,
  });
  const verifiedIDs = new Set(verifiedDeals.map((deal) => deal.id));
  rejected.push(...deals
    .filter((deal) => !verifiedIDs.has(deal.id))
    .map((deal) => ({ reason: 'post-verification-rejected', deal })));

  console.log(`✅ Final: ${verifiedDeals.length} Deals`);

  const output = {
    lastUpdated: new Date().toISOString(),
    source: 'firecrawl5',
    totalDeals: verifiedDeals.length,
    freshDiscoveryDeals: deals.length,
    retainedPreviousDeals: history.retainedPreviousDeals,
    pipelineReport: `deal-pipeline-last-run-${SOURCE_KEY}.json`,
    deals: verifiedDeals,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  writePipelineRunReport(buildPipelineRunReport({
    sourceKey: SOURCE_KEY,
    sourceLabel: SOURCE_LABEL,
    startedAt: RUN_STARTED_AT,
    finishedAt: new Date(),
    status: runErrors.length > 0 ? 'completed-with-errors' : 'completed',
    outputFile: OUTPUT_PATH,
    rawCandidates: rawOffers.length,
    normalizedCandidates: deals.length,
    verifiedCandidates: verifiedDeals.length,
    previousDeals: previousOutput.deals.length,
    acceptedDeals: verifiedDeals.length,
    rejected,
    diagnostics: {
      agentStatus: result?.status || 'failed',
      creditsUsed: agentCreditsUsed,
      configuredSources: DISCOVERY_URLS.length,
      agentTimeoutSeconds: AGENT_TIMEOUT_SECONDS,
      maxCredits: MAX_CREDITS,
      retainedPreviousDeals: history.retainedPreviousDeals,
      prunedPreviousDeals: history.prunedPreviousDeals,
      duplicateCandidatesMerged: history.duplicateCount,
      verifier: summarizeVerifiedDeals(verifiedDeals),
    },
    errors: runErrors,
  }));
  console.log(`💾 ${verifiedDeals.length} Deals → ${OUTPUT_PATH}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    writeFailedPipelineRunReport({
      sourceKey: SOURCE_KEY,
      sourceLabel: SOURCE_LABEL,
      startedAt: RUN_STARTED_AT,
      outputFile: OUTPUT_PATH,
      error: err,
    });
    console.error('Error:', err.message);
    process.exit(1);
  });

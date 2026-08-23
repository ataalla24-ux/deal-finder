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
  isFirecrawlRateOrCreditError,
  positiveInteger,
  runBoundedFirecrawlAgent,
  selectRotatingFirecrawlTargets,
} from './firecrawl-agent-utils.js';
import {
  isConcreteFirecrawlSearchResult,
  searchFreshInstagramPosts,
} from './firecrawl-search-utils.js';
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
const AGENT_TIMEOUT_SECONDS = positiveInteger(process.env.FIRECRAWL5_AGENT_TIMEOUT_SECONDS, 120);
const MAX_CREDITS_PER_TARGET = positiveInteger(process.env.FIRECRAWL5_MAX_CREDITS_PER_TARGET, 300);
const TARGETS_PER_RUN = positiveInteger(process.env.FIRECRAWL5_TARGETS_PER_RUN, 4);
const DISCOVERY_URLS = [
  'https://www.instagram.com/ciosgrill/',
  'https://www.instagram.com/corner_xvi/',
  'https://www.instagram.com/tokki_korean_bbq/',
  'https://www.instagram.com/sajado.bbq/',
  'https://www.instagram.com/mosquito_mexican/',
  'https://www.instagram.com/zushimarket/',
  'https://www.instagram.com/tastyfood.vienna/',
];
const ACTIVE_DISCOVERY_URLS = selectRotatingFirecrawlTargets(
  DISCOVERY_URLS,
  TARGETS_PER_RUN,
  RUN_STARTED_AT,
);
const DISCOVERY_PROMPT = `Prüfe das angegebene Wiener Gastro-Konto und extrahiere möglichst viele konkrete Angebote aus seinen Instagram-Originalposts. Nimm nur Posts aus den letzten 7 Tagen auf und prüfe Tag, Monat und Jahr; zukünftig beginnende Aktionen sind erwünscht, sofern der Post selbst höchstens 7 Tage alt ist. Nutze nur direkte /p/...- oder /reel/...-Links und gib Restaurantname, Account-Handle, echtes Post-Datum, Beschreibung, konkreten Vorteil, Ablauf und exakten Wien-Standort zurück. Veröffentlichungsdatum und Angebotszeitraum niemals verwechseln. Alte Posts, Reposts ohne Original, Gewinnspiele, Empfehlungen, Gratis-Versand und unkonkrete Aktionen weglassen. Bei eindeutig frischem Originalpost darf ein unlesbares Detail leer bleiben, damit Graph API und Validator nachprüfen können.`;
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

function hasConcreteOfferSignal(text) {
  return /(gratis|kostenlos|free|umsonst|0 ?€|1\s*\+\s*1|2\s*(?:für|for)\s*1|bogo|\d{1,2}\s*%|rabatt|aktion|angebot|coupon|gutschein|happy hour|statt\s+(?:€\s*)?\d)/i.test(text);
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
  if (/(1\s*\+\s*1|buy one get one|bogo|2\s*für\s*1|2\s*for\s*1)/i.test(haystack)) return 'bogo';
  if (/(gratis|kostenlos|free|umsonst|0 ?€)/i.test(haystack)) return 'gratis';
  return 'rabatt';
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
  const rawOffers = [];
  const sourceStats = [];
  let totalCreditsUsed = 0;
  let completedSources = 0;
  console.log(`🎯 ${ACTIVE_DISCOVERY_URLS.length}/${DISCOVERY_URLS.length} rotierende Ziele`);
  console.log(`💳 Maximal ${MAX_CREDITS_PER_TARGET} Credits und ${AGENT_TIMEOUT_SECONDS}s pro Ziel`);

  for (const targetUrl of ACTIVE_DISCOVERY_URLS) {
    const stat = { url: targetUrl, status: 'started', rawCandidates: 0, searchCandidates: 0, creditsUsed: 0 };
    let stopAfterTarget = false;
    try {
      const searchPosts = (await searchFreshInstagramPosts(firecrawl, targetUrl, {
        now: RUN_STARTED_AT,
        limit: 12,
      })).filter(isConcreteFirecrawlSearchResult);
      stat.searchCandidates = searchPosts.length;
      if (searchPosts.length > 0) {
        rawOffers.push(...searchPosts.map((post) => ({
          restaurant_name: post.ownerUsername || 'Instagram Gastro',
          post_url: post.url,
          post_date: '',
          offer_description: post.title,
          offer_type: post.description,
          valid_until: '',
          location: '',
          owner_username: post.ownerUsername,
          discovery_target: targetUrl,
          discovery_method: post.discoveryMethod,
        })));
        stat.status = 'completed-search';
        stat.rawCandidates = searchPosts.length;
        completedSources += 1;
        console.log(`   ${targetUrl} → ${searchPosts.length} direkte Posts via Firecrawl Search`);
        sourceStats.push(stat);
        continue;
      }
    } catch (error) {
      stat.searchError = error.message;
      console.log(`   ${targetUrl} → Search-Warnung: ${error.message}`);
    }
    try {
      const result = await runBoundedFirecrawlAgent(firecrawl, {
        urls: [targetUrl],
        prompt: `${DISCOVERY_PROMPT}\n\nStartziel dieses Durchlaufs: ${targetUrl}`,
        schema: offerSchema,
        model: 'spark-1-mini',
      }, {
        timeoutSeconds: AGENT_TIMEOUT_SECONDS,
        maxCredits: MAX_CREDITS_PER_TARGET,
      });
      stat.creditsUsed = Number(result?.creditsUsed || result?.credits_used || 0);
      totalCreditsUsed += stat.creditsUsed;
      let resultData = result?.data || {};
      if (typeof resultData === 'string') resultData = JSON.parse(resultData);
      const targetOffers = Array.isArray(resultData?.offers) ? resultData.offers : [];
      rawOffers.push(...targetOffers.map((offer) => ({ ...offer, discovery_target: targetUrl })));
      stat.status = 'completed';
      stat.rawCandidates = targetOffers.length;
      completedSources += 1;
      console.log(`   ${targetUrl} → ${targetOffers.length} Rohangebote`);
    } catch (error) {
      stat.status = 'failed';
      stat.error = error.message;
      stat.creditsUsed = Number(error?.creditsUsed || 0);
      totalCreditsUsed += stat.creditsUsed;
      runErrors.push(`${targetUrl}: ${error.message}`);
      console.log(`   ${targetUrl} → ⚠️ ${error.message}`);
      stopAfterTarget = isFirecrawlRateOrCreditError(error.message);
    }
    sourceStats.push(stat);
    if (stopAfterTarget) break;
  }
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
    if (!hasConcreteOfferSignal(`${description} ${offerType}`)) {
      rejected.push({
        reason: 'missing-concrete-offer',
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
      priority: type === 'gratis' ? 1 : type === 'bogo' ? 2 : 4,
      votes: 1,
      qualityScore: 80,
      ownerUsername,
      reportedPostDate: postDateRaw,
      discoveryTarget: normalizeText(offer.discovery_target),
      discoveryMethod: normalizeText(offer.discovery_method) || 'firecrawl-agent',
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
      agentStatus: runErrors.length > 0 ? 'completed-with-errors' : 'completed',
      creditsUsed: totalCreditsUsed,
      configuredSources: DISCOVERY_URLS.length,
      attemptedSources: sourceStats.length,
      completedSources,
      targetsPerRun: TARGETS_PER_RUN,
      agentTimeoutSeconds: AGENT_TIMEOUT_SECONDS,
      maxCreditsPerTarget: MAX_CREDITS_PER_TARGET,
      sourceStats,
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

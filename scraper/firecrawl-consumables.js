import '../sentry/instrument.mjs';
// ============================================
// 🔥 FIRECRAWL KEY 3 - INSTAGRAM CONSUMABLE OFFERS
// Frischer Instagram-Intake mit zentraler Originalpost-Verifikation
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

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY3 || process.env.FIRECRAWL_API_KEY;
const SOURCE_KEY = 'firecrawl2';
const SOURCE_LABEL = 'Firecrawl Key 3 - Consumables';
const OUTPUT_PATH = 'docs/deals-pending-firecrawl2.json';
const RUN_STARTED_AT = new Date();
const AGENT_TIMEOUT_SECONDS = positiveInteger(process.env.FIRECRAWL3_AGENT_TIMEOUT_SECONDS, 120);
const MAX_CREDITS_PER_TARGET = positiveInteger(process.env.FIRECRAWL3_MAX_CREDITS_PER_TARGET, 300);
const TARGETS_PER_RUN = positiveInteger(process.env.FIRECRAWL3_TARGETS_PER_RUN, 4);
const DISCOVERY_URLS = [
  'https://www.instagram.com/spar_oesterreich/',
  'https://www.instagram.com/billa_at/',
  'https://www.instagram.com/lidl_oesterreich/',
  'https://www.instagram.com/hofer_at/',
  'https://www.instagram.com/dm_oesterreich/',
  'https://www.instagram.com/bipa/',
  'https://www.instagram.com/explore/tags/wiengratis/',
  'https://www.instagram.com/explore/tags/kostenloswien/',
];
const ACTIVE_DISCOVERY_URLS = selectRotatingFirecrawlTargets(
  DISCOVERY_URLS,
  TARGETS_PER_RUN,
  RUN_STARTED_AT,
);
const DISCOVERY_PROMPT = `Untersuche das angegebene Instagram-Konto oder Hashtag-Ziel nach möglichst vielen konkreten Gratis-, 1+1-, Coupon- und starken Rabattangeboten für Verbrauchsartikel. Suche neben Essen und Getränken gezielt auch Drogerie, Beauty, Haushalt und kostenlose Produktaktionen. Nur Angebote aufnehmen, die in Wien in einer Filiale oder vor Ort nutzbar sind und deren Originalpost in den letzten 7 Tagen veröffentlicht wurde; Tag, Monat und Jahr ausdrücklich prüfen. Zukünftig beginnende Angebote sind erwünscht, wenn der Post selbst höchstens 7 Tage alt ist. Erfasse Gültigkeitszeitraum, Produkt oder Leistung, exakten Wien-Bezug, direkten /p/...- oder /reel/...-Link, Account-Handle und Veröffentlichungszeitpunkt. Veröffentlichungsdatum und Angebotszeitraum niemals verwechseln. Alte Posts, Gewinnspiele, Empfehlungen, reine Onlinecodes, Gratis-Versand und Posts ohne konkreten Vorteil weglassen. Bei eindeutig frischem Originalpost darf ein unlesbares Detail leer bleiben, damit Graph API und Validator nachprüfen können.`;
if (!FIRECRAWL_API_KEY) {
  const error = new Error('FIRECRAWL_API_KEY3 oder FIRECRAWL_API_KEY nicht gesetzt');
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

const key3Schema = z.object({
  posts: z.array(z.object({
    validity_period: z.string().describe('Date and time range the offer is valid for'),
    validity_period_citation: z.string().optional(),
    location: z.string().describe('Exact location of the event/restaurant in Vienna'),
    location_citation: z.string().optional(),
    item_or_service: z.string().describe('The exact product, food, drink, beauty item or service offered'),
    food_and_drinks: z.string().optional().describe('Legacy food and drink description when applicable'),
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
  return /(gratis|kostenlos|1\s*\+\s*1|2\s*für\s*1|2\s*for\s*1|bogo|\d{1,2}\s*%|rabatt|aktion|coupon|gutschein|statt\s+(?:€\s*)?\d)/i.test(text);
}

function looksLikePureRestaurantIntro(text) {
  return /(neueröffnung|neueroeffnung|eröffnung|eroeffnung|opening)/i.test(text)
    && !hasRequiredOfferSignal(text);
}

function inferType(offerType) {
  if (/(1\s*\+\s*1|2\s*für\s*1|2\s*for\s*1|bogo)/i.test(offerType)) return 'bogo';
  if (/(gratis|kostenlos|free|umsonst|0 ?€)/i.test(offerType)) return 'gratis';
  return 'rabatt';
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

  const previousOutput = readFirecrawlDealOutput(OUTPUT_PATH);
  const runErrors = [];
  const rawPosts = [];
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
        rawPosts.push(...searchPosts.map((post) => ({
          validity_period: '',
          location: '',
          item_or_service: post.title,
          original_post_url: post.url,
          post_timestamp: '',
          offer_type: post.description,
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
        schema: key3Schema,
        model: 'spark-1-mini',
      }, {
        timeoutSeconds: AGENT_TIMEOUT_SECONDS,
        maxCredits: MAX_CREDITS_PER_TARGET,
      });
      stat.creditsUsed = Number(result?.creditsUsed || result?.credits_used || 0);
      totalCreditsUsed += stat.creditsUsed;
      let resultData = result?.data || {};
      if (typeof resultData === 'string') resultData = JSON.parse(resultData);
      const targetPosts = Array.isArray(resultData?.posts) ? resultData.posts : [];
      rawPosts.push(...targetPosts.map((post) => ({ ...post, discovery_target: targetUrl })));
      stat.status = 'completed';
      stat.rawCandidates = targetPosts.length;
      completedSources += 1;
      console.log(`   ${targetUrl} → ${targetPosts.length} Rohposts`);
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

  console.log(`🔍 Agent returned ${rawPosts.length} Rohposts`);

  for (const post of rawPosts) {
    const validityPeriod = normalizeText(post.validity_period);
    const location = normalizeText(post.location);
    const itemOrService = normalizeText(post.item_or_service || post.food_and_drinks);
    const originalPostUrl = normalizeText(post.original_post_url);
    const postTimestampRaw = normalizeText(post.post_timestamp);
    const offerType = normalizeText(post.offer_type);
    const ownerUsername = normalizeText(post.owner_username).replace(/^@/, '').toLowerCase();
    const offerSignal = `${itemOrService} ${offerType} ${validityPeriod}`;

    if (looksLikeGiveaway(offerSignal)) {
      rejected.push({
        reason: 'excluded-giveaway',
        deal: { title: offerType || itemOrService, brand: ownerUsername || location, url: originalPostUrl },
      });
      continue;
    }
    if (looksLikePureRestaurantIntro(offerSignal) || !hasRequiredOfferSignal(offerSignal)) {
      rejected.push({
        reason: 'missing-concrete-offer',
        deal: { title: offerType || itemOrService, brand: ownerUsername || location, url: originalPostUrl },
      });
      continue;
    }

    if (!originalPostUrl || !isInstagramPostUrl(originalPostUrl)) {
      rejected.push({
        reason: 'invalid-original-post-url',
        deal: {
          title: offerType || itemOrService,
          brand: ownerUsername || location,
          url: originalPostUrl,
        },
      });
      continue;
    }

    const brand = ownerUsername || location.split(',')[0] || 'Instagram';
    const titleCore = offerType || itemOrService || 'Instagram Freebie';
    const title = `${brand}: ${titleCore}`.slice(0, 140);
    const type = inferType(offerSignal);
    const category = /(kosmetik|beauty|make.?up|parfum|pflege|shampoo|drogerie)/i.test(`${itemOrService} ${offerType}`)
      ? 'beauty'
      : (/(haushalt|reiniger|waschmittel|produkt|artikel)/i.test(`${itemOrService} ${offerType}`)
          ? 'shopping'
          : inferCategory(itemOrService, offerType));
    deals.push({
      id: dealId(brand, title, originalPostUrl),
      brand,
      title,
      description: [itemOrService, offerType, location].filter(Boolean).join(' | '),
      type,
      category,
      source: 'Firecrawl Key 3 - Consumables',
      url: originalPostUrl,
      expires: '',
      expiresOriginal: validityPeriod,
      expiryDisplayText: validityPeriod,
      distance: location,
      hot: type === 'gratis' || type === 'bogo',
      isNew: true,
      priority: type === 'gratis' ? 1 : type === 'bogo' ? 2 : 4,
      votes: 1,
      qualityScore: type === 'gratis' ? 84 : type === 'bogo' ? 78 : 62,
      ownerUsername,
      reportedPostDate: postTimestampRaw,
      discoveryTarget: normalizeText(post.discovery_target),
      discoveryMethod: normalizeText(post.discovery_method) || 'firecrawl-agent',
    });
  }

  const history = mergeFirecrawlDealHistory(deals, previousOutput.deals, {
    now: RUN_STARTED_AT,
  });
  console.log(`🛡️ Fresh history: ${history.retainedPreviousDeals}/${history.previousDeals}; exact duplicates merged: ${history.duplicateCount}`);
  const verifiedDeals = await verifyFirecrawlDeals(history.deals, {
    sourceKey: 'firecrawl-key3-consumables',
    now: RUN_STARTED_AT,
  });
  const verifiedIDs = new Set(verifiedDeals.map((deal) => deal.id));
  rejected.push(...deals
    .filter((deal) => !verifiedIDs.has(deal.id))
    .map((deal) => ({ reason: 'post-verification-rejected', deal })));

  console.log(`✅ Final: ${verifiedDeals.length} Deals`);

  const output = {
    lastUpdated: new Date().toISOString(),
    source: 'firecrawl3',
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
    rawCandidates: rawPosts.length,
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

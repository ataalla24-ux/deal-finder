import '../sentry/instrument.mjs';
// ============================================
// 🍔🔥 FIRECRAWL FOOD AGENT #2
// Breiter Intake für Instagram-Angebote zu Essen & Getränken
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

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY2 || process.env.FIRECRAWL_API_KEY;
const SOURCE_KEY = 'food3';
const SOURCE_LABEL = 'Firecrawl Key 2 - Food';
const OUTPUT_PATH = 'docs/deals-pending-food3.json';
const RUN_STARTED_AT = new Date();
const AGENT_TIMEOUT_SECONDS = positiveInteger(process.env.FIRECRAWL2_AGENT_TIMEOUT_SECONDS, 120);
const MAX_CREDITS_PER_TARGET = positiveInteger(process.env.FIRECRAWL2_MAX_CREDITS_PER_TARGET, 300);
const TARGETS_PER_RUN = positiveInteger(process.env.FIRECRAWL2_TARGETS_PER_RUN, 3);
const DISCOVERY_URLS = [
  'https://www.instagram.com/explore/tags/wienessen/',
  'https://www.instagram.com/explore/tags/viennafood/',
  'https://www.instagram.com/explore/tags/fooddealsvienna/',
  'https://www.instagram.com/explore/tags/happyhourwien/',
  'https://www.instagram.com/explore/tags/lunchdealwien/',
  'https://www.instagram.com/explore/tags/neueröffnungwien/',
];
const ACTIVE_DISCOVERY_URLS = selectRotatingFirecrawlTargets(
  DISCOVERY_URLS,
  TARGETS_PER_RUN,
  RUN_STARTED_AT,
);
const DISCOVERY_PROMPT = "Extrahiere möglichst viele konkrete Instagram-Angebote rund um Essen und Getränke, die in Wien nutzbar sind. Untersuche das angegebene Hashtag-Ziel und folge nur direkten Originalposts. Nimm nur Originalposts aus den letzten 7 Tagen auf; prüfe dabei ausdrücklich Tag, Monat und Jahr. Ein Angebot darf erst in Zukunft beginnen, solange der Post selbst höchstens 7 Tage alt ist. Erfasse Anbietername, Produktart, exakten Wien-Standort, Angebotszeiten, Teilnahmebedingungen, echten Account-Handle, Veröffentlichungsdatum und direkten /p/...- oder /reel/...-Link. Verwechsle Veröffentlichungsdatum und Angebotszeitraum nicht. Lass bekannte alte Posts, Gewinnspiele, allgemeine Empfehlungen, Gratis-Versand und Posts ohne konkreten Preisvorteil weg. Ist nur das exakte Datum unlesbar, der direkte Originalpost aber eindeutig frisch, gib ihn zur Graph-Verifikation trotzdem zurück.";

if (!FIRECRAWL_API_KEY) {
  const error = new Error('FIRECRAWL_API_KEY2 oder FIRECRAWL_API_KEY nicht gesetzt');
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

const schema = z.object({
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
    offer_type: z.string(),
    offer_type_citation: z.string().optional(),
    post_url: z.string(),
    post_url_citation: z.string().optional(),
    owner_username: z.string().optional(),
    owner_username_citation: z.string().optional(),
    post_date: z.string().optional(),
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

function dealId(prefix, brand, title, url) {
  return `${prefix}-${stableHash(`${brand}|${title}|${url}`)}`;
}

function isInstagramPostUrl(url) {
  return /^https?:\/\/(www\.)?instagram\.com\/(p|reel)\//i.test(normalizeText(url));
}

function hasConcreteOfferSignal(text) {
  return /(gratis|kostenlos|free|umsonst|0 ?€|1\s*\+\s*1|2\s*(?:für|for)\s*1|bogo|\d{1,2}\s*%|rabatt|aktion|angebot|coupon|gutschein|happy hour|statt\s+(?:€\s*)?\d)/i.test(text);
}

function inferType(offerType, details) {
  const haystack = `${normalizeText(offerType)} ${normalizeText(details)}`;
  if (/(gewinnspiel|giveaway|verlosung|zu gewinnen|tagge|markiere|kommentiere.*gewinn)/i.test(haystack)) {
    return 'event';
  }
  if (/(1\s*\+\s*1|2\s*für\s*1|2 for 1|buy one get one|bogo)/i.test(haystack)) {
    return 'bogo';
  }
  if (/(gratis|kostenlos|free|umsonst|0 ?€)/i.test(haystack)) {
    return 'gratis';
  }
  return 'rabatt';
}

function inferCategory(productType, details) {
  const haystack = `${normalizeText(productType)} ${normalizeText(details)}`;
  if (/(kaffee|coffee|espresso|latte|cappuccino|tee|matcha|drink|getränk|getraenk|smoothie|saft|cocktail|spritz|bier|beer|wein|wine)/i.test(haystack)) {
    return 'kaffee';
  }
  return 'essen';
}

function getEmoji(category, type, text) {
  if (type === 'bogo') return '1+1';
  if (type === 'event') return '🎉';
  if (category === 'kaffee') return '☕';
  if (/pizza/i.test(text)) return '🍕';
  if (/burger/i.test(text)) return '🍔';
  if (/kebab|döner|doener|falafel/i.test(text)) return '🥙';
  if (/eis|gelato/i.test(text)) return '🍦';
  return type === 'gratis' ? '🎁' : '🍽️';
}

async function main() {
  console.log('🍔🔥 FIRECRAWL FOOD AGENT #2');
  console.log('='.repeat(40));
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
          provider_name: post.ownerUsername || 'Instagram',
          product_type: post.title,
          location: '',
          times: '',
          participation_conditions: post.description,
          offer_type: post.description,
          post_url: post.url,
          owner_username: post.ownerUsername,
          post_date: '',
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
        schema,
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
  console.log(`📦 Rohangebote: ${rawOffers.length}`);

  const deals = [];
  const rejected = [];

  for (const offer of rawOffers) {
    const providerName = normalizeText(offer.provider_name) || 'Instagram';
    const productType = normalizeText(offer.product_type);
    const location = normalizeText(offer.location);
    const times = normalizeText(offer.times);
    const conditions = normalizeText(offer.participation_conditions);
    const offerTypeText = normalizeText(offer.offer_type);
    const postUrl = normalizeText(offer.post_url);
    const ownerUsername = normalizeText(offer.owner_username).replace(/^@/, '').toLowerCase();
    const reportedPostDate = normalizeText(offer.post_date);
    const combined = `${providerName} ${productType} ${location} ${times} ${conditions} ${offerTypeText}`;

    if (!postUrl || !isInstagramPostUrl(postUrl)) {
      rejected.push({
        reason: 'invalid-original-post-url',
        deal: {
          title: productType || offerTypeText,
          brand: providerName,
          url: postUrl,
        },
      });
      continue;
    }

    const type = inferType(offerTypeText, `${productType} ${conditions}`);
    if (type === 'event' || !hasConcreteOfferSignal(combined)) {
      rejected.push({
        reason: type === 'event' ? 'excluded-giveaway' : 'missing-concrete-offer',
        deal: { title: productType || offerTypeText, brand: providerName, url: postUrl },
      });
      continue;
    }
    const category = inferCategory(productType, `${offerTypeText} ${conditions}`);
    const titleCore = productType || offerTypeText || 'Instagram-Angebot';
    const title = `${providerName}: ${titleCore}`.slice(0, 140);
    const description = [offerTypeText, productType, location, times, conditions]
      .filter(Boolean)
      .join(' | ')
      .slice(0, 400);

    deals.push({
      id: dealId('food3', providerName, title, postUrl),
      brand: providerName,
      title,
      logo: getEmoji(category, type, `${title} ${description}`),
      description: description || providerName,
      type,
      category,
      source: 'Firecrawl Food #2',
      url: postUrl,
      expires: '',
      expiresOriginal: times,
      expiryDisplayText: times,
      distance: location || 'Ort unklar',
      hot: type === 'gratis' || type === 'bogo',
      isNew: true,
      priority: type === 'gratis' ? 2 : type === 'bogo' ? 3 : 4,
      votes: 1,
      qualityScore: type === 'gratis' ? 72 : type === 'bogo' ? 70 : 58,
      ownerUsername,
      reportedPostDate,
      discoveryTarget: normalizeText(offer.discovery_target),
      discoveryMethod: normalizeText(offer.discovery_method) || 'firecrawl-agent',
    });
  }

  const history = mergeFirecrawlDealHistory(deals, previousOutput.deals, {
    now: RUN_STARTED_AT,
  });
  console.log(`🛡️ Fresh history: ${history.retainedPreviousDeals}/${history.previousDeals}; exact duplicates merged: ${history.duplicateCount}`);
  const verifiedDeals = await verifyFirecrawlDeals(history.deals, {
    sourceKey: 'firecrawl-key2-food',
    now: RUN_STARTED_AT,
  });
  const verifiedIDs = new Set(verifiedDeals.map((deal) => deal.id));
  rejected.push(...deals
    .filter((deal) => !verifiedIDs.has(deal.id))
    .map((deal) => ({ reason: 'post-verification-rejected', deal })));

  const output = {
    lastUpdated: new Date().toISOString(),
    source: 'firecrawl-food3',
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
  console.log(`✅ Final: ${verifiedDeals.length} Deals`);
  console.log('💾 Deals → docs/deals-pending-food3.json');
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

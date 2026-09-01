import '../sentry/instrument.mjs';
// ============================================
// 🍕🔥 FIRECRAWL GASTRO AGENT #2
// Fokus: Gastronomie - Mahlzeiten unter €3, 50%+ Rabatt, Döner €1,99
// ============================================

import Firecrawl from '@mendable/firecrawl-js';
import { z } from 'zod';
import fs from 'fs';
import {
  mergeFirecrawlDealHistory,
  normalizeInstagramPostUrl,
  readFirecrawlDealOutput,
  verifyFirecrawlDeals,
} from './firecrawl-post-verifier.js';
import {
  isFirecrawlRateOrCreditError,
  positiveInteger,
  runBoundedFirecrawlAgent,
} from './firecrawl-agent-utils.js';
import {
  inferFirecrawlSearchDealType,
  isConcreteFirecrawlSearchResult,
  searchFreshInstagramPosts,
  searchFreshWebDeals,
} from './firecrawl-search-utils.js';
import {
  GASTRO_DISCOVERY_BASE_PROMPT,
  getExcludedGastroDiscoverySource,
} from './firecrawl-gastro-discovery-policy.js';
import {
  buildPipelineRunReport,
  summarizeVerifiedDeals,
  writeFailedPipelineRunReport,
  writePipelineRunReport,
} from './pipeline-run-report-utils.js';

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY1 || process.env.FIRECRAWL_API_KEY;
const SOURCE_KEY = 'gastro2';
const SOURCE_LABEL = 'Firecrawl Key 1 - Gastro';
const OUTPUT_PATH = 'docs/deals-pending-gastro2.json';
const RUN_STARTED_AT = new Date();
const AGENT_TIMEOUT_SECONDS = positiveInteger(process.env.FIRECRAWL1_AGENT_TIMEOUT_SECONDS, 420);
const MAX_CREDITS_PER_AGENT = positiveInteger(process.env.FIRECRAWL1_MAX_CREDITS_PER_TARGET, 500);
const BROAD_AGENT_PASSES = positiveInteger(process.env.FIRECRAWL1_BROAD_AGENT_PASSES, 4);

if (!FIRECRAWL_API_KEY) {
  const error = new Error('FIRECRAWL_API_KEY1 oder FIRECRAWL_API_KEY nicht gesetzt');
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

async function runAgent(payload) {
  return runBoundedFirecrawlAgent(firecrawl, payload, {
    timeoutSeconds: AGENT_TIMEOUT_SECONDS,
    maxCredits: MAX_CREDITS_PER_AGENT,
  });
}

// ============================================
// SEITEN
// ============================================

const SCRAPE_URLS = [
  'https://www.instagram.com/explore/tags/gratiswien/',
  'https://www.instagram.com/explore/tags/wienfood/',
  'https://www.instagram.com/explore/tags/wienessen/',
  'https://www.instagram.com/explore/tags/aktionwien/',
  'https://www.instagram.com/explore/tags/schnäppchenwien/',
  'https://www.instagram.com/explore/tags/gutscheinwien/',
  'https://www.instagram.com/explore/tags/wiengutschein/',
  'https://www.instagram.com/explore/tags/essensangebotwien/',
  'https://www.instagram.com/explore/tags/restaurantangebotwien/',
  'https://www.instagram.com/explore/tags/foodaktionwien/',
  'https://www.ikea.com/at/de/offers/',
  'https://www.marktguru.at/c/essensgutscheine',
];

const BROAD_DISCOVERY_FOCUSES = [
  'Suche ausschließlich auf Instagram und TikTok nach neuen Wiener Gastro-Aktionen. Liefere direkte Originalposts statt Profile, Hashtag-Seiten oder Web-Sammellisten.',
  'Durchsuche Gutschein.at, Preisjaeger.at, Marktguru, Sparhamster, GuteGutscheine und Studentenportale. Nutze nur konkrete Aktions- oder Detailseiten und verteile die Funde über mehrere Domains.',
  'Suche auf Social Media, direkten Restaurant- und Markenwebseiten sowie lokalen Veranstalterseiten nach Wiener Neueröffnungen, zeitlich begrenzten Gastro-Aktionen und Gratisangeboten. Keine Restaurantverzeichnisse, Buchungsportale oder redaktionellen Sammellisten verwenden.',
  'Durchsuche Wolt und Lieferando sowie direkte Restaurantseiten nach 1+1, Gratisartikeln und Rabatten ab 30 Prozent in Wien. Liefere höchstens zwei Deals von Wolt und höchstens zwei von Lieferando und bevorzuge unterschiedliche Restaurants mit konkret sichtbarem Angebot.',
];
const ACTIVE_BROAD_DISCOVERY_FOCUSES = BROAD_DISCOVERY_FOCUSES.slice(
  0,
  Math.min(BROAD_AGENT_PASSES, BROAD_DISCOVERY_FOCUSES.length),
);

function isInstagramUrl(url) {
  return (url || '').includes('instagram.com');
}

// ============================================
// SCHEMA
// ============================================

const gastroSchema = z.object({
  deals: z.array(z.object({
    category: z.string(),
    category_citation: z.string().optional(),
        brand_or_store: z.string(),
        brand_or_store_citation: z.string().optional(),
    item_given_away: z.string(),
    item_given_away_citation: z.string().optional(),
    location: z.string(),
    location_citation: z.string().optional(),
    validity_date: z.string(),
    validity_date_citation: z.string().optional(),
    validity_time: z.string(),
    validity_time_citation: z.string().optional(),
    post_url: z.string(),
    post_url_citation: z.string().optional(),
    owner_username: z.string().optional(),
    owner_username_citation: z.string().optional(),
    post_date: z.string().optional(),
    post_date_citation: z.string().optional(),
  })),
});

// ============================================
// PROMPT
// ============================================

const PROMPT = GASTRO_DISCOVERY_BASE_PROMPT;

// ============================================
// MAIN
// ============================================


// ============================================
// STABILE DEAL-ID (Hash statt Date.now/random)
// ============================================
function stableHash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash = hash >>> 0;
  }
  return hash.toString(36);
}
function dealId(prefix, brand, title, url) {
  const key = (brand || '') + '|' + (title || '') + '|' + (url || '');
  return prefix + '-' + stableHash(key);
}

async function main() {
  console.log('🍕🔥 FIRECRAWL GASTRO AGENT #2');
  console.log('='.repeat(40));
  console.log(`📅 ${new Date().toLocaleString('de-AT')}`);
  console.log();

  const previousOutput = readFirecrawlDealOutput(OUTPUT_PATH);
  const allDeals = [];
  const rejected = [];
  const runErrors = [];
  const sourceStats = [];
  let rawCandidateCount = 0;
  let completedSources = 0;
  let totalCreditsUsed = 0;
  
  console.log(`🔎 Ergänzende Fresh Search über ${SCRAPE_URLS.length} Ziele...`);

  for (let i = 0; i < SCRAPE_URLS.length; i++) {
    const url = SCRAPE_URLS[i];
    const source = new URL(url).hostname.replace('www.', '');
    const stat = {
      id: `search:${i + 1}`,
      kind: 'fresh-search',
      url,
      status: 'started',
      rawCandidates: 0,
      searchCandidates: 0,
      normalizedCandidates: 0,
      creditsUsed: 0,
    };
    const normalizedBefore = allDeals.length;

    console.log(`   [${i + 1}/${SCRAPE_URLS.length}] ${source}...`);

    try {
      const searchRows = isInstagramUrl(url)
        ? await searchFreshInstagramPosts(firecrawl, url, { now: RUN_STARTED_AT, limit: 12 })
        : await searchFreshWebDeals(firecrawl, url, { now: RUN_STARTED_AT, limit: 12 });
      const relevantRows = searchRows
        .filter(isConcreteFirecrawlSearchResult)
        .filter((row) => !getExcludedGastroDiscoverySource(row, row.url));
      stat.searchCandidates = relevantRows.length;
      if (relevantRows.length > 0) {
        for (const row of relevantRows) {
          const brand = row.ownerUsername || row.title || source;
          const title = row.title || row.description.slice(0, 120) || 'Aktueller Deal';
          allDeals.push({
            id: dealId('g2', brand, title, row.url),
            brand,
            title: title.slice(0, 140),
            description: row.description || title,
            type: inferFirecrawlSearchDealType(row),
            category: 'essen',
            source: 'Firecrawl Gastro #2 Search',
            url: row.url,
            expires: '',
            expiresOriginal: '',
            distance: '',
            hot: true,
            isNew: true,
            priority: 3,
            votes: 1,
            qualityScore: 60,
            ownerUsername: row.ownerUsername || '',
            discoveryTarget: url,
            discoveryMethod: row.discoveryMethod,
          });
        }
        console.log(`      → ${relevantRows.length} direkte Treffer via Firecrawl Search`);
      }
      rawCandidateCount += relevantRows.length;
      completedSources += 1;
      stat.status = 'completed-search';
      stat.rawCandidates = relevantRows.length;
    } catch (error) {
      stat.status = 'failed-search';
      stat.searchError = error.message;
      runErrors.push(`${source} Search: ${error.message}`);
      console.log(`      → Search-Warnung: ${error.message}`);
    }

    stat.normalizedCandidates = allDeals.length - normalizedBefore;
    sourceStats.push(stat);
  }

  console.log();
  console.log(`🌐 ${ACTIVE_BROAD_DISCOVERY_FOCUSES.length} breite Agent-Suchen wie im erfolgreichen August-Setup...`);
  console.log(`💳 Maximal ${MAX_CREDITS_PER_AGENT} Credits und ${AGENT_TIMEOUT_SECONDS}s pro Agent-Suche`);

  for (let i = 0; i < ACTIVE_BROAD_DISCOVERY_FOCUSES.length; i++) {
    const focus = ACTIVE_BROAD_DISCOVERY_FOCUSES[i];
    const normalizedBefore = allDeals.length;
    const stat = {
      id: `broad-agent:${i + 1}`,
      kind: 'broad-agent',
      label: `Breite Suche ${i + 1}`,
      status: 'started',
      rawCandidates: 0,
      normalizedCandidates: 0,
      creditsUsed: 0,
    };
    let stopAfterPass = false;

    console.log(`   [${i + 1}/${ACTIVE_BROAD_DISCOVERY_FOCUSES.length}] Breite Suche ${i + 1}...`);

    try {
      const result = await runAgent({
        prompt: `${PROMPT}\n\nSchwerpunkt dieses Durchlaufs: ${focus}\nLiefere möglichst andere konkrete Deals als in naheliegenden Standardsuchen.`,
        schema: gastroSchema,
        model: 'spark-1-pro',
      });
      stat.creditsUsed = Number(result?.creditsUsed || result?.credits_used || 0);
      totalCreditsUsed += stat.creditsUsed;
      
      if (result && result.data) {
        let data = result.data;
        
        if (typeof data === 'string') {
          try {
            data = JSON.parse(data);
          } catch (e) {}
        }
        
        if (data && data.deals && Array.isArray(data.deals)) {
          completedSources += 1;
          rawCandidateCount += data.deals.length;
          stat.status = 'completed-agent';
          stat.rawCandidates = data.deals.length;
          console.log(`      → ${data.deals.length} Deals gefunden`);
          
          for (const d of data.deals) {
            const reportedUrl = (d.post_url || '').trim();
            
            if (!reportedUrl) {
              rejected.push({
                reason: 'missing-target-url',
                deal: {
                  title: d.item_given_away || '',
                  brand: d.brand_or_store || 'Unbekannt',
                },
              });
              continue;
            }

            const postUrl = isInstagramUrl(reportedUrl)
              ? normalizeInstagramPostUrl(reportedUrl)
              : reportedUrl;
            if (!postUrl) {
              rejected.push({
                reason: 'instagram-profile-not-post',
                deal: {
                  title: d.item_given_away || '',
                  brand: d.brand_or_store || 'Unbekannt',
                  url: reportedUrl,
                },
              });
              continue;
            }

            const excludedSource = getExcludedGastroDiscoverySource(d, postUrl);
            if (excludedSource) {
              rejected.push({
                reason: `excluded-downstream-source:${excludedSource}`,
                deal: {
                  title: d.item_given_away || '',
                  brand: d.brand_or_store || 'Unbekannt',
                  url: postUrl,
                },
              });
              continue;
            }
            
            const isGratis = /gratis|kostenlos|free|0€|umsonst/i.test(d.item_given_away || '');
            const brand = d.brand_or_store || 'Unbekannt';
            const title = d.item_given_away?.substring(0, 60) || 'Gastro Deal';
            const ownerUsername = (d.owner_username || '').replace(/^@/, '').trim().toLowerCase();
            
            allDeals.push({
              id: dealId('g2', brand, title, postUrl),
              brand,
              title,
              description: [d.item_given_away, d.location].filter(Boolean).join(' – '),
              type: isGratis ? 'gratis' : 'rabatt',
              category: 'essen',
              source: 'Firecrawl Gastro #2',
              url: postUrl,
              expires: `${d.validity_date || ''} ${d.validity_time || ''}`.trim(),
              distance: d.location || '',
              hot: true,
              isNew: true,
              priority: isGratis ? 2 : 3,
              votes: 1,
              qualityScore: 65,
              ownerUsername,
              reportedPostDate: d.post_date || '',
              expiresOriginal: `${d.validity_date || ''} ${d.validity_time || ''}`.trim(),
              discoveryTarget: stat.id,
              discoveryTargetLabel: stat.label,
              discoveryMethod: 'firecrawl-agent',
            });
          }
        }
      }
    } catch (e) {
      console.log(`      → Error: ${e.message}`);
      stat.status = 'failed';
      stat.error = e.message;
      stat.creditsUsed = Number(e?.creditsUsed || 0);
      totalCreditsUsed += stat.creditsUsed;
      runErrors.push(`${stat.label}: ${e.message}`);
      if (isFirecrawlRateOrCreditError(e.message)) {
        console.log('      → Stoppe Run frühzeitig wegen API-Limit/Credits');
        stopAfterPass = true;
      }
    }
    stat.normalizedCandidates = allDeals.length - normalizedBefore;
    sourceStats.push(stat);
    if (stopAfterPass) break;
  }

  console.log();
  console.log('📊 ERGEBNIS:');
  console.log(`   📦 Deals: ${allDeals.length}`);
  const eligiblePreviousDeals = [];
  let excludedPreviousDeals = 0;
  for (const deal of previousOutput.deals) {
    const excludedSource = getExcludedGastroDiscoverySource(deal, deal.url);
    if (excludedSource) {
      excludedPreviousDeals += 1;
      rejected.push({ reason: `excluded-downstream-history:${excludedSource}`, deal });
      continue;
    }
    eligiblePreviousDeals.push(deal);
  }
  const history = mergeFirecrawlDealHistory(allDeals, eligiblePreviousDeals, {
    now: RUN_STARTED_AT,
  });
  console.log(`🛡️ Fresh history: ${history.retainedPreviousDeals}/${history.previousDeals}; excluded history pruned: ${excludedPreviousDeals}; exact duplicates merged: ${history.duplicateCount}`);
  const finalDeals = await verifyFirecrawlDeals(history.deals, {
    sourceKey: 'firecrawl-key1-gastro',
    now: RUN_STARTED_AT,
  });
  const verifiedIDs = new Set(finalDeals.map((deal) => deal.id));
  rejected.push(...allDeals
    .filter((deal) => !verifiedIDs.has(deal.id))
    .map((deal) => ({ reason: 'post-verification-rejected', deal })));
  
  const output = {
    lastUpdated: new Date().toISOString(),
    source: 'gastro2',
    totalDeals: finalDeals.length,
    freshDiscoveryDeals: allDeals.length,
    retainedPreviousDeals: history.retainedPreviousDeals,
    pipelineReport: `deal-pipeline-last-run-${SOURCE_KEY}.json`,
    deals: finalDeals,
  };
  
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  writePipelineRunReport(buildPipelineRunReport({
    sourceKey: SOURCE_KEY,
    sourceLabel: SOURCE_LABEL,
    startedAt: RUN_STARTED_AT,
    finishedAt: new Date(),
    status: runErrors.length > 0 ? 'completed-with-errors' : 'completed',
    outputFile: OUTPUT_PATH,
    rawCandidates: rawCandidateCount,
    normalizedCandidates: allDeals.length,
    verifiedCandidates: finalDeals.length,
    previousDeals: previousOutput.deals.length,
    acceptedDeals: finalDeals.length,
    rejected,
    diagnostics: {
      configuredSources: SCRAPE_URLS.length + ACTIVE_BROAD_DISCOVERY_FOCUSES.length,
      attemptedSources: sourceStats.length,
      completedSources,
      searchTargets: SCRAPE_URLS.length,
      broadAgentPasses: ACTIVE_BROAD_DISCOVERY_FOCUSES.length,
      agentTimeoutSeconds: AGENT_TIMEOUT_SECONDS,
      maxCreditsPerAgent: MAX_CREDITS_PER_AGENT,
      totalCreditsUsed,
      retainedPreviousDeals: history.retainedPreviousDeals,
      prunedPreviousDeals: history.prunedPreviousDeals,
      excludedPreviousDeals,
      duplicateCandidatesMerged: history.duplicateCount,
      sourceStats,
      verifier: summarizeVerifiedDeals(finalDeals),
    },
    errors: runErrors,
  }));
  console.log(`💾 ${finalDeals.length} Deals → ${OUTPUT_PATH}`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
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

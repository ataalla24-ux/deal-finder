import '../sentry/instrument.mjs';
// ============================================
// 🍕🔥 FIRECRAWL GASTRO AGENT #4
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
  buildPipelineRunReport,
  summarizeVerifiedDeals,
  writeFailedPipelineRunReport,
  writePipelineRunReport,
} from './pipeline-run-report-utils.js';
import {
  GASTRO2_BASE_PROMPT,
  buildTargetPrompt,
  selectScrapeTargets,
} from './firecrawl-instagram-direct4-config.js';

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY4;
const SOURCE_KEY = 'firecrawl4';
const SOURCE_LABEL = 'Firecrawl Key 4 - Gastro Discovery';
const OUTPUT_PATH = 'docs/deals-pending-firecrawl4.json';
const RUN_STARTED_AT = new Date();
const DEFAULT_MAX_CREDITS_PER_TARGET = 500;
const MAX_CREDITS_PER_TARGET = positiveInteger(
  process.env.FIRECRAWL4_MAX_CREDITS_PER_TARGET,
  DEFAULT_MAX_CREDITS_PER_TARGET,
);
const AGENT_TIMEOUT_SECONDS = positiveInteger(process.env.FIRECRAWL4_AGENT_TIMEOUT_SECONDS, 360);
const MAX_AGENT_FALLBACKS = positiveInteger(process.env.FIRECRAWL4_MAX_AGENT_FALLBACKS, 1);
const BROAD_AGENT_PASSES = positiveInteger(process.env.FIRECRAWL4_BROAD_AGENT_PASSES, 2);
const SCRAPE_TARGETS = selectScrapeTargets(RUN_STARTED_AT);
const BROAD_DISCOVERY_FOCUSES = [
  'Durchsuche Instagram, TikTok und das offene Web breit nach Wiener Gastro-Angeboten. Nutze besonders alternative Hashtags, lokale Food-Accounts und Neueröffnungs-Posts; liefere direkte Originalpost- oder Aktionslinks.',
  'Durchsuche besonders Gutschein.at, Preisjaeger.at, Marktguru, Sparhamster, Wolt, Lieferando und direkte Restaurantseiten nach aktuell nutzbaren Wiener Gratisaktionen, 1+1-Angeboten und Rabatten ab 30 Prozent.',
].slice(0, Math.min(BROAD_AGENT_PASSES, 2));

if (!FIRECRAWL_API_KEY) {
  const error = new Error('FIRECRAWL_API_KEY4 nicht gesetzt');
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
    maxCredits: MAX_CREDITS_PER_TARGET,
  });
}

function isInstagramUrl(url) {
  return (url || '').includes('instagram.com');
}

function belongsToWebTarget(url, targetUrl) {
  try {
    return new URL(url).hostname.replace(/^www\./, '') === new URL(targetUrl).hostname.replace(/^www\./, '');
  } catch {
    return false;
  }
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
  console.log('🍕🔥 FIRECRAWL GASTRO AGENT #4');
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
  let agentFallbacks = 0;
  let creditLimitReached = false;

  console.log(`🔍 Scrape ${SCRAPE_TARGETS.length} echte Ziele (Gastro Focus)...`);
  console.log(`💳 Maximal ${MAX_CREDITS_PER_TARGET} Credits und ${AGENT_TIMEOUT_SECONDS}s pro Ziel`);

  for (let i = 0; i < SCRAPE_TARGETS.length; i++) {
    const target = SCRAPE_TARGETS[i];
    const normalizedBefore = allDeals.length;
    const rejectedBefore = rejected.length;
    const stat = {
      id: target.id,
      kind: target.kind,
      label: target.label,
      url: target.url,
      status: 'started',
      rawCandidates: 0,
      normalizedCandidates: 0,
      rejectedCandidates: 0,
      searchCandidates: 0,
      creditsUsed: 0,
    };
    let stopAfterTarget = false;

    console.log(`   [${i + 1}/${SCRAPE_TARGETS.length}] ${target.label} (${target.kind})...`);

    try {
      const searchRows = target.kind.startsWith('instagram-')
        ? await searchFreshInstagramPosts(firecrawl, target.url, { now: RUN_STARTED_AT, limit: 12 })
        : await searchFreshWebDeals(firecrawl, target.url, { now: RUN_STARTED_AT, limit: 12 });
      const relevantRows = searchRows.filter(isConcreteFirecrawlSearchResult);
      stat.searchCandidates = relevantRows.length;
      if (relevantRows.length > 0) {
        for (const row of relevantRows) {
          const brand = row.ownerUsername || row.title || target.label;
          const title = row.title || row.description.slice(0, 120) || 'Aktueller Gastro Deal';
          allDeals.push({
            id: dealId('fc4g', brand, title, row.url),
            brand,
            title: title.slice(0, 140),
            description: row.description || title,
            type: inferFirecrawlSearchDealType(row),
            category: 'essen',
            source: 'Firecrawl Gastro #4 Search',
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
            discoveryTarget: target.id,
            discoveryTargetLabel: target.label,
            discoveryMethod: row.discoveryMethod,
          });
        }
        completedSources += 1;
        rawCandidateCount += relevantRows.length;
        stat.status = 'completed-search';
        stat.rawCandidates = relevantRows.length;
        stat.normalizedCandidates = allDeals.length - normalizedBefore;
        sourceStats.push(stat);
        console.log(`      → ${relevantRows.length} direkte Treffer via Firecrawl Search`);
        continue;
      }
    } catch (error) {
      stat.searchError = error.message;
      console.log(`      → Search-Warnung: ${error.message}`);
    }

    if (agentFallbacks >= MAX_AGENT_FALLBACKS) {
      stat.status = 'search-empty';
      sourceStats.push(stat);
      console.log('      → Kein Search-Treffer; Agent-Fallback-Budget für diesen Lauf ausgeschöpft');
      continue;
    }
    agentFallbacks += 1;

    try {
      const result = await runAgent({
        urls: [target.url],
        prompt: buildTargetPrompt(target),
        schema: gastroSchema,
        model: target.kind === 'web-deal-list' ? 'spark-1-pro' : 'spark-1-mini',
      });

      if (Number.isFinite(Number(result?.creditsUsed))) {
        stat.creditsUsed = Number(result.creditsUsed);
        totalCreditsUsed += stat.creditsUsed;
      }

      if (result?.status === 'failed' || result?.success === false) {
        throw new Error(result?.error || 'Firecrawl Agent fehlgeschlagen');
      }

      if (result?.data) {
        let data = result.data;

        if (typeof data === 'string') {
          try {
            data = JSON.parse(data);
          } catch (error) {
            throw new Error(`Ungültige Agent-Antwort: ${error.message}`);
          }
        }

        if (data && data.deals && Array.isArray(data.deals)) {
          completedSources += 1;
          rawCandidateCount += data.deals.length;
          stat.status = 'completed';
          stat.rawCandidates = data.deals.length;
          console.log(`      → ${data.deals.length} Deals gefunden`);

          for (const d of data.deals) {
            const postUrl = d.post_url || '';

            if (!postUrl) {
              rejected.push({
                reason: 'missing-target-url',
                deal: {
                  title: d.item_given_away || '',
                  brand: d.brand_or_store || target.label,
                },
              });
              continue;
            }

            const targetUrl = isInstagramUrl(postUrl)
              ? normalizeInstagramPostUrl(postUrl)
              : postUrl;
            if (!targetUrl) {
              rejected.push({
                reason: 'instagram-profile-not-post',
                deal: {
                  title: d.item_given_away || '',
                  brand: d.brand_or_store || target.label,
                  url: postUrl,
                },
              });
              continue;
            }

            if (target.kind.startsWith('instagram-') && !isInstagramUrl(targetUrl)) {
              rejected.push({
                reason: 'instagram-target-returned-web-result',
                deal: {
                  title: d.item_given_away || '',
                  brand: d.brand_or_store || target.label,
                  url: targetUrl,
                },
              });
              continue;
            }
            if (target.kind === 'web-deal-list' && !belongsToWebTarget(targetUrl, target.url)) {
              rejected.push({
                reason: 'web-target-returned-other-domain',
                deal: {
                  title: d.item_given_away || '',
                  brand: d.brand_or_store || target.label,
                  url: targetUrl,
                },
              });
              continue;
            }
            if (!isConcreteFirecrawlSearchResult({
              title: d.item_given_away,
              description: `${d.category || ''} ${d.validity_date || ''} ${d.validity_time || ''}`,
            })) {
              rejected.push({
                reason: 'missing-concrete-offer-or-giveaway',
                deal: {
                  title: d.item_given_away || '',
                  brand: d.brand_or_store || target.label,
                  url: targetUrl,
                },
              });
              continue;
            }

            const isGratis = /gratis|kostenlos|free|0€|umsonst/i.test(d.item_given_away || '');
            const brand = d.brand_or_store || target.label;
            const title = d.item_given_away?.substring(0, 60) || 'Gastro Deal';
            const ownerUsername = (d.owner_username || '').replace(/^@/, '').trim().toLowerCase();

            allDeals.push({
              id: dealId('fc4g', brand, title, targetUrl),
              brand,
              title,
              description: [d.item_given_away, d.location].filter(Boolean).join(' – '),
              type: isGratis ? 'gratis' : 'rabatt',
              category: 'essen',
              source: 'Firecrawl Gastro #4',
              url: targetUrl,
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
              discoveryTarget: target.id,
              discoveryTargetLabel: target.label,
              discoveryMethod: 'firecrawl-agent',
            });
          }
        } else {
          stat.status = 'no-data';
          console.log('      → Keine strukturierte Deal-Liste erhalten');
        }
      } else {
        stat.status = 'no-data';
        console.log('      → Keine Agent-Daten erhalten');
      }
    } catch (e) {
      console.log(`      → Error: ${e.message}`);
      stat.status = 'failed';
      stat.error = e.message;
      totalCreditsUsed += Number(e?.creditsUsed || 0);
      runErrors.push(`${target.label}: ${e.message}`);
      if (isFirecrawlRateOrCreditError(e.message)) {
        console.log('      → Stoppe Run frühzeitig wegen API-Limit/Credits');
        stopAfterTarget = true;
        creditLimitReached = true;
      }
    }

    stat.normalizedCandidates = allDeals.length - normalizedBefore;
    stat.rejectedCandidates = rejected.length - rejectedBefore;
    sourceStats.push(stat);

    if (stopAfterTarget) break;

    await new Promise(r => setTimeout(r, 2000));
  }

  if (!creditLimitReached) {
    console.log();
    console.log(`🌐 ${BROAD_DISCOVERY_FOCUSES.length} ergänzende breite Agent-Suchen...`);

    for (let i = 0; i < BROAD_DISCOVERY_FOCUSES.length; i++) {
      const focus = BROAD_DISCOVERY_FOCUSES[i];
      const normalizedBefore = allDeals.length;
      const rejectedBefore = rejected.length;
      const stat = {
        id: `broad-agent:${i + 1}`,
        kind: 'broad-agent',
        label: `Breite Ergänzung ${i + 1}`,
        status: 'started',
        rawCandidates: 0,
        normalizedCandidates: 0,
        rejectedCandidates: 0,
        creditsUsed: 0,
      };
      let stopAfterPass = false;

      console.log(`   [${i + 1}/${BROAD_DISCOVERY_FOCUSES.length}] ${stat.label}...`);

      try {
        const result = await runAgent({
          prompt: `${GASTRO2_BASE_PROMPT}\n\nSchwerpunkt dieses Durchlaufs: ${focus}\nDiese Suche ist absichtlich offen und nicht auf eine einzelne Start-URL beschränkt.`,
          schema: gastroSchema,
          model: 'spark-1-pro',
        });
        stat.creditsUsed = Number(result?.creditsUsed || result?.credits_used || 0);
        totalCreditsUsed += stat.creditsUsed;

        let data = result?.data;
        if (typeof data === 'string') {
          try {
            data = JSON.parse(data);
          } catch (error) {
            throw new Error(`Ungültige Agent-Antwort: ${error.message}`);
          }
        }

        if (data?.deals && Array.isArray(data.deals)) {
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
                  brand: d.brand_or_store || stat.label,
                },
              });
              continue;
            }

            const targetUrl = isInstagramUrl(reportedUrl)
              ? normalizeInstagramPostUrl(reportedUrl)
              : reportedUrl;
            if (!targetUrl) {
              rejected.push({
                reason: 'instagram-profile-not-post',
                deal: {
                  title: d.item_given_away || '',
                  brand: d.brand_or_store || stat.label,
                  url: reportedUrl,
                },
              });
              continue;
            }

            const isGratis = /gratis|kostenlos|free|0€|umsonst/i.test(d.item_given_away || '');
            const brand = d.brand_or_store || stat.label;
            const title = d.item_given_away?.substring(0, 60) || 'Gastro Deal';
            const ownerUsername = (d.owner_username || '').replace(/^@/, '').trim().toLowerCase();

            allDeals.push({
              id: dealId('fc4g', brand, title, targetUrl),
              brand,
              title,
              description: [d.item_given_away, d.location].filter(Boolean).join(' – '),
              type: isGratis ? 'gratis' : 'rabatt',
              category: 'essen',
              source: 'Firecrawl Gastro #4',
              url: targetUrl,
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
        } else {
          stat.status = 'no-data';
          console.log('      → Keine strukturierte Deal-Liste erhalten');
        }
      } catch (error) {
        console.log(`      → Error: ${error.message}`);
        stat.status = 'failed';
        stat.error = error.message;
        stat.creditsUsed = Number(error?.creditsUsed || 0);
        totalCreditsUsed += stat.creditsUsed;
        runErrors.push(`${stat.label}: ${error.message}`);
        if (isFirecrawlRateOrCreditError(error.message)) {
          console.log('      → Stoppe Run frühzeitig wegen API-Limit/Credits');
          stopAfterPass = true;
        }
      }

      stat.normalizedCandidates = allDeals.length - normalizedBefore;
      stat.rejectedCandidates = rejected.length - rejectedBefore;
      sourceStats.push(stat);
      if (stopAfterPass) break;
    }
  }

  console.log();
  console.log('📊 ERGEBNIS:');
  console.log(`   📦 Deals: ${allDeals.length}`);
  const history = mergeFirecrawlDealHistory(allDeals, previousOutput.deals, {
    now: RUN_STARTED_AT,
  });
  console.log(`🛡️ Fresh history: ${history.retainedPreviousDeals}/${history.previousDeals}; exact duplicates merged: ${history.duplicateCount}`);
  const finalDeals = await verifyFirecrawlDeals(history.deals, {
    sourceKey: 'firecrawl-key4-gastro',
    now: RUN_STARTED_AT,
  });
  const verifiedIDs = new Set(finalDeals.map((deal) => deal.id));
  rejected.push(...allDeals
    .filter((deal) => !verifiedIDs.has(deal.id))
    .map((deal) => ({ reason: 'post-verification-rejected', deal })));

  const outputDeals = finalDeals;
  const output = {
    lastUpdated: new Date().toISOString(),
    source: 'firecrawl4',
    totalDeals: outputDeals.length,
    freshDiscoveryDeals: allDeals.length,
    retainedPreviousDeals: history.retainedPreviousDeals,
    pipelineReport: `deal-pipeline-last-run-${SOURCE_KEY}.json`,
    deals: outputDeals,
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
    acceptedDeals: outputDeals.length,
    rejected,
    diagnostics: {
      configuredSources: SCRAPE_TARGETS.length + BROAD_DISCOVERY_FOCUSES.length,
      attemptedSources: sourceStats.length,
      completedSources,
      agentTimeoutSeconds: AGENT_TIMEOUT_SECONDS,
      maxAgentFallbacks: MAX_AGENT_FALLBACKS,
      agentFallbacks,
      broadAgentPasses: BROAD_DISCOVERY_FOCUSES.length,
      maxCreditsPerTarget: MAX_CREDITS_PER_TARGET,
      totalCreditsUsed,
      retainedPreviousDeals: history.retainedPreviousDeals,
      prunedPreviousDeals: history.prunedPreviousDeals,
      duplicateCandidatesMerged: history.duplicateCount,
      sourceStats,
      verifier: summarizeVerifiedDeals(outputDeals),
    },
    errors: runErrors,
  }));
  console.log(`💾 ${outputDeals.length} Deals → ${OUTPUT_PATH}`);
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

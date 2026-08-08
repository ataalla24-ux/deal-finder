import '../sentry/instrument.mjs';
// ============================================
// 🍕🔥 FIRECRAWL GASTRO AGENT #4
// Fokus: Gastronomie - Mahlzeiten unter €3, 50%+ Rabatt, Döner €1,99
// ============================================

import Firecrawl from '@mendable/firecrawl-js';
import { z } from 'zod';
import fs from 'fs';
import {
  normalizeInstagramPostUrl,
  verifyFirecrawlDeals,
} from './firecrawl-post-verifier.js';
import {
  buildPipelineRunReport,
  summarizeVerifiedDeals,
  writeFailedPipelineRunReport,
  writePipelineRunReport,
} from './pipeline-run-report-utils.js';
import {
  buildTargetPrompt,
  selectScrapeTargets,
} from './firecrawl-instagram-direct4-config.js';

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY4;
const SOURCE_KEY = 'firecrawl4';
const SOURCE_LABEL = 'Firecrawl Key 4 - Gastro Discovery';
const OUTPUT_PATH = 'docs/deals-pending-firecrawl4.json';
const RUN_STARTED_AT = new Date();
const DEFAULT_MAX_CREDITS_PER_TARGET = 350;

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const MAX_CREDITS_PER_TARGET = positiveInteger(
  process.env.FIRECRAWL4_MAX_CREDITS_PER_TARGET,
  DEFAULT_MAX_CREDITS_PER_TARGET,
);
const SCRAPE_TARGETS = selectScrapeTargets(RUN_STARTED_AT);

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
  return firecrawl.agent(payload);
}

function isRateOrCreditError(message) {
  const m = (message || '').toLowerCase();
  return m.includes('insufficient credits') || m.includes('rate limit exceeded');
}

function isInstagramUrl(url) {
  return (url || '').includes('instagram.com');
}

function readPreviousOutput() {
  try {
    const payload = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
    return {
      payload,
      deals: Array.isArray(payload?.deals) ? payload.deals : [],
    };
  } catch {
    return { payload: null, deals: [] };
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

function parseGermanDate(str) {
  if (!str || typeof str !== 'string') return null;
  const s = str.trim();
  let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0));
  m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (m) {
    const year = m[3].length === 2 ? Number(`20${m[3]}`) : Number(m[3]);
    return new Date(Date.UTC(year, Number(m[2]) - 1, Number(m[1]), 12, 0, 0));
  }
  return null;
}

function isNotTooOld(dateObj) {
  if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return true;
  const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
  return dateObj.getTime() >= twoWeeksAgo;
}

async function main() {
  console.log('🍕🔥 FIRECRAWL GASTRO AGENT #4');
  console.log('='.repeat(40));
  console.log(`📅 ${new Date().toLocaleString('de-AT')}`);
  console.log();

  const previousOutput = readPreviousOutput();
  const allDeals = [];
  const rejected = [];
  const runErrors = [];
  const sourceStats = [];
  let rawCandidateCount = 0;
  let completedSources = 0;
  let totalCreditsUsed = 0;

  console.log(`🔍 Scrape ${SCRAPE_TARGETS.length} echte Ziele (Gastro Focus)...`);
  console.log(`💳 Maximal ${MAX_CREDITS_PER_TARGET} Credits pro Ziel`);

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
      creditsUsed: 0,
    };
    let stopAfterTarget = false;

    console.log(`   [${i + 1}/${SCRAPE_TARGETS.length}] ${target.label} (${target.kind})...`);

    try {
      const result = await runAgent({
        urls: [target.url],
        prompt: buildTargetPrompt(target),
        schema: gastroSchema,
        model: 'spark-1-pro',
        maxCredits: MAX_CREDITS_PER_TARGET,
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

            const isGratis = /gratis|kostenlos|free|0€|umsonst/i.test(d.item_given_away || '');
            const validityDate = parseGermanDate(d.validity_date || '');
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
              ...(validityDate ? {
                validOn: validityDate.toISOString(),
                expires: validityDate.toISOString(),
                expirySource: 'firecrawl-agent-reported-validity',
                dateConfidence: 'low',
              } : {}),
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
      runErrors.push(`${target.label}: ${e.message}`);
      if (isRateOrCreditError(e.message)) {
        console.log('      → Stoppe Run frühzeitig wegen API-Limit/Credits');
        stopAfterTarget = true;
      }
    }

    stat.normalizedCandidates = allDeals.length - normalizedBefore;
    stat.rejectedCandidates = rejected.length - rejectedBefore;
    sourceStats.push(stat);

    if (stopAfterTarget) break;

    await new Promise(r => setTimeout(r, 2000));
  }

  console.log();
  console.log('📊 ERGEBNIS:');
  console.log(`   📦 Deals: ${allDeals.length}`);
  console.log('🔄 URL-Dedupe deaktiviert');
  const finalDeals = await verifyFirecrawlDeals(allDeals, {
    sourceKey: 'firecrawl-key4-gastro',
  });
  const verifiedIDs = new Set(finalDeals.map((deal) => deal.id));
  rejected.push(...allDeals
    .filter((deal) => !verifiedIDs.has(deal.id))
    .map((deal) => ({ reason: 'post-verification-rejected', deal })));

  const preservePreviousOutput = (
    finalDeals.length === 0
    && completedSources === 0
    && previousOutput.deals.length > 0
    && runErrors.some(isRateOrCreditError)
  );
  const outputDeals = preservePreviousOutput ? previousOutput.deals : finalDeals;

  if (preservePreviousOutput) {
    console.log(`🛡️ Credit-Fehler vor erstem Ergebnis: ${previousOutput.deals.length} vorhandene Deals bleiben erhalten`);
  } else {
    const output = {
      lastUpdated: new Date().toISOString(),
      source: 'firecrawl4',
      totalDeals: finalDeals.length,
      pipelineReport: `deal-pipeline-last-run-${SOURCE_KEY}.json`,
      deals: finalDeals,
    };
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  }

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
      configuredSources: SCRAPE_TARGETS.length,
      attemptedSources: sourceStats.length,
      completedSources,
      maxCreditsPerTarget: MAX_CREDITS_PER_TARGET,
      totalCreditsUsed,
      preservedPreviousOutput,
      sourceStats,
      verifier: summarizeVerifiedDeals(finalDeals),
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

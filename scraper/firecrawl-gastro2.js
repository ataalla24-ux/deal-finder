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
  readFirecrawlDealOutput,
  verifyFirecrawlDeals,
} from './firecrawl-post-verifier.js';
import {
  isFirecrawlRateOrCreditError,
  positiveInteger,
  runBoundedFirecrawlAgent,
} from './firecrawl-agent-utils.js';
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
const AGENT_TIMEOUT_SECONDS = positiveInteger(process.env.FIRECRAWL1_AGENT_TIMEOUT_SECONDS, 120);
const MAX_CREDITS_PER_TARGET = positiveInteger(process.env.FIRECRAWL1_MAX_CREDITS_PER_TARGET, 250);

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
    maxCredits: MAX_CREDITS_PER_TARGET,
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
  'https://www.1000things.at/',
  'https://www.meinbezirk.at/',
];

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

const PROMPT = `Extrahiere aktuelle und zukünftige Deals in Wien mit höchster Priorität auf Gastronomie-Angebote (Essen & Trinken).

Instagram-Freshness ist zwingend: Nimm nur Originalposts auf, die in den letzten 7 Tagen veröffentlicht wurden. Ein Angebot darf in der Zukunft beginnen, aber der Instagram-Post selbst darf trotzdem nicht älter als 7 Tage sein. Bekanntermaßen ältere Posts, Reposts ohne Originalquelle und Posts aus vergangenen Jahren weglassen.

Suche gezielt nach:
- Starken Rabatten wie Mahlzeiten unter €3
- Mindestens 50% Preisnachlass (z.B. 1,99€ Döner, 1+1 Aktionen)
- Kostenlose Freebies
- Neueröffnungen mit Gratis-Aktionen
- Starke Rabatte allgemein

Suche primär auf Instagram nach den ersten 50-100 Deals und ergänze diese durch Funde aus dem restlichen Web (z.B. 1000things, meinbezirk.at).

Erfasse für jeden Deal:
  – Den genauen Namen des Restaurants/Geschäfts/Unternehmens (brand_or_store – NICHT die Website-Domain!)
- Kategorie
- Was genau verschenkt/rabattiert wird
- Den Standort
- Datum und Uhrzeit der Gültigkeit
- Die direkte URL zum ursprünglichen Post oder Web-Beitrag
- Bei Instagram: den echten Account-Handle und das Veröffentlichungsdatum des Original-Posts.

Wichtig: Das Veröffentlichungsdatum des Posts und die Gültigkeit des Angebots sind zwei verschiedene Felder. Gib Jahreszahlen vollständig an. Nur konkrete direkt nutzbare Vorteile in Wien aufnehmen; Gewinnspiele, reine Empfehlungen, Gratis-Versand und bloße Hinweise ohne Preisvorteil weglassen. Bei Instagram muss die URL direkt auf /p/... oder /reel/... zeigen.`;

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
  let rawCandidateCount = 0;
  let completedSources = 0;
  let totalCreditsUsed = 0;
  
  console.log(`🔍 Scrape ${SCRAPE_URLS.length} Seiten (Gastro Focus)...`);
  console.log(`💳 Maximal ${MAX_CREDITS_PER_TARGET} Credits und ${AGENT_TIMEOUT_SECONDS}s pro Ziel`);
  
  for (let i = 0; i < SCRAPE_URLS.length; i++) {
    const url = SCRAPE_URLS[i];
    const source = new URL(url).hostname.replace('www.', '');
    
    console.log(`   [${i + 1}/${SCRAPE_URLS.length}] ${source}...`);
    
    try {
      const result = await runAgent({
        urls: [url],
        prompt: isInstagramUrl(url)
          ? `${PROMPT}\n\nDieser Durchlauf startet auf Instagram. Liefere ausschließlich direkte Instagram-Originalposts von diesem Ziel; weiche nicht auf allgemeine Deal-Webseiten aus.`
          : PROMPT,
        schema: gastroSchema,
        model: isInstagramUrl(url) ? 'spark-1-mini' : 'spark-1-pro',
      });
      totalCreditsUsed += Number(result?.creditsUsed || result?.credits_used || 0);
      
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
          console.log(`      → ${data.deals.length} Deals gefunden`);
          
          for (const d of data.deals) {
            const postUrl = d.post_url || '';
            
            if (!postUrl) {
              rejected.push({
                reason: 'missing-target-url',
                deal: {
                  title: d.item_given_away || '',
                  brand: d.brand_or_store || source,
                },
              });
              continue;
            }
            if (isInstagramUrl(url) && !isInstagramUrl(postUrl)) {
              rejected.push({
                reason: 'instagram-target-returned-web-result',
                deal: {
                  title: d.item_given_away || '',
                  brand: d.brand_or_store || source,
                  url: postUrl,
                },
              });
              continue;
            }
            
            const isGratis = /gratis|kostenlos|free|0€|umsonst/i.test(d.item_given_away || '');
            const brand = d.brand_or_store || source;
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
            });
          }
        }
      }
    } catch (e) {
      console.log(`      → Error: ${e.message}`);
      totalCreditsUsed += Number(e?.creditsUsed || 0);
      runErrors.push(`${source}: ${e.message}`);
      if (isFirecrawlRateOrCreditError(e.message)) {
        console.log('      → Stoppe Run frühzeitig wegen API-Limit/Credits');
        break;
      }
    }
    
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log();
  console.log('📊 ERGEBNIS:');
  console.log(`   📦 Deals: ${allDeals.length}`);
  const history = mergeFirecrawlDealHistory(allDeals, previousOutput.deals, {
    now: RUN_STARTED_AT,
  });
  console.log(`🛡️ Fresh history: ${history.retainedPreviousDeals}/${history.previousDeals}; exact duplicates merged: ${history.duplicateCount}`);
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
      configuredSources: SCRAPE_URLS.length,
      completedSources,
      agentTimeoutSeconds: AGENT_TIMEOUT_SECONDS,
      maxCreditsPerTarget: MAX_CREDITS_PER_TARGET,
      totalCreditsUsed,
      retainedPreviousDeals: history.retainedPreviousDeals,
      prunedPreviousDeals: history.prunedPreviousDeals,
      duplicateCandidatesMerged: history.duplicateCount,
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

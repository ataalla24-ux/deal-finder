import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  duplicateDealKey,
  getPublicationEvidence,
  mergeDealEvidence,
} from './deal-evidence-utils.js';
import {
  enrichDealWithInstagramGraphEvidence,
  loadInstagramGraphEvidence,
} from './instagram-graph-evidence.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');

// The legacy Firecrawl/daily-sync pipeline owns deals-pending-instagram.json.
// Keep the evidence-gated sources isolated so neither pipeline can overwrite
// the other's Slack state or generated output.
const MERGED_PATH = path.join(DOCS_DIR, 'deals-pending-instagram-verified.json');
const GRAPH_EVIDENCE_PATH = path.join(DOCS_DIR, 'instagram-graph-post-evidence.json');
const SOURCE_FILES = [
  { key: 'instagram-web', file: 'deals-pending-instagram-web.json' },
  { key: 'instagram-discovery', file: 'deals-pending-instagram-discovery.json' },
  { key: 'instagram-ai', file: 'deals-pending-instagram-ai.json' },
  { key: 'instagram-apify', file: 'deals-pending-instagram-apify.json' },
  { key: 'meta-instagram', file: 'deals-pending-meta-instagram.json' },
];

function readPayload(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function readDeals(filePath) {
  const parsed = readPayload(filePath);
  if (!parsed) return [];
  if (Array.isArray(parsed?.deals)) return parsed.deals;
  if (Array.isArray(parsed)) return parsed;
  return [];
}

function readExistingMergedDeals() {
  const parsed = readPayload(MERGED_PATH);
  if (!parsed) return [];
  if (Array.isArray(parsed?.deals)) return parsed.deals;
  if (Array.isArray(parsed)) return parsed;
  return [];
}

function writePayload(payload) {
  fs.writeFileSync(MERGED_PATH, JSON.stringify(payload, null, 2));
}

function cleanText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function getSignature(deal) {
  const canonicalKey = duplicateDealKey(deal);
  if (canonicalKey) return canonicalKey;
  return [cleanText(deal?.brand), cleanText(deal?.title)].filter(Boolean).join('|');
}

function getPubDateMs(deal) {
  const ts = Date.parse(getPublicationEvidence(deal).sourcePublishedAt);
  return Number.isFinite(ts) ? ts : 0;
}

function getQualityScore(deal) {
  return Number(deal?.qualityScore) || 0;
}

export function buildMergedInstagramPayload(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const graphEvidence = options.graphEvidence instanceof Map
    ? options.graphEvidence
    : loadInstagramGraphEvidence(options.graphEvidencePath || GRAPH_EVIDENCE_PATH).byKey;
  const sourceDeals = [];
  const sourceCounts = {};
  const graphStats = { matched: 0, blocked: 0 };
  let existingSourceFiles = 0;

  for (const source of SOURCE_FILES) {
    const filePath = path.join(DOCS_DIR, source.file);
    if (!fs.existsSync(filePath)) {
      sourceCounts[source.key] = 0;
      continue;
    }
    existingSourceFiles += 1;
    const rawDeals = readDeals(filePath);
    const deals = [];
    for (const rawDeal of rawDeals) {
      const merged = mergeDealEvidence({}, {
        ...rawDeal,
        originSource: rawDeal.originSource || rawDeal.source || source.key,
        sourceKeys: [source.key],
      }, { now });
      const graphResult = enrichDealWithInstagramGraphEvidence(merged, graphEvidence, { now });
      if (graphResult.matched) graphStats.matched += 1;
      if (graphResult.blocked) {
        graphStats.blocked += 1;
        continue;
      }
      deals.push(graphResult.deal);
    }
    sourceCounts[source.key] = deals.length;
    sourceDeals.push(...deals);
  }

  if (existingSourceFiles === 0) {
    const existingMergedDeals = readExistingMergedDeals();
    return {
      lastUpdated: now.toISOString(),
      source: 'instagram-merged',
      totalDeals: existingMergedDeals.length,
      meta: {
        sources: { ...sourceCounts, merged: existingMergedDeals.length },
        graphEvidence: graphStats,
        note: 'No Instagram source files found; kept existing merged payload.',
      },
      deals: existingMergedDeals,
    };
  }

  const merged = new Map();
  for (const deal of sourceDeals) {
    const key = getSignature(deal);
    if (!key) continue;
    if (!merged.has(key)) {
      merged.set(key, deal);
      continue;
    }
    merged.set(key, mergeDealEvidence(merged.get(key), deal, { now }));
  }

  const deals = [...merged.values()]
    .map((deal) => ({
      ...deal,
      source: 'Instagram',
    }))
    .sort((a, b) => {
      const scoreDiff = getQualityScore(b) - getQualityScore(a);
      if (scoreDiff !== 0) return scoreDiff;
      return getPubDateMs(b) - getPubDateMs(a);
    });

  return {
    lastUpdated: now.toISOString(),
    source: 'instagram-merged',
    totalDeals: deals.length,
    meta: {
      sources: { ...sourceCounts, merged: deals.length },
      graphEvidence: graphStats,
    },
    deals,
  };
}

export function runMerge() {
  const payload = buildMergedInstagramPayload();

  writePayload(payload);
  console.log(`✅ merged Instagram deals → ${MERGED_PATH}`);
  console.log(`   ${Object.entries(payload.meta.sources).map(([source, count]) => `${source}: ${count}`).join(', ')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  runMerge();
}

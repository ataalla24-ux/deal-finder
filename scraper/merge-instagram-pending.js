import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');

const WEB_PATH = path.join(DOCS_DIR, 'deals-pending-instagram-web.json');
const DISCOVERY_PATH = path.join(DOCS_DIR, 'deals-pending-instagram-discovery.json');
const FIRECRAWL4_PATH = path.join(DOCS_DIR, 'deals-pending-firecrawl4.json');
const FIRECRAWL5_PATH = path.join(DOCS_DIR, 'deals-pending-firecrawl5.json');
const MERGED_PATH = path.join(DOCS_DIR, 'deals-pending-instagram.json');

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

function mergeDeals() {
  const hasWebFile = fs.existsSync(WEB_PATH);
  const hasDiscoveryFile = fs.existsSync(DISCOVERY_PATH);
  const hasFirecrawl4File = fs.existsSync(FIRECRAWL4_PATH);
  const hasFirecrawl5File = fs.existsSync(FIRECRAWL5_PATH);
  const existingMergedDeals = readExistingMergedDeals().filter((deal) => isFreshByPubDate(deal));
  const webDeals = prepareSourceDeals(WEB_PATH, 'instagram-web');
  const discoveryDeals = prepareSourceDeals(DISCOVERY_PATH, 'instagram-discovery-engine');
  const firecrawl4Deals = prepareSourceDeals(FIRECRAWL4_PATH, 'firecrawl-key4-instagram-direct');
  const firecrawl5Deals = prepareSourceDeals(FIRECRAWL5_PATH, 'firecrawl-key5-instagram-gastro');

  if (!hasWebFile && !hasDiscoveryFile && !hasFirecrawl4File && !hasFirecrawl5File) {
    const fallbackPayload = {
      lastUpdated: new Date().toISOString(),
      source: 'instagram-merged',
      totalDeals: existingMergedDeals.length,
      meta: {
        sources: {
          web: 0,
          discovery: 0,
          firecrawl4: 0,
          firecrawl5: 0,
          merged: existingMergedDeals.length,
        },
        note: 'No fresh Instagram source files found; kept existing merged payload.',
      },
      deals: existingMergedDeals,
    };
    writePayload(fallbackPayload);
    console.log(`ℹ️ no fresh Instagram source files found; keeping existing merged file (${existingMergedDeals.length} deals)`);
    return [];
  }

  return { webDeals, discoveryDeals, firecrawl4Deals, firecrawl5Deals };
}

function normalizeUrl(url) {
  const value = String(url || '').trim();
  if (!/^https?:\/\//i.test(value)) return '';
  return value
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
}

function cleanText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function getSignature(deal) {
  return [
    normalizeUrl(deal?.url),
    cleanText(deal?.brand),
    cleanText(deal?.title),
  ].filter(Boolean).join('|');
}

function getPubDateMs(deal) {
  const ts = Date.parse(String(deal?.pubDate || ''));
  return Number.isFinite(ts) ? ts : 0;
}

function getQualityScore(deal) {
  return Number(deal?.qualityScore) || 0;
}

function getMaxAgeDays() {
  const configured = Number(process.env.IG_MAX_AGE_DAYS);
  return Number.isFinite(configured) && configured > 0 ? configured : 1;
}

function isFreshByPubDate(deal) {
  const ts = getPubDateMs(deal);
  if (!ts) return false;
  const ageMs = Date.now() - ts;
  return ageMs >= 0 && ageMs <= getMaxAgeDays() * 24 * 60 * 60 * 1000;
}

function prepareSourceDeals(filePath, fallbackSource) {
  return readDeals(filePath)
    .filter((deal) => isFreshByPubDate(deal))
    .map((deal) => ({
      ...deal,
      originSource: deal.originSource || deal.source || fallbackSource,
    }));
}

function chooseBetterDeal(a, b) {
  const aScore = getQualityScore(a);
  const bScore = getQualityScore(b);
  if (aScore !== bScore) return bScore > aScore ? b : a;

  const aDate = getPubDateMs(a);
  const bDate = getPubDateMs(b);
  if (aDate !== bDate) return bDate > aDate ? b : a;

  const aTrusted = String(a?.pubDateSource || '').length > 0;
  const bTrusted = String(b?.pubDateSource || '').length > 0;
  if (aTrusted !== bTrusted) return bTrusted ? b : a;

  return a;
}

function runMerge() {
  const inputs = mergeDeals();
  if (!inputs || Array.isArray(inputs)) return;
  const { webDeals, discoveryDeals, firecrawl4Deals, firecrawl5Deals } = inputs;

  const merged = new Map();
  for (const deal of [...firecrawl5Deals, ...firecrawl4Deals, ...discoveryDeals, ...webDeals]) {
    const key = getSignature(deal);
    if (!key) continue;
    if (!merged.has(key)) {
      merged.set(key, deal);
      continue;
    }
    merged.set(key, chooseBetterDeal(merged.get(key), deal));
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

  const payload = {
    lastUpdated: new Date().toISOString(),
    source: 'instagram-merged',
    totalDeals: deals.length,
    meta: {
      sources: {
        web: webDeals.length,
        discovery: discoveryDeals.length,
        firecrawl4: firecrawl4Deals.length,
        firecrawl5: firecrawl5Deals.length,
        merged: deals.length,
      },
    },
    deals,
  };

  writePayload(payload);
  console.log(`✅ merged Instagram deals → ${MERGED_PATH}`);
  console.log(`   web: ${webDeals.length}, discovery: ${discoveryDeals.length}, key4: ${firecrawl4Deals.length}, key5: ${firecrawl5Deals.length}, merged: ${deals.length}`);
}

runMerge();

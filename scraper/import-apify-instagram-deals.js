import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeCategoryForScraper } from './category-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const OUTPUT_PATH = path.join(DOCS_DIR, 'deals-pending-instagram-apify.json');
const REPORT_PATH = path.join(DOCS_DIR, 'apify-instagram-report.json');
const DEFAULT_INPUT_PATH = path.join(ROOT, 'apify', 'instagram-vienna-food-offers', 'default-input.json');

const APIFY_TOKEN = String(process.env.APIFY_TOKEN || '').trim();
const APIFY_ACTOR_ID = String(
  process.env.APIFY_INSTAGRAM_VIENNA_ACTOR_ID ||
  process.env.APIFY_ACTOR_ID ||
  ''
).trim();
const APIFY_BASE_URL = String(process.env.APIFY_API_BASE_URL || 'https://api.apify.com/v2').replace(/\/+$/, '');
const POLL_INTERVAL_MS = Math.max(5000, Number(process.env.APIFY_POLL_INTERVAL_MS || 15000));
const RUN_TIMEOUT_MS = Math.max(120000, Number(process.env.APIFY_RUN_TIMEOUT_MS || 25 * 60 * 1000));
const APIFY_INSTAGRAM_COOKIE_STRING = String(process.env.APIFY_INSTAGRAM_COOKIE_STRING || '').trim();
const APIFY_INSTAGRAM_SESSIONID = String(process.env.APIFY_INSTAGRAM_SESSIONID || '').trim();

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJsonIfExists(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function normalizeText(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/#[\p{L}\p{N}_]+/gu, ' ')
    .replace(/@[\p{L}\p{N}._]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (!/^https?:$/i.test(url.protocol)) return '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

function toIso(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stableId(seed) {
  let hash = 5381;
  for (let i = 0; i < seed.length; i += 1) {
    hash = ((hash << 5) + hash) ^ seed.charCodeAt(i);
    hash >>>= 0;
  }
  return hash.toString(36);
}

function formatDateDisplay(value) {
  const iso = toIso(value);
  if (!iso) return '';
  return iso.slice(0, 10);
}

function inferType(item) {
  if (String(item.offerKind || '').toLowerCase() === 'bogo') return 'bogo';
  return 'gratis';
}

function inferCategory(item) {
  return normalizeCategoryForScraper('', [
    item.description,
    item.venueName,
    item.locationText,
  ]);
}

function inferLogo(category, type) {
  if (type === 'bogo') return '1+1';
  if (category === 'kaffee') return '☕';
  if (category === 'essen') return '🍽️';
  return '🎁';
}

function buildTitle(item, brand) {
  const base = normalizeText(item.description);
  const withoutBrand = base.replace(new RegExp(`^${brand}\\s*:?\\s*`, 'i'), '').trim();
  const titleText = normalizeText(withoutBrand || base || `${brand} Instagram-Angebot`);
  return titleText.slice(0, 110);
}

function buildDescription(item, brand, type) {
  const location = normalizeText(item.locationText || 'Wien');
  const dateText = formatDateDisplay(item.validUntil);
  const lead = type === 'bogo'
    ? `1+1 Angebot bei ${brand}`
    : `Gratis-Angebot bei ${brand}`;
  const dateSuffix = dateText ? `. Gültig bis ${dateText}` : '';
  return `${lead} in ${location}${dateSuffix}`;
}

function computeQualityScore(item, type) {
  let score = type === 'gratis' ? 90 : 84;
  if (item.explicitValidityDetected) score += 4;
  if (item.locationText) score += 2;
  if (item.postPublishedAt) score += 3;
  return Math.min(score, 100);
}

function normalizeApifyItem(raw) {
  const item = raw && typeof raw === 'object' ? raw : {};
  const postUrl = normalizeUrl(item.postUrl);
  if (!postUrl) return null;

  const brand = normalizeText(item.venueName || item.instagramHandle || 'Instagram Deal');
  const type = inferType(item);
  const category = inferCategory(item);
  const pubDate = toIso(item.postPublishedAt);
  const expires = toIso(item.validUntil) || 'Unbekannt';
  const title = buildTitle(item, brand);
  const qualityScore = computeQualityScore(item, type);

  return {
    id: `igap-${stableId(`${postUrl}|${pubDate}|${brand}`)}`,
    brand,
    title,
    logo: inferLogo(category, type),
    description: buildDescription(item, brand, type),
    type,
    category,
    source: 'Instagram',
    originSource: 'Apify Instagram Vienna Food Offers',
    url: postUrl,
    expires,
    distance: normalizeText(item.locationText || 'Wien'),
    hot: qualityScore >= 88,
    isNew: true,
    priority: Math.max(6, Math.round(qualityScore / 10)),
    votes: 1,
    qualityScore,
    pubDate,
    pubDateSource: 'apifyPostMetadata',
    discoveredBy: normalizeText(item.sourceType || 'apify'),
    sourceHits: 1,
    reviewTier: qualityScore >= 88 ? 'high' : 'medium',
    apifyOfferKind: normalizeText(item.offerKind),
    validFrom: toIso(item.validFrom) || '',
    validUntil: toIso(item.validUntil) || '',
  };
}

function dedupeDeals(deals) {
  const byUrl = new Map();
  for (const deal of deals) {
    const existing = byUrl.get(deal.url);
    if (!existing) {
      byUrl.set(deal.url, deal);
      continue;
    }

    const existingScore = Number(existing.qualityScore || 0);
    const score = Number(deal.qualityScore || 0);
    if (score > existingScore) {
      byUrl.set(deal.url, deal);
      continue;
    }

    if (score === existingScore && String(deal.pubDate || '') > String(existing.pubDate || '')) {
      byUrl.set(deal.url, deal);
    }
  }

  return [...byUrl.values()].sort((a, b) => {
    if ((b.qualityScore || 0) !== (a.qualityScore || 0)) return (b.qualityScore || 0) - (a.qualityScore || 0);
    return Date.parse(b.pubDate || '') - Date.parse(a.pubDate || '');
  });
}

async function apifyFetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${APIFY_TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Apify API ${response.status} for ${url}: ${body.slice(0, 500)}`);
  }

  return response.json();
}

async function triggerActorRun(input) {
  const url = `${APIFY_BASE_URL}/acts/${encodeURIComponent(APIFY_ACTOR_ID)}/runs`;
  const response = await apifyFetchJson(url, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return response.data;
}

async function getRun(runId) {
  const url = `${APIFY_BASE_URL}/actor-runs/${encodeURIComponent(runId)}`;
  const response = await apifyFetchJson(url);
  return response.data;
}

async function getDatasetItems(datasetId) {
  const url = `${APIFY_BASE_URL}/datasets/${encodeURIComponent(datasetId)}/items?clean=true&format=json`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${APIFY_TOKEN}`,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Dataset fetch failed ${response.status}: ${body.slice(0, 500)}`);
  }

  return response.json();
}

async function getSummaryRecord(storeId) {
  if (!storeId) return null;
  const url = `${APIFY_BASE_URL}/key-value-stores/${encodeURIComponent(storeId)}/records/SUMMARY`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${APIFY_TOKEN}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) return null;
  return response.json();
}

async function waitForRunCompletion(runId) {
  const startedAt = Date.now();
  while (true) {
    const run = await getRun(runId);
    const status = String(run.status || '');
    if (['SUCCEEDED', 'FAILED', 'TIMED-OUT', 'ABORTED'].includes(status)) return run;
    if (Date.now() - startedAt > RUN_TIMEOUT_MS) {
      throw new Error(`Apify run ${runId} did not finish within ${RUN_TIMEOUT_MS / 1000}s`);
    }
    console.log(`⏳ Apify run ${runId} status: ${status}`);
    await sleep(POLL_INTERVAL_MS);
  }
}

async function main() {
  ensureDir(DOCS_DIR);

  if (!APIFY_TOKEN) {
    throw new Error('APIFY_TOKEN fehlt');
  }
  if (!APIFY_ACTOR_ID) {
    throw new Error('APIFY_INSTAGRAM_VIENNA_ACTOR_ID oder APIFY_ACTOR_ID fehlt');
  }

  const input = {
    ...readJsonIfExists(DEFAULT_INPUT_PATH, {}),
    ...(APIFY_INSTAGRAM_COOKIE_STRING ? { cookieString: APIFY_INSTAGRAM_COOKIE_STRING } : {}),
    ...(APIFY_INSTAGRAM_SESSIONID ? { sessionId: APIFY_INSTAGRAM_SESSIONID } : {}),
  };

  console.log('🕷️ APIFY INSTAGRAM IMPORT');
  console.log(`Actor: ${APIFY_ACTOR_ID}`);

  const run = await triggerActorRun(input);
  console.log(`▶️ Started Apify run ${run.id}`);

  const finishedRun = await waitForRunCompletion(run.id);
  console.log(`✅ Finished with status ${finishedRun.status}`);

  if (finishedRun.status !== 'SUCCEEDED') {
    throw new Error(`Apify run ended with status ${finishedRun.status}`);
  }

  const datasetItems = await getDatasetItems(finishedRun.defaultDatasetId);
  const summary = await getSummaryRecord(finishedRun.defaultKeyValueStoreId);

  const acceptedItems = Array.isArray(datasetItems)
    ? datasetItems.filter((item) => item)
    : [];
  const normalizedDeals = acceptedItems
    .map(normalizeApifyItem)
    .filter(Boolean);

  const payload = {
    lastUpdated: new Date().toISOString(),
    source: 'instagram-apify',
    totalDeals: normalizedDeals.length,
    meta: {
      actorId: APIFY_ACTOR_ID,
      runId: finishedRun.id,
      datasetId: finishedRun.defaultDatasetId,
      status: finishedRun.status,
    },
    deals: normalizedDeals,
  };

  const report = {
    updatedAt: new Date().toISOString(),
    actorId: APIFY_ACTOR_ID,
    runId: finishedRun.id,
    status: finishedRun.status,
    startedAt: finishedRun.startedAt || '',
    finishedAt: finishedRun.finishedAt || '',
    datasetId: finishedRun.defaultDatasetId,
    keyValueStoreId: finishedRun.defaultKeyValueStoreId,
    rawDatasetItems: Array.isArray(datasetItems) ? datasetItems.length : 0,
    acceptedDeals: normalizedDeals.length,
    summary,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  console.log(`💾 ${normalizedDeals.length} deals -> ${path.relative(ROOT, OUTPUT_PATH)}`);
  console.log(`📝 report -> ${path.relative(ROOT, REPORT_PATH)}`);
}

main().catch((error) => {
  console.error(`❌ ${error.message}`);
  process.exit(1);
});

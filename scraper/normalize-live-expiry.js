import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeDealExpiry, shouldVerifyExpiryAgainstUrl } from './expiry-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DEALS_JSON_PATH = path.join(ROOT, 'docs', 'deals.json');
const ENV_PATH = path.join(ROOT, '.env');

function loadEnvFile() {
  if (!fs.existsSync(ENV_PATH)) return;
  const lines = fs.readFileSync(ENV_PATH, 'utf-8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile();

const MAX_URL_EXPIRY_CHECKS = Number(process.env.MAX_URL_EXPIRY_CHECKS || 120);

function loadDeals() {
  return JSON.parse(fs.readFileSync(DEALS_JSON_PATH, 'utf-8'));
}

function wantsUrlLookup(deal, now) {
  return shouldVerifyExpiryAgainstUrl(deal, { now });
}

async function main() {
  const now = new Date();
  const payload = loadDeals();
  const deals = Array.isArray(payload.deals) ? payload.deals : [];
  const urlCache = new Map();
  let normalizedCount = 0;
  let urlChecksUsed = 0;
  let urlExpiryHits = 0;

  for (const deal of deals) {
    const hadExpires = String(deal.expires || '').trim();
    const shouldLookup = wantsUrlLookup(deal, now);
    const cached = deal.url ? urlCache.has(deal.url) : false;
    const allowUrlLookup = shouldLookup && (cached || urlChecksUsed < MAX_URL_EXPIRY_CHECKS);
    const beforeCacheSize = urlCache.size;

    await normalizeDealExpiry(deal, { now, urlCache, allowUrlLookup });

    if (allowUrlLookup && deal.url && !cached && urlCache.size > beforeCacheSize) {
      urlChecksUsed += 1;
    }
    if (deal.expiresDetectedFromUrl) {
      urlExpiryHits += 1;
    }
    if (String(deal.expires || '').trim() !== hadExpires || deal.expiresPrecision || deal.expiresSource) {
      normalizedCount += 1;
    }
  }

  payload.deals = deals;
  payload.totalDeals = deals.length;
  payload.lastUpdated = new Date().toISOString();
  fs.writeFileSync(DEALS_JSON_PATH, JSON.stringify(payload, null, 2));

  console.log(`✅ normalized deals: ${normalizedCount}/${deals.length}`);
  console.log(`🔎 URL expiry checks: ${urlChecksUsed}/${MAX_URL_EXPIRY_CHECKS}, Treffer: ${urlExpiryHits}`);
}

main().catch((error) => {
  console.error('❌ normalize-live-expiry failed:', error.message);
  process.exit(1);
});

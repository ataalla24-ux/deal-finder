import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeDealExpiry, shouldSkipUrlExpiryLookup } from './expiry-utils.js';
import { isGenericJunkDeal, normalizeDealRecord } from './deal-normalization-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const DEALS_PATH = path.join(ROOT, 'docs', 'deals.json');
const CHURCH_FILES = [
  path.join(ROOT, 'docs', 'deals-pending-church-gemeinde.json'),
  path.join(ROOT, 'docs', 'deals-pending-church-gottesdienste.json'),
  path.join(ROOT, 'docs', 'deals-pending-church-events.json'),
];

const REMOVE_IDS = new Set([
  'freikirche-0-20260308',
  'freikirche-1-20260308',
  'freikirche-2-20260308',
  'events-2-20260308',
  'events-7-20260308',
  'gottesdienste-24-20260308',
  'gottesdienste-26-20260308',
  'gemeinde-0-20260308',
  'gemeinde-1-20260308',
  'gottesdienste-0-20260308',
]);

function cleanText(value) {
  if (!value) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function getChurchCuratedIds(churchDeals) {
  return new Set(churchDeals.map((deal) => deal.id).filter(Boolean));
}

function shouldDropLegacyChurchDeal(deal) {
  return REMOVE_IDS.has(deal.id);
}

function fixPubDateFromSlackTs(deal, now) {
  if (!deal?.slackTs) return deal;
  const slackTs = Number(String(deal.slackTs).split('.')[0]);
  if (!Number.isFinite(slackTs) || slackTs <= 0) return deal;

  const slackDate = new Date(slackTs * 1000);
  const pubDate = Date.parse(deal.pubDate || '');
  if (
    Number.isNaN(pubDate) ||
    Math.abs(pubDate - slackDate.getTime()) > 1000 * 60 * 60 * 24 * 3 ||
    pubDate > now.getTime() + 1000 * 60 * 60 * 36
  ) {
    return { ...deal, pubDate: slackDate.toISOString() };
  }

  return deal;
}

function resetUnsafeUrlExpiry(deal) {
  const raw = cleanText(deal.expiresOriginal || deal.expires || '');
  if (
    deal.expiresSource === 'url' &&
    shouldSkipUrlExpiryLookup(deal, deal.url || '', raw)
  ) {
    const next = { ...deal };
    if (raw) {
      next.expires = raw;
      next.expiresOriginal = raw;
      next.expiresPrecision = 'unknown';
      next.expiresSource = 'raw';
    } else {
      next.expires = '';
      next.expiresPrecision = '';
      next.expiresSource = '';
    }
    delete next.expiresDetectedFromUrl;
    return next;
  }

  return deal;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function loadCuratedChurchDeals() {
  const bundles = await Promise.all(CHURCH_FILES.map((filePath) => readJson(filePath)));
  return bundles.flatMap((bundle) => Array.isArray(bundle?.deals) ? bundle.deals : []);
}

async function main() {
  const now = new Date();
  const urlCache = new Map();
  const dealsDoc = await readJson(DEALS_PATH);
  const churchDeals = await loadCuratedChurchDeals();
  const curatedChurchIds = getChurchCuratedIds(churchDeals);

  const remaining = [];
  const seenIds = new Set();

  for (const original of dealsDoc.deals || []) {
    if (!original || typeof original !== 'object') continue;
    if (shouldDropLegacyChurchDeal(original)) continue;
    if (curatedChurchIds.has(original.id)) continue;

    let deal = { ...original };
    deal = fixPubDateFromSlackTs(deal, now);
    deal = resetUnsafeUrlExpiry(deal);
    deal = normalizeDealRecord(deal);
    await normalizeDealExpiry(deal, { now, allowUrlLookup: true, urlCache });

    if (isGenericJunkDeal(deal)) continue;
    if (!deal.id || seenIds.has(deal.id)) continue;

    seenIds.add(deal.id);
    remaining.push(deal);
  }

  for (const churchDeal of churchDeals) {
    const normalizedChurchDeal = normalizeDealRecord({ ...churchDeal });
    await normalizeDealExpiry(normalizedChurchDeal, { now, allowUrlLookup: true, urlCache });
    if (!normalizedChurchDeal.id || seenIds.has(normalizedChurchDeal.id)) continue;
    seenIds.add(normalizedChurchDeal.id);
    remaining.push(normalizedChurchDeal);
  }

  remaining.sort((a, b) => {
    const aTime = Date.parse(a.pubDate || '') || 0;
    const bTime = Date.parse(b.pubDate || '') || 0;
    return bTime - aTime;
  });

  dealsDoc.deals = remaining;
  dealsDoc.totalDeals = remaining.length;
  dealsDoc.lastUpdated = now.toISOString();

  await writeFile(DEALS_PATH, JSON.stringify(dealsDoc, null, 2) + '\n', 'utf8');
  console.log(`Normalized live deals: ${remaining.length}`);
}

main().catch((error) => {
  console.error('normalize-live-deals failed:', error);
  process.exitCode = 1;
});

import '../sentry/instrument.mjs';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  buildFallbackDescription,
  cleanText,
  cleanUiNoiseText,
  normalizeDealRecord,
} from './deal-normalization-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DEFAULT_INPUT_PATH = path.join(ROOT, 'docs', 'deals.json');

const MAX_SUMMARY_LENGTH = 112;
const MIN_SUMMARY_LENGTH = 22;
const GENERIC_DESCRIPTIONS = [
  /^deal$/i,
  /^rabatt$/i,
  /^gratis$/i,
  /^angebot$/i,
  /^aktion$/i,
  /^mehr erfahren$/i,
  /^siehe webseite$/i,
  /^siehe website$/i,
  /^mehr infos$/i,
  /^weitere infos$/i,
  /^jetzt entdecken$/i,
];

const FILLER_PHRASES = [
  'jetzt',
  'aktuell',
  'gerade',
  'brandneu',
  'super',
  'mega',
  'ultra',
  'nicht verpassen',
  'solange der vorrat reicht',
  'für euch',
  'für dich',
  'schnell sichern',
  'schnell sein',
];

function resolveInputPath(argvPath) {
  if (!argvPath) return DEFAULT_INPUT_PATH;
  return path.isAbsolute(argvPath) ? argvPath : path.join(ROOT, argvPath);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeWhitespace(value) {
  return cleanText(value)
    .replace(/\s*[|•·]\s*/g, ' • ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripLeadingBrand(text, brand) {
  const cleanBrand = cleanUiNoiseText(brand || '');
  if (!cleanBrand || !text) return text;
  const pattern = new RegExp(`^${escapeRegex(cleanBrand)}(?:\\s*[:\\-–|•]\\s*|\\s+)`, 'i');
  return text.replace(pattern, '').trim();
}

function removeFillerPhrases(text) {
  let next = text;
  for (const phrase of FILLER_PHRASES) {
    next = next.replace(new RegExp(`\\b${escapeRegex(phrase)}\\b`, 'gi'), ' ');
  }
  return next.replace(/\s+/g, ' ').trim();
}

function truncateAtWordBoundary(text, maxLength = MAX_SUMMARY_LENGTH) {
  if (text.length <= maxLength) return text;
  const slice = text.slice(0, maxLength + 1);
  const lastSpace = slice.lastIndexOf(' ');
  if (lastSpace > Math.floor(maxLength * 0.55)) {
    return `${slice.slice(0, lastSpace).trim()}...`;
  }
  return `${slice.slice(0, maxLength).trim()}...`;
}

function cleanSummaryText(value, brand = '') {
  let text = normalizeWhitespace(value);
  if (!text) return '';

  text = stripLeadingBrand(text, brand);
  text = removeFillerPhrases(text);
  text = text
    .replace(/\(\s*\)/g, ' ')
    .replace(/\[\s*\]/g, ' ')
    .replace(/\s+([,.:;!?])/g, '$1')
    .replace(/^[,.:;!?\-–•\s]+|[,.:;!?\-–•\s]+$/g, '')
    .trim();

  return truncateAtWordBoundary(text);
}

function compactLocation(value) {
  const text = cleanSummaryText(value);
  if (!text) return '';
  if (/^(wien|vienna)$/i.test(text)) return 'Wien';
  return text;
}

function compactExpiry(value) {
  const text = cleanSummaryText(value);
  if (!text) return '';
  if (/^(siehe webseite|siehe website|laufend|unbekannt|jederzeit|dauerhaft|unbegrenzt)$/i.test(text)) return '';
  return text;
}

function hasUsefulSignal(text) {
  return /\b(gratis|kostenlos|free|1\+1|bogo|rabatt|sale|sparen|probetraining|geburtstag|deal|voucher|gutschein|coupon|bonus|aktion|\d{1,3}\s?%|\d+[,.]?\d*\s?(?:€|eur))\b/i.test(text);
}

function looksGeneric(text) {
  if (!text) return true;
  if (GENERIC_DESCRIPTIONS.some((pattern) => pattern.test(text))) return true;
  return text.length < MIN_SUMMARY_LENGTH;
}

function extractOfferSignal(deal) {
  const haystack = [
    deal.title,
    deal.description,
    deal.expires,
    deal.brand,
  ].map(cleanText).join(' ');

  const patterns = [
    /\b1\s*\+\s*1\b/i,
    /\bbogo\b/i,
    /\bgratis\b/i,
    /\bkostenlos\b/i,
    /\bfree\b/i,
    /\bprobetraining\b/i,
    /\bgeburtstag\b/i,
    /\bwelcome bonus\b/i,
    /\bgratis(?:er|e|es)?\s+[^\s,.;:!?]+(?:\s+[^\s,.;:!?]+)?/i,
    /\b\d{1,3}\s?%\b/,
    /\b\d+[,.]?\d*\s?(?:€|eur)\b/i,
  ];

  for (const pattern of patterns) {
    const match = haystack.match(pattern);
    if (match) return cleanSummaryText(match[0]);
  }

  if (deal.type === 'gratis' || deal.type === 'freebie') return 'Gratis';
  if (deal.type === 'bogo') return '1+1 Deal';
  if (deal.type === 'rabatt') return 'Rabatt';
  if (deal.type === 'testabo') return 'Testabo';
  return '';
}

function combineSummaryParts(parts) {
  const unique = [];
  const seen = new Set();
  for (const part of parts) {
    const cleanPart = cleanSummaryText(part);
    if (!cleanPart) continue;
    const key = cleanPart.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(cleanPart);
  }
  return truncateAtWordBoundary(unique.join(' • '));
}

function pickBestDescription(deal) {
  const normalized = normalizeDealRecord(deal);
  const brand = normalized.brand || '';
  const original = cleanSummaryText(normalized.description, brand);
  const title = cleanSummaryText(normalized.title, brand);
  const offerSignal = extractOfferSignal(normalized);
  const location = compactLocation(normalized.distance);
  const expiry = compactExpiry(normalized.expires);

  const originalLooksGood = Boolean(original) &&
    !looksGeneric(original) &&
    (original.length <= MAX_SUMMARY_LENGTH || hasUsefulSignal(original));

  if (originalLooksGood && original.length <= MAX_SUMMARY_LENGTH) {
    return original;
  }

  const derived = combineSummaryParts([
    offerSignal,
    title,
    location,
    expiry,
  ]);

  if (derived && !looksGeneric(derived)) {
    return derived;
  }

  const fallback = cleanSummaryText(buildFallbackDescription(normalized), brand);
  if (fallback && !looksGeneric(fallback)) {
    return fallback;
  }

  return original || title || fallback;
}

function processDeals(deals) {
  let improved = 0;
  const nextDeals = deals.map((deal) => {
    const nextDescription = pickBestDescription(deal);
    const previousDescription = cleanUiNoiseText(deal.description || '');
    if (!nextDescription || nextDescription === previousDescription) {
      return deal;
    }
    improved += 1;
    return {
      ...deal,
      description: nextDescription,
    };
  });

  return { deals: nextDeals, improved };
}

async function main() {
  const inputPath = resolveInputPath(process.argv[2]);
  console.log(`📝 Smart Summary läuft für ${inputPath}`);

  if (!fs.existsSync(inputPath)) {
    console.error(`❌ Datei nicht gefunden: ${inputPath}`);
    process.exit(1);
  }

  const data = readJson(inputPath);
  const deals = Array.isArray(data?.deals) ? data.deals : [];
  const { deals: nextDeals, improved } = processDeals(deals);

  if (improved === 0) {
    console.log('ℹ️ Keine Beschreibungen mussten angepasst werden.');
    return;
  }

  const nextData = {
    ...data,
    deals: nextDeals,
    lastUpdated: new Date().toISOString(),
  };

  writeJson(inputPath, nextData);
  console.log(`✅ ${improved} Beschreibungen verbessert.`);
}

main().catch((error) => {
  console.error('❌ smart-summary fehlgeschlagen:', error);
  process.exit(1);
});

export {
  cleanSummaryText,
  pickBestDescription,
  processDeals,
};

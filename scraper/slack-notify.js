import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  DEFAULT_REPORT_PATH,
  validateDealsForSlack,
  writeDealValidityReport,
} from './deal-validity-agent.js';
import { parseExpiryShape } from './expiry-utils.js';
import {
  filterModeratedDeals,
  loadDealModeration,
  moderationCounts,
} from './deal-moderation-utils.js';
import { extractDealsFromThreadMessages } from './slack-digest-utils.js';
import {
  canonicalDealUrl,
  canonicalSocialPostKey,
  extractStructuredOwnerUsername,
  getPublicationEvidence,
  getViennaEvidence,
  mergeDealEvidence,
  mergeDuplicateDealRecords,
} from './deal-evidence-utils.js';
import {
  enrichDealWithInstagramGraphEvidence,
  loadInstagramGraphEvidence,
} from './instagram-graph-evidence.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const PENDING_ALL_PATH = path.join(DOCS_DIR, 'deals-pending-all.json');
const KEY4_REVIEW_PATH = path.join(DOCS_DIR, 'deals-review-firecrawl4.json');
const GRAPH_EVIDENCE_PATH = path.join(DOCS_DIR, 'instagram-graph-post-evidence.json');
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

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || '';
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID || '';
const PENDING_FILE_NAMES = process.env.PENDING_FILE_NAMES || '';
const SEEN_DEAL_SUPPRESSION_DAYS = Number(process.env.SLACK_SEEN_DEAL_SUPPRESSION_DAYS || 7);
const MAX_SEEN_REACTION_CHECKS = Number(process.env.SLACK_SEEN_MAX_REACTION_CHECKS || 250);
const FIRECRAWL_REVIEW_ENABLED = /^(?:1|true|yes)$/i.test(cleanText(process.env.FIRECRAWL_REVIEW_ENABLED));
const FIRECRAWL_REVIEW_MAX_PER_SOURCE = boundedInteger(
  process.env.FIRECRAWL_REVIEW_MAX_PER_SOURCE,
  10,
  1,
  25,
);
const FIRECRAWL_REVIEW_MAX_TOTAL = boundedInteger(
  process.env.FIRECRAWL_REVIEW_MAX_TOTAL,
  30,
  1,
  100,
);
const FIRECRAWL_REVIEW_MAX_AGE_DAYS = boundedInteger(
  process.env.FIRECRAWL_REVIEW_MAX_AGE_DAYS,
  7,
  1,
  14,
);
const KEY4_REVIEW_ARTIFACT_MAX_AGE_HOURS = boundedInteger(
  process.env.FIRECRAWL_KEY4_REVIEW_ARTIFACT_MAX_AGE_HOURS,
  48,
  12,
  168,
);
const EXCLUDED_PENDING_FILES = new Set([
  'deals-pending-all.json',
  'deals-pending-firecrawl.json',
  'deals-pending-instagram-verified.json',
  'deals-pending-merged.json',
]);

function ensureObject(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value) {
  if (!value) return '';
  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function normalizeLooseText(value) {
  return cleanText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeUrl(url) {
  const text = cleanText(url);
  if (!text) return '';
  if (!/^https?:\/\//i.test(text)) return '';
  return text;
}

function canonicalPostKey(url) {
  const text = normalizeUrl(url);
  if (!text) return '';
  try {
    const parsed = new URL(text);
    parsed.hash = '';
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const pathParts = parsed.pathname.split('/').filter(Boolean);

    if (host === 'instagram.com' && parsed.pathname.toLowerCase().startsWith('/accounts/login')) {
      const next = cleanText(parsed.searchParams.get('next'));
      if (next) {
        const nextUrl = next.startsWith('http') ? next : `https://instagram.com${next}`;
        return canonicalPostKey(nextUrl);
      }
    }

    if (host === 'instagram.com') {
      const postTypeIndex = pathParts.findIndex((part) => ['p', 'reel', 'tv'].includes(part.toLowerCase()));
      if (postTypeIndex >= 0 && pathParts[postTypeIndex + 1]) {
        return `instagram:${pathParts[postTypeIndex].toLowerCase()}:${pathParts[postTypeIndex + 1]}`;
      }
    }

    if (host === 'tiktok.com') {
      const videoIndex = pathParts.findIndex((part) => part.toLowerCase() === 'video');
      if (videoIndex >= 0 && pathParts[videoIndex + 1]) {
        return `tiktok:video:${pathParts[videoIndex + 1].toLowerCase()}`;
      }
    }

    parsed.hostname = host;
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    parsed.search = '';
    return parsed.toString().toLowerCase();
  } catch {
    return text.replace(/[#?].*$/, '').replace(/\/+$/, '').toLowerCase();
  }
}

function isDigestHeader(message) {
  return cleanText(message?.text).includes('FreeFinder Wien');
}

function isLikelyHumanMessage(message, botUserId) {
  const user = cleanText(message?.user);
  if (!user || (botUserId && user === botUserId)) return false;
  if (message?.bot_id || message?.subtype === 'bot_message') return false;
  return !isDigestHeader(message);
}

function hasHumanCheckReaction(reactions, botUserId) {
  const checkNames = new Set(['white_check_mark', 'heavy_check_mark', 'check']);
  return ensureArray(reactions).some((reaction) => {
    if (!checkNames.has(cleanText(reaction?.name))) return false;
    return ensureArray(reaction?.users).some((user) => user && user !== botUserId);
  });
}

function toIsoDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString();
}

function inferBrand(deal, sourceKey) {
  const brand = cleanText(deal.brand);
  if (brand) return brand;
  const title = cleanText(deal.title);
  if (title.includes(' - ')) return title.split(' - ')[0].trim();
  if (title.includes(':')) return title.split(':')[0].trim();
  return sourceKey;
}

function inferTitle(deal, brand) {
  const title = cleanText(deal.title);
  if (title) return title;
  const desc = cleanText(deal.description);
  if (desc) return desc.slice(0, 80);
  return `${brand} Deal`;
}

function inferType(deal) {
  const t = cleanText(deal.type).toLowerCase();
  if (['gratis', 'rabatt', 'testabo', 'bogo'].includes(t)) return t;
  return 'rabatt';
}

function inferCategory(deal) {
  const c = cleanText(deal.category).toLowerCase();
  return c || 'wien';
}

function inferLogo(deal, type) {
  const logo = cleanText(deal.logo);
  if (logo) return logo;
  if (type === 'gratis') return '🎁';
  return '🎯';
}

function inferDistance(deal) {
  const structuredLocation = deal.location && typeof deal.location === 'object'
    ? (deal.location.address || deal.location.streetAddress || deal.location.name || deal.location.city)
    : deal.location;
  return cleanText(deal.distance || structuredLocation || deal.ort || deal.address || deal.city);
}

function inferExpires(deal) {
  const raw = deal.expires || deal.validUntil || deal.validOn || deal.end_date || deal.validity_date || '';
  const text = cleanText(raw);
  if (!text || /^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^(?:abflug|departure|hinflug)\b/i.test(text)) return text;
  if (!/\b(?:19|20)\d{2}\b/.test(text)) return text;
  const shape = parseExpiryShape(text, {
    contextText: [deal.title, deal.description, deal.category, deal.type].map(cleanText).filter(Boolean).join(' '),
  });
  return cleanText(shape.validOn || shape.validUntil || text);
}

function repairKnownDealIdentity(deal, url, inferredBrand, inferredTitle) {
  let hostname = '';
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    hostname = '';
  }
  if (hostname === 'watertuin.at' && /^tui$/i.test(inferredBrand)) {
    return {
      brand: 'Watertuin',
      title: /free all-you-can-eat/i.test(inferredTitle)
        ? 'Gratis All-you-can-eat & Drinks am Geburtstag'
        : inferredTitle,
      logo: '🍽️',
      logoUrl: 'https://www.google.com/s2/favicons?sz=256&domain_url=https://www.watertuin.at',
    };
  }
  if (hostname.endsWith('foodora.at') && /^mcdonald'?s$/i.test(inferredBrand) && /^1\s*\+\s*1\s+gratis\s+burger/i.test(inferredTitle)) {
    return {
      brand: "McDonald's",
      title: "1+1 gratis Burger bei McDonald's",
      logo: inferLogo(deal, inferType(deal)),
      logoUrl: cleanText(deal.logoUrl),
    };
  }
  if (hostname.endsWith('burgerking.at') && /^burger\s+king$/i.test(inferredBrand) && /^verschiedene\s+coupons/i.test(inferredTitle)) {
    return {
      brand: 'Burger King',
      title: 'Verschiedene Burger-King-Coupons und 1+1-Aktionen',
      logo: inferLogo(deal, inferType(deal)),
      logoUrl: cleanText(deal.logoUrl),
    };
  }
  if (hostname.endsWith('tiktok.com') && /^@?lovinghut\.neubau$/i.test(inferredBrand) && /^strawberry:\s*/i.test(inferredTitle)) {
    return {
      brand: '@lovinghut.neubau',
      title: inferredTitle.replace(/^strawberry:\s*/i, ''),
      logo: inferLogo(deal, inferType(deal)),
      logoUrl: cleanText(deal.logoUrl),
    };
  }
  return {
    brand: inferredBrand,
    title: inferredTitle,
    logo: inferLogo(deal, inferType(deal)),
    logoUrl: cleanText(deal.logoUrl),
  };
}

function stableId(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

function normalizeDeal(rawDeal, sourceKey) {
  const deal = ensureObject(rawDeal);
  const rawUrl = normalizeUrl(deal.url || deal.post_url || deal.postUrl);
  const inferredBrand = inferBrand(deal, sourceKey);
  const inferredTitle = inferTitle(deal, inferredBrand);
  const identity = repairKnownDealIdentity(deal, rawUrl, inferredBrand, inferredTitle);
  const brand = identity.brand;
  const title = identity.title;
  const rawDistance = inferDistance(deal);
  const rawExpires = cleanText(deal.expires || deal.validUntil || deal.validOn || deal.end_date || deal.validity_date || '');
  const normalizedExpires = inferExpires(deal);
  const rawSource = cleanText(deal.source);
  const originSource = cleanText(deal.originSource) || rawSource || sourceKey;
  const url = rawUrl;
  const publication = getPublicationEvidence(deal);
  const viennaEvidence = getViennaEvidence(deal);
  const suppliedViennaEvidence = ensureObject(deal.viennaEvidence);
  const normalizedViennaEvidence = Object.keys(suppliedViennaEvidence).length > 0
    ? { ...suppliedViennaEvidence }
    : (viennaEvidence.hasViennaEvidence
        ? {
            verified: true,
            type: viennaEvidence.type,
            source: viennaEvidence.type,
            value: viennaEvidence.value,
            detail: viennaEvidence.value,
          }
        : undefined);
  const legacyFirecrawl = /\bfirecrawl\b/i.test([rawSource, originSource, sourceKey].join(' '));
  const legacyPubDate = toIsoDate(deal.pubDate);
  const pubDate = legacyFirecrawl ? legacyPubDate : publication.sourcePublishedAt;
  const pubDateSource = legacyFirecrawl ? cleanText(deal.pubDateSource) : publication.sourcePublishedAtSource;
  const idSeed = `${sourceKey}|${deal.id || ''}|${url}|${title}`;
  const id = cleanText(deal.id) || `${sourceKey}-${stableId(idSeed)}`;
  const type = inferType(deal);
  const missingFields = ensureArray(deal.missingFields).map(cleanText).filter(Boolean);
  if (!rawUrl) missingFields.push('Ziel-URL');
  if (!rawDistance) missingFields.push('Ort');
  if (!rawExpires) missingFields.push('Ablauf');
  if (!rawSource) missingFields.push('Quelle');

  return {
    ...deal,
    id,
    brand,
    title,
    description: cleanText(deal.description),
    url,
    category: inferCategory(deal),
    type,
    logo: identity.logo,
    logoUrl: identity.logoUrl,
    distance: rawDistance,
    address: cleanText(deal.address),
    location: deal.location && typeof deal.location === 'object'
      ? { ...deal.location }
      : cleanText(deal.location),
    ort: cleanText(deal.ort),
    city: cleanText(deal.city || (deal.location && typeof deal.location === 'object' ? deal.location.city : '')),
    postalCode: cleanText(deal.postalCode || deal.zip || deal.zipCode || (deal.location && typeof deal.location === 'object' ? (deal.location.postalCode || deal.location.zip) : '')),
    latitude: deal.latitude ?? deal.lat ?? (deal.location && typeof deal.location === 'object' ? deal.location.latitude : undefined),
    longitude: deal.longitude ?? deal.lng ?? deal.lon ?? (deal.location && typeof deal.location === 'object' ? deal.location.longitude : undefined),
    pubDate,
    pubDateSource,
    sourcePublishedAt: toIsoDate(deal.sourcePublishedAt || deal.source_published_at),
    sourcePublishedAtSource: cleanText(deal.sourcePublishedAtSource || deal.sourceDateSource),
    createdAt: toIsoDate(deal.createdAt),
    discoveredAt: toIsoDate(deal.discoveredAt),
    submittedAt: toIsoDate(deal.submittedAt),
    lastUpdated: toIsoDate(deal.lastUpdated),
    expires: normalizedExpires,
    expiresOriginal: cleanText(deal.expiresOriginal || (rawExpires && rawExpires !== normalizedExpires ? rawExpires : '')),
    expiresSource: cleanText(deal.expiresSource),
    expirySource: cleanText(deal.expirySource || deal.expiresSource),
    expiryKind: cleanText(deal.expiryKind),
    expiryDisplayText: cleanText(deal.expiryDisplayText),
    validOn: cleanText(deal.validOn),
    validFrom: cleanText(deal.validFrom),
    validUntil: cleanText(deal.validUntil),
    dateConfidence: cleanText(deal.dateConfidence),
    source: cleanText(deal.source) || sourceKey,
    originSource,
    qualityScore: Number(deal.qualityScore) || 0,
    hot: Boolean(deal.hot),
    isNew: true,
    votes: Number(deal.votes) || 1,
    priority: Number(deal.priority) || 3,
    ownerUsername: extractStructuredOwnerUsername(deal),
    viennaVerified: deal.viennaVerified === true || viennaEvidence.hasViennaEvidence,
    viennaEvidence: normalizedViennaEvidence,
    slackTs: cleanText(deal.slackTs),
    slackThreadTs: cleanText(deal.slackThreadTs),
    slackPostFormatVersion: cleanText(deal.slackPostFormatVersion),
    missingFields: [...new Set(missingFields)],
  };
}

function normalizeDealWithGraphEvidence(rawDeal, sourceKey, graphEvidence) {
  const graphResult = enrichDealWithInstagramGraphEvidence(rawDeal, graphEvidence);
  return normalizeDeal(graphResult.deal, sourceKey);
}

function getPendingFiles() {
  const allPendingFiles = fs.readdirSync(DOCS_DIR).filter((file) => {
    if (!file.startsWith('deals-pending-') || !file.endsWith('.json')) return false;
    return !EXCLUDED_PENDING_FILES.has(file);
  });
  if (!cleanText(PENDING_FILE_NAMES)) {
    return allPendingFiles.sort((left, right) => left.localeCompare(right));
  }

  const requested = PENDING_FILE_NAMES
    .split(',')
    .map((name) => cleanText(name))
    .filter(Boolean);
  return requested.filter((name) => allPendingFiles.includes(name) && !EXCLUDED_PENDING_FILES.has(name));
}

function loadPendingDeals(files, graphEvidence = new Map()) {
  const deals = [];
  console.log(`📂 Found ${files.length} pending deal files`);

  for (const file of files) {
    const sourceKey = file.replace(/^deals-pending-/, '').replace(/\.json$/, '');
    const filePath = path.join(DOCS_DIR, file);
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const items = ensureArray(parsed.deals || parsed);
      const normalized = items.map((deal) => normalizeDealWithGraphEvidence(deal, sourceKey, graphEvidence));
      console.log(`  - ${file}: ${normalized.length} deals`);
      deals.push(...normalized);
    } catch (error) {
      console.log(`  ⚠️ Error reading ${file}: ${error.message}`);
    }
  }

  return deals;
}

const KEY4_REVIEW_REASON_PATTERN = /^(?:missing-original-offer-evidence|not-verified-vienna|chance-based-offer|missing-real-post-date|older-than-\d+-days)$/i;

function formatKey4ReviewReason(reason) {
  const normalized = cleanText(reason).toLowerCase();
  if (normalized === 'missing-original-offer-evidence') return 'Originalpost-Inhalt nicht vollständig lesbar';
  if (normalized === 'not-verified-vienna') return 'Wien-Nachweis manuell prüfen';
  if (normalized === 'chance-based-offer') return 'Gratis-Vorteil ist glücksabhängig';
  if (normalized === 'missing-real-post-date') return 'Original-Postdatum fehlt';
  const ageDays = normalized.match(/^older-than-(\d+)-days$/)?.[1];
  if (ageDays) return `Post älter als ${ageDays} Tage, möglicher wiederkehrender Deal`;
  return normalized;
}

function isKey4ReviewDeal(deal) {
  return cleanText(deal?.key4Decision?.status).toLowerCase() === 'review'
    && /(?:^|\b)firecrawl4\b/i.test(cleanText(deal?.originSource))
    && /^instagram:/i.test(canonicalPostKey(deal?.url));
}

function prepareKey4ReviewDeals(deals, options = {}) {
  const maxAgeDays = boundedInteger(options.maxAgeDays, 7, 1, 14);
  const selected = [];
  let discarded = 0;

  for (const deal of ensureArray(deals)) {
    if (!isKey4ReviewDeal(deal)) {
      discarded += 1;
      continue;
    }
    const rawReasons = ensureArray(deal?.key4Decision?.reasons).map(cleanText).filter(Boolean);
    if (rawReasons.length === 0 || rawReasons.some((reason) => !KEY4_REVIEW_REASON_PATTERN.test(reason))) {
      discarded += 1;
      continue;
    }
    const sourceAgeDays = Number(deal?.postAgeDays);
    if (Number.isFinite(sourceAgeDays) && sourceAgeDays > maxAgeDays) {
      discarded += 1;
      continue;
    }
    const reasons = rawReasons.map(formatKey4ReviewReason);
    selected.push({
      ...deal,
      firecrawlReview: true,
      firecrawlReviewSource: 'Firecrawl Key 4 - Instagram Direct',
      firecrawlReviewReasons: reasons,
      key4ReviewReasons: rawReasons,
      validity: {
        ...ensureObject(deal?.validity),
        status: 'blocked',
        reasons,
        sourceDate: cleanText(deal?.pubDate || deal?.sourcePublishedAt),
        sourceAgeDays: Number.isFinite(sourceAgeDays) ? sourceAgeDays : null,
      },
    });
  }

  return {
    deals: selected.sort(compareFirecrawlReviewDeals),
    eligible: selected.length,
    discarded,
    maxAgeDays,
  };
}

function loadKey4ReviewArtifact(options = {}) {
  if (!fs.existsSync(KEY4_REVIEW_PATH)) {
    return { deals: [], eligible: 0, discarded: 0, maxAgeDays: 7, status: 'missing' };
  }
  try {
    const payload = ensureObject(JSON.parse(fs.readFileSync(KEY4_REVIEW_PATH, 'utf-8')));
    const updatedAt = new Date(cleanText(payload.lastUpdated));
    const now = options.now instanceof Date ? options.now : new Date();
    const ageHours = Number.isNaN(updatedAt.getTime())
      ? Number.POSITIVE_INFINITY
      : Math.max(0, (now.getTime() - updatedAt.getTime()) / (60 * 60 * 1000));
    if (ageHours > KEY4_REVIEW_ARTIFACT_MAX_AGE_HOURS) {
      return { deals: [], eligible: 0, discarded: 0, maxAgeDays: 7, status: 'stale', ageHours };
    }
    const normalized = ensureArray(payload.deals).map((deal) => (
      normalizeDealWithGraphEvidence(deal, 'firecrawl4-review', options.graphEvidence || new Map())
    ));
    return {
      ...prepareKey4ReviewDeals(normalized, { maxAgeDays: 7 }),
      status: 'loaded',
      ageHours,
    };
  } catch (error) {
    return {
      deals: [],
      eligible: 0,
      discarded: 0,
      maxAgeDays: 7,
      status: 'invalid',
      error: cleanText(error?.message),
    };
  }
}

function loadPendingQueue(graphEvidence = new Map()) {
  if (!fs.existsSync(PENDING_ALL_PATH)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(PENDING_ALL_PATH, 'utf-8'));
    const deals = ensureArray(parsed.deals);
    return deals.map((deal) => (
      normalizeDealWithGraphEvidence(deal, cleanText(deal.source) || 'queue', graphEvidence)
    ));
  } catch {
    return [];
  }
}

function formatDate(value) {
  if (!value) return 'k.A.';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('de-AT');
}

function formatValidationDetails(deal) {
  const validity = ensureObject(deal.validity);
  if (!validity.status) return '';

  const icon = validity.status === 'ok'
    ? '✅'
    : (validity.status === 'warning' ? '⚠️' : '🚫');
  const lines = [`🧪 Prüfstatus: ${icon} ${validity.status}`];

  if (validity.sourceDate) {
    lines.push(`🗓️ Quell-/Post-Datum: ${formatDate(validity.sourceDate)} (${validity.sourceDateSource || 'k.A.'})`);
  }
  if (validity.expiryDate) {
    lines.push(`⏳ Gefundene Gültigkeit: ${formatDate(validity.expiryDate)} (${validity.expirySource || 'k.A.'})`);
  }

  const reasons = ensureArray(validity.reasons).filter(Boolean);
  if (reasons.length > 0) {
    lines.push(`🚫 Automatisch blockiert: ${reasons.slice(0, 3).join('; ')}`);
  }

  const warnings = ensureArray(validity.warnings).filter(Boolean);
  if (warnings.length > 0) {
    lines.push(`⚠️ Hinweise: ${warnings.slice(0, 2).join('; ')}`);
  }

  return `\n${lines.join('\n')}`;
}

function formatReasonCategoryCounts(counts) {
  const entries = Object.entries(ensureObject(counts))
    .filter(([, count]) => Number(count) > 0)
    .sort((left, right) => Number(right[1]) - Number(left[1]));
  if (entries.length === 0) return '';
  return entries.map(([reason, count]) => `${count} ${reason}`).join(' | ');
}

function buildSlackMessage(deal, index) {
  const validity = ensureObject(deal.validity);
  const displayedOfferDate = validity.status ? validity.sourceDate : deal.pubDate;
  const displayedStart = deal.validFrom || (deal.expiryKind === 'single' ? deal.validOn : '');
  const displayedExpiry = validity.expiryDate || deal.validUntil || deal.validOn || deal.expires;
  const link = deal.url ? `<${deal.url}|Zum Angebot>` : '⚠️ FEHLT';
  const desc = deal.description ? `\n📝 ${deal.description.slice(0, 180)}` : '';
  const missingNote = Array.isArray(deal.missingFields) && deal.missingFields.length > 0
    ? `\n⚠️ FEHLT: ${deal.missingFields.join(', ')}`
    : '';
  const validationDetails = formatValidationDetails(deal);
  return [
    `*${index}. ${deal.title}*`,
    `🏷️ Marke/Restaurant: ${deal.brand || 'k.A.'}`,
    `📍 Ort: ${deal.distance || 'k.A.'}`,
    `📅 Angebotsdatum: ${formatDate(displayedOfferDate)}`,
    ...(displayedStart ? [`🚀 Startet am: ${formatDate(displayedStart)}`] : []),
    `⏳ Gültig bis: ${displayedExpiry ? formatDate(displayedExpiry) : 'k.A.'}`,
    `🧭 Kategorie: ${deal.category} | Typ: ${deal.type}`,
    `🧩 Ursprung intern: ${deal.originSource || deal.source || 'k.A.'}`,
    `🔗 Direktlink: ${link}`,
    `🆔 Deal-ID: ${deal.id}`,
    validationDetails,
    missingNote,
    desc,
    `✏️ Bearbeiten: \`edit ${index} titel: Neuer Titel | datum: TT.MM.JJJJ | ablauf: TT.MM.JJJJ | ort: Adresse | link: https://... | quelle: Quelle\``,
    '_Mit ✅ freigeben_',
  ].join('\n');
}

function buildFirecrawlReviewMessage(deal, index) {
  return buildSlackMessage(deal, index).replace(
    '_Mit ✅ freigeben_',
    '_Review: Link prüfen. Wenn der Deal aktuell ist, Datum/Ablauf/Ort mit `edit` belegen und erst danach ✅ setzen._',
  );
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function postSlackMessage(text, threadTs = null, attempt = 0) {
  const payload = { channel: SLACK_CHANNEL_ID, text };
  if (threadTs) payload.thread_ts = threadTs;

  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (data.ok) return data.ts;

  if (data.error === 'ratelimited' && attempt < 5) {
    const retryMs = (Number(data.retry_after) || 2) * 1000;
    console.log(`  ⏳ Rate limited, waiting ${retryMs}ms...`);
    await sleep(retryMs);
    return postSlackMessage(text, threadTs, attempt + 1);
  }

  console.log(`❌ Slack post failed: ${data.error || 'unknown_error'}`);
  return null;
}

async function slackApi(url, attempt = 0) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
    },
  });

  const retryAfterHeader = response.headers.get('retry-after');
  const data = await response.json();

  if (response.status === 429 || data.error === 'ratelimited') {
    if (attempt >= 5) return { ok: false, error: 'ratelimited' };
    const retryMs = Math.max(1000, Number(retryAfterHeader || data.retry_after || 2) * 1000);
    console.log(`  ⏳ Rate limited, waiting ${retryMs}ms...`);
    await sleep(retryMs);
    return slackApi(url, attempt + 1);
  }

  return data;
}

async function getBotUserId() {
  const data = await slackApi('https://slack.com/api/auth.test');
  if (!data.ok) return '';
  return cleanText(data.user_id);
}

async function findRecentDigestThreadTs(days = SEEN_DEAL_SUPPRESSION_DAYS) {
  if (!Number.isFinite(days) || days <= 0) return [];
  const oldest = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);
  let cursor = '';
  const threadTs = [];

  while (true) {
    const query = new URLSearchParams({
      channel: SLACK_CHANNEL_ID,
      limit: '100',
      oldest: String(oldest),
    });
    if (cursor) query.set('cursor', cursor);

    const data = await slackApi(`https://slack.com/api/conversations.history?${query.toString()}`);
    if (!data.ok) {
      console.log(`⚠️ Konnte alte Slack-Digests nicht lesen: ${data.error || 'unknown_error'}`);
      break;
    }

    for (const msg of ensureArray(data.messages)) {
      if (isDigestHeader(msg)) {
        const ts = cleanText(msg.ts);
        if (ts) threadTs.push(ts);
      }
    }

    cursor = cleanText(data.response_metadata?.next_cursor);
    if (!cursor) break;
    await sleep(300);
  }

  return [...new Set(threadTs)];
}

async function getThreadMessages(threadTs) {
  let cursor = '';
  const messages = [];

  while (true) {
    const query = new URLSearchParams({
      channel: SLACK_CHANNEL_ID,
      ts: threadTs,
      limit: '200',
    });
    if (cursor) query.set('cursor', cursor);

    const data = await slackApi(`https://slack.com/api/conversations.replies?${query.toString()}`);
    if (!data.ok) break;
    messages.push(...ensureArray(data.messages));

    cursor = cleanText(data.response_metadata?.next_cursor);
    if (!cursor) break;
    await sleep(300);
  }

  return messages;
}

async function getReactions(messageTs) {
  const query = new URLSearchParams({
    channel: SLACK_CHANNEL_ID,
    timestamp: messageTs,
  });
  const data = await slackApi(`https://slack.com/api/reactions.get?${query.toString()}`);
  if (!data.ok) return [];
  return ensureArray(data.message?.reactions);
}

function addSeenDealsFromThread(seenKeys, deals) {
  let added = 0;
  for (const deal of deals) {
    const key = canonicalPostKey(deal.url);
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);
    added += 1;
  }
  return added;
}

async function loadRecentlySeenPostKeys() {
  const threadTsList = await findRecentDigestThreadTs();
  if (threadTsList.length === 0) return new Set();

  const botUserId = await getBotUserId();
  const seenKeys = new Set();
  let reactionChecks = 0;
  let checkedThreads = 0;
  let repliedThreads = 0;
  let checkedDeals = 0;

  for (const threadTs of threadTsList) {
    const messages = await getThreadMessages(threadTs);
    const deals = extractDealsFromThreadMessages(messages);
    const dealByTs = new Map(deals.map((deal) => [cleanText(deal.slackTs), deal]).filter(([ts]) => ts));
    const headerMessage = messages.find((message) => cleanText(message?.ts) === cleanText(threadTs));
    let headerReactions = ensureArray(headerMessage?.reactions);
    if (headerReactions.length === 0 && reactionChecks < MAX_SEEN_REACTION_CHECKS) {
      headerReactions = await getReactions(threadTs);
      reactionChecks += 1;
      await sleep(150);
    }

    if (hasHumanCheckReaction(headerReactions, botUserId)) {
      const added = addSeenDealsFromThread(seenKeys, deals);
      if (added > 0) checkedThreads += 1;
      continue;
    }

    const humanReplyInThread = messages.some((message) => {
      if (cleanText(message?.ts) === cleanText(threadTs)) return false;
      if (dealByTs.has(cleanText(message?.ts))) return false;
      return isLikelyHumanMessage(message, botUserId);
    });

    if (humanReplyInThread) {
      const added = addSeenDealsFromThread(seenKeys, deals);
      if (added > 0) repliedThreads += 1;
      continue;
    }

    for (const deal of deals) {
      const message = messages.find((item) => cleanText(item?.ts) === cleanText(deal.slackTs));
      let reactions = ensureArray(message?.reactions);
      if (reactions.length === 0 && deal.slackTs && reactionChecks < MAX_SEEN_REACTION_CHECKS) {
        reactions = await getReactions(deal.slackTs);
        reactionChecks += 1;
        await sleep(150);
      }
      if (!hasHumanCheckReaction(reactions, botUserId)) continue;
      const key = canonicalPostKey(deal.url);
      if (key && !seenKeys.has(key)) {
        seenKeys.add(key);
        checkedDeals += 1;
      }
    }
  }

  console.log(
    `👀 Seen filter: ${seenKeys.size} exakte Post-URLs aus ${threadTsList.length} Slack-Digest(s) ` +
    `der letzten ${SEEN_DEAL_SUPPRESSION_DAYS} Tage ` +
    `(${checkedThreads} abgehakte Threads, ${repliedThreads} beantwortete Threads, ${checkedDeals} einzelne Deals)`
  );
  return seenKeys;
}

function filterRecentlySeenDeals(deals, seenKeys) {
  if (!seenKeys || seenKeys.size === 0) return { deals, removed: 0 };
  const filtered = deals.filter((deal) => {
    const key = canonicalPostKey(deal.url);
    return !key || !seenKeys.has(key);
  });
  return { deals: filtered, removed: deals.length - filtered.length };
}

function isSocialPostKey(key) {
  return /^instagram:|^tiktok:/i.test(cleanText(key));
}

function buildDealDuplicateKeys(deal) {
  const keys = [];
  const postKey = canonicalPostKey(deal.url);
  const titleKey = normalizeLooseText(deal.title);
  const sourceKey = normalizeLooseText(deal.source || deal.originSource);
  const idKey = cleanText(deal.id).toLowerCase();

  if (postKey && isSocialPostKey(postKey)) {
    keys.push(`post:${postKey}`);
  }
  if (postKey && titleKey) {
    keys.push(`url-title:${postKey}|${titleKey}`);
  }
  if (sourceKey && idKey) {
    keys.push(`source-id:${sourceKey}|${idKey}`);
  }

  const crawlerSignal = normalizeLooseText([deal.source, deal.originSource].map(cleanText).join(' '));
  if (postKey && /\b(?:firecrawl|crawler)\b/.test(crawlerSignal)) {
    const brandKey = normalizeLooseText(deal.brand)
      .replace(/\b(?:wien|vienna|österreich|oesterreich|austria)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (brandKey) keys.push(`crawler-url-brand:${postKey}|${brandKey}`);
  }

  if (postKey && /\bgutscheine\s+at\b/.test(crawlerSignal)) {
    keys.push(`gutscheine-url:${postKey}`);
  }

  return [...new Set(keys)];
}

function loadQueuedDealDuplicateKeys(existingDeals) {
  const keys = new Set();
  for (const deal of existingDeals) {
    if (!cleanText(deal.slackTs)) continue;
    for (const key of buildDealDuplicateKeys(deal)) keys.add(key);
  }
  return keys;
}

function filterDuplicateDealsInRun(deals) {
  const sharedDuplicates = mergeDuplicateDealRecords(deals);
  const filtered = [];
  const keyToIndex = new Map();
  let removed = sharedDuplicates.duplicateCount;

  for (const deal of sharedDuplicates.deals) {
    const keys = buildDealDuplicateKeys(deal);
    const existingIndex = keys
      .map((key) => keyToIndex.get(key))
      .find((index) => Number.isInteger(index));

    if (Number.isInteger(existingIndex)) {
      const merged = mergeDealEvidence(filtered[existingIndex], deal);
      filtered[existingIndex] = merged;
      for (const key of buildDealDuplicateKeys(merged)) keyToIndex.set(key, existingIndex);
      removed += 1;
      continue;
    }

    const index = filtered.length;
    filtered.push(deal);
    for (const key of keys) keyToIndex.set(key, index);
  }

  return { deals: filtered, removed };
}

function explicitValidityRank(deal) {
  if (cleanText(deal.validUntil || deal.validOn || deal.validity?.expiryDate)) return 3;
  const raw = cleanText(deal.expires);
  if (/\b(?:20\d{2}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}[./]20\d{2})\b/.test(raw)) return 2;
  if (raw && !/\b(?:siehe|unbekannt|laut\s+quelle|regelmäßig|regelmaessig|ongoing|k\.a\.)\b/i.test(raw)) return 1;
  return 0;
}

function directOfferUrlRank(deal) {
  try {
    const hostname = new URL(cleanText(deal.url)).hostname.toLowerCase().replace(/^www\./, '');
    return /(?:goodnight\.at|news\.google\.com|yelp\.|tripadvisor\.|1000things)/i.test(hostname) ? 0 : 1;
  } catch {
    return 0;
  }
}

function compareSlackDeals(left, right) {
  const validityDifference = explicitValidityRank(right) - explicitValidityRank(left);
  if (validityDifference) return validityDifference;
  const directUrlDifference = directOfferUrlRank(right) - directOfferUrlRank(left);
  if (directUrlDifference) return directUrlDifference;
  const qualityDifference = Number(right.qualityScore || 0) - Number(left.qualityScore || 0);
  if (qualityDifference) return qualityDifference;
  const rightDate = parseDealDate(right.pubDate)?.getTime() || 0;
  const leftDate = parseDealDate(left.pubDate)?.getTime() || 0;
  return rightDate - leftDate;
}

const FIRECRAWL_REVIEW_HARD_REASON_PATTERN = /(?:abgelaufen|nicht eindeutig in wien|url ungültig|ausgeschlossene quelle|gewinnspiel|noch nicht gestartet|liegt in der zukunft|nur gratis-lieferung|gottesdienste|meta-graph-widerspruch|kein echtes social-post-datum)/i;
const FIRECRAWL_REVIEW_SOFT_REASON_PATTERN = /^(?:älter als \d+ tage(?: trotz [^(]+)? \(\d{4}-\d{2}-\d{2}\)|kein konkretes angebot erkennbar|allgemeine empfehlung\/gratis-event statt konkreter aktion|kein echtes social-post-datum gefunden|kein verlässliches quell-\/post-datum gefunden)$/i;

function isFirecrawlReviewSource(deal) {
  return /\bfirecrawl\b/i.test([
    deal?.source,
    deal?.originSource,
    deal?.sourceKeys,
    deal?.evidenceSources,
  ].map(cleanText).join(' '));
}

function firecrawlReviewSourceKey(deal) {
  const signal = [deal?.originSource, deal?.source].map(cleanText).filter(Boolean).join(' ');
  if (/instagram direct\s*#?\s*4/i.test(signal)) return 'Firecrawl Key 4 - Instagram Direct';
  if (/instagram gastro\s*#?\s*5/i.test(signal)) return 'Firecrawl Key 5 - Instagram Gastro';
  if (/key\s*3|consumables/i.test(signal)) return 'Firecrawl Key 3 - Consumables';
  if (/food\s*#?\s*2/i.test(signal)) return 'Firecrawl Key 2 - Food';
  if (/gastro\s*#?\s*2/i.test(signal)) return 'Firecrawl Key 1 - Gastro';
  return cleanText(deal?.originSource || deal?.source) || 'Firecrawl';
}

function compareFirecrawlReviewDeals(left, right) {
  const leftAgeRaw = left?.validity?.sourceAgeDays;
  const rightAgeRaw = right?.validity?.sourceAgeDays;
  const leftAge = leftAgeRaw === null || leftAgeRaw === undefined || leftAgeRaw === ''
    ? Number.NaN
    : Number(leftAgeRaw);
  const rightAge = rightAgeRaw === null || rightAgeRaw === undefined || rightAgeRaw === ''
    ? Number.NaN
    : Number(rightAgeRaw);
  const leftAgeRank = Number.isFinite(leftAge) ? leftAge : Number.POSITIVE_INFINITY;
  const rightAgeRank = Number.isFinite(rightAge) ? rightAge : Number.POSITIVE_INFINITY;
  if (leftAgeRank !== rightAgeRank) return leftAgeRank - rightAgeRank;

  const leftReasons = ensureArray(left?.firecrawlReviewReasons).length;
  const rightReasons = ensureArray(right?.firecrawlReviewReasons).length;
  if (leftReasons !== rightReasons) return leftReasons - rightReasons;

  const qualityDifference = Number(right?.qualityScore || 0) - Number(left?.qualityScore || 0);
  if (qualityDifference) return qualityDifference;
  return compareSlackDeals(left, right);
}

function selectFirecrawlReviewDeals(results, options = {}) {
  const maxPerSource = boundedInteger(options.maxPerSource, 10, 1, 25);
  const maxTotal = boundedInteger(options.maxTotal, 30, 1, 100);
  const maxAgeDays = boundedInteger(options.maxAgeDays, 7, 1, 14);
  const candidates = [];

  for (const result of ensureArray(results)) {
    if (result?.decision?.allowed || !isFirecrawlReviewSource(result?.deal)) continue;
    const reasons = ensureArray(result?.decision?.reasons).map(cleanText).filter(Boolean);
    if (reasons.length === 0) continue;
    if (reasons.some((reason) => FIRECRAWL_REVIEW_HARD_REASON_PATTERN.test(reason))) continue;
    if (reasons.some((reason) => !FIRECRAWL_REVIEW_SOFT_REASON_PATTERN.test(reason))) continue;

    const sourceAgeRaw = result?.decision?.sourceAgeDays;
    const sourceAgeDays = sourceAgeRaw === null || sourceAgeRaw === undefined || sourceAgeRaw === ''
      ? Number.NaN
      : Number(sourceAgeRaw);
    if (Number.isFinite(sourceAgeDays) && sourceAgeDays > maxAgeDays) continue;

    const sourceKey = firecrawlReviewSourceKey(result.deal);
    candidates.push({
      ...result.deal,
      firecrawlReview: true,
      firecrawlReviewSource: sourceKey,
      firecrawlReviewReasons: reasons,
      validity: {
        ...ensureObject(result.deal?.validity),
        status: 'blocked',
        reasons,
        sourceAgeDays: Number.isFinite(sourceAgeDays) ? sourceAgeDays : null,
      },
    });
  }

  candidates.sort(compareFirecrawlReviewDeals);
  const sourceCounts = new Map();
  const duplicateKeys = new Set();
  const selected = [];
  let duplicateRemoved = 0;
  let sourceLimitRemoved = 0;

  for (const deal of candidates) {
    const keys = buildDealDuplicateKeys(deal);
    if (keys.length > 0 && keys.some((key) => duplicateKeys.has(key))) {
      duplicateRemoved += 1;
      continue;
    }

    const sourceKey = firecrawlReviewSourceKey(deal);
    const sourceCount = sourceCounts.get(sourceKey) || 0;
    if (sourceCount >= maxPerSource) {
      sourceLimitRemoved += 1;
      continue;
    }

    selected.push(deal);
    sourceCounts.set(sourceKey, sourceCount + 1);
    for (const key of keys) duplicateKeys.add(key);
    if (selected.length >= maxTotal) break;
  }

  return {
    deals: selected,
    eligible: candidates.length,
    duplicateRemoved,
    sourceLimitRemoved,
    sourceCounts: Object.fromEntries(sourceCounts),
    maxPerSource,
    maxTotal,
    maxAgeDays,
  };
}

function combineFirecrawlReviewSelections(key4Selection, validitySelection, allowedDeals = []) {
  const excludedKeys = new Set(ensureArray(allowedDeals).flatMap(buildDealDuplicateKeys));
  const excludedPostKeys = new Set(
    ensureArray(allowedDeals).map((deal) => canonicalPostKey(deal?.url)).filter(Boolean),
  );
  const selectedKeys = new Set();
  const selectedPostKeys = new Set();
  const selected = [];
  let duplicateRemoved = Number(validitySelection?.duplicateRemoved || 0);

  for (const deal of [
    ...ensureArray(key4Selection?.deals),
    ...ensureArray(validitySelection?.deals),
  ]) {
    const keys = buildDealDuplicateKeys(deal);
    const postKey = canonicalPostKey(deal?.url);
    if ((postKey && (excludedPostKeys.has(postKey) || selectedPostKeys.has(postKey)))
      || keys.some((key) => excludedKeys.has(key) || selectedKeys.has(key))) {
      duplicateRemoved += 1;
      continue;
    }
    selected.push(deal);
    for (const key of keys) selectedKeys.add(key);
    if (postKey) selectedPostKeys.add(postKey);
  }

  const sourceCounts = {};
  for (const deal of selected) {
    const sourceKey = firecrawlReviewSourceKey(deal);
    sourceCounts[sourceKey] = (sourceCounts[sourceKey] || 0) + 1;
  }

  return {
    deals: selected,
    eligible: Number(key4Selection?.eligible || 0) + Number(validitySelection?.eligible || 0),
    key4Eligible: Number(key4Selection?.eligible || 0),
    validityEligible: Number(validitySelection?.eligible || 0),
    duplicateRemoved,
    sourceLimitRemoved: Number(validitySelection?.sourceLimitRemoved || 0),
    sourceCounts,
    maxPerSource: Number(validitySelection?.maxPerSource || FIRECRAWL_REVIEW_MAX_PER_SOURCE),
    maxTotal: Number(validitySelection?.maxTotal || FIRECRAWL_REVIEW_MAX_TOTAL),
    maxAgeDays: Math.max(
      Number(key4Selection?.maxAgeDays || 0),
      Number(validitySelection?.maxAgeDays || 0),
    ),
  };
}

async function validateAndDedupeDealsForSlack(deals, options = {}) {
  const validation = await validateDealsForSlack(deals, options);
  const rankedAllowed = [...validation.allowedDeals].sort(compareSlackDeals);
  const duplicateFilter = filterDuplicateDealsInRun(rankedAllowed);
  return {
    validation,
    allowedDeals: duplicateFilter.deals,
    duplicateRemoved: duplicateFilter.removed,
  };
}

function parseDealDate(value) {
  const text = cleanText(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function queueDealAgeDays(deal, now = new Date()) {
  const slackSeconds = Number(cleanText(deal.slackTs).split('.')[0]);
  const slackDate = Number.isFinite(slackSeconds) && slackSeconds > 0
    ? new Date(slackSeconds * 1000)
    : null;
  const date = slackDate && !Number.isNaN(slackDate.getTime())
    ? slackDate
    : parseDealDate(deal.pubDate || deal.createdAt || deal.discoveredAt || deal.lastUpdated);
  if (!date) return null;
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000)));
}

function pruneStaleQueueDeals(deals, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const maxAgeDays = Number.isFinite(Number(options.maxAgeDays))
    ? Number(options.maxAgeDays)
    : SEEN_DEAL_SUPPRESSION_DAYS;
  const filtered = [];
  let removed = 0;

  for (const deal of deals) {
    const postKey = canonicalPostKey(deal.url);
    const socialSignal = normalizeLooseText([deal.url, deal.source, deal.originSource, deal.id].map(cleanText).join(' '));
    const isSocialQueueDeal = isSocialPostKey(postKey) || /\b(instagram|tiktok)\b/i.test(socialSignal);
    const age = queueDealAgeDays(deal, now);
    if ((isSocialQueueDeal && age === null) || (age !== null && age >= maxAgeDays)) {
      removed += 1;
      continue;
    }

    filtered.push(deal);
  }

  return { deals: filtered, removed };
}

async function revalidateRecentPostedQueue(deals, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const maxAgeDays = Number.isFinite(Number(options.revalidationDays))
    ? Number(options.revalidationDays)
    : SEEN_DEAL_SUPPRESSION_DAYS;
  const entries = deals
    .map((deal, index) => ({ deal, index }))
    // Review candidates intentionally remain queued so a human can add
    // factual date/expiry/location evidence before approving them. The
    // approval workflow still runs the full validator after any edit.
    .filter(({ deal }) => deal.firecrawlReview !== true
      && cleanText(deal.slackTs)
      && (queueDealAgeDays(deal, now) ?? Infinity) < maxAgeDays);
  if (entries.length === 0) {
    return { deals, removed: 0, validation: null };
  }

  const validation = await validateDealsForSlack(entries.map((entry) => entry.deal), {
    ...options,
    now,
  });
  const blockedIndexes = new Set();
  const validatedByIndex = new Map();
  validation.results.forEach((result, resultIndex) => {
    const originalIndex = entries[resultIndex].index;
    if (result.decision.allowed) validatedByIndex.set(originalIndex, result.deal);
    else blockedIndexes.add(originalIndex);
  });
  const filtered = deals
    .map((deal, index) => validatedByIndex.get(index) || deal)
    .filter((deal, index) => !blockedIndexes.has(index));
  return {
    deals: filtered,
    removed: blockedIndexes.size,
    validation,
  };
}

function filterAlreadyQueuedDeals(deals, queuedDealKeys) {
  if (!queuedDealKeys || queuedDealKeys.size === 0) return { deals, removed: 0 };
  const filtered = deals.filter((deal) => {
    const keys = buildDealDuplicateKeys(deal);
    return keys.length === 0 || !keys.some((key) => queuedDealKeys.has(key));
  });
  return { deals: filtered, removed: deals.length - filtered.length };
}

function writePendingAll(deals) {
  const payload = {
    deals,
    totalDeals: deals.length,
    updatedAt: new Date().toISOString(),
  };
  const tempPath = `${PENDING_ALL_PATH}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2));
  fs.renameSync(tempPath, PENDING_ALL_PATH);
}

function queueKey(deal) {
  const slackTs = cleanText(deal.slackTs);
  if (slackTs) return `slack:${slackTs}`;
  const postKey = canonicalPostKey(deal.url);
  if (isSocialPostKey(postKey)) return postKey;
  return cleanText(deal.id) || normalizeUrl(deal.url);
}

function mergePendingQueue(existingDeals, newPostedDeals) {
  const byKey = new Map();
  for (const deal of existingDeals) {
    const key = queueKey(deal);
    if (!key) continue;
    byKey.set(key, byKey.has(key) ? mergeDealEvidence(byKey.get(key), deal) : deal);
  }
  for (const deal of newPostedDeals) {
    const key = queueKey(deal);
    if (!key) continue;
    byKey.set(key, byKey.has(key) ? mergeDealEvidence(byKey.get(key), deal) : deal);
  }
  return [...byKey.values()];
}

async function main() {
  console.log('📱 SLACK NOTIFY - APPROVAL PIPELINE');
  console.log('========================================');

  if (!SLACK_BOT_TOKEN || !SLACK_CHANNEL_ID) {
    console.log('❌ SLACK_BOT_TOKEN oder SLACK_CHANNEL_ID fehlt (ENV oder .env)');
    process.exit(1);
  }

  const pendingFiles = getPendingFiles();
  const moderation = loadDealModeration();
  const graphEvidence = loadInstagramGraphEvidence(GRAPH_EVIDENCE_PATH).byKey;
  const loadedPendingDeals = loadPendingDeals(pendingFiles, graphEvidence);
  const graphMatchedDeals = loadedPendingDeals.filter((deal) => deal.metaGraphVerified === true);
  const graphBlockedDeals = graphMatchedDeals.filter((deal) => cleanText(deal.metaGraphBlockingReason));
  console.log(`🧬 Instagram Graph evidence: ${graphMatchedDeals.length} exakte Treffer, ${graphBlockedDeals.length} harte Widersprüche`);
  const key4ReviewArtifact = FIRECRAWL_REVIEW_ENABLED
    ? loadKey4ReviewArtifact({ graphEvidence })
    : { deals: [], eligible: 0, discarded: 0, maxAgeDays: 7, status: 'disabled' };
  const moderationPendingFilter = filterModeratedDeals(loadedPendingDeals, moderation);
  if (moderationPendingFilter.removed.length > 0) {
    console.log(`🛡️ Moderation filter: ${moderationPendingFilter.removed.length} pending Deals vor Slack entfernt`);
    const counts = formatReasonCategoryCounts(moderationCounts(moderationPendingFilter.removed));
    if (counts) console.log(`🛡️ Moderation reasons: ${counts}`);
  }
  const pendingDeals = moderationPendingFilter.deals;
  const moderationKey4ReviewFilter = filterModeratedDeals(key4ReviewArtifact.deals, moderation);
  if (moderationKey4ReviewFilter.removed.length > 0) {
    console.log(`🛡️ Key4 review moderation: ${moderationKey4ReviewFilter.removed.length} Kandidaten entfernt`);
  }
  const key4ReviewDeals = moderationKey4ReviewFilter.deals;
  console.log(`📋 Total pending deals loaded: ${pendingDeals.length}`);
  if (FIRECRAWL_REVIEW_ENABLED) {
    console.log(
      `🔎 Key4 Review-Artefakt: ${key4ReviewArtifact.status}, ${key4ReviewDeals.length} Kandidaten`
      + (Number.isFinite(key4ReviewArtifact.ageHours)
        ? `, ${key4ReviewArtifact.ageHours.toFixed(1)} Stunden alt`
        : ''),
    );
  }
  const queuePrune = pruneStaleQueueDeals(loadPendingQueue(graphEvidence));
  if (queuePrune.removed > 0) {
    console.log(`🧹 Queue prune: ${queuePrune.removed} mehr als ${SEEN_DEAL_SUPPRESSION_DAYS} Tage alte Deals aus der Slack-Queue entfernt`);
  }
  const moderationQueueFilter = filterModeratedDeals(queuePrune.deals, moderation);
  if (moderationQueueFilter.removed.length > 0) {
    console.log(`🛡️ Queue moderation: ${moderationQueueFilter.removed.length} Deals aus der Slack-Queue entfernt`);
  }
  let existingQueue = moderationQueueFilter.deals;
  let queueChanged = queuePrune.removed > 0 || moderationQueueFilter.removed.length > 0;
  const validityUrlCache = new Map();
  const recentQueueValidation = await revalidateRecentPostedQueue(existingQueue, { urlCache: validityUrlCache });
  if (recentQueueValidation.removed > 0) {
    console.log(`🧹 Queue validity: ${recentQueueValidation.removed} kürzlich gepostete, inzwischen blockierte Deals entfernt`);
    existingQueue = recentQueueValidation.deals;
    queueChanged = true;
  }

  const seenPostKeys = await loadRecentlySeenPostKeys();
  const preSlackSeenFilter = filterRecentlySeenDeals(
    [...pendingDeals, ...key4ReviewDeals],
    seenPostKeys,
  );
  if (preSlackSeenFilter.removed > 0) {
    console.log(`👀 Seen filter: ${preSlackSeenFilter.removed} bereits gesehene exakte Posts vor Slack entfernt`);
  }

  const queuedDealKeys = loadQueuedDealDuplicateKeys(existingQueue);
  const preSlackQueueFilter = filterAlreadyQueuedDeals(preSlackSeenFilter.deals, queuedDealKeys);
  if (preSlackQueueFilter.removed > 0) {
    console.log(`🔁 Queue filter: ${preSlackQueueFilter.removed} bereits gepostete Deals vor Slack entfernt`);
  }

  const queuedKey4ReviewDeals = preSlackQueueFilter.deals.filter((deal) => (
    deal.firecrawlReview === true && isKey4ReviewDeal(deal)
  ));
  const regularPendingDeals = preSlackQueueFilter.deals.filter((deal) => !(
    deal.firecrawlReview === true && isKey4ReviewDeal(deal)
  ));
  const validatedRun = await validateAndDedupeDealsForSlack(regularPendingDeals, { urlCache: validityUrlCache });
  const validation = validatedRun.validation;
  writeDealValidityReport(validation.report);
  const freshDeals = validatedRun.allowedDeals;
  const blockedSummary = formatReasonCategoryCounts(validation.summary.reasonCategoryCounts);
  const validityFirecrawlReview = FIRECRAWL_REVIEW_ENABLED
    ? selectFirecrawlReviewDeals(validation.results, {
        maxPerSource: FIRECRAWL_REVIEW_MAX_PER_SOURCE,
        maxTotal: FIRECRAWL_REVIEW_MAX_TOTAL,
        maxAgeDays: FIRECRAWL_REVIEW_MAX_AGE_DAYS,
      })
    : {
        deals: [],
        eligible: 0,
        duplicateRemoved: 0,
        sourceLimitRemoved: 0,
        sourceCounts: {},
        maxPerSource: FIRECRAWL_REVIEW_MAX_PER_SOURCE,
        maxTotal: FIRECRAWL_REVIEW_MAX_TOTAL,
        maxAgeDays: FIRECRAWL_REVIEW_MAX_AGE_DAYS,
      };
  const firecrawlReview = FIRECRAWL_REVIEW_ENABLED
    ? combineFirecrawlReviewSelections({
        deals: queuedKey4ReviewDeals,
        eligible: queuedKey4ReviewDeals.length,
        maxAgeDays: key4ReviewArtifact.maxAgeDays,
      }, validityFirecrawlReview, freshDeals)
    : validityFirecrawlReview;
  const firecrawlReviewDeals = firecrawlReview.deals;

  console.log(
    `🧪 Deal validity agent: ${validation.summary.allowed}/${validation.summary.total} allowed, ` +
    `${validation.summary.blocked} blocked, ${validation.summary.warnings} warnings`
  );
  if (blockedSummary) {
    console.log(`🚫 Blocked reasons: ${blockedSummary}`);
  }
  if (validatedRun.duplicateRemoved > 0) {
    console.log(`🔁 Run filter: ${validatedRun.duplicateRemoved} doppelte gültige Deals innerhalb dieses Laufs entfernt`);
  }
  console.log(`💾 saved: ${path.relative(ROOT, DEFAULT_REPORT_PATH)}`);
  console.log(`📨 Pending: ${pendingDeals.length}, posting to Slack: ${freshDeals.length}`);
  if (FIRECRAWL_REVIEW_ENABLED) {
    console.log(
      `🔎 Firecrawl Review: ${firecrawlReviewDeals.length}/${firecrawlReview.eligible} Kandidaten `
      + `(${firecrawlReview.key4Eligible} direkt von Key4; andere Quellen begrenzt auf `
      + `${firecrawlReview.maxPerSource}/Quelle und ${firecrawlReview.maxTotal} gesamt)`,
    );
    if (Object.keys(firecrawlReview.sourceCounts).length > 0) {
      console.log(`🔎 Firecrawl Review sources: ${formatReasonCategoryCounts(firecrawlReview.sourceCounts)}`);
    }
  }

  if (freshDeals.length === 0 && firecrawlReviewDeals.length === 0) {
    if (queueChanged) {
      writePendingAll(existingQueue);
      console.log(`💾 pending queue updated after moderation/prune: ${existingQueue.length} deals left`);
    }
    console.log('✅ Keine neuen Deals für Slack');
    return;
  }

  freshDeals.sort((a, b) => {
    if ((b.qualityScore || 0) !== (a.qualityScore || 0)) {
      return (b.qualityScore || 0) - (a.qualityScore || 0);
    }
    return new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime();
  });

  const postedDeals = [];
  if (freshDeals.length > 0) {
    const freeCount = freshDeals.filter((d) => d.type === 'gratis').length;
    const headerTs = await postSlackMessage(
      `🎯 *FreeFinder Wien* — ${freshDeals.length} neue Deals\n` +
      `🆓 ${freeCount} gratis | 💰 ${freshDeals.length - freeCount} rabatt/test\n` +
      `🧪 Gültigkeitscheck: ${validation.summary.allowed}/${validation.summary.total} freigegeben | ${validation.summary.blocked} blockiert (max. ${validation.summary.maxAgeDays} Tage)\n` +
      (blockedSummary ? `🚫 Blockiert: ${blockedSummary}\n` : '') +
      `_Jeden Deal mit ✅ bestätigen, dann erscheint er in der iOS-App._\n` +
      `_Bearbeiten vor Freigabe: z. B. edit 3 titel: Gratis Matcha | ort: Neubaugasse 12, 1070 Wien | ablauf: TT.MM.JJJJ_`,
    );

    if (!headerTs) {
      throw new Error('Konnte Header-Nachricht nicht senden');
    }

    for (let i = 0; i < freshDeals.length; i += 1) {
      const deal = freshDeals[i];
      const text = buildSlackMessage(deal, i + 1);
      const ts = await postSlackMessage(text, headerTs);
      if (!ts) continue;

      deal.slackTs = ts;
      deal.slackThreadTs = headerTs;
      deal.order = i + 1;
      postedDeals.push(deal);

      // Persist each confirmed Slack message immediately. If a later request
      // times out, the always-run workflow commit still has a durable queue
      // checkpoint and the next scan will not repost these rows.
      writePendingAll(mergePendingQueue(existingQueue, postedDeals));

      if ((i + 1) % 10 === 0) {
        console.log(`  ✅ posted ${i + 1}/${freshDeals.length}`);
      }
      await sleep(600);
    }
  }

  const postedReviewDeals = [];
  if (firecrawlReviewDeals.length > 0) {
    const reviewSources = Object.entries(firecrawlReview.sourceCounts)
      .map(([source, count]) => `${source.replace(/^Firecrawl\s*/i, '')}: ${count}`)
      .join(' | ');
    const reviewHeaderTs = await postSlackMessage(
      `🔎 *FreeFinder Wien – Firecrawl Review* — ${firecrawlReviewDeals.length} unsichere Kandidaten\n` +
      `📦 ${reviewSources || 'Firecrawl'}\n` +
      `🛡️ Key4-markierte Reviews sowie weiche Zweifelsfälle: Originalbeleg, Wien-Nachweis, Datum oder Dealtext prüfen.\n` +
      `_Eindeutig abgelaufene, Nicht-Wien-, Gewinnspiel-, ungültige und ausgeschlossene Quellen bleiben blockiert._\n` +
      `_Link prüfen; bei aktuellem Deal zuerst Datum/Ablauf/Ort mit \`edit\` belegen und danach ✅ setzen._`,
    );

    if (!reviewHeaderTs) {
      throw new Error('Konnte Firecrawl-Review-Header nicht senden');
    }

    for (let i = 0; i < firecrawlReviewDeals.length; i += 1) {
      const deal = firecrawlReviewDeals[i];
      const ts = await postSlackMessage(buildFirecrawlReviewMessage(deal, i + 1), reviewHeaderTs);
      if (!ts) continue;

      deal.slackTs = ts;
      deal.slackThreadTs = reviewHeaderTs;
      deal.order = i + 1;
      deal.firecrawlReviewQueuedAt = new Date().toISOString();
      postedReviewDeals.push(deal);
      writePendingAll(mergePendingQueue(existingQueue, [...postedDeals, ...postedReviewDeals]));

      if ((i + 1) % 10 === 0) {
        console.log(`  🔎 review posted ${i + 1}/${firecrawlReviewDeals.length}`);
      }
      await sleep(600);
    }
  }

  const mergedQueue = mergePendingQueue(existingQueue, [...postedDeals, ...postedReviewDeals]);
  writePendingAll(mergedQueue);

  console.log(`✅ ${postedDeals.length} Deals an Slack gesendet`);
  if (FIRECRAWL_REVIEW_ENABLED) {
    console.log(`🔎 ${postedReviewDeals.length} Firecrawl-Kandidaten zur manuellen Prüfung gesendet`);
  }
  console.log(`🗂️ pending queue size: ${mergedQueue.length}`);
  console.log(`💾 saved: ${path.relative(ROOT, PENDING_ALL_PATH)}`);
  if (postedDeals.length !== freshDeals.length) {
    throw new Error(`${freshDeals.length - postedDeals.length} Deal(s) konnten nicht an Slack gesendet werden`);
  }
  if (postedReviewDeals.length !== firecrawlReviewDeals.length) {
    throw new Error(`${firecrawlReviewDeals.length - postedReviewDeals.length} Firecrawl-Review(s) konnten nicht an Slack gesendet werden`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error('❌ slack-notify failed:', error.message);
    process.exit(1);
  });
}

export {
  buildFirecrawlReviewMessage,
  buildSlackMessage,
  compareSlackDeals,
  filterDuplicateDealsInRun,
  normalizeDeal,
  prepareKey4ReviewDeals,
  pruneStaleQueueDeals,
  revalidateRecentPostedQueue,
  combineFirecrawlReviewSelections,
  selectFirecrawlReviewDeals,
  validateAndDedupeDealsForSlack,
};

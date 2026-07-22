import '../sentry/instrument.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { cleanText, extractDealsFromThreadMessages, extractSlackMessageText } from './slack-digest-utils.js';
import { normalizeCategoryForScraper } from './category-utils.js';
import {
  filterModeratedDeals,
  loadDealModeration,
  moderationCounts,
} from './deal-moderation-utils.js';
import { isVagueExpiry, normalizeDealExpiry, parseExpiryDetails } from './expiry-utils.js';
import { isDealNewByDate } from './deal-freshness-utils.js';
import { validateDealsForSlack } from './deal-validity-agent.js';
import { canonicalSocialPostKey, mergeDealEvidence } from './deal-evidence-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const DEALS_JSON_PATH = path.join(DOCS_DIR, 'deals.json');
const PENDING_ALL_PATH = path.join(DOCS_DIR, 'deals-pending-all.json');
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
const APPROVE_SLACK_CHANNEL_ID = cleanText(process.env.APPROVE_SLACK_CHANNEL_ID || '');
const APPROVE_SLACK_MESSAGE_TS = cleanText(process.env.APPROVE_SLACK_MESSAGE_TS || '');
const APPROVE_SLACK_REACTION = cleanText(process.env.APPROVE_SLACK_REACTION || '');
const APPROVE_SLACK_REACTION_USER = cleanText(process.env.APPROVE_SLACK_REACTION_USER || '');
const MAX_APPROVAL_URL_EXPIRY_CHECKS = Number(process.env.MAX_APPROVAL_URL_EXPIRY_CHECKS || 50);
const APPROVE_FULL_SCAN_MAX_THREADS = Number(process.env.APPROVE_FULL_SCAN_MAX_THREADS || 8);
const APPROVE_FULL_SCAN_MAX_DEALS = Number(process.env.APPROVE_FULL_SCAN_MAX_DEALS || 250);
const PENDING_QUEUE_TTL_DAYS = Number(process.env.PENDING_QUEUE_TTL_DAYS || 14);
const LIVE_DEAL_REMOVALS_ENABLED = process.env.LIVE_DEAL_REMOVALS_ENABLED === '1';
const BLOCKED_APPROVAL_URL_PATTERNS = [
  /tiktok\.com\/@planetmatters\/video\/7634961057521437975/i,
  /tiktok\.com\/@viennas_joy\/video\/7635566976642911510/i,
];

function ensureObject(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeEditKey(value) {
  return cleanText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function parseFlexibleDateInput(value, mode = 'datetime') {
  const raw = cleanText(value);
  if (!raw) return '';

  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) {
    if (mode === 'expiry') {
      const d = new Date(direct);
      d.setHours(23, 59, 59, 999);
      return d.toISOString();
    }
    return direct.toISOString();
  }

  const dmY = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/);
  if (dmY) {
    const day = Number(dmY[1]);
    const month = Number(dmY[2]);
    const year = Number(dmY[3].length === 2 ? `20${dmY[3]}` : dmY[3]);
    const isoBase = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const iso = mode === 'expiry' ? `${isoBase}T23:59:59.999` : `${isoBase}T12:00:00.000`;
    const parsed = new Date(iso);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  return '';
}

function normalizeEditFieldName(value) {
  const key = normalizeEditKey(value);
  if (!key) return '';

  const fieldMap = new Map([
    [['titel', 'title', 'headline', 'ueberschrift'], 'title'],
    [['brand', 'marke', 'restaurant', 'restaurantname', 'anbieter'], 'brand'],
    [['ort', 'location', 'distance', 'adresse', 'bezirk'], 'distance'],
    [['beschreibung', 'description', 'desc', 'memo', 'text'], 'description'],
    [['link', 'url', 'direktlink', 'posturl', 'zielurl'], 'url'],
    [['kategorie', 'category'], 'category'],
    [['typ', 'type', 'dealtyp', 'angebotstyp'], 'type'],
    [['logo', 'emoji', 'icon'], 'logo'],
    [['datum', 'pubdate', 'postdate', 'angebotsdatum'], 'pubDate'],
    [['ablauf', 'expires', 'gueltigbis', 'gultigbis', 'validuntil', 'enddatum'], 'expires'],
    [['quelle', 'source'], 'source'],
  ]);

  for (const [keys, target] of fieldMap.entries()) {
    if (keys.includes(key)) return target;
  }
  return '';
}

function normalizeEditedFieldValue(field, value) {
  const raw = cleanText(value);
  if (!raw) return '';

  if (field === 'pubDate') {
    return parseFlexibleDateInput(raw, 'datetime') || raw;
  }

  if (field === 'expires') {
    return parseFlexibleDateInput(raw, 'expiry') || raw;
  }

  if (field === 'category' || field === 'type') {
    return raw.toLowerCase();
  }

  return raw;
}

function parseSlackEditCommand(messageText) {
  const text = cleanText(messageText);
  if (!text) return null;

  const match = text.match(/^edit(?:iere)?\s+([^\s|;]+)\s+([\s\S]+)$/i);
  if (!match) return null;

  const target = cleanText(match[1]);
  const body = cleanText(match[2]);
  if (!target || !body) return null;

  const changes = {};
  const segments = body.split(/\s*(?:\||;|\n)\s*/).filter(Boolean);
  for (const segment of segments) {
    const fieldMatch = segment.match(/^([^:]+):\s*(.+)$/) || segment.match(/^([^\s:]+)\s+(.+)$/);
    if (!fieldMatch) continue;
    const field = normalizeEditFieldName(fieldMatch[1]);
    const value = normalizeEditedFieldValue(field, fieldMatch[2]);
    if (!field || !value) continue;
    changes[field] = value;
  }

  if (Object.keys(changes).length === 0) return null;
  return { target, changes };
}

function findDealIndexByEditTarget(deals, target) {
  const normalizedTarget = cleanText(target);
  if (!normalizedTarget) return -1;

  const numericTarget = Number(normalizedTarget);
  if (Number.isInteger(numericTarget)) {
    const byOrder = deals.findIndex((deal, index) => Number(deal?.order || index + 1) === numericTarget);
    if (byOrder >= 0) return byOrder;
  }

  const lowered = normalizedTarget.toLowerCase();
  return deals.findIndex((deal) => {
    return lowered === cleanText(deal?.id).toLowerCase() ||
      lowered === cleanText(deal?.slackTs).toLowerCase() ||
      lowered === cleanText(deal?.submissionId).toLowerCase();
  });
}

function applyEditChangesToDeal(deal, changes, message) {
  const next = { ...deal };
  for (const [field, value] of Object.entries(changes)) {
    next[field] = value;
  }

  if (changes.pubDate) {
    next.sourcePublishedAt = changes.pubDate;
    next.sourcePublishedAtSource = 'slack.human-review';
    next.pubDateSource = 'slack.human-review';
  }
  if (changes.expires) {
    next.validUntil = changes.expires;
    next.expirySource = 'slack.human-review';
    next.expiresSource = 'slack.human-review';
    next.dateConfidence = 'high';
  }

  next.editedInSlack = true;
  next.slackEditedAt = new Date().toISOString();
  next.slackEditedFields = [...new Set([...(ensureArray(deal?.slackEditedFields)), ...Object.keys(changes)])];
  next.lastSlackEditTs = cleanText(message?.ts);
  return next;
}

function applySlackEdits(deals, threadMessages) {
  const editedDeals = deals.map((deal, index) => ({
    ...deal,
    order: Number(deal?.order || index + 1),
  }));
  const unresolvedTargets = [];
  let appliedCount = 0;

  for (const message of threadMessages) {
    const parsed = parseSlackEditCommand(extractSlackMessageText(message));
    if (!parsed) continue;

    const targetIndex = findDealIndexByEditTarget(editedDeals, parsed.target);
    if (targetIndex < 0) {
      unresolvedTargets.push(parsed.target);
      continue;
    }

    editedDeals[targetIndex] = applyEditChangesToDeal(editedDeals[targetIndex], parsed.changes, message);
    appliedCount += 1;
  }

  return {
    deals: editedDeals,
    appliedCount,
    unresolvedTargets: [...new Set(unresolvedTargets)],
  };
}

function normalizeUrl(url) {
  const text = cleanText(url);
  if (!text) return '';
  if (!/^https?:\/\//i.test(text)) return '';
  return text;
}

function slackTsNumber(value) {
  const num = Number.parseFloat(cleanText(value));
  return Number.isFinite(num) ? num : 0;
}

function pendingApprovalKey(deal) {
  const slackTs = cleanText(deal?.slackTs);
  if (slackTs) return `slack:${slackTs}`;
  const socialPostKey = canonicalSocialPostKey(deal?.url);
  if (socialPostKey) return socialPostKey;
  const id = cleanText(deal?.id);
  if (id) return `id:${id}`;
  const url = normalizeUrl(deal?.url).toLowerCase();
  const title = normalizeLooseText(deal?.title);
  if (url && title) return `url-title:${url}|${title}`;
  if (url) return `url:${url}`;
  return title ? `title:${title}` : '';
}

function uniqueDealsByApprovalKey(deals) {
  const byKey = new Map();
  for (const deal of deals) {
    const key = pendingApprovalKey(deal);
    if (!key) continue;
    const existing = byKey.get(key);
    byKey.set(key, existing ? mergeDealEvidence(existing, deal) : deal);
  }
  return [...byKey.values()];
}

function mergeRemainingPendingQueue(allQueuedDeals, checkedDeals, stillUnapprovedDeals) {
  const checkedKeys = new Set(checkedDeals.map(pendingApprovalKey).filter(Boolean));
  return uniqueDealsByApprovalKey([
    ...allQueuedDeals.filter((deal) => !checkedKeys.has(pendingApprovalKey(deal))),
    ...stillUnapprovedDeals,
  ]);
}

function isBlockedApprovalDeal(deal) {
  const url = normalizeUrl(deal?.url);
  return BLOCKED_APPROVAL_URL_PATTERNS.some((pattern) => pattern.test(url));
}

function normalizeLooseText(value) {
  return cleanText(String(value || ''))
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/discount/g, 'rabatt')
    .replace(/\bfree\b/g, 'gratis')
    .replace(/all you can eat/g, 'brunch')
    .replace(/2for1/g, '1+1')
    .replace(/buy one get one/g, '1+1')
    .replace(/[^a-z0-9%+ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeBrandSignature(value) {
  return normalizeLooseText(value)
    .replace(/\b(restaurant|osterreich|austria|wien|vienna|gmbh|cafe|café|food|store|stores|official)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getCanonicalUrlBrandKey(deal) {
  const variantKey = getSameUrlVariantKey(deal);
  if (variantKey) return variantKey;

  const brand = normalizeBrandSignature(deal?.brand);
  const url = normalizeUrl(deal?.url).toLowerCase();
  if (!brand || !url) return '';
  return `${brand}|${url}`;
}

function getSameUrlVariantKey(deal) {
  const id = cleanText(deal?.id).toLowerCase();
  const brand = normalizeBrandSignature(deal?.brand);
  const url = normalizeUrl(deal?.url).toLowerCase();
  const title = normalizeLooseText(deal?.title);
  if (!brand || !url || !title) return '';

  const sourceText = normalizeLooseText([deal?.source, deal?.originSource].filter(Boolean).join(' '));
  const isJoeOmvFreeTaste =
    id.startsWith('joe-omv-viva-free-taste-') ||
    (
      sourceText.includes('jo bonus club') &&
      brand.includes('omv viva') &&
      /gratis/.test(title) &&
      /(coconut|strawberry|sunny|orange|espresso|sparkling|tonic|iced|matcha|latte|sunset)/.test(title)
    );

  if (!isJoeOmvFreeTaste) return '';
  return `${brand}|${url}|${title}`;
}

function isSameUrlVariantDeal(deal) {
  return Boolean(getSameUrlVariantKey(deal));
}

function getApprovedMergeKeys(deal) {
  const keys = [
    getCanonicalSocialPostKey(deal),
    getCanonicalUrlBrandKey(deal),
    cleanText(deal?.id),
  ];

  if (!isSameUrlVariantDeal(deal)) {
    keys.push(normalizeUrl(deal?.url));
  }

  return keys.filter(Boolean);
}

function isSocialDeal(deal) {
  const url = normalizeUrl(deal?.url).toLowerCase();
  return url.includes('instagram.com/') || url.includes('tiktok.com/');
}

function getCanonicalSocialPostKey(deal) {
  if (!isSocialDeal(deal)) return '';
  return canonicalSocialPostKey(deal?.url) || normalizeUrl(deal?.url).toLowerCase();
}

function getSemanticOfferKey(deal) {
  if (!isSocialDeal(deal)) return '';

  const brand = normalizeBrandSignature(deal?.brand);
  const title = normalizeLooseText(deal?.title);
  if (!brand || !title) return '';

  const percentMatch = title.match(/(\d+)\s*%/);
  if (percentMatch && /rabatt/.test(title)) {
    return `${brand}|${percentMatch[1]}%|rabatt`;
  }
  if (/1\s*\+\s*1|bogo/.test(title) && /pizza/.test(title)) {
    return `${brand}|1+1|pizza`;
  }
  if (/brunch/.test(title)) {
    return `${brand}|brunch`;
  }
  if (/gratis/.test(title) && /kaffee/.test(title)) {
    return `${brand}|gratis|kaffee`;
  }
  if (/gratis/.test(title) && /drink|getr[aä]nk|cola|limonade/.test(title)) {
    return `${brand}|gratis|drink`;
  }
  if (/gratis/.test(title) && /falafel|wrap|sandwich|burger|speisen|essen|gerichte|men[uü]/.test(title)) {
    return `${brand}|gratis|food`;
  }

  return '';
}

function dealRecencyScore(deal) {
  const approvedAt = Date.parse(cleanText(deal?.approvedAt) || '');
  if (!Number.isNaN(approvedAt)) return approvedAt;
  const pubDate = Date.parse(cleanText(deal?.pubDate) || '');
  if (!Number.isNaN(pubDate)) return pubDate;
  return 0;
}

function pickBetterDeal(current, candidate) {
  const currentRecency = dealRecencyScore(current);
  const candidateRecency = dealRecencyScore(candidate);
  if (candidateRecency !== currentRecency) {
    return candidateRecency > currentRecency ? candidate : current;
  }

  const currentQuality = Number(current?.qualityScore) || 0;
  const candidateQuality = Number(candidate?.qualityScore) || 0;
  if (candidateQuality !== currentQuality) {
    return candidateQuality > currentQuality ? candidate : current;
  }

  const currentVotes = Number(current?.votes) || 0;
  const candidateVotes = Number(candidate?.votes) || 0;
  if (candidateVotes !== currentVotes) {
    return candidateVotes > currentVotes ? candidate : current;
  }

  const currentDescription = cleanText(current?.description).length;
  const candidateDescription = cleanText(candidate?.description).length;
  if (candidateDescription !== currentDescription) {
    return candidateDescription > currentDescription ? candidate : current;
  }

  return candidate;
}

function dedupeApprovedDeals(deals) {
  const byBrandUrl = new Map();
  const bySocialPost = new Map();
  const bySemanticKey = new Map();
  const deduped = [];

  for (const deal of deals) {
    let existingIndex = -1;

    const socialPostKey = getCanonicalSocialPostKey(deal);
    if (socialPostKey && bySocialPost.has(socialPostKey)) {
      existingIndex = bySocialPost.get(socialPostKey);
    }

    const brandUrlKey = existingIndex === -1 ? getCanonicalUrlBrandKey(deal) : '';
    if (brandUrlKey && byBrandUrl.has(brandUrlKey)) {
      existingIndex = byBrandUrl.get(brandUrlKey);
    }

    const semanticKey = existingIndex === -1 ? getSemanticOfferKey(deal) : '';
    if (semanticKey && bySemanticKey.has(semanticKey)) {
      existingIndex = bySemanticKey.get(semanticKey);
    }

    if (existingIndex >= 0) {
      const merged = pickBetterDeal(deduped[existingIndex], { ...deduped[existingIndex], ...deal });
      deduped[existingIndex] = merged;

      const mergedSocialPostKey = getCanonicalSocialPostKey(merged);
      if (mergedSocialPostKey) bySocialPost.set(mergedSocialPostKey, existingIndex);

      const mergedBrandUrlKey = getCanonicalUrlBrandKey(merged);
      if (mergedBrandUrlKey) byBrandUrl.set(mergedBrandUrlKey, existingIndex);

      const mergedSemanticKey = getSemanticOfferKey(merged);
      if (mergedSemanticKey) bySemanticKey.set(mergedSemanticKey, existingIndex);
      continue;
    }

    const index = deduped.length;
    deduped.push(deal);
    if (socialPostKey) bySocialPost.set(socialPostKey, index);
    if (brandUrlKey) byBrandUrl.set(brandUrlKey, index);
    const newSemanticKey = getSemanticOfferKey(deal);
    if (newSemanticKey) bySemanticKey.set(newSemanticKey, index);
  }

  return deduped;
}

function toIsoDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString();
}

function normalizeDeal(raw, options = {}) {
  const deal = ensureObject(raw);
  const brand = cleanText(deal.brand) || 'Wien Deals';
  const title = cleanText(deal.title) || `${brand} Deal`;
  const description = cleanText(deal.description);
  const url = normalizeUrl(deal.url);
  const type = cleanText(deal.type).toLowerCase() || 'rabatt';
  const structuredLocation = deal.location && typeof deal.location === 'object'
    ? (deal.location.address || deal.location.streetAddress || deal.location.name || deal.location.city)
    : deal.location;
  const distance = cleanText(deal.distance || structuredLocation || deal.ort || deal.address || deal.city);
  const category = normalizeCategoryForScraper(deal.category, [
    brand,
    title,
    description,
    distance,
    url,
    type,
    deal.source,
    deal.originSource,
  ]);
  const pubDate = toIsoDate(deal.sourcePublishedAt || deal.postPublishedAt || deal.pubDate);
  const approvedAt = toIsoDate(deal.approvedAt);
  const rawMissing = Array.isArray(deal.missingFields) ? deal.missingFields : [];
  const missingFields = [];
  if (!url) missingFields.push('Ziel-URL');
  if (!distance) missingFields.push('Ort');
  if (!cleanText(deal.expires || deal.end_date || deal.validity_date || '')) missingFields.push('Ablauf');
  if (!cleanText(deal.source)) missingFields.push('Quelle');
  for (const item of rawMissing) {
    const t = cleanText(item);
    if (t && !missingFields.includes(t)) missingFields.push(t);
  }

  const normalized = {
    ...deal,
    id: cleanText(deal.id) || `slack-${cleanText(deal.slackTs)}`,
    submissionId: cleanText(deal.submissionId).replace(/^community:/, ''),
    brand,
    title,
    description,
    url,
    category,
    type,
    logo: cleanText(deal.logo) || '🎯',
    distance,
    source: cleanText(deal.source) || 'Slack Approved',
    originSource: cleanText(deal.originSource) || cleanText(deal.source) || 'Slack Approved',
    expires: cleanText(deal.expires || deal.validUntil || deal.validOn),
    expiresOriginal: cleanText(deal.expiresOriginal || deal.expires || deal.validUntil || deal.validOn),
    expiresPrecision: cleanText(deal.expiresPrecision),
    expiresSource: cleanText(deal.expiresSource),
    expirySource: cleanText(deal.expirySource || deal.expiresSource),
    expiryKind: cleanText(deal.expiryKind),
    expiryDisplayText: cleanText(deal.expiryDisplayText),
    validOn: cleanText(deal.validOn),
    validFrom: cleanText(deal.validFrom),
    validUntil: cleanText(deal.validUntil),
    dateConfidence: cleanText(deal.dateConfidence),
    expiresDetectedFromUrl: Boolean(deal.expiresDetectedFromUrl),
    ownerUsername: cleanText(deal.ownerUsername || deal.owner?.username),
    instagramHandle: cleanText(deal.instagramHandle || deal.instagramUsername),
    city: cleanText(deal.city),
    postalCode: cleanText(deal.postalCode || deal.zip || deal.zipCode),
    address: cleanText(deal.address || deal.streetAddress || deal.venueAddress),
    location: cleanText(typeof deal.location === 'string' ? deal.location : deal.location?.name),
    viennaVerified: deal.viennaVerified === true,
    viennaEvidence: ensureObject(deal.viennaEvidence),
    evidence: ensureObject(deal.evidence),
    sourcePublishedAt: pubDate,
    sourcePublishedAtSource: cleanText(deal.sourcePublishedAtSource || deal.pubDateSource),
    pubDate,
    pubDateSource: cleanText(deal.pubDateSource || deal.sourcePublishedAtSource),
    discoveredAt: toIsoDate(deal.discoveredAt),
    qualityScore: Number(deal.qualityScore) || 0,
    votes: Number(deal.votes) || 1,
    priority: Number(deal.priority) || 3,
    hot: Boolean(deal.hot),
    isNew: false,
    slackTs: cleanText(deal.slackTs),
    slackThreadTs: cleanText(deal.slackThreadTs),
    slackPostFormatVersion: cleanText(deal.slackPostFormatVersion),
    approvedAt,
    missingFields,
  };
  normalized.isNew = isDealNewByDate(normalized);
  return normalized;
}

function normalizePendingDeal(raw) {
  return {
    ...normalizeDeal(raw),
    // Presence in deals-pending-all.json is authoritative: this record is
    // still waiting for approval, even if an older workflow polluted it.
    approvedAt: '',
  };
}

async function validateApprovalCandidates(deals, options = {}) {
  return validateDealsForSlack(ensureArray(deals), options);
}

function formatApprovalValidationReasons(validation) {
  return ensureArray(validation?.results)
    .filter((result) => !result?.decision?.allowed)
    .map((result) => {
      const label = cleanText(result?.deal?.title || result?.deal?.id || result?.deal?.url) || 'Deal';
      const reasons = ensureArray(result?.decision?.reasons).map(cleanText).filter(Boolean).join('; ');
      return `${label}: ${reasons || 'Gültigkeitsprüfung fehlgeschlagen'}`;
    });
}

async function normalizeApprovedDealExpiries(approvedDeals) {
  const now = new Date();
  const urlCache = new Map();
  let urlChecksUsed = 0;
  let urlExpiryHits = 0;

  for (const deal of approvedDeals) {
    const rawExpiry = cleanText(deal.expires);
    const parsedExpiry = parseExpiryDetails(rawExpiry, { now });
    const wantsUrlLookup = Boolean(
      deal.url &&
      (!rawExpiry || isVagueExpiry(rawExpiry) || !parsedExpiry || parsedExpiry.precision !== 'day')
    );
    const cached = deal.url ? urlCache.has(deal.url) : false;
    const allowUrlLookup = wantsUrlLookup && (cached || urlChecksUsed < MAX_APPROVAL_URL_EXPIRY_CHECKS);

    const beforeCacheSize = urlCache.size;
    await normalizeDealExpiry(deal, { now, urlCache, allowUrlLookup });
    if (allowUrlLookup && deal.url && !cached && urlCache.size > beforeCacheSize) {
      urlChecksUsed += 1;
    }
    if (deal.expiresDetectedFromUrl) {
      urlExpiryHits += 1;
    }
  }

  return { urlChecksUsed, urlExpiryHits };
}

function loadJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function pendingQueueTimestamp(deal) {
  const slackTs = Number.parseFloat(cleanText(deal?.slackTs));
  if (Number.isFinite(slackTs) && slackTs > 0) return slackTs * 1000;
  for (const value of [deal?.discoveredAt, deal?.sourcePublishedAt, deal?.pubDate]) {
    const timestamp = Date.parse(cleanText(value));
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return 0;
}

function prunePendingQueue(deals, now = Date.now()) {
  const ttlMs = Number.isFinite(PENDING_QUEUE_TTL_DAYS) && PENDING_QUEUE_TTL_DAYS > 0
    ? PENDING_QUEUE_TTL_DAYS * 24 * 60 * 60 * 1000
    : 0;
  let expiredCount = 0;
  let staleCount = 0;
  const kept = uniqueDealsByApprovalKey(deals).filter((deal) => {
    const expiryText = cleanText(deal?.validUntil || deal?.expires);
    const dateOnlyOrMidnight = expiryText.match(/^(\d{4}-\d{2}-\d{2})(?:T00:00:00(?:\.000)?Z)?$/)?.[1];
    const expiry = Date.parse(dateOnlyOrMidnight
      ? `${dateOnlyOrMidnight}T23:59:59.999Z`
      : expiryText);
    if (Number.isFinite(expiry) && expiry < now) {
      expiredCount += 1;
      return false;
    }
    const queuedAt = pendingQueueTimestamp(deal);
    if (ttlMs > 0 && queuedAt > 0 && now - queuedAt > ttlMs) {
      staleCount += 1;
      return false;
    }
    return true;
  });
  if (expiredCount || staleCount) {
    console.log(`🧹 pending queue cleanup: ${expiredCount} expired, ${staleCount} older than ${PENDING_QUEUE_TTL_DAYS} day(s)`);
  }
  return kept;
}

function loadPendingDeals() {
  const parsed = loadJson(PENDING_ALL_PATH, { deals: [] });
  return ensureArray(parsed.deals).map(normalizePendingDeal).filter((d) => d.slackTs);
}

function loadExistingApprovedDeals() {
  const parsed = loadJson(DEALS_JSON_PATH, { deals: [] });
  return ensureArray(parsed.deals).map(normalizeDeal);
}

function loadExistingApprovedDealsForMerge(moderation) {
  const existingDeals = loadExistingApprovedDeals();
  const moderated = filterModeratedDeals(existingDeals, moderation);
  if (moderated.removed.length > 0) {
    const status = LIVE_DEAL_REMOVALS_ENABLED ? 'entfernt' : 'pausiert';
    console.log(`🛡️ Moderation filter: ${moderated.removed.length} bestehende Live-Deals ${status}`);
  }
  return LIVE_DEAL_REMOVALS_ENABLED ? moderated.deals : existingDeals;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
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
    if (attempt >= 6) return { ok: false, error: 'ratelimited' };
    const retrySeconds = Number(retryAfterHeader || data.retry_after || 2);
    const waitMs = Math.max(1000, retrySeconds * 1000);
    console.log(`  ⏳ Rate limited, waiting ${waitMs}ms...`);
    await sleep(waitMs);
    return slackApi(url, attempt + 1);
  }

  return data;
}

async function getBotUserId() {
  const data = await slackApi('https://slack.com/api/auth.test');
  if (!data.ok) return '';
  return data.user_id || '';
}

async function findRecentDigestThreadTs() {
  const query = new URLSearchParams({
    channel: SLACK_CHANNEL_ID,
    limit: '50',
  });
  const data = await slackApi(`https://slack.com/api/conversations.history?${query.toString()}`);
  if (!data.ok) return [];

  const messages = ensureArray(data.messages);
  const today = new Date().toDateString();
  return messages.filter((msg) => {
    const text = cleanText(msg?.text);
    if (!text.includes('FreeFinder Wien')) return false;
    const msgDate = new Date(parseFloat(msg.ts || '0') * 1000).toDateString();
    return msgDate === today;
  }).map((msg) => cleanText(msg?.ts)).filter(Boolean);
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

    const url = `https://slack.com/api/conversations.replies?${query.toString()}`;
    const data = await slackApi(url);
    if (!data.ok) break;

    const pageMessages = ensureArray(data.messages);
    messages.push(...pageMessages);

    cursor = cleanText(data.response_metadata?.next_cursor);
    if (!cursor) break;
    await sleep(350);
  }

  return messages;
}

async function getReactions(messageTs, channelId = SLACK_CHANNEL_ID) {
  const url = `https://slack.com/api/reactions.get?channel=${encodeURIComponent(channelId)}&timestamp=${encodeURIComponent(messageTs)}`;
  const data = await slackApi(url);
  if (!data.ok) return [];
  return ensureArray(data.message?.reactions);
}

function hasHumanApproval(reactions, botUserId) {
  const checks = reactions.filter((r) => ['white_check_mark', 'heavy_check_mark', 'check'].includes(r.name));
  for (const reaction of checks) {
    const users = ensureArray(reaction.users);
    if (users.some((u) => u && u !== botUserId)) return true;
  }
  return false;
}

function getChurchReplacementScope(deal) {
  const category = cleanText(deal?.category).toLowerCase();
  const source = `${cleanText(deal?.source)} ${cleanText(deal?.originSource)}`.toLowerCase();
  const fromChurchSource = source.includes('freikirchen wien');

  if (category === 'gottesdienste') return 'church-services';
  if (category === 'events' && fromChurchSource) return 'church-events';
  if (['kirche', 'freikirche', 'gemeinde'].includes(category) || (fromChurchSource && category === '')) {
    return 'church-community';
  }

  if (fromChurchSource && category === 'events') return 'church-events';
  if (fromChurchSource) return 'church-community';
  return '';
}

function mergeApprovedDeals(existingDeals, newlyApproved) {
  const replacementScopes = new Set(
    newlyApproved
      .map(getChurchReplacementScope)
      .filter(Boolean)
  );

  const merged = existingDeals.filter((deal) => {
    const scope = getChurchReplacementScope(deal);
    return !scope || !replacementScopes.has(scope);
  });

  const indexByKey = new Map();
  for (let i = 0; i < merged.length; i += 1) {
    const keys = getApprovedMergeKeys(merged[i]);
    for (const key of keys) {
      indexByKey.set(key, i);
    }
  }

  for (const deal of newlyApproved) {
    const keys = getApprovedMergeKeys(deal);
    if (keys.length === 0) continue;
    const existingIndex = keys
      .map((key) => indexByKey.get(key))
      .find((value) => Number.isInteger(value));
    if (Number.isInteger(existingIndex)) {
      merged[existingIndex] = pickBetterDeal(merged[existingIndex], { ...merged[existingIndex], ...deal });
      const mergedDeal = merged[existingIndex];
      for (const key of getApprovedMergeKeys(mergedDeal)) {
        indexByKey.set(key, existingIndex);
      }
    } else {
      for (const key of keys) {
        indexByKey.set(key, merged.length);
      }
      merged.push(deal);
    }
  }

  return dedupeApprovedDeals(merged);
}

function saveDealsJson(deals) {
  const payload = {
    deals,
    totalDeals: deals.length,
    lastUpdated: new Date().toISOString(),
  };
  fs.writeFileSync(DEALS_JSON_PATH, JSON.stringify(payload, null, 2));
}

function savePendingRemaining(unapprovedDeals) {
  const cleanedDeals = prunePendingQueue(unapprovedDeals).map((deal) => {
    const { approvedAt: _approvedAt, ...pendingDeal } = deal;
    return pendingDeal;
  });
  const payload = {
    deals: cleanedDeals,
    totalDeals: cleanedDeals.length,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(PENDING_ALL_PATH, JSON.stringify(payload, null, 2));
}

async function runTargetedApproval({ moderation, botUserId }) {
  if (!APPROVE_SLACK_MESSAGE_TS) return false;

  const targetChannel = APPROVE_SLACK_CHANNEL_ID || SLACK_CHANNEL_ID;
  console.log(`🎯 Targeted Slack approval mode: ${APPROVE_SLACK_MESSAGE_TS}${APPROVE_SLACK_REACTION ? ` (${APPROVE_SLACK_REACTION})` : ''}`);
  if (targetChannel !== SLACK_CHANNEL_ID) {
    console.log(`ℹ️ Ignoring approval from unexpected channel ${targetChannel}`);
    return true;
  }

  const queuedModeration = filterModeratedDeals(loadPendingDeals(), moderation);
  if (queuedModeration.removed.length > 0) {
    console.log(`🛡️ Moderation filter: ${queuedModeration.removed.length} queued Deals entfernt`);
  }

  const queuedDeals = queuedModeration.deals;
  const targetDeal = queuedDeals.find((deal) => cleanText(deal.slackTs) === APPROVE_SLACK_MESSAGE_TS);
  if (!targetDeal) {
    console.log('ℹ️ Targeted Slack message is not in the pending queue anymore');
    return true;
  }

  let dealToApprove = targetDeal;
  const threadTs = cleanText(targetDeal.slackThreadTs);
  if (threadTs) {
    const threadMessages = await getThreadMessages(threadTs);
    const editResult = applySlackEdits([targetDeal], threadMessages);
    const editedTarget = editResult.deals.find((deal) => cleanText(deal.slackTs) === APPROVE_SLACK_MESSAGE_TS);
    if (editedTarget) dealToApprove = editedTarget;
    console.log(`✏️ Slack edits applied for targeted approval: ${editResult.appliedCount}`);
    if (editResult.unresolvedTargets.length > 0) {
      console.log(`⚠️ Unresolved edit targets: ${editResult.unresolvedTargets.join(', ')}`);
    }
  }

  const remainingPending = queuedDeals.filter((deal) => cleanText(deal.slackTs) !== APPROVE_SLACK_MESSAGE_TS);

  if (isBlockedApprovalDeal(dealToApprove)) {
    console.log(`🚫 blocked expired/invalid Slack deal: ${dealToApprove.title || dealToApprove.url}`);
    savePendingRemaining(remainingPending);
    return true;
  }

  const reactions = await getReactions(APPROVE_SLACK_MESSAGE_TS, targetChannel);
  const eventConfirmsHumanApproval = ['white_check_mark', 'heavy_check_mark', 'check'].includes(APPROVE_SLACK_REACTION) &&
    APPROVE_SLACK_REACTION_USER &&
    APPROVE_SLACK_REACTION_USER !== botUserId;
  if (!hasHumanApproval(reactions, botUserId) && !eventConfirmsHumanApproval) {
    console.log('ℹ️ Targeted Slack message has no human check reaction yet');
    return true;
  }

  const approvalValidation = await validateApprovalCandidates([dealToApprove]);
  if (approvalValidation.allowedDeals.length === 0) {
    const reasons = formatApprovalValidationReasons(approvalValidation);
    console.log(`🚫 Slack-Approval durch aktuelle Gültigkeitsprüfung blockiert: ${reasons.join(' | ')}`);
    savePendingRemaining(remainingPending);
    return true;
  }

  const approved = approvalValidation.allowedDeals.map((deal) => ({
    ...deal,
    approvedAt: new Date().toISOString(),
  }));
  const approvedModeration = filterModeratedDeals(approved, moderation);
  if (approvedModeration.removed.length > 0) {
    console.log(`🛡️ Moderation filter: ${approvedModeration.removed.length} approved Deals vor Live-Merge entfernt`);
  }

  const expiryNormalization = await normalizeApprovedDealExpiries(approvedModeration.deals);
  console.log(`🔎 approval expiry checks: ${expiryNormalization.urlChecksUsed}/${MAX_APPROVAL_URL_EXPIRY_CHECKS}, Treffer: ${expiryNormalization.urlExpiryHits}`);

  const existingApprovedDeals = loadExistingApprovedDealsForMerge(moderation);
  const mergedApproved = mergeApprovedDeals(existingApprovedDeals, approvedModeration.deals);
  saveDealsJson(mergedApproved);
  savePendingRemaining(remainingPending);

  console.log('✅ Newly approved in this targeted run: 1');
  console.log(`✅ deals.json updated with approved-only deals: ${mergedApproved.length}`);
  console.log(`💾 pending queue updated: ${remainingPending.length} deals left`);
  return true;
}

async function main() {
  console.log('🔍 SLACK APPROVE - strict approved-only mode');

  if (!SLACK_BOT_TOKEN || !SLACK_CHANNEL_ID) {
    console.log('❌ SLACK_BOT_TOKEN oder SLACK_CHANNEL_ID fehlt (ENV oder .env)');
    process.exit(1);
  }

  const moderation = loadDealModeration();
  const botUserId = await getBotUserId();
  console.log(`🤖 Bot User ID: ${botUserId || 'unknown'}`);

  if (await runTargetedApproval({ moderation, botUserId })) {
    return;
  }

  const queuedModeration = filterModeratedDeals(loadPendingDeals(), moderation);
  if (queuedModeration.removed.length > 0) {
    console.log(`🛡️ Moderation filter: ${queuedModeration.removed.length} queued Deals entfernt`);
  }
  const queuedDeals = queuedModeration.deals;
  const queueThreadTs = [...new Set(queuedDeals.map((deal) => cleanText(deal.slackThreadTs)).filter(Boolean))];
  const recentThreadTs = [...new Set(await findRecentDigestThreadTs())].filter(Boolean);
  let threadCandidates = [...new Set([...queueThreadTs, ...recentThreadTs])]
    .filter(Boolean)
    .sort((left, right) => slackTsNumber(right) - slackTsNumber(left));

  if (APPROVE_FULL_SCAN_MAX_THREADS > 0 && threadCandidates.length > APPROVE_FULL_SCAN_MAX_THREADS) {
    console.log(
      `🧭 limiting fallback scan to newest ${APPROVE_FULL_SCAN_MAX_THREADS}/${threadCandidates.length} thread(s); ` +
      'older pending deals stay queued for direct reaction events'
    );
    threadCandidates = threadCandidates.slice(0, APPROVE_FULL_SCAN_MAX_THREADS);
  }

  if (threadCandidates.length === 0) {
    console.log('ℹ️ Kein offener Digest- oder Community-Thread gefunden');
    return;
  }

  if (queueThreadTs.length > 0 && recentThreadTs.length > 0) {
    console.log(`🧭 using queued thread state + recent digest discovery: ${queueThreadTs.length} queued, ${recentThreadTs.length} recent, ${threadCandidates.length} total`);
  } else if (queueThreadTs.length > 0) {
    console.log(`🧭 using queued thread state only: ${queueThreadTs.length} thread(s)`);
  } else {
    console.log(`🧭 using recent digest discovery fallback: ${threadCandidates.length} thread(s)`);
  }

  const threadMessagesByThread = new Map();
  const messageByTs = new Map();
  const pendingDeals = [];
  let appliedEditCount = 0;
  const unresolvedEditTargets = [];

  for (const threadTs of threadCandidates) {
    const threadMessages = await getThreadMessages(threadTs);
    threadMessagesByThread.set(threadTs, threadMessages);
    console.log(`🧵 loaded digest thread ${threadTs}: ${threadMessages.length} messages`);

    for (const msg of threadMessages) {
      if (msg?.ts) messageByTs.set(String(msg.ts), msg);
    }

    const parsedDeals = extractDealsFromThreadMessages(threadMessages);
    const queueDealsForThread = queuedDeals.filter((deal) => cleanText(deal.slackThreadTs) === threadTs);
    const basePendingDeals = parsedDeals.length > 0 ? parsedDeals : queueDealsForThread;
    const editResult = applySlackEdits(basePendingDeals, threadMessages);
    pendingDeals.push(...editResult.deals);
    appliedEditCount += editResult.appliedCount;
    unresolvedEditTargets.push(...editResult.unresolvedTargets);
  }

  const dedupedPendingDeals = [];
  const seenPendingKeys = new Set();
  for (const deal of pendingDeals) {
    const key = cleanText(deal.slackTs) || cleanText(deal.id);
    if (!key || seenPendingKeys.has(key)) continue;
    seenPendingKeys.add(key);
    dedupedPendingDeals.push(deal);
  }

  const pendingModeration = filterModeratedDeals(dedupedPendingDeals, moderation);
  if (pendingModeration.removed.length > 0) {
    console.log(`🛡️ Moderation filter: ${pendingModeration.removed.length} pending Deals vor Approval entfernt`);
    const counts = moderationCounts(pendingModeration.removed);
    console.log(`🛡️ Moderation reasons: ${Object.entries(counts).map(([reason, count]) => `${count} ${reason}`).join(' | ')}`);
  }
  const moderatedPendingDeals = pendingModeration.deals;
  const approvalCheckDeals = moderatedPendingDeals
    .slice()
    .sort((left, right) => slackTsNumber(right.slackTs) - slackTsNumber(left.slackTs))
    .slice(0, APPROVE_FULL_SCAN_MAX_DEALS > 0 ? APPROVE_FULL_SCAN_MAX_DEALS : undefined);
  const deferredPendingDeals = moderatedPendingDeals.filter((deal) => {
    const key = pendingApprovalKey(deal);
    return key && !approvalCheckDeals.some((candidate) => pendingApprovalKey(candidate) === key);
  });

  console.log(`📋 Pending posted deals across ${threadCandidates.length} thread(s): ${moderatedPendingDeals.length}`);
  if (approvalCheckDeals.length < moderatedPendingDeals.length) {
    console.log(`🧭 checking newest ${approvalCheckDeals.length}/${moderatedPendingDeals.length} pending deals in fallback mode`);
  }
  console.log(`✏️ Slack edits applied: ${appliedEditCount}`);
  if (unresolvedEditTargets.length > 0) {
    console.log(`⚠️ Unresolved edit targets: ${[...new Set(unresolvedEditTargets)].join(', ')}`);
  }

  if (approvalCheckDeals.length === 0) {
    const sampleThread = threadMessagesByThread.get(threadCandidates[0]) || [];
    const sample = sampleThread.find((msg) => cleanText(msg?.ts) !== threadCandidates[0]);
    if (sample) {
      console.log('🧪 sample digest message text:', JSON.stringify(extractSlackMessageText(sample).slice(0, 1000)));
      console.log('🧪 sample digest message keys:', Object.keys(sample).slice(0, 20).join(','));
      console.log('🧪 sample digest has blocks:', Array.isArray(sample.blocks), 'blockCount:', Array.isArray(sample.blocks) ? sample.blocks.length : 0);
    }
    console.log('✅ Keine offenen Slack-Deals zum Prüfen');
    savePendingRemaining(uniqueDealsByApprovalKey([...queuedDeals, ...deferredPendingDeals]));
    return;
  }

  const approved = [];
  const unapproved = [];

  for (let i = 0; i < approvalCheckDeals.length; i += 1) {
    const deal = approvalCheckDeals[i];
    if (isBlockedApprovalDeal(deal)) {
      console.log(`  🚫 blocked expired/invalid Slack deal: ${deal.title || deal.url}`);
      continue;
    }

    const msg = messageByTs.get(deal.slackTs);
    let reactions = msg && Array.isArray(msg.reactions) ? msg.reactions : [];
    if (reactions.length === 0 && deal.slackTs) {
      reactions = await getReactions(deal.slackTs);
    }
    const ok = hasHumanApproval(reactions, botUserId);

    if (ok) {
      approved.push({ ...deal, approvedAt: new Date().toISOString() });
    } else {
      unapproved.push(deal);
    }

    if ((i + 1) % 25 === 0) {
      console.log(`  ✅ checked ${i + 1}/${approvalCheckDeals.length}`);
    }

    await sleep(200);
  }

  console.log(`✅ Newly approved in this run: ${approved.length}`);
  console.log(`🕓 Still waiting approval: ${unapproved.length}`);

  if (approved.length === 0) {
    savePendingRemaining(mergeRemainingPendingQueue([...queuedDeals, ...deferredPendingDeals], approvalCheckDeals, unapproved));
    console.log('ℹ️ Keine neuen approvals gefunden, deals.json bleibt unverändert');
    return;
  }

  const approvalValidation = await validateApprovalCandidates(approved);
  const validationBlockedReasons = formatApprovalValidationReasons(approvalValidation);
  if (validationBlockedReasons.length > 0) {
    console.log(`🚫 Approval validity filter: ${validationBlockedReasons.length} Deal(s) blockiert`);
    for (const reason of validationBlockedReasons.slice(0, 10)) console.log(`  - ${reason}`);
  }

  if (approvalValidation.allowedDeals.length === 0) {
    const remainingPending = mergeRemainingPendingQueue(
      [...queuedDeals, ...deferredPendingDeals],
      approvalCheckDeals,
      unapproved,
    );
    savePendingRemaining(remainingPending);
    console.log('ℹ️ Keine aktuell gültigen Approvals zum Veröffentlichen');
    return;
  }

  const approvedModeration = filterModeratedDeals(approvalValidation.allowedDeals, moderation);
  if (approvedModeration.removed.length > 0) {
    console.log(`🛡️ Moderation filter: ${approvedModeration.removed.length} approved Deals vor Live-Merge entfernt`);
  }

  const expiryNormalization = await normalizeApprovedDealExpiries(approvedModeration.deals);
  console.log(`🔎 approval expiry checks: ${expiryNormalization.urlChecksUsed}/${MAX_APPROVAL_URL_EXPIRY_CHECKS}, Treffer: ${expiryNormalization.urlExpiryHits}`);

  const existingApprovedDeals = loadExistingApprovedDealsForMerge(moderation);
  const mergedApproved = mergeApprovedDeals(existingApprovedDeals, approvedModeration.deals);

  saveDealsJson(mergedApproved);
  const remainingPending = mergeRemainingPendingQueue([...queuedDeals, ...deferredPendingDeals], approvalCheckDeals, unapproved);
  savePendingRemaining(remainingPending);

  console.log(`✅ deals.json updated with approved-only deals: ${mergedApproved.length}`);
  console.log(`💾 pending queue updated: ${remainingPending.length} deals left`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error('❌ slack-approve failed:', error.message);
    process.exit(1);
  });
}

export {
  applySlackEdits,
  normalizeDeal,
  normalizePendingDeal,
  pendingApprovalKey,
  prunePendingQueue,
  uniqueDealsByApprovalKey,
  validateApprovalCandidates,
};

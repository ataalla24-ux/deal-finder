import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  DEFAULT_REPORT_PATH,
  validateDealsForSlack,
  writeDealValidityReport,
} from './deal-validity-agent.js';
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
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
const PENDING_FILE_NAMES = process.env.PENDING_FILE_NAMES || '';
const SEEN_DEAL_SUPPRESSION_DAYS = Number(process.env.SLACK_SEEN_DEAL_SUPPRESSION_DAYS || 7);
const MAX_SEEN_REACTION_CHECKS = Number(process.env.SLACK_SEEN_MAX_REACTION_CHECKS || 250);
const EXCLUDED_PENDING_FILES = new Set([
  'deals-pending-all.json',
  'deals-pending-firecrawl.json',
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
  return canonicalSocialPostKey(url) || canonicalDealUrl(url);
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
    ? (deal.location.name || deal.location.address || deal.location.city)
    : deal.location;
  const distance = cleanText(deal.distance || structuredLocation || deal.ort || deal.address);
  return distance;
}

function inferExpires(deal) {
  const raw = cleanText(deal.expires || deal.validUntil || deal.validOn || deal.end_date || deal.validity_date || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const iso = toIsoDate(raw);
  return iso || raw;
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
  const brand = inferBrand(deal, sourceKey);
  const title = inferTitle(deal, brand);
  const rawUrl = normalizeUrl(deal.url || deal.post_url || deal.postUrl);
  const rawDistance = inferDistance(deal);
  const rawExpires = cleanText(deal.expires || deal.validUntil || deal.validOn || deal.end_date || deal.validity_date || '');
  const rawSource = cleanText(deal.source);
  const originSource = cleanText(deal.originSource) || rawSource || sourceKey;
  const url = rawUrl;
  const publication = getPublicationEvidence(deal);
  const legacyFirecrawl = /\bfirecrawl\b/i.test([rawSource, originSource, sourceKey].join(' '));
  const legacyPubDate = toIsoDate(deal.pubDate);
  const pubDate = legacyFirecrawl ? legacyPubDate : publication.sourcePublishedAt;
  const pubDateSource = legacyFirecrawl ? cleanText(deal.pubDateSource) : publication.sourcePublishedAtSource;
  const idSeed = `${sourceKey}|${deal.id || ''}|${url}|${title}`;
  const id = cleanText(deal.id) || `${sourceKey}-${stableId(idSeed)}`;
  const type = inferType(deal);
  const viennaEvidence = getViennaEvidence(deal);
  const missingFields = [];
  if (!rawUrl) missingFields.push('Ziel-URL');
  if (!rawDistance) missingFields.push('Ort');
  if (!rawExpires) missingFields.push('Ablauf');
  if (!rawSource) missingFields.push('Quelle');

  return {
    id,
    brand,
    title,
    description: cleanText(deal.description),
    url,
    category: inferCategory(deal),
    type,
    logo: inferLogo(deal, type),
    distance: inferDistance(deal),
    address: cleanText(deal.address),
    location: cleanText(deal.location && typeof deal.location === 'object' ? (deal.location.name || deal.location.address || deal.location.city) : deal.location),
    ort: cleanText(deal.ort),
    pubDate,
    pubDateSource,
    sourcePublishedAt: publication.sourcePublishedAt,
    sourcePublishedAtSource: publication.sourcePublishedAtSource,
    discoveredAt: publication.discoveredAt,
    expires: inferExpires(deal),
    source: cleanText(deal.source) || sourceKey,
    originSource,
    qualityScore: Number(deal.qualityScore) || 0,
    hot: Boolean(deal.hot),
    isNew: true,
    votes: Number(deal.votes) || 1,
    priority: Number(deal.priority) || 3,
    ownerUsername: extractStructuredOwnerUsername(deal),
    postalCode: cleanText(deal.postalCode || deal.zip || deal.zipCode),
    city: cleanText(deal.city || deal.location?.city),
    latitude: deal.latitude ?? deal.lat ?? deal.location?.latitude,
    longitude: deal.longitude ?? deal.lng ?? deal.lon ?? deal.location?.longitude,
    viennaVerified: viennaEvidence.hasViennaEvidence,
    viennaEvidence: viennaEvidence.hasViennaEvidence
      ? {
          verified: true,
          type: viennaEvidence.type,
          source: viennaEvidence.type,
          value: viennaEvidence.value,
          detail: viennaEvidence.value,
        }
      : undefined,
    validOn: cleanText(deal.validOn),
    validFrom: cleanText(deal.validFrom),
    validUntil: cleanText(deal.validUntil),
    expiresOriginal: cleanText(deal.expiresOriginal),
    expiresSource: cleanText(deal.expiresSource),
    expirySource: cleanText(deal.expirySource || deal.expiresSource),
    expiryKind: cleanText(deal.expiryKind),
    dateConfidence: cleanText(deal.dateConfidence),
    slackTs: cleanText(deal.slackTs),
    slackThreadTs: cleanText(deal.slackThreadTs),
    slackPostFormatVersion: cleanText(deal.slackPostFormatVersion),
    missingFields,
  };
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

function loadPendingDeals(files) {
  const deals = [];
  console.log(`📂 Found ${files.length} pending deal files`);

  for (const file of files) {
    const sourceKey = file.replace(/^deals-pending-/, '').replace(/\.json$/, '');
    const filePath = path.join(DOCS_DIR, file);
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const items = ensureArray(parsed.deals || parsed);
      const normalized = items.map((d) => normalizeDeal(d, sourceKey));
      console.log(`  - ${file}: ${normalized.length} deals`);
      deals.push(...normalized);
    } catch (error) {
      console.log(`  ⚠️ Error reading ${file}: ${error.message}`);
    }
  }

  return deals;
}

function loadPendingQueue() {
  if (!fs.existsSync(PENDING_ALL_PATH)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(PENDING_ALL_PATH, 'utf-8'));
    const deals = ensureArray(parsed.deals);
    return deals.map((d) => normalizeDeal(d, cleanText(d.source) || 'queue'));
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
    `📅 Angebotsdatum: ${formatDate(deal.pubDate)}`,
    `⏳ Gültig bis: ${deal.expires ? formatDate(deal.expires) : 'k.A.'}`,
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
  const result = mergeDuplicateDealRecords(deals);
  return { deals: result.deals, removed: result.duplicateCount };
}

function parseDealDate(value) {
  const text = cleanText(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function socialDealAgeDays(deal) {
  // Discovery/crawl time is not evidence of when a social post was published.
  const date = parseDealDate(getPublicationEvidence(deal).sourcePublishedAt);
  if (!date) return null;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000)));
}

function pruneStaleSocialQueueDeals(deals) {
  const filtered = [];
  let removed = 0;

  for (const deal of deals) {
    const postKey = canonicalPostKey(deal.url);
    const socialSignal = normalizeLooseText([deal.url, deal.source, deal.originSource, deal.id].map(cleanText).join(' '));
    const isSocialQueueDeal = isSocialPostKey(postKey) || /\b(instagram|tiktok)\b/i.test(socialSignal);
    if (!isSocialQueueDeal) {
      filtered.push(deal);
      continue;
    }

    const age = socialDealAgeDays(deal);
    // Unknown publication time blocks a new automatic validation, but an
    // already-posted Slack item must remain addressable for a later human ✅.
    if (age !== null && age >= SEEN_DEAL_SUPPRESSION_DAYS) {
      removed += 1;
      continue;
    }

    filtered.push(deal);
  }

  return { deals: filtered, removed };
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
  const loadedPendingDeals = loadPendingDeals(pendingFiles);
  const moderationPendingFilter = filterModeratedDeals(loadedPendingDeals, moderation);
  if (moderationPendingFilter.removed.length > 0) {
    console.log(`🛡️ Moderation filter: ${moderationPendingFilter.removed.length} pending Deals vor Slack entfernt`);
    const counts = formatReasonCategoryCounts(moderationCounts(moderationPendingFilter.removed));
    if (counts) console.log(`🛡️ Moderation reasons: ${counts}`);
  }
  const pendingDeals = moderationPendingFilter.deals;
  console.log(`📋 Total pending deals loaded: ${pendingDeals.length}`);
  const queuePrune = pruneStaleSocialQueueDeals(loadPendingQueue());
  if (queuePrune.removed > 0) {
    console.log(`🧹 Queue prune: ${queuePrune.removed} alte Social-Posts aus der Slack-Queue entfernt`);
  }
  const moderationQueueFilter = filterModeratedDeals(queuePrune.deals, moderation);
  if (moderationQueueFilter.removed.length > 0) {
    console.log(`🛡️ Queue moderation: ${moderationQueueFilter.removed.length} Deals aus der Slack-Queue entfernt`);
  }
  const existingQueue = moderationQueueFilter.deals;
  const queueChanged = queuePrune.removed > 0 || moderationQueueFilter.removed.length > 0;

  const seenPostKeys = await loadRecentlySeenPostKeys();
  const preSlackSeenFilter = filterRecentlySeenDeals(pendingDeals, seenPostKeys);
  if (preSlackSeenFilter.removed > 0) {
    console.log(`👀 Seen filter: ${preSlackSeenFilter.removed} bereits gesehene exakte Posts vor Slack entfernt`);
  }

  const inRunDuplicateFilter = filterDuplicateDealsInRun(preSlackSeenFilter.deals);
  if (inRunDuplicateFilter.removed > 0) {
    console.log(`🔁 Run filter: ${inRunDuplicateFilter.removed} doppelte Deals innerhalb dieses Laufs entfernt`);
  }

  const queuedDealKeys = loadQueuedDealDuplicateKeys(existingQueue);
  const preSlackQueueFilter = filterAlreadyQueuedDeals(inRunDuplicateFilter.deals, queuedDealKeys);
  if (preSlackQueueFilter.removed > 0) {
    console.log(`🔁 Queue filter: ${preSlackQueueFilter.removed} bereits gepostete Deals vor Slack entfernt`);
  }

  const validation = await validateDealsForSlack(preSlackQueueFilter.deals);
  writeDealValidityReport(validation.report);
  const freshDeals = validation.allowedDeals;
  const blockedSummary = formatReasonCategoryCounts(validation.summary.reasonCategoryCounts);

  console.log(
    `🧪 Deal validity agent: ${validation.summary.allowed}/${validation.summary.total} allowed, ` +
    `${validation.summary.blocked} blocked, ${validation.summary.warnings} warnings`
  );
  if (blockedSummary) {
    console.log(`🚫 Blocked reasons: ${blockedSummary}`);
  }
  console.log(`💾 saved: ${path.relative(ROOT, DEFAULT_REPORT_PATH)}`);
  console.log(`📨 Pending: ${pendingDeals.length}, posting to Slack: ${freshDeals.length}`);

  if (freshDeals.length === 0) {
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

  const freeCount = freshDeals.filter((d) => d.type === 'gratis').length;
  const headerTs = await postSlackMessage(
    `🎯 *FreeFinder Wien* — ${freshDeals.length} neue Deals\n` +
    `🆓 ${freeCount} gratis | 💰 ${freshDeals.length - freeCount} rabatt/test\n` +
    `🧪 Gültigkeitscheck: ${validation.summary.allowed}/${validation.summary.total} freigegeben | ${validation.summary.blocked} blockiert (max. ${validation.summary.maxAgeDays} Tage)\n` +
    (blockedSummary ? `🚫 Blockiert: ${blockedSummary}\n` : '') +
    `_Jeden Deal mit ✅ bestätigen, dann erscheint er in der iOS-App._\n` +
    `_Bearbeiten vor Freigabe: z. B. edit 3 titel: Gratis Matcha | ort: Neubaugasse 12, 1070 Wien | ablauf: 20.04.2026_`
  );

  if (!headerTs) {
    console.log('❌ Konnte Header-Nachricht nicht senden');
    process.exit(1);
  }

  const postedDeals = [];
  for (let i = 0; i < freshDeals.length; i += 1) {
    const deal = freshDeals[i];
    const text = buildSlackMessage(deal, i + 1);
    const ts = await postSlackMessage(text, headerTs);
    if (!ts) continue;

    deal.slackTs = ts;
    deal.slackThreadTs = headerTs;
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

  const mergedQueue = mergePendingQueue(existingQueue, postedDeals);
  writePendingAll(mergedQueue);

  console.log(`✅ ${postedDeals.length} Deals an Slack gesendet`);
  console.log(`🗂️ pending queue size: ${mergedQueue.length}`);
  console.log(`💾 saved: ${path.relative(ROOT, PENDING_ALL_PATH)}`);
  if (postedDeals.length !== freshDeals.length) {
    throw new Error(`${freshDeals.length - postedDeals.length} Deal(s) konnten nicht an Slack gesendet werden`);
  }
}

export { normalizeDeal };

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error('❌ slack-notify failed:', error.message);
    process.exit(1);
  });
}

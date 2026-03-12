import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { cleanText, extractDealsFromThreadMessages, extractSlackMessageText } from './slack-digest-utils.js';
import { isVagueExpiry, normalizeDealExpiry, parseExpiryDetails } from './expiry-utils.js';

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
const MAX_APPROVAL_URL_EXPIRY_CHECKS = Number(process.env.MAX_APPROVAL_URL_EXPIRY_CHECKS || 50);

function ensureObject(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeUrl(url) {
  const text = cleanText(url);
  if (!text) return '';
  if (!/^https?:\/\//i.test(text)) return '';
  return text;
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
  const brand = normalizeBrandSignature(deal?.brand);
  const url = normalizeUrl(deal?.url).toLowerCase();
  if (!brand || !url) return '';
  return `${brand}|${url}`;
}

function isSocialDeal(deal) {
  const url = normalizeUrl(deal?.url).toLowerCase();
  return url.includes('instagram.com/') || url.includes('tiktok.com/');
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
  const bySemanticKey = new Map();
  const deduped = [];

  for (const deal of deals) {
    let existingIndex = -1;

    const brandUrlKey = getCanonicalUrlBrandKey(deal);
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

      const mergedBrandUrlKey = getCanonicalUrlBrandKey(merged);
      if (mergedBrandUrlKey) byBrandUrl.set(mergedBrandUrlKey, existingIndex);

      const mergedSemanticKey = getSemanticOfferKey(merged);
      if (mergedSemanticKey) bySemanticKey.set(mergedSemanticKey, existingIndex);
      continue;
    }

    const index = deduped.length;
    deduped.push(deal);
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

function normalizeDeal(raw) {
  const deal = ensureObject(raw);
  const brand = cleanText(deal.brand) || 'Wien Deals';
  const title = cleanText(deal.title) || `${brand} Deal`;
  const description = cleanText(deal.description);
  const url = normalizeUrl(deal.url);
  const pubDate = toIsoDate(deal.pubDate) || new Date().toISOString();
  const approvedAt = toIsoDate(deal.approvedAt) || new Date().toISOString();
  const rawMissing = Array.isArray(deal.missingFields) ? deal.missingFields : [];
  const missingFields = [];
  if (!url) missingFields.push('Ziel-URL');
  if (!cleanText(deal.distance || deal.location || deal.ort)) missingFields.push('Ort');
  if (!cleanText(deal.expires || deal.end_date || deal.validity_date || '')) missingFields.push('Ablauf');
  if (!cleanText(deal.source)) missingFields.push('Quelle');
  for (const item of rawMissing) {
    const t = cleanText(item);
    if (t && !missingFields.includes(t)) missingFields.push(t);
  }

  return {
    id: cleanText(deal.id) || `slack-${cleanText(deal.slackTs)}`,
    brand,
    title,
    description,
    url,
    category: cleanText(deal.category).toLowerCase() || 'wien',
    type: cleanText(deal.type).toLowerCase() || 'rabatt',
    logo: cleanText(deal.logo) || '🎯',
    distance: cleanText(deal.distance || deal.location || deal.ort) || 'Wien',
    source: cleanText(deal.source) || 'Slack Approved',
    originSource: cleanText(deal.originSource) || cleanText(deal.source) || 'Slack Approved',
    expires: cleanText(deal.expires),
    expiresOriginal: cleanText(deal.expiresOriginal || deal.expires),
    expiresPrecision: cleanText(deal.expiresPrecision),
    expiresSource: cleanText(deal.expiresSource),
    expiresDetectedFromUrl: Boolean(deal.expiresDetectedFromUrl),
    pubDate,
    qualityScore: Number(deal.qualityScore) || 0,
    votes: Number(deal.votes) || 1,
    priority: Number(deal.priority) || 3,
    hot: Boolean(deal.hot),
    isNew: Boolean(deal.isNew),
    slackTs: cleanText(deal.slackTs),
    slackThreadTs: cleanText(deal.slackThreadTs),
    approvedAt,
    missingFields,
  };
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

function loadPendingDeals() {
  const parsed = loadJson(PENDING_ALL_PATH, { deals: [] });
  return ensureArray(parsed.deals).map(normalizeDeal).filter((d) => d.slackTs);
}

function loadExistingApprovedDeals() {
  const parsed = loadJson(DEALS_JSON_PATH, { deals: [] });
  return ensureArray(parsed.deals).map(normalizeDeal);
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

async function findLatestDigestThreadTs() {
  const query = new URLSearchParams({
    channel: SLACK_CHANNEL_ID,
    limit: '20',
  });
  const data = await slackApi(`https://slack.com/api/conversations.history?${query.toString()}`);
  if (!data.ok) return '';

  const messages = ensureArray(data.messages);
  const today = new Date().toDateString();
  const match = messages.find((msg) => {
    const text = cleanText(msg?.text);
    if (!text.includes('FreeFinder Wien')) return false;
    const msgDate = new Date(parseFloat(msg.ts || '0') * 1000).toDateString();
    return msgDate === today;
  });
  return cleanText(match?.ts);
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

async function getReactions(messageTs) {
  const url = `https://slack.com/api/reactions.get?channel=${SLACK_CHANNEL_ID}&timestamp=${encodeURIComponent(messageTs)}`;
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
    const key = getCanonicalUrlBrandKey(merged[i]) || merged[i].id || merged[i].url;
    if (!key) continue;
    indexByKey.set(key, i);
  }

  for (const deal of newlyApproved) {
    const key = getCanonicalUrlBrandKey(deal) || deal.id || deal.url;
    if (!key) continue;
    const existingIndex = indexByKey.get(key);
    if (Number.isInteger(existingIndex)) {
      merged[existingIndex] = pickBetterDeal(merged[existingIndex], { ...merged[existingIndex], ...deal });
    } else {
      indexByKey.set(key, merged.length);
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
  const payload = {
    deals: unapprovedDeals,
    totalDeals: unapprovedDeals.length,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(PENDING_ALL_PATH, JSON.stringify(payload, null, 2));
}

async function main() {
  console.log('🔍 SLACK APPROVE - strict approved-only mode');

  if (!SLACK_BOT_TOKEN || !SLACK_CHANNEL_ID) {
    console.log('❌ SLACK_BOT_TOKEN oder SLACK_CHANNEL_ID fehlt (ENV oder .env)');
    process.exit(1);
  }

  const botUserId = await getBotUserId();
  console.log(`🤖 Bot User ID: ${botUserId || 'unknown'}`);
  const latestThreadTs = await findLatestDigestThreadTs();
  if (!latestThreadTs) {
    console.log('ℹ️ Kein heutiger Digest-Thread gefunden');
    return;
  }

  const threadMessages = await getThreadMessages(latestThreadTs);
  console.log(`🧵 loaded latest digest ${latestThreadTs}: ${threadMessages.length} messages`);

  const parsedDeals = extractDealsFromThreadMessages(threadMessages);
  const pendingDeals = parsedDeals.length > 0 ? parsedDeals : loadPendingDeals().filter((d) => d.slackThreadTs === latestThreadTs);
  console.log(`📋 Pending posted deals for latest digest: ${pendingDeals.length}`);

  if (pendingDeals.length === 0) {
    const sample = threadMessages.find((msg) => cleanText(msg?.ts) !== latestThreadTs);
    if (sample) {
      console.log('🧪 sample digest message text:', JSON.stringify(extractSlackMessageText(sample).slice(0, 1000)));
      console.log('🧪 sample digest message keys:', Object.keys(sample).slice(0, 20).join(','));
      console.log('🧪 sample digest has blocks:', Array.isArray(sample.blocks), 'blockCount:', Array.isArray(sample.blocks) ? sample.blocks.length : 0);
    }
    console.log('✅ Keine offenen Slack-Deals zum Prüfen');
    savePendingRemaining([]);
    return;
  }

  const messageByTs = new Map();
  for (const msg of threadMessages) {
    if (msg?.ts) messageByTs.set(String(msg.ts), msg);
  }

  const approved = [];
  const unapproved = [];

  for (let i = 0; i < pendingDeals.length; i += 1) {
    const deal = pendingDeals[i];
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
      console.log(`  ✅ checked ${i + 1}/${pendingDeals.length}`);
    }

    await sleep(200);
  }

  console.log(`✅ Newly approved in this run: ${approved.length}`);
  console.log(`🕓 Still waiting approval: ${unapproved.length}`);

  if (approved.length === 0) {
    savePendingRemaining(unapproved);
    console.log('ℹ️ Keine neuen approvals gefunden, deals.json bleibt unverändert');
    return;
  }

  const expiryNormalization = await normalizeApprovedDealExpiries(approved);
  console.log(`🔎 approval expiry checks: ${expiryNormalization.urlChecksUsed}/${MAX_APPROVAL_URL_EXPIRY_CHECKS}, Treffer: ${expiryNormalization.urlExpiryHits}`);

  const existingApproved = loadExistingApprovedDeals();
  const mergedApproved = mergeApprovedDeals(existingApproved, approved);

  saveDealsJson(mergedApproved);
  savePendingRemaining(unapproved);

  console.log(`✅ deals.json updated with approved-only deals: ${mergedApproved.length}`);
  console.log(`💾 pending queue updated: ${unapproved.length} deals left`);
}

main().catch((error) => {
  console.error('❌ slack-approve failed:', error.message);
  process.exit(1);
});

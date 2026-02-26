import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

function normalizeUrl(url) {
  const text = cleanText(url);
  if (!text) return '';
  if (!/^https?:\/\//i.test(text)) return '';
  return text;
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
  const url = normalizeUrl(deal.url) || 'https://www.wien.gv.at';
  const pubDate = toIsoDate(deal.pubDate) || new Date().toISOString();

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
    expires: cleanText(deal.expires),
    pubDate,
    qualityScore: Number(deal.qualityScore) || 0,
    votes: Number(deal.votes) || 1,
    priority: Number(deal.priority) || 3,
    hot: Boolean(deal.hot),
    isNew: Boolean(deal.isNew),
    slackTs: cleanText(deal.slackTs),
    slackThreadTs: cleanText(deal.slackThreadTs),
    approvedAt: new Date().toISOString(),
  };
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

function mergeApprovedDeals(existingDeals, newlyApproved) {
  const byId = new Map();

  for (const deal of existingDeals) {
    const key = deal.id || deal.url;
    if (!key) continue;
    byId.set(key, deal);
  }

  for (const deal of newlyApproved) {
    const key = deal.id || deal.url;
    if (!key) continue;
    byId.set(key, deal);
  }

  const merged = [...byId.values()];
  merged.sort((a, b) => {
    if ((b.qualityScore || 0) !== (a.qualityScore || 0)) {
      return (b.qualityScore || 0) - (a.qualityScore || 0);
    }
    return new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime();
  });
  return merged;
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

  const pendingDeals = loadPendingDeals();
  console.log(`📋 Pending posted deals with slackTs: ${pendingDeals.length}`);

  if (pendingDeals.length === 0) {
    console.log('✅ Keine offenen Slack-Deals zum Prüfen');
    return;
  }

  const botUserId = await getBotUserId();
  console.log(`🤖 Bot User ID: ${botUserId || 'unknown'}`);

  const messageByTs = new Map();
  const threadTsSet = new Set(pendingDeals.map((d) => d.slackThreadTs).filter(Boolean));

  for (const threadTs of threadTsSet) {
    const threadMessages = await getThreadMessages(threadTs);
    for (const msg of threadMessages) {
      if (msg?.ts) messageByTs.set(String(msg.ts), msg);
    }
    console.log(`🧵 loaded thread ${threadTs}: ${threadMessages.length} messages`);
    await sleep(350);
  }

  const approved = [];
  const unapproved = [];

  for (let i = 0; i < pendingDeals.length; i += 1) {
    const deal = pendingDeals[i];
    const msg = messageByTs.get(deal.slackTs);
    const reactions = msg && Array.isArray(msg.reactions) ? msg.reactions : [];
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

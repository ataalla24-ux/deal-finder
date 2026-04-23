import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  DEFAULT_REPORT_PATH,
  validateDealsForSlack,
  writeDealValidityReport,
} from './deal-validity-agent.js';

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
  const distance = cleanText(deal.distance || deal.location || deal.ort || deal.address);
  return distance || 'Wien';
}

function inferExpires(deal) {
  const raw = deal.expires || deal.end_date || deal.validity_date || '';
  const iso = toIsoDate(raw);
  return iso || cleanText(raw) || '';
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
  const rawUrl = normalizeUrl(deal.url);
  const rawDistance = cleanText(deal.distance || deal.location || deal.ort || deal.address);
  const rawExpires = cleanText(deal.expires || deal.end_date || deal.validity_date || '');
  const rawSource = cleanText(deal.source);
  const originSource = cleanText(deal.originSource) || rawSource || sourceKey;
  const url = rawUrl;
  const pubDate = toIsoDate(deal.pubDate);
  const pubDateSource = cleanText(deal.pubDateSource);
  const idSeed = `${sourceKey}|${deal.id || ''}|${url}|${title}`;
  const id = cleanText(deal.id) || `${sourceKey}-${stableId(idSeed)}`;
  const type = inferType(deal);
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
    location: cleanText(deal.location),
    ort: cleanText(deal.ort),
    pubDate,
    pubDateSource,
    expires: inferExpires(deal),
    source: cleanText(deal.source) || sourceKey,
    originSource,
    qualityScore: Number(deal.qualityScore) || 0,
    hot: Boolean(deal.hot),
    isNew: true,
    votes: Number(deal.votes) || 1,
    priority: Number(deal.priority) || 3,
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
    `📍 Ort: ${deal.distance || 'Wien'}`,
    `📅 Angebotsdatum: ${formatDate(deal.pubDate)}`,
    `⏳ Gültig bis: ${deal.expires ? formatDate(deal.expires) : 'k.A.'}`,
    `🧭 Kategorie: ${deal.category} | Typ: ${deal.type}`,
    `🧩 Ursprung intern: ${deal.originSource || deal.source || 'k.A.'}`,
    `🔗 Direktlink: ${link}`,
    `🆔 Deal-ID: ${deal.id}`,
    validationDetails,
    missingNote,
    desc,
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

function writePendingAll(deals) {
  const payload = {
    deals,
    totalDeals: deals.length,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(PENDING_ALL_PATH, JSON.stringify(payload, null, 2));
}

function queueKey(deal) {
  return cleanText(deal.slackTs) || cleanText(deal.id) || normalizeUrl(deal.url);
}

function mergePendingQueue(existingDeals, newPostedDeals) {
  const byKey = new Map();
  for (const deal of existingDeals) {
    const key = queueKey(deal);
    if (!key) continue;
    byKey.set(key, deal);
  }
  for (const deal of newPostedDeals) {
    const key = queueKey(deal);
    if (!key) continue;
    byKey.set(key, deal);
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
  const pendingDeals = loadPendingDeals(pendingFiles);
  console.log(`📋 Total pending deals loaded: ${pendingDeals.length}`);
  const existingQueue = loadPendingQueue();

  const validation = await validateDealsForSlack(pendingDeals);
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
}

main().catch((error) => {
  console.error('❌ slack-notify failed:', error.message);
  process.exit(1);
});

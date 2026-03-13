import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const SENT_IDS_PATH = path.join(DOCS_DIR, 'sent-deal-ids.json');
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

const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;
const CUTOFF_DATE = Date.now() - TWO_WEEKS_MS;
const DAY_MS = 24 * 60 * 60 * 1000;
const TRUSTED_PUBDATE_SOURCES = new Set(['ldDate', 'timeDatetime', 'igScriptTimestamp']);

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

function stableDealSignature(deal) {
  const normalizedUrl = normalizeUrl(deal?.url)
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
  const title = cleanText(deal?.title)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const brand = cleanText(deal?.brand)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const type = cleanText(deal?.type).toLowerCase();
  const distance = cleanText(deal?.distance || deal?.location || deal?.ort)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return [normalizedUrl, brand, title, type, distance].filter(Boolean).join('|');
}

function alternateDealSignature(deal) {
  const title = cleanText(deal?.title)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const brand = cleanText(deal?.brand)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const type = cleanText(deal?.type).toLowerCase();
  const distance = cleanText(deal?.distance || deal?.location || deal?.ort)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return [brand, title, type, distance].filter(Boolean).join('|');
}

function getDealSignatureVariants(deal) {
  return [stableDealSignature(deal), alternateDealSignature(deal)].filter(Boolean);
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
  const distance = cleanText(deal.distance || deal.location || deal.ort);
  return distance || 'Wien';
}

function inferExpires(deal) {
  const raw = deal.expires || deal.end_date || deal.validity_date || '';
  const iso = toIsoDate(raw);
  return iso || cleanText(raw) || '';
}

function parseLooseExpiry(text) {
  const value = cleanText(text);
  if (!value) return null;
  const lower = value.toLowerCase();

  if (
    lower.includes('unknown') ||
    lower.includes('unbekannt') ||
    lower.includes('ongoing') ||
    lower.includes('laufend') ||
    lower.includes('siehe') ||
    lower.includes('website') ||
    lower.includes('webseite')
  ) {
    return null;
  }

  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) return direct.getTime();

  const matchYmd = value.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (matchYmd) {
    const ts = Date.parse(`${matchYmd[1]}-${matchYmd[2]}-${matchYmd[3]}T23:59:59`);
    if (!Number.isNaN(ts)) return ts;
  }

  const matchDmy = value.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (matchDmy) {
    const yyyy = matchDmy[3].length === 2 ? `20${matchDmy[3]}` : matchDmy[3];
    const mm = String(matchDmy[2]).padStart(2, '0');
    const dd = String(matchDmy[1]).padStart(2, '0');
    const ts = Date.parse(`${yyyy}-${mm}-${dd}T23:59:59`);
    if (!Number.isNaN(ts)) return ts;
  }

  return null;
}

function extractRelativeAgeDays(text) {
  const t = cleanText(text).toLowerCase();
  if (!t) return null;
  const m = t.match(/(\d+)\s*(weeks?|wochen|days?|tage|months?|monate|years?|jahre?n?|y|w|d|m)\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 0) return null;
  const unit = m[2].toLowerCase();
  if (unit.startsWith('w') || unit.includes('woch')) return n * 7;
  if (unit.startsWith('d') || unit.includes('tag')) return n;
  if (unit.startsWith('m') || unit.includes('monat')) return n * 30;
  if (unit.startsWith('y') || unit.includes('jahr') || unit.includes('year')) return n * 365;
  return null;
}

function parseDateCandidatesFromText(text) {
  const t = cleanText(text);
  if (!t) return [];
  const out = [];

  const ymdMatches = [...t.matchAll(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g)];
  for (const m of ymdMatches) {
    const yyyy = Number(m[1]);
    const mm = Number(m[2]);
    const dd = Number(m[3]);
    const d = new Date(Date.UTC(yyyy, mm - 1, dd, 12, 0, 0));
    if (!Number.isNaN(d.getTime())) out.push(d.getTime());
  }

  const dmyMatches = [...t.matchAll(/\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b/g)];
  for (const m of dmyMatches) {
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    const yyRaw = String(m[3]);
    const yyyy = yyRaw.length === 2 ? Number(`20${yyRaw}`) : Number(yyRaw);
    const d = new Date(Date.UTC(yyyy, mm - 1, dd, 12, 0, 0));
    if (!Number.isNaN(d.getTime())) out.push(d.getTime());
  }

  return out;
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
  const rawDistance = cleanText(deal.distance || deal.location || deal.ort);
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
  const files = fs.readdirSync(DOCS_DIR);
  return files.filter((file) => {
    if (!file.startsWith('deals-pending-') || !file.endsWith('.json')) return false;
    if (file === 'deals-pending-merged.json') return false;
    if (file === 'deals-pending-all.json') return false;
    return true;
  });
}

function loadPendingDeals() {
  const files = getPendingFiles();
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

function loadSentIds() {
  if (!fs.existsSync(SENT_IDS_PATH)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(SENT_IDS_PATH, 'utf-8'));
    return ensureObject(parsed);
  } catch {
    return {};
  }
}

function saveSentIds(sentIds) {
  fs.writeFileSync(SENT_IDS_PATH, JSON.stringify(sentIds, null, 2));
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

function buildSeenSignatureMap(sentIds, pendingQueue) {
  const seen = new Map();

  for (const [key, value] of Object.entries(sentIds)) {
    if (key.startsWith('sig:')) {
      seen.set(key.slice(4), Number(value) || Date.now());
    }
  }

  for (const deal of pendingQueue) {
    if (!deal?.slackTs) continue;
    const postedAt = deal.slackTs ? Number.parseFloat(deal.slackTs) * 1000 : Date.now();
    for (const signature of getDealSignatureVariants(deal)) {
      seen.set(signature, Number.isFinite(postedAt) ? postedAt : Date.now());
    }
  }

  return seen;
}

function isRecent(deal) {
  const pubMs = new Date(deal.pubDate).getTime();
  if (!Number.isFinite(pubMs)) return false;
  return pubMs >= CUTOFF_DATE;
}

function hasTrustedInstagramDate(deal) {
  const source = cleanText(deal.source).toLowerCase();
  if (!source.includes('instagram')) return true;
  return TRUSTED_PUBDATE_SOURCES.has(cleanText(deal.pubDateSource));
}

function isNotExpired(deal) {
  const expiryMs = parseLooseExpiry(deal.expires);
  if (!expiryMs) return true;
  return expiryMs + DAY_MS >= Date.now();
}

function hasOldAgeSignal(deal) {
  const haystack = `${deal.title || ''} ${deal.description || ''} ${deal.expires || ''}`;
  const ageDays = extractRelativeAgeDays(haystack);
  if (!Number.isFinite(ageDays)) return false;
  return ageDays > 14;
}

function hasStaleExplicitDateSignal(deal) {
  const bundle = `${deal.title || ''} ${deal.description || ''} ${deal.expires || ''}`;
  const dates = parseDateCandidatesFromText(bundle);
  if (dates.length === 0) return false;
  const newest = Math.max(...dates);
  return newest < CUTOFF_DATE;
}

function formatDate(value) {
  if (!value) return 'k.A.';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('de-AT');
}

function buildSlackMessage(deal, index) {
  const link = deal.url ? `<${deal.url}|Zum Angebot>` : '⚠️ FEHLT';
  const desc = deal.description ? `\n📝 ${deal.description.slice(0, 180)}` : '';
  const missingNote = Array.isArray(deal.missingFields) && deal.missingFields.length > 0
    ? `\n⚠️ FEHLT: ${deal.missingFields.join(', ')}`
    : '';
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

  const pendingDeals = loadPendingDeals();
  console.log(`📋 Total pending deals loaded: ${pendingDeals.length}`);

  const sentIds = loadSentIds();
  const existingQueue = loadPendingQueue();
  const seenSignatures = buildSeenSignatureMap(sentIds, existingQueue);
  const unseenDeals = pendingDeals.filter((deal) => {
    if (sentIds[deal.id]) return false;
    const signatures = getDealSignatureVariants(deal);
    if (signatures.length === 0) return true;
    return !signatures.some((signature) => seenSignatures.has(signature));
  });
  const freshDeals = unseenDeals
    .filter(isRecent)
    .filter(hasTrustedInstagramDate)
    .filter((d) => !hasOldAgeSignal(d))
    .filter((d) => !hasStaleExplicitDateSignal(d))
    .filter(isNotExpired);

  console.log(`📨 Pending: ${pendingDeals.length}, unseen: ${unseenDeals.length}, fresh: ${freshDeals.length}`);

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
    `_Jeden Deal mit ✅ bestätigen, dann erscheint er in der iOS-App._`
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
    sentIds[deal.id] = Date.now();

    if ((i + 1) % 10 === 0) {
      console.log(`  ✅ posted ${i + 1}/${freshDeals.length}`);
    }
    await sleep(600);
  }

  for (const deal of postedDeals) {
    for (const signature of getDealSignatureVariants(deal)) {
      sentIds[`sig:${signature}`] = Date.now();
    }
  }

  saveSentIds(sentIds);
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

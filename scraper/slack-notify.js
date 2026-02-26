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
  const url = normalizeUrl(deal.url);
  const pubDate = toIsoDate(deal.pubDate) || new Date().toISOString();
  const idSeed = `${sourceKey}|${deal.id || ''}|${url}|${title}|${pubDate}`;
  const id = cleanText(deal.id) || `${sourceKey}-${stableId(idSeed)}`;
  const type = inferType(deal);

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
    expires: inferExpires(deal),
    source: cleanText(deal.source) || sourceKey,
    qualityScore: Number(deal.qualityScore) || 0,
    hot: Boolean(deal.hot),
    isNew: true,
    votes: Number(deal.votes) || 1,
    priority: Number(deal.priority) || 3,
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

function isRecent(deal) {
  const pubMs = new Date(deal.pubDate).getTime();
  if (!Number.isFinite(pubMs)) return true;
  return pubMs >= CUTOFF_DATE;
}

function isNotExpired(deal) {
  const expiryMs = parseLooseExpiry(deal.expires);
  if (!expiryMs) return true;
  return expiryMs + DAY_MS >= Date.now();
}

function formatDate(value) {
  if (!value) return 'k.A.';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('de-AT');
}

function buildSlackMessage(deal, index) {
  const link = deal.url ? `<${deal.url}|Zum Angebot>` : 'Kein Link';
  const desc = deal.description ? `\n📝 ${deal.description.slice(0, 180)}` : '';
  return [
    `*${index}. ${deal.title}*`,
    `🏷️ Marke/Restaurant: ${deal.brand || 'k.A.'}`,
    `📍 Ort: ${deal.distance || 'Wien'}`,
    `📅 Angebotsdatum: ${formatDate(deal.pubDate)}`,
    `⏳ Gültig bis: ${deal.expires ? formatDate(deal.expires) : 'k.A.'}`,
    `🧭 Kategorie: ${deal.category} | Typ: ${deal.type}`,
    `🔗 Direktlink: ${link}`,
    `🆔 Deal-ID: ${deal.id}`,
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
  const unseenDeals = pendingDeals.filter((deal) => !sentIds[deal.id]);
  const freshDeals = unseenDeals.filter(isRecent).filter(isNotExpired).filter((deal) => deal.url);

  console.log(`📨 Pending: ${pendingDeals.length}, unseen: ${unseenDeals.length}, fresh+valid URL: ${freshDeals.length}`);

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

  saveSentIds(sentIds);
  writePendingAll(postedDeals);

  console.log(`✅ ${postedDeals.length} Deals an Slack gesendet`);
  console.log(`💾 saved: ${path.relative(ROOT, PENDING_ALL_PATH)}`);
}

main().catch((error) => {
  console.error('❌ slack-notify failed:', error.message);
  process.exit(1);
});

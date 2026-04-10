import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const ENV_PATH = path.join(ROOT, '.env');
const PUSH_CONFIG_PATH = path.join(DOCS_DIR, 'push-config.json');
const OUTPUT_PATH = path.join(DOCS_DIR, 'deals-pending-community.json');

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

function cleanText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function loadPushConfig() {
  if (!fs.existsSync(PUSH_CONFIG_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(PUSH_CONFIG_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function getApiBase() {
  const fromEnv = cleanText(process.env.COMMUNITY_API_BASE);
  if (fromEnv) return fromEnv.replace(/\/+$/, '');

  const cfg = loadPushConfig();
  const fromConfig = cfg && cfg.referralEnabled ? cleanText(cfg.referralApiBase) : '';
  return fromConfig.replace(/\/+$/, '');
}

function normalizeSubmissionDeal(submission) {
  const submittedAt = Number(submission?.submittedAt || 0) || Date.now();
  const brand = cleanText(submission?.brand) || 'Community Fund';
  const title = cleanText(submission?.title) || 'Community-Deal prüfen';
  const logo = cleanText(submission?.logo) || '🔗';
  const category = cleanText(submission?.category).toLowerCase() || 'wien';
  const type = cleanText(submission?.type).toLowerCase() || 'rabatt';

  return {
    id: `community:${cleanText(submission?.id)}`,
    submissionId: cleanText(submission?.id),
    brand,
    logo,
    title,
    description: '📨 Von der Community eingereicht. Bitte Link, Ort und Ablauf prüfen, bevor der Deal live geht.',
    type,
    category,
    source: 'Community Submission',
    originSource: 'community-submission',
    url: cleanText(submission?.url),
    expires: '',
    distance: 'Bitte prüfen',
    hot: false,
    isNew: true,
    votes: 1,
    priority: 4,
    qualityScore: 0,
    pubDate: new Date(submittedAt).toISOString(),
    pubDateSource: 'communitySubmission',
    submittedAt: new Date(submittedAt).toISOString(),
    missingFields: ['Ort', 'Ablauf', 'Beschreibung prüfen'],
  };
}

async function main() {
  const apiBase = getApiBase();
  const token = cleanText(process.env.COMMUNITY_SYNC_TOKEN);

  if (!apiBase) {
    throw new Error('COMMUNITY_API_BASE fehlt und push-config.json enthält keine referralApiBase');
  }
  if (!token) {
    throw new Error('COMMUNITY_SYNC_TOKEN fehlt');
  }

  const res = await fetch(`${apiBase}/api/deals/submissions/admin/pending?limit=100&status=pending`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) {
    throw new Error((body && body.error) || `Community fetch failed: ${res.status}`);
  }

  const submissions = ensureArray(body.submissions);
  const deals = submissions
    .map(normalizeSubmissionDeal)
    .filter((deal) => deal.submissionId && deal.url);

  const payload = {
    deals,
    totalDeals: deals.length,
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(`✅ community submissions fetched: ${deals.length}`);
}

main().catch((error) => {
  console.error('❌ fetch-community-submissions failed:', error.message);
  process.exit(1);
});

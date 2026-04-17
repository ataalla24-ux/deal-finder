import '../sentry/instrument.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const ENV_PATH = path.join(ROOT, '.env');
const PUSH_CONFIG_PATH = path.join(DOCS_DIR, 'push-config.json');
const PENDING_ALL_PATH = path.join(DOCS_DIR, 'deals-pending-all.json');

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

function loadPostedSubmissionIds() {
  if (!fs.existsSync(PENDING_ALL_PATH)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(PENDING_ALL_PATH, 'utf-8'));
    const deals = ensureArray(parsed?.deals);
    const ids = new Set();
    for (const deal of deals) {
      const source = cleanText(deal?.source).toLowerCase();
      const origin = cleanText(deal?.originSource).toLowerCase();
      if (!source.includes('community submission') && !origin.includes('community-submission')) continue;
      if (!cleanText(deal?.slackTs)) continue;
      const submissionId = cleanText(deal?.submissionId).replace(/^community:/, '');
      if (submissionId) ids.add(submissionId);
    }
    return [...ids];
  } catch {
    return [];
  }
}

async function main() {
  const apiBase = getApiBase();
  const token = cleanText(process.env.COMMUNITY_SYNC_TOKEN);
  const ids = loadPostedSubmissionIds();

  if (!apiBase) throw new Error('COMMUNITY_API_BASE fehlt');
  if (!token) throw new Error('COMMUNITY_SYNC_TOKEN fehlt');

  if (ids.length === 0) {
    console.log('ℹ️ no posted community submissions to acknowledge');
    return;
  }

  const res = await fetch(`${apiBase}/api/deals/submissions/admin/mark-posted`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ids }),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) {
    throw new Error((body && body.error) || `Community acknowledge failed: ${res.status}`);
  }

  console.log(`✅ community submissions marked queued: ${body.updated || 0}`);
}

main().catch((error) => {
  console.error('❌ ack-community-submissions failed:', error.message);
  process.exit(1);
});

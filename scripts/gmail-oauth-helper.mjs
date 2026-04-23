import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, '.env');
const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function loadEnv() {
  if (!fs.existsSync(ENV_PATH)) return {};
  const out = {};
  for (const line of fs.readFileSync(ENV_PATH, 'utf-8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const env = { ...loadEnv(), ...process.env };

function requireEnv(name) {
  const value = cleanText(env[name]);
  if (!value) throw new Error(`${name} fehlt`);
  return value;
}

function redirectUri() {
  return cleanText(env.GMAIL_OAUTH_REDIRECT_URI) || 'http://localhost:3000/oauth2callback';
}

function printAuthUrl() {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set('client_id', requireEnv('GMAIL_CLIENT_ID'));
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GMAIL_READONLY_SCOPE);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');

  console.log('Open this URL, approve Gmail readonly access, then copy the code from the redirect URL:');
  console.log(url.toString());
}

async function exchangeCode(code) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: requireEnv('GMAIL_CLIENT_ID'),
      client_secret: requireEnv('GMAIL_CLIENT_SECRET'),
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri(),
    }),
  });
  const text = await response.text();
  let body = {};
  try {
    body = JSON.parse(text);
  } catch {
    body = {};
  }

  if (!response.ok || !body.refresh_token) {
    const detail = cleanText(body.error_description || body.error || text).slice(0, 220);
    throw new Error(`OAuth code exchange failed (${response.status}): ${detail}`);
  }

  console.log('Set this as the GitHub secret GMAIL_REFRESH_TOKEN:');
  console.log(body.refresh_token);
}

async function main() {
  const command = cleanText(process.argv[2] || 'auth-url');
  if (command === 'auth-url') {
    printAuthUrl();
    return;
  }
  if (command === 'exchange') {
    const code = cleanText(process.argv[3]);
    if (!code) throw new Error('Usage: npm run gmail:oauth -- exchange <code>');
    await exchangeCode(code);
    return;
  }

  throw new Error('Usage: npm run gmail:oauth -- auth-url | npm run gmail:oauth -- exchange <code>');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

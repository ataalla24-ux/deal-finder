const GMAIL_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1';
const DEFAULT_GMAIL_USER_ID = 'me';
const DEFAULT_GMAIL_QUERY = 'newer_than:2d (from:security@mail.instagram.com OR from:mail.instagram.com OR from:no-reply@mail.instagram.com OR from:no-reply@instagram.com)';

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function numberFromEnv(value, fallback) {
  const parsed = Number.parseInt(cleanText(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function requireEnv(env, name) {
  const value = cleanText(env[name]);
  if (!value) throw new Error(`${name} fehlt`);
  return value;
}

function maskSecret(value) {
  const text = cleanText(value);
  if (text && process.env.GITHUB_ACTIONS) {
    console.log(`::add-mask::${text}`);
  }
}

export function gmailInstagramCodeConfigured(env = process.env) {
  return Boolean(cleanText(env.GMAIL_CLIENT_ID) && cleanText(env.GMAIL_CLIENT_SECRET) && cleanText(env.GMAIL_REFRESH_TOKEN));
}

async function requestGmailAccessToken(env) {
  const params = new URLSearchParams({
    client_id: requireEnv(env, 'GMAIL_CLIENT_ID'),
    client_secret: requireEnv(env, 'GMAIL_CLIENT_SECRET'),
    refresh_token: requireEnv(env, 'GMAIL_REFRESH_TOKEN'),
    grant_type: 'refresh_token',
  });

  const response = await fetch(GMAIL_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  const bodyText = await response.text();
  let body = {};
  try {
    body = JSON.parse(bodyText);
  } catch {
    body = {};
  }

  if (!response.ok || !body.access_token) {
    const detail = cleanText(body.error_description || body.error || bodyText).slice(0, 180);
    throw new Error(`Gmail OAuth Token konnte nicht erneuert werden (${response.status}): ${detail}`);
  }

  return body.access_token;
}

async function gmailJson(accessToken, url, description) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });
  const bodyText = await response.text();
  let body = {};
  try {
    body = JSON.parse(bodyText);
  } catch {
    body = {};
  }

  if (!response.ok) {
    const detail = cleanText(body.error?.message || body.error_description || bodyText).slice(0, 180);
    throw new Error(`Gmail API Fehler bei ${description} (${response.status}): ${detail}`);
  }

  return body;
}

function base64UrlDecode(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64').toString('utf8');
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)));
}

function payloadText(payload) {
  if (!payload) return '';

  const chunks = [];
  const visit = (part) => {
    if (!part) return;
    const mimeType = cleanText(part.mimeType).toLowerCase();
    if (part.body?.data && (mimeType === 'text/plain' || mimeType === 'text/html')) {
      const decoded = base64UrlDecode(part.body.data);
      chunks.push(mimeType === 'text/html' ? decodeHtmlEntities(decoded.replace(/<[^>]*>/g, ' ')) : decoded);
    }
    for (const child of part.parts || []) visit(child);
  };
  visit(payload);

  return cleanText(chunks.join(' '));
}

function messageText(message) {
  return cleanText(`${message.snippet || ''} ${payloadText(message.payload)}`);
}

export function extractInstagramCodeFromText(text) {
  const normalized = cleanText(text);
  const patterns = [
    /(?:instagram[^0-9]{0,120})?(?:code|security code|confirmation code|bestätigungscode|sicherheitscode|anmeldecode|login code)[^0-9]{0,120}([0-9]{6})/i,
    /([0-9]{6})[^0-9]{0,120}(?:is your instagram code|ist dein instagram-code|instagram code|confirmation code|sicherheitscode)/i,
    /(?:^|[^0-9])([0-9]{6})(?:[^0-9]|$)/,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) return match[1];
  }
  return '';
}

async function listCandidateMessages(accessToken, env) {
  const userId = encodeURIComponent(cleanText(env.GMAIL_USER_ID) || DEFAULT_GMAIL_USER_ID);
  const query = cleanText(env.GMAIL_INSTAGRAM_CODE_QUERY) || DEFAULT_GMAIL_QUERY;
  const maxResults = numberFromEnv(env.GMAIL_INSTAGRAM_CODE_MAX_RESULTS, 10);
  const url = new URL(`${GMAIL_API_BASE}/users/${userId}/messages`);
  url.searchParams.set('q', query);
  url.searchParams.set('maxResults', String(Math.min(Math.max(maxResults, 1), 20)));
  url.searchParams.set('includeSpamTrash', 'false');

  const list = await gmailJson(accessToken, url, 'messages.list');
  return list.messages || [];
}

async function getMessage(accessToken, env, messageId) {
  const userId = encodeURIComponent(cleanText(env.GMAIL_USER_ID) || DEFAULT_GMAIL_USER_ID);
  const url = new URL(`${GMAIL_API_BASE}/users/${userId}/messages/${encodeURIComponent(messageId)}`);
  url.searchParams.set('format', 'full');
  return gmailJson(accessToken, url, 'messages.get');
}

async function findLatestInstagramCode(accessToken, env, sinceMs) {
  const candidates = await listCandidateMessages(accessToken, env);
  const messages = [];

  for (const candidate of candidates) {
    const message = await getMessage(accessToken, env, candidate.id);
    const internalDate = Number.parseInt(message.internalDate || '0', 10);
    if (Number.isFinite(internalDate) && internalDate >= sinceMs) {
      messages.push({ message, internalDate });
    }
  }

  messages.sort((left, right) => right.internalDate - left.internalDate);

  for (const { message } of messages) {
    const code = extractInstagramCodeFromText(messageText(message));
    if (code) return code;
  }

  return '';
}

export async function fetchInstagramCodeFromGmail(options = {}) {
  const env = options.env || process.env;
  if (!gmailInstagramCodeConfigured(env)) {
    throw new Error('Gmail API ist nicht konfiguriert: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET und GMAIL_REFRESH_TOKEN fehlen.');
  }

  const timeoutMs = numberFromEnv(env.GMAIL_INSTAGRAM_CODE_POLL_TIMEOUT_MS, 90000);
  const intervalMs = numberFromEnv(env.GMAIL_INSTAGRAM_CODE_POLL_INTERVAL_MS, 5000);
  const sinceMs = Number.isFinite(options.sinceMs) ? options.sinceMs : Date.now() - 15000;
  const deadline = Date.now() + timeoutMs;
  const accessToken = await requestGmailAccessToken(env);

  while (Date.now() <= deadline) {
    const code = await findLatestInstagramCode(accessToken, env, sinceMs);
    if (code) {
      maskSecret(code);
      return code;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error('Gmail API hat keinen frischen Instagram-Code gefunden.');
}

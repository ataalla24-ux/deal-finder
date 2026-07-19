import '../sentry/instrument.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = process.cwd();
const DOCS_DIR = path.join(ROOT, 'docs');
const ENV_PATH = path.join(ROOT, '.env');
const DEFAULT_REPORT_PATH = path.join(DOCS_DIR, 'instagram-auth-health.json');
const DEFAULT_TEST_USERNAME = 'ciosgrill';
const INSTAGRAM_APP_ID = '936619743392459';

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function loadEnv() {
  if (!fs.existsSync(ENV_PATH)) return {};
  const out = {};
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
    out[key] = value;
  }
  return out;
}

const env = { ...loadEnv(), ...process.env };

export function parseCookiePairs(value) {
  const pairs = [];
  const raw = String(value || '').trim();
  if (!raw) return pairs;

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (trimmed.includes('\t')) {
      const columns = trimmed.split('\t').map((part) => part.trim());
      const name = columns.length >= 7 ? columns[5] : columns[0];
      const cookieValue = columns.length >= 7 ? columns[6] : columns[1];
      if (name && cookieValue) pairs.push({ name, value: cookieValue });
      continue;
    }

    for (const part of trimmed.split(';').map((item) => item.trim()).filter(Boolean)) {
      const idx = part.indexOf('=');
      if (idx <= 0) continue;
      const name = part.slice(0, idx).trim();
      const cookieValue = part.slice(idx + 1).trim();
      if (name && cookieValue) pairs.push({ name, value: cookieValue });
    }
  }

  return pairs;
}

function collectCookiePairs() {
  const pairs = [];

  const addCookieText = (value) => {
    pairs.push(...parseCookiePairs(value));
  };

  addCookieText(env.INSTAGRAM_COOKIES);
  addCookieText(env.APIFY_INSTAGRAM_COOKIE_STRING);

  const cookieFile = cleanText(env.INSTAGRAM_COOKIES_FILE);
  if (cookieFile && fs.existsSync(cookieFile)) {
    addCookieText(fs.readFileSync(cookieFile, 'utf-8'));
  }

  const sessionId = cleanText(env.INSTAGRAM_SESSIONID || env.APIFY_INSTAGRAM_SESSIONID);
  if (sessionId && !pairs.some((cookie) => cookie.name === 'sessionid')) {
    pairs.push({ name: 'sessionid', value: sessionId });
  }

  const byName = new Map();
  for (const pair of pairs) {
    const name = cleanText(pair.name);
    const value = cleanText(pair.value);
    if (!name || !value) continue;
    byName.set(name, value);
  }

  return [...byName.entries()].map(([name, value]) => ({ name, value }));
}

function buildCookieHeader(cookies) {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

function cookieDiagnostics(cookies) {
  const names = cookies.map((cookie) => cookie.name).filter(Boolean).sort();
  return {
    cookieCount: cookies.length,
    cookieNames: names.slice(0, 30),
    hasSessionCookie: names.includes('sessionid'),
    hasCsrfCookie: names.includes('csrftoken'),
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseRetryAfter(value, nowMs = Date.now()) {
  const raw = cleanText(value);
  if (!raw) return null;

  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    return new Date(nowMs + Math.max(0, Number(raw)) * 1000);
  }

  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : new Date(Math.max(nowMs, parsed));
}

function toIsoOrEmpty(value) {
  const timestamp = Date.parse(value || '');
  return Number.isNaN(timestamp) ? '' : new Date(timestamp).toISOString();
}

function previousRateLimitState(previousReport) {
  if (!previousReport || previousReport.status !== 'rate-limited') {
    return { consecutiveRateLimits: 0, nextRetryAt: '' };
  }

  return {
    consecutiveRateLimits: Math.max(1, Number(previousReport.consecutiveRateLimits || 1)),
    nextRetryAt: toIsoOrEmpty(previousReport.nextRetryAt),
  };
}

function rateLimitResult({
  username,
  diagnostics,
  previousReport,
  nowMs,
  response,
  bodySample = '',
  attempt = 1,
  circuitOpen = false,
  config = env,
}) {
  const previous = previousRateLimitState(previousReport);
  const consecutiveRateLimits = circuitOpen
    ? previous.consecutiveRateLimits
    : previous.consecutiveRateLimits + 1;
  const baseCooldownMs = toPositiveInt(config.INSTAGRAM_AUTH_RATE_LIMIT_COOLDOWN_MS, 15 * 60 * 1000);
  const maxCooldownMs = toPositiveInt(config.INSTAGRAM_AUTH_RATE_LIMIT_MAX_COOLDOWN_MS, 6 * 60 * 60 * 1000);
  const exponentialCooldownMs = Math.min(
    maxCooldownMs,
    baseCooldownMs * (2 ** Math.max(0, consecutiveRateLimits - 1)),
  );
  const retryAfterDate = circuitOpen
    ? (previous.nextRetryAt ? new Date(previous.nextRetryAt) : null)
    : parseRetryAfter(response?.headers?.get?.('retry-after'), nowMs);
  const nextRetryMs = circuitOpen && retryAfterDate
    ? retryAfterDate.getTime()
    : Math.max(
      nowMs + exponentialCooldownMs,
      retryAfterDate?.getTime?.() || 0,
    );
  const nextRetryAt = new Date(nextRetryMs).toISOString();

  return {
    ok: false,
    status: 'rate-limited',
    reason: circuitOpen
      ? `Instagram Auth-Check pausiert bis ${nextRetryAt}`
      : `Instagram rate-limited den Healthcheck (HTTP ${response?.status || 429}); Cookies werden nicht als ungültig markiert`,
    username,
    httpStatus: Number(response?.status || previousReport?.httpStatus || 429),
    diagnostics,
    apiUserFound: false,
    bodySample,
    attempts: attempt,
    rateLimited: true,
    circuitOpen,
    credentialsState: 'unknown',
    shouldRefreshCookies: false,
    consecutiveRateLimits,
    retryAfter: retryAfterDate?.toISOString?.() || '',
    nextRetryAt,
    cooldownSeconds: Math.max(0, Math.ceil((nextRetryMs - nowMs) / 1000)),
  };
}

function instagramHeaders(cookieHeader, username) {
  return {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept: '*/*',
    Cookie: cookieHeader,
    Referer: `https://www.instagram.com/${encodeURIComponent(username)}/`,
    'X-IG-App-ID': INSTAGRAM_APP_ID,
    'X-Requested-With': 'XMLHttpRequest',
  };
}

export async function validateInstagramAuth(cookies, options = {}) {
  const config = options.env || env;
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const fetchImpl = options.fetchImpl || fetchWithTimeout;
  const sleepImpl = options.sleepImpl || sleep;
  const previousReport = options.previousReport || null;
  const username = cleanText(config.INSTAGRAM_AUTH_TEST_USERNAME) || DEFAULT_TEST_USERNAME;
  const diagnostics = cookieDiagnostics(cookies);
  const cookieHeader = buildCookieHeader(cookies);
  const maxAttempts = Math.max(1, toPositiveInt(config.INSTAGRAM_AUTH_ATTEMPTS || config.INSTAGRAM_AUTH_RETRIES, 1));
  const baseBackoffMs = toPositiveInt(config.INSTAGRAM_AUTH_BACKOFF_MS, 15000);

  if (!diagnostics.hasSessionCookie) {
    return {
      ok: false,
      status: 'missing-session',
      reason: 'Instagram sessionid fehlt',
      username,
      httpStatus: 0,
      diagnostics,
      credentialsState: 'missing',
      shouldRefreshCookies: true,
      rateLimited: false,
      circuitOpen: false,
    };
  }

  const previous = previousRateLimitState(previousReport);
  if (previous.nextRetryAt && Date.parse(previous.nextRetryAt) > nowMs) {
    return rateLimitResult({
      username,
      diagnostics,
      previousReport,
      nowMs,
      attempt: 0,
      circuitOpen: true,
      config,
    });
  }

  const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
  let lastFailure = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) {
      await sleepImpl(baseBackoffMs * (attempt - 1));
    }

    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: instagramHeaders(cookieHeader, username),
      }, Number(config.INSTAGRAM_AUTH_TIMEOUT_MS || 15000));

      const contentType = cleanText(response.headers.get('content-type')).toLowerCase();
      const bodyText = await response.text();
      let parsed = null;
      if (contentType.includes('json') || bodyText.trim().startsWith('{')) {
        try {
          parsed = JSON.parse(bodyText);
        } catch {
          parsed = null;
        }
      }

      const apiUser = parsed?.data?.user;
      if (response.ok && apiUser?.username) {
        return {
          ok: true,
          status: 'ok',
          reason: `Profil ${apiUser.username} erreichbar`,
          username,
          httpStatus: response.status,
          diagnostics,
          apiUserFound: true,
          attempts: attempt,
          credentialsState: 'valid',
          shouldRefreshCookies: false,
          rateLimited: false,
          circuitOpen: false,
          consecutiveRateLimits: 0,
          nextRetryAt: '',
        };
      }

      const bodySample = cleanText(bodyText).slice(0, 500);
      const lowerSample = bodySample.toLowerCase();
      const loginWall = lowerSample.includes('login') || lowerSample.includes('log in') || lowerSample.includes('anmelden');
      const rateLimited = response.status === 429 || lowerSample.includes('please wait');
      const challengeRequired = lowerSample.includes('challenge_required')
        || lowerSample.includes('checkpoint_required')
        || lowerSample.includes('/challenge/');
      const blocked = response.status === 403 || challengeRequired;
      const invalidSession = response.status === 401 || loginWall;
      const confirmedCredentialFailure = invalidSession || challengeRequired;
      const serviceUnavailable = response.status >= 500;

      if (rateLimited) {
        return rateLimitResult({
          username,
          diagnostics,
          previousReport,
          nowMs,
          response,
          bodySample,
          attempt,
          config,
        });
      }

      lastFailure = {
        ok: false,
        status: blocked
          ? 'blocked'
          : (loginWall ? 'login-wall' : (invalidSession ? 'invalid-session' : (serviceUnavailable ? 'service-unavailable' : 'unexpected-response'))),
        reason: `Instagram API lieferte HTTP ${response.status}`,
        username,
        httpStatus: response.status,
        diagnostics,
        apiUserFound: false,
        bodySample,
        attempts: attempt,
        rateLimited: false,
        circuitOpen: false,
        credentialsState: confirmedCredentialFailure ? 'invalid' : 'unknown',
        shouldRefreshCookies: confirmedCredentialFailure,
      };

      if (!serviceUnavailable || attempt === maxAttempts) return lastFailure;
    } catch (error) {
      lastFailure = {
        ok: false,
        status: 'error',
        reason: `Auth-Check fehlgeschlagen: ${error.message}`,
        username,
        httpStatus: 0,
        diagnostics,
        apiUserFound: false,
        attempts: attempt,
        rateLimited: false,
        circuitOpen: false,
        credentialsState: 'unknown',
        shouldRefreshCookies: false,
      };
      if (attempt === maxAttempts) return lastFailure;
    }
  }

  return lastFailure || {
    ok: false,
    status: 'error',
    reason: 'Auth-Check fehlgeschlagen',
    username,
    httpStatus: 0,
    diagnostics,
    apiUserFound: false,
    attempts: maxAttempts,
    rateLimited: false,
    circuitOpen: false,
    credentialsState: 'unknown',
    shouldRefreshCookies: false,
  };
}

function readPreviousReport(reportPath) {
  if (!fs.existsSync(reportPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  } catch {
    return null;
  }
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function buildEmptyPayload(source, report) {
  return {
    lastUpdated: report.updatedAt,
    source,
    totalDeals: 0,
    meta: {
      skippedDueToInstagramAuth: true,
      authStatus: report.status,
      authReason: report.reason,
    },
    deals: [],
  };
}

function clearPendingOutputsIfRequested(report) {
  if (report.ok || !report.shouldRefreshCookies || env.INSTAGRAM_AUTH_CLEAR_PENDING_ON_FAILURE !== '1') return [];

  const mode = cleanText(env.INSTAGRAM_AUTH_CLEAR_MODE).toLowerCase();
  const written = [];

  if (mode === 'daily-sync') {
    const files = [
      ['deals-pending-instagram.json', 'instagram-merged'],
      ['deals-pending-instagram-web.json', 'instagram-web-disabled'],
      ['deals-pending-instagram-discovery.json', 'instagram-daily-sync-v2'],
    ];
    for (const [file, source] of files) {
      const target = path.join(DOCS_DIR, file);
      writeJson(target, buildEmptyPayload(source, report));
      written.push(path.relative(ROOT, target));
    }

    const discoveryReport = {
      updatedAt: report.updatedAt,
      mode: 'skipped-auth-healthcheck',
      visitedSources: 0,
      totalCandidates: 0,
      visitedPosts: 0,
      savedDeals: 0,
      rejectionReasons: { instagramAuth: 1 },
      authStatus: report.status,
      authReason: report.reason,
      topSources: [],
      candidates: [],
    };
    const webReport = {
      updatedAt: report.updatedAt,
      mode: 'skipped-auth-healthcheck',
      note: 'Instagram auth healthcheck failed before scraping.',
      savedDeals: 0,
      authStatus: report.status,
      authReason: report.reason,
    };
    writeJson(path.join(DOCS_DIR, 'instagram-discovery-report.json'), discoveryReport);
    writeJson(path.join(DOCS_DIR, 'instagram-web-report.json'), webReport);
    written.push('docs/instagram-discovery-report.json', 'docs/instagram-web-report.json');
  }

  if (mode === 'apify') {
    const outputPath = path.join(DOCS_DIR, 'deals-pending-instagram-apify.json');
    const apifyReportPath = path.join(DOCS_DIR, 'apify-instagram-report.json');
    writeJson(outputPath, buildEmptyPayload('instagram-apify', report));
    writeJson(apifyReportPath, {
      updatedAt: report.updatedAt,
      actorId: cleanText(env.APIFY_INSTAGRAM_VIENNA_ACTOR_ID || env.APIFY_ACTOR_ID),
      runId: '',
      status: 'SKIPPED_AUTH',
      acceptedDeals: 0,
      rawDatasetItems: 0,
      summary: {
        authStatus: report.status,
        authReason: report.reason,
      },
    });
    written.push(path.relative(ROOT, outputPath), path.relative(ROOT, apifyReportPath));
  }

  return written;
}

function shouldNotifySlack(report, previousReport) {
  if (report.ok) return false;
  if (!env.SLACK_BOT_TOKEN || !env.SLACK_CHANNEL_ID) return false;
  if (env.INSTAGRAM_AUTH_NOTIFY_SLACK === '0') return false;

  const dedupHours = Math.max(0, Number(env.INSTAGRAM_AUTH_SLACK_DEDUP_HOURS || 6));
  if (!previousReport || previousReport.ok || dedupHours === 0) return true;

  const previousTs = Date.parse(previousReport.updatedAt || '');
  if (Number.isNaN(previousTs)) return true;
  const elapsedMs = Date.now() - previousTs;
  return elapsedMs > dedupHours * 60 * 60 * 1000;
}

async function postSlackWarning(report, clearedFiles) {
  const context = report.context || 'Instagram Auth';
  const cleared = clearedFiles.length ? `\nGeleerte Dateien: ${clearedFiles.join(', ')}` : '';
  const headline = report.rateLimited
    ? `⏸️ *Instagram Healthcheck rate-limited* (${context})`
    : `⚠️ *Instagram Auth kaputt* (${context})`;
  const recommendation = report.rateLimited
    ? `Keine Cookie-Erneuerung auslösen. Nächster Versuch frühestens: ${report.nextRetryAt || 'nach Cooldown'}.`
    : 'Instagram-Session/Cookies nur bei echter Login-Wall oder ungültiger Session erneuern.';
  const text = [
    headline,
    `Status: ${report.status}`,
    `Grund: ${report.reason}`,
    `Testprofil: ${report.username}`,
    `Cookies: sessionid=${report.diagnostics.hasSessionCookie ? 'ja' : 'nein'}, csrftoken=${report.diagnostics.hasCsrfCookie ? 'ja' : 'nein'}, gesamt=${report.diagnostics.cookieCount}`,
    recommendation,
    cleared,
  ].filter(Boolean).join('\n');

  try {
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ channel: env.SLACK_CHANNEL_ID, text }),
    });
    const data = await response.json();
    return Boolean(data.ok);
  } catch {
    return false;
  }
}

function writeGithubOutputs(report) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    fs.appendFileSync(outputPath, `ok=${report.ok ? 'true' : 'false'}\n`);
    fs.appendFileSync(outputPath, `status=${report.status}\n`);
    fs.appendFileSync(outputPath, `reason=${report.reason.replace(/\n/g, ' ')}\n`);
    fs.appendFileSync(outputPath, `rate_limited=${report.rateLimited ? 'true' : 'false'}\n`);
    fs.appendFileSync(outputPath, `circuit_open=${report.circuitOpen ? 'true' : 'false'}\n`);
    fs.appendFileSync(outputPath, `should_refresh=${report.shouldRefreshCookies ? 'true' : 'false'}\n`);
    fs.appendFileSync(outputPath, `next_retry_at=${report.nextRetryAt || ''}\n`);
  }

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    fs.appendFileSync(summaryPath, [
      '### Instagram Auth Health',
      '',
      `- Status: ${report.ok ? 'OK' : 'FAILED'} (${report.status})`,
      `- Reason: ${report.reason}`,
      `- Test username: ${report.username}`,
      `- Attempts: ${report.attempts || 1}`,
      `- Rate limited: ${report.rateLimited ? 'yes' : 'no'}`,
      `- Circuit open: ${report.circuitOpen ? 'yes' : 'no'}`,
      `- Refresh cookies: ${report.shouldRefreshCookies ? 'yes' : 'no'}`,
      ...(report.nextRetryAt ? [`- Next retry: ${report.nextRetryAt}`] : []),
      `- Session cookie: ${report.diagnostics.hasSessionCookie ? 'yes' : 'no'}`,
      `- CSRF cookie: ${report.diagnostics.hasCsrfCookie ? 'yes' : 'no'}`,
      '',
    ].join('\n'));
  }
}

export async function main() {
  const reportPath = cleanText(env.INSTAGRAM_AUTH_REPORT_PATH) || DEFAULT_REPORT_PATH;
  const previousReport = readPreviousReport(reportPath);
  const cookies = collectCookiePairs();
  const result = await validateInstagramAuth(cookies, { previousReport });
  const report = {
    updatedAt: new Date().toISOString(),
    context: cleanText(env.INSTAGRAM_AUTH_CONTEXT) || 'local',
    ...result,
  };

  const clearedFiles = clearPendingOutputsIfRequested(report);
  const notify = shouldNotifySlack(report, previousReport);
  let slackNotified = false;
  if (notify) {
    slackNotified = await postSlackWarning(report, clearedFiles);
  }

  const finalReport = {
    ...report,
    clearedFiles,
    slackNotified,
    slackNotificationSuppressed: !report.ok && !notify,
  };

  writeJson(reportPath, finalReport);
  writeGithubOutputs(finalReport);

  console.log('Instagram auth health:');
  console.log(`- context: ${finalReport.context}`);
  console.log(`- status: ${finalReport.status}`);
  console.log(`- ok: ${finalReport.ok ? 'true' : 'false'}`);
  console.log(`- reason: ${finalReport.reason}`);
  console.log(`- attempts: ${finalReport.attempts || 1}`);
  console.log(`- cookies: sessionid=${finalReport.diagnostics.hasSessionCookie ? 'yes' : 'no'}, csrftoken=${finalReport.diagnostics.hasCsrfCookie ? 'yes' : 'no'}, total=${finalReport.diagnostics.cookieCount}`);
  if (clearedFiles.length) console.log(`- cleared: ${clearedFiles.join(', ')}`);
  if (slackNotified) console.log('- slack: warning sent');
  else if (!finalReport.ok) console.log('- slack: warning not sent or suppressed');
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  main().catch((error) => {
    console.error(`Instagram auth healthcheck crashed: ${error.message}`);
    process.exit(1);
  });
}

import '../sentry/instrument.mjs';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { chromium } from 'playwright';
import { fetchInstagramCodeFromGmail, gmailInstagramCodeConfigured } from './lib/gmail-instagram-code.mjs';

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, '.env');
const INSTAGRAM_HOME = 'https://www.instagram.com/';
const INSTAGRAM_LOGIN = 'https://www.instagram.com/accounts/login/';
const INSTAGRAM_APP_ID = '936619743392459';
const DEFAULT_TEST_USERNAME = 'instagram';
const COOKIE_ORDER = [
  'sessionid',
  'csrftoken',
  'ds_user_id',
  'ig_did',
  'mid',
  'rur',
  'datr',
  'wd',
  'ps_l',
  'ps_n',
];
const USERNAME_SELECTORS = [
  'input[name="username"]',
  'input[autocomplete="username"]',
  'input[aria-label*="Phone"]',
  'input[aria-label*="Telefon"]',
  'input[aria-label*="Benutzer"]',
  'input[type="text"]',
];
const PASSWORD_SELECTORS = [
  'input[name="password"]',
  'input[autocomplete="current-password"]',
  'input[type="password"]',
];
const INSTAGRAM_PROMPT_BUTTONS = [
  'Nur erforderliche Cookies erlauben',
  'Allow essential cookies',
  'Ablehnen',
  'Decline optional cookies',
  'Jetzt nicht',
  'Nicht jetzt',
  'Not now',
  'Später',
  'Skip',
  'Weiter',
  'Continue',
  'Fortfahren',
];

class InstagramRefreshError extends Error {
  constructor(status, message, details = {}) {
    super(message);
    this.name = 'InstagramRefreshError';
    this.status = status;
    this.details = details;
  }
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function safePageUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.origin}${parsed.pathname}${parsed.search ? '?...' : ''}`;
  } catch {
    return String(rawUrl || '');
  }
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

function mask(value) {
  const text = cleanText(value);
  if (text && process.env.GITHUB_ACTIONS) {
    console.log(`::add-mask::${text}`);
  }
}

function requireEnv(name, fallbackName = '') {
  const value = cleanText(env[name] || (fallbackName ? env[fallbackName] : ''));
  if (!value) throw new Error(`${name}${fallbackName ? `/${fallbackName}` : ''} fehlt`);
  mask(value);
  return value;
}

function base32ToBuffer(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const normalized = cleanText(secret).replace(/=+$/g, '').replace(/\s+/g, '').toUpperCase();
  let bits = '';
  for (const char of normalized) {
    const value = alphabet.indexOf(char);
    if (value < 0) continue;
    bits += value.toString(2).padStart(5, '0');
  }

  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function generateTotp(secret, now = Date.now()) {
  const key = base32ToBuffer(secret);
  if (key.length === 0) throw new Error('INSTAGRAM_TOTP_SECRET ist kein gültiger Base32-Secret');

  const counter = Math.floor(now / 1000 / 30);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuffer.writeUInt32BE(counter >>> 0, 4);

  const hmac = crypto.createHmac('sha1', key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24)
    | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8)
    | (hmac[offset + 3] & 0xff);
  return String(binary % 1000000).padStart(6, '0');
}

async function clickFirstVisible(page, selectors, timeout = 700) {
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      if (await locator.isVisible({ timeout })) {
        await locator.click({ timeout: 1500 });
        await page.waitForTimeout(350);
        return true;
      }
    } catch {
      // Try next selector.
    }
  }
  return false;
}

async function clickButtonByText(page, labels, timeout = 700) {
  for (const label of labels) {
    try {
      const locator = page.getByRole('button', { name: label }).first();
      if (await locator.isVisible({ timeout })) {
        await locator.click({ timeout: 1500 });
        await page.waitForTimeout(350);
        return true;
      }
    } catch {
      // Try next label.
    }
  }
  return false;
}

async function dismissInstagramPrompts(page) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const clicked = await clickButtonByText(page, INSTAGRAM_PROMPT_BUTTONS);
    if (!clicked) break;
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(700);
  }
  try {
    await page.keyboard.press('Escape');
  } catch {
    // Ignore.
  }
}

async function firstVisibleLocator(page, selectors, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      try {
        const locator = page.locator(selector).first();
        if (await locator.isVisible({ timeout: 400 })) return locator;
      } catch {
        // Try next selector.
      }
    }
    await page.waitForTimeout(500);
  }
  return null;
}

async function diagnosePage(page) {
  const snapshot = await page.evaluate(() => ({
    title: document.title || '',
    url: location.href,
    body: document.body?.innerText?.slice(0, 600) || '',
  })).catch(() => ({ title: '', url: page.url(), body: '' }));
  return `${snapshot.title || 'ohne Titel'} @ ${safePageUrl(snapshot.url)}: ${cleanText(snapshot.body).slice(0, 240)}`;
}

async function openLoginPage(page) {
  const urls = [
    `${INSTAGRAM_LOGIN}?hl=en`,
    `${INSTAGRAM_LOGIN}?next=%2F&hl=en`,
    INSTAGRAM_HOME,
  ];

  for (const url of urls) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await dismissInstagramPrompts(page);
    if (await firstVisibleLocator(page, USERNAME_SELECTORS, 2500)) return;
    await clickButtonByText(page, ['Log in', 'Einloggen', 'Anmelden'], 900);
    if (await firstVisibleLocator(page, USERNAME_SELECTORS, 2500)) return;
  }
}

async function fillLoginForm(page, username, password) {
  await openLoginPage(page);

  const usernameInput = await firstVisibleLocator(page, USERNAME_SELECTORS, 20000);
  const passwordInput = await firstVisibleLocator(page, PASSWORD_SELECTORS, 10000);
  if (!usernameInput || !passwordInput) {
    throw new Error(`Instagram Login-Formular nicht gefunden: ${await diagnosePage(page)}`);
  }

  await usernameInput.fill(username, { timeout: 10000 });
  await passwordInput.fill(password, { timeout: 10000 });
  return { usernameInput, passwordInput };
}

async function hasSessionCookie(context) {
  const cookies = await collectInstagramCookies(context);
  return cookies.some((cookie) => cookie.name === 'sessionid' && cookie.value);
}

async function loginFormVisible(page) {
  return Boolean(await firstVisibleLocator(page, PASSWORD_SELECTORS, 900));
}

async function waitForLoginAttemptResult(page, context, timeout = 9000) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    if (await hasSessionCookie(context)) return 'session';
    if (await twoFactorInputVisible(page)) return 'transition';
    if (await emailCodeChallengeVisible(page)) return 'transition';

    const blockingState = await detectBlockingState(page);
    if (blockingState) throw new Error(blockingState);

    const stillOnLogin = /\/accounts\/login/i.test(page.url()) && await loginFormVisible(page);
    if (!stillOnLogin) return 'transition';

    await page.waitForTimeout(700);
  }

  return '';
}

async function submitLoginForm(page, context, passwordInput) {
  const submitAttempts = [
    {
      label: 'submit button',
      run: () => clickFirstVisible(page, ['button[type="submit"]'], 3500),
    },
    {
      label: 'login button text',
      run: () => clickButtonByText(page, ['Log in', 'Einloggen', 'Anmelden'], 2500),
    },
    {
      label: 'password enter',
      run: async () => {
        await passwordInput.press('Enter');
        return true;
      },
    },
    {
      label: 'form requestSubmit',
      run: () => page.evaluate(() => {
        const password = document.querySelector('input[type="password"]');
        const form = password?.closest('form');
        const submit = form?.querySelector('button[type="submit"]');
        if (submit instanceof HTMLElement) {
          submit.click();
          return true;
        }
        if (typeof form?.requestSubmit === 'function') {
          form.requestSubmit();
          return true;
        }
        return false;
      }),
    },
  ];

  for (const attempt of submitAttempts) {
    console.log(`Instagram login submit: ${attempt.label}`);
    const submitted = await attempt.run().catch(() => false);
    if (!submitted) continue;

    await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
    const result = await waitForLoginAttemptResult(page, context);
    if (result) return result;
  }

  throw new Error(`Instagram Login wurde nicht akzeptiert: ${await diagnosePage(page)}`);
}

async function handleTwoFactor(page) {
  const totpSecret = cleanText(env.INSTAGRAM_TOTP_SECRET);
  const codeInput = twoFactorInput(page);
  const visible = await twoFactorInputVisible(page);

  if (!visible) return false;
  if (!totpSecret) {
    throw new Error('Instagram fragt 2FA ab, aber INSTAGRAM_TOTP_SECRET fehlt');
  }

  const code = generateTotp(totpSecret);
  mask(code);
  await codeInput.fill(code);
  await Promise.all([
    page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {}),
    clickButtonByText(page, ['Confirm', 'Bestätigen', 'Weiter', 'Next'], 1500),
  ]);
  await page.waitForTimeout(3500);
  return true;
}

async function handleEmailCodeChallenge(page) {
  if (!await emailCodeChallengeVisible(page)) return false;

  let code = cleanText(env.INSTAGRAM_EMAIL_CODE);
  if (!code && gmailInstagramCodeConfigured(env)) {
    console.log('Instagram email challenge: fetching code via Gmail API');
    code = await fetchInstagramCodeFromGmail({ env, sinceMs: Date.now() - 15000 });
  }

  if (!code) {
    throw new Error('Instagram verlangt einen E-Mail-Bestätigungscode. Konfiguriere die Gmail API Secrets oder das Repository Secret INSTAGRAM_EMAIL_CODE.');
  }

  mask(code);
  const input = page.locator('input[autocomplete="one-time-code"], input[inputmode="numeric"], input[type="tel"], input[type="text"]').first();
  await input.fill(code, { timeout: 10000 });
  await Promise.all([
    page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {}),
    clickButtonByText(page, ['Weiter', 'Continue', 'Confirm', 'Bestätigen', 'Submit'], 2500),
  ]);
  await page.waitForTimeout(3500);
  return true;
}

function twoFactorInput(page) {
  return page.locator('input[name="verificationCode"], input[autocomplete="one-time-code"], input[type="tel"]').first();
}

async function twoFactorInputVisible(page) {
  try {
    return await twoFactorInput(page).isVisible({ timeout: 700 });
  } catch {
    return false;
  }
}

async function emailCodeChallengeVisible(page) {
  if (/\/auth_platform\/codeentry/i.test(page.url())) return true;
  const bodyText = await page.locator('body').innerText({ timeout: 1000 }).catch(() => '');
  return /sieh in deinen e-mails nach|check your email|email.*code|code.*email|gib den code/i.test(cleanText(bodyText));
}

async function detectBlockingState(page) {
  const currentUrl = page.url();
  if (/\/challenge\/|\/checkpoint\/|two_factor|suspended|disabled/i.test(currentUrl)) {
    return `Instagram Challenge/Verifizierung erkannt (${safePageUrl(currentUrl)})`;
  }

  const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  const signal = cleanText(bodyText).toLowerCase();
  if (!signal) return '';

  if (/challenge|required|confirm it'?s you|suspicious|help us confirm|verify your account|bestätige|verdächtig|verification code|security code|two-factor|authentifizierung|sicherheitscode/.test(signal)) {
    return 'Instagram Challenge/Verifizierung erkannt';
  }
  if (/incorrect|falsch|passwort.*falsch|wrong password|invalid/.test(signal)) {
    return 'Instagram Login-Daten wurden abgelehnt';
  }
  return '';
}

async function collectInstagramCookies(context) {
  const cookies = await context.cookies(INSTAGRAM_HOME);
  return sortCookies(
    cookies.filter((cookie) => cookie.name && cookie.value && /(^|\.)instagram\.com$/i.test(cookie.domain || '.instagram.com'))
  );
}

function cookieDiagnostics(cookies) {
  const cookieNames = cookies.map((cookie) => cookie.name);
  return {
    cookieCount: cookies.length,
    cookieNames,
    hasSessionCookie: cookieNames.includes('sessionid'),
    hasCsrfCookie: cookieNames.includes('csrftoken'),
  };
}

async function waitForSessionCookie(context, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let cookies = [];

  while (Date.now() < deadline) {
    cookies = await collectInstagramCookies(context);
    if (cookies.some((cookie) => cookie.name === 'sessionid' && cookie.value)) {
      return cookies;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return cookies;
}

async function validateBrowserSession(page) {
  const username = cleanText(env.INSTAGRAM_AUTH_TEST_USERNAME) || DEFAULT_TEST_USERNAME;
  await page.goto(INSTAGRAM_HOME, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1000);

  const result = await page.evaluate(async ({ username, appId }) => {
    try {
      const response = await fetch(`/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`, {
        credentials: 'include',
        headers: {
          'X-IG-App-ID': appId,
          'X-Requested-With': 'XMLHttpRequest',
          Accept: '*/*',
        },
      });
      const text = await response.text();
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
      return {
        ok: response.ok,
        status: response.status,
        username: parsed?.data?.user?.username || '',
        bodySample: text.slice(0, 300),
        retryAfter: response.headers.get('retry-after') || '',
      };
    } catch (error) {
      return { ok: false, status: 0, username: '', bodySample: String(error?.message || error || '') };
    }
  }, { username, appId: INSTAGRAM_APP_ID });

  if (!result.ok || !result.username) {
    if (result.status === 429 || /please wait|try again later/i.test(result.bodySample)) {
      throw new InstagramRefreshError(
        'rate-limited',
        `Instagram Auth-Validierung wurde rate-limited (HTTP ${result.status || 429})`,
        { httpStatus: result.status || 429, retryAfter: cleanText(result.retryAfter) },
      );
    }

    const status = result.status === 401 || /login|log in|anmelden/i.test(result.bodySample)
      ? 'login-wall'
      : 'validation-failed';
    throw new InstagramRefreshError(
      status,
      `Instagram Auth-Validierung fehlgeschlagen (HTTP ${result.status}): ${cleanText(result.bodySample).slice(0, 160)}`,
      { httpStatus: result.status || 0 },
    );
  }

  return result;
}

function sortCookies(cookies) {
  return cookies.slice().sort((left, right) => {
    const leftIdx = COOKIE_ORDER.indexOf(left.name);
    const rightIdx = COOKIE_ORDER.indexOf(right.name);
    if (leftIdx !== rightIdx) {
      if (leftIdx < 0) return 1;
      if (rightIdx < 0) return -1;
      return leftIdx - rightIdx;
    }
    return left.name.localeCompare(right.name);
  });
}

async function extractCookieOutput(context) {
  const instagramCookies = await collectInstagramCookies(context);
  const session = instagramCookies.find((cookie) => cookie.name === 'sessionid');
  const csrf = instagramCookies.find((cookie) => cookie.name === 'csrftoken');

  if (!session?.value) throw new Error('Login erfolgreich, aber sessionid Cookie fehlt');
  if (!csrf?.value) throw new Error('Login erfolgreich, aber csrftoken Cookie fehlt');

  const cookieString = instagramCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
  mask(cookieString);
  mask(session.value);

  return {
    cookieString,
    sessionId: session.value,
    diagnostics: cookieDiagnostics(instagramCookies),
  };
}

function writeSecretFiles(output) {
  const outDir = process.env.RUNNER_TEMP || path.join(ROOT, '.tmp');
  fs.mkdirSync(outDir, { recursive: true });

  const cookiesPath = path.join(outDir, 'instagram-cookies.txt');
  const sessionPath = path.join(outDir, 'instagram-sessionid.txt');
  fs.writeFileSync(cookiesPath, output.cookieString);
  fs.writeFileSync(sessionPath, output.sessionId);
  fs.chmodSync(cookiesPath, 0o600);
  fs.chmodSync(sessionPath, 0o600);

  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    fs.appendFileSync(githubOutput, `cookies_path=${cookiesPath}\n`);
    fs.appendFileSync(githubOutput, `sessionid_path=${sessionPath}\n`);
    fs.appendFileSync(githubOutput, `ok=true\n`);
  }

  return { cookiesPath, sessionPath };
}

function writeReport(report) {
  const reportPath = cleanText(env.INSTAGRAM_COOKIE_REFRESH_REPORT_PATH);
  if (!reportPath) return;
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function writeGithubStatus(report) {
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    fs.appendFileSync(githubOutput, `ok=${report.ok ? 'true' : 'false'}\n`);
    fs.appendFileSync(githubOutput, `status=${report.status}\n`);
    fs.appendFileSync(githubOutput, `should_retry_login=${report.shouldRetryLogin ? 'true' : 'false'}\n`);
  }

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    fs.appendFileSync(summaryPath, [
      '### Instagram Cookie Refresh',
      '',
      `- Status: ${report.status}`,
      `- Login attempted: ${report.loginAttempted ? 'yes' : 'no'}`,
      `- Retry login: ${report.shouldRetryLogin ? 'yes' : 'no'}`,
      ...(report.reason ? [`- Reason: ${report.reason}`] : []),
      '',
    ].join('\n'));
  }
}

function refreshPermission() {
  const eventName = cleanText(process.env.GITHUB_EVENT_NAME).toLowerCase();
  const reason = cleanText(env.INSTAGRAM_COOKIE_REFRESH_REASON).toLowerCase();
  const manual = !process.env.GITHUB_ACTIONS || eventName === 'workflow_dispatch';
  const authFailure = ['login-wall', 'invalid-session', 'missing-session', 'blocked'].includes(reason);
  const automatedAllowed = env.INSTAGRAM_COOKIE_REFRESH_ALLOW_AUTOMATED === '1' && authFailure;

  if (manual || automatedAllowed) {
    return { allowed: true, eventName: eventName || 'local', reason: reason || (manual ? 'manual' : 'auth-failure') };
  }

  return {
    allowed: false,
    eventName: eventName || 'unknown',
    reason: eventName === 'schedule'
      ? 'scheduled-refresh-disabled'
      : 'refresh-requires-manual-run-or-confirmed-auth-failure',
  };
}

function classifyRefreshFailure(error) {
  if (error instanceof InstagramRefreshError) {
    return {
      status: error.status,
      reason: error.message,
      details: error.details,
    };
  }

  const reason = cleanText(error?.message || error);
  if (/rate.?limit|http 429|please wait|try again later/i.test(reason)) {
    return { status: 'rate-limited', reason, details: {} };
  }
  if (/challenge|verifizierung|verification|checkpoint/i.test(reason)) {
    return { status: 'blocked', reason, details: {} };
  }
  if (/login-daten|wrong password|passwort.*falsch|invalid-session/i.test(reason)) {
    return { status: 'invalid-session', reason, details: {} };
  }
  return { status: 'failed', reason, details: {} };
}

async function main() {
  const permission = refreshPermission();
  if (!permission.allowed) {
    const report = {
      updatedAt: new Date().toISOString(),
      ok: false,
      status: 'manual-only',
      reason: permission.reason,
      eventName: permission.eventName,
      loginAttempted: false,
      shouldRetryLogin: false,
    };
    writeReport(report);
    writeGithubStatus(report);
    console.log('Instagram cookie refresh: skipped');
    console.log(`- reason: ${report.reason}`);
    console.log('- no login request was sent to Instagram');
    return;
  }

  const username = requireEnv('INSTAGRAM_USERNAME', 'IG_USERNAME');
  const password = requireEnv('INSTAGRAM_PASSWORD', 'IG_PASSWORD');
  const headless = cleanText(env.INSTAGRAM_COOKIE_REFRESH_HEADLESS || '1') !== '0';

  console.log('Instagram cookie refresh: starting login');
  console.log(`- username: ${username}`);
  console.log(`- headless: ${headless ? 'true' : 'false'}`);

  const browser = await chromium.launch({
    headless,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 1366, height: 900 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      locale: 'de-AT',
      timezoneId: 'Europe/Vienna',
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    const { passwordInput } = await fillLoginForm(page, username, password);
    await submitLoginForm(page, context, passwordInput);
    await handleTwoFactor(page);
    await handleEmailCodeChallenge(page);
    await dismissInstagramPrompts(page);

    const blockingState = await detectBlockingState(page);
    if (blockingState) throw new Error(blockingState);

    const sessionCookies = await waitForSessionCookie(context);
    if (!sessionCookies.some((cookie) => cookie.name === 'sessionid' && cookie.value)) {
      const diagnostics = cookieDiagnostics(sessionCookies);
      throw new Error(`Instagram hat keinen sessionid Cookie gesetzt: ${await diagnosePage(page)}; Cookies: ${diagnostics.cookieNames.join(', ') || 'keine'}`);
    }

    const validation = await validateBrowserSession(page);
    const output = await extractCookieOutput(context);
    const files = writeSecretFiles(output);

    writeReport({
      updatedAt: new Date().toISOString(),
      ok: true,
      status: 'ok',
      reason: permission.reason,
      eventName: permission.eventName,
      loginAttempted: true,
      shouldRetryLogin: false,
      validation,
      diagnostics: output.diagnostics,
    });

    writeGithubStatus({
      ok: true,
      status: 'ok',
      loginAttempted: true,
      shouldRetryLogin: false,
    });

    console.log('Instagram cookie refresh: ok');
    console.log(`- validation profile: ${validation.username}`);
    console.log(`- cookies: ${output.diagnostics.cookieNames.join(', ')}`);
    console.log(`- cookies path: ${files.cookiesPath}`);
    console.log(`- session path: ${files.sessionPath}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  const failure = classifyRefreshFailure(error);
  const shouldRetryLogin = ['login-wall', 'invalid-session', 'blocked'].includes(failure.status);
  const report = {
    updatedAt: new Date().toISOString(),
    ok: false,
    status: failure.status,
    reason: failure.reason,
    loginAttempted: true,
    shouldRetryLogin,
    ...failure.details,
  };
  writeReport(report);
  writeGithubStatus(report);
  console.error(`Instagram cookie refresh failed [${failure.status}]: ${failure.reason}`);
  process.exit(1);
});

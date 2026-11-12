import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { fetchInstagramCodeFromGmail, gmailInstagramCodeConfigured } from './lib/gmail-instagram-code.mjs';
import { instagramLoginCredentials, instagramLoginPageState, workflowMaskValue } from './lib/instagram-login-policy.mjs';

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, '.env');
const INSTAGRAM_HOME = 'https://www.instagram.com/';
const INSTAGRAM_LOGIN = 'https://www.instagram.com/accounts/login/';
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
  const text = String(value || '');
  if (text && process.env.GITHUB_ACTIONS) {
    console.log(`::add-mask::${workflowMaskValue(text)}`);
  }
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

async function clickButtonByText(page, labels, timeout = 700) {
  for (const label of labels) {
    try {
      const locator = page.getByRole('button', { name: label, exact: true }).first();
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

async function pageLoginState(page) {
  const body = await page.locator('body').innerText({ timeout: 1500 }).catch(() => '');
  return instagramLoginPageState(page.url(), body);
}

export async function diagnosePage(page) {
  // Do not persist page text: challenge pages can contain email addresses and codes.
  return `state=${await pageLoginState(page)}; loginForm=${await loginFormVisible(page)}`;
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

export async function fillLoginForm(page, username, password, { openPage = true } = {}) {
  if (openPage) await openLoginPage(page);

  const usernameInput = await firstVisibleLocator(page, USERNAME_SELECTORS, 20000);
  const passwordInput = await firstVisibleLocator(page, PASSWORD_SELECTORS, 10000);
  if (!usernameInput || !passwordInput) {
    throw new Error(`Instagram Login-Formular nicht gefunden: ${await diagnosePage(page)}`);
  }

  try {
    await usernameInput.fill(username, { timeout: 10000 });
    await passwordInput.fill(password, { timeout: 10000 });
    if (await usernameInput.inputValue() !== username || await passwordInput.inputValue() !== password) {
      throw new Error('input mismatch');
    }
  } catch {
    throw new InstagramRefreshError('form-mismatch', 'Instagram-Eingabefelder stimmen nicht mit den konfigurierten Werten überein; kein Login gesendet.');
  }
  console.log('Instagram login fields verified: username=true; password=true');
  return { usernameInput, passwordInput };
}

async function hasSessionCookie(context) {
  const cookies = await collectInstagramCookies(context);
  return cookies.some((cookie) => cookie.name === 'sessionid' && cookie.value);
}

async function loginFormVisible(page) {
  return Boolean(await firstVisibleLocator(page, PASSWORD_SELECTORS, 900));
}

export async function waitForLoginAttemptResult(page, context, timeout = 15000) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    if (await hasSessionCookie(context)) return 'session';
    if (await emailCodeChallengeVisible(page)) return 'email-code';
    if (await twoFactorInputVisible(page)) return 'two-factor';

    const blockingState = await detectBlockingState(page);
    if (blockingState) throw blockingState;

    await page.waitForTimeout(700);
  }

  throw new InstagramRefreshError('login-unconfirmed', `Instagram hat den einmaligen Login noch nicht bestätigt (${await diagnosePage(page)}). Kein automatischer Neuversuch.`);
}

export async function submitLoginForm(page, context, passwordInput, { resultTimeout = 15000 } = {}) {
  const form = passwordInput.locator('xpath=ancestor::form[1]');
  const scope = await form.count() ? form : page;
  const loginButton = scope.getByRole('button', { name: /^(Log in|Einloggen|Anmelden)$/i }).first();
  const submitButton = form.locator('button[type="submit"]').first();
  // Choose before clicking. A timeout after a click may already have sent credentials.
  try {
    if (await loginButton.isVisible()) await loginButton.click({ timeout: 5000 });
    else if (await submitButton.isVisible()) await submitButton.click({ timeout: 5000 });
    else await passwordInput.press('Enter', { timeout: 5000 });
  } catch {
    throw new InstagramRefreshError('login-unconfirmed', 'Instagram-Login konnte nicht eindeutig bestätigt werden; kein weiterer Submit.');
  }
  console.log('Instagram login submit: one attempt');
  return waitForLoginAttemptResult(page, context, resultTimeout);
}

async function handleTwoFactor(page) {
  const totpSecret = cleanText(env.INSTAGRAM_TOTP_SECRET);
  const codeInput = twoFactorInput(page);
  const visible = await twoFactorInputVisible(page);

  if (!visible) return false;
  if (!totpSecret) {
    throw new InstagramRefreshError('blocked', 'Instagram fragt 2FA ab, aber INSTAGRAM_TOTP_SECRET fehlt');
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
    throw new InstagramRefreshError('blocked', 'Instagram verlangt einen E-Mail-Bestätigungscode. Konfiguriere die Gmail API Secrets oder das Repository Secret INSTAGRAM_EMAIL_CODE.');
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

export async function twoFactorInputVisible(page) {
  if (await pageLoginState(page) !== 'two-factor') return false;
  try {
    return await twoFactorInput(page).isVisible({ timeout: 700 });
  } catch {
    return false;
  }
}

export async function emailCodeChallengeVisible(page) {
  return await pageLoginState(page) === 'email-code';
}

async function detectBlockingState(page) {
  const state = await pageLoginState(page);
  if (state === 'login-rejected') return new InstagramRefreshError(state, 'Instagram lehnt diesen Server-Login ab. Das beweist bei erfolgreicher manueller Anmeldung kein falsches Passwort.');
  if (state === 'rate-limited') return new InstagramRefreshError(state, 'Instagram hat den Login gedrosselt; kein weiterer Versuch.');
  if (['challenge', 'email-code', 'two-factor'].includes(state)) return new InstagramRefreshError('blocked', 'Instagram Challenge/Verifizierung noch nicht abgeschlossen.');
  return null;
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

export async function validateBrowserSession(page, { username, expectedUserId = '', timeout = 20000 } = {}) {
  if (!/^[a-z0-9._]{1,30}$/i.test(username || '')) throw new InstagramRefreshError('wrong-account', 'Erwartetes Scraper-Konto fehlt; keine Secrets aktualisiert.');
  const targetPath = `/${username.toLowerCase()}/`;
  // Ordinary own-profile UI, not the obsolete private web_profile_info endpoint.
  const response = await page.goto(`${INSTAGRAM_HOME}${username}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  if (response && response.status() >= 400) throw new InstagramRefreshError(response.status() === 429 ? 'rate-limited' : 'validation-failed', `Instagram Profilprüfung fehlgeschlagen (HTTP ${response.status()}); keine Secrets aktualisiert.`);
  const editProfile = page.getByRole('link', { name: /^(Edit profile|Profil bearbeiten)$/i }).first();
  const editButton = page.getByRole('button', { name: /^(Edit profile|Profil bearbeiten)$/i }).first();
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const current = new URL(page.url());
    const exactProfile = current.origin === 'https://www.instagram.com' && `${current.pathname.replace(/\/$/, '').toLowerCase()}/` === targetPath;
    const cookies = await collectInstagramCookies(page.context());
    const owner = cookies.find(cookie => cookie.name === 'ds_user_id')?.value;
    const sessionPresent = cookies.some(cookie => cookie.name === 'sessionid');
    if (exactProfile && owner && sessionPresent && (!expectedUserId || owner === expectedUserId)
      && (await editProfile.isVisible() || await editButton.isVisible())) {
      return { ok: true, method: 'own-profile-ui', accountMatched: true, username };
    }
    const blockingState = await detectBlockingState(page);
    if (blockingState) throw blockingState;
    await page.waitForTimeout(500);
  }
  throw new InstagramRefreshError('wrong-account', 'Eigene Profilansicht des erwarteten Scraper-Kontos nicht bestätigt; keine Secrets aktualisiert.');
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

export async function extractCookieOutput(context) {
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
  fs.writeFileSync(cookiesPath, output.cookieString, { mode: 0o600 });
  fs.writeFileSync(sessionPath, output.sessionId, { mode: 0o600 });
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

export function classifyRefreshFailure(error) {
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

  const { username, password } = instagramLoginCredentials(env);
  mask(username);
  mask(password);
  const headless = cleanText(env.INSTAGRAM_COOKIE_REFRESH_HEADLESS || '1') !== '0';

  console.log('Instagram cookie refresh: starting login');
  console.log(`- headless: ${headless ? 'true' : 'false'}`);

  const browser = await chromium.launch({
    headless,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 1366, height: 900 },
      locale: 'de-AT',
      timezoneId: 'Europe/Vienna',
    });
    const page = await context.newPage();
    const { passwordInput } = await fillLoginForm(page, username, password);
    await submitLoginForm(page, context, passwordInput);
    await handleEmailCodeChallenge(page);
    await handleTwoFactor(page);
    await dismissInstagramPrompts(page);

    const blockingState = await detectBlockingState(page);
    if (blockingState) throw blockingState;

    const sessionCookies = await waitForSessionCookie(context);
    if (!sessionCookies.some((cookie) => cookie.name === 'sessionid' && cookie.value)) {
      const diagnostics = cookieDiagnostics(sessionCookies);
      throw new Error(`Instagram hat keinen sessionid Cookie gesetzt: ${await diagnosePage(page)}; Cookies: ${diagnostics.cookieNames.join(', ') || 'keine'}`);
    }

    const validation = await validateBrowserSession(page, { username });
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => {
  const failure = classifyRefreshFailure(error);
  const shouldRetryLogin = false;
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

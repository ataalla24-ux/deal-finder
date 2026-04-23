import '../sentry/instrument.mjs';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { chromium } from 'playwright';

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
  await clickButtonByText(page, [
    'Nur erforderliche Cookies erlauben',
    'Allow essential cookies',
    'Ablehnen',
    'Decline optional cookies',
    'Jetzt nicht',
    'Not now',
    'Später',
    'Skip',
  ]);
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
  return `${snapshot.title || 'ohne Titel'} @ ${snapshot.url}: ${cleanText(snapshot.body).slice(0, 240)}`;
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
  await Promise.all([
    page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {}),
    clickFirstVisible(page, ['button[type="submit"]'], 2000),
  ]);
  await page.waitForTimeout(2500);
}

async function handleTwoFactor(page) {
  const totpSecret = cleanText(env.INSTAGRAM_TOTP_SECRET);
  const codeInput = page.locator('input[name="verificationCode"], input[autocomplete="one-time-code"], input[type="tel"]').first();
  let visible = false;
  try {
    visible = await codeInput.isVisible({ timeout: 2500 });
  } catch {
    visible = false;
  }

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

async function detectBlockingState(page) {
  const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  const signal = cleanText(bodyText).toLowerCase();
  if (!signal) return '';

  if (/challenge|required|confirm it'?s you|suspicious|help us confirm|verify your account|bestätige|verdächtig/.test(signal)) {
    return 'Instagram Challenge/Verifizierung erkannt';
  }
  if (/incorrect|falsch|passwort.*falsch|wrong password|invalid/.test(signal)) {
    return 'Instagram Login-Daten wurden abgelehnt';
  }
  return '';
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
      };
    } catch (error) {
      return { ok: false, status: 0, username: '', bodySample: String(error?.message || error || '') };
    }
  }, { username, appId: INSTAGRAM_APP_ID });

  if (!result.ok || !result.username) {
    throw new Error(`Instagram Auth-Validierung fehlgeschlagen (HTTP ${result.status}): ${cleanText(result.bodySample).slice(0, 160)}`);
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
  const cookies = await context.cookies(INSTAGRAM_HOME);
  const instagramCookies = sortCookies(
    cookies.filter((cookie) => cookie.name && cookie.value && /(^|\.)instagram\.com$/i.test(cookie.domain || '.instagram.com'))
  );
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
    diagnostics: {
      cookieCount: instagramCookies.length,
      cookieNames: instagramCookies.map((cookie) => cookie.name),
      hasSessionCookie: true,
      hasCsrfCookie: true,
    },
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

async function main() {
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

    await fillLoginForm(page, username, password);
    await handleTwoFactor(page);
    await dismissInstagramPrompts(page);

    const blockingState = await detectBlockingState(page);
    if (blockingState) throw new Error(blockingState);

    const validation = await validateBrowserSession(page);
    const output = await extractCookieOutput(context);
    const files = writeSecretFiles(output);

    writeReport({
      updatedAt: new Date().toISOString(),
      ok: true,
      status: 'ok',
      validation,
      diagnostics: output.diagnostics,
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
  writeReport({
    updatedAt: new Date().toISOString(),
    ok: false,
    status: 'failed',
    reason: error.message,
  });
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    fs.appendFileSync(githubOutput, 'ok=false\n');
  }
  console.error(`Instagram cookie refresh failed: ${error.message}`);
  process.exit(1);
});

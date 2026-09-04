import fs from 'node:fs';

const COOKIE_NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;

function clean(value) {
  return String(value || '').trim();
}

function normalizeDomain(value) {
  const domain = clean(value)
    .replace(/^#HttpOnly_/i, '')
    .replace(/^https?:\/\//i, '')
    .split('/')[0];
  return /(?:^|\.)instagram\.com$/i.test(domain) ? domain : '.instagram.com';
}

function addCookie(target, name, value, domain = '.instagram.com') {
  const normalizedName = clean(name);
  const normalizedValue = clean(value);
  if (!COOKIE_NAME_PATTERN.test(normalizedName) || !normalizedValue) return;
  target.set(normalizedName, {
    name: normalizedName,
    value: normalizedValue,
    domain: normalizeDomain(domain),
  });
}

function parseCookieLine(target, line) {
  const trimmed = clean(line);
  if (!trimmed || (trimmed.startsWith('#') && !trimmed.startsWith('#HttpOnly_'))) return;

  // Common browser exports use either name/value/domain TSV or Netscape's
  // domain/flags/path/secure/expiry/name/value layout.
  if (trimmed.includes('\t')) {
    const columns = trimmed.split('\t').map(clean);
    if (columns.length >= 7 && /(?:^|\.)instagram\.com$/i.test(columns[0].replace(/^#HttpOnly_/i, ''))) {
      addCookie(target, columns[5], columns[6], columns[0]);
      return;
    }
    if (columns.length >= 2) {
      addCookie(target, columns[0], columns[1], columns[2]);
      return;
    }
  }

  for (const part of trimmed.replace(/^cookie:\s*/i, '').split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    addCookie(target, part.slice(0, separator), part.slice(separator + 1));
  }
}

export function parseInstagramCookies(value) {
  const cookies = new Map();
  for (const line of String(value || '').split(/\r?\n/)) parseCookieLine(cookies, line);
  return [...cookies.values()];
}

export function loadInstagramCookieHints(env = process.env, options = {}) {
  const cookies = new Map();
  for (const source of [env.APIFY_INSTAGRAM_COOKIE_STRING, env.INSTAGRAM_COOKIES]) {
    for (const cookie of parseInstagramCookies(source)) {
      addCookie(cookies, cookie.name, cookie.value, cookie.domain);
    }
  }

  const cookieFile = clean(env.INSTAGRAM_COOKIES_FILE);
  if (cookieFile) {
    try {
      const fileContents = (options.fsImpl || fs).readFileSync(cookieFile, 'utf8');
      for (const cookie of parseInstagramCookies(fileContents)) {
        addCookie(cookies, cookie.name, cookie.value, cookie.domain);
      }
    } catch {
      // A missing optional local file should not disable public discovery.
    }
  }

  // The explicit session value is authoritative when both inputs contain it.
  addCookie(cookies, 'sessionid', env.INSTAGRAM_SESSIONID || env.APIFY_INSTAGRAM_SESSIONID);
  return [...cookies.values()];
}

export function instagramCookieHeader(cookies) {
  return (Array.isArray(cookies) ? cookies : [])
    .filter((cookie) => COOKIE_NAME_PATTERN.test(clean(cookie?.name)) && clean(cookie?.value))
    .map((cookie) => `${clean(cookie.name)}=${clean(cookie.value)}`)
    .join('; ');
}

export function instagramPlaywrightCookies(cookies) {
  return (Array.isArray(cookies) ? cookies : []).map((cookie) => ({
    name: cookie.name,
    value: cookie.value,
    domain: normalizeDomain(cookie.domain),
    path: '/',
    secure: true,
    httpOnly: cookie.name === 'sessionid',
    sameSite: 'Lax',
  }));
}

export async function applyInstagramCookies(context, cookies) {
  const normalized = instagramPlaywrightCookies(cookies);
  if (normalized.length > 0) await context.addCookies(normalized);
  return normalized.length;
}

export function instagramAuthSummary(cookies) {
  const normalized = Array.isArray(cookies) ? cookies : [];
  return {
    cookieCount: normalized.length,
    authenticatedSession: normalized.some((cookie) => cookie?.name === 'sessionid' && clean(cookie?.value)),
  };
}

export function instagramAuthCircuitStatus(report = {}, now = new Date()) {
  if (report?.status !== 'rate-limited') {
    return { allowed: true, reason: '', nextRetryAt: '' };
  }
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const retryMs = Date.parse(report.nextRetryAt || '');
  if (Number.isFinite(retryMs) && retryMs > nowMs) {
    return {
      allowed: false,
      reason: 'auth-health-cooldown',
      nextRetryAt: new Date(retryMs).toISOString(),
    };
  }
  const updatedMs = Date.parse(report.updatedAt || '');
  const fallbackCooldownMs = Math.max(60, Number(report.cooldownSeconds || 21600)) * 1000;
  if (!Number.isFinite(retryMs) && Number.isFinite(updatedMs) && updatedMs + fallbackCooldownMs > nowMs) {
    return {
      allowed: false,
      reason: 'auth-health-cooldown',
      nextRetryAt: new Date(updatedMs + fallbackCooldownMs).toISOString(),
    };
  }
  return { allowed: true, reason: '', nextRetryAt: '' };
}

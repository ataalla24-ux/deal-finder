import '../sentry/instrument.mjs';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

import { normalizeCategoryForScraper } from './category-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const OUTPUT_PATH = path.join(DOCS_DIR, 'deals-pending-tiktok.json');
const REPORT_PATH = path.join(DOCS_DIR, 'tiktok-scanner-report.json');

const DAY_MS = 24 * 60 * 60 * 1000;
const CONFIG = {
  maxAgeDays: Number(process.env.TIKTOK_MAX_AGE_DAYS || 7),
  maxPostsToVisit: Number(process.env.TIKTOK_MAX_POSTS || 90),
  maxDeals: Number(process.env.TIKTOK_MAX_DEALS || 45),
  minScore: Number(process.env.TIKTOK_MIN_SCORE || 58),
};

const SEARCH_QUERIES = [
  'site:tiktok.com/@ wien gratis essen',
  'site:tiktok.com/@ wien gratis kaffee',
  'site:tiktok.com/@ wien gratis drink',
  'site:tiktok.com/@ wien gratis pizza burger kebab',
  'site:tiktok.com/@ wien neueröffnung gratis',
  'site:tiktok.com/@ wien opening free food',
  'site:tiktok.com/@ vienna free coffee',
  'site:tiktok.com/@ vienna free food',
  'site:tiktok.com/@ wien 1+1 restaurant',
  'site:tiktok.com/@ wien 2 für 1 essen',
  'site:tiktok.com/@ wien happy hour deal',
  'site:tiktok.com/@ wien rabatt gutschein',
  'site:tiktok.com/@ wien gratis probetraining',
  'site:tiktok.com/@ wien gratis goodie bag',
  'site:tiktok.com/@ wien kostenlos aktion',
  'site:tiktok.com/@ tiktok wien gratis',
];

const TIKTOK_API_KEYWORDS = [
  'wien gratis essen',
  'wien gratis kaffee',
  'wien gratis drink',
  'wien gratis pizza',
  'wien gratis burger',
  'wien gratis kebab',
  'wien döner gratis',
  'wien neueröffnung gratis',
  'wien opening free food',
  'vienna free coffee',
  'vienna free food',
  'wien 1+1 restaurant',
  'wien 2 für 1 essen',
  'wien happy hour deal',
  'wien rabatt gutschein',
  'wien gratis probetraining',
  'wien gratis goodie bag',
  'wien kostenlos aktion',
];

const VIENNA_PATTERNS = [
  /\bwien\b/i,
  /\bvienna\b/i,
  /\b1(?:0[1-9]0|1[0-9]0|2[0-3]0)\b/i,
  /\binnere stadt|leopoldstadt|landstraße|landstrasse|wieden|margareten|mariahilf|neubau|josefstadt|alsergrund|favoriten|meidling|hietzing|penzing|rudolfsheim|ottakring|hernals|währing|waehring|döbling|doebling|brigittenau|floridsdorf|donaustadt|liesing\b/i,
];

const CONFLICT_LOCATION_PATTERNS = [
  /\bgraz\b/i,
  /\blinz\b/i,
  /\bsalzburg\b/i,
  /\binnsbruck\b/i,
  /\bklagenfurt\b/i,
  /\bst\.?\s*pölten\b/i,
  /\bst\.?\s*poelten\b/i,
  /\btirol\b/i,
  /\bvorarlberg\b/i,
  /\bkärnten\b/i,
  /\bkaernten\b/i,
];

const STRONG_DEAL_PATTERNS = [
  /\bgratis\b/i,
  /\bkostenlos(?:e|er|es|en)?\b/i,
  /\bfree\b/i,
  /\b0\s*€/i,
  /\b1\s*\+\s*1\b/i,
  /\b2\s*(?:für|fuer)\s*1\b/i,
  /\bbogo\b/i,
  /\b\d{1,2}\s*%\s*(?:rabatt|discount|off)\b/i,
  /\b(?:rabatt|gutschein|coupon|voucher|deal|aktion|happy hour|goodie bag)\b/i,
  /\bneueröffnung|neueroeffnung|opening offer|opening deal\b/i,
];

const FALSE_POSITIVE_PATTERNS = [
  /\bgratis versand\b/i,
  /\bkostenlose lieferung\b/i,
  /\bfree shipping\b/i,
  /\bgewinnspiel\b/i,
  /\bverlosung\b/i,
  /\bjob\b/i,
  /\bwohnung\b/i,
  /\bhotelzimmer\b/i,
  /\bairbnb\b/i,
  /\bkostenlos stornieren\b/i,
  /\bthings to do\b/i,
  /\bwochenendtipps\b/i,
  /\bwir zeigen dir\b/i,
  /\bwir haben für euch\b/i,
  /\bgesammelt\b/i,
  /\bwas in wien geht\b/i,
];

const CATEGORY_RULES = [
  { category: 'kaffee', logo: '☕', pattern: /\b(kaffee|coffee|cafe|café|matcha|espresso|latte|cappuccino|drink|drinks|getränk|getraenk|bubble tea|boba)\b/i },
  { category: 'essen', logo: '🍽️', pattern: /\b(essen|food|restaurant|pizza|burger|kebab|kebap|döner|doener|sushi|ramen|brunch|croissant|wrap|falafel|eis|gelato|snack)\b/i },
  { category: 'fitness', logo: '💪', pattern: /\b(fitness|gym|probetraining|workout|yoga|pilates|training)\b/i },
  { category: 'beauty', logo: '💄', pattern: /\b(beauty|kosmetik|make.?up|parfum|goodie bag|haare|friseur|barber)\b/i },
  { category: 'kultur', logo: '🎟️', pattern: /\b(kino|ticket|museum|theater|konzert|festival|event|ausstellung|prater)\b/i },
  { category: 'shopping', logo: '🛍️', pattern: /\b(shop|store|shopping|sale|gutschein|coupon|rabattcode|fashion|sneaker)\b/i },
];

function cleanText(value = '', max = 1600) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function stableHash(value = '') {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
    hash >>>= 0;
  }
  return hash.toString(36);
}

function normalizeTikTokVideoUrl(value = '') {
  const raw = cleanText(value, 1200);
  if (!raw) return '';

  let candidate = raw;
  try {
    const parsed = new URL(raw);
    const redirect = parsed.searchParams.get('uddg') || parsed.searchParams.get('url') || parsed.searchParams.get('u');
    if (redirect) candidate = decodeURIComponent(redirect);
  } catch {}

  const decoded = candidate
    .replace(/\\u002F/g, '/')
    .replace(/&amp;/g, '&');
  const match = decoded.match(/https?:\/\/(?:www\.|m\.)?tiktok\.com\/@([A-Za-z0-9._-]{2,40})\/video\/(\d{8,30})/i);
  if (!match) return '';
  return `https://www.tiktok.com/@${match[1]}/video/${match[2]}`;
}

function hasViennaSignal(text) {
  const signal = cleanText(text, 2600);
  if (!VIENNA_PATTERNS.some((pattern) => pattern.test(signal))) return false;
  if (CONFLICT_LOCATION_PATTERNS.some((pattern) => pattern.test(signal))) return false;
  return true;
}

function hasStrongDealSignal(text) {
  const signal = cleanText(text, 2600);
  if (!STRONG_DEAL_PATTERNS.some((pattern) => pattern.test(signal))) return false;
  if (FALSE_POSITIVE_PATTERNS.some((pattern) => pattern.test(signal))) return false;
  return true;
}

function inferType(text) {
  if (/\b1\s*\+\s*1\b|\b2\s*(?:für|fuer)\s*1\b|\bbogo\b/i.test(text)) return 'bogo';
  if (/\bgratis\b|\bkostenlos|\bfree\b|\b0\s*€/i.test(text)) return 'gratis';
  return 'rabatt';
}

function inferCategoryAndLogo(text, type) {
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(text)) return { category: rule.category, logo: rule.logo };
  }
  if (type === 'gratis') return { category: 'gratis', logo: '🎁' };
  return { category: 'shopping', logo: '🎯' };
}

function extractBrand(text, accountHandle) {
  const signal = cleanText(text, 800);
  const patterns = [
    /\bbei\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß0-9&'. -]{2,45})/i,
    /\bvon\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß0-9&'. -]{2,45})/i,
    /^([A-ZÄÖÜ][A-Za-zÄÖÜäöüß0-9&'. -]{2,45})\s+(?:schenkt|gibt|macht|startet|eröffnet|eroeffnet)/i,
  ];
  for (const pattern of patterns) {
    const match = signal.match(pattern);
    if (match?.[1]) return cleanText(match[1], 80).replace(/[.!?:;].*$/, '').trim();
  }
  return accountHandle ? `@${accountHandle}` : 'TikTok Wien';
}

function buildOfferTitle(text, brand) {
  const signal = cleanText(text, 1200);
  const items = 'kaffee|coffee|drink|drinks|getränk|getraenk|pizza|burger|kebab|kebap|döner|doener|eis|gelato|ticket|kino|goodie bag|probetraining|brunch|croissant|matcha|boba|bubble tea';
  let match = signal.match(new RegExp(`\\b(?:gratis|kostenlos(?:e|er|es|en)?|free)\\s+(?:einen?|eine|ein)?\\s*(${items})`, 'i'));
  if (match) return `Gratis ${cleanText(match[1], 40).replace(/^./, (c) => c.toUpperCase())}${brand ? ` bei ${brand}` : ''}`;
  match = signal.match(new RegExp(`\\b(${items})\\s+(?:gratis|kostenlos(?:e|er|es|en)?|free)\\b`, 'i'));
  if (match) return `Gratis ${cleanText(match[1], 40).replace(/^./, (c) => c.toUpperCase())}${brand ? ` bei ${brand}` : ''}`;
  match = signal.match(/\b(1\s*\+\s*1|2\s*(?:für|fuer)\s*1|bogo)\b[^.!?]{0,55}/i);
  if (match) return cleanText(match[0], 90).replace(/\b2\s*fuer\s*1\b/i, '2 für 1');
  match = signal.match(/\b(\d{1,2})\s*%\s*(?:rabatt|discount|off)?[^.!?]{0,45}/i);
  if (match) return cleanText(match[0], 90);

  const first = signal
    .replace(/#[\w.äöüß-]+/gi, ' ')
    .replace(/@\w[\w.-]+/g, ' ')
    .split(/[.!?\n]/)[0]
    .trim();
  if (first.length >= 10 && first.length <= 92) return first;
  return `${brand || 'TikTok'} Angebot`;
}

function parseDateFromPost(data) {
  const candidates = [];
  const add = (source, value) => {
    const text = cleanText(value, 120);
    if (!text) return;
    if (/^\d{10}$/.test(text)) {
      candidates.push({ source, date: new Date(Number(text) * 1000) });
      return;
    }
    if (/^\d{13}$/.test(text)) {
      candidates.push({ source, date: new Date(Number(text)) });
      return;
    }
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) candidates.push({ source, date: parsed });
  };

  add('time.datetime', data.timeDateTime);
  add('jsonLd.uploadDate', data.jsonLdUploadDate);
  add('jsonLd.datePublished', data.jsonLdDatePublished);
  for (const createTime of data.createTimes || []) add('script.createTime', createTime);

  const valid = candidates.filter((item) => item.date instanceof Date && !Number.isNaN(item.date.getTime()));
  valid.sort((a, b) => b.date.getTime() - a.date.getTime());
  return valid[0] || null;
}

function ageDays(date) {
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / DAY_MS));
}

function isCurrentPost(date) {
  if (date.getTime() > Date.now() + 2 * 60 * 60 * 1000) return false;
  const age = ageDays(date);
  return age >= 0 && age <= CONFIG.maxAgeDays;
}

function endOfViennaDay(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day, 21, 59, 59, 999));
}

function parseExplicitOfferEndDate(text) {
  const signal = cleanText(text, 1600).toLowerCase();
  const year = new Date().getUTCFullYear();

  let match = signal.match(/\b(?:bis|gültig bis|gueltig bis|nur bis|noch bis)\s+(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/i);
  if (match) {
    const parsedYear = match[3] ? (Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3])) : year;
    return endOfViennaDay(parsedYear, Number(match[2]), Number(match[1]));
  }

  match = signal.match(/\b(?:von\s+)?(\d{1,2})\.\s*[-–]\s*(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/i);
  if (match) {
    const parsedYear = match[4] ? (Number(match[4]) < 100 ? 2000 + Number(match[4]) : Number(match[4])) : year;
    return endOfViennaDay(parsedYear, Number(match[3]), Number(match[2]));
  }

  match = signal.match(/\b(?:am|nur am)\s+(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/i);
  if (match) {
    const parsedYear = match[3] ? (Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3])) : year;
    return endOfViennaDay(parsedYear, Number(match[2]), Number(match[1]));
  }

  return null;
}

function endOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

function endOfWeekendForPost(postDate) {
  const day = postDate.getUTCDay();
  const daysUntilSunday = (7 - day) % 7;
  const sunday = new Date(Date.UTC(postDate.getUTCFullYear(), postDate.getUTCMonth(), postDate.getUTCDate() + daysUntilSunday, 23, 59, 59, 999));
  return sunday;
}

function firstSundayOfMonth(date) {
  const first = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 23, 59, 59, 999));
  const offset = (7 - first.getUTCDay()) % 7;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1 + offset, 23, 59, 59, 999));
}

function isExplicitlyExpired(text, postDate = null) {
  const signal = cleanText(text, 1600);
  const endDate = parseExplicitOfferEndDate(text);
  if (endDate && endDate.getTime() < Date.now() - 2 * 60 * 60 * 1000) return true;

  if (postDate instanceof Date && !Number.isNaN(postDate.getTime())) {
    if (/\bnur heute\b/i.test(signal) && endOfUtcDay(postDate).getTime() < Date.now()) return true;
    if (/\bmorgen\b/i.test(signal)) {
      const tomorrow = new Date(Date.UTC(postDate.getUTCFullYear(), postDate.getUTCMonth(), postDate.getUTCDate() + 1, 23, 59, 59, 999));
      if (tomorrow.getTime() < Date.now()) return true;
    }
    if (/\bdieses wochenende\b/i.test(signal) && endOfWeekendForPost(postDate).getTime() < Date.now()) return true;
    if (/\bersten?\s+sonntag\s+des\s+monats\b/i.test(signal) && firstSundayOfMonth(postDate).getTime() < Date.now()) return true;
  }
  return false;
}

function extractExpiryText(text) {
  const signal = cleanText(text, 1200);
  const explicit = signal.match(/\b(?:bis|gültig bis|gueltig bis|nur bis|noch bis)\s+(\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)/i);
  if (explicit) return explicit[0];
  const range = signal.match(/\b(?:von\s+)?\d{1,2}\.\s*[-–]\s*\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?/i);
  if (range) return range[0];
  const single = signal.match(/\b(?:am|nur am)\s+\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?/i);
  if (single) return single[0];
  if (/\bnur heute\b/i.test(signal)) return 'Nur heute';
  if (/\bdieses wochenende\b/i.test(signal)) return 'Dieses Wochenende';
  if (/\bdiese woche\b/i.test(signal)) return 'Diese Woche';
  return 'Kurzfristig / siehe TikTok';
}

async function prepareTikTokSession(context) {
  const page = await context.newPage();
  await page.goto('https://www.tiktok.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2200);
  return page;
}

function normalizeTikTokApiItem(raw) {
  const item = raw?.item || raw?.item_info?.item_struct || raw?.aweme_info || raw;
  if (!item?.id || !item?.author?.uniqueId) return null;
  const accountHandle = item.author.uniqueId;
  const url = `https://www.tiktok.com/@${accountHandle}/video/${item.id}`;
  const createTime = Number(item.createTime || item.create_time || 0);
  return {
    url,
    finalUrl: url,
    accountHandle,
    title: item.desc || '',
    description: item.desc || '',
    bodyText: [
      item.desc,
      item.author?.nickname,
      item.author?.signature,
      ...(item.textExtra || []).map((entry) => entry.hashtagName || ''),
    ].filter(Boolean).join(' '),
    timeDateTime: createTime > 0 ? new Date(createTime * 1000).toISOString() : '',
    createTimes: createTime > 0 ? [String(createTime)] : [],
    stats: item.stats || {},
  };
}

async function fetchTikTokApiCandidates(page) {
  const rows = [];
  const errors = [];
  for (const keyword of TIKTOK_API_KEYWORDS) {
    try {
      const result = await page.evaluate(async ({ keyword }) => {
        const url = `/api/search/general/full/?keyword=${encodeURIComponent(keyword)}&offset=0&count=18`;
        const response = await fetch(url, {
          headers: { accept: 'application/json,text/plain,*/*' },
        });
        const text = await response.text();
        if (!response.ok) return { ok: false, status: response.status, text: text.slice(0, 200) };
        if (!text) return { ok: false, status: response.status, text: '' };
        try {
          return { ok: true, status: response.status, body: JSON.parse(text) };
        } catch {
          return { ok: false, status: response.status, text: text.slice(0, 200) };
        }
      }, { keyword });

      if (!result.ok) {
        errors.push({ keyword, status: result.status, error: result.text || 'empty response' });
        continue;
      }
      for (const row of result.body?.data || []) {
        const normalized = normalizeTikTokApiItem(row);
        if (normalized) rows.push({ keyword, data: normalized });
      }
    } catch (error) {
      errors.push({ keyword, error: error.message });
    }
    await page.waitForTimeout(450);
  }
  return { rows, errors };
}

async function discoverTikTokLinksViaDuckDuckGo() {
  const links = new Set();
  const errors = [];
  for (const query of SEARCH_QUERIES) {
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const response = await fetch(url, {
        headers: {
          'user-agent': 'Mozilla/5.0 (compatible; FreeFinderTikTokScanner/1.0; +https://freefinder.app)',
          'accept-language': 'de-AT,de;q=0.9,en;q=0.8',
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      const hrefMatches = [...html.matchAll(/href=["']([^"']+)["']/gi)];
      for (const match of hrefMatches) {
        const normalized = normalizeTikTokVideoUrl(match[1]);
        if (normalized) links.add(normalized);
      }
    } catch (error) {
      errors.push({ query, error: error.message });
    }
  }
  return { links: [...links], errors };
}

async function extractTikTokPostData(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
  await page.waitForTimeout(1800);

  return page.evaluate(() => {
    const meta = (selector) => document.querySelector(selector)?.getAttribute('content') || '';
    const bodyText = document.body?.innerText || '';
    const scriptText = Array.from(document.querySelectorAll('script'))
      .map((node) => node.textContent || '')
      .join('\n')
      .slice(0, 1200000);
    const createTimes = Array.from(scriptText.matchAll(/"createTime"\s*:\s*"?(\d{10})"?/g)).map((match) => match[1]);
    let jsonLdUploadDate = '';
    let jsonLdDatePublished = '';
    for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
      try {
        const parsed = JSON.parse(script.textContent || '{}');
        const entries = Array.isArray(parsed) ? parsed : [parsed];
        for (const entry of entries) {
          jsonLdUploadDate ||= entry.uploadDate || '';
          jsonLdDatePublished ||= entry.datePublished || '';
        }
      } catch {}
    }

    const accountMatch = location.pathname.match(/\/@([^/]+)\//);
    return {
      finalUrl: location.href,
      accountHandle: accountMatch?.[1] || '',
      title: meta('meta[property="og:title"]') || meta('meta[name="twitter:title"]') || document.title || '',
      description: meta('meta[property="og:description"]') || meta('meta[name="description"]') || meta('meta[name="twitter:description"]') || '',
      bodyText,
      timeDateTime: document.querySelector('time[datetime]')?.getAttribute('datetime') || '',
      jsonLdUploadDate,
      jsonLdDatePublished,
      createTimes: [...new Set(createTimes)].slice(0, 8),
    };
  });
}

function buildDealFromPost(url, data) {
  const dateCandidate = parseDateFromPost(data);
  if (!dateCandidate) {
    return { deal: null, reason: 'kein echtes TikTok-Post-Datum gefunden' };
  }
  if (!isCurrentPost(dateCandidate.date)) {
    return { deal: null, reason: `TikTok-Post älter als ${CONFIG.maxAgeDays} Tage (${dateCandidate.date.toISOString().slice(0, 10)})` };
  }

  const signal = [
    data.title,
    data.description,
    data.bodyText,
    data.accountHandle,
    url,
  ].map((part) => cleanText(part, 1800)).filter(Boolean).join(' ');

  if (!hasViennaSignal(signal)) return { deal: null, reason: 'kein eindeutiges Wien-Signal' };
  if (!hasStrongDealSignal(signal)) return { deal: null, reason: 'kein starkes Gratis-/Deal-Signal' };
  if (isExplicitlyExpired(signal, dateCandidate.date)) return { deal: null, reason: 'explizites/relatives Aktionsdatum ist abgelaufen' };

  const type = inferType(signal);
  const { category, logo } = inferCategoryAndLogo(signal, type);
  const brand = extractBrand(signal, data.accountHandle);
  const title = buildOfferTitle(signal, brand);
  const score = buildQualityScore(signal, dateCandidate.date, type, category);
  if (score < CONFIG.minScore) return { deal: null, reason: `Score zu niedrig (${score})` };

  return {
    deal: {
      id: `tiktok-${stableHash(`${url}|${dateCandidate.date.toISOString()}|${title}`)}`,
      brand,
      logo,
      title,
      description: cleanText(`${data.description || data.title} Quelle: TikTok @${data.accountHandle}.`, 500),
      type,
      category,
      source: 'TikTok Scanner',
      originSource: 'tiktok-deals-scanner',
      url,
      expires: extractExpiryText(signal),
      distance: 'Wien',
      hot: type === 'gratis' || type === 'bogo',
      isNew: true,
      votes: type === 'gratis' || type === 'bogo' ? 3 : 2,
      priority: type === 'gratis' || type === 'bogo' ? 5 : 4,
      qualityScore: score,
      pubDate: dateCandidate.date.toISOString(),
      pubDateSource: dateCandidate.source,
    },
    reason: '',
  };
}

function buildQualityScore(signal, postDate, type, category) {
  let score = 0;
  if (type === 'gratis') score += 34;
  else if (type === 'bogo') score += 30;
  else score += 18;

  if (/\bgratis|kostenlos|free|0\s*€/i.test(signal)) score += 16;
  if (/\b1\s*\+\s*1|2\s*(?:für|fuer)\s*1|bogo/i.test(signal)) score += 14;
  if (/\bkaffee|coffee|pizza|burger|drink|goodie|ticket|probetraining/i.test(signal)) score += 10;
  if (category === 'kaffee' || category === 'essen') score += 8;
  if (/\bnur heute|heute|morgen|wochenende|diese woche|neueröffnung|neueroeffnung|opening/i.test(signal)) score += 8;
  const age = ageDays(postDate);
  if (age <= 1) score += 16;
  else if (age <= 3) score += 12;
  else if (age <= 7) score += 8;
  return score;
}

function dedupeDeals(deals) {
  const byUrl = new Map();
  for (const deal of deals) {
    const existing = byUrl.get(deal.url);
    if (!existing || deal.qualityScore > existing.qualityScore) byUrl.set(deal.url, deal);
  }
  return [...byUrl.values()]
    .sort((left, right) => right.qualityScore - left.qualityScore || Date.parse(right.pubDate) - Date.parse(left.pubDate))
    .slice(0, CONFIG.maxDeals);
}

async function main() {
  console.log('🎵 TIKTOK DEAL SCANNER (STRICT CURRENT)');
  console.log('========================================');
  console.log(` freshness: max ${CONFIG.maxAgeDays} Tage, ohne Post-Datum blockiert`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'de-AT',
    timezoneId: 'Europe/Vienna',
  });

  const deals = [];
  const rejected = [];
  let discovery = { links: [], errors: [] };
  let apiDiscovery = { rows: [], errors: [] };
  try {
    const apiPage = await prepareTikTokSession(context);
    apiDiscovery = await fetchTikTokApiCandidates(apiPage);
    console.log(`🔎 TikTok API candidates: ${apiDiscovery.rows.length}`);
    for (const item of apiDiscovery.rows) {
      const { deal, reason } = buildDealFromPost(item.data.url, item.data);
      if (deal) {
        deals.push(deal);
        console.log(`  ✅ ${deal.title}`);
      } else {
        rejected.push({ url: item.data.url, keyword: item.keyword, reason });
      }
    }

    discovery = await discoverTikTokLinksViaDuckDuckGo();
    const knownUrls = new Set(apiDiscovery.rows.map((item) => item.data.url));
    const urls = discovery.links.filter((url) => !knownUrls.has(url)).slice(0, Math.max(0, CONFIG.maxPostsToVisit - apiDiscovery.rows.length));
    console.log(`🔎 search-engine videos: ${discovery.links.length}, visiting fallback: ${urls.length}`);
    const page = apiPage;
    for (const url of urls) {
      try {
        const data = await extractTikTokPostData(page, url);
        const { deal, reason } = buildDealFromPost(url, data);
        if (deal) {
          deals.push(deal);
          console.log(`  ✅ ${deal.title}`);
        } else {
          rejected.push({ url, reason });
        }
      } catch (error) {
        rejected.push({ url, reason: error.message });
      }
      await page.waitForTimeout(500);
    }
  } finally {
    await context.close();
    await browser.close();
  }

  const finalDeals = dedupeDeals(deals);
  const payload = {
    lastUpdated: new Date().toISOString(),
    source: 'tiktok-deals-scanner',
    totalDeals: finalDeals.length,
    maxAgeDays: CONFIG.maxAgeDays,
    deals: finalDeals,
  };
  const report = {
    lastUpdated: payload.lastUpdated,
    config: CONFIG,
    searchQueries: SEARCH_QUERIES,
    apiKeywords: TIKTOK_API_KEYWORDS,
    discovered: discovery.links.length,
    apiCandidates: apiDiscovery.rows.length,
    accepted: finalDeals.length,
    discoveryErrors: discovery.errors,
    apiErrors: apiDiscovery.errors,
    rejected: rejected.slice(0, 250),
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`💾 ${finalDeals.length} Deals → ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error('❌ tiktok deal scanner failed:', error);
  process.exit(1);
});

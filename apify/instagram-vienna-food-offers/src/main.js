import { Actor, log } from 'apify';
import { PlaywrightCrawler, RequestQueue } from 'crawlee';
import {
  isCalendarDateAfter,
  isCalendarDateBefore,
  extractCaptionDateRange,
  inferCaptionDateYear,
  relativeCaptionValidity,
  stripInstagramMetaDescriptionPrefix,
} from './validity-utils.js';

const DEFAULT_INPUT = {
  seedAccounts: [
    'viennaeats',
    'viennafoodstories',
    'viennarestaurants',
    'vienna.coffee',
    'viennawurstelstand',
    'ciosgrill',
    'corner_xvi',
    'assal.burger',
    'cafe_wirr',
    'mangalet.at',
  ],
  // Accounts are crawl targets, not location proof. The importer supplies only
  // registry/watchlist entries that were explicitly verified for Vienna.
  verifiedViennaAccounts: [],
  seedHashtags: [
    'gratiswien',
    'wiengastro',
    'wienessen',
    'wienkaffee',
    'gratisessenwien',
    'gratiskaffeewien',
    'gratisdrinkwien',
    'gratisburgerwien',
    'gratispizza',
    'wienstreetfood',
    'freefoodvienna',
    'freedrinkvienna',
  ],
  maxPostsPerSource: 9,
  maxPostsToInspect: 120,
  maxPostAgeDays: 7,
  maxAgeDaysWithoutExplicitValidity: 3,
  maxFutureValidityDays: 120,
  debugMode: false,
};

const RESERVED_PATHS = new Set([
  'explore', 'accounts', 'about', 'developer', 'legal', 'privacy', 'api', 'reel', 'p',
  'stories', 'direct', 'reels', 'tv', 'challenge', 'directory', 'topics', 'emails',
  'download', 'press', 'jobs', 'threads', 'create', 'login', 'signup',
]);

const VIENNA_KEYWORDS = [
  'wien', 'vienna', '1010', '1020', '1030', '1040', '1050', '1060', '1070', '1080', '1090',
  '1100', '1110', '1120', '1130', '1140', '1150', '1160', '1170', '1180', '1190', '1200',
  '1210', '1220', '1230', 'mariahilf', 'favoriten', 'ottakring', 'neubau', 'leopoldstadt',
  'donaustadt', 'floridsdorf', 'währing', 'waehring', 'landstraße', 'landstrasse',
];

const FOOD_DRINK_KEYWORDS = [
  'essen', 'food', 'drink', 'getränk', 'getraenk', 'restaurant', 'cafe', 'café', 'coffee',
  'kaffee', 'matcha', 'espresso', 'latte', 'pizza', 'burger', 'sushi', 'kebab', 'kebap',
  'döner', 'doener', 'falafel', 'brunch', 'croissant', 'frühstück', 'fruehstueck', 'dessert',
  'eis', 'ice cream', 'bubble tea', 'cocktail', 'spritz', 'smoothie', 'bakery', 'donut',
  'sandwich', 'burrito', 'taco', 'ramen', 'nudeln', 'pasta',
];

const FREE_KEYWORDS = [
  'gratis', 'kostenlos', 'free', 'for free', 'freebie', '0€', '0 €', '0eur', '0 eur',
  'geschenkt', 'umsonst', 'free drink', 'free coffee', 'free food', 'gratis essen',
  'gratis kaffee', 'gratis burger', 'gratis pizza', 'gratis drink', 'gratis cocktail',
  'gratis matcha', 'gratis döner', 'gratis doener', 'gratis eis',
];

const BOGO_KEYWORDS = [
  '1+1', '1 + 1', '2for1', '2 for 1', 'buy one get one', 'bogo', 'bring 1 friend get 1',
  'zwei zum preis von einem', '2 zum preis von 1',
];

const DISCOUNT_KEYWORDS = [
  'rabatt', 'discount', 'off', 'gutschein', 'voucher', 'coupon', 'promocode', 'aktionscode',
  'happy hour', 'halber preis', 'half price', 'sonderpreis', 'special price',
];

const CONCRETE_DISCOUNT_PATTERNS = [
  /\b\d{1,2}\s*%\s*(?:rabatt|off|discount)?\b/i,
  /\b(?:nur|only|um|ab|f(?:ü|u|ue)r)\s+\d{1,3}(?:[,.]\d{1,2})?\s*(?:€|eur|euro)\b/i,
  /\b(?:happy\s*hour|halber\s+preis|half\s+price)\b/i,
  /\b(?:mit\s+)?(?:code|codewort|promo(?:code)?)\s*[:\-]?\s*[a-z0-9]{3,}\b/i,
  /\b\d{1,3}(?:[,.]\d{1,2})?\s*(?:€|eur|euro)\s*(?:rabatt|gutschein|bonus)\b/i,
];

const EXCLUDE_KEYWORDS = [
  'gewinnspiel', 'giveaway', 'verlosung', 'zu gewinnen', 'tagge', 'kommentiere', 'kommentier',
  'like & comment', 'follow und gewinne', 'ticket', 'festival', 'konzert', 'clubbing',
];

const EXPIRED_KEYWORDS = [
  'abgelaufen', 'expired', 'ended', 'vorbei', 'ausverkauft', 'nicht mehr gültig',
];

const COOKIE_BUTTON_TEXTS = [
  'Allow all cookies',
  'Accept all',
  'Alle Cookies erlauben',
  'Alle akzeptieren',
  'Nur erforderliche Cookies erlauben',
  'Allow essential and optional cookies',
];

const MONTHS = new Map([
  ['january', 0], ['jan', 0], ['januar', 0],
  ['february', 1], ['feb', 1], ['februar', 1],
  ['march', 2], ['mar', 2], ['märz', 2], ['maerz', 2],
  ['april', 3], ['apr', 3],
  ['may', 4], ['mai', 4],
  ['june', 5], ['jun', 5], ['juni', 5],
  ['july', 6], ['jul', 6], ['juli', 6],
  ['august', 7], ['aug', 7],
  ['september', 8], ['sep', 8], ['sept', 8],
  ['october', 9], ['oct', 9], ['oktober', 9], ['okt', 9],
  ['november', 10], ['nov', 10],
  ['december', 11], ['dec', 11], ['dezember', 11], ['dez', 11],
]);

function normalizeText(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function stripQuotes(value) {
  return normalizeText(value).replace(/^["“”'`]+|["“”'`]+$/g, '').trim();
}

function normalizeHandle(value) {
  const handle = normalizeText(value).toLowerCase().replace(/^@/, '');
  if (!handle || RESERVED_PATHS.has(handle)) return '';
  if (!/^[a-z0-9._]{2,40}$/.test(handle)) return '';
  return handle;
}

function keywordPattern(keyword) {
  const normalized = normalizeText(keyword).toLowerCase();
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const startsWithWord = /^[\p{L}\p{N}]/u.test(normalized);
  const endsWithWord = /[\p{L}\p{N}]$/u.test(normalized);
  return new RegExp(
    `${startsWithWord ? '(?<![\\p{L}\\p{N}_-])' : ''}${escaped}${endsWithWord ? '(?![\\p{L}\\p{N}_-])' : ''}`,
    'iu',
  );
}

function containsAny(text, keywords) {
  const haystack = normalizeText(text).toLowerCase();
  if (!haystack) return false;
  return keywords.some((keyword) => keywordPattern(keyword).test(haystack));
}

function boundedInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function collectMatchedKeywords(text, keywords) {
  const haystack = normalizeText(text).toLowerCase();
  return keywords.filter((keyword) => keywordPattern(keyword).test(haystack));
}

function uniquePostUrl(value) {
  const raw = normalizeText(value);
  if (!raw) return '';
  try {
    const url = new URL(raw.startsWith('http') ? raw : `https://www.instagram.com${raw}`);
    if (!/instagram\.com$/i.test(url.hostname) && !/\.instagram\.com$/i.test(url.hostname)) return '';
    const match = url.pathname.match(/^\/(p|reel|reels|tv)\/([^/?#]+)\/?/i);
    if (!match) return '';
    const type = /^reels?$/i.test(match[1]) ? 'reel' : match[1].toLowerCase();
    return `https://www.instagram.com/${type}/${match[2]}/`;
  } catch {
    return '';
  }
}

function toIsoEndOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function parseIsoDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function resolveYear(monthIndex, day, now, preferredYear) {
  return inferCaptionDateYear(monthIndex, day, now, preferredYear);
}

function parseNumericDates(text, now) {
  const results = [];
  const regex = /\b(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?\b/g;
  let match;
  while ((match = regex.exec(text))) {
    const day = Number(match[1]);
    const monthIndex = Number(match[2]) - 1;
    const explicitYear = match[3]
      ? (match[3].length === 2 ? Number(`20${match[3]}`) : Number(match[3]))
      : null;
    const year = resolveYear(monthIndex, day, now, explicitYear);
    const date = new Date(Date.UTC(year, monthIndex, day, 0, 0, 0, 0));
    if (!Number.isNaN(date.getTime())) {
      results.push({ raw: match[0], date });
    }
  }
  return results;
}

function parseMonthNameDates(text, now) {
  const results = [];
  const regex = /\b(?:on\s+|bis\s+|until\s+|gültig bis\s+|gueltig bis\s+|ab\s+|from\s+)?([A-Za-zÄÖÜäöü]+)\s+(\d{1,2})(?:,?\s*(\d{4}))?/gi;
  let match;
  while ((match = regex.exec(text))) {
    const monthIndex = MONTHS.get(match[1].toLowerCase());
    if (monthIndex === undefined) continue;
    const day = Number(match[2]);
    const explicitYear = match[3] ? Number(match[3]) : null;
    const year = resolveYear(monthIndex, day, now, explicitYear);
    const date = new Date(Date.UTC(year, monthIndex, day, 0, 0, 0, 0));
    if (!Number.isNaN(date.getTime())) {
      results.push({ raw: match[0], date });
    }
  }
  return results;
}

function parseDateToken(token, now) {
  const text = normalizeText(token);
  return [...parseNumericDates(text, now), ...parseMonthNameDates(text, now)].map((item) => item.date)[0] || null;
}

function extractValidity(text, now, postPublishedAt, maxFutureValidityDays) {
  const cleaned = normalizeText(text);
  const lower = cleaned.toLowerCase();
  const dateReference = parseIsoDate(postPublishedAt) || now;

  if (!cleaned) {
    return { explicit: false, validFrom: null, validUntil: null, isFuture: false };
  }

  if (containsAny(lower, EXPIRED_KEYWORDS)) {
    return { explicit: true, validFrom: null, validUntil: addDays(now, -1).toISOString(), isFuture: false };
  }

  const relativeValidity = relativeCaptionValidity(cleaned, now, postPublishedAt);
  if (relativeValidity) return relativeValidity;

  const numericRange = extractCaptionDateRange(cleaned, now, maxFutureValidityDays, dateReference);
  if (numericRange) return numericRange;

  const rangeRegex = /\b(?:von|ab|from)\s+([^,\n;]+?)\s*(?:-|–|bis|to)\s*([^,\n;]+)\b/i;
  const rangeMatch = cleaned.match(rangeRegex);
  if (rangeMatch) {
    const startDate = parseDateToken(rangeMatch[1], dateReference);
    const endDate = parseDateToken(rangeMatch[2], dateReference);
    if (startDate || endDate) {
      const safeEnd = endDate && endDate.getTime() - now.getTime() <= maxFutureValidityDays * 24 * 60 * 60 * 1000
        ? toIsoEndOfDay(endDate)
        : null;
      return {
        explicit: true,
        validFrom: startDate ? startDate.toISOString() : null,
        validUntil: safeEnd,
        isFuture: Boolean(startDate && startDate > now),
      };
    }
  }

  const untilRegex = /\b(?:bis|until|gültig bis|gueltig bis|valid until|nur bis)\s+([^,\n;]+)/i;
  const untilMatch = cleaned.match(untilRegex);
  if (untilMatch) {
    const endDate = parseDateToken(untilMatch[1], dateReference);
    if (endDate && endDate.getTime() - now.getTime() <= maxFutureValidityDays * 24 * 60 * 60 * 1000) {
      return {
        explicit: true,
        validFrom: null,
        validUntil: toIsoEndOfDay(endDate),
        isFuture: false,
      };
    }
  }

  const startRegex = /\b(?:ab|from|starting)\s+([^,\n;]+)/i;
  const startMatch = cleaned.match(startRegex);
  if (startMatch) {
    const startDate = parseDateToken(startMatch[1], dateReference);
    if (startDate) {
      return {
        explicit: true,
        validFrom: startDate.toISOString(),
        validUntil: null,
        isFuture: startDate > now,
      };
    }
  }

  const allDates = [...parseNumericDates(cleaned, dateReference), ...parseMonthNameDates(cleaned, dateReference)]
    .map((item) => item.date)
    .sort((a, b) => a - b);
  if (allDates.length === 1) {
    const onlyDate = allDates[0];
    if (onlyDate.getTime() - now.getTime() <= maxFutureValidityDays * 24 * 60 * 60 * 1000) {
      return {
        explicit: true,
        validFrom: onlyDate > now ? onlyDate.toISOString() : null,
        validUntil: toIsoEndOfDay(onlyDate),
        isFuture: onlyDate > now,
      };
    }
  }

  const postDate = parseIsoDate(postPublishedAt);
  return { explicit: false, validFrom: null, validUntil: null, isFuture: Boolean(postDate && postDate > now) };
}

function acceptCookiesIfPresent(page) {
  return Promise.allSettled(
    COOKIE_BUTTON_TEXTS.map((text) =>
      page.getByRole('button', { name: text, exact: false }).click({ timeout: 1500 }),
    ),
  );
}

function extractPostUrls(values, maxPostsPerSource) {
  const unique = [];
  const seen = new Set();
  for (const value of values) {
    const postUrl = uniquePostUrl(value);
    if (!postUrl || seen.has(postUrl)) continue;
    seen.add(postUrl);
    unique.push(postUrl);
    if (unique.length >= maxPostsPerSource) break;
  }
  return unique;
}

async function collectSourceLinks(page, maxPostsPerSource) {
  let lastDiagnostic = {
    state: 'empty',
    title: '',
    bodySample: '',
    linkCount: 0,
    attemptCount: 0,
  };

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    if (attempt > 1) {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
      await acceptCookiesIfPresent(page);
    }

    try {
      await page.waitForSelector('a[href*="/p/"], a[href*="/reel/"], main', { timeout: 4000 });
    } catch {
      // Instagram often renders a shell first; continue with timed waits below.
    }

    await page.waitForTimeout(2500);

    for (let i = 0; i < 8; i += 1) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await page.waitForTimeout(900);
    }

    const [snapshot, html] = await Promise.all([
      page.evaluate(() => {
        const links = [...document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"]')]
          .map((link, index) => ({
            href: link.getAttribute('href') || '',
            index,
            pinned: Boolean(
              link.querySelector('svg[aria-label*="Pinned" i], svg[aria-label*="Angepinnt" i]')
              || link.parentElement?.querySelector('svg[aria-label*="Pinned" i], svg[aria-label*="Angepinnt" i]'),
            ),
          }))
          .filter((entry) => entry.href);
        return {
          title: document.title || '',
          bodyText: document.body?.innerText?.slice(0, 2000) || '',
          hrefs: links,
          linkCount: links.length,
        };
      }),
      page.content(),
    ]);

    const htmlMatches = [...html.matchAll(/https:\/\/www\.instagram\.com\/(?:[^"'?\s<>]+\/)?(?:p|reel)\/[^"'?#\s<>]+\/?|\/(?:[^"'?\s<>]+\/)?(?:p|reel)\/[^"'?#\s<>]+\/?/gi)].map((match) => match[0]);
    const hrefCandidates = snapshot.hrefs
      .sort((left, right) => Number(left.pinned) - Number(right.pinned) || left.index - right.index)
      .map(({ href }) => (href.startsWith('http') ? href : `https://www.instagram.com${href}`));
    const postUrls = extractPostUrls([...hrefCandidates, ...htmlMatches], maxPostsPerSource);

    const diagnosticText = normalizeText(`${snapshot.title} ${snapshot.bodyText}`).toLowerCase();
    const isErrorPage = diagnosticText.includes('something went wrong')
      || diagnosticText.includes("page couldn't load")
      || diagnosticText.includes('etwas ist schiefgelaufen')
      || diagnosticText.includes('seite konnte nicht geladen werden');
    const isLoginWall = diagnosticText.includes('log in') && diagnosticText.includes('sign up');

    lastDiagnostic = {
      state: postUrls.length ? 'ok' : isErrorPage ? 'errorPage' : isLoginWall ? 'loginWall' : 'noPostLinks',
      title: snapshot.title,
      bodySample: snapshot.bodyText.slice(0, 400),
      linkCount: snapshot.linkCount,
      attemptCount: attempt,
    };

    if (postUrls.length) {
      return { postUrls, diagnostic: lastDiagnostic };
    }
  }

  return { postUrls: [], diagnostic: lastDiagnostic };
}

function parseLdJson(rawScripts) {
  const parsed = [];
  for (const raw of rawScripts || []) {
    try {
      const json = JSON.parse(raw);
      if (Array.isArray(json)) {
        parsed.push(...json);
      } else if (json && typeof json === 'object') {
        parsed.push(json);
      }
    } catch {
      // ignore malformed blocks
    }
  }
  return parsed;
}

function extractPostDateFromMeta(text) {
  const cleaned = normalizeText(text);
  const match = cleaned.match(/\bon\s+([A-Za-zÄÖÜäöü]+\s+\d{1,2},?\s+\d{4})\b/i);
  if (!match) return null;
  return parseDateToken(match[1], new Date());
}

async function extractPostData(page) {
  const snapshot = await page.evaluate(() => {
    const metaContent = (selector) => document.querySelector(selector)?.getAttribute('content') || '';
    const textContent = (selector) => document.querySelector(selector)?.textContent || '';
    const locationText =
      textContent('a[href*="/locations/"]') ||
      textContent('main a[href*="/locations/"]') ||
      '';

    const headerHandle = (() => {
      const handleLink = document.querySelector('header a[href^="/"]');
      const href = handleLink?.getAttribute('href') || '';
      const match = href.match(/^\/([^/?#]+)\/?$/);
      return match ? match[1] : '';
    })();

    return {
      url: window.location.href,
      title: document.title || '',
      bodyText: document.body?.innerText?.slice(0, 12000) || '',
      metaDescription: metaContent('meta[name="description"]'),
      ogDescription: metaContent('meta[property="og:description"]'),
      ogTitle: metaContent('meta[property="og:title"]'),
      publishedTime: metaContent('meta[property="article:published_time"]'),
      canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') || '',
      ldJsonBlocks: [...document.querySelectorAll('script[type="application/ld+json"]')].map((node) => node.textContent || ''),
      timeDatetime: document.querySelector('time')?.getAttribute('datetime') || '',
      locationText,
      headerHandle,
    };
  });

  const ldJson = parseLdJson(snapshot.ldJsonBlocks);
  const firstLd = ldJson.find((item) => item && typeof item === 'object') || {};

  const captionCandidates = [
    firstLd.caption,
    firstLd.articleBody,
    snapshot.metaDescription,
    snapshot.ogDescription,
    snapshot.ogTitle,
  ]
    .map(stripQuotes)
    .filter(Boolean);

  const caption = captionCandidates[0] || '';
  const venueName = stripQuotes(
    firstLd?.author?.alternateName ||
    firstLd?.author?.name ||
    snapshot.headerHandle ||
    snapshot.ogTitle?.split(':')[0],
  );

  const timestampCandidates = [
    { value: normalizeText(firstLd.uploadDate), source: 'ldJson.uploadDate' },
    { value: normalizeText(snapshot.publishedTime), source: 'meta.articlePublishedTime' },
    { value: normalizeText(snapshot.timeDatetime), source: 'time.datetime' },
  ];
  const metaDate = extractPostDateFromMeta(snapshot.metaDescription) || extractPostDateFromMeta(snapshot.ogDescription);
  if (metaDate) timestampCandidates.push({ value: metaDate.toISOString(), source: 'instagramMetaDescription' });
  const realTimestamp = timestampCandidates.find((candidate) => parseIsoDate(candidate.value));
  const postPublishedAt = realTimestamp?.value || '';
  const postPublishedAtSource = realTimestamp?.source || '';

  const locationText = stripQuotes(
    firstLd?.locationCreated?.name ||
    firstLd?.contentLocation?.name ||
    snapshot.locationText,
  );

  return {
    url: uniquePostUrl(snapshot.canonical || snapshot.url),
    caption,
    venueName,
    locationText,
    postPublishedAt,
    postPublishedAtSource,
    title: stripQuotes(snapshot.ogTitle || snapshot.title),
    metaDescription: stripQuotes(snapshot.metaDescription),
    ogDescription: stripQuotes(snapshot.ogDescription),
    bodyText: stripQuotes(snapshot.bodyText),
  };
}

function classifyOffer(text) {
  if (containsAny(text, BOGO_KEYWORDS)) return 'bogo';
  if (containsAny(text, FREE_KEYWORDS)) return 'free';
  if (CONCRETE_DISCOUNT_PATTERNS.some((pattern) => pattern.test(text))) return 'discount';
  return 'other';
}

function buildDescription(post) {
  return stripQuotes(stripInstagramMetaDescriptionPrefix(
    post.caption || post.metaDescription || post.ogDescription || post.title,
  ));
}

function buildItem(post, validity, input, request, now = new Date()) {
  const description = buildDescription(post);
  const combinedText = normalizeText([
    post.venueName,
    description,
    post.locationText,
  ].join(' '));
  const locationEvidenceText = normalizeText([description, post.locationText].join(' '));

  const offerKind = classifyOffer(combinedText);
  const foodOrDrinkMatch = containsAny(combinedText, FOOD_DRINK_KEYWORDS);
  const explicitViennaSignal = containsAny(locationEvidenceText, VIENNA_KEYWORDS);
  const seedHandle = normalizeHandle(request.userData?.seedValue);
  const trustedViennaAccount = request.userData?.sourceType === 'account'
    && input.verifiedViennaAccounts.includes(seedHandle);
  const isVienna = explicitViennaSignal || trustedViennaAccount;
  const isGiveaway = containsAny(combinedText, EXCLUDE_KEYWORDS);
  const explicitExpired = Boolean(validity.validUntil && isCalendarDateBefore(validity.validUntil, now));
  const explicitNotStarted = Boolean(validity.validFrom && isCalendarDateAfter(validity.validFrom, now));
  const postDate = parseIsoDate(post.postPublishedAt);
  const postAgeDays = postDate ? (now.getTime() - postDate.getTime()) / (24 * 60 * 60 * 1000) : null;
  const explicitStartOnlyActive =
    Boolean(validity.explicit && validity.validFrom && !validity.validUntil) &&
    !isCalendarDateAfter(validity.validFrom, now) &&
    Boolean(postDate && postDate >= addDays(now, -input.maxAgeDaysWithoutExplicitValidity));
  const noExplicitValidityButFreshEnough =
    !validity.explicit &&
    postDate &&
    postDate >= addDays(now, -input.maxAgeDaysWithoutExplicitValidity);

  const stillValid =
    !explicitExpired &&
    !explicitNotStarted &&
    (
      explicitStartOnlyActive ||
      Boolean(validity.validUntil && new Date(validity.validUntil) >= now) ||
      noExplicitValidityButFreshEnough
    );

  return {
    postUrl: post.url,
    postType: /\/reel\//i.test(post.url) ? 'reel' : 'post',
    venueName: post.venueName || '',
    instagramHandle: normalizeHandle(post.venueName) || normalizeHandle(request.userData?.seedValue),
    description,
    locationText: post.locationText || '',
    postPublishedAt: post.postPublishedAt || null,
    postPublishedAtSource: post.postPublishedAtSource || null,
    postAgeDays,
    maxPostAgeDays: input.maxPostAgeDays,
    validFrom: validity.validFrom,
    validUntil: validity.validUntil,
    explicitValidityDetected: validity.explicit,
    stillValid,
    offerKind,
    isVienna,
    viennaEvidence: explicitViennaSignal
      ? { type: 'postText', values: collectMatchedKeywords(locationEvidenceText, VIENNA_KEYWORDS) }
      : (trustedViennaAccount ? { type: 'trustedSeedAccount', values: [seedHandle] } : null),
    foodOrDrinkMatch,
    isGiveaway,
    matchedKeywords: {
      free: collectMatchedKeywords(combinedText, FREE_KEYWORDS),
      bogo: collectMatchedKeywords(combinedText, BOGO_KEYWORDS),
      discount: collectMatchedKeywords(combinedText, DISCOUNT_KEYWORDS),
      vienna: collectMatchedKeywords(locationEvidenceText, VIENNA_KEYWORDS),
      foodDrink: collectMatchedKeywords(combinedText, FOOD_DRINK_KEYWORDS),
    },
    sourcePage: request.userData?.sourcePage || null,
    sourceType: request.userData?.sourceType || null,
    scrapedAt: new Date().toISOString(),
  };
}

function getRejectReason(item) {
  if (!item.postUrl) return 'missingPostUrl';
  if (!item.postPublishedAt || !item.postPublishedAtSource) return 'missingRealPostTimestamp';
  if (!Number.isFinite(item.postAgeDays)) return 'invalidPostTimestamp';
  if (item.postAgeDays < -(10 / (24 * 60))) return 'futurePostTimestamp';
  if (item.postAgeDays > item.maxPostAgeDays) return 'postTooOld';
  if (item.isGiveaway) return 'giveaway';
  if (!item.isVienna) return 'notVienna';
  if (!item.foodOrDrinkMatch) return 'notFoodOrDrink';
  if (item.offerKind === 'other') return 'noConcreteOfferSignal';
  if (!item.stillValid) return 'expiredOrTooOld';
  return '';
}

function buildCookieObjects(input) {
  const cookies = [];
  const cookieString = normalizeText(input.cookieString);
  if (cookieString) {
    for (const part of cookieString.split(';').map((value) => value.trim()).filter(Boolean)) {
      const index = part.indexOf('=');
      if (index <= 0) continue;
      cookies.push({
        name: part.slice(0, index).trim(),
        value: part.slice(index + 1).trim(),
        domain: '.instagram.com',
        path: '/',
      });
    }
  }

  const sessionId = normalizeText(input.sessionId);
  if (sessionId && !cookies.some((cookie) => cookie.name === 'sessionid')) {
    cookies.push({ name: 'sessionid', value: sessionId, domain: '.instagram.com', path: '/' });
  }

  return cookies;
}

async function getContextCookieDiagnostics(page) {
  try {
    const cookies = await page.context().cookies('https://www.instagram.com/');
    const names = cookies.map((cookie) => cookie.name).filter(Boolean).sort();
    return {
      cookieCount: cookies.length,
      cookieNames: names.slice(0, 20),
      hasSessionCookie: names.includes('sessionid'),
      hasCsrfCookie: names.includes('csrftoken'),
    };
  } catch {
    return {
      cookieCount: 0,
      cookieNames: [],
      hasSessionCookie: false,
      hasCsrfCookie: false,
    };
  }
}

await Actor.main(async () => {
  const rawInput = await Actor.getInput() || {};
  const input = {
    ...DEFAULT_INPUT,
    ...rawInput,
    seedAccounts: (rawInput.seedAccounts || DEFAULT_INPUT.seedAccounts).map(normalizeHandle).filter(Boolean),
    verifiedViennaAccounts: (rawInput.verifiedViennaAccounts || DEFAULT_INPUT.verifiedViennaAccounts).map(normalizeHandle).filter(Boolean),
    seedHashtags: (rawInput.seedHashtags || DEFAULT_INPUT.seedHashtags).map((tag) => normalizeText(tag).replace(/^#/, '')).filter(Boolean),
    maxPostsPerSource: boundedInt(rawInput.maxPostsPerSource, DEFAULT_INPUT.maxPostsPerSource, 1, 12),
    maxPostsToInspect: boundedInt(rawInput.maxPostsToInspect, DEFAULT_INPUT.maxPostsToInspect, 1, 500),
    maxPostAgeDays: boundedInt(rawInput.maxPostAgeDays, DEFAULT_INPUT.maxPostAgeDays, 1, 30),
    maxAgeDaysWithoutExplicitValidity: boundedInt(
      rawInput.maxAgeDaysWithoutExplicitValidity,
      DEFAULT_INPUT.maxAgeDaysWithoutExplicitValidity,
      1,
      30,
    ),
    maxFutureValidityDays: boundedInt(
      rawInput.maxFutureValidityDays,
      DEFAULT_INPUT.maxFutureValidityDays,
      1,
      365,
    ),
  };

  const now = new Date();
  const cookieObjects = buildCookieObjects(input);
  const inputCookieDiagnostics = {
    providedCookieCount: cookieObjects.length,
    providedCookieNames: cookieObjects.map((cookie) => cookie.name).filter(Boolean).sort().slice(0, 20),
    hasProvidedSessionCookie: cookieObjects.some((cookie) => cookie.name === 'sessionid'),
    hasProvidedCsrfCookie: cookieObjects.some((cookie) => cookie.name === 'csrftoken'),
  };
  const requestQueue = await RequestQueue.open();
  const sourceStats = {};
  const seenPostContexts = new Set();
  const acceptedUrls = new Set();
  const rejectReasons = {};
  let queuedPostCount = 0;

  for (const account of input.seedAccounts) {
    const url = `https://www.instagram.com/${account}/`;
    sourceStats[url] = { type: 'account', seed: account, queued: 0, visited: 0, accepted: 0 };
    await requestQueue.addRequest({
      url,
      uniqueKey: `account:${account}`,
      userData: { label: 'SOURCE', sourceType: 'account', seedValue: account, sourcePage: url },
    });
  }

  for (const hashtag of input.seedHashtags) {
    const url = `https://www.instagram.com/explore/tags/${hashtag}/`;
    sourceStats[url] = { type: 'hashtag', seed: hashtag, queued: 0, visited: 0, accepted: 0 };
    await requestQueue.addRequest({
      url,
      uniqueKey: `hashtag:${hashtag}`,
      userData: { label: 'SOURCE', sourceType: 'hashtag', seedValue: hashtag, sourcePage: url },
    });
  }

  const proxyConfiguration = await Actor.createProxyConfiguration(input.proxyConfiguration);

  const crawler = new PlaywrightCrawler({
    requestQueue,
    proxyConfiguration,
    maxConcurrency: 3,
    maxRequestRetries: 1,
    navigationTimeoutSecs: 60,
    requestHandlerTimeoutSecs: 90,
    launchContext: {
      launchOptions: {
        headless: true,
      },
    },
    preNavigationHooks: [
      async ({ page }) => {
        if (cookieObjects.length) {
          await page.context().addCookies(cookieObjects);
        }
      },
    ],
    async requestHandler({ request, page, crawler: currentCrawler }) {
      await acceptCookiesIfPresent(page);

      if (request.userData.label === 'SOURCE') {
        const contextCookieDiagnostics = await getContextCookieDiagnostics(page);
        const { postUrls, diagnostic } = await collectSourceLinks(page, input.maxPostsPerSource);
        // Preserve a verified account context even when a hashtag discovers
        // the same URL first. Hashtag duplicates still share one context.
        const contextKey = (url) => request.userData.sourceType === 'account'
          ? `account:${request.userData.seedValue}:${url}`
          : `hashtag:${url}`;
        const freshPostUrls = postUrls
          .filter((url) => !seenPostContexts.has(contextKey(url)))
          .slice(0, Math.max(0, input.maxPostsToInspect - queuedPostCount));
        freshPostUrls.forEach((url) => seenPostContexts.add(contextKey(url)));

        queuedPostCount += freshPostUrls.length;
        sourceStats[request.url].queued = freshPostUrls.length;
        sourceStats[request.url].state = diagnostic.state;
        sourceStats[request.url].title = diagnostic.title;
        sourceStats[request.url].attemptCount = diagnostic.attemptCount;
        sourceStats[request.url].cookieCount = contextCookieDiagnostics.cookieCount;
        sourceStats[request.url].cookieNames = contextCookieDiagnostics.cookieNames;
        sourceStats[request.url].hasSessionCookie = contextCookieDiagnostics.hasSessionCookie;
        sourceStats[request.url].hasCsrfCookie = contextCookieDiagnostics.hasCsrfCookie;

        if (freshPostUrls.length) {
          await currentCrawler.addRequests(
            freshPostUrls.map((url) => ({
              url,
              uniqueKey: contextKey(url),
              userData: {
                label: 'POST',
                sourceType: request.userData.sourceType,
                seedValue: request.userData.seedValue,
                sourcePage: request.url,
              },
            })),
          );
        }

        if (!freshPostUrls.length) {
          rejectReasons[`source:${diagnostic.state}`] = (rejectReasons[`source:${diagnostic.state}`] || 0) + 1;
          log.warning(`Collected 0 post URLs from ${request.url} [${diagnostic.state}] ${diagnostic.title || diagnostic.bodySample}`);
        } else {
          log.info(`Collected ${freshPostUrls.length} post URLs from ${request.url}`);
        }
        return;
      }

      const post = await extractPostData(page);
      const validity = extractValidity(
        [post.caption, post.metaDescription, post.ogDescription].join(' '),
        now,
        post.postPublishedAt,
        input.maxFutureValidityDays,
      );

      const item = buildItem(post, validity, input, request, now);
      sourceStats[request.userData.sourcePage].visited += 1;

      const rejectReason = getRejectReason(item);
      if (rejectReason) {
        rejectReasons[rejectReason] = (rejectReasons[rejectReason] || 0) + 1;
        if (input.debugMode) {
          await Actor.pushData({
            ...item,
            accepted: false,
            rejectReason,
            debugTextSample: stripQuotes(post.bodyText).slice(0, 1200),
          });
        }
        return;
      }

      if (acceptedUrls.has(item.postUrl)) return;
      acceptedUrls.add(item.postUrl);
      sourceStats[request.userData.sourcePage].accepted += 1;

      await Actor.pushData({
        ...item,
        accepted: true,
      });
    },
    failedRequestHandler({ request, error }) {
      const reason = `requestFailed:${request.userData?.label || 'unknown'}`;
      rejectReasons[reason] = (rejectReasons[reason] || 0) + 1;
      log.warning(`Request failed for ${request.url}: ${error.message}`);
    },
  });

  await crawler.run();

  const summary = {
    finishedAt: new Date().toISOString(),
    acceptedDeals: acceptedUrls.size,
    inspectedPosts: Object.values(sourceStats).reduce((sum, entry) => sum + entry.visited, 0),
    queuedPosts: queuedPostCount,
    inputCookieDiagnostics,
    sources: sourceStats,
    rejectReasons,
  };

  await Actor.setValue('SUMMARY', summary);
  log.info(`Done. Accepted ${acceptedUrls.size} valid Instagram offer posts.`);
});

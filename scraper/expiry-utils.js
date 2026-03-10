const URL_CHECK_UA = 'Mozilla/5.0 (compatible; FreeFinderBot/1.0; +https://freefinder.wien)';

const MONTH_MAP = {
  'jänner': 0, 'januar': 0, 'january': 0, 'jan': 0,
  'februar': 1, 'february': 1, 'feb': 1,
  'märz': 2, 'maerz': 2, 'march': 2, 'mar': 2, 'mär': 2,
  'april': 3, 'apr': 3,
  'mai': 4, 'may': 4,
  'juni': 5, 'june': 5, 'jun': 5,
  'juli': 6, 'july': 6, 'jul': 6,
  'august': 7, 'aug': 7,
  'september': 8, 'sep': 8, 'sept': 8,
  'oktober': 9, 'october': 9, 'okt': 9, 'oct': 9,
  'november': 10, 'nov': 10,
  'dezember': 11, 'december': 11, 'dez': 11, 'dec': 11,
};

const URL_EXPIRY_BLOCK_HOSTS = new Set([
  'instagram.com',
  'www.instagram.com',
  'tiktok.com',
  'www.tiktok.com',
  'preisjaeger.at',
  'www.preisjaeger.at',
  'gutscheine.at',
  'www.gutscheine.at',
  'facebook.com',
  'www.facebook.com',
  'x.com',
  'www.x.com',
  'twitter.com',
  'www.twitter.com',
  'slack.com',
  'www.slack.com',
]);

function cleanText(value) {
  if (!value) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function endOfUtcDay(year, monthIndex, day) {
  return new Date(Date.UTC(year, monthIndex, day, 23, 59, 59, 999));
}

function endOfUtcMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0, 23, 59, 59, 999));
}

export function isVagueExpiry(value) {
  const text = cleanText(value).toLowerCase();
  if (!text) return true;
  return /^(siehe|unbekannt|dauerhaft|unbegrenzt|jederzeit|laufend|ongoing|k\.a\.?|tbd|coming soon|bei eröffnung|bei eroeffnung|regelm[aä]ßig|regelmaessig|immer|permanent\b|frühjahr\b|fruehjahr\b|season opening\b)/i.test(text)
    || /(siehe details|siehe website|siehe webseite|check website|not specified|unknown unknown|zeiten auf webseite pr[üu]fen|aktuelle termine auf webseite|\(neotaste deal\)|\(7 days rolling\)|g[üu]ltig 2 tage vor oder nach dem geburtstag)/i.test(text)
    || isScheduleOnlyExpiry(text)
    || isPartOfDayExpiry(text);
}

function isRecurringChurchLikeExpiry(value) {
  const text = cleanText(value).toLowerCase();
  if (!text) return false;
  return /^(regelm[aä]ßig|regelmaessig|zeiten auf webseite pr[üu]fen|aktuelle termine auf webseite|so \d{1,2}:\d{2} uhr|jeden\b|jeden sonntag\b|jeden dienstag\b|jeden mittwoch\b|jeden donnerstag\b|jeden freitag\b|jeden samstag\b)/i.test(text);
}

function isScheduleOnlyExpiry(value) {
  const text = cleanText(value).toLowerCase();
  if (!text) return false;
  const hasExplicitDate =
    /\b\d{1,2}\.\d{1,2}\.(?:\d{2,4})?\b/.test(text) ||
    /\b\d{1,2}\.\s*[-–]\s*\d{1,2}\.\d{1,2}\.\d{4}\b/.test(text) ||
    /\b(j[aä]nner|januar|februar|m[aä]rz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\s+\d{4}\b/.test(text) ||
    /\b\d{1,2}\.?\s+(j[aä]nner|januar|februar|m[aä]rz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\b/.test(text);
  if (hasExplicitDate) return false;
  return /^(mo|di|mi|do|fr|sa|so|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)/i.test(text)
    || /\b(mo|di|mi|do|fr|sa|so)(?:\s*[-–&/]\s*(mo|di|mi|do|fr|sa|so))+/i.test(text)
    || /\b\d{1,2}:\d{2}\s*(?:uhr)?\b/i.test(text) && !/\b(bis|endet|gültig|gueltig|läuft|laeuft|nur heute|morgen)\b/i.test(text);
}

function isPartOfDayExpiry(value) {
  const text = cleanText(value).toLowerCase();
  if (!text) return false;
  return /\b(vormittag|nachmittag|abend|morgens|mittags|abends)\b/i.test(text);
}

function isChurchDomain(hostname = '') {
  const host = hostname.toLowerCase();
  return [
    'hillsong.com',
    'www.hillsong.com',
    'cigwien.at',
    'www.cigwien.at',
    'icf-wien.at',
    'www.icf-wien.at',
    'jesuszentrum.at',
    'www.jesuszentrum.at',
    'cgw.at',
    'www.cgw.at',
    'fcgwien.at',
    'www.fcgwien.at',
    'feg.at',
    'www.feg.at',
  ].includes(host);
}

export function shouldSkipUrlExpiryLookup(deal = {}, url = '', raw = '') {
  if (!url || typeof url !== 'string') return true;

  try {
    const parsedUrl = new URL(url);
    if (URL_EXPIRY_BLOCK_HOSTS.has(parsedUrl.hostname.toLowerCase())) return true;
  } catch {
    return true;
  }

  const category = cleanText(deal.category || '').toLowerCase();
  if (category === 'kirche' || category === 'gottesdienste') return true;
  if ((category === 'events' || category === 'gemeinde') && isRecurringChurchLikeExpiry(raw)) return true;

  if (isRecurringChurchLikeExpiry(raw)) return true;
  return false;
}

function parseIsoLike(text) {
  const direct = Date.parse(text);
  if (!Number.isNaN(direct) && /^\d{4}-\d{1,2}-\d{1,2}/.test(text)) {
    const m = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    return {
      date: endOfUtcDay(Number(m[1]), Number(m[2]) - 1, Number(m[3])),
      precision: 'day',
      source: 'text',
    };
  }
  return null;
}

function parseDmyRange(text) {
  let m = text.match(/\b\d{1,2}\.\d{1,2}\.\d{4}\s*[-–]\s*(\d{1,2})\.(\d{1,2})\.(\d{4})\b/);
  if (m) {
    return {
      date: endOfUtcDay(Number(m[3]), Number(m[2]) - 1, Number(m[1])),
      precision: 'day',
      source: 'text',
    };
  }

  m = text.match(/\b\d{1,2}\.\d{1,2}\.\s*[-–]\s*(\d{1,2})\.(\d{1,2})\.(\d{4})\b/);
  if (m) {
    return {
      date: endOfUtcDay(Number(m[3]), Number(m[2]) - 1, Number(m[1])),
      precision: 'day',
      source: 'text',
    };
  }

  m = text.match(/\b\d{1,2}\.-(\d{1,2})\.(\d{1,2})\.(\d{4})\b/);
  if (m) {
    return {
      date: endOfUtcDay(Number(m[3]), Number(m[2]) - 1, Number(m[1])),
      precision: 'day',
      source: 'text',
    };
  }

  return null;
}

function parseMonthNameRange(text) {
  const monthPattern = '(j[aä]nner|januar|februar|m[aä]rz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember|january|february|march|april|may|june|july|august|september|october|november|december)';
  const regex = new RegExp(`\\b\\d{1,2}\\.?\\s*[-–]\\s*(\\d{1,2})\\.?\\s+${monthPattern}\\s*(\\d{4})\\b`, 'i');
  const m = text.match(regex);
  if (!m) return null;
  const month = MONTH_MAP[m[2].toLowerCase()];
  if (month === undefined) return null;
  return {
    date: endOfUtcDay(Number(m[3]), month, Number(m[1])),
    precision: 'day',
    source: 'text',
  };
}

function parseDmy(text, now) {
  let m = text.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b/);
  if (m) {
    const year = String(m[3]).length === 2 ? Number(`20${m[3]}`) : Number(m[3]);
    return {
      date: endOfUtcDay(year, Number(m[2]) - 1, Number(m[1])),
      precision: 'day',
      source: 'text',
    };
  }

  m = text.match(/\b(\d{1,2})\.(\d{1,2})\.(?!\d)/);
  if (m) {
    return {
      date: endOfUtcDay(now.getUTCFullYear(), Number(m[2]) - 1, Number(m[1])),
      precision: 'day',
      source: 'text',
    };
  }

  return null;
}

function parseNamedDate(text, now) {
  const monthPattern = '(j[aä]nner|januar|februar|m[aä]rz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember|january|february|march|april|may|june|july|august|september|october|november|december)';
  let m = text.match(new RegExp(`\\b(\\d{1,2})\\.?\\s+${monthPattern}\\s*(\\d{4})?\\b`, 'i'));
  if (m) {
    const month = MONTH_MAP[m[2].toLowerCase()];
    if (month !== undefined) {
      const year = m[3] ? Number(m[3]) : now.getUTCFullYear();
      return {
        date: endOfUtcDay(year, month, Number(m[1])),
        precision: 'day',
        source: 'text',
      };
    }
  }

  m = text.match(new RegExp(`\\b${monthPattern}\\s+(\\d{1,2}),?\\s*(\\d{4})?\\b`, 'i'));
  if (m) {
    const month = MONTH_MAP[m[1].toLowerCase()];
    if (month !== undefined) {
      const year = m[3] ? Number(m[3]) : now.getUTCFullYear();
      return {
        date: endOfUtcDay(year, month, Number(m[2])),
        precision: 'day',
        source: 'text',
      };
    }
  }

  return null;
}

function parseMonthOnly(text, now) {
  const monthPattern = '(j[aä]nner|januar|februar|m[aä]rz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember|january|february|march|april|may|june|july|august|september|october|november|december)';
  const m = text.match(new RegExp(`\\b(?:im\\s+|bis\\s+ende\\s+)?${monthPattern}\\s*(\\d{4})\\b`, 'i'));
  if (!m) return null;
  const month = MONTH_MAP[m[1].toLowerCase()];
  if (month === undefined) return null;
  return {
    date: endOfUtcMonth(Number(m[2]), month),
    precision: 'month',
    source: 'text',
  };
}

function stripScheduleSuffix(text) {
  return cleanText(text)
    .replace(/\s+(während öffnungszeiten|regelmäßige?n? zeiten|regular hours|nicht angegeben|not specified|siehe details|see details)$/i, '')
    .replace(/\s+(mo|di|mi|do|fr|sa|so)(?:\s*[-–&/]\s*(mo|di|mi|do|fr|sa|so))+\s*,?\s*\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}.*$/i, '')
    .replace(/\s+(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\s*\d{1,2}:\d{2}.*$/i, '')
    .replace(/\s+(fr|sa|so|mo|di|mi|do)\s+\d{1,2}:\d{2}.*$/i, '')
    .trim();
}

function isolateLeadingExpiryToken(text) {
  const normalized = stripScheduleSuffix(text);
  const patterns = [
    /^(\d{1,2}\.\s*[-–]\s*\d{1,2}\.\d{1,2}\.\d{4})\b/i,
    /^(\d{1,2}\.\d{1,2}\.\d{4}\s*[-–]\s*\d{1,2}\.\d{1,2}\.\d{4})\b/i,
    /^(\d{1,2}\.\d{1,2}\.\s*[-–]\s*\d{1,2}\.\d{1,2}\.\d{4})\b/i,
    /^((?:j[aä]nner|januar|februar|m[aä]rz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\s+\d{4})\b/i,
    /^(\d{1,2}\.\d{1,2}\.\d{2,4})\b/i,
    /^(\d{1,2}\.\d{1,2}\.)\b/i,
    /^(\d{1,2}\.?\s+(?:j[aä]nner|januar|februar|m[aä]rz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)(?:\s+\d{4})?)\b/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) return cleanText(match[1]);
  }

  return normalized;
}

export function parseExpiryDetails(value, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const text = cleanText(value);
  if (!text) return null;

  if (isVagueExpiry(text)) return null;

  const withoutPrefixes = isolateLeadingExpiryToken(
    text.replace(/^(gültig\s*bis|einlösbar\s*bis|aktion\s*bis|angebot\s*bis|läuft\s*bis|nur\s*bis|endet\s*am|bis)\s*[:\-]?\s*/i, '')
  );

  return (
    parseIsoLike(withoutPrefixes) ||
    parseDmyRange(withoutPrefixes) ||
    parseMonthNameRange(withoutPrefixes) ||
    parseDmy(withoutPrefixes, now) ||
    parseNamedDate(withoutPrefixes, now) ||
    parseMonthOnly(withoutPrefixes, now)
  );
}

function extractWestfieldExpiry(text, now) {
  const range = text.match(/\b\d{1,2}\s+[A-Za-zäöüÄÖÜ]+\s+\d{4}\s*[—-]\s*(\d{1,2}\s+[A-Za-zäöüÄÖÜ]+\s+\d{4})\b/);
  if (!range) return null;
  const parsed = parseExpiryDetails(range[1], { now });
  return parsed?.date ? { ...parsed, source: 'url' } : null;
}

function extractNeotasteExpiry(text) {
  if (/90\s*days?|7\s*days?\s*rolling|rolling validity|neotaste deal/i.test(text)) {
    return null;
  }
  return null;
}

export function extractExpiryDateFromHtml(html, options = {}) {
  if (!html) return null;
  const now = options.now instanceof Date ? options.now : new Date();
  const hostname = cleanText(options.hostname || '').toLowerCase();
  const text = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (hostname.includes('westfield.com')) {
    const westfield = extractWestfieldExpiry(text, now);
    if (westfield) return westfield;
  }

  if (hostname.includes('neotaste.com')) {
    const neotaste = extractNeotasteExpiry(text);
    if (neotaste) return neotaste;
    return null;
  }

  if (isChurchDomain(hostname)) {
    return null;
  }

  const phrases = [
    /(?:gültig\s*bis|einlösbar\s*bis|aktion\s*bis|angebot\s*bis|läuft\s*bis|nur\s*bis|endet\s*am|ends?\s*(?:on)?|until)\s*[:\-]?\s*([^.!,;\n]{4,90})/gi,
  ];

  for (const re of phrases) {
    let m;
    while ((m = re.exec(text)) !== null) {
      const parsed = parseExpiryDetails(m[1], { now });
      if (parsed?.date) return { ...parsed, source: 'url' };
    }
  }

  const broadMatches = text.match(/\b\d{4}-\d{1,2}-\d{1,2}\b|\b\d{1,2}\.\d{1,2}\.\d{2,4}\b|\b\d{1,2}\.\s*(?:j[aä]nner|januar|februar|m[aä]rz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\s*\d{0,4}\b|\b(?:j[aä]nner|januar|februar|m[aä]rz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\s+\d{4}\b/gi) || [];
  for (const token of broadMatches.slice(0, 25)) {
    const parsed = parseExpiryDetails(token, { now });
    if (parsed?.date) return { ...parsed, source: 'url' };
  }

  return null;
}

export async function fetchExpiryFromUrl(url, options = {}) {
  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return null;
  let hostname = '';
  try {
    hostname = new URL(url).hostname;
  } catch {
    hostname = '';
  }
  const timeoutMs = Number(options.timeoutMs || process.env.URL_CHECK_TIMEOUT_MS || 7000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'user-agent': URL_CHECK_UA,
        'accept': 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const ctype = (res.headers.get('content-type') || '').toLowerCase();
    if (!ctype.includes('text/html') && !ctype.includes('application/xhtml+xml')) return null;
    const html = await res.text();
    return extractExpiryDateFromHtml(html, { ...options, hostname });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function normalizeDealExpiry(deal, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const allowUrlLookup = options.allowUrlLookup !== false;
  const raw = cleanText(
    deal.expires ||
    deal.expiresOriginal ||
    deal.end_date ||
    deal.validity_date ||
    ''
  );
  const url = cleanText(deal.url);

  if (raw) {
    deal.expiresOriginal = deal.expiresOriginal || raw;
  }

  const parsed = parseExpiryDetails(raw, { now });
  const shouldCheckUrl = Boolean(
    allowUrlLookup &&
    url &&
    /^https?:\/\//i.test(url) &&
    !shouldSkipUrlExpiryLookup(deal, url, raw) &&
    (
      !parsed ||
      parsed.precision !== 'day' ||
      isVagueExpiry(raw)
    )
  );

  if (shouldCheckUrl) {
    const cache = options.urlCache;
    let fetched = cache?.get(url);
    if (fetched === undefined) {
      fetched = await fetchExpiryFromUrl(url, options);
      if (cache) cache.set(url, fetched || null);
    }
    if (fetched?.date) {
      deal.expires = fetched.date.toISOString();
      deal.expiresPrecision = fetched.precision || 'day';
      deal.expiresSource = fetched.source || 'url';
      deal.expiresDetectedFromUrl = true;
      return deal;
    }
  }

  if (parsed?.date) {
    deal.expires = parsed.date.toISOString();
    deal.expiresPrecision = parsed.precision || 'day';
    deal.expiresSource = parsed.source || 'text';
    return deal;
  }

  deal.expires = '';
  deal.expiresPrecision = '';
  deal.expiresSource = '';
  return deal;
}

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

function confidenceRank(confidence) {
  if (confidence === 'high') return 3;
  if (confidence === 'medium') return 2;
  if (confidence === 'low') return 1;
  return 0;
}

function clearStructuredExpiryFields(deal) {
  delete deal.expiryKind;
  delete deal.expiryDisplayText;
  delete deal.validOn;
  delete deal.validFrom;
  delete deal.validUntil;
  delete deal.dateConfidence;
}

function toIsoDateString(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isoDateFromMs(ms) {
  if (!Number.isFinite(ms)) return '';
  const date = new Date(ms);
  return toIsoDateString(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
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

export function shouldVerifyExpiryAgainstUrl(deal = {}, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const raw = cleanText(
    deal.expires ||
    deal.expiresOriginal ||
    deal.end_date ||
    deal.validity_date ||
    ''
  );
  const url = cleanText(deal.url);
  if (!url || !/^https?:\/\//i.test(url)) return false;
  if (shouldSkipUrlExpiryLookup(deal, url, raw)) return false;
  if (!raw) return true;
  if (isVagueExpiry(raw)) return true;

  const parsed = parseExpiryDetails(raw, { now });
  if (!parsed?.date || parsed.precision !== 'day') return true;

  const contextText = [
    deal?.title,
    deal?.description,
    deal?.category,
    deal?.type,
  ].filter(Boolean).join(' ');
  const shape = parseExpiryShape(raw, { now, contextText });
  return confidenceRank(shape.confidence) < 3 || shape.kind === 'unknown';
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

export function parseExpiryShape(value, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const raw = cleanText(value);
  if (!raw) return { kind: 'unknown', raw: '' };

  const contextText = cleanText(options.contextText || '');
  const text = raw.toLowerCase();
  const signalText = [raw, contextText].filter(Boolean).join(' ').toLowerCase();
  const monthPattern = '(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)';
  const explicitDateMatches = text.match(/\b(\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}(?:[./-]\d{2,4})?|\d{1,2}-\d{1,2}-\d{2,4})\b/g) || [];
  const uniqueExplicitDates = new Set(explicitDateMatches);
  const hasSingleExplicitDate = uniqueExplicitDates.size === 1;
  const hasDateRange = /\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\s*[-–]\s*\d{1,2}[./-]\d{1,2}/.test(text);
  const hasTimeOnlyEndSignal = /\bbis\s+\d{1,2}:\d{2}\b/.test(text);
  const hasEventishSignal =
    /\b(eröffnung|eroeffnung|opening|launch|after work|event|brunch|verkostung|tasting|festival)\b/.test(signalText) ||
    /\(\s*\d+\s*(stunde|stunden|hour|hours|tag|tage)\b/.test(signalText);
  const hasSingleDaySignal =
    /\b(gültig am|gueltig am|nur heute|heute|morgen)\b/.test(signalText) ||
    /\bam\s+\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b/.test(signalText) ||
    /\bam\s+\d{1,2}\.?\s+(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\b/.test(signalText) ||
    /\b(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/.test(signalText);
  const monthMap = {
    januar: 1, februar: 2, 'märz': 3, maerz: 3, april: 4, mai: 5, juni: 6,
    juli: 7, august: 8, september: 9, oktober: 10, november: 11, dezember: 12,
  };

  const buildIso = (year, month, day) => toIsoDateString(Number(year), Number(month), Number(day));

  if (isVagueExpiry(raw) || isRecurringChurchLikeExpiry(raw)) {
    return { kind: 'recurring', raw, confidence: 'low' };
  }

  if (/\bjeden\s+(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/.test(text) ||
      /\bwöchentlich\b|\bwoechentlich\b|\bmonatlich\b|\bregelmäßig\b|\bregelm[aä](?:ß|ss)ig\b/.test(text) ||
      /\bsolange vorrat reicht\b|\bsolange der vorrat reicht\b|\btba\b|\bvariiert\b/.test(text)) {
    return { kind: 'recurring', raw, confidence: 'low' };
  }

  let m = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})\s*[-–]\s*(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (m) {
    const startYear = m[3].length === 2 ? `20${m[3]}` : m[3];
    const endYear = m[6].length === 2 ? `20${m[6]}` : m[6];
    return {
      kind: 'range',
      raw,
      validFrom: buildIso(startYear, m[2], m[1]),
      validUntil: buildIso(endYear, m[5], m[4]),
      confidence: 'high',
    };
  }

  m = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*[-–]\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    const startYear = m[3].length === 2 ? `20${m[3]}` : m[3];
    const endYear = m[6].length === 2 ? `20${m[6]}` : m[6];
    return {
      kind: 'range',
      raw,
      validFrom: buildIso(startYear, m[2], m[1]),
      validUntil: buildIso(endYear, m[5], m[4]),
      confidence: 'high',
    };
  }

  m = text.match(/(\d{1,2})\.\s*[-–]\s*(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (m) {
    const year = m[4].length === 2 ? `20${m[4]}` : m[4];
    return {
      kind: 'range',
      raw,
      validFrom: buildIso(year, m[3], m[1]),
      validUntil: buildIso(year, m[3], m[2]),
      confidence: 'high',
    };
  }

  m = text.match(/(anfang|mitte|ende)\s+(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\s+(\d{4})/i);
  if (m) {
    const year = Number(m[3]);
    const month = monthMap[m[2]];
    const startDay = m[1] === 'anfang' ? 1 : m[1] === 'mitte' ? 10 : 20;
    const endDay = m[1] === 'anfang' ? 10 : m[1] === 'mitte' ? 20 : new Date(year, month, 0).getDate();
    return {
      kind: 'approx-range',
      raw,
      validFrom: buildIso(year, month, startDay),
      validUntil: buildIso(year, month, endDay),
      confidence: 'medium',
    };
  }

  const hasNamedDay = new RegExp(`\\b\\d{1,2}\\.?(?:\\s+|\\.)${monthPattern}\\b`, 'i').test(text);
  if (!hasNamedDay && !hasSingleExplicitDate) {
    m = text.match(new RegExp(`${monthPattern}\\s+(\\d{4})`, 'i'));
  } else {
    m = null;
  }
  if (m) {
    const year = Number(m[2]);
    const month = monthMap[m[1]];
    return {
      kind: 'month',
      raw,
      validFrom: buildIso(year, month, 1),
      validUntil: buildIso(year, month, new Date(year, month, 0).getDate()),
      confidence: 'medium',
    };
  }

  const hasStrongEndSignal = /\b(gültig bis|gueltig bis|endet|endet am|letzter tag|deadline|frist|einlösbar bis|einloesbar bis|aktion bis|läuft bis|laeuft bis|nur bis|bis)\b/.test(signalText);
  const hasEndSignal = hasStrongEndSignal || (/\bbis\b/.test(text) && (!hasSingleExplicitDate || hasDateRange || !hasTimeOnlyEndSignal));
  const hasRealStartSignal = /\b(gültig ab|gueltig ab|startet|startet am|abholung ab|verfügbar ab|verfuegbar ab|ab eröffnung|ab eroeffnung|öffnet am|oeffnet am)\b/.test(signalText);
  const hasTimeOnlyStartSignal = /\bab\s+\d{1,2}:\d{2}\b/.test(signalText);
  const hasStartSignal = !hasEndSignal && (hasRealStartSignal || hasTimeOnlyStartSignal);
  const hasSingleDayTimeWindow = hasSingleExplicitDate && hasTimeOnlyEndSignal;
  const hasSingleDateEventSignal = hasSingleExplicitDate && hasEventishSignal && !hasStrongEndSignal && !hasRealStartSignal;

  const directTokenMatch =
    raw.match(/\b\d{4}-\d{1,2}-\d{1,2}\b/) ||
    raw.match(/\b\d{1,2}\.\d{1,2}\.\d{2,4}\b/) ||
    raw.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/) ||
    raw.match(new RegExp(`\\b\\d{1,2}\\.?(?:\\s+|\\.)${monthPattern}(?:\\s+\\d{4})?\\b`, 'i'));

  const parsed = parseExpiryDetails(directTokenMatch ? directTokenMatch[0] : raw, { now });
  const parsedIso = parsed?.date ? isoDateFromMs(parsed.date.getTime()) : '';
  if (!parsedIso) {
    return { kind: 'unknown', raw, confidence: 'low' };
  }

  if (hasStartSignal) {
    return { kind: 'start', raw, validFrom: parsedIso, confidence: 'high' };
  }
  if (hasSingleDayTimeWindow) {
    return { kind: 'single', raw, validOn: parsedIso, confidence: 'high' };
  }
  if (hasEndSignal) {
    return { kind: 'end', raw, validUntil: parsedIso, confidence: 'high' };
  }
  if (hasSingleDaySignal) {
    return { kind: 'single', raw, validOn: parsedIso, confidence: 'medium' };
  }
  if (hasSingleDateEventSignal) {
    return { kind: 'single', raw, validOn: parsedIso, confidence: 'medium' };
  }
  if (hasSingleExplicitDate) {
    return { kind: 'end', raw, validUntil: parsedIso, confidence: 'medium' };
  }
  return { kind: 'end', raw, validUntil: parsedIso, confidence: 'low' };
}

function applyStructuredExpiryFields(deal, value, options = {}) {
  clearStructuredExpiryFields(deal);
  const contextText = [
    options.contextText,
    deal?.title,
    deal?.description,
    deal?.category,
    deal?.type,
  ].filter(Boolean).join(' ');
  const shape = parseExpiryShape(value, { ...options, contextText });
  deal.expiryKind = shape.kind || 'unknown';
  deal.expiryDisplayText = shape.raw || cleanText(value);
  if (shape.validOn) deal.validOn = shape.validOn;
  if (shape.validFrom) deal.validFrom = shape.validFrom;
  if (shape.validUntil) deal.validUntil = shape.validUntil;
  if (shape.confidence) deal.dateConfidence = shape.confidence;
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

  const phrasePatterns = [
    {
      kind: 'end',
      label: 'gültig bis',
      regex: /(?:gültig\s*bis|einlösbar\s*bis|aktion\s*bis|angebot\s*bis|läuft\s*bis|laeuft\s*bis|nur\s*bis|endet\s*am|end(?:s|et)?\s*(?:on)?|until)\s*[:\-]?\s*([^.!,;\n]{4,90})/gi,
    },
    {
      kind: 'single',
      label: 'gültig am',
      regex: /(?:gültig\s*am|einlösbar\s*am|aktion\s*am|angebot\s*am|nur\s*am|event\s*am|opening\s*on)\s*[:\-]?\s*([^.!,;\n]{4,90})/gi,
    },
    {
      kind: 'start',
      label: 'gültig ab',
      regex: /(?:gültig\s*ab|einlösbar\s*ab|aktion\s*ab|angebot\s*ab|verfügbar\s*ab|verfuegbar\s*ab|startet\s*(?:am|ab)?|available\s*from)\s*[:\-]?\s*([^.!,;\n]{4,90})/gi,
    },
  ];

  for (const pattern of phrasePatterns) {
    let m;
    while ((m = pattern.regex.exec(text)) !== null) {
      const parsed = parseExpiryDetails(m[1], { now });
      if (parsed?.date) {
        return {
          ...parsed,
          source: 'url',
          rawText: cleanText(m[1]),
          shapeText: `${pattern.label} ${cleanText(m[1])}`,
          kindHint: pattern.kind,
        };
      }
    }
  }

  const broadMatches = text.match(/\b\d{4}-\d{1,2}-\d{1,2}\b|\b\d{1,2}\.\d{1,2}\.\d{2,4}\b|\b\d{1,2}\.\s*(?:j[aä]nner|januar|februar|m[aä]rz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\s*\d{0,4}\b|\b(?:j[aä]nner|januar|februar|m[aä]rz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\s+\d{4}\b/gi) || [];
  for (const token of broadMatches.slice(0, 25)) {
    const parsed = parseExpiryDetails(token, { now });
    if (parsed?.date) {
      return {
        ...parsed,
        source: 'url',
        rawText: cleanText(token),
        shapeText: cleanText(token),
      };
    }
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
  const shouldCheckUrl = Boolean(allowUrlLookup && shouldVerifyExpiryAgainstUrl(deal, { now }));

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
      const contextText = [
        deal?.title,
        deal?.description,
        deal?.category,
        deal?.type,
      ].filter(Boolean).join(' ');
      const rawShape = parseExpiryShape(deal.expiresOriginal || raw || '', { now, contextText });
      const fetchedShapeSource = cleanText(fetched.shapeText || fetched.rawText || isoDateFromMs(fetched.date.getTime()));
      const fetchedShape = parseExpiryShape(fetchedShapeSource, { now, contextText });
      const useFetchedStructure =
        !parsed?.date ||
        isVagueExpiry(raw) ||
        rawShape.kind === 'unknown' ||
        confidenceRank(fetchedShape.confidence) > confidenceRank(rawShape.confidence) ||
        Boolean(fetched.kindHint) ||
        fetchedShape.kind !== rawShape.kind;
      applyStructuredExpiryFields(
        deal,
        useFetchedStructure ? fetchedShapeSource : (deal.expiresOriginal || raw || deal.expires),
        { now, contextText }
      );
      if (useFetchedStructure) {
        deal.expiryDisplayText = fetchedShapeSource;
        deal.dateConfidence = fetchedShape.confidence || deal.dateConfidence || 'medium';
      }
      return deal;
    }
  }

  if (parsed?.date) {
    deal.expires = parsed.date.toISOString();
    deal.expiresPrecision = parsed.precision || 'day';
    deal.expiresSource = parsed.source || 'text';
    applyStructuredExpiryFields(deal, deal.expiresOriginal || raw || deal.expires, { now });
    return deal;
  }

  deal.expires = '';
  deal.expiresPrecision = '';
  deal.expiresSource = '';
  applyStructuredExpiryFields(deal, deal.expiresOriginal || raw || '', { now });
  return deal;
}

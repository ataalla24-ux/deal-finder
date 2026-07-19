import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { inspectDealUrlHealth, parseExpiryShape } from './expiry-utils.js';
import {
  getExpiryEvidenceRank,
  getPublicationEvidence,
  getViennaEvidence as getStructuredViennaEvidence,
} from './deal-evidence-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const DEFAULT_REPORT_PATH = path.join(DOCS_DIR, 'deal-validity-report.json');
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CHURCH_WEEKDAY = 1; // Monday, aligned with the Churches Wien weekly workflow.
const EXCLUDED_SOURCE_PATTERNS = [
  { label: 'DieRestaurantWoche', hostPattern: /(^|\.)dierestaurantwoche\.at$/i, textPattern: /\b(die\s*restaurantwoche|restaurantwoche|culinarius\s+restaurant\s+week)\b/i },
  { label: 'Neotaste', hostPattern: /(^|\.)neotaste\.com$/i, textPattern: /\bneotaste\b/i },
  { label: 'TheFork', hostPattern: /(^|\.)thefork\.(at|com)$/i, textPattern: /\bthe\s*fork\b|\bthefork\b/i },
  { label: 'gastro.news', hostPattern: /(^|\.)gastro\.news$/i, textPattern: /\bgastro\.news\b|\bgastro\s+news\b/i },
  { label: '1000things Website', hostPattern: /(^|\.)1000things(?:magazine)?\.(?:at|com)$/i },
];
const VIENNA_SIGNAL_PATTERN = /\b(wien|vienna)\b|(?:^|[^\d])(1(?:0[1-9]0|1[0-9]0|2[0-3]0))(?:\b|[^\d])/i;
const SYNTHETIC_PUBLICATION_SOURCE_PATTERN = /(?:firecrawl.*run|agent(?:\s|[-_])?run|crawl(?:ed|er)?(?:\s|[-_])?(?:at|run|time)|scrap(?:ed|er)(?:\s|[-_])?(?:at|run|time)|discovered(?:\s|[-_])?at|generated(?:\s|[-_])?at|fallback|current(?:\s|[-_])?time)/i;

function cleanText(value) {
  if (!value) return '';
  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function toDate(value) {
  const text = cleanText(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIsoDate(value) {
  const date = value instanceof Date ? value : toDate(value);
  if (!date) return '';
  return date.toISOString().slice(0, 10);
}

function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isBeforeToday(isoDate, now) {
  const text = cleanText(isoDate);
  const dateOnlyOrMidnight = text.match(/^(\d{4}-\d{2}-\d{2})(?:T00:00:00(?:\.000)?Z)?$/)?.[1];
  if (dateOnlyOrMidnight) return dateOnlyOrMidnight < toIsoDate(startOfUtcDay(now));
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) && timestamp < now.getTime();
}

function ageDays(date, now) {
  if (!(date instanceof Date)) return null;
  const sourceDay = startOfUtcDay(date);
  const today = startOfUtcDay(now);
  return Math.max(0, Math.floor((today.getTime() - sourceDay.getTime()) / DAY_MS));
}

function normalizeUrl(value) {
  const text = cleanText(value);
  return /^https?:\/\//i.test(text) ? text : '';
}

function hostnameFromUrl(value) {
  const url = normalizeUrl(value);
  if (!url) return '';
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isSocialPostDeal(deal) {
  const signal = [
    deal.url,
    deal.source,
    deal.originSource,
    deal.id,
  ].map(cleanText).join(' ').toLowerCase();
  return /(^|[^\w])(tiktok|instagram)([^\w]|$)/i.test(signal)
    || /(^|\.)tiktok\.com$/i.test(hostnameFromUrl(deal.url))
    || /(^|\.)instagram\.com$/i.test(hostnameFromUrl(deal.url));
}

function isLegacyFirecrawlDeal(deal) {
  const signal = [deal.source, deal.originSource, deal.id, deal.sourceKeys, deal.evidenceSources]
    .flat()
    .map(cleanText)
    .join(' ');
  return /\bfirecrawl\b/i.test(signal);
}

function getDealSignalText(deal, health = null) {
  return [
    deal.id,
    deal.brand,
    deal.title,
    deal.description,
    deal.category,
    deal.type,
    deal.source,
    deal.originSource,
    deal.distance,
    deal.location,
    deal.ort,
    deal.address,
    deal.url,
    health?.finalUrl,
    health?.contentHints?.title,
    health?.contentHints?.description,
  ].map(cleanText).filter(Boolean).join(' ');
}

function getExcludedSourceMatch(deal, health = null) {
  const signal = getDealSignalText(deal, health);
  const hosts = [deal.url, health?.finalUrl].map(hostnameFromUrl).filter(Boolean);
  return EXCLUDED_SOURCE_PATTERNS.find((entry) => {
    if (entry.textPattern?.test(signal)) return true;
    return hosts.some((host) => entry.hostPattern.test(host));
  }) || null;
}

function hasViennaSignalInText(value) {
  return VIENNA_SIGNAL_PATTERN.test(cleanText(value));
}

function hasMissingLocation(deal) {
  return Array.isArray(deal.missingFields) && deal.missingFields.includes('Ort');
}

function hasViennaEvidence(deal, health = null) {
  const strongLocationText = [
    deal.address,
    deal.location,
    deal.ort,
    hasMissingLocation(deal) ? '' : deal.distance,
  ].map(cleanText).filter(Boolean).join(' ');

  if (hasViennaSignalInText(strongLocationText)) return true;

  const contextText = [
    deal.title,
    deal.description,
    deal.brand,
    deal.url,
    health?.finalUrl,
    health?.contentHints?.title,
    health?.contentHints?.description,
  ].map(cleanText).filter(Boolean).join(' ');

  return hasViennaSignalInText(contextText);
}

function hasSocialViennaEvidence(deal, context = {}) {
  const structured = getStructuredViennaEvidence(deal, {
    registryUsernames: context.registryUsernames,
  });
  if (structured.hasViennaEvidence) return true;

  // For social posts a display/default value such as `distance: "Wien"` is
  // not evidence. If no structured evidence exists, require the post content
  // itself to name Vienna or a Vienna postcode.
  return hasViennaSignalInText([
    deal.description,
    deal.evidence?.textSample,
  ].map(cleanText).filter(Boolean).join(' '));
}

function isChurchServiceDeal(deal) {
  const signal = [
    deal.category,
    deal.source,
    deal.originSource,
    deal.title,
    deal.description,
  ].map(cleanText).join(' ').toLowerCase();

  return /\b(gottesdienste?|freikirche|freikirchen|church service|service times)\b/i.test(signal);
}

function shouldAllowChurchThisRun(now, options = {}) {
  const configured = Number(options.churchWeekday ?? process.env.DEAL_VALIDITY_CHURCH_WEEKDAY ?? DEFAULT_CHURCH_WEEKDAY);
  const weekday = Number.isFinite(configured) ? configured : DEFAULT_CHURCH_WEEKDAY;
  return startOfUtcDay(now).getUTCDay() === weekday;
}

function collectExpiryCandidates(deal, health, now) {
  const candidates = [];
  const add = (source, raw, shape = null, rank = 2, evidenceSource = '') => {
    const text = cleanText(raw);
    const parsedShape = shape || (text ? parseExpiryShape(text, { now }) : null);
    if (!parsedShape) return;
    candidates.push({
      source,
      raw: text || cleanText(parsedShape.raw),
      kind: cleanText(parsedShape.kind),
      validOn: cleanText(parsedShape.validOn),
      validFrom: cleanText(parsedShape.validFrom),
      validUntil: cleanText(parsedShape.validUntil),
      confidence: cleanText(parsedShape.confidence),
      rank,
      evidenceSource: cleanText(evidenceSource),
    });
  };

  const hasStructuredExpiry = Boolean(deal.validOn || deal.validFrom || deal.validUntil);
  const hasIndependentExpiresEvidence = !hasStructuredExpiry || Boolean(
    cleanText(deal.expiresSource)
    && cleanText(deal.expiresSource) !== cleanText(deal.expirySource)
  );
  if (hasIndependentExpiresEvidence) {
    add(
      'deal.expires',
      deal.expires || deal.expiresOriginal || deal.end_date || deal.validity_date || '',
      null,
      getExpiryEvidenceRank(deal, 'expires'),
      deal.expiresSource || deal.expirySource,
    );
  }

  if (hasStructuredExpiry) {
    add('deal.structured', deal.expiryDisplayText || deal.validUntil || deal.validOn || deal.expires || '', {
      kind: deal.expiryKind || (deal.validOn ? 'single' : (deal.validUntil ? 'end' : 'start')),
      raw: deal.expiryDisplayText || deal.validUntil || deal.validOn || deal.expires || '',
      validOn: deal.validOn || '',
      validFrom: deal.validFrom || '',
      validUntil: deal.validUntil || '',
      confidence: deal.dateConfidence || '',
    }, getExpiryEvidenceRank(deal, deal.validUntil ? 'validUntil' : 'validOn'), deal.expirySource || deal.expiresSource);
  }

  const hints = health?.dateHints || {};
  if (hints.validOn || hints.validFrom || hints.validUntil) {
    add('url.dateHints', hints.targetDateRaw || hints.validOn || hints.validUntil || hints.validFrom, {
      kind: hints.targetDateKind || (hints.validOn ? 'single' : (hints.validUntil ? 'end' : 'start')),
      raw: hints.targetDateRaw || '',
      validOn: hints.validOn || '',
      validFrom: hints.validFrom || '',
      validUntil: hints.validUntil || '',
      confidence: 'url',
    }, 100, 'url.dateHints');
  }

  return candidates.filter((candidate) => candidate.validOn || candidate.validFrom || candidate.validUntil || candidate.kind === 'recurring');
}

function getExpiryDecision(expiryCandidates, now) {
  const ranked = expiryCandidates.map((candidate) => {
    const terminalDate = candidate.validUntil || candidate.validOn || '';
    const timestamp = Date.parse(terminalDate || '');
    const expired = Boolean(terminalDate && isBeforeToday(terminalDate, now));
    const validFromTimestamp = Date.parse(candidate.validFrom || candidate.validOn || '');
    const notStarted = Number.isFinite(validFromTimestamp) && validFromTimestamp > now.getTime();
    return { candidate, timestamp: Number.isFinite(timestamp) ? timestamp : 0, expired, notStarted };
  }).sort((left, right) => Number(right.candidate.rank || 0) - Number(left.candidate.rank || 0)
    || Number(left.expired) - Number(right.expired)
    || right.timestamp - left.timestamp);
  const strongest = ranked[0];
  if (strongest?.expired) {
    const expired = strongest.candidate;
    return {
      blocked: true,
      reason: `abgelaufen (${expired.validOn || expired.validUntil})`,
      source: expired.source,
      candidate: expired,
    };
  }
  if (strongest?.notStarted) {
    const future = strongest.candidate;
    return {
      blocked: true,
      reason: `noch nicht gestartet (${future.validFrom})`,
      source: future.source,
      candidate: future,
    };
  }
  return {
    blocked: false,
    source: strongest?.candidate?.source || '',
    candidate: strongest?.candidate || null,
  };
}

function getTrustedSocialPublicationEvidence(deal) {
  // Some importers historically copied their crawl time into both pubDate and
  // sourcePublishedAt. Remove such fields before asking the shared evidence
  // helper to select the strongest remaining source timestamp.
  const sanitized = { ...deal };
  const sourcePublishedAtSource = cleanText(
    deal.sourcePublishedAtSource || deal.sourceDateSource || deal.pubDateSource
  );
  if (SYNTHETIC_PUBLICATION_SOURCE_PATTERN.test(sourcePublishedAtSource)) {
    delete sanitized.sourcePublishedAt;
    delete sanitized.source_published_at;
  }

  const publication = getPublicationEvidence(sanitized);
  if (!publication.sourcePublishedAt || publication.publicationEvidenceRank < 4) return null;
  if (SYNTHETIC_PUBLICATION_SOURCE_PATTERN.test(cleanText(publication.sourcePublishedAtSource))) return null;
  return publication;
}

function getPublicationCandidates(deal, health) {
  const candidates = [];
  const add = (source, value) => {
    const date = toDate(value);
    if (!date) return;
    candidates.push({
      source,
      iso: date.toISOString(),
      date,
    });
  };

  if (isLegacyFirecrawlDeal(deal)) {
    // User-requested compatibility path: Firecrawl keeps the pre-existing
    // publication treatment while evidence-gated Instagram sources use the
    // stricter timestamp provenance below.
    add('url.publicationDate', health?.dateHints?.publicationDate);
    add('deal.pubDate', deal.pubDate);
    return candidates;
  }

  if (isSocialPostDeal(deal)) {
    const publication = getTrustedSocialPublicationEvidence(deal);
    if (publication) {
      add(`deal.${publication.sourcePublishedAtSource || 'sourcePublishedAt'}`, publication.sourcePublishedAt);
    }
    return candidates;
  }
  add('url.publicationDate', health?.dateHints?.publicationDate);
  add('deal.pubDate', deal.pubDate);
  add('deal.createdAt', deal.createdAt);
  add('deal.discoveredAt', deal.discoveredAt);
  add('deal.submittedAt', deal.submittedAt);
  add('deal.lastUpdated', deal.lastUpdated);
  return candidates;
}

function getFreshnessDecision(publicationCandidates, maxAgeDays, now, options = {}) {
  if (publicationCandidates.length === 0) {
    return {
      blocked: Boolean(options.requireDate),
      reason: options.requireDate ? 'kein echtes Social-Post-Datum gefunden' : '',
      warning: 'kein Quell-/Post-Datum gefunden',
      selected: null,
    };
  }

  const future = publicationCandidates.find((candidate) => candidate.date.getTime() > now.getTime() + 10 * 60 * 1000);
  if (future) {
    return {
      blocked: true,
      reason: `Quell-/Post-Datum liegt in der Zukunft (${toIsoDate(future.date)})`,
      selected: future,
      ageDays: null,
    };
  }

  publicationCandidates.sort((a, b) => a.date.getTime() - b.date.getTime());
  const oldest = publicationCandidates[0];
  const age = ageDays(oldest.date, now);
  if (age !== null && age > maxAgeDays) {
    return {
      blocked: true,
      reason: `älter als ${maxAgeDays} Tage (${toIsoDate(oldest.date)})`,
      selected: oldest,
      ageDays: Number(age.toFixed(1)),
    };
  }

  publicationCandidates.sort((a, b) => b.date.getTime() - a.date.getTime());
  const newest = publicationCandidates[0];
  return {
    blocked: false,
    selected: newest,
    ageDays: Number(ageDays(newest.date, now).toFixed(1)),
  };
}

function summarizeUrlHealth(health) {
  if (!health) return 'nicht geprüft';
  if (health.invalid) return `ungültig: ${health.reason || 'URL ungültig'}`;
  if (health.transientError) return `unklar: ${health.reason || 'temporärer URL-Fehler'}`;
  if (health.status) return `HTTP ${health.status}`;
  return 'geprüft';
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Number.isFinite(concurrency) ? Math.max(1, Math.floor(concurrency)) : 1;
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function inspectUrlWithCache(url, cache, options) {
  if (!url) {
    return { invalid: true, reason: 'fehlende Ziel-URL' };
  }
  if (cache.has(url)) return cache.get(url);
  const inspector = options.inspectDealUrlHealth || inspectDealUrlHealth;
  const health = await inspector(url, options);
  cache.set(url, health);
  return health;
}

function buildPublicValidationMeta(decision) {
  return {
    status: decision.allowed ? (decision.warnings.length ? 'warning' : 'ok') : 'blocked',
    checkedAt: decision.checkedAt,
    reasons: decision.reasons,
    warnings: decision.warnings,
    sourceDate: decision.sourceDate,
    sourceDateSource: decision.sourceDateSource,
    sourceAgeDays: decision.sourceAgeDays,
    expiryDate: decision.expiryDate,
    expirySource: decision.expirySource,
    urlStatus: decision.urlStatus,
    finalUrl: decision.finalUrl,
  };
}

async function validateDeal(deal, context) {
  const now = context.now;
  const checkedAt = new Date().toISOString();
  const url = normalizeUrl(deal.url);
  const health = await inspectUrlWithCache(url, context.urlCache, context.urlOptions);
  const excludedSource = getExcludedSourceMatch(deal, health);
  const socialPostDeal = isSocialPostDeal(deal);
  const legacyFirecrawlDeal = isLegacyFirecrawlDeal(deal);
  const publicationCandidates = getPublicationCandidates(deal, health);
  const freshness = getFreshnessDecision(publicationCandidates, context.maxAgeDays, now, {
    requireDate: socialPostDeal,
  });
  const expiryCandidates = collectExpiryCandidates(deal, health, now);
  const expiry = getExpiryDecision(expiryCandidates, now);
  const reasons = [];
  const warnings = [];

  if (health?.invalid) {
    reasons.push(`URL ungültig (${health.reason || 'unbekannt'})`);
  } else if (health?.transientError) {
    warnings.push(`URL nicht eindeutig prüfbar (${health.reason || 'temporärer Fehler'})`);
  }

  if (excludedSource) {
    reasons.push(`ausgeschlossene Quelle (${excludedSource.label})`);
  }

  const viennaConfirmed = socialPostDeal && !legacyFirecrawlDeal
    ? hasSocialViennaEvidence(deal, context)
    : hasViennaEvidence(deal, health);
  if (context.requireVienna && !viennaConfirmed) {
    reasons.push('nicht eindeutig in Wien');
  }

  if (isChurchServiceDeal(deal) && !context.allowChurchThisRun) {
    reasons.push('Gottesdienste nur im Wochenlauf');
  }

  if (freshness.blocked) {
    reasons.push(freshness.reason);
  } else if (freshness.warning) {
    warnings.push(freshness.warning);
  }

  if (expiry.blocked) {
    reasons.push(expiry.reason);
  } else if (expiryCandidates.length === 0) {
    warnings.push('kein Ablaufdatum gefunden');
  }

  const selectedExpiry = expiry.candidate || expiryCandidates.find((candidate) => candidate.validUntil || candidate.validOn) || expiryCandidates[0] || null;
  const selectedDate = freshness.selected || null;
  const allowed = reasons.length === 0;
  const decision = {
    allowed,
    checkedAt,
    reasons,
    warnings,
    sourceDate: selectedDate?.iso || '',
    sourceDateSource: selectedDate?.source || '',
    sourceAgeDays: freshness.ageDays ?? null,
    expiryDate: selectedExpiry?.validOn || selectedExpiry?.validUntil || '',
    expirySource: selectedExpiry?.evidenceSource || selectedExpiry?.source || '',
    urlStatus: summarizeUrlHealth(health),
    finalUrl: health?.finalUrl || url,
  };

  const nextDeal = {
    ...deal,
    url: url || deal.url,
    validity: buildPublicValidationMeta(decision),
  };

  if (selectedDate?.iso && (!deal.pubDate || selectedDate.source === 'url.publicationDate')) {
    nextDeal.pubDate = selectedDate.iso;
    nextDeal.pubDateSource = selectedDate.source;
  }

  if (selectedExpiry?.validOn || selectedExpiry?.validUntil) {
    delete nextDeal.validOn;
    delete nextDeal.validFrom;
    delete nextDeal.validUntil;
    nextDeal.expiryKind = selectedExpiry.kind || nextDeal.expiryKind;
    nextDeal.expiryDisplayText = selectedExpiry.raw || nextDeal.expiryDisplayText;
    nextDeal.dateConfidence = selectedExpiry.confidence || nextDeal.dateConfidence;
    if (selectedExpiry.validOn) nextDeal.validOn = selectedExpiry.validOn;
    if (selectedExpiry.validFrom) nextDeal.validFrom = selectedExpiry.validFrom;
    if (selectedExpiry.validUntil) nextDeal.validUntil = selectedExpiry.validUntil;
    nextDeal.expires = selectedExpiry.validUntil || selectedExpiry.validOn;
    nextDeal.expiresSource = selectedExpiry.evidenceSource || selectedExpiry.source;
    nextDeal.expirySource = selectedExpiry.evidenceSource || selectedExpiry.source;
  }

  return { deal: nextDeal, decision };
}

function buildSummary(results, maxAgeDays) {
  const allowed = results.filter((item) => item.decision.allowed);
  const blocked = results.filter((item) => !item.decision.allowed);
  const warning = allowed.filter((item) => item.decision.warnings.length > 0);
  const reasonCounts = {};
  const reasonCategoryCounts = {};
  for (const item of blocked) {
    for (const reason of item.decision.reasons) {
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
      const category = classifyBlockReason(reason);
      reasonCategoryCounts[category] = (reasonCategoryCounts[category] || 0) + 1;
    }
  }
  return {
    maxAgeDays,
    total: results.length,
    allowed: allowed.length,
    blocked: blocked.length,
    warnings: warning.length,
    reasonCounts,
    reasonCategoryCounts,
  };
}

function classifyBlockReason(reason) {
  const text = cleanText(reason).toLowerCase();
  if (text.startsWith('älter') || text.startsWith('aelter')) return 'älter als 7 Tage';
  if (text.startsWith('abgelaufen')) return 'abgelaufen';
  if (text.startsWith('url ungültig')) return 'ungültige URL';
  if (text.startsWith('ausgeschlossene quelle')) return 'ausgeschlossene Quelle';
  if (text.startsWith('nicht eindeutig in wien')) return 'nicht Wien';
  if (text.startsWith('gottesdienste nur')) return 'Gottesdienste außerhalb Wochenlauf';
  return 'sonstiges';
}

function buildReport(results, summary) {
  const pick = (item) => ({
    id: item.deal.id,
    title: item.deal.title,
    brand: item.deal.brand,
    source: item.deal.originSource || item.deal.source,
    url: item.deal.url,
    reasons: item.decision.reasons,
    warnings: item.decision.warnings,
    sourceDate: item.decision.sourceDate,
    sourceDateSource: item.decision.sourceDateSource,
    sourceAgeDays: item.decision.sourceAgeDays,
    expiryDate: item.decision.expiryDate,
    expirySource: item.decision.expirySource,
    urlStatus: item.decision.urlStatus,
  });

  return {
    generatedAt: new Date().toISOString(),
    summary,
    allowed: results.filter((item) => item.decision.allowed).map(pick),
    blocked: results.filter((item) => !item.decision.allowed).map(pick),
  };
}

async function validateDealsForSlack(deals, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const configuredMaxAgeDays = Number(options.maxAgeDays || process.env.DEAL_VALIDITY_MAX_AGE_DAYS || 7);
  const maxAgeDays = Number.isFinite(configuredMaxAgeDays) && configuredMaxAgeDays >= 0 ? configuredMaxAgeDays : 7;
  const concurrency = Number(options.concurrency || process.env.DEAL_VALIDITY_URL_CONCURRENCY || 8);
  const timeoutMs = Number(options.timeoutMs || process.env.URL_CHECK_TIMEOUT_MS || 7000);
  const urlCache = options.urlCache || new Map();
  const requireVienna = options.requireVienna ?? process.env.DEAL_VALIDITY_REQUIRE_VIENNA !== '0';
  const context = {
    now,
    maxAgeDays,
    requireVienna,
    allowChurchThisRun: options.allowChurchThisRun ?? shouldAllowChurchThisRun(now, options),
    registryUsernames: options.registryUsernames instanceof Set ? options.registryUsernames : new Set(),
    urlCache,
    urlOptions: {
      now,
      timeoutMs,
      inspectDealUrlHealth: options.inspectDealUrlHealth,
    },
  };

  const results = await mapWithConcurrency(deals, concurrency, (deal) => validateDeal(deal, context));
  const summary = buildSummary(results, maxAgeDays);
  const report = buildReport(results, summary);

  return {
    allowedDeals: results.filter((item) => item.decision.allowed).map((item) => item.deal),
    blockedDeals: results.filter((item) => !item.decision.allowed).map((item) => item.deal),
    results,
    summary,
    report,
  };
}

function writeDealValidityReport(report, reportPath = DEFAULT_REPORT_PATH) {
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
}

export {
  DEFAULT_REPORT_PATH,
  validateDealsForSlack,
  writeDealValidityReport,
};

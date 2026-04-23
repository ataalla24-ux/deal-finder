import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { inspectDealUrlHealth, parseExpiryShape } from './expiry-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const DEFAULT_REPORT_PATH = path.join(DOCS_DIR, 'deal-validity-report.json');
const DAY_MS = 24 * 60 * 60 * 1000;

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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  return text < toIsoDate(startOfUtcDay(now));
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

function collectExpiryCandidates(deal, health, now) {
  const candidates = [];
  const add = (source, raw, shape = null) => {
    const text = cleanText(raw);
    const parsedShape = shape || (text ? parseExpiryShape(text, {
      now,
      contextText: [deal.title, deal.description, deal.category, deal.type].filter(Boolean).join(' '),
    }) : null);
    if (!parsedShape) return;
    candidates.push({
      source,
      raw: text || cleanText(parsedShape.raw),
      kind: cleanText(parsedShape.kind),
      validOn: cleanText(parsedShape.validOn),
      validFrom: cleanText(parsedShape.validFrom),
      validUntil: cleanText(parsedShape.validUntil),
      confidence: cleanText(parsedShape.confidence),
    });
  };

  add('deal.expires', deal.expires || deal.expiresOriginal || deal.end_date || deal.validity_date || '');

  if (deal.validOn || deal.validFrom || deal.validUntil) {
    add('deal.structured', deal.expiryDisplayText || deal.expires || '', {
      kind: deal.expiryKind || (deal.validOn ? 'single' : (deal.validUntil ? 'end' : 'start')),
      raw: deal.expiryDisplayText || deal.expires || '',
      validOn: deal.validOn || '',
      validFrom: deal.validFrom || '',
      validUntil: deal.validUntil || '',
      confidence: deal.dateConfidence || '',
    });
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
    });
  }

  return candidates.filter((candidate) => candidate.validOn || candidate.validFrom || candidate.validUntil || candidate.kind === 'recurring');
}

function getExpiryDecision(expiryCandidates, now) {
  const expired = expiryCandidates.find((candidate) => {
    if (candidate.validOn && isBeforeToday(candidate.validOn, now)) return true;
    if (candidate.validUntil && isBeforeToday(candidate.validUntil, now)) return true;
    return false;
  });
  if (expired) {
    return {
      blocked: true,
      reason: `abgelaufen (${expired.validOn || expired.validUntil})`,
      source: expired.source,
      candidate: expired,
    };
  }
  return { blocked: false };
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

  add('url.publicationDate', health?.dateHints?.publicationDate);
  add('deal.pubDate', deal.pubDate);
  add('deal.createdAt', deal.createdAt);
  add('deal.discoveredAt', deal.discoveredAt);
  add('deal.submittedAt', deal.submittedAt);
  add('deal.lastUpdated', deal.lastUpdated);
  return candidates;
}

function getFreshnessDecision(publicationCandidates, maxAgeDays, now) {
  if (publicationCandidates.length === 0) {
    return {
      blocked: false,
      warning: 'kein Quell-/Post-Datum gefunden',
      selected: null,
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
  const publicationCandidates = getPublicationCandidates(deal, health);
  const freshness = getFreshnessDecision(publicationCandidates, context.maxAgeDays, now);
  const expiryCandidates = collectExpiryCandidates(deal, health, now);
  const expiry = getExpiryDecision(expiryCandidates, now);
  const reasons = [];
  const warnings = [];

  if (health?.invalid) {
    reasons.push(`URL ungültig (${health.reason || 'unbekannt'})`);
  } else if (health?.transientError) {
    warnings.push(`URL nicht eindeutig prüfbar (${health.reason || 'temporärer Fehler'})`);
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
    expirySource: selectedExpiry?.source || '',
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
    nextDeal.expiryKind = selectedExpiry.kind || nextDeal.expiryKind;
    nextDeal.expiryDisplayText = selectedExpiry.raw || nextDeal.expiryDisplayText;
    nextDeal.dateConfidence = selectedExpiry.confidence || nextDeal.dateConfidence;
    if (selectedExpiry.validOn) nextDeal.validOn = selectedExpiry.validOn;
    if (selectedExpiry.validFrom) nextDeal.validFrom = selectedExpiry.validFrom;
    if (selectedExpiry.validUntil) nextDeal.validUntil = selectedExpiry.validUntil;
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
  const context = {
    now,
    maxAgeDays,
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

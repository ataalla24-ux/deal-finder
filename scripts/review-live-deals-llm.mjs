import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { inspectDealUrlHealth } from '../scraper/expiry-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const DEALS_PATH = path.join(DOCS_DIR, 'deals.json');
const REPORT_PATH = path.join(DOCS_DIR, 'live-deal-llm-review.json');

const MODEL = cleanText(process.env.DEAL_REVIEW_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini');
const MAX_DEALS = numberEnv('DEAL_REVIEW_MAX_DEALS', 160);
const CHUNK_SIZE = Math.max(1, Math.min(32, numberEnv('DEAL_REVIEW_CHUNK_SIZE', 24)));
const MIN_REMOVE_CONFIDENCE = Math.max(0, Math.min(1, numberEnv('DEAL_REVIEW_MIN_REMOVE_CONFIDENCE', 0.86)));
const APPLY = process.env.DEAL_REVIEW_APPLY === '1';
const TARGET_EVIDENCE_ENABLED = process.env.DEAL_REVIEW_TARGET_EVIDENCE !== '0';
const TARGET_EVIDENCE_CONCURRENCY = Math.max(1, Math.min(12, numberEnv('DEAL_REVIEW_TARGET_CONCURRENCY', 8)));
const TARGET_EVIDENCE_TIMEOUT_MS = numberEnv('DEAL_REVIEW_TARGET_TIMEOUT_MS', numberEnv('URL_CHECK_TIMEOUT_MS', 7000));
const MAX_TARGET_TEXT_CHARS = Math.max(0, Math.min(1800, numberEnv('DEAL_REVIEW_TARGET_TEXT_CHARS', 900)));
const AUTO_REMOVE_REASONS = new Set([
  'expired',
  'not_a_deal',
  'not_vienna',
  'bad_source',
  'duplicate',
]);

function cleanText(value, maxLength = 1000) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function hostnameFromUrl(value) {
  const text = cleanText(value, 500);
  if (!/^https?:\/\//i.test(text)) return '';
  try {
    return new URL(text).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function compactList(values = [], maxItems = 5, maxLength = 160) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const text = cleanText(value, maxLength);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    result.push(text);
    seen.add(key);
    if (result.length >= maxItems) break;
  }
  return result;
}

function significantTokens(value) {
  return cleanText(value, 160)
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+/gi, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !['gratis', 'free', 'deal', 'aktion', 'wien', 'vienna'].includes(token));
}

function hasTokenOverlap(targetText, value) {
  const text = cleanText(targetText, 3000).toLowerCase();
  const tokens = significantTokens(value);
  if (!text || !tokens.length) return false;
  return tokens.some((token) => text.includes(token));
}

function hasViennaSignal(value) {
  return /\b(wien|vienna)\b|(?:^|[^\d])(1(?:0[1-9]0|1[0-9]0|2[0-3]0))(?:\b|[^\d])/i.test(cleanText(value, 3000));
}

function hasDealSignal(value) {
  return /\b(gratis|kostenlos|free|rabatt|gutschein|coupon|gewinnspiel|aktion|deal|happy\s*hour|opening|eröffnung|eroeffnung)\b|(?:\b1\s*\+\s*1\b)|(?:\b2\s*(?:für|fuer|for)\s*1\b)|(?:\d+\s*%)/i.test(cleanText(value, 3000));
}

function summarizeHealthStatus(health) {
  if (!health) return 'not_checked';
  if (health.invalid) return 'invalid';
  if (health.blockedByProtection) return 'blocked';
  if (health.transientError) return 'transient';
  if (health.status) return 'ok';
  return 'checked';
}

function buildTargetSignals(deal, health) {
  const targetText = cleanText([
    health?.contentHints?.title,
    health?.contentHints?.description,
    health?.contentHints?.heading,
    ...(Array.isArray(health?.contentHints?.headings) ? health.contentHints.headings : []),
    health?.contentHints?.textSnippet,
  ].filter(Boolean).join(' '), 3500);

  return {
    mentionsVienna: hasViennaSignal(targetText),
    mentionsBrand: hasTokenOverlap(targetText, deal?.brand),
    mentionsDealTitle: hasTokenOverlap(targetText, deal?.title),
    mentionsDealTerms: hasDealSignal(targetText),
    hasPublicationDate: Boolean(cleanText(health?.dateHints?.publicationDate || '')),
    hasValidityDate: Boolean(
      cleanText(health?.dateHints?.validOn || '') ||
      cleanText(health?.dateHints?.validFrom || '') ||
      cleanText(health?.dateHints?.validUntil || '')
    ),
  };
}

function buildTargetEvidence(deal, health, checkedAt) {
  const url = cleanText(deal?.url, 500);
  const contentHints = health?.contentHints || {};
  const dateHints = health?.dateHints || {};
  return {
    dealID: cleanText(deal?.id, 120),
    sourceUrl: url,
    finalUrl: cleanText(health?.finalUrl || url, 500),
    finalHost: hostnameFromUrl(health?.finalUrl || url),
    status: summarizeHealthStatus(health),
    httpStatus: Number.isFinite(Number(health?.status)) ? Number(health.status) : null,
    invalid: Boolean(health?.invalid),
    transientError: Boolean(health?.transientError),
    blockedByProtection: Boolean(health?.blockedByProtection),
    reason: cleanText(health?.reason, 180),
    checkedAt: cleanText(health?.checkedAt || checkedAt, 80),
    page: {
      title: cleanText(contentHints.title, 220),
      description: cleanText(contentHints.description, 420),
      heading: cleanText(contentHints.heading, 180),
      headings: compactList(contentHints.headings, 5, 160),
      textSnippet: cleanText(contentHints.textSnippet, MAX_TARGET_TEXT_CHARS),
    },
    dates: {
      publicationDate: cleanText(dateHints.publicationDate, 80),
      publicationDateSource: cleanText(dateHints.publicationDateSource, 80),
      targetDateSource: cleanText(dateHints.targetDateSource, 80),
      targetDateRaw: cleanText(dateHints.targetDateRaw, 180),
      targetDateKind: cleanText(dateHints.targetDateKind, 40),
      validOn: cleanText(dateHints.validOn, 40),
      validFrom: cleanText(dateHints.validFrom, 40),
      validUntil: cleanText(dateHints.validUntil, 40),
    },
    signals: buildTargetSignals(deal, health),
  };
}

function buildMissingUrlEvidence(deal, checkedAt) {
  return {
    dealID: cleanText(deal?.id, 120),
    sourceUrl: cleanText(deal?.url, 500),
    finalUrl: '',
    finalHost: '',
    status: 'missing_link',
    httpStatus: null,
    invalid: true,
    transientError: false,
    blockedByProtection: false,
    reason: 'fehlende oder ungueltige Ziel-URL',
    checkedAt,
    page: { title: '', description: '', heading: '', headings: [], textSnippet: '' },
    dates: {
      publicationDate: '',
      publicationDateSource: '',
      targetDateSource: '',
      targetDateRaw: '',
      targetDateKind: '',
      validOn: '',
      validFrom: '',
      validUntil: '',
    },
    signals: {
      mentionsVienna: false,
      mentionsBrand: false,
      mentionsDealTitle: false,
      mentionsDealTerms: false,
      hasPublicationDate: false,
      hasValidityDate: false,
    },
  };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(items.length || 1, Math.floor(concurrency) || 1));
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

async function inspectUrlWithCache(url, cache) {
  if (cache.has(url)) return cache.get(url);
  const promise = inspectDealUrlHealth(url, { timeoutMs: TARGET_EVIDENCE_TIMEOUT_MS });
  cache.set(url, promise);
  return promise;
}

function summarizeTargetEvidence(items) {
  const statusCounts = {};
  for (const item of items) {
    statusCounts[item.status] = (statusCounts[item.status] || 0) + 1;
  }
  return {
    enabled: TARGET_EVIDENCE_ENABLED,
    checkedDeals: items.length,
    urlConcurrency: TARGET_EVIDENCE_CONCURRENCY,
    timeoutMs: TARGET_EVIDENCE_TIMEOUT_MS,
    maxTextChars: MAX_TARGET_TEXT_CHARS,
    statusCounts,
    withPageText: items.filter((item) => Boolean(item.page?.title || item.page?.description || item.page?.textSnippet)).length,
    withPublicationDate: items.filter((item) => Boolean(item.dates?.publicationDate)).length,
    withValidityDate: items.filter((item) => Boolean(item.dates?.validOn || item.dates?.validFrom || item.dates?.validUntil)).length,
  };
}

async function collectTargetEvidence(deals, checkedAt) {
  if (!TARGET_EVIDENCE_ENABLED || !deals.length) {
    return {
      byDealId: new Map(),
      items: [],
      errors: [],
      summary: summarizeTargetEvidence([]),
    };
  }

  const cache = new Map();
  const errors = [];
  const items = await mapWithConcurrency(deals, TARGET_EVIDENCE_CONCURRENCY, async (deal) => {
    const url = cleanText(deal?.url, 500);
    if (!/^https?:\/\//i.test(url)) return buildMissingUrlEvidence(deal, checkedAt);
    try {
      const health = await inspectUrlWithCache(url, cache);
      return buildTargetEvidence(deal, health, checkedAt);
    } catch (error) {
      const message = cleanText(error?.message || error, 220);
      errors.push(`${cleanText(deal?.id, 120) || url}: ${message}`);
      return buildTargetEvidence(deal, { transientError: true, reason: message, finalUrl: url }, checkedAt);
    }
  });

  return {
    byDealId: new Map(items.map((item) => [item.dealID, item])),
    items,
    errors,
    summary: summarizeTargetEvidence(items),
  };
}

function compactTargetEvidence(evidence = null) {
  if (!evidence) return null;
  return {
    status: evidence.status,
    httpStatus: evidence.httpStatus,
    reason: cleanText(evidence.reason, 160),
    finalUrl: cleanText(evidence.finalUrl, 360),
    finalHost: cleanText(evidence.finalHost, 120),
    page: {
      title: cleanText(evidence.page?.title, 180),
      description: cleanText(evidence.page?.description, 320),
      heading: cleanText(evidence.page?.heading, 160),
      headings: compactList(evidence.page?.headings, 4, 140),
      textSnippet: cleanText(evidence.page?.textSnippet, MAX_TARGET_TEXT_CHARS),
    },
    dates: evidence.dates || {},
    signals: evidence.signals || {},
  };
}

function compactDeal(deal = {}, targetEvidence = null) {
  return {
    id: cleanText(deal.id, 120),
    brand: cleanText(deal.brand, 90),
    title: cleanText(deal.title, 180),
    description: cleanText(deal.description, 360),
    type: cleanText(deal.type, 50),
    category: cleanText(deal.category, 70),
    source: cleanText(deal.source || deal.originSource, 100),
    url: cleanText(deal.url, 260),
    expires: cleanText(deal.expiryDisplayText || deal.expires || deal.expiresOriginal, 140),
    validFrom: cleanText(deal.validFrom, 40),
    validUntil: cleanText(deal.validUntil, 40),
    location: cleanText(deal.location || deal.distance || deal.address, 160),
    publishedAt: cleanText(deal.pubDate || deal.createdAt || deal.discoveredAt || deal.lastUpdated, 80),
    publishedAtSource: cleanText(deal.pubDateSource, 80),
    qualityScore: Number.isFinite(Number(deal.qualityScore)) ? Number(deal.qualityScore) : null,
    targetEvidence: compactTargetEvidence(targetEvidence),
  };
}

function chunked(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function normalizeReason(value) {
  const text = cleanText(value, 40).toLowerCase().replace(/[^a-z_]/g, '_');
  if (AUTO_REMOVE_REASONS.has(text)) return text;
  if (['missing_link', 'weak_evidence', 'wrong_category', 'unclear', 'ok'].includes(text)) return text;
  return 'unclear';
}

function normalizeDecision(value) {
  const text = cleanText(value, 20).toLowerCase();
  if (text === 'remove' || text === 'flag' || text === 'keep') return text;
  return 'flag';
}

function normalizeReviews(rawReviews, dealById) {
  const reviews = [];
  for (const raw of Array.isArray(rawReviews) ? rawReviews : []) {
    const dealID = cleanText(raw?.dealID || raw?.id, 120);
    if (!dealID || !dealById.has(dealID)) continue;
    const confidence = Math.max(0, Math.min(1, Number(raw?.confidence) || 0));
    reviews.push({
      id: `llm-${dealID}`,
      dealID,
      decision: normalizeDecision(raw?.decision),
      reason: normalizeReason(raw?.reason),
      confidence,
      message: cleanText(raw?.message, 240),
      suggestion: cleanText(raw?.suggestion, 240),
    });
  }
  return reviews;
}

function shouldRemove(review) {
  return review.decision === 'remove'
    && AUTO_REMOVE_REASONS.has(review.reason)
    && review.confidence >= MIN_REMOVE_CONFIDENCE;
}

async function classifyChunk(deals, referenceDate) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'freefinder_live_deal_review',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              reviews: {
                type: 'array',
                maxItems: CHUNK_SIZE,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    dealID: { type: 'string' },
                    decision: { type: 'string', enum: ['keep', 'flag', 'remove'] },
                    reason: {
                      type: 'string',
                      enum: [
                        'ok',
                        'expired',
                        'not_a_deal',
                        'not_vienna',
                        'bad_source',
                        'duplicate',
                        'missing_link',
                        'weak_evidence',
                        'wrong_category',
                        'unclear',
                      ],
                    },
                    confidence: { type: 'number' },
                    message: { type: 'string' },
                    suggestion: { type: 'string' },
                  },
                  required: ['dealID', 'decision', 'reason', 'confidence', 'message', 'suggestion'],
                },
              },
            },
            required: ['reviews'],
          },
        },
      },
      messages: [
        {
          role: 'system',
          content: [
            'Du bist der zentrale FreeFinder Live-Deal-Pruefer fuer Wien.',
            'Pruefe nur, ob ein bereits veroeffentlichter App-Deal im Live-Feed bleiben darf.',
            'Jeder Deal kann targetEvidence von der Zielseite enthalten: Linkstatus, finale URL, Seitentitel, Beschreibung, sichtbarer Text, Datums-Hinweise und einfache Signale.',
            'Vergleiche alle App-Angaben mit der Zielseite: Titel, Marke, Beschreibung, Deal-Vorteil, Gueltigkeit/Ablauf, Wien-Bezug, Quelle und Veroeffentlichungsdatum.',
            'Wenn Slack/App-Daten der Zielseite widersprechen, vertraue der Zielseiten-Evidence staerker.',
            'Entferne nur mit hoher Sicherheit: abgelaufen, kein echter Deal, nicht fuer Wien/online fuer Wien, unserioese Quelle oder eindeutiges Duplikat.',
            'Wenn targetEvidence eindeutig zeigt, dass die Zielseite nicht zum Deal passt, nutze bad_source. Wenn sie nur schwach oder blockiert ist, nutze weak_evidence oder missing_link nur als flag.',
            'Wenn targetEvidence ein abgelaufenes Datum oder bei Social Posts ein altes Veroeffentlichungsdatum zeigt, nutze expired.',
            'Markiere missing_link, weak_evidence oder wrong_category nur als flag, nicht als remove.',
            'Lass Kirchen-/Community-/Event-Eintraege drin, solange sie nicht eindeutig abgelaufen oder irrelevant sind.',
            'Antworte ausschliesslich im geforderten JSON-Schema.',
          ].join(' '),
        },
        {
          role: 'user',
          content: JSON.stringify({
            referenceDate,
            timezone: 'Europe/Vienna',
            removePolicy: {
              minConfidence: MIN_REMOVE_CONFIDENCE,
              autoRemoveReasons: Array.from(AUTO_REMOVE_REASONS),
            },
            deals,
          }),
        },
      ],
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI HTTP ${response.status}: ${text.slice(0, 260)}`);
  }

  const data = JSON.parse(text);
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI response did not include message content');
  return {
    parsed: JSON.parse(content),
    usage: data?.usage || null,
  };
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const generatedAt = new Date().toISOString();
  const payload = JSON.parse(await readFile(DEALS_PATH, 'utf8'));
  const deals = Array.isArray(payload.deals) ? payload.deals : [];
  const selectedDeals = deals.slice(0, MAX_DEALS);
  const dealById = new Map(selectedDeals.map((deal) => [cleanText(deal.id, 120), deal]));
  const targetEvidence = await collectTargetEvidence(selectedDeals, generatedAt);
  const compactDeals = selectedDeals.map((deal) => {
    const dealID = cleanText(deal.id, 120);
    return compactDeal(deal, targetEvidence.byDealId.get(dealID));
  });
  const errors = [];
  const reviews = [];
  const usage = {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  };

  if (!process.env.OPENAI_API_KEY) {
    errors.push('OPENAI_API_KEY fehlt, LLM-Review uebersprungen.');
  } else if (!compactDeals.length) {
    errors.push('Keine Deals im Live-Feed gefunden.');
  } else {
    for (const chunk of chunked(compactDeals, CHUNK_SIZE)) {
      try {
        const result = await classifyChunk(chunk, generatedAt);
        reviews.push(...normalizeReviews(result.parsed?.reviews, dealById));
        if (result.usage) {
          usage.prompt_tokens += Number(result.usage.prompt_tokens || 0);
          usage.completion_tokens += Number(result.usage.completion_tokens || 0);
          usage.total_tokens += Number(result.usage.total_tokens || 0);
        }
      } catch (error) {
        errors.push(cleanText(error?.message || error, 500));
      }
    }
  }

  const removeReviews = reviews.filter(shouldRemove);
  const removedIDs = new Set(removeReviews.map((review) => review.dealID));
  const keptDeals = APPLY && removedIDs.size
    ? deals.filter((deal) => !removedIDs.has(cleanText(deal.id, 120)))
    : deals;
  const removedDeals = removeReviews.map((review) => {
    const deal = dealById.get(review.dealID) || {};
    return {
      id: review.dealID,
      title: cleanText(deal.title, 180),
      brand: cleanText(deal.brand, 90),
      url: cleanText(deal.url, 260),
      reason: review.reason,
      confidence: review.confidence,
      message: review.message,
    };
  });

  const report = {
    generatedAt,
    source: 'github-live-deal-llm-review',
    model: MODEL,
    aiEnabled: Boolean(process.env.OPENAI_API_KEY),
    apply: APPLY,
    minRemoveConfidence: MIN_REMOVE_CONFIDENCE,
    totalDealsBefore: deals.length,
    reviewedDeals: compactDeals.length,
    totalDealsAfter: keptDeals.length,
    removedCount: removedDeals.length,
    flaggedCount: reviews.filter((review) => review.decision === 'flag').length,
    targetEvidenceSummary: targetEvidence.summary,
    targetEvidenceErrors: targetEvidence.errors.slice(0, 50),
    errors,
    usage,
    removedDeals,
    reviews,
    targetEvidence: targetEvidence.items,
  };

  if (APPLY && keptDeals.length !== deals.length) {
    payload.deals = keptDeals;
    payload.totalDeals = keptDeals.length;
    payload.lastUpdated = generatedAt;
    await writeJson(DEALS_PATH, payload);
  }

  await writeJson(REPORT_PATH, report);
  console.log(`LLM live deal review: ${reviews.length} reviewed, ${removedDeals.length} removed, ${errors.length} errors.`);
}

main().catch((error) => {
  console.error('review-live-deals-llm failed:', error);
  process.exit(1);
});

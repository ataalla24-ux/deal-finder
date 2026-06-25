import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

function compactDeal(deal = {}) {
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
    qualityScore: Number.isFinite(Number(deal.qualityScore)) ? Number(deal.qualityScore) : null,
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
            'Entferne nur mit hoher Sicherheit: abgelaufen, kein echter Deal, nicht fuer Wien/online fuer Wien, unserioese Quelle oder eindeutiges Duplikat.',
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
  const compactDeals = selectedDeals.map(compactDeal);
  const dealById = new Map(selectedDeals.map((deal) => [cleanText(deal.id, 120), deal]));
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
    errors,
    usage,
    removedDeals,
    reviews,
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

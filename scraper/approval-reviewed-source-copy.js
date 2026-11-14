import { createHash } from 'node:crypto';
import { hasReviewedOfferPeriod, offerPeriodFields } from './offer-period-fields.js';

const OFFER_ID = 'fc4g-1opqd7m';
const SOURCE_URL = 'https://www.preisjaeger.at/deals/mcdonalds-gratis-fussball-donut-zum-osterreich-match-372365';
const ORIGINAL_TITLE = '1 Fußball-Donut gratis zum Österreich-Match';
const ORIGINAL_START_TEXT = 'ab 14. November 2026; Enddatum im Beitrag Keine konkrete Uhrzeit angegeben';
const CAPTION_HASH = 'c6529cdd4b6f6c046579a26601a98b7323639d26e3c25b62d6c85ae1ec76a772';
const END_LITERAL = 'bis inkl. 17.11.2026';
const END_INSTANT = '2026-11-17T22:59:59.999Z'; // Inclusive end of 17 November in Vienna.
const RANGE_TEXT = 'vom 14.11.2026 bis 17.11.2026';
const TITLE = 'McDonald’s: Gratis Fußball-Donut per App';
const DESCRIPTION = 'Gratis Fußball-Donut mit Gutschein in der McDonald’s-App bis einschließlich 17.11.2026 in teilnehmenden Restaurants in Österreich, solange Vorrat reicht. Einmal pro Bestellung, höchstens zweimal pro Gast. Maximal sechs MyMcDonald’s-Gutscheine je Bestellung; weitere Gutscheine mit neuer Bestellung. Kein McDelivery und keine Barauszahlung.';
const clean = value => typeof value === 'string' ? value.trim() : value == null ? '' : String(value);

// Reviewed fixed wording for one complete source, not an AI approval. Evidence
// must come from this attempt's successful URL-health read; persisted copy memos
// or an old source caption cannot supply the current checkedAt.
export function prepareReviewedApprovalCopy(deal, evidence, { existingIds = new Set(), now } = {}) {
  if (!deal || deal.id !== OFFER_ID || deal.url !== SOURCE_URL || deal.brand !== "McDonald's"
    || deal.source !== 'Slack Digest' || deal.originSource !== 'Firecrawl Gastro #4'
    || deal.title !== ORIGINAL_TITLE || clean(deal.description)
    || deal.pipelineLifecycle?.manualDecision !== 'approved'
    || existingIds.has(deal.id) || deal.pipelineLifecycle.publishedAt || deal.pipelineLifecycle.stage === 'published'
    || deal.editedInSlack || deal.slackEditedAt || deal.slackFormEditTs || deal.liveEditedAt
    || deal.isBusiness || deal.campaignId || deal.forceKeep || hasReviewedOfferPeriod(deal)
    || [...(deal.slackEditedFields || []), ...(deal.liveEditedFields || [])].length
    || !(now instanceof Date) || !Number.isFinite(+now) || +now > Date.parse(END_INSTANT)
    || evidence?.sourceUrl !== SOURCE_URL || evidence.blockingReason || evidence.checkedAt !== now.toISOString()
    || !['preisjaeger-visible-thread', undefined].includes(evidence.sourceKind)
    || typeof evidence.caption !== 'string' || createHash('sha256').update(evidence.caption).digest('hex') !== CAPTION_HASH
    || !evidence.caption.includes(END_LITERAL)) return deal;

  // The stored start is independently retained, never inferred from the read
  // time. Do not replace any existing end or a differently reviewed period.
  if (deal.expiryKind !== 'start' || deal.validFrom !== '2026-11-14'
    || deal.expiresOriginal !== ORIGINAL_START_TEXT || deal.expiryDisplayText !== ORIGINAL_START_TEXT
    || ['validUntil', 'validOn', 'expires', 'end_date', 'validity_date', 'validityText', 'expiresPrecision',
      'expiresSource', 'expirySource', 'price', 'originalPrice', 'discountPercent'].some(key => clean(deal[key]))
    || deal.expiresDetectedFromUrl || Object.keys(deal.evidence?.offerTiming || {}).length) return deal;

  const result = { ...deal, title: TITLE, description: DESCRIPTION };
  // An earlier review memo belongs to the old empty copy, not this exact
  // source-reviewed replacement. Never reuse its patch or pending marker.
  delete result.approvalCopyReview;
  for (const field of offerPeriodFields) delete result[field];
  Object.assign(result, { validFrom: deal.validFrom, validUntil: '2026-11-17', expiryKind: 'range',
    expires: END_INSTANT, expiresOriginal: RANGE_TEXT, expiryDisplayText: RANGE_TEXT,
    expiresSource: 'url', expirySource: 'url', expiresPrecision: 'day', expiresDetectedFromUrl: true, dateConfidence: 'high' });
  result.reviewedSourceCopy = { method: 'reviewed-source-template-v1', rule: 'mcd-football-donut-2026-11-v1',
    sourceUrl: SOURCE_URL, contentHash: CAPTION_HASH, checkedAt: evidence.checkedAt,
    fields: ['title', 'description', ...offerPeriodFields.filter(field => Object.hasOwn(result, field))],
    offerPeriodEvidence: { literal: END_LITERAL, validUntil: '2026-11-17', retainedValidFrom: deal.validFrom,
      retainedStartSource: 'existing-queued-start', normalizedRange: RANGE_TEXT } };
  return result;
}

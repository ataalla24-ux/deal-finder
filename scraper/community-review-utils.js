import { parseExpiryShape } from './expiry-utils.js';

export function isCommunitySubmission(deal) {
  return String(deal?.id || '').startsWith('community:')
    && Boolean(String(deal?.submissionId || '').trim())
    && deal?.originSource === 'community-submission';
}

export function isHumanReviewedCommunity(deal) {
  const review = deal?.pipelineLifecycle;
  return isCommunitySubmission(deal) && review?.manualDecision === 'approved'
    && Boolean(review.manualDecisionUser) && Number.isFinite(Date.parse(review.manualDecisionAt));
}

function calendarDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day ? date.toISOString().slice(0, 10) : '';
}

// Only a recent human review can anchor a yearless community date. This is
// never used by extraction or crawler validation, and never invents a post date.
export function prepareCommunityApproval(deal, now = new Date()) {
  if (!isHumanReviewedCommunity(deal)) return deal;
  const raw = String(deal.expiresOriginal || deal.expires || '').trim();
  const fail = () => ({ ...deal, communityApprovalIssue:
    'Community-Aktionszeitraum unklar: bitte unter Bearbeiten ein eindeutiges Ablaufdatum mit Jahr eintragen' });
  const structuredEnd = String(deal.validOn || deal.validUntil || deal.expires || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(structuredEnd)) {
    const [year, month, day] = structuredEnd.split('-').map(Number);
    const start = String(deal.validFrom || '').slice(0, 10);
    if (start && (!/^\d{4}-\d{2}-\d{2}$/.test(start)
        || !calendarDate(...start.split('-').map(Number)) || start > structuredEnd)) return fail();
    return calendarDate(year, month, day) ? { ...deal, communityApprovalIssue: '' } : fail();
  }
  if (!raw) return fail();
  if (/\b(?:ab|startet|beginnt)\b/i.test(raw) && !/\bbis\b/i.test(raw)) return fail();
  const tokens = [...raw.matchAll(/\b(\d{1,2})\.(\d{1,2})(?:\.(20\d{2}))?\.?/g)];
  if (tokens.length < 1 || tokens.length > 2) return fail();
  const explicitYears = new Set(tokens.map(match => match[3]).filter(Boolean));
  const yearless = explicitYears.size === 0;
  const reference = new Date(deal.submittedAt);
  const reviewAge = now - new Date(deal.pipelineLifecycle.manualDecisionAt);
  if (yearless && (!Number.isFinite(reference.getTime()) || now - reference < 0
      || now - reference > 14 * 86400000 || reviewAge < 0 || reviewAge > 86400000)) return fail();
  const year = yearless ? reference.getUTCFullYear() : Number([...explicitYears][0]);
  const dates = tokens.map(match => calendarDate(Number(match[3]) || year, Number(match[2]), Number(match[1])));
  if (dates.some(date => !date) || dates[0] > dates.at(-1)) return fail();
  // Do not turn separated offer days into a continuous promotion.
  if (dates.length === 2) {
    const between = raw.slice(tokens[0].index + tokens[0][0].length, tokens[1].index).trim();
    if (/^(?:und|&)$/i.test(between)) {
      if (Date.parse(dates[1]) - Date.parse(dates[0]) !== 86400000) return fail();
    } else if (!/^(?:bis|[-–])$/i.test(between)) return fail();
  }
  if (yearless && dates.some(date => Math.abs(Date.parse(date) - reference.getTime()) > 60 * 86400000)) return fail();
  const shape = dates.length === 2
    ? { kind: 'range', validFrom: dates[0], validUntil: dates[1] }
    : /\bam\b/i.test(raw) ? { kind: 'single', validOn: dates[0] }
      : parseExpiryShape(raw.replace(tokens[0][0], dates[0]), { now });
  if (!shape.validUntil && !shape.validOn) return fail();
  return {
    ...deal,
    validFrom: shape.validFrom || '', validUntil: shape.validUntil || '', validOn: shape.validOn || '',
    expires: shape.validUntil || shape.validOn,
    expiryKind: shape.kind, expiryDisplayText: raw,
    expirySource: 'slack.community-human-review', expiresSource: 'slack.community-human-review',
    dateConfidence: 'high', communityApprovalIssue: '',
    communityDateReview: {
      at: deal.pipelineLifecycle.manualDecisionAt, user: deal.pipelineLifecycle.manualDecisionUser,
      literal: raw, yearAnchoredToSubmission: yearless,
    },
    missingFields: (deal.missingFields || []).filter(field => !['Ablauf', 'Aktionsdatum bestätigen', 'Gültigkeit'].includes(field)),
  };
}

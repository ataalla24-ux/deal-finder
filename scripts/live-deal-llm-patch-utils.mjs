function cleanText(value, maxLength = 500) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalized(value) {
  return cleanText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function dateOnly(value) {
  const match = cleanText(value, 80).match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match) return '';
  const parsed = Date.parse(`${match[1]}T12:00:00.000Z`);
  return Number.isFinite(parsed) ? match[1] : '';
}

function currentDateMatches(deal, field, value) {
  const candidates = field === 'validUntil'
    ? [deal?.validUntil, deal?.expires]
    : [deal?.validFrom];
  return candidates.some((candidate) => dateOnly(candidate) === value);
}

function hasSpecificTargetUrl(evidence = {}) {
  const value = cleanText(evidence.finalUrl || evidence.sourceUrl, 500);
  if (!value) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const path = url.pathname.toLowerCase().replace(/\/+$/, '') || '/';
    if (host === 'gutscheine.at' || host.endsWith('.gutscheine.at')) return false;
    if (host === 'preisjaeger.at' || host.endsWith('.preisjaeger.at')) {
      return /^\/deals\/[^/]+/.test(path);
    }
    return !['/', '/offers', '/angebote', '/aktionen', '/deals', '/gutscheine'].includes(path);
  } catch {
    return false;
  }
}

function strongTargetMatch(evidence = {}) {
  return evidence.status === 'ok'
    && evidence.invalid !== true
    && evidence.transientError !== true
    && evidence.blockedByProtection !== true
    && evidence.signals?.mentionsDealTitle === true
    && evidence.signals?.mentionsDealTerms === true
    && hasSpecificTargetUrl(evidence);
}

export function sanitizeLlmProposedPatch(review = {}, deal = {}, evidence = {}) {
  const rawPatch = review.proposedPatch && typeof review.proposedPatch === 'object'
    ? review.proposedPatch
    : {};
  if (
    review.decision === 'remove'
    || ['weak_evidence', 'bad_source', 'missing_link', 'not_vienna', 'expired', 'unclear'].includes(review.reason)
  ) {
    return {};
  }

  const confidence = Math.max(0, Math.min(1, Number(review.confidence) || 0));
  const patch = {};
  const hasStrongTargetMatch = strongTargetMatch(evidence);
  const hasExactValidityWindow = ['end', 'range'].includes(
    cleanText(evidence.dates?.targetDateKind, 40).toLowerCase(),
  );

  if (hasStrongTargetMatch && hasExactValidityWindow) {
    const evidenceValidFrom = dateOnly(evidence.dates?.validFrom);
    const evidenceValidUntil = dateOnly(evidence.dates?.validUntil);
    if (evidenceValidFrom && !currentDateMatches(deal, 'validFrom', evidenceValidFrom)) {
      patch.validFrom = evidenceValidFrom;
    }
    if (evidenceValidUntil && !currentDateMatches(deal, 'validUntil', evidenceValidUntil)) {
      patch.validUntil = evidenceValidUntil;
    }

    const targetDateRaw = cleanText(evidence.dates?.targetDateRaw, 180);
    const currentExpiryText = normalized(deal.expiryDisplayText || deal.expiresOriginal);
    if (
      targetDateRaw
      && targetDateRaw.length <= 100
      && !/[✓►]/.test(targetDateRaw)
      && (patch.validFrom || patch.validUntil)
      && normalized(targetDateRaw) !== currentExpiryText
    ) {
      patch.expiryDisplayText = targetDateRaw;
    }
  }

  if (review.reason === 'wrong_category' && confidence >= 0.8 && hasStrongTargetMatch) {
    const category = cleanText(rawPatch.category, 80).toLowerCase();
    const type = cleanText(rawPatch.type, 40).toLowerCase();
    if (category && category !== cleanText(deal.category, 80).toLowerCase()) patch.category = category;
    if (type && type !== cleanText(deal.type, 40).toLowerCase()) patch.type = type;
  }

  return patch;
}

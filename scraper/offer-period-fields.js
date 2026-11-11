export const offerPeriodFields = ['expires', 'expiresOriginal', 'expiresSource', 'expirySource',
  'expiryKind', 'expiryDisplayText', 'validOn', 'validFrom', 'validUntil', 'end_date',
  'validity_date', 'dateConfidence', 'validityText', 'expiresPrecision', 'expiresDetectedFromUrl'];

export function hasReviewedOfferPeriod(deal = {}) {
  const fields = [deal.slackEditedFields, deal.liveEditedFields].flatMap(value => Array.isArray(value) ? value : []);
  return Boolean(deal.communityDateReview || (
    (deal.slackFormEditTs || deal.slackEditedAt || deal.liveEditedAt)
    && fields.some(field => ['expires', 'expiresOriginal', 'expiryKind', 'expiryDisplayText',
      'validityText', 'validOn', 'validFrom', 'validUntil'].includes(field))));
}

export function copyOfferPeriod(target, source) {
  for (const field of offerPeriodFields) {
    delete target[field];
    if (Object.hasOwn(source, field)) target[field] = source[field];
  }
}

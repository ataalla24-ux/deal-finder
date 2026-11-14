export const ENRICHMENT_MODE = 'two-stage-v1';
export const ENRICHMENT_NOTICE = 'Details werden ergänzt. ';
export const MAP_INPUT_FIELDS = ['address', 'location', 'distance', 'city', 'postalCode', 'addressLocality', 'postcode', 'latitude', 'longitude', 'lat', 'lng', 'coordinates', 'ort', 'streetAddress', 'venueAddress', 'zip', 'zipCode', 'lon'];
const fieldsOf = deal => [...new Set((deal.enrichmentFields || []).filter(field => ['description', 'map'].includes(field)))];

export function stripEnrichmentNotice(value) {
  let text = typeof value === 'string' ? value : '';
  while (text.startsWith(ENRICHMENT_NOTICE)) text = text.slice(ENRICHMENT_NOTICE.length);
  return text;
}

export function updateDealEnrichment(deal, { completedFields = [], pendingFields = [], nextReviewAt, now = new Date() } = {}) {
  const fields = [...new Set([...fieldsOf(deal).filter(field => !completedFields.includes(field)), ...pendingFields])]
    .filter(field => ['description', 'map'].includes(field));
  return { ...deal, enrichmentPending: fields.length > 0, enrichmentFields: fields,
    enrichmentNextReviewAt: fields.length ? nextReviewAt || deal.enrichmentNextReviewAt || new Date(+now + 6 * 3600000).toISOString() : null };
}

// Store only public offer inputs, never Slack/reviewer/credential metadata.
export function captureMapEnrichmentInput(deal) {
  return { id: deal.id, url: deal.url, fields: Object.fromEntries(MAP_INPUT_FIELDS.filter(field => Object.hasOwn(deal, field)).map(field => [field, deal[field]])) };
}

export function restoreMapEnrichmentInput(deal, store = {}) {
  const entry = store.entries?.[deal.id];
  if (deal.approvalPublicationMode !== ENRICHMENT_MODE || !fieldsOf(deal).includes('map')
    || entry?.id !== deal.id || entry.url !== deal.url) return { ...deal };
  const edited = [...(deal.slackEditedFields || []), ...(deal.liveEditedFields || [])];
  if (edited.some(field => MAP_INPUT_FIELDS.includes(field))
    || MAP_INPUT_FIELDS.some(field => Object.hasOwn(deal, field) && deal[field] !== '' && deal[field] != null
      && !(field === 'distance' && deal[field] === 'Wien · Standort folgt'))) return { ...deal };
  return { ...deal, ...Object.fromEntries(MAP_INPUT_FIELDS.filter(field => Object.hasOwn(entry.fields || {}, field)).map(field => [field, entry.fields[field]])) };
}

// Existing installed apps understand these text fields. A pending address must
// never become an unverified native fallback-geocoder pin.
export function projectEnrichmentDeal(deal) {
  if (deal.approvalPublicationMode !== ENRICHMENT_MODE) return deal;
  const fields = fieldsOf(deal);
  const description = stripEnrichmentNotice(deal.description);
  const result = { ...deal, description: fields.includes('description') ? ENRICHMENT_NOTICE + description : description };
  if (fields.includes('map')) {
    for (const field of MAP_INPUT_FIELDS) delete result[field];
    result.distance = 'Wien · Standort folgt';
  }
  // Native detail view prefers these verified details over description. Keep
  // the verified object untouched and add the same notice to its display only.
  if (result.redemption?.details) {
    result.redemption = { ...result.redemption, details: (fields.includes('description') ? ENRICHMENT_NOTICE : '') + stripEnrichmentNotice(result.redemption.details) };
  }
  return result;
}

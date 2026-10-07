// Keep moderation metadata separate from the text displayed by all clients.
const reviewMarker = /(?:\s*[-\u2013\u2014|\u2022;]\s*|\s*\(\s*|^)(?:bitte\s+)?(?:manuell\s+pr(?:\u00fc|ue|u)fen|manual\s+review(?:\s+required)?)(?:\s*\))?(?=\s*(?:$|[.;\n]))/gi;
const reviewLine = /^\s*(?:Pr\u00fcfgrund|Pruefgrund|LLM-Vorschlag|Interner Hinweis|Review reason)\s*:[^\n]*/gim;
const cityOnly = /^(?:\d{4}\s+)?(?:Wien|Vienna)$/i;
const publicFields = ['title', 'brand', 'description', 'distance', 'location', 'address', 'expiryDisplayText', 'expiresOriginal', 'expires'];

export function publicDealText(value) {
  if (typeof value !== 'string') return value;
  const result = value.replace(reviewLine, '').replace(reviewMarker, '');
  // Preserve original formatting unless an internal marker was actually removed.
  return result === value ? value : result.trim();
}

export function sanitizePublicDealText(deal) {
  if (!deal || typeof deal !== 'object') return deal;
  const result = { ...deal };
  for (const key of publicFields) {
    if (typeof deal[key] === 'string') result[key] = publicDealText(deal[key]);
  }
  if (result.brand !== deal.brand && cityOnly.test(result.brand)) {
    if (typeof result.title === 'string') {
      result.title = result.title.replace(new RegExp(`\\s+bei\\s+${result.brand}\\s*$`, 'i'), '');
    }
    result.brand = '';
  }
  if (deal.title && !result.title) result.title = 'Deal';
  return result;
}

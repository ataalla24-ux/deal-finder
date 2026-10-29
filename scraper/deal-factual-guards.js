const text = (value) => String(value || '').replace(/\s+/g, ' ').trim();

export function locationConflictReason(deal = {}) {
  if (deal.flight || /flights-vienna/i.test(deal.originSource || '')) return '';
  // Generated descriptions may contain a default Vienna address. Prefer the
  // original post when deciding where the actual promotion takes place.
  const caption = text(deal.metaGraphCaption || deal.evidence?.textSample || deal.description);
  const outside = '(?:Graz|Salzburg|Linz|Innsbruck|Klagenfurt|Villach|Berlin|München|Dubai|Abu Dhabi)';
  const explicitElsewhere = new RegExp(`\\b(?:in|bei|nahe|at)\\s+${outside}\\b`, 'i');
  const venueElsewhere = new RegExp(`(?:📍|\\b(?:Standort|Location|Adresse|Address)\\s*:)\\s*[^.!?]{0,180}\\b${outside}\\b`, 'i');
  const outsideHandle = /\b(?:@?[a-z0-9_.]*(?:grill|food|kebab|kebap|pizza|cafe)[a-z0-9_.]*graz)\b/i;
  const nationwide = /\b(?:österreichweit|austria[- ]wide|bundesweit|im\s+online[- ]?shop|online\s+bestellen)\b/i.test(caption);
  if (nationwide && !/\bnur\s+(?:in|bei)\b/i.test(caption) && !explicitElsewhere.test(text(deal.title))) return '';
  // A Vienna display default or Wienerstrasse cannot override the actual venue.
  const viennaBranch = /\b1(?:0[1-9]|1\d|2[0-3])0\s+(?:Wien|Vienna)\b/i.test(caption)
    || /\b(?:in allen|alle teilnehmenden|auch in|auch bei)\b[^.!?]{0,65}\b(?:Wien|Wiener|österreichweit)\b/i.test(caption);
  return explicitElsewhere.test(text(deal.title)) || (!viennaBranch && (explicitElsewhere.test(caption) || venueElsewhere.test(caption) || outsideHandle.test(caption)))
    ? 'Ortswiderspruch: Originalangebot nennt einen Standort ausserhalb Wiens' : '';
}

export function explicitFoodMerchant(deal = {}) {
  const caption = text(deal.description || deal.evidence?.textSample);
  const match = caption.match(/(?:📍\s*|\bbei\s+)((?:Trattoria|Pizzeria|Restaurant|Café|Cafe|Kebaphaus|Kebabhaus)\s+[\p{L}\p{N}'’&.-]+(?:\s+[\p{L}\p{N}'’&.-]+){0,3})(?=\s*[•|,\n]|\s+in\s+|$)/u);
  return match ? text(match[1]) : '';
}

export function isDirectMessageInstruction(value) {
  return /\b(?:per|via|als|by|direkt\s+per)\s+DM\b|\bDM\s+(?:me|us|to|for|your|zur|für|fuer|anmeldung|details?|infos?|booking)\b/i.test(text(value));
}

export function normalizeDealFacts(deal = {}) {
  const result = { ...deal };
  const caption = text(deal.description || deal.evidence?.textSample);
  if (/^dm$/i.test(text(deal.brand)) && isDirectMessageInstruction(caption)) {
    const merchant = explicitFoodMerchant(deal);
    if (merchant) result.brand = merchant;
  }
  if (deal.type === 'gratis' && /(?:\d\s*€|€\s*\d|\d\s*Euro\b)/i.test(deal.title || '')
    && !/\b(?:gratis|kostenlos\w*|free|geschenkt|1\s*\+\s*1|2\s*(?:für|for)\s*1)\b/i.test(`${deal.title || ''} ${caption}`)) result.type = 'rabatt';
  return result;
}

export function materialOfferConditions(deal = {}) {
  const caption = text(deal.description || deal.evidence?.textSample);
  return caption.split(/(?<=[.!?])\s+/).filter((sentence) =>
    /\b(?:Mindestbestellwert|Mindestkauf|Neukunden?|Erstbestellung|ab\s+\d|über\s+\d|beim\s+nächsten|nächsten\s+Einkauf|bei\s+(?:Kauf|Bestellung|Konsumation)|pro\s+Person|solange\s+der\s+Vorrat|Kommentar|kommentiere|folge\s+uns)\b/i.test(sentence)
  ).slice(0, 3).join(' ').slice(0, 900);
}

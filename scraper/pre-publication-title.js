import { polishOfferTitle } from './offer-title-utils.js';

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();

function protectedTitle(deal, existingIds) {
  const fields = [...(deal.liveEditedFields || []), ...(deal.slackEditedFields || [])];
  return existingIds.has(deal.id) || fields.includes('title')
    || deal.editedInSlack === true || Boolean(deal.slackEditedAt || deal.slackFormEditTs)
    || Boolean(deal.liveEditedAt) || deal.isBusiness === true || Boolean(deal.campaignId);
}

function titleFacts(value) {
  const text = clean(value).toLowerCase();
  return {
    numbers: (text.match(/\d+(?:[,.]\d+)?/g) || []).sort().join('|'),
    conditions: (text.match(/\b(?:ab|bis|ausgew\S*|neukund\S*|mitglied\S*|kund\S*|gutschein\S*|coupon\S*|code\S*|abholung|mitnahme|mindest\S*|kauf\S*|erst\S*|zweite\S*|dritte\S*)/gu) || []).sort().join('|'),
  };
}

function compactTitle(value) {
  return clean(value)
    .replace(/^(?:Jetzt\s+)?(?:Sichere? dir|Hol dir|Genieße)\s+(?=\d)/iu, '')
    .replace(/^(?:Große|Grosse|Tolle|Mega) Aktion\s*:\s*/iu, '')
    .replace(/\bzum Aktionspreis von\s+/giu, 'für ')
    .replace(/\bfür nur\s+/giu, 'für ')
    .replace(/\b(\d+(?:[,.]\d+)?)\s*Prozent(?: Rabatt)?\s+auf\b/giu, '$1 % auf')
    .replace(/(\d+(?:[,.]\d+)?)\s*%\s+Rabatt auf\b/giu, '$1 % auf')
    .replace(/\b(\d+(?:[,.]\d+)?)\s+Euro\b/giu, '$1 €')
    .replace(/\bGRATIS\b/gu, (word, offset, text) => offset === 0 || text[offset + word.length] === '-' ? 'Gratis' : 'gratis')
    .replace(/\bRABATT\b/gu, 'Rabatt');
}

// This local stage runs before approval validation, not after publication.
// Ambiguous copy stays untouched; neither a model call nor a hard truncation is allowed.
export function preparePublicationTitle(deal, { existingIds = new Set() } = {}) {
  if (!deal || protectedTitle(deal, existingIds)) return deal;
  const original = clean(deal.title);
  if (!original) return deal;
  // Do not select a different sentence from a long caption after human approval.
  // Source-based extraction stays upstream; this boundary only rewrites the given title.
  let title = polishOfferTitle(original);
  if (JSON.stringify(titleFacts(title)) !== JSON.stringify(titleFacts(original))) title = original;
  title = compactTitle(title);
  if (!title || title === original || /\b(?:und|oder|mit|für|ab|bis|bei)$/iu.test(title)) return deal;
  const description = clean(deal.description);
  if ((deal.liveEditedFields || []).includes('description') && !description.includes(original)) return deal;
  return {
    ...deal,
    title,
    description: description.includes(original) ? description : [description, original].filter(Boolean).join(' '),
    prePublicationTitleEdit: {
      version: 1,
      method: 'local-evidence-rules',
      originalTitle: deal.prePublicationTitleEdit?.originalTitle || original,
      title,
    },
  };
}

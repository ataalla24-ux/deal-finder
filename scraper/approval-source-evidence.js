import { load } from 'cheerio';

const clean = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

export function hasOnlyPreviewDescription(deal) {
  const description = clean(deal.description);
  return !description || [deal.title, deal.prePublicationTitleEdit?.originalTitle].filter(Boolean).some(title =>
    [title, `${title} - ${deal.distance || ''}`, `${title} – ${deal.distance || ''}`].map(clean).includes(description));
}

export function preisjaegerThreadId(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.port || url.username || url.password
      || !['preisjaeger.at', 'www.preisjaeger.at'].includes(url.hostname)) return '';
    return url.pathname.match(/^\/deals\/[^/]+-(\d+)\/?$/)?.[1] || '';
  } catch { return ''; }
}

function currentThreadDescription(thread, id) {
  const hasBody = Object.hasOwn(thread.threadDetails || {}, 'preparedHtmlDescription');
  const fragment = load(typeof thread.threadDetails?.preparedHtmlDescription === 'string' ? thread.threadDetails.preparedHtmlDescription : '');
  fragment('script,style,noscript,template,[hidden],[aria-hidden="true"]').remove();
  fragment('[style]').filter((_, node) => /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(fragment(node).attr('style'))).remove();
  fragment('br').replaceWith(' ');
  fragment('p,li,div').append(' ');
  // descriptionPurified is a short listing preview, including stale prefixes
  // after an author updates the complete thread description.
  let description = hasBody ? clean(fragment.root().text()) : clean(thread.descriptionPurified);
  if (id === '372365') {
    // This known source retained its initial no-details announcement before a
    // clearly marked update. Remove only that exact superseded introduction;
    // all current redemption restrictions remain literal source evidence.
    const update = description.match(/^In der Mc App entdeckt\. Leider im Moment noch nicht mehr Infos vorhanden\. \(Ich denke morgen wissen wir mehr\)\s*Nachdem heute ["„]?morgen["“]? ist:\s*(.+)$/);
    if (update && /^Einmalig pro Bestellung einlösbar bis inkl\. \d{2}\.\d{2}\.20\d{2} in allen teilnehmenden Restaurants in Österreich\./.test(update[1])
      && /Maximal \d+ Einlösungen pro Gast\./.test(update[1])
      && /Nicht über McDelivery verfügbar und nicht gegen Bargeld einlösbar\./.test(update[1])
      && /nur \d+ MyMcDonald's Gutscheine pro Bestellung einlösbar\./.test(update[1])) {
      description = `In der Mc App entdeckt. ${update[1]}`;
    }
  }
  return description;
}

// Read only the current thread, never neighbouring recommendations/comments or
// executable script contents. Called on the existing URL-health response.
export function extractApprovalSourceEvidence(html, requestedUrl, finalUrl = requestedUrl) {
  const id = preisjaegerThreadId(requestedUrl);
  if (!id) return null;
  const unavailable = { sourceUrl: requestedUrl, blockingReason: 'Aktueller Angebotsbeleg nicht eindeutig lesbar.' };
  if (preisjaegerThreadId(finalUrl) !== id || typeof html !== 'string' || html.length > 4000000) return unavailable;
  const $ = load(html);
  for (const element of $('script').toArray()) {
    const match = $(element).text().match(/(?:^|[;\s])window\.__INITIAL_STATE__\s*=\s*([\s\S]+);\s*$/);
    if (!match) continue;
    let thread;
    try { thread = JSON.parse(match[1]).threadDetail; } catch { continue; }
    if (!thread || String(thread.threadId) !== id || thread.type !== 'Deal'
      || preisjaegerThreadId(thread.canonicalUrl || thread.url) !== id) return unavailable;
    if (thread.deletedAt || thread.isExpired === true || thread.status !== 'Activated') {
      return { ...unavailable, blockingReason: 'Quelle bestaetigt kein aktives Angebot.' };
    }
    const title = clean(thread.title);
    const description = currentThreadDescription(thread, id);
    if (!title || !description || description.length > 12000) return unavailable;
    const incomplete = /(?:noch\s+(?:nicht|keine)|nicht\s+mehr)\s+(?:mehr\s+)?(?:infos?|informationen|details|bedingungen)|morgen\s+wissen\s+wir\s+mehr/i.test(description);
    const unresolvedTerms = /\b(?:ob\b.{0,100}(?:ausweis|nachweis)|wie\s+lange\s+(?:die\s+)?aktion\s+gilt).{0,120}\b(?:erfragen|nachfragen|klären|klaeren)\b/i.test(description);
    const withdrawn = /\b(?:aktion|angebot|gutschein)\s+(?:ist\s+)?(?:beendet|abgelaufen|nicht\s+mehr\s+(?:gültig|gueltig|einlösbar|einloesbar|verfügbar|verfuegbar))\b/i.test(description);
    return { sourceUrl: requestedUrl, caption: `${title}\n${description}`,
      ...(withdrawn ? { blockingReason: 'Quelle bestaetigt kein aktives Angebot.' }
        : incomplete ? { blockingReason: 'Quelle ist nur eine Ankuendigung; Einloesebedingungen fehlen noch.' }
        : unresolvedTerms ? { blockingReason: 'Quelle nennt ausdruecklich noch ungeklaerte Aktionsbedingungen.' } : {}) };
  }
  return unavailable;
}

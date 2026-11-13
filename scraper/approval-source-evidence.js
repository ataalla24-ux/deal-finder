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
    const fragment = load(thread.threadDetails?.preparedHtmlDescription || '');
    fragment('script,style').remove();
    fragment('br').replaceWith(' ');
    const description = clean(thread.descriptionPurified) || clean(fragment.root().text());
    if (!title || !description || description.length > 12000) return unavailable;
    const incomplete = /(?:noch\s+(?:nicht|keine)|nicht\s+mehr)\s+(?:mehr\s+)?(?:infos?|informationen|details|bedingungen)|morgen\s+wissen\s+wir\s+mehr/i.test(description);
    return { sourceUrl: requestedUrl, caption: `${title}\n${description}`,
      ...(incomplete ? { blockingReason: 'Quelle ist nur eine Ankuendigung; Einloesebedingungen fehlen noch.' } : {}) };
  }
  return unavailable;
}

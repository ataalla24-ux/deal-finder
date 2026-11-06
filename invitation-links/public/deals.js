const FEED = 'https://freefinder.at/deals.json';
const MAX_BYTES = 2 * 1024 * 1024;
const validToken = value => typeof value === 'string' && value.length === 12 && /^[A-Za-z0-9_-]+$/.test(value);

// A stable 72-bit public identifier, with collision checks against the current feed.
export async function dealToken(id) {
  if (typeof id !== 'string' || !id || new TextEncoder().encode(id).length > 160 || /[\x00-\x1f\x7f-\x9f]/.test(id)) return null;
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id)));
  return btoa(String.fromCharCode(...hash.slice(0, 9))).replaceAll('+', '-').replaceAll('/', '_');
}

async function readDeals() {
  const result = await fetch(FEED, {
    headers: { accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
    cf: { cacheTtl: 180, cacheEverything: true },
  });
  if (!result.ok || Number(result.headers.get('content-length')) > MAX_BYTES) throw new Error('Feed unavailable');
  const reader = result.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) throw new Error('Feed too large');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const raw = JSON.parse(await new Blob(chunks).text());
  const deals = Array.isArray(raw) ? raw : raw?.deals;
  if (!Array.isArray(deals) || deals.length > 2000) throw new Error('Invalid feed');
  return deals;
}

export async function resolveDealLink(request, invitationCode, respond, loadDeals = readDeals) {
  const url = new URL(request.url);
  const token = url.pathname.slice(3);
  const invitation = url.searchParams.get('i');
  const referral = url.searchParams.get('r');
  if (!validToken(token) || url.searchParams.size > 1 ||
      [...url.searchParams.keys()].some(key => !['i', 'r'].includes(key)) ||
      (url.searchParams.has('i') && !invitationCode(invitation)) ||
      (url.searchParams.has('r') && (!referral || referral.length !== 6 || !/^[A-Z0-9]+$/.test(referral)))) {
    return respond(request, 'Dieser Deal-Link ist ungueltig.', 404, { 'X-Robots-Tag': 'noindex' });
  }
  try {
    const deals = await loadDeals();
    const matches = [];
    for (const deal of deals) {
      if (deal && await dealToken(deal.id) === token) matches.push(deal);
    }
    if (!matches.length) return respond(request, 'Dieses Angebot ist nicht mehr verfuegbar.', 410, { 'X-Robots-Tag': 'noindex' });
    if (matches.length !== 1) throw new Error('Ambiguous deal');
    const deal = matches[0];
    const target = new URL(invitation ? 'https://freefinder.at/invite.html' : 'https://freefinder.at/');
    target.searchParams.set('deal', deal.id);
    if (invitation) target.searchParams.set('invite', invitationCode(invitation));
    if (referral) target.searchParams.set('ref', `FF-${referral}`);
    target.searchParams.set('source', 'deal_share');
    // Existing clients understand the destination; no new native deep-link parser is required.
    return respond(request, '', 302, { Location: target.href, 'X-Robots-Tag': 'noindex' });
  } catch {
    return respond(request, 'Der Deal ist gerade nicht erreichbar. Bitte erneut versuchen.', 503,
      { 'Retry-After': '30', 'X-Robots-Tag': 'noindex' });
  }
}

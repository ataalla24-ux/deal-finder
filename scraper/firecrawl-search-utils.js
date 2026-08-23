import { normalizeInstagramPostUrl } from './firecrawl-post-verifier.js';

const OFFER_SIGNAL_PATTERN = /(?:\bgratis\b|\bkostenlos\b|\bfree\b|\bumsonst\b|\b0\s*€|\b1\s*[+&]\s*1\b|\b2\s*(?:für|for)\s*1\b|\bbogo\b|\b\d{1,2}\s*%|\brabatt\b|\baktion\b|\bangebot\b|\bdeal\b|\bcoupon\b|\bgutschein\b|\bhappy hour\b|\bstatt\s+(?:€\s*)?\d)/i;
const GIVEAWAY_PATTERN = /(?:\bgewinnspiel\b|\bgiveaway\b|\bverlos(?:ung|en)\b|\bgewinn(?:e|en|st|t)?\b|\bzu gewinnen\b|\blostopf\b|\btagge\b|\bmarkiere\b.*\bfreund|\bkommentiere\b.*\bgewinn)/i;
const SHIPPING_ONLY_PATTERN = /(?:\bgratis(?:er|e|es)? versand\b|\bkostenlos(?:er|e|es)? versand\b|\bfree shipping\b)/i;
const NON_OFFER_FREE_PATTERN = /(?:\bfeel free\b|\bfree[ -]?flow\b|\b(?:gluten|sugar|lactose|dairy|alcohol)[ -]?free\b)/gi;
const GENERIC_COLLECTION_TITLE_PATTERN = /(?:\balle termine\b|\bveranstaltungskalender\b|\bevents? (?:in|für) wien\b|\bangebote? im überblick\b|\bdeal[- ]?(?:liste|übersicht)\b|\bseite\s+\d+\b)/i;

function cleanText(value, maxLength = 1200) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function targetIdentity(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts[0] === 'explore' && parts[1] === 'tags' && parts[2]) {
      return { kind: 'hashtag', value: decodeURIComponent(parts[2]).replace(/^#/, '') };
    }
    if (parts[0] && !['p', 'reel', 'reels', 'tv'].includes(parts[0].toLowerCase())) {
      return { kind: 'account', value: parts[0].replace(/^@/, '') };
    }
  } catch {
    // The caller still gets a useful generic search query.
  }
  return { kind: 'generic', value: 'Wien' };
}

export function isConcreteFirecrawlSearchResult(row = {}) {
  const title = cleanText(typeof row === 'string' ? '' : row?.title, 500);
  if (title && GENERIC_COLLECTION_TITLE_PATTERN.test(title)) return false;
  const signal = cleanText(
    typeof row === 'string' ? row : `${row?.title || ''} ${row?.description || ''}`,
    2600,
  ).replace(NON_OFFER_FREE_PATTERN, '');
  if (!OFFER_SIGNAL_PATTERN.test(signal)) return false;
  if (GIVEAWAY_PATTERN.test(signal)) return false;
  if (SHIPPING_ONLY_PATTERN.test(signal)) {
    const withoutShipping = signal.replace(SHIPPING_ONLY_PATTERN, '');
    if (!OFFER_SIGNAL_PATTERN.test(withoutShipping)) return false;
  }
  return true;
}

export function inferFirecrawlSearchDealType(row = {}) {
  const signal = cleanText(
    typeof row === 'string' ? row : `${row?.title || ''} ${row?.description || ''}`,
    2600,
  ).replace(NON_OFFER_FREE_PATTERN, '');
  if (/(?:\b1\s*[+&]\s*1\b|\b2\s*(?:für|for)\s*1\b|\bbogo\b|\bbuy one get one\b)/i.test(signal)) return 'bogo';
  if (/(?:\bgratis\b|\bkostenlos\b|\bfree\b|\bumsonst\b|\b0\s*€)/i.test(signal)) return 'gratis';
  return 'rabatt';
}

export function buildFreshInstagramDealSearchQuery(targetUrl, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const target = targetIdentity(targetUrl);
  const scope = target.kind === 'hashtag'
    ? `("#${target.value}" OR "${target.value}")`
    : `("@${target.value}" OR "${target.value}")`;
  return `(site:instagram.com/p/ OR site:instagram.com/reel/) ${scope} (gratis OR kostenlos OR free OR "1+1" OR "2 für 1" OR rabatt OR aktion OR angebot OR coupon OR gutschein) after:${since}`;
}

export function buildFreshWebDealSearchQuery(targetUrl, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  let hostname = '';
  try {
    hostname = new URL(targetUrl).hostname.replace(/^www\./, '');
  } catch {
    hostname = cleanText(targetUrl, 200);
  }
  return `site:${hostname} (Wien OR Vienna) (gratis OR kostenlos OR "1+1" OR "2 für 1" OR rabatt OR aktion OR angebot OR coupon OR gutschein) after:${since}`;
}

function ownerUsernameFromTitle(title) {
  const value = cleanText(title, 500);
  const patterns = [
    /\(@([a-z0-9._]{2,40})\)/i,
    /^@([a-z0-9._]{2,40})(?:\s|$)/i,
    /^([a-z0-9._]{2,40})\s+(?:on|auf)\s+Instagram\b/i,
    /\b(?:post|reel)\s+(?:by|von)\s+@?([a-z0-9._]{2,40})\b/i,
  ];
  for (const pattern of patterns) {
    const username = cleanText(value.match(pattern)?.[1], 40).toLowerCase();
    if (username) return username;
  }
  return '';
}

export async function searchFreshInstagramPosts(client, targetUrl, options = {}) {
  if (!client?.search) throw new TypeError('Firecrawl client must support search()');
  const query = buildFreshInstagramDealSearchQuery(targetUrl, options);
  const target = targetIdentity(targetUrl);
  const response = await client.search(query, {
    sources: ['web'],
    limit: Math.max(1, Number(options.limit) || 10),
    tbs: 'qdr:w',
    location: options.location || 'Vienna, Austria',
    timeout: Math.max(1000, Number(options.timeoutMs) || 30000),
    ignoreInvalidURLs: true,
  });
  if (response?.success === false || response?.error) {
    throw new Error(cleanText(response.error) || 'Firecrawl Search fehlgeschlagen');
  }

  const byUrl = new Map();
  for (const row of Array.isArray(response?.web) ? response.web : []) {
    const url = normalizeInstagramPostUrl(row?.url || row?.metadata?.sourceURL || row?.metadata?.url);
    if (!url) continue;
    const detectedOwner = ownerUsernameFromTitle(row?.title || row?.metadata?.title);
    if (target.kind === 'account' && detectedOwner && detectedOwner !== target.value.toLowerCase()) continue;
    const candidate = {
      url,
      title: cleanText(row?.title || row?.metadata?.title, 300),
      description: cleanText(row?.description || row?.metadata?.description || row?.markdown, 1800),
      ownerUsername: detectedOwner || (target.kind === 'account' ? target.value.toLowerCase() : ''),
      discoveryTarget: targetUrl,
      discoveryMethod: 'firecrawl-search',
      searchQuery: query,
    };
    const previous = byUrl.get(url);
    if (!previous || candidate.description.length > previous.description.length) byUrl.set(url, candidate);
  }
  return [...byUrl.values()];
}

export async function searchFreshWebDeals(client, targetUrl, options = {}) {
  if (!client?.search) throw new TypeError('Firecrawl client must support search()');
  const targetHost = new URL(targetUrl).hostname.replace(/^www\./, '');
  const query = buildFreshWebDealSearchQuery(targetUrl, options);
  const response = await client.search(query, {
    sources: ['web'],
    limit: Math.max(1, Number(options.limit) || 10),
    tbs: 'qdr:w',
    location: options.location || 'Vienna, Austria',
    timeout: Math.max(1000, Number(options.timeoutMs) || 30000),
    ignoreInvalidURLs: true,
  });
  if (response?.success === false || response?.error) {
    throw new Error(cleanText(response.error) || 'Firecrawl Search fehlgeschlagen');
  }

  const byUrl = new Map();
  for (const row of Array.isArray(response?.web) ? response.web : []) {
    const rawUrl = cleanText(row?.url || row?.metadata?.sourceURL || row?.metadata?.url, 1000);
    let url = '';
    try {
      const parsed = new URL(rawUrl);
      if (parsed.hostname.replace(/^www\./, '') !== targetHost) continue;
      for (const key of [...parsed.searchParams.keys()]) {
        if (/^(?:utm_|fbclid|gclid)/i.test(key)) parsed.searchParams.delete(key);
      }
      parsed.hash = '';
      url = parsed.toString();
    } catch {
      continue;
    }
    const candidate = {
      url,
      title: cleanText(row?.title || row?.metadata?.title, 300),
      description: cleanText(row?.description || row?.metadata?.description || row?.markdown, 1800),
      discoveryTarget: targetUrl,
      discoveryMethod: 'firecrawl-search',
      searchQuery: query,
    };
    const previous = byUrl.get(url);
    if (!previous || candidate.description.length > previous.description.length) byUrl.set(url, candidate);
  }
  return [...byUrl.values()];
}

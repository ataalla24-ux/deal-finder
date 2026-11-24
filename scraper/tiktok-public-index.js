import { retryAfterAt } from './source-http-policy.js';

const DAY_MS = 86_400_000;
const MAX_RESULTS = 20;
const searchTerms = [
  'Wien gratis Essen Döner Pizza Neueröffnung 1+1 Wien',
  'Wien Neueröffnung gratis Döner Burger Pizza Verkostung Eröffnungsangebot',
  'Wien 1+1 Essen 2 für 1 Döner Pizza Burger Restaurant Angebot',
  'Wien gratis Kaffee Frühstück Croissant günstiges Mittagessen Aktion',
];
const viennaMonth = new Intl.DateTimeFormat('de-AT', {
  timeZone: 'Europe/Vienna', month: 'long', year: 'numeric',
});
const allowedHosts = new Set(['www.tiktok.com', 'tiktok.com', 'm.tiktok.com']);

function publicVideoTarget(value) {
  if (typeof value !== 'string' || value.length > 600) return null;
  try {
    const url = new URL(value);
    const match = /^\/@[a-z0-9._-]{2,40}\/video\/([1-9]\d{15,21})\/?$/i.exec(url.pathname);
    if (url.protocol !== 'https:' || url.username || url.password || url.port
        || !allowedHosts.has(url.hostname) || !match) return null;
    return { id: match[1], url: `https://www.tiktok.com${url.pathname.replace(/\/$/, '')}` };
  } catch { return null; }
}

async function readIndexResults(response) {
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 256_000) {
      await reader.cancel();
      throw new Error('Unexpected public index response size');
    }
    chunks.push(value);
  }
  const results = JSON.parse(Buffer.concat(chunks).toString('utf8')).results;
  if (!Array.isArray(results)) throw new Error('Unexpected public index response');
  return results;
}

export async function discoverTikTokLinksViaTavily({
  enabled = false, previous = {}, fetcher = fetch, clock = () => new Date(),
} = {}) {
  const now = clock();
  const deadline = Date.parse(previous?.nextRetryAt);
  const nextRetryAt = deadline > +now ? new Date(deadline).toISOString() : '';
  const cursor = previous?.nextQueryIndex;
  const nextQueryIndex = Number.isSafeInteger(cursor) && cursor >= 0 ? cursor % searchTerms.length : 0;
  const result = { status: 'disabled', nextRetryAt, nextQueryIndex, attemptedQueries: 0, indexRows: 0, links: [] };
  if (!enabled) return result;
  if (nextRetryAt) return { ...result, status: 'cooldown' };

  const attempt = { ...result, queryIndex: nextQueryIndex, attemptedQueries: 1 };
  const query = {
    query: `${searchTerms[nextQueryIndex]} ${viennaMonth.format(now)}`,
    search_depth: 'basic',
    country: 'austria',
    time_range: 'week',
    include_published_date: true,
    max_age_hours: -1, // Search cached index entries only, without live source fetches.
    max_results: MAX_RESULTS,
    include_domains: ['tiktok.com'],
    include_answer: false,
    include_raw_content: false,
    auto_parameters: false,
  };
  // This documented search mode is unauthenticated. Provider results contribute
  // links only. The scanner still needs to read the actual TikTok original.
  let response;
  try {
    response = await fetcher('https://api.tavily.com/search', {
      method: 'POST', redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(15_000),
      headers: { 'Content-Type': 'application/json', 'X-Tavily-Access-Mode': 'keyless' },
      body: JSON.stringify(query),
    });
    const retryAfter = response.headers.get('retry-after');
    if (!response.ok || retryAfter !== null) {
      await response.body?.cancel().catch(() => {});
      const failedAt = clock();
      return {
        ...attempt, httpStatus: response.status,
        status: response.status === 429 ? 'rate-limited' : 'unavailable',
        nextRetryAt: retryAfterAt(retryAfter, failedAt) || new Date(+failedAt + DAY_MS).toISOString(),
      };
    }
    const rows = await readIndexResults(response);
    const distinct = new Map();
    for (const row of rows.slice(0, MAX_RESULTS)) {
      const target = publicVideoTarget(row?.url);
      if (target && !distinct.has(target.id)) distinct.set(target.id, target.url);
    }
    return { ...attempt, status: 'completed', httpStatus: response.status, indexRows: rows.length,
      nextQueryIndex: (nextQueryIndex + 1) % searchTerms.length, links: [...distinct.values()] };
  } catch {
    return {
      ...attempt, status: 'unavailable', httpStatus: response?.status || 0,
      nextRetryAt: new Date(+clock() + DAY_MS).toISOString(),
    };
  }
}

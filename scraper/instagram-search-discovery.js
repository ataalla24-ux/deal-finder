import { load } from 'cheerio';
import { normalizeInstagramPublicPostUrl } from './instagram-page-access.js';
import { sourceFailureFields } from './source-http-policy.js';

const DAY = 86400000;
const time = value => Date.parse(value) || 0;

export function parseInstagramSearchResults(html) {
  const $ = load(html);
  return $('a.result__a[href], a.result-link[href]').toArray().flatMap(node => {
    const link = $(node);
    let href;
    try { href = new URL(link.attr('href'), 'https://html.duckduckgo.com'); } catch { return []; }
    const redirect = /^(?:html\.)?duckduckgo\.com$/i.test(href.hostname) && href.pathname === '/l/'
      ? href.searchParams.get('uddg') : '';
    const url = normalizeInstagramPublicPostUrl(redirect || href.href);
    if (!url) return [];
    const result = link.closest('.result, .result__body, .result-wrapper');
    const text = value => value.replace(/\s+/g, ' ').trim();
    return [{ url, title: text(link.text()), snippet: text(result.find('.result__snippet, .result-snippet').first().text()) }];
  });
}

export async function runInstagramSearchQueries(queries, { search, previousReport = {}, now = new Date(), sleep }) {
  const previous = previousReport.search || {};
  const wasBlocked = (previous.errors || []).some(error => [401, 403, 429].includes(
    sourceFailureFields({ ...error, message: error.error }).httpStatus));
  const deadline = time(previous.nextRetryAt) || (wasBlocked ? time(previousReport.lastUpdated) + DAY : 0);
  const result = {
    candidates: [], errors: [], attemptedQueries: 0, stoppedReason: '',
    nextRetryAt: '', lastAttemptAt: previous.lastAttemptAt || '',
    nextQueryIndex: Math.max(0, Math.floor(Number(previous.nextQueryIndex) || 0)),
  };
  if (deadline > +now) {
    return { ...result, stoppedReason: 'search-cooldown', nextRetryAt: new Date(deadline).toISOString() };
  }
  const start = queries.length ? result.nextQueryIndex % queries.length : 0;
  for (let offset = 0; offset < queries.length; offset++) {
    const index = (start + offset) % queries.length;
    const query = queries[index];
    result.attemptedQueries++;
    result.lastAttemptAt = now.toISOString();
    result.nextQueryIndex = (index + 1) % queries.length;
    try {
      result.candidates.push(...await search(query));
    } catch (error) {
      const details = sourceFailureFields(error);
      result.errors.push({ query, error: error.message, ...details });
      if ([401, 403, 429].includes(details.httpStatus) || time(details.retryAt) > +now) {
        result.stoppedReason = details.httpStatus === 429 ? 'search-rate-limited' : 'search-unavailable';
        result.nextRetryAt = new Date(Math.max(+now + DAY, time(details.retryAt))).toISOString();
        break;
      }
    }
    if (result.attemptedQueries < queries.length) await sleep(1000);
  }
  return result;
}

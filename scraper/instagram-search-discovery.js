import { load } from 'cheerio';
import { normalizeInstagramPublicPostUrl } from './instagram-page-access.js';
import { sourceFailureFields } from './source-http-policy.js';

const DAY = 86400000;
const ONE_RECHECK_DELAY = 4 * 3600000;
const CHALLENGE_WITHOUT_WAIT = 'challenge-without-retry-after';
const challenge = 'Search challenge; no bypass attempted';
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

function getSearchCooldown(previousReport) {
  const previous = previousReport.search || {};
  const lastError = (previous.errors || []).at(-1);
  const blocked = (previous.errors || []).some(error => [401, 403, 429].includes(
    sourceFailureFields({ ...error, message: error.error }).httpStatus));
  const lastAttempt = time(previous.lastAttemptAt);
  const stored = time(previous.nextRetryAt);
  const persisted = previous.boundedRetry;
  const failures = persisted?.reason === CHALLENGE_WITHOUT_WAIT && persisted.failures > 0
    ? Math.min(2, persisted.failures) : 0;
  // Old reports stored the parsed provider deadline. Only reuse an intact
  // challenge record and the exact local 24-hour interval for the same attempt.
  const legacyLocal = !persisted && previous.stoppedReason === 'search-unavailable'
    && lastError?.error === challenge && lastError.httpStatus === 403 && lastError.retryAt === ''
    && lastError.retryAfterProvided !== true && lastAttempt > 0 && stored === lastAttempt + DAY;
  return legacyLocal
    ? { deadline: lastAttempt + ONE_RECHECK_DELAY, failures: 1, failedAt: previous.lastAttemptAt }
    : { deadline: stored || (blocked ? time(previousReport.lastUpdated) + DAY : 0), failures, failedAt: persisted?.failedAt };
}

export async function runInstagramSearchQueries(queries, { search, previousReport = {}, now, clock = () => now ?? new Date(), sleep }) {
  const previous = previousReport.search || {};
  const { deadline, failures, failedAt } = getSearchCooldown(previousReport);
  const result = {
    candidates: [], errors: [], attemptedQueries: 0, stoppedReason: '',
    nextRetryAt: '', lastAttemptAt: previous.lastAttemptAt || '',
    ...(failures ? { boundedRetry: { reason: CHALLENGE_WITHOUT_WAIT, failures, failedAt } } : {}),
    nextQueryIndex: Math.max(0, Math.floor(Number(previous.nextQueryIndex) || 0)),
  };
  if (deadline > +clock()) {
    return { ...result, stoppedReason: 'search-cooldown', nextRetryAt: new Date(deadline).toISOString() };
  }
  const start = queries.length ? result.nextQueryIndex % queries.length : 0;
  const queryLimit = failures ? Math.min(queries.length, 1) : queries.length;
  for (let offset = 0; offset < queryLimit; offset++) {
    const index = (start + offset) % queries.length;
    const query = queries[index];
    result.attemptedQueries++;
    result.lastAttemptAt = clock().toISOString();
    result.nextQueryIndex = (index + 1) % queries.length;
    try {
      result.candidates.push(...await search(query));
      delete result.boundedRetry;
    } catch (error) {
      const details = sourceFailureFields(error);
      const attemptedAt = clock();
      const recordedHeader = typeof error.retryAfterProvided === 'boolean'
        ? { retryAfterProvided: error.retryAfterProvided } : {};
      result.errors.push({ query, error: error.message, ...details, ...recordedHeader });
      if (failures || [401, 403, 429].includes(details.httpStatus) || time(details.retryAt) > +attemptedAt) {
        const allowEarlyRecheck = details.httpStatus === 403 && error.message === challenge
          && error.retryAfterProvided === false && !details.retryAt;
        const previousFailures = result.boundedRetry?.failures || 0;
        if (allowEarlyRecheck || previousFailures) {
          result.boundedRetry = { reason: CHALLENGE_WITHOUT_WAIT, failures: Math.min(2, previousFailures + 1), failedAt: attemptedAt.toISOString() };
        }
        const delay = allowEarlyRecheck && previousFailures === 0 ? ONE_RECHECK_DELAY : DAY;
        result.stoppedReason = details.httpStatus === 429 ? 'search-rate-limited' : 'search-unavailable';
        result.nextRetryAt = new Date(Math.max(+attemptedAt + delay, time(details.retryAt))).toISOString();
        break;
      }
    }
    if (result.attemptedQueries < queryLimit) await sleep(1000);
  }
  return result;
}

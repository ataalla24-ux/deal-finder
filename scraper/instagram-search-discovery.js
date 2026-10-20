import { sourceFailureFields } from './source-http-policy.js';

const DAY = 86400000;
const time = value => Date.parse(value) || 0;

export async function runInstagramSearchQueries(queries, { search, previousReport = {}, now = new Date(), sleep }) {
  const previous = previousReport.search || {};
  const wasBlocked = (previous.errors || []).some(error => [401, 403, 429].includes(
    sourceFailureFields({ ...error, message: error.error }).httpStatus));
  const deadline = time(previous.nextRetryAt) || (wasBlocked ? time(previousReport.lastUpdated) + DAY : 0);
  const result = {
    candidates: [], errors: [], attemptedQueries: 0, stoppedReason: '',
    nextRetryAt: '', lastAttemptAt: previous.lastAttemptAt || '',
  };
  if (deadline > +now) {
    return { ...result, stoppedReason: 'search-cooldown', nextRetryAt: new Date(deadline).toISOString() };
  }
  for (const query of queries) {
    result.attemptedQueries++;
    result.lastAttemptAt = now.toISOString();
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

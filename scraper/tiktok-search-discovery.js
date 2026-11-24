import { retryAfterAt } from './source-http-policy.js';

const DAY_MS = 86400000;
const LOCAL_RETRY_MS = 4 * 3600000;
const SINGLE_REQUEST = 'single-request';
const transportReasons = new Set(['response-unavailable', 'request-policy-blocked', 'response-http-error',
  'response-too-large', 'empty-response', 'non-json-response', 'response-read-failed', 'request-failed', 'response-timeout',
  'no-search-request', 'unrecognized-search-request', 'ancillary-search-only', 'document-http-error',
  'homepage-origin-mismatch', 'login-wall', 'access-challenge']);
const providerMessageSignals = new Map([
  ['login required', 'login-required'], ['please log in to continue', 'login-required'],
  ['please login your account first', 'login-required'],
  ['too many requests', 'throttled'], ['rate limit exceeded', 'throttled'],
  ['captcha required', 'access-challenge'], ['verify to continue', 'access-challenge'],
  ['access denied', 'access-denied'], ['invalid parameter', 'invalid-parameters'],
  ['invalid parameters', 'invalid-parameters'], ['invalid request', 'invalid-request'],
  ['something went wrong', 'generic-provider-error'], ['try again later', 'retry-later'],
]);
const providerSignals = new Set([...providerMessageSignals.values(), 'unclassified']);
const searchFailureCodes = new Set(['provider-error', 'transport-unavailable', 'invalid-response', 'schema-mismatch']);

export function tikTokRetryAt(retryAfter, now = new Date(), minimumMs = DAY_MS) {
  return new Date(Math.max(+now + minimumMs, Date.parse(retryAfterAt(retryAfter, now)) || 0)).toISOString();
}

export function hasTikTokSingleRequestRetry(previous = {}) {
  const guard = previous.boundedRetry;
  // Older reports expressed the same request cap as a local failure reason.
  return guard?.failures >= 1 && (guard.mode === SINGLE_REQUEST || guard.reason === 'local-request-policy');
}

export function tikTokDirectProbePrevious(previous, now = new Date(), scheduledRun) {
  const failure = previous?.errors?.[0];
  if (!(Date.parse(previous?.nextRetryAt) > +now)
      || !hasTikTokSingleRequestRetry(previous) || previous.attemptedRequests !== 1
      || previous.searchRequests !== 0 || previous.lastSearchResponse != null
      || previous.errors?.length !== 1 || failure?.status !== 0
      || failure.retryAfter != null || failure.retryAt != null) return previous;

  const oldBrowserFilter = previous.transport === 'public-browser-search'
    && previous.blockedExtraRequests > 0 && failure.transportReason === 'request-policy-blocked';
  // In this diagnostic revision, the local homepage URL check was the only
  // source of this error code in the direct transport.
  const oldHomepageCheck = previous.transport === 'direct-browser-search' && previous.navigations === 1
    && previous.checkedBy?.checkoutSha === '05060c270fa89da1247dd0e4fe206a6323f47bf9'
    && failure.transportReason === 'request-failed';
  // The old exact-URL gate rejected the URL enriched by the public page before
  // forwarding any search. Only release the matching scheduled report once.
  const oldDirectUrlCheck = scheduledRun?.runId === '45077824293'
    && scheduledRun.checkoutSha === '93b17460f15e1dc6894726f304fe52c6490f4d2f'
    && !previous.checkedBy && previous.transport === 'direct-browser-search' && previous.navigations === 1
    && previous.homepageNavigation === 'same-origin-redirect' && failure.code === 'transport-unavailable'
    && !failure.transportReason;
  // Retain the single-request limit and let the new attempt record any provider deadline.
  return oldBrowserFilter || oldHomepageCheck || oldDirectUrlCheck ? { ...previous, nextRetryAt: '' } : previous;
}

export function selectTikTokPostVisits(api, webLinks, maxPosts) {
  const knownUrls = new Set(api.rows.map(item => item.data.url));
  const visibleLinks = (api.publicVideoLinks || []).filter(url => !knownUrls.has(url));
  const webCandidates = webLinks.filter(url => !knownUrls.has(url));
  const urls = [...new Set([...visibleLinks, ...(api.nextRetryAt ? [] : webCandidates)])].slice(0, maxPosts);
  return {
    urls,
    deferredWebVisits: api.nextRetryAt ? webCandidates.slice(0, maxPosts).filter(url => !urls.includes(url)).length : 0,
  };
}

export function tikTokPublicOnlyAccess(previousReport = {}, now = new Date()) {
  const api = previousReport.apiDiscovery || {};
  const previousSearchStop = previousReport.searchDiscovery?.postVisitStop;
  const apiStopAt = Date.parse(api.postVisitStop?.retryAt) || 0;
  const searchStopAt = Date.parse(previousSearchStop?.retryAt) || 0;
  const postVisitStop = searchStopAt > apiStopAt ? previousSearchStop : api.postVisitStop;
  const deadline = Math.max(0, Date.parse(api.nextRetryAt) || 0, apiStopAt, searchStopAt);
  const nextRetryAt = deadline > +now ? new Date(deadline).toISOString() : '';
  const lastFailure = previousTikTokSearchFailure(api, previousReport.runProvenance);
  return {
    rows: [], errors: [], attemptedRequests: 0, rawItems: 0, nextRetryAt,
    stoppedReason: nextRetryAt ? 'api-cooldown' : 'public-only',
    ...(postVisitStop ? { postVisitStop } : {}),
    ...(api.nextKeywordIndex !== undefined ? { nextKeywordIndex: api.nextKeywordIndex } : {}),
    ...(hasTikTokSingleRequestRetry(api) ? { boundedRetry: api.boundedRetry } : {}),
    ...(lastFailure ? { lastFailure } : {}),
  };
}

export function tikTokDiscoveryHealth(api, search, accepted = 0, { index, publicVisits = [] } = {}) {
  const missedOriginals = publicVisits.length > 0 && !publicVisits.some(visit => visit.originalUrl);
  const publicSearchUnavailable = api.stoppedReason === 'public-only'
    && ((!search.attemptedQueries && index?.status !== 'completed') || missedOriginals);
  const webSearchUnavailable = !search.skippedThisRun && (search.errors?.length || search.nextRetryAt);
  const unavailable = Boolean(api.errors?.length || api.nextRetryAt || webSearchUnavailable || publicSearchUnavailable);
  return { status: unavailable ? 'discovery-degraded' : 'completed',
    outputPreserved: (unavailable || Boolean(search.skippedThisRun)) && accepted === 0 };
}

function numericProviderCode(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  const code = String(value);
  return /^-?\d{1,10}$/.test(code) ? code : undefined;
}

function providerMessageSignal(message) {
  if (typeof message !== 'string' || !message.trim()) return undefined;
  if (message.length > 120) return 'unclassified';
  const phrase = message.trim().toLowerCase().replace(/[.!]$/, '').replace(/\s+/g, ' ');
  return providerMessageSignals.get(phrase) || 'unclassified';
}

function searchFailureEvidence(failure, { failedAt, runProvenance, retryAfterProvided } = {}) {
  if (!searchFailureCodes.has(failure?.code)) return undefined;
  const status = Number(failure.status);
  const providerCode = numericProviderCode(failure.providerCode);
  return {
    status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : 0,
    code: failure.code,
    ...(providerCode !== undefined ? { providerCode } : {}),
    ...(providerSignals.has(failure.providerSignal) ? { providerSignal: failure.providerSignal } : {}),
    ...(transportReasons.has(failure.transportReason) ? { transportReason: failure.transportReason } : {}),
    failedAt: Number.isFinite(Date.parse(failedAt)) ? new Date(failedAt).toISOString() : null,
    ...(typeof retryAfterProvided === 'boolean' ? { retryAfterProvided } : {}),
    runProvenance: runProvenance || null,
  };
}

export function previousTikTokSearchFailure(previous = {}, previousRunProvenance) {
  if (previous.lastFailure) return searchFailureEvidence(previous.lastFailure, previous.lastFailure);
  if (!(previous.attemptedRequests > 0) || !Array.isArray(previous.errors)) return undefined;
  return searchFailureEvidence(previous.errors.at(-1), {
    failedAt: previous.boundedRetry?.failedAt,
    retryAfterProvided: previous.lastSearchResponse?.retryAfterProvided,
    runProvenance: previous.checkedBy === undefined ? previousRunProvenance : previous.checkedBy,
  });
}

export function parseTikTokSearchResponse(result = {}) {
  const status = Number(result.status || 0);
  if (!result.ok) return { error: status >= 400 ? `HTTP ${status}` : 'Empty or non-JSON TikTok response', code: 'transport-unavailable',
    transportReason: transportReasons.has(result.transportReason) ? result.transportReason : 'response-unavailable' };
  const body = result.body;
  if (!body || typeof body !== 'object') return { error: 'Missing TikTok response object', code: 'invalid-response' };
  const providerStatus = body.status_code ?? body.statusCode;
  const providerCode = numericProviderCode(providerStatus);
  if (providerStatus !== undefined && (providerCode === undefined || Number(providerCode) !== 0)) {
    return { error: 'TikTok returned a provider error', code: 'provider-error',
      providerCode, providerSignal: providerMessageSignal(body.status_msg ?? body.statusMsg) };
  }
  const batch = [body.data, body.item_list, body.itemList, body.data?.item_list, body.data?.itemList].find(Array.isArray);
  if (!batch) return { error: 'Unrecognized TikTok search payload', code: 'schema-mismatch' };
  return { batch, hasMore: body.has_more ?? body.hasMore, providerCode: providerStatus ?? null };
}

export async function runTikTokApiDiscovery({ keywords, request, normalize, wait = async () => {},
  previous = {}, now, clock = () => now ?? new Date(), pages = 3, count = 30, maxCandidates = 1200,
  fullKeywordScan = false, runProvenance, previousRunProvenance } = {}) {
  const boundedRetry = hasTikTokSingleRequestRetry(previous);
  const useFullScan = fullKeywordScan && !boundedRetry;
  const result = { rows: [], errors: [], attemptedRequests: 0, emptyResponses: 0,
    rawItems: 0, normalizedItems: 0, ignoredItems: 0, stoppedReason: '', nextRetryAt: '',
    nextKeywordIndex: Math.max(0, Math.floor(Number(previous.nextKeywordIndex) || 0)) };
  if (Date.parse(previous.nextRetryAt) > +clock()) {
    const lastFailure = previousTikTokSearchFailure(previous, previousRunProvenance);
    return { ...result, stoppedReason: 'api-cooldown', nextRetryAt: previous.nextRetryAt,
      ...(lastFailure ? { lastFailure } : {}),
      ...(previous.postVisitStop ? { postVisitStop: previous.postVisitStop } : {}),
      ...(boundedRetry ? { boundedRetry: { mode: SINGLE_REQUEST, failures: previous.boundedRetry.failures } } : {}) };
  }
  const seen = new Set();
  const start = !useFullScan && keywords.length ? result.nextKeywordIndex % keywords.length : 0;
  const keywordLimit = boundedRetry ? Math.min(keywords.length, 1) : keywords.length;
  const pageLimit = boundedRetry ? Math.min(pages, 1) : pages;
  let consecutiveEmpty = 0;
  for (let index = 0; index < keywordLimit; index++) {
    const keywordIndex = (start + index) % keywords.length;
    const keyword = keywords[keywordIndex];
    result.nextKeywordIndex = (keywordIndex + 1) % keywords.length;
    for (let pageIndex = 0; pageIndex < pageLimit; pageIndex++) {
      const offset = pageIndex * count;
      if (result.attemptedRequests) await wait(useFullScan ? 350 : 1000);
      result.attemptedRequests++;
      if (runProvenance) result.checkedBy = runProvenance;
      let response, parsed;
      try {
        response = await request({ keyword, offset, count });
        parsed = parseTikTokSearchResponse(response);
      } catch {
        parsed = { error: 'TikTok search request failed or timed out', code: 'transport-unavailable' };
      }
      if (parsed.error) {
        const status = Number(response?.status || 0);
        const retryAfter = response?.retryAfter;
        const failedAt = clock();
        const localPolicyBlocked = status === 0 && parsed.transportReason === 'request-policy-blocked'
          && (retryAfter === '' || retryAfter == null);
        const failure = { status, code: parsed.code, providerCode: parsed.providerCode, providerSignal: parsed.providerSignal,
          ...(parsed.transportReason ? { transportReason: parsed.transportReason } : {}) };
        result.errors.push({ keyword, offset, error: parsed.error, ...failure });
        // Null is an observed absent header. Some local transport failures use an empty placeholder.
        result.lastFailure = searchFailureEvidence(failure, { failedAt: failedAt.toISOString(), runProvenance,
          retryAfterProvided: retryAfter === null ? false : retryAfter ? true : undefined });
        result.stoppedReason = parsed.code;
        result.nextRetryAt = tikTokRetryAt(retryAfter, failedAt, localPolicyBlocked && !boundedRetry ? LOCAL_RETRY_MS : DAY_MS);
        if (localPolicyBlocked || boundedRetry) {
          result.boundedRetry = { mode: SINGLE_REQUEST, failures: boundedRetry ? 2 : 1 };
        }
        return result;
      }
      result.rawItems += parsed.batch.length;
      for (const raw of parsed.batch) {
        const item = normalize(raw);
        if (!item) { result.ignoredItems++; continue; }
        result.normalizedItems++;
        if (seen.has(item.url)) continue;
        seen.add(item.url);
        result.rows.push({ keyword, offset, data: item });
        if (result.rows.length >= maxCandidates) return { ...result, stoppedReason: 'candidate-limit' };
      }
      if (parsed.batch.length === 0) {
        result.emptyResponses++;
        if (!useFullScan && ++consecutiveEmpty >= 5) return { ...result, stoppedReason: 'empty-search-sample' };
        break;
      }
      consecutiveEmpty = 0;
      if (parsed.hasMore === false || parsed.hasMore === 0) break;
    }
  }
  return result;
}

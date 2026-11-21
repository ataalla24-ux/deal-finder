import { retryAfterAt } from './source-http-policy.js';

const DAY_MS = 86400000;
const LOCAL_RETRY_MS = 4 * 3600000;
const LOCAL_RETRY_REASON = 'local-request-policy';
const transportReasons = new Set(['response-unavailable', 'request-policy-blocked', 'response-http-error',
  'response-too-large', 'empty-response', 'non-json-response', 'response-read-failed', 'request-failed', 'response-timeout',
  'no-search-request', 'document-http-error', 'login-wall', 'access-challenge']);

export function tikTokRetryAt(retryAfter, now = new Date(), minimumMs = DAY_MS) {
  return new Date(Math.max(+now + minimumMs, Date.parse(retryAfterAt(retryAfter, now)) || 0)).toISOString();
}

export function isTikTokLocalRetry(previous = {}) {
  return previous.boundedRetry?.reason === LOCAL_RETRY_REASON && previous.boundedRetry.failures >= 1;
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

export function tikTokDiscoveryHealth(api, search, accepted = 0) {
  const unavailable = Boolean(api.errors?.length || search.errors?.length || api.nextRetryAt || search.nextRetryAt);
  return { status: unavailable ? 'discovery-degraded' : 'completed', outputPreserved: unavailable && accepted === 0 };
}

export function parseTikTokSearchResponse(result = {}) {
  const status = Number(result.status || 0);
  if (!result.ok) return { error: status >= 400 ? `HTTP ${status}` : 'Empty or non-JSON TikTok response', code: 'transport-unavailable',
    transportReason: transportReasons.has(result.transportReason) ? result.transportReason : 'response-unavailable' };
  const body = result.body;
  if (!body || typeof body !== 'object') return { error: 'Missing TikTok response object', code: 'invalid-response' };
  const providerCode = body.status_code ?? body.statusCode;
  if (providerCode !== undefined && Number(providerCode) !== 0) {
    return { error: 'TikTok returned a provider error', code: 'provider-error', providerCode: String(providerCode).slice(0, 40) };
  }
  const batch = [body.data, body.item_list, body.itemList, body.data?.item_list, body.data?.itemList].find(Array.isArray);
  if (!batch) return { error: 'Unrecognized TikTok search payload', code: 'schema-mismatch' };
  return { batch, hasMore: body.has_more ?? body.hasMore, providerCode: providerCode ?? null };
}

export async function runTikTokApiDiscovery({ keywords, request, normalize, wait = async () => {},
  previous = {}, now, clock = () => now ?? new Date(), pages = 3, count = 30, maxCandidates = 1200 } = {}) {
  const boundedRetry = isTikTokLocalRetry(previous);
  const result = { rows: [], errors: [], attemptedRequests: 0, emptyResponses: 0,
    rawItems: 0, normalizedItems: 0, ignoredItems: 0, stoppedReason: '', nextRetryAt: '',
    nextKeywordIndex: Math.max(0, Math.floor(Number(previous.nextKeywordIndex) || 0)) };
  if (Date.parse(previous.nextRetryAt) > +clock()) {
    return { ...result, stoppedReason: 'api-cooldown', nextRetryAt: previous.nextRetryAt,
      ...(boundedRetry ? { boundedRetry: previous.boundedRetry } : {}) };
  }
  const seen = new Set();
  const start = keywords.length ? result.nextKeywordIndex % keywords.length : 0;
  const keywordLimit = boundedRetry ? Math.min(keywords.length, 1) : keywords.length;
  const pageLimit = boundedRetry ? Math.min(pages, 1) : pages;
  let consecutiveEmpty = 0;
  for (let index = 0; index < keywordLimit; index++) {
    const keywordIndex = (start + index) % keywords.length;
    const keyword = keywords[keywordIndex];
    result.nextKeywordIndex = (keywordIndex + 1) % keywords.length;
    for (let pageIndex = 0; pageIndex < pageLimit; pageIndex++) {
      const offset = pageIndex * count;
      if (result.attemptedRequests) await wait(1000);
      result.attemptedRequests++;
      let response, parsed;
      try {
        response = await request({ keyword, offset, count });
        parsed = parseTikTokSearchResponse(response);
      } catch {
        parsed = { error: 'TikTok search request failed or timed out', code: 'transport-unavailable' };
      }
      if (parsed.error) {
        const status = Number(response?.status || 0);
        const failedAt = clock();
        const localPolicyBlocked = status === 0 && parsed.transportReason === 'request-policy-blocked'
          && (response?.retryAfter === '' || response?.retryAfter == null);
        result.errors.push({ keyword, offset, status,
          error: parsed.error, code: parsed.code, providerCode: parsed.providerCode,
          ...(parsed.transportReason ? { transportReason: parsed.transportReason } : {}) });
        result.stoppedReason = parsed.code;
        result.nextRetryAt = tikTokRetryAt(response?.retryAfter, failedAt, localPolicyBlocked && !boundedRetry ? LOCAL_RETRY_MS : DAY_MS);
        if (localPolicyBlocked || boundedRetry) {
          result.boundedRetry = { reason: LOCAL_RETRY_REASON, failures: boundedRetry ? 2 : 1, failedAt: failedAt.toISOString() };
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
        if (++consecutiveEmpty >= 5) return { ...result, stoppedReason: 'empty-search-sample' };
        break;
      }
      consecutiveEmpty = 0;
      if (parsed.hasMore === false || parsed.hasMore === 0) break;
    }
  }
  return result;
}

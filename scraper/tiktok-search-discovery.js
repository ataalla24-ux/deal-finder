import { retryAfterAt } from './source-http-policy.js';

export function tikTokDiscoveryHealth(api, search, accepted = 0) {
  const unavailable = Boolean(api.errors?.length || search.errors?.length || api.nextRetryAt || search.nextRetryAt);
  return { status: unavailable ? 'discovery-degraded' : 'completed', outputPreserved: unavailable && accepted === 0 };
}

export function parseTikTokSearchResponse(result = {}) {
  const status = Number(result.status || 0);
  if (!result.ok) return { error: status >= 400 ? `HTTP ${status}` : 'Empty or non-JSON TikTok response', code: 'transport-unavailable' };
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
  previous = {}, now = new Date(), pages = 3, count = 30, maxCandidates = 1200 } = {}) {
  const result = { rows: [], errors: [], attemptedRequests: 0, emptyResponses: 0,
    rawItems: 0, normalizedItems: 0, ignoredItems: 0, stoppedReason: '', nextRetryAt: '',
    nextKeywordIndex: Math.max(0, Math.floor(Number(previous.nextKeywordIndex) || 0)) };
  if (Date.parse(previous.nextRetryAt) > +now) {
    return { ...result, stoppedReason: 'api-cooldown', nextRetryAt: previous.nextRetryAt };
  }
  const seen = new Set();
  const start = keywords.length ? result.nextKeywordIndex % keywords.length : 0;
  let consecutiveEmpty = 0;
  for (let index = 0; index < keywords.length; index++) {
    const keywordIndex = (start + index) % keywords.length;
    const keyword = keywords[keywordIndex];
    result.nextKeywordIndex = (keywordIndex + 1) % keywords.length;
    for (let pageIndex = 0; pageIndex < pages; pageIndex++) {
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
        result.errors.push({ keyword, offset, status: Number(response?.status || 0),
          error: parsed.error, code: parsed.code, providerCode: parsed.providerCode });
        result.stoppedReason = parsed.code;
        result.nextRetryAt = new Date(Math.max(+now + 86400000, Date.parse(retryAfterAt(response?.retryAfter, now)) || 0)).toISOString();
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

import { setTimeout as wait } from 'node:timers/promises';
import { getFreeSearchBudget, requestTavilyJson } from './tiktok-public-index.js';
import { buildInstagramTavilyQuery, normalizeInstagramTavilyUrl } from './instagram-tavily-index.js';

export const INSTAGRAM_TAVILY_INVESTIGATION = 'instagram-empty-results-20261127-v1';
export const INSTAGRAM_TAVILY_INVESTIGATION_STATE = 'source-state/instagram-tavily-investigation.json';

export function instagramTavilyComparisons(now) {
  const base = { search_depth: 'basic', topic: 'general', country: 'austria',
    time_range: 'week', include_published_date: true, max_age_hours: -1,
    max_results: 20, include_domains: ['instagram.com'], include_answer: false,
    include_raw_content: false, auto_parameters: false, include_usage: true };
  const short = { ...base, query: 'Wien gratis Essen' };
  const allDates = { ...short }; delete allDates.time_range;
  const providerDefault = { ...allDates }; delete providerDefault.max_age_hours;
  return [
    { id: 'production-baseline', body: { ...base, query: buildInstagramTavilyQuery(now) } },
    { id: 'short-query', body: short },
    { id: 'short-query-all-dates', body: allDates },
    { id: 'short-query-provider-default-cache', body: providerDefault },
  ];
}

// A separately claimed, finite experiment. It cannot alter the ordinary TikTok
// cursor/query cap or replay the previous one-query Instagram probe.
export async function investigateInstagramTavily({ apiKey = '', freePlanConfirmed = false,
  previous = {}, cache = {}, instagramHoldUntil = '', fetcher = fetch,
  clock = () => new Date(), sleep = wait } = {}) {
  const now = clock();
  const report = { investigation: INSTAGRAM_TAVILY_INVESTIGATION, checkedAt: now.toISOString(),
    status: 'not-started', usageChecks: 0, attemptedQueries: 0, reportedSearchCredits: 0,
    comparisons: [], links: [], nextRetryAt: '' };
  if (cache === null) return { ...report, status: 'shared-index-state-invalid' };
  const holds = [previous.nextRetryAt, cache.nextRetryAt];
  if ([...holds, instagramHoldUntil, cache.lastProbeAt].some(value => value && !Number.isFinite(Date.parse(value)))) {
    return { ...report, status: 'shared-index-state-invalid' };
  }
  const deadline = Math.max(0, ...holds.map(value => Date.parse(value) || 0));
  if (deadline > +now) return { ...report, status: 'cooldown', nextRetryAt: new Date(deadline).toISOString() };
  // An Instagram website hold must not become a shared Tavily/TikTok hold.
  if (Date.parse(instagramHoldUntil) > +now) return { ...report, status: 'instagram-access-paused',
    instagramNextRetryAt: instagramHoldUntil };
  if (!freePlanConfirmed) return { ...report, status: 'free-plan-unconfirmed' };
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!key) return { ...report, status: 'key-missing' };
  const authorization = { Authorization: `Bearer ${key}` };
  const usage = await requestTavilyJson('https://api.tavily.com/usage', { method: 'GET', headers: authorization },
    { fetcher, clock, isValid: value => value && typeof value === 'object' && !Array.isArray(value) });
  report.usageChecks = 1; report.usageHttpStatus = usage.httpStatus;
  if (usage.status !== 'completed') return { ...report, status: usage.status, nextRetryAt: usage.nextRetryAt };
  const budget = getFreeSearchBudget(usage.payload, now, 4);
  if (budget.refusal) return { ...report, status: 'free-plan-unverified', budgetRefusalReason: budget.refusal };
  report.budget = budget;
  const cap = Math.min(4, budget.remainingCredits, budget.plannedQueries);
  if (!cap) return { ...report, status: 'free-credits-exhausted' };
  const links = new Set();
  const baselineTime = cache.lastProbeAt ? new Date(cache.lastProbeAt) : now;
  for (const [index, variant] of instagramTavilyComparisons(baselineTime).slice(0, cap).entries()) {
    if (index) await sleep(1000);
    report.attemptedQueries++;
    const response = await requestTavilyJson('https://api.tavily.com/search', {
      method: 'POST', headers: { ...authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify(variant.body),
    }, { fetcher, clock, isValid: value => Array.isArray(value?.results) });
    const row = { id: variant.id, query: variant.body.query, dateWindow: variant.body.time_range || 'none',
      cacheMode: variant.body.max_age_hours === -1 ? 'index-only' : 'provider-default',
      liveFetchAllowed: variant.body.max_age_hours !== -1,
      status: response.status, httpStatus: response.httpStatus, indexRows: 0, canonicalPublicLinks: 0,
      excludedRows: 0, reportedSearchCredits: null };
    report.comparisons.push(row);
    if (response.status !== 'completed') return { ...report, status: response.status,
      nextRetryAt: response.nextRetryAt, links: [...links] };
    row.indexRows = response.payload.results.length;
    row.reportedSearchCredits = Number.isSafeInteger(response.payload.usage?.credits)
      ? response.payload.usage.credits : null;
    if (row.reportedSearchCredits >= 0) report.reportedSearchCredits += row.reportedSearchCredits;
    // Basic is exactly one included credit. Missing/abnormal receipts stop the
    // investigation before another request; snippets and provider dates never
    // become offer evidence or enter the stored output.
    if (row.reportedSearchCredits !== 1) return { ...report, status: 'unexpected-search-credit-cost',
      nextRetryAt: new Date(+clock() + 86400000).toISOString(), links: [...links] };
    const canonical = new Set();
    for (const result of response.payload.results.slice(0, 20)) {
      const url = normalizeInstagramTavilyUrl(result?.url);
      if (url) canonical.add(url); else row.excludedRows++;
    }
    row.canonicalPublicLinks = canonical.size;
    row.links = [...canonical];
    for (const url of canonical) links.add(url);
  }
  return { ...report, status: cap === 4 ? 'completed' : 'budget-limited', links: [...links] };
}

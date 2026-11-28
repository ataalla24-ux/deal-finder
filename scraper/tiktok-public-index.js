import { setTimeout as wait } from 'node:timers/promises';
import { retryAfterAt } from './source-http-policy.js';
import { buildTavilyTikTokQueries } from './tiktok-public-index-queries.js';
import {
  buildInstagramTavilyQuery, normalizeInstagramTavilyUrl, selectInstagramTavilyProductionQuery,
} from './instagram-tavily-index.js';

const DAY_MS = 86_400_000;
const MAX_RESULTS = 20;
const FREE_PLAN_CREDITS = 1_000;
const REQUEST_INTERVAL_MS = 1_000;
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

async function readTavilyJson(response) {
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
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function requestTavilyJson(url, options, { fetcher, clock, isValid }) {
  let response;
  try {
    response = await fetcher(url, {
      ...options, redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(15_000),
    });
    const retryAfter = response.headers.get('retry-after');
    if (!response.ok || retryAfter !== null) {
      await response.body?.cancel().catch(() => {});
      const failedAt = clock();
      return { status: response.status === 429 ? 'rate-limited' : 'unavailable', httpStatus: response.status,
        nextRetryAt: retryAfterAt(retryAfter, failedAt) || new Date(+failedAt + DAY_MS).toISOString() };
    }
    const payload = await readTavilyJson(response);
    if (!isValid(payload)) throw new Error('Unexpected Tavily response');
    return { status: 'completed', httpStatus: response.status, payload };
  } catch {
    return { status: 'unavailable', httpStatus: response?.status || 0,
      nextRetryAt: new Date(+clock() + DAY_MS).toISOString() };
  }
}

export function getFreeSearchBudget({ account, key }, now, queryCount) {
  const nonnegativeInteger = value => Number.isSafeInteger(value) && value >= 0;
  const plan = typeof account?.current_plan === 'string' ? account.current_plan.trim().toLowerCase() : '';
  if (!['researcher', 'free'].includes(plan)) return { refusal: 'account-plan-unrecognized' };
  if (account.plan_limit !== FREE_PLAN_CREDITS) return { refusal: 'account-limit-unconfirmed' };
  if (!nonnegativeInteger(account.plan_usage)) return { refusal: 'account-usage-invalid' };
  if (account.paygo_usage !== 0 || ![0, null].includes(account.paygo_limit)) return { refusal: 'paygo-not-confirmed-off' };
  if (!nonnegativeInteger(key?.usage) || (key.limit !== null && !nonnegativeInteger(key.limit))) {
    return { refusal: 'key-usage-invalid' };
  }

  const keyCredits = key.limit === null ? FREE_PLAN_CREDITS : key.limit - key.usage;
  const remainingCredits = Math.max(0, Math.min(FREE_PLAN_CREDITS - account.plan_usage, keyCredits));
  const finalDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  // Count the current invocation once, plus scheduled 05:15 and 17:15 UTC
  // slots strictly after it through the end of the current UTC month.
  const laterToday = [5 * 60 + 15, 17 * 60 + 15].filter(slot => slot > minutes).length;
  const remainingRunSlots = 1 + laterToday + 2 * (finalDay - now.getUTCDate());
  return { remainingCredits, remainingRunSlots,
    plannedQueries: Math.min(queryCount, Math.ceil(remainingCredits / remainingRunSlots)) };
}

export async function discoverTikTokLinksViaTavily({
  enabled = false, previous = {}, apiKey = '', freePlanConfirmed = false,
  instagramIndex = undefined,
  fetcher = fetch, clock = () => new Date(), sleep = wait,
} = {}) {
  const now = clock();
  const deadline = Math.max(Date.parse(previous?.nextRetryAt) || 0, Date.parse(instagramIndex?.previous?.nextRetryAt) || 0);
  const nextRetryAt = deadline > +now ? new Date(deadline).toISOString() : '';
  const cursor = previous?.nextQueryIndex;
  const nextQueryIndex = Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0;
  const result = { status: 'disabled', nextRetryAt, nextQueryIndex, attemptedQueries: 0, indexRows: 0, links: [] };
  if (!enabled) return result;
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  const accessMode = freePlanConfirmed || apiKey ? 'keyed' : 'keyless';
  const indexRun = { ...result, accessMode };
  const instagramProbe = instagramIndex?.probe === true;
  if (instagramIndex?.previous === null) return { ...indexRun, status: 'shared-index-state-invalid' };
  if (instagramProbe && instagramIndex.previous?.lastProbeAt) return { ...indexRun, status: 'probe-already-attempted' };
  if (instagramProbe && accessMode !== 'keyed') return { ...indexRun, status: 'key-missing' };
  if (accessMode === 'keyed' && !freePlanConfirmed) return { ...indexRun, status: 'free-plan-unconfirmed' };
  if (freePlanConfirmed && !key) return { ...indexRun, status: 'key-missing' };
  if (nextRetryAt) return { ...indexRun, status: 'cooldown' };

  const queryPlan = buildTavilyTikTokQueries(now);
  const queries = [...new Set(key ? queryPlan : queryPlan.slice(0, 4))];
  if (!queries.length) return { ...indexRun, status: 'no-search-queries' };
  const attempt = { ...indexRun, queryIndex: nextQueryIndex % queries.length, nextQueryIndex: nextQueryIndex % queries.length };
  const authorization = key ? { Authorization: `Bearer ${key}` } : { 'X-Tavily-Access-Mode': 'keyless' };
  let queryBudget = 1;
  if (key) {
    const usage = await requestTavilyJson('https://api.tavily.com/usage', {
      method: 'GET', headers: authorization,
    }, { fetcher, clock, isValid: value => value && typeof value === 'object' && !Array.isArray(value) });
    attempt.usageChecks = 1;
    attempt.usageHttpStatus = usage.httpStatus;
    attempt.completedQueries = 0;
    attempt.queriesWithCreditUsage = 0;
    attempt.reportedSearchCredits = 0;
    if (usage.status !== 'completed') return { ...attempt, status: usage.status, nextRetryAt: usage.nextRetryAt };
    const budget = getFreeSearchBudget(usage.payload, now, queries.length);
    if (budget.refusal) return { ...attempt, status: 'free-plan-unverified', budgetRefusalReason: budget.refusal };
    attempt.budget = budget;
    queryBudget = budget.plannedQueries;
    if (queryBudget === 0) return { ...attempt, status: 'free-credits-exhausted' };
  }
  if (instagramProbe) queryBudget = 1;
  const instagramSlot = instagramProbe || (key && instagramIndex?.enabled && queryBudget >= 2) ? queryBudget - 1 : -1;
  const searchOptions = {
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
    ...(key ? { include_usage: true } : {}),
  };
  const distinct = new Map();
  for (let index = 0; index < queryBudget; index++) {
    if (index > 0) await sleep(REQUEST_INTERVAL_MS);
    const forInstagram = index === instagramSlot;
    const productionQuery = forInstagram && !instagramProbe ? selectInstagramTavilyProductionQuery(instagramIndex.previous) : null;
    const query = forInstagram ? productionQuery?.query || buildInstagramTavilyQuery(now) : queries[attempt.nextQueryIndex];
    const instagram = forInstagram ? { attemptedQueries: 1, indexRows: 0, links: [] } : null;
    if (instagram) {
      attempt.instagramIndex = instagram;
      if (productionQuery) {
        attempt.tikTokStatus = 'completed';
        instagram.productionQueryId = productionQuery.id;
        instagram.productionQueryPlanVersion = productionQuery.version;
      }
    }
    attempt.attemptedQueries++;
    const search = await requestTavilyJson('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authorization },
      body: JSON.stringify({ query, ...searchOptions, ...(forInstagram ? { include_domains: ['instagram.com'] } : {}) }),
    }, { fetcher, clock, isValid: value => Array.isArray(value?.results) });
    attempt.httpStatus = search.httpStatus;
    if (instagram) Object.assign(instagram, { status: search.status, httpStatus: search.httpStatus });
    if (search.status !== 'completed') {
      return {
        ...attempt, status: search.status, nextRetryAt: search.nextRetryAt, links: [...distinct.values()],
      };
    }
    const rows = search.payload.results;
    if (instagram) instagram.indexRows = rows.length;
    else attempt.indexRows += rows.length;
    const reportedCredits = search.payload.usage?.credits;
    if (productionQuery && reportedCredits === 1) instagram.nextProductionQueryCursor = productionQuery.nextCursor;
    if (key) {
      attempt.completedQueries++;
      if (Number.isSafeInteger(reportedCredits) && reportedCredits >= 0) {
        attempt.queriesWithCreditUsage++;
        attempt.reportedSearchCredits += reportedCredits;
        if (instagram) instagram.reportedSearchCredits = reportedCredits;
      }
    }
    if (!instagram) attempt.nextQueryIndex = (attempt.nextQueryIndex + 1) % queries.length;
    // Index result content cannot become deal evidence. Keep exact URLs only.
    for (const row of rows.slice(0, MAX_RESULTS)) {
      if (instagram) {
        const url = normalizeInstagramTavilyUrl(row?.url);
        if (url && !instagram.links.includes(url)) instagram.links.push(url);
        continue;
      }
      const target = publicVideoTarget(row?.url);
      if (target && !distinct.has(target.id)) distinct.set(target.id, target.url);
    }
    if (key && Number.isSafeInteger(reportedCredits) && reportedCredits > 1) {
      if (instagram) Object.assign(instagram, { status: 'unexpected-search-credit-cost', links: [] });
      return { ...attempt, status: 'unexpected-search-credit-cost',
        nextRetryAt: new Date(+clock() + DAY_MS).toISOString(), links: [...distinct.values()] };
    }
  }
  return { ...attempt, status: 'completed', links: [...distinct.values()] };
}

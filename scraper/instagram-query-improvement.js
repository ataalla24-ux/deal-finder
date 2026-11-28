import { setTimeout as wait } from 'node:timers/promises';
import { canonicalInstagramPostKey } from './deal-evidence-utils.js';
import { instagramTavilyComparisons } from './instagram-tavily-investigation.js';
import { normalizeInstagramTavilyUrl } from './instagram-tavily-index.js';
import { getFreeSearchBudget, requestTavilyJson } from './tiktok-public-index.js';

export const INSTAGRAM_QUERY_COMPARISON = 'instagram-query-improvement-20261128-v1';
export const INSTAGRAM_QUERY_RESULT = 'source-state/instagram-query-improvement-result.json';
export const MAX_INSTAGRAM_COMPARISON_QUERIES = 6;
const previousOpeningQuery = 'Wien Instagram öffentliche Beiträge oder Reels gratis Essen und Getränke Neueröffnung';
const controlQuery = 'Dahab Döner 1+1 Rußbergstraße Wien';
const controlPost = 'instagram:DgQIUvqNQm-';
const publicResponseKeys = ['query', 'answer', 'images', 'results', 'response_time', 'auto_parameters', 'usage', 'request_id', 'warning', 'warnings'];
const dayMs = 86_400_000;

export function instagramQueryMatrix(now) {
  const body = instagramTavilyComparisons(now)[0].body;
  return [
    ['current-production', body.query], ['previous-opening', previousOpeningQuery],
    ['gratis-kaffee', 'Wien gratis Kaffee'], ['doener-neueroeffnung', 'Wien Neueröffnung gratis Döner'],
    ['known-control-week', controlQuery], ['known-control-all-dates', controlQuery],
  ].map(([id, query]) => {
    const settings = { ...body, query };
    if (id === 'known-control-all-dates') delete settings.time_range;
    return { id, body: settings };
  });
}

function sanitizedHint(value, key) {
  if (typeof value !== 'string') return '';
  return value.replaceAll(key, '[redacted]')
    .replace(/<[^>\n]{1,300}>/g, ' ').replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\b(?:tvly|sk)-[\w-]{10,}\b/g, '[redacted]')
    .replace(/\s+/g, ' ').trim().slice(0, 600);
}

export async function compareInstagramQueries({ apiKey = '', freePlanConfirmed = false,
  previous = {}, cache = {}, knownKeys = new Set(), fetcher = fetch, clock = () => new Date(), sleep = wait,
} = {}) {
  const now = clock();
  const variants = instagramQueryMatrix(now);
  const report = { check: INSTAGRAM_QUERY_COMPARISON, checkedAt: now.toISOString(), status: 'not-started',
    searchDepth: 'basic', cacheMode: 'index-only', liveFetchAllowed: false,
    usageChecks: 0, attemptedQueries: 0, reportedSearchCredits: 0, indexRows: 0, comparisons: [],
    canonicalLinks: 0, previouslyKnownLinks: 0, unseenLinks: 0, links: [], nextRetryAt: '',
    instagramReads: 0, modelCalls: 0, publishedDeals: 0 };
  const empty = status => ({ report: { ...report, status }, leadHints: [] });
  const holds = [previous.nextRetryAt, cache?.nextRetryAt];
  if (cache?.version !== 1 || !Array.isArray(cache.links) || !Number.isFinite(Date.parse(cache.lastProbeAt))
      || typeof cache.nextRetryAt !== 'string' || holds.some(value => value && !Number.isFinite(Date.parse(value)))) {
    return empty('shared-index-state-invalid');
  }
  const deadline = Math.max(0, ...holds.map(value => Date.parse(value) || 0));
  if (deadline > +now) {
    report.nextRetryAt = new Date(deadline).toISOString();
    return empty('cooldown');
  }
  if (!freePlanConfirmed) return empty('free-plan-unconfirmed');
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!key) return empty('key-missing');
  const auth = { Authorization: 'Bearer ' + key };
  const usage = await requestTavilyJson('https://api.tavily.com/usage', { method: 'GET', headers: auth },
    { fetcher, clock, isValid: value => value && typeof value === 'object' && !Array.isArray(value) });
  report.usageChecks = 1;
  report.usageHttpStatus = usage.httpStatus;
  if (usage.status !== 'completed') {
    report.nextRetryAt = usage.nextRetryAt;
    return empty(usage.status);
  }
  const budget = getFreeSearchBudget(usage.payload, now, MAX_INSTAGRAM_COMPARISON_QUERIES);
  if (budget.refusal) {
    report.budgetRefusalReason = budget.refusal;
    return empty('free-plan-unverified');
  }
  report.budget = budget;
  const cap = Math.min(variants.length, budget.remainingCredits, budget.plannedQueries, MAX_INSTAGRAM_COMPARISON_QUERIES);
  if (!cap) return empty('free-credits-exhausted');

  const seen = new Set([controlPost, ...knownKeys, ...cache.links.map(link => canonicalInstagramPostKey(link?.url))]);
  const all = new Map();
  const finish = status => {
    const unseen = [...all.values()].filter(link => !link.known);
    return { report: { ...report, status, canonicalLinks: all.size, previouslyKnownLinks: all.size - unseen.length,
      unseenLinks: unseen.length, links: unseen.map(hit => hit.url) },
      leadHints: unseen.map(({ url, title, snippet }) => ({ url, title, snippet })) };
  };
  const headers = { ...auth, 'Content-Type': 'application/json' };
  for (const [position, { id, body }] of variants.slice(0, cap).entries()) {
    if (position) await sleep(1000);
    report.attemptedQueries++;
    const response = await requestTavilyJson('https://api.tavily.com/search', {
      method: 'POST', headers, body: JSON.stringify(body),
    }, { fetcher, clock, isValid: value => Array.isArray(value?.results) });
    const row = { id, query: body.query, dateWindow: body.time_range || 'none', status: response.status,
      httpStatus: response.httpStatus, indexRows: 0,
      reportedSearchCredits: null, canonicalLinks: 0, previouslyKnownLinks: 0, unseenLinks: 0, links: [] };
    report.comparisons.push(row);
    if (response.status !== 'completed') {
      report.nextRetryAt = response.nextRetryAt;
      return finish(response.status);
    }
    row.indexRows = response.payload.results.length;
    row.responseKeys = publicResponseKeys.filter(field => Object.hasOwn(response.payload, field));
    row.providerWarningPresent = Boolean(response.payload.warning || response.payload.warnings?.length);
    if (Number.isFinite(response.payload.response_time) && response.payload.response_time >= 0) {
      row.responseTimeSeconds = response.payload.response_time;
    }
    report.indexRows += row.indexRows;
    const credits = response.payload.usage?.credits;
    row.reportedSearchCredits = Number.isSafeInteger(credits) && credits >= 0 ? credits : null;
    report.reportedSearchCredits += row.reportedSearchCredits || 0;
    if (row.reportedSearchCredits !== 1) {
      row.status = 'unexpected-search-credit-cost';
      report.nextRetryAt = new Date(+clock() + dayMs).toISOString();
      return finish(row.status);
    }
    const hits = new Map();
    for (const candidate of response.payload.results.slice(0, 20)) {
      const url = normalizeInstagramTavilyUrl(candidate?.url);
      const post = canonicalInstagramPostKey(url);
      if (!post || hits.has(post)) continue;
      const known = seen.has(post);
      hits.set(post, { url, known });
      if (!all.has(post)) {
        const title = sanitizedHint(candidate.title, key).slice(0, 180);
        const snippet = sanitizedHint(candidate.content, key).slice(0, 600 - title.length);
        all.set(post, { url, known, title, snippet });
      }
    }
    row.links = [...hits.values()].map(hit => hit.url);
    row.canonicalLinks = hits.size;
    row.previouslyKnownLinks = [...hits.values()].filter(hit => hit.known).length;
    row.unseenLinks = row.canonicalLinks - row.previouslyKnownLinks;
    if (id.startsWith('known-control-')) row.expectedControlSeen = hits.has(controlPost);
  }
  return finish(cap === variants.length ? 'completed' : 'budget-limited');
}

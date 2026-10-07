import { graphCursor } from './instagram-graph-scan.js';

const HOUR = 3600000;

// A refreshed head must not overwrite an unfinished backfill. Meta does not
// promise chronological order, so every result page is eventually visited.
export async function scanAdLibraryCoverage({ terms, previous = {}, scope, now = new Date(),
  maxRequests = 190, maxPagesPerTerm = 190, headsOnly = false, fetchPage,
  onItem, seen = new Set(), deadline = Infinity, clock = Date.now, safeError = (error) => String(error.message),
}) {
  const state = { version: 1, scope, queries: {} };
  for (const term of terms) {
    const old = previous?.version === 1 && previous.scope === scope ? previous.queries?.[term] : null;
    state.queries[term] = {
      lastHeadAt: old?.lastHeadAt || '', lastCompletedAt: old?.lastCompletedAt || '',
      lastPageAt: old?.lastPageAt || '',
      resumeAfter: graphCursor(old?.resumeAfter), pagesSinceHead: Number(old?.pagesSinceHead || 0),
      emptyHead: old?.emptyHead === true,
    };
  }
  const raw = [], errors = [], usage = [], selectedTerms = new Set();
  const result = { raw, errors, usage, selectedTerms: [], state, requests: 0, fetched: 0,
    failure: null, budgetDeferred: false, stopReason: '', completedQueries: 0 };
  const visits = new Map();
  const heads = terms.filter((term) => {
    const query = state.queries[term];
    return now.getTime() - (Date.parse(query.lastHeadAt) || 0) >= (query.emptyHead ? 3 : 1) * HOUR;
  }).sort((a, b) => (Date.parse(state.queries[a].lastHeadAt) || 0) - (Date.parse(state.queries[b].lastHeadAt) || 0));
  const queue = heads.map((term) => ({ term, head: true }));
  const backfill = terms.filter((term) => state.queries[term].resumeAfter)
    .sort((a, b) => (Date.parse(state.queries[a].lastPageAt) || 0) - (Date.parse(state.queries[b].lastPageAt) || 0))
    .map((term) => ({ term, head: false }));
  // The seed reserves a small share for unfinished pages even if organic
  // discovery subsequently consumes all shared capacity. Fresh heads dominate.
  if (headsOnly) queue.splice(Math.min(queue.length, Math.max(1, Math.floor(maxRequests * 0.75))), 0,
    ...backfill.slice(0, Math.max(1, Math.floor(maxRequests / 4))));
  else queue.push(...backfill);
  const attempted = new Set();
  while (queue.length && result.requests < maxRequests) {
    if (clock() >= deadline) { result.stopReason = 'runtime-deadline'; break; }
    const { term, head } = queue.shift();
    const query = state.queries[term];
    const after = head ? '' : query.resumeAfter;
    if (!head && !after) continue;
    if ((visits.get(term) || 0) >= maxPagesPerTerm) continue;
    const key = `${term}:${after}`;
    if (attempted.has(key)) continue;
    attempted.add(key);
    selectedTerms.add(term);
    try {
      result.requests += 1;
      const response = await fetchPage(term, after);
      usage.push(response.usage);
      const rows = Array.isArray(response.payload?.data) ? response.payload.data : [];
      // Empty data is terminal, even when Meta still includes paging hints.
      const nextUrl = rows.length ? response.payload?.paging?.next : '';
      let cursor = '';
      if (nextUrl) {
        const parsed = new URL(nextUrl);
        if (parsed.origin !== 'https://graph.facebook.com' || !/^\/v\d+\.\d+\/ads_archive\/?$/.test(parsed.pathname)) {
          throw new Error('Untrusted Ad Library pagination URL');
        }
        cursor = graphCursor(parsed.searchParams.get('after') || response.payload?.paging?.cursors?.after);
        if (!cursor || cursor === after) throw new Error('Invalid or repeated Ad Library cursor');
      }
      visits.set(term, (visits.get(term) || 0) + 1);
      query.lastPageAt = now.toISOString();
      for (const item of rows) {
        const id = String(item?.id || '');
        if (id && seen.has(id)) continue;
        if (id) seen.add(id);
        const entry = { ...item, _searchTerm: term, _adLibraryActiveCheckedAt: now.toISOString() };
        result.fetched += 1;
        if (onItem) onItem(entry); else raw.push(entry);
      }
      if (head) {
        query.lastHeadAt = now.toISOString();
        query.emptyHead = rows.length === 0;
        if (!query.resumeAfter) { query.resumeAfter = cursor; query.pagesSinceHead = 1; }
      } else {
        query.resumeAfter = cursor;
        query.pagesSinceHead += 1;
      }
      if (!cursor && !query.resumeAfter) { query.lastCompletedAt = now.toISOString(); result.completedQueries += 1; }
      if (!headsOnly && query.resumeAfter) queue.push({ term, head: false });
    } catch (error) {
      const failure = { term, status: Number(error.status || 0), code: error.code || '', message: safeError(error) };
      errors.push(failure);
      if (error.code === 'SCAN_BUDGET' || [4, 17, 32, 613, 80002].includes(Number(error.code)) || error.status === 429) {
        result.budgetDeferred = true; result.stopReason = 'shared-quota'; break;
      }
      // An expired cursor affects one query, not the credentials of all queries.
      if (after && Number(error.code) === 100) {
        query.resumeAfter = ''; query.lastHeadAt = ''; query.pagesSinceHead = 0;
        continue;
      }
      result.failure = { ...failure, retryAt: new Date(now.getTime() + 6 * HOUR).toISOString() };
      result.stopReason = 'api-error'; break;
    }
  }
  result.selectedTerms = [...selectedTerms];
  result.pendingPages = Object.values(state.queries).filter((query) => query.resumeAfter).length;
  result.dueQueries = heads.filter((term) => state.queries[term].lastHeadAt !== now.toISOString()).length;
  result.stopReason ||= queue.length ? 'request-budget' : headsOnly ? 'seed-complete' : 'relevant-queries-complete';
  return result;
}

export function hasFreshActiveAdEvidence(deal, now = new Date()) {
  const evidence = deal?.evidence;
  const checkedAt = Date.parse(evidence?.activeAdCheckedAt || '');
  const deliveryStart = Date.parse(deal?.pubDate || '');
  if (deal?.originSource !== 'Meta Ad Library API' || evidence?.activeAdStatus !== 'ACTIVE'
    || !/^\d+$/.test(String(evidence.metaAdId || '')) || deal.id !== `meta-ad-${evidence.metaAdId}`
    || !/^(?:deal\.)?meta-ad-delivery-start$/.test(deal.pubDateSource || '') || !Number.isFinite(deliveryStart)
    || deliveryStart > now.getTime() + 600000 || now.getTime() - deliveryStart > 365 * 24 * HOUR
    || !Number.isFinite(checkedAt) || checkedAt > now.getTime() + 60000 || now.getTime() - checkedAt > 24 * HOUR) return false;
  try {
    const url = new URL(deal.url);
    return url.origin === 'https://www.facebook.com' && url.pathname === '/ads/library/'
      && url.searchParams.get('id') === String(evidence.metaAdId)
      && evidence.platforms?.some((platform) => ['instagram', 'facebook'].includes(String(platform).toLowerCase()));
  } catch { return false; }
}

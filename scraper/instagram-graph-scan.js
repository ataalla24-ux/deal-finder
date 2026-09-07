import fs from 'node:fs';
import path from 'node:path';

const HOUR = 3600000;
const DAY = 24 * HOUR;
export const boundedInteger = (value, fallback, min, max) => Number.isFinite(Number(value)) && value !== '' && value != null
  ? Math.min(max, Math.max(min, Math.floor(Number(value)))) : fallback;

// Cursors are data, never URLs or arbitrary field-expansion expressions.
export function graphCursor(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_\-=+/]{1,2048}$/.test(value) ? value : '';
}

function usagePercent(headers) {
  let highest = 0;
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (['call_count', 'total_cputime', 'total_time'].includes(key) && Number.isFinite(Number(item))) highest = Math.max(highest, Number(item));
      else if (typeof item === 'object') visit(item);
    }
  };
  for (const header of ['x-app-usage', 'x-business-use-case-usage']) {
    try { visit(JSON.parse(headers?.get?.(header) || '{}')); } catch { /* optional headers */ }
  }
  return highest;
}

export function createGraphRequestBudget(fetchImpl, { maxRequests = 120, usageThreshold = 85 } = {}) {
  const stats = { requests: 0, maxRequests: boundedInteger(maxRequests, 120, 1, 300), highestUsagePercent: 0, stopped: false, reason: '' };
  return {
    stats,
    fetch: async (...args) => {
      if (stats.stopped || stats.requests >= stats.maxRequests) {
        stats.stopped = true;
        stats.reason ||= 'request-budget';
        const error = new Error(`Instagram scan paused: ${stats.reason}`);
        error.code = 'SCAN_BUDGET';
        throw error;
      }
      stats.requests += 1;
      const response = await fetchImpl(...args);
      stats.highestUsagePercent = Math.max(stats.highestUsagePercent, usagePercent(response.headers));
      if (stats.highestUsagePercent >= boundedInteger(usageThreshold, 85, 20, 95) || response.status === 429) {
        stats.stopped = true;
        stats.reason = response.status === 429 ? 'rate-limit' : 'api-usage';
      }
      return response;
    },
  };
}

/** Always read the head. Resume bounded backfill separately so busy feeds cannot
 * starve older unseen pages. Two wholly known pages allow an incremental stop;
 * a periodic sweep ignores this heuristic because Meta does not promise order. */
export async function scanGraphPages({ fetchPage, previous = {}, now = new Date(), maxPages = 3, refreshHours = 6 }) {
  const limit = boundedInteger(maxPages, 3, 1, 3);
  const previousIds = new Set(Array.isArray(previous.seenIds) ? previous.seenIds : []);
  const sweepAt = Date.parse(previous.lastSweepAt || '');
  const fullSweep = !Number.isFinite(sweepAt) || now.getTime() - sweepAt >= refreshHours * HOUR;
  const resume = graphCursor(previous.resumeAfter);
  const rows = new Map();
  const cursors = new Set();
  let after = '';
  let knownPages = 0;
  let oldPages = 0;
  let pages = 0;
  let stopReason = 'page-limit';
  let nextCursor = '';
  let incomplete = false;
  let lastResponse = {};
  let pageError = null;
  while (pages < limit) {
    let response;
    try { response = await fetchPage(after); } catch (error) {
      if (pages === 0) throw error;
      pageError = error;
      incomplete = true;
      const rejectedCursor = after && [24, 100].includes(Number(error?.code));
      nextCursor = rejectedCursor ? '' : after;
      stopReason = rejectedCursor ? 'cursor-rejected' : error?.code === 'SCAN_BUDGET' ? 'request-budget' : 'page-error';
      break;
    }
    lastResponse = response;
    pages += 1;
    const data = Array.isArray(response.data) ? response.data : [];
    let allKnown = data.length > 0;
    for (const row of data) {
      const id = String(row?.id || row?.permalink || '');
      if (!id || !previousIds.has(id)) allKnown = false;
      if (id) rows.set(id, row);
    }
    knownPages = allKnown ? knownPages + 1 : 0;
    oldPages = data.length > 0 && data.every((row) => Number.isFinite(Date.parse(row.timestamp)) && Date.parse(row.timestamp) < now.getTime() - 7 * DAY)
      ? oldPages + 1 : 0;
    const paging = response.paging || {};
    // Only continue when Meta advertises a next page. Never follow its URL.
    nextCursor = paging.next ? graphCursor(paging.cursors?.after) : '';
    if (paging.next && !nextCursor) {
      incomplete = true;
      stopReason = 'invalid-cursor';
      break;
    }
    if (!nextCursor) { stopReason = 'exhausted'; break; }
    if (oldPages >= 2) { stopReason = 'age-window'; break; }
    if (!fullSweep && !resume && knownPages >= 2) { stopReason = 'known-pages'; break; }
    if (pages === 1 && resume && limit > 1) nextCursor = resume;
    if (cursors.has(nextCursor) || nextCursor === after) {
      incomplete = true;
      stopReason = 'cursor-loop';
      nextCursor = '';
      break;
    }
    cursors.add(nextCursor);
    after = nextCursor;
  }
  const needsContinuation = incomplete || stopReason === 'page-limit';
  const values = [...rows.values()];
  const seenIds = [...new Set([...previousIds, ...rows.keys()])].slice(-1000);
  return {
    rows: values,
    lastResponse,
    pageError,
    report: { pages, uniquePosts: values.length, newPosts: values.filter((row) => !previousIds.has(String(row.id || row.permalink))).length, stopReason, incomplete: needsContinuation, resumed: Boolean(resume && pages > 1) },
    checkpoint: {
      seenIds,
      lastAttemptAt: now.toISOString(),
      lastSuccessfulAt: needsContinuation ? (previous.lastSuccessfulAt || '') : now.toISOString(),
      lastSweepAt: !needsContinuation && ['exhausted', 'age-window'].includes(stopReason) ? now.toISOString() : (previous.lastSweepAt || ''),
      resumeAfter: needsContinuation ? nextCursor : '',
    },
  };
}

function readState(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

// Each collector owns a different file. Both can read the other's snapshots,
// avoiding a shared-file lost-update race in concurrent GitHub jobs.
export function createGraphScanStore({ ownPath, peerPath, scope, now = new Date(), write = true, state }) {
  const own = state || (write ? readState(ownPath) : {});
  const peer = write ? readState(peerPath) : {};
  const sources = own.scope === scope ? { ...own.sources } : {};
  const peerSources = peer.scope === scope ? (peer.sources || {}) : {};
  return {
    get(key) {
      const candidates = [sources[key], peerSources[key]].filter((item) => item && now.getTime() - Date.parse(item.updatedAt) <= 7 * DAY);
      return candidates.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] || {};
    },
    put(key, value) { sources[key] = { ...value, updatedAt: now.toISOString() }; },
    save() {
      const payload = { version: 1, scope, updatedAt: now.toISOString(), sources: Object.fromEntries(Object.entries(sources).filter(([, item]) => now.getTime() - Date.parse(item.updatedAt) <= 7 * DAY).slice(-300)) };
      if (write) {
        fs.mkdirSync(path.dirname(ownPath), { recursive: true });
        const tmp = `${ownPath}.tmp-${process.pid}`;
        fs.writeFileSync(tmp, `${JSON.stringify(payload)}\n`);
        fs.renameSync(tmp, ownPath);
      }
      return payload;
    },
  };
}

export async function scanGraphSource({ key, store, now, cacheMinutes = 30, ...options }) {
  const previous = store.get(key);
  const age = now.getTime() - Date.parse(previous.updatedAt);
  // Replay complete raw results for independent normalization, never just skip
  // a source (which would remove its candidates from the rebuilt output).
  if (!previous.report?.incomplete && Array.isArray(previous.rows) && age >= 0 && age < cacheMinutes * 60000) {
    return { rows: previous.rows, report: { ...previous.report, pages: 0, cacheHit: true }, lastResponse: previous.metadata || {} };
  }
  const result = await scanGraphPages({ ...options, previous: previous.checkpoint, now });
  // Child paging URLs can contain Graph credentials. Persist media fields only.
  const cleanMedia = (row) => {
    const clean = Object.fromEntries(['id', 'caption', 'timestamp', 'username', 'name', 'media_type', 'media_product_type', 'permalink', 'media_url', 'thumbnail_url', 'like_count', 'comments_count']
      .filter((field) => row[field] !== undefined).map((field) => [field, row[field]]));
    if (Array.isArray(row.children?.data)) clean.children = { data: row.children.data.map(cleanMedia) };
    return clean;
  };
  store.put(key, { rows: result.rows.map(cleanMedia), checkpoint: result.checkpoint, report: result.report, metadata: { fieldMode: result.lastResponse.fieldMode, appliedLimit: result.lastResponse.appliedLimit } });
  return result;
}

import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ApifyDiscoveryClient, DISCOVERY_ACTOR, HASHTAG_ACTOR, budgetCheck } from './apify-discovery-client.js';
import {
  DAY, LIMITS, discoverySources, selectDiscoverySources, reservationReason,
  postIdentity, postFingerprint, earlyPostRejection, classifyDiscoveryPost, mergeDiscoveryPending,
} from './apify-food-discovery-policy.js';
import { analyzeInstagramMediaItem, detectMediaTools, entryMediaPriority } from './instagram-media-evidence.js';
import { buildPipelineRunReport, writePipelineRunReport } from './pipeline-run-report-utils.js';

export const ACTOR_BUILD = '0.0.830';
export const HASHTAG_BUILD = '0.0.707';
const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'TIMED-OUT', 'ABORTED']);
const FILES = {
  state: 'docs/apify-discovery-state.json', report: 'docs/apify-discovery-report.json',
  pending: 'docs/deals-pending-instagram-apify2.json', plan: 'output/apify-discovery-plan.json',
};
const AGGREGATE_PENDING = new Set(['deals-pending-all.json', 'deals-pending-merged.json',
  'deals-pending-firecrawl.json', 'deals-pending-instagram-verified.json']);

async function read(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw new Error(`invalid-state-file:${path.basename(file)}`); }
}
async function write(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(`${file}.tmp`, file);
}

export function actorInput(sources, now = new Date()) {
  if (sources.every(s => s.kind === 'hashtag')) return {
    hashtags: sources.map(s => s.key.split(':')[1]), resultsType: 'posts',
    resultsLimit: LIMITS.perSource, keywordSearch: false,
  };
  return {
    directUrls: sources.map(s => s.url), resultsType: 'posts', resultsLimit: LIMITS.perSource,
    onlyPostsNewerThan: new Date(+now - 7 * DAY).toISOString(), addParentData: false,
  };
}

export function pipelineHealthReport(report) {
  return buildPipelineRunReport({
    sourceKey: 'instagram-apify2', sourceLabel: 'Apify 2 Vienna Food Discovery',
    startedAt: report.generatedAt, finishedAt: new Date(), outputFile: FILES.pending,
    status: report.status === 'succeeded' ? 'completed' : report.status === 'partial' ? 'completed-with-errors' : 'failed',
    rawCandidates: report.fetchedRecords || 0, normalizedCandidates: report.candidateAudit?.length || 0,
    acceptedDeals: report.freshAcceptedDeals || 0,
    rejected: (report.candidateAudit || []).filter(row => row.status === 'rejected'),
    diagnostics: { pendingDeals: report.pendingDeals || 0, unchangedPosts: report.unchangedPosts || 0,
      providerErrors: report.providerErrors || 0, ocrCalls: report.ocrCalls || 0, sources: report.sources || [] },
    constraints: LIMITS, errors: [report.error, ...(report.batchErrors || []).map(e => e.reason)].filter(Boolean),
  });
}

export async function runBoundedActor(client, sources, {
  now = () => new Date(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), onStarted = async () => {},
} = {}) {
  if (!sources.length || sources.some(s => s.kind !== sources[0].kind)) throw new Error('invalid-mixed-source-batch');
  const hashtag = sources[0].kind === 'hashtag';
  const actorId = hashtag ? HASHTAG_ACTOR : DISCOVERY_ACTOR;
  const build = hashtag ? HASHTAG_BUILD : ACTOR_BUILD;
  const cap = hashtag ? 0.01 : 0.03;
  const maxItems = hashtag ? 2 : 8;
  const start = +now();
  // One POST only. Provider timeout also bounds abandoned/cancelled GitHub jobs.
  let run = await client.request(`/acts/${actorId}/runs?build=${build}&timeout=600&memory=512&maxItems=${maxItems}&maxTotalChargeUsd=${cap}`, {
    method: 'POST', body: actorInput(sources, now()),
  });
  if (!/^[A-Za-z0-9]+$/.test(run?.id || '')) throw Object.assign(new Error('missing-run-id'), { uncertainStart: true });
  await onStarted(run.id);
  while (!TERMINAL.has(run.status)) {
    if (+now() - start >= 660_000) {
      try { await client.request(`/actor-runs/${run.id}/abort`, { method: 'POST' }); } catch { /* Server timeout remains in force. */ }
      throw new Error('actor-poll-deadline');
    }
    await sleep(15_000);
    run = await client.request(`/actor-runs/${run.id}`);
  }
  if (run.status !== 'SUCCEEDED') throw new Error(`actor-${run.status.toLowerCase()}`);
  if (!/^[A-Za-z0-9]+$/.test(run.defaultDatasetId || '')) throw new Error('missing-dataset-id');
  const items = await client.request(`/datasets/${run.defaultDatasetId}/items?clean=true&format=json&limit=${maxItems}`);
  if (!Array.isArray(items)) throw new Error('invalid-dataset');
  return { runId: run.id, actorId, status: run.status, items: items.slice(0, maxItems),
    reportedChargeUsd: Number.isFinite(run.usageTotalUsd) ? run.usageTotalUsd : null };
}

export async function collectDiscoveryBatches(client, sources, options = {}) {
  const items = [], runs = [], errors = [], failedSources = new Set();
  let retryAt = '';
  for (const kind of ['profile', 'hashtag']) {
    const selected = sources.filter(s => s.kind === kind);
    if (!selected.length) continue;
    try {
      const check = budgetCheck(await client.preflight(kind === 'profile' ? DISCOVERY_ACTOR : HASHTAG_ACTOR),
        options.now?.() || new Date(), kind === 'profile' ? .03 : .01);
      if (!check.allowed) throw new Error(`apify-budget-${check.reason}`);
      const run = await runBoundedActor(client, selected, options);
      items.push(...run.items);
      runs.push({ id: run.runId, actorId: run.actorId, reportedChargeUsd: run.reportedChargeUsd });
    } catch (error) {
      selected.forEach(s => failedSources.add(s.key));
      errors.push({ kind, reason: /^apify-|^actor-|^missing-|^invalid-/.test(error.message) ? error.message : 'collector-processing-failed' });
      if (error.uncertainStart || [401, 403, 429].includes(error.httpStatus)) {
        retryAt = new Date(Math.max(+(options.now?.() || new Date()) + DAY, Date.parse(error.retryAt) || 0)).toISOString();
        break;
      }
    }
  }
  return { items, runs, errors, failedSources, retryAt };
}

export function safeMediaUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && /(?:^|\.)(?:cdninstagram\.com|fbcdn\.net)$/.test(url.hostname) ? url.href : '';
  } catch { return ''; }
}

export function restrictedMediaFetch(fetchImpl = fetch) {
  return async (url, options) => {
    if (!safeMediaUrl(url)) throw new Error('untrusted-media-host');
    let response;
    try { response = await fetchImpl(url, { ...options, redirect: 'manual' }); }
    catch { throw new Error('media-unavailable'); }
    // No alternate headers, proxies, hosts or retries after access/rate-limit errors.
    if (!response.ok || !/^image\/(?:png|jpeg|webp|gif|avif)(?:;|$)/i.test(response.headers.get('content-type') || '')) {
      await response.body?.cancel();
      throw new Error(`media-refused-${response.status}`);
    }
    return response;
  };
}

export async function localOcr(raw, tools) {
  const urls = [raw.displayUrl, ...(raw.childPosts || []).map(child => child.displayUrl)].map(safeMediaUrl).filter(Boolean);
  if (!urls.length) return { ocrText: '', errors: ['no-safe-image'] };
  return analyzeInstagramMediaItem({
    permalink: raw.url, media_type: 'IMAGE', media_url: urls[0],
  }, {
    mediaOcrEnabled: true, mediaVisionEnabled: false, mediaMaxAssetsPerPost: 1,
    mediaDownloadTimeoutMs: 10_000, mediaMaxBytes: 5 * 1024 * 1024,
    ocrTimeoutMs: 15_000, mediaTesseractTimeoutMs: 15_000, mediaOcrMaxTextChars: 4000,
  }, { tools, fetchImpl: restrictedMediaFetch() });
}

export async function processDiscoveryItems(items, {
  now = new Date(), state = {}, registry = {}, previous = [], knownPostKeys = new Set(), ocr = async () => ({ ocrText: '', errors: ['ocr-unavailable'] }),
} = {}) {
  const seen = Object.fromEntries(Object.entries(state.seen || {}).filter(([, v]) => Date.parse(v.at) >= +now - 14 * DAY));
  const fresh = [], rejected = [], audit = [];
  const batch = new Set();
  let ocrCalls = 0, unchanged = 0, duplicates = 0, providerErrors = 0;
  // Spend the same four OCR slots on likely offers first, not provider arrival order.
  const ordered = items.slice(0, LIMITS.posts).map((raw, index) => {
    const account = (registry.accounts || []).find(a => String(a.username).toLowerCase() === String(raw?.ownerUsername || '').toLowerCase());
    return { raw, index, priority: entryMediaPriority({ item: raw,
      context: { account: { ...account, verifiedVienna: account?.viennaVerified === true } } }, now) };
  }).sort((a, b) => b.priority - a.priority || a.index - b.index);
  for (const { raw } of ordered) {
    if (!raw || typeof raw !== 'object' || raw.error || raw.errorDescription) { providerErrors++; continue; }
    const key = postIdentity(raw);
    const fingerprint = postFingerprint(raw);
    if (key && (batch.has(key) || knownPostKeys.has(key))) { duplicates++; continue; }
    if (key) batch.add(key);
    const early = earlyPostRejection(raw, now, registry);
    if (!early && seen[key]?.hash === fingerprint && !seen[key]?.ocrIncomplete) { unchanged++; continue; }
    let media = { ocrText: '', errors: [] }, deferredOcr = false;
    if (!early && safeMediaUrl(raw.displayUrl || raw.childPosts?.[0]?.displayUrl)) {
      if (ocrCalls < LIMITS.ocrPosts) {
        ocrCalls++;
        try { media = await ocr(raw); } catch { media = { ocrText: '', errors: ['ocr-failed'] }; }
      } else deferredOcr = true;
    }
    const result = early ? { deal: null, rejectReason: early } : classifyDiscoveryPost(raw, { now, registry, ocrText: media.ocrText });
    if (key) seen[key] = { hash: fingerprint, at: now.toISOString(), ocrIncomplete: deferredOcr || Boolean(media.errors?.length) };
    if (result.deal) fresh.push(result.deal);
    else if (key) rejected.push(key);
    audit.push({ key, url: key ? raw.url || raw.postUrl : '', ownerUsername: String(raw.ownerUsername || '').slice(0, 30),
      status: result.deal ? 'accepted' : 'rejected', reason: result.rejectReason,
      ocrUsed: Boolean(media.ocrText), ocrDeferred: deferredOcr, ocrErrors: media.errors?.length || 0 });
  }
  const deals = mergeDiscoveryPending(previous.filter(d => !knownPostKeys.has(postIdentity(d))), fresh, rejected, now);
  return { deals, seen: Object.fromEntries(Object.entries(seen).sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, 1000)),
    report: { fetchedRecords: items.length, freshAcceptedDeals: fresh.length, pendingDeals: deals.length,
      unchangedPosts: unchanged, duplicatePosts: duplicates, providerErrors, ocrCalls, candidateAudit: audit } };
}

export async function main(mode = '--plan') {
  const now = new Date();
  const state = await read(FILES.state, { version: 1, reservations: [], sources: {}, seen: {} });
  if (state.version !== 1 || !Array.isArray(state.reservations) || !state.sources || !state.seen) throw new Error('invalid-ledger');
  const registry = await read('docs/instagram-merchant-registry.json', {});
  const pool = discoverySources(await read('docs/instagram-watchlist.json', {}), registry);
  if (mode === '--plan') {
    console.log(JSON.stringify({ sources: pool.length, selected: selectDiscoverySources(pool, state, now), limits: LIMITS }, null, 2));
    return;
  }
  if (!['--reserve', '--run'].includes(mode)) throw new Error('invalid-mode');
  if (!/^\d+$/.test(process.env.GITHUB_RUN_ID || '')) throw new Error('requires-audited-github-workflow');
  const purpose = process.env.APIFY_DISCOVERY_PURPOSE || 'scan';
  if (!['scan', 'hashtag-test'].includes(purpose)) throw new Error('invalid-purpose');
  const validation = purpose === 'hashtag-test';
  if (validation && process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch') throw new Error('validation-requires-manual-dispatch');
  const runKey = process.env.GITHUB_RUN_ID;
  const client = new ApifyDiscoveryClient(process.env.APIFY_2);
  const budget = budgetCheck(await client.preflight(validation ? HASHTAG_ACTOR : DISCOVERY_ACTOR), now, validation ? .01 : .04);
  if (mode === '--reserve') {
    const sources = validation
      ? pool.filter(s => s.key === 'hashtag:wienfood' && !(Date.parse(state.sources[s.key]?.retryAt) > +now))
      : selectDiscoverySources(pool, state, now);
    const reason = reservationReason(state, budget, runKey, now, purpose) || (!sources.length ? 'no-available-sources' : '');
    const plan = { allowed: !reason, reason, generatedAt: now.toISOString(), runKey, purpose, sources, budget, limits: LIMITS };
    if (!reason) {
      state.reservations = state.reservations.filter(r => Date.parse(r.at) >= +now - 40 * DAY);
      state.reservations.push({ key: runKey, at: now.toISOString(), capUsd: budget.runCapUsd, purpose, status: 'reserved' });
      // Permanent marker: pruning the monetary ledger must never reopen this one-shot test.
      if (validation) state.hashtagValidationReservedAt = now.toISOString();
      await write(FILES.state, state);
    }
    await write(FILES.plan, plan);
    if (reason) await write(FILES.report, { ...plan, status: 'deferred', freshAcceptedDeals: 0 });
    if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, `allowed=${!reason}\n`);
    console.log(JSON.stringify({ allowed: !reason, reason, sourceCount: sources.length, budget }));
    return;
  }
  const plan = await read(FILES.plan, null);
  const reservation = state.reservations.find(r => r.key === runKey);
  if (!budget.allowed || !plan?.allowed || plan.runKey !== runKey || plan.purpose !== purpose
      || reservation?.status !== 'reserved' || reservation.purpose !== purpose || reservation.capUsd !== budget.runCapUsd
      || (validation && (plan.sources.length !== 1 || plan.sources[0].key !== 'hashtag:wienfood'))
      || +now - Date.parse(reservation.at) > 30 * 60_000) throw new Error('missing-or-invalid-committed-reservation');
  const previous = (await read(FILES.pending, { deals: [] })).deals;
  const report = { generatedAt: now.toISOString(), purpose, limits: LIMITS, budget, selectedSources: plan.sources, status: 'starting' };
  reservation.status = 'attempted';
  for (const source of plan.sources) state.sources[source.key] = { ...state.sources[source.key], lastAttemptAt: now.toISOString() };
  await write(FILES.state, state);
  try {
    const result = await collectDiscoveryBatches(client, plan.sources, { onStarted: async id => {
      reservation.runId = id;
      reservation.startedRuns = [...(reservation.startedRuns || []), id];
      await write(FILES.state, state);
    } });
    const known = new Set();
    for (const file of await fs.readdir('docs')) {
      if ((file === 'deals.json' || /^deals-pending-.*\.json$/.test(file))
          && file !== path.basename(FILES.pending) && !AGGREGATE_PENDING.has(file)) {
        const payload = await read(`docs/${file}`, { deals: [] });
        for (const deal of Array.isArray(payload) ? payload : payload.deals || []) { const key = postIdentity(deal); if (key) known.add(key); }
      }
    }
    const tools = await detectMediaTools();
    const processed = await processDiscoveryItems(result.items, { now: new Date(), state, registry, previous,
      knownPostKeys: known, ocr: raw => localOcr(raw, tools) });
    state.seen = processed.seen;
    state.retryAt = result.retryAt;
    reservation.status = result.errors.length && !result.runs.length ? 'failed'
      : processed.report.providerErrors || result.errors.length ? 'partial' : 'succeeded';
    for (const source of plan.sources) {
      const rows = result.items.filter(raw => String(raw.inputUrl || '').replace(/\/$/, '') === source.url.replace(/\/$/, '')
        || (source.kind === 'profile' && raw.ownerUsername?.toLowerCase() === source.username));
      const failures = rows.filter(row => row.error || row.errorDescription);
      const entry = state.sources[source.key];
      entry.postsReturned = rows.filter(row => postIdentity(row) && !row.error && !row.errorDescription).length;
      entry.status = failures.length || result.failedSources.has(source.key) ? 'failed'
        : entry.postsReturned ? 'posts-returned' : 'no-attributed-results';
      if (entry.status === 'failed') {
        entry.consecutiveFailures = (entry.consecutiveFailures || 0) + 1;
        entry.retryAt = new Date(+now + Math.min(7, 2 ** (entry.consecutiveFailures - 1)) * DAY).toISOString();
      } else if (rows.length) { entry.consecutiveFailures = 0; entry.retryAt = ''; }
    }
    Object.assign(report, processed.report, { status: reservation.status, actorRuns: result.runs, batchErrors: result.errors,
      reportedChargeUsd: result.runs.reduce((sum, run) => sum + (run.reportedChargeUsd || 0), 0),
      tools, sources: plan.sources.map(s => ({ key: s.key, ...state.sources[s.key] })) });
    if (reservation.status === 'failed') process.exitCode = 1;
    await write(FILES.pending, { source: 'Apify 2 Vienna Food Discovery', lastUpdated: new Date().toISOString(), deals: processed.deals });
  } catch (error) {
    reservation.status = error.uncertainStart ? 'uncertain-start' : 'failed';
    state.retryAt = new Date(Math.max(+now + DAY, Date.parse(error.retryAt) || 0)).toISOString();
    report.status = reservation.status;
    report.error = /^apify-|^actor-|^missing-|^invalid-/.test(error.message) ? error.message : 'collector-processing-failed';
    report.retryAt = state.retryAt;
    report.freshAcceptedDeals = 0;
    process.exitCode = 1;
  } finally {
    await write(FILES.state, state);
    await write(FILES.report, report);
    writePipelineRunReport(pipelineHealthReport(report));
    console.log(JSON.stringify(report, null, 2));
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
}

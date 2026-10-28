import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FEED_URL = 'https://freefinder.at/deals.json';
const MAX_BYTES = 4 * 1024 * 1024;
const REPORTS = [
  ['Apify 2', 'apify-discovery-report.json', 36],
  ['Food providers', 'food-provider-report.json', 36],
  ['Meta', 'meta-instagram-report.json', 12],
  ['Power', 'power-scraper-report.json', 36],
  ['Pipeline overview', 'deal-source-health.json', 36],
];
const count = value => Number.isInteger(value) && value >= 0 ? value : null;
const amount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const code = value => /^[a-z0-9_-]{1,80}$/i.test(String(value || '')) ? String(value) : 'unspecified';
const codes = values => [...new Set(values.filter(Boolean).map(code))].slice(0, 20);

export function inspectFeed(body) {
  const deals = body?.deals;
  if (!Array.isArray(deals) || deals.length === 0 || body.totalDeals !== deals.length)
    return { status: 'error', reason: 'empty-or-invalid-feed' };
  const ids = new Set();
  for (const deal of deals) {
    if (typeof deal?.id !== 'string' || !deal.id.trim() || ids.has(deal.id)
        || typeof deal.title !== 'string' || !deal.title.trim())
      return { status: 'error', reason: 'invalid-or-duplicate-deal' };
    ids.add(deal.id);
  }
  return { status: 'ok', dealCount: deals.length };
}

export async function probeLiveFeed(fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let reader;
  try {
    const response = await fetchImpl(FEED_URL, { signal: controller.signal, redirect: 'error' });
    if (response.status !== 200) return { status: 'error', reason: 'feed-http-error', httpStatus: response.status };
    reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) return { status: 'error', reason: 'feed-too-large' };
      chunks.push(value);
    }
    return { ...inspectFeed(JSON.parse(Buffer.concat(chunks).toString('utf8'))), bytes };
  } catch {
    return { status: 'error', reason: 'feed-unreachable-or-invalid-json' };
  } finally {
    clearTimeout(timer);
    if (reader) await reader.cancel().catch(() => {});
  }
}

function summarize(name, raw) {
  const row = { name, state: raw.status || 'unknown', counts: {}, holds: [], issues: [] };
  if (name === 'Apify 2') {
    row.counts = { returnedRecords: count(raw.fetchedRecords), newCandidates: count(raw.freshAcceptedDeals),
      sourceErrors: count(raw.providerErrors), emptySourceRecords: count(raw.emptySourceRecords) };
    if (raw.budget?.allowed === false) row.holds.push(raw.budget.reason || 'budget-denied');
    row.budget = {
      kind: 'report-snapshot-not-live-balance',
      reportedUsageUsd: amount(raw.budget?.accountUsageUsd),
      configuredRunCapUsd: amount(raw.budget?.runCapUsd),
    };
    if (raw.providerErrors > 0 || raw.batchErrors?.length) row.issues.push('source-or-batch-errors');
  } else if (name === 'Food providers') {
    row.counts = { checkedPages: Array.isArray(raw.results) ? raw.results.length : null,
      newCandidates: count(raw.newPendingCandidates), knownCandidates: count(raw.alreadyKnown) };
    row.holds = (raw.skipped || []).map(item => item.reason);
    for (const result of raw.results || []) {
      if (result.status === 'failed') row.issues.push('provider-or-source-error');
      if (['budget-stopped', 'source-paused', 'runtime-stopped'].includes(result.status))
        row.holds.push(result.reason || result.status);
    }
    row.budget = { kind: 'report-snapshot-not-live-balance', providers: {} };
    for (const provider of ['scraperapi', 'scrapingbee']) {
      const usage = raw.usage?.[provider];
      row.budget.providers[provider] = { used: count(usage?.used), maximum: count(usage?.maximum) };
    }
    row.budget.providers.zyte = { liveBalanceAvailable: false };
  } else if (name === 'Meta') {
    row.counts = { newCandidates: count(raw.newDeals), retainedCandidates: count(raw.totalDeals) };
    for (const source of Object.values(raw.sources || {})) {
      if (source.coverage?.stopReason) row.holds.push(source.coverage.stopReason);
      if (source.sharedQuota?.deferredReason) row.holds.push(source.sharedQuota.deferredReason);
      if (source.errors?.length) row.issues.push('source-errors');
    }
    if (raw.mediaClassificationBudget?.limitReason) row.holds.push(raw.mediaClassificationBudget.limitReason);
    row.budget = { kind: 'reported-ai-call-count-not-dollar-credit',
      remainingCalls: count(raw.mediaClassificationBudget?.remaining) };
  } else if (name === 'Power') {
    row.state = raw.summary ? (raw.summary.failedSources > 0 ? 'partial' : 'completed') : 'unknown';
    row.counts = { candidates: count(raw.summary?.acceptedDeals), failedSources: count(raw.summary?.failedSources),
      deferredSources: count(raw.summary?.deferredSources) };
    if (raw.summary?.failedSources > 0) row.issues.push('source-errors');
    if (raw.summary?.deferredSources > 0) row.holds.push('deferred-sources');
  } else {
    const runs = raw.summary?.pipelineRuns;
    row.state = runs ? 'completed' : 'unknown';
    row.counts = { reportedSources: count(runs?.reportedSources), failedSources: runs?.failedSources?.length ?? null,
      sourcesWithErrors: runs?.completedWithErrors?.length ?? null };
    if (runs?.failedSources?.length) row.issues.push('failed-pipelines');
    if (runs?.completedWithErrors?.length) row.issues.push('pipelines-with-errors');
  }
  if (['failed', 'error', 'partial', 'degraded'].includes(row.state)) row.issues.push('degraded-or-failed-run');
  if (['skipped', 'deferred', 'quota-deferred', 'budget-stopped'].includes(row.state)) row.holds.push(row.state);
  if (!['ok', 'completed', ...(name === 'Apify 2' ? ['succeeded'] : []), 'legitimate-zero', 'healthy-no-verified-deals', 'failed', 'error', 'partial',
    'degraded', 'skipped', 'deferred', 'quota-deferred', 'budget-stopped'].includes(row.state)) row.issues.push('unknown-run-state');
  row.state = code(row.state);
  row.holds = codes(row.holds);
  row.issues = codes(row.issues);
  return row;
}

export function buildReadinessReport({ docsDir = path.join(ROOT, 'docs'), now = new Date(), feed }) {
  const sources = REPORTS.map(([name, file, maxAgeHours]) => {
    let raw;
    try { raw = JSON.parse(fs.readFileSync(path.join(docsDir, file), 'utf8')); }
    catch { return { name, file, status: 'warning', issues: ['missing-or-invalid-report'], holds: [], counts: {} }; }
    try {
      const row = summarize(name, raw);
      const timestamp = raw.generatedAt || raw.finishedAt || raw.createdAt;
      const at = Date.parse(timestamp);
      row.observedAt = Number.isFinite(at) ? new Date(at).toISOString() : null;
      row.maxAgeHours = maxAgeHours;
      row.ageHours = Number.isFinite(at) ? Math.round((+now - at) / 36000) / 100 : null;
      if (!Number.isFinite(at) || at > +now + 300_000 || +now - at > maxAgeHours * 3_600_000)
        row.issues.push('stale-or-invalid-timestamp');
      row.status = row.issues.length || row.holds.length ? 'warning' : 'ok';
      row.zeroNewCandidates = row.counts.newCandidates === 0;
      return { ...row, file };
    } catch {
      return { name, file, status: 'warning', issues: ['invalid-report-shape'], holds: [], counts: {} };
    }
  });
  return { schemaVersion: 1, checkedAt: now.toISOString(), feed,
    status: feed.status !== 'ok' ? 'error' : sources.some(row => row.status !== 'ok') ? 'warning' : 'ok', sources,
    limits: 'Read-only snapshots, not live balances, Slack delivery proof, merchant verification or a native device test. Zero new candidates alone is not a failure. No provider or AI calls, sends or budget changes.' };
}

export function renderSummary(report) {
  const lines = ['## Launch readiness (read-only)', '', `Overall: **${report.status}**`,
    `Public feed: **${report.feed.status}** (${report.feed.dealCount ?? 'unknown'} deals${report.feed.reason ? `; ${report.feed.reason}` : ''})`, '',
    '| Source | Status | Snapshot (UTC) | Counts | Issues / deliberate stops |', '| --- | --- | --- | --- | --- |'];
  for (const row of report.sources) {
    const counts = Object.entries(row.counts).map(([key, value]) => `${key}: ${value ?? 'unknown'}`).join(', ');
    lines.push(`| ${row.name} | ${row.status} (${row.state || 'unknown'}) | ${row.observedAt || 'missing'} | ${counts} | ${[...row.issues, ...row.holds].join(', ') || 'none recorded'} |`);
  }
  lines.push('', '### Budget snapshots (not current credit balances)', '');
  for (const row of report.sources) if (row.budget) lines.push(`- ${row.name}: ${JSON.stringify(row.budget)}`);
  lines.push('', report.limits, 'Details: launch-readiness artifact. No customer notifications are sent by this check.', '');
  return lines.join('\n');
}

async function main() {
  const report = buildReadinessReport({ feed: await probeLiveFeed() });
  const output = path.join(ROOT, 'output', 'launch-readiness.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  const summary = renderSummary(report);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(summary);
  if (process.env.GITHUB_ACTIONS === 'true') {
    for (const row of report.sources.filter(source => source.status === 'warning'))
      console.log(`::warning title=Launch readiness::${row.name}: ${[...row.issues, ...row.holds].join(', ')}`);
  }
  if (report.status === 'error') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();

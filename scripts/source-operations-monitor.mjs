import { createHash } from 'node:crypto';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const docs = file => `docs/${file}.json`;
const pending = key => docs(`deals-pending-${key}`);
const pipeline = key => docs(`deal-pipeline-last-run-${key}`);

const source = (key, label, workflow, { report = null, output = pending(key), ...options } = {}) =>
  ({ key, label, workflow: workflow ? `${workflow}.yml` : null, report, output, ...options });
const firecrawl = (key, number, name, workflow) =>
  source(key, `Firecrawl Key ${number} · ${name}`, workflow, { report: pipeline(key), history: docs(`deal-pipeline-runs-${key}`) });

export const sourceOperationsRegistry = [
  source('meta-instagram', 'Meta Instagram · Graph und Ad Library', 'meta-instagram-deals', { report: docs('meta-instagram-report') }),
  source('instagram-apify', 'Apify Instagram', 'apify-instagram-daily', { report: docs('apify-instagram-report') }),
  source('instagram-apify2', 'Apify 2 · Vienna Food', 'apify-discovery', { report: docs('apify-discovery-report'), enabledBy: 'APIFY_2_DISCOVERY_ENABLED' }),
  source('instagram-ai', 'Instagram AI · Suche und Profile', 'instagram-ai-agent', { report: docs('instagram-ai-report') }),
  source('instagram-discovery', 'Instagram · Öffentliche Profile', 'firecrawl-daily-sync', { report: docs('instagram-discovery-report') }),
  source('instagram-web', 'Instagram · Veraltete private Web-Route', 'firecrawl-daily-sync', { report: docs('instagram-web-report'), mode: 'disabled' }),
  source('tiktok', 'TikTok · Scanner', 'tiktok-deals', { report: docs('tiktok-scanner-report') }),
  source('tiktok-browser', 'TikTok · Browser-Import', 'tiktok-deals', { mode: 'manual-only' }),
  source('wien-combined', 'Wien Deals Combined', 'wien-deals-combined', { report: docs('wien-deals-combined-report'), runReport: pipeline('wien-combined'), history: docs('deal-pipeline-runs-wien-combined') }),
  firecrawl('gastro2', 1, 'Gastro', 'firecrawl-gastro-key1'),
  firecrawl('food3', 2, 'Food', 'firecrawl-food-key2'),
  firecrawl('firecrawl2', 3, 'Consumables', 'firecrawl-consumables-key3'),
  firecrawl('firecrawl4', 4, 'Gastro Discovery', 'firecrawl-instagram-key4'),
  firecrawl('firecrawl5', 5, 'Instagram Gastro', 'firecrawl-instagram-key5'),
  source('power', 'Power Scraper', 'power-scraper', { report: docs('power-scraper-report'), history: docs('deal-pipeline-runs-power') }),
  source('vienna-websites', 'Wiener Händlerseiten', 'vienna-merchant-discovery', { report: 'reviews/vienna-merchant-discovery-report.json' }),
  source('food-providers', 'Food Provider Discovery', 'food-provider-discovery', { report: docs('food-provider-report'), state: docs('food-provider-state'), enabledBy: 'FOOD_PROVIDER_DISCOVERY_ENABLED' }),
  source('joe', 'jö · Öffentliche Angebote und privater Zugang', 'firecrawl-daily-sync', { report: docs('joe-scraper-report'), runReport: pipeline('joe'), history: docs('deal-pipeline-runs-joe') }),
  source('vienna-promo-radar', 'Vienna Promo Radar · RSS-Hinweise', 'firecrawl-daily-sync'),
  source('member-benefits', 'Mitgliedervorteile', 'member-benefits'),
  source('gutscheine', 'Gutscheine.at', 'gutscheine'),
  source('flights', 'Flüge ab Wien', 'flights-vienna'),
  source('church-gemeinde', 'Kirchen · Verzeichnis', 'churches-wien'),
  source('church-gottesdienste', 'Kirchen · Gottesdienste', 'churches-wien'),
  source('church-events', 'Kirchen · Veranstaltungen', 'churches-wien'),
  source('freikirchen', 'Freikirchen · Separater Lauf', 'freikirchen-wien', { mode: 'manual-only' }),
  source('community', 'Community-Einreichungen', 'community-submissions', { output: null }),
  source('central', 'Central · Validierung und Slack-Zustellung', 'daily-digest', { report: docs('deal-validity-report'), output: null }),
  source('approval', 'Slack-Freigabe · Regulärer Nachlauf', 'approve-deals', { output: null }),
  source('google', 'Google Places · Lokaler Lauf', null, { mode: 'manual-only' }),
  source('telegram', 'Telegram · Altbestand', null, { mode: 'inactive' }),
  source('twitter', 'X/Twitter · Altbestand', null, { mode: 'inactive' }),
  ...['events', 'gemeinde', 'gottesdienste'].map(key =>
    source(key, `Kirchen · Archiv ${key}`, null, { mode: 'inactive' })),
];

function values(field, min, max) {
  if (/^\d+(,\d+)*$/.test(field)) {
    const result = [...new Set(field.split(',').map(Number))].sort((a, b) => a - b);
    return result.every(n => n >= min && n <= max) ? result : null;
  }
  const step = field === '*' ? 1 : /^\*\/[1-9]\d*$/.test(field) ? Number(field.slice(2)) : null;
  return step && step <= max - min + 1 ? Array.from({ length: 1 + Math.floor((max - min) / step) },
    (_, index) => min + index * step) : null;
}

// Collector schedules currently use UTC, minute/hour lists and optional weekdays.
// An unrecognized future format is reported as unknown until supported explicitly.
export function workflowSchedule(workflow = '') {
  const schedule = workflow.match(/^on:\s*\r?\n([\s\S]*?)(?=^\S|(?![\s\S]))/m)?.[1]
    ?.match(/^  schedule:\s*\r?\n((?:^ {4,}[^\r\n]*\r?\n?)+)/m)?.[1];
  if (!schedule || /timezone\s*:/.test(schedule)) return null;
  const cron = [...schedule.matchAll(/^    - cron:\s*['"]([^'"]+)['"]/gm)].map(match => match[1]);
  if (cron.length !== 1) return null;
  const [minutes, hours, monthDays, months, dayOfWeek, ...rest] = cron[0].trim().split(/\s+/);
  if (monthDays !== '*' || months !== '*' || dayOfWeek == null || rest.length) return null;
  const mins = values(minutes, 0, 59);
  const hrs = values(hours, 0, 23);
  const days = values(dayOfWeek, 0, 6);
  if (!mins || !hrs || !days) return null;
  const slots = days.flatMap(day => hrs.flatMap(hour => mins.map(minute => (day * 24 + hour) * 60 + minute)));
  const interval = Math.min(...slots.map((slot, i) => (slots[i + 1] ?? slots[0] + 7 * 1440) - slot));
  return { cron: cron[0], slots, graceMinutes: interval <= 60 ? 60 : 120 };
}

function expectedSlot(schedule, now) {
  if (!schedule) return null;
  const cutoff = +now - schedule.graceMinutes * MINUTE;
  const date = new Date(cutoff);
  const start = date.setUTCHours(0, 0, 0, 0) - date.getUTCDay() * DAY;
  const slot = schedule.slots.filter(minute => start + minute * MINUTE <= cutoff).at(-1);
  return slot === undefined ? start - 7 * DAY + schedule.slots.at(-1) * MINUTE : start + slot * MINUTE;
}

const iso = value => {
  const ms = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)
    ? Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value}Z`) : NaN;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};
const observedAt = report => iso(report?.generatedAt || report?.finishedAt || report?.lastUpdated
  || report?.updatedAt || report?.checkedAt || report?.createdAt || report?.startedAt);
const number = (...values) => values.find(value => Number.isSafeInteger(value) && value >= 0) ?? null;
const slug = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,79}$/i.test(value) ? value : null;
const id = value => (typeof value === 'string' || Number.isSafeInteger(value))
  && /^\d{1,20}$/.test(String(value)) ? String(value) : null;
const actionsRunURL = (repository, runId) => repository && id(runId)
  ? `https://github.com/${repository}/actions/runs/${runId}` : null;
const repositoryName = value => typeof value === 'string' && /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(value) ? value : null;
const eventNames = new Set(['schedule', 'workflow_dispatch', 'workflow_run', 'repository_dispatch', 'push']);
const githubStatuses = new Set(['queued', 'in_progress', 'waiting', 'pending', 'requested', 'completed']);
const githubConclusions = new Set(['success', 'failure', 'cancelled', 'skipped', 'timed_out', 'action_required', 'neutral', 'stale', 'startup_failure']);

function runReceipt(run, repository, now) {
  const runId = id(run?.id);
  const createdAt = iso(run?.created_at);
  if (!runId || !createdAt || Date.parse(createdAt) > +now || !eventNames.has(run.event)
    || !githubStatuses.has(run.status)) return null;
  const start = iso(run.run_started_at);
  const makesSense = start && Date.parse(start) >= Date.parse(createdAt) && Date.parse(start) <= +now;
  return { runId, event: run.event, createdAt, startedAt: makesSense ? start : null,
    queueDelayMinutes: makesSense ? Math.floor((Date.parse(start) - Date.parse(createdAt)) / MINUTE) : null,
    status: run.status, conclusion: githubConclusions.has(run.conclusion) ? run.conclusion : null,
    url: actionsRunURL(repository, runId) };
}

export async function readCollectorWorkflowRuns(workflows, { request = fetch, env = process.env, now = new Date() } = {}) {
  const repository = repositoryName(env.GITHUB_REPOSITORY);
  if (!repository || !env.GH_TOKEN) return {};
  const result = {};
  const unique = [...new Set(workflows)].filter(file => /^[a-z0-9-]+\.yml$/.test(file)).slice(0, 25);
  async function readOne(file) {
    try {
      const response = await request(`https://api.github.com/repos/${repository}/actions/workflows/${file}/runs?branch=main&event=schedule&per_page=8`, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(4_000),
        headers: { authorization: `Bearer ${env.GH_TOKEN}`, accept: 'application/vnd.github+json' },
      });
      if (!response.ok) return { status: `github-http-${response.status}`, runs: [] };
      const data = await response.json();
      if (!Array.isArray(data?.workflow_runs)) return { status: 'github-malformed-response', runs: [] };
      const runs = data.workflow_runs.slice(0, 8).map(run => runReceipt(run, repository, now))
        .filter(run => run?.event === 'schedule').sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      if (data.workflow_runs.length > 0 && !runs.length) return { status: 'github-unusable-run-receipts', runs: [] };
      return { status: 'observed', runs };
    } catch {
      return { status: 'github-unavailable', runs: [] };
    }
  }
  for (let i = 0; i < unique.length; i += 5) {
    await Promise.all(unique.slice(i, i + 5).map(async file => { result[file] = await readOne(file); }));
  }
  return result;
}

function workflowHealth(mode, schedule, metadata, now, priorSuccess, repository) {
  if (mode !== 'scheduled') return { status: mode, metadata: 'not-required' };
  const due = expectedSlot(schedule, now);
  const latest = metadata?.runs[0] || null;
  const previous = runReceipt({ id: priorSuccess?.runId, event: priorSuccess?.event,
    created_at: priorSuccess?.createdAt, run_started_at: priorSuccess?.startedAt,
    status: priorSuccess?.status, conclusion: priorSuccess?.conclusion }, repository, now);
  const success = metadata?.runs.find(run => run.conclusion === 'success')
    || (previous?.event === 'schedule' && previous.conclusion === 'success' ? previous : null);
  const state = { cron: schedule?.cron || null, graceMinutes: schedule?.graceMinutes ?? null,
    expectedByNow: due === null ? null : new Date(due).toISOString(), metadata: metadata?.status || 'unavailable',
    latestScheduledRun: latest, lastSuccessfulScheduledRun: success };
  if (!schedule || metadata?.status !== 'observed') return { ...state, status: 'schedule-unverified' };
  if (!latest || Date.parse(latest.createdAt) < due) return { ...state, status: 'scheduled-run-overdue' };
  if (latest.status !== 'completed') return { ...state, status: latest.status === 'in_progress' ? 'in-progress' : 'awaiting-runner' };
  return { ...state, status: latest.conclusion === 'success' ? 'workflow-succeeded'
    : latest.conclusion === 'skipped' ? 'workflow-skipped' : latest.conclusion ? 'workflow-failed' : 'schedule-unverified' };
}

function priorEvidence(previous, now, repository, withCount = false) {
  const at = iso(previous?.at);
  if (!at || Date.parse(at) > +now || withCount && !(number(previous.count) > 0)) return null;
  const runId = id(previous.runId);
  const event = eventNames.has(previous.event) ? previous.event : null;
  return { at, ...(runId ? { runId, event, url: actionsRunURL(repository, runId), basis: 'collector-receipt' } : {}),
    ...(withCount ? { count: previous.count } : {}) };
}

const latest = (...evidence) => evidence.filter(Boolean).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] || null;

function provenance(report, runReport, repository) {
  const sourceRun = report?.runProvenance || report?.github || runReport?.runProvenance;
  const runId = id(sourceRun?.runId || report?.runId);
  if (runId) {
    const recordedRepository = repositoryName(sourceRun?.repository);
    if (repository && recordedRepository && recordedRepository !== repository) return null;
    const event = eventNames.has(sourceRun?.event) ? sourceRun.event : null;
    return { runId, event, url: actionsRunURL(repository || recordedRepository, runId), basis: 'collector-receipt' };
  }
  // Legacy writers lack a workflow id. A timestamp alone cannot prove event or
  // exact run identity, so preserve the workflow observation separately.
  return null;
}

function holdEntries(report, providerState) {
  const top = [report, report?.search, report?.profileDiscovery, report?.previewFetch, report?.apiDiscovery,
    report?.searchDiscovery, report?.tavilyDiscovery, report?.webAccess, report?.sharedQuota,
    report?.authenticatedCoverage, report?.privateAccessPause, report?.sources?.instagramGraph?.sharedQuota];
  const sourceHolds = (Array.isArray(report?.sources) ? report.sources : []).flatMap(row => row.cooldown
    ? [{ ...row.cooldown, scope: slug(row.source) || 'source' }] : []);
  const attempts = [...(Array.isArray(report?.errors) ? report.errors : []),
    ...(Array.isArray(report?.results) ? report.results : [])].filter(row => row && typeof row === 'object');
  const providerHolds = Object.entries(providerState?.providerPauses || {}).map(([scope, retryAt]) => ({ scope, retryAt, reason: 'provider-paused' }));
  const sourceState = Object.entries(providerState?.sources || {}).map(([scope, row]) => ({ ...row, scope }));
  const pageState = Object.values(providerState?.pages || {}).map(row => ({ ...row, scope: 'page' }));
  return [...top, ...sourceHolds, ...attempts, ...providerHolds, ...sourceState, ...pageState].flatMap(row => {
    const retryAt = iso(row?.nextRetryAt || row?.retryAt);
    if (!retryAt) return [];
    return [{ scope: slug(row.scope) || ([report?.authenticatedCoverage, report?.privateAccessPause].includes(row)
      ? 'authenticated-access' : 'collector'),
      reason: slug(row.stoppedReason || row.reason || row.status) || 'retry-deferred', retryAt }];
  }).filter((row, index, all) => all.findIndex(other => other.scope === row.scope && other.reason === row.reason && other.retryAt === row.retryAt) === index)
    .sort((a, b) => Date.parse(a.retryAt) - Date.parse(b.retryAt)).slice(-20);
}

function collectorSnapshot(spec, report, output) {
  const central = spec.key === 'central' ? report?.summary : null;
  const verified = number(report?.verifiedDeals, report?.uniqueVerifiedCandidates, report?.outbox?.freshlyVerified,
    report?.counts?.verifiedCandidates);
  const fetched = number(report?.freshPostsFetched, report?.fetchedPosts, report?.fetchedRecords, report?.rawDatasetItems,
    report?.visitedPosts, report?.counts?.rawCandidates, central?.total);
  const fresh = number(report?.newDeals, report?.newPendingCandidates, report?.freshAcceptedDeals,
    report?.counts?.newDeals);
  const previous = number(report?.outbox?.retained, report?.retainedPreviousDeals, report?.diagnostics?.retainedPreviousDeals, report?.retainedCandidateCount,
    report?.retainedDeals, output?.retainedPreviousDeals);
  const accepted = number(report?.acceptedDeals, report?.accepted, report?.summary?.acceptedDeals, report?.counts?.acceptedDeals, central?.allowed);
  const attempted = number(report?.totalPageSlotsUsed, report?.eligiblePages, report?.publicDiscovery?.requests);
  const branches = Object.fromEntries(['adLibrary', 'instagramGraph'].flatMap(key => {
    const row = report?.sources?.[key];
    return row ? [[key, { status: slug(row.status), fetched: number(row.fetched),
      accepted: number(row.accepted), newCandidates: number(row.newAccepted) }]] : [];
  }));
  const sourceCoverage = {
    healthy: number(report?.summary?.healthySources, report?.successfulSources, report?.diagnostics?.completedSources),
    failed: number(report?.summary?.failedSources, report?.failedSources),
    deferred: number(report?.summary?.deferredSources, report?.offerPagesDeferredThisRun),
  };
  const discovered = spec.key === 'instagram-ai' ? number(report?.discoveredCandidates) : null;
  const checked = spec.key === 'tiktok' ? number(report?.coverage?.uniqueVideosChecked)
    : spec.key === 'instagram-apify' ? number(report?.inspectedPosts) : null;
  const newDiscoveredPosts = spec.key === 'instagram-apify' ? number(report?.newDiscoveredPosts) : null;
  const recordedCount = Array.isArray(output?.deals) ? output.deals.length : null;
  const branch = spec.key === 'joe' ? slug(report?.authenticatedCoverage?.status) : null;
  return { fetched, discovered, checked, newDiscoveredPosts, verified, accepted, attempted, newCandidates: fresh,
    retainedCount: previous, outboxCount: recordedCount,
    sourceCoverage, branches, ...(central ? { validationBlocked: number(central.blocked) } : {}),
    ...(branch ? { authenticatedStatus: branch, authenticatedOffers: number(report.authenticatedCoverage?.readableOffers) } : {}) };
}

function collectorOutcome(report, snapshot, holds, now, mode, readFailed) {
  if (['disabled', 'inactive'].includes(mode)) return mode;
  if (!report) return readFailed ? 'report-unreadable' : 'report-missing';
  const at = observedAt(report);
  if (!at || Date.parse(at) > +now) return 'report-timestamp-unverified';
  const status = String(report.operationalStatus || report.status || report.mode || '').toLowerCase();
  if (report.enabled === false || status === 'disabled') return 'disabled';
  if (status === 'skipped' && (report.eligiblePages === 0 || (Array.isArray(report.skipped) && report.skipped.some(row => row?.reason === 'no-eligible-pages')))) return 'no-eligible-inputs';
  if (['failed', 'error', 'timed_out', 'aborted'].includes(status)) return 'collection-failed';
  if (status === 'reserved') return 'awaiting-completed-collector-report';
  const held = holds.some(hold => Date.parse(hold.retryAt) > +now);
  if ((snapshot.fetched === 0 && report.budgetDeferred) || ['paused', 'deferred', 'rate-limited', 'cooldown'].includes(status)) {
    return held ? 'held' : 'awaiting-post-hold-observation';
  }
  if (status === 'skipped' || status.startsWith('skipped-') || report.budget?.allowed === false) return 'collector-skipped';
  if (['partial', 'degraded', 'discovery-degraded', 'completed-with-errors'].includes(status)
    || report.budgetDeferred || (report.summary?.failedSources > 0) || report.errors?.length) return 'partially-available';
  if (held) return snapshot.fetched > 0 || snapshot.accepted > 0 ? 'partially-available' : 'held';
  if (snapshot.newCandidates > 0) return 'new-candidates';
  if (snapshot.newCandidates === 0 || status === 'healthy-no-verified-deals') return 'no-new-candidates';
  if (snapshot.fetched > 0 || snapshot.accepted > 0) return 'collector-ran';
  if (snapshot.outboxCount !== null) return 'outbox-observed';
  return status === 'ok' || status === 'completed' ? 'report-observed' : 'collector-outcome-unknown';
}

function observedOutput(output, previous, now) {
  const at = observedAt(output);
  if (!at || Date.parse(at) > +now || !Array.isArray(output?.deals) || output.deals.length > 3000) return null;
  const hashes = [...new Set(output.deals.map(deal => deal?.id).filter(value => typeof value === 'string' && value.length > 0)
    .map(value => createHash('sha256').update(value).digest('hex').slice(0, 16)))].sort();
  const prior = previous?.outboxObservation;
  const valid = Array.isArray(prior?.hashes) && prior.hashes.length <= 3000 && prior.hashes.every(value => /^[a-f\d]{16}$/.test(value));
  if (!valid || !iso(prior.at) || prior.at > at) return { at, hashes, newIds: null, retainedIds: null };
  const before = new Set(prior.hashes);
  const retainedIds = hashes.filter(value => before.has(value)).length;
  return { at, hashes, newIds: hashes.length - retainedIds, retainedIds };
}

export async function monitorSources({ readJson, readWorkflow, now = new Date(), request = fetch, env = process.env,
  previous = [], registry = sourceOperationsRegistry } = {}) {
  const schedules = new Map();
  const specs = registry.map(spec => {
    const mode = spec.mode || (spec.enabledBy && env[spec.enabledBy] == null ? 'activation-unknown'
      : spec.enabledBy && env[spec.enabledBy] !== 'true' ? 'disabled' : 'scheduled');
    if (mode === 'scheduled' && spec.workflow && !schedules.has(spec.workflow)) {
      schedules.set(spec.workflow, workflowSchedule(readWorkflow(spec.workflow)));
    }
    return { ...spec, mode };
  });
  const metadata = await readCollectorWorkflowRuns([...schedules.keys()], { request, env, now });
  const byKey = new Map((Array.isArray(previous) ? previous : []).filter(row => row?.key).map(row => [row.key, row]));
  const repository = repositoryName(env.GITHUB_REPOSITORY);
  return specs.map(spec => {
    const previous = byKey.get(spec.key);
    let readFailed = false;
    const read = file => {
      if (!file) return null;
      try {
        const value = readJson(file);
        if (value != null && (typeof value !== 'object' || Array.isArray(value))) throw new TypeError('invalid-report');
        return value;
      } catch {
        readFailed = true;
        return null;
      }
    };
    const output = read(spec.output);
    const report = spec.report ? read(spec.report) : output;
    const rawRun = read(spec.runReport);
    const state = read(spec.state);
    const collector = collectorSnapshot(spec, report, output);
    const workflow = workflowHealth(spec.mode, schedules.get(spec.workflow), metadata[spec.workflow],
      now, previous?.schedule?.lastSuccessfulScheduledRun, repository);
    const holds = holdEntries(report, state);
    const at = observedAt(report);
    const receipt = provenance(report, rawRun, repository);
    const current = at && Date.parse(at) <= +now ? { at, ...receipt } : null;
    const confirmedNew = current && collector.newCandidates > 0 ? { ...current, count: collector.newCandidates } : null;
    const history = read(spec.history)?.runs;
    const lastRecordedCollection = Array.isArray(history) ? history.slice(0, 90).find(run =>
      typeof observedAt(run) === 'string' && Date.parse(observedAt(run)) <= +now
      && run.counts?.rawCandidates > 0 && !['failed', 'deferred'].includes(run.status)) : null;
    const historicalCollection = lastRecordedCollection
      ? { at: observedAt(lastRecordedCollection), ...provenance(lastRecordedCollection, null, repository) } : null;
    const healthy = current && (collector.fetched > 0 || collector.checked > 0 || collector.sourceCoverage.healthy > 0) ? current : null;
    const reportBehindWorkflow = workflow.latestScheduledRun?.conclusion === 'success'
      && (!current || Date.parse(current.at) < Date.parse(workflow.latestScheduledRun.createdAt));
    return { key: spec.key, label: spec.label, file: spec.report || spec.output, workflowFile: spec.workflow,
      schedule: workflow, reportStatus: slug(report?.operationalStatus || report?.status), observedAt: current?.at || null,
      collectorOutcome: collectorOutcome(report, collector, holds, now, spec.mode, readFailed),
      reportBehindWorkflow: Boolean(reportBehindWorkflow), runProvenance: receipt,
      lastConfirmedCollection: latest(healthy, historicalCollection, priorEvidence(previous?.lastConfirmedCollection, now, repository)),
      lastConfirmedNew: latest(confirmedNew, priorEvidence(previous?.lastConfirmedNew, now, repository, true)),
      nextRetryAt: holds.find(hold => Date.parse(hold.retryAt) > +now)?.retryAt || null,
      holds, counts: collector, outboxObservation: observedOutput(output, previous, now), newlyDeliveredToSlack: null };
  });
}

const safeCell = value => String(value ?? 'unbekannt').replace(/[|\r\n<>]/g, ' ');
const formatRun = run => {
  const label = safeCell(run?.runId || run?.createdAt);
  return run?.url ? `[${label}](${run.url})` : label;
};

export function formatSourceOperations(sources) {
  return ['','## Quellenbetrieb','',
    'Erwartete GitHub-Zeiten enthalten einen Toleranzpuffer. Ein Workflow-Erfolg bestätigt weder Quellenzugriff noch neue Angebote. Neu beobachtete Ausgangs-IDs gelten nur für den Zeitraum zwischen zwei Berichten. Slack-Zustellungen stehen im Abschnitt Ertrag.',
    '', '| Quelle | Zeitplan und letzter regulärer Lauf | Quellenbefund | Belegte Kennzahlen | Neu beobachtete IDs | Bekannte Wartezeit bis |',
    '|---|---|---|---|---:|---|', ...sources.map(row => {
      const workflow = row.schedule;
      const when = workflow.expectedByNow || '—';
      const lastRun = workflow.latestScheduledRun;
      const timing = [workflow.status, workflow.cron ? `UTC ${workflow.cron}` : null,
        workflow.expectedByNow ? `erwartet seit ${when}` : null,
        lastRun ? `${formatRun(lastRun)} ${safeCell(lastRun.conclusion || lastRun.status)} ${lastRun.startedAt || lastRun.createdAt}` : null,
        workflow.status === 'schedule-unverified' ? workflow.metadata : null].filter(Boolean).join(' · ');
      const outcome = [row.collectorOutcome, row.reportBehindWorkflow ? 'Bericht älter als Lauf' : null,
        row.counts.authenticatedStatus, row.reportStatus,
        row.lastConfirmedCollection ? `letzter belegter Rücklauf ${row.lastConfirmedCollection.at}` : null,
        row.lastConfirmedNew ? `zuletzt neu ${row.lastConfirmedNew.at}` : null].filter(Boolean).map(safeCell).join(' · ');
      const metrics = [
        ['Abgerufene Datensätze', row.counts.fetched], ['Entdeckte Kandidaten', row.counts.discovered],
        ['Geprüft', row.counts.checked], ['Neu entdeckte Posts', row.counts.newDiscoveredPosts],
        ['Akzeptiert', row.counts.accepted], ['Neue bestätigte Kandidaten', row.counts.newCandidates],
        ['Im Ausgang', row.counts.outboxCount],
      ];
      const counts = metrics.filter(([label, count]) => count != null || label === 'Neue bestätigte Kandidaten')
        .map(([label, count]) => `${label} ${safeCell(count)}`).join(' · ');
      return `| ${safeCell(row.label)} | ${timing} | ${outcome} | ${counts} | ${safeCell(row.outboxObservation?.newIds)} | ${safeCell(row.nextRetryAt)} |`;
    }), ''].join('\n') + '\n';
}

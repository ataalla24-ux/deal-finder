import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  formatSourceOperations, monitorSources, sourceOperationsRegistry, workflowSchedule,
} from './source-operations-monitor.mjs';

const now = new Date('2026-11-27T20:00:00.000Z');
const env = { GH_TOKEN: 'fixture-token', GITHUB_REPOSITORY: 'owner/repo' };
const daily = "name: fixture\non:\n  workflow_dispatch:\n  schedule:\n    - cron: '0 7 * * *'\njobs:\n";
const weekly = daily.replace('* * *', '* * 1');
const run = (id, created_at, conclusion = 'success', event = 'schedule', status = 'completed') =>
  ({ id, event, created_at, run_started_at: created_at, status, conclusion, html_url: 'https://invalid.example/untrusted' });
const json = workflow_runs => Response.json({ workflow_runs });
const fixture = (key, workflow, extra = {}) =>
  ({ key, label: key, workflow, report: `${key}-report.json`, output: `${key}-output.json`, ...extra });

test('registry covers active collection, intake and review workflows and parses real schedule declarations', () => {
  const workflows = new Set(sourceOperationsRegistry.filter(spec => !spec.mode).map(spec => spec.workflow));
  assert(workflows.size >= 20 && workflows.size <= 25);
  for (const workflow of workflows) {
    const contents = fs.readFileSync(new URL(`../.github/workflows/${workflow}`, import.meta.url), 'utf8');
    assert(workflowSchedule(contents), workflow);
  }
  for (const key of ['tiktok-browser', 'freikirchen', 'google']) {
    assert.equal(sourceOperationsRegistry.find(spec => spec.key === key).mode, 'manual-only');
  }
  assert.equal(sourceOperationsRegistry.find(spec => spec.key === 'telegram').mode, 'inactive');
  assert.equal(sourceOperationsRegistry.find(spec => spec.key === 'instagram-web').mode, 'disabled');
  assert.equal(workflowSchedule(daily.replace("    - cron: '0 7 * * *'", "    - cron: '0 7 * * *'\n      timezone: Europe/Vienna")), null);
  assert.equal(workflowSchedule(daily.replace('0 7 * * *', '0 7 15 * *')), null);
});

test('a weekly run stays current; a missing daily run and failed run link remain explicit', async () => {
  const values = [
    fixture('church', 'weekly.yml'), fixture('daily', 'daily.yml'),
    fixture('failed', 'failed.yml'), fixture('queued', 'queued.yml'), fixture('denied', 'denied.yml'),
    fixture('shared', 'daily.yml'), fixture('never', 'disabled.yml', { enabledBy: 'NEVER' }),
    fixture('held-activation', 'off.yml', { enabledBy: 'OFF' }),
    fixture('manual', 'weekly.yml', { mode: 'manual-only' }),
  ];
  const visited = [];
  const data = {
    'weekly.yml': [run(8, '2026-11-23T08:00:00Z')],
    'daily.yml': [run(7, '2026-11-26T08:00:00Z'), run(99, '2026-11-27T19:00:00Z', 'success', 'workflow_dispatch')],
    'failed.yml': [run(9, '2026-11-27T08:00:00Z', 'failure'), run(6, '2026-11-26T08:00:00Z')],
    'queued.yml': [run(10, '2026-11-27T08:00:00Z', null, 'schedule', 'queued')],
  };
  const output = await monitorSources({ now, env: { ...env, OFF: '' }, registry: values, readJson: () => null,
    readWorkflow: file => file === 'weekly.yml' ? weekly : daily,
    request: async (value, options) => {
      const url = new URL(value);
      assert.equal(url.origin, 'https://api.github.com');
      assert.equal(url.search, '?branch=main&event=schedule&per_page=8');
      assert.equal(options.method, 'GET');
      const file = url.pathname.split('/').at(-2);
      visited.push(file);
      return file === 'denied.yml' ? new Response('', {status: 403}) : json(data[file]);
    } });
  const rows = Object.fromEntries(output.map(row => [row.key, row]));
  assert.equal(visited.length, 5);
  assert.equal(visited.filter(file => file === 'daily.yml').length, 1);
  assert.equal(rows.church.schedule.status, 'workflow-succeeded');
  assert.equal(rows.church.schedule.expectedByNow, '2026-11-23T07:00:00.000Z');
  assert.equal(rows.daily.schedule.status, 'scheduled-run-overdue');
  assert.equal(rows.daily.schedule.latestScheduledRun.runId, '7');
  assert.equal(rows.failed.schedule.status, 'workflow-failed');
  assert.equal(rows.failed.schedule.latestScheduledRun.url, 'https://github.com/owner/repo/actions/runs/9');
  assert.equal(rows.failed.schedule.lastSuccessfulScheduledRun.runId, '6');
  assert.equal(rows.queued.schedule.status, 'awaiting-runner');
  assert.equal(rows.denied.schedule.metadata, 'github-http-403');
  assert.equal(rows.denied.schedule.status, 'schedule-unverified');
  assert.equal(rows.manual.schedule.status, 'manual-only');
  assert.equal(rows.never.schedule.status, 'activation-unknown');
  assert.equal(rows['held-activation'].schedule.status, 'disabled');
  assert(!JSON.stringify(output).includes('fixture-token'));
  assert.match(formatSourceOperations(output), /scheduled-run-overdue.*\[7\]/);
});

test('a green workflow cannot imply a new collection, reset a hold, or create a delivery receipt', async () => {
  const registry = [
    fixture('wien-combined', 'pass.yml', { history: 'history.json' }),
    fixture('food-providers', 'pass.yml'),
    fixture('joe', 'pass.yml'),
    fixture('unknown', 'pass.yml'),
  ];
  const at = '2026-11-27T09:25:00.000Z';
  const rows = new Map([
    ['wien-combined-report.json', { generatedAt: at, status: 'degraded', budgetDeferred: true, fetchedPosts: 0,
      sharedQuota: { retryAt: '2026-11-28T09:00:00Z', reason: 'quota-hold' } }],
    ['wien-combined-output.json', { lastUpdated: at, deals: [{ id: 'prior-candidate' }] }],
    ['history.json', { runs: [{ finishedAt: '2026-11-26T09:25:00Z', status: 'completed',
      runProvenance: { runId: '5', event: 'schedule' }, counts: { rawCandidates: 2 } }] }],
    ['food-providers-report.json', { createdAt: at, runId: '8', status: 'skipped', eligiblePages: 0 }],
    ['food-providers-output.json', { updatedAt: '2026-11-26T09:25:00Z', deals: [] }],
    ['joe-report.json', { generatedAt: at, status: 'degraded', authenticatedCoverage: { status: 'provider-rate-limited', readableOffers: 0 },
      privateAccessPause: { reason: 'provider-rate-limited', retryAt: '2026-11-29T10:00:00Z' }, publicDiscovery: { requests: 6 } }],
    ['unknown-output.json', { generatedAt: at, deals: [] }],
  ]);
  const evaluate = async at => monitorSources({ now: new Date(at), env, registry, readWorkflow: () => daily,
    readJson: f => rows.get(f), request: async () => json([run(8, '2026-11-27T09:00:00Z')]) });
  const [combined, food, joe, unknown] = await evaluate(now);
  assert.equal(combined.schedule.status, 'workflow-succeeded');
  assert.equal(combined.collectorOutcome, 'held');
  assert.equal(combined.lastConfirmedCollection.runId, '5');
  assert.equal(combined.lastConfirmedNew, null);
  assert.equal(combined.nextRetryAt, '2026-11-28T09:00:00.000Z');
  assert.equal(food.collectorOutcome, 'no-eligible-inputs');
  assert.equal(food.counts.outboxCount, 0);
  assert.equal(food.counts.newCandidates, null);
  assert.equal(joe.collectorOutcome, 'partially-available');
  assert.equal(joe.counts.authenticatedOffers, 0);
  assert.equal(joe.counts.attempted, 6);
  assert.equal(unknown.collectorOutcome, 'report-missing');
  assert.equal(unknown.newlyDeliveredToSlack, null);
  assert.equal((await evaluate('2026-11-28T09:30:00Z'))[0].collectorOutcome, 'awaiting-post-hold-observation');
});

test('output observations are bounded, preserve zero versus unknown and retain explicit new-candidate dates', async () => {
  const registry = [fixture('meta-instagram', 'pass.yml')];
  const at = '2026-11-27T09:25:00.000Z';
  let report = { generatedAt: at, newDeals: 2, freshPostsFetched: 6,
    runProvenance: { runId: '8', event: 'schedule' },
    sources: { adLibrary: { status: 'ok', fetched: 10, accepted: 4, newAccepted: 1, errors: ['secret fixture'] } } };
  let output = { generatedAt: at, deals: [{ id: 'private fixture id' }, { id: 'old' }] };
  const evaluate = async previous => monitorSources({ now, env: {}, registry, previous, readWorkflow: () => daily,
    readJson: file => file.endsWith('report.json') ? report : output });
  const initial = await evaluate([]);
  assert.equal(initial[0].outboxObservation.newIds, null);
  assert.equal(initial[0].lastConfirmedNew.count, 2);
  assert.equal(initial[0].lastConfirmedNew.event, 'schedule');
  assert.equal(initial[0].counts.branches.adLibrary.newCandidates, 1);
  assert(!JSON.stringify(initial).includes('fixture'));
  report = { generatedAt: '2026-11-27T10:00:00Z', freshPostsFetched: 0, newDeals: 0 };
  output = { generatedAt: report.generatedAt, deals: [{ id: 'old' }, { id: 'new-arrival' }] };
  const later = (await evaluate(initial))[0];
  assert.equal(later.lastConfirmedNew.at, at);
  assert.equal(later.counts.newCandidates, 0);
  assert.equal(later.outboxObservation.newIds, 1);
  assert.equal(later.outboxObservation.retainedIds, 1);
  assert.equal(later.schedule.status, 'schedule-unverified');
});

test('bad source artifacts and future previous observations never become valid receipts', async () => {
  const registry = [fixture('broken', 'pass.yml'), fixture('healthy', 'pass.yml')];
  const past = '2026-11-26T10:00:00.000Z';
  const future = '2026-11-29T10:00:00.000Z';
  const result = await monitorSources({ now, env, registry, readWorkflow: () => daily,
    previous: [{ key: 'broken', lastConfirmedNew: { at: future, count: 10, runId: '9' },
      lastConfirmedCollection: { at: past, runId: '8', event: 'schedule', url: 'https://invalid.example' },
      schedule: { lastSuccessfulScheduledRun: { runId: '7', event: 'schedule', createdAt: past,
        status: 'completed', conclusion: 'success' } } }],
    request: async () => new Response('', { status: 503 }),
    readJson: file => {
      if (file === 'broken-report.json') throw new SyntaxError('internal token');
      if (file === 'healthy-report.json') return { generatedAt: future, newDeals: 9,
        runProvenance: { runId: '8', repository: 'wrong/repo' } };
      return null;
    } });
  const [broken, healthy] = result;
  assert.equal(broken.collectorOutcome, 'report-unreadable');
  assert.equal(broken.lastConfirmedNew, null);
  assert.equal(broken.lastConfirmedCollection.url, 'https://github.com/owner/repo/actions/runs/8');
  assert.equal(broken.schedule.lastSuccessfulScheduledRun.runId, '7');
  assert.equal(broken.schedule.status, 'schedule-unverified');
  assert.equal(healthy.collectorOutcome, 'report-timestamp-unverified');
  assert.equal(healthy.lastConfirmedNew, null);
  assert.equal(healthy.runProvenance, null);
  assert(!JSON.stringify(result).includes('internal token'));
});

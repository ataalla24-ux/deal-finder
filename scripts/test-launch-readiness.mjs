import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildReadinessReport, inspectFeed, probeLiveFeed, renderSummary } from './check-launch-readiness.mjs';

const now = new Date('2026-10-23T12:00:00Z');
const validFeed = { totalDeals: 1, deals: [{ id: 'demo', title: 'Gratis Kaffee' }] };
function fixture(run) {
  const docsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freefinder-readiness-'));
  const reports = {
    'apify-discovery-report.json': { generatedAt: now, status: 'completed', fetchedRecords: 26, freshAcceptedDeals: 0, providerErrors: 0 },
    'food-provider-report.json': { finishedAt: now, status: 'completed', newPendingCandidates: 0, results: [] },
    'meta-instagram-report.json': { generatedAt: now, status: 'legitimate-zero', newDeals: 0, sources: {} },
    'power-scraper-report.json': { finishedAt: now, summary: { failedSources: 0, deferredSources: 0 } },
    'deal-source-health.json': { generatedAt: now, summary: { pipelineRuns: { reportedSources: 8, failedSources: [], completedWithErrors: [] } } },
  };
  const write = (file, value) => fs.writeFileSync(path.join(docsDir, file), JSON.stringify(value));
  try {
    for (const [file, value] of Object.entries(reports)) write(file, value);
    run({ docsDir, reports, write, build: () => buildReadinessReport({ docsDir, now, feed: inspectFeed(validFeed) }) });
  } finally { fs.rmSync(docsDir, { recursive: true, force: true }); }
}

test('zero new candidates alone is healthy, not a transport failure or delivery count', () => fixture(({ build }) => {
  const report = build();
  assert.equal(report.status, 'ok');
  assert.equal(report.sources[0].zeroNewCandidates, true);
  assert.match(renderSummary(report), /not live balances, Slack delivery proof/);
}));
test('Apify succeeded is healthy, but source errors, holds and stale evidence still warn', () => fixture(({ reports, write, build }) => {
  const file = 'apify-discovery-report.json';
  const succeeded = { ...reports[file], status: 'succeeded', fetchedRecords: 24, freshAcceptedDeals: 1 };
  write(file, succeeded);
  assert.equal(build().sources[0].status, 'ok');
  assert.equal(build().sources[0].state, 'succeeded');
  write(file, { ...succeeded, providerErrors: 1 });
  assert(build().sources[0].issues.includes('source-or-batch-errors'));
  assert.equal(build().sources[0].status, 'warning');
  write(file, { ...succeeded, budget: { allowed: false, reason: 'low-credit' } });
  assert.equal(build().sources[0].status, 'warning');
  write(file, { ...succeeded, generatedAt: '2026-10-20T00:00:00Z' });
  assert.equal(build().sources[0].status, 'warning');
  write(file, { ...succeeded, status: 'unknown-provider-state' });
  assert(build().sources[0].issues.includes('unknown-run-state'));
}));
test('budget stops and partial source failures remain distinct and visible', () => fixture(({ reports, write, build }) => {
  write('apify-discovery-report.json', { ...reports['apify-discovery-report.json'], status: 'partial', providerErrors: 8,
    budget: { allowed: false, reason: 'low-credit', accountUsageUsd: 4.8, runCapUsd: .075 } });
  write('food-provider-report.json', { ...reports['food-provider-report.json'],
    skipped: [{ provider: 'zyte', reason: 'zyte-local-trial-cap' }] });
  const report = build();
  assert.equal(report.status, 'warning');
  assert.deepEqual(report.sources[0].holds, ['low-credit']);
  assert(report.sources[0].issues.includes('source-or-batch-errors'));
  assert.deepEqual(report.sources[1].holds, ['zyte-local-trial-cap']);
  assert.equal(report.sources[0].budget.kind, 'report-snapshot-not-live-balance');
}));
test('missing, malformed, old and future reports never claim healthy', () => fixture(({ docsDir, reports, write, build }) => {
  fs.unlinkSync(path.join(docsDir, 'apify-discovery-report.json'));
  write('meta-instagram-report.json', { ...reports['meta-instagram-report.json'], generatedAt: '2026-10-22T00:00:00Z' });
  write('food-provider-report.json', { ...reports['food-provider-report.json'], finishedAt: '2026-10-24T12:00:00Z' });
  write('power-scraper-report.json', null);
  assert.equal(build().sources.filter(row => row.status === 'warning').length, 4);
}));
test('no raw errors, credentials, customer data or credential hashes enter output', () => fixture(({ write, build, reports }) => {
  write('apify-discovery-report.json', { ...reports['apify-discovery-report.json'],
    budget: { runCapUsd: { key: 'DO-NOT-PRINT' }, accountUsageUsd: 'DO-NOT-PRINT' } });
  write('food-provider-report.json', { ...reports['food-provider-report.json'],
    secret: 'sk-DO-NOT-PRINT', results: [{ status: 'failed', reason: 'secret=DO-NOT-PRINT' }],
    usage: { zyte: { credentialFingerprint: 'DO-NOT-PRINT' } },
    skipped: [{ reason: 'secret=DO-NOT-PRINT' }] });
  const report = build();
  assert.doesNotMatch(JSON.stringify(report) + renderSummary(report), /DO-NOT-PRINT/);
  assert.equal(report.sources[1].budget.providers.zyte.liveBalanceAvailable, false);
}));
test('empty feed, duplicate IDs, missing titles and inconsistent count fail', () => {
  for (const body of [{ deals: [], totalDeals: 0 }, { ...validFeed, totalDeals: 2 },
    { totalDeals: 2, deals: [...validFeed.deals, ...validFeed.deals] }, { totalDeals: 1, deals: [{ id: 'x' }] }])
    assert.equal(inspectFeed(body).status, 'error');
});
test('one bounded public-feed request; never follows redirects or calls provider APIs', async () => {
  let calls = 0;
  const result = await probeLiveFeed(async (url, options) => {
    calls++;
    assert.equal(url, 'https://freefinder.at/deals.json');
    assert.equal(options.redirect, 'error');
    assert(options.signal);
    return new Response(JSON.stringify(validFeed));
  });
  assert.equal(calls, 1);
  assert.equal(result.status, 'ok');
  assert.equal((await probeLiveFeed(async () => new Response('denied', { status: 403 }))).status, 'error');
  assert.equal((await probeLiveFeed(async () => new Response('bad json'))).status, 'error');
  assert.equal((await probeLiveFeed(async () => new Response('x'.repeat(4 * 1024 * 1024 + 1)))).reason, 'feed-too-large');
});

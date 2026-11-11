import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  buildPipelineRunReport,
  githubRunProvenance,
  pipelineReportPaths,
  summarizeVerifiedDeals,
  writePipelineRunReport,
} from '../scraper/pipeline-run-report-utils.js';

const report = buildPipelineRunReport({
  sourceKey: 'firecrawl4',
  sourceLabel: 'Firecrawl Key 4',
  startedAt: '2026-07-27T10:00:00.000Z',
  finishedAt: '2026-07-27T10:00:05.000Z',
  rawCandidates: 12,
  normalizedCandidates: 10,
  verifiedCandidates: 4,
  acceptedDeals: 2,
  rejected: [
    { reason: 'not-free', deal: { id: 'a', title: 'A' } },
    { reason: 'not-free', deal: { id: 'b', title: 'B' } },
    { reason: 'not-vienna', deal: { id: 'c', title: 'C' } },
  ],
});

assert.equal(report.durationMs, 5000);
assert.equal(report.counts.acceptedDeals, 2);
assert.equal(report.counts.rejectedDeals, 3);
assert.equal(report.rejectedByReason['not-free'], 2);
assert.equal(report.rejectedByReason['not-vienna'], 1);
const github={GITHUB_REPOSITORY:'ataalla24-ux/deal-finder',GITHUB_RUN_ID:'123',GITHUB_SHA:'a'.repeat(40),
  GITHUB_EVENT_NAME:'schedule',GITHUB_RUN_ATTEMPT:'1',OPENAI_API_KEY:'never-persist-this'};
assert.equal(githubRunProvenance({}),null);
assert.equal(githubRunProvenance({...github,GITHUB_SHA:'bad'}),null);
assert.equal(githubRunProvenance({...github,GITHUB_REPOSITORY:'bad?secret'}),null);
assert.equal(githubRunProvenance(github).event,'schedule');
assert.equal(githubRunProvenance({...github,GITHUB_EVENT_NAME:'workflow_dispatch'}).event,'workflow_dispatch');
assert(!JSON.stringify(githubRunProvenance(github)).includes('never-persist-this'));
assert.equal(buildPipelineRunReport({sourceKey:'fixture',env:github}).runProvenance.headSha,github.GITHUB_SHA);

const verifier = summarizeVerifiedDeals([
  { postVerification: { status: 'verified-original-post' } },
  { postVerification: { status: 'timestamp-only' } },
  { postVerification: { status: 'unavailable' }, viennaEvidence: { source: 'merchant-registry' } },
]);
assert.equal(verifier.verifiedOriginalPosts, 1);
assert.equal(verifier.timestampOnlyPosts, 1);
assert.equal(verifier.unavailableOriginalPosts, 1);
assert.equal(verifier.registryViennaEvidence, 1);

const docsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freefinder-pipeline-report-'));
try {
  const git = args => execFileSync('git', ['-C', docsDir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '--quiet']);
  git(['-c', 'user.name=Offline fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'Fixture']);
  const checkoutSha = git(['rev-parse', 'HEAD']);
  const eventPath = path.join(docsDir, 'event.json');
  const triggeringRun = { id: 456, head_sha: 'b'.repeat(40), event: 'schedule',
    name: 'TikTok Deal Scanner', run_started_at: '2026-11-11T17:15:00Z',
    head_repository: { full_name: github.GITHUB_REPOSITORY }, ignoredSecret: 'do-not-copy-event-secrets' };
  fs.writeFileSync(eventPath, JSON.stringify({ workflow_run: triggeringRun, other: 'never-persist-this' }));
  const dispatchEnv = { ...github, GITHUB_EVENT_NAME: 'workflow_run', GITHUB_WORKSPACE: docsDir, GITHUB_EVENT_PATH: eventPath };
  const provenance = githubRunProvenance(dispatchEnv);
  assert.equal(provenance.headSha, github.GITHUB_SHA, 'event SHA is retained separately');
  assert.equal(provenance.checkoutSha, checkoutSha, 'actual checked-out source is measured');
  assert.equal(provenance.triggeringRun.runId, '456');
  assert.equal(provenance.triggeringRun.event, 'schedule');
  assert.equal(provenance.triggeringRun.headSha, triggeringRun.head_sha);
  assert(!JSON.stringify(provenance).includes('do-not-copy-event-secrets'));
  assert(!JSON.stringify(provenance).includes('never-persist-this'));
  assert.equal(githubRunProvenance({ ...dispatchEnv, GITHUB_WORKSPACE: path.join(docsDir, 'missing') }).checkoutSha, null);
  fs.writeFileSync(eventPath, JSON.stringify({ workflow_run: { ...triggeringRun, event: 'workflow_dispatch' } }));
  assert.equal(githubRunProvenance(dispatchEnv).triggeringRun.event, 'workflow_dispatch', 'manual collectors never count as scheduled');
  fs.writeFileSync(eventPath, JSON.stringify({ workflow_run: { ...triggeringRun, head_repository: { full_name: 'foreign/repo' } } }));
  assert.equal(githubRunProvenance(dispatchEnv).triggeringRun, null);
  fs.writeFileSync(eventPath, '{invalid');
  assert.equal(githubRunProvenance(dispatchEnv).triggeringRun, null);
  assert.equal(githubRunProvenance({ ...dispatchEnv, GITHUB_EVENT_NAME: 'schedule' }).triggeringRun, null);
  writePipelineRunReport(report, { docsDir, historyLimit: 2 });
  const second = buildPipelineRunReport({
    ...report,
    startedAt: '2026-07-27T11:00:00.000Z',
    finishedAt: '2026-07-27T11:00:01.000Z',
  });
  const third = buildPipelineRunReport({
    ...report,
    startedAt: '2026-07-27T12:00:00.000Z',
    finishedAt: '2026-07-27T12:00:01.000Z',
  });
  writePipelineRunReport(second, { docsDir, historyLimit: 2 });
  writePipelineRunReport(third, { docsDir, historyLimit: 2 });

  const paths = pipelineReportPaths('firecrawl4', docsDir);
  const latest = JSON.parse(fs.readFileSync(paths.latestPath, 'utf8'));
  const history = JSON.parse(fs.readFileSync(paths.historyPath, 'utf8'));
  assert.equal(latest.runId, third.runId);
  assert.equal(history.runCount, 2);
  assert.deepEqual(history.runs.map((entry) => entry.runId), [third.runId, second.runId]);
} finally {
  fs.rmSync(docsDir, { recursive: true, force: true });
}

console.log('Pipeline run report tests passed.');

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildPipelineRunReport,
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

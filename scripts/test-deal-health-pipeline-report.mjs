import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const docsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freefinder-health-report-'));
try {
  fs.writeFileSync(path.join(docsDir, 'deals-pending-firecrawl4.json'), JSON.stringify({
    source: 'firecrawl4',
    deals: [{
      id: 'fc4-a',
      brand: 'Cafe Wien',
      title: 'Gratis Kaffee',
      description: 'Gratis Kaffee in Wien',
      category: 'kaffee',
      type: 'gratis',
      distance: 'Wien',
      url: 'https://www.instagram.com/p/ABC123/',
      pubDate: new Date().toISOString(),
    }],
  }));
  fs.writeFileSync(path.join(docsDir, 'deal-pipeline-last-run-firecrawl4.json'), JSON.stringify({
    sourceKey: 'firecrawl4',
    status: 'failed',
    startedAt: '2026-07-27T10:00:00.000Z',
    finishedAt: '2026-07-27T10:00:05.000Z',
    durationMs: 5000,
    counts: {
      rawCandidates: 12,
      acceptedDeals: 0,
    },
    rejectedByReason: {
      'not-free': 12,
    },
    errors: ['test failure'],
  }));

  const result = spawnSync(process.execPath, ['scraper/build-deal-source-health.js'], {
    cwd: path.resolve('.'),
    env: {
      ...process.env,
      DEAL_HEALTH_DOCS_DIR: docsDir,
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);

  const health = JSON.parse(fs.readFileSync(path.join(docsDir, 'deal-source-health.json'), 'utf8'));
  const source = health.sources.find((item) => item.sourceKey === 'firecrawl4');
  assert.equal(source.lastRun.status, 'failed');
  assert.equal(source.lastRun.counts.rawCandidates, 12);
  assert(source.issues.includes('letzter Pipeline-Lauf ist fehlgeschlagen'));
  assert(source.issues.includes('letzter Lauf fand Kandidaten, aber akzeptierte keinen Deal'));
  assert.equal(health.summary.pipelineRuns.reportedSources, 1);
  assert.deepEqual(health.summary.pipelineRuns.failedSources, ['firecrawl4']);
} finally {
  fs.rmSync(docsDir, { recursive: true, force: true });
}

console.log('Deal health pipeline report tests passed.');

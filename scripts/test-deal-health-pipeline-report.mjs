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
      description: 'Gratis Kaffee in Wien \ud83d',
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
  fs.writeFileSync(path.join(docsDir, 'deals-pending-tiktok-browser.json'), JSON.stringify({
    deals: [
      { id: 'admission', title: 'Gratis Eintritt: Museum of Change', category: 'kultur',
        description: 'Heißen Tee einpacken. Kaffee und Kuchen sind separat erhältlich.',
        url: 'https://www.tiktok.com/@venue/video/7709139846413012246' },
      { id: 'bundle', title: 'Museumseintritt inklusive Brunch um 19 €', category: 'kultur',
        description: 'Der Brunch ist im Preis enthalten.',
        url: 'https://www.tiktok.com/@venue/video/7709139846413012247' },
    ],
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
  const tiktok = health.sources.find((item) => item.sourceKey === 'tiktok-browser');
  assert.equal(tiktok.totalDeals, 2);
  assert.equal(tiktok.foodDrinkCount, 1);
  assert.deepEqual(tiktok.topCategories.sort((a, b) => a.value.localeCompare(b.value)), [
    { value: 'essen', count: 1 }, { value: 'kultur', count: 1 },
  ]);

  const candidateIndex = JSON.parse(fs.readFileSync(path.join(docsDir, 'deal-candidates-index.json'), 'utf8'));
  const serializedCandidate = JSON.stringify(candidateIndex.candidates[0]);
  assert.doesNotMatch(serializedCandidate, /\\ud83d(?!\\ud[c-f][0-9a-f]{2})/i, 'candidate index must repair lone Unicode surrogates');
  assert.equal(candidateIndex.candidates.find(candidate => candidate.id === 'admission').hasFoodDrinkSignal, false);
  assert.equal(candidateIndex.candidates.find(candidate => candidate.id === 'bundle').hasFoodDrinkSignal, true);
} finally {
  fs.rmSync(docsDir, { recursive: true, force: true });
}

console.log('Deal health pipeline report tests passed.');

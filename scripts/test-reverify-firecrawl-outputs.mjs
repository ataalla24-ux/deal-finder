import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { reverifyFirecrawlOutputs } from '../scraper/reverify-firecrawl-outputs.js';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'firecrawl-reverify-'));
const outputFile = 'deals-pending-test.json';
const outputPath = path.join(tempDir, outputFile);
const now = new Date('2026-08-23T12:00:00.000Z');

try {
  fs.writeFileSync(outputPath, JSON.stringify({
    source: 'test',
    totalDeals: 2,
    deals: [
      { id: 'keep', title: '1+1 in Wien' },
      { id: 'remove', title: 'Normales Sortiment' },
    ],
  }));

  const summaries = await reverifyFirecrawlOutputs({
    docsDir: tempDir,
    now,
    outputs: [
      { file: outputFile, sourceKey: 'test-source' },
      { file: 'missing.json', sourceKey: 'missing-source' },
    ],
    verifyDeals: async (deals, options) => {
      assert.equal(options.sourceKey, 'test-source');
      assert.equal(options.maxAcceptedAgeDays, 7);
      return deals.filter((deal) => deal.id === 'keep').map((deal) => ({ ...deal, exactEvidenceAligned: true }));
    },
  });

  const updated = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  assert.equal(updated.totalDeals, 1);
  assert.equal(updated.centralReverifiedAt, now.toISOString());
  assert.equal(updated.centralReverifiedFrom, 2);
  assert.deepEqual(updated.deals.map((deal) => deal.id), ['keep']);
  assert.equal(updated.deals[0].exactEvidenceAligned, true);
  assert.deepEqual(summaries, [
    { file: outputFile, status: 'verified', before: 2, after: 1, removed: 1 },
    { file: 'missing.json', status: 'missing', before: 0, after: 0 },
  ]);

  const workflow = fs.readFileSync('.github/workflows/daily-digest.yml', 'utf8');
  const graphStep = workflow.indexOf('Verify fresh Instagram candidates via Graph API');
  const reverifyStep = workflow.indexOf('Reverify Firecrawl outputs');
  const healthStep = workflow.indexOf('Build Deal Source Health');
  assert.ok(graphStep >= 0 && graphStep < reverifyStep && reverifyStep < healthStep);
  for (const file of [
    'docs/deals-pending-gastro2.json',
    'docs/deals-pending-food3.json',
    'docs/deals-pending-firecrawl2.json',
    'docs/deals-pending-firecrawl4.json',
    'docs/deals-pending-firecrawl5.json',
  ]) {
    assert.match(workflow, new RegExp(file.replaceAll('.', '\\.')));
  }
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log('Central Firecrawl re-verification tests passed.');

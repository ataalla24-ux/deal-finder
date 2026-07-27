import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  computeDealsFeedVersion,
  stampDealsFeedBundle,
  stampDealsFeedFile,
} from './deals-feed-contract.mjs';

const deals = [
  { id: 'a', title: 'Deal A' },
  { id: 'b', title: 'Deal B' },
];
const firstVersion = computeDealsFeedVersion(deals);
assert.equal(firstVersion, computeDealsFeedVersion(deals));
assert.notEqual(firstVersion, computeDealsFeedVersion([...deals, { id: 'c', title: 'Deal C' }]));

const stamped = stampDealsFeedBundle({ deals, totalDeals: 99 }, {
  nowIso: '2026-07-27T12:00:00.000Z',
});
assert.equal(stamped.schemaVersion, 1);
assert.equal(stamped.feedVersion, firstVersion);
assert.equal(stamped.totalDeals, 2);
assert.equal(stamped.lastUpdated, '2026-07-27T12:00:00.000Z');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freefinder-feed-contract-'));
try {
  const filePath = path.join(tempDir, 'deals.json');
  fs.writeFileSync(filePath, JSON.stringify({ deals }));
  const fileResult = stampDealsFeedFile(filePath, {
    nowIso: '2026-07-27T13:00:00.000Z',
  });
  const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(onDisk.feedVersion, fileResult.feedVersion);
  assert.equal(onDisk.totalDeals, 2);
  assert.equal(onDisk.lastUpdated, '2026-07-27T13:00:00.000Z');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log('Deals feed contract tests passed.');

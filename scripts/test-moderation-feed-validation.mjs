import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stampDealsFeedBundle } from './deals-feed-contract.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'moderation-validation-'));
const write = (name, data) => fs.writeFileSync(path.join(temp, name), JSON.stringify(data));
try {
  fs.mkdirSync(path.join(temp, 'scripts'));
  fs.mkdirSync(path.join(temp, 'docs'));
  for (const name of ['validate-production-feed.mjs', 'deals-feed-contract.mjs']) {
    fs.copyFileSync(path.join(root, 'scripts', name), path.join(temp, 'scripts', name));
  }
  const good = { id: 'keep', brand: 'Cafe Test', title: 'Gratis Kaffee', description: '',
    url: 'https://example.com/coffee', category: 'kaffee', type: 'gratis', distance: 'Wien', logo: 'C', logoUrl: '' };
  const old = { ...good, id: 'old', category: 'service', expires: '2020-01-01' };
  const removed = { ...good, id: 'remove' };
  const baseline = [good, old, removed];
  write('baseline.json', { deals: baseline });
  const reset = (deals = [good, old]) => {
    write('docs/deals.json', stampDealsFeedBundle({ deals }));
    write('docs/deal-map-locations.json', { locations: [] });
    for (const kind of ['day', 'week']) write(`docs/deal-of-the-${kind}.json`, { ...good, dealId: good.id });
  };
  const run = (args = ['--removal-baseline', path.join(temp, 'baseline.json')]) => spawnSync(process.execPath,
    [path.join(temp, 'scripts/validate-production-feed.mjs'), ...args], { encoding: 'utf8' });
  reset();
  assert.equal(run().status, 0, 'Unchanged pre-existing errors must not block removal');
  assert.notEqual(run([]).status, 0, 'Normal production validation must remain strict');
  reset([good, { ...old, title: 'Changed' }]);
  assert.notEqual(run().status, 0, 'Changed records must fail');
  reset([good, old, { ...good, id: 'new' }]);
  assert.notEqual(run().status, 0, 'New records must fail');
  reset([good, good, old]);
  assert.notEqual(run().status, 0, 'Duplicate IDs must fail');
  reset();
  write('docs/deal-of-the-day.json', { ...removed, dealId: removed.id });
  assert.notEqual(run().status, 0, 'Removed featured references must fail');
  reset();
  write('docs/deal-map-locations.json', { locations: [{ dealIds: [removed.id] }] });
  assert.notEqual(run().status, 0, 'Removed map references must fail');
  reset();
  write('docs/deals.json', { ...stampDealsFeedBundle({ deals: [good, old] }), feedVersion: 'stale' });
  assert.notEqual(run().status, 0, 'Feed version must remain strict');
  console.log('Moderation feed validation: 8 checks passed');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

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
  write('package.json', { type: 'module' });
  for (const name of [
    'scripts/validate-production-feed.mjs', 'scripts/deals-feed-contract.mjs',
    'scripts/add-deal-moderation-entry.mjs', 'scripts/apply-deal-moderation.mjs',
    'scripts/sync-deal-map-references.mjs', 'scripts/sync-featured-deal-references.mjs',
    'scripts/stamp-deals-feed.mjs', 'scraper/public-deal-text.js',
    'scraper/deal-moderation-utils.js', 'scraper/deal-evidence-utils.js',
    'scraper/native-weekly-utils.js',
  ]) {
    fs.mkdirSync(path.dirname(path.join(temp, name)), { recursive: true });
    fs.copyFileSync(path.join(root, name), path.join(temp, name));
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
  const run = (args = ['--removal-baseline', path.join(temp, 'baseline.json')]) => {
    const result = spawnSync(process.execPath,
      [path.join(temp, 'scripts/validate-production-feed.mjs'), ...args], { encoding: 'utf8' });
    const diagnostics = `Validator did not complete:\n${result.stdout}\n${result.stderr}`;
    // A startup/import failure is not evidence that an invalid feed was rejected.
    assert.match(result.stdout, /"totalDeals":\s*\d+/, diagnostics);
    assert.ok(result.status === 0 || result.status === 1, diagnostics);
    if (result.status === 1) assert.match(result.stderr, /ERROR:/, diagnostics);
    return result;
  };
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
  const logoDeal = { ...old, logoUrl: 'https://freefinder.at/assets/brand-logos/existing.png' };
  write('baseline.json', { deals: [good, logoDeal, removed] });
  reset([good, logoDeal]);
  assert.equal(run().status, 0, 'An existing missing logo must not block unrelated removal');
  assert.match(run().stderr, /Existing unchanged logo reference: brand logo file is missing/);
  assert.notEqual(run([]).status, 0, 'Missing logos still fail normal production validation');
  reset([good, { ...logoDeal, logoUrl: 'https://freefinder.at/assets/brand-logos/new.png' }]);
  assert.notEqual(run().status, 0, 'A newly introduced broken logo must fail removal validation');
  reset([good, logoDeal]);
  fs.mkdirSync(path.join(temp, 'docs/assets/brand-logos'), { recursive: true });
  fs.writeFileSync(path.join(temp, 'docs/assets/brand-logos/existing.png'), 'invalid image');
  assert.equal(run().status, 0, 'An existing unreadable logo must not block unrelated removal');
  assert.notEqual(run([]).status, 0, 'Unreadable logos still fail normal production validation');
  const smallPng = Buffer.alloc(24);
  smallPng.write('PNG', 1, 'ascii');
  smallPng.writeUInt32BE(16, 16);
  smallPng.writeUInt32BE(16, 20);
  fs.writeFileSync(path.join(temp, 'docs/assets/brand-logos/existing.png'), smallPng);
  assert.equal(run().status, 0, 'An existing low-resolution logo must not block unrelated removal');
  assert.notEqual(run([]).status, 0, 'Low-resolution logos still fail normal production validation');
  // Exercise the real workflow commands, but only against disposable fixtures.
  const read = (name) => JSON.parse(fs.readFileSync(path.join(temp, name), 'utf8'));
  const cli = (name, env = {}) => {
    const result = spawnSync(process.execPath, [path.join(temp, 'scripts', name)], {
      cwd: temp,
      encoding: 'utf8',
      env: {
        ...process.env,
        DEAL_MODERATION_PATH: path.join(temp, 'docs/deal-moderation.json'),
        DEAL_MODERATION_DOCS_DIR: path.join(temp, 'docs'),
        DEAL_MODERATION_ID: '', DEAL_MODERATION_URL: '', DEAL_MODERATION_IDS: '',
        DEAL_MODERATION_URLS: '', DEAL_MODERATION_PROVIDER: '', DEAL_MODERATION_TEXT: '',
        DEAL_MODERATION_BY: 'isolated-test', DEAL_MODERATION_REASON: 'fixture removal',
        DEAL_MODERATION_APPLY: '0', LIVE_DEAL_REMOVALS_ENABLED: '0',
        LIVE_DEAL_MANUAL_ACTION: '0', ...env,
      },
    });
    assert.equal(result.status, 0, `${name}:\n${result.stdout}\n${result.stderr}`);
  };
  write('baseline.json', { deals: baseline });
  reset(baseline);
  write('docs/deal-moderation.json', {
    blockedIds: [], blockedUrls: [], blockedProviders: [], blockedText: [], hiddenDeals: [],
  });
  write('docs/deals-pending-test.json', { deals: [good, removed] });
  write('docs/deal-map-locations.json', { locations: [{ id: 'fixture-map', dealIds: ['keep', 'remove'] }] });
  for (const kind of ['day', 'week']) write(`docs/deal-of-the-${kind}.json`, { ...removed, dealId: removed.id });
  cli('add-deal-moderation-entry.mjs', { DEAL_MODERATION_ID: removed.id });
  const beforeRemoval = read('docs/deals.json');
  const gates = { DEAL_MODERATION_APPLY: '1', LIVE_DEAL_REMOVALS_ENABLED: '1', LIVE_DEAL_MANUAL_ACTION: '1' };
  for (const gate of Object.keys(gates)) {
    cli('apply-deal-moderation.mjs', { ...gates, [gate]: '0' });
    assert.deepEqual(read('docs/deals.json'), beforeRemoval, `${gate} must block removal`);
  }
  cli('apply-deal-moderation.mjs', gates);
  assert.deepEqual(read('docs/deals.json').deals, [good, old], 'Only the explicit target is removed');
  assert.deepEqual(read('docs/deals-pending-test.json').deals, [good], 'Pending copy cannot republish removed target');
  assert.ok(read('docs/deal-moderation-report.json').removed.some((deal) => deal.id === removed.id), 'Removed record remains in report');
  cli('sync-deal-map-references.mjs');
  cli('sync-featured-deal-references.mjs');
  cli('stamp-deals-feed.mjs');
  assert.deepEqual(read('docs/deal-map-locations.json').locations[0].dealIds, [good.id]);
  for (const kind of ['day', 'week']) assert.equal(read(`docs/deal-of-the-${kind}.json`).dealId, good.id);
  assert.equal(run().status, 0, 'Complete removal pipeline must pass validation');
  cli('apply-deal-moderation.mjs', gates);
  assert.equal(read('docs/deal-moderation-report.json').removedCount, 0, 'Retry must be idempotent');
  assert.deepEqual(read('docs/deals.json').deals, [good, old]);
  console.log('Moderation feed validation: 15 validation cases and isolated removal pipeline passed');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const SCRIPT_PATH = fileURLToPath(new URL('./commit-generated.mjs', import.meta.url));
const FEED = 'docs/deals.json';
const MAP = 'docs/deal-map-locations.json';
const COVERAGE = 'reviews/map-coverage.json';
const OPTIONAL_OUTPUTS = [
  'reviews/map-location-catalog.json',
  'reviews/map-source-address-cache.json',
  'reviews/map-business-campaigns.json',
];
const OUTPUTS = [MAP, COVERAGE, 'reviews/map-geocode-cache.json', ...OPTIONAL_OUTPUTS];
const SOURCE_INPUTS = [
  'scripts/enrich-deal-map.mjs',
  'scripts/deal-map-enrichment.mjs',
  'scripts/deal-map-source-addresses.mjs',
  'scripts/deal-map-business.mjs',
  'scripts/sync-deal-map-references.mjs',
  'scripts/discover-vienna-merchants.mjs',
  'scraper/vienna-merchant-discovery.js',
];
const GIT_ENV = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
  GIT_AUTHOR_NAME: 'Map Consistency Test',
  GIT_AUTHOR_EMAIL: 'map-test@example.com',
  GIT_COMMITTER_NAME: 'Map Consistency Test',
  GIT_COMMITTER_EMAIL: 'map-test@example.com',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_TERMINAL_PROMPT: '0',
  // Even an accidentally inherited URL rewrite cannot send these tests outside the fixture.
  GIT_ALLOW_PROTOCOL: 'file',
};

function run(command, args, cwd, env = {}) {
  const result = spawnSync(command, args, { cwd, env: { ...GIT_ENV, ...env }, encoding: 'utf8' });
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

function write(directory, file, value) {
  const target = path.join(directory, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
}

function commit(directory, message) {
  run('git', ['add', '.'], directory);
  return run('git', ['commit', '-m', message], directory);
}

function fixture(t, { optionalInputs = false, largeCache = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'map-commit-consistency-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const seed = path.join(root, 'seed');
  const remote = path.join(root, 'remote.git');
  const local = path.join(root, 'local');
  const concurrent = path.join(root, 'concurrent');
  fs.mkdirSync(seed);
  run('git', ['init', '--initial-branch=main'], seed);
  write(seed, FEED, { deals: [{ id: 'base', title: 'Base deal' }] });
  write(seed, MAP, { locations: [] });
  write(seed, COVERAGE, { totalDeals: 1 });
  write(seed, 'reviews/map-addresses.json', {});
  write(seed, 'reviews/map-geocode-cache.json', {});
  write(seed, 'docs/deals-pending-all.json', { deals: [{ id: 'old', slackTs: '100.1' }] });
  write(seed, 'README.md', 'Unrelated main state\n');
  if (optionalInputs) for (const file of OPTIONAL_OUTPUTS) write(seed, file, {});
  if (largeCache) write(seed, 'reviews/map-source-address-cache.json', { fixture: 'x'.repeat(2 * 1024 * 1024) });
  for (const file of SOURCE_INPUTS) write(seed, file, '// Map source version 1\n');

  // Local hooks deliberately have no network or live-data dependencies. The map
  // hook records the exact feed bytes it read, including stamping/sanitization.
  write(seed, 'scripts/enrich-deal-map.mjs', `
import fs from 'node:fs';
import { createHash } from 'node:crypto';
const text = fs.readFileSync('docs/deals.json', 'utf8');
const feed = JSON.parse(text);
if (!feed.feedVersion) throw new Error('Map hook ran before feed stamping');
const result = { feedHash: createHash('sha256').update(text).digest('hex'),
  feedVersion: feed.feedVersion, dealIds: feed.deals.map(deal => deal.id) };
for (const file of ${JSON.stringify(OUTPUTS)}) fs.writeFileSync(file, JSON.stringify(result) + '\\n');
`);
  write(seed, 'scripts/sync-deal-guides.mjs', `
import fs from 'node:fs';
fs.writeFileSync('reviews/deal-guide-candidates.json', '{"candidates":[]}\\n');
`);
  write(seed, 'scripts/sync-featured-deal-references.mjs', `
import fs from 'node:fs';
for (const file of ['docs/deal-of-the-day.json', 'docs/deal-of-the-week.json']) {
  fs.writeFileSync(file, '{"id":"local"}\\n');
}
`);
  write(seed, 'scripts/generate-seo-deals-page.mjs', `
import fs from 'node:fs';
fs.writeFileSync('docs/angebote-wien-heute.html', '<html>Local fixture</html>\\n');
fs.writeFileSync('docs/sitemap.xml', '<urlset/>\\n');
`);
  commit(seed, 'seed map inputs');
  run('git', ['init', '--bare', '--initial-branch=main', remote], root);
  run('git', ['remote', 'add', 'origin', remote], seed);
  run('git', ['push', '-u', 'origin', 'main'], seed);
  run('git', ['clone', '--branch', 'main', remote, local], root);
  run('git', ['clone', '--branch', 'main', remote, concurrent], root);
  return { root, remote, local, concurrent };
}

function remoteHead(f) {
  return run('git', ['rev-parse', 'refs/heads/main'], f.remote);
}

function remoteText(f, file) {
  return run('git', ['show', `refs/heads/main:${file}`], f.remote);
}

function publishRemote(f, file, value) {
  if (value === null) fs.rmSync(path.join(f.concurrent, file));
  else write(f.concurrent, file, value);
  commit(f.concurrent, `concurrent ${file}`);
  run('git', ['push', 'origin', 'main'], f.concurrent);
}

function generate(f, files = [MAP, COVERAGE], flags = []) {
  const result = spawnSync(process.execPath, [SCRIPT_PATH, '--message', 'generated map fixture',
    '--remote', 'origin', '--branch', 'main', '--retries', '0', ...flags, '--files', ...files], {
    cwd: f.local, env: { ...GIT_ENV, PATH: f.gitPath || GIT_ENV.PATH }, encoding: 'utf8',
  });
  return { ...result, output: `${result.stdout}\n${result.stderr}` };
}

function expectRejected(f, result, previousHead, file) {
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /Map input consistency check failed/);
  assert.match(result.output, /Rerun this workflow/);
  assert.ok(result.output.includes(file), result.output);
  assert.equal(remoteHead(f), previousHead, 'must not publish any part of the rejected batch');
}

function changeMap(f, files = [MAP, COVERAGE]) {
  for (const file of files) write(f.local, file, { generated: 'local' });
}

const conflictModes = [[], ['--skip-conflicts'], ['--replace-conflicts'], ['--skip-conflicts', '--replace-conflicts']];
for (const flags of conflictModes) {
  test(`map-only stale feed cannot bypass the guard: ${flags.join(' ') || 'default'}`, t => {
    const f = fixture(t);
    changeMap(f);
    publishRemote(f, FEED, { deals: [{ id: 'remote' }] });
    const head = remoteHead(f);
    expectRejected(f, generate(f, [MAP, COVERAGE], flags), head, FEED);
  });

  test(`feed/map batch is atomic when remote feed moved: ${flags.join(' ') || 'default'}`, t => {
    const f = fixture(t);
    write(f.local, FEED, { deals: [{ id: 'local', title: 'Local deal' }] });
    write(f.local, 'docs/deals-pending-all.json', { deals: [{ id: 'new-local' }] });
    publishRemote(f, FEED, { deals: [{ id: 'remote' }] });
    const head = remoteHead(f);
    expectRejected(f, generate(f, [FEED, 'docs/deals-pending-all.json'], flags), head, FEED);
    assert.deepEqual(JSON.parse(remoteText(f, 'docs/deals-pending-all.json')).deals, [{ id: 'old', slackTs: '100.1' }]);
  });
}

for (const file of ['reviews/map-addresses.json', 'reviews/map-geocode-cache.json', MAP, ...OPTIONAL_OUTPUTS, ...SOURCE_INPUTS]) {
  test(`coverage-only job rejects remote input changes: ${file}`, t => {
    const f = fixture(t);
    changeMap(f, [COVERAGE]);
    publishRemote(f, file, file.endsWith('.json') ? { changed: 'remote' } : '// Map source version 2\n');
    const head = remoteHead(f);
    expectRejected(f, generate(f, [COVERAGE], ['--replace-conflicts']), head, file);
  });
}

for (const file of [FEED, 'reviews/map-addresses.json', ...OPTIONAL_OUTPUTS]) {
  test(`missing/deleted remote inputs are not ignored: ${file}`, t => {
    const f = fixture(t, { optionalInputs: true });
    changeMap(f);
    publishRemote(f, file, null);
    const head = remoteHead(f);
    expectRejected(f, generate(f), head, file);
  });
}

test('map-only batch can cross unrelated main changes with optional inputs absent', t => {
  const f = fixture(t);
  changeMap(f);
  publishRemote(f, 'README.md', 'Keep this remote documentation edit\n');
  const base = remoteHead(f);
  const result = generate(f);
  assert.equal(result.status, 0, result.output);
  assert.equal(run('git', ['rev-parse', 'refs/heads/main^'], f.remote), base);
  assert.equal(remoteText(f, 'README.md'), 'Keep this remote documentation edit');
  assert.deepEqual(JSON.parse(remoteText(f, MAP)), { generated: 'local' });
  assert.deepEqual(JSON.parse(remoteText(f, COVERAGE)), { generated: 'local' });
});

test('large unchanged source caches do not break map-only writers', t => {
  const f = fixture(t, { largeCache: true });
  changeMap(f);
  const result = generate(f);
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(JSON.parse(remoteText(f, MAP)), { generated: 'local' });
});

test('feed writers retain the final stamped feed and every map hook output', t => {
  const f = fixture(t);
  write(f.local, FEED, { deals: [{ id: 'local', title: 'Cafe (manual review required)' }] });
  publishRemote(f, 'README.md', 'Concurrent unrelated edit\n');
  const result = generate(f, [FEED], ['--skip-conflicts']);
  assert.equal(result.status, 0, result.output);
  const feedText = `${remoteText(f, FEED)}\n`;
  const feed = JSON.parse(feedText);
  assert.ok(feed.feedVersion);
  assert.equal(feed.deals[0].title, 'Cafe');
  for (const file of OUTPUTS) {
    const output = JSON.parse(remoteText(f, file));
    assert.equal(output.feedHash, createHash('sha256').update(feedText).digest('hex'), file);
    assert.equal(output.feedVersion, feed.feedVersion, file);
    assert.deepEqual(output.dealIds, ['local'], file);
  }
  assert.equal(remoteText(f, 'README.md'), 'Concurrent unrelated edit');
  assert.match(remoteText(f, 'docs/angebote-wien-heute.html'), /Local fixture/);
});

for (const file of [FEED, 'reviews/map-addresses.json', ...OPTIONAL_OUTPUTS, 'scripts/deal-map-enrichment.mjs']) {
  test(`uncommitted input omitted from map batch is rejected: ${file}`, t => {
    const f = fixture(t);
    changeMap(f);
    write(f.local, file, file.endsWith('.json') ? { local: 'not retained' } : '// Uncommitted policy\n');
    const head = remoteHead(f);
    expectRejected(f, generate(f, [MAP, COVERAGE], ['--replace-conflicts']), head, file);
  });
}

test('local reviewed inputs can be retained in the same map batch', t => {
  const f = fixture(t);
  changeMap(f);
  write(f.local, 'reviews/map-addresses.json', { local: 'reviewed address' });
  const result = generate(f, [MAP, COVERAGE, 'reviews/map-addresses.json']);
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(JSON.parse(remoteText(f, 'reviews/map-addresses.json')), { local: 'reviewed address' });
});

test('skipping a conflicting coverage output cannot publish a partial map batch', t => {
  const f = fixture(t);
  changeMap(f);
  publishRemote(f, COVERAGE, { generated: 'remote' });
  const head = remoteHead(f);
  expectRejected(f, generate(f, [MAP, COVERAGE], ['--skip-conflicts']), head, COVERAGE);
});

test('a later hook cannot change the feed after the map has read it', t => {
  const f = fixture(t);
  write(f.local, FEED, { deals: [{ id: 'local' }] });
  write(f.local, 'scripts/sync-featured-deal-references.mjs', `
import fs from 'node:fs';
fs.writeFileSync('docs/deals.json', '{"deals":[{"id":"too-late"}]}\\n');
`);
  const head = remoteHead(f);
  expectRejected(f, generate(f, [FEED]), head, FEED);
});

function arrangePushRace(f, file) {
  write(f.concurrent, file, file === FEED ? { deals: [{ id: 'raced' }] } : 'Raced unrelated edit\n');
  commit(f.concurrent, 'move main during first push');
  const racedHead = run('git', ['rev-parse', 'HEAD'], f.concurrent);
  const hooks = path.join(f.root, 'hooks');
  const marker = path.join(f.root, 'push-race-done');
  const hook = `#!${process.execPath}
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
if (!fs.existsSync(${JSON.stringify(marker)})) {
  fs.writeFileSync(${JSON.stringify(marker)}, 'raced');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  env.GIT_ALLOW_PROTOCOL = 'file';
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_CONFIG_GLOBAL = ${JSON.stringify(os.devNull)};
  const result = spawnSync('git', ['push', 'origin', 'main'], {
    cwd: ${JSON.stringify(f.concurrent)}, env, encoding: 'utf8'
  });
  if (result.status !== 0) { console.error(result.stderr); process.exit(1); }
}
`;
  write(f.root, 'hooks/package.json', { type: 'module' });
  write(f.root, 'hooks/pre-push', hook);
  fs.chmodSync(path.join(hooks, 'pre-push'), 0o755);
  run('git', ['config', 'core.hooksPath', hooks], f.local);
  return racedHead;
}

for (const flags of [[], ['--skip-conflicts'], ['--replace-conflicts']]) {
  test(`push retry rechecks original input hashes: ${flags.join(' ') || 'default'}`, t => {
    const f = fixture(t);
    changeMap(f);
    const racedHead = arrangePushRace(f, FEED);
    const result = generate(f, [MAP, COVERAGE], ['--retries', '1', ...flags]);
    assert.match(result.output, /Push attempt 1 failed/);
    expectRejected(f, result, racedHead, FEED);
    assert.deepEqual(JSON.parse(remoteText(f, MAP)), { locations: [] });
  });
}

test('push retry permits unrelated main movement and retains the map batch', t => {
  const f = fixture(t);
  changeMap(f);
  const racedHead = arrangePushRace(f, 'README.md');
  const result = generate(f, [MAP, COVERAGE], ['--retries', '1']);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /Push attempt 1 failed/);
  assert.equal(run('git', ['rev-parse', 'refs/heads/main^'], f.remote), racedHead);
  assert.equal(remoteText(f, 'README.md'), 'Raced unrelated edit');
  assert.deepEqual(JSON.parse(remoteText(f, MAP)), { generated: 'local' });
});

test('tree creation stays pinned if another fetch moves the checked remote-tracking ref', t => {
  const f = fixture(t);
  changeMap(f);
  write(f.concurrent, FEED, { deals: [{ id: 'raced' }] });
  commit(f.concurrent, 'move main after map input checks');
  const racedHead = run('git', ['rev-parse', 'HEAD'], f.concurrent);
  const marker = path.join(f.root, 'read-tree-race');
  write(f.root, 'bin/package.json', { type: 'module' });
  write(f.root, 'bin/git', `#!${process.execPath}
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2);
const env = { ...process.env, PATH: ${JSON.stringify(GIT_ENV.PATH)} };
if (args[0] === 'read-tree' && !fs.existsSync(${JSON.stringify(marker)})) {
  fs.writeFileSync(${JSON.stringify(marker)}, 'raced');
  const cleanEnv = { ...env };
  delete cleanEnv.GIT_INDEX_FILE;
  for (const [cwd, command] of [
    [${JSON.stringify(f.concurrent)}, ['push', 'origin', 'main']],
    [${JSON.stringify(f.local)}, ['fetch', 'origin', '+refs/heads/main:refs/remotes/origin/main']],
  ]) {
    const result = spawnSync('git', command, { cwd, env: cleanEnv, encoding: 'utf8' });
    if (result.status !== 0) { console.error(result.stderr); process.exit(1); }
  }
}
const result = spawnSync('git', args, { env, stdio: 'inherit' });
process.exit(result.status ?? 1);
`);
  fs.chmodSync(path.join(f.root, 'bin/git'), 0o755);
  f.gitPath = `${path.join(f.root, 'bin')}${path.delimiter}${GIT_ENV.PATH}`;
  const result = generate(f, [MAP, COVERAGE], ['--retries', '1']);
  assert.match(result.output, /Push attempt 1 failed/);
  expectRejected(f, result, racedHead, FEED);
  assert.deepEqual(JSON.parse(remoteText(f, MAP)), { locations: [] });
});

test('queue three-way conflict merging still works in a valid map batch', t => {
  const f = fixture(t);
  changeMap(f);
  publishRemote(f, 'docs/deals-pending-all.json', { deals: [{ id: 'remote-new', slackTs: '200.1' }] });
  write(f.local, 'docs/deals-pending-all.json', { deals: [
    { id: 'old', slackTs: '100.1' }, { id: 'local-new', slackTs: '300.1' },
  ] });
  const result = generate(f, [MAP, COVERAGE, 'docs/deals-pending-all.json'], ['--skip-conflicts']);
  assert.equal(result.status, 0, result.output);
  const queue = JSON.parse(remoteText(f, 'docs/deals-pending-all.json'));
  assert.deepEqual(queue.deals.map(deal => deal.id).sort(), ['local-new', 'remote-new']);
  assert.equal(queue.totalDeals, 2);
});

test('queue-only writers ignore map input drift entirely', t => {
  const f = fixture(t);
  publishRemote(f, FEED, { deals: [{ id: 'remote' }] });
  write(f.local, 'docs/deals-pending-all.json', { deals: [{ id: 'local-new' }] });
  const result = generate(f, ['docs/deals-pending-all.json'], ['--skip-conflicts']);
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(JSON.parse(remoteText(f, FEED)).deals, [{ id: 'remote' }]);
  assert.deepEqual(JSON.parse(remoteText(f, 'docs/deals-pending-all.json')).deals, [{ id: 'local-new' }]);
});

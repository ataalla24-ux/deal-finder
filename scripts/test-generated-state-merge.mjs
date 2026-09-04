import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT_PATH = path.resolve('scripts/commit-generated.mjs');
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Merge Test',
  GIT_AUTHOR_EMAIL: 'merge-test@example.com',
  GIT_COMMITTER_NAME: 'Merge Test',
  GIT_COMMITTER_EMAIL: 'merge-test@example.com',
};

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, env: GIT_ENV, encoding: 'utf8' });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`,
  );
  return result.stdout;
}

function writeQueue(directory, deals, updatedAt) {
  const docsDir = path.join(directory, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, 'deals-pending-all.json'), `${JSON.stringify({
    deals,
    totalDeals: deals.length,
    updatedAt,
  }, null, 2)}\n`);
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'generated-state-merge-'));
const seedDir = path.join(tempDir, 'seed');
const remoteDir = path.join(tempDir, 'remote.git');
const localDir = path.join(tempDir, 'local');
const concurrentDir = path.join(tempDir, 'concurrent');
const verifyDir = path.join(tempDir, 'verify');
const replaceVerifyDir = path.join(tempDir, 'replace-verify');

try {
  fs.mkdirSync(seedDir, { recursive: true });
  run('git', ['init', '--initial-branch=main'], seedDir);
  writeQueue(seedDir, [{ id: 'approved-old', slackTs: '100.1', title: 'Old queue row' }], '2026-08-22T09:00:00.000Z');
  run('git', ['add', 'docs/deals-pending-all.json'], seedDir);
  run('git', ['commit', '-m', 'seed queue'], seedDir);
  fs.mkdirSync(remoteDir, { recursive: true });
  run('git', ['init', '--bare'], remoteDir);
  run('git', ['remote', 'add', 'origin', remoteDir], seedDir);
  run('git', ['push', '-u', 'origin', 'main'], seedDir);

  run('git', ['clone', '--branch', 'main', remoteDir, localDir], tempDir);
  run('git', ['clone', '--branch', 'main', remoteDir, concurrentDir], tempDir);

  // A concurrent approval removes the old row and another source adds a row.
  writeQueue(concurrentDir, [{ id: 'remote-new', slackTs: '200.1', title: 'Remote deal' }], '2026-08-22T10:00:00.000Z');
  run('git', ['add', 'docs/deals-pending-all.json'], concurrentDir);
  run('git', ['commit', '-m', 'approve old and add remote'], concurrentDir);
  run('git', ['push', 'origin', 'main'], concurrentDir);

  // This stale checkout posts a different new deal while still containing the
  // now-approved row. The three-way merge must not resurrect that old row.
  writeQueue(localDir, [
    { id: 'approved-old', slackTs: '100.1', title: 'Old queue row' },
    { id: 'local-new', slackTs: '300.1', title: 'Local deal' },
  ], '2026-08-22T11:00:00.000Z');
  run(process.execPath, [
    SCRIPT_PATH,
    '--skip-conflicts',
    '--message',
    'merge generated queue',
    '--remote',
    'origin',
    '--branch',
    'main',
    '--files',
    'docs/deals-pending-all.json',
  ], localDir);

  run('git', ['clone', '--branch', 'main', remoteDir, verifyDir], tempDir);
  const payload = JSON.parse(fs.readFileSync(path.join(verifyDir, 'docs/deals-pending-all.json'), 'utf8'));
  assert.deepEqual(payload.deals.map((deal) => deal.id).sort(), ['local-new', 'remote-new']);
  assert.equal(payload.totalDeals, 2);

  // A source-owned collector may intentionally replace its own generated file
  // even if a verifier enriched the previous version while the collector ran.
  writeQueue(verifyDir, [{ id: 'remote-verification', title: 'Concurrent verifier output' }], '2026-08-22T12:00:00.000Z');
  run('git', ['add', 'docs/deals-pending-all.json'], verifyDir);
  run('git', ['commit', '-m', 'concurrent verifier output'], verifyDir);
  run('git', ['push', 'origin', 'main'], verifyDir);

  writeQueue(localDir, [{ id: 'source-owned', title: 'Fresh collector output' }], '2026-08-22T13:00:00.000Z');
  run(process.execPath, [
    SCRIPT_PATH,
    '--replace-conflicts',
    '--message',
    'replace source-owned generated state',
    '--remote',
    'origin',
    '--branch',
    'main',
    '--files',
    'docs/deals-pending-all.json',
  ], localDir);

  run('git', ['clone', '--branch', 'main', remoteDir, replaceVerifyDir], tempDir);
  const replacedPayload = JSON.parse(fs.readFileSync(path.join(replaceVerifyDir, 'docs/deals-pending-all.json'), 'utf8'));
  assert.deepEqual(replacedPayload.deals.map((deal) => deal.id), ['source-owned']);
  assert.equal(replacedPayload.totalDeals, 1);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log('generated state three-way merge tests passed');

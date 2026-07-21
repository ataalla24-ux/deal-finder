import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const workflowsDir = path.join(root, '.github', 'workflows');
const sharedQueueGroup = 'deal-pending-all-queue';

const queueWriterFiles = fs.readdirSync(workflowsDir)
  .filter((file) => /\.ya?ml$/i.test(file))
  .filter((file) => {
    const text = fs.readFileSync(path.join(workflowsDir, file), 'utf8');
    return text.includes('docs/deals-pending-all.json')
      || /docs\/deals-pending-\*\.json/.test(text);
  })
  .sort();

assert.deepEqual(queueWriterFiles, [
  'apify-instagram-daily.yml',
  'approve-deals.yml',
  'community-submissions.yml',
  'daily-digest.yml',
  'deal-moderation.yml',
  'instagram-ai-agent.yml',
  'meta-instagram-deals.yml',
  'tiktok-deals.yml',
]);

for (const file of queueWriterFiles) {
  assert.doesNotMatch(file, /firecrawl/i, 'Firecrawl workflows are outside the queue-writer lock change');
  const text = fs.readFileSync(path.join(workflowsDir, file), 'utf8');
  const concurrency = text.match(/(?:^|\n)concurrency:\s*\n\s+group:\s*([^\n]+)\n\s+cancel-in-progress:\s*([^\n]+)/);
  assert.ok(concurrency, `${file} must define top-level queue concurrency`);
  assert.equal(concurrency[1].trim(), sharedQueueGroup, `${file} must use the shared queue group`);
  assert.equal(concurrency[2].trim(), 'false', `${file} must never cancel an active queue writer`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      ...(options.env || {}),
    },
    encoding: 'utf8',
  });
  if (!options.allowFailure && result.status !== 0) {
    throw new Error([
      `${command} ${args.join(' ')} failed with ${result.status}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }
  return result;
}

function writeQueue(repoPath, ids) {
  const docsDir = path.join(repoPath, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  const deals = ids.map((id) => ({
    id,
    title: `Deal ${id}`,
    url: `https://example.com/${id}`,
    slackTs: `1784550000.${id.charCodeAt(0)}`,
  }));
  fs.writeFileSync(path.join(docsDir, 'deals-pending-all.json'), `${JSON.stringify({
    deals,
    totalDeals: deals.length,
  }, null, 2)}\n`);
}

function configureGit(repoPath) {
  run('git', ['config', 'user.name', 'Queue Safety Test'], { cwd: repoPath });
  run('git', ['config', 'user.email', 'queue-safety@example.test'], { cwd: repoPath });
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deal-queue-race-test-'));
try {
  const remotePath = path.join(tempRoot, 'remote.git');
  const seedPath = path.join(tempRoot, 'seed');
  const approvalJobPath = path.join(tempRoot, 'approval-job');
  const concurrentJobPath = path.join(tempRoot, 'concurrent-job');

  run('git', ['init', '--bare', remotePath]);
  run('git', ['init', seedPath]);
  configureGit(seedPath);
  run('git', ['checkout', '-b', 'main'], { cwd: seedPath });
  writeQueue(seedPath, ['a', 'b']);
  run('git', ['add', 'docs/deals-pending-all.json'], { cwd: seedPath });
  run('git', ['commit', '-m', 'seed queue'], { cwd: seedPath });
  run('git', ['remote', 'add', 'origin', remotePath], { cwd: seedPath });
  run('git', ['push', '-u', 'origin', 'main'], { cwd: seedPath });

  run('git', ['clone', '--branch', 'main', remotePath, approvalJobPath]);
  run('git', ['clone', '--branch', 'main', remotePath, concurrentJobPath]);
  configureGit(approvalJobPath);
  configureGit(concurrentJobPath);

  // Approval removes A locally while another workflow adds C remotely.
  writeQueue(approvalJobPath, ['b']);
  writeQueue(concurrentJobPath, ['a', 'b', 'c']);
  run('git', ['add', 'docs/deals-pending-all.json'], { cwd: concurrentJobPath });
  run('git', ['commit', '-m', 'concurrent queue addition'], { cwd: concurrentJobPath });
  run('git', ['push', 'origin', 'main'], { cwd: concurrentJobPath });

  const commitAttempt = run(process.execPath, [
    path.join(root, 'scripts', 'commit-generated.mjs'),
    '--message',
    'approval removes A',
    '--branch',
    'main',
    '--retries',
    '0',
    '--files',
    'docs/deals-pending-all.json',
  ], {
    cwd: approvalJobPath,
    allowFailure: true,
    env: {
      GIT_GENERATED_BRANCH: 'main',
      GIT_GENERATED_PUSH_RETRIES: '0',
    },
  });

  assert.notEqual(commitAttempt.status, 0, 'a same-file remote queue change must abort the generated commit');
  assert.match(
    `${commitAttempt.stdout}\n${commitAttempt.stderr}`,
    /Remote changed the same generated file\(s\).*docs\/deals-pending-all\.json.*Rerun this workflow/s,
  );

  const remoteQueueRaw = run('git', [
    '--git-dir',
    remotePath,
    'show',
    'main:docs/deals-pending-all.json',
  ]).stdout;
  const remoteQueue = JSON.parse(remoteQueueRaw);
  assert.deepEqual(remoteQueue.deals.map((deal) => deal.id), ['a', 'b', 'c']);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log('queue workflow safety ok');

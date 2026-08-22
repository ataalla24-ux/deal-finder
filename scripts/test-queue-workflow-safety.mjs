import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const workflowsDir = path.join(root, '.github', 'workflows');
const workflowFiles = fs.readdirSync(workflowsDir)
  .filter((file) => /\.ya?ml$/i.test(file))
  .sort();
const workflows = new Map(workflowFiles.map((file) => [
  file,
  fs.readFileSync(path.join(workflowsDir, file), 'utf8'),
]));

function concurrencyFor(file) {
  const text = workflows.get(file) || '';
  const match = text.match(/(?:^|\n)concurrency:\s*\n\s+group:\s*([^\n]+)\n\s+cancel-in-progress:\s*([^\n]+)/);
  assert.ok(match, `${file} must define top-level concurrency`);
  assert.equal(match[2].trim(), 'false', `${file} must never cancel its active run`);
  return match[1].trim();
}

const slackDealPublishers = workflowFiles.filter((file) => (
  workflows.get(file).includes('node scraper/slack-notify.js')
));
assert.deepEqual(slackDealPublishers, ['daily-digest.yml'], 'only the central dispatch may publish deals to Slack');
const communityAcknowledgeWorkflows = workflowFiles.filter((file) => (
  workflows.get(file).includes('node scraper/ack-community-submissions.js')
));
assert.deepEqual(communityAcknowledgeWorkflows, ['daily-digest.yml']);

const slackNotifySource = fs.readFileSync(path.join(root, 'scraper', 'slack-notify.js'), 'utf8');
assert.match(
  slackNotifySource,
  /EXCLUDED_PENDING_FILES[\s\S]*deals-pending-instagram-verified\.json/,
  'the stale derived Instagram aggregate must not duplicate raw collector inputs',
);

const centralDispatch = workflows.get('daily-digest.yml');
assert.match(centralDispatch, /name:\s*["']Central Deal Dispatch["']/);
assert.match(centralDispatch, /cron:\s*['"]7,22,37,52 \* \* \* \*['"]/);
assert.equal(concurrencyFor('daily-digest.yml'), 'deal-state-writer');
assert.ok(
  centralDispatch.indexOf('node scraper/slack-notify.js')
    < centralDispatch.indexOf('node scraper/ack-community-submissions.js'),
  'community submissions must only be acknowledged after central Slack publishing',
);
assert.match(centralDispatch, /commit-generated\.mjs --skip-conflicts/);

const collectors = new Map([
  ['apify-instagram-daily.yml', 'apify-instagram-scan'],
  ['community-submissions.yml', 'community-intake'],
  ['flights-vienna.yml', 'flights-vienna-scan'],
  ['instagram-ai-agent.yml', 'instagram-ai-scan'],
  ['meta-instagram-deals.yml', 'meta-instagram-scan'],
  ['power-scraper.yml', 'power-scraper'],
  ['tiktok-deals.yml', 'tiktok-deal-scan'],
  ['wien-deals-combined.yml', 'wien-deals-combined'],
]);
for (const [file, expectedGroup] of collectors) {
  const text = workflows.get(file) || '';
  assert.equal(concurrencyFor(file), expectedGroup, `${file} must run independently`);
  assert.doesNotMatch(text, /scraper\/slack-notify\.js/, `${file} must not publish deals directly`);
  assert.doesNotMatch(text, /docs\/deals-pending-all\.json/, `${file} must not write the shared queue`);
}

const queueWriterFiles = workflowFiles.filter((file) => {
  const text = workflows.get(file);
  return text.includes('docs/deals-pending-all.json')
    || /docs\/deals-pending-\*\.json/.test(text);
});

assert.deepEqual(queueWriterFiles, [
  'approve-deals.yml',
  'daily-digest.yml',
  'deal-moderation.yml',
]);
const sharedStateWriters = [
  'approve-deals.yml',
  'daily-digest.yml',
  'deal-moderation.yml',
  'live-deal-edit.yml',
  'smart-summary.yml',
  'validate-live-deals.yml',
];
for (const file of sharedStateWriters) {
  assert.equal(concurrencyFor(file), 'deal-state-writer', `${file} must serialize shared deal state writes`);
  assert.match(
    workflows.get(file) || '',
    /uses:\s*actions\/checkout@v4[\s\S]{0,180}\n\s+ref:\s*main(?:\s|$)/,
    `${file} must checkout the latest main after waiting for the shared writer lock`,
  );
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

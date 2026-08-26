#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

import { stampDealsFeedFile } from './deals-feed-contract.mjs';

const DEFAULT_REMOTE = process.env.GIT_GENERATED_REMOTE || 'origin';
const DEFAULT_BRANCH = process.env.GIT_GENERATED_BRANCH || process.env.GITHUB_REF_NAME || 'main';
const DEFAULT_RETRIES = Number(process.env.GIT_GENERATED_PUSH_RETRIES || 4);
const DEFAULT_AUTHOR_NAME = process.env.GIT_AUTHOR_NAME || process.env.GIT_COMMITTER_NAME || 'Deal Bot';
const DEFAULT_AUTHOR_EMAIL = process.env.GIT_AUTHOR_EMAIL || process.env.GIT_COMMITTER_EMAIL || 'bot@freefinder.wien';

function cleanText(value) {
  return String(value || '').trim();
}

function runGit(args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...(options.env || {}),
    },
    encoding: options.binary ? null : 'utf8',
  });
  return result;
}

function gitOutput(args, options = {}) {
  const result = runGit(args, options);
  if (result.status !== 0) {
    const stderr = options.binary ? result.stderr?.toString('utf8') : result.stderr;
    throw new Error(`git ${args.join(' ')} failed: ${cleanText(stderr)}`);
  }
  return result.stdout;
}

function parseArgs(argv) {
  const parsed = {
    message: '',
    remote: DEFAULT_REMOTE,
    branch: DEFAULT_BRANCH,
    retries: Number.isFinite(DEFAULT_RETRIES) && DEFAULT_RETRIES >= 0 ? DEFAULT_RETRIES : 4,
    skipConflicts: false,
    patterns: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--message' || arg === '-m') {
      parsed.message = cleanText(argv[i + 1]);
      i += 1;
    } else if (arg === '--remote') {
      parsed.remote = cleanText(argv[i + 1]) || parsed.remote;
      i += 1;
    } else if (arg === '--branch') {
      parsed.branch = cleanText(argv[i + 1]) || parsed.branch;
      i += 1;
    } else if (arg === '--retries') {
      const retries = Number(argv[i + 1]);
      parsed.retries = Number.isFinite(retries) && retries >= 0 ? retries : parsed.retries;
      i += 1;
    } else if (arg === '--skip-conflicts') {
      parsed.skipConflicts = true;
    } else if (arg === '--files') {
      continue;
    } else {
      parsed.patterns.push(arg);
    }
  }

  if (!parsed.message) {
    throw new Error('Missing --message "Commit message"');
  }
  if (parsed.patterns.length === 0) {
    throw new Error('Missing --files <path> [path...]');
  }
  return parsed;
}

function normalizeRepoPath(value) {
  return cleanText(value)
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '');
}

function isGlobPattern(value) {
  return /[*?[\]]/.test(value);
}

function statusChanged(filePath) {
  const result = runGit(['status', '--porcelain', '--', filePath]);
  return result.status === 0 && cleanText(result.stdout).length > 0;
}

function listChangedPathspec(pattern) {
  const normalized = normalizeRepoPath(pattern);
  if (!normalized) return [];
  if (!isGlobPattern(normalized)) {
    return statusChanged(normalized) ? [normalized] : [];
  }

  const result = runGit(['ls-files', '-m', '-o', '-d', '--exclude-standard', '--', normalized]);
  if (result.status !== 0) return [];
  return result.stdout
    .split(/\r?\n/)
    .map(normalizeRepoPath)
    .filter(Boolean);
}

function uniqueChangedFiles(patterns) {
  const files = new Set();
  for (const pattern of patterns) {
    for (const file of listChangedPathspec(pattern)) files.add(file);
  }
  return [...files].sort((left, right) => left.localeCompare(right));
}

function captureFile(filePath) {
  const absolutePath = path.join(process.cwd(), filePath);
  if (!fs.existsSync(absolutePath)) {
    return {
      path: filePath,
      exists: false,
      mode: '100644',
      content: Buffer.alloc(0),
    };
  }

  const stat = fs.statSync(absolutePath);
  if (!stat.isFile()) return null;
  const modeResult = runGit(['ls-files', '-s', '--', filePath]);
  const modeMatch = modeResult.status === 0 ? cleanText(modeResult.stdout).match(/^(\d{6})\s/) : null;
  return {
    path: filePath,
    exists: true,
    mode: modeMatch?.[1] || (stat.mode & 0o111 ? '100755' : '100644'),
    content: fs.readFileSync(absolutePath),
  };
}

function captureFiles(files) {
  return files.map(captureFile).filter(Boolean);
}

function remoteRef(remote, branch) {
  return `refs/remotes/${remote}/${branch}`;
}

function fetchRemote(remote, branch) {
  const result = runGit(['fetch', '--no-tags', remote, `+refs/heads/${branch}:${remoteRef(remote, branch)}`]);
  if (result.status !== 0) {
    throw new Error(`git fetch failed: ${cleanText(result.stderr)}`);
  }
}

function pathChangedBetween(baseRef, headRef, filePath) {
  const result = runGit(['diff', '--quiet', baseRef, headRef, '--', filePath]);
  if (result.status === 0) return false;
  if (result.status === 1) return true;
  throw new Error(`git diff failed for ${filePath}: ${cleanText(result.stderr)}`);
}

function remoteFileContent(ref, filePath) {
  const result = runGit(['show', `${ref}:${filePath}`], { binary: true });
  if (result.status !== 0) return null;
  return Buffer.from(result.stdout);
}

function capturedMatchesRemote(state, ref) {
  const remoteContent = remoteFileContent(ref, state.path);
  if (!state.exists) return remoteContent === null;
  return remoteContent !== null && Buffer.compare(state.content, remoteContent) === 0;
}

function latestIso(left, right) {
  const leftTimestamp = Date.parse(cleanText(left));
  const rightTimestamp = Date.parse(cleanText(right));
  if (!Number.isFinite(leftTimestamp)) return cleanText(right);
  if (!Number.isFinite(rightTimestamp)) return cleanText(left);
  return leftTimestamp >= rightTimestamp ? cleanText(left) : cleanText(right);
}

function mergeJsonRecords(remoteRows, localRows, keyFor, mergeRecord = (remote, local) => ({ ...remote, ...local })) {
  const merged = new Map();
  let anonymous = 0;
  for (const row of [...remoteRows, ...localRows]) {
    const key = cleanText(keyFor(row)) || `anonymous:${anonymous++}`;
    merged.set(key, merged.has(key) ? mergeRecord(merged.get(key), row) : row);
  }
  return [...merged.values()];
}

function jsonSignature(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function queueDealKey(deal) {
  const slackTs = cleanText(deal?.slackTs);
  if (slackTs) return `slack:${slackTs}`;
  const id = cleanText(deal?.id);
  const url = cleanText(deal?.url);
  if (id || url) return `deal:${id}|${url}`;
  return `anonymous:${jsonSignature(deal)}`;
}

function recordsByKey(rows, keyFor) {
  const records = new Map();
  for (const row of rows) records.set(keyFor(row), row);
  return records;
}

function mergeQueueThreeWay(baseRows, remoteRows, localRows) {
  const base = recordsByKey(baseRows, queueDealKey);
  const remote = recordsByKey(remoteRows, queueDealKey);
  const local = recordsByKey(localRows, queueDealKey);
  const merged = new Map(remote);

  // Local removals are intentional validity/pruning decisions. In particular,
  // a remote approval deletion must not be resurrected by an unchanged checkout.
  for (const key of base.keys()) {
    if (!local.has(key)) merged.delete(key);
  }

  for (const [key, localDeal] of local.entries()) {
    const baseDeal = base.get(key);
    const remoteDeal = remote.get(key);
    if (!baseDeal) {
      merged.set(key, remoteDeal ? { ...remoteDeal, ...localDeal } : localDeal);
      continue;
    }
    if (jsonSignature(baseDeal) !== jsonSignature(localDeal) && remoteDeal) {
      merged.set(key, { ...remoteDeal, ...localDeal });
    }
    // If remote removed a base deal, respect that deletion even when this run
    // enriched its stale local copy.
  }
  return [...merged.values()];
}

function mergeKnownGeneratedJson(state, ref, baseRef) {
  const remoteContent = remoteFileContent(ref, state.path);
  if (!state.exists || !remoteContent) return null;
  let localPayload;
  let remotePayload;
  let basePayload;
  try {
    localPayload = JSON.parse(state.content.toString('utf8'));
    remotePayload = JSON.parse(remoteContent.toString('utf8'));
    const baseContent = remoteFileContent(baseRef, state.path);
    basePayload = baseContent ? JSON.parse(baseContent.toString('utf8')) : {};
  } catch {
    return null;
  }

  if (state.path === 'docs/deals-pending-all.json') {
    const baseDeals = Array.isArray(basePayload?.deals) ? basePayload.deals : [];
    const remoteDeals = Array.isArray(remotePayload?.deals) ? remotePayload.deals : [];
    const localDeals = Array.isArray(localPayload?.deals) ? localPayload.deals : [];
    const deals = mergeQueueThreeWay(baseDeals, remoteDeals, localDeals);
    const payload = {
      ...remotePayload,
      ...localPayload,
      deals,
      totalDeals: deals.length,
      updatedAt: latestIso(remotePayload?.updatedAt, localPayload?.updatedAt) || new Date().toISOString(),
    };
    return { ...state, content: Buffer.from(`${JSON.stringify(payload, null, 2)}\n`) };
  }

  if (state.path === 'docs/instagram-graph-post-evidence.json') {
    const remotePosts = Array.isArray(remotePayload?.posts) ? remotePayload.posts : [];
    const localPosts = Array.isArray(localPayload?.posts) ? localPayload.posts : [];
    const posts = mergeJsonRecords(remotePosts, localPosts, (post) => post?.postKey, (left, right) => {
      const newest = Date.parse(right?.verifiedAt || '') >= Date.parse(left?.verifiedAt || '') ? right : left;
      const older = newest === right ? left : right;
      return {
        ...older,
        ...newest,
        sourceTypes: [...new Set([...(older?.sourceTypes || []), ...(newest?.sourceTypes || [])])],
        sourceNames: [...new Set([...(older?.sourceNames || []), ...(newest?.sourceNames || [])])],
      };
    }).sort((left, right) => Date.parse(right?.sourcePublishedAt || '') - Date.parse(left?.sourcePublishedAt || ''));
    const payload = {
      ...remotePayload,
      ...localPayload,
      generatedAt: latestIso(remotePayload?.generatedAt, localPayload?.generatedAt) || new Date().toISOString(),
      totalPosts: posts.length,
      blockedPosts: posts.filter((post) => cleanText(post?.blockingReason)).length,
      posts,
    };
    return { ...state, content: Buffer.from(`${JSON.stringify(payload, null, 2)}\n`) };
  }

  return null;
}

function resolveSameFileRemoteChanges(states, baseRef, headRef, options = {}) {
  const conflicts = [];
  const safeStates = [];
  const mergedFiles = [];

  for (const state of states) {
    const changedRemotely = pathChangedBetween(baseRef, headRef, state.path);
    if (changedRemotely && !capturedMatchesRemote(state, headRef)) {
      if (options.skipConflicts) {
        const mergedState = mergeKnownGeneratedJson(state, headRef, baseRef);
        if (mergedState) {
          safeStates.push(mergedState);
          mergedFiles.push(state.path);
          continue;
        }
      }
      conflicts.push(state.path);
      continue;
    }
    safeStates.push(state);
  }

  if (conflicts.length > 0 && !options.skipConflicts) {
    throw new Error(
      'Remote changed the same generated file(s) while this job was running: ' +
      `${conflicts.join(', ')}. Rerun this workflow so it regenerates on the latest main.`
    );
  }
  if (conflicts.length > 0) {
    console.log(`Skipping remotely changed generated file(s): ${conflicts.join(', ')}`);
  }
  if (mergedFiles.length > 0) {
    console.log(`Merged concurrent generated state for: ${mergedFiles.join(', ')}`);
  }
  return safeStates;
}

function writeTempFile(state, tempDir) {
  const tempPath = path.join(tempDir, state.path);
  fs.mkdirSync(path.dirname(tempPath), { recursive: true });
  fs.writeFileSync(tempPath, state.content);
  return tempPath;
}

function commitFromCapturedFiles(states, message, remote, branch, tempDir) {
  const indexFile = path.join(tempDir, `index-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const env = {
    GIT_INDEX_FILE: indexFile,
    GIT_AUTHOR_NAME: DEFAULT_AUTHOR_NAME,
    GIT_AUTHOR_EMAIL: DEFAULT_AUTHOR_EMAIL,
    GIT_COMMITTER_NAME: DEFAULT_AUTHOR_NAME,
    GIT_COMMITTER_EMAIL: DEFAULT_AUTHOR_EMAIL,
  };
  const headRef = remoteRef(remote, branch);

  gitOutput(['read-tree', headRef], { env });
  for (const state of states) {
    if (!state.exists) {
      gitOutput(['update-index', '--force-remove', '--', state.path], { env });
      continue;
    }
    const tempPath = writeTempFile(state, tempDir);
    const hash = cleanText(gitOutput(['hash-object', '-w', tempPath]));
    gitOutput(['update-index', '--add', '--cacheinfo', `${state.mode},${hash},${state.path}`], { env });
  }

  const tree = cleanText(gitOutput(['write-tree'], { env }));
  const remoteTree = cleanText(gitOutput(['rev-parse', `${headRef}^{tree}`]));
  if (tree === remoteTree) return '';
  return cleanText(gitOutput(['commit-tree', tree, '-p', headRef, '-m', message], { env }));
}

function pushCommit(commit, remote, branch) {
  return runGit(['push', remote, `${commit}:refs/heads/${branch}`]);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const dealsPath = 'docs/deals.json';
  const includesDealsFeed = options.patterns
    .map(normalizeRepoPath)
    .includes(dealsPath);
  if (includesDealsFeed && statusChanged(dealsPath)) {
    const featuredSync = spawnSync(process.execPath, ['scripts/sync-featured-deal-references.mjs'], {
      cwd: process.cwd(),
      env: process.env,
      encoding: 'utf8',
    });
    if (featuredSync.status !== 0) {
      throw new Error(`Featured deal reference sync failed: ${cleanText(featuredSync.stderr || featuredSync.stdout)}`);
    }
    if (cleanText(featuredSync.stdout)) console.log(cleanText(featuredSync.stdout));
    options.patterns.push('docs/deal-of-the-day.json');
    options.patterns.push('docs/deal-of-the-week.json');

    const stamped = stampDealsFeedFile(path.join(process.cwd(), dealsPath));
    console.log(`Stamped deals feed ${stamped.feedVersion} (${stamped.totalDeals} deals)`);
    const generated = spawnSync(process.execPath, ['scripts/generate-seo-deals-page.mjs'], {
      cwd: process.cwd(),
      env: process.env,
      encoding: 'utf8',
    });
    if (generated.status !== 0) {
      throw new Error(`SEO deals page generation failed: ${cleanText(generated.stderr || generated.stdout)}`);
    }
    if (cleanText(generated.stdout)) console.log(cleanText(generated.stdout));
    options.patterns.push('docs/angebote-wien-heute.html');
    options.patterns.push('docs/sitemap.xml');
  }
  const changedFiles = uniqueChangedFiles(options.patterns);
  if (changedFiles.length === 0) {
    console.log('No generated file changes to commit');
    return;
  }

  const baseRef = cleanText(gitOutput(['rev-parse', 'HEAD']));
  const states = captureFiles(changedFiles);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-generated-'));
  console.log(`Preparing generated commit for ${states.length} file(s): ${states.map((state) => state.path).join(', ')}`);

  try {
    for (let attempt = 1; attempt <= options.retries + 1; attempt += 1) {
      fetchRemote(options.remote, options.branch);
      const headRef = remoteRef(options.remote, options.branch);
      const safeStates = resolveSameFileRemoteChanges(states, baseRef, headRef, {
        skipConflicts: options.skipConflicts,
      });
      if (safeStates.length === 0) {
        console.log('All generated changes were already superseded on remote main');
        return;
      }
      const commit = commitFromCapturedFiles(safeStates, options.message, options.remote, options.branch, tempDir);
      if (!commit) {
        console.log('No changes versus latest remote main');
        return;
      }

      const pushed = pushCommit(commit, options.remote, options.branch);
      if (pushed.status === 0) {
        console.log(`Pushed generated commit ${commit.slice(0, 12)} to ${options.remote}/${options.branch}`);
        return;
      }

      const errorText = cleanText(pushed.stderr || pushed.stdout);
      if (attempt > options.retries) {
        throw new Error(`git push failed after ${attempt} attempt(s): ${errorText}`);
      }
      console.log(`Push attempt ${attempt} failed because main moved. Retrying on latest main...`);
      await sleep(Math.min(1000 * attempt, 5000));
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`Generated commit failed: ${error.message}`);
  process.exit(1);
});

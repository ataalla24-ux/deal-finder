import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DEFAULT_DOCS_DIR = path.join(ROOT, 'docs');

export function githubRunProvenance(env=process.env) {
  if(!/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY||'') || !/^\d+$/.test(env.GITHUB_RUN_ID||'')
    || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'')
    || !['schedule','workflow_dispatch','push','workflow_run'].includes(env.GITHUB_EVENT_NAME))return null;
  // workflow_run and checkout(ref: main) can execute a newer commit than GITHUB_SHA.
  let checkoutSha = null;
  if (env.GITHUB_WORKSPACE) {
    try {
      const sha = execFileSync('git', ['-C', env.GITHUB_WORKSPACE, 'rev-parse', '--verify', 'HEAD'],
        { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (/^[a-f0-9]{40}$/.test(sha)) checkoutSha = sha;
    } catch { /* Missing checkout evidence stays unknown, never the trigger SHA. */ }
  }
  let triggeringRun = null;
  if (env.GITHUB_EVENT_NAME === 'workflow_run' && env.GITHUB_EVENT_PATH) {
    try {
      if (fs.statSync(env.GITHUB_EVENT_PATH).size > 1_000_000) throw new Error('Oversized event');
      const run = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8')).workflow_run;
      if (run?.head_repository?.full_name === env.GITHUB_REPOSITORY
        && /^\d+$/.test(String(run.id)) && /^[a-f0-9]{40}$/.test(run.head_sha || '')
        && ['schedule', 'workflow_dispatch', 'push', 'workflow_run'].includes(run.event)) {
        triggeringRun = { runId: String(run.id), headSha: run.head_sha, event: run.event,
          name: cleanText(run.name, 160),
          startedAt: Number.isFinite(Date.parse(run.run_started_at)) ? new Date(run.run_started_at).toISOString() : null,
          url: `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${run.id}` };
      }
    } catch { /* An unavailable event is a provenance gap, not a scheduled run. */ }
  }
  return {repository:env.GITHUB_REPOSITORY,runId:env.GITHUB_RUN_ID,headSha:env.GITHUB_SHA,checkoutSha,triggeringRun,
    event:env.GITHUB_EVENT_NAME,runAttempt:/^\d+$/.test(env.GITHUB_RUN_ATTEMPT||'')?env.GITHUB_RUN_ATTEMPT:null,
    url:`https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`};
}

function cleanText(value, maxLength = 500) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function safeCount(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function safeSourceKey(value) {
  const sourceKey = cleanText(value, 80)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!sourceKey) throw new Error('Pipeline report requires a sourceKey');
  return sourceKey;
}

function compactDeal(deal = {}) {
  return {
    id: cleanText(deal.id, 140),
    title: cleanText(deal.title, 200),
    brand: cleanText(deal.brand, 120),
    url: cleanText(deal.url, 400),
    source: cleanText(deal.originSource || deal.source, 160),
    pubDate: cleanText(deal.pubDate || deal.reportedPostDate, 80),
    expires: cleanText(deal.expires || deal.expiresOriginal, 160),
    postVerificationStatus: cleanText(deal.postVerification?.status, 80),
  };
}

function normalizeRejectedItems(rejected = [], limit = 30) {
  if (!Array.isArray(rejected)) return [];
  return rejected.slice(0, limit).map((entry) => {
    const deal = entry?.deal && typeof entry.deal === 'object' ? entry.deal : entry;
    return {
      reason: cleanText(entry?.reason || entry?.rejectionReason || 'rejected', 180),
      deal: compactDeal(deal),
    };
  });
}

function countRejectedReasons(rejected = []) {
  const counts = {};
  for (const entry of Array.isArray(rejected) ? rejected : []) {
    const reason = cleanText(entry?.reason || entry?.rejectionReason || 'rejected', 180) || 'rejected';
    counts[reason] = (counts[reason] || 0) + 1;
  }
  return counts;
}

export function summarizeVerifiedDeals(deals = []) {
  const statusCounts = {};
  let verifiedOriginalPosts = 0;
  let timestampOnlyPosts = 0;
  let unavailableOriginalPosts = 0;
  let registryViennaEvidence = 0;

  for (const deal of Array.isArray(deals) ? deals : []) {
    const status = cleanText(deal?.postVerification?.status, 80) || 'not-recorded';
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    if (status === 'verified-original-post' || deal?.postVerification?.verifiedOriginalPost === true) {
      verifiedOriginalPosts += 1;
    }
    if (status === 'timestamp-only') timestampOnlyPosts += 1;
    if (status === 'unavailable' || status === 'invalid') unavailableOriginalPosts += 1;
    if (
      deal?.viennaEvidence?.source === 'merchant-registry'
      || deal?.postVerification?.viennaEvidence === 'merchant-registry'
    ) {
      registryViennaEvidence += 1;
    }
  }

  return {
    statusCounts,
    verifiedOriginalPosts,
    timestampOnlyPosts,
    unavailableOriginalPosts,
    registryViennaEvidence,
  };
}

export function buildPipelineRunReport(options = {}) {
  const sourceKey = safeSourceKey(options.sourceKey);
  const startedAt = new Date(options.startedAt || Date.now());
  const finishedAt = new Date(options.finishedAt || Date.now());
  const rejected = Array.isArray(options.rejected) ? options.rejected : [];
  const acceptedDeals = safeCount(options.acceptedDeals);

  return {
    schemaVersion: 1,
    runProvenance: githubRunProvenance(options.env),
    runId: `${sourceKey}-${finishedAt.toISOString()}`,
    sourceKey,
    sourceLabel: cleanText(options.sourceLabel || sourceKey, 160),
    status: cleanText(options.status || 'completed', 40),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
    outputFile: cleanText(options.outputFile, 240),
    counts: {
      rawCandidates: safeCount(options.rawCandidates),
      normalizedCandidates: safeCount(options.normalizedCandidates),
      verifiedCandidates: safeCount(options.verifiedCandidates),
      previousDeals: safeCount(options.previousDeals),
      acceptedDeals,
      rejectedDeals: options.rejectedDeals === undefined
        ? rejected.length
        : safeCount(options.rejectedDeals),
    },
    rejectedByReason: {
      ...countRejectedReasons(rejected),
      ...(options.rejectedByReason || {}),
    },
    rejectedSamples: normalizeRejectedItems(rejected),
    diagnostics: options.diagnostics && typeof options.diagnostics === 'object'
      ? options.diagnostics
      : {},
    constraints: options.constraints && typeof options.constraints === 'object'
      ? options.constraints
      : {},
    errors: (Array.isArray(options.errors) ? options.errors : [options.errors])
      .map((error) => cleanText(error?.message || error, 700))
      .filter(Boolean)
      .slice(0, 30),
  };
}

function readHistory(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed?.runs) ? parsed.runs : [];
  } catch {
    return [];
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tempPath, filePath);
}

export function pipelineReportPaths(sourceKey, docsDir = DEFAULT_DOCS_DIR) {
  const safeKey = safeSourceKey(sourceKey);
  return {
    latestPath: path.join(docsDir, `deal-pipeline-last-run-${safeKey}.json`),
    historyPath: path.join(docsDir, `deal-pipeline-runs-${safeKey}.json`),
  };
}

export function writePipelineRunReport(report, options = {}) {
  const docsDir = options.docsDir || DEFAULT_DOCS_DIR;
  const historyLimit = Math.max(1, Math.min(365, safeCount(options.historyLimit, 90) || 90));
  const paths = pipelineReportPaths(report.sourceKey, docsDir);
  const history = readHistory(paths.historyPath)
    .filter((entry) => entry?.runId !== report.runId);
  const runs = [report, ...history].slice(0, historyLimit);

  writeJsonAtomic(paths.latestPath, report);
  writeJsonAtomic(paths.historyPath, {
    schemaVersion: 1,
    sourceKey: report.sourceKey,
    sourceLabel: report.sourceLabel,
    updatedAt: report.finishedAt,
    runCount: runs.length,
    runs,
  });

  return paths;
}

export function writeFailedPipelineRunReport(options = {}) {
  const report = buildPipelineRunReport({
    ...options,
    status: 'failed',
    finishedAt: options.finishedAt || new Date(),
    errors: [
      ...(Array.isArray(options.errors) ? options.errors : []),
      options.error,
    ],
  });
  writePipelineRunReport(report, options);
  return report;
}

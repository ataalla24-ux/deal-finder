import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DEFAULT_DOCS_DIR = path.join(ROOT, 'docs');

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

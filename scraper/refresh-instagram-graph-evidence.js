import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalInstagramPostKey } from './deal-evidence-utils.js';
import {
  buildInstagramGraphEvidencePayload,
  candidateIsFreshForGraph,
  inferInstagramPostingUsername,
  loadInstagramGraphEvidence,
  writeInstagramGraphEvidence,
} from './instagram-graph-evidence.js';
import {
  buildConfig,
  fetchInstagramBusinessDiscoveryMedia,
  isGlobalMetaGraphError,
  normalizeGraphMediaItem,
} from './meta-instagram-deals.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const DEFAULT_EVIDENCE_PATH = path.join(DOCS_DIR, 'instagram-graph-post-evidence.json');
const DEFAULT_REPORT_PATH = path.join(DOCS_DIR, 'instagram-graph-verification-report.json');
const EXCLUDED_FILES = new Set([
  'deals-pending-all.json',
  'deals-pending-firecrawl.json',
  'deals-pending-instagram-verified.json',
  'deals-pending-merged.json',
]);

function cleanText(value, max = 1000) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tempPath, filePath);
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.floor(number))) : fallback;
}

function sanitizeError(error, config) {
  let message = cleanText(error?.message || error, 500);
  for (const secret of [config.instagramAccessToken, config.openAiApiKey].filter(Boolean)) {
    message = message.split(secret).join('[redacted]');
    try {
      message = message.split(encodeURIComponent(secret)).join('[redacted]');
    } catch {
      // Raw replacement above still covers non-URL error messages.
    }
  }
  return message.replace(/([?&](?:access_token|token)=)[^&\s"']+/gi, '$1[redacted]');
}

function pendingFiles(docsDir, explicitNames = '') {
  const available = fs.existsSync(docsDir)
    ? fs.readdirSync(docsDir).filter((name) => name.startsWith('deals-pending-') && name.endsWith('.json'))
    : [];
  const requested = cleanText(explicitNames, 5000)
    .split(',')
    .map((name) => cleanText(name, 200))
    .filter(Boolean);
  return (requested.length ? requested : available)
    .filter((name) => available.includes(name) && !EXCLUDED_FILES.has(name))
    .sort();
}

export function collectInstagramGraphVerificationCandidates(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const docsDir = options.docsDir || DOCS_DIR;
  const maxAgeDays = boundedNumber(options.maxAgeDays, 8, 1, 14);
  const files = options.files || pendingFiles(docsDir, options.pendingFileNames);
  const evidenceIndex = options.evidenceIndex instanceof Map ? options.evidenceIndex : new Map();
  const candidatesByKey = new Map();
  const sourceCounts = {};

  for (const file of files) {
    const payload = readJson(path.join(docsDir, file), null);
    const deals = Array.isArray(payload) ? payload : (Array.isArray(payload?.deals) ? payload.deals : []);
    let acceptedFromFile = 0;
    for (const deal of deals) {
      const postKey = canonicalInstagramPostKey(deal?.url || deal?.post_url || deal?.postUrl);
      if (!postKey || evidenceIndex.has(postKey) || !candidateIsFreshForGraph(deal, now, maxAgeDays)) continue;
      const ownerUsername = inferInstagramPostingUsername(deal);
      if (!ownerUsername) continue;
      const current = candidatesByKey.get(postKey);
      const candidate = {
        postKey,
        url: cleanText(deal.url || deal.post_url || deal.postUrl, 1000),
        ownerUsername,
        sourceFile: file,
        deal,
      };
      if (!current || cleanText(deal.sourcePublishedAt || deal.pubDate) > cleanText(current.deal?.sourcePublishedAt || current.deal?.pubDate)) {
        candidatesByKey.set(postKey, candidate);
      }
      acceptedFromFile += 1;
    }
    sourceCounts[file] = { deals: deals.length, candidates: acceptedFromFile };
  }

  return {
    candidates: [...candidatesByKey.values()],
    files,
    sourceCounts,
  };
}

export async function refreshInstagramGraphEvidence(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const env = options.env || process.env;
  const evidencePath = options.evidencePath || cleanText(env.META_INSTAGRAM_GRAPH_EVIDENCE_PATH, 500) || DEFAULT_EVIDENCE_PATH;
  const reportPath = options.reportPath || cleanText(env.INSTAGRAM_GRAPH_VERIFICATION_REPORT_PATH, 500) || DEFAULT_REPORT_PATH;
  const previous = loadInstagramGraphEvidence(evidencePath);
  const previousReport = readJson(reportPath, {});
  const maxAgeDays = boundedNumber(options.maxAgeDays ?? env.INSTAGRAM_GRAPH_VERIFY_MAX_AGE_DAYS, 7, 1, 7);
  const maxAccounts = boundedNumber(options.maxAccounts ?? env.INSTAGRAM_GRAPH_VERIFY_MAX_ACCOUNTS, 24, 1, 60);
  const mediaPerAccount = boundedNumber(options.mediaPerAccount ?? env.INSTAGRAM_GRAPH_VERIFY_MEDIA_PER_ACCOUNT, 25, 1, 30);
  const config = {
    ...buildConfig(env, now),
    mediaPerAccount,
    mediaOcrEnabled: false,
  };
  const inventory = collectInstagramGraphVerificationCandidates({
    now,
    docsDir: options.docsDir,
    files: options.files,
    pendingFileNames: options.pendingFileNames || env.INSTAGRAM_GRAPH_VERIFY_PENDING_FILES,
    maxAgeDays,
    evidenceIndex: previous.byKey,
  });
  const grouped = new Map();
  for (const candidate of inventory.candidates) {
    const candidates = grouped.get(candidate.ownerUsername) || [];
    candidates.push(candidate);
    grouped.set(candidate.ownerUsername, candidates);
  }
  const accountFailures = Object.fromEntries(Object.entries(previousReport?.accountFailures || {}).filter(([, failure]) => {
    const lastAt = Date.parse(failure?.lastAt || '');
    return Number.isFinite(lastAt) && now.getTime() - lastAt <= 14 * 24 * 60 * 60 * 1000;
  }));
  const availableAccounts = [...grouped.entries()].filter(([username]) => {
    const cooldownUntil = Date.parse(accountFailures[username]?.cooldownUntil || '');
    return !Number.isFinite(cooldownUntil) || cooldownUntil <= now.getTime();
  });
  const prioritizedAccounts = availableAccounts.sort((left, right) => {
      if (right[1].length !== left[1].length) return right[1].length - left[1].length;
      const newest = (candidates) => Math.max(...candidates.map((candidate) => (
        Date.parse(candidate.deal?.sourcePublishedAt || candidate.deal?.pubDate || '') || 0
      )));
      return newest(right[1]) - newest(left[1]);
    });
  const reserveCount = Math.min(8, maxAccounts, prioritizedAccounts.length);
  const selectedAccounts = prioritizedAccounts.slice(0, reserveCount);
  const rotatingAccounts = prioritizedAccounts.slice(reserveCount);
  const rotatingSlots = maxAccounts - selectedAccounts.length;
  const shardIndex = boundedNumber(
    options.shardIndex ?? env.INSTAGRAM_GRAPH_VERIFY_SHARD_INDEX,
    Math.floor(now.getTime() / (2 * 60 * 60 * 1000)),
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const rotatingStart = rotatingAccounts.length ? (shardIndex * Math.max(1, rotatingSlots)) % rotatingAccounts.length : 0;
  for (let offset = 0; offset < rotatingAccounts.length && selectedAccounts.length < maxAccounts; offset += 1) {
    selectedAccounts.push(rotatingAccounts[(rotatingStart + offset) % rotatingAccounts.length]);
  }

  const report = {
    generatedAt: now.toISOString(),
    source: 'instagram-graph-cross-source-verification',
    status: 'running',
    configured: Boolean(config.instagramAccessToken && config.instagramUserId),
    scannedFiles: inventory.files,
    sourceCounts: inventory.sourceCounts,
    candidatePosts: inventory.candidates.length,
    candidateAccounts: grouped.size,
    skippedAccountCooldowns: grouped.size - availableAccounts.length,
    selectedAccounts: selectedAccounts.map(([username, candidates]) => ({ username, candidates: candidates.length })),
    fetchedPosts: 0,
    exactMatches: 0,
    retainedEvidencePosts: previous.byKey.size,
    errors: [],
    accountFailures,
  };

  if (!report.configured) {
    report.status = 'not-configured';
    report.message = 'INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_USER_ID are required; existing evidence was preserved.';
    if (options.write !== false) writeJsonAtomic(reportPath, report);
    return { report, evidence: previous.payload, shouldFail: false };
  }

  const fetchedEntries = [];
  const candidateKeys = new Set(inventory.candidates.map((candidate) => candidate.postKey));
  const fetchAccount = options.fetchAccount || fetchInstagramBusinessDiscoveryMedia;
  for (const [username] of selectedAccounts) {
    try {
      const response = await fetchAccount(config, { username }, options.fetchImpl || fetch);
      fetchedEntries.push(...response.entries);
      report.fetchedPosts += response.entries.length;
      delete accountFailures[username];
    } catch (error) {
      report.errors.push({ username, message: sanitizeError(error, config) });
      if (isGlobalMetaGraphError(error)) {
        report.globalError = {
          username,
          status: Number(error?.status || 0),
          code: cleanText(error?.code, 80),
          message: sanitizeError(error, config),
        };
        break;
      }
      const previousFailure = accountFailures[username] || {};
      accountFailures[username] = {
        count: Number(previousFailure.count || 0) + 1,
        lastAt: now.toISOString(),
        cooldownUntil: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      };
    }
  }
  report.accountFailures = accountFailures;

  const evidenceRows = fetchedEntries.map((entry) => {
    const outcome = normalizeGraphMediaItem(entry.item, entry.context, config, now);
    const postKey = canonicalInstagramPostKey(entry.item?.permalink);
    if (postKey && candidateKeys.has(postKey)) report.exactMatches += 1;
    return { entry, outcome };
  });
  const evidence = buildInstagramGraphEvidencePayload(evidenceRows, {
    now,
    previous: previous.payload,
    retentionDays: 14,
  });
  report.retainedEvidencePosts = evidence.totalPosts;
  report.blockedEvidencePosts = evidence.blockedPosts;
  report.unmatchedCandidatePosts = Math.max(0, inventory.candidates.length - report.exactMatches);
  report.status = report.globalError && !fetchedEntries.length
    ? 'failed-preserved'
    : (report.errors.length
        ? (fetchedEntries.length ? 'degraded' : 'failed-preserved')
        : (inventory.candidates.length > 0 && selectedAccounts.length === 0 ? 'degraded-cooldown' : 'ok'));
  report.message = `${report.exactMatches}/${inventory.candidates.length} fresh cross-source Instagram candidates matched exactly via Graph API.`;

  if (options.write !== false) {
    if (fetchedEntries.length || selectedAccounts.length === 0) writeInstagramGraphEvidence(evidence, evidencePath);
    writeJsonAtomic(reportPath, report);
  }
  return { report, evidence, shouldFail: false };
}

async function main() {
  const result = await refreshInstagramGraphEvidence();
  console.log(`Instagram Graph cross-source verification: ${result.report.status}`);
  console.log(`  candidates: ${result.report.candidatePosts}; exact matches: ${result.report.exactMatches}`);
  console.log(`  evidence posts retained: ${result.report.retainedEvidencePosts}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(`Instagram Graph verification failed: ${cleanText(error?.stack || error, 2000)}`);
    process.exitCode = 1;
  });
}

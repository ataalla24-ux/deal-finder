import '../sentry/instrument.mjs';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalInstagramPostKey } from './deal-evidence-utils.js';
import {
  buildConfig,
  normalizeGraphMediaItem,
} from './meta-instagram-deals.js';
import {
  buildPipelineRunReport,
  writeFailedPipelineRunReport,
  writePipelineRunReport,
} from './pipeline-run-report-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const OUTPUT_PATH = path.join(DOCS_DIR, 'deals-pending-wien-combined.json');
const REPORT_PATH = path.join(DOCS_DIR, 'wien-deals-combined-report.json');
const SOURCE_KEY = 'wien-combined';
const SOURCE_LABEL = 'Wien Deals Combined';
const RUN_STARTED_AT = new Date();
const HASHTAG_MEDIA_FIELDS = 'id,caption,media_type,permalink,timestamp,like_count,comments_count';
const DEFAULT_HASHTAGS = [
  'gratiswien',
  'wienaktion',
  'wienrabatt',
  'wiengutschein',
  'neueröffnungwien',
  'wienangebote',
  'wienangebot',
  'wienhappyhour',
  'wiengratis',
  'gratisinwien',
  'viennadeals',
  'viennafooddeals',
];

function cleanText(value, maxLength = 1200) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function parseHashtags(value) {
  const hashtags = String(value || '')
    .split(/[\s,;]+/)
    .map((entry) => entry.replace(/^#/, '').trim().toLowerCase())
    .filter((entry) => /^[a-z0-9_.äöüß-]{2,80}$/i.test(entry));
  return [...new Set(hashtags.length > 0 ? hashtags : DEFAULT_HASHTAGS)].slice(0, 20);
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tempPath, filePath);
}

async function graphRequest(pathname, params, options) {
  const url = new URL(`https://graph.facebook.com/${options.graphVersion}/${pathname.replace(/^\//, '')}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  url.searchParams.set('access_token', options.accessToken);
  const response = await options.fetchImpl(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {}
  if (!response.ok || payload?.error) {
    const message = cleanText(payload?.error?.message || `HTTP ${response.status}`, 500);
    const code = Number(payload?.error?.code || response.status || 0);
    const error = new Error(`Meta Graph ${code}: ${message}`);
    error.code = code;
    error.status = response.status;
    throw error;
  }
  return payload;
}

function rejectionCounts(rejected) {
  const counts = {};
  for (const item of rejected) {
    const reason = cleanText(item.reason, 120) || 'rejected';
    counts[reason] = (counts[reason] || 0) + 1;
  }
  return counts;
}

export async function runWienDealsCombined(options = {}) {
  const env = options.env || process.env;
  const now = options.now instanceof Date ? options.now : new Date();
  const accessToken = cleanText(env.INSTAGRAM_ACCESS_TOKEN || env.INSTAGRAM_GRAPH_ACCESS_TOKEN, 1000);
  const userId = cleanText(env.INSTAGRAM_USER_ID || env.INSTAGRAM_GRAPH_USER_ID, 120);
  const graphVersion = cleanText(env.META_GRAPH_VERSION || 'v26.0', 20);
  const hashtags = parseHashtags(env.WIEN_COMBINED_GRAPH_HASHTAGS || env.META_INSTAGRAM_HASHTAGS);
  const maxMediaPerHashtag = Math.max(5, Math.min(50, Number(env.WIEN_COMBINED_MEDIA_PER_HASHTAG || 30)));
  const maxDeals = Math.max(1, Math.min(80, Number(env.WIEN_COMBINED_MAX_DEALS || 40)));
  const timeoutMs = Math.max(3000, Number(env.WIEN_COMBINED_GRAPH_TIMEOUT_MS || 12000));
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const outputPath = options.outputPath || OUTPUT_PATH;
  const reportPath = options.reportPath || REPORT_PATH;

  if (!accessToken || !userId) throw new Error('Instagram Graph access token or user id is missing');
  if (typeof fetchImpl !== 'function') throw new Error('Fetch implementation is missing');

  const collectorConfig = buildConfig({
    ...env,
    INSTAGRAM_ACCESS_TOKEN: accessToken,
    INSTAGRAM_USER_ID: userId,
    META_GRAPH_VERSION: graphVersion,
    META_INSTAGRAM_MAX_POST_AGE_HOURS: '168',
    META_INSTAGRAM_MAX_POST_AGE_WITH_EXPIRY_DAYS: '7',
    META_INSTAGRAM_UNKNOWN_EXPIRY_TTL_HOURS: env.META_INSTAGRAM_UNKNOWN_EXPIRY_TTL_HOURS || '72',
    META_INSTAGRAM_ALLOW_WATCHLIST_VIENNA: '0',
  }, now);
  const requestOptions = { accessToken, graphVersion, fetchImpl, timeoutMs };
  const sourceResults = [];
  const normalized = [];
  const rejected = [];
  let fetchedPosts = 0;

  for (const hashtag of hashtags) {
    try {
      const search = await graphRequest('ig_hashtag_search', { user_id: userId, q: hashtag }, requestOptions);
      const hashtagId = cleanText(search?.data?.[0]?.id, 120);
      if (!hashtagId) {
        sourceResults.push({ hashtag, status: 'not-found', fetched: 0, accepted: 0 });
        continue;
      }
      const media = await graphRequest(`${hashtagId}/recent_media`, {
        user_id: userId,
        // Hashtag media does not consistently expose username and rejects the
        // whole request with Graph error #100 when that field is requested.
        fields: HASHTAG_MEDIA_FIELDS,
        limit: maxMediaPerHashtag,
      }, requestOptions);
      const rows = Array.isArray(media?.data) ? media.data : [];
      fetchedPosts += rows.length;
      let accepted = 0;
      for (const raw of rows) {
        const result = normalizeGraphMediaItem(raw, {
          sourceType: 'hashtag',
          sourceName: `#${hashtag}`,
        }, collectorConfig, now);
        if (result.deal) {
          normalized.push(result.deal);
          accepted += 1;
        } else {
          rejected.push({
            reason: result.rejection || 'rejected',
            deal: {
              id: cleanText(raw?.id, 120),
              title: cleanText(raw?.caption, 180),
              url: cleanText(raw?.permalink, 400),
              source: `#${hashtag}`,
              pubDate: cleanText(raw?.timestamp, 80),
            },
          });
        }
      }
      sourceResults.push({ hashtag, status: 'ok', fetched: rows.length, accepted });
    } catch (error) {
      const notFound = Number(error?.code || 0) === 24;
      sourceResults.push({
        hashtag,
        status: notFound ? 'not-found' : 'error',
        fetched: 0,
        accepted: 0,
        ...(notFound
          ? { detail: cleanText(error?.message || error, 500) }
          : { error: cleanText(error?.message || error, 500) }),
      });
    }
  }

  const successfulSources = sourceResults.filter((source) => source.status === 'ok').length;
  const failedSources = sourceResults.filter((source) => source.status === 'error');
  if (successfulSources === 0) {
    const report = {
      generatedAt: now.toISOString(),
      status: 'failed',
      message: 'No Graph hashtag source completed successfully; last-good output was preserved.',
      hashtags,
      fetchedPosts,
      totalDeals: 0,
      sources: sourceResults,
      rejectionReasons: rejectionCounts(rejected),
    };
    if (options.write !== false) writeJsonAtomic(reportPath, report);
    throw new Error(report.message);
  }

  const byPost = new Map();
  for (const deal of normalized) {
    const key = canonicalInstagramPostKey(deal.url) || cleanText(deal.id, 160);
    if (!key || byPost.has(key)) continue;
    byPost.set(key, {
      ...deal,
      source: 'Instagram',
      originSource: 'Wien Deals Combined Graph',
    });
  }
  const deals = [...byPost.values()]
    .sort((left, right) => Number(right.qualityScore || 0) - Number(left.qualityScore || 0)
      || Date.parse(right.pubDate || 0) - Date.parse(left.pubDate || 0))
    .slice(0, maxDeals);
  const status = failedSources.length > 0 || fetchedPosts === 0 ? 'degraded' : 'healthy';
  const payload = {
    lastUpdated: now.toISOString(),
    source: SOURCE_KEY,
    totalDeals: deals.length,
    meta: { status, fetchedPosts, successfulSources, failedSources: failedSources.length },
    deals,
  };
  const report = {
    generatedAt: now.toISOString(),
    status,
    message: `${deals.length} fresh, evidence-checked Graph hashtag deal(s) found.`,
    hashtags,
    fetchedPosts,
    totalDeals: deals.length,
    sources: sourceResults,
    rejectionReasons: rejectionCounts(rejected),
  };
  if (options.write !== false) {
    writeJsonAtomic(outputPath, payload);
    writeJsonAtomic(reportPath, report);
  }
  return { payload, report, rejected };
}

async function main() {
  const result = await runWienDealsCombined();
  const finishedAt = new Date();
  const sourceErrors = result.report.sources
    .filter((source) => source.status === 'error')
    .map((source) => `#${source.hashtag}: ${source.error}`);
  if (result.report.fetchedPosts === 0) {
    sourceErrors.push('Meta Graph returned zero posts across all resolved hashtags.');
  }
  writePipelineRunReport(buildPipelineRunReport({
    sourceKey: SOURCE_KEY,
    sourceLabel: SOURCE_LABEL,
    status: sourceErrors.length > 0 ? 'completed-with-errors' : 'completed',
    startedAt: RUN_STARTED_AT,
    finishedAt,
    outputFile: path.relative(ROOT, OUTPUT_PATH),
    rawCandidates: result.report.fetchedPosts,
    normalizedCandidates: result.payload.totalDeals,
    verifiedCandidates: result.payload.totalDeals,
    acceptedDeals: result.payload.totalDeals,
    rejected: result.rejected,
    errors: sourceErrors,
    diagnostics: {
      hashtags: result.report.hashtags.length,
      successfulSources: result.payload.meta.successfulSources,
      failedSources: result.payload.meta.failedSources,
      graphVersion: cleanText(process.env.META_GRAPH_VERSION || 'v26.0', 20),
    },
    constraints: { maxSocialPostAgeDays: 7 },
  }));
  console.log(`Wien Deals Combined: ${result.report.status}`);
  console.log(`  Graph posts: ${result.report.fetchedPosts}`);
  console.log(`  deals: ${result.payload.totalDeals}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      writeFailedPipelineRunReport({
        sourceKey: SOURCE_KEY,
        sourceLabel: SOURCE_LABEL,
        startedAt: RUN_STARTED_AT,
        outputFile: path.relative(ROOT, OUTPUT_PATH),
        error,
      });
      console.error(`Wien Deals Combined failed: ${cleanText(error?.message || error, 500)}`);
      process.exit(1);
    });
}

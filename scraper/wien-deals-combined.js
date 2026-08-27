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
  enrichInstagramGraphMedia,
  extractInstagramMediaAssets,
} from './instagram-media-evidence.js';
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
const MEDIA_CACHE_PATH = path.join(DOCS_DIR, 'wien-deals-combined-media-cache.json');
const META_STATE_PATH = path.join(DOCS_DIR, 'meta-instagram-state.json');
const SOURCE_KEY = 'wien-combined';
const SOURCE_LABEL = 'Wien Deals Combined';
const RUN_STARTED_AT = new Date();
const BASIC_HASHTAG_MEDIA_FIELDS = 'id,caption,media_type,permalink,timestamp,like_count,comments_count';
const HASHTAG_MEDIA_FIELD_VARIANTS = [
  {
    mode: 'supported-media',
    fields: `${BASIC_HASHTAG_MEDIA_FIELDS},media_url,children`,
  },
  {
    mode: 'media-url',
    fields: `${BASIC_HASHTAG_MEDIA_FIELDS},media_url`,
  },
  { mode: 'basic', fields: BASIC_HASHTAG_MEDIA_FIELDS },
];
const RESCUABLE_REJECTIONS = new Set([
  'missing-text',
  'no-concrete-offer',
  'missing-vienna-evidence',
]);
const DEFAULT_HASHTAGS = [
  'wien',
  'vienna',
  'viennafood',
  'wienevents',
  'wientipps',
  'wienfamilie',
  'sommerinwien',
  'wienergastro',
  'essenwien',
  'viennaeats',
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

function readJson(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function mediaEvidenceCache(options, mediaCachePath) {
  if (options.mediaCache && typeof options.mediaCache === 'object') return options.mediaCache;
  if (options.write === false) return {};
  const shared = readJson(META_STATE_PATH)?.mediaEvidence;
  const ownPayload = readJson(mediaCachePath);
  const own = ownPayload?.mediaEvidence || ownPayload;
  return {
    ...(shared && typeof shared === 'object' ? shared : {}),
    ...(own && typeof own === 'object' ? own : {}),
  };
}

function isFreshMediaRescueCandidate(item, now, maxAgeHours) {
  const timestamp = Date.parse(cleanText(item?.timestamp, 80));
  if (!Number.isFinite(timestamp) || timestamp > now.getTime() + 10 * 60 * 1000) return false;
  return now.getTime() - timestamp <= maxAgeHours * 60 * 60 * 1000;
}

function emptyMediaReport(status = 'disabled', error = '') {
  return {
    status,
    eligible: 0,
    selected: 0,
    cached: 0,
    analyzed: 0,
    withOcrText: 0,
    withVisionImages: 0,
    aiCalls: 0,
    visionCalls: 0,
    aiAccepted: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    errors: error ? [cleanText(error, 180)] : [],
  };
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

async function graphHashtagMediaRequest(pathname, params, options) {
  let lastUnsupportedFieldError = null;
  for (const variant of HASHTAG_MEDIA_FIELD_VARIANTS) {
    try {
      const payload = await graphRequest(pathname, { ...params, fields: variant.fields }, options);
      return { payload, fieldMode: variant.mode };
    } catch (error) {
      if (Number(error?.code || 0) !== 100) throw error;
      lastUnsupportedFieldError = error;
    }
  }
  throw lastUnsupportedFieldError || new Error('Meta Graph rejected all hashtag media field variants');
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
  // This is intentionally a separate discovery surface from the high-intent
  // hashtag pool used by the main Meta collector.
  const hashtags = parseHashtags(env.WIEN_COMBINED_GRAPH_HASHTAGS);
  const maxMediaPerHashtag = Math.max(5, Math.min(50, Number(env.WIEN_COMBINED_MEDIA_PER_HASHTAG || 30)));
  const maxDeals = Math.max(1, Math.min(80, Number(env.WIEN_COMBINED_MAX_DEALS || 40)));
  const timeoutMs = Math.max(3000, Number(env.WIEN_COMBINED_GRAPH_TIMEOUT_MS || 12000));
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const outputPath = options.outputPath || OUTPUT_PATH;
  const reportPath = options.reportPath || REPORT_PATH;
  const mediaCachePath = options.mediaCachePath || MEDIA_CACHE_PATH;

  if (!accessToken || !userId) throw new Error('Instagram Graph access token or user id is missing');
  if (typeof fetchImpl !== 'function') throw new Error('Fetch implementation is missing');

  const collectorConfig = buildConfig({
    ...env,
    INSTAGRAM_ACCESS_TOKEN: accessToken,
    INSTAGRAM_USER_ID: userId,
    META_GRAPH_VERSION: graphVersion,
    META_INSTAGRAM_MAX_POST_AGE_HOURS: '72',
    META_INSTAGRAM_MAX_POST_AGE_WITH_EXPIRY_DAYS: '7',
    META_INSTAGRAM_UNKNOWN_EXPIRY_TTL_HOURS: env.META_INSTAGRAM_UNKNOWN_EXPIRY_TTL_HOURS || '72',
    META_INSTAGRAM_ALLOW_WATCHLIST_VIENNA: '0',
    META_INSTAGRAM_MEDIA_MAX_POSTS_PER_RUN: env.WIEN_COMBINED_MEDIA_MAX_POSTS_PER_RUN || '18',
    META_INSTAGRAM_MEDIA_MAX_ASSETS_PER_POST: env.WIEN_COMBINED_MEDIA_MAX_ASSETS_PER_POST || '3',
    META_INSTAGRAM_MEDIA_MAX_VIDEO_FRAMES: env.WIEN_COMBINED_MEDIA_MAX_VIDEO_FRAMES || '3',
    META_INSTAGRAM_MEDIA_LLM_MAX_CALLS_PER_RUN: env.WIEN_COMBINED_MEDIA_LLM_MAX_CALLS_PER_RUN || '8',
    META_INSTAGRAM_MEDIA_LLM_MIN_CONFIDENCE: env.WIEN_COMBINED_MEDIA_LLM_MIN_CONFIDENCE || '0.84',
  }, now);
  const requestOptions = { accessToken, graphVersion, fetchImpl, timeoutMs };
  const sourceResults = [];
  const graphEntries = new Map();
  let fetchedPosts = 0;

  for (const hashtag of hashtags) {
    try {
      const search = await graphRequest('ig_hashtag_search', { user_id: userId, q: hashtag }, requestOptions);
      const hashtagId = cleanText(search?.data?.[0]?.id, 120);
      if (!hashtagId) {
        sourceResults.push({ hashtag, status: 'not-found', fetched: 0, accepted: 0 });
        continue;
      }
      const mediaResponse = await graphHashtagMediaRequest(`${hashtagId}/recent_media`, {
        user_id: userId,
        limit: maxMediaPerHashtag,
      }, requestOptions);
      const rows = Array.isArray(mediaResponse.payload?.data) ? mediaResponse.payload.data : [];
      fetchedPosts += rows.length;
      for (const raw of rows) {
        const key = canonicalInstagramPostKey(raw?.permalink) || cleanText(raw?.id, 160);
        if (!key) continue;
        const existing = graphEntries.get(key);
        if (existing) {
          existing.hashtags.add(hashtag);
          continue;
        }
        graphEntries.set(key, {
          key,
          item: raw,
          context: { sourceType: 'hashtag', sourceName: `#${hashtag}`, account: null },
          hashtags: new Set([hashtag]),
        });
      }
      sourceResults.push({
        hashtag,
        status: 'ok',
        fetched: rows.length,
        accepted: 0,
        mediaFieldMode: mediaResponse.fieldMode,
      });
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
      rejectionReasons: {},
    };
    if (options.write !== false) writeJsonAtomic(reportPath, report);
    throw new Error(report.message);
  }

  const uniqueEntries = [...graphEntries.values()];
  const initialOutcomes = new Map(uniqueEntries.map((entry) => [
    entry.key,
    normalizeGraphMediaItem(entry.item, entry.context, collectorConfig, now),
  ]));
  const rescueCandidates = uniqueEntries.filter((entry) => {
    const initial = initialOutcomes.get(entry.key);
    return !initial?.deal
      && RESCUABLE_REJECTIONS.has(initial?.rejection)
      && isFreshMediaRescueCandidate(entry.item, now, collectorConfig.maxOrganicAgeHours)
      && extractInstagramMediaAssets(entry.item).length > 0;
  });

  let media = {
    entries: rescueCandidates,
    cache: mediaEvidenceCache(options, mediaCachePath),
    report: emptyMediaReport(rescueCandidates.length ? 'disabled' : 'not-needed'),
  };
  if (rescueCandidates.length > 0) {
    try {
      media = await (options.enrichGraphMedia || enrichInstagramGraphMedia)(rescueCandidates, collectorConfig, now, {
        cache: media.cache,
        mediaFetchImpl: options.mediaFetchImpl,
        openAiFetchImpl: options.openAiFetchImpl,
        execFileImpl: options.execFileImpl,
        tools: options.mediaTools,
        analyzeItem: options.analyzeMediaItem,
        classifyOcr: options.classifyOcr,
      });
    } catch (error) {
      media.report = emptyMediaReport('degraded', error?.message || error);
    }
  }

  const normalized = [];
  const rejected = [];
  let rescuedDeals = 0;
  for (const entry of uniqueEntries) {
    const id = cleanText(entry.item?.id, 160);
    const initial = initialOutcomes.get(entry.key);
    const result = normalizeGraphMediaItem(entry.item, entry.context, collectorConfig, now);
    if (result.deal) {
      normalized.push(result.deal);
      if (!initial?.deal) rescuedDeals += 1;
      for (const hashtag of entry.hashtags) {
        const source = sourceResults.find((item) => item.hashtag === hashtag);
        if (source) source.accepted += 1;
      }
      continue;
    }
    rejected.push({
      reason: result.rejection || 'rejected',
      initialReason: initial?.rejection || '',
      deal: {
        id,
        title: cleanText(entry.item?.caption, 180),
        url: cleanText(entry.item?.permalink, 400),
        source: entry.context.sourceName,
        pubDate: cleanText(entry.item?.timestamp, 80),
      },
    });
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
  const mediaDegraded = rescueCandidates.length > 0 && ['degraded', 'unavailable'].includes(media.report?.status);
  const status = failedSources.length > 0 || fetchedPosts === 0 || mediaDegraded ? 'degraded' : 'healthy';
  const payload = {
    lastUpdated: now.toISOString(),
    source: SOURCE_KEY,
    totalDeals: deals.length,
    meta: {
      status,
      fetchedPosts,
      uniquePosts: uniqueEntries.length,
      successfulSources,
      failedSources: failedSources.length,
      rescueEligible: rescueCandidates.length,
      rescuedDeals,
    },
    deals,
  };
  const report = {
    generatedAt: now.toISOString(),
    status,
    message: `${deals.length} fresh, evidence-checked Graph hashtag deal(s) found; ${rescuedDeals} recovered from media.`,
    hashtags,
    fetchedPosts,
    uniquePosts: uniqueEntries.length,
    totalDeals: deals.length,
    rescueEligible: rescueCandidates.length,
    rescuedDeals,
    mediaEvidence: media.report,
    sources: sourceResults,
    rejectionReasons: rejectionCounts(rejected),
  };
  if (options.write !== false) {
    writeJsonAtomic(outputPath, payload);
    writeJsonAtomic(reportPath, report);
    writeJsonAtomic(mediaCachePath, {
      version: 1,
      updatedAt: now.toISOString(),
      mediaEvidence: media.cache,
    });
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
  if (['degraded', 'unavailable'].includes(result.report.mediaEvidence?.status)) {
    sourceErrors.push(...(result.report.mediaEvidence.errors || []).map((error) => `media evidence: ${error}`));
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
      uniquePosts: result.payload.meta.uniquePosts,
      rescueEligible: result.report.rescueEligible,
      rescuedDeals: result.report.rescuedDeals,
      mediaAnalyzed: result.report.mediaEvidence?.analyzed || 0,
      mediaAiCalls: result.report.mediaEvidence?.aiCalls || 0,
      mediaVisionCalls: result.report.mediaEvidence?.visionCalls || 0,
      mediaTokens: result.report.mediaEvidence?.totalTokens || 0,
      graphVersion: cleanText(process.env.META_GRAPH_VERSION || 'v26.0', 20),
    },
    constraints: { maxSocialPostAgeDays: 7 },
  }));
  console.log(`Wien Deals Combined: ${result.report.status}`);
  console.log(`  Graph posts: ${result.report.fetchedPosts}`);
  console.log(`  media rescue: ${result.report.rescuedDeals}/${result.report.rescueEligible}`);
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

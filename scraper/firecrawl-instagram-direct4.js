import '../sentry/instrument.mjs';

import Firecrawl from '@mendable/firecrawl-js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { inspectDealUrlHealth } from './expiry-utils.js';
import {
  buildPipelineRunReport,
  writeFailedPipelineRunReport,
  writePipelineRunReport,
} from './pipeline-run-report-utils.js';
import {
  buildKey4SearchQueries,
  buildKey4TargetAccounts,
  classifyKey4Evidence,
  dealToKey4SeedCandidate,
  dedupeKey4Candidates,
  extractKey4PostEvidence,
  isKey4DiscoveryCandidateRecent,
  key4CandidatePriority,
  searchResultToKey4Candidate,
} from './firecrawl-instagram-direct4-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const OUTPUT_PATH = path.join(DOCS_DIR, 'deals-pending-firecrawl4.json');
const RAW_OUTPUT_PATH = path.join(DOCS_DIR, 'deals-raw-firecrawl4.json');
const REVIEW_OUTPUT_PATH = path.join(DOCS_DIR, 'deals-review-firecrawl4.json');
const REJECTED_OUTPUT_PATH = path.join(DOCS_DIR, 'deals-rejected-firecrawl4.json');
const WATCHLIST_PATH = path.join(DOCS_DIR, 'instagram-watchlist.json');
const REGISTRY_PATH = path.join(DOCS_DIR, 'instagram-merchant-registry.json');
const SEED_FILE_NAMES = [
  'deals-pending-gastro2.json',
  'deals-pending-food3.json',
  'deals-pending-firecrawl2.json',
  'deals-pending-firecrawl5.json',
  'deals-pending-instagram-ai.json',
  'deals-pending-instagram-apify.json',
  'deals-pending-instagram-discovery.json',
  'deals-pending-instagram-verified.json',
  'deals-pending-instagram.json',
];
const SOURCE_KEY = 'firecrawl4';
const SOURCE_LABEL = 'Firecrawl Key 4 - Instagram Direct';
const RUN_STARTED_AT = new Date();

const MAX_POST_AGE_DAYS = Math.max(1, Number(process.env.FC4_MAX_AGE_DAYS || 7) || 7);
const DISCOVERY_MAX_AGE_DAYS = Math.max(
  MAX_POST_AGE_DAYS,
  Number(process.env.FC4_DISCOVERY_MAX_AGE_DAYS || 14) || 14,
);
const RECURRING_MAX_AGE_DAYS = Math.max(
  DISCOVERY_MAX_AGE_DAYS,
  Number(process.env.FC4_RECURRING_MAX_AGE_DAYS || 45) || 45,
);
const MAX_DEALS = Math.max(1, Number(process.env.FC4_MAX_DEALS || 40) || 40);
const MAX_REVIEW = Math.max(1, Number(process.env.FC4_MAX_REVIEW || 80) || 80);
const SEARCH_LIMIT = Math.max(1, Math.min(20, Number(process.env.FC4_SEARCH_LIMIT || 6) || 6));
const PROFILE_QUERY_LIMIT = Math.max(0, Number(process.env.FC4_PROFILE_QUERY_LIMIT || 18) || 0);
const TARGET_ACCOUNT_LIMIT = Math.max(
  PROFILE_QUERY_LIMIT,
  Number(process.env.FC4_TARGET_ACCOUNT_LIMIT || 30) || 30,
);
const MAX_POSTS_TO_SCRAPE = Math.max(1, Number(process.env.FC4_MAX_POSTS_TO_SCRAPE || 80) || 80);
const SEARCH_CONCURRENCY = Math.max(1, Number(process.env.FC4_SEARCH_CONCURRENCY || 2) || 2);
const SCRAPE_CONCURRENCY = Math.max(1, Number(process.env.FC4_SCRAPE_CONCURRENCY || 3) || 3);
const MAX_FIRECRAWL_CALLS = Math.max(1, Number(process.env.FC4_MAX_FIRECRAWL_CALLS || 140) || 140);

function cleanText(value, maxLength = Infinity) {
  const text = value === null || value === undefined
    ? ''
    : String(value).replace(/\s+/g, ' ').trim();
  return Number.isFinite(maxLength) ? text.slice(0, maxLength) : text;
}

function readJson(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function readKey4SeedCandidates(now) {
  return dedupeKey4Candidates(SEED_FILE_NAMES.flatMap((fileName) => {
    const payload = readJson(path.join(DOCS_DIR, fileName), {});
    const deals = Array.isArray(payload?.deals) ? payload.deals : [];
    return deals
      .map((deal) => dealToKey4SeedCandidate(deal, fileName, now))
      .filter(Boolean)
      .filter((candidate) => isKey4DiscoveryCandidateRecent(candidate, {
        now,
        maxAgeDays: DISCOVERY_MAX_AGE_DAYS,
        recurringMaxAgeDays: RECURRING_MAX_AGE_DAYS,
      }));
  }));
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tempPath, filePath);
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const rows = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.max(1, Math.floor(concurrency)) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      rows[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return rows;
}

function keyFailureKind(error) {
  const signal = cleanText(error?.message || error, 1000).toLowerCase();
  if (/insufficient credits|not enough credits|payment required|\b402\b/.test(signal)) return 'credits';
  if (/invalid api key|unauthori[sz]ed|authentication failed|\b401\b/.test(signal)) return 'authentication';
  if (/rate limit|too many requests|\b429\b/.test(signal)) return 'rate-limit';
  return 'request';
}

function safeErrorMessage(error) {
  return cleanText(error?.message || error || 'unknown Firecrawl error', 500)
    .replace(/fc-[a-z0-9_-]+/gi, '[redacted-key]');
}

export function loadKey4ApiKeyEntries(environment = process.env) {
  const candidates = [
    ['key-4', environment.FIRECRAWL_API_KEY4],
    ['key-1', environment.FIRECRAWL_API_KEY1],
    ['key-2', environment.FIRECRAWL_API_KEY2],
    ['key-3', environment.FIRECRAWL_API_KEY3],
    ['key-5', environment.FIRECRAWL_API_KEY5],
    ['key-6', environment.FIRECRAWL_API_KEY6],
    ['default-key', environment.FIRECRAWL_API_KEY],
  ];
  const seen = new Set();
  return candidates
    .map(([alias, apiKey]) => ({ alias, apiKey: cleanText(apiKey) }))
    .filter(({ apiKey }) => apiKey && !seen.has(apiKey) && seen.add(apiKey));
}

export function createKey4FirecrawlPool(options = {}) {
  const entries = (Array.isArray(options.keys) ? options.keys : [])
    .map((entry, index) => typeof entry === 'string'
      ? { alias: `key-${index + 1}`, apiKey: entry }
      : { alias: cleanText(entry?.alias) || `key-${index + 1}`, apiKey: cleanText(entry?.apiKey) })
    .filter((entry) => entry.apiKey);
  if (!entries.length) throw new Error('Firecrawl Key 4 requires at least one API key');

  const clientFactory = options.clientFactory || ((apiKey) => new Firecrawl({ apiKey }));
  const states = entries.map((entry) => ({
    ...entry,
    client: clientFactory(entry.apiKey, entry.alias),
    calls: 0,
    failures: 0,
    disabledReason: '',
  }));
  const maxCalls = Math.max(1, Number(options.maxCalls || MAX_FIRECRAWL_CALLS) || MAX_FIRECRAWL_CALLS);
  let cursor = 0;
  let totalCalls = 0;

  async function call(operation, callback) {
    if (totalCalls >= maxCalls) {
      throw new Error(`Firecrawl Key 4 call budget reached (${maxCalls})`);
    }
    const attempted = new Set();
    let lastError = null;
    while (attempted.size < states.length) {
      if (totalCalls >= maxCalls) {
        throw new Error(`Firecrawl Key 4 call budget reached (${maxCalls})`);
      }
      let index = -1;
      for (let offset = 0; offset < states.length; offset += 1) {
        const candidateIndex = (cursor + offset) % states.length;
        if (!attempted.has(candidateIndex) && !states[candidateIndex].disabledReason) {
          index = candidateIndex;
          break;
        }
      }
      if (index < 0) break;

      const state = states[index];
      attempted.add(index);
      state.calls += 1;
      totalCalls += 1;
      try {
        const result = await callback(state.client);
        cursor = index;
        return result;
      } catch (error) {
        lastError = error;
        state.failures += 1;
        const kind = keyFailureKind(error);
        if (kind === 'credits' || kind === 'authentication') state.disabledReason = kind;
        cursor = (index + 1) % states.length;
        if (kind === 'request') throw error;
      }
    }
    throw new Error(`No Firecrawl API key available for ${operation}: ${safeErrorMessage(lastError)}`);
  }

  return {
    search(query, request) {
      return call('search', (client) => client.search(query, request));
    },
    scrape(url, request) {
      return call('scrape', (client) => client.scrape(url, request));
    },
    diagnostics() {
      return {
        totalCalls,
        maxCalls,
        keys: states.map((state) => ({
          alias: state.alias,
          calls: state.calls,
          failures: state.failures,
          disabledReason: state.disabledReason,
        })),
      };
    },
  };
}

function extractSearchResults(response = {}) {
  return Array.isArray(response?.web) ? response.web : [];
}

export async function discoverKey4PostCandidates(options = {}) {
  const pool = options.pool;
  if (!pool || typeof pool.search !== 'function') {
    throw new Error('Key 4 discovery requires a Firecrawl key pool');
  }
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const queries = options.queries || buildKey4SearchQueries(options.targetAccounts || [], {
    profileLimit: options.profileQueryLimit ?? PROFILE_QUERY_LIMIT,
  });
  const searchLimit = Math.max(1, Number(options.searchLimit ?? SEARCH_LIMIT) || SEARCH_LIMIT);
  const rows = await mapWithConcurrency(
    queries,
    Number(options.concurrency ?? SEARCH_CONCURRENCY) || SEARCH_CONCURRENCY,
    async (query) => {
      try {
        const response = await pool.search(query.query, {
          sources: ['web'],
          limit: searchLimit,
          tbs: 'qdr:m,sbd:1',
          location: 'Vienna, Austria',
          country: 'AT',
          ignoreInvalidURLs: true,
          timeout: 45_000,
        });
        const results = extractSearchResults(response);
        return { query, status: 'completed', results, error: '' };
      } catch (error) {
        return { query, status: 'failed', results: [], error: safeErrorMessage(error) };
      }
    },
  );

  const rawResults = rows.flatMap((row) => row.results.map((result) => ({
    queryId: row.query.id,
    query: row.query.query,
    targetUsername: row.query.targetUsername || '',
    url: cleanText(result?.url || result?.metadata?.url || result?.metadata?.ogUrl, 500),
    title: cleanText(result?.title || result?.metadata?.title || result?.metadata?.ogTitle, 500),
    description: cleanText(
      result?.description || result?.metadata?.description || result?.metadata?.ogDescription,
      1200,
    ),
  })));

  const directCandidates = rows.flatMap((row) => row.results
    .map((result) => searchResultToKey4Candidate(result, row.query, now))
    .filter(Boolean));
  const prefilterRejected = [];
  const recentCandidates = [];
  for (const candidate of directCandidates) {
    if (isKey4DiscoveryCandidateRecent(candidate, {
      now,
      maxAgeDays: options.discoveryMaxAgeDays ?? DISCOVERY_MAX_AGE_DAYS,
      recurringMaxAgeDays: options.recurringMaxAgeDays ?? RECURRING_MAX_AGE_DAYS,
    })) {
      recentCandidates.push(candidate);
    } else {
      prefilterRejected.push({ reason: 'discovery-post-too-old', deal: candidate });
    }
  }

  return {
    candidates: dedupeKey4Candidates(recentCandidates),
    rawResults,
    prefilterRejected,
    diagnostics: {
      queries: rows.map((row) => ({
        id: row.query.id,
        status: row.status,
        results: row.results.length,
        error: row.error,
      })),
      queryCount: rows.length,
      failedQueries: rows.filter((row) => row.status === 'failed').length,
      rawSearchResults: rawResults.length,
      directPostResults: directCandidates.length,
      recentDistinctPosts: dedupeKey4Candidates(recentCandidates).length,
      prefilteredAsOld: prefilterRejected.length,
    },
  };
}

function previousDealsToCandidates(previousDeals = [], now = new Date()) {
  return previousDeals.map((deal) => ({
    url: deal.url,
    title: deal.title,
    discoverySnippet: deal.postCaption || deal.description || deal.title || '',
    ownerUsername: deal.ownerUsername || '',
    targetUsername: deal.ownerUsername || '',
    targetViennaVerified: deal.viennaVerified === true,
    sourcePublishedAt: deal.sourcePublishedAt || deal.pubDate || '',
    sourcePublishedAtSource: deal.sourcePublishedAtSource || deal.pubDateSource || '',
    discoveredAt: deal.discoveredAt || now.toISOString(),
    discoveredBy: [
      ...(Array.isArray(deal.discoveredBy) ? deal.discoveredBy : []),
      'previous-key4-accepted',
    ],
    previousDeal: deal,
  })).filter((candidate) => isKey4DiscoveryCandidateRecent(candidate, {
    now,
    maxAgeDays: DISCOVERY_MAX_AGE_DAYS,
    recurringMaxAgeDays: RECURRING_MAX_AGE_DAYS,
  }));
}

function healthToFirecrawlDocument(health = {}) {
  return {
    markdown: cleanText(health?.contentHints?.textSnippet, 5000),
    metadata: {
      title: cleanText(health?.contentHints?.title, 1000),
      description: cleanText(
        health?.contentHints?.description || health?.contentHints?.textSnippet,
        5000,
      ),
      ogTitle: cleanText(health?.contentHints?.title, 1000),
      ogDescription: cleanText(
        health?.contentHints?.description || health?.contentHints?.textSnippet,
        5000,
      ),
      publishedTime: cleanText(health?.dateHints?.publicationDate, 100),
      sourceURL: cleanText(health?.finalUrl, 500),
      statusCode: Number(health?.status || 0) || null,
      error: cleanText(health?.reason, 300),
    },
  };
}

export async function scrapeKey4PostCandidates(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const registry = options.registry instanceof Map ? options.registry : new Map();
  const inspector = options.inspector === undefined ? inspectDealUrlHealth : options.inspector;
  if (typeof inspector !== 'function') {
    throw new Error('Key 4 direct-post extraction requires an original-post inspector');
  }
  const selected = dedupeKey4Candidates(options.candidates || [])
    .sort((left, right) => key4CandidatePriority(right, now) - key4CandidatePriority(left, now))
    .slice(0, Math.max(1, Number(options.maxPosts ?? MAX_POSTS_TO_SCRAPE) || MAX_POSTS_TO_SCRAPE));

  const evidenceRows = await mapWithConcurrency(
    selected,
    Number(options.concurrency ?? SCRAPE_CONCURRENCY) || SCRAPE_CONCURRENCY,
    async (candidate) => {
      try {
        const health = await inspector(candidate.url, { timeoutMs: 8000, now });
        return extractKey4PostEvidence(healthToFirecrawlDocument(health), candidate, {
          now,
          registry,
          scrapeError: cleanText(health?.reason, 300),
          retrievalMode: 'direct-original-post-inspection',
        });
      } catch (error) {
        return extractKey4PostEvidence({}, candidate, {
          now,
          registry,
          scrapeError: safeErrorMessage(error),
          retrievalMode: 'direct-original-post-inspection',
        });
      }
    },
  );

  return {
    evidenceRows,
    diagnostics: {
      selectedForDirectScrape: selected.length,
      originalPostsVerified: evidenceRows.filter((row) => (
        /^verified-original-post/.test(row.postVerification?.status || '')
      )).length,
      unavailableOriginalPosts: evidenceRows.filter((row) => (
        !/^verified-original-post/.test(row.postVerification?.status || '')
      )).length,
      directOriginalPostInspections: selected.length,
    },
  };
}

function verifiedRegistryMap(registryDocument = {}) {
  const accounts = Array.isArray(registryDocument?.accounts) ? registryDocument.accounts : [];
  return new Map(accounts
    .filter((account) => account?.viennaVerified === true
      && cleanText(account?.accountType || 'merchant').toLowerCase() === 'merchant')
    .map((account) => [cleanText(account?.username).replace(/^@/, '').toLowerCase(), account])
    .filter(([username]) => username));
}

export async function runKey4Pipeline(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const watchlist = options.watchlist || {};
  const registryDocument = options.registryDocument || {};
  const registry = options.registry instanceof Map
    ? options.registry
    : verifiedRegistryMap(registryDocument);
  const targetAccounts = options.targetAccounts || buildKey4TargetAccounts(
    watchlist,
    registryDocument,
    options.targetAccountLimit ?? TARGET_ACCOUNT_LIMIT,
  );
  const discovery = await discoverKey4PostCandidates({
    pool: options.pool,
    targetAccounts,
    queries: options.queries,
    now,
    searchLimit: options.searchLimit,
    profileQueryLimit: options.profileQueryLimit,
    concurrency: options.searchConcurrency,
    discoveryMaxAgeDays: options.discoveryMaxAgeDays,
    recurringMaxAgeDays: options.recurringMaxAgeDays,
  });
  const previousCandidates = previousDealsToCandidates(options.previousDeals || [], now);
  const seedCandidates = dedupeKey4Candidates(options.seedCandidates || [])
    .filter((candidate) => isKey4DiscoveryCandidateRecent(candidate, {
      now,
      maxAgeDays: options.discoveryMaxAgeDays ?? DISCOVERY_MAX_AGE_DAYS,
      recurringMaxAgeDays: options.recurringMaxAgeDays ?? RECURRING_MAX_AGE_DAYS,
    }));
  const candidates = dedupeKey4Candidates([
    ...discovery.candidates,
    ...seedCandidates,
    ...previousCandidates,
  ]);
  const scrape = await scrapeKey4PostCandidates({
    candidates,
    registry,
    now,
    maxPosts: options.maxPosts,
    concurrency: options.scrapeConcurrency,
    inspector: options.inspector,
  });
  const classification = classifyKey4Evidence(scrape.evidenceRows, {
    now,
    maxAgeDays: options.maxAgeDays ?? MAX_POST_AGE_DAYS,
    recurringMaxAgeDays: options.recurringMaxAgeDays ?? RECURRING_MAX_AGE_DAYS,
  });
  return {
    now,
    targetAccounts,
    seedCandidates,
    candidates,
    discovery,
    scrape,
    classification,
  };
}

function compactEvidence(row = {}) {
  const { previousDeal, ...rest } = row;
  return {
    ...rest,
    postCaption: cleanText(rest.postCaption, 5000),
    discoverySnippet: cleanText(rest.discoverySnippet, 2000),
    previousDealId: cleanText(previousDeal?.id, 160),
  };
}

function countReasons(entries = []) {
  const counts = {};
  for (const entry of entries) {
    const reason = cleanText(entry?.reason || 'rejected', 180) || 'rejected';
    counts[reason] = (counts[reason] || 0) + 1;
  }
  return counts;
}

async function main() {
  const keyEntries = loadKey4ApiKeyEntries();
  if (!keyEntries.length) {
    throw new Error('Kein Firecrawl API-Key für Firecrawler 4 gesetzt');
  }
  const pool = createKey4FirecrawlPool({ keys: keyEntries });
  const now = new Date();
  const watchlist = readJson(WATCHLIST_PATH, {});
  const registryDocument = readJson(REGISTRY_PATH, {});
  const previousOutput = readJson(OUTPUT_PATH, {});
  const previousDeals = Array.isArray(previousOutput?.deals) ? previousOutput.deals : [];
  const seedCandidates = readKey4SeedCandidates(now);

  console.log('FIRECRAWL KEY 4 V2 - DIRECT INSTAGRAM EVIDENCE');
  console.log('='.repeat(58));
  console.log(`Wien: ${now.toLocaleString('de-AT', { timeZone: 'Europe/Vienna' })}`);
  console.log(`API-Key-Pool: ${keyEntries.length} Key(s)`);
  console.log(`Regeln: ${MAX_POST_AGE_DAYS} Tage frisch, ${RECURRING_MAX_AGE_DAYS} Tage bei belegter Wiederholung`);

  const result = await runKey4Pipeline({
    pool,
    now,
    watchlist,
    registryDocument,
    previousDeals,
    seedCandidates,
  });
  const accepted = result.classification.accepted.slice(0, MAX_DEALS);
  const review = result.classification.review.slice(0, MAX_REVIEW);
  const rejected = result.classification.rejected;
  const constraints = {
    maximumPostAgeDays: MAX_POST_AGE_DAYS,
    recurringOfferMaximumAgeDays: RECURRING_MAX_AGE_DAYS,
    discoveryMaximumAgeDays: DISCOVERY_MAX_AGE_DAYS,
    location: 'Wien',
    offer: 'kostenlose Speisen/Getränke, 1+1/2für1 und kostenlose Gastro-Proben',
    originalEvidenceRequiredForAutomaticAcceptance: true,
    discoveryMode: 'merchant-first Firecrawl search plus recent direct-post seeds from existing pipelines',
  };
  const diagnostics = {
    targetAccounts: result.targetAccounts.length,
    seedCandidates: result.seedCandidates.length,
    discovery: result.discovery.diagnostics,
    extraction: result.scrape.diagnostics,
    classification: result.classification.summary,
    keyPool: pool.diagnostics(),
    previousAcceptedDeals: previousDeals.length,
  };

  writeJsonAtomic(OUTPUT_PATH, {
    lastUpdated: now.toISOString(),
    source: SOURCE_KEY,
    totalDeals: accepted.length,
    constraints,
    diagnostics,
    pipelineReport: `deal-pipeline-last-run-${SOURCE_KEY}.json`,
    deals: accepted,
  });
  writeJsonAtomic(RAW_OUTPUT_PATH, {
    lastUpdated: now.toISOString(),
    source: SOURCE_KEY,
    totalSearchResults: result.discovery.rawResults.length,
    totalSeedCandidates: result.seedCandidates.length,
    totalDirectPosts: result.scrape.evidenceRows.length,
    searchResults: result.discovery.rawResults,
    posts: result.scrape.evidenceRows.map(compactEvidence),
  });
  writeJsonAtomic(REVIEW_OUTPUT_PATH, {
    lastUpdated: now.toISOString(),
    source: SOURCE_KEY,
    totalDeals: review.length,
    deals: review,
  });
  writeJsonAtomic(REJECTED_OUTPUT_PATH, {
    lastUpdated: now.toISOString(),
    source: SOURCE_KEY,
    totalDeals: rejected.length + result.discovery.prefilterRejected.length,
    rejectedByReason: {
      ...result.classification.summary.rejectedByReason,
      ...countReasons(result.discovery.prefilterRejected),
    },
    deals: [
      ...rejected.map((entry) => ({
        ...entry.deal,
        rejectionReason: entry.reason,
      })),
      ...result.discovery.prefilterRejected.map((entry) => ({
        ...entry.deal,
        rejectionReason: entry.reason,
      })),
    ],
  });

  const pipelineRejected = [
    ...rejected,
    ...result.discovery.prefilterRejected,
  ];
  writePipelineRunReport(buildPipelineRunReport({
    sourceKey: SOURCE_KEY,
    sourceLabel: SOURCE_LABEL,
    startedAt: RUN_STARTED_AT,
    finishedAt: new Date(),
    outputFile: path.relative(ROOT, OUTPUT_PATH),
    rawCandidates: result.discovery.rawResults.length + result.seedCandidates.length + previousDeals.length,
    normalizedCandidates: result.candidates.length,
    verifiedCandidates: result.scrape.evidenceRows.filter((row) => (
      /^verified-original-post/.test(row.postVerification?.status || '')
    )).length,
    previousDeals: previousDeals.length,
    acceptedDeals: accepted.length,
    rejected: pipelineRejected,
    diagnostics,
    constraints,
  }));

  console.log(`Suchtreffer: ${result.discovery.rawResults.length}`);
  console.log(`Aktuelle direkte Seeds aus bestehenden Pipelines: ${result.seedCandidates.length}`);
  console.log(`Direkte Posts nach Vorfilter/Deduplizierung: ${result.candidates.length}`);
  console.log(`Original-Posts verifiziert: ${result.scrape.diagnostics.originalPostsVerified}`);
  console.log(`Akzeptiert: ${accepted.length}`);
  console.log(`Review: ${review.length} ${JSON.stringify(result.classification.summary.reviewByReason)}`);
  console.log(`Abgelehnt: ${pipelineRejected.length} ${JSON.stringify({
    ...result.classification.summary.rejectedByReason,
    ...countReasons(result.discovery.prefilterRejected),
  })}`);
  console.log(`Gespeichert: docs/${path.basename(OUTPUT_PATH)} sowie Raw/Review/Rejected-Artefakte`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    writeFailedPipelineRunReport({
      sourceKey: SOURCE_KEY,
      sourceLabel: SOURCE_LABEL,
      startedAt: RUN_STARTED_AT,
      outputFile: path.relative(ROOT, OUTPUT_PATH),
      error,
      constraints: {
        maximumPostAgeDays: MAX_POST_AGE_DAYS,
        recurringOfferMaximumAgeDays: RECURRING_MAX_AGE_DAYS,
        location: 'Wien',
      },
    });
    console.error('Firecrawl Key 4 fehlgeschlagen:', safeErrorMessage(error));
    process.exit(1);
  });
}

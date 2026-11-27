import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyWithOpenAi, makeCandidate, parsePubDate } from '../scraper/instagram-ai-agent.js';
import { modelForTask } from '../scraper/ai-credit-budget.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const safeCodes = new Set(['request-timeout', 'request-failed', 'response-invalid', 'free_credit_budget_deferred',
  'insufficient_quota', 'rate_limit_exceeded', 'invalid_api_key', 'model_not_found', 'unclassified']);
const safeReasons = new Set(['background-timeout', 'background-response-invalid', 'background-response-unavailable',
  'request-or-ledger-unavailable', 'shared-spend-limit', 'storage-or-provider-pause', 'runner-paused',
  'shared-storage-unavailable', 'reservation-contention', 'model-response-unavailable']);

export function cachedClassificationCandidates(payload, now = new Date()) {
  const seen = new Set();
  return (Array.isArray(payload?.deals) ? payload.deals : []).flatMap(deal => {
    const candidate = makeCandidate({ url: deal?.url, title: deal?.title,
      snippet: deal?.description, source: 'cached-instagram-model-diagnostic', sourceDeal: structuredClone(deal) });
    if (!candidate || seen.has(candidate.key)) return [];
    const published = parsePubDate(candidate)?.date;
    if (!published || +published > +now || +now - +published > 7 * 86_400_000) return [];
    seen.add(candidate.key);
    candidate.score = Number.isFinite(deal.qualityScore) ? deal.qualityScore : 0;
    return [candidate];
  }).slice(0, 4);
}

export async function checkInstagramModelResponse({ payload, env = process.env, classify = classifyWithOpenAi,
  now = new Date(), clock = Date.now } = {}) {
  if (env.INSTAGRAM_MODEL_DIAGNOSTIC !== '1' || !env.OPENAI_API_KEY) {
    throw new Error('Explicit model diagnostic and existing API credential required');
  }
  const candidates = cachedClassificationCandidates(payload, now);
  if (!candidates.length) throw new Error('No fresh cached source candidates available');
  const started = clock();
  // At most four candidates means exactly one classifier batch. Its production
  // credit wrapper reserves once, polls that job, and never publishes the result.
  const result = await classify(candidates, { enabled: true, apiKey: env.OPENAI_API_KEY, background: true });
  const usage = Object.fromEntries(['inputTokens', 'outputTokens', 'totalTokens'].map(key =>
    [key, Number.isSafeInteger(result.usage?.[key]) && result.usage[key] >= 0 ? result.usage[key] : null]));
  const success = result.health?.status === 'ok' && usage.totalTokens > 0
    && usage.totalTokens === usage.inputTokens + usage.outputTokens;
  return { checkedAt: now.toISOString(), status: success ? 'success' : 'unavailable', model: modelForTask('review'),
    requestMode: 'background', candidates: candidates.length, elapsedMs: Math.max(0, clock() - started),
    returnedAcceptedCandidates: Array.isArray(result.deals) ? result.deals.length : 0,
    usage, errorCode: safeCodes.has(result.health?.code) ? result.health.code : null,
    budgetReason: safeReasons.has(result.health?.budgetReason) ? result.health.budgetReason : null,
    httpStatus: Number.isInteger(result.health?.httpStatus) ? result.health.httpStatus : null,
    sourceReads: 0, publishedDeals: 0, collectorRun: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!process.argv.includes('--run') || process.env.GITHUB_REF !== 'refs/heads/main'
      || process.env.GITHUB_RUN_ATTEMPT !== '1') throw new Error('Fresh explicit main-branch diagnostic invocation required');
    const payload = JSON.parse(await fs.readFile(path.join(root, 'docs/deals-pending-instagram-ai.json'), 'utf8'));
    const report = await checkInstagramModelResponse({ payload });
    const directory = path.join(root, 'output/instagram-model-response');
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
    if (report.status !== 'success') process.exitCode = 1;
  } catch {
    console.error('Instagram model diagnostic failed before a verified result was available');
    process.exitCode = 1;
  }
}

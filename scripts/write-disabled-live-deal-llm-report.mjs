import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const DEALS_PATH = path.join(ROOT, 'docs', 'deals.json');
const REPORT_PATH = path.join(ROOT, 'docs', 'live-deal-llm-review.json');

const generatedAt = new Date().toISOString();
const payload = JSON.parse(await readFile(DEALS_PATH, 'utf8'));
const deals = Array.isArray(payload.deals) ? payload.deals : [];

const report = {
  generatedAt,
  source: 'github-live-deal-llm-review',
  model: '',
  aiEnabled: false,
  apply: false,
  disabled: true,
  disabledReason: 'Live deal LLM review is disabled. Set repository variable ENABLE_LIVE_DEAL_LLM_REVIEW=1 to enable it.',
  minRemoveConfidence: null,
  totalDealsBefore: deals.length,
  reviewedDeals: 0,
  totalDealsAfter: deals.length,
  removedCount: 0,
  flaggedCount: 0,
  policyOverrides: [],
  targetEvidenceSummary: {
    enabled: false,
    checkedDeals: 0,
    urlConcurrency: 0,
    timeoutMs: 0,
    maxTextChars: 0,
    statusCounts: {},
    withPageText: 0,
    withPublicationDate: 0,
    withValidityDate: 0,
  },
  targetEvidenceErrors: [],
  errors: ['LLM review disabled by workflow configuration.'],
  usage: {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  },
  removedDeals: [],
  reviews: [],
  targetEvidence: [],
};

await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(`LLM live deal review disabled; wrote report for ${deals.length} deals.`);

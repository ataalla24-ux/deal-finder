import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..');
const reportPath = path.join(root, 'docs', 'meta-instagram-report.json');

function fail(message) {
  console.error(`meta instagram report invalid: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(reportPath)) fail('report file is missing');

let report;
try {
  report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
} catch (error) {
  fail(`report is not valid JSON (${error.message})`);
}

const validStatuses = new Set(['ok', 'degraded', 'legitimate-zero']);
if (!validStatuses.has(report?.status)) fail(`collector status is ${report?.status || 'missing'}`);
if (!report?.configured?.adLibrary && !report?.configured?.instagramGraph) fail('no Meta source is configured');
if (!Number.isFinite(Number(report?.totalDeals))) fail('totalDeals is missing');

for (const [sourceName, source] of Object.entries(report?.sources || {})) {
  if (source?.status === 'failed') {
    console.warn(`${sourceName} failed; another configured source kept the collector operational`);
  }
  if (!Number.isFinite(Number(source?.fetched))) fail(`${sourceName}.fetched is missing`);
  if (!Array.isArray(source?.errors)) fail(`${sourceName}.errors is missing`);
}

const summary = [
  '## Meta Instagram discovery',
  '',
  `- Status: **${report.status}**`,
  `- Verified new deals: **${report.totalDeals}**`,
  `- Ad Library: ${report.sources?.adLibrary?.status || 'unknown'} (${report.sources?.adLibrary?.fetched || 0} fetched)`,
  `- Instagram Graph: ${report.sources?.instagramGraph?.status || 'unknown'} (${report.sources?.instagramGraph?.fetched || 0} fetched)`,
  `- Media OCR: ${report.sources?.instagramGraph?.mediaEvidence?.status || 'not-run'} (${report.sources?.instagramGraph?.mediaEvidence?.withOcrText || 0} with text)`,
  `- OCR cache hits: ${report.sources?.instagramGraph?.mediaEvidence?.cached || 0}`,
  `- AI media classifications: ${report.sources?.instagramGraph?.mediaEvidence?.aiCalls || 0} (${report.sources?.instagramGraph?.mediaEvidence?.aiAccepted || 0} accepted)`,
  `- Sources on cooldown: ${(report.sources?.instagramGraph?.skippedCooldown?.accounts || 0) + (report.sources?.instagramGraph?.skippedCooldown?.hashtags || 0)}`,
  `- Selected accounts: ${Array.isArray(report.selectedAccounts) ? report.selectedAccounts.length : 0}`,
  `- Selected hashtags: ${Array.isArray(report.selectedHashtags) ? report.selectedHashtags.length : 0}/${report.discoveryBudget?.hashtagPoolSize || 0}`,
  `- Hashtag posts accepted: ${Object.values(report.sources?.instagramGraph?.hashtagYield || {}).reduce((sum, row) => sum + Number(row?.recentAccepted || 0), 0)}`,
  '',
].join('\n');

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}

console.log(`meta instagram report valid: ${report.status}, ${report.totalDeals} deal(s)`);

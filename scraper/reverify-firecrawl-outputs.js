import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyFirecrawlDeals } from './firecrawl-post-verifier.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');

export const FIRECRAWL_OUTPUTS = [
  { file: 'deals-pending-gastro2.json', sourceKey: 'firecrawl-key1-gastro' },
  { file: 'deals-pending-food3.json', sourceKey: 'firecrawl-key2-food' },
  { file: 'deals-pending-firecrawl2.json', sourceKey: 'firecrawl-key3-consumables' },
  { file: 'deals-pending-firecrawl4.json', sourceKey: 'firecrawl-key4-gastro' },
  { file: 'deals-pending-firecrawl5.json', sourceKey: 'firecrawl-key5-instagram-gastro' },
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporaryPath, filePath);
}

export async function reverifyFirecrawlOutputs(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const docsDir = options.docsDir || DOCS_DIR;
  const outputs = Array.isArray(options.outputs) ? options.outputs : FIRECRAWL_OUTPUTS;
  const verifyDeals = options.verifyDeals || verifyFirecrawlDeals;
  const summaries = [];

  for (const output of outputs) {
    const filePath = path.join(docsDir, output.file);
    if (!fs.existsSync(filePath)) {
      summaries.push({ file: output.file, status: 'missing', before: 0, after: 0 });
      continue;
    }

    const payload = readJson(filePath);
    const deals = Array.isArray(payload) ? payload : (Array.isArray(payload?.deals) ? payload.deals : []);
    const verifiedDeals = await verifyDeals(deals, {
      sourceKey: output.sourceKey,
      now,
      maxNetworkVerifications: Number(options.maxNetworkVerifications || process.env.FIRECRAWL_POST_VERIFY_MAX || 80),
      networkMaxAgeDays: 7,
      maxAcceptedAgeDays: 7,
      concurrency: Number(options.concurrency || process.env.FIRECRAWL_POST_VERIFY_CONCURRENCY || 4),
      timeoutMs: Number(options.timeoutMs || process.env.FIRECRAWL_POST_VERIFY_TIMEOUT_MS || 6000),
    });

    const nextPayload = Array.isArray(payload)
      ? verifiedDeals
      : {
          ...payload,
          totalDeals: verifiedDeals.length,
          centralReverifiedAt: now.toISOString(),
          centralReverifiedFrom: deals.length,
          deals: verifiedDeals,
        };
    if (options.write !== false) writeJsonAtomic(filePath, nextPayload);
    summaries.push({
      file: output.file,
      status: 'verified',
      before: deals.length,
      after: verifiedDeals.length,
      removed: Math.max(0, deals.length - verifiedDeals.length),
    });
  }

  return summaries;
}

async function main() {
  const summaries = await reverifyFirecrawlOutputs();
  console.log('Central Firecrawl re-verification');
  for (const summary of summaries) {
    console.log(`  ${summary.file}: ${summary.status} ${summary.before} -> ${summary.after}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(`Central Firecrawl re-verification failed: ${error?.stack || error}`);
    process.exitCode = 1;
  });
}

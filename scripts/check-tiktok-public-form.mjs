import fs from 'node:fs';
import { chromium } from 'playwright';
import { githubRunProvenance } from '../scraper/pipeline-run-report-utils.js';
import { inspectTikTokPublicForm, priorTikTokFormPause } from '../scraper/tiktok-public-form.js';

const previous = JSON.parse(fs.readFileSync('docs/tiktok-scanner-report.json', 'utf8'));
const retryAt = priorTikTokFormPause(previous);
const report = { checkedAt: new Date().toISOString(), provenance: githubRunProvenance(),
  mode: 'anonymous-public-home-search-form', outcome: 'cooldown', retryAt };
if (!retryAt) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ locale: 'de-AT', timezoneId: 'Europe/Vienna' });
    Object.assign(report, await inspectTikTokPublicForm(page));
  } finally { await browser.close(); }
}
fs.mkdirSync('output/social-discovery', { recursive: true });
fs.writeFileSync('output/social-discovery/tiktok-public-form.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));

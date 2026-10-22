import fs from 'node:fs';
import { ApifyDiscoveryClient, budgetCheck } from '../scraper/apify-discovery-client.js';

let report;
try {
  const client = new ApifyDiscoveryClient(process.env.APIFY_2);
  const current = await client.preflight();
  let sameAccountAsPrimary = null;
  if (process.env.APIFY_TOKEN) {
    const primary = await new ApifyDiscoveryClient(process.env.APIFY_TOKEN).request('/users/me');
    sameAccountAsPrimary = Boolean(primary.id && current.user.id && primary.id === current.user.id);
  }
  report = { checkedAt: new Date().toISOString(), credentialAccepted: true, sameAccountAsPrimary, ...budgetCheck(current) };
  if (fs.existsSync('docs/apify-discovery-report.json')) {
    const last = JSON.parse(fs.readFileSync('docs/apify-discovery-report.json', 'utf8'));
    if (/^[A-Za-z0-9]+$/.test(last.actorRunId || '')) {
      const run = await client.request(`/actor-runs/${last.actorRunId}`);
      report.lastRun = { id: run.id, status: run.status, usageTotalUsd: run.usageTotalUsd };
      if (/^[A-Za-z0-9]+$/.test(run.defaultDatasetId || '')) {
        const items = await client.request(`/datasets/${run.defaultDatasetId}/items?clean=true&format=json&limit=10`);
        // Only public business-post evidence; never persist comments, profiles or proxy fields.
        report.lastRun.records = items.map(row => ({
          keys: Object.keys(row), inputUrl: row.inputUrl, url: row.url,
          ownerUsername: row.ownerUsername, timestamp: row.timestamp,
          caption: String(row.caption || '').slice(0, 1800), locationName: row.locationName,
          errorCode: /^[a-zA-Z0-9_-]{1,100}$/.test(row.error || '') ? row.error : Boolean(row.error),
        }));
      }
    }
  }
} catch (error) {
  report = { checkedAt: new Date().toISOString(), credentialAccepted: false, allowed: false, reason: error.message };
  process.exitCode = 1;
}
fs.mkdirSync('output', { recursive: true });
fs.writeFileSync('output/apify-discovery-preflight.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));

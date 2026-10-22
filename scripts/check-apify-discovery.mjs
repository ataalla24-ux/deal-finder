import fs from 'node:fs';
import { ApifyDiscoveryClient, budgetCheck } from '../scraper/apify-discovery-client.js';

let report;
try {
  const current = await new ApifyDiscoveryClient(process.env.APIFY_2).preflight();
  let sameAccountAsPrimary = null;
  if (process.env.APIFY_TOKEN) {
    const primary = await new ApifyDiscoveryClient(process.env.APIFY_TOKEN).request('/users/me');
    sameAccountAsPrimary = Boolean(primary.id && current.user.id && primary.id === current.user.id);
  }
  report = { checkedAt: new Date().toISOString(), credentialAccepted: true, sameAccountAsPrimary, ...budgetCheck(current) };
} catch (error) {
  report = { checkedAt: new Date().toISOString(), credentialAccepted: false, allowed: false, reason: error.message };
  process.exitCode = 1;
}
fs.mkdirSync('output', { recursive: true });
fs.writeFileSync('output/apify-discovery-preflight.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));

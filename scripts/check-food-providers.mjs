import fs from 'node:fs/promises';
import { FoodProviderClient, ProviderError } from '../scraper/food-provider-client.js';
const providers = [];
for (const provider of ['scraperapi', 'scrapingbee', 'zyte']) {
  try { providers.push(await new FoodProviderClient(provider).usage()); }
  catch (error) { providers.push({ provider, error: error instanceof ProviderError ? error.message : 'usage-check-failed' }); }
}
const report = { checkedAt: new Date().toISOString(), chargedRequests: 0, providers };
await fs.mkdir('output', { recursive: true });
await fs.writeFile('output/food-provider-audit.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));

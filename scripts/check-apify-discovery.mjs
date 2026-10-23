import fs from 'node:fs';
import { ApifyDiscoveryClient, HASHTAG_ACTOR, PROFILE_CAP_USD, HASHTAG_CAP_USD, budgetCheck } from '../scraper/apify-discovery-client.js';
import { LIMITS } from '../scraper/apify-food-discovery-policy.js';

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
  report.hashtagBudget = budgetCheck(await client.preflight(HASHTAG_ACTOR), new Date(), HASHTAG_CAP_USD);
  report.configuredLimits = { ...LIMITS, profileCapUsd: PROFILE_CAP_USD, hashtagCapUsd: HASHTAG_CAP_USD };
  if (fs.existsSync('docs/apify-discovery-report.json')) {
    const last = JSON.parse(fs.readFileSync('docs/apify-discovery-report.json', 'utf8'));
    const lastIds = [...new Set((last.actorRuns?.map(row => row.id) || [last.actorRunId])
      .filter(id => /^[A-Za-z0-9]+$/.test(id || '')))].slice(-2);
    report.lastRuns = [];
    for (const lastId of lastIds) {
      const run = await client.request(`/actor-runs/${lastId}`);
      const evidence = { id: run.id, status: run.status, usageTotalUsd: run.usageTotalUsd };
      report.lastRuns.push(evidence);
      if (/^[A-Za-z0-9]+$/.test(run.defaultDatasetId || '')) {
        const items = await client.request(`/datasets/${run.defaultDatasetId}/items?clean=true&format=json&limit=${LIMITS.posts}`);
        // Only public business-post evidence; never persist comments, profiles or proxy fields.
        evidence.records = items.map(row => ({
          keys: Object.keys(row), inputUrl: row.inputUrl, url: row.url,
          ownerUsername: row.ownerUsername, timestamp: row.timestamp,
          caption: String(row.caption || '').slice(0, 1800), locationName: row.locationName,
          errorCode: /^[a-zA-Z0-9_-]{1,100}$/.test(row.error || '') ? row.error : Boolean(row.error),
          nestedPostsType: typeof row.posts, nestedPostsCount: Array.isArray(row.posts) ? row.posts.length : null,
          nestedPosts: Array.isArray(row.posts) ? row.posts.slice(0, 2).map(p => typeof p === 'string' ? p : ({
            keys: Object.keys(p || {}), url: p?.url, shortcode: p?.shortcode || p?.shortCode,
            timestamp: p?.timestamp, caption: String(p?.caption || '').slice(0, 1000), ownerUsername: p?.ownerUsername,
          })) : [],
        }));
      }
    }
    report.lastRun = report.lastRuns.at(-1) || null;
  }
} catch (error) {
  report = { checkedAt: new Date().toISOString(), credentialAccepted: false, allowed: false, reason: error.message };
  process.exitCode = 1;
}
fs.mkdirSync('output', { recursive: true });
fs.writeFileSync('output/apify-discovery-preflight.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));

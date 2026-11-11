// Historical, read-only reconciliation. No network, model, Graph or Slack calls.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { normalizeDeal, normalizeSeenPostCache, filterRecentlySeenDeals, filterAlreadyQueuedDeals,
  loadLiveDealDuplicateKeys, loadQueuedDealDuplicateKeys } from '../scraper/slack-notify.js';
import { filterDiscoveryDeals } from '../scraper/deal-discovery-policy.js';
import { filterModeratedDeals } from '../scraper/deal-moderation-utils.js';
import { enrichDealWithInstagramGraphEvidence } from '../scraper/instagram-graph-evidence.js';
import { buildInstagramDeliveryAudit } from '../scraper/instagram-delivery-audit.js';

const [collectorRef, dispatchRef] = process.argv.slice(2);
if (![collectorRef,dispatchRef].every(ref=>/^[a-f0-9]{7,40}$/i.test(ref || ''))) {
  throw new Error('Usage: node scripts/audit-instagram-delivery.mjs <collector-commit> <dispatch-commit>');
}
const read = (ref,name) => JSON.parse(execFileSync('git',['show',`${ref}:docs/${name}`],{maxBuffer:32e6}));
const deals = payload => Array.isArray(payload) ? payload : payload.deals;
const report = read(dispatchRef,'deal-validity-report.json');
const now = new Date(report.generatedAt);
const evidence = new Map(read(collectorRef,'instagram-graph-post-evidence.json').posts.map(post=>[post.postKey,post]));
const candidates = deals(read(collectorRef,'deals-pending-instagram-ai.json')).map(deal =>
  normalizeDeal(enrichDealWithInstagramGraphEvidence(deal,evidence).deal,'instagram-ai'));
const moderation = filterModeratedDeals(candidates,read(collectorRef,'deal-moderation.json')).deals;
const discovery = filterDiscoveryDeals(moderation).deals;
const cache = normalizeSeenPostCache(read(dispatchRef,'slack-seen-posts.json'),{now});
const unseen = filterRecentlySeenDeals(discovery,cache.keys).deals;
const notLive = filterAlreadyQueuedDeals(unseen,loadLiveDealDuplicateKeys(deals(read(collectorRef,'deals.json')))).deals;
const postedKeys = loadQueuedDealDuplicateKeys(deals(read(collectorRef,'deals-pending-all.json')));
const notQueued = filterAlreadyQueuedDeals(notLive,postedKeys).deals;
const rows = [...report.allowed.map(row=>({...row,allowed:true})),...report.blocked.map(row=>({...row,allowed:false}))];
const validation = {results: rows.map(row=>({deal:row,decision:row}))};
const audit = buildInstagramDeliveryAudit({candidates, now, validation, selected:report.allowed, stages:[
  {reason:'moderated',deals:moderation}, {reason:'discovery-excluded',deals:discovery},
  {reason:'already-seen-post',deals:unseen}, {reason:'already-live',deals:notLive}, {reason:'already-queued',deals:notQueued},
]});
// The dispatch seen-cache may include that run's sends. Cross-check against
// the pre-dispatch posted queue instead of treating new receipts as old ones.
audit.preDispatchQueueMatches = candidates.length-filterAlreadyQueuedDeals(candidates,postedKeys).deals.length;
audit.collectorRef=collectorRef;
audit.dispatchRef=dispatchRef;
audit.mode='saved-report-reconciliation; current code, historical state; not a new delivery';
fs.mkdirSync('output/social-delivery-2026-11-11',{recursive:true});
fs.writeFileSync('output/social-delivery-2026-11-11/historical-instagram.json',`${JSON.stringify(audit,null,2)}\n`);
console.log(JSON.stringify(audit,null,2));

import { buildAndWriteSocialFoodAudit } from '../scraper/social-food-audit.js';

const { audit, review } = buildAndWriteSocialFoodAudit();
console.log('Social Food candidate audit');
console.log(`  unique social posts: ${audit.observations.uniquePosts}`);
console.log(`  stratified sample: ${audit.auditSample.length}`);
console.log(`  review eligible: ${review.totalDeals}`);
console.log(`  manual approvals per day (7d): ${audit.manualOutcomeMetrics.approvedPerDay}`);

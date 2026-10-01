import assert from 'node:assert/strict';
import { isCommunitySubmission, normalizeDeal, revalidateRecentPostedQueue } from '../scraper/slack-notify.js';

const submission = normalizeDeal({
  id: 'community:test', submissionId: 'test', originSource: 'community-submission',
  source: 'Community Submission', title: 'Community-Deal prüfen',
  url: 'https://www.instagram.com/reel/test/',
}, 'community');
assert.equal(isCommunitySubmission(submission), true);
assert.equal(isCommunitySubmission({ ...submission, submissionId: '' }), false);
assert.equal(isCommunitySubmission({ ...submission, originSource: 'instagram' }), false);
assert.equal(isCommunitySubmission({ ...submission, id: 'scraped:test' }), false);
const result = await revalidateRecentPostedQueue([{ ...submission, slackTs: '123.456' }]);
assert.equal(result.validation, null);
assert.equal(result.changed, false);
assert.equal(result.deals.length, 1);
console.log('Community manual-review regression checks passed');

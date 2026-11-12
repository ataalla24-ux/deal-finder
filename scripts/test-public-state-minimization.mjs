import test from 'node:test';
import assert from 'node:assert/strict';
import { minimizePublicState, minimizeCapturedPublicStates } from './minimize-public-state.mjs';
import { normalizeReviewFeedbackStore, resolveHumanReviewDecision, upsertReviewFeedback } from '../scraper/deal-review-feedback.js';
import { stampDealsFeedBundle, computeDealsFeedVersion } from './deals-feed-contract.mjs';

test('removes only reviewer identity; human approval and rejection still work', () => {
  const original = {events:[{key:'deal:test',decision:'approved',decisionUser:'U_PRIVATE',decidedAt:'2026-11-12T08:00:00Z',slackTs:'1.1'}],updatedAt:'unchanged'};
  const clean = minimizePublicState('docs/deal-review-feedback.json', original);
  const {decisionUser, ...expected} = original.events[0];
  assert.deepEqual(clean, {...original,events:[expected]});
  assert.equal(normalizeReviewFeedbackStore(original).events[0].decisionUser, undefined);
  const resolved = resolveHumanReviewDecision({botUserId:'BOT',eventUser:'U_PRIVATE',eventReaction:'x'});
  assert.equal(resolved.decision, 'rejected');
  assert.equal(resolved.user, 'U_PRIVATE', 'authorization still uses the actual user in memory');
  const updated = upsertReviewFeedback(original,{id:'test'}, {decision:resolved.decision,user:resolved.user});
  assert.equal(updated.events[0].decision, 'rejected');
  assert.ok(!JSON.stringify(updated).includes('U_PRIVATE'));
});

test('live community offer retains every field except raw draft data', () => {
  const raw = {id:'community:test', title:'1 Euro Wrap', description:'Conditions',
    submissionId:'test',slackTs:'1.1',address:'Verified address',photoUrl:'https://example.invalid/food.jpg',
    submittedContent:{private:'raw submission'},communityExtraction:{private:'diagnostic'}};
  const merchant = {id:'merchant',title:'Offer',evidence:{source:'original'}};
  const data = {deals:[raw,merchant],lastUpdated:'unchanged',totalDeals:2};
  const clean = minimizePublicState('docs/deals.json', data);
  const {submittedContent,communityExtraction,...expected} = raw;
  assert.deepEqual(clean.deals,[expected,merchant]);
  assert.equal(clean.feedVersion,computeDealsFeedVersion(clean.deals));
  assert.equal(clean.lastUpdated,'unchanged');
  assert.deepEqual(minimizePublicState('docs/deals.json',clean),clean);
  assert.equal(stampDealsFeedBundle(data,{redemptionManifest:null}).deals[0].submittedContent,undefined);
  assert.ok(raw.submittedContent, 'no mutation of internal draft');
  const review = {entries:[{id:raw.id,status:'review',originalDeal:raw}]};
  assert.deepEqual(minimizePublicState('docs/verified-expiry-review.json',review),
    {entries:[{id:raw.id,status:'review',originalDeal:expected}]});
});

test('generated output boundary protects both initial and merged states without changing queues', () => {
  const content = Buffer.from('{"events":[{"key":"deal:test","decisionUser":"U_PRIVATE","decision":"approved"}]}');
  const [clean, queue] = minimizeCapturedPublicStates([
    {path:'docs/deal-review-feedback.json',exists:true,content},
    {path:'docs/deals-pending-all.json',exists:true,content},
  ]);
  assert.ok(!clean.content.toString().includes('U_PRIVATE'));
  assert.equal(queue.content,content);
});

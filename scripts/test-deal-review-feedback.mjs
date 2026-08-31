import assert from 'node:assert/strict';

import {
  normalizeReviewFeedbackStore,
  resolveHumanReviewDecision,
  reviewFeedbackKey,
  upsertReviewFeedback,
} from '../scraper/deal-review-feedback.js';

const deal = {
  id: 'food-1',
  url: 'https://www.instagram.com/reel/DealPost1/?igsh=tracking',
  title: 'Gratis Kaffee',
  category: 'kaffee',
  ownerUsername: 'foodiewien',
  sourceAccountType: 'creator',
  scoutUsername: 'foodiewien',
  merchantUsername: 'testcafe',
  slackTs: '123.456',
};

assert.equal(reviewFeedbackKey(deal), 'instagram:DealPost1');
assert.deepEqual(
  resolveHumanReviewDecision({
    botUserId: 'BOT',
    reactions: [
      { name: 'white_check_mark', users: ['U1'] },
      { name: 'x', users: ['U2'] },
    ],
  }),
  { decision: 'rejected', user: 'U2', source: 'reaction-scan' },
  'a rejection wins in fallback scans when both reactions exist',
);
assert.deepEqual(
  resolveHumanReviewDecision({
    botUserId: 'BOT',
    reactions: [{ name: 'x', users: ['U2'] }],
    eventReaction: 'white_check_mark',
    eventUser: 'U1',
  }),
  { decision: 'approved', user: 'U1', source: 'targeted-event' },
  'the exact targeted reaction event reflects the newest explicit decision',
);

let store = upsertReviewFeedback(normalizeReviewFeedbackStore(), deal, {
  slackSentAt: '2026-08-31T08:00:00Z',
  at: '2026-08-31T08:00:00Z',
});
store = upsertReviewFeedback(store, deal, {
  decision: 'approved',
  user: 'U1',
  decisionSource: 'targeted-event',
  publicationStatus: 'validator-blocked',
  validationReasons: ['missing expiry'],
  at: '2026-08-31T08:03:00Z',
});
assert.equal(store.events.length, 1);
assert.equal(store.events[0].decision, 'approved');
assert.equal(store.events[0].publicationStatus, 'validator-blocked');
assert.equal(store.events[0].slackSentAt, '2026-08-31T08:00:00.000Z');
assert.deepEqual(store.events[0].validationReasons, ['missing expiry']);

console.log('deal review feedback tests passed');

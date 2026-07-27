import assert from 'node:assert/strict';

import { makePolicyOverride } from './review-live-deals-llm.mjs';

const deal = {
  id: 'deal-a',
  title: 'Gratis Kaffee',
  category: 'kaffee',
  url: 'https://example.com/deal',
};

const blocked = makePolicyOverride({
  dealID: 'deal-a',
  decision: 'remove',
  reason: 'missing_link',
  confidence: 0.95,
  message: 'HTTP 403',
}, deal, {
  status: 'blocked',
  blockedByProtection: true,
});
assert.equal(blocked.decision, 'flag');
assert.equal(blocked.reason, 'weak_evidence');

const transient = makePolicyOverride({
  dealID: 'deal-a',
  decision: 'remove',
  reason: 'bad_source',
  confidence: 0.95,
  message: 'temporarily unavailable',
}, deal, {
  status: 'transient',
  transientError: true,
});
assert.equal(transient.decision, 'flag');
assert.equal(transient.reason, 'weak_evidence');

const socialShell = makePolicyOverride({
  dealID: 'deal-a',
  decision: 'remove',
  reason: 'bad_source',
  confidence: 0.95,
  message: 'TikTok shell without content',
}, {
  ...deal,
  url: 'https://www.tiktok.com/@example/video/123',
}, {
  status: 'ok',
  finalHost: 'www.tiktok.com',
  signals: {
    mentionsDealTitle: false,
    mentionsDealTerms: false,
    hasValidityDate: false,
  },
});
assert.equal(socialShell.decision, 'flag');
assert.equal(socialShell.reason, 'weak_evidence');

const missingLink = makePolicyOverride({
  dealID: 'deal-b',
  decision: 'flag',
  reason: 'weak_evidence',
  confidence: 0.7,
  message: 'No URL',
}, {
  ...deal,
  id: 'deal-b',
  url: '',
}, {
  status: 'missing_link',
});
assert.equal(missingLink.decision, 'remove');
assert.equal(missingLink.reason, 'missing_link');

console.log('Live deal LLM policy safety tests passed.');

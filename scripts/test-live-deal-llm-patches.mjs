import assert from 'node:assert/strict';

import { sanitizeLlmProposedPatch } from './live-deal-llm-patch-utils.mjs';

const deal = {
  id: 'deal-a',
  category: 'essen',
  type: 'rabatt',
  expires: '2026-06-30T23:59:59.999Z',
  expiryDisplayText: 'Bis 30. Juni 2026',
};

const strongEvidence = {
  status: 'ok',
  finalUrl: 'https://www.preisjaeger.at/deals/example-deal',
  invalid: false,
  transientError: false,
  blockedByProtection: false,
  dates: {
    targetDateRaw: 'Gültig bis 31. August 2026',
    targetDateKind: 'end',
    validFrom: '',
    validUntil: '2026-08-31',
  },
  signals: {
    mentionsDealTitle: true,
    mentionsDealTerms: true,
  },
};

const correctedDates = sanitizeLlmProposedPatch({
  decision: 'keep',
  reason: 'ok',
  confidence: 1,
  proposedPatch: {
    validUntil: '2026-12-31',
    expiryDisplayText: '2026-06-30',
  },
}, deal, strongEvidence);
assert.deepEqual(correctedDates, {
  validUntil: '2026-08-31',
  expiryDisplayText: 'Gültig bis 31. August 2026',
});

const weakEvidencePatch = sanitizeLlmProposedPatch({
  decision: 'flag',
  reason: 'weak_evidence',
  confidence: 0.9,
  proposedPatch: {
    validUntil: '2026-12-31',
  },
}, deal, {});
assert.deepEqual(weakEvidencePatch, {});

const genericPagePatch = sanitizeLlmProposedPatch({
  decision: 'keep',
  reason: 'ok',
  confidence: 1,
  proposedPatch: {
    validUntil: '2026-08-31',
  },
}, deal, {
  ...strongEvidence,
  signals: {
    mentionsDealTitle: false,
    mentionsDealTerms: true,
  },
});
assert.deepEqual(genericPagePatch, {});

const aggregatorPatch = sanitizeLlmProposedPatch({
  decision: 'keep',
  reason: 'ok',
  confidence: 1,
  proposedPatch: {
    validFrom: '2026-07-01',
    validUntil: '2026-07-31',
  },
}, deal, {
  ...strongEvidence,
  finalUrl: 'https://www.gutscheine.at/example',
  dates: {
    targetDateRaw: 'Aktuelle Gutscheine im Juli 2026',
    targetDateKind: 'range',
    validFrom: '2026-07-01',
    validUntil: '2026-07-31',
  },
});
assert.deepEqual(aggregatorPatch, {});

const categoryPatch = sanitizeLlmProposedPatch({
  decision: 'flag',
  reason: 'wrong_category',
  confidence: 0.9,
  proposedPatch: {
    category: 'kaffee',
    type: 'gratis',
  },
}, deal, strongEvidence);
assert.equal(categoryPatch.category, 'kaffee');
assert.equal(categoryPatch.type, 'gratis');

const removalPatch = sanitizeLlmProposedPatch({
  decision: 'remove',
  reason: 'bad_source',
  confidence: 0.99,
  proposedPatch: {
    validUntil: '2026-08-31',
  },
}, deal, strongEvidence);
assert.deepEqual(removalPatch, {});

console.log('Live deal LLM patch safety tests passed.');

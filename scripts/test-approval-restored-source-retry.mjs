import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isRestoredIamstudentApprovalRetry } from '../scraper/approval-restored-source-retry.js';
import { filterModeratedDeals } from '../scraper/deal-moderation-utils.js';

// Exact retained candidate and original failure; no output-directory dependency.
const candidate = {
  id: 'g2-15kbyb4',
  url: 'https://www.iamstudent.at/g/vapiano-gutschein-mit-50-prozent-studentenrabatt-gsh-wise26',
  slackTs: '1792798563.887069', slackThreadTs: '1792798563.697429',
  validUntil: '2027-02-28T12:00:00.000Z', expires: '2027-02-28',
  pipelineLifecycle: { manualDecision: 'approved' },
  approvalBlock: { reasons: ['URL ungültig (Inhalt nicht mehr verfügbar)'],
    checkedAt: '2026-10-25T11:24:57.678Z' },
};
const now = new Date('2026-11-14T09:47:56.586Z');

test('the actual old VAPIANO hold is eligible without mutating its decision or block', () => {
  const before = structuredClone(candidate);
  assert.equal(isRestoredIamstudentApprovalRetry(candidate, now), true);
  assert.deepEqual(candidate, before);
});

test('only the exact supported voucher URL qualifies', () => {
  for (const url of [candidate.url + '/', candidate.url + '?source=review',
    candidate.url.replace('www.iamstudent.at', 'iamstudent.at'),
    candidate.url.replace('wise26', 'wise27'), 'https://www.iamstudent.at/',
    'https://www.instagram.com/p/Example/', 'https://www.preisjaeger.at/deals/example',
    'https://www.iamstudent.at.evil.example/g/vapiano']) {
    assert.equal(isRestoredIamstudentApprovalRetry({ ...candidate, url }, now), false, url);
  }
});

test('the stored approval is required; top-level flags or rejected decisions do not substitute', () => {
  for (const pipelineLifecycle of [undefined, {}, { manualDecision: 'rejected' }, { manualDecision: '' }]) {
    assert.equal(isRestoredIamstudentApprovalRetry({ ...candidate, pipelineLifecycle,
      manualDecision: 'approved', approvedAt: now.toISOString() }, now), false);
  }
});

test('unrelated, expired, removed and mixed block reasons do not become retryable', () => {
  for (const reasons of [undefined, [], ['URL ungültig (HTTP 404)'], ['Inhalt nicht mehr verfügbar'],
    ['abgelaufen (2026-11-13)'], ['aus Slack Live-Review entfernt'],
    ['kein konkretes Angebot erkennbar'], ['Angebotsbeleg ausstehend'],
    [...candidate.approvalBlock.reasons, 'abgelaufen (2026-11-13)'],
    [...candidate.approvalBlock.reasons, 'nicht eindeutig in Wien']]) {
    assert.equal(isRestoredIamstudentApprovalRetry({ ...candidate, approvalBlock: { reasons } }, now), false);
  }
});

test('known expired dates cannot consume a restored-source slot', () => {
  for (const patch of [{ validUntil: '2026-11-13' }, { expires: '2026-11-13T23:59:59.999Z' },
    { expiryKind: 'single', validOn: '2026-11-13' }]) {
    assert.equal(isRestoredIamstudentApprovalRetry({ ...candidate, ...patch }, now), false);
  }
  assert.equal(isRestoredIamstudentApprovalRetry({ ...candidate, validUntil: '2026-11-14' }, now), true);
  assert.equal(isRestoredIamstudentApprovalRetry(candidate, new Date('2027-03-01T00:00:00Z')), false);
});

test('existing moderation removes the exact candidate before retry selection', () => {
  for (const moderation of [
    { hiddenDeals: [{ id: candidate.id, reason: 'aus Slack Live-Review entfernt' }] },
    { hiddenDeals: [{ url: candidate.url, reason: 'removed' }] },
  ]) {
    const filtered = filterModeratedDeals([candidate], moderation);
    assert.equal(filtered.removed.length, 1);
    assert.deepEqual(filtered.deals.filter(deal => isRestoredIamstudentApprovalRetry(deal, now)), []);
  }
});

test('the production retry filter includes the old approved hold in existing slots', () => {
  // Exercise the actual pure selector expression without importing the runner,
  // loading credentials, invoking Slack, or duplicating its scheduling logic.
  const source = readFileSync(new URL('../scraper/slack-approve.js', import.meta.url), 'utf8');
  const expression = source.match(/const approvalRetries = ([\s\S]*?);\n  const retryThreads/)[1];
  const select = new Function('queuedDeals', 'cleanText', 'ensureArray', 'isApprovalRetryReason',
    'isRestoredIamstudentApprovalRetry', 'APPROVE_FULL_SCAN_MAX_THREADS', 'APPROVE_FULL_SCAN_MAX_DEALS',
    `return ${expression};`);
  const run = (rows, maxThreads = 24, maxDeals = 500) => select(rows,
    value => String(value || '').trim(), value => Array.isArray(value) ? value : [],
    reason => reason === 'Angebotsbeleg ausstehend',
    deal => isRestoredIamstudentApprovalRetry(deal, now), maxThreads, maxDeals);
  const ordinary = Array.from({ length: 5 }, (_, index) => ({ ...candidate, id: `normal-${index}`,
    url: 'https://example.invalid/', slackTs: `179400000${index}.1`, slackThreadTs: `179400000${index}.0`,
    approvalBlock: { reasons: ['Angebotsbeleg ausstehend'], checkedAt: `2026-11-0${index + 1}T00:00:00Z` } }));
  const rows = [candidate, ...ordinary];
  assert.deepEqual(run(rows).map(x => x.id), [candidate.id, 'normal-0', 'normal-1', 'normal-2']);
  assert.equal(run(rows).length, 4, 'restored source consumes one of the existing four slots');
  assert.equal(run(rows, 1).length, 1);
  assert.equal(run(rows, 24, 2).length, 2);
});

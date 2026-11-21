import assert from 'node:assert/strict';
import test from 'node:test';
import { loadAiCreditPolicy } from '../scraper/ai-credit-budget.js';
import { releaseSettledOverrun, requireRecoveryGeneration } from './release-settled-openai-overrun-20261121.mjs';

const now = Date.parse('2026-11-21T12:49:00Z'), policy = loadAiCreditPolicy();
const commit = 'c0b4829031f8fbb4db9d86744670bd8e111d9ffa';
function state() {
  const at = 1795265195768, expiresAt = Date.parse(policy.expiresAt);
  const incident = { reservationId: '2d864fd3-9a11-4b8e-8e11-20764a607266',
    model: 'gpt-6.2-sol', reservedUsd: 0.117935, actualUsd: 0.141308 };
  const row = { id: incident.reservationId, model: incident.model, at, expiresAt, status: 'settled', count: 1,
    creditPeriod: policy.periodId, usd: incident.actualUsd, reservedUsd: incident.reservedUsd };
  return { version: 1, creditPeriod: policy.periodId, pausedUntil: expiresAt, costOverrun: incident,
    modelPausedUntil: { retired: at - 86400000 }, reservations: [
      { ...row, id: '4513a121-cb88-48ec-81d1-8dcaf179f3ac', at: at - 2000, usd: 0.139558 },
      { ...row, id: 'uncertain', at: at - 1000, usd: 0.3, status: 'reserved' }, row] };
}

test('release preserves the fully metered call, earlier reconciliation and uncertain reservations exactly', () => {
  const s = state(), before = structuredClone(s);
  assert.deepEqual(releaseSettledOverrun(s, policy, now), {
    version: 1, creditPeriod: policy.periodId, pausedUntil: 0, modelPausedUntil: s.modelPausedUntil, reservations: s.reservations });
  assert.deepEqual(s, before);
});

test('other incident, parallel booking, unbooked costs, foreign pauses or changed cap cannot authorize a release', () => {
  for (const mutate of [s => s.costOverrun.reservationId = 'other', s => s.pausedUntil--,
    s => s.reservations.push({ ...s.reservations[2], id:'concurrent', at: now }),
    s => s.reservations[2].status = 'reserved', s => s.reservations[2].usd = 0.117935,
    s => s.modelPausedUntil.other = now + 5000, s => s.reservations[0].usd = 99]) {
    const s = state();
    mutate(s);
    assert.throws(() => releaseSettledOverrun(s, policy, now));
  }
  assert.throws(() => releaseSettledOverrun(state(), { ...policy, periodLimitUsd: 101 }, now));
});

test('only exact incident head allows CAS; confirmed first child is idempotent and other heads never write', () => {
  assert.equal(requireRecoveryGeneration(commit, 'earlier', 'old', 'new'), 'ready');
  assert.equal(requireRecoveryGeneration('child', commit, 'new', 'new'), 'already-applied');
  assert.throws(() => requireRecoveryGeneration('child', commit, 'foreign', 'new'));
  assert.throws(() => requireRecoveryGeneration('grandchild', 'concurrent', 'new', 'new'));
});

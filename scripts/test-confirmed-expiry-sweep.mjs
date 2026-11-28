import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { captureApprovedExpiryEvidence } from './approved-expiry-evidence.mjs';
import { maintainDeals, maintainFeedFile } from './automatic-deal-maintenance.mjs';

const now = new Date('2026-11-28T12:00:00Z');
const policy = { version: 1, enabled: true, automaticExpiry: true, maxNewHidesPerRun: 5,
  protectedMerchants: ['Wolt'] };
function confirmed(id, changes = {}) {
  const deal = { id, brand: 'Fixture merchant', title: '25 % Rabatt', description: 'Ein bestätigter Aktionsrabatt.',
    url: `https://merchant.example/offers/${id}`, approvedAt: '2026-11-26T10:00:00Z',
    expiryKind: 'end', validUntil: '2026-11-27', expires: '2026-11-27T23:59:59.999Z',
    expiresOriginal: 'Bis 27.11.2026', expiryDisplayText: 'Bis 27.11.2026', ...changes };
  return { ...deal, approvedExpiryEvidence: captureApprovedExpiryEvidence(deal,
    { sourceText: `25 % Rabatt. Gültig bis ${deal.validUntil.slice(8)}.${deal.validUntil.slice(5, 7)}.${deal.validUntil.slice(0, 4)}.`,
      verifiedAt: deal.approvedAt, now }) };
}
const eight = () => Array.from({ length: 8 }, (_, i) => confirmed(`expired-${i}`));

test('an explicitly requested complete sweep removes every confirmed elapsed offer in one pass', () => {
  const deals = eight();
  const result = maintainDeals(deals, { policy, now, scheduledExpiryOnly: true, confirmedExpirySweep: true });
  assert.deepEqual(result.deals, []);
  assert.equal(result.state.hidden.length, 8);
  assert.deepEqual(result.state.hidden.map(row => row.originalDeal), deals);
  assert.deepEqual(result.report.expiry, {
    mode: 'complete-confirmed', assessedCount: 8, confirmedExpiredCount: 8,
    removedCount: 8, deferredCount: 0, keptCount: 0,
    assessments: result.report.expiry.assessments,
  });
  assert.deepEqual(result.report.expiry.assessments.map(row => row.id), deals.map(row => row.id));
  for (const row of result.report.expiry.assessments) {
    assert.equal(row.eligible, true);
    assert.equal(row.action, 'removed');
    assert.equal(row.reason, 'literal-source-end-with-year');
    assert.match(row.evidenceHash, /^[a-f0-9]{64}$/);
  }
});

test('regular modes keep their configured cap and report all cap-deferred confirmed ends', () => {
  for (const confirmedExpirySweep of [undefined, false, 'true', 1]) {
    const result = maintainDeals(eight(), { policy, now, scheduledExpiryOnly: true, confirmedExpirySweep });
    assert.equal(result.report.hidden.length, 5);
    assert.equal(result.deals.length, 3);
    assert.equal(result.report.expiry.mode, 'bounded');
    assert.equal(result.report.expiry.confirmedExpiredCount, 8);
    assert.equal(result.report.expiry.deferredCount, 3);
    assert.deepEqual(result.report.expiry.assessments.slice(5).map(row => [row.action, row.constraintReason]),
      [['deferred', 'new-hide-cap'], ['deferred', 'new-hide-cap'], ['deferred', 'new-hide-cap']]);
  }
  assert.equal(maintainDeals(eight(), { policy: { ...policy, maxNewHidesPerRun: 2 }, now }).deals.length, 6);
  assert.equal(maintainDeals(eight(), { policy: { ...policy, maxNewHidesPerRun: 2 }, now,
    confirmedExpirySweep: true }).deals.length, 0);
});

test('complete expiry-only reporting retains every unconfirmed, protected or contradictory row', () => {
  const guessed = { ...confirmed('guessed'), approvedExpiryEvidence: undefined };
  const wrongSource = { ...confirmed('wrong-source'), url: 'https://other.example/another-offer' };
  const kept = confirmed('owner-keep', { forceKeep: true });
  const business = confirmed('business', { isBusinessAdvertisement: true });
  const protectedMerchant = confirmed('protected-merchant', { brand: 'Wolt' });
  const cleared = confirmed('cleared');
  const future = confirmed('future', { validUntil: '2026-11-29', expires: '2026-11-29T23:59:59.999Z',
    expiresOriginal: 'Bis 29.11.2026', expiryDisplayText: 'Bis 29.11.2026' });
  const blocked = confirmed('blocked'), extended = confirmed('extended'), undated = confirmed('undated');
  const holds = [guessed, wrongSource, kept, business, protectedMerchant, cleared, future, blocked, extended, undated];
  const sourceEvidence = new Map([[blocked.id, { blockingReason: 'source-unavailable' }],
    [extended.id, { officialText: '25 % Rabatt. Die Aktion wurde verlängert bis 30.11.2026.' }],
    [undated.id, { officialText: 'Aktueller Vorteil ohne bestätigtes Ende.' }]]);
  const deals = [...eight(), ...holds];
  const result = maintainDeals(deals, { policy, now, scheduledExpiryOnly: true, confirmedExpirySweep: true,
    edits: [{ dealId: cleared.id, clearFields: ['validUntil'] }], sourceEvidence });
  assert.deepEqual(result.deals, holds);
  assert.equal(result.report.expiry.assessedCount, deals.length);
  assert.equal(result.report.expiry.removedCount, 8);
  assert.equal(result.report.expiry.keptCount, holds.length);
  assert.equal(result.report.expiry.deferredCount, 0);
  for (const deal of holds) {
    const row = result.report.expiry.assessments.find(row => row.id === deal.id);
    assert.equal(row.action, 'retained', deal.id);
    assert.equal(row.eligible, false, deal.id);
    assert.ok(row.reason, deal.id);
  }
  assert.equal(result.report.expiry.assessments.find(row => row.id === cleared.id).reason, 'manual-period-cleared');
});

test('complete sweeps never enable disabled removal policy or disabled maintenance', () => {
  const disabledRemoval = maintainDeals(eight(), { policy: { ...policy, automaticExpiry: false }, now,
    scheduledExpiryOnly: true, confirmedExpirySweep: true });
  assert.equal(disabledRemoval.deals.length, 8);
  assert.equal(disabledRemoval.report.expiry.confirmedExpiredCount, 8);
  assert.equal(disabledRemoval.report.expiry.removedCount, 0);
  assert.equal(disabledRemoval.report.expiry.deferredCount, 0);
  assert.ok(disabledRemoval.report.expiry.assessments.every(row => row.action === 'retained'
    && row.constraintReason === 'automatic-expiry-disabled'));
  const disabled = maintainDeals(eight(), { policy: { ...policy, enabled: false }, now,
    scheduledExpiryOnly: true, confirmedExpirySweep: true });
  assert.equal(disabled.deals.length, 8);
  assert.equal(disabled.report.mode, 'disabled');
  assert.equal(disabled.report.expiry.assessedCount, 0);
  assert.equal(disabled.report.expiry.assessments.length, 8);
  assert.ok(disabled.report.expiry.assessments.every(row => row.reason === 'maintenance-disabled'));
});

test('archived removals replay without consuming new slots or duplicating retained originals', () => {
  const deals = eight();
  const first = maintainDeals(deals, { policy, now, confirmedExpirySweep: true });
  const replay = maintainDeals(deals, { policy, now, state: first.state, scheduledExpiryOnly: true });
  assert.deepEqual(replay.deals, []);
  assert.equal(replay.report.newHides, 0);
  assert.equal(replay.state.hidden.length, 8);
  assert.ok(replay.report.hidden.every(row => row.replay));
  assert.deepEqual(replay.state.hidden, first.state.hidden);
});

test('file-level preview passes the explicit sweep through, reports all rows and writes nothing', async t => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'confirmed-expiry-sweep-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  for (const directory of ['docs', 'reviews']) fs.mkdirSync(path.join(cwd, directory));
  const feedPath = path.join(cwd, 'docs/deals.json'), statePath = path.join(cwd, 'reviews/automatic-deal-maintenance-state.json');
  fs.writeFileSync(path.join(cwd, 'reviews/automatic-maintenance-policy.json'), JSON.stringify(policy));
  fs.writeFileSync(feedPath, JSON.stringify({ deals: eight(), totalDeals: 8 }));
  fs.writeFileSync(statePath, JSON.stringify({ version: 1, hidden: [], corrections: [] }));
  const beforeFeed = fs.readFileSync(feedPath), beforeState = fs.readFileSync(statePath);
  let calls = 0;
  const options = { cwd, now, apply: false, allowAi: true, scheduledExpiryOnly: true,
    request: async () => { calls++; throw Error('No provider calls in a local expiry sweep'); } };
  assert.equal((await maintainFeedFile(options)).deals.length, 3);
  const result = await maintainFeedFile({ ...options, confirmedExpirySweep: true });
  assert.equal(result.deals.length, 0);
  assert.equal(result.report.expiry.assessments.length, 8);
  assert.equal(result.report.expiry.deferredCount, 0);
  assert.equal(calls, 0);
  assert.deepEqual(fs.readFileSync(feedPath), beforeFeed);
  assert.deepEqual(fs.readFileSync(statePath), beforeState);
});

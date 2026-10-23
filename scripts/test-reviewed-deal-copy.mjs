import assert from 'node:assert/strict';
import { applyReviewedDealCopy } from './apply-reviewed-deal-copy.mjs';
import { applyLiveDealEditsToBundle } from './live-deal-edits-lib.mjs';

const bundle = { lastUpdated: '2026-10-22T00:00:00Z', totalDeals: 3, deals: [
  { id: 'pizza', title: 'Gemeinsam schmeckt es besser', description: 'Gutschein nötig.', expires: '2026-10-31', votes: 4, type: 'gratis' },
  { id: 'ended', title: 'Eröffnungsangebot am 22.10.', description: 'Nur am Eröffnungstag.', expires: '2026-10-22', votes: 2 },
  { id: 'kept', title: 'Kaffee für 2 €', description: 'Montag bis Freitag.', expires: '', votes: 1 },
] };
const store = { version: 1, updatedAt: '', edits: [] };
const review = { reviewedAt: '2026-10-23', reviewedCount: 3, changes: [
  { id: 'pizza', before: bundle.deals[0].title, fields: { title: '1+1 Pizza gratis mit Gutschein', type: 'bogo' }, reason: 'Verified product and benefit.' },
  { id: 'ended', before: bundle.deals[1].title, fields: { title: 'Eröffnungsangebot am 22.10.', hidden: true }, reason: 'Documented end date.' },
], kept: [{ id: 'kept', reason: 'Already clear.' }] };
const before = structuredClone(bundle);
const result = applyReviewedDealCopy(bundle, store, review, '2026-10-23T09:00:00Z');
assert.deepEqual(bundle, before, 'dry-run does not mutate input');
assert.equal(store.edits.length, 0, 'dry-run does not mutate stored edits');
assert.deepEqual(result.bundle.deals.map(row => row.id), ['pizza', 'kept']);
assert.equal(result.bundle.deals[0].expires, before.deals[0].expires);
assert.equal(result.bundle.deals[0].votes, before.deals[0].votes);
assert.equal(result.bundle.deals[0].type, 'bogo');
assert.deepEqual(result.bundle.deals[1], before.deals[2]);
assert.equal(result.report.hidden[0].originalDeal.description, before.deals[1].description);
assert.equal(result.store.edits.find(row => row.dealId === 'ended').restoreDeal.title, before.deals[1].title);
assert.equal(result.store.edits.find(row => row.dealId === 'ended').manualRemovalApproved, true);
const replay = applyLiveDealEditsToBundle(result.bundle, result.store, { allowRemovals: false, allowManualRemovals: true });
assert.deepEqual(replay.bundle.deals, result.bundle.deals, 'persistent replay cannot restore or regress reviewed copy');
const changedInventory = structuredClone(bundle);
changedInventory.deals.push({ id: 'new', title: 'New deal' });
assert.throws(() => applyReviewedDealCopy(changedInventory, store, review), /inventory changed/);
const changedTitle = structuredClone(bundle);
changedTitle.deals[0].title = 'Concurrent owner correction';
assert.throws(() => applyReviewedDealCopy(changedTitle, store, review), /Title changed since review/);
const widened = structuredClone(review);
widened.changes[0].fields.expires = '2027-10-31';
assert.throws(() => applyReviewedDealCopy(bundle, store, widened), /Only reviewed copy/);
const duplicate = structuredClone(review);
duplicate.kept.push({ id: 'pizza' });
assert.throws(() => applyReviewedDealCopy(bundle, store, duplicate), /Duplicate reviewed ID/);
console.log('Reviewed deal copy: dry-run isolation, exact inventory, concurrent edits, protected fields, persistent replay and recoverable hides passed');

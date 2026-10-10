import assert from 'node:assert/strict';
import { activeBusinessDeals, refreshBusinessSnapshot } from './deal-map-business.mjs';
const now = new Date('2026-10-10T12:00:00Z');
const campaign = { id: 'test-id', restaurantName: 'Example', dealTitle: 'Lunch', address: 'Wollzeile 29, 1010 Wien',
  startsAt: now.getTime() - 1000, endsAt: now.getTime() + 86400000, status: 'paid', email: 'private@example.invalid', transactionId: 'secret' };
const refresh = campaigns => refreshBusinessSnapshot({ now, fetcher: async () => ({ ok: true, json: async () => ({ ok: true, campaigns }) }) });
const result = await refresh([campaign, { ...campaign, id: 'expired', endsAt: now.getTime() }, { ...campaign, id: 'hidden', status: 'hidden' }]);
assert.equal(result.snapshot.deals.length, 1);
assert.equal(result.snapshot.deals[0].id, 'merchant-test-id');
assert.equal(result.snapshot.deals[0].address, campaign.address);
assert.ok(!JSON.stringify(result.snapshot).includes('secret'));
assert.ok(!JSON.stringify(result.snapshot).includes('private@'));
assert.deepEqual((await refresh([])).snapshot.deals, [], 'A successful empty feed removes hidden campaigns');
const outage = await refreshBusinessSnapshot({ snapshot: result.snapshot, now, fetcher: async () => { throw new Error('offline'); } });
assert.deepEqual(outage.snapshot, result.snapshot);
assert.equal(activeBusinessDeals(outage.snapshot, new Date(now.getTime() + 86400000)).length, 0);
const invalid = await refreshBusinessSnapshot({ snapshot: result.snapshot, now, fetcher: async () => ({ ok: true, json: async () => ({ error: 'unavailable' }) }) });
assert.deepEqual(invalid.snapshot, result.snapshot);
console.log('Business map projection: IDs, active/hidden/expiry, outage recovery and private-field isolation passed.');

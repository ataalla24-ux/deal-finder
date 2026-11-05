import assert from 'node:assert/strict';
import { requireApprovalMap } from './approval-map-readiness.mjs';
const now = new Date('2026-11-05T10:00:00Z');
const deal = { id: 'new-cafe', brand: 'Cafe Fixture', title: 'Kaffee gratis', category: 'Essen',
  description: 'Kaffee vor Ort', address: 'Am Hof 4, 1010 Wien', location: 'Wien' };
const validation = deals => ({ allowedDeals: deals, blockedDeals: [],
  results: deals.map(deal => ({ deal, decision: { allowed: true, reasons: [], warnings: [] } })) });
let calls = 0;
const lookup = async () => { calls++; return { latitude: 48.211, longitude: 16.369,
  address: 'Am Hof 4, 1010 Wien', source: 'official-fixture', featureId: 'fixture' }; };
const ready = await requireApprovalMap(validation([deal]), { now, lookup });
assert.equal(calls, 1);
assert.equal(ready.validation.allowedDeals.length, 1);
assert.ok(ready.map.locations.some(row => row.dealIds.includes(deal.id)));
const replay = await requireApprovalMap(validation([deal]), { now, map: ready.map, cache: ready.cache,
  catalog: ready.catalog, lookup: () => { throw Error('cached location must not refetch'); } });
assert.equal(replay.requests, 0);
assert.equal(replay.validation.allowedDeals.length, 1);
const missing = { ...deal, id: 'no-address', address: '', location: 'Wien' };
const held = await requireApprovalMap(validation([missing]), { now, lookup });
assert.equal(held.validation.allowedDeals.length, 0);
assert.equal(held.validation.blockedDeals[0].id, missing.id);
assert.equal(held.validation.summary.allowed, 0);
assert.equal(held.validation.summary.blocked, 1);
assert.equal(held.validation.report.blocked.length, 1);
assert.match(held.validation.results[0].decision.reasons[0], /Kartenstandort fehlt/);
const failed = await requireApprovalMap(validation([deal]), { now, lookup: async () => { throw Error('503'); } });
assert.equal(failed.validation.allowedDeals.length, 0);
const online = { id: 'online', brand: 'Online', title: 'Rabatt im Onlineshop', description: 'Nur online einloesen', location: 'Online' };
const exempt = await requireApprovalMap(validation([online]), { now, lookup });
assert.equal(exempt.validation.allowedDeals.length, 1);
assert.equal(exempt.requests, 0);
const existing = await requireApprovalMap(validation([missing]), { now, existingDeals: [missing], lookup });
assert.equal(existing.changed, false);
assert.equal(existing.validation.allowedDeals.length, 1);
const blocked = validation([deal]);
blocked.results[0].decision = { allowed: false, reasons: ['expired'] };
blocked.allowedDeals = []; blocked.blockedDeals = [deal];
assert.deepEqual((await requireApprovalMap(blocked, { now, lookup })).validation, blocked);
console.log('PASS: new on-site map gate, cached exact reuse, missing address, outage, online exemption, prior live preservation and validity guard');

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

const original = { ...missing, id: 'official-source-fixture', url: 'https://cafemorgen.at/angebote/kaffee',
  title: 'Gratis Kaffee zum Fruehstueck', description: 'Gratis Kaffee zum Fruehstueck bei Cafe Fixture.',
  validUntil: '2026-11-30' };
const postal = { '@type': 'PostalAddress', streetAddress: 'Am Hof 4', postalCode: '1010', addressLocality: 'Wien' };
const business = { '@type': 'Restaurant', name: original.brand, address: postal, url: original.url, mainEntityOfPage: original.url };
const fixturePage = (url, message) => ({ url, status: 200, headers: { 'content-type': 'text/html' }, body: `<main>
  <script type="application/ld+json">${JSON.stringify(business)}</script><h1>${original.title}</h1><p>${message}</p></main>` });
const fetchPage = async url => url.endsWith('/robots.txt') ? { url, status: 404 }
  : fixturePage(url, 'Dieses Angebot gilt bei Cafe Fixture, Am Hof 4, 1010 Wien.');
const oldMap = { locations: [{ id: 'old-pin', address: 'Wollzeile 29, 1010 Wien', latitude: 48.21, longitude: 16.371,
  source: 'existing-proof', confidence: 1, managedBy: 'exact-vienna-address-v1', dealIds: ['existing'] }] };
const recovered = await requireApprovalMap(validation([original]), { now, lookup, map: oldMap, fetchPage, maxSourceRequests: 2 });
assert.equal(recovered.sourceRequests, 2);
assert.equal(recovered.validation.allowedDeals[0].id, original.id);
assert.deepEqual(recovered.map.locations[0], oldMap.locations[0]);
assert.ok(recovered.map.locations.some(row => row.dealIds.includes(original.id)));
const unproven = await requireApprovalMap(validation([original]), { now, lookup, map: oldMap, maxSourceRequests: 2,
  fetchPage: async url => url.endsWith('/robots.txt') ? { url, status: 404 } : fixturePage(url, 'Cafe Fixture, Am Hof 4, 1010 Wien.') });
assert.equal(unproven.validation.allowedDeals.length, 0);
assert.deepEqual(unproven.map, oldMap);
assert.equal(unproven.projectionChanged, false);
console.log('PASS: new on-site map gate, cached exact reuse, missing address, outage, online exemption, prior live preservation and validity guard');

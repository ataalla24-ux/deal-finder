import assert from 'node:assert/strict';
import { candidatesFor, enrichMap, extractAddresses, onlineOnly, selectExactFeature, inspectDealLocation } from './deal-map-enrichment.mjs';

assert.deepEqual(extractAddresses('Alpizena, Braunhubergasse 19, 1110 Wien'), [{ street: 'Braunhubergasse', number: '19', postalCode: '1110' }]);
assert.equal(extractAddresses('Wien, 20% Rabatt').length, 0);
assert.equal(extractAddresses('Schottengasse, Wien').length, 0);
assert.equal(extractAddresses('Landstraßer Hauptstraße 71, 1030 Wien')[0].street, 'Landstraßer Hauptstraße');
assert.equal(onlineOnly({ url: 'https://wolt.com/test', title: 'Döner', distance: 'Wien' }), true);
assert.equal(onlineOnly({ distance: 'Braunhubergasse 19', description: 'Gutschein online holen' }), false);
assert.equal(onlineOnly({ distance: 'Mehrere Standorte in Wien', description: 'Gutschein online holen' }), false);
const deal = { id: 'test', brand: 'Restaurant', distance: 'Braunhubergasse 19, 1110 Wien' };
assert.equal(extractAddresses('Wollzeile 29, 1010 Wien')[0].street, 'Wollzeile');
assert.equal(extractAddresses('Wien 1200 Dresdnerstrasse 115')[0].street, 'Dresdnerstrasse');
assert.equal(candidatesFor({ id: 'forno', distance: 'Wien', description: 'Pizza gratis. 📍Wollzeile 29 • 1010 #wien' }, {}, '2026-10-09').addresses[0].street, 'Wollzeile');
assert.equal(candidatesFor({ id: 'loving', brand: 'Loving Hut Neubau, Neubaugürtel 38/5', distance: '1070 Wien' }, {}, '2026-10-09').addresses[0].number, '38/5');
assert.equal(candidatesFor({ id: 'other', description: 'Hauptstraße 1, Graz' }, {}, '2026-10-09').addresses.length, 0);
assert.equal(candidatesFor({ id: 'papa', distance: '1060 Wien', viennaEvidence: { verified: true, detail: 'Nur bei Papa Duck, Barnabitengasse 1, 1060 Wien' } }, {}, '2026-10-09').addresses[0].street, 'Barnabitengasse');
assert.equal(candidatesFor({ id: 'unverified', distance: 'Wien', viennaEvidence: { verified: false, detail: 'Barnabitengasse 1, 1060 Wien' } }, {}, '2026-10-09').addresses.length, 0);
assert.equal(candidatesFor({ ...deal, description: 'Nur Sonntag: Wagramer Straße 126' }, {}, '2026-09-30').reason, 'multiple-branches-need-review');
const reviewed = { test: { locations: [{ street: 'A', number: '1', validUntil: '2026-09-27' }, { street: 'B', number: '2', validUntil: '2026-10-04' }] } };
assert.equal(candidatesFor(deal, reviewed, '2026-09-30').addresses.length, 1);
const feature = { id: '1', properties: { NAME_STR: 'Braunhubergasse', NAME_ONR: '19', PLZ: '1110' }, geometry: { type: 'Point', coordinates: [16.41565621, 48.17024268] } };
const address = extractAddresses(deal.distance)[0];
assert.equal(selectExactFeature([feature], address), feature);
assert.equal(selectExactFeature([{ ...feature, properties: { NAME_STR: 'Dresdner Straße', NAME_ONR: '115', PLZ: '1200' } }], { street: 'Dresdnerstrasse', number: '115', postalCode: '1200' })?.id, '1');
assert.equal(selectExactFeature([feature], { ...address, number: '17' }), null);
assert.equal(selectExactFeature([feature], { ...address, postalCode: '1020' }), null);
assert.equal(selectExactFeature([feature, { ...feature, geometry: { type: 'Point', coordinates: [16.5, 48.2] } }], address), null);
const map = { schemaVersion: 1, lastUpdated: '2026-09-01T00:00:00Z', locations: [] };
let calls = 0;
const lookup = async () => { calls++; return { latitude: 48.17024268, longitude: 16.41565621, address: deal.distance, source: 'test' }; };
const now = new Date('2026-09-30T12:00:00Z');
const first = await enrichMap({ deals: [deal], map, lookup, now });
assert.equal(first.map.locations.length, 1);
assert.equal(first.report.mappedDeals, 1);
const second = await enrichMap({ deals: [deal], map: first.map, cache: first.cache, lookup, now });
assert.deepEqual(second.map, first.map);
assert.equal(calls, 1);
assert.equal(second.requests, 0);
assert.equal(second.map.locations[0].brandMatches, undefined);
const unresolved = await enrichMap({ deals: [{ id: 'city', distance: 'Wien' }], map, lookup, now });
assert.equal(unresolved.map.locations.length, 0);
assert.equal(unresolved.report.deals[0].status, 'missing-exact-address');
const budget = await enrichMap({ deals: [deal], map, lookup, now, maxRequests: 0 });
assert.deepEqual(budget.report.deals[0].failures, ['request-budget']);
const staleCache = structuredClone(first.cache);
Object.values(staleCache)[0].checkedAt = '2025-01-01T00:00:00Z';
const outage = await enrichMap({ deals: [deal], map: first.map, cache: staleCache, now,
  lookup: async () => { throw new Error('offline'); } });
assert.deepEqual(outage.map, first.map);
const existing = { id: 'old', dealIds: ['another'], name: 'Existing chain', address: 'Wagramer Straße 94, 1220 Wien',
  latitude: 48.24, longitude: 16.43, source: 'official-store-finder', confidence: 1 };
const preserved = await enrichMap({ deals: [deal, { id: 'another', brand: 'Existing chain', distance: 'Wien' }], map: { ...map, locations: [existing] }, lookup, now });
assert.deepEqual(preserved.map.locations[0], existing);
const partialReview = { test: { incomplete: true, locations: [address] } };
const partial = await enrichMap({ deals: [deal], map: first.map, catalog: first.catalog, cache: first.cache,
  reviewed: partialReview, now, lookup: async()=>{throw Error('unexpected lookup');} });
assert.equal(partial.report.deals[0].status, 'partially-mapped');
assert.equal(partial.report.deals[0].needsReview, true);
assert.deepEqual(partial.report.deals[0].failures, ['reviewed-location-list-incomplete']);
assert.equal(partial.map.locations.length, 1);
assert.equal(inspectDealLocation(deal,{map:partial.map,reviewed:partialReview,today:'2026-09-30'}).status,'partially-mapped');
const completeReview = { test: { locations: [address] } };
assert.equal(inspectDealLocation(deal,{map:partial.map,reviewed:completeReview,today:'2026-09-30'}).status,'mapped');
const unusual = { id:'unusual-street',brand:'Fixture',distance:'Wien' };
const unusualAddress = {street:'Tuchlauben',number:'13',postalCode:'1010'};
const unusualReview = {[unusual.id]:{locations:[unusualAddress]}};
const unusualLocation = {id:'tuchlauben',name:'Fixture',address:'Tuchlauben 13, 1010 Wien',
  latitude:48.21,longitude:16.37,source:'verified-fixture',confidence:1};
assert.equal(inspectDealLocation(unusual,{map:{locations:[unusualLocation]},reviewed:unusualReview,today:'2026-09-30'}).status,'mapped');
for(const changed of [{number:'12'},{postalCode:'1020'},{street:'Tuchlaubenplatz'}])
  assert.equal(inspectDealLocation(unusual,{map:{locations:[unusualLocation]},reviewed:{[unusual.id]:{locations:[{...unusualAddress,...changed}]}},today:'2026-09-30'}).locationIds.length,0);
console.log('Map enrichment: exact matches, online exclusion, branch dates, ambiguity, cache, budget and idempotency passed.');

const tenant = { ...existing, id:'shared-building-shop', name:'Phone shop', address:deal.distance, dealIds:['phone'] };
const cinema = {id:'cinema-benefit',brand:'Mobile provider',title:'1+1 Kinotickets',distance:'Wien'};
const venueReview = {[cinema.id]:{evidenceUrl:'https://example.com/participants',locations:[{...address,venueName:'Cinema Vienna'}]}};
const phone = {id:'phone',brand:'Phone shop',distance:deal.distance};
const venueInput = {deals:[phone,cinema],map:{...map,locations:[tenant]},reviewed:venueReview,now,
  lookup:async()=>{throw Error('Exact coordinate already known; no geocoding allowed');},maxRequests:0};
assert.equal(inspectDealLocation(cinema,{map:venueInput.map,reviewed:venueReview,today:'2026-09-30'}).locationIds.length,0);
const venues = await enrichMap(venueInput);
const cinemaPin = venues.map.locations.find(x=>x.dealIds.includes(cinema.id));
assert.equal(cinemaPin.name,'Cinema Vienna');
assert.notEqual(cinemaPin.id,tenant.id);
assert.equal(cinemaPin.coordinateReferenceId,tenant.id);
for(const field of ['latitude','longitude','address','source']) assert.equal(cinemaPin[field],tenant[field]);
assert.equal(cinemaPin.attribution,undefined,'Non-City coordinate sources must not be misattributed');
assert.deepEqual(venues.map.locations.find(x=>x.id===tenant.id),tenant);
assert.equal(venues.requests,0);
const repeatVenue = await enrichMap({...venueInput,map:venues.map,catalog:venues.catalog,cache:venues.cache});
assert.deepEqual(repeatVenue.map,venues.map);
assert.deepEqual(repeatVenue.catalog,venues.catalog);
const twoVenues = await enrichMap({...venueInput,reviewed:{[cinema.id]:{...venueReview[cinema.id],locations:[
  {...address,venueName:'Cinema Vienna'},{...address,venueName:'Second cinema'}]}}});
assert.equal(twoVenues.map.locations.filter(x=>x.dealIds.includes(cinema.id)).length,2);
const chainVenues = await enrichMap({...venueInput,reviewed:{},catalog:{chainRules:[{
  id:'cinema',reviewed:true,brands:[cinema.brand],sourceUrls:['https://example.com/deal'],titleTerms:['Kinotickets'],
  validFrom:'2026-09-01',evidenceUrl:'https://example.com/participants',locationIds:[],excludedLocationIds:[],
  addresses:venueReview[cinema.id].locations}]},deals:[phone,{...cinema,url:'https://example.com/deal'}]});
assert.equal(chainVenues.map.locations.find(x=>x.dealIds.includes(cinema.id)).name,'Cinema Vienna');
for(const changed of [{number:'20'},{postalCode:'1020'},{street:'Othergasse'}]) {
  const wrong = await enrichMap({...venueInput,reviewed:{[cinema.id]:{locations:[{...address,...changed,venueName:'Cinema Vienna'}]}}});
  assert.equal(wrong.map.locations.some(x=>x.dealIds.includes(cinema.id)),false);
}
console.log('Reviewed redemption venues keep tenant identity, coordinate provenance and stable IDs without extra lookups.');

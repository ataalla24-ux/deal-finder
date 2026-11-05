import assert from 'node:assert/strict';
import {matchChainRule} from './deal-map-chain-rules.mjs';
import {inspectDealLocation,enrichMap} from './deal-map-enrichment.mjs';
import {requireApprovalMap} from './approval-map-readiness.mjs';
const today='2026-11-05', now=new Date(today+'T12:00:00Z');
const locations=[{id:'a',name:'Fixture Nord',address:'Am Hof 1, 1010 Wien',latitude:48.21,longitude:16.37,source:'verified-fixture',confidence:1},
  {id:'b',name:'Fixture Sued',address:'Wollzeile 2, 1010 Wien',latitude:48.22,longitude:16.38,source:'verified-fixture',confidence:1}];
const rule={id:'fixture',reviewed:true,brands:['Fixture'],sourceUrls:['https://fixture.example/coupons'],titleTerms:['Gutschein'],
  locationIds:['a','b'],excludedLocationIds:[],evidenceUrl:'https://fixture.example/coupons',validFrom:'2026-11-01',validUntil:'2026-11-30',
  allowedExclusions:['an Autobahnraststaetten']};
const deal={id:'new-coupon',brand:'Fixture',title:'1+1 mit Gutschein',description:'In allen teilnehmenden Filialen.',url:'https://fixture.example/coupons',distance:'Wien'};
const catalog={locations,chainRules:[rule]}, map={locations:[]};
assert.equal(matchChainRule(deal,[rule],today).id,'fixture');
for(const changed of [{brand:'Impostor'},{url:'https://fixture.example/other'},{url:'https://fixture.example/coupons?unreviewed=1'},
  {title:'Ein anderes Produkt'},{description:'Nur im Restaurant Donauzentrum.'},{description:'Ausgenommen Hauptbahnhof.'}]) {
  assert.equal(matchChainRule({...deal,...changed},[rule],today),null);
}
assert.equal(matchChainRule(deal,[rule],'2026-12-01'),null);
assert.equal(matchChainRule(deal,[{...rule,validUntil:null}],'2026-12-01').id,'fixture');
assert.equal(matchChainRule(deal,[rule,{...rule,id:'ambiguous'}],today),null);
assert.equal(matchChainRule(deal,[{...rule,excludedLocationIds:['b']}],today),null);
assert.equal(inspectDealLocation(deal,{map,catalog,today}).locationIds.length,2);
assert.equal(inspectDealLocation(deal,{map,catalog:{...catalog,locations:locations.slice(0,1)},today}).status,'needs-review');
const addressRule={...rule,locationIds:[],addresses:[{street:'Am Hof',number:'1',postalCode:'1010'},{street:'Wollzeile',number:'2',postalCode:'1010'}]};
assert.deepEqual(inspectDealLocation(deal,{map,catalog:{locations,chainRules:[addressRule]},today}).locationIds,['a','b']);
assert.equal(inspectDealLocation(deal,{map,catalog:{locations:locations.slice(0,1),chainRules:[addressRule]},today}).status,'address-ready');
const narrow=inspectDealLocation({...deal,address:'Am Hof 1, 1010 Wien'},{map,catalog,today});
assert.deepEqual(narrow.locationIds,['a']);
const named=inspectDealLocation({...deal,distance:'Fixture Nord, Wien'},{map,catalog,today});
assert.deepEqual(named.locationIds,['a']);
const manual=inspectDealLocation(deal,{map,catalog,today,reviewed:{[deal.id]:{locations:[{street:'Am Hof',number:'1',postalCode:'1010'}]}}});
assert.deepEqual(manual.locationIds,['a']);
const online=inspectDealLocation({...deal,description:'Nur online einloesen.'},{map,catalog,today});
assert.equal(online.status,'online-only');
let calls=0;
const result=await enrichMap({deals:[deal],map,catalog,now,lookup:async()=>{calls++;throw Error('No network needed');},maxRequests:0});
assert.equal(calls,0); assert.equal(result.report.mappedDeals,1);
assert.ok(result.map.locations.every(location=>location.dealIds.includes(deal.id)));
const replay=await enrichMap({deals:[deal],map:result.map,catalog:{...result.catalog,chainRules:[rule]},now,maxRequests:0});
assert.deepEqual(replay.map,result.map);
const validation={allowedDeals:[deal],blockedDeals:[],results:[{deal,decision:{allowed:true,reasons:[],warnings:[]}}]};
const approval=await requireApprovalMap(validation,{map,catalog,now,maxRequests:0});
assert.equal(approval.validation.allowedDeals.length,1);
assert.equal(approval.requests,0);
const missing=await requireApprovalMap(validation,{map,catalog:{...catalog,locations:[]},now,maxRequests:0});
assert.equal(missing.validation.allowedDeals.length,0);
console.log('PASS: campaign identity/window, full branch set, exact/manual/named branch precedence, exclusions, incomplete catalog hold, cached replay and approval integration');

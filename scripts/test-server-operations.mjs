import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { maintenanceEvidenceFor, refreshMaintenanceEvidence } from './refresh-maintenance-evidence.mjs';
import { buildRecoveryQueue, updatePublicationPilot, creditSnapshot, writeOperationsReport } from './server-operations-report.mjs';
import { auditServerQuality } from './server-quality-audit.mjs';
import { processDeals } from '../scraper/smart-summary.js';
import { normalizeDealRecord } from '../scraper/deal-normalization-utils.js';

const now=new Date('2026-11-06T12:00:00Z'), url='https://www.drei.at/de/dreiplus/ersparnisse/cleverfit/';
const text='10 % Rabatt auf das Fitnessabo fuer neue Mitglieder. Alle Bedingungen.';
const row={url,brand:'clever fit',status:'verified',text,hash:createHash('sha256').update(text).digest('hex'),checkedAt:now.toISOString()};
const deal={id:'one',brand:'clever fit',url,title:'10 % Rabatt',description:''};
const mapContext={map:{locations:[]},reviewed:{},coverage:{deals:[]},today:'2026-11-06'};
const ready={id:'ready',brand:'Fixture Cafe',title:'Gratis Kaffee mit Gutschein',description:'Nur online einloesen.',
  distance:'Online',validOn:'2026-11-06',caption:'Gratis Kaffee mit Gutschein, nur am 06.11.2026.',url:'https://example.org/coffee'};
test('summaries never overwrite full conditions or protected descriptions; missing terms remain visibly missing',()=>{
  const full={...deal,description:'Zwei Doener kaufen und den dritten gratis bekommen. Nur vom 3. bis 30. November. Alle Sorten. Gueltig an zwei genannten Standorten, Ruessbergstrasse 9 und Wagramer Strasse 126 in Wien.'};
  assert.deepEqual(processDeals([full]).deals,[full]);
  const empty={...deal,slackEditedFields:['description']};
  assert.deepEqual(processDeals([empty]).deals,[empty]);
  const fragment={...full,description:'Owner note with a deliberate ending...',liveEditedFields:['description']};
  assert.equal(normalizeDealRecord(fragment).description,fragment.description);
  const slack={id:'fixture',brand:'Example',title:'Zu jedem Döner gibts ein leckeres Tiramisu gratis',description:'Manuell gepruefte Bedingungen.',slackEditedFields:['description']};
  assert.equal(normalizeDealRecord(slack).description,slack.description);
  const derived=processDeals([deal]).deals[0];
  assert.equal(derived.description,'');
  assert.deepEqual(processDeals([derived]).deals,[derived]);
});
test('official evidence is scoped to exact URL, merchant, hash, freshness and successful source read',()=>{
  assert.equal(maintenanceEvidenceFor([deal],{entries:{[url]:row}},now).size,1);
  for(const changed of [{url:'https://evil.test'}, {brand:'another'}, {hash:'other'}, {status:'deferred'},
    {checkedAt:'2026-11-04T12:00:00Z'}, {checkedAt:'2026-11-07T12:00:00Z'}, {checkedAt:'invalid'}]) {
    assert.equal(maintenanceEvidenceFor([deal],{entries:{[url]:{...row,...changed}}},now).size,0);
  }
});
test('failed source refresh replaces stale evidence and waits 24h, never making a paid or arbitrary URL request',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'maintenance-sources-'));
  try {
    for(const dir of ['docs','reviews'])fs.mkdirSync(path.join(root,dir));
    fs.writeFileSync(path.join(root,'docs/deals.json'),JSON.stringify({deals:[deal,{...deal,id:'other',url:'http://127.0.0.1/private'}]}));
    fs.writeFileSync(path.join(root,'reviews/maintenance-source-evidence.json'),JSON.stringify({entries:{[url]:row}}));
    let calls=0;
    const fetchPage=async value=>{calls++;assert.equal(value,url);throw Error('fixture secret');};
    const result=await refreshMaintenanceEvidence({root,now,fetchPage});
    assert.equal(calls,1);assert.equal(result.cache.entries[url].status,'deferred');
    assert.equal(result.report.unresolved.length,2);
    assert(!JSON.stringify(result).includes('secret'));
    await refreshMaintenanceEvidence({root,now,fetchPage});assert.equal(calls,1);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test('recovery counts separate live and pending duplicates from reviewable candidates without approving anything',()=>{
  const live=[{id:'live',title:'Gratis Kaffee',url:'https://www.instagram.com/p/Abc123/'}];
  const pending=[live[0],{...live[0],id:'same-post'},deal,{...deal,id:'duplicate'}, {...deal,id:'other',url:'https://example.org/'}];
  const before=JSON.stringify([live,pending]);
  const queue=buildRecoveryQueue(live,pending,{mapContext});
  assert.equal(queue.length,4);
  assert.equal(queue.filter(r=>r.duplicateOf).length,2);
  assert(queue.every(r=>r.automaticPublicationAllowed===false));
  assert.equal(JSON.stringify([live,pending]),before);
});
test('recovery inspects current copy, blocks and evidence, never a previous clean row with the same ID',()=>{
  const first=buildRecoveryQueue([],[ready],{mapContext})[0];
  assert.equal(first.priority,'human-review-ready');
  assert.equal(first.automaticPublicationAllowed,false);
  for(const [patch,issue] of [[{description:''},'missing-conditions'],[{caption:''},'evidence-missing'],
    [{approvalBlock:'source revoked'},'source-blocked'],[{validity:{warnings:['confirm']}},'upstream-validity-review']]) {
    const row=buildRecoveryQueue([],[{...ready,...patch}],{mapContext})[0];
    assert(row.issues.includes(issue));
    assert.notEqual(row.priority,'human-review-ready');
    assert.notEqual(row.fingerprint,first.fingerprint);
  }
  const changedSource=buildRecoveryQueue([],[{...ready,url:'https://example.org/different-campaign'}],{mapContext})[0];
  assert.notEqual(changedSource.fingerprint,first.fingerprint,'old human labels do not transfer to another source');
});
test('recovery checks the current Vienna day and current venue bindings with no missing-context success',()=>{
  assert(buildRecoveryQueue([],[ready],{mapContext:{...mapContext,today:'2026-11-07'}})[0].issues.includes('stored-end-past'));
  assert.equal(buildRecoveryQueue([],[ready])[0].priority,'audit-needed');
  const onsite={...ready,description:'Kaffee vor Ort.',distance:'Wien'};
  const location={id:'cafe',name:'Fixture Cafe',address:'Braunhubergasse 19, 1110 Wien',latitude:48.17024,
    longitude:16.41565,confidence:1,source:'fixture',dealIds:[ready.id]};
  assert.equal(buildRecoveryQueue([],[onsite],{mapContext:{...mapContext,map:{locations:[location]}}})[0].priority,'human-review-ready');
  assert(buildRecoveryQueue([],[onsite],{mapContext})[0].issues.includes('map-incomplete'));
});
test('duplicate pending IDs are all held, never joined to the last audit or treated as separate ready deals',()=>{
  const input=[ready,{...ready,url:'https://example.org/different-campaign',title:'Gratis Pizza mit Gutschein'}];
  const before=JSON.stringify(input),queue=buildRecoveryQueue([],input,{mapContext});
  assert.equal(queue.length,2);
  assert(queue.every(row=>row.priority==='duplicate-review' && row.issues.includes('duplicate-pending-id')));
  assert.notEqual(queue[0].fingerprint,queue[1].fingerprint);
  assert.equal(JSON.stringify(input),before);
});
test('operations rechecks current drafts, withholds stale live/image audits and is read-only when requested',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'operations-freshness-'));
  const put=(file,value)=>{fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),JSON.stringify(value));};
  try {
    put('docs/deals.json',{deals:[{...ready,id:'live'}]});
    put('docs/deals-pending-all.json',{deals:[ready]});
    const quality=await auditServerQuality({root,now,apply:false,allowAi:false,request:()=>assert.fail('no model calls')});
    quality.live[0].websitePhoto={status:'needs-review'};
    quality.nativeContracts={status:'fixture-current'};
    put('reviews/server-quality-audit.json',quality);
    const report=async(options={})=>writeOperationsReport({root,now,apply:false,request:async()=>new Response('',{status:503}),...options});
    const current=await report();
    assert.equal(current.qualitySnapshot.status,'current');
    assert.deepEqual(current.images.review,['live']);
    assert.equal(current.images.native.status,'fixture-current');
    const sourceDeal={...deal,id:'live'};
    put('docs/deals.json',{deals:[sourceDeal]});
    put('reviews/maintenance-source-evidence.json',{entries:{[url]:row}});
    const sourced=await auditServerQuality({root,now,apply:false,allowAi:false,request:()=>assert.fail('no model calls')});
    put('reviews/server-quality-audit.json',sourced);
    assert.equal((await report()).qualitySnapshot.sourceEvidenceMatches,true);
    put('reviews/maintenance-source-evidence.json',{entries:{[url]:{...row,status:'deferred'}}});
    assert.equal((await report()).qualitySnapshot.status,'stale-or-missing','revoked source evidence cannot preserve a clean live audit');
    put('docs/deals.json',{deals:[{...ready,id:'live'}]});
    put('reviews/maintenance-source-evidence.json',{entries:{}});
    put('reviews/server-quality-audit.json',quality);
    put('docs/deals-pending-all.json',{deals:[{...ready,approvalBlock:'source withdrawn'}]});
    const changedPending=await report();
    assert.equal(changedPending.qualitySnapshot.status,'current','only pending changes do not discard the unchanged live audit');
    assert(changedPending.sourceRecovery.rows[0].issues.includes('source-blocked'));
    const staleByDate=await report({now:new Date('2026-11-07T12:00:00Z')});
    assert.equal(staleByDate.qualitySnapshot.status,'stale-or-missing');
    assert.equal(staleByDate.images.review.length,0);
    assert.equal((await report({now:new Date('2026-11-06T11:59:00Z')})).qualitySnapshot.status,'stale-or-missing');
    put('docs/deal-map-locations.json',{locations:[]});
    assert.equal((await report()).qualitySnapshot.status,'stale-or-missing','map evidence change invalidates its old status');
    fs.rmSync(path.join(root,'docs/deal-map-locations.json'));
    put('docs/deals.json',{deals:[{...ready,id:'live',title:'Pizza'}]});
    const stale=await report();
    assert.equal(stale.qualitySnapshot.status,'stale-or-missing');
    assert.equal(stale.images.status,'stale-or-missing');
    assert.equal(stale.images.nativeSelection.status,'missing-current-quality-audit');
    assert.deepEqual(stale.images.review,[]);
    assert.deepEqual(stale.missingInformation,[]);
    assert.equal(fs.existsSync(path.join(root,'reviews/server-operations-report.json')),false);
    assert.equal(fs.existsSync(path.join(root,'reviews/automatic-publication-pilot.json')),false);
    assert.equal(fs.readFileSync(path.join(root,'reviews/server-quality-audit.json'),'utf8'),JSON.stringify(quality));
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test('pilot needs independent labels and real scheduled runs; replays and manual green audits never count',()=>{
  const queue=Array.from({length:70},(_,i)=>({id:String(i),fingerprint:String(i),priority:'human-review-ready',issues:[]}));
  let state=updatePublicationPilot(null,queue,{now,event:'workflow_dispatch',runId:'1',sha:'a'.repeat(40)});
  assert.equal(state.samples.length,50);assert.equal(state.evaluatedCases,0);assert.equal(state.regularRuns.length,0);
  state=updatePublicationPilot(state,queue,{now,event:'schedule',runId:'2',sha:'b'.repeat(40)});
  state=updatePublicationPilot(state,queue,{now,event:'schedule',runId:'2',sha:'b'.repeat(40)});
  assert.equal(state.regularRuns.length,1);assert.equal(state.automaticPublicationEnabled,false);
  state.samples[0]={...state.samples[0],expected:'hold',reviewStatus:'human-reviewed',reviewedBy:'fixture',reviewedAt:now.toISOString()};
  state=updatePublicationPilot(state,queue,{now});assert.equal(state.evaluatedCases,1);
  state=updatePublicationPilot(state,queue.map(row=>row.id===state.samples[0].id?{...row,fingerprint:'changed'}:row),{now});
  assert.equal(state.evaluatedCases,0);assert.equal(new Set(state.samples.map(row=>row.id)).size,state.samples.length);
});
test('credit summary includes unsettled charges, reports missing data honestly and never claims provider balance',()=>{
  const policy={periodId:'fixture',periodLimitUsd:38,rollingDayLimitUsd:2,expiresAt:'2026-11-20T08:10:11Z'};
  assert.equal(creditSnapshot(null,policy,now).status,'unavailable-or-invalid');
  const ledger={creditPeriod:'fixture',reservations:[{at:+now-1000,usd:0.02,status:'reserved',model:'gpt-6.1-terra'},
    {at:+now-90000000,usd:0.03,status:'settled',model:'gpt-6.1-sol'}]};
  const report=creditSnapshot(ledger,policy,now);
  assert.equal(report.periodReservedOrSettledUsd,0.05);assert.equal(report.rollingDayReservedOrSettledUsd,0.02);
  assert.equal(report.unsettledReservations,1);assert.equal(report.providerBalanceKnown,false);
  assert.equal(creditSnapshot({...ledger,creditPeriod:'old'},policy,now).status,'unavailable-or-invalid');
});

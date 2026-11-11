import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { maintenanceEvidenceFor, refreshMaintenanceEvidence } from './refresh-maintenance-evidence.mjs';
import { buildRecoveryQueue, updatePublicationPilot, creditSnapshot, writeOperationsReport,
  buildPublicationReviewPack, redemptionSummary, summarizeSourceReport, nativeImageSummary } from './server-operations-report.mjs';
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
test('formal readiness cannot accept trade recruiting or alcoholic gifts despite complete copy, dates and online mapping',()=>{
  for(const description of ['Fuer Betriebe in Wien: kostenlos registrieren, erster Auftrag 0 % Servicegebuehr.',
    'Gansl fuer vier Personen, eine Flasche Cuvee G gratis dazu.']){
    const row=buildRecoveryQueue([],[{...ready,title:'Aktuelles Angebot in Wien',description,caption:description}],{mapContext})[0];
    assert.equal(row.priority,'blocked-source');assert(row.issues.includes('excluded-offer'));
  }
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
    const scheduledSlot = '2026-11-06T12:13';
    assert.equal((await report({event:'push',scheduledSlot})).lastScheduledQualitySlot,'');
    const complete = await report({event:'schedule',scheduledSlot});
    assert.equal(complete.lastScheduledQualitySlot,scheduledSlot);
    put('reviews/server-operations-report.json',complete);
    assert.equal((await report({event:'push'})).lastScheduledQualitySlot,scheduledSlot);
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

test('pilot does not count malformed, future, pre-sample or duplicate-ID labels and exposes missing evidence',()=>{
  const queue=[{id:'one',fingerprint:'first',priority:'human-review-ready',issues:[],source:'fixture'}];
  const state=updatePublicationPilot(null,queue,{now});
  assert.equal(state.evaluation.agreement,null);
  assert.equal(state.evaluation.currentSamples,1);
  const label={...state.samples[0],expected:'hold',reviewStatus:'human-reviewed',reviewedBy:'owner',reviewedAt:now.toISOString()};
  for(const patch of [{reviewedAt:'bad'},{reviewedAt:'2026-11-07T12:00:00Z'},
    {reviewedAt:'2026-11-06T11:59:00Z'},{reviewedBy:' '},{expected:'model-approved'}]){
    assert.equal(updatePublicationPilot({...state,samples:[{...label,...patch}]},queue,{now}).evaluatedCases,0);
  }
  const reviewed=updatePublicationPilot({...state,samples:[label]},queue,{now});
  assert.equal(reviewed.evaluation.unsafeFormalReady,1);
  assert.equal(reviewed.evaluation.agreement,0);
  assert.equal(reviewed.automaticPublicationEnabled,false);
  const duplicate=updatePublicationPilot({...state,samples:[label]},[...queue,...queue],{now});
  assert.equal(duplicate.evaluatedCases,0);
  assert.equal(duplicate.evaluation.archivedSamples,1);
  assert.equal(duplicate.samples.length,0);
});

test('a full obsolete pilot does not freeze forever; its original labels are archived and replacements stay unlabelled',()=>{
  const rows=Array.from({length:60},(_,i)=>({id:String(i),fingerprint:'old-'+i,priority:'human-review-ready',issues:[]}));
  const original=updatePublicationPilot(null,rows,{now});
  original.samples[0]={...original.samples[0],expected:'approve',reviewedBy:'owner',reviewedAt:now.toISOString(),reviewStatus:'human-reviewed'};
  const changed=rows.map(r=>({...r,fingerprint:'new-'+r.id}));
  const result=updatePublicationPilot(original,changed,{now});
  assert.equal(result.samples.length,50);assert.equal(result.archivedSamples.length,50);
  assert.equal(result.evaluatedCases,0);assert(result.samples.every(s=>s.expected===null));
  assert.equal(result.archivedSamples[0].expected,'approve');
  const replay=updatePublicationPilot(result,changed,{now});
  assert.equal(replay.archivedSamples.length,50);assert.deepEqual(replay.samples,result.samples);
});

test('fresh review pack preserves current terms, separates duplicate IDs and never manufactures independent labels',()=>{
  const pending=[ready,{...ready,id:'two',description:'Only with membership.'}];
  const queue=buildRecoveryQueue([],pending,{mapContext});
  const before=JSON.stringify(pending),pack=buildPublicationReviewPack([],pending,queue,{now});
  assert.equal(pack.cases.length,2);
  assert(pack.cases.every(r=>r.expected===null && r.reviewedBy===null));
  assert.equal(pack.cases.find(r=>r.id==='two').description,'Only with membership.');
  assert.equal(JSON.stringify(pending),before);
  const changed=buildPublicationReviewPack([],[{...ready,description:'Changed terms.'}],queue,{now});
  assert.notEqual(changed.pendingHash,pack.pendingHash);
  const duplicate=buildPublicationReviewPack([], [ready,ready],buildRecoveryQueue([],[ready,ready],{mapContext}),{now});
  assert(duplicate.cases.every(r=>r.ambiguousId && r.description===null && r.reviewStatus==='resolve-duplicate-id-before-labeling'));
  const many=Array.from({length:70},(_,i)=>({...ready,id:String(i)}));
  assert.equal(buildPublicationReviewPack([],many,buildRecoveryQueue([],many,{mapContext}),{now}).cases.length,50);
});

test('redemption audit reuses exact time-bound codec and never mistakes descriptions or private codes for verified public codes',()=>{
  const input=[{...ready,approvedAt:'2026-11-01',description:'Your personal code PRIVATE123.'}];
  const review={dealId:ready.id,expectedTitle:ready.title,expectedDescription:input[0].description,
    sourceUrl:ready.url,method:'onsite',instructions:'Show the original voucher.',
    verifiedAt:now.toISOString(),reviewUntil:'2026-11-07T12:00:00Z',evidence:['Fixture source proof.']};
  assert.equal(redemptionSummary(input,null,now).completeCoverage,false);
  const valid=redemptionSummary(input,{reviews:[review]},now);
  assert.equal(valid.byMethod.onsite,1);assert.equal(valid.rows[0].hasPublicCode,false);
  assert.equal(valid.sourceReviewedRoutes,1);assert.equal(valid.unconfirmedReviews,0);
  assert.equal(valid.rows[0].externalStepRequired,false);
  for(const patch of [{expectedDescription:'Different terms.'},{expectedTitle:'Different offer'},
    {reviewUntil:'2026-11-05T12:00:00Z'}]){
    assert.equal(redemptionSummary(input,{reviews:[{...review,...patch}]},now).byMethod['not-verified'],1);
  }
  assert.equal(redemptionSummary(input,{reviews:[{...review,method:'provider_coupon',url:ready.url}]},now).rows[0].externalStepRequired,true);
  const unknown=redemptionSummary(input,{reviews:[{...review,method:'unknown'}]},now);
  assert.equal(unknown.sourceReviewedRoutes,0);assert.equal(unknown.unconfirmedReviews,1);
  assert.equal(unknown.completeCoverage,false);assert.equal(unknown.missingReviews,0);
  assert.equal(redemptionSummary(input,null,now).missingReviews,1);
});

test('native image summary separates repaired primary photos from small bundled fallbacks and absent counts',()=>{
  const summary=nativeImageSummary({status:'current',observedDeals:68,reviewedPlatformImages:20,
    lowResolutionDeals:['a','b'],reviewedPrimaryPhotoDeals:['a','b'],effectiveLowResolutionDeals:[],sharedAssignments:[]});
  assert.match(summary,/2 Angebote mit zu kleinen gebuendelten Fallback/);
  assert.match(summary,/2 Angebote mit aktuell gebundenem/);
  assert.match(summary,/0 verbleibende primaere Aufloesungsluecken/);
  assert.match(nativeImageSummary({status:'older-observation'}),/unbekannt verbleibende primaere/);
});

test('source audit distinguishes Meta branches, retained outbox and actual candidate audit from Slack delivery',()=>{
  const report={generatedAt:now.toISOString(),status:'degraded',freshPostsFetched:406,newDeals:1,repeatedDeals:73,
    outbox:{retained:63},sources:{adLibrary:{status:'ok',fetched:9753,accepted:12,newAccepted:7,errors:[]},
      instagramGraph:{status:'degraded',fetched:406,accepted:6,newAccepted:1,errors:[{message:'fixture'}]}},
    candidateAudit:[{status:'rejected',rejectionReason:'expired'},{status:'accepted'},{status:'rejected',reason:'no-benefit'}]};
  const summary=summarizeSourceReport(report,{now});
  assert.equal(summary.counts.newDeals,1);assert.equal(summary.counts.freshPostsFetched,406);
  assert.equal(summary.retainedOutbox,63);assert.equal(summary.branches[1].errors,1);
  assert.equal(summary.newlyDeliveredToSlack,null);assert.equal(summary.runProvenance,null);
  assert.deepEqual(summary.rejectionReasons,{expired:1,'no-benefit':1});
  assert.equal(summarizeSourceReport({...report,generatedAt:'bad'},{now}).stale,true);
  const power=summarizeSourceReport({finishedAt:now.toISOString(),summary:{acceptedDeals:37},sources:[]},{now});
  assert.equal(power.counts.acceptedDeals,37);assert.equal(power.newlyDeliveredToSlack,null);
  assert.equal(summarizeSourceReport(null,{now}).status,'missing-report');
});

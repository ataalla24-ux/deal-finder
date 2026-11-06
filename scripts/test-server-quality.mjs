import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { copyReviewReasons, groundedDatePatch, maintainFeedFile, maintainDeals } from './automatic-deal-maintenance.mjs';
import { verifyOfficialFoodDeal } from '../scraper/power-food-verification.js';
import { extractCouponMediaOffers } from '../scraper/official-coupon-media.js';
import { viennaQualitySlot } from './vienna-quality-slot.mjs';
import { inspectSourceBackedQuality } from '../scraper/source-backed-quality.js';
import { reviewPhoto } from './server-quality-audit.mjs';
import { sourceTexts } from './automatic-deal-maintenance.mjs';
import { verifyPublicQuality } from './verify-server-quality-public.mjs';
import { artworkInputHash,nativeContractStatus } from './native-contract-observation.mjs';

const now = new Date('2026-11-06T12:00:00Z');
const policy = {version:1, enabled:true, automaticExpiry:true, automaticLocalCopy:true, maxNewHidesPerRun:5, maxAiCandidatesPerRun:4};

test('benefit-only titles, address identities and earlier validation warnings remain review cases',()=>{
  for(const title of ['25 % sparen','35 % Rabatt','20% Rabatt mit dem Vorteilsclub Wien','1+1 gratis','Gratis']) {
    const deal={title,description:'Vollstaendige Bedingungen',expires:'2026-11-30'};
    assert(copyReviewReasons(deal).includes('title'));
    assert(!copyReviewReasons(deal,new Set(['title'])).includes('title'));
    assert(inspectSourceBackedQuality(deal).issues.some(i=>i.code==='product-unspecified'));
  }
  for(const title of ['6 Krapfen für 9 €','1+1 Pizza gratis mit Gutschein','20 % auf alle Speisen','Gratis Kaffee','30 % Rabatt bei SHEIN']) {
    assert(!copyReviewReasons({title,description:'Bedingungen',expires:'2026-11-30'}).includes('title'));
  }
  const check=inspectSourceBackedQuality({title:'6 Krapfen für 9 €',brand:'Landstraßer Hauptstraße 2',validity:{warnings:['Originaltext pruefen']}});
  assert(check.issues.some(i=>i.code==='merchant-looks-like-address'));
  assert(check.issues.some(i=>i.code==='upstream-validity-review'));
  assert.equal(check.automaticPublicationAllowed,false);
});

test('native observation expires on artwork-relevant feed changes and never certifies semantic match or recipient UI',()=>{
  const deals=[{id:'one',title:'Pizza',brand:'Example',category:'essen'}];
  const snapshot={artworkInputHash:artworkInputHash(deals),tests:['test-artwork-native-parity','test-artwork-library-assets','test-deal-photo-sharing'].map(name=>({name,status:'passed'}))};
  assert.equal(nativeContractStatus(deals,snapshot).status,'observed-contracts-pass');
  assert.equal(nativeContractStatus([{...deals[0],description:'terms'}],snapshot).status,'feed-changed-recheck-required');
  assert.equal(nativeContractStatus([{...deals[0],title:'Burger'}],snapshot).status,'feed-changed-recheck-required');
  assert.equal(nativeContractStatus([...deals,{id:'two',title:'Pizza'}],snapshot).status,'feed-changed-recheck-required');
  assert.equal(nativeContractStatus(deals,{...snapshot,tests:[]}).status,'native-tests-incomplete');
  assert.equal(nativeContractStatus(deals,snapshot).semanticImageReview,false);
  assert.equal(nativeContractStatus(deals,snapshot).recipientUiTest,false);
});

test('publication requires actual bytes for all four public documents; green local tests are insufficient',()=>fixture(async({cwd,put})=>{
  const files=['deals.json','deal-map-locations.json','deal-of-the-day.json','deal-of-the-week.json'];
  for(const file of files)put(`docs/${file}`,{test:file});
  const request=async url=>new Response(fs.readFileSync(path.join(cwd,'docs',new URL(url).pathname)));
  assert.equal((await verifyPublicQuality({root:cwd,request,attempts:1})).status,'publicly-verified');
  const stale=await verifyPublicQuality({root:cwd,request:async()=>new Response('{}'),attempts:1});
  assert.equal(stale.status,'publication-not-confirmed');
  assert.equal(stale.checks.filter(row=>row.exact).length,0);
}));

test('public verification returns failure evidence before the workflow timeout',()=>fixture(async({cwd,put})=>{
  for(const file of ['deals.json','deal-map-locations.json','deal-of-the-day.json','deal-of-the-week.json'])put(`docs/${file}`,{});
  let clock=0,calls=0;
  const result=await verifyPublicQuality({root:cwd,clock:()=>clock,maxDurationMs:25000,
    request:async()=>{calls++;clock+=10000;throw Error('offline');},wait:async ms=>{clock+=ms;}});
  assert.equal(result.status,'publication-not-confirmed');
  assert.equal(calls,3);
  assert(result.checks.some(row=>row.error==='verification-deadline'));
}));

test('50-character target never truncates protected or condition-bearing titles', () => {
  const deal = {title:'10 Euro Gutschein: Essen ab 10 Euro und Einkauf ab 50 Euro', description:'Alle Bedingungen vorhanden', expires:'2026-12-31'};
  assert.deepEqual(copyReviewReasons(deal), ['title']);
  assert.deepEqual(copyReviewReasons(deal, new Set(['title'])), []);
  assert.deepEqual(copyReviewReasons({...deal,description:''},new Set(['title','description'])), []);
});

test('dates require an exact offer clause with a year and cannot override existing or cleared fields', () => {
  const quote = 'Nur am 07.11.2026';
  const patch = groundedDatePatch(quote,[quote],{});
  assert.equal(patch.validOn,'2026-11-07');
  for (const bad of ['Nur am 07.11.', 'Veroeffentlicht am 07.11.2026', '2026-11-07', 'Voraussichtlich bis 07.11.2026']) {
    assert.deepEqual(groundedDatePatch(bad,[bad],{}),{});
  }
  assert.deepEqual(groundedDatePatch(quote,['other'],{}),{});
  assert.deepEqual(groundedDatePatch(quote,[quote],{expires:'2026-11-30'}),{});
  assert.deepEqual(groundedDatePatch(quote,[quote],{},new Set(['validUntil'])),{});
  assert.deepEqual(groundedDatePatch(quote,[quote],{},new Set(['expiryDisplayText'])),{});
  assert.deepEqual(sourceTexts({metaGraphCaption:quote,metaGraphBlockingReason:'not-current'}),[]);
  assert.deepEqual(sourceTexts({metaGraphCaption:quote},{caption:quote,graphAccepted:false}),[]);
});

async function fixture(callback) {
  const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'server-quality-'));
  const old=process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY='offline-test';
  const put=(file,value)=>{fs.mkdirSync(path.dirname(path.join(cwd,file)),{recursive:true});fs.writeFileSync(path.join(cwd,file),JSON.stringify(value));};
  try { put('reviews/automatic-maintenance-policy.json',policy); await callback({cwd,put}); }
  finally { if(old===undefined) delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=old;fs.rmSync(cwd,{recursive:true,force:true}); }
}
const mock=(draft, approve=true)=>async(_url,init)=>{
  const body=JSON.parse(init.body);
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(body.model==='gpt-6.1-sol'?{supported:approve}:draft)}}]});
};

test('missing conditions and date can be completed without rewriting a protected title; replay is exact',()=>fixture(async({cwd,put})=>{
  const quote='Gratis Kaffee mit Gutschein. Nur am 07.11.2026. Solange der Vorrat reicht.';
  const deal={id:'test',title:'Gratis Kaffee mit Gutschein',description:'',metaGraphCaption:quote,liveEditedFields:['title'],votes:12};
  put('docs/deals.json',{deals:[deal]});
  const request=mock({title:'HALLO',quote,conditionsQuote:quote,dateQuote:'Nur am 07.11.2026'});
  const result=await maintainFeedFile({cwd,now,apply:true,allowAi:true,request});
  assert.equal(result.deals[0].title,deal.title);
  assert.equal(result.deals[0].description,quote);
  assert.equal(result.deals[0].validOn,'2026-11-07');
  assert.equal(result.deals[0].votes,12);
  assert.deepEqual(maintainDeals([deal],{policy,now,state:result.state}).deals,result.deals);
  const changedEvidence=new Map([['test',{caption:'Nur am 20.11.2026'}]]);
  assert.deepEqual(maintainDeals([deal],{policy,now,state:result.state,sourceEvidence:changedEvidence}).deals,[deal]);
}));

test('manual clears stay empty, second review can veto, unchanged failed review is cached',()=>fixture(async({cwd,put})=>{
  const quote='Gratis Kaffee mit Gutschein.';
  const deal={id:'test',title:'Die allerbeste neue fantastische Kaffeeaktion mit besonders vielen Worten und mehr',description:'',metaGraphCaption:quote};
  put('docs/deals.json',{deals:[deal]});
  put('docs/live-deal-edits.json',{edits:[{dealId:'test',clearFields:['description','validUntil']}]});
  let calls=0; const response=mock({title:'Gratis Kaffee mit Gutschein',quote,conditionsQuote:quote,dateQuote:'Nur am 07.11.2026'},false);
  const request=(...args)=>{calls++;return response(...args);};
  const result=await maintainFeedFile({cwd,now,apply:true,allowAi:true,request});
  assert.deepEqual(result.deals,[deal]);
  assert.equal(calls,2);
  await maintainFeedFile({cwd,now,apply:true,allowAi:true,request});
  assert.equal(calls,2,'same evidence must not spend again every dispatch');
}));

test('missing OCR tools defer only coupon media with zero source requests and never approve it',async()=>{
  const old=process.env.COUPON_TOOLS_AVAILABLE;
  process.env.COUPON_TOOLS_AVAILABLE='0';
  try {
    const result=await verifyOfficialFoodDeal({originSource:'power-official-food',source:'NORDSEE',url:'https://www.nordsee.com/at/coupons',evidence:{media:{url:'https://www.nordsee.com/at/coupons/pdf'}}},{fetchPage:()=>assert.fail('no source request')});
    assert.equal(result.ok,false);
    // A fabricated source identity cannot bypass either the allowlist or media gate.
    assert(['untrusted-merchant','coupon-tools-unavailable'].includes(result.reason));
    const media=await extractCouponMediaOffers('<a href="https://www.nordsee.com/at/coupons/pdf">PDF</a>',{url:'https://www.nordsee.com/at/coupons',couponMedia:'nordsee-at-v1'}, {fetchAsset:()=>assert.fail('no media download')});
    assert.equal(media.deals.length,0);
    assert.equal(media.assets[0].status,'deferred');
  } finally {if(old===undefined)delete process.env.COUPON_TOOLS_AVAILABLE;else process.env.COUPON_TOOLS_AVAILABLE=old;}
});

test('12/20 Vienna schedule selects exactly two slots across DST and never assumes punctual delivery',()=>{
  for(const [date,expected] of [['2026-11-06',[11,19]],['2027-07-06',[10,18]]]) {
    const selected=[];
    for(const hour of [10,11,18,19])if(viennaQualitySlot({event:'schedule',schedule:`0 ${hour} * * *`,now:new Date(`${date}T${String(hour).padStart(2,'0')}:15:00Z`)}).run)selected.push(hour);
    assert.deepEqual(selected,expected);
  }
  assert.equal(viennaQualitySlot({event:'schedule',schedule:'0 11 * * *',now:new Date('2026-11-06T13:00:00Z')}).run,true);
  assert.equal(viennaQualitySlot({event:'schedule',schedule:'0 11 * * *',now:new Date('2026-11-06T15:00:00Z')}).run,false);
  assert.equal(viennaQualitySlot({event:'push',now}).run,true);
});

test('quality checks are advisory and never grant approval based on model or map success',()=>{
  const deal={id:'test',title:'Gratis Kaffee mit Gutschein',brand:'Cafe',description:'Nur mit Gutschein',validOn:'2026-11-07',caption:'Gratis Kaffee mit Gutschein am 07.11.2026'};
  const before=JSON.stringify(deal);
  const good=inspectSourceBackedQuality(deal,{mapReview:{status:'mapped',locationIds:['known']},today:'2026-11-06'});
  assert.equal(good.issues.length,0);
  assert.equal(good.automaticPublicationAllowed,false);
  const bad=inspectSourceBackedQuality({...deal,validOn:'2026-02-31',description:''},{mapReview:{status:'needs-review'}});
  assert(bad.issues.some(r=>r.code==='invalid-date'));
  assert(bad.issues.some(r=>r.code==='map-incomplete'));
  assert.equal(JSON.stringify(deal),before);
});

test('image reviews are content-addressed, bounded and cannot claim photo rights or change photos',()=>fixture(async({cwd})=>{
  fs.mkdirSync(path.join(cwd,'docs/assets'),{recursive:true});
  fs.writeFileSync(path.join(cwd,'docs/assets/fixture.webp'),Buffer.from('offline-image-fixture'));
  const cache={},deal={title:'Burger',brand:'Test'},photo={src:'/assets/fixture.webp',alt:'Symbolfoto: Burger'};
  let calls=0;
  const request=async(_url,init)=>{calls++;const body=JSON.parse(init.body);assert.equal(body.model,'gpt-6.1-terra');assert.equal(body.max_tokens,700);return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({matchesProduct:true,emptyTableOrPackaging:false,uncertain:false})}}]});};
  const result=await reviewPhoto(deal,photo,{root:cwd,cache,now,request});
  assert.equal(result.provesMerchantPhoto,false);assert.equal(result.automaticReplacement,false);
  await reviewPhoto(deal,photo,{root:cwd,cache,now,request});assert.equal(calls,1);
  await reviewPhoto({...deal,title:'Pizza'},photo,{root:cwd,cache,now,request});assert.equal(calls,2);
  assert.equal((await reviewPhoto(deal,{src:'/assets/../../private.webp'},{root:cwd,cache,now,request})).status,'invalid-image-path');
}));

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDealImagePreviewCheck,prepareDealImagePreview,dealImagePreviewBlock,
  markDealImagePreviewSent,prepareApprovedDealImage} from '../scraper/deal-image-pilot.js';
import {inspectBoundOriginalPhoto} from './original-deal-photo.mjs';
import {applyLiveDealEditsToBundle,loadLiveDealEditStore} from './live-deal-edits-lib.mjs';
import {stampDealsFeedBundle} from './deals-feed-contract.mjs';
import {photoDigest} from './deal-photo-contract.mjs';
import {normalizeDealRecord} from '../scraper/deal-normalization-utils.js';

const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const now=new Date();
const until=new Date(+now+30*86400000).toISOString().slice(0,10);
const base={id:'owned-preview-fixture',title:'Gratis Kaffee mit Gutschein',brand:'Café Fixture',category:'kaffee',
  description:'Eine Tasse Kaffee gratis gegen Vorlage des Gutscheins. Nur einmal pro Person in Wien.',
  url:'https://merchant.example/kaffee',source:'Merchant fixture',validUntil:until,expires:until,
  sourcePublishedAt:new Date(+now-3600000).toISOString(),
  validity:{status:'ok',urlStatus:'HTTP 200',checkedAt:now.toISOString(),finalUrl:'https://merchant.example/kaffee'}};
const read=(root,file)=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const write=(root,file,value)=>{const p=path.join(root,file);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(value));};
async function fixture(fn) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'deal-image-pilot-'));
  try {
    for(const directory of ['docs/assets/deal-image-pilot','docs/assets/blog/photos']) {
      fs.mkdirSync(path.dirname(path.join(root,directory)),{recursive:true});
      fs.cpSync(path.join(repository,directory),path.join(root,directory),{recursive:true});
    }
    return await fn(root);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
}
async function preview(root,deal=base,options={}) {
  return prepareDealImagePreview(structuredClone(deal),{root,now,enabled:true,checkPreview:async()=>true,...options});
}
function approve(deal) {
  const approved={...deal,slackTs:'1795176000.123456',pipelineLifecycle:{manualDecision:'approved',manualDecisionAt:now.toISOString()}};
  const previous=process.env.FREEFINDER_DEAL_IMAGE_PILOT;
  process.env.FREEFINDER_DEAL_IMAGE_PILOT='1';
  try {markDealImagePreviewSent(approved,approved.slackTs,now);} finally {
    if(previous===undefined)delete process.env.FREEFINDER_DEAL_IMAGE_PILOT;else process.env.FREEFINDER_DEAL_IMAGE_PILOT=previous;
  }
  return approved;
}

test('new exact offer previews and first publication keep the same labelled bytes and protected copy',()=>fixture(async root=>{
  const queued=await preview(root,{...base,liveEditedFields:['description'],approvedSourceCopy:{description:base.description}});
  assert.equal(queued.pendingDealImage.key,'coffee');
  assert.equal(dealImagePreviewBlock(queued,{enabled:true,now}).image_url,queued.pendingDealImage.previewURL);
  const approved=approve(queued);
  const published=await prepareApprovedDealImage(approved,{root,now,enabled:true});
  assert.ok(published.photoUrl);
  assert.equal(published.description,base.description,'protected prose is never appended or rewritten for a disclosure');
  assert.equal(Object.hasOwn(published,'pendingDealImage'),false);
  const bound=await inspectBoundOriginalPhoto(published,{root});
  assert.equal(photoDigest(bound.bytes),queued.pendingDealImage.sha256);
  assert.deepEqual(bound.bytes,fs.readFileSync(path.join(root,'docs/assets/deal-image-pilot',path.basename(queued.pendingDealImage.previewURL))));
  assert.deepEqual(bound.review.renderedDisclosure.bounds,{left:428,top:320,width:224,height:54});
  assert.equal(bound.review.kind,'editorial-illustration');
  assert.equal(bound.review.showsActualProduct,false);
  const store=loadLiveDealEditStore(path.join(root,'docs/live-deal-edits.json'));
  assert.equal(store.edits[0].photoEditorialDisclosure,undefined);
  const rebuilt=applyLiveDealEditsToBundle({deals:[{...base,liveEditedFields:['description']}]},store).bundle.deals[0];
  assert.equal(rebuilt.photoUrl,published.photoUrl,'ordinary snapshot rebuild carries the permanent binding');
  assert.equal(rebuilt.description,base.description);
  assert.equal(normalizeDealRecord(rebuilt).photoUrl,published.photoUrl,'ordinary public record normalization retains the bound photo');
  const changed=applyLiveDealEditsToBundle({deals:[{...base,title:'Gratis Tee mit Gutschein'}]},store).bundle.deals[0];
  assert.equal(Boolean(changed.photoUrl),false,'changed offer does not reuse the photograph');
}));

test('strict product identities accept supported motifs and leave different or unknown variants unchanged',()=>fixture(async root=>{
  const cases=[
    ['Pizza Margherita 1+1','Zwei Pizza Margherita zum Preis von einer.','pizza'],
    ['Doppel-Smashburger für 9,90 €','Zwei Beef Patties auf einem Burger.','double-smashburger'],
    ['Gratis Cappuccino','Ein Cappuccino gratis.',undefined],
    ['Gratis Kaffee und Croissant','Kaffee mit Croissant im Menü.',undefined],
    ['Zu eurem Kaffee gibt es ein Lächeln gratis','Ein Lächeln gibt es gratis dazu.',undefined],
    ['Kaffee für 2,50 €','Eine Tasse Kaffee für 2,50 Euro.','coffee'],
    ['Pizza Margherita oder Salami 1+1','Wähle zwischen beiden Varianten.',undefined],
    ['Veganer Doppel-Smashburger 1+1','Zwei Beef Style Patties.',undefined],
    ['Gratis Donut','Ein Donut gratis.',undefined],
    ['Kuchen 1+1','Zwei Stück Kuchen zum Preis von einem.',undefined],
  ];
  for(const [title,description,key] of cases) {
    const result=await preview(root,{...base,category:'essen',title,description});
    assert.equal(result.pendingDealImage?.key,key,title);
  }
  assert.ok((await preview(root,{...base,validUntil:until+'T12:00:00.000Z',validity:{...base.validity,status:'warning'}})).pendingDealImage,
    'ordinary retained queue ISO dates and warning validity are supported');
  assert.equal((await preview(root,{...base,validUntil:'2027-02-30'})).pendingDealImage,undefined);
}));

test('stale, missing, rejected and edited source evidence cannot add or preserve a preview',()=>fixture(async root=>{
  const staged=await preview(root);
  for(const patch of [
    {validity:{...base.validity,checkedAt:new Date(+now-86400001).toISOString()}},
    {validity:{...base.validity,urlStatus:'HTTP 403'}},
    {validity:{...base.validity,finalUrl:'https://merchant.example/another-offer'}},
    {validity:{...base.validity,status:'invalid'}},
    {validUntil:'2020-01-01'},{expires:new Date(+now-1000).toISOString()},
    {validUntil:null,sourcePublishedAt:new Date(+now-8*86400000).toISOString()},
    {slackTs:'already-delivered'}, {photoUrl:'already-reviewed'}, {slackEditedFields:['photoUrl']},
    {approvalBlock:{reasons:['source unavailable']}},{pipelineLifecycle:{manualDecision:'rejected'}},
    {originSource:'community-submission',submissionId:'private'},
  ]) assert.equal((await preview(root,{...staged,...patch})).pendingDealImage,undefined,JSON.stringify(patch));
  assert.equal((await preview(root,staged,{enabled:false})).pendingDealImage,undefined);
  assert.equal((await preview(root,staged,{checkPreview:async()=>false})).pendingDealImage,undefined);
  assert.equal(dealImagePreviewBlock(staged,{enabled:false,now}),null);
  assert.equal(dealImagePreviewBlock({...staged,title:'Gratis Tee'},{enabled:true,now}),null);
  assert.equal(dealImagePreviewBlock(staged,{enabled:true,now:new Date(+now+86400001)}),null);
}));

test('approval requires the exact successfully delivered preview and never blocks an otherwise valid deal',()=>fixture(async root=>{
  const staged=await preview(root);
  for(const deal of [staged,{...approve(staged),title:'Gratis Tee'},
    {...approve(staged),slackTs:'different-message'},
    {...approve(staged),pipelineLifecycle:{manualDecision:'rejected'}},
    {...approve(staged),pendingDealImage:{...approve(staged).pendingDealImage,sha256:'a'.repeat(64)}},
  ]) {
    const result=await prepareApprovedDealImage(deal,{root,now,enabled:true});
    assert.equal(result.photoUrl,undefined);
    assert.equal(Object.hasOwn(result,'pendingDealImage'),false);
    assert.equal(result.id,deal.id);
  }
  const disabled=await prepareApprovedDealImage(approve(staged),{root,now,enabled:false});
  assert.equal(disabled.photoUrl,undefined);
  write(root,'docs/live-deal-edits.json',{version:1,edits:[{dealId:base.id,photoUrl:''}]});
  assert.equal((await prepareApprovedDealImage(approve(staged),{root,now,enabled:true})).photoUrl,undefined,'manual image clear is authoritative');
}));

test('owned provenance, immutable image digest and explicit label geometry are required',()=>fixture(async root=>{
  const catalog=read(root,'docs/assets/deal-image-pilot/catalog.json');
  for(const patch of [{labelBounds:undefined},{labelBounds:{left:0,top:0,width:1,height:1}},{kind:'merchant-photo'},{sha256:'a'.repeat(64)}]) {
    write(root,'docs/assets/deal-image-pilot/catalog.json',{...catalog,assets:{...catalog.assets,coffee:{...catalog.assets.coffee,...patch}}});
    assert.equal((await preview(root)).pendingDealImage,undefined);
  }
  write(root,'docs/assets/deal-image-pilot/catalog.json',catalog);
  const staged=await preview(root),published=await prepareApprovedDealImage(approve(staged),{root,now,enabled:true});
  const file='reviews/deal-photos/'+path.basename(published.photoUrl)+'.json',receipt=read(root,file);
  const malformed={...catalog,assets:{...catalog.assets,coffee:{...catalog.assets.coffee,labelBounds:undefined}}};
  write(root,'docs/assets/deal-image-pilot/catalog.json',malformed);
  write(root,file,{...receipt,renderedDisclosure:{...receipt.renderedDisclosure,bounds:undefined}});
  await assert.rejects(inspectBoundOriginalPhoto(published,{root}),/disclosure-proof-invalid/);
  write(root,'docs/assets/deal-image-pilot/catalog.json',catalog);write(root,file,receipt);
  const proof=read(root,'docs/assets/blog/photos/sources.json');proof.photos.coffee.kind='public-instagram';
  write(root,'docs/assets/blog/photos/sources.json',proof);
  assert.equal((await preview(root)).pendingDealImage,undefined);
}));

test('public feed strips private preview metadata including falsy values',()=>{
  for(const pendingDealImage of [null,false,undefined,{previewURL:'https://internal.example'}]) {
    const publicDeal=stampDealsFeedBundle({deals:[{...base,pendingDealImage}]},{nowIso:now.toISOString(),redemptionManifest:null}).deals[0];
    assert.equal(Object.hasOwn(publicDeal,'pendingDealImage'),false);
  }
});

test('optional public preview check is cached, bounded and fail-closed',()=>fixture(async root=>{
  let calls=0;
  const check=createDealImagePreviewCheck({request:async(url,options)=>{
    calls++;assert.equal(options.method,'HEAD');assert.equal(options.redirect,'error');assert.ok(options.signal);
    assert.ok(url.startsWith('https://freefinder.at/assets/deal-image-pilot/'));
    const bytes=fs.readFileSync(path.join(root,'docs/assets/deal-image-pilot',path.basename(url)));
    return new Response(null,{status:200,headers:{'content-type':'image/jpeg','content-length':String(bytes.length)}});
  }});
  assert.ok((await preview(root,base,{checkPreview:check})).pendingDealImage);
  assert.ok((await preview(root,{...base,id:'second'},{checkPreview:check})).pendingDealImage);
  assert.equal(calls,1);
  const unavailable=createDealImagePreviewCheck({request:async()=>new Response(null,{status:404})});
  assert.equal((await preview(root,base,{checkPreview:unavailable})).pendingDealImage,undefined);
}));

test('approval merge helper excludes already-live identities in both fast and regular publication',()=>fixture(async root=>{
  const {preparePublishedApprovedDeals}=await import('../scraper/slack-approve.js');
  const staged=approve(await preview(root));
  for(const existing of [{...base},{...base,id:'alias-existing-id'}]) {
    const [published]=await preparePublishedApprovedDeals([staged],{root,now,enabled:true,existingDeals:[existing]});
    assert.equal(published.photoUrl,undefined);
    assert.equal(published.pendingDealImage,undefined);
  }
  const [published]=await preparePublishedApprovedDeals([staged],{root,now,enabled:true,existingDeals:[]});
  assert.ok(published.photoUrl);
  const code=fs.readFileSync(path.join(repository,'scraper/slack-approve.js'),'utf8');
  assert.equal((code.match(/await preparePublishedApprovedDeals\(approvedModeration.deals,\{now:publishedAt,existingDeals:existingApprovedDeals\}\)/g)||[]).length,2);
}));

test('Slack rejects optional preview once then delivers ordinary text without marking an image as reviewed',()=>fixture(async root=>{
  const previousFetch=globalThis.fetch,previousFlag=process.env.FREEFINDER_DEAL_IMAGE_PILOT;
  process.env.FREEFINDER_DEAL_IMAGE_PILOT='1';
  try {
    const {postSlackMessage}=await import('../scraper/slack-notify.js');
    const staged=await preview(root),payloads=[];
    globalThis.fetch=async(url,init)=>{
      assert.equal(String(url),'https://slack.com/api/chat.postMessage');payloads.push(JSON.parse(init.body));
      return Response.json(payloads.length===1?{ok:false,error:'invalid_blocks'}:{ok:true,ts:'offline-message'});
    };
    const ts=await postSlackMessage('Offline fixture','offline-thread',0,staged);
    assert.equal(ts,'offline-message');assert.equal(payloads.length,2);
    assert.equal(payloads[0].blocks.some(block=>block.type==='image'),true);
    assert.equal((payloads[1].blocks||[]).some(block=>block.type==='image'),false);
    assert.equal(staged.pendingDealImage,undefined);
    markDealImagePreviewSent(staged,ts,now);
    assert.equal(staged.pendingDealImage,undefined);
  } finally {
    globalThis.fetch=previousFetch;
    if(previousFlag===undefined)delete process.env.FREEFINDER_DEAL_IMAGE_PILOT;else process.env.FREEFINDER_DEAL_IMAGE_PILOT=previousFlag;
  }
}));

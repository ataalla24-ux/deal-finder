import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {auditGeneratedDealImage} from './generated-image-audit.mjs';
import {GENERATED_IMAGE_CACHE,generatedDealImageKey} from '../scraper/generated-deal-images.js';
import {photoDigest} from './deal-photo-contract.mjs';
import {createCreditBudget,loadAiCreditPolicy,DEAL_IMAGE_GENERATION_MODEL,DEAL_IMAGE_GENERATION_URL,
  OPENAI_MODEL_TIMEOUT_MS,OPENAI_IMAGE_TIMEOUT_MS} from '../scraper/ai-credit-budget.js';

const sourceFile='docs/deals-pending-meta-instagram.json';
const now=new Date('2026-11-27T20:00:00Z');
const candidate={id:'fixture-pending',title:'Gratis Donut',description:'Ein Donut pro Person.',brand:'Fixture Bakery',category:'essen',
  url:'https://merchant.example/donut',slackTs:'123.456',slackThreadTs:'123.450',approvedAt:now.toISOString(),
  pendingDealImage:{version:2},pipelineLifecycle:{manualDecision:'approved',manualDecisionUser:'PRIVATE_REVIEWER'},
  privateState:'PRIVATE_INTERNAL'};
const never=async()=>assert.fail('no provider or Slack request permitted');
const fixture=fn=>async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'generated-image-audit-'));
  try {
    fs.mkdirSync(path.join(root,'docs'));
    fs.writeFileSync(path.join(root,sourceFile),JSON.stringify({deals:[candidate]}));
    fs.writeFileSync(path.join(root,'docs/deals.json'),JSON.stringify({deals:[]}));
    await fn(root);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
};
const options=root=>({root,mode:'generate',sourceFile,dealId:candidate.id,now,apiKey:'offline-fixture',request:never,publicRequest:never});
const saveCache=(root,key,row)=>{
  fs.mkdirSync(path.join(root,'reviews'),{recursive:true});
  fs.writeFileSync(path.join(root,GENERATED_IMAGE_CACHE),JSON.stringify({version:1,entries:{[key]:row}}));
};

test('generation prepares only a cloned pending candidate and emits sanitized proof without queue or feed changes',fixture(async root=>{
  const sourceBefore=fs.readFileSync(path.join(root,sourceFile));
  const feedBefore=fs.readFileSync(path.join(root,'docs/deals.json'));
  let preparations=0;
  const result=await auditGeneratedDealImage({...options(root),prepare:async(draft,opts)=>{
    preparations++;
    assert.equal(draft.id,candidate.id);
    assert.equal(draft.title,candidate.title);
    for(const field of ['slackTs','slackThreadTs','pendingDealImage','pipelineLifecycle','approvedAt']) assert.equal(draft[field],undefined);
    assert.deepEqual(opts.batch,{used:0,paused:false});
    const key=generatedDealImageKey(draft),sha256='a'.repeat(64);
    saveCache(root,key,{status:'ready',photoUrl:`https://freefinder.at/assets/approved-deal-photos/${photoDigest(draft.id).slice(0,16)}-${sha256}.jpg`,sha256});
    return {...draft,imagePreparationState:'waiting-publication'};
  }});
  assert.equal(preparations,1);
  assert.equal(result.status,'prepared');
  assert.equal(result.publiclyVerified,false);
  assert.equal(result.sourceUnchanged,true);
  assert.ok(fs.readFileSync(path.join(root,sourceFile)).equals(sourceBefore));
  assert.ok(fs.readFileSync(path.join(root,'docs/deals.json')).equals(feedBefore));
  assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
  assert.equal(JSON.stringify(result).includes('offline-fixture'),false);
}));

test('unsafe source paths, duplicate candidates and already live or locked deals cannot cause generation',fixture(async root=>{
  for(const invalid of ['docs/deals.json','../docs/deals-pending-all.json','/tmp/deals-pending-all.json','docs/sub/deals-pending-all.json']) {
    await assert.rejects(auditGeneratedDealImage({...options(root),sourceFile:invalid,prepare:never}));
  }
  const write=deals=>fs.writeFileSync(path.join(root,sourceFile),JSON.stringify({deals}));
  for(const deals of [[],[candidate,candidate],[{...candidate,approvedDealImage:{status:'locked'}}],
    [{...candidate,pipelineLifecycle:{stage:'published'}}],[{...candidate,pipelineLifecycle:{publishedAt:now.toISOString()}}]]) {
    write(deals);
    await assert.rejects(auditGeneratedDealImage({...options(root),prepare:never}));
  }
  write([candidate]);
  fs.writeFileSync(path.join(root,'docs/deals.json'),JSON.stringify({deals:[{id:candidate.id}]}));
  await assert.rejects(auditGeneratedDealImage({...options(root),prepare:never}),/already-live/);
}));

test('verification with missing prepared state never enters generation',fixture(async root=>{
  const result=await auditGeneratedDealImage({...options(root),mode:'verify-public',prepare:never});
  assert.equal(result.status,'public-verification-pending');
  assert.equal(result.cacheStatus,'missing');
  assert.equal(result.publiclyVerified,false);
}));

test('verification permits an exact public image read and supplies an unusable provider path',fixture(async root=>{
  const bytes=Buffer.from('offline-jpeg-fixture'),sha256=photoDigest(bytes);
  const key=generatedDealImageKey(candidate);
  const photoUrl=`https://freefinder.at/assets/approved-deal-photos/${photoDigest(candidate.id).slice(0,16)}-${sha256}.jpg`;
  saveCache(root,key,{status:'ready',photoUrl,sha256});
  const cacheBefore=fs.readFileSync(path.join(root,GENERATED_IMAGE_CACHE));
  let publicReads=0;
  const result=await auditGeneratedDealImage({...options(root),mode:'verify-public',prepare:async(draft,opts)=>{
    assert.equal(opts.apiKey,'');
    assert.equal(opts.batch.paused,true);
    await assert.rejects(opts.request('https://api.openai.com/v1/images/generations'),/forbidden/);
    assert.equal(await opts.checkPreview({previewURL:photoUrl,bytes,sha256}),true);
    return {...draft,imagePreparationState:'ready',pendingDealImage:{version:3,generationKey:key}};
  },publicRequest:async(url,init)=>{
    assert.equal(url,photoUrl);assert.equal(init.method,'GET');publicReads++;
    return new Response(bytes,{headers:{'content-type':'image/jpeg','content-length':String(bytes.length)}});
  }});
  assert.equal(result.status,'publicly-verified');
  assert.equal(result.publiclyVerified,true);
  assert.equal(publicReads,1);
  assert.ok(fs.readFileSync(path.join(root,GENERATED_IMAGE_CACHE)).equals(cacheBefore));
}));


function imageRequest() {
  return {method:'POST',headers:{},body:JSON.stringify({model:DEAL_IMAGE_GENERATION_MODEL,prompt:'A single ring donut.',
    n:1,size:'1536x1024',quality:'high',complexity:'high',output_format:'jpeg',output_compression:95,moderation:'auto'})};
}

function budgetStore(afterWrite=()=>{}) {
  let state={version:1,pausedUntil:0,reservations:[]},revision=0;
  return {read:async()=>({state:structuredClone(state),revision}),compareAndSwap:async(expected,next)=>{
    if(expected!==revision)return false;
    state=structuredClone(next);revision++;afterWrite();return true;
  }};
}

test('image admission reserves its full five-minute window, including after a delayed ledger write',async()=>{
  const policy=loadAiCreditPolicy(),end=Date.parse(policy.expiresAt);
  const imageOptions={imageGenerationKey:'c'.repeat(64)};
  let calls=0;
  const provider=async()=>{calls++;return Response.json({});};
  const early=createCreditBudget({store:budgetStore(),policy,clock:()=>end-OPENAI_IMAGE_TIMEOUT_MS,request:provider});
  await assert.rejects(early(DEAL_IMAGE_GENERATION_URL,imageRequest(),imageOptions),
    error=>error.budgetReason==='image-generation-period-ending');
  let clock=end-OPENAI_IMAGE_TIMEOUT_MS-1;
  const delayed=createCreditBudget({store:budgetStore(()=>{clock+=60_000;}),policy,clock:()=>clock,request:provider});
  await assert.rejects(delayed(DEAL_IMAGE_GENERATION_URL,imageRequest(),imageOptions),
    error=>error.budgetReason==='image-generation-period-ending');
  assert.equal(calls,0);
});

test('image and text calls use their separate bounded provider timeouts',async()=>{
  const policy=loadAiCreditPolicy(),clock=()=>Date.parse(policy.notBefore)+60000;
  const original=AbortSignal.timeout;
  const timeouts=[];
  AbortSignal.timeout=ms=>{timeouts.push(ms);return new AbortController().signal;};
  try {
    const provider=async()=>Response.json({});
    await createCreditBudget({store:budgetStore(),policy,clock,request:provider})(DEAL_IMAGE_GENERATION_URL,imageRequest(),
      {imageGenerationKey:'d'.repeat(64)});
    await createCreditBudget({store:budgetStore(),policy,clock,request:provider})('https://api.openai.com/v1/chat/completions',
      {method:'POST',headers:{},body:JSON.stringify({model:'gpt-6.2-sol',max_tokens:100,messages:[{role:'user',content:'Offline fixture.'}]})});
    assert.deepEqual(timeouts,[OPENAI_IMAGE_TIMEOUT_MS,OPENAI_MODEL_TIMEOUT_MS]);
    assert.equal(OPENAI_IMAGE_TIMEOUT_MS,300000);
    assert.equal(OPENAI_MODEL_TIMEOUT_MS,110000);
  } finally {AbortSignal.timeout=original;}
});

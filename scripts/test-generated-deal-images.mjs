import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {prepareGeneratedDealImagePreview,generatedDealImageKey,validatePreparedGeneratedImages,GENERATED_IMAGE_CACHE} from '../scraper/generated-deal-images.js';
import {DEAL_IMAGE_GENERATION_URL} from '../scraper/ai-credit-budget.js';

const now=new Date('2026-11-27T20:00:00Z');
const deal={id:'specific-donut',title:'Gratis Donut',brand:'Fixture Bakery',category:'essen',url:'https://example.test/donut',description:'Ein Donut gratis, einmal pro Person.'};
const checks=['matchesSubject','specificEnough','noContradictions','cropComplete','labelReadable','notMisleading'];
const image=await sharp({create:{width:1536,height:1024,channels:3,background:'#b79472'}}).jpeg().toBuffer();
const read=root=>JSON.parse(fs.readFileSync(path.join(root,GENERATED_IMAGE_CACHE)));
const options=root=>({root,now,apiKey:'offline-fixture',batch:{used:0,paused:false},checkPreview:async()=>false});
const fixture=fn=>async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'specific-image-'));try{await fn(root);}finally{fs.rmSync(root,{recursive:true,force:true});}};

function provider({rejectVision=false,pauseVision=false}={}) {
  const calls=[];
  const request=async(url,init,opts)=>{
    const body=JSON.parse(init.body);calls.push({url,body,opts});
    if(url===DEAL_IMAGE_GENERATION_URL) {
      assert.equal(opts.imageGenerationKey,generatedDealImageKey(deal));
      assert.match(body.prompt,/ring donut/);
      return Response.json({data:[{b64_json:image.toString('base64')} ]});
    }
    const name=body.response_format.json_schema.name;
    if(name==='deal_photo_visual_review'&&pauseVision) throw Object.assign(Error('budget'),{code:'free_credit_budget_deferred',budgetReason:'shared-spend-limit'});
    const result=name==='deal_photo_brief'
      ? {eligible:true,visualSubject:'A single ring donut with a visible central hole',requiredFeatures:['ring donut'],avoidFeatures:['cake','restaurant interior']}
      : {...Object.fromEntries(checks.map(key=>[key,true])),...(rejectVision?{matchesSubject:false}:{})};
    return Response.json({model:body.model,choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}]});
  };
  return {calls,request};
}

test('specific image is generated, visually checked, published first and reused without another model call',fixture(async root=>{
  const f=provider(),opts={...options(root),request:f.request};
  const staged=await prepareGeneratedDealImagePreview(deal,opts);
  assert.equal(staged.imagePreparationState,'waiting-publication');
  assert.equal(staged.pendingDealImage,undefined);
  assert.equal(f.calls.length,3);
  const row=read(root).entries[generatedDealImageKey(deal)];
  assert.equal(row.status,'ready');
  assert.ok(row.generatedDealImage.visualSubject.includes('donut'));
  const validated=await validatePreparedGeneratedImages({root});
  assert.equal(validated.inputs.length,3);
  const ready=await prepareGeneratedDealImagePreview({...deal,validUntil:'2027-02-01',address:'Wien'},
    {...opts,request:async()=>assert.fail('ready image must not be regenerated'),checkPreview:async asset=>{
      assert.equal(asset.sha256,row.sha256);return true;
    }});
  assert.equal(ready.pendingDealImage.version,3);
  assert.equal(ready.pendingDealImage.previewURL,row.photoUrl);
  assert.equal(ready.pendingDealImage.draftContextHash,row.inputHash);
  assert.notEqual(generatedDealImageKey({...deal,title:'Gratis Schoko-Donut'}),row.generationKey);
}));

test('a rejected product/crop never reaches Slack and is not regenerated on each dispatch',fixture(async root=>{
  const f=provider({rejectVision:true});
  const result=await prepareGeneratedDealImagePreview(deal,{...options(root),request:f.request});
  assert.equal(result.imagePreparationState,'review-held');
  assert.equal(result.pendingDealImage,undefined);
  assert.equal(read(root).entries[generatedDealImageKey(deal)].status,'held');
  await validatePreparedGeneratedImages({root});
  await prepareGeneratedDealImagePreview(deal,{...options(root),request:async()=>assert.fail('held generation must not spend again')});
}));

test('a successful generation survives a later review-budget pause without buying another image',fixture(async root=>{
  const first=provider({pauseVision:true});
  assert.equal((await prepareGeneratedDealImagePreview(deal,{...options(root),request:first.request})).imagePreparationState,'budget-paused');
  const row=read(root).entries[generatedDealImageKey(deal)];
  assert.equal(row.status,'generated');
  assert.ok(fs.existsSync(path.join(root,row.stagingFile)));
  await validatePreparedGeneratedImages({root});
  const second=provider();
  const result=await prepareGeneratedDealImagePreview(deal,{...options(root),now:new Date(+now+2*3600000),request:second.request});
  assert.equal(result.imagePreparationState,'waiting-publication');
  assert.equal(second.calls.length,1);
  assert.equal(second.calls[0].body.response_format.json_schema.name,'deal_photo_visual_review');
  assert.equal(read(root).entries[generatedDealImageKey(deal)].status,'ready');
}));

test('asset tampering and missing credentials cannot trigger a generic substitute',fixture(async root=>{
  const noKey=await prepareGeneratedDealImagePreview(deal,{...options(root),apiKey:'',request:async()=>assert.fail('no key')});
  assert.equal(noKey.imagePreparationState,'budget-paused');
  const f=provider();await prepareGeneratedDealImagePreview(deal,{...options(root),request:f.request});
  const row=read(root).entries[generatedDealImageKey(deal)];
  fs.writeFileSync(path.join(root,'docs',new URL(row.photoUrl).pathname),'bad');
  await assert.rejects(validatePreparedGeneratedImages({root}));
  const invalid=await prepareGeneratedDealImagePreview(deal,{...options(root),request:async()=>assert.fail('do not regenerate damaged immutable assets')});
  assert.equal(invalid.imagePreparationState,'review-held');
  assert.equal(invalid.pendingDealImage,undefined);
}));

test('an unresolved provider generation is held without a second paid request',fixture(async root=>{
  const f=provider();
  const first=async(url,init,options)=>url===DEAL_IMAGE_GENERATION_URL
    ? Promise.reject(Object.assign(Error('timeout'),{code:'free_credit_budget_deferred',budgetReason:'request-or-ledger-unavailable'}))
    : f.request(url,init,options);
  await prepareGeneratedDealImagePreview(deal,{...options(root),request:first});
  const second=async()=>{throw Object.assign(Error('claimed'),{code:'free_credit_budget_deferred',budgetReason:'image-generation-already-dispatched'});};
  const result=await prepareGeneratedDealImagePreview(deal,{...options(root),now:new Date(+now+2*3600000),request:second});
  assert.equal(result.imagePreparationState,'review-held');
  assert.equal(read(root).entries[generatedDealImageKey(deal)].reason,'generation-recovery-required');
}));

test('cached-only approval never starts image preparation',fixture(async root=>{
  const previous=process.env.APPROVAL_COPY_CACHE_ONLY;
  process.env.APPROVAL_COPY_CACHE_ONLY='1';
  try {
    const result=await prepareGeneratedDealImagePreview(deal,{...options(root),request:async()=>assert.fail('cached approval must not spend')});
    assert.equal(result.imagePreparationState,'budget-paused');
    assert.equal(fs.existsSync(path.join(root,GENERATED_IMAGE_CACHE)),false);
  } finally {
    if(previous===undefined) delete process.env.APPROVAL_COPY_CACHE_ONLY;
    else process.env.APPROVAL_COPY_CACHE_ONLY=previous;
  }
}));

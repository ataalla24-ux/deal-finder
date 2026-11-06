import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {nativeArtworkContext,reviewNativeArtwork,nativeSourceResolution} from './native-artwork-review.mjs';
import {artworkInputHash} from './native-contract-observation.mjs';
import {auditServerQuality} from './server-quality-audit.mjs';
import {photoDigest} from './deal-photo-contract.mjs';

const now=new Date('2026-11-06T14:00:00Z');
const deal={id:'one',title:'1+1 Pizza gratis',brand:'Pizzeria',description:'Mit Gutschein',category:'essen'};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const good={matchesProduct:true,emptyTableOrPackaging:false,cropKeepsProduct:true,visuallyClear:true,uncertain:false};
const response=value=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]});
async function fixture(callback){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'native-photo-test-'));
  const previous=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='offline-test';
  const put=(file,value)=>{fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),JSON.stringify(value));};
  const bytes=Buffer.from('RIFF0000WEBPoffline-fixture'),sha256=hash(bytes),file=`reviews/native-artwork/${sha256}.webp`;
  fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),bytes);
  const selected={title:deal.title,brand:deal.brand,candidates:[1,2],assigned:1,asset:{index:1,crop:{width:1200,height:444},full:{file,sha256},card:{file,sha256},kind:'existing-bundled-symbolic-artwork'}};
  const row={id:deal.id,ios:structuredClone(selected),android:structuredClone(selected),selectionParity:true};
  const observation={version:1,displayTransformationsTested:true,artworkInputHash:artworkInputHash([deal]),entries:[row]};
  try {await callback({root,row,observation,put,file});}
  finally {if(previous===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previous;fs.rmSync(root,{recursive:true,force:true});}
}

test('native observation requires exact current inventory and artwork inputs',()=>fixture(async({observation})=>{
  assert.equal(nativeArtworkContext([deal],observation).status,'observed-selection-current');
  for(const patch of [{title:'Burger'},{description:'Nur vegetarisch'},{category:'reisen'},{photoUrl:'https://example.com/new.jpg'}])
    assert.equal(nativeArtworkContext([{...deal,...patch}],observation).entries.size,0);
  assert.equal(nativeArtworkContext([deal],{...observation,entries:[]}).status,'incomplete-native-selection-observation');
  assert.equal(nativeArtworkContext([deal],{...observation,entries:[...observation.entries,...observation.entries]}).status,'incomplete-native-selection-observation');
  assert.equal(nativeArtworkContext([deal],{...observation,displayTransformationsTested:false}).status,'invalid-native-selection-observation');
  assert.equal(nativeArtworkContext([deal],null).status,'missing-native-selection-observation');
}));

test('two native views are checked together; identical platform pixels reuse one review without rights or recipient claims',()=>fixture(async({root,row})=>{
  let calls=0;const cache={};
  const request=async(_url,init)=>{calls++;const body=JSON.parse(init.body);assert.equal(body.model,'gpt-6.1-terra');assert.equal(body.max_tokens,700);assert.equal(body.messages[1].content.filter(r=>r.type==='image_url').length,2);return response(good);};
  const result=await reviewNativeArtwork(deal,row,{root,cache,now,allowNew:()=>true,request});
  assert.equal(calls,1);assert.equal(result.platforms.ios.status,'symbolic-match');assert.equal(result.platforms.android.cached,true);
  assert.equal(result.platforms.ios.provesMerchantPhoto,false);assert.equal(result.platforms.ios.automaticReplacement,false);
  assert.equal(result.recipientUiTest,false);assert.equal(result.nativeAppLaunched,false);
  await reviewNativeArtwork(deal,row,{root,cache,now,request:()=>assert.fail('cached')});
  await reviewNativeArtwork({...deal,description:'Neue Auswahl'},row,{root,cache,now,allowNew:()=>true,request});assert.equal(calls,2);
  const changed=structuredClone(row);changed.ios.title='1+1 vegane Pizza gratis';
  await reviewNativeArtwork(deal,changed,{root,cache,now,allowNew:()=>true,request});assert.equal(calls,3);
}));

test('empty packaging, poor crop, unclear quality and uncertain product never pass',()=>fixture(async({root,row})=>{
  for(const bad of [{emptyTableOrPackaging:true},{cropKeepsProduct:false},{visuallyClear:false},{uncertain:true},{matchesProduct:false}]){
    const result=await reviewNativeArtwork(deal,row,{root,cache:{},now,allowNew:()=>true,request:async()=>response({...good,...bad})});
    assert.equal(result.platforms.ios.status,'needs-review');
  }
  await assert.rejects(reviewNativeArtwork(deal,row,{root,cache:{},now,allowNew:()=>true,request:async()=>response({matchesProduct:true})}),/invalid-native-photo-review/);
}));

test('original resolution cannot be certified by upscaling or a positive model verdict',()=>fixture(async({root,row})=>{
  assert.equal(nativeSourceResolution({crop:{width:1200,height:100}}).requiresHigherResolution,true);
  assert.equal(nativeSourceResolution({crop:{width:600,height:223}}).requiresHigherResolution,false);
  for(const crop of [{width:313,height:313},{width:0,height:444},undefined]){
    const changed=structuredClone(row);changed.ios.asset.crop=crop;
    const result=await reviewNativeArtwork(deal,changed,{root,cache:{},now,allowNew:()=>true,request:async()=>response(good)});
    assert.equal(result.platforms.ios.status,'needs-review');
    assert.equal(result.platforms.ios.semanticStatus,'symbolic-match');
    assert.equal(result.platforms.android.status,'symbolic-match');
  }
  const changed=structuredClone(row);changed.ios.asset.crop={width:313,height:313};
  const unreviewed=await reviewNativeArtwork(deal,changed,{root,cache:{},now});
  assert.equal(unreviewed.platforms.ios.status,'needs-review');
  assert.equal(unreviewed.platforms.ios.semanticStatus,'not-reviewed');
}));

test('missing, tampered, traversal and symlink assets fail before any model request',()=>fixture(async({root,row,file})=>{
  const options={root,cache:{},now,allowNew:()=>true,request:()=>assert.fail('no model')};
  for(const wrong of ['../private.webp','reviews/native-artwork/../../private.webp','docs/assets/logo.webp']){
    const changed=structuredClone(row);changed.ios.asset.full.file=wrong;
    await assert.rejects(reviewNativeArtwork(deal,changed,options),/invalid-native-image-path/);
  }
  const changed=structuredClone(row);changed.ios.asset.full.sha256='0'.repeat(64);
  await assert.rejects(reviewNativeArtwork(deal,changed,options),/native-image-integrity-failed/);
  const outside=path.join(root,'outside.webp');fs.copyFileSync(path.join(root,file),outside);
  fs.symlinkSync(outside,path.join(root,'reviews/native-artwork/link.webp'));
  const symlink=structuredClone(row);symlink.ios.asset.full.file='reviews/native-artwork/link.webp';
  await assert.rejects(reviewNativeArtwork(deal,symlink,options),/invalid-native-image-path/);
}));

test('approved original photos stay separate from a symbolic fallback review',()=>fixture(async({root,row})=>{
  const photoUrl=`https://freefinder.at/assets/approved-deal-photos/${photoDigest(deal.id).slice(0,16)}-${'a'.repeat(64)}.jpg`;
  const result=await reviewNativeArtwork({...deal,photoUrl},row,{root,cache:{},now});
  assert.equal(result.originalPhoto.status,'requires-original-photo-review');assert.equal(result.platforms.ios.status,'not-reviewed');
}));

test('combined server audit retains the two-call ceiling and performs zero calls on a read-only or stale snapshot',()=>fixture(async({root,row,observation,put})=>{
  const deals=[deal,{...deal,id:'two',title:'Burger'},{...deal,id:'three',title:'Nudeln'}];
  const snapshot={...observation,artworkInputHash:artworkInputHash(deals),entries:deals.map(d=>({...structuredClone(row),id:d.id,ios:{...structuredClone(row.ios),title:d.title},android:{...structuredClone(row.android),title:d.title}}))};
  put('docs/deals.json',{deals});put('reviews/native-artwork-observation.json',snapshot);
  let calls=0;const request=async()=>{calls++;return response(good);};
  const before=JSON.stringify(deals);
  const result=await auditServerQuality({root,now,apply:true,allowAi:true,request});
  assert.equal(calls,2);assert.equal(result.modelCalls,2);assert.equal(result.nativeSelection.reviewedPlatformImages,4);
  assert.equal(result.nativeSelection.sharedAssignments.length,2);
  assert.deepEqual(result.nativeSelection.lowResolutionDeals,[]);
  assert.equal(result.live[2].nativePhoto.platforms.ios.status,'not-reviewed');
  assert.equal(JSON.stringify(JSON.parse(fs.readFileSync(path.join(root,'docs/deals.json'))).deals),before);
  await auditServerQuality({root,now,apply:false,allowAi:true,request:()=>assert.fail('read-only')});
  put('docs/deals.json',{deals:[...deals,{...deal,id:'four'}]});
  const stale=await auditServerQuality({root,now,apply:false,allowAi:true,request:()=>assert.fail('stale')});
  assert.equal(stale.nativeSelection.status,'feed-changed-recheck-required');assert.equal(stale.nativeSelection.reviewedPlatformImages,0);
}));

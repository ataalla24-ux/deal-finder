import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync,spawnSync} from 'node:child_process';
import sharp from 'sharp';
import {fileURLToPath} from 'node:url';
import {normalizeOriginalPhoto,inspectBoundOriginalPhoto,validatePhotoPermission} from './original-deal-photo.mjs';
import {photoDigest,photoSubjectHash} from './deal-photo-contract.mjs';
import {applyLiveDealEditsToBundle,normalizeLiveDealEdit,upsertLiveDealEdit} from './live-deal-edits-lib.mjs';
import {reviewBoundOriginalPhoto} from './native-artwork-review.mjs';
import {validateOriginalDealPhotos} from './validate-original-deal-photos.mjs';
import {auditServerQuality} from './server-quality-audit.mjs';
import {maintainFeedFile} from './automatic-deal-maintenance.mjs';

const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const now=new Date('2026-11-06T14:00:00Z');
const baseDeal={id:'photo-test',title:'Pizza Margherita 1+1',brand:'Test Pizzeria',description:'Zwei Pizzen zum Preis von einer.',category:'essen',url:'https://merchant.example/offer',votes:7};
const permission={dealId:baseDeal.id,sourceURL:'https://merchant.example/photo',rights:'merchant-permission',rightsEvidence:'offline-fixture-permission',reviewedBy:'offline-test',matchesOffer:true,showsActualProduct:true,cropChecked:true};
const verdict={matchesProduct:true,emptyTableOrPackaging:false,cropKeepsProduct:true,visuallyClear:true,uncertain:false};
function write(root,file,value){const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,Buffer.isBuffer(value)?value:JSON.stringify(value));}
async function fixture(fn){const root=fs.mkdtempSync(path.join(os.tmpdir(),'original-photo-'));try{return await fn(root);}finally{fs.rmSync(root,{recursive:true,force:true});}}
async function image(width=1200,height=800){return sharp({create:{width,height,channels:3,background:'#cc4422'}}).jpeg().toBuffer();}
async function bound(root,deal={...baseDeal}){
  const asset=await normalizeOriginalPhoto(await image());
  const filename=`${photoDigest(deal.id).slice(0,16)}-${photoDigest(asset.bytes)}.jpg`;
  const photoUrl=`https://freefinder.at/assets/approved-deal-photos/${filename}`;
  const review={version:2,...permission,dealId:deal.id,file:filename,photoUrl,subjectHash:photoSubjectHash(deal),sha256:photoDigest(asset.bytes),cardSha256:photoDigest(asset.card),...asset.size,crop:asset.crop,reviewedAt:now.toISOString()};
  write(root,'docs/assets/approved-deal-photos/'+filename,asset.bytes);
  write(root,'reviews/deal-photos/'+filename+'.json',review);
  return {deal:{...deal,photoUrl},review,asset,filename};
}

test('actual decode rejects a valid-looking JPEG header and truncated scan',async()=>{
  const header=Buffer.from([0xff,0xd8,0xff,0xc0,0,8,8,3,32,4,176,1,0xff,0xd9]);
  await assert.rejects(normalizeOriginalPhoto(header));
  const jpeg=await image();await assert.rejects(normalizeOriginalPhoto(jpeg.subarray(0,Math.floor(jpeg.length/2))));
  await assert.rejects(normalizeOriginalPhoto(await image(599,400)),/600x400/);
  await assert.rejects(normalizeOriginalPhoto(Buffer.alloc(1_500_001)),/1.5 MB/);
});

test('normalization preserves resolution, strips metadata and produces real centre crop',async()=>{
  const source=await sharp(await image()).withMetadata({density:144}).jpeg().toBuffer();
  await assert.rejects(normalizeOriginalPhoto(source),/EXIF/);
  const {bytes,card,size,crop}=await normalizeOriginalPhoto(await image(1000,600));
  assert.deepEqual(size,{width:1000,height:600});assert.deepEqual(crop,{left:0,top:115,width:1000,height:370});
  const metadata=await sharp(bytes).metadata(),cropped=await sharp(card).metadata();
  assert.equal(metadata.exif,undefined);assert.equal(metadata.iptc,undefined);
  assert.equal(cropped.width,1000);assert.equal(cropped.height,370);
});

test('public visibility is not permission and arbitrary extra fields cannot approve',()=>{
  for(const patch of [{rights:'public-instagram'},{rightsEvidence:''},{reviewedBy:''},{revoked:true},{matchesOffer:false},{showsActualProduct:false},{cropChecked:false},{sourceURL:'file:///secret'},{sourceURL:'https://user:secret@example.com'}])
    assert.throws(()=>validatePhotoPermission({...permission,...patch}));
  validatePhotoPermission({...permission,rights:'owned-original'});
});

test('bound original verifies exact subject, file and card hashes',()=>fixture(async root=>{
  const {deal,review,filename}=await bound(root);assert.ok(await inspectBoundOriginalPhoto(deal,{root}));
  for(const patch of [{title:'Kebab 1+1'},{brand:'Different merchant'},{description:'Vegan only'},{category:'freizeit'},{url:'https://merchant.example/new'}])
    await assert.rejects(inspectBoundOriginalPhoto({...deal,...patch},{root}),/stale/);
  write(root,'reviews/deal-photos/'+filename+'.json',{...review,cardSha256:'0'.repeat(64)});
  await assert.rejects(inspectBoundOriginalPhoto(deal,{root}),/crop-integrity/);
  write(root,'reviews/deal-photos/'+filename+'.json',review);
  write(root,'docs/assets/approved-deal-photos/'+filename,await image(1100,800));
  await assert.rejects(inspectBoundOriginalPhoto(deal,{root}),/integrity/);
}));

test('revocation and symlink escape fail before any image/model request',()=>fixture(async root=>{
  const {deal,review,filename}=await bound(root);
  write(root,'reviews/deal-photos/'+filename+'.json',{...review,revoked:true});
  let calls=0;const request=async()=>{calls++;throw Error('must not call');};
  const invalid=await reviewBoundOriginalPhoto(deal,{root,cache:{},now,allowNew:()=>true,request});
  assert.equal(invalid.status,'needs-review');assert.equal(calls,0);
  write(root,'reviews/deal-photos/'+filename+'.json',review);
  const file=path.join(root,'docs/assets/approved-deal-photos',filename);
  fs.unlinkSync(file);write(root,'outside.jpg',await image());fs.symlinkSync(path.join(root,'outside.jpg'),file);
  await assert.rejects(inspectBoundOriginalPhoto(deal,{root}),/outside-review/);
  assert.equal((await validateOriginalDealPhotos([deal],{root})).errors,1);
}));

test('image binding survives edit-store replay and disables image on changed deal only',()=>{
  const url=`https://freefinder.at/assets/approved-deal-photos/${photoDigest(baseDeal.id).slice(0,16)}-${'a'.repeat(64)}.jpg`;
  let store={edits:[{dealId:baseDeal.id,photoUrl:url,photoSubjectHash:photoSubjectHash(baseDeal)}]};
  assert.equal(normalizeLiveDealEdit(store.edits[0]).photoSubjectHash,photoSubjectHash(baseDeal));
  assert.equal(normalizeLiveDealEdit({dealId:baseDeal.id,photoSubjectHash:''},{existing:store.edits[0]}).photoSubjectHash,photoSubjectHash(baseDeal));
  const bundle={updatedAt:'2026-11-01T00:00:00Z',deals:[baseDeal,{id:'other',title:'Other',votes:9}]};
  const initial=applyLiveDealEditsToBundle(bundle,store).bundle;
  assert.equal(initial.deals[0].photoUrl,url);
  const cleared=applyLiveDealEditsToBundle(initial,{edits:[{...store.edits[0],photoUrl:''}]}).bundle;
  assert.equal(cleared.deals[0].photoUrl,'');
  store=upsertLiveDealEdit(store,{dealId:baseDeal.id,title:'Kebab 1+1'});
  const changed=applyLiveDealEditsToBundle(initial,store).bundle;
  assert.equal(changed.deals[0].photoUrl,'');assert.equal(changed.deals[0].title,'Kebab 1+1');
  assert.equal(changed.deals[0].votes,7);assert.deepEqual(changed.deals[1],bundle.deals[1]);
  const replay=applyLiveDealEditsToBundle(changed,store,{checkedAt:'2026-11-08T00:00:00Z'});
  assert.equal(replay.changed,false);assert.deepEqual(replay.bundle,changed);
});

test('visual review sees real full/crop bytes and cache cannot override changed permission',()=>fixture(async root=>{
  const {deal,review,filename,asset}=await bound(root);const cache={};let calls=0;
  const request=async(url,options)=>{calls++;const body=JSON.parse(options.body);assert.equal(body.store,false);
    const imgs=body.messages[1].content.slice(1).map(i=>Buffer.from(i.image_url.url.split(',')[1],'base64'));
    assert.ok(imgs[0].equals(asset.bytes));assert.ok(imgs[1].equals(asset.card));
    return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(verdict)}}]})};};
  const first=await reviewBoundOriginalPhoto(deal,{root,cache,now,allowNew:()=>true,request});
  assert.equal(first.status,'visual-match');assert.equal(first.provesMerchantPhoto,false);assert.equal(first.automaticReplacement,false);
  assert.equal((await reviewBoundOriginalPhoto(deal,{root,cache,now,request})).cached,true);assert.equal(calls,1);
  write(root,'reviews/deal-photos/'+filename+'.json',{...review,revoked:true});
  assert.equal((await reviewBoundOriginalPhoto(deal,{root,cache,now,request})).status,'needs-review');assert.equal(calls,1);
}));

test('automatic copy maintenance clears only stale bound originals, preview is read-only and replay stable',()=>fixture(async root=>{
  const input={...baseDeal,title:'Jetzt Sichere dir 20 Prozent Rabatt auf ausgewählte Snacks',description:'Nur mit Gutschein. Mindestbestellwert 10 Euro.'};
  const {deal}=await bound(root,input);
  const other={...baseDeal,id:'unchanged',photoUrl:'https://example.com/unrelated.jpg'};
  write(root,'docs/deals.json',{deals:[deal,other]});
  write(root,'docs/live-deal-edits.json',{edits:[{dealId:deal.id,photoUrl:deal.photoUrl,photoSubjectHash:photoSubjectHash(deal)}]});
  write(root,'reviews/automatic-maintenance-policy.json',{version:1,enabled:true,automaticLocalCopy:true,automaticExpiry:false,maxAiCandidatesPerRun:0});
  const before=fs.readFileSync(path.join(root,'docs/deals.json'));
  const preview=await maintainFeedFile({cwd:root,now,apply:false,request:()=>assert.fail('no network')});
  assert.equal(preview.deals[0].photoUrl,'');assert.ok(fs.readFileSync(path.join(root,'docs/deals.json')).equals(before));
  assert.equal(fs.existsSync(path.join(root,'reviews/automatic-deal-maintenance-state.json')),false);
  const applied=await maintainFeedFile({cwd:root,now,apply:true});
  assert.equal(applied.deals[0].photoUrl,'');assert.notEqual(applied.deals[0].title,input.title);
  assert.equal(applied.deals[0].votes,input.votes);assert.deepEqual(applied.deals[1],other);
  assert.ok(applied.report.corrected.some(r=>r.method==='reviewed-photo-subject-changed'));
  const replay=await maintainFeedFile({cwd:root,now,apply:true});
  assert.equal(replay.changed,false);assert.deepEqual(replay.deals,applied.deals);
}));

const gitEnv={...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_'))),
  GIT_AUTHOR_NAME:'Photo Fixture',GIT_AUTHOR_EMAIL:'photo@example.com',GIT_COMMITTER_NAME:'Photo Fixture',GIT_COMMITTER_EMAIL:'photo@example.com',
  GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:os.devNull,GIT_ALLOW_PROTOCOL:'file',GIT_TERMINAL_PROMPT:'0'};
function git(cwd,...args){return execFileSync('git',args,{cwd,env:gitEnv,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
function gitCommit(cwd){git(cwd,'add','.');git(cwd,'commit','-m','offline photo fixture');}
const photoInputs=['scripts/original-deal-photo.mjs','scripts/deal-photo-contract.mjs','scripts/validate-original-deal-photos.mjs'];
async function photoGitFixture(root){
  const seed=path.join(root,'seed'),remote=path.join(root,'remote.git'),local=path.join(root,'local'),concurrent=path.join(root,'concurrent');
  fs.mkdirSync(seed);git(seed,'init','--initial-branch=main');
  write(seed,'docs/deals.json',{deals:[baseDeal]});write(seed,'docs/live-deal-edits.json',{edits:[]});
  for(const file of photoInputs){fs.mkdirSync(path.dirname(path.join(seed,file)),{recursive:true});fs.copyFileSync(path.join(repository,file),path.join(seed,file));}
  for(const file of ['scripts/enrich-deal-map.mjs','scripts/sync-deal-guides.mjs','scripts/sync-featured-deal-references.mjs','scripts/generate-seo-deals-page.mjs']){
    fs.writeFileSync(path.join(seed,file),'// Offline fixture: no external calls.\n');
  }
  gitCommit(seed);git(root,'init','--bare','--initial-branch=main',remote);git(seed,'remote','add','origin',remote);git(seed,'push','-u','origin','main');
  git(root,'clone','--branch','main',remote,local);git(root,'clone','--branch','main',remote,concurrent);
  const photo=await bound(local);
  write(local,'docs/deals.json',{deals:[photo.deal]});
  write(local,'docs/live-deal-edits.json',{edits:[{dealId:baseDeal.id,photoUrl:photo.deal.photoUrl,photoSubjectHash:photoSubjectHash(baseDeal)}]});
  return {root,remote,local,concurrent,...photo};
}
for(const mode of ['full','omit-photo','omit-review','invalid-bytes','remote-revocation']){
  test(`real generated committer enforces original photo atomicity: ${mode}`,()=>fixture(async root=>{
    const f=await photoGitFixture(root);
    const assetPath='docs/assets/approved-deal-photos/'+f.filename,reviewPath='reviews/deal-photos/'+f.filename+'.json';
    let paths=['docs/deals.json','docs/live-deal-edits.json',assetPath,reviewPath];
    if(mode==='omit-photo')paths=paths.filter(p=>p!==assetPath);
    if(mode==='omit-review')paths=paths.filter(p=>p!==reviewPath);
    if(mode==='invalid-bytes')write(f.local,assetPath,Buffer.from('not-a-photo'));
    if(mode==='remote-revocation'){
      write(f.concurrent,reviewPath,{...f.review,revoked:true});gitCommit(f.concurrent);git(f.concurrent,'push','origin','main');
    }
    const before=git(f.remote,'rev-parse','main');
    const run=spawnSync(process.execPath,[path.join(repository,'scripts/commit-generated.mjs'),'--message','offline photo batch','--remote','origin','--branch','main','--retries','0','--replace-conflicts','--files',...paths],{cwd:f.local,env:gitEnv,encoding:'utf8'});
    const output=run.stdout+'\n'+run.stderr;
    if(mode==='full'){
      assert.equal(run.status,0,output);assert.notEqual(git(f.remote,'rev-parse','main'),before);
      assert.equal(JSON.parse(git(f.remote,'show','main:docs/deals.json')).deals[0].photoUrl,f.deal.photoUrl);
      assert.equal(JSON.parse(git(f.remote,'show','main:'+reviewPath)).subjectHash,f.review.subjectHash);
      const bytes=execFileSync('git',['show','main:'+assetPath],{cwd:f.remote,env:gitEnv});assert.ok(bytes.equals(f.asset.bytes));
    }else{
      assert.equal(run.status,1,output);assert.match(output,/Original photo (consistency|verification) failed/);
      assert.equal(git(f.remote,'rev-parse','main'),before,'rejected batch must not publish');
      assert.equal(JSON.parse(git(f.remote,'show','main:docs/deals.json')).deals[0].photoUrl,undefined);
    }
  }));
}

test('original, fallback and website reviews share two calls even without native observation',()=>fixture(async root=>{
  const deals=[];for(let i=0;i<3;i++)deals.push((await bound(root,{...baseDeal,id:'image-'+i})).deal);
  write(root,'docs/deals.json',{deals});
  const previous=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='offline-test-only';let calls=0;
  try{const report=await auditServerQuality({root,now,apply:true,allowAi:true,request:async()=>{calls++;return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(verdict)}}]})};}});
    assert.equal(calls,2);assert.equal(report.modelCalls,2);assert.equal(report.nativeSelection.observedDeals,0);
    assert.deepEqual(report.live.map(r=>r.nativePhoto.originalPhoto.status),['visual-match','visual-match','not-reviewed']);
  }finally{if(previous===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previous;}
}));

test('real offline importer records only reviewed fields and preserves foreign edits',()=>fixture(async root=>{
  for(const name of ['prepare-deal-photo.mjs','deal-photo-contract.mjs','original-deal-photo.mjs','live-deal-edits-lib.mjs']){
    const target=path.join(root,'scripts',name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(repository,'scripts',name),target);
  }
  fs.symlinkSync(path.join(repository,'node_modules'),path.join(root,'node_modules'));
  write(root,'docs/deals.json',{deals:[baseDeal]});
  write(root,'docs/live-deal-edits.json',{version:1,edits:[{dealId:baseDeal.id,description:baseDeal.description,forceKeep:true},{dealId:'hidden',hidden:true,manualRemovalApproved:true}]});
  write(root,'input.jpg',await image());write(root,'request.json',{...permission,file:'input.jpg',unrelatedSecret:'never-store-this'});
  const run=mode=>JSON.parse(execFileSync(process.execPath,[path.join(root,'scripts/prepare-deal-photo.mjs'),path.join(root,'request.json'),mode],{encoding:'utf8'}));
  const checked=run('--check');assert.equal(checked.mode,'check-only');assert.equal(fs.existsSync(path.join(root,'reviews/deal-photos')),false);
  const applied=run('--apply');assert.equal(applied.mode,'prepared-not-published');
  const edits=JSON.parse(fs.readFileSync(path.join(root,'docs/live-deal-edits.json')));
  assert.equal(edits.edits.find(e=>e.dealId==='hidden').hidden,true);assert.equal(edits.edits.find(e=>e.dealId===baseDeal.id).forceKeep,true);
  const current=applyLiveDealEditsToBundle({deals:[baseDeal]},edits).bundle.deals[0];
  const boundPhoto=await inspectBoundOriginalPhoto(current,{root});assert.ok(boundPhoto);
  assert.equal(JSON.stringify(boundPhoto.review).includes('never-store-this'),false);
  assert.equal(JSON.stringify(boundPhoto.review).includes(root),false);
  assert.equal((await validateOriginalDealPhotos([current],{root})).errors,0);
}));

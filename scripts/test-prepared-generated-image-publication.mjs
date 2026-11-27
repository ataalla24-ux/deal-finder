import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import sharp from 'sharp';
import {prepareGeneratedPhoto} from './generated-deal-photo-contract.mjs';
import {photoDigest} from './deal-photo-contract.mjs';
import {writePreparedOriginalPhoto} from './original-deal-photo.mjs';
import {validatePreparedGeneratedImages} from '../scraper/generated-deal-images.js';

const publisher=path.resolve(import.meta.dirname,'commit-generated.mjs');
const cachePath='reviews/generated-deal-images.json';
const now=new Date('2026-11-27T20:00:00Z');
const deal={id:'prepared-asset-publication',title:'Gratis Kaffee',brand:'Fixture Cafe',category:'kaffee',
  description:'Eine Tasse Kaffee gratis.',url:'https://merchant.example/coffee'};
const environment={...process.env,SENTRY_DISABLED:'1',OPENAI_API_KEY:'',GH_TOKEN:'',GITHUB_TOKEN:'',
  GIT_AUTHOR_NAME:'Prepared Image Test',GIT_AUTHOR_EMAIL:'fixture@example.com',
  GIT_COMMITTER_NAME:'Prepared Image Test',GIT_COMMITTER_EMAIL:'fixture@example.com'};
const patterns=[cachePath,'docs/assets/approved-deal-photos/*.jpg','reviews/deal-photos/*.json',
  'reviews/generated-deal-image-staging/*.jpg'];

function command(command,args,cwd) {
  const result=spawnSync(command,args,{cwd,env:environment,encoding:'utf8'});
  assert.equal(result.status,0,`${command} ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
function write(root,file,payload) {
  const target=path.join(root,file);
  fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.writeFileSync(target,JSON.stringify(payload,null,2)+'\n');
}
const read=(root,file)=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));

async function fixture(t,{existing=false}={}) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'prepared-image-publication-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const seed=path.join(directory,'seed'),remote=path.join(directory,'remote.git'),local=path.join(directory,'local');
  fs.mkdirSync(seed);
  command('git',['init','--initial-branch=main'],seed);
  write(seed,'docs/deals.json',{deals:[{id:'unchanged-live',title:'Existing live offer'}],totalDeals:1});
  write(seed,cachePath,{version:1,entries:{}});
  const prepared=await prepareGeneratedPhoto(deal,{generationKey:'c'.repeat(64),promptHash:'d'.repeat(64),
    visualSubject:'One cup of dark coffee',model:'gpt-image-2.6-sunburst',generatedAt:now.toISOString()},
  await sharp({create:{width:1200,height:800,channels:3,background:'#aa7744'}}).jpeg().toBuffer(),now);
  prepared.review.generatedVisualReview={version:1,model:'gpt-6.2-astra',checkedAt:now.toISOString(),
    imageSha256:prepared.review.sha256,inputHash:prepared.generatedDealImage.inputHash,
    matchesSubject:true,specificEnough:true,noContradictions:true,cropComplete:true,labelReadable:true,notMisleading:true};
  const stagingFile=`reviews/generated-deal-image-staging/${prepared.generatedDealImage.generationKey}-${prepared.review.sha256}.jpg`;
  const cache={version:1,entries:{[prepared.generatedDealImage.generationKey]:{status:'ready',
    generationKey:prepared.generatedDealImage.generationKey,inputHash:prepared.generatedDealImage.inputHash,
    dealHash:photoDigest(deal.id),model:'gpt-image-2.6-sunburst',visualSubject:prepared.generatedDealImage.visualSubject,
    promptHash:prepared.generatedDealImage.promptHash,generatedAt:now.toISOString(),readyAt:now.toISOString(),
    generatedDealImage:prepared.generatedDealImage,photoUrl:prepared.photoUrl,sha256:prepared.review.sha256,
    stagingFile,stagingSha256:prepared.review.sha256}}};
  const stage=root=>{
    writePreparedOriginalPhoto(root,prepared);
    const target=path.join(root,stagingFile);
    fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.writeFileSync(target,prepared.bytes);
    write(root,cachePath,cache);
  };
  if(existing) stage(seed);
  command('git',['add','.'],seed);
  command('git',['commit','-m','Initial publication state'],seed);
  command('git',['init','--bare','--initial-branch=main',remote],directory);
  command('git',['remote','add','origin',remote],seed);
  command('git',['push','origin','main'],seed);
  command('git',['clone','--branch','main',remote,local],directory);
  if(!existing) stage(local);
  const receipt=`reviews/deal-photos/${prepared.review.file}.json`;
  const photo=`docs/assets/approved-deal-photos/${prepared.review.file}`;
  const noNetwork=path.join(directory,'no-network.mjs'),networkCount=path.join(directory,'network-count.json');
  fs.writeFileSync(noNetwork,`import fs from 'node:fs';\nlet attempts=0;\nglobalThis.fetch=async()=>{attempts++;throw Error('network-forbidden-in-publication-test');};\nprocess.on('exit',()=>fs.writeFileSync(${JSON.stringify(networkCount)},JSON.stringify({attempts})));\n`);
  const publish=(files=patterns,{skipConflicts=false}={})=>{
    const result=spawnSync(process.execPath,['--import',noNetwork,publisher,...(skipConflicts?['--skip-conflicts']:[]),'--retries','0','--message','Prepare image assets',
      '--files',...files],{cwd:local,env:environment,encoding:'utf8'});
    assert.equal(read(directory,'network-count.json').attempts,0,'publication performs no model or provider requests');
    return result;
  };
  return {directory,local,remote,prepared,cache,photo,receipt,stagingFile,publish};
}

test('prepared image cache, bytes and receipts publish atomically while the live feed is unchanged',async t=>{
  const f=await fixture(t);
  const originalFeed=fs.readFileSync(path.join(f.local,'docs/deals.json'));
  const checked=await validatePreparedGeneratedImages({root:f.local});
  assert.ok([cachePath,f.photo,f.receipt,f.stagingFile].every(file=>checked.inputs.includes(file)));
  const result=f.publish();
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
  const verify=path.join(f.directory,'verify');
  command('git',['clone','--branch','main',f.remote,verify],f.directory);
  assert.deepEqual(read(verify,cachePath),f.cache);
  assert.deepEqual(fs.readFileSync(path.join(verify,f.photo)),f.prepared.bytes);
  assert.deepEqual(fs.readFileSync(path.join(verify,f.stagingFile)),f.prepared.bytes);
  assert.deepEqual(read(verify,f.receipt),f.prepared.review);
  assert.deepEqual(fs.readFileSync(path.join(verify,'docs/deals.json')),originalFeed);
});

test('a cache-only checkpoint cannot omit newly prepared image bytes and receipts',async t=>{
  const f=await fixture(t);
  const originalHead=command('git',['rev-parse','refs/heads/main'],f.remote).trim();
  const result=f.publish([cachePath]);
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Prepared generated image consistency failed: partial batch omits/);
  assert.equal(command('git',['rev-parse','refs/heads/main'],f.remote).trim(),originalHead);
});

for(const changed of ['receipt','cache']) test(`a concurrent ${changed} update invalidates a prepared image checkpoint`,async t=>{
  const f=await fixture(t,{existing:true});
  const next=structuredClone(f.cache);
  next.entries[f.prepared.generatedDealImage.generationKey].lastReadAt='2026-11-27T20:01:00Z';
  write(f.local,cachePath,next);
  const concurrent=path.join(f.directory,'concurrent');
  command('git',['clone','--branch','main',f.remote,concurrent],f.directory);
  const changedPath=changed==='receipt'?f.receipt:cachePath;
  const payload=read(concurrent,changedPath);
  if(changed==='receipt') payload.rightsEvidence+=' Updated by a concurrent reviewer.';
  else payload.updatedAt='2026-11-27T20:02:00Z';
  write(concurrent,changedPath,payload);
  command('git',['add',changedPath],concurrent);
  command('git',['commit','-m','Concurrent review update'],concurrent);
  command('git',['push','origin','main'],concurrent);
  const expectedHead=command('git',['rev-parse','refs/heads/main'],f.remote).trim();
  const result=f.publish(patterns,{skipConflicts:true});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Prepared generated image consistency failed: remote changed/);
  assert.ok(result.stderr.includes(changedPath));
  assert.equal(command('git',['rev-parse','refs/heads/main'],f.remote).trim(),expectedHead);
});

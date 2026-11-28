import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {prepareDealImagePreview} from '../scraper/deal-image-pilot.js';
import {inspectBoundOriginalPhoto} from './original-deal-photo.mjs';
import {photoDigest} from './deal-photo-contract.mjs';

const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
for(const mode of ['targeted','regular']) for(const scenario of ['original','edited','orphan']) test(`actual ${mode} approval: ${scenario}`,async()=>{
  const edited=scenario==='edited',refresh=scenario!=='original';
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'owned-image-approval-'));
  const previousEnv={...process.env},previousFetch=globalThis.fetch;
  const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
  const write=(file,value)=>{const p=path.join(root,file);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(value));};
  try {
    for(const directory of ['scraper','sentry','docs/assets/deal-image-pilot','docs/assets/blog/photos']) {
      fs.mkdirSync(path.dirname(path.join(root,directory)),{recursive:true});
      fs.cpSync(path.join(repository,directory),path.join(root,directory),{recursive:true});
    }
    fs.mkdirSync(path.join(root,'scripts'));
    for(const file of ['deal-map-review.mjs','deal-map-enrichment.mjs','deal-map-chain-rules.mjs',
      'deal-map-source-addresses.mjs','approval-map-readiness.mjs','discover-vienna-merchants.mjs',
      'automatic-deal-maintenance.mjs','original-social-copy.mjs','automatic-maintenance-review.mjs','refresh-maintenance-evidence.mjs',
      'live-deal-duplicates.mjs', 'approved-expiry-evidence.mjs','expiry-embedded-clock-range.mjs','expiry-original-today.mjs',
      'expiry-fixed-flight.mjs','expiry-instagram-finite-range.mjs','deal-photo-contract.mjs',
      'original-deal-photo.mjs','live-deal-edits-lib.mjs','refresh-pending-deal-photo.mjs'])
      fs.copyFileSync(path.join(repository,'scripts',file),path.join(root,'scripts',file));
    fs.copyFileSync(path.join(repository,'package.json'),path.join(root,'package.json'));
    fs.symlinkSync(path.join(repository,'node_modules'),path.join(root,'node_modules'));
    fs.mkdirSync(path.join(root,'reviews'));
    for(const file of ['restaurant-coupon-documents.json','nordsee-coupon-cards-20261113.json'])
      fs.copyFileSync(path.join(repository,'reviews',file),path.join(root,'reviews',file));
    Object.assign(process.env,{SENTRY_DISABLED:'1',SLACK_BOT_TOKEN:'offline-only',SLACK_CHANNEL_ID:'C_TEST',
      FREEFINDER_DEAL_IMAGE_PILOT:'1',APPROVAL_REQUIRE_MAP:'0',APPROVAL_SOURCE_COPY_REVIEW:'0',APPROVAL_COPY_CACHE_ONLY:'1',
      APPROVAL_MAP_SOURCE_REQUESTS:'0',APPROVAL_MAP_GEOCODE_REQUESTS:'0'});
    delete process.env.OPENAI_API_KEY;
    delete process.env.APPROVE_SLACK_CHANNEL_ID;delete process.env.APPROVE_SLACK_MESSAGE_TS;
    delete process.env.APPROVE_SLACK_REACTION;delete process.env.APPROVE_SLACK_REACTION_USER;
    const now=new Date(),ts=String(Math.floor(+now/1000))+'.123456',thread=String(Math.floor(+now/1000)-3)+'.123456';
    const until=new Date(+now+30*86400000).toISOString().slice(0,10);
    const literal=until.split('-').reverse().join('.');
    const original={id:'preview-approval-'+mode,title:'Gratis Kaffee mit Gutschein',description:'Eine Tasse Kaffee gratis gegen Vorlage des Gutscheins. Nur einmal pro Person in Wien.',
      brand:'Café Fixture',category:'kaffee',type:'gratis',url:'https://cafe-fixture.example/angebote/kaffee',source:'Merchant fixture',
      address:'Wollzeile 29, 1010 Wien',distance:'Wien',validUntil:until,expires:until,
      expiresOriginal:'Gültig bis '+literal,sourcePublishedAt:new Date(+now-3600000).toISOString(),
      validity:{status:'ok',urlStatus:'HTTP 200',checkedAt:now.toISOString(),finalUrl:'https://cafe-fixture.example/angebote/kaffee'}};
    const queued=await prepareDealImagePreview(original,{root,now,enabled:true,checkPreview:async()=>true});
    assert.ok(queued.pendingDealImage);
    Object.assign(queued,{slackTs:ts,slackThreadTs:thread});
    Object.assign(queued.pendingDealImage,{slackMessageTs:ts,sentAt:now.toISOString()});
    if(mode==='targeted')Object.assign(process.env,{APPROVE_SLACK_CHANNEL_ID:'C_TEST',APPROVE_SLACK_MESSAGE_TS:ts});
    const {main}=await import(pathToFileURL(path.join(root,'scraper/slack-approve.js')));
    const {buildSlackMessage}=await import(pathToFileURL(path.join(root,'scraper/slack-notify.js')));
    const message={ts,thread_ts:thread,user:'BOT',text:buildSlackMessage(queued,1)};
    const external=[],posts=[];
    const editCommand={ts:String(Math.floor(+now/1000)+1)+'.123456',text:'edit 1 titel: Gratis Döner mit Gutschein | beschreibung: Ein Döner gratis gegen Vorlage des Gutscheins.'};
    globalThis.fetch=async(url,init={})=>{
      const target=new URL(url);
      if(refresh && target.hostname==='freefinder.at') {
        const bytes=fs.readFileSync(path.join(root,'docs',target.pathname));
        return new Response(bytes,{headers:{'content-type':'image/jpeg','content-length':String(bytes.length)}});
      }
      if(target.hostname==='cafe-fixture.example') {
        external.push(String(url));
        return new Response(`<main><h1>${original.title}</h1><p>${original.description} Gültig bis ${literal}.</p><p>Wollzeile 29, 1010 Wien</p></main>`,{status:200,headers:{'content-type':'text/html'}});
      }
      assert.equal(target.hostname,'slack.com','only existing source validation and Slack reads are permitted in the offline fixture');
      if(target.pathname.endsWith('/auth.test'))return Response.json({ok:true,user_id:'BOT'});
      if(target.pathname.endsWith('/conversations.history'))return Response.json({ok:true,messages:[]});
      if(target.pathname.endsWith('/conversations.replies'))return Response.json({ok:true,messages:[message,...edited?[editCommand]:[]]});
      if(target.pathname.endsWith('/reactions.get'))return Response.json({ok:true,message:{...message,reactions:[{name:'white_check_mark',users:['U_OFFLINE_REVIEWER']}]}});
      if(/\/chat\.(?:postMessage|update)$/.test(target.pathname)) {
        posts.push({method:target.pathname,payload:JSON.parse(init.body)});
        return Response.json({ok:true,ts:String(Math.floor(+now/1000)+2)+'.123456'});
      }
      assert.fail('Unexpected fixture request '+target.pathname);
    };
    if(scenario==='orphan') delete queued.pendingDealImage;
    write('docs/deals.json',{deals:[],totalDeals:0});write('docs/deals-pending-all.json',{deals:[queued]});
    await main();
    if(refresh) {
      assert.equal(read('docs/deals.json').deals.length,0,'old check must not approve a new image');
      const remaining=read('docs/deals-pending-all.json').deals;
      assert.equal(remaining.length,1);
      assert.notEqual(remaining[0].slackTs,ts);
      assert.equal(remaining[0].pendingDealImage.key,edited?'kebab':'coffee');
      assert.equal(remaining[0].pipelineLifecycle.manualDecision,'');
      assert.equal(posts.filter(p=>p.method.endsWith('/chat.postMessage')).length,1);
      assert.equal(external.length,0,'new preview requires its own check before source validation');
      return;
    }
    const published=read('docs/deals.json').deals[0];
    assert.ok(published,JSON.stringify(read('docs/deals-pending-all.json')));
    assert.ok(published.photoUrl,JSON.stringify(published));
    assert.equal(published.description,original.description);
    assert.equal(published.pendingDealImage,undefined);
    assert.equal(read('docs/deals-pending-all.json').deals.length,0);
    const bound=await inspectBoundOriginalPhoto(published,{root});
    assert.equal(photoDigest(bound.bytes),queued.pendingDealImage.sha256);
    assert.ok(external.length<=1,'photo promotion adds no extra source or image request');
  } finally {
    globalThis.fetch=previousFetch;
    for(const key of Object.keys(process.env))if(!(key in previousEnv))delete process.env[key];
    Object.assign(process.env,previousEnv);fs.rmSync(root,{recursive:true,force:true});
  }
});

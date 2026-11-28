import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import sharp from 'sharp';
import {prepareGeneratedPhoto} from './generated-deal-photo-contract.mjs';
import {writePreparedOriginalPhoto,inspectBoundOriginalPhoto} from './original-deal-photo.mjs';
import {photoDigest} from './deal-photo-contract.mjs';
import {dealImageAssetKey} from '../scraper/deal-image-subject.js';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

for (const mode of ['targeted','regular']) for (const productEdited of [false,true]) {
  test(`actual ${mode} approval binds a generated photo ${productEdited ? 'only after a fresh product review' : 'before copy enrichment'}`,async()=>{
    const root = fs.mkdtempSync(path.join(os.tmpdir(),'generated-photo-entry-'));
    const previousEnv = {...process.env},previousFetch = globalThis.fetch;
    const read = file => JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
    const write = (file,value) => {
      const target = path.join(root,file);
      fs.mkdirSync(path.dirname(target),{recursive:true});
      fs.writeFileSync(target,JSON.stringify(value));
    };
    try {
      // All real entrypoint sources are copied, while every writable document
      // and every HTTP result belongs to this disposable offline fixture.
      for (const directory of ['scraper','sentry']) fs.cpSync(path.join(repository,directory),path.join(root,directory),{recursive:true});
      fs.mkdirSync(path.join(root,'scripts'));
      for (const file of ['deal-map-review.mjs','deal-map-enrichment.mjs','deal-map-chain-rules.mjs',
        'deal-map-source-addresses.mjs','approval-map-readiness.mjs','discover-vienna-merchants.mjs',
        'automatic-deal-maintenance.mjs','original-social-copy.mjs','automatic-maintenance-review.mjs','refresh-maintenance-evidence.mjs',
        'expiry-fixed-flight.mjs','expiry-instagram-finite-range.mjs','live-deal-duplicates.mjs', 'approved-expiry-evidence.mjs','deal-photo-contract.mjs','generated-deal-photo-contract.mjs',
        'original-deal-photo.mjs','live-deal-edits-lib.mjs','refresh-pending-deal-photo.mjs']) {
        fs.copyFileSync(path.join(repository,'scripts',file),path.join(root,'scripts',file));
      }
      fs.copyFileSync(path.join(repository,'package.json'),path.join(root,'package.json'));
      fs.symlinkSync(path.join(repository,'node_modules'),path.join(root,'node_modules'));
      fs.mkdirSync(path.join(root,'reviews'));
      for (const file of ['restaurant-coupon-documents.json','nordsee-coupon-cards-20261113.json']) {
        fs.copyFileSync(path.join(repository,'reviews',file),path.join(root,'reviews',file));
      }
      Object.assign(process.env,{SENTRY_DISABLED:'1',SLACK_BOT_TOKEN:'offline-only',SLACK_CHANNEL_ID:'C_GENERATED_TEST',
        FREEFINDER_DEAL_IMAGE_PILOT:'1',FREEFINDER_GENERATED_DEAL_PHOTOS:'1',APPROVAL_REQUIRE_MAP:'0',
        APPROVAL_SOURCE_COPY_REVIEW:'0',APPROVAL_COPY_CACHE_ONLY:'1',APPROVAL_MAP_SOURCE_REQUESTS:'0',APPROVAL_MAP_GEOCODE_REQUESTS:'0'});
      for (const name of ['OPENAI_API_KEY','APPROVE_SLACK_CHANNEL_ID','APPROVE_SLACK_MESSAGE_TS','APPROVE_SLACK_REACTION','APPROVE_SLACK_REACTION_USER']) delete process.env[name];
      const now = new Date(),timestamp = Math.floor(+now/1000);
      const ts = timestamp+'.123456',thread = (timestamp-3)+'.123456';
      const until = new Date(+now+30*86400000).toISOString().slice(0,10);
      const literal = until.split('-').reverse().join('.');
      const original = {id:'generated-entry-'+mode,title:'GRATIS Erdbeer-Donut mit Gutschein',
        description:'Ein Erdbeer-Donut gratis gegen Vorlage des Gutscheins. Nur einmal pro Person in Wien.',
        brand:'Café Fixture',category:'essen',type:'gratis',url:'https://cafe-fixture.example/angebote/donut',source:'Merchant fixture',
        address:'Wollzeile 29, 1010 Wien',distance:'Wien',validUntil:until,expires:until,expiresOriginal:'Gültig bis '+literal,
        sourcePublishedAt:new Date(+now-3600000).toISOString(),
        validity:{status:'ok',urlStatus:'HTTP 200',checkedAt:now.toISOString(),finalUrl:'https://cafe-fixture.example/angebote/donut'}};
      const prepared = await prepareGeneratedPhoto(original,{generationKey:photoDigest('generated-entry-'+mode),promptHash:photoDigest('strawberry-ring-donut'),
        visualSubject:'Ein Ring-Donut mit Erdbeerglasur auf einem Teller',model:'gpt-image-offline-test',generatedAt:now.toISOString()},
      await sharp({create:{width:1536,height:1024,channels:3,background:'#b67d6e'}}).png().toBuffer(),now);
      prepared.review.generatedVisualReview = {version:1,model:'gpt-6.2-astra',checkedAt:now.toISOString(),
        imageSha256:prepared.generatedDealImage.sha256,inputHash:prepared.generatedDealImage.inputHash,
        matchesSubject:true,specificEnough:true,noContradictions:true,cropComplete:true,labelReadable:true,notMisleading:true};
      writePreparedOriginalPhoto(root,prepared);
      const draft = prepared.generatedDealImage;
      const queued = {...original,imageApprovalRequired:true,slackTs:ts,slackThreadTs:thread,
        pendingDealImage:{version:3,sourceKind:'generated-owned',kind:'editorial-illustration',generationKey:draft.generationKey,
          draftContextHash:draft.inputHash,visualSubject:draft.visualSubject,key:draft.assetKey,sha256:draft.sha256,
          previewURL:draft.photoUrl,offerId:original.id,sourceURL:original.url,preparedAt:now.toISOString(),
          generatedDealImage:draft,slackMessageTs:ts,sentAt:now.toISOString()}};
      if (productEdited) {
        queued.imageApprovalContextHash = draft.inputHash;
        queued.pipelineLifecycle = {manualDecision:'approved',manualDecisionAt:now.toISOString(),manualDecisionUser:'U_PREVIOUS_CHECK'};
      }
      if (mode === 'targeted') Object.assign(process.env,{APPROVE_SLACK_CHANNEL_ID:'C_GENERATED_TEST',APPROVE_SLACK_MESSAGE_TS:ts});
      const {main} = await import(pathToFileURL(path.join(root,'scraper/slack-approve.js')));
      const {buildSlackMessage} = await import(pathToFileURL(path.join(root,'scraper/slack-notify.js')));
      const message = {ts,thread_ts:thread,user:'BOT',text:buildSlackMessage(queued,1),
        blocks:[{type:'image',image_url:draft.photoUrl,alt_text:'Symbolbild'}]};
      const changedTitle = 'GRATIS Schoko-Donut mit Gutschein';
      const changedDescription = 'Ein Schoko-Donut gratis gegen Vorlage des Gutscheins. Nur einmal pro Person in Wien.';
      assert.equal(dealImageAssetKey({...original,title:changedTitle,description:changedDescription}),draft.assetKey,
        'the product change shares the former broad selector, so the exact generated input guard is essential');
      const editCommand = {ts:(timestamp+1)+'.123456',text:`edit 1 titel: ${changedTitle} | beschreibung: ${changedDescription}`};
      const requests = [];
      globalThis.fetch = async (url,init={}) => {
        const target = new URL(url);
        requests.push(target.hostname+target.pathname);
        if (target.hostname === 'cafe-fixture.example') {
          return new Response(`<main><h1>${productEdited ? changedTitle : original.title}</h1><p>${productEdited ? changedDescription : original.description} Gültig bis ${literal}.</p><p>Wollzeile 29, 1010 Wien</p></main>`,
            {headers:{'content-type':'text/html'}});
        }
        assert.equal(target.hostname,'slack.com','fixture permits only its source and Slack requests');
        if (target.pathname.endsWith('/auth.test')) return Response.json({ok:true,user_id:'BOT'});
        if (target.pathname.endsWith('/conversations.history')) return Response.json({ok:true,messages:[]});
        if (target.pathname.endsWith('/conversations.replies')) return Response.json({ok:true,messages:[message,...productEdited ? [editCommand] : []]});
        if (target.pathname.endsWith('/reactions.get')) return Response.json({ok:true,message:{...message,reactions:[{name:'white_check_mark',users:['U_CURRENT_HUMAN']}]}});
        if (/\/chat\.(?:postMessage|update)$/.test(target.pathname)) return Response.json({ok:true,ts:(timestamp+2)+'.123456'});
        assert.fail('Unexpected fixture request '+target.pathname);
      };
      write('docs/deals.json',{deals:[],totalDeals:0});
      write('docs/deals-pending-all.json',{deals:[queued]});
      await main();
      if (productEdited) {
        assert.equal(read('docs/deals.json').deals.length,0,'a previous product marker cannot approve this changed product');
        const pending = read('docs/deals-pending-all.json').deals;
        assert.equal(pending.length,1);
        assert.equal(pending[0].title,changedTitle);
        assert.equal(pending[0].imageApprovalContextHash,undefined,'old context must be cleared before any new copy validation');
      } else {
        const published = read('docs/deals.json').deals[0];
        assert.ok(published,'the actual approved deal must publish after same-product copy enrichment');
        assert.notEqual(published.title,original.title,'the real approval entrypoint ran its local title enrichment');
        assert.notEqual(published.description,original.description,'the real copy change occurred after the human image context was bound');
        assert.equal(published.prePublicationTitleEdit.originalTitle,original.title);
        assert.equal(published.photoUrl,draft.photoUrl);
        assert.equal(published.approvedDealImage.version,2);
        assert.equal(published.approvedDealImage.draftContextHash,draft.inputHash);
        assert.equal(published.pendingDealImage,undefined);
        assert.equal(published.imageApprovalContextHash,undefined,'internal approval markers never reach the public feed');
        assert.equal(read('docs/deals-pending-all.json').deals.length,0);
        assert.deepEqual((await inspectBoundOriginalPhoto(published,{root})).bytes,prepared.bytes);
      }
      assert.ok(requests.some(value=>value==='slack.com/api/reactions.get'),'publication requires the actual fresh human-reaction read');
      assert.ok(requests.every(value=>!value.includes('openai.com')),'the entrypoint fixture never requests a model');
    } finally {
      globalThis.fetch = previousFetch;
      for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
      Object.assign(process.env,previousEnv);
      fs.rmSync(root,{recursive:true,force:true});
    }
  });
}

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {prepareSlackImageDeals} from '../scraper/slack-notify.js';
import {prepareDealImagePreview} from '../scraper/deal-image-pilot.js';

const root=path.resolve(import.meta.dirname,'..');
const now=new Date('2026-11-27T12:00:00Z');
const base={id:'preflight-coffee',title:'Gratis Kaffee',brand:'Fixture Cafe',category:'kaffee',
  description:'Ein Kaffee gratis.',url:'https://merchant.example/coffee'};

test('only prepared public image cards enter the Slack delivery batch',async()=>{
  const selected=await prepareDealImagePreview(base,{root,now,enabled:true,checkPreview:async()=>true});
  assert.ok(selected.pendingDealImage);
  const unavailable={...base,id:'waiting-publication',imageApprovalRequired:true,imagePreparationState:'waiting-publication'};
  const held={...base,id:'review-held',imageApprovalRequired:true,imagePreparationState:'review-held'};
  const legacy={...base,id:'legacy-no-photo'};
  const visited=[];
  const result=await prepareSlackImageDeals([base,unavailable,held,legacy],{root,now,
    editCard:async deal=>{visited.push(deal.id);return deal;},
    prepareImage:async deal=>deal.id===base.id?selected:deal,
  });
  assert.deepEqual(result.ready.map(deal=>deal.id),[base.id,legacy.id]);
  assert.deepEqual(result.deferred.map(deal=>deal.id),[unavailable.id,held.id]);
  assert.deepEqual(visited,[base.id,unavailable.id,held.id,legacy.id]);
  assert.equal(unavailable.slackTs,undefined);
});

test('all three source lanes prepare images before headers and ordinary checkpoints publish pending assets',()=>{
  const source=fs.readFileSync(path.join(root,'scraper/slack-notify.js'),'utf8');
  const before=source.indexOf('for (const lane of [freshDeals, firecrawlReviewDeals, socialFoodReviewDeals])');
  assert.ok(before>0);
  assert.ok(before<source.indexOf('for (const group of pendingDealGroups(freshDeals))'));
  for(const name of ['daily-digest','pending-deal-edit','approve-deals']) {
    const workflow=fs.readFileSync(path.join(root,'.github/workflows',name+'.yml'),'utf8');
    assert.match(workflow,/FREEFINDER_GENERATED_DEAL_PHOTOS: '1'/);
    assert.match(workflow,/OPENAI_API_KEY:.*secrets.OPENAI_API_KEY/);
    assert.match(workflow,/GH_TOKEN:.*github.token/);
    const checkpoints=workflow.split('\n').filter(line=>line.includes('scripts/commit-generated.mjs'));
    const photoCheckpoint=checkpoints.find(line=>line.includes('reviews/generated-deal-images.json'));
    assert.ok(photoCheckpoint,name+' must save the generation cache');
    assert.ok(photoCheckpoint.includes("'docs/assets/approved-deal-photos/*.jpg'"));
    assert.ok(photoCheckpoint.includes("'reviews/deal-photos/*.json'"));
    assert.ok(photoCheckpoint.includes("'reviews/generated-deal-image-staging/*.jpg'"));
  }
});

test('the generated Slack preview promotes the exact reviewed file after checked copy enrichment',async t=>{
  const os=await import('node:os');
  const {default:sharp}=await import('sharp');
  const {prepareGeneratedPhoto}=await import('./generated-deal-photo-contract.mjs');
  const {writePreparedOriginalPhoto,inspectBoundOriginalPhoto}=await import('./original-deal-photo.mjs');
  const {dealImagePreviewBlock,prepareApprovedDealImage}=await import('../scraper/deal-image-pilot.js');
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'generated-slack-promotion-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const prepared=await prepareGeneratedPhoto(base,{generationKey:'a'.repeat(64),promptHash:'b'.repeat(64),
    visualSubject:'One coffee cup with dark coffee',model:'gpt-image-2.6-sunburst',generatedAt:now.toISOString()},
  await sharp({create:{width:1200,height:800,channels:3,background:'#af7b47'}}).jpeg().toBuffer(),now);
  prepared.review.generatedVisualReview={version:1,model:'gpt-6.2-astra',checkedAt:now.toISOString(),
    imageSha256:prepared.review.sha256,inputHash:prepared.generatedDealImage.inputHash,
    matchesSubject:true,specificEnough:true,noContradictions:true,cropComplete:true,labelReadable:true,notMisleading:true};
  writePreparedOriginalPhoto(folder,prepared);
  const draft=prepared.generatedDealImage;
  const staged={...base,imageApprovalRequired:true,slackTs:'1795770000.01',pipelineLifecycle:{manualDecision:'approved'},
    pendingDealImage:{version:3,sourceKind:'generated-owned',kind:'editorial-illustration',generationKey:draft.generationKey,
      draftContextHash:draft.inputHash,visualSubject:draft.visualSubject,key:draft.assetKey,sha256:draft.sha256,
      previewURL:draft.photoUrl,offerId:base.id,sourceURL:base.url,preparedAt:now.toISOString(),
      generatedDealImage:draft,slackMessageTs:'1795770000.01'}};
  assert.equal(dealImagePreviewBlock(staged,{enabled:true,now}).image_url,draft.photoUrl);
  const enriched={...staged,description:'Eine Tasse Kaffee gratis gegen Vorlage des Gutscheins in Wien.'};
  assert.equal(dealImagePreviewBlock(enriched,{enabled:true,now}),null,'unchecked changes cannot borrow a prior preview');
  const approved={...enriched,imageApprovalContextHash:draft.inputHash};
  const published=await prepareApprovedDealImage(approved,{root:folder,now,enabled:true});
  assert.equal(published.photoUrl,draft.photoUrl);
  assert.equal(published.approvedDealImage?.version,2);
  assert.equal(published.approvedDealImage?.draftContextHash,draft.inputHash);
  assert.deepEqual((await inspectBoundOriginalPhoto(published,{root:folder})).bytes,prepared.bytes);
  assert.equal(dealImagePreviewBlock({...approved,title:'Gratis Döner'},{enabled:true,now}),null,'a changed product cannot retain the coffee approval');
  assert.equal(dealImagePreviewBlock({...approved,slackTs:'different-message'},{enabled:true,now}),null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareDealImagePreview,dealImagePreviewBlock} from '../scraper/deal-image-pilot.js';
import {refreshPendingDealPhoto} from './refresh-pending-deal-photo.mjs';

const root = fileURLToPath(new URL('../',import.meta.url));
const now = new Date('2026-11-27T09:00:00Z');
const original = {id:'photo-refresh',title:'Gratis Essen',brand:'Fixture Lokal',description:'Eine Portion gratis.',
  url:'https://merchant.example/free-meal',category:'essen',type:'gratis',distance:'Wien',order:3};

async function draft() {
  const staged = await prepareDealImagePreview(original,{root,now,enabled:true,checkPreview:async()=>true});
  assert.ok(staged.pendingDealImage);
  return {...staged,slackTs:'1795760400.001',slackThreadTs:'1795760000.001',
    approvedAt:now.toISOString(),pipelineLifecycle:{stage:'manually-approved',manualDecision:'approved',manualDecisionUser:'previous-reviewer'},
    pendingDealImage:{...staged.pendingDealImage,slackMessageTs:'1795760400.001',sentAt:now.toISOString()}};
}

function requests({failUpdate=false,failPost=false,badPhoto=false}={}) {
  const calls = [];
  const request = async (url,options) => {
    if (String(url).startsWith('https://freefinder.at/assets/')) {
      const file = path.join(root,'docs',new URL(url).pathname);
      const bytes = badPhoto ? Buffer.from('wrong-image') : fs.readFileSync(file);
      return new Response(bytes,{headers:{'content-type':'image/jpeg','content-length':String(bytes.length)}});
    }
    const method = new URL(url).pathname.split('/').at(-1);
    const body = JSON.parse(options.body);
    calls.push({method,body});
    if (method === 'chat.update') return Response.json({ok:!failUpdate});
    if (method === 'chat.postMessage') return Response.json({ok:!failPost,ts:'1795760450.002'});
    throw Error('Unexpected request');
  };
  return {calls,request};
}

test('a changed product gets a new photo card and only that new message can carry a fresh approval',async()=>{
  const previous = await draft();
  const edited = {...previous,title:'Gratis Döner'};
  assert.equal(dealImagePreviewBlock(edited,{enabled:true,now}),null);
  const f = requests();
  const result = await refreshPendingDealPhoto(edited,{root,now,request:f.request,token:'offline-token',channel:'offline-channel'});
  assert.equal(result.status,'refreshed');
  assert.deepEqual(f.calls.map(row=>row.method),['chat.update','chat.postMessage']);
  assert.equal(f.calls[0].body.ts,previous.slackTs);
  assert.equal(f.calls[0].body.text.includes('Deal-ID:'),false);
  assert.deepEqual(f.calls[0].body.blocks,[]);
  const posted = f.calls[1].body;
  assert.equal(posted.thread_ts,previous.slackThreadTs);
  assert.match(posted.text,/\*3\. Gratis Döner\*/);
  assert.match(posted.text,/Deal-ID: photo-refresh/);
  assert.equal(posted.blocks.filter(block=>block.type==='image').length,1);
  assert.equal(result.deal.pendingDealImage.key,'kebab');
  assert.equal(posted.blocks.find(block=>block.type==='image').image_url,result.deal.pendingDealImage.previewURL);
  assert.equal(result.deal.pendingDealImage.slackMessageTs,'1795760450.002');
  assert.equal(result.deal.pendingDealImage.supersedesSlackMessageTs,previous.slackTs);
  assert.equal(result.deal.slackTs,'1795760450.002');
  assert.equal(result.deal.slackFormEditTs,result.deal.slackTs);
  assert.equal(result.deal.pipelineLifecycle.manualDecision,'');
  assert.equal(result.deal.pipelineLifecycle.manualDecisionUser,'');
  assert.equal(result.deal.approvedAt,undefined);
  assert.equal(previous.slackTs,'1795760400.001','caller state is not mutated before durable replacement');
  assert.match(posted.client_msg_id,/^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/);
});

test('text, date and location edits that retain the same product keep the exact delivered card',async()=>{
  const previous = await draft();
  const result = await refreshPendingDealPhoto({...previous,title:'Gratis Essen im Lokal',distance:'Andere Adresse',validUntil:'2027-01-01'},
    {root,now,request:async()=>assert.fail('no network required'),token:'offline-token',channel:'offline-channel'});
  assert.equal(result.status,'unchanged');
  assert.equal(result.deal.slackTs,previous.slackTs);
  assert.deepEqual(result.deal.pendingDealImage,previous.pendingDealImage);
});

test('replacement retains the Community card style and clears all old attachment content',async()=>{
  const edited={...await draft(),title:'Gratis Döner',source:'Community',originSource:'community-submission',submissionId:'fixture'};
  const f=requests();
  const result=await refreshPendingDealPhoto(edited,{root,now,request:f.request,token:'offline-token',channel:'offline-channel'});
  assert.equal(result.status,'refreshed');
  assert.deepEqual(f.calls[0].body.attachments,[]);
  const posted=f.calls[1].body;
  assert.equal(posted.channel,'offline-channel');
  assert.match(posted.text,/COMMUNITY-EINSENDUNG/);
  assert.equal(posted.attachments[0].color,'#EAB308');
  assert.equal(posted.attachments[0].blocks.filter(block=>block.type==='image').length,1);
});

test('unavailable or substituted photo bytes cannot supersede the already delivered preview',async()=>{
  const edited = {...await draft(),title:'Gratis Döner'};
  const f = requests({badPhoto:true});
  const result = await refreshPendingDealPhoto(edited,{root,now,request:f.request,token:'offline-token',channel:'offline-channel'});
  assert.equal(result.status,'unavailable');
  assert.equal(result.reason,'preview-unavailable');
  assert.equal(result.deal,edited);
  assert.equal(f.calls.length,0);
});

test('Slack failure leaves the edited deal held and does not reuse any old approval',async()=>{
  const edited = {...await draft(),title:'Gratis Döner'};
  const rejected = requests({failUpdate:true});
  assert.equal((await refreshPendingDealPhoto(edited,{root,now,request:rejected.request,token:'offline-token',channel:'offline-channel'})).reason,'slack-update-failed');
  assert.deepEqual(rejected.calls.map(row=>row.method),['chat.update']);
  const posting = requests({failPost:true});
  const result = await refreshPendingDealPhoto(edited,{root,now,request:posting.request,token:'offline-token',channel:'offline-channel'});
  assert.equal(result.reason,'slack-post-failed');
  assert.equal(result.deal.slackTs,edited.slackTs);
  const retry = requests({failPost:true});
  await refreshPendingDealPhoto(edited,{root,now,request:retry.request,token:'offline-token',channel:'offline-channel'});
  assert.equal(posting.calls[1].body.client_msg_id,retry.calls[1].body.client_msg_id,'retries use the same replacement identity');
});

test('legacy cards and disabled preview refresh use their existing approval path',async()=>{
  const edited = {...await draft(),title:'Gratis Döner'};
  for (const [deal,enabled] of [[edited,false],[{...edited,imageApprovalRequired:false},true],
    [{...edited,approvedDealImage:{status:'locked'}},true],
    [{...edited,pipelineLifecycle:{publishedAt:now.toISOString()}},true]]) {
    const result = await refreshPendingDealPhoto(deal,{root,now,enabled,request:async()=>assert.fail('no request allowed')});
    assert.equal(result.status,'unchanged');
  }
});

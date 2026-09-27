import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import worker from '../referrals-worker/src/index.js';
import { buildLiveFeaturedPick } from './set-live-featured-deal.mjs';
import { normalizeLiveDealEdit, applyLiveDealEditsToBundle } from './live-deal-edits-lib.mjs';

const now = new Date('2026-09-27T10:00:00Z');
const deal = { id:'test', title:'Gratis Kaffee', brand:'Test Cafe', url:'https://example.com/coffee', description:'Test', category:'kaffee', type:'gratis', expires:'2099-10-31', validUntil:'2099-10-31' };
for (const kind of ['daily','weekly']) {
  const pick = await buildLiveFeaturedPick([deal],deal.id,kind,now);
  assert.equal(pick.dealId,deal.id);
  assert.equal(pick.manualPick,true);
  assert.equal(pick.selectionReason,'slack-live-review');
}
await assert.rejects(buildLiveFeaturedPick([],deal.id,'daily',now));
await assert.rejects(buildLiveFeaturedPick([{...deal,expires:'2020-01-01',validUntil:'2020-01-01'}],deal.id,'daily',now));
await assert.rejects(buildLiveFeaturedPick([{...deal,title:'Museum',category:'kultur',brand:'Museum',description:'',type:'event'}],deal.id,'weekly',now));
const edited = normalizeLiveDealEdit({ dealId:deal.id, url:'https://example.com/new', clearFields:['expires','validUntil','description'] });
const result = applyLiveDealEditsToBundle({deals:[deal]}, {edits:[edited]});
assert.equal(result.bundle.deals[0].url,'https://example.com/new');
assert.equal(result.bundle.deals[0].expires,'');
assert.equal(result.bundle.deals[0].validUntil,'');
assert.equal(result.bundle.deals[0].description,'');

const env = { DEAL_REMOVE_LINK_SECRET:'test-secret', GITHUB_WORKFLOW_TOKEN:'test-token', REFERRAL_KV:{get:async()=>null,put:async()=>{}} };
const signed = data => {
  const payload=Buffer.from(JSON.stringify(data)).toString('base64url');
  return {payload,sig:createHmac('sha256',env.DEAL_REMOVE_LINK_SECRET).update(payload).digest('hex')};
};
const originalFetch=globalThis.fetch;
const dispatches=[];
globalThis.fetch=async(url,init)=>{
  if(String(url).includes('api.github.com')) {dispatches.push(JSON.parse(init.body));return new Response(null,{status:204});}
  return Response.json({deals:[deal]});
};
try {
  const params=signed({dealId:deal.id,kind:'daily'});
  const url='https://example.com/api/deals/admin/feature-link';
  const preview=await worker.fetch(new Request(url+'?'+new URLSearchParams(params)),env,{});
  assert.equal(preview.status,200);
  assert.equal(dispatches.length,0,'GET must not change the featured deal');
  const post=await worker.fetch(new Request(url,{method:'POST',body:new URLSearchParams(params)}),env,{});
  assert.equal(post.status,200);
  assert.equal(dispatches.length,1);
  const bad=await worker.fetch(new Request(url+'?'+new URLSearchParams({...params,sig:'bad'})),env,{});
  assert.equal(bad.status,401);
  const editParams=signed({dealId:deal.id});
  const editUrl='https://example.com/api/deals/admin/edit-link';
  const form=await worker.fetch(new Request(editUrl+'?'+new URLSearchParams(editParams)),env,{});
  const html=await form.text();
  if (process.env.REVIEW_FORM_PREVIEW_PATH) fs.writeFileSync(process.env.REVIEW_FORM_PREVIEW_PATH, html);
  assert.ok(html.includes(deal.title));
  assert.ok(!html.includes('name="expires"'));
  assert.ok(!html.includes('name="pubDate"'));
  const invalid=await worker.fetch(new Request(editUrl,{method:'POST',body:new URLSearchParams({...editParams,title:deal.title,brand:deal.brand,url:deal.url,validFrom:'2026-10-31',validUntil:'2026-09-01'})}),env,{});
  assert.equal(invalid.status,400);
  assert.equal(dispatches.length,1,'Invalid edits must not dispatch');
  const removedParams=signed({dealId:deal.id,dealUrl:deal.url,title:deal.title});
  const removePreview=await worker.fetch(new Request('https://example.com/api/deals/admin/remove-link?'+new URLSearchParams(removedParams)),env,{});
  assert.equal(removePreview.status,200);
  assert.equal(dispatches.length,1,'Link previews must not remove deals');
  const valid=await worker.fetch(new Request(editUrl,{method:'POST',body:new URLSearchParams({...editParams,title:deal.title,brand:deal.brand,url:deal.url,category:'kaffee',type:'gratis',validOn:'',validFrom:'',validUntil:'',expiryDisplayText:'',description:''})}),env,{});
  assert.equal(valid.status,200);
  const change=JSON.parse(dispatches.at(-1).inputs.edit_payload);
  assert.ok(change.clearFields.includes('expires'));
  assert.ok(change.clearFields.includes('description'));
} finally { globalThis.fetch=originalFetch; }
console.log('Live review admin checks passed');

import assert from 'node:assert/strict';
import { applyPendingEdit } from './apply-pending-deal-edit.mjs';
const doc = {deals:[{id:'a',validOn:'2026-10-01'},{id:'b',title:'unchanged'}]};
const edit = {dealId:'a',title:'Offer',brand:'Merchant',description:'Full text',distance:'Address',url:'https://example.com',expires:'2026-10-12'};
applyPendingEdit(doc,edit);
assert.equal(doc.deals[0].validOn,undefined);
assert.equal(doc.deals[0].validUntil,'2026-10-12');
assert.equal(doc.deals[0].editedInSlack,true);
assert.equal(doc.deals[1].title,'unchanged');
assert.throws(()=>applyPendingEdit(doc,{...edit,dealId:'absent'}));
const { mergeParsedDealsWithQueue, applySlackEdits } = await import('../scraper/slack-approve.js');
doc.deals[0].slackTs = '123.4';
const merged = mergeParsedDealsWithQueue([{slackTs:'123.4',title:'Old title'}],doc.deals);
assert.equal(merged[0].title,'Offer');
const priorEdit = applySlackEdits(merged,[{ts:'1.0',text:'edit a titel: Old edit'}]);
assert.equal(priorEdit.deals[0].title,'Offer');
console.log('Pending edit isolation tests passed');

const { default: worker } = await import('../referrals-worker/src/index.js');
const { createHmac } = await import('node:crypto');
const env = { DEAL_REMOVE_LINK_SECRET:'test', GITHUB_WORKFLOW_TOKEN:'test' };
const payload = Buffer.from(JSON.stringify({dealId:'a',scope:'pending-edit'})).toString('base64url');
const sig = createHmac('sha256','test').update(payload).digest('hex');
const originalFetch = globalThis.fetch;
const dispatches = [];
globalThis.fetch = async (url, init) => {
  if (String(url).includes('api.github.com')) {dispatches.push(String(url)); return new Response(null,{status:204});}
  return Response.json(doc);
};
try {
  const url = 'https://example.com/api/deals/admin/pending-edit';
  const response = await worker.fetch(new Request(url+'?'+new URLSearchParams({payload,sig})),env,{});
  assert.equal(response.status,200);
  assert.ok((await response.text()).includes('Full text'));
  assert.equal(dispatches.length,0);
  const bad = await worker.fetch(new Request(url+'?'+new URLSearchParams({payload,sig:'bad'})),env,{});
  assert.equal(bad.status,401);
  const save = await worker.fetch(new Request(url,{method:'POST',body:new URLSearchParams({...edit,payload,sig})}),env,{});
  assert.equal(save.status,200);
  assert.equal(dispatches.length,1);
  assert.ok(dispatches[0].includes('pending-deal-edit.yml'));
} finally { globalThis.fetch = originalFetch; }
console.log('Signed form, no-write GET, invalid signature and draft-only dispatch tests passed');

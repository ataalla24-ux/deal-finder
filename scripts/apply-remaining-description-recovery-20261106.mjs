import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {loadLiveDealEditStore,normalizeLiveDealEdit,upsertLiveDealEdit,applyLiveDealEditsToBundle,saveLiveDealEditStore} from './live-deal-edits-lib.mjs';

const evidenceRoot=process.argv[2];
assert(evidenceRoot,'Explicit evidence directory required; no automatic source fetch');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const review=read('reviews/remaining-description-recovery-2026-11-06.json');
const before=read('docs/deals.json'),file='docs/live-deal-edits.json',now=new Date().toISOString();
let store=loadLiveDealEditStore(file);
const evidenceFiles={'fc4g-eg5ndc':'westfield-nordsee.json','joe-omv-xlrh16':'omv-joe.json'};
const receipts=[];
for(const correction of review.edits){
  const deal=before.deals.find(d=>d.id===correction.id);
  assert(deal,'Existing live deal required, never restore a hidden record');
  assert(!deal.description||deal.description===correction.description,'Concurrent description must not be overwritten');
  if(evidenceFiles[deal.id]){
    const source=read(path.join(evidenceRoot,evidenceFiles[deal.id]));
    assert.equal(source.status,200);assert.equal(source.finalUrl,correction.sourceUrl);
    assert(source.checkedAt.startsWith(review.reviewedAt));
    assert(correction.requiredEvidence.every(quote=>source.text.includes(quote)),'Missing source condition');
    receipts.push({id:deal.id,url:source.url,checkedAt:source.checkedAt,sha256:source.sha256});
  }else{
    const pdf=fs.readFileSync(path.join(evidenceRoot,'nordsee-current-coupons.pdf'));
    assert(pdf.subarray(0,5).toString()==='%PDF-','Verified original PDF required');
    const digest=createHash('sha256').update(pdf).digest('hex');
    const proof=read(path.join(evidenceRoot,'nordsee-pdf-proof.json'));
    assert.equal(proof.url,correction.sourceUrl);assert.equal(proof.sha256,digest);
    assert.equal(proof.visuallyReviewed,true);assert.equal(proof.validUntil,'2026-11-30');
    receipts.push({id:deal.id,...proof});
  }
  const patch={dealId:deal.id,description:correction.description,editedBy:'source-reviewed-conditions-2026-11-06'};
  if(correction.title){
    assert(['30 % Rabatt auf OMV-TopWash-Autowäsche',correction.title].includes(deal.title),'Concurrent title changed');
    patch.title=correction.title;
  }
  store=upsertLiveDealEdit(store,normalizeLiveDealEdit(patch,{nowIso:now}),now);
}
const result=applyLiveDealEditsToBundle(before,store,{checkedAt:now,allowRemovals:false,allowManualRemovals:false});
const ids=new Set(review.edits.map(e=>e.id));
assert.deepEqual(result.bundle.deals.map(d=>d.id),before.deals.map(d=>d.id));
assert.deepEqual(result.bundle.deals.filter(d=>!ids.has(d.id)),before.deals.filter(d=>!ids.has(d.id)));
for(const correction of review.edits){
  const original=before.deals.find(d=>d.id===correction.id),after=result.bundle.deals.find(d=>d.id===correction.id);
  for(const [key,value] of Object.entries(original)){
    if(['description','title','liveEditedAt','liveEditedBy','liveEditedFields'].includes(key))continue;
    assert.deepEqual(after[key],value,`Unexpected change: ${original.id}/${key}`);
  }
  assert.equal(after.description,correction.description);assert.equal(after.title,correction.title||original.title);
}
saveLiveDealEditStore(file,store,now);fs.writeFileSync('docs/deals.json',JSON.stringify(result.bundle,null,2)+'\n');
fs.writeFileSync('reviews/remaining-description-recovery-proof-2026-11-06.json',JSON.stringify({checkedAt:now,receipts},null,2)+'\n');
console.log('Three descriptions and one necessary points-eligibility title corrected; other fields and records preserved.');

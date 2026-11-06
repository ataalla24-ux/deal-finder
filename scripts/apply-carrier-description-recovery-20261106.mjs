import fs from 'node:fs';
import assert from 'node:assert/strict';
import {maintenanceEvidenceFor} from './refresh-maintenance-evidence.mjs';
import {loadLiveDealEditStore,normalizeLiveDealEdit,upsertLiveDealEdit,applyLiveDealEditsToBundle,saveLiveDealEditStore} from './live-deal-edits-lib.mjs';

const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const review=read('reviews/carrier-description-recovery-2026-11-06.json'),before=read('docs/deals.json'),now=new Date();
const evidence=maintenanceEvidenceFor(before.deals,read('reviews/maintenance-source-evidence.json'),now),file='docs/live-deal-edits.json';
let store=loadLiveDealEditStore(file);
for(const correction of review.edits){
  const deal=before.deals.find(d=>d.id===correction.id),source=evidence.get(correction.id);
  assert(deal&&source,'Existing live deal with freshly verified source required');
  assert.equal(deal.url,correction.url);
  assert(!deal.description||deal.description===correction.description,'Do not overwrite concurrent description changes');
  assert(correction.requiredEvidence.every(quote=>source.officialText.includes(quote)),'Missing condition evidence');
  store=upsertLiveDealEdit(store,normalizeLiveDealEdit({dealId:deal.id,description:correction.description,editedBy:'source-reviewed-conditions-2026-11-06'},{nowIso:now.toISOString()}),now.toISOString());
}
const result=applyLiveDealEditsToBundle(before,store,{checkedAt:now.toISOString(),allowRemovals:false,allowManualRemovals:false});
const ids=new Set(review.edits.map(e=>e.id));
assert.deepEqual(result.bundle.deals.filter(d=>!ids.has(d.id)),before.deals.filter(d=>!ids.has(d.id)));
for(const correction of review.edits)assert.equal(result.bundle.deals.find(d=>d.id===correction.id).description,correction.description);
saveLiveDealEditStore(file,store,now.toISOString());fs.writeFileSync('docs/deals.json',JSON.stringify(result.bundle,null,2)+'\n');
console.log('Two source-reviewed description-only corrections persisted; all other live deals retained.');

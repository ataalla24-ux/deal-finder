import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectBoundOriginalPhoto} from './original-deal-photo.mjs';

export async function validateOriginalDealPhotos(deals,{root=process.cwd()}={}) {
  const results=[];
  for(const deal of deals.filter(d=>d.photoUrl)) {
    try {await inspectBoundOriginalPhoto(deal,{root});results.push({id:deal.id,status:'verified-file-permission-and-subject'});}
    catch(error){results.push({id:deal.id,status:'invalid',reason:error.code==='ENOENT'?'photo-review-or-file-missing':error.message});}
  }
  return {checked:results.length,errors:results.filter(r=>r.status==='invalid').length,results,
    semanticReview:false,recipientUiTest:false};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const feed=JSON.parse(fs.readFileSync('docs/deals.json'));
  const deals=Array.isArray(feed)?feed:feed.deals;
  if(!Array.isArray(deals))throw Error('Invalid feed');
  const result=await validateOriginalDealPhotos(deals);
  console.log(JSON.stringify(result));
  if(result.errors)process.exitCode=1;
}

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectBoundOriginalPhoto} from './original-deal-photo.mjs';
import {normalizeApprovedDealImage} from './deal-photo-contract.mjs';

function assertLockedPhoto(deal) {
  if (!Object.hasOwn(deal,'approvedDealImage')) return;
  if (!normalizeApprovedDealImage(deal.approvedDealImage,deal.id,deal.photoUrl)) {
    throw Error('locked-photo-binding-invalid');
  }
}

export async function validateOriginalDealPhotos(deals,{root=process.cwd(),previousDeals=[]}={}) {
  const results=[];
  const previousLocks = new Map(previousDeals.filter(deal => deal.approvedDealImage?.status === 'locked')
    .map(deal => [deal.id,deal]));
  for(const deal of deals.filter(d=>d.photoUrl || Object.hasOwn(d,'approvedDealImage') || previousLocks.has(d.id))) {
    try {
      const previous = previousLocks.get(deal.id);
      if (previous && (previous.photoUrl !== deal.photoUrl
        || ['version','status','photoUrl','sha256','assetKey','kind','approvedAt'].some(field =>
          previous.approvedDealImage[field] !== deal.approvedDealImage?.[field]))) {
        throw Error('locked-photo-changed-after-approval');
      }
      assertLockedPhoto(deal);
      const inspected = await inspectBoundOriginalPhoto(deal,{root});
      if (deal.approvedDealImage && (deal.approvedDealImage.sha256 !== inspected.review.sha256
        || deal.approvedDealImage.kind !== (inspected.review.kind || 'merchant-photo'))) {
        throw Error('locked-photo-review-mismatch');
      }
      results.push({id:deal.id,status:'verified-file-permission-and-subject'});
    }
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

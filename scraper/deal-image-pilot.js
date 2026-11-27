import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DEAL_IMAGE_ASSETS,dealImageAssetKey,dealImageSubjectHash} from './deal-image-subject.js';
import {approvedDealPhotoURL,normalizeGeneratedPhotoDraft,generatedPhotoApproval} from '../scripts/deal-photo-contract.mjs';

const baseURL = 'https://freefinder.at/assets/deal-image-pilot/';
const catalogPath = 'docs/assets/deal-image-pilot/catalog.json';
const clean = value => String(value || '').replace(/\s+/g,' ').trim();
const digest = value => createHash('sha256').update(value).digest('hex');
const labelBounds = {left:428,top:320,width:224,height:54};
const read = file => JSON.parse(fs.readFileSync(file,'utf8'));
const legacySubject = deal => digest(JSON.stringify(['pending-owned-photo-v1',
  ...['id','url','title','brand','description','category'].map(field=>clean(deal[field]))]));

export const DEAL_IMAGE_PILOT_ASSETS = DEAL_IMAGE_ASSETS;

function canStageImage(deal, now) {
  if (!deal?.id || !clean(deal.title) || !deal.category || !Number.isFinite(+now)
    || deal.pipelineLifecycle?.manualDecision === 'rejected') return false;
  // Preview selection uses owned files. Source/link requirements belong to the
  // existing offer validator, including community submissions without a URL.
  if (!clean(deal.url)) return true;
  try {
    const url = new URL(deal.url);
    return ['https:','http:'].includes(url.protocol) && !url.username && !url.password && !url.port;
  } catch {return false;}
}

function ownedAsset(root, key) {
  if (!DEAL_IMAGE_ASSETS.some(asset=>asset.key === key)) return null;
  const catalog = read(path.join(root,catalogPath)), row = catalog?.assets?.[key];
  if (catalog.version !== 1 || row?.key !== key || row.kind !== 'editorial-illustration'
    || row.width !== 1080 || row.height !== 400 || row.label !== 'Symbolbild'
    || JSON.stringify(row.labelBounds) !== JSON.stringify(labelBounds)
    || !/^[a-f0-9]{64}$/.test(row.sha256 || '') || row.file !== `${key}-${row.sha256}.jpg`) return null;
  const provenance = read(path.join(root,'docs/assets/blog/photos/sources.json')).photos?.[key];
  if (provenance?.kind !== 'generated-editorial-symbol-photo' || provenance.overlays !== false
    || provenance.sourceSha256 !== row.provenanceSha256 || provenance.inputWidth < 600 || provenance.inputHeight < 400
    || provenance.subject !== DEAL_IMAGE_ASSETS.find(asset=>asset.key === key).subject) return null;
  const source = fs.readFileSync(path.join(root,'docs/assets/blog/photos',`${key}.jpg`));
  const bytes = fs.readFileSync(path.join(root,'docs/assets/deal-image-pilot',row.file));
  if (digest(source) !== row.sourceSha256 || digest(bytes) !== row.sha256) return null;
  return {...row,bytes,previewURL:baseURL+row.file};
}

export function createDealImagePreviewCheck({request=fetch}={}) {
  const cache = new Map();
  return async asset => {
    if (!cache.has(asset.previewURL)) cache.set(asset.previewURL,(async()=>{
      try {
        const response = await request(asset.previewURL,{method:'GET',redirect:'error',signal:AbortSignal.timeout(5000)});
        const length = response.headers.get('content-length');
        if (!response.ok || !/^image\/jpeg\b/i.test(response.headers.get('content-type') || '')
          || !response.body || asset.bytes.length > 1_500_000
          || length !== null && Number(length) !== asset.bytes.length) {
          await response.body?.cancel();
          return false;
        }
        const reader = response.body.getReader();
        const chunks = [];
        let size = 0;
        while (true) {
          const {value,done} = await reader.read();
          if (done) break;
          size += value.length;
          if (size > asset.bytes.length || size > 1_500_000) {
            await reader.cancel();
            return false;
          }
          chunks.push(value);
        }
        return size === asset.bytes.length && digest(Buffer.concat(chunks)) === asset.sha256;
      } catch {return false;}
    })());
    return cache.get(asset.previewURL);
  };
}

function approvedGeneratedDraft(deal, row, now = new Date()) {
  const draft = normalizeGeneratedPhotoDraft(row?.generatedDealImage, deal);
  if (!draft || row.generationKey !== draft.generationKey || row.draftContextHash !== draft.inputHash
    || row.visualSubject !== draft.visualSubject || row.key !== draft.assetKey
    || row.sha256 !== draft.sha256 || row.previewURL !== draft.photoUrl
    || row.offerId !== deal.id || row.sourceURL !== deal.url) return null;
  const allowCopyEnrichment = deal.imageApprovalContextHash === draft.inputHash
    && deal.pipelineLifecycle?.manualDecision === 'approved'
    && Boolean(deal.slackTs) && row.slackMessageTs === deal.slackTs;
  try {return generatedPhotoApproval(deal, draft, now.toISOString(), {allowCopyEnrichment});}
  catch {return null;}
}

function matchesPreview(deal, row) {
  if (row?.version === 3 && row.sourceKind === 'generated-owned') return Boolean(approvedGeneratedDraft(deal,row));
  if (![1,2].includes(row?.version) || row.offerId !== deal.id || row.sourceURL !== deal.url
    || !DEAL_IMAGE_ASSETS.some(asset=>asset.key === row.key) || !/^[a-f0-9]{64}$/.test(row.sha256 || '')) return false;
  const expectedSubject = row.version === 1 ? legacySubject(deal) : dealImageSubjectHash(deal);
  if (row.subjectHash !== expectedSubject || row.key !== dealImageAssetKey(deal)) return false;
  if (row.sourceKind === 'bound-photo') return approvedDealPhotoURL(row.previewURL,deal.id) === row.previewURL;
  return row.previewURL === `${baseURL}${row.key}-${row.sha256}.jpg`;
}

export async function prepareDealImagePreview(deal,{root=process.cwd(),now=new Date(),enabled=process.env.FREEFINDER_DEAL_IMAGE_PILOT === '1',checkPreview}={}) {
  // A delivered preview is a human review input. Re-running discovery cannot
  // substitute another photograph underneath that Slack message.
  if (deal.slackTs || deal.pendingDealImage?.slackMessageTs || deal.approvedDealImage?.status === 'locked') return deal;
  const {pendingDealImage: old,...base} = deal;
  const cleared = Object.hasOwn(deal,'pendingDealImage') ? base : deal;
  if (!enabled) return cleared;
  if (process.env.FREEFINDER_GENERATED_DEAL_PHOTOS === '1') {
    if (!canStageImage(cleared,now)) return {...cleared,imageApprovalRequired:true,imagePreparationState:'review-held'};
    const {prepareGeneratedDealImagePreview} = await import('./generated-deal-images.js');
    return prepareGeneratedDealImagePreview(cleared,{root,now,checkPreview});
  }
  const withoutPreview = {...cleared,imageApprovalRequired:true};
  if (!canStageImage(withoutPreview,now)) return withoutPreview;
  if ([...(deal.slackEditedFields || []),...(deal.liveEditedFields || [])].includes('photoUrl') && !deal.photoUrl) return withoutPreview;
  try {
    const key = dealImageAssetKey(withoutPreview);
    let asset;
    if (withoutPreview.photoUrl) {
      const {readBoundPhotoSnapshot} = await import('../scripts/original-deal-photo.mjs');
      const bound = readBoundPhotoSnapshot(withoutPreview,{root});
      asset = {key,sha256:bound.review.sha256,previewURL:withoutPreview.photoUrl,bytes:bound.bytes,
        sourceKind:'bound-photo',kind:bound.review.kind || 'merchant-photo'};
    } else {
      asset = ownedAsset(root,key);
      if (asset) asset = {...asset,sourceKind:'owned-catalog',kind:'editorial-illustration'};
    }
    if (!asset || !checkPreview || !await checkPreview(asset)) return withoutPreview;
    return {...withoutPreview,pendingDealImage:{version:2,key,sha256:asset.sha256,previewURL:asset.previewURL,
      sourceKind:asset.sourceKind,kind:asset.kind,offerId:deal.id,sourceURL:deal.url,
      subjectHash:dealImageSubjectHash(deal,key),preparedAt:now.toISOString()}};
  } catch {return withoutPreview;}
}

export function dealImagePreviewBlock(deal,{enabled=process.env.FREEFINDER_DEAL_IMAGE_PILOT === '1',now=new Date()}={}) {
  const row = deal?.pendingDealImage;
  const preparedAt = Date.parse(row?.preparedAt);
  if (!enabled || !canStageImage(deal,now) || !Number.isFinite(preparedAt) || preparedAt > +now
    || !matchesPreview(deal,row)) return null;
  const kind = row.kind === 'merchant-photo' ? 'Angebotsfoto' : 'Symbolbild';
  return {type:'image',image_url:row.previewURL,alt_text:`${kind} zum Angebot: ${clean(deal.title)}`};
}

export function markDealImagePreviewSent(deal, messageTs, now = new Date()) {
  if (dealImagePreviewBlock(deal,{now})) deal.pendingDealImage = {...deal.pendingDealImage,
    slackMessageTs:messageTs,sentAt:now.toISOString()};
}

export async function prepareApprovedDealImage(deal,{root=process.cwd(),now=new Date(),enabled=process.env.FREEFINDER_DEAL_IMAGE_PILOT === '1'}={}) {
  const {pendingDealImage: staged,...output} = deal;
  if (!staged) return Object.hasOwn(deal,'pendingDealImage') ? output : deal;
  const stagedAt = Date.parse(staged.preparedAt);
  if (!enabled || !canStageImage(deal,now) || deal.pipelineLifecycle?.manualDecision !== 'approved'
    || !Number.isFinite(stagedAt) || stagedAt > +now || staged.slackMessageTs !== deal.slackTs
    || !staged.slackMessageTs || !dealImagePreviewBlock(deal,{enabled,now})) return output;
  try {
    const approvedAt = now.toISOString();
    const lock = (photoUrl,kind) => ({version:1,status:'locked',photoUrl,sha256:staged.sha256,
      assetKey:staged.key,kind,approvedAt});
    if (['bound-photo','generated-owned'].includes(staged.sourceKind)) {
      const {readBoundPhotoSnapshot} = await import('../scripts/original-deal-photo.mjs');
      const generatedLock = staged.sourceKind === 'generated-owned' ? approvedGeneratedDraft(deal,staged,now) : null;
      if (staged.sourceKind === 'generated-owned' && !generatedLock) return output;
      const photoDeal = generatedLock ? {...output,photoUrl:staged.previewURL,approvedDealImage:generatedLock} : output;
      const bound = readBoundPhotoSnapshot(photoDeal,{root});
      if (bound.review.sha256 !== staged.sha256 || photoDeal.photoUrl !== staged.previewURL) return output;
      const approvedDealImage = generatedLock || lock(photoDeal.photoUrl,bound.review.kind || 'merchant-photo');
      const lockedDeal = {...photoDeal,approvedDealImage};
      const {photoSubjectHash} = await import('../scripts/deal-photo-contract.mjs');
      const {writePreparedOriginalPhoto} = await import('../scripts/original-deal-photo.mjs');
      const {loadLiveDealEditStore,saveLiveDealEditStore,upsertLiveDealEdit} = await import('../scripts/live-deal-edits-lib.mjs');
      const editsPath = path.join(root,'docs/live-deal-edits.json');
      const store = loadLiveDealEditStore(editsPath);
      const existing = store.edits.find(edit=>edit.dealId === deal.id);
      if (existing?.hidden || existing?.restoreDeal || existing && Object.hasOwn(existing,'photoUrl') && existing.photoUrl !== photoDeal.photoUrl) return output;
      const subjectHash = photoSubjectHash(lockedDeal);
      writePreparedOriginalPhoto(root,{bytes:bound.bytes,review:{...bound.review,subjectHash}});
      saveLiveDealEditStore(editsPath,upsertLiveDealEdit(store,{...existing,dealId:deal.id,photoUrl:photoDeal.photoUrl,
        photoSubjectHash:subjectHash,approvedDealImage,editedBy:'FreeFinder image approval'},approvedAt),approvedAt);
      return lockedDeal;
    }
    const asset = ownedAsset(root,staged.key);
    if (!asset || asset.sha256 !== staged.sha256) return output;
    const {loadLiveDealEditStore,saveLiveDealEditStore,upsertLiveDealEdit} = await import('../scripts/live-deal-edits-lib.mjs');
    const editsPath = path.join(root,'docs/live-deal-edits.json');
    const store = loadLiveDealEditStore(editsPath);
    const existing = store.edits.find(edit=>edit.dealId === deal.id);
    if (existing?.hidden || existing?.restoreDeal || existing && Object.hasOwn(existing,'photoUrl')) return output;
    const {prepareOriginalPhoto,writePreparedOriginalPhoto} = await import('../scripts/original-deal-photo.mjs');
    const photoUrl = `https://freefinder.at/assets/approved-deal-photos/${digest(String(deal.id)).slice(0,16)}-${asset.sha256}.jpg`;
    const approvedDealImage = lock(photoUrl,'editorial-illustration');
    const prepared = await prepareOriginalPhoto({...output,photoUrl,approvedDealImage},{
      dealId:deal.id,sourceURL:asset.previewURL,rights:'owned-original',
      rightsEvidence:`Owned FreeFinder motif, docs/assets/blog/photos/sources.json#${asset.key} (${asset.provenanceSha256}); exact normalized preview ${asset.sha256}.`,
      reviewedBy:'FreeFinder image approval',kind:'editorial-illustration',
      showsActualProduct:false,showsIllustratedProduct:true,matchesOffer:true,cropChecked:true,
    },asset.bytes,now,{reuseNormalizedBytes:true});
    if (digest(prepared.bytes) !== staged.sha256 || prepared.review.photoUrl !== photoUrl) return output;
    prepared.review.renderedDisclosure = {label:'Symbolbild',assetKey:asset.key,imageSha256:asset.sha256,bounds:asset.labelBounds};
    writePreparedOriginalPhoto(root,prepared);
    saveLiveDealEditStore(editsPath,upsertLiveDealEdit(store,{
      ...existing,dealId:deal.id,photoUrl,photoSubjectHash:prepared.review.subjectHash,approvedDealImage,
      editedBy:'FreeFinder image approval',
    },now.toISOString()),now.toISOString());
    return {...output,photoUrl,approvedDealImage};
  } catch {return output;}
}

import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const baseURL = 'https://freefinder.at/assets/deal-image-pilot/';
const catalogPath = 'docs/assets/deal-image-pilot/catalog.json';
const clean = value => String(value || '').replace(/\s+/g,' ').trim();
const digest = value => createHash('sha256').update(value).digest('hex');
const normalized = value => clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const oneDay = 86400000;
const labelBounds = {left:428,top:320,width:224,height:54};
const read = file => JSON.parse(fs.readFileSync(file,'utf8'));
const subject = deal => digest(JSON.stringify(['pending-owned-photo-v1',
  ...['id','url','title','brand','description','category'].map(field=>clean(deal[field]))]));

// These labels describe the actual owned motifs, not inferred merchant dishes.
// Unknown variants keep the existing artwork selected by the app.
export const DEAL_IMAGE_PILOT_ASSETS = [
  {key:'coffee',subject:'Tasse Kaffee im Café'},
  {key:'pizza',subject:'Pizza Margherita'},
  {key:'double-smashburger',subject:'Doppel-Smashburger'},
];

function assetKey(deal) {
  const title = normalized(deal.title), text = normalized(`${deal.title} ${deal.description}`);
  const coffeeOffer = /\b(?:gratis|kostenlos\w*)\s+kaffee\b|\bkaffee\s*(?:fur|um|nur|:)?\s*(?:\d+(?:[,.]\d+)?\s*(?:€|eur\b|euro\b)|(?:gratis|kostenlos\w*)\b|1\s*\+\s*1)/.test(title);
  if (coffeeOffer && !/\b(?:eis|eiskaffee|cold|latte|cappuccino|espresso|melange|tee|matcha|croissant|buttercroissant|donut|krapfen|kuchen|torte|toast|menu|combo|bundle)\b/.test(text))
    return 'coffee';
  if (/\bpizza margherita\b/.test(title) && !/\b(?:salami|prosciutto|schinken|thunfisch|vegan\w*|pepperoni|diavola|calzone|funghi)\b/.test(text))
    return 'pizza';
  if (/\bdoppel[- ]smashburger\b/.test(title) && /\b(?:2x|zwei)\b.*\b(?:beef|rind)\b/.test(text)
    && !/\b(?:chicken|huhn|hahnchen|vegan\w*|vegetar\w*|plant\w*)\b/.test(text)) return 'double-smashburger';
  return '';
}

function currentOffer(deal, now) {
  if (!deal?.id || deal.category !== 'essen' && deal.category !== 'kaffee' || deal.photoUrl
    || deal.submissionId || deal.originSource === 'community-submission'
    || deal.approvalBlock || deal.metaGraphBlockingReason || deal.pipelineLifecycle?.manualDecision === 'rejected'
    || !['ok','warning'].includes(deal.validity?.status) || deal.validity?.urlStatus !== 'HTTP 200'
    || !Number.isFinite(+now)) return false;
  if (!/(?:gratis|kostenlos|rabatt|gutschein|coupon|\d\s*[+%€]|\d+[,.]\d+\s*(?:euro|eur)\b)/i.test(deal.title || '')) return false;
  if ([...(deal.slackEditedFields || []),...(deal.liveEditedFields || [])].includes('photoUrl')) return false;
  const checked = Date.parse(deal.validity.checkedAt);
  if (!Number.isFinite(checked) || checked > +now || +now - checked > oneDay) return false;
  let url;
  try {url = new URL(deal.url);} catch {return false;}
  if (url.protocol !== 'https:' || url.username || url.password || url.port
    || deal.validity.finalUrl && deal.validity.finalUrl !== deal.url) return false;
  const ends = [deal.validUntil,deal.validOn].filter(Boolean);
  const today = new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Vienna'}).format(now);
  if (ends.some(value=> {
    const day=String(value).slice(0,10);
    return !/^20\d{2}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/.test(value)
      || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0,10)!==day || day < today;
  })) return false;
  if (deal.expires && Number.isFinite(Date.parse(deal.expires)) && Date.parse(deal.expires) <= +now) return false;
  const published = Date.parse(deal.sourcePublishedAt || deal.postPublishedAt || deal.pubDate);
  return ends.length > 0 || Number.isFinite(published) && published <= +now && +now-published <= 7*oneDay;
}

function ownedAsset(root, key) {
  if (!DEAL_IMAGE_PILOT_ASSETS.some(asset=>asset.key === key)) return null;
  const catalog = read(path.join(root,catalogPath)), row = catalog?.assets?.[key];
  if (catalog.version !== 1 || row?.key !== key || row.kind !== 'editorial-illustration'
    || row.width !== 1080 || row.height !== 400 || row.label !== 'Symbolbild'
    || JSON.stringify(row.labelBounds) !== JSON.stringify(labelBounds)
    || !/^[a-f0-9]{64}$/.test(row.sha256 || '') || row.file !== `${key}-${row.sha256}.jpg`) return null;
  const provenance = read(path.join(root,'docs/assets/blog/photos/sources.json')).photos?.[key];
  if (provenance?.kind !== 'generated-editorial-symbol-photo' || provenance.overlays !== false
    || provenance.sourceSha256 !== row.provenanceSha256
    || provenance.subject !== DEAL_IMAGE_PILOT_ASSETS.find(asset=>asset.key === key).subject) return null;
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
        const response = await request(asset.previewURL,{method:'HEAD',redirect:'error',signal:AbortSignal.timeout(5000)});
        return response.ok && /^image\/jpeg\b/i.test(response.headers.get('content-type') || '')
          && Number(response.headers.get('content-length')) === asset.bytes.length;
      } catch {return false;}
    })());
    return cache.get(asset.previewURL);
  };
}

export async function prepareDealImagePreview(deal,{root=process.cwd(),now=new Date(),enabled=process.env.FREEFINDER_DEAL_IMAGE_PILOT === '1',checkPreview}={}) {
  const {pendingDealImage: old,...base} = deal;
  const withoutPreview = Object.hasOwn(deal,'pendingDealImage') ? base : deal;
  if (!enabled || !currentOffer(withoutPreview,now) || deal.slackTs) return withoutPreview;
  try {
    const asset = ownedAsset(root,assetKey(withoutPreview));
    if (!asset || !checkPreview || !await checkPreview(asset)) return withoutPreview;
    return {...withoutPreview,pendingDealImage:{version:1,key:asset.key,sha256:asset.sha256,previewURL:asset.previewURL,
      offerId:deal.id,sourceURL:deal.url,subjectHash:subject(deal),preparedAt:now.toISOString()}};
  } catch {return withoutPreview;}
}

export function dealImagePreviewBlock(deal,{enabled=process.env.FREEFINDER_DEAL_IMAGE_PILOT === '1',now=new Date()}={}) {
  const row = deal?.pendingDealImage;
  const preparedAt = Date.parse(row?.preparedAt);
  if (!enabled || !currentOffer(deal,now) || !Number.isFinite(preparedAt) || preparedAt > +now || +now-preparedAt > oneDay
    || row?.version !== 1 || row.offerId !== deal.id || row.sourceURL !== deal.url || row.subjectHash !== subject(deal)
    || !DEAL_IMAGE_PILOT_ASSETS.some(asset=>asset.key === row.key)
    || !/^[a-f0-9]{64}$/.test(row.sha256 || '') || row.previewURL !== `${baseURL}${row.key}-${row.sha256}.jpg`) return null;
  return {type:'image',image_url:row.previewURL,alt_text:`Symbolbild zum Angebot: ${clean(deal.title)}`};
}

export function markDealImagePreviewSent(deal, messageTs, now = new Date()) {
  if (dealImagePreviewBlock(deal,{now})) deal.pendingDealImage = {...deal.pendingDealImage,
    slackMessageTs:messageTs,sentAt:now.toISOString()};
}

export async function prepareApprovedDealImage(deal,{root=process.cwd(),now=new Date(),enabled=process.env.FREEFINDER_DEAL_IMAGE_PILOT === '1'}={}) {
  const {pendingDealImage: staged,...output} = deal;
  if (!staged) return Object.hasOwn(deal,'pendingDealImage') ? output : deal;
  const stagedAt = Date.parse(staged.preparedAt);
  if (!enabled || !currentOffer(deal,now) || deal.pipelineLifecycle?.manualDecision !== 'approved'
    || !Number.isFinite(stagedAt) || stagedAt > +now || +now-stagedAt > oneDay
    || staged.slackMessageTs !== deal.slackTs || !staged.slackMessageTs || !dealImagePreviewBlock(deal,{enabled,now})
    || staged.key !== assetKey(deal)) return output;
  try {
    const asset = ownedAsset(root,staged.key);
    if (!asset || asset.sha256 !== staged.sha256) return output;
    const {loadLiveDealEditStore,saveLiveDealEditStore,upsertLiveDealEdit} = await import('../scripts/live-deal-edits-lib.mjs');
    const editsPath = path.join(root,'docs/live-deal-edits.json');
    const store = loadLiveDealEditStore(editsPath);
    const existing = store.edits.find(edit=>edit.dealId === deal.id);
    if (existing?.hidden || existing?.restoreDeal || existing && Object.hasOwn(existing,'photoUrl')) return output;
    const {prepareOriginalPhoto,writePreparedOriginalPhoto} = await import('../scripts/original-deal-photo.mjs');
    const prepared = await prepareOriginalPhoto(output,{
      dealId:deal.id,sourceURL:asset.previewURL,rights:'owned-original',
      rightsEvidence:`Owned FreeFinder motif, docs/assets/blog/photos/sources.json#${asset.key} (${asset.provenanceSha256}); exact normalized preview ${asset.sha256}.`,
      reviewedBy:'FreeFinder owned image pilot',kind:'editorial-illustration',
      showsActualProduct:false,showsIllustratedProduct:true,matchesOffer:true,cropChecked:true,
    },asset.bytes,now,{reuseNormalizedBytes:true});
    if (digest(prepared.bytes) !== staged.sha256) return output;
    prepared.review.renderedDisclosure = {label:'Symbolbild',assetKey:asset.key,imageSha256:asset.sha256,bounds:asset.labelBounds};
    writePreparedOriginalPhoto(root,prepared);
    saveLiveDealEditStore(editsPath,upsertLiveDealEdit(store,{
      ...existing,dealId:deal.id,photoUrl:prepared.review.photoUrl,photoSubjectHash:prepared.review.subjectHash,
      editedBy:'FreeFinder owned image pilot',
    },now.toISOString()),now.toISOString());
    return {...output,photoUrl:prepared.review.photoUrl};
  } catch {return output;}
}

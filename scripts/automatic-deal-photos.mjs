import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {freeCreditOpenAiFetch,isAstraEnrichmentActive,modelForTask} from '../scraper/ai-credit-budget.js';
import {protectedFields} from './automatic-deal-maintenance.mjs';
import {disclosedPhotoDescription,photoDigest} from './deal-photo-contract.mjs';
import {dealArrayFromBundle,loadLiveDealEditStore,readJson,saveLiveDealEditStore,upsertLiveDealEdit,writeJson} from './live-deal-edits-lib.mjs';
import {reviewOriginalPhotoAsset} from './native-artwork-review.mjs';
import {prepareOriginalPhoto,writePreparedOriginalPhoto} from './original-deal-photo.mjs';

const library = 'docs/assets/blog/photos';
const reviewedBy = 'FreeFinder editorial artwork rules';
const viennaDay = new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Vienna'});
const exactDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
const words = value => String(value || '').normalize('NFKC').toLocaleLowerCase('de-AT')
  .replace(/[^\p{L}\p{N}]+/gu,' ').trim();

const seasonalLatte = {
  brand:'OMV VIVA', category:'kaffee',
  url:'https://presse.ikp.at/news-wintergenuss-bei-omv-viva-drei-neue-kaffee-kreationen-fuer-die-kalte-jahreszeit?id=251130&menueid=33632&l=deutsch',
  validUntil:'2027-01-31',
};

// Each rule records one source and offer variant, plus the previously examined
// full image and card crop. A provenance entry alone does not activate a photo.
const artwork = [
  {key:'tuna-wrap',subject:'Tortilla-Wrap mit Thunfisch',product:'thunfisch wrap',brand:'NORDSEE',category:'essen',
    url:'https://www.drei.at/de/dreiplus/ersparnisse/nordsee/',validUntil:'2027-01-03',
    title:/^drei kunden 1 1 thunfisch wrap gratis$/,description:/\bthunfisch wraps? zum preis von einem\b/,
    jpegSha256:'9a04d9526ee43300d08c7c9b1d2f10f674ea96210eb435ad600ded4d2a9f4dde'},
  {key:'double-smashburger',subject:'Doppel-Smashburger',product:'doppel smashburger',brand:'ABBY Restaurant',category:'essen',
    url:'https://www.instagram.com/reel/DfS8EP4oW02/',validUntil:'2026-12-31',
    title:/^doppel smashburger für 9 90(?: euro| eur)?$/,description:/\bdoppel smashburger\b.*\b2x saftiges beef\b/,
    jpegSha256:'e983c8bf0ddec1b48159107fa58f00a121fa9357a83c3bf9a97448b5016f5bab'},
  {...seasonalLatte,key:'cherry-latte',subject:'Kirsch-Latte mit Sahne',product:'cherry cream latte',
    title:/^gratis cherry cream latte mit jö$/,description:/^cherry cream latte mit der jö app\b/,
    jpegSha256:'ff1d849a4117bc1b632b68da237c878ce9dc705891519bf8e3dbb7fe8be93533'},
  {...seasonalLatte,key:'caramel-latte',subject:'Karamell-Latte',product:'double caramel latte',
    title:/^gratis double caramel latte mit jö$/,description:/^double caramel latte mit der jö app\b/,
    jpegSha256:'26e0df5e364a209e1e632649f36af7c84fbbac0a14d23280518221cc54ac392d'},
  {...seasonalLatte,key:'ube-coconut-latte',subject:'Ube-Kokos-Latte',product:'ube coconut latte',
    title:/^gratis ube coconut latte mit jö$/,description:/^ube coconut latte mit der jö app\b/,
    jpegSha256:'ffa0ff3fb6220591d7c1a54a113d4d2c2fcc9721a7537c5fb3fc2bbae6d430c2'},
];

function matchesArtwork(deal, entry, today) {
  if (!deal.id || deal.photoUrl || deal.url !== entry.url || deal.category !== entry.category
    || words(deal.brand) !== words(entry.brand) || deal.validUntil !== entry.validUntil
    || deal.validUntil < today || deal.dateConfidence !== 'high' || !['end','range'].includes(deal.expiryKind)
    || (deal.validFrom && (!exactDay(deal.validFrom) || deal.validFrom > today))) return false;
  const title = words(deal.title), description = words(deal.description);
  if (!entry.title.test(title) || !entry.description.test(description)) return false;
  return !artwork.some(other => other.key !== entry.key && other.url === entry.url
    && ` ${description} `.includes(` ${other.product} `));
}

function prepareCandidate(root, deal, entry, manifest, now) {
  const provenance = manifest?.photos?.[entry.key];
  if (provenance?.kind !== 'generated-editorial-symbol-photo' || provenance.subject !== entry.subject
    || provenance.overlays !== false || !/^[a-f0-9]{64}$/.test(provenance.sourceSha256 || '')) {
    throw Error('missing-editorial-provenance');
  }
  const file = path.join(root,library,`${entry.key}.jpg`);
  if (fs.statSync(file).size > 1_500_000) throw Error('editorial-image-size');
  const bytes = fs.readFileSync(file);
  if (photoDigest(bytes) !== entry.jpegSha256) throw Error('editorial-image-digest-mismatch');
  return prepareOriginalPhoto(deal,{
    dealId:deal.id,sourceURL:`https://freefinder.at/assets/blog/photos/${entry.key}.jpg`,rights:'owned-original',
    rightsEvidence:`FreeFinder generated editorial library, ${library}/sources.json#${entry.key} (${provenance.sourceSha256}).`,
    reviewedBy,kind:'editorial-illustration',showsActualProduct:false,showsIllustratedProduct:true,matchesOffer:true,cropChecked:true,
  },bytes,now);
}

export async function maintainDealPhotos({root=process.cwd(),now=new Date(),apply=false,request=freeCreditOpenAiFetch,
  requireVision=isAstraEnrichmentActive(),allowNewVision=Boolean(process.env.OPENAI_API_KEY)}={}) {
  const today = viennaDay.format(now);
  const feedPath = path.join(root,'docs/deals.json');
  const feed = readJson(feedPath), deals = dealArrayFromBundle(feed);
  if (!deals) throw Error('Invalid public feed');
  const editsPath = path.join(root,'docs/live-deal-edits.json');
  let store = loadLiveDealEditStore(editsPath);
  const edits = new Map(store.edits.map(edit => [edit.dealId,edit]));
  const manifest = readJson(path.join(root,library,'sources.json'));
  const cachePath = path.join(root,'reviews/server-photo-audit-cache.json');
  const beforeCache = requireVision ? readJson(cachePath,{version:1,entries:{}}) : null;
  const cache = requireVision ? structuredClone(beforeCache) : null;
  const candidates = [], updated = new Map();
  let modelCalls = 0, deferred = false;
  const boundedRequest = (...args) => {modelCalls++;return request(...args);};
  for (const entry of artwork) {
    const matching = deals.filter(deal => {
      const edit = edits.get(deal.id);
      return matchesArtwork(deal,entry,today) && !edit?.hidden && !edit?.manualRemovalApproved
        && !edit?.restoreDeal && !(edit && Object.hasOwn(edit,'photoUrl'));
    });
    if (matching.length !== 1) continue;
    const [deal] = matching;
    const result = {id:deal.id,artwork:entry.key};
    candidates.push(result);
    const description = disclosedPhotoDescription(deal.description);
    const addDisclosure = description !== deal.description;
    if (addDisclosure && protectedFields(deal,store.edits).has('description')) {
      result.status = 'protected-description-needs-symbolic-label';continue;
    }
    const disclosedDeal = addDisclosure ? {...deal,description} : deal;
    let prepared;
    try {prepared = await prepareCandidate(root,disclosedDeal,entry,manifest,now);}
    catch {result.status = 'artwork-integrity-deferred';continue;}
    if (requireVision) {
      let verdict;
      try {
        verdict = await reviewOriginalPhotoAsset(disclosedDeal,prepared,{cache:cache.entries,now,request:boundedRequest,
          allowNew:() => apply && allowNewVision && modelCalls < 2 && !deferred});
      } catch {deferred = true;result.status = 'visual-review-deferred';continue;}
      if (verdict.status !== 'visual-match') {result.status = verdict.status;continue;}
      prepared.review.visualValidation = {model:modelForTask('vision'),status:verdict.status,checkedAt:verdict.checkedAt};
    }
    result.status = 'eligible';
    if (!apply || updated.size >= 4) continue;
    writePreparedOriginalPhoto(root,prepared);
    const {photoUrl,subjectHash} = prepared.review, existing = edits.get(deal.id);
    store = upsertLiveDealEdit(store,{editedBy:reviewedBy,...existing,dealId:deal.id,photoUrl,photoSubjectHash:subjectHash,
      ...(addDisclosure?{photoEditorialDisclosure:true}:{})},now.toISOString());
    updated.set(deal.id,{...disclosedDeal,photoUrl});
    result.status = 'prepared';
  }
  if (updated.size) {
    const nextDeals = deals.map(deal => updated.get(deal.id) || deal);
    saveLiveDealEditStore(editsPath,store,now.toISOString());
    writeJson(feedPath,Array.isArray(feed) ? nextDeals : {...feed,deals:nextDeals});
  }
  if (apply && requireVision && JSON.stringify(cache) !== JSON.stringify(beforeCache)) writeJson(cachePath,cache);
  return {mode:apply?'prepared-not-published':'check-only',modelCalls,requireVision,
    model:requireVision?modelForTask('vision'):null,prepared:updated.size,candidates};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flags = process.argv.slice(2);
  if (flags.some(flag => flag !== '--apply')) throw Error('Usage: node scripts/automatic-deal-photos.mjs [--apply]');
  const report = await maintainDealPhotos({apply:flags.includes('--apply')});
  console.log(JSON.stringify(report,null,2));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `Symbolbilder vorbereitet: ${report.prepared}; visuelle Modellprüfungen angefordert: ${report.modelCalls}${report.model?` (${report.model})`:''}.\n`);
}

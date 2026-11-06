import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { photoDigest, photoSubjectHash } from './deal-photo-contract.mjs';
import { normalizeOriginalPhoto, validatePhotoPermission } from './original-deal-photo.mjs';
import { dealArrayFromBundle, loadLiveDealEditStore, saveLiveDealEditStore, upsertLiveDealEdit } from './live-deal-edits-lib.mjs';

// Offline editorial import only. It never fetches a social image or publishes a pending deal.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [requestPath, mode] = process.argv.slice(2);
if (!requestPath || !['--check', '--apply', undefined].includes(mode)) throw new Error('Usage: node scripts/prepare-deal-photo.mjs review.json [--check|--apply]');
const request = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
validatePhotoPermission(request);
if (typeof request.file !== 'string' || !request.file.trim()) throw new Error('Missing file');
const feed = dealArrayFromBundle(JSON.parse(fs.readFileSync(path.join(root, 'docs/deals.json'))));
const deal = feed?.find(item => item.id === request.dealId);
if (!deal) throw new Error('Only an already approved live deal can receive a photograph');
const sourceFile = path.resolve(path.dirname(requestPath), request.file);
if (fs.statSync(sourceFile).size > 1_500_000) throw new Error('JPEG required, at most 1.5 MB');
const sourceBytes = fs.readFileSync(sourceFile);
const {bytes,card,size,crop} = await normalizeOriginalPhoto(sourceBytes);
const filename = `${photoDigest(deal.id).slice(0, 16)}-${photoDigest(bytes)}.jpg`;
const photoUrl = `https://freefinder.at/assets/approved-deal-photos/${filename}`;
const editsPath = path.join(root, 'docs/live-deal-edits.json');
const store = loadLiveDealEditStore(editsPath);
const existing = store.edits.find(edit => edit.dealId === deal.id);
if (existing?.hidden) throw new Error('Cannot assign an image to a hidden deal');
const review = {version:2,dealId:deal.id,file:filename,sourceURL:request.sourceURL,
  rights:request.rights,rightsEvidence:request.rightsEvidence,reviewedBy:request.reviewedBy,
  matchesOffer:true,cropChecked:true,
  ...(request.kind==='editorial-illustration'?{kind:request.kind,showsActualProduct:false,showsIllustratedProduct:true}:{showsActualProduct:true}),
  titleAtReview:deal.title,brandAtReview:deal.brand,subjectHash:photoSubjectHash(deal),
  photoUrl,...size,crop,sha256:photoDigest(bytes),cardSha256:photoDigest(card),
  originalSha256:photoDigest(sourceBytes),reviewedAt:new Date().toISOString()};
if (mode === '--apply') {
  const directory = path.join(root, 'docs/assets/approved-deal-photos');
  fs.mkdirSync(directory, {recursive: true});
  const destination = path.join(directory, filename);
  if (fs.existsSync(destination) && !fs.readFileSync(destination).equals(bytes)) throw new Error('Existing immutable photo differs');
  if (!fs.existsSync(destination)) fs.writeFileSync(destination, bytes, {flag: 'wx'});
  const reviewDir = path.join(root, 'reviews/deal-photos');
  fs.mkdirSync(reviewDir, {recursive: true});
  fs.writeFileSync(path.join(reviewDir, `${filename}.json`), JSON.stringify(review, null, 2) + '\n');
  saveLiveDealEditStore(editsPath, upsertLiveDealEdit(store, {...existing, dealId: deal.id, hidden: false, photoUrl, photoSubjectHash:review.subjectHash, editedBy: request.reviewedBy}));
}
console.log(JSON.stringify({mode: mode === '--apply' ? 'prepared-not-published' : 'check-only', dealId: deal.id, photoUrl, ...size}, null, 2));

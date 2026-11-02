import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectOriginalJPEG, photoDigest } from './deal-photo-contract.mjs';
import { dealArrayFromBundle, loadLiveDealEditStore, saveLiveDealEditStore, upsertLiveDealEdit } from './live-deal-edits-lib.mjs';

// Offline editorial import only. It never fetches a social image or publishes a pending deal.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [requestPath, mode] = process.argv.slice(2);
if (!requestPath || !['--check', '--apply', undefined].includes(mode)) throw new Error('Usage: node scripts/prepare-deal-photo.mjs review.json [--check|--apply]');
const request = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
const required = ['dealId', 'file', 'sourceURL', 'rightsEvidence', 'reviewedBy'];
for (const key of required) if (typeof request[key] !== 'string' || !request[key].trim()) throw new Error(`Missing ${key}`);
if (!['merchant-permission', 'owned-original'].includes(request.rights)) throw new Error('Document permission or ownership; public visibility is not permission');
if (request.matchesOffer !== true || request.showsActualProduct !== true || request.cropChecked !== true) throw new Error('Review product relevance, visible food and 2.7:1 crop first');
const feed = dealArrayFromBundle(JSON.parse(fs.readFileSync(path.join(root, 'docs/deals.json'))));
const deal = feed?.find(item => item.id === request.dealId);
if (!deal) throw new Error('Only an already approved live deal can receive a photograph');
const bytes = fs.readFileSync(path.resolve(path.dirname(requestPath), request.file));
const size = inspectOriginalJPEG(bytes);
const filename = `${photoDigest(deal.id).slice(0, 16)}-${photoDigest(bytes)}.jpg`;
const photoUrl = `https://freefinder.at/assets/approved-deal-photos/${filename}`;
const editsPath = path.join(root, 'docs/live-deal-edits.json');
const store = loadLiveDealEditStore(editsPath);
const existing = store.edits.find(edit => edit.dealId === deal.id);
if (existing?.hidden) throw new Error('Cannot assign an image to a hidden deal');
const review = {...request, file: filename, titleAtReview: deal.title, brandAtReview: deal.brand,
  photoUrl, ...size, sha256: photoDigest(bytes), reviewedAt: new Date().toISOString()};
if (mode === '--apply') {
  const directory = path.join(root, 'docs/assets/approved-deal-photos');
  fs.mkdirSync(directory, {recursive: true});
  const destination = path.join(directory, filename);
  if (!fs.existsSync(destination)) fs.writeFileSync(destination, bytes, {flag: 'wx'});
  const reviewDir = path.join(root, 'reviews/deal-photos');
  fs.mkdirSync(reviewDir, {recursive: true});
  fs.writeFileSync(path.join(reviewDir, `${filename}.json`), JSON.stringify(review, null, 2) + '\n');
  saveLiveDealEditStore(editsPath, upsertLiveDealEdit(store, {...existing, dealId: deal.id, hidden: false, photoUrl, editedBy: request.reviewedBy}));
}
console.log(JSON.stringify({mode: mode === '--apply' ? 'prepared-not-published' : 'check-only', dealId: deal.id, photoUrl, ...size}, null, 2));

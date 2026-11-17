import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareOriginalPhoto, validatePhotoPermission, writePreparedOriginalPhoto } from './original-deal-photo.mjs';
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
const editsPath = path.join(root, 'docs/live-deal-edits.json');
const store = loadLiveDealEditStore(editsPath);
const existing = store.edits.find(edit => edit.dealId === deal.id);
if (existing?.hidden) throw new Error('Cannot assign an image to a hidden deal');
const prepared = await prepareOriginalPhoto(deal, request, sourceBytes);
const {review, size} = prepared;
const {photoUrl} = review;
if (mode === '--apply') {
  writePreparedOriginalPhoto(root, prepared);
  saveLiveDealEditStore(editsPath, upsertLiveDealEdit(store, {...existing, dealId: deal.id, hidden: false, photoUrl, photoSubjectHash:review.subjectHash, editedBy: request.reviewedBy}));
}
console.log(JSON.stringify({mode: mode === '--apply' ? 'prepared-not-published' : 'check-only', dealId: deal.id, photoUrl, ...size}, null, 2));

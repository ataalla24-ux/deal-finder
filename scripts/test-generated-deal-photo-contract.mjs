import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {prepareGeneratedPhoto,generatedPhotoInputHash,generatedPhotoDraftMatches,generatedPhotoApproval} from './generated-deal-photo-contract.mjs';
import {photoDigest,photoSubjectHash,normalizeApprovedDealImage} from './deal-photo-contract.mjs';
import {writePreparedOriginalPhoto,inspectBoundOriginalPhoto} from './original-deal-photo.mjs';
import {validateOriginalDealPhotos} from './validate-original-deal-photos.mjs';

const now = new Date('2026-11-27T22:00:00Z');
const deal = {id:'generated-donut',title:'Gratis Erdbeer-Donut',brand:'Fixture Café',
  description:'Ein Donut mit Erdbeerglasur gratis.',category:'essen',url:'https://merchant.example/donut'};
const details = {generationKey:photoDigest('exact-generation-input'),promptHash:photoDigest('specific-strawberry-donut-prompt'),
  visualSubject:'Ein Ring-Donut mit Erdbeerglasur auf einem Teller',model:'gpt-image-test',generatedAt:now.toISOString()};

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'generated-photo-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const input = await sharp({create:{width:1536,height:1024,channels:3,background:'#85501a'}}).png().toBuffer();
  const prepared = await prepareGeneratedPhoto(deal,details,input,now);
  writePreparedOriginalPhoto(root,prepared);
  const approvedDealImage = generatedPhotoApproval(deal,prepared.generatedDealImage,now);
  const locked = {...deal,photoUrl:prepared.photoUrl,approvedDealImage};
  return {root,input,prepared,locked};
}

function saveReview(root,prepared,review) {
  fs.writeFileSync(path.join(root,'reviews/deal-photos',prepared.review.file+'.json'),JSON.stringify(review));
}

test('generated preview has exact final immutable bytes, visible disclosure and no fixed-catalogue dependency',async t=>{
  const {root,prepared,locked} = await fixture(t);
  assert.deepEqual(prepared.size,{width:1080,height:400});
  assert.equal(prepared.review.kind,'editorial-illustration');
  assert.equal(prepared.review.showsActualProduct,false);
  assert.equal(prepared.review.sourceURL,prepared.photoUrl);
  assert.equal(photoDigest(prepared.bytes),prepared.generatedDealImage.sha256);
  assert.equal(normalizeApprovedDealImage(locked.approvedDealImage,locked.id,locked.photoUrl).version,2);
  const pending = await inspectBoundOriginalPhoto({...deal,photoUrl:prepared.photoUrl},{root});
  const approved = await inspectBoundOriginalPhoto(locked,{root});
  assert.deepEqual(approved.bytes,pending.bytes);
  assert.equal(fs.existsSync(path.join(root,'docs/assets/deal-image-pilot/catalog.json')),false);
  const metadata = await sharp(prepared.bytes).metadata();
  assert.equal(metadata.exif,undefined);
  const labelPixel = await sharp(prepared.bytes).extract({left:450,top:335,width:1,height:1}).raw().toBuffer();
  assert.ok([...labelPixel].every(channel=>channel>220),'the renderer applied the visible disclosure panel');
  assert.equal((await validateOriginalDealPhotos([locked],{root})).errors,0);
});

test('generation input distinguishes specifics sharing the same old category image selector',async t=>{
  const {root,prepared,locked} = await fixture(t);
  const changed = {...deal,title:'Gratis Schoko-Donut',description:'Ein Donut mit Schokoglasur gratis.'};
  assert.notEqual(generatedPhotoInputHash(changed),generatedPhotoInputHash(deal));
  assert.equal(generatedPhotoDraftMatches(changed,prepared.generatedDealImage),false);
  assert.throws(()=>generatedPhotoApproval(changed,prepared.generatedDealImage,now),/context-mismatch/);
  await assert.rejects(inspectBoundOriginalPhoto({...changed,photoUrl:prepared.photoUrl},{root}),/draft-stale/);
  assert.equal(generatedPhotoInputHash({...deal,distance:'Neue Adresse',validUntil:'2027-01-01'}),generatedPhotoInputHash(deal));
  assert.ok(locked.approvedDealImage);
});

test('a human-approved product keeps its image through later copy, price, calendar and map completion',async t=>{
  const {root,prepared,locked} = await fixture(t);
  const enriched = {...locked,title:'Erdbeer-Donut kostenlos im Fixture Café',description:'Ein Erdbeer-Donut pro Person. Abholung im Café.',
    distance:'Wien · 1070',validUntil:'2027-01-01',price:0};
  assert.equal(photoSubjectHash(enriched),photoSubjectHash(locked));
  assert.deepEqual((await inspectBoundOriginalPhoto(enriched,{root})).bytes,prepared.bytes);
  assert.equal((await validateOriginalDealPhotos([enriched],{root,previousDeals:[locked]})).errors,0);
  const enrichedBeforeLock = {...enriched,approvedDealImage:undefined};
  assert.throws(()=>generatedPhotoApproval(enrichedBeforeLock,prepared.generatedDealImage,now),/context-mismatch/);
  assert.ok(generatedPhotoApproval(enrichedBeforeLock,prepared.generatedDealImage,now,{allowCopyEnrichment:true}));
});

test('a different source, merchant, deal identity or recognized product cannot reuse the generated receipt',async t=>{
  const {root,prepared,locked} = await fixture(t);
  for (const patch of [{id:'other-deal'},{brand:'Different Café'},{url:'https://merchant.example/another'},
    {category:'shopping'},{title:'Gratis Kaffee',description:'Eine Tasse Kaffee gratis.'}]) {
    const changed = {...locked,...patch};
    assert.equal(generatedPhotoDraftMatches(changed,prepared.generatedDealImage),false);
    await assert.rejects(inspectBoundOriginalPhoto(changed,{root}));
  }
});

test('tampered generation or disclosure evidence fails while legacy permissions remain required',async t=>{
  const {root,prepared,locked} = await fixture(t);
  const review = prepared.review;
  const variants = [
    {...review,generation:{...review.generation,promptHash:'invalid'}},
    {...review,generation:{...review.generation,generationKey:photoDigest('different-request')}},
    {...review,generation:{...review.generation,visualSubject:'A different product'}},
    {...review,renderedDisclosure:{...review.renderedDisclosure,bounds:{left:0,top:0,width:224,height:54}}},
    {...review,renderedDisclosure:{...review.renderedDisclosure,imageSha256:'a'.repeat(64)}},
    {...review,rights:'public-image'}, {...review,revoked:true},
  ];
  for (const candidate of variants) {
    saveReview(root,prepared,candidate);
    await assert.rejects(inspectBoundOriginalPhoto(locked,{root}));
  }
  saveReview(root,prepared,review);
  const changedLock = {...locked,approvedDealImage:{...locked.approvedDealImage,visualSubject:'Another product'}};
  assert.equal((await validateOriginalDealPhotos([changedLock],{root,previousDeals:[locked]})).results[0].reason,'locked-photo-changed-after-approval');
});

test('generation rejects unbounded metadata and undersized or undecodable source images',async()=>{
  const small = await sharp({create:{width:1024,height:1024,channels:3,background:'#85501a'}}).jpeg().toBuffer();
  await assert.rejects(prepareGeneratedPhoto(deal,details,small,now),/size-invalid/);
  await assert.rejects(prepareGeneratedPhoto(deal,{...details,visualSubject:''},small,now),/input-invalid/);
  await assert.rejects(prepareGeneratedPhoto(deal,{...details,promptHash:'not-a-hash'},small,now),/input-invalid/);
  await assert.rejects(prepareGeneratedPhoto(deal,details,Buffer.from('not-an-image'),now));
});

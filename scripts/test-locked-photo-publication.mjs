import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {prepareOriginalPhoto,writePreparedOriginalPhoto} from './original-deal-photo.mjs';
import {photoSubjectHash} from './deal-photo-contract.mjs';
import {validateOriginalDealPhotos} from './validate-original-deal-photos.mjs';
import {stampDealsFeedBundle} from './deals-feed-contract.mjs';

const now = new Date('2026-11-25T18:00:00Z');
const deal = {id:'locked-test',title:'Gratis Kaffee',brand:'Test Café',description:'Ein Kaffee gratis.',
  category:'kaffee',url:'https://merchant.example/coffee'};

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'locked-photo-'));
  t.after(() => fs.rmSync(root,{recursive:true,force:true}));
  const bytes = await sharp({create:{width:1200,height:800,channels:3,background:'#a96e31'}}).jpeg().toBuffer();
  const prepared = await prepareOriginalPhoto(deal,{
    dealId:deal.id,sourceURL:'https://merchant.example/coffee.jpg',rights:'merchant-permission',
    rightsEvidence:'offline-test-permission',reviewedBy:'offline-test',matchesOffer:true,showsActualProduct:true,cropChecked:true,
  },bytes,now);
  const locked = {...deal,photoUrl:prepared.review.photoUrl,approvedDealImage:{version:1,status:'locked',
    photoUrl:prepared.review.photoUrl,sha256:prepared.review.sha256,assetKey:'coffee',kind:'merchant-photo',approvedAt:now.toISOString()}};
  prepared.review.subjectHash = photoSubjectHash(locked);
  writePreparedOriginalPhoto(root,prepared);
  return {root,locked,prepared};
}

test('public feed stamping keeps the exact locked image and hides its pending approval draft',async t => {
  const {root,locked} = await fixture(t);
  const stamped = stampDealsFeedBundle({deals:[{...locked,pendingDealImage:{secret:'internal-draft'}}]},
    {nowIso:now.toISOString(),redemptionManifest:null}).deals[0];
  assert.deepEqual(stamped.approvedDealImage,locked.approvedDealImage);
  assert.equal(stamped.photoUrl,locked.photoUrl);
  assert.equal(Object.hasOwn(stamped,'pendingDealImage'),false);
  assert.equal((await validateOriginalDealPhotos([stamped],{root})).errors,0);
});

test('a missing, replaced or malformed locked image fails publication even without a photoUrl',async t => {
  const {root,locked} = await fixture(t);
  const variants = [
    {...locked,photoUrl:''},
    {...locked,photoUrl:undefined},
    {...locked,photoUrl:locked.photoUrl.replace(locked.approvedDealImage.sha256,'a'.repeat(64))},
    ...[null,{...locked.approvedDealImage,version:2},{...locked.approvedDealImage,status:'pending'},
      {...locked.approvedDealImage,sha256:'b'.repeat(64)},{...locked.approvedDealImage,photoUrl:'https://elsewhere.example/photo.jpg'},
      {...locked.approvedDealImage,assetKey:'../coffee'},{...locked.approvedDealImage,kind:'unreviewed'},
      {...locked.approvedDealImage,approvedAt:'not-a-date'}].map(approvedDealImage => ({...locked,approvedDealImage})),
  ];
  for (const candidate of variants) {
    const result = await validateOriginalDealPhotos([candidate],{root});
    assert.equal(result.checked,1);
    assert.equal(result.errors,1);
    assert.equal(result.results[0].reason,'locked-photo-binding-invalid');
  }
});

test('a lock cannot claim a different image kind or reuse revoked file permission',async t => {
  const {root,locked,prepared} = await fixture(t);
  const wrongKind = {...locked,approvedDealImage:{...locked.approvedDealImage,kind:'editorial-illustration'}};
  assert.equal((await validateOriginalDealPhotos([wrongKind],{root})).results[0].reason,'locked-photo-review-mismatch');
  const reviewFile = path.join(root,'reviews/deal-photos',prepared.review.file+'.json');
  fs.writeFileSync(reviewFile,JSON.stringify({...prepared.review,revoked:true}));
  assert.equal((await validateOriginalDealPhotos([locked],{root})).errors,1);
});

test('legacy deals keep their existing photo verification without acquiring a lock',async t => {
  const {root,locked,prepared} = await fixture(t);
  const {approvedDealImage,...legacy} = locked;
  prepared.review.subjectHash = photoSubjectHash(legacy);
  writePreparedOriginalPhoto(root,prepared);
  const result = await validateOriginalDealPhotos([legacy,{...deal,id:'no-photo'}],{root});
  assert.equal(result.checked,1);
  assert.equal(result.errors,0);
});

test('later writers cannot delete or replace both the locked photo and its metadata',async t => {
  const {root,locked} = await fixture(t);
  const previousDeals = [locked];
  const {photoUrl,approvedDealImage,...lostPhoto} = locked;
  const variants = [lostPhoto,
    {...locked,approvedDealImage:{...approvedDealImage,approvedAt:'2026-11-26T00:00:00Z'}},
    {...locked,approvedDealImage:{...approvedDealImage,sha256:'a'.repeat(64)}},
  ];
  for (const candidate of variants) {
    const result = await validateOriginalDealPhotos([candidate],{root,previousDeals});
    assert.equal(result.errors,1);
    assert.equal(result.results[0].reason,'locked-photo-changed-after-approval');
  }
  const unchanged = await validateOriginalDealPhotos([{...locked,distance:'Wien · 1070'}],{root,previousDeals});
  assert.equal(unchanged.errors,0);
  const expiredOrHidden = await validateOriginalDealPhotos([],{root,previousDeals});
  assert.equal(expiredOrHidden.checked,0);
  assert.equal(expiredOrHidden.errors,0);
});

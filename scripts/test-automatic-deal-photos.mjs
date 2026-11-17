import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {protectedFields} from './automatic-deal-maintenance.mjs';
import {maintainDealPhotos} from './automatic-deal-photos.mjs';
import {inspectBoundOriginalPhoto} from './original-deal-photo.mjs';
import {applyLiveDealEditsToBundle,loadLiveDealEditStore,readJson,writeJson} from './live-deal-edits-lib.mjs';

const now = new Date('2026-11-17T10:00:00Z');
const library = 'docs/assets/blog/photos';
const tuna = {id:'tuna', brand:'NORDSEE', title:'Drei-Kunden: 1+1 Thunfisch-Wrap gratis', category:'essen',
  description:'Zwei Thunfisch-Wraps zum Preis von einem. Gutschein vorzeigen.', validUntil:'2027-01-03',
  url:'https://www.drei.at/de/dreiplus/ersparnisse/nordsee/', dateConfidence:'high', expiryKind:'end'};
const abby = {id:'abby', brand:'ABBY Restaurant', title:'Doppel-Smashburger für 9,90 €', category:'essen',
  description:'Doppel Smashburger für nur 9,90 €. 2x saftiges Beef!', validUntil:'2026-12-31',
  url:'https://www.instagram.com/reel/DfS8EP4oW02/', dateConfidence:'high', expiryKind:'end'};
const latte = (id, product) => ({id, brand:'OMV VIVA', title:`Gratis ${product} mit jö`, category:'kaffee',
  description:`${product} mit der jö App einmal gratis testen.`, validUntil:'2027-01-31',
  url:'https://presse.ikp.at/news-wintergenuss-bei-omv-viva-drei-neue-kaffee-kreationen-fuer-die-kalte-jahreszeit?id=251130&menueid=33632&l=deutsch',
  dateConfidence:'high', expiryKind:'end'});
const drinks = [latte('cherry','Cherry Cream Latte'),latte('caramel','Double Caramel Latte'),latte('ube','Ube Coconut Latte')];

function fixture(t,deals,edits=[]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'freefinder-automatic-photos-'));
  t.after(() => fs.rmSync(root,{recursive:true,force:true}));
  const libraryPath = path.join(root,library);
  fs.mkdirSync(libraryPath,{recursive:true});
  fs.mkdirSync(path.join(root,'reviews'));
  const sources = fileURLToPath(new URL(`../${library}/`,import.meta.url));
  for (const file of ['sources.json','tuna-wrap.jpg','double-smashburger.jpg','cherry-latte.jpg','caramel-latte.jpg','ube-coconut-latte.jpg']) {
    fs.copyFileSync(path.join(sources,file),path.join(libraryPath,file));
  }
  writeJson(path.join(root,'docs/deals.json'),{deals,version:'preserved'});
  writeJson(path.join(root,'docs/live-deal-edits.json'),{version:1,edits});
  return root;
}

test('exact artwork only updates its photo binding, documents rights and replays idempotently',async t => {
  const labelledTuna = {...tuna,description:`${tuna.description} Symbolbild.`};
  const deals = [labelledTuna,abby,...drinks];
  const root = fixture(t,deals,[{dealId:tuna.id,editedBy:'editorial copy review',description:labelledTuna.description,
    createdAt:'2026-11-12T10:00:00Z',updatedAt:'2026-11-12T10:00:00Z'}]);
  const feedPath = path.join(root,'docs/deals.json'), editsPath = path.join(root,'docs/live-deal-edits.json');
  const preview = await maintainDealPhotos({root,now,requireVision:false});
  assert.equal(preview.prepared,0);
  assert.equal(preview.candidates.length,5);
  assert.equal(fs.existsSync(path.join(root,'reviews/deal-photos')),false);
  assert.deepEqual(readJson(feedPath).deals,deals);
  const first = await maintainDealPhotos({root,now,apply:true,requireVision:false});
  assert.equal(first.prepared,4);
  assert.equal(first.modelCalls,0);
  const live = readJson(feedPath);
  assert.equal(live.version,'preserved');
  for (const [index,deal] of live.deals.entries()) {
    const {photoUrl,description,...fields} = deal;
    const {description:original,...originalFields} = deals[index];
    assert.deepEqual(fields,originalFields);
    assert.equal(description,index > 0 && index < 4 ? `${original} Symbolbild.` : original);
    if (index >= 4) continue;
    const {review} = await inspectBoundOriginalPhoto(deal,{root});
    assert.equal(photoUrl,review.photoUrl);
    assert.equal(review.rights,'owned-original');
    assert.equal(review.kind,'editorial-illustration');
    assert.equal(review.showsActualProduct,false);
  }
  const store = loadLiveDealEditStore(editsPath);
  assert.equal(store.edits.find(edit => edit.dealId === tuna.id).editedBy,'editorial copy review');
  assert.equal(protectedFields(live.deals[1],store.edits).has('description'),false);
  const replay = applyLiveDealEditsToBundle({deals},store).bundle.deals;
  assert.deepEqual(replay.map(({photoUrl,description}) => ({photoUrl,description})),
    live.deals.map(({photoUrl,description}) => ({photoUrl,description})));
  const changed = applyLiveDealEditsToBundle([{...abby,description:'A newly updated source description.'}],store).bundle[0];
  assert.equal(changed.description,'A newly updated source description.');
  assert.ok(!changed.photoUrl);
  assert.equal((await maintainDealPhotos({root,now,apply:true,requireVision:false})).prepared,1);
  const after = fs.readFileSync(feedPath);
  assert.equal((await maintainDealPhotos({root,now,apply:true,requireVision:false})).prepared,0);
  assert.deepEqual(fs.readFileSync(feedPath),after);
});

test('source, variant, timing and human photo edits all protect offers from replacement',async t => {
  const root = fixture(t,[
    {...tuna,id:'different-source',url:`${tuna.url}?ref=other`},
    {...tuna,id:'wrong-copy',description:'Zwei Garnelen-Wraps zum Preis von einem.'},
    {...tuna,id:'unverified-date',dateConfidence:'low'},
    {...tuna,id:'future-start',validFrom:'2027-01-01'},
    {...tuna,id:'expired',validUntil:'2026-11-16'},
    {...tuna,id:'existing-photo',photoUrl:'https://freefinder.at/example.jpg'},
    {...tuna,id:'cleared-photo'},
    {...tuna,id:'removed'},
    {...abby,id:'ambiguous-1'},{...abby,id:'ambiguous-2'},
    {...drinks[0],description:`${drinks[0].description} Double Caramel Latte.`},
  ],[{dealId:'cleared-photo',photoUrl:''},{dealId:'removed',hidden:true}]);
  const report = await maintainDealPhotos({root,now,apply:true,requireVision:false});
  assert.deepEqual(report.candidates,[]);
  assert.equal(fs.existsSync(path.join(root,'reviews/deal-photos')),false);
});

test('edited or unlicensed artwork is skipped before any visual request',async t => {
  const root = fixture(t,[tuna,abby]);
  fs.appendFileSync(path.join(root,library,'tuna-wrap.jpg'),'changed');
  const sourcesPath = path.join(root,library,'sources.json');
  const sources = readJson(sourcesPath);
  delete sources.photos['double-smashburger'];
  writeJson(sourcesPath,sources);
  const result = await maintainDealPhotos({root,now,apply:true,requireVision:true,allowNewVision:true,
    request:async () => assert.fail('invalid artwork reached visual review')});
  assert.equal(result.prepared,0);
  assert.equal(result.modelCalls,0);
  assert.deepEqual(result.candidates.map(row => row.status),['artwork-integrity-deferred','artwork-integrity-deferred']);
});

test('an editor-written description stays byte-exact and requires explicit existing disclosure',async t => {
  const root = fixture(t,[tuna],[{dealId:tuna.id,description:tuna.description,editedBy:'editor'}]);
  const report = await maintainDealPhotos({root,now,apply:true,requireVision:true,allowNewVision:true,
    request:async () => assert.fail('protected description reached visual review')});
  assert.equal(report.prepared,0);
  assert.equal(report.modelCalls,0);
  assert.equal(report.candidates[0].status,'protected-description-needs-symbolic-label');
  assert.deepEqual(readJson(path.join(root,'docs/deals.json')).deals,[tuna]);
});

test('visual validation requires clear exact product and crop within its existing two-call budget',async t => {
  const root = fixture(t,[tuna,abby,...drinks]);
  const options = {root,now,apply:true,requireVision:true,allowNewVision:true};
  let seen = [];
  const request = async (url,init) => {
    assert.equal(url,'https://api.openai.com/v1/chat/completions');
    const [{text},...images] = JSON.parse(init.body).messages.at(-1).content;
    assert.equal(images.length,2);
    assert.ok(images.every(image => image.image_url.url.startsWith('data:image/jpeg;base64,')));
    const {id} = JSON.parse(text);
    seen.push(id);
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({
      matchesProduct:true,emptyTableOrPackaging:false,cropKeepsProduct:id !== 'tuna',visuallyClear:true,uncertain:false,
    })}}]});
  };
  const noKey = await maintainDealPhotos({...options,allowNewVision:false,request});
  assert.equal(noKey.prepared,0);
  assert.equal(noKey.modelCalls,0);
  const first = await maintainDealPhotos({...options,request});
  assert.equal(first.prepared,1);
  assert.deepEqual(seen,['tuna','abby']);
  assert.equal(first.candidates[0].status,'needs-review');
  const live = readJson(path.join(root,'docs/deals.json')).deals;
  const {review} = await inspectBoundOriginalPhoto(live.find(deal => deal.id === 'abby'),{root});
  assert.equal(review.visualValidation.status,'visual-match');
  assert.equal(live.find(deal => deal.id === 'tuna').photoUrl,undefined);
  seen = [];
  const second = await maintainDealPhotos({...options,request});
  assert.equal(second.prepared,2);
  assert.deepEqual(seen,['cherry','caramel']);
});

test('unavailable visual provider defers the run after a single attempt',async t => {
  const root = fixture(t,[tuna,abby]);
  const report = await maintainDealPhotos({root,now,apply:true,requireVision:true,allowNewVision:true,
    request:async () => {throw Error('fake budget deferral');}});
  assert.equal(report.modelCalls,1);
  assert.equal(report.prepared,0);
  assert.equal(report.candidates[0].status,'visual-review-deferred');
  assert.equal(fs.existsSync(path.join(root,'reviews/deal-photos')),false);
});

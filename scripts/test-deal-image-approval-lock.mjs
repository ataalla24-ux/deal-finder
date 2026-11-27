import test from 'node:test';
import assert from 'node:assert/strict';
import {photoDigest,photoSubjectHash,normalizeApprovedDealImage} from './deal-photo-contract.mjs';
import {applyLiveDealEditsToBundle,normalizeLiveDealEdit} from './live-deal-edits-lib.mjs';
import {dealImageSubjectHash} from '../scraper/deal-image-subject.js';
import {preparePublishedApprovedDeals} from '../scraper/slack-approve.js';
import {postSlackMessage} from '../scraper/slack-notify.js';

const now = new Date();
const base = {id:'locked-photo-fixture',title:'Gratis Kaffee',description:'Eine Tasse Kaffee in Wien.',
  brand:'Café Fixture',category:'kaffee',url:'https://cafe.example/angebot',
  slackTs:'1234.56',pipelineLifecycle:{manualDecision:'approved'}};
const sha256 = 'a'.repeat(64);
const photoUrl = `https://freefinder.at/assets/approved-deal-photos/${photoDigest(base.id).slice(0,16)}-${sha256}.jpg`;
const approvedDealImage = {version:1,status:'locked',photoUrl,sha256,assetKey:'coffee',
  kind:'editorial-illustration',approvedAt:now.toISOString()};
const deal = {...base,photoUrl,approvedDealImage};
const edit = {dealId:base.id,photoUrl,approvedDealImage,photoSubjectHash:photoSubjectHash(deal)};

test('ordinary copy, dates and location enrichment retain the reviewed photo and its persistent lock', () => {
  assert.equal(photoSubjectHash(deal),dealImageSubjectHash(deal));
  assert.deepEqual(normalizeLiveDealEdit(edit).approvedDealImage,approvedDealImage);
  const updated = {...deal,title:'Kaffee gratis mit Gutschein',description:'Eine Tasse Kaffee mit Gutschein. Einmal pro Person.',
    validUntil:'2027-01-31',address:'Wollzeile 1, 1010 Wien'};
  const result = applyLiveDealEditsToBundle({deals:[updated]},{edits:[edit]}).bundle.deals[0];
  assert.equal(result.photoUrl,photoUrl);
  assert.deepEqual(result.approvedDealImage,approvedDealImage);
  const rebuilt = applyLiveDealEditsToBundle({deals:[base]},{edits:[edit]}).bundle.deals[0];
  assert.equal(rebuilt.photoUrl,photoUrl);
  assert.deepEqual(rebuilt.approvedDealImage,approvedDealImage);
  assert.equal(normalizeApprovedDealImage({...approvedDealImage,sha256:'b'.repeat(64)},base.id,photoUrl),null);
});

test('a changed product cannot silently reuse or select a different locked photo', () => {
  const changed = {...deal,title:'Gratis Döner',description:'Ein Döner im Fladenbrot.'};
  const result = applyLiveDealEditsToBundle({deals:[changed]},{edits:[edit]}).bundle.deals[0];
  assert.equal(result.photoUrl,'');
  assert.deepEqual(result.approvedDealImage,approvedDealImage,'publication validation must see the unresolved old lock');
});

test('both publication entry points hold an incomplete required image without losing the approval', async () => {
  const pending = {...base,imageApprovalRequired:true};
  const blockedDeals = [];
  const published = await preparePublishedApprovedDeals([pending],{now,enabled:true,blockedDeals});
  assert.deepEqual(published,[]);
  assert.deepEqual(blockedDeals,[pending]);
  assert.equal(blockedDeals[0].pipelineLifecycle.manualDecision,'approved');
});

test('a required preview rejected by Slack is retained and never resent with a substitute or text-only payload', async () => {
  const originalFetch = globalThis.fetch;
  const originalFlag = process.env.FREEFINDER_DEAL_IMAGE_PILOT;
  process.env.FREEFINDER_DEAL_IMAGE_PILOT = '1';
  const pending = {...base,imageApprovalRequired:true,pendingDealImage:{version:2,key:'coffee',sha256,
    previewURL:`https://freefinder.at/assets/deal-image-pilot/coffee-${sha256}.jpg`,
    sourceKind:'owned-catalog',kind:'editorial-illustration',offerId:base.id,sourceURL:base.url,
    subjectHash:dealImageSubjectHash(base),preparedAt:now.toISOString()}};
  let calls = 0;
  try {
    globalThis.fetch = async (_url,options) => {
      calls++;
      const payload = JSON.parse(options.body);
      assert.equal(payload.blocks.filter(block => block.type === 'image').length,1);
      assert.equal(payload.blocks.find(block => block.type === 'image').image_url,pending.pendingDealImage.previewURL);
      return Response.json({ok:false,error:'invalid_blocks'});
    };
    assert.equal(await postSlackMessage('Fixture','1234.00',0,pending),null);
    assert.equal(calls,1);
    assert.ok(pending.pendingDealImage);
    assert.equal(await postSlackMessage('Fixture','1234.00',0,{...base,imageApprovalRequired:true}),null);
    assert.equal(calls,1,'an unprepared image must never create a Slack approval message');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalFlag === undefined) delete process.env.FREEFINDER_DEAL_IMAGE_PILOT;
    else process.env.FREEFINDER_DEAL_IMAGE_PILOT = originalFlag;
  }
});

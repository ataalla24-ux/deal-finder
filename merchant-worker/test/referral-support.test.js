import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from 'miniflare';
import { handleReferralMonths, ReferralMonthsLedger, referralHash } from '../src/referral-months.js';
import { bundledAuth } from './bundled-auth.js';

const DAY = 86400000, now = Date.now(), start = now - 60 * DAY;
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const product = 'com.stefanataalla.freefinderwien.premium.monthly';
const source = { version:1, platform:'ios', accountId:id(90), purchaseKey:'ios:10000001',
  receiptId:'10000001', productId:product, purchasedAt:start, periodEnd:start+30*DAY, verifiedAt:start };
const receipt = { bundleId:'com.stefanataalla.freefinderwien', environment:'Production', transactionId:'10000001',
  originalTransactionId:'10000001', productId:product, appAccountToken:id(90), purchaseDate:start,
  originalPurchaseDate:start, expiresDate:start+30*DAY, offerType:1, offerDiscountType:'FREE_TRIAL' };
const reward = (n=1, state='store_confirmation') => ({ id:id(n+100), state, months:1, createdAt:start,
  sourceEvidence:structuredClone(source), sourceReview:{status:'unverified',checkedAt:now-1},
  redemptionPlatform:'ios', reservedAt:start+DAY, productId:product, offerId:'private-offer',
  redemptionURL:'https://apps.apple.com/redeem?code=PRIVATECODE' });
const account = (n=1, rewards=[reward()]) => ({ id:id(n), recoverable:true, email:'private@example.test',
  code:'RM-' + String(n).padStart(24,'0'), preferences:{dealEmails:false}, consentEvents:[], rewards });
const delivered = () => ({ ...reward(1,'redeemed'), redeemedAt:start+2*DAY,
  redemptionEvidence:{version:1,platform:'ios',accountId:id(1),purchaseKey:'ios:20000001',
    receiptId:'20000002',productId:product,purchasedAt:start+DAY,periodEnd:start+31*DAY,verifiedAt:start+2*DAY} });

async function runtime(t) {
  const ledger = await readFile(new URL('../src/referral-months.js', import.meta.url),'utf8');
  const mf = new Miniflare(convertV4MiniflareOptions({compatibilityDate:'2026-03-09',log:new Log(LogLevel.NONE),
    bindings:{REFERRAL_SUPPORT_ENABLED:'1',REFERRAL_MONTHS_ENABLED:'0',REFERRAL_ADMIN_SECRET:'fixture-only-admin'},
    durableObjects:{LEDGER:{className:'TestLedger',useSQLite:true}},
    modules:[{type:'ESModule',path:'runtime.js',contents:`
      import { ReferralMonthsLedger, handleReferralMonths } from './ledger.js';
      export class TestLedger extends ReferralMonthsLedger {
        async sourcePurchase(evidence) {
          await this.storage.put('calls',(await this.storage.get('calls') || 0)+1);
          const fixture = await this.storage.get('fixture') || {};
          if (fixture.pause) { const pending = new Promise(resolve => this.release=resolve); this.started=true; await pending; }
          if (fixture.outage) throw Error('private upstream error');
          return fixture.receipt;
        }
        async deferPlay() { throw Error('Support must not change billing'); }
        async verifyPurchase() { throw Error('Support must not replay redemption'); }
        async fetch(request) {
          const path = new URL(request.url).pathname;
          if (path === '/seed') {const data=await request.json(); if(data.fixture) this.started=false;
            await this.storage.put(data); return Response.json({ok:true});}
          if (path === '/snapshot') return Response.json(Object.fromEntries(await this.storage.list()));
          if (path === '/started') return Response.json({started:this.started === true});
          if (path === '/release') {this.release?.(); return Response.json({ok:true});}
          // Allow concurrent fixture mutations to exercise the real transactional revision check.
          if (path.startsWith('/support-')) {
            try {return Response.json(await this.perform(path.slice(1),await request.json()));}
            catch(e) {return Response.json({error:e.message}, {status:e.status || 503});}
          }
          return super.fetch(request);
        }
      }
      export default { fetch(request,env) {
        if(new URL(request.url).pathname.startsWith('/api/'))
          return handleReferralMonths(request,{...env,REFERRAL_MONTHS:env.LEDGER},async()=>{throw Error('No user authentication for admin route');});
        return env.LEDGER.get(env.LEDGER.idFromName('referral-months-v1')).fetch(request);
      }};
    `},{type:'ESModule',path:'ledger.js',contents:ledger},await bundledAuth('account-auth.js')],
  }));
  t.after(()=>mf.dispose());
  return async (path, body={}, status=200, authorized=true) => {
    const response=await mf.dispatchFetch('https://fixture'+path,{method:'POST',body:JSON.stringify(body),
      headers:{'content-type':'application/json',...(authorized ? {'x-freefinder-merchant-secret':'fixture-only-admin'} : {})}});
    assert.equal(response.status,status,await response.clone().text());
    return response.json();
  };
}
const inspect = call => call('/api/referral-months/support-case',{accountId:id(1),rewardId:id(101)});
const request = revision => ({accountId:id(1),rewardId:id(101),requestId:id(200),revision,decision:'recheck_source'});

test('support requires admin and independent gate; disabled requests never reach storage',async()=>{
  for(const action of ['support-cases','support-case','support-review']) {
    for(const [env,headers,status] of [
      [{}, {},403], [{REFERRAL_ADMIN_SECRET:'x'}, {'x-freefinder-merchant-secret':'x'},503],
      [{REFERRAL_SUPPORT_ENABLED:'1',REFERRAL_ADMIN_SECRET:'x'}, {authorization:'Bearer x'},403],
    ]) {
      const response=await handleReferralMonths(new Request('https://fixture/api/referral-months/'+action,
        {method:'POST',headers:{'content-type':'application/json',...headers},body:'{}'}),
        {...env,REFERRAL_MONTHS:{idFromName(){assert.fail('must not access ledger');}}});
      assert.equal(response.status,status);
    }
    const ledger=new ReferralMonthsLedger({storage:new Proxy({}, {get(){assert.fail('disabled storage access');}})},{});
    await assert.rejects(()=>ledger.perform(action,{}),e=>e.status===503);
  }
});

test('case inspection and queue never expose contacts, codes, source owner or receipts',async t=>{
  const call=await runtime(t),original=account();
  await call('/seed',{['account:'+id(1)]:original});
  const detail=await inspect(call),queue=await call('/api/referral-months/support-cases');
  assert.equal(detail.case.state,'store_confirmation'); assert.equal(queue.cases.length,1);
  assert.match(detail.case.revision,/^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify([detail,queue]),/private@|PRIVATECODE|private-offer|10000001|000000000090|RM-/);
  assert.deepEqual((await call('/snapshot'))['account:'+id(1)],original);
});

test('queue pagination is bounded and visits each reward once across account boundaries',async t=>{
  const call=await runtime(t);
  const records=Object.fromEntries(Array.from({length:7},(_,i)=>['account:'+id(i+1),account(i+1,
    Array.from({length:i===0?105:1},(_,j)=>reward(1000*(i+1)+j)))]));
  await call('/seed',records);
  let cursor,seen=[];
  for(let i=0;i<5;i++) {
    const page=await call('/api/referral-months/support-cases',cursor?{cursor}:{});
    assert.ok(page.cases.length<=100); seen.push(...page.cases.map(x=>x.rewardId));
    cursor=page.cursor; if(!cursor) break;
  }
  assert.equal(cursor,null); assert.equal(seen.length,111); assert.equal(new Set(seen).size,111);
});

test('malformed cursors and extra fields are rejected before a support operation',async t=>{
  const call=await runtime(t);
  for(const cursor of ['account:private',{accountId:id(1),offset:-1},{accountId:id(1),offset:0,url:'https://outside'},
    {accountId:id(1),offset:0.5}]) await call('/api/referral-months/support-cases',{cursor},400);
  await call('/api/referral-months/support-cases',{secret:'unexpected'},400);
  await call('/api/referral-months/support-case',{accountId:'../other',rewardId:id(101)},400);
  await call('/api/referral-months/support-cases',{},403,false);
});

test('source recheck is audited, idempotent, owner-scoped and never changes credit or billing',async t=>{
  const call=await runtime(t),original=account();
  await call('/seed',{['account:'+id(1)]:original,fixture:{receipt}});
  const body=request((await inspect(call)).case.revision);
  const reviewed=await call('/api/referral-months/support-review',body);
  assert.equal(reviewed.case.sourceStatus,'verified'); assert.equal(reviewed.replay,false);
  assert.equal((await call('/api/referral-months/support-review',body)).replay,true);
  const snapshot=await call('/snapshot'),stored=snapshot['account:'+id(1)].rewards[0];
  assert.equal(snapshot.calls,1); assert.equal(stored.supportHistory.length,1);
  const {sourceReview,reconciliation,supportHistory,...preserved}=stored;
  const {sourceReview:previous,...expected}=original.rewards[0];
  assert.deepEqual(preserved,expected);
  await call('/api/referral-months/support-review',{...body,decision:'retain_delivered_benefit'},409);
  await call('/api/referral-months/support-review',{...body,requestId:id(201)},409);
  await call('/api/referral-months/support-review',{...body,accountId:id(2)},404);
  assert.equal((await call('/snapshot')).calls,1);
});

test('outage and missing original proof remain pending without inventing revocation',async t=>{
  const call=await runtime(t);
  for(const missing of [false,true]) {
    const r=reward(); if(missing) delete r.sourceEvidence;
    await call('/seed',{['account:'+id(1)]:account(1,[r]),fixture:{outage:true},calls:0});
    const result=await call('/api/referral-months/support-review',request((await inspect(call)).case.revision));
    assert.equal(result.case.sourceStatus,'unverified'); assert.equal(result.case.resolved,false);
    const snapshot=await call('/snapshot'); assert.equal(snapshot.calls,missing?0:1);
    assert.equal(snapshot['account:'+id(1)].rewards[0].state,'store_confirmation');
  }
});

test('only an explicitly retained delivered benefit with fresh authoritative revocation closes a case',async t=>{
  const call=await runtime(t),r=delivered(),original=account(1,[r]);
  await call('/seed',{['account:'+id(1)]:original,fixture:{receipt:{...receipt,revocationDate:now-1}}});
  const body={...request((await inspect(call)).case.revision),decision:'retain_delivered_benefit'};
  const result=await call('/api/referral-months/support-review',body);
  assert.equal(result.case.resolved,true); assert.equal(result.case.state,'redeemed');
  assert.equal((await call('/api/referral-months/support-cases')).cases.length,0);
  const stored=(await call('/snapshot'))['account:'+id(1)].rewards[0];
  const {sourceReview,reconciliation,supportHistory,...preserved}=stored;
  const {sourceReview:previous,...expected}=r;
  assert.deepEqual(preserved,expected);
  assert.equal((await call('/api/referral-months/support-review',body)).replay,true);
  // An evidence change reopens the case, even when the previous decision was retained.
  stored.sourceEvidence.receiptId='10000002';
  await call('/seed',{['account:'+id(1)]:account(1,[stored])});
  assert.equal((await inspect(call)).case.resolved,false);
});

test('retention refuses pending/unproven benefits, unknown source, unchanged source and malformed proof',async t=>{
  const call=await runtime(t);
  for(const [r,raw] of [[reward(),receipt],[delivered(),receipt],
    [delivered(),{...receipt,appAccountToken:id(91)}],
    [{...delivered(),redemptionEvidence:{}},{...receipt,revocationDate:now-1}],
    [{...delivered(),redemptionEvidence:{...delivered().redemptionEvidence,accountId:id(2)}},{...receipt,revocationDate:now-1}]]) {
    const original=account(1,[r]);
    await call('/seed',{['account:'+id(1)]:original,fixture:{receipt:raw}});
    await call('/api/referral-months/support-review',{
      ...request((await inspect(call)).case.revision),decision:'retain_delivered_benefit'},409);
    assert.deepEqual((await call('/snapshot'))['account:'+id(1)],original);
  }
});

test('Google refunded source can be reviewed without a deferral or token disclosure',async t=>{
  const call=await runtime(t),r=delivered(),token='fixture-private-google-token';
  r.sourceEvidence={...source,platform:'android',receiptId:'GPA.1111-2222-3333-44444',
    productId:'freefinder.pro.monthly',purchaseKey:'android:'+await referralHash(token)};
  const raw={orderId:r.sourceEvidence.receiptId,purchaseToken:token,state:'REFUNDED',
    orderHistory:{refundEvent:{eventTime:new Date(now-1).toISOString()}},lineItems:[{
      productId:'freefinder.pro.monthly',subscriptionDetails:{basePlanId:'monthly',offerId:'flyer-month-free',servicePeriodStartTime:new Date(start).toISOString(),
        servicePeriodEndTime:new Date(start+30*DAY).toISOString(),offerPhaseDetails:{freeTrialDetails:{}}}}]};
  await call('/seed',{['account:'+id(1)]:account(1,[r]),fixture:{receipt:raw}});
  const result=await call('/api/referral-months/support-review',{
    ...request((await inspect(call)).case.revision),decision:'retain_delivered_benefit'});
  assert.equal(result.case.resolved,true); assert.doesNotMatch(JSON.stringify(result),/fixture-private|GPA\./);
});

test('private support audit is excluded from native status/export and erased with the account',async t=>{
  const call=await runtime(t);
  await call('/seed',{['account:'+id(1)]:account(),fixture:{receipt}});
  await call('/api/referral-months/support-review',request((await inspect(call)).case.revision));
  const user={accountId:id(1),principal:{id:id(1),authTime:Date.now()/1000},trustedIP:'fixture'};
  const exported=await call('/account-export',user);
  assert.doesNotMatch(JSON.stringify(exported),/supportHistory|sourceFingerprint|revision|sourceEvidence/);
  await call('/account-delete',user);
  await call('/api/referral-months/support-case',{accountId:id(1),rewardId:id(101)},404);
  assert.equal((await call('/api/referral-months/support-cases')).cases.length,0);
});

test('concurrent deletion or changed evidence rejects a late Store response and preserves newer data',async t=>{
  const call=await runtime(t);
  for(const deleted of [false,true]) {
    await call('/seed',{['account:'+id(1)]:account(),fixture:{pause:true,receipt},calls:0});
    const body=request((await inspect(call)).case.revision);
    const pending=call('/api/referral-months/support-review',body,409);
    // Await the fixture signal with bounded event-loop checks, no external traffic.
    for(let i=0;i<100;i++) {if((await call('/started')).started) break; await new Promise(r=>setTimeout(r,1));}
    const changed=deleted?{id:id(1),recoverable:true,deletedAt:now}:account();
    if(!deleted) changed.rewards[0].sourceReview={status:'revoked',checkedAt:now+1};
    await call('/seed',{['account:'+id(1)]:changed}); await call('/release'); await pending;
    assert.deepEqual((await call('/snapshot'))['account:'+id(1)],changed);
  }
});

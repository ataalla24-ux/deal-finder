import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from 'miniflare';
import { ReferralMonthsLedger, handleReferralMonths, referralHash } from '../src/referral-months.js';
import { bundledAuth } from './bundled-auth.js';

const DAY = 86400000, now = Date.now(), start = now - 60 * DAY;
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const key = n => 'account:' + id(n);
const product = 'com.stefanataalla.freefinderwien.premium.monthly';
const reward = (n, state = 'earned') => ({ id: id(n + 100), state, months: 1, createdAt: start,
  sourceEvidence: { version: 1, platform: 'ios', accountId: id(90), purchaseKey: 'ios:' + (10000000 + n),
    receiptId: String(10000000 + n), productId: product, purchasedAt: start, periodEnd: start + 30 * DAY, verifiedAt: start },
});
const account = (n, rewards = []) => ({ id: id(n), code: 'RM-' + String(n).padStart(24, '0'), recoverable: true,
  email: 'fixture@example.test', preferences: {dealEmails:false}, consentEvents: [], rewards });
const receipt = n => ({ bundleId: 'com.stefanataalla.freefinderwien', environment: 'Production',
  transactionId: String(10000000 + n), originalTransactionId: String(10000000 + n), productId: product,
  appAccountToken: id(90), purchaseDate: start, originalPurchaseDate: start, expiresDate: start + 30 * DAY,
  offerType: 1, offerDiscountType: 'FREE_TRIAL' });
const flags = {REFERRAL_MONTHS_ENABLED:'1', REFERRAL_RECONCILIATION_ENABLED:'1'};

async function runtime(t, bindings = flags) {
  const source = await readFile(new URL('../src/referral-months.js', import.meta.url), 'utf8');
  const mf = new Miniflare(convertV4MiniflareOptions({ compatibilityDate:'2026-03-09',
    modules: [{type:'ESModule',path:'runtime.js',contents:`
      import { ReferralMonthsLedger } from './ledger.js';
      export class TestLedger extends ReferralMonthsLedger {
        async sourcePurchase(evidence) {
          const fixture = await this.storage.get('fixture') || {};
          const calls = await this.storage.get('calls') || [];
          calls.push(evidence.receiptId); await this.storage.put('calls', calls);
          if (fixture.pause) {
            const paused = new Promise(resolve => { this.release = resolve; });
            this.hasStarted = true; this.started?.();
            await paused;
          }
          if (fixture.outage) throw Error('private upstream failure');
          return fixture.receipts?.[evidence.receiptId];
        }
        async deferPlay() { throw Error('Reconciliation must never invoke a financial operation'); }
        async fetch(request) {
          const path = new URL(request.url).pathname;
          if (path === '/seed') { await this.storage.put(await request.json()); return Response.json({ok:true}); }
          if (path === '/run') return Response.json(await this.reconcileSources((await request.json()).now));
          if (path === '/alarm') { await super.alarm(); return Response.json({alarm:await this.storage.getAlarm()}); }
          if (path === '/started') {
            if (!this.hasStarted) await new Promise(resolve => { this.started = resolve; });
            return Response.json({ok:true});
          }
          if (path === '/release') { this.release?.(); return Response.json({ok:true}); }
          if (path === '/snapshot') return Response.json(Object.fromEntries(await this.storage.list()));
          if (path === '/status') return Response.json(this.status(await this.storage.get((await request.json()).key)));
          return super.fetch(request);
        }
      }
      export default {fetch(request, env) { return env.LEDGER.get(env.LEDGER.idFromName('fixture')).fetch(request); }};
    `}, {type:'ESModule',path:'ledger.js',contents:source}, await bundledAuth('account-auth.js')],
    durableObjects:{LEDGER:{className:'TestLedger',useSQLite:true}}, bindings, log:new Log(LogLevel.NONE),
  }));
  t.after(() => mf.dispose());
  return async (path, body) => {
    const response = await mf.dispatchFetch('https://fixture' + path,
      body === undefined ? {} : {method:'POST',body:JSON.stringify(body)});
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
}

test('disabled reconciliation performs no account scan, Store lookup or scheduling', async () => {
  for (const env of [{}, {...flags,REFERRAL_MONTHS_ENABLED:'0'}, {...flags,REFERRAL_RECONCILIATION_ENABLED:'0'}]) {
    const ledger = new ReferralMonthsLedger({storage:new Proxy({}, {get() { assert.fail('disabled audit touched storage'); }})}, env);
    assert.deepEqual(await ledger.reconcileSources(now), {checked:0,nextAt:null});
  }
});

test('disabled background audit retains existing rate cleanup without changing account records', async t => {
  const call = await runtime(t, {...flags,REFERRAL_RECONCILIATION_ENABLED:'0'});
  const original = account(1,[reward(1)]);
  await call('/seed', {[key(1)]:original,'rate:expired':{at:Date.now()-120000,count:1},
    'rate:current':{at:Date.now(),count:2}});
  const before = Date.now();
  const result = await call('/alarm');
  assert.ok(result.alarm >= before+120000 && result.alarm < before+180000);
  const snapshot = await call('/snapshot');
  assert.equal(snapshot['rate:expired'],undefined);
  assert.equal(snapshot['rate:current'].count,2);
  assert.deepEqual(snapshot[key(1)],original);
  assert.equal(snapshot['referral-source-scan:v1'],undefined);
  assert.equal(snapshot.calls,undefined);
});

test('background audit uses exact Google order evidence and leaves redeemed Play benefits unchanged', async t => {
  const call = await runtime(t);
  const token = 'synthetic-google-order-token';
  const google = reward(1,'redeemed');
  google.sourceEvidence = {...google.sourceEvidence,platform:'android',receiptId:'GPA.1111-2222-3333-44444',
    productId:'freefinder.pro.monthly',purchaseKey:'android:' + await referralHash(token)};
  Object.assign(google,{redemptionPlatform:'android',newExpiry:now+DAY,redeemedAt:now-DAY});
  const order = {orderId:google.sourceEvidence.receiptId,purchaseToken:token,state:'REFUNDED',
    orderHistory:{refundEvent:{eventTime:new Date(now-DAY).toISOString()}},
    lineItems:[{productId:'freefinder.pro.monthly',subscriptionDetails:{
      servicePeriodStartTime:new Date(start).toISOString(),servicePeriodEndTime:new Date(start+30*DAY).toISOString(),
      offerPhaseDetails:{freeTrialDetails:{}},
    }}]};
  await call('/seed', {[key(1)]:account(1,[google]),fixture:{receipts:{[order.orderId]:order}}});
  assert.equal((await call('/run',{now})).revoked,1);
  const stored = (await call('/snapshot'))[key(1)].rewards[0];
  const {sourceReview,reconciliation,...preserved} = stored;
  assert.equal(sourceReview.status,'revoked'); assert.equal(reconciliation.status,'manual_review');
  assert.deepEqual(preserved,google);
  assert.ok(!JSON.stringify(stored).includes(token));
});

test('daily source audit keeps earned, pending and redeemed balances intact and review metadata private', async t => {
  const call = await runtime(t);
  const original = account(1, [reward(1), reward(2, 'store_pending'), reward(3, 'redeemed')]);
  original.rewards[1].expectedExpiry = now + DAY;
  original.rewards[1].redemptionPlatform = 'android';
  original.rewards[2].redeemedAt = now - DAY;
  await call('/seed', {[key(1)]:original, fixture:{receipts:{
    [receipt(1).transactionId]:receipt(1),
    [receipt(2).transactionId]:{...receipt(2),revocationDate:now - DAY},
    [receipt(3).transactionId]:{...receipt(3),revocationDate:now - DAY},
  }}});
  const before = await call('/status', {key:key(1)});
  const first = await call('/run', {now});
  assert.equal(first.checked, 2); assert.equal(first.verified, 1); assert.equal(first.revoked, 1);
  assert.equal(first.nextAt, now + 120000);
  assert.equal((await call('/run', {now:now+1})).checked, 0);
  const second = await call('/run', {now:first.nextAt});
  assert.equal(second.checked, 1); assert.equal(second.revoked, 1);
  const audit = await call('/reconciliation-status', {});
  assert.deepEqual(audit.lastCompleted, {at:first.nextAt,checked:3,verified:1,revoked:2,unverified:0,skipped:0});
  assert.equal(audit.nextAt, second.nextAt); assert.equal(audit.inProgress, false);
  assert.doesNotMatch(JSON.stringify(audit), /sourceEvidence|account:|1000000|example.test|runId/);
  const snapshot = await call('/snapshot');
  assert.deepEqual(snapshot.calls, ['10000001','10000002','10000003']);
  const stored = snapshot[key(1)];
  assert.deepEqual(stored.rewards.map(x => x.state), ['earned','store_pending','redeemed']);
  assert.deepEqual(stored.rewards.map(x => x.reconciliation.status), ['verified','manual_review','manual_review']);
  for (const [i, item] of stored.rewards.entries()) {
    const {sourceReview, reconciliation, ...preserved} = item;
    assert.deepEqual(preserved, original.rewards[i]);
  }
  assert.deepEqual(await call('/status', {key:key(1)}), before);
  const exported = await call('/account-export', {accountId:id(1),principal:{id:id(1),authTime:Date.now()/1000},trustedIP:'fixture'});
  assert.doesNotMatch(JSON.stringify(exported), /sourceEvidence|sourceReview|reconciliation|10000001/);
});

test('legacy missing proof and Store outages are unverified, never treated as a revocation', async t => {
  const call = await runtime(t);
  const legacy = reward(1); delete legacy.sourceEvidence;
  await call('/seed', {[key(1)]:account(1,[legacy,reward(2)]),fixture:{outage:true}});
  const result = await call('/run', {now});
  assert.equal(result.unverified, 2); assert.equal(result.revoked, 0);
  const snapshot = await call('/snapshot');
  assert.deepEqual(snapshot.calls, ['10000002'], 'missing historical proof must not cause a guessed lookup');
  assert.deepEqual(snapshot[key(1)].rewards.map(x => [x.state,x.months,x.sourceReview.status]),
    [['earned',1,'unverified'],['earned',1,'unverified']]);
});

test('bounded account pagination skips deleted/empty profiles and persists the scan between invocations', async t => {
  const call = await runtime(t);
  const records = Object.fromEntries(Array.from({length:21}, (_, i) => [key(i+1), account(i+1)]));
  records[key(5)] = {id:id(5),deletedAt:now-1,recoverable:true};
  records[key(21)].rewards = [reward(1)];
  records.fixture = {receipts:{'10000001':receipt(1)}};
  await call('/seed', records);
  const first = await call('/run', {now});
  assert.equal(first.checked, 0); assert.equal(first.nextAt, now+120000);
  assert.equal((await call('/snapshot'))['referral-source-scan:v1'].after, key(20));
  const second = await call('/run', {now:first.nextAt});
  assert.equal(second.checked, 1); assert.equal(second.nextAt, first.nextAt+DAY);
  assert.equal((await call('/snapshot'))['referral-source-scan:v1'].after, undefined);
});

test('a later authoritative reversal clears manual review without replaying or changing the reward', async t => {
  const call = await runtime(t);
  await call('/seed', {[key(1)]:account(1,[reward(1,'redeemed')]),
    fixture:{receipts:{'10000001':{...receipt(1),revocationDate:now-1}}}});
  assert.equal((await call('/run', {now})).revoked, 1);
  await call('/seed', {fixture:{receipts:{'10000001':receipt(1)}}});
  assert.equal((await call('/run', {now:now+DAY})).verified, 1);
  const stored = (await call('/snapshot'))[key(1)].rewards[0];
  assert.equal(stored.reconciliation.status, 'verified'); assert.equal(stored.state, 'redeemed');
});

test('background checks preserve concurrent account edits and a newer foreground proof review', async t => {
  const call = await runtime(t);
  const original = account(1,[reward(1)]);
  await call('/seed', {[key(1)]:original,fixture:{pause:true,receipts:{'10000001':{...receipt(1),revocationDate:now-1}}}});
  const pending = call('/run', {now});
  await call('/started');
  try {
    const changed = structuredClone(original);
    changed.preferences.dealEmails = true;
    changed.rewards[0].state = 'redeemed';
    changed.rewards[0].sourceReview = {status:'verified',checkedAt:now+1};
    await call('/seed', {[key(1)]:changed});
    assert.equal((await call('/run', {now:now+2})).checked, 0, 'active lease excludes another batch');
  } finally { await call('/release'); }
  assert.equal((await pending).skipped, 1);
  const stored = (await call('/snapshot'))[key(1)];
  assert.equal(stored.preferences.dealEmails, true);
  assert.equal(stored.rewards[0].state, 'redeemed');
  assert.deepEqual(stored.rewards[0].sourceReview, {status:'verified',checkedAt:now+1});
});

test('an in-flight Store response cannot restore a deleted account', async t => {
  const call = await runtime(t);
  await call('/seed', {[key(1)]:account(1,[reward(1)]),fixture:{pause:true,receipts:{'10000001':receipt(1)}}});
  const pending = call('/run', {now});
  await call('/started');
  try {
    await call('/account-delete', {accountId:id(1),principal:{id:id(1),authTime:Date.now()/1000},trustedIP:'fixture'});
  } finally { await call('/release'); }
  assert.equal((await pending).skipped, 1);
  const stored = (await call('/snapshot'))[key(1)];
  assert.ok(stored.deletedAt); assert.equal(stored.email, undefined); assert.equal(stored.rewards, undefined);
});

test('audit merge preserves concurrent preferences and pending Store state without making a financial call', async t => {
  const call = await runtime(t);
  const original = account(1,[reward(1)]);
  await call('/seed', {[key(1)]:original,fixture:{pause:true,receipts:{'10000001':receipt(1)}}});
  const pending = call('/run', {now});
  await call('/started');
  try {
    original.preferences.dealEmails = true;
    Object.assign(original.rewards[0], {state:'store_pending',redemptionPlatform:'android',expectedExpiry:now+DAY});
    await call('/seed', {[key(1)]:original});
  } finally { await call('/release'); }
  assert.equal((await pending).verified, 1);
  const stored = (await call('/snapshot'))[key(1)];
  assert.equal(stored.preferences.dealEmails, true);
  assert.equal(stored.rewards[0].state, 'store_pending');
  assert.equal(stored.rewards[0].expectedExpiry, now+DAY);
  assert.equal(stored.rewards[0].sourceReview.status, 'verified');
});

test('changed evidence and replaced scan leases reject stale audit results', async t => {
  for (const change of ['evidence','lease']) {
    await t.test(change, async t => {
      const call = await runtime(t);
      const original = account(1,[reward(1)]);
      await call('/seed', {[key(1)]:original,fixture:{pause:true,receipts:{'10000001':receipt(1)}}});
      const pending = call('/run', {now});
      await call('/started');
      try {
        if (change === 'evidence') {
          original.rewards[0].sourceEvidence = reward(2).sourceEvidence;
          await call('/seed', {[key(1)]:original});
        } else await call('/seed', {'referral-source-scan:v1':{runId:'replacement',leaseUntil:now+60000}});
      } finally { await call('/release'); }
      assert.equal((await pending).skipped, 1);
      const snapshot = await call('/snapshot');
      assert.equal(snapshot[key(1)].rewards[0].sourceReview, undefined);
      if (change === 'lease') assert.equal(snapshot['referral-source-scan:v1'].runId, 'replacement');
    });
  }
});

test('a background alarm preserves an earlier cleanup alarm scheduled by a concurrent account request', async t => {
  const call = await runtime(t);
  await call('/seed', {[key(1)]:account(1,[reward(1)]),fixture:{pause:true,receipts:{'10000001':receipt(1)}}});
  const pending = call('/alarm');
  await call('/started');
  const before = Date.now();
  try {
    await call('/account-profile', {accountId:id(1),principal:{id:id(1),email:'fixture@example.test'},trustedIP:'fixture'});
  } finally { await call('/release'); }
  const scheduled = (await pending).alarm;
  assert.ok(scheduled >= before+120000 && scheduled < before+180000);
});

test('expired scan leases recover after a restart, and enabled alarms schedule the next bounded audit', async t => {
  const call = await runtime(t);
  await call('/seed', {[key(1)]:account(1,[reward(1)]),fixture:{receipts:{'10000001':receipt(1)}},
    'referral-source-scan:v1':{runId:'old-run',leaseUntil:now-1}});
  assert.equal((await call('/run', {now})).verified, 1);
  const result = await call('/alarm');
  assert.equal(result.alarm, now+DAY);
});

test('audit status is admin-only and cannot be opened with an ordinary account or forged body', async () => {
  let dispatched = 0;
  const env = {REFERRAL_ADMIN_SECRET:'test-admin',REFERRAL_MONTHS:{idFromName:x=>x,get:()=>({fetch:async request=>{
    dispatched++;
    assert.equal(new URL(request.url).pathname, '/reconciliation-status');
    assert.equal((await request.json()).principal, undefined);
    return Response.json({ok:true});
  }})}};
  for (const secret of [null,'wrong','test-admin']) {
    const request = new Request('https://test/api/referral-months/reconciliation-status', {method:'POST',
      headers:{'content-type':'application/json',...(secret ? {'x-freefinder-merchant-secret':secret} : {})},
      body:JSON.stringify({principal:{id:id(1)},platform:'ios'})});
    const response = await handleReferralMonths(request,env,async()=>assert.fail('admin status must not accept user authentication'));
    assert.equal(response.status,secret === 'test-admin' ? 200 : 403);
  }
  assert.equal(dispatched,1);
  const missingSecret = await handleReferralMonths(new Request('https://test/api/referral-months/reconciliation-status',
    {method:'POST',headers:{'content-type':'application/json'},body:'{}'}),{...env,REFERRAL_ADMIN_SECRET:undefined});
  assert.equal(missingSecret.status,403); assert.equal(dispatched,1);
});

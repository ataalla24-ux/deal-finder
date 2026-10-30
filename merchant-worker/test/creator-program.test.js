import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from 'miniflare';
import { workerBundleOptions } from './bundled-apple-claims.js';
import {
  creatorAppleEvidence, creatorCode, creatorCommission, creatorDrafts, creatorHash,
  creatorPlayEvidence, handleCreatorProgram,
} from '../src/creator-program.js';

const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 30, 12);
const START = Date.UTC(2024, 0, 1);
const OWNER = '11111111-1111-8111-8111-111111111111';
const OTHER = '22222222-2222-8222-8222-222222222222';
const TOKEN = 'fixture-private-purchase-token-never-public';
const ADMIN = 'fixture-admin-not-a-real-secret';
const APP = 'com.stefanataalla.freefinderwien';
const IOS = APP + '.premium.monthly';
const PLAY = 'freefinder.pro.monthly';
const HASH = 'a'.repeat(64);
const approvals = { termsApproved: true, transportReady: true, releasesVerified: true, maxPartners: 5, holdDays: 30 };
const status = expected => error => error.status === expected;

function partner(index = 0, patch = {}) {
  const draft = creatorDrafts()[index];
  return { ...draft, state: 'active', acceptsNew: true, storeVerified: true,
    contractRef: 'fixture-contract-' + draft.id, appleOfferId: draft.id + '.apple',
    playOfferId: draft.id + '-play', activatedAt: START, ...patch };
}
function apple(patch = {}) {
  return { environment: 'Production', bundleId: APP, productId: IOS,
    transactionId: '100000001', originalTransactionId: '100000000',
    purchaseDate: NOW - DAY, originalPurchaseDate: NOW - DAY, expiresDate: NOW + 29 * DAY,
    currency: 'EUR', storefront: 'AUT', price: 3990, inAppOwnershipType: 'PURCHASED',
    offerIdentifier: partner().appleOfferId, offerType: 3, appAccountToken: OWNER, ...patch };
}
function money(cents) {
  return { currencyCode: 'EUR', units: String(Math.floor(cents / 100)), nanos: cents % 100 * 10000000 };
}
function google() {
  return {
    purchase: { regionCode: 'AT', subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
      startTime: new Date(NOW - DAY).toISOString(),
      externalAccountIdentifiers: { obfuscatedExternalAccountId: OWNER },
      lineItems: [{ productId: PLAY, expiryTime: new Date(NOW + 29 * DAY).toISOString() }] },
    order: { orderId: 'GPA.0000-0000-0000-00001', state: 'PROCESSED', total: money(399),
      buyerAddress: { buyerCountry: 'AT' }, lineItems: [{ productId: PLAY, subscriptionDetails: {
        offerId: partner().playOfferId, basePlanId: 'monthly',
        servicePeriodStartTime: new Date(NOW - DAY).toISOString(),
        servicePeriodEndTime: new Date(NOW + 29 * DAY).toISOString(),
      } }] },
  };
}

test('draft pilot has exactly five separate inactive partners and two named codes', () => {
  const drafts = creatorDrafts();
  assert.equal(drafts.length, 5);
  assert.deepEqual(drafts.filter(p => p.code).map(p => [p.name, p.code]), [
    ['Foodiewien', 'FOODIEWIEN20'], ['Tastyfood', 'TASTYFOOD20'],
  ]);
  assert.equal(new Set(drafts.map(p => p.id)).size, 5);
  for (const p of drafts) {
    assert.equal(p.state, 'draft');
    assert.equal(p.acceptsNew, false);
    assert.equal(p.storeVerified, false);
    assert.equal(p.contractRef, null);
    assert.equal(p.appleOfferId, null);
    assert.equal(p.playOfferId, null);
    assert.equal(p.commissionBps, 3000);
    assert.equal(p.commissionVat, 'inclusive');
    assert.equal(p.discountedCents, 399);
    assert.equal(p.regularCents, 499);
    assert.equal(p.paidMonths, 12);
    assert.equal(p.commissionMonths, 12);
  }
  drafts[0].state = 'active';
  assert.equal(creatorDrafts()[0].state, 'draft');
});

test('codes normalize only bounded alphanumeric text', () => {
  assert.equal(creatorCode(' foodiewien20 '), 'FOODIEWIEN20');
  for (const value of [null, 20, {}, '', 'abc', 'x'.repeat(33), 'FOODIE-20', 'FOODIE/20', 'FOODIE\n20']) {
    assert.equal(creatorCode(value), null, JSON.stringify(value));
  }
});

for (const [gross, expected] of [[0, 0], [1, 0], [5, 2], [399, 120], [499, 150], [100000, 30000]]) {
  test(`commission uses exact integer 30% of customer gross ${gross} => ${expected} cents`, () => {
    assert.equal(creatorCommission(gross), expected);
  });
}
test('commission rejects untrusted, fractional, negative, unsafe or changed-rate amounts', () => {
  for (const value of [-1, 1.5, NaN, Infinity, 100001, Number.MAX_SAFE_INTEGER + 1, '399', null, undefined]) {
    assert.throws(() => creatorCommission(value), status(400));
  }
  assert.throws(() => creatorCommission(399, 3500), status(400));
});

for (const gross of [0, 399, 499]) {
  test(`Apple trusted monthly evidence retains ${gross} customer-paid cents`, () => {
    const e = creatorAppleEvidence(apple({ price: gross * 10 }), [partner()], NOW);
    assert.equal(e.grossCents, gross);
    assert.equal(e.refundedCents, 0);
    assert.equal(e.accountId, OWNER);
    assert.equal(e.key, 'ios:100000000');
    assert.equal(e.partnerId, 'foodiewien');
    assert.equal(creatorCommission(e.grossCents), gross === 0 ? 0 : gross === 399 ? 120 : 150);
  });
}

const badApple = [
  ['sandbox', { environment: 'Sandbox' }], ['Xcode/dev', { environment: 'Xcode' }],
  ['other app', { bundleId: 'other.app' }], ['annual product', { productId: APP + '.premium.yearly' }],
  ['foreign currency', { currency: 'USD' }], ['foreign storefront', { storefront: 'USA' }],
  ['family sharing', { inAppOwnershipType: 'FAMILY_SHARED' }],
  ['missing transaction', { transactionId: '' }], ['missing original', { originalTransactionId: '' }],
  ['wrong offer', { offerIdentifier: 'unrelated-offer' }], ['intro instead of creator offer', { offerType: 1 }],
  ['unapproved paid price', { price: 2990 }], ['negative price', { price: -10 }],
  ['fractional cents', { price: 3991 }], ['client-shaped price', { price: '3990' }],
  ['future payment', { purchaseDate: NOW + 2 * DAY }],
  ['old pre-pilot subscription', { originalPurchaseDate: START - DAY }],
  ['annual-length period', { expiresDate: NOW + 365 * DAY }],
  ['inverted period', { expiresDate: NOW - 2 * DAY }],
  ['future refund', { revocationDate: NOW + 2 * DAY }], ['malformed refund', { revocationDate: 'today' }],
];
for (const [name, patch] of badApple) {
  test('Apple rejects ' + name, () => {
    assert.throws(() => creatorAppleEvidence(apple(patch), [partner()], NOW), status(409));
  });
}
test('Apple first attribution rejects unverified or closed offers without a qualifying pre-close origin', () => {
  for (const patch of [{ state: 'draft' }, { state: 'paused' }, { state: 'ended' },
    { acceptsNew: false }, { storeVerified: false }, { contractRef: null }, { redeemUntil: NOW - 2 * DAY }]) {
    assert.throws(() => creatorAppleEvidence(apple(), [partner(0, patch)], NOW), status(409));
  }
});
test('Apple existing original chain permits renewal without offer ID after new intake closes', () => {
  const e = creatorAppleEvidence(apple({ offerIdentifier: undefined, offerType: undefined, price: 4990 }),
    [partner(0, { state: 'paused', acceptsNew: false })], NOW,
    { key: 'ios:100000000', partnerId: 'foodiewien' });
  assert.equal(e.grossCents, 499);
  assert.equal(e.partnerId, 'foodiewien');
  assert.throws(() => creatorAppleEvidence(apple(), [partner()], NOW,
    { key: 'ios:another-original', partnerId: 'foodiewien' }), status(409));
});
test('Apple full refund reverses only the authenticated customer-paid gross', () => {
  const e = creatorAppleEvidence(apple({ revocationDate: NOW }), [partner()], NOW);
  assert.equal(e.refundedCents, 399);
  assert.equal(creatorCommission(e.refundedCents), 120);
});

for (const [percentage, refunded] of [[0, 0], [25000, 100], [40000, 160], [75000, 299], [100000, 399]]) {
  test(`Apple prorated refund ${percentage} milli-percent resolves unambiguously to ${refunded} cents`, () => {
    const e = creatorAppleEvidence(apple({ revocationDate: NOW, revocationType: 'REFUND_PRORATED',
      revocationPercentage: percentage }), [partner()], NOW);
    assert.equal(e.refundedCents, refunded);
    assert.equal(e.grossCents, 399);
  });
}
test('Apple rounded 50% refund is ambiguous for odd gross cents and requires manual finance', () => {
  for (const gross of [399, 499]) {
    assert.throws(() => creatorAppleEvidence(apple({ price: gross * 10, revocationDate: NOW,
      revocationType: 'REFUND_PRORATED', revocationPercentage: 50000 }), [partner()], NOW),
    error => error.status === 409 && /Finanzabgleich/.test(error.message));
  }
});
test('Apple prorated percentages must be integers in inclusive range 0..100000', () => {
  for (const percentage of [-1, 100001, 40000.5, '40000', NaN, Infinity, null, undefined]) {
    assert.throws(() => creatorAppleEvidence(apple({ revocationDate: NOW, revocationType: 'REFUND_PRORATED',
      revocationPercentage: percentage }), [partner()], NOW), status(409));
  }
});
test('Apple explicit full refunds allow only absent or complete percentage', () => {
  for (const percentage of [undefined, 100000]) {
    const e = creatorAppleEvidence(apple({ price: 4990, revocationDate: NOW, revocationType: 'REFUND_FULL',
      revocationPercentage: percentage }), [partner()], NOW);
    assert.equal(e.refundedCents, 499);
  }
  for (const percentage of [0, 40000, '100000']) {
    assert.throws(() => creatorAppleEvidence(apple({ revocationDate: NOW, revocationType: 'REFUND_FULL',
      revocationPercentage: percentage }), [partner()], NOW), status(409));
  }
});
for (const revocationType of ['FAMILY', 'ASSIGNMENT', 'UNKNOWN']) {
  test(`Apple ${revocationType} revocation must not be treated as a financial refund`, () => {
    assert.throws(() => creatorAppleEvidence(apple({ revocationDate: NOW, revocationType }), [partner()], NOW), status(409));
  });
}
test('Apple refund metadata without a revocation date is contradictory evidence', () => {
  for (const patch of [{ revocationType: 'REFUND_FULL' }, { revocationType: 'REFUND_PRORATED', revocationPercentage: 40000 },
    { revocationPercentage: 40000 }]) {
    assert.throws(() => creatorAppleEvidence(apple(patch), [partner()], NOW), status(409));
  }
});

for (const gross of [0, 399, 499]) {
  test(`Google final VAT-inclusive order total supplies ${gross} cents, not a listing price`, () => {
    const { purchase, order } = google();
    order.total = money(gross);
    order.lineItems[0].listingPrice = money(9999);
    const e = creatorPlayEvidence(purchase, order, HASH, [partner()], NOW);
    assert.equal(e.grossCents, gross);
    assert.equal(e.key, 'android:' + HASH);
    assert.equal(e.accountId, OWNER);
  });
}
const badGoogle = [
  ['test purchase', f => { f.purchase.testPurchase = {}; }],
  ['foreign subscription', f => { f.purchase.regionCode = 'DE'; }],
  ['foreign buyer', f => { f.order.buyerAddress.buyerCountry = 'DE'; }],
  ['missing buyer country', f => { delete f.order.buyerAddress; }],
  ['foreign total', f => { f.order.total.currencyCode = 'USD'; }],
  ['annual purchase', f => { f.purchase.lineItems[0].productId = 'freefinder.pro.yearly'; }],
  ['mismatched order product', f => { f.order.lineItems[0].productId = 'another.product'; }],
  ['extra purchased item', f => { f.purchase.lineItems.push(f.purchase.lineItems[0]); }],
  ['extra order item', f => { f.order.lineItems.push(f.order.lineItems[0]); }],
  ['unpaid order', f => { f.order.state = 'PENDING'; }],
  ['missing order ID', f => { delete f.order.orderId; }],
  ['forged account identifier', f => { f.purchase.externalAccountIdentifiers.obfuscatedExternalAccountId = 'not-an-account'; }],
  ['wrong offer', f => { f.order.lineItems[0].subscriptionDetails.offerId = 'wrong'; }],
  ['wrong base plan', f => { f.order.lineItems[0].subscriptionDetails.basePlanId = 'annual'; }],
  ['linked old subscription', f => { f.purchase.linkedPurchaseToken = 'old-token'; }],
  ['annual service period', f => { f.order.lineItems[0].subscriptionDetails.servicePeriodEndTime = new Date(NOW + 365 * DAY).toISOString(); }],
  ['future service period', f => { f.order.lineItems[0].subscriptionDetails.servicePeriodStartTime = new Date(NOW + 2 * DAY).toISOString(); }],
  ['unapproved price', f => { f.order.total = money(299); }],
  ['fractional cents', f => { f.order.total.nanos = 990000001; }],
  ['negative money', f => { f.order.total.units = '-4'; }],
  ['pending partial refund', f => { f.order.orderHistory = { partialRefundEvents: [{ state: 'PENDING', refundDetails: { total: money(100) } }] }; }],
  ['refund exceeds payment', f => { f.order.orderHistory = { partialRefundEvents: [{ state: 'PROCESSED_SUCCESSFULLY', refundDetails: { total: money(400) } }] }; }],
];
for (const [name, change] of badGoogle) {
  test('Google rejects ' + name, () => {
    const f = google(); change(f);
    assert.throws(() => creatorPlayEvidence(f.purchase, f.order, HASH, [partner()], NOW), status(409));
  });
}
test('Google rejects an untrusted raw token in place of its hashed chain identifier', () => {
  const f = google();
  assert.throws(() => creatorPlayEvidence(f.purchase, f.order, TOKEN, [partner()], NOW), status(409));
});
test('Google existing chain permits offer-less regular renewal after new intake closes', () => {
  const f = google();
  delete f.order.lineItems[0].subscriptionDetails.offerId;
  f.order.total = money(499);
  const e = creatorPlayEvidence(f.purchase, f.order, HASH,
    [partner(0, { state: 'paused', acceptsNew: false })], NOW,
    { key: 'android:' + HASH, partnerId: 'foodiewien' });
  assert.equal(e.grossCents, 499);
  assert.equal(e.partnerId, 'foodiewien');
});
test('Google existing attribution cannot authorize a different purchase-token chain', () => {
  const f = google();
  assert.throws(() => creatorPlayEvidence(f.purchase, f.order, 'b'.repeat(64), [partner()], NOW,
    { key: 'android:' + HASH, partnerId: 'foodiewien' }), status(409));
});
test('Google processed partial refunds sum actual cents and full refunds take precedence', () => {
  const f = google();
  f.order.total = money(499);
  f.order.orderHistory = { partialRefundEvents: [100, 99].map(cents => ({
    state: 'PROCESSED_SUCCESSFULLY', refundDetails: { total: money(cents) },
  })) };
  assert.equal(creatorPlayEvidence(f.purchase, f.order, HASH, [partner()], NOW).refundedCents, 199);
  f.order.state = 'REFUNDED';
  assert.equal(creatorPlayEvidence(f.purchase, f.order, HASH, [partner()], NOW).refundedCents, 499);
});

function apiRequest(action, body = {}, options = {}) {
  const method = options.method || (['config', 'admin/partners', 'admin/summary'].includes(action) ? 'GET' : 'POST');
  return new Request('https://fixture.invalid/api/creators/' + action, {
    method, headers: { 'content-type': 'application/json', ...options.headers },
    ...(method === 'GET' ? {} : { body: options.raw ?? JSON.stringify(body) }),
  });
}
function forwardingEnv(patch = {}) {
  const forwarded = [];
  return { forwarded, env: {
    CREATOR_PROGRAM_ENABLED: '1', MERCHANT_PROMO_ADMIN_SECRET: ADMIN,
    ACCOUNTS_ENABLED: '1', FIREBASE_PROJECT_ID: 'fixture-project', FIREBASE_WEB_API_KEY: 'fixture-key',
    CREATOR_PROGRAM: { idFromName: name => name, get: name => ({ fetch: async request => {
      forwarded.push({ name, path: new URL(request.url).pathname, method: request.method,
        body: request.method === 'GET' ? null : await request.json() });
      return Response.json({ ok: true });
    } }) }, ...patch,
  } };
}
test('public default disabled short-circuits auth, ledger and every Store call', async () => {
  for (const flag of [undefined, '0', 'true']) {
    const { env, forwarded } = forwardingEnv({ CREATOR_PROGRAM_ENABLED: flag });
    let authenticated = 0;
    const auth = async () => { authenticated++; throw Error('must not authenticate'); };
    const config = await handleCreatorProgram(apiRequest('config'), env, auth);
    assert.deepEqual(await config.json(), { ok: true, enabled: false });
    for (const action of ['quote', 'confirm']) {
      const response = await handleCreatorProgram(apiRequest(action, { platform: 'ios' }), env, auth);
      assert.equal(response.status, 503);
    }
    assert.equal(authenticated, 0);
    assert.equal(forwarded.length, 0);
  }
});
test('handler replaces forged principal with authenticated account identity', async () => {
  const { env, forwarded } = forwardingEnv();
  const response = await handleCreatorProgram(apiRequest('confirm', {
    platform: 'ios', transactionId: '100000001', principal: { id: OTHER }, accountId: OTHER,
    grossCents: 99999, commissionCents: 99999,
  }), env, async () => ({ id: OWNER, email: 'fixture@example.test', providers: ['password'] }));
  assert.equal(response.status, 200);
  assert.equal(forwarded.length, 1);
  assert.deepEqual(forwarded[0].body.principal, { id: OWNER });
  assert.equal(forwarded[0].path, '/confirm');
});
test('real auth rejects absent bearer and malformed JWT without forwarding to a ledger', async () => {
  for (const token of ['', 'Bearer bad', 'Bearer ' + 'x'.repeat(110),
    'Bearer eyJhbGciOiJub25lIn0.' + 'x'.repeat(100) + '.']) {
    const { env, forwarded } = forwardingEnv();
    const response = await handleCreatorProgram(apiRequest('confirm', { platform: 'ios', principal: { id: OWNER } },
      { headers: { authorization: token } }), env);
    assert.equal(response.status, 401);
    assert.equal(forwarded.length, 0);
  }
});
test('admin routes require exact admin bearer, never account JWT or body principal', async () => {
  const actions = ['admin/partners', 'admin/summary', 'admin/seed', 'admin/settings', 'admin/partner',
    'admin/reconcile', 'admin/statement', 'admin/paid', 'admin/adjust-refund'];
  for (const action of actions) {
    for (const authorization of ['', 'Bearer fixture-account-jwt', 'Bearer ' + ADMIN + '-suffix']) {
      const { env, forwarded } = forwardingEnv();
      const response = await handleCreatorProgram(apiRequest(action, { principal: { id: OWNER } },
        { headers: { authorization } }), env, async () => { throw Error('admin must not use account auth'); });
      assert.equal(response.status, 401, action);
      assert.equal(forwarded.length, 0);
    }
  }
  const { env, forwarded } = forwardingEnv();
  assert.equal((await handleCreatorProgram(apiRequest('admin/partners', {},
    { headers: { authorization: 'Bearer ' + ADMIN } }), env)).status, 200);
  assert.equal(forwarded.length, 1);
  const absent = forwardingEnv({ MERCHANT_PROMO_ADMIN_SECRET: undefined });
  assert.equal((await handleCreatorProgram(apiRequest('admin/partners'), absent.env)).status, 503);
  assert.equal(absent.forwarded.length, 0);
});

const malformed = [
  ['wrong method', 'config', {}, { method: 'POST' }, 405],
  ['unknown route', 'unknown', {}, {}, 404],
  ['array', 'quote', {}, { raw: '[]' }, 400],
  ['null', 'quote', {}, { raw: 'null' }, 400],
  ['scalar', 'quote', {}, { raw: '123' }, 400],
  ['broken JSON', 'quote', {}, { raw: '{"code":' }, 400],
  ['oversized JSON', 'quote', { code: 'x'.repeat(16001) }, {}, 413],
  ['wrong media type', 'quote', {}, { headers: { 'content-type': 'text/plain' } }, 415],
  ['invalid platform', 'confirm', { platform: 'desktop' }, {}, 400],
];
for (const [name, action, body, options, expected] of malformed) {
  test('public API rejects ' + name + ' before ledger mutation', async () => {
    const { env, forwarded } = forwardingEnv();
    const response = await handleCreatorProgram(apiRequest(action, body, options), env, async () => ({ id: OWNER }));
    assert.equal(response.status, expected);
    assert.equal(forwarded.length, 0);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });
}
for (const httpStatus of [undefined, 503]) {
  test(`public auth errors never echo raw tokens, including status=${httpStatus}`, async () => {
    const { env } = forwardingEnv();
    const response = await handleCreatorProgram(apiRequest('confirm', { platform: 'android', purchaseToken: TOKEN }), env,
      async () => { throw Object.assign(Error('provider failed for ' + TOKEN), httpStatus ? { status: httpStatus } : {}); });
    assert.equal(response.status, 503);
    assert.equal((await response.text()).includes(TOKEN), false);
  });
}

// Only this in-memory test entry can inject trusted Store responses or control ledger time.
// Production fetch, evidence functions and all transactional accounting remain unchanged.
let runtimePromise;
let sequence = 0;
const outbound = [];
async function runtime() {
  if (!runtimePromise) runtimePromise = (async () => {
    const bundled = await build({ ...workerBundleOptions, stdin: {
      resolveDir: fileURLToPath(new URL('..', import.meta.url)), contents: `
        import { CreatorProgramLedger, creatorAppleEvidence, creatorPlayEvidence, creatorHash,
          handleCreatorProgram } from './src/creator-program.js';
        export class FixtureLedger extends CreatorProgramLedger {
          constructor(ctx, env) { super(ctx, {...env}); }
          async verifyAppleNotification(body) {
            await this.storage.transaction(async tx => {
              await tx.put('fixture:apple-proof-checks', (await tx.get('fixture:apple-proof-checks') || 0) + 1);
            });
            const trusted = await this.storage.get('fixture:apple-proof');
            if (!trusted) return super.verifyAppleNotification(body);
            if (body.signedPayload !== trusted.signedPayload) {
              throw Object.assign(Error('Unverified fixture Apple notification'), {status:401});
            }
            return trusted.proof;
          }
          async verify(body, partners, existing) {
            await this.storage.transaction(async tx => {
              await tx.put('fixture:verify-count', (await tx.get('fixture:verify-count') || 0) + 1);
            });
            const token = body.platform === 'android' ? body.purchaseToken : body.transactionId;
            const f = await this.storage.get('fixture:receipt:' + token);
            if (!f) throw Object.assign(Error('Missing trusted fixture'), {status:409});
            if (body.reconcile && f.verifyHook) {
              const run = await this.storage.transaction(async tx => {
                const key = 'fixture:verify-hook:' + f.verifyHook.id;
                if (await tx.get(key)) return false;
                await tx.put(key, true);
                await tx.put('fixture:verify-hook-count', (await tx.get('fixture:verify-hook-count') || 0) + 1);
                return true;
              });
              if (run) {
                for (const booking of f.verifyHook.bookings || []) {
                  await this.book(booking.evidence, booking.privateToken || null, booking.now);
                }
                const last = f.verifyHook.bookings?.at(-1);
                if (last) await this.storage.put('fixture:verify-hook-chain:' + f.verifyHook.id,
                  await this.storage.get('chain:' + last.evidence.key));
              }
            }
            if (f.error) throw Object.assign(Error(f.error), f.status ? {status:f.status} : {});
            const entries = [];
            for (const source of f.entries || [f]) {
              const key = body.platform === 'android' ? 'android:' + await creatorHash(token) : 'ios:' + source.raw.originalTransactionId;
              const chain = existing || await this.storage.get('chain:' + key);
              entries.push(body.platform === 'ios'
                ? creatorAppleEvidence(source.raw, partners, source.now || f.now || Date.now(), chain)
                : creatorPlayEvidence(source.purchase, source.order, await creatorHash(token), partners, source.now || f.now || Date.now(), chain));
            }
            return Array.isArray(f.entries) ? entries : entries[0];
          }
          async fetch(request) {
            const path = new URL(request.url).pathname;
            if (path === '/__fixture') {
              const b = await request.json();
              try {
                if (b.op === 'put') { await this.storage.put(b.values); return Response.json({ok:true}); }
                if (b.op === 'inspect') return Response.json(Object.fromEntries(await this.storage.list()));
                if (b.op === 'sqlite') return Response.json(this.storage.sql.exec('SELECT 1 AS ready').toArray());
                if (b.op === 'env') {
                  for (const key of b.unset || []) delete this.env[key];
                  Object.assign(this.env, b.values); return Response.json({ok:true});
                }
                if (!['book','statement','markPaid','adjustRefund','reconcile','savePartner','summary','ready','notification'].includes(b.op)) {
                  return Response.json({error:'Unknown fixture operation'}, {status:400});
                }
                return Response.json({result: await this[b.op](...(b.args || []))});
              } catch (error) { return Response.json({error:error.message}, {status:error.status || 500}); }
            }
            return super.fetch(request);
          }
        }
        export default { async fetch(request, env) {
          const name = request.headers.get('x-fixture-ledger');
          if (!name) return new Response(null,{status:400});
          const stub = env.CREATOR_PROGRAM.get(env.CREATOR_PROGRAM.idFromName(name));
          if (new URL(request.url).pathname === '/__fixture') return stub.fetch(request);
          const bound = {...env, CREATOR_PROGRAM: {idFromName:n=>n,get:()=>stub}};
          return handleCreatorProgram(request, bound, async request => {
            if (request.headers.get('authorization') !== 'Bearer fixture-verified-account') {
              throw Object.assign(Error('Fixture account authentication required'),{status:401});
            }
            return {id:'${OWNER}'};
          });
        }};
      `,
    } });
    return new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-03-09',
      compatibilityFlags: ['nodejs_compat'], modules: true, script: bundled.outputFiles[0].text,
      durableObjects: { CREATOR_PROGRAM: { className: 'FixtureLedger', useSQLite: true } },
      bindings: { CREATOR_PROGRAM_ENABLED: '1', CREATOR_RECONCILIATION_ENABLED: '1',
        CREATOR_APPLE_NOTIFICATIONS_ENABLED: '1', MERCHANT_PROMO_ADMIN_SECRET: ADMIN },
      log: new Log(LogLevel.NONE), outboundService: async request => {
        outbound.push(new URL(request.url).host);
        return new Response('External network forbidden by creator-program tests', { status: 599 });
      },
    }));
  })();
  return runtimePromise;
}
after(async () => {
  if (runtimePromise) await (await runtimePromise).dispose();
  assert.deepEqual(outbound, [], 'No test may attempt an external Store, auth or other network call');
});

async function ledger() {
  const mf = await runtime();
  const name = 'creator-fixture-' + ++sequence;
  async function request(path, body, expected = 200, options = {}) {
    const method = options.method || 'POST';
    const response = await mf.dispatchFetch('https://fixture.invalid' + path, {
      method, headers: { 'content-type': 'application/json', 'x-fixture-ledger': name,
        authorization: 'Bearer ' + (path.includes('/admin/') ? ADMIN : 'fixture-verified-account'), ...options.headers },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    if (Array.isArray(expected)) assert.ok(expected.includes(response.status), `${path}: ${response.status} ${JSON.stringify(data)}`);
    else assert.equal(response.status, expected, `${path}: ${JSON.stringify(data)}`);
    return data;
  }
  const api = (action, body = {}, expected = 200, options = {}) => request('/api/creators/' + action, body, expected,
    { method: ['config', 'admin/partners', 'admin/summary'].includes(action) ? 'GET' : 'POST', ...options });
  const fixture = (op, values = {}, expected = 200) => request('/__fixture', { op, ...values }, expected);
  const call = async (op, args = [], expected = 200) => (await fixture(op, { args }, expected)).result;
  const inspect = () => fixture('inspect');
  const seed = async () => {
    await api('admin/seed');
    await api('admin/settings', approvals);
    const p = await call('savePartner', [partner(0, { activatedAt: null }), START]);
    return p;
  };
  const book = (e, at = e.purchasedAt, token = null, expected = 200) => call('book', [e, token, at], expected);
  return { api, fixture, call, inspect, seed, book };
}
function payment(p, suffix = '00001', purchasedAt = START, gross = 399, patch = {}) {
  return { platform: 'ios', key: 'ios:100000000', receiptId: 'payment-' + suffix, partnerId: p.id,
    accountId: OWNER, grossCents: gross, purchasedAt, periodEnd: purchasedAt + 30 * DAY,
    refundedCents: 0, currency: 'EUR', terms: p, originAt: START, ...patch };
}
function applePayment(e, patch = {}) {
  return { raw: apple({ transactionId: e.receiptId, originalTransactionId: e.key.slice('ios:'.length),
    purchaseDate: e.purchasedAt, originalPurchaseDate: e.originAt, expiresDate: e.periodEnd,
    price: e.grossCents * 10, appAccountToken: e.accountId, offerIdentifier: e.terms.appleOfferId, ...patch }) };
}
function appleNotificationFixture(patch = {}, notificationId = 'fixture-apple-ownerless') {
  const now = Date.now();
  const raw = apple({ appAccountToken: null, purchaseDate: now - DAY, originalPurchaseDate: now - DAY,
    expiresDate: now + 29 * DAY, ...patch });
  return { signedPayload: 'fixture-payload-' + notificationId,
    proof: { notificationId, transactionId: raw.transactionId, rawTransaction: raw } };
}
const statementBody = (month, patch = {}) => ({ partnerId: 'foodiewien', month,
  reconciledFinancialReports: true, storeFundsReceived: true, evidenceRef: 'fixture-financial-report-' + month, ...patch });
const refundBody = (receiptId, refundedCents, patch = {}) => ({ platform: 'ios', receiptId, refundedCents,
  ownerConfirmed: true, evidenceRef: 'fixture-refund-report-' + receiptId, ...patch });
const paidBody = (statement, patch = {}) => ({ statementId: statement.id, amountCents: statement.totalCents,
  ownerConfirmed: true, bankReference: 'fixture-transfer-' + statement.id, ...patch });
const foodie = summary => summary.partners.find(p => p.id === 'foodiewien');

test('SQLite runtime really exposes SQL; seed and default approvals never enable intake', async () => {
  const l = await ledger();
  assert.deepEqual(await l.fixture('sqlite'), [{ ready: 1 }]);
  assert.equal((await l.api('config')).enabled, false);
  const seeded = await l.api('admin/seed');
  assert.equal(seeded.partners.length, 5);
  assert.deepEqual((await l.api('admin/seed')).partners, seeded.partners);
  await l.api('quote', { platform: 'ios', code: 'FOODIEWIEN20' }, 503);
  await l.api('confirm', { platform: 'ios', transactionId: '100000001' }, 503);
  assert.equal((await l.api('admin/reconcile')).checked, 0);
  assert.equal((await l.inspect())['fixture:verify-count'], undefined);
  await l.fixture('env', { values: { CREATOR_PROGRAM_ENABLED: '0' } });
  assert.equal(await l.call('ready'), false);
});
test('all three approvals are individually required even with an active partner', async () => {
  const l = await ledger(); await l.seed();
  assert.equal((await l.api('config')).enabled, true);
  for (const field of ['termsApproved', 'transportReady', 'releasesVerified']) {
    await l.api('admin/settings', { ...approvals, [field]: false });
    assert.equal((await l.api('config')).enabled, false, field);
    await l.api('confirm', { platform: 'ios', transactionId: '100000001' }, 503);
  }
  for (const patch of [{ holdDays: 29 }, { holdDays: 91 }, { maxPartners: 6 }, { termsApproved: 'true' }, { extra: true }]) {
    await l.api('admin/settings', { ...approvals, ...patch }, 400);
  }
  assert.equal((await l.inspect())['fixture:verify-count'], undefined);
});
test('pilot enforces five partners, unique codes/offers and immutable started terms', async () => {
  const l = await ledger(); const p = await l.seed();
  await l.call('savePartner', [partner(2, { id: 'sixth-partner', code: 'SIXTH20', activatedAt: null }), START], 409);
  const second = creatorDrafts()[1];
  for (const patch of [{ code: p.code }, { appleOfferId: p.appleOfferId }, { playOfferId: p.playOfferId }]) {
    await l.call('savePartner', [{ ...second, ...patch }, START], 409);
  }
  for (const patch of [{ commissionMonths: null }, { code: 'CHANGED20' }, { activatedAt: null },
    { appleOfferId: 'different-offer' }]) {
    await l.call('savePartner', [{ ...p, ...patch }, START + DAY], 409);
  }
  await l.call('savePartner', [{ ...p, regularCents: 599 }, START + DAY], 400);
  const paused = await l.call('savePartner', [{ ...p, name: 'Foodiewien updated', state: 'paused', acceptsNew: false }, NOW]);
  assert.equal(paused.activatedAt, START);
  assert.equal((await l.api('config')).enabled, false);
});
test('quotes come only from approved terms; client prices and codes cannot invent offers', async () => {
  const l = await ledger(); await l.seed();
  for (const platform of ['ios', 'android']) {
    const { offer } = await l.api('quote', { platform, code: ' foodiewien20 ', discountedCents: 1, regularCents: 1 });
    assert.equal(offer.discountedCents, 399); assert.equal(offer.regularCents, 499);
    assert.equal(offer.paidMonths, 12); assert.equal(offer.currency, 'EUR'); assert.equal(offer.region, 'AT');
    assert.equal(offer.productId, platform === 'ios' ? IOS : PLAY);
    if (platform === 'ios') {
      const url = new URL(offer.appleRedemptionURL);
      assert.equal(url.origin, 'https://apps.apple.com');
      assert.equal(url.searchParams.get('code'), 'FOODIEWIEN20');
      assert.equal(url.searchParams.get('id'), '6758958213');
    }
  }
  for (const code of ['UNKNOWN20', 'TASTYFOOD20', 'FOODIEWIEN20<script>']) {
    await l.api('quote', { platform: 'ios', code }, 404);
  }
});
test('trusted confirmation ignores supplied prices and rejects forged or foreign account principal', async () => {
  const l = await ledger(); await l.seed();
  await l.fixture('put', { values: { 'fixture:receipt:100000001': { raw: apple(), now: NOW } } });
  await l.api('confirm', { platform: 'ios', transactionId: '100000001', principal: { id: OTHER },
    accountId: OTHER, grossCents: 99999, commissionCents: 99999, price: 1 });
  let state = await l.inspect();
  assert.equal(state['payment:ios:100000001'].grossCents, 399);
  assert.equal(state['payment:ios:100000001'].commissionCents, 120);
  assert.equal(state['chain:ios:100000000'].accountId, OWNER);
  await l.fixture('put', { values: { 'fixture:receipt:100000002': {
    raw: apple({ transactionId: '100000002', originalTransactionId: '200000000', appAccountToken: OTHER }), now: NOW,
  } } });
  await l.api('confirm', { platform: 'ios', transactionId: '100000002', principal: { id: OTHER } }, 403);
  state = await l.inspect();
  assert.equal(state['payment:ios:100000002'], undefined);
});
test('free trial records zero commission and does not start paid attribution', async () => {
  const l = await ledger(); const p = await l.seed();
  await l.book(payment(p, 'trial', START, 0));
  const state = await l.inspect();
  assert.equal(state['payment:ios:payment-trial'].commissionCents, 0);
  assert.equal(state['chain:ios:100000000'].firstPaidAt, null);
  assert.equal((await l.call('summary')).partners.find(p => p.id === 'foodiewien').payments, 0);
  await l.call('statement', [statementBody('2024-01'), Date.UTC(2024, 2, 2)], 409);
});
test('concurrent duplicate confirmations book once and do not restart the 30-day hold', async () => {
  const l = await ledger(); const p = await l.seed();
  const e = payment(p);
  await Promise.all(Array.from({ length: 8 }, () => l.book(e)));
  const first = await l.inspect();
  await l.book(e, START + 20 * DAY);
  const state = await l.inspect();
  assert.equal(Object.keys(state).filter(k => k.startsWith('payment:')).length, 1);
  assert.equal(state['chain:ios:100000000'].paymentKeys.length, 1);
  assert.equal(state['payment:ios:payment-00001'].eligibleAt, first['payment:ios:payment-00001'].eligibleAt);
  assert.equal(foodie(await l.call('summary')).commissionCents, 120);
});
test('concurrent distinct receipts for the same chain period cannot double-count', async () => {
  const l = await ledger(); const p = await l.seed();
  const a = payment(p, 'same-period-a'), b = payment(p, 'same-period-b');
  const results = await Promise.all([a, b].map(e => l.fixture('book', { args: [e, null, START] }, [200, 409])
    .then(result => result.error ? 409 : 200)));
  assert.deepEqual(results.sort(), [200, 409]);
  const state = await l.inspect();
  assert.equal(Object.keys(state).filter(k => k.startsWith('payment:')).length, 1);
  assert.equal(foodie(await l.call('summary')).commissionCents, 120);
});
test('receipt conflicts roll back and original partner attribution is immutable', async () => {
  const l = await ledger(); const p = await l.seed();
  const e = payment(p); await l.book(e);
  for (const patch of [{ grossCents: 499 }, { purchasedAt: START + DAY }, { key: 'ios:another-chain' },
    { partnerId: 'tastyfood', terms: partner(1) }]) {
    await l.book({ ...e, ...patch }, START + DAY, null, 409);
  }
  await l.book(payment(partner(1), 'steal-chain', START + 30 * DAY), START + 30 * DAY, null, 409);
  const state = await l.inspect();
  assert.equal(state['chain:ios:100000000'].partnerId, p.id);
  assert.equal(state['payment:ios:payment-00001'].grossCents, 399);
  assert.equal(Object.keys(state).filter(k => k.startsWith('payment:')).length, 1);
});
test('an existing chain account identity cannot be overwritten by later evidence', async () => {
  const l = await ledger(); const p = await l.seed();
  await l.book(payment(p));
  await l.book(payment(p, 'other-owner', START + 30 * DAY, 399, { accountId: OTHER }), START + 30 * DAY, null, 409);
  assert.equal((await l.inspect())['chain:ios:100000000'].accountId, OWNER);
});
test('a one-cent refund rounds commission on the actual remaining customer payment', async () => {
  const l = await ledger(); const p = await l.seed();
  const e = payment(p); await l.book(e);
  await l.api('admin/adjust-refund', refundBody(e.receiptId, 1));
  const item = (await l.inspect())['payment:ios:' + e.receiptId];
  assert.equal(item.commissionCents - item.reversedCents, creatorCommission(398));
  assert.equal(item.reversedCents, 1);
});
test('12-payment commission cap counts paid monthly periods, not elapsed calendar months or trials', async () => {
  const l = await ledger(); const p = await l.seed();
  await l.book(payment(p, 'trial-a', START, 0));
  await l.book(payment(p, 'trial-b', START + 30 * DAY, 0));
  // Receipt 13 arrives first; chronological recomputation must move it outside the cap.
  for (const i of [12, ...Array.from({ length: 12 }, (_, i) => i)]) {
    const at = START + (60 + i * 60) * DAY;
    await l.book(payment(p, 'paid-' + String(i).padStart(2, '0'), at, i === 12 ? 499 : 399), at);
  }
  const state = await l.inspect();
  const paid = Object.entries(state).filter(([k, v]) => k.startsWith('payment:') && v.grossCents > 0)
    .map(([, v]) => v).sort((a, b) => a.purchasedAt - b.purchasedAt);
  assert.equal(paid.length, 13);
  assert.ok(paid[11].purchasedAt - START > 365 * DAY, '12th paid monthly period is later than calendar year one');
  assert.deepEqual(paid.map(p => p.commissionCents), [...Array(12).fill(120), 0]);
  assert.equal(foodie(await l.call('summary')).commissionCents, 1440);
  assert.equal(state['chain:ios:100000000'].paymentKeys.length, 15);
});
test('explicit unlimited commission terms remain distinct from default 12-payment pilot', async () => {
  const l = await ledger();
  await l.api('admin/seed'); await l.api('admin/settings', approvals);
  const p = await l.call('savePartner', [partner(0, { activatedAt: null, commissionMonths: null }), START]);
  for (let i = 0; i < 13; i++) await l.book(payment(p, 'unlimited-' + i, START + i * 30 * DAY));
  assert.equal(foodie(await l.call('summary')).commissionCents, 13 * 120);
});
test('statement requires a closed month, actual financial approval, funds received and full 30-day hold', async () => {
  const l = await ledger(); const p = await l.seed();
  const verifiedAt = Date.UTC(2024, 1, 1);
  await l.book(payment(p), verifiedAt);
  const eligibleAt = verifiedAt + 30 * DAY;
  await l.call('statement', [statementBody('2024-01'), eligibleAt - 1], 409);
  for (const patch of [{ reconciledFinancialReports: false }, { storeFundsReceived: false }, { evidenceRef: '' },
    { evidenceRef: 'bad\nreference' }, { month: '2024-13' }]) {
    await l.call('statement', [statementBody('2024-01', patch), eligibleAt], 409);
  }
  await l.call('statement', [statementBody('2024-03'), eligibleAt], 409);
  assert.equal((await l.inspect())['payment:ios:payment-00001'].allocatedCents, undefined);
  const result = await l.call('statement', [statementBody('2024-01'), eligibleAt]);
  assert.equal(result.statement.totalCents, 120);
  assert.equal(result.statement.state, 'locked');
  assert.equal((await l.call('statement', [statementBody('2024-01'), eligibleAt + DAY])).duplicate, true);
  await l.call('statement', [statementBody('2024-02'), eligibleAt + DAY], 409);
});
test('review-required reconciliation chains are held out of statements', async () => {
  const l = await ledger(); const p = await l.seed();
  await l.book(payment(p));
  const state = await l.inspect(), key = 'chain:ios:100000000';
  await l.fixture('put', { values: { [key]: { ...state[key], reviewRequired: true } } });
  await l.call('statement', [statementBody('2024-01'), Date.UTC(2024, 1, 2)], 409);
  assert.equal((await l.inspect())['payment:ios:payment-00001'].allocatedCents, undefined);
});
test('concurrent statement locking allocates a payment only once', async () => {
  const l = await ledger(); const p = await l.seed(); await l.book(payment(p));
  const results = await Promise.all(Array.from({ length: 6 }, () =>
    l.call('statement', [statementBody('2024-01'), Date.UTC(2024, 1, 2)])));
  assert.equal(results.filter(x => x.duplicate).length, 5);
  assert.ok(results.every(x => x.statement.totalCents === 120));
  const state = await l.inspect();
  assert.equal(Object.keys(state).filter(k => k.startsWith('statement:')).length, 1);
  assert.equal(state['payment:ios:payment-00001'].allocatedCents, 120);
});
for (const refunded of [199, 399]) {
  test(`refund ${refunded} cents before statement reduces commission without paying refunded gross`, async () => {
    const l = await ledger(); const p = await l.seed();
    const e = payment(p); await l.book(e);
    await l.call('adjustRefund', [refundBody(e.receiptId, refunded), START + DAY]);
    await l.book(e, START + 2 * DAY); // Older Store evidence must not undo a confirmed refund.
    const state = await l.inspect(), item = state['payment:ios:' + e.receiptId];
    assert.equal(item.refundedCents, refunded);
    assert.equal(item.reversedCents, refunded === 199 ? 60 : 120);
    assert.equal(foodie(await l.call('summary')).commissionCents, refunded === 199 ? 60 : 0);
    const result = await l.call('statement', [statementBody('2024-01'), Date.UTC(2024, 1, 2)], refunded === 399 ? 409 : 200);
    if (refunded === 199) assert.equal(result.statement.totalCents, 60);
  });
}
test('refund corrections require external evidence, exact bounds and monotonic cumulative amounts', async () => {
  const l = await ledger(); const p = await l.seed(); const e = payment(p); await l.book(e);
  for (const patch of [{ ownerConfirmed: false }, { evidenceRef: '' }, { refundedCents: 400 },
    { refundedCents: -1 }, { refundedCents: 1.5 }, { refundedCents: '199' }, { receiptId: 'missing-receipt' }]) {
    await l.call('adjustRefund', [refundBody(e.receiptId, 199, patch), START + DAY], 409);
  }
  await l.call('adjustRefund', [refundBody(e.receiptId, 199), START + DAY]);
  await l.call('adjustRefund', [refundBody(e.receiptId, 199), START + DAY]);
  await l.call('adjustRefund', [refundBody(e.receiptId, 198), START + DAY], 409);
  assert.equal((await l.inspect())['payment:ios:' + e.receiptId].refundedCents, 199);
});

for (const refunded of [199, 399]) {
  test(`refund ${refunded} after locking preserves the original statement and allocates reversal only once`, async () => {
    const l = await ledger(); const p = await l.seed(); const e = payment(p); await l.book(e);
    const jan = (await l.call('statement', [statementBody('2024-01'), Date.UTC(2024, 1, 2)])).statement;
    await l.call('adjustRefund', [refundBody(e.receiptId, refunded), Date.UTC(2024, 1, 5)]);
    const retry = await l.call('statement', [statementBody('2024-01'), Date.UTC(2024, 1, 6)]);
    assert.equal(retry.duplicate, true);
    assert.deepEqual(retry.statement, jan);
    const feb = (await l.call('statement', [statementBody('2024-02'), Date.UTC(2024, 2, 2)])).statement;
    assert.equal(feb.totalCents, refunded === 199 ? -60 : -120);
    assert.equal(feb.lines.length, 1);
    await l.call('adjustRefund', [refundBody(e.receiptId, refunded), Date.UTC(2024, 2, 3)]);
    const march = (await l.call('statement', [statementBody('2024-03'), Date.UTC(2024, 3, 2)])).statement;
    assert.equal(march.totalCents, feb.totalCents);
    assert.deepEqual(march.lines, [{ carryFrom: feb.id, commissionCents: feb.totalCents, currency: 'EUR' }]);
  });
}

for (const refunded of [199, 399]) {
  test(`refund ${refunded} after paid statement creates one negative carry into future earnings`, async () => {
    const l = await ledger(); const p = await l.seed(); const e = payment(p); await l.book(e);
    const jan = (await l.call('statement', [statementBody('2024-01'), Date.UTC(2024, 1, 2)])).statement;
    await l.call('markPaid', [paidBody(jan), Date.UTC(2024, 1, 2)]);
    await l.call('adjustRefund', [refundBody(e.receiptId, refunded), Date.UTC(2024, 1, 5)]);
    const reversed = refunded === 199 ? 60 : 120;
    const feb = (await l.call('statement', [statementBody('2024-02'), Date.UTC(2024, 2, 2)])).statement;
    assert.equal(feb.totalCents, -reversed);
    await l.call('markPaid', [paidBody(feb), Date.UTC(2024, 2, 2)], 409);
    await l.book(payment(p, 'march', Date.UTC(2024, 2, 1), 499));
    const march = (await l.call('statement', [statementBody('2024-03'), Date.UTC(2024, 3, 2)])).statement;
    assert.equal(march.totalCents, 150 - reversed);
    assert.equal(march.lines.filter(x => x.carryFrom === feb.id).length, 1);
    const state = await l.inspect();
    assert.equal(state['statement:' + jan.id].totalCents, 120);
    assert.equal(state['statement:' + jan.id].state, 'paid');
    assert.equal(state['statement:' + feb.id].carriedInto, march.id);
    await l.call('statement', [statementBody('2024-03'), Date.UTC(2024, 3, 3)]);
    await l.book(payment(p, 'april', Date.UTC(2024, 3, 1), 499));
    const april = (await l.call('statement', [statementBody('2024-04'), Date.UTC(2024, 4, 2)])).statement;
    assert.equal(april.totalCents, 150, 'a previously consumed negative carry cannot be applied twice');
  });
}
test('bank confirmation requires exact amount/reference/owner approval and is idempotent under concurrency', async () => {
  const l = await ledger(); const p = await l.seed(); await l.book(payment(p));
  const s = (await l.call('statement', [statementBody('2024-01'), Date.UTC(2024, 1, 2)])).statement;
  for (const patch of [{ amountCents: 119 }, { amountCents: '120' }, { amountCents: 0 },
    { ownerConfirmed: false }, { bankReference: '' }, { bankReference: 'bank\nref' }]) {
    await l.call('markPaid', [paidBody(s, patch), NOW], 409);
  }
  assert.equal((await l.inspect())['statement:' + s.id].state, 'locked');
  const results = await Promise.all(Array.from({ length: 6 }, () => l.call('markPaid', [paidBody(s), NOW])));
  assert.equal(results.filter(x => x.duplicate).length, 5);
  await l.call('markPaid', [paidBody(s, { bankReference: 'different-transfer' }), NOW], 409);
  await l.book(payment(p, 'february', Date.UTC(2024, 1, 1)));
  const feb = (await l.call('statement', [statementBody('2024-02'), Date.UTC(2024, 2, 5)])).statement;
  await l.call('markPaid', [paidBody(feb, { bankReference: paidBody(s).bankReference }), NOW], 409);
  const state = await l.inspect();
  assert.equal(Object.keys(state).filter(k => k.startsWith('transfer:')).length, 1);
  assert.equal(state['statement:' + feb.id].state, 'locked');
});
test('concurrent different bank references cannot mark one statement paid twice', async () => {
  const l = await ledger(); const p = await l.seed(); await l.book(payment(p));
  const s = (await l.call('statement', [statementBody('2024-01'), Date.UTC(2024, 1, 2)])).statement;
  const results = await Promise.all(['transfer-a', 'transfer-b'].map(bankReference =>
    l.fixture('markPaid', { args: [paidBody(s, { bankReference }), NOW] }, [200, 409])));
  assert.equal(results.filter(x => !x.error).length, 1);
  assert.equal(results.filter(x => x.error).length, 1);
  assert.equal(Object.keys(await l.inspect()).filter(k => k.startsWith('transfer:')).length, 1);
});
test('Android public confirmation and safe summaries never disclose stored raw purchase tokens', async () => {
  const l = await ledger(); await l.seed(); const f = google();
  await l.fixture('put', { values: { ['fixture:receipt:' + TOKEN]: { ...f, now: NOW } } });
  const confirmed = await l.api('confirm', { platform: 'android', purchaseToken: TOKEN,
    grossCents: 1, commissionCents: 99999, principal: { id: OTHER } });
  assert.equal(JSON.stringify(confirmed).includes(TOKEN), false);
  const summary = await l.api('admin/summary');
  assert.equal(JSON.stringify(summary).includes(TOKEN), false);
  assert.equal(foodie(summary).commissionCents, 120);
  const chain = (await l.inspect())['chain:android:' + await creatorHash(TOKEN)];
  assert.equal(chain.privateToken, TOKEN, 'the Store token is retained privately for reconciliation only');
});
for (const httpStatus of [undefined, 503]) {
  test(`Store verifier error never leaks raw token, including status=${httpStatus}`, async () => {
    const l = await ledger(); await l.seed();
    await l.fixture('put', { values: { ['fixture:receipt:' + TOKEN]: { error: 'provider URL includes ' + TOKEN, status: httpStatus } } });
    const result = await l.api('confirm', { platform: 'android', purchaseToken: TOKEN }, 503);
    assert.equal(JSON.stringify(result).includes(TOKEN), false);
    assert.equal(Object.keys(await l.inspect()).filter(k => k.startsWith('payment:')).length, 0);
  });
}
test('failed reconciliation marks review and prevents payout without exposing transport errors', async () => {
  const l = await ledger(); const p = await l.seed();
  const e = payment(p, 'reconciliation', START, 399,
    { platform: 'android', key: 'android:' + await creatorHash(TOKEN) });
  await l.book(e, START, TOKEN);
  await l.fixture('put', { values: { ['fixture:receipt:' + TOKEN]: { error: 'private provider error ' + TOKEN } } });
  const result = await l.call('reconcile', [START + 2 * DAY]);
  assert.equal(result.review, 1); assert.equal(result.checked, 0);
  assert.equal(JSON.stringify(result).includes(TOKEN), false);
  const state = await l.inspect();
  assert.equal(state['chain:' + e.key].reviewRequired, true);
  await l.call('statement', [statementBody('2024-01'), Date.UTC(2024, 1, 2)], 409);
});
test('disabled reconciliation makes no verification calls even for a due private chain', async () => {
  const l = await ledger(); const p = await l.seed();
  await l.book(payment(p), START, TOKEN);
  await l.fixture('env', { values: { CREATOR_RECONCILIATION_ENABLED: '0' } });
  const result = await l.call('reconcile', [START + 2 * DAY]);
  assert.equal(result.checked, 0);
  assert.equal(result.skipped, 'disabled');
  assert.equal((await l.inspect())['fixture:verify-count'], undefined);
});

test('known full-refund negative adjustment is still allocated while its chain requires review', async () => {
  const l = await ledger(); const p = await l.seed(); const e = payment(p); await l.book(e);
  const jan = (await l.call('statement', [statementBody('2024-01'), Date.UTC(2024, 1, 2)])).statement;
  await l.call('markPaid', [paidBody(jan), Date.UTC(2024, 1, 2)]);
  await l.call('adjustRefund', [refundBody(e.receiptId, 399), Date.UTC(2024, 1, 5)]);
  const key = 'chain:' + e.key, state = await l.inspect();
  await l.fixture('put', { values: { [key]: { ...state[key], reviewRequired: true } } });
  const feb = (await l.call('statement', [statementBody('2024-02'), Date.UTC(2024, 2, 2)])).statement;
  assert.equal(feb.totalCents, -120);
  assert.deepEqual(feb.lines.map(x => [x.receiptId, x.commissionCents]), [[e.receiptId, -120]]);
  assert.equal((await l.inspect())['payment:ios:' + e.receiptId].allocatedCents, 0);
  await l.call('markPaid', [paidBody(feb), NOW], 409);
});
test('review-held refund nets against payable earnings but unrelated held positives cannot inflate payout', async () => {
  const l = await ledger(); const p = await l.seed(); const refunded = payment(p); await l.book(refunded);
  const jan = (await l.call('statement', [statementBody('2024-01'), Date.UTC(2024, 1, 2)])).statement;
  await l.call('markPaid', [paidBody(jan), Date.UTC(2024, 1, 2)]);
  await l.call('adjustRefund', [refundBody(refunded.receiptId, 199), Date.UTC(2024, 1, 5)]);
  const held = payment(p, 'held-positive', START + DAY, 499, { key: 'ios:held-positive-chain' });
  const payable = payment(p, 'payable-positive', START + 2 * DAY, 399, { key: 'ios:payable-positive-chain' });
  await l.book(held); await l.book(payable);
  const state = await l.inspect(), refundKey = 'chain:' + refunded.key, heldKey = 'chain:' + held.key;
  await l.fixture('put', { values: {
    [refundKey]: { ...state[refundKey], reviewRequired: true },
    [heldKey]: { ...state[heldKey], reviewRequired: true },
  } });
  const feb = (await l.call('statement', [statementBody('2024-02'), Date.UTC(2024, 2, 2)])).statement;
  assert.equal(feb.totalCents, 60, '120 payable minus 60 known reversal; held 150 must not contribute');
  assert.deepEqual(feb.lines.map(x => [x.receiptId, x.commissionCents]).sort(),
    [[refunded.receiptId, -60], [payable.receiptId, 120]].sort());
  assert.equal((await l.inspect())['payment:ios:' + held.receiptId].allocatedCents, undefined);
  await l.call('markPaid', [paidBody(feb, { amountCents: 120 }), NOW], 409);
  assert.equal((await l.call('markPaid', [paidBody(feb), NOW])).statement.totalCents, 60);
});

test('single-receipt booking and partial reconciliation preserve review until every stored payment is verified', async () => {
  const l = await ledger(); const p = await l.seed();
  const a = payment(p, 'review-first'), b = payment(p, 'review-second', START + 30 * DAY);
  await l.book(a); await l.book(b);
  const chainKey = 'chain:' + a.key, state = await l.inspect();
  await l.fixture('put', { values: { [chainKey]: { ...state[chainKey], reviewRequired: true } } });
  await l.book(a, NOW);
  assert.equal((await l.inspect())[chainKey].reviewRequired, true, 'one confirmed receipt cannot clear a chain-wide review');
  const firstCheck = NOW + 2 * DAY;
  await l.fixture('put', { values: { ['fixture:receipt:' + b.receiptId]: {
    entries: [applePayment(b)], now: firstCheck,
  } } });
  const partial = await l.call('reconcile', [firstCheck]);
  assert.equal(partial.checked, 1); assert.equal(partial.review, 0);
  assert.equal((await l.inspect())[chainKey].reviewRequired, true, 'successful but incomplete history remains held');
  const fullCheck = firstCheck + 2 * DAY;
  await l.fixture('put', { values: { ['fixture:receipt:' + b.receiptId]: {
    entries: [applePayment(a), applePayment(b)], now: fullCheck,
  } } });
  const complete = await l.call('reconcile', [fullCheck]);
  assert.equal(complete.checked, 1); assert.equal(complete.review, 0);
  const current = (await l.inspect())[chainKey];
  assert.equal(current.reviewRequired, false);
  assert.deepEqual(current.paymentKeys.slice().sort(), [a, b].map(e => 'payment:ios:' + e.receiptId).sort());
  assert.equal(current.checkedAt, fullCheck);
  assert.equal(current.nextCheckAt, fullCheck + DAY);
});
test('successful reconciliation cannot clear review when a new payment appears during verification', async () => {
  const l = await ledger(); const p = await l.seed();
  const a = payment(p, 'snapshot-first'), b = payment(p, 'snapshot-new', START + 30 * DAY);
  await l.book(a);
  const chainKey = 'chain:' + a.key, state = await l.inspect();
  await l.fixture('put', { values: {
    [chainKey]: { ...state[chainKey], reviewRequired: true },
    ['fixture:receipt:' + a.receiptId]: { now: NOW, entries: [applePayment(a)],
      verifyHook: { id: 'successful-stale-snapshot', bookings: [{ evidence: b, now: NOW - 1000 }] } },
  } });
  const result = await l.call('reconcile', [NOW]);
  assert.equal(result.checked, 1); assert.equal(result.review, 0);
  const current = await l.inspect();
  assert.equal(current[chainKey].reviewRequired, true);
  assert.equal(current['fixture:verify-hook-count'], 1);
  assert.deepEqual(current[chainKey].paymentKeys.slice().sort(), [a, b].map(e => 'payment:ios:' + e.receiptId).sort());
  assert.equal(current[chainKey].latestReceipt, b.receiptId);
});
test('reconciliation catch reloads the current chain and changes only review scheduling after an in-flight booking', async () => {
  const l = await ledger(); const p = await l.seed();
  const a = payment(p, 'catch-original'), b = payment(p, 'catch-concurrent', START + 30 * DAY);
  await l.book(a);
  const hookId = 'failing-stale-snapshot';
  await l.fixture('put', { values: { ['fixture:receipt:' + a.receiptId]: {
    error: 'fixture provider failed after a concurrent booking', status: 503,
    verifyHook: { id: hookId, bookings: [{ evidence: b, now: NOW - 1000 }] },
  } } });
  const result = await l.call('reconcile', [NOW]);
  assert.equal(result.checked, 0); assert.equal(result.review, 1);
  const state = await l.inspect(), current = state['chain:' + a.key];
  assert.equal(state['fixture:verify-hook-count'], 1);
  assert.deepEqual(current, { ...state['fixture:verify-hook-chain:' + hookId],
    reviewRequired: true, checkedAt: NOW, nextCheckAt: NOW + DAY });
  assert.deepEqual(current.paymentKeys.slice().sort(), [a, b].map(e => 'payment:ios:' + e.receiptId).sort());
  assert.equal(current.latestReceipt, b.receiptId);
  assert.equal(state['payment:ios:' + b.receiptId].grossCents, 399);
});
test('second booking failure in a verified evidence array preserves the first newly booked payment', async () => {
  const l = await ledger(); const p = await l.seed();
  const a = payment(p, 'array-original'), b = payment(p, 'array-new', START + 30 * DAY);
  await l.book(a);
  // Both Store fixtures have permitted prices and valid dates. Only the second conflicts with a recorded receipt.
  await l.fixture('put', { values: { ['fixture:receipt:' + a.receiptId]: {
    now: NOW, entries: [applePayment(b), applePayment(a, { price: 4990 })],
  } } });
  const result = await l.call('reconcile', [NOW]);
  assert.equal(result.checked, 0); assert.equal(result.review, 1);
  const state = await l.inspect(), current = state['chain:' + a.key];
  assert.equal(state['fixture:verify-count'], 1);
  assert.equal(current.reviewRequired, true);
  assert.deepEqual(current.paymentKeys.slice().sort(), [a, b].map(e => 'payment:ios:' + e.receiptId).sort());
  assert.equal(current.latestReceipt, b.receiptId);
  assert.equal(current.latestAt, b.purchasedAt);
  assert.equal(current.checkedAt, NOW); assert.equal(current.nextCheckAt, NOW + DAY);
  assert.equal(state['payment:ios:' + a.receiptId].grossCents, 399);
  assert.equal(state['payment:ios:' + b.receiptId].grossCents, 399);
});
test('empty verified history cannot clear review or claim a completed reconciliation', async () => {
  const l = await ledger(); const p = await l.seed(); const e = payment(p); await l.book(e);
  await l.fixture('put', { values: { ['fixture:receipt:' + e.receiptId]: { entries: [], now: NOW } } });
  const result = await l.call('reconcile', [NOW]);
  assert.equal(result.checked, 0); assert.equal(result.review, 1);
  assert.equal((await l.inspect())['chain:' + e.key].reviewRequired, true);
});

test('trusted Apple 40% refund books 160 cents and commissions only the 239 cents retained', async () => {
  const l = await ledger(); const p = await l.seed();
  const e = creatorAppleEvidence(apple({ revocationDate: NOW, revocationType: 'REFUND_PRORATED',
    revocationPercentage: 40000 }), [p], NOW);
  await l.book(e, NOW);
  const item = (await l.inspect())['payment:ios:' + e.receiptId];
  assert.equal(item.refundedCents, 160);
  assert.equal(item.reversedCents, 48);
  assert.equal(foodie(await l.call('summary')).commissionCents, 72);
  const s = (await l.call('statement', [statementBody('2026-10'), Date.UTC(2026, 11, 2)])).statement;
  assert.equal(s.totalCents, 72);
});
test('ambiguous Apple percentage is rejected by public confirmation without a financial row', async () => {
  const l = await ledger(); await l.seed();
  await l.fixture('put', { values: { 'fixture:receipt:100000001': { raw: apple({ revocationDate: NOW,
    revocationType: 'REFUND_PRORATED', revocationPercentage: 50000 }), now: NOW } } });
  await l.api('confirm', { platform: 'ios', transactionId: '100000001' }, 409);
  assert.equal(Object.keys(await l.inspect()).filter(k => k.startsWith('payment:')).length, 0);
});
for (const token of [undefined, null, '']) {
  test(`public Apple confirmation rejects ownerless Store evidence (${String(token)}) despite client ownership claims`, async () => {
    const l = await ledger(); await l.seed();
    await l.fixture('put', { values: { 'fixture:receipt:100000001': { raw: apple({ appAccountToken: token }), now: NOW } } });
    await l.api('confirm', { platform: 'ios', transactionId: '100000001', accountId: OWNER,
      appAccountToken: OWNER, principal: { id: OWNER } }, 403);
    const state = await l.inspect();
    assert.equal(Object.keys(state).filter(k => k.startsWith('payment:')).length, 0);
    assert.equal(Object.keys(state).filter(k => k.startsWith('chain:')).length, 0);
  });
}

for (const restoredRefund of [199, 0]) {
  test(`admin may decrease cumulative refund to ${restoredRefund} only with explicit reversal and new financial evidence`, async () => {
    const l = await ledger(); const p = await l.seed(); const e = payment(p); await l.book(e);
    const originalRef = 'fixture-external-refund-report';
    await l.call('adjustRefund', [refundBody(e.receiptId, 399, { evidenceRef: originalRef }), NOW]);
    for (const patch of [{ evidenceRef: 'fixture-new-proof' },
      { evidenceRef: 'fixture-new-proof', refundReversalConfirmed: false },
      { evidenceRef: 'fixture-new-proof', refundReversalConfirmed: 'true' },
      { evidenceRef: originalRef, refundReversalConfirmed: true },
      { evidenceRef: '', refundReversalConfirmed: true }]) {
      await l.call('adjustRefund', [refundBody(e.receiptId, restoredRefund, patch), NOW + DAY], 409);
      assert.equal((await l.inspect())['payment:ios:' + e.receiptId].refundedCents, 399);
    }
    const reversal = refundBody(e.receiptId, restoredRefund, {
      refundReversalConfirmed: true, evidenceRef: 'fixture-new-reversal-report',
    });
    await l.call('adjustRefund', [reversal, NOW + DAY]);
    await l.call('adjustRefund', [reversal, NOW + DAY]);
    const item = (await l.inspect())['payment:ios:' + e.receiptId];
    assert.equal(item.refundedCents, restoredRefund);
    assert.equal(item.reversedCents, restoredRefund === 199 ? 60 : 0);
    assert.equal(item.refundEvidenceRef, reversal.evidenceRef);
    assert.equal(foodie(await l.call('summary')).commissionCents, restoredRefund === 199 ? 60 : 120);
  });
}
test('whitespace cannot make a reused refund financial-evidence reference count as new proof', async () => {
  const l = await ledger(); const p = await l.seed(); const e = payment(p); await l.book(e);
  const evidenceRef = 'fixture-same-financial-report';
  await l.call('adjustRefund', [refundBody(e.receiptId, 399, { evidenceRef }), NOW]);
  await l.call('adjustRefund', [refundBody(e.receiptId, 199, {
    evidenceRef: '  ' + evidenceRef + '  ', refundReversalConfirmed: true,
  }), NOW + DAY], 409);
  assert.equal((await l.inspect())['payment:ios:' + e.receiptId].refundedCents, 399);
});

test('bank references are trimmed before persistence, idempotency and cross-statement duplicate checks', async () => {
  const l = await ledger(); const p = await l.seed(); await l.book(payment(p));
  const jan = (await l.call('statement', [statementBody('2024-01'), Date.UTC(2024, 1, 2)])).statement;
  const reference = 'fixture-bank-transfer-123';
  const paid = await l.call('markPaid', [paidBody(jan, { bankReference: '  ' + reference + '  ' }), NOW]);
  assert.equal(paid.statement.bankReference, reference);
  for (const bankReference of [reference, ' ' + reference, reference + '  ']) {
    const retried = await l.call('markPaid', [paidBody(jan, { bankReference }), NOW + DAY]);
    assert.equal(retried.duplicate, true);
    assert.equal(retried.statement.paidAt, NOW);
  }
  await l.book(payment(p, 'trim-february', Date.UTC(2024, 1, 1)));
  const feb = (await l.call('statement', [statementBody('2024-02'), Date.UTC(2024, 2, 5)])).statement;
  for (const bankReference of [reference, '  ' + reference + '  ']) {
    await l.call('markPaid', [paidBody(feb, { bankReference }), NOW + DAY], 409);
  }
  const state = await l.inspect();
  assert.equal(state['transfer:' + await creatorHash(reference)], jan.id);
  assert.equal(state['transfer:' + await creatorHash('  ' + reference + '  ')], undefined);
  assert.equal(Object.keys(state).filter(k => k.startsWith('transfer:')).length, 1);
  assert.equal(state['statement:' + feb.id].state, 'locked');
});
test('concurrent whitespace variants of one bank reference cannot pay two different statements', async () => {
  const l = await ledger(); const p = await l.seed();
  await l.book(payment(p));
  const jan = (await l.call('statement', [statementBody('2024-01'), Date.UTC(2024, 1, 2)])).statement;
  await l.book(payment(p, 'trim-race-february', Date.UTC(2024, 1, 1)));
  const feb = (await l.call('statement', [statementBody('2024-02'), Date.UTC(2024, 2, 5)])).statement;
  const results = await Promise.all([jan, feb].map((s, index) => l.fixture('markPaid', {
    args: [paidBody(s, { bankReference: index ? 'fixture-bank-race' : '  fixture-bank-race  ' }), NOW],
  }, [200, 409])));
  assert.equal(results.filter(x => !x.error).length, 1);
  assert.equal(results.filter(x => x.error).length, 1);
  const state = await l.inspect();
  assert.equal(Object.keys(state).filter(k => k.startsWith('transfer:')).length, 1);
  assert.equal([jan, feb].filter(s => state['statement:' + s.id].state === 'paid').length, 1);
});

for (const platform of ['apple', 'google']) {
  test(`${platform} notifications default disabled before authentication, ledger access or verification`, async () => {
    const flag = platform === 'apple' ? 'CREATOR_APPLE_NOTIFICATIONS_ENABLED' : 'CREATOR_GOOGLE_NOTIFICATIONS_ENABLED';
    for (const value of [undefined, '0', 'true', true]) {
      const { env, forwarded } = forwardingEnv({ [flag]: value });
      let authenticated = 0;
      const response = await handleCreatorProgram(apiRequest(platform + '-notifications', {
        signedPayload: 'untrusted-fixture', message: { data: 'untrusted-fixture' },
      }), env, async () => { authenticated++; throw Error('Callbacks must not use account authentication'); });
      assert.equal(response.status, 503);
      assert.equal(authenticated, 0);
      assert.equal(forwarded.length, 0);
    }
  });
}
test('Apple callback handler forwards only signed payload, never client proof, account or amounts', async () => {
  const { env, forwarded } = forwardingEnv({ CREATOR_APPLE_NOTIFICATIONS_ENABLED: '1', MERCHANT_PROMO_ADMIN_SECRET: undefined });
  const response = await handleCreatorProgram(apiRequest('apple-notifications', {
    signedPayload: 'fixture-notification-payload', principal: { id: OWNER }, accountId: OWNER,
    transportAuthorization: 'forged-admin', proof: { rawTransaction: apple() }, rawTransaction: apple(),
    grossCents: 99999, commissionCents: 99999,
  }, { headers: { authorization: '' } }), env, async () => { throw Error('Callback must rely on verified server proof'); });
  assert.equal(response.status, 200);
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0].path, '/apple-notifications');
  assert.deepEqual(forwarded[0].body, { signedPayload: 'fixture-notification-payload' });
});
test('readiness requires exact Apple-notification enablement in addition to every financial approval', async () => {
  const l = await ledger(); await l.seed();
  assert.equal(await l.call('ready'), true);
  for (const patch of [{ unset: ['CREATOR_APPLE_NOTIFICATIONS_ENABLED'] },
    { values: { CREATOR_APPLE_NOTIFICATIONS_ENABLED: '0' } },
    { values: { CREATOR_APPLE_NOTIFICATIONS_ENABLED: true } }]) {
    await l.fixture('env', patch);
    assert.equal(await l.call('ready'), false);
    assert.equal((await l.api('config')).enabled, false);
    await l.api('quote', { platform: 'ios', code: 'FOODIEWIEN20' }, 503);
    await l.api('confirm', { platform: 'ios', transactionId: '100000001' }, 503);
    assert.equal((await l.call('reconcile', [NOW])).checked, 0);
  }
  await l.fixture('env', { values: { CREATOR_APPLE_NOTIFICATIONS_ENABLED: '1' } });
  assert.equal(await l.call('ready'), true);
  assert.equal((await l.api('config')).enabled, true);
  assert.deepEqual((await l.api('admin/partners')).settings, approvals);
  const state = await l.inspect();
  assert.equal(state['fixture:verify-count'], undefined);
  assert.equal(state['fixture:apple-proof-checks'], undefined);
});
test('unconfigured Apple and Google proof verifiers remain fail-closed with callbacks enabled', async () => {
  const l = await ledger(); await l.seed();
  await l.api('apple-notifications', { signedPayload: 'unverified-payload' }, 503, { headers: { authorization: '' } });
  await l.fixture('env', { values: { CREATOR_GOOGLE_NOTIFICATIONS_ENABLED: '1' } });
  await l.call('notification', ['/google-notifications', { message: { data: 'unverified-message' } }, NOW], 503);
  const state = await l.inspect();
  assert.equal(state['fixture:apple-proof-checks'], 1);
  assert.equal(Object.keys(state).filter(k => k.startsWith('payment:') || k.startsWith('event:')).length, 0);
});
test('only a trusted Apple callback can record ownerless financial rows; public confirmation stays 403 before and after', async () => {
  const l = await ledger(); await l.seed();
  const trusted = appleNotificationFixture(), raw = trusted.proof.rawTransaction;
  await l.fixture('put', { values: {
    'fixture:apple-proof': trusted,
    ['fixture:receipt:' + raw.transactionId]: { raw, now: Date.now() },
  } });
  const client = { platform: 'ios', transactionId: raw.transactionId, accountId: OWNER,
    appAccountToken: OWNER, principal: { id: OWNER } };
  await l.api('confirm', client, 403);
  assert.equal(Object.keys(await l.inspect()).filter(k => k.startsWith('payment:')).length, 0);
  const result = await l.api('apple-notifications', { signedPayload: trusted.signedPayload,
    principal: { id: OWNER }, accountId: OWNER, grossCents: 1, commissionCents: 99999,
    rawTransaction: { ...raw, appAccountToken: OWNER, price: 999990 },
  }, 200, { headers: { authorization: '' } });
  assert.equal(result.recorded, true);
  const first = await l.inspect(), paymentKey = 'payment:ios:' + raw.transactionId;
  assert.equal(first[paymentKey].grossCents, 399);
  assert.equal(first[paymentKey].commissionCents, 120);
  assert.equal(first['chain:ios:' + raw.originalTransactionId].accountId, null);
  assert.equal(first['chain:ios:' + raw.originalTransactionId].partnerId, 'foodiewien');
  assert.ok(first['event:apple:' + await creatorHash(trusted.proof.notificationId)]);
  assert.equal((await l.api('apple-notifications', { signedPayload: trusted.signedPayload }, 200,
    { headers: { authorization: '' } })).duplicate, true);
  await l.api('confirm', client, 403);
  const current = await l.inspect();
  assert.deepEqual(current[paymentKey], first[paymentKey]);
  assert.equal(current['chain:ios:' + raw.originalTransactionId].accountId, null);
  assert.equal(current['fixture:apple-proof-checks'], 2);
  assert.equal(Object.keys(current).filter(k => k.startsWith('payment:')).length, 1);
  assert.equal(Object.keys(current).filter(k => k.startsWith('event:apple:')).length, 1);
  assert.equal(Object.keys(current).filter(k => k.startsWith('account:')).length, 0);
});
test('an authenticated client cannot replace the configured callback proof with body evidence', async () => {
  const l = await ledger(); await l.seed(); const trusted = appleNotificationFixture();
  await l.fixture('put', { values: { 'fixture:apple-proof': trusted } });
  await l.api('apple-notifications', { signedPayload: 'forged-payload',
    proof: trusted.proof, rawTransaction: trusted.proof.rawTransaction, principal: { id: OWNER },
  }, 401);
  const state = await l.inspect();
  assert.equal(state['fixture:apple-proof-checks'], 1);
  assert.equal(Object.keys(state).filter(k => k.startsWith('payment:') || k.startsWith('chain:') || k.startsWith('event:')).length, 0);
});
test('disabled Apple callback refuses even a stored trusted proof before verification', async () => {
  const l = await ledger(); await l.seed(); const trusted = appleNotificationFixture();
  await l.fixture('put', { values: { 'fixture:apple-proof': trusted } });
  await l.fixture('env', { values: { CREATOR_APPLE_NOTIFICATIONS_ENABLED: '0' } });
  await l.api('apple-notifications', { signedPayload: trusted.signedPayload }, 503);
  const state = await l.inspect();
  assert.equal(state['fixture:apple-proof-checks'], undefined);
  assert.equal(Object.keys(state).filter(k => k.startsWith('payment:') || k.startsWith('event:')).length, 0);
});
test('verified Apple test notification never creates an ownerless payment or attribution', async () => {
  const l = await ledger();
  await l.fixture('put', { values: { 'fixture:apple-proof': {
    signedPayload: 'fixture-test-notification', proof: { test: true },
  } } });
  const result = await l.api('apple-notifications', { signedPayload: 'fixture-test-notification' }, 200,
    { headers: { authorization: '' } });
  assert.deepEqual(result, { ok: true, test: true, recorded: false });
  const state = await l.inspect();
  assert.equal(Object.keys(state).filter(k => k.startsWith('payment:') || k.startsWith('chain:') || k.startsWith('event:')).length, 0);
});
test('trusted ownerless renewal without an offer ID keeps its original partner after new intake pauses', async () => {
  const l = await ledger(); const p = await l.seed(); const now = Date.now();
  const initial = appleNotificationFixture({ purchaseDate: now - 31 * DAY, originalPurchaseDate: now - 31 * DAY,
    expiresDate: now - DAY }, 'fixture-ownerless-initial');
  await l.fixture('put', { values: { 'fixture:apple-proof': initial } });
  await l.api('apple-notifications', { signedPayload: initial.signedPayload }, 200, { headers: { authorization: '' } });
  await l.call('savePartner', [{ ...p, state: 'paused', acceptsNew: false }, now]);
  assert.equal((await l.api('config')).enabled, false);
  const renewal = appleNotificationFixture({ transactionId: '100000002', purchaseDate: now - DAY,
    originalPurchaseDate: initial.proof.rawTransaction.originalPurchaseDate, expiresDate: now + 29 * DAY,
    price: 4990, offerIdentifier: undefined, offerType: undefined }, 'fixture-ownerless-renewal');
  await l.fixture('put', { values: { 'fixture:apple-proof': renewal } });
  assert.equal((await l.api('apple-notifications', { signedPayload: renewal.signedPayload }, 200,
    { headers: { authorization: '' } })).recorded, true);
  const state = await l.inspect(), chain = state['chain:ios:100000000'];
  assert.equal(chain.partnerId, 'foodiewien'); assert.equal(chain.accountId, null);
  assert.equal(chain.paymentKeys.length, 2);
  assert.equal(state['payment:ios:100000002'].grossCents, 499);
  assert.equal(state['payment:ios:100000002'].commissionCents, 150);
  assert.equal(foodie(await l.call('summary')).commissionCents, 270);
});
test('trusted Apple refund callback reverses the ownerless financial row without inventing ownership', async () => {
  const l = await ledger(); await l.seed(); const initial = appleNotificationFixture();
  await l.fixture('put', { values: { 'fixture:apple-proof': initial } });
  await l.api('apple-notifications', { signedPayload: initial.signedPayload }, 200, { headers: { authorization: '' } });
  const refunded = { signedPayload: 'fixture-ownerless-full-refund', proof: {
    notificationId: 'fixture-ownerless-refund-event', transactionId: initial.proof.transactionId,
    rawTransaction: { ...initial.proof.rawTransaction, revocationDate: Date.now(),
      revocationType: 'REFUND_FULL', revocationPercentage: 100000 },
  } };
  await l.fixture('put', { values: { 'fixture:apple-proof': refunded } });
  assert.equal((await l.api('apple-notifications', { signedPayload: refunded.signedPayload }, 200,
    { headers: { authorization: '' } })).recorded, true);
  const state = await l.inspect(), item = state['payment:ios:' + initial.proof.transactionId];
  assert.equal(item.refundedCents, 399); assert.equal(item.reversedCents, 120);
  assert.equal(state['chain:ios:100000000'].accountId, null);
  assert.equal(Object.keys(state).filter(k => k.startsWith('payment:')).length, 1);
  assert.equal(Object.keys(state).filter(k => k.startsWith('event:apple:')).length, 2);
  assert.equal(foodie(await l.call('summary')).commissionCents, 0);
});

test('closing new intake uses server time and cannot be forged or moved by repeated partner edits', async () => {
  const l = await ledger(); const p = await l.seed(); const closedAt = NOW - 2 * DAY;
  assert.equal(p.closedForNewAt, null);
  const paused = await l.call('savePartner', [{ ...p, state: 'paused', acceptsNew: false,
    closedForNewAt: NOW + DAY }, closedAt]);
  assert.equal(paused.closedForNewAt, closedAt);
  await l.api('quote', { platform: 'ios', code: p.code }, 404);
  const renamed = await l.call('savePartner', [{ ...paused, name: 'Foodiewien paused',
    closedForNewAt: 0 }, closedAt + 1000]);
  assert.equal(renamed.closedForNewAt, closedAt);
  const ended = await l.call('savePartner', [{ ...renamed, state: 'ended',
    closedForNewAt: NOW + DAY }, closedAt + 2000]);
  assert.equal(ended.closedForNewAt, closedAt, 'ending an already closed intake must not move its original cutoff');
  const reopened = await l.call('savePartner', [{ ...ended, state: 'active', acceptsNew: true,
    closedForNewAt: NOW + DAY }, closedAt + 3000]);
  assert.equal(reopened.closedForNewAt, null);
  const closedAgainAt = closedAt + 4000;
  const closedAgain = await l.call('savePartner', [{ ...reopened, acceptsNew: false,
    closedForNewAt: closedAt }, closedAgainAt]);
  assert.equal(closedAgain.closedForNewAt, closedAgainAt);
  assert.equal(closedAgain.activatedAt, p.activatedAt);
  assert.equal(closedAgain.contractRef, p.contractRef);
  assert.equal((await l.api('config')).enabled, false);
  await l.api('quote', { platform: 'android', code: p.code }, 404);
});
test('delayed first Apple confirmation preserves pre-close rights but still needs Store code proof and a strictly earlier origin', async () => {
  const l = await ledger(); const p = await l.seed(); const closedAt = NOW - 2 * DAY;
  const paused = await l.call('savePartner', [{ ...p, state: 'paused', acceptsNew: false }, closedAt]);
  const raw = apple({ originalPurchaseDate: closedAt - 1 });
  assert.ok(raw.purchaseDate > closedAt, 'first paid receipt may arrive after a subscription origin preceding closure');
  for (const cutoff of [paused, { ...paused, state: 'active', acceptsNew: true,
    closedForNewAt: null, redeemUntil: closedAt }]) {
    const e = creatorAppleEvidence(raw, [cutoff], NOW);
    assert.equal(e.partnerId, p.id); assert.equal(e.originAt, closedAt - 1);
    for (const patch of [{ originalPurchaseDate: closedAt }, { originalPurchaseDate: closedAt + 1 },
      { originalPurchaseDate: p.activatedAt - 1 }, { offerIdentifier: undefined },
      { offerIdentifier: 'unrelated-store-offer' }, { offerType: 1 }]) {
      assert.throws(() => creatorAppleEvidence({ ...raw, ...patch }, [cutoff], NOW), status(409));
    }
  }
  for (const unknownWindow of [{ ...paused, closedForNewAt: null, redeemUntil: NOW + DAY },
    { ...paused, closedForNewAt: NOW + DAY },
    { ...paused, closedForNewAt: NOW + DAY, redeemUntil: NOW + 2 * DAY }]) {
    assert.throws(() => creatorAppleEvidence(raw, [unknownWindow], NOW), status(409));
  }
  await l.api('quote', { platform: 'ios', code: p.code }, 404);
  await l.fixture('put', { values: { ['fixture:receipt:' + raw.transactionId]: { raw, now: NOW } } });
  assert.equal((await l.api('confirm', { platform: 'ios', transactionId: raw.transactionId })).recorded, true);
  const state = await l.inspect(), chain = state['chain:ios:' + raw.originalTransactionId];
  assert.equal(chain.partnerId, p.id); assert.equal(chain.accountId, OWNER);
  assert.equal(chain.terms.closedForNewAt, closedAt);
  assert.equal(state['payment:ios:' + raw.transactionId].commissionCents, 120);
  assert.equal((await l.api('config')).enabled, false);
});
test('delayed first Google confirmation uses authenticated subscription start rather than later service time or arrival', async () => {
  const l = await ledger(); const p = await l.seed(); const closedAt = NOW - 2 * DAY;
  const ended = await l.call('savePartner', [{ ...p, state: 'ended', acceptsNew: false }, closedAt]);
  const f = google(); f.purchase.startTime = new Date(closedAt - 1).toISOString();
  assert.ok(Date.parse(f.order.lineItems[0].subscriptionDetails.servicePeriodStartTime) > closedAt);
  for (const cutoff of [ended, { ...ended, state: 'active', acceptsNew: true,
    closedForNewAt: null, redeemUntil: closedAt }]) {
    const e = creatorPlayEvidence(f.purchase, f.order, HASH, [cutoff], NOW);
    assert.equal(e.partnerId, p.id); assert.equal(e.originAt, closedAt - 1);
    for (const startTime of [new Date(closedAt).toISOString(), new Date(closedAt + 1).toISOString(),
      new Date(p.activatedAt - 1).toISOString(), undefined]) {
      assert.throws(() => creatorPlayEvidence({ ...f.purchase, startTime }, f.order, HASH, [cutoff], NOW), status(409));
    }
    for (const offerId of [undefined, 'unrelated-store-offer']) {
      const order = structuredClone(f.order); order.lineItems[0].subscriptionDetails.offerId = offerId;
      assert.throws(() => creatorPlayEvidence(f.purchase, order, HASH, [cutoff], NOW), status(409));
    }
  }
  for (const unknownWindow of [{ ...ended, closedForNewAt: null, redeemUntil: NOW + DAY },
    { ...ended, closedForNewAt: NOW + DAY },
    { ...ended, closedForNewAt: NOW + DAY, redeemUntil: NOW + 2 * DAY }]) {
    assert.throws(() => creatorPlayEvidence(f.purchase, f.order, HASH, [unknownWindow], NOW), status(409));
  }
  await l.api('quote', { platform: 'android', code: p.code }, 404);
  await l.fixture('put', { values: { ['fixture:receipt:' + TOKEN]: { ...f, now: NOW } } });
  assert.equal((await l.api('confirm', { platform: 'android', purchaseToken: TOKEN })).recorded, true);
  const state = await l.inspect(), chain = state['chain:android:' + await creatorHash(TOKEN)];
  assert.equal(chain.partnerId, p.id); assert.equal(chain.accountId, OWNER);
  assert.equal(chain.terms.closedForNewAt, closedAt);
  assert.equal(state['payment:android:' + f.order.orderId].commissionCents, 120);
  assert.equal((await l.api('config')).enabled, false);
});

test('persisted reconciliation cursor passes 200 future chains, bounds due work to two and fairly wraps', async () => {
  const l = await ledger(); const p = await l.seed();
  const payments = Array.from({ length: 204 }, (_, i) => {
    const suffix = String(i).padStart(9, '0');
    return payment(p, 'pagination-' + suffix, START, 399, { key: 'ios:' + suffix });
  });
  await l.book(payments[0]);
  const initial = await l.inspect(), chainTemplate = initial['chain:' + payments[0].key];
  const paymentTemplate = initial['payment:ios:' + payments[0].receiptId];
  const rows = [];
  for (const [index, e] of payments.entries()) {
    rows.push(['chain:' + e.key, { ...chainTemplate, key: e.key, latestReceipt: e.receiptId,
      paymentKeys: ['payment:ios:' + e.receiptId], nextCheckAt: index < 201 ? NOW + 10 * DAY : NOW - DAY,
      reviewRequired: index >= 201 }]);
    rows.push(['payment:ios:' + e.receiptId, { ...paymentTemplate, receiptId: e.receiptId, chainKey: e.key }]);
    if (index >= 201) rows.push(['fixture:receipt:' + e.receiptId, { ...applePayment(e), now: NOW }]);
  }
  for (let start = 0; start < rows.length; start += 100) {
    await l.fixture('put', { values: Object.fromEntries(rows.slice(start, start + 100)) });
  }
  const futurePage = await l.call('reconcile', [NOW]);
  assert.equal(futurePage.checked, 0); assert.equal(futurePage.review, 0);
  assert.equal(futurePage.capacityLimited, false);
  let state = await l.inspect();
  assert.equal(state['reconcile-cursor'], 'chain:' + payments[199].key);
  assert.equal(state['fixture:verify-count'], undefined, 'future-only pages must not cause Store verification');
  const bounded = await l.call('reconcile', [NOW]);
  assert.equal(bounded.checked, 2); assert.equal(bounded.review, 0); assert.equal(bounded.capacityLimited, true);
  state = await l.inspect();
  assert.equal(state['reconcile-cursor'], 'chain:' + payments[202].key);
  assert.equal(state['fixture:verify-count'], 2);
  for (const e of payments.slice(201, 203)) assert.equal(state['chain:' + e.key].reviewRequired, false);
  assert.equal(state['chain:' + payments[203].key].reviewRequired, true, 'third due chain waits for a bounded next run');
  const remaining = await l.call('reconcile', [NOW]);
  assert.equal(remaining.checked, 1); assert.equal(remaining.review, 0); assert.equal(remaining.capacityLimited, false);
  state = await l.inspect();
  assert.equal(state['reconcile-cursor'], 'chain:' + payments[203].key);
  assert.equal(state['fixture:verify-count'], 3);
  assert.equal(state['chain:' + payments[203].key].reviewRequired, false);
  const firstKey = 'chain:' + payments[0].key;
  await l.fixture('put', { values: {
    [firstKey]: { ...state[firstKey], nextCheckAt: NOW - DAY, reviewRequired: true },
    ['fixture:receipt:' + payments[0].receiptId]: { ...applePayment(payments[0]), now: NOW },
  } });
  const wrapped = await l.call('reconcile', [NOW]);
  assert.equal(wrapped.checked, 1); assert.equal(wrapped.review, 0);
  state = await l.inspect();
  assert.equal(state['reconcile-cursor'], 'chain:' + payments[199].key);
  assert.equal(state['fixture:verify-count'], 4);
  assert.equal(state[firstKey].reviewRequired, false);
  assert.equal(state[firstKey].nextCheckAt, NOW + DAY);
  const noDueTail = await l.call('reconcile', [NOW]);
  assert.equal(noDueTail.checked, 0); assert.equal(noDueTail.review, 0);
  state = await l.inspect();
  assert.equal(state['reconcile-cursor'], 'chain:' + payments[203].key);
  assert.equal(state['fixture:verify-count'], 4);
  assert.equal(Object.keys(state).filter(key => key.startsWith('chain:')).length, 204);
  assert.equal(Object.keys(state).filter(key => key.startsWith('payment:')).length, 204);
});

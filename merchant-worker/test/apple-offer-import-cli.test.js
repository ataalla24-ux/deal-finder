import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, chmodSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareOffers, readPrivateCodes, importOffers } from '../scripts/import-apple-offers.mjs';
import { boundedJSON } from '../src/account-auth.js';

const now = Date.parse('2026-10-15T12:00:00Z');
const row = n => { const code = `FIXTURE${String(n).padStart(8, '0')}`; return `${code},https://apps.apple.com/redeem?ctx=offercodes&id=6758958213&code=${code}`; };
const bytes = n => Buffer.from(Array.from({ length:n }, (_, i) => row(i)).join('\n') + '\n');
const manifest = data => ({ environment:'Production',batchId:'618085',count:500,
  sha256:createHash('sha256').update(data).digest('hex'),offerId:'referral-active-monthly-2026',
  expiresAt:'2026-12-31T00:00:00.000Z',freeMonths:1,autoRenew:true,combineIntroductoryOffer:false,countries:['AT','DE'],
  sourceURL:'https://appstoreconnect.apple.com/apps/6758958213/distribution/subscriptions/6810249175/pricing/offer-codes/3f5a4d1e-eb81-40e1-9acf-b8efde5ebdcc' });

test('private import reads only owner-private bounded regular files', t => {
  const dir = mkdtempSync(join(tmpdir(), 'apple-import-fixture-')); t.after(() => rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,'codes.csv'), link=join(dir,'link.csv');
  writeFileSync(file,bytes(500),{mode:0o600}); assert.equal(readPrivateCodes(file).length,bytes(500).length);
  chmodSync(file,0o644); assert.throws(()=>readPrivateCodes(file)); chmodSync(file,0o600);
  symlinkSync(file,link); assert.throws(()=>readPrivateCodes(link));
  writeFileSync(file,Buffer.alloc(1024*1024+1)); assert.throws(()=>readPrivateCodes(file));
});

test('verified-format export preserves first row and exact metadata; no implicit Sandbox classification', () => {
  const data=bytes(500), meta=manifest(data), offers=prepareOffers(data,meta,now);
  assert.equal(offers.length,500); assert.equal(offers[0].code,'FIXTURE00000000');
  assert.equal(offers[0].customerType,'existing'); assert.equal(offers[0].environment,'Production');
  assert.equal(offers[0].expiresAt,Date.parse(meta.expiresAt));
  for(const patch of [{environment:'Sandbox'},{environment:undefined},{sha256:'0'.repeat(64)},
    {count:499},{count:0},{batchId:'bad'},{assignedTo:'owner'},{freeMonths:2},{autoRenew:false},
    {combineIntroductoryOffer:true},{countries:['US']},{offerId:'unreviewed'},
    {sourceURL:'https://outside.test'},{expiresAt:'2026-10-15T00:00:00.000Z'},
    {expiresAt:'2028-01-01T00:00:00.000Z'},{expiresAt:'2026-12-31'}]) {
    assert.throws(()=>prepareOffers(data,{...meta,...patch},now));
  }
});

test('malformed duplicate foreign-app and mismatched-code rows fail closed without exposing values', () => {
  for(const line of [row(0)+'\n'+row(0),row(0).replace('6758958213','1111111111'),
    row(0).replace('https://apps.apple.com','https://outside.test'),row(0)+'&unexpected=1',
    row(0).replace(/code=.+/,'code=OTHER123'), 'code,url', '"'+row(0)+'"', row(0)+'\n\n']) {
    const data=Buffer.from(line+'\n');
    assert.throws(()=>prepareOffers(data,{...manifest(data),count:1},now),e=>!e.message.includes('FIXTURE'));
  }
});

test('second-round inventory requires its own inspected Store offer and preserves customer/product boundaries', () => {
  const data = bytes(500);
  const definitions = [
    ['referral-active-monthly-2026-r2', '9947151e-1f9b-49bb-ab44-21e48a23951e', '6810249175', 'monthly', 'existing'],
    ['referral-earned-month-2026-r2', '938442b7-eec5-468c-a115-3633121ac360', '6810249175', 'monthly', 'new_or_expired'],
    ['referral-active-yearly-2026-r2', 'f422214a-e757-4a1e-a7df-1623a8dd65b6', '6810354972', 'yearly', 'existing'],
  ];
  for (const [offerId, uuid, product, period, customerType] of definitions) {
    const sourceURL = `https://appstoreconnect.apple.com/apps/6758958213/distribution/subscriptions/${product}/pricing/offer-codes/${uuid}`;
    const meta = {...manifest(data), offerId, sourceURL};
    const offers = prepareOffers(data, meta, now);
    assert.equal(offers.length, 500);
    assert.ok(offers.every(row => row.offerId === offerId && row.productId === `com.stefanataalla.freefinderwien.premium.${period}` &&
      row.customerType === customerType && row.freeMonths === 1 && row.autoRenew === true && row.combineIntroductoryOffer === false));
    assert.throws(() => prepareOffers(data, {...meta, sourceURL: manifest(data).sourceURL}, now));
    assert.throws(() => prepareOffers(data, {...meta, environment: 'Sandbox'}, now));
    assert.throws(() => prepareOffers(data, {...meta, offerId: offerId.replace('-r2', '-r3')}, now));
  }
});

test('bounded sequential import sends exact batches to fixed host and sanitized success only',async()=>{
  const data=bytes(500),offers=prepareOffers(data,manifest(data),now); let calls=0, offset=0;
  const result=await importOffers(offers,'fixture-secret',async(url,options)=>{
    assert.equal(url,'https://freefinder-merchant-backend.freefinder-stefan.workers.dev/api/referral-months/import-apple-offers');
    assert.equal(options.redirect,'manual'); assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.headers['x-freefinder-merchant-secret'],'fixture-secret');
    const parsed = await boundedJSON(new Request(url,options));
    assert.ok(parsed.offers.length <= 100); assert.ok(Buffer.byteLength(options.body) <= 16000);
    assert.deepEqual(parsed.offers,offers.slice(offset,offset+parsed.offers.length));
    offset+=parsed.offers.length; calls++;
    return Response.json({ok:true,ignored:'not returned'});
  });
  assert.deepEqual(result,{ok:true,confirmed:500}); assert.ok(calls>5); assert.equal(offset,500);
});

test('uncertain import stops without replay or leaking provider body and can safely reimport identical input',async()=>{
  const data=bytes(500),offers=prepareOffers(data,manifest(data),now);
  for(const bad of [()=>new Response('secret',{status:302,headers:{location:'https://outside'}}),
    ()=>Response.json({ok:false,private:'secret'}),()=>new Response('secret'.repeat(1024)),
    ()=>{throw Error('secret');}]) {
    let calls=0, firstCount=0;
    await assert.rejects(()=>importOffers(offers,'fixture-secret',async(_url,options)=>{
      if(++calls===1){firstCount=JSON.parse(options.body).offers.length;return Response.json({ok:true});}return bad();
    }),e=>e.message.includes(`${firstCount} confirmed`) && !e.message.includes('secret'));
    assert.equal(calls,2);
  }
});

test('oversize rows and invalid credentials cannot cause any partial import',async()=>{
  let calls=0; const transport=async()=>{calls++;return Response.json({ok:true});};
  await assert.rejects(()=>importOffers([{code:'fixture'},{code:'x'.repeat(17000)}],'fixture-secret',transport));
  await assert.rejects(()=>importOffers([{code:'fixture'}],'',transport));
  await assert.rejects(()=>importOffers([{code:'fixture'}],'unsafe\nsecret',transport));
  assert.equal(calls,0);
});

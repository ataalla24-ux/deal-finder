import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, symlinkSync, statSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { privateInput, privateOutput, reviewRequest } from '../scripts/referral-support.mjs';

test('operator input is owner-private regular bounded JSON; output never overwrites or follows links',t=>{
  const dir=mkdtempSync(join(tmpdir(),'freefinder-support-fixture-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const input=join(dir,'input.json'),output=join(dir,'result.json'),link=join(dir,'link.json');
  writeFileSync(input,'{}',{mode:0o600}); assert.deepEqual(privateInput(input),{});
  chmodSync(input,0o644); assert.throws(()=>privateInput(input)); chmodSync(input,0o600);
  symlinkSync(input,link); assert.throws(()=>privateInput(link));
  writeFileSync(input,'[]'); assert.throws(()=>privateInput(input));
  writeFileSync(input,JSON.stringify({value:'x'.repeat(16000)})); assert.throws(()=>privateInput(input));
  privateOutput(output,{ok:true}); assert.equal(statSync(output).mode & 0o777,0o600);
  assert.throws(()=>privateOutput(output,{ok:false})); assert.equal(JSON.parse(readFileSync(output)).ok,true);
  assert.throws(()=>privateOutput(link,{ok:false}));
});

test('operator uses fixed host, manual redirects, existing credential and single request only',async()=>{
  let calls=0;
  const transport=async(url,options)=>{
    calls++;
    assert.equal(url,'https://freefinder-merchant-backend.freefinder-stefan.workers.dev/api/referral-months/support-case');
    assert.equal(options.redirect,'manual');assert.equal(options.headers['x-freefinder-merchant-secret'],'fixture-admin');
    assert.equal(options.body,'{}');assert.ok(options.signal instanceof AbortSignal);
    return Response.json({ok:true,case:{state:'store_pending'}});
  };
  assert.equal((await reviewRequest('support-case',{},'fixture-admin',transport)).ok,true);
  assert.equal(calls,1);
  for(const action of ['../other','https://outside','redeem','import-apple-offers']) {
    await assert.rejects(()=>reviewRequest(action,{},'fixture-admin',transport));
  }
  assert.equal(calls,1);
});

test('operator never follows redirects, retries unknown results or prints provider/contact diagnostics',async()=>{
  for(const status of [302,401,403,409,503]) {
    let calls=0;
    await assert.rejects(()=>reviewRequest('support-cases',{},'fixture-admin',async()=>{
      calls++;return new Response('private@example.test secret',{status,headers:{location:'https://outside'}});
    }),error=>!error.message.includes('private') && error.message.includes(String(status)));
    assert.equal(calls,1);
  }
  for(const transport of [async()=>{throw Error('private token');},
    async()=>new Response('bad private token'),async()=>Response.json({ok:false,secret:'private token'}),
    async()=>new Response('x'.repeat(256*1024+1))]) {
    await assert.rejects(()=>reviewRequest('support-case',{},'fixture-admin',transport),e=>!e.message.includes('private token'));
  }
});

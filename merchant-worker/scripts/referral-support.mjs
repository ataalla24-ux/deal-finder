import { execFileSync } from 'node:child_process';
import { constants, openSync, fstatSync, readFileSync, writeFileSync, closeSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const actions = new Set(['support-cases', 'support-case', 'support-review']);
const host = 'https://freefinder-merchant-backend.freefinder-stefan.workers.dev';

export function privateInput(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.mode & 0o077 || stat.uid !== process.getuid() || stat.size > 16000) {
      throw Error('Input must be a private owner-held regular JSON file of at most16KB.');
    }
    const value = JSON.parse(readFileSync(fd, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Input must be a JSON object.');
    return value;
  } finally { closeSync(fd); }
}

export async function reviewRequest(action, body, secret, transport = fetch) {
  if (!actions.has(action) || typeof secret !== 'string' || !secret.trim() || /[\r\n]/.test(secret)) {
    throw Error('Invalid support action or missing existing administrator credential.');
  }
  let response;
  try {
    response = await transport(`${host}/api/referral-months/${action}`, { method:'POST', redirect:'manual',
      signal:AbortSignal.timeout(25000), headers:{'content-type':'application/json','x-freefinder-merchant-secret':secret},
      body:JSON.stringify(body) });
  } catch { throw Error('Support request unavailable. Do not change the request ID after an uncertain result.'); }
  if (!response.ok) throw Error(`Support request failed (HTTP ${response.status}). No automatic retry.`);
  const reader = response.body?.getReader();
  if (!reader) throw Error('Empty support response.');
  const chunks=[]; let length=0;
  try {
    while (true) {
      const {done,value}=await reader.read(); if(done) break;
      length+=value.byteLength;
      if(length>256*1024) {await reader.cancel(); throw Error('Response exceeds limit.');}
      chunks.push(value);
    }
    const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(value?.ok!==true) throw Error('Unconfirmed result.');
    return value;
  } catch { throw Error('Support response invalid or unavailable. Retain the original request ID.'); }
}

export function privateOutput(path, result) {
  const fd=openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {writeFileSync(fd,JSON.stringify(result,null,2)+'\n');} finally {closeSync(fd);}
}

async function main() {
  const [action,input,output]=process.argv.slice(2);
  if(process.argv.length!==5 || !actions.has(action)) {
    throw Error('Usage: node scripts/referral-support.mjs support-cases|support-case|support-review PRIVATE_INPUT.json NEW_PRIVATE_OUTPUT.json');
  }
  const body=privateInput(input);
  let secret=process.env.REFERRAL_ADMIN_SECRET;
  if(!secret) {
    try {secret=execFileSync('security',['find-generic-password','-s','freefinder-referral-admin','-a','freefinder','-w'],
      {encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}
    catch {throw Error('Existing referral administrator credential unavailable. No new credential was created.');}
  }
  const result=await reviewRequest(action,body,secret);
  secret=undefined;
  privateOutput(output,result);
  console.log('Support result saved privately. No billing or subscription action was performed.');
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  main().catch(error=>{console.error(error.message);process.exitCode=1;});
}

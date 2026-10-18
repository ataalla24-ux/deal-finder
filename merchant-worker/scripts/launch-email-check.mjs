import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
if (args.length && (args.length !== 1 || args[0] !== '--send-two-approved-tests')) throw Error('Invalid arguments');
let secret = execFileSync('security', ['find-generic-password', '-s', 'freefinder-merchant-promo-admin', '-a', 'freefinder', '-w'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const url = 'https://freefinder-merchant-backend.freefinder-stefan.workers.dev/api/email/admin/launch-test';
async function request(slot) {
  const r = await fetch(url, { method: slot ? 'POST' : 'GET', redirect: 'manual', signal: AbortSignal.timeout(25000),
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    ...(slot ? { body: JSON.stringify({ slot }) } : {}) });
  if (!r.ok) throw Error(`Launch email check: HTTP ${r.status}`);
  return r.json();
}
const result = { checkedAt: new Date().toISOString(), sent: [] };
if (args.length) for (const slot of [1, 2]) result.sent.push({ slot, ...await request(slot) });
result.status = await request();
secret = undefined;
console.log(JSON.stringify(result, null, 2));

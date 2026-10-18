import { execFileSync } from 'node:child_process';
if (process.argv.length !== 2) throw Error('No arguments accepted. Read-only aggregate status.');
let secret = execFileSync('security', ['find-generic-password', '-s', 'freefinder-referral-admin', '-a', 'freefinder', '-w'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const base = 'https://freefinder-merchant-backend.freefinder-stefan.workers.dev/api/referral-months/';
async function read(action, body = {}) {
  const r = await fetch(base + action, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(25000),
    headers: { 'content-type': 'application/json', 'x-freefinder-merchant-secret': secret }, body: JSON.stringify(body) });
  if (!r.ok) throw Error(`${action}: HTTP ${r.status}`);
  const result = await r.json();
  if (!result.ok) throw Error(`${action}: unconfirmed`);
  return result;
}
const report = { checkedAt: new Date().toISOString(), sections: {} };
for (const section of ['offers', 'accounts', 'deliveries']) {
  const total = { scanned: 0, counts: {}, complete: false };
  let cursor;
  for (let page = 0; page < 100; page++) {
    const result = await read('operations-status', { section, ...(cursor ? { cursor } : {}) });
    total.scanned += result.scanned;
    for (const [key, count] of Object.entries(result.counts)) total.counts[key] = (total.counts[key] || 0) + count;
    report.email = result.email; report.referralEnabled = result.referralEnabled;
    if (result.complete) { total.complete = true; break; }
    if (!result.cursor || result.cursor === cursor) throw Error('Pagination stalled');
    cursor = result.cursor;
  }
  report.sections[section] = total;
}
report.reconciliation = await read('reconciliation-status');
report.push = await read('push-status');
report.preview = await read('push-preview');
secret = undefined;
console.log(JSON.stringify(report, null, 2));

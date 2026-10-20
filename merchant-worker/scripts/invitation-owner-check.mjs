import { execFileSync } from 'node:child_process';

const action = process.argv[2] || 'status';
if (process.argv.length > 3 || !['status', 'send'].includes(action)) throw Error('Use status or send; no recipient arguments.');
let secret = execFileSync('security', ['find-generic-password', '-s', 'freefinder-merchant-promo-admin', '-a', 'freefinder', '-w'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const response = await fetch('https://freefinder-merchant-backend.freefinder-stefan.workers.dev/api/invitations/admin/owner-test', {
  method: action === 'send' ? 'POST' : 'GET', redirect: 'manual', signal: AbortSignal.timeout(30000),
  headers: { authorization: `Bearer ${secret}` },
});
secret = undefined;
const result = await response.json();
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), httpStatus: response.status, ...result }, null, 2));
if (!response.ok || !result.ok) process.exitCode = 1;

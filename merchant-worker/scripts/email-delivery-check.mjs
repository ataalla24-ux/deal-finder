import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
if (args.length && (args.length !== 1 || args[0] !== '--send-approved-test')) {
  throw Error('Use no argument for status or --send-approved-test for the explicitly approved one-time owner test.');
}
let secret;
try {
  secret = execFileSync('security', ['find-generic-password', '-s', 'freefinder-merchant-promo-admin', '-a', 'freefinder', '-w'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
} catch { throw Error('Existing admin credential unavailable.'); }
const response = await fetch('https://freefinder-merchant-backend.freefinder-stefan.workers.dev/api/email/admin/owner-test', {
  method: args.length ? 'POST' : 'GET', redirect: 'manual', signal: AbortSignal.timeout(20000),
  headers: { authorization: `Bearer ${secret}` },
});
secret = undefined;
if (!response.ok) throw Error(`Owner email check failed (HTTP ${response.status}).`);
const result = await response.json();
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), ...result }, null, 2));

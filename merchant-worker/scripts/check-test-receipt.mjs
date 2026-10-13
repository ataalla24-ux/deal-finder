import { execFileSync } from 'node:child_process';
import { constants, openSync, fstatSync, readFileSync, closeSync } from 'node:fs';

if (process.argv.length !== 3) throw Error('Pass the path of a private mode600 JSON test-receipt file. Never pass a token in command arguments.');
const fd = openSync(process.argv[2], constants.O_RDONLY | constants.O_NOFOLLOW);
let body;
try {
  const stat = fstatSync(fd);
  if (!stat.isFile() || stat.mode & 0o077 || stat.uid !== process.getuid() || stat.size > 16000) {
    throw Error('Test receipt input must be a private, owner-held regular file of at most16KB.');
  }
  body = readFileSync(fd, 'utf8');
  try { JSON.parse(body); } catch { throw Error('Invalid private JSON input.'); }
} finally { closeSync(fd); }
let secret;
try {
  secret = execFileSync('security', ['find-generic-password', '-s', 'freefinder-merchant-promo-admin', '-a', 'freefinder', '-w'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
} catch { throw Error('Existing admin credential unavailable.'); }
const response = await fetch('https://freefinder-merchant-backend.freefinder-stefan.workers.dev/api/subscriptions/admin/test-receipt', {
  method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(25000),
  headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body,
});
secret = undefined; body = undefined;
if (!response.ok) throw Error(`Read-only test receipt check failed (HTTP ${response.status}).`);
const result = await response.json();
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), ...result }, null, 2));

import { execFileSync } from 'node:child_process';

// Fixed production read-only route; credentials cannot be redirected to a caller-selected host.
if (process.argv.length > 2) {
  console.log('node scripts/store-catalog.mjs\nRead-only FreeFinder Play catalog. Admin access uses MERCHANT_PROMO_ADMIN_SECRET or the existing macOS Keychain entry.');
  process.exit(process.argv[2] === '--help' ? 0 : 1);
}
try {
  let secret = process.env.MERCHANT_PROMO_ADMIN_SECRET?.trim();
  if (!secret && process.platform === 'darwin') {
    try { secret = execFileSync('security', ['find-generic-password', '-s', 'freefinder-merchant-promo-admin', '-a', 'freefinder', '-w'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
  }
  if (!secret) throw Error('Admin access unavailable; no request sent.');
  const response = await fetch('https://freefinder-merchant-backend.freefinder-stefan.workers.dev/api/subscriptions/admin/play-catalog', {
    method: 'GET', headers: { authorization: `Bearer ${secret}` }, redirect: 'error', signal: AbortSignal.timeout(25000),
  });
  const result = await response.json();
  console.log(JSON.stringify({ httpStatus: response.status, ...result }, null, 2));
  if (!response.ok || result.ok !== true) process.exitCode = 1;
} catch {
  console.error('Store catalog check failed. Verify admin access and connectivity; no Store change was requested.');
  process.exitCode = 1;
}

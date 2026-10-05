import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  restaurant: { type: 'string' }, label: { type: 'string' }, days: { type: 'string', default: '30' },
  id: { type: 'string' }, endpoint: { type: 'string', default: 'https://freefinder-merchant-backend.freefinder-stefan.workers.dev' },
  shared: { type: 'string' },
  package: { type: 'string', default: 'starter' },
  help: { type: 'boolean', short: 'h' },
} });
const command = positionals[0];
if (values.help || !['create', 'list', 'revoke'].includes(command)) {
  console.log('npm run promos -- create --restaurant "Restaurantname" [--label "Notiz"] [--days 30]\n'
    + 'npm run promos -- create --shared STARTERGRATIS [--label "Notiz"]\n'
    + 'npm run promos -- list\nnpm run promos -- revoke --id CODE_ID\n'
    + '--package starter|spotlight|city: 1, 3 oder 8 Tage Anzeige, einmalig 0 EUR (Standard: starter).\n'
    + '--days: Gueltigkeit individueller Codes, nicht Anzeigenlaufzeit. Gemeinsame Codes: ohne Ablauf, einmal je Restaurant und Code.\n'
    + 'Admin-Zugang: MERCHANT_PROMO_ADMIN_SECRET oder macOS-Schluesselbund (freefinder-merchant-promo-admin).');
  process.exit(values.help ? 0 : 1);
}
try {
  const endpoint = new URL(values.endpoint);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.pathname !== '/') throw new Error('HTTPS-API-Origin erwartet.');
  let secret = process.env.MERCHANT_PROMO_ADMIN_SECRET?.trim();
  if (!secret && process.platform === 'darwin') {
    try { secret = execFileSync('security', ['find-generic-password', '-s', 'freefinder-merchant-promo-admin', '-a', 'freefinder', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
  }
  if (!secret) throw new Error('Admin-Zugang fehlt. MERCHANT_PROMO_ADMIN_SECRET sicher konfigurieren.');
  let path = '/codes';
  let payload;
  if (command === 'create') {
    if (!['starter', 'spotlight', 'city'].includes(values.package)) throw new Error('--package: starter, spotlight oder city.');
    if (!values.restaurant?.trim() && !values.shared) throw new Error('--restaurant oder --shared CODE ist erforderlich.');
    payload = { restaurantName: values.restaurant, label: values.label || '', expiresInDays: Number(values.days), packageId: values.package, kind: values.shared ? 'shared' : 'individual', code: values.shared };
  } else if (command === 'revoke') {
    if (!values.id) throw new Error('--id ist erforderlich.');
    path = '/revoke'; payload = { id: values.id };
  }
  const response = await fetch(`${endpoint.origin}/api/merchant/promos/admin${path}`, {
    method: command === 'list' ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    body: payload ? JSON.stringify(payload) : undefined, signal: AbortSignal.timeout(20000),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.message); process.exitCode = 1;
}

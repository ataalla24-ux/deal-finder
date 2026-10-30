import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { creatorDrafts } from '../src/creator-program.js';

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  file: { type: 'string' }, out: { type: 'string' }, help: { type: 'boolean', short: 'h' },
} });
const [command] = positionals;
const routes = { list: ['GET', 'partners'], summary: ['GET', 'summary'], seed: ['POST', 'seed'],
  configure: ['POST', 'partner'], settings: ['POST', 'settings'], reconcile: ['POST', 'reconcile'],
  statement: ['POST', 'statement'], 'record-transfer': ['POST', 'paid'], 'adjust-refund': ['POST', 'adjust-refund'] };
const help = `Creator-Pilot: fünf Partner, standardmäßig inaktiv. Keine Überweisung wird ausgelöst.
  node scripts/creators.mjs drafts --out /absoluter/pfad/partner-entwuerfe.json
  node scripts/creators.mjs seed
  node scripts/creators.mjs list
  node scripts/creators.mjs configure --file partner.json
  node scripts/creators.mjs settings --file freigaben.json
  node scripts/creators.mjs summary --out /absoluter/pfad/uebersicht.json
  node scripts/creators.mjs reconcile
  node scripts/creators.mjs statement --file monatsabrechnung-anfrage.json
  node scripts/creators.mjs record-transfer --file tatsaechliche-ueberweisung.json
  node scripts/creators.mjs adjust-refund --file bestaetigte-erstattung.json
Admin-Zugang: bestehender MERCHANT_PROMO_ADMIN_SECRET oder macOS-Schlüsselbund
(freefinder-merchant-promo-admin). Niemals Schlüssel in Dateien/Argumente schreiben.
Vor echtem Start: Vertragsfreigabe, Store-Konfiguration, echte Einlösetests und
App-Updates; alle vier CREATOR_*_ENABLED-Flags bleiben bis dahin 0.`;
try {
  if (values.help || !command) { console.log(help); process.exit(0); }
  if (command === 'drafts') {
    const content = JSON.stringify({ partners: creatorDrafts(), settings: {
      termsApproved: false, transportReady: false, releasesVerified: false, maxPartners: 5, holdDays: 30,
    } }, null, 2) + '\n';
    if (values.out) await writeFile(values.out, content, { flag: 'wx', mode: 0o600 });
    else console.log(content);
    process.exit(0);
  }
  if (!routes[command]) throw Error('Unbekannter Befehl. --help zeigt die Befehle.');
  let secret = process.env.MERCHANT_PROMO_ADMIN_SECRET?.trim();
  if (!secret && process.platform === 'darwin') {
    try { secret = execFileSync('security', ['find-generic-password', '-s', 'freefinder-merchant-promo-admin', '-a', 'freefinder', '-w'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
  }
  if (!secret) throw Error('Bestehender Admin-Zugang fehlt. Kein neuer Schlüssel wurde angelegt.');
  const [method, path] = routes[command];
  const needsFile = ['configure', 'settings', 'statement', 'record-transfer', 'adjust-refund'].includes(command);
  if (needsFile && !values.file) throw Error('--file mit geprüfter JSON-Anfrage ist erforderlich.');
  let body = values.file ? JSON.parse(await readFile(values.file, 'utf8')) : {};
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error('JSON-Objekt erwartet.');
  if (command === 'configure') body = { partner: body };
  const response = await fetch('https://freefinder-merchant-backend.freefinder-stefan.workers.dev/api/creators/admin/' + path, {
    method, headers: { authorization: 'Bearer ' + secret, 'content-type': 'application/json' },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}), redirect: 'manual', signal: AbortSignal.timeout(60000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) throw Error(result?.error || 'Creator-Dienst noch nicht bereit (HTTP ' + response.status + ').');
  const content = JSON.stringify(result, null, 2) + '\n';
  if (values.out) { await writeFile(values.out, content, { flag: 'wx', mode: 0o600 }); console.log('Private Ausgabe gespeichert: ' + values.out); }
  else console.log(content);
} catch (error) { console.error(error.message); process.exitCode = 1; }

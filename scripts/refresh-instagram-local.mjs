import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { extractCookieOutput, validateBrowserSession } from './refresh-instagram-cookies.mjs';

const REPOSITORY = 'ataalla24-ux/deal-finder';
const ACCOUNT = 'dermarollerdesign';

export function publishScraperSession(output, run = spawnSync) {
  if (!output.cookieString || !output.sessionId) throw new Error('Verifizierte Sitzung unvollständig; keine weitere Aktualisierung.');
  for (const [name, value] of [['INSTAGRAM_COOKIES', output.cookieString], ['INSTAGRAM_SESSIONID', output.sessionId]]) {
    // Secret bytes travel over stdin only, never arguments, files or logs.
    const result = run('gh', ['secret', 'set', name, '--repo', REPOSITORY], { input: value, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 });
    if (result.status !== 0) throw new Error(`Aktualisierung von ${name} fehlgeschlagen; vorherige Schritte können bereits gespeichert sein.`);
    console.log(`Updated ${name}; value not displayed`);
  }
}

async function main() {
  if (process.env.GITHUB_ACTIONS || !process.argv.includes('--interactive-update')) {
    throw new Error('Nur lokal mit --interactive-update und persönlicher Anmeldung erlaubt.');
  }
  const auth = spawnSync('gh', ['auth', 'status', '--hostname', 'github.com'], { stdio: 'ignore', timeout: 15000 });
  if (auth.status !== 0) throw new Error('Lokale GitHub-Anmeldung fehlt. Kein Browser-Login gestartet.');
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  try {
    const context = await browser.newContext({ locale: 'de-AT', timezoneId: 'Europe/Vienna', viewport: null });
    const page = await context.newPage();
    await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    console.log('WAITING_FOR_OWNER_LOGIN: Bitte im separaten Chrome-Fenster mit dem Scraper-Konto anmelden und Sicherheitsabfragen dort bestätigen. Zeitlimit: 12 Minuten.');
    const deadline = Date.now() + 12 * 60 * 1000;
    while (Date.now() < deadline) {
      if (page.isClosed()) throw new Error('Anmeldefenster geschlossen; keine Secrets aktualisiert.');
      const cookies = await context.cookies('https://www.instagram.com/');
      const session = cookies.find(cookie => cookie.name === 'sessionid' && cookie.value);
      const owner = cookies.find(cookie => cookie.name === 'ds_user_id' && cookie.value);
      if (session && owner) {
        await validateBrowserSession(page, { username: ACCOUNT, expectedUserId: owner.value });
        console.log('ACCOUNT_AND_SESSION_VERIFIED: true');
        const output = await extractCookieOutput(context);
        publishScraperSession(output);
        console.log('LOCAL_REFRESH_COMPLETE: beide Scraper-Secrets aktualisiert; keine Sammlung ausgelöst und keine Zugriffspausen verändert.');
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    throw new Error('Anmeldung nicht innerhalb des Zeitlimits abgeschlossen; keine Secrets aktualisiert.');
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  // Browser/CLI errors can contain submitted values; only our fixed messages are safe.
  const message = String(error?.message || '');
  const known = /^(Nur lokal|Lokale GitHub|Anmeldefenster geschlossen|Anmeldung nicht|Aktualisierung von INSTAGRAM_|Verifizierte Sitzung|Eigene Profilansicht|Instagram Profilprüfung)/.test(message);
  console.error(known ? message : 'Lokale Sitzungs-Erneuerung fehlgeschlagen; kein weiterer Login-Versuch.');
  process.exitCode = 1;
});

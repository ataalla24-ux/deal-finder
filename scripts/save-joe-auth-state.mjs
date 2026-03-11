import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DEFAULT_OUTPUT = path.join(ROOT, '.secrets', 'joe.storage-state.json');
const OUTPUT_PATH = process.env.JOE_STORAGE_STATE || DEFAULT_OUTPUT;

async function main() {
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ locale: 'de-AT' });
  const page = await context.newPage();

  console.log('Öffne jö Login. Bitte im Browser anmelden und danach Enter drücken.');
  console.log(`Storage State wird gespeichert unter: ${OUTPUT_PATH}`);
  await page.goto('https://www.joe-club.at/vorteile', {
    waitUntil: 'domcontentloaded',
    timeout: 90000,
  });

  process.stdin.setEncoding('utf8');
  await new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once('data', () => resolve());
  });

  await context.storageState({ path: OUTPUT_PATH });
  console.log(`Gespeichert: ${OUTPUT_PATH}`);
  await browser.close();
}

main().catch((error) => {
  console.error('Konnte jö auth state nicht speichern:', error);
  process.exit(1);
});

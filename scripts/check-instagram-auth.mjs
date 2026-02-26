import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const envPath = path.join(ROOT, '.env');

function loadEnv() {
  if (!fs.existsSync(envPath)) return {};
  const out = {};
  const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const idx = t.indexOf('=');
    if (idx <= 0) continue;
    out[t.slice(0, idx).trim()] = t.slice(idx + 1).trim();
  }
  return out;
}

const env = { ...loadEnv(), ...process.env };

const hasSession = Boolean((env.INSTAGRAM_SESSIONID || '').trim());
const cookieFile = (env.INSTAGRAM_COOKIES_FILE || '').trim();
const hasCookieFile = Boolean(cookieFile) && fs.existsSync(cookieFile);

console.log('Instagram auth status:');
console.log(`- INSTAGRAM_SESSIONID: ${hasSession ? 'set' : 'missing'}`);
console.log(`- INSTAGRAM_COOKIES_FILE: ${hasCookieFile ? `found (${cookieFile})` : (cookieFile ? `missing file (${cookieFile})` : 'not set')}`);

if (!hasSession && !hasCookieFile) {
  console.log('\nNo Instagram auth configured. Public scraping will usually hit login wall and return 0 links.');
  process.exit(2);
}

console.log('\nAuth hints found. You can run: npm run instagram');

import { chromium } from 'playwright';
import { readJoeBenefits } from '../scraper/joe-scraper.js';

// This read-only comparison never returns coupon copy, response bodies or session values.
const browser = await chromium.launch({ headless: true });
try {
  const saved = process.env.JOE_STORAGE_STATE_B64;
  if (saved) {
    try {
      const storage = JSON.parse(Buffer.from(saved, 'base64').toString('utf8'));
      const result = await readJoeBenefits(browser, storage, { signalsOnly: true });
      console.log(JSON.stringify({ context: 'saved', ...result.health }));
    } catch { console.log(JSON.stringify({ context: 'saved', status: 'state-or-navigation-unreadable' })); }
  } else console.log(JSON.stringify({ context: 'saved', status: 'not-configured' }));
  const guest = await readJoeBenefits(browser, undefined, { signalsOnly: true });
  console.log(JSON.stringify({ context: 'guest', ...guest.health }));
} catch {
  console.error('Guest navigation or rendering failed.');
  process.exitCode = 1;
} finally { await browser.close(); }

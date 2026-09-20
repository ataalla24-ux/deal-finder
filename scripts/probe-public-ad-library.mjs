import fs from 'node:fs/promises';
import { chromium } from 'playwright';

// Public search only. No personal cookies, credentials, private endpoints,
// proxy rotation, CAPTCHA solving, or retries around access restrictions.
const url = new URL('https://www.facebook.com/ads/library/');
for (const [key, value] of Object.entries({
  active_status: 'active', ad_type: 'all', country: 'AT',
  is_targeted_country: 'false', media_type: 'all',
  'publisher_platforms[0]': 'instagram', q: 'gratis Kaffee Wien',
  search_type: 'keyword_unordered',
})) url.searchParams.set(key, value);

const report = {
  checkedAt: new Date().toISOString(),
  source: 'Meta Ad Library public web',
  authenticated: false,
  status: 'unavailable',
  visibleAdCards: 0,
  slackDeliveryEnabled: false,
};
let browser;
try {
  browser = await chromium.launch();
  const context = await browser.newContext({ locale: 'de-DE' });
  const page = await context.newPage();
  const response = await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 45000 });
  report.httpStatus = response?.status() || 0;
  if ([401, 403, 429].includes(report.httpStatus)) {
    report.reason = 'public-access-restricted';
  } else {
    // Cookie preference is not an authentication bypass.
    const rejectCookies = page.getByRole('button', { name: /Decline optional cookies|Optionale Cookies ablehnen/i });
    if (await rejectCookies.count() === 1 && await rejectCookies.isVisible()) await rejectCookies.click();
    await page.getByText(/Bibliotheks-ID:|Library ID:|Keine Ergebnisse|No results|Log in to continue|Melde dich an, um fortzufahren/i).first()
      .waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
    const text = await page.locator('body').innerText();
    report.visibleAdCards = new Set([...text.matchAll(/(?:Bibliotheks-ID|Library ID):\s*(\d+)/g)].map((match) => match[1])).size;
    if (/\/login|\/checkpoint|\/challenge/.test(new URL(page.url()).pathname)
      || /confirm you are human|security check|Sicherheitskontrolle|temporarily blocked|vor\u00fcbergehend blockiert/i.test(text)) {
      report.reason = 'authentication-or-security-check';
    } else if (report.visibleAdCards) {
      report.status = 'accessible';
      report.reason = 'visible-public-ad-cards';
    } else if (/Keine Ergebnisse|No results found/i.test(text)) {
      report.status = 'empty';
      report.reason = 'explicit-empty-result';
    } else {
      report.reason = 'public-results-not-readable';
    }
  }
} catch {
  report.reason = 'browser-or-navigation-failed';
} finally {
  await browser?.close();
  await fs.mkdir('artifacts', { recursive: true });
  await fs.writeFile('artifacts/public-ad-library-access.json', `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
  if (report.status === 'unavailable') process.exitCode = 1;
}

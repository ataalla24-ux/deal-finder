import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { load } from 'cheerio';

const html = fs.readFileSync(new URL('../docs/pro-test.html', import.meta.url), 'utf8');
const code = fs.readFileSync(new URL('../docs/pro-test.js', import.meta.url), 'utf8');
const apple = 'https://apps.apple.com/app/id6758958213';
const google = 'https://play.google.com/store/apps/details?id=com.stefanataalla.freefinderwien';
const $ = load(html);
assert.equal($('h1').length, 1);
assert.equal($('link[rel="canonical"]').attr('href'), 'https://freefinder.at/pro-test.html');
assert.equal($('meta[property="og:image"]').attr('content'), 'https://freefinder.at/icon-512.png');
assert.equal($('meta[property="og:url"]').attr('content'), $('link[rel="canonical"]').attr('href'));
assert.equal($('meta[property="og:title"]').attr('content'), $('title').text());
assert.equal($('meta[name="twitter:image"]').attr('content'), $('meta[property="og:image"]').attr('content'));
assert.equal($('#primary-store').attr('href'), apple);
assert.equal($('#alternative-store').attr('href'), google);
assert.equal($('a[href^="freefinder:"]').length, 0, 'new-customer QR does not open an installed app');
assert.equal($('script[src^="pro-test.js"][defer]').length, 1);
assert.equal($('details').length, 3);
assert.match($('.reassurance').text(), /Heute zahlst du nichts.*Jederzeit kündbar/);
assert.equal($('.hero .price').length, 0);
assert.match($('details').text(), /automatisch für 4,99.*pro Monat/);
assert.match($('.eligibility').text(), /berechtigte Neukunden/);
assert.match($('details').text(), /24 Stunden/);
assert.doesNotMatch(html, /current-ios\/deals-home|Testangebot in der App öffnen/);
assert.doesNotMatch(code, /fetch\(|localStorage|sessionStorage|setTimeout|location\.search|document\.cookie/);
for (const file of ['flyer-food-20261023-portrait.webp', 'flyer-food-20261023-wide.webp']) {
  const image = fs.readFileSync(new URL(`../docs/assets/campaigns/${file}`, import.meta.url));
  assert.equal(image.toString('ascii', 8, 12), 'WEBP');
  assert.ok(image.length < 300000, 'lightweight background, not the multi-megabyte original');
  assert.ok(html.includes(file));
}
const cases = [
  ['iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 'iPhone', 5, apple],
  ['iPad', 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)', 'iPad', 5, apple],
  ['desktop-mode iPad', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', 'MacIntel', 5, apple],
  ['Android Chrome', 'Mozilla/5.0 (Linux; Android 15; Pixel 8) Chrome/130', 'Linux armv8l', 5, google],
  ['Android in-app browser', 'Mozilla/5.0 (Linux; Android 15) FB_IAB/FB4A', 'Linux', 5, google],
  ['desktop Mac', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)', 'MacIntel', 0, undefined],
  ['Windows', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Win32', 0, undefined],
  ['unknown', '', '', 0, undefined],
  ['mobile crawler', 'Googlebot Smartphone Android', 'Linux', 5, undefined],
  ['link preview', 'facebookexternalhit/1.1 (iPhone)', '', 0, undefined],
];
for (const [label, userAgent, platform, maxTouchPoints, expected] of cases) {
  for (const navigationBlocked of [false, true]) {
    const nodes = { 'primary-store': { href: apple }, 'alternative-store': { href: google } };
    const navigations = [];
    vm.runInNewContext(code, {
      navigator: { userAgent, platform, maxTouchPoints },
      document: { getElementById: id => nodes[id] },
      window: { location: { replace: url => { navigations.push(url); if (navigationBlocked) throw Error('blocked'); } } },
    });
    assert.deepEqual(navigations, expected ? [expected] : [], label);
    if (expected) {
      assert.equal(nodes['primary-store'].href, expected, `${label}: manual fallback`);
      assert.equal(nodes['alternative-store'].href, expected === apple ? google : apple);
    }
  }
}
console.log(`Flyer website passed: ${cases.length * 2} routing/fallback cases, unchanged QR destination, clear subscription terms, no tracking or app-opening action.`);

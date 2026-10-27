import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { load } from 'cheerio';

const html = fs.readFileSync(new URL('../docs/app/index.html', import.meta.url), 'utf8');
const $ = load(html);
const apple = 'https://apps.apple.com/app/id6758958213';
const google = 'https://play.google.com/store/apps/details?id=com.stefanataalla.freefinderwien';
const scriptUrl = new URL($('script[src]').attr('src'), 'https://freefinder.at/app/');
const code = fs.readFileSync(new URL(`../docs${scriptUrl.pathname}`, import.meta.url), 'utf8');

assert.equal($('h1').text(), 'FreeFinder');
assert.equal($('link[rel="canonical"]').attr('href'), 'https://freefinder.at/app/');
assert.match($('meta[name="robots"]').attr('content'), /noindex/);
assert.equal($('meta[property="og:url"]').attr('content'), 'https://freefinder.at/app/');
assert.equal($('meta[property="og:title"]').attr('content'), $('title').text());
assert.equal($('meta[property="og:image"]').attr('content'), 'https://freefinder.at/icon-512.png');
assert.equal($('meta[name="twitter:image"]').attr('content'), $('meta[property="og:image"]').attr('content'));
assert.equal($('#primary-store').attr('href'), apple, 'iPhone download works without JavaScript');
assert.equal($('#alternative-store').attr('href'), google, 'Android download works without JavaScript');
assert.equal($('script').length, 1, 'Only the existing, first-party routing script');
assert.equal(scriptUrl.origin, 'https://freefinder.at');
assert.equal(scriptUrl.pathname, '/pro-test.js');
assert.ok($('script').is('[defer]'));
assert.equal($('form, iframe, a[href^="freefinder:"]').length, 0);
assert.doesNotMatch($('body').text(), /4,99|Testmonat|Pro testen|SPOTLIGHTGRATIS/);
assert.doesNotMatch(code, /fetch\s*\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|location\.search|location\.hash|document\.cookie/);

const devices = [
  ['iPhone Safari', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari', 'iPhone', 5, apple],
  ['iPhone Instagram', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Instagram', 'iPhone', 5, apple],
  ['Android Chrome', 'Mozilla/5.0 (Linux; Android 15; Pixel 8) Chrome/130', 'Linux armv8l', 5, google],
  ['Android Instagram', 'Mozilla/5.0 (Linux; Android 15) Instagram', 'Linux', 5, google],
  ['iPad desktop mode', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', 'MacIntel', 5, apple],
  ['Mac', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', 'MacIntel', 0, undefined],
  ['Windows', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Win32', 0, undefined],
  ['unknown', '', '', 0, undefined],
  ['WhatsApp/Facebook link preview', 'facebookexternalhit/1.1 (iPhone)', '', 0, undefined],
  ['crawler', 'Googlebot Smartphone Android', 'Linux', 5, undefined],
];
for (const [name, userAgent, platform, maxTouchPoints, expected] of devices) {
  for (const blocked of [false, true]) {
    const nodes = Object.fromEntries(['primary-store', 'alternative-store'].map(id => [id, {
      href: $(`#${id}`).attr('href'), textContent: $(`#${id}`).text(),
    }]));
    const navigations = [];
    vm.runInNewContext(code, {
      navigator: { userAgent, platform, maxTouchPoints },
      document: { getElementById: id => nodes[id] },
      window: { location: { replace: url => {
        navigations.push(url);
        if (blocked) throw new Error('Browser blocked external navigation');
      } } },
    });
    assert.deepEqual(navigations, expected ? [expected] : [], name);
    assert.equal(nodes['primary-store'].href, expected || apple, `${name}: primary fallback`);
    assert.equal(nodes['alternative-store'].href, expected === google ? apple : google, `${name}: alternative fallback`);
    if (expected) assert.match(nodes['primary-store'].textContent, expected === apple ? /iPhone/ : /Android/);
  }
}
console.log(`App download route: ${devices.length * 2} routing/fallback cases, neutral previews, no-JS links and no tracking PASS.`);

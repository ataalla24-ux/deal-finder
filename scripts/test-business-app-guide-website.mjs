import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { load } from 'cheerio';

const html = fs.readFileSync(new URL('../docs/gratis-anzeige.html', import.meta.url), 'utf8');
const script = fs.readFileSync(new URL('../docs/gratis-anzeige.js', import.meta.url), 'utf8');
const $ = load(html);
assert.equal($('h1').length, 1);
assert.match($('meta[name="robots"]').attr('content'), /noindex/);
assert.equal($('link[rel="canonical"]').attr('href'), 'https://freefinder.at/gratis-anzeige.html');
assert.equal($('#promo-code').val(), 'SPOTLIGHTGRATIS');
assert.ok($('#promo-code').is('[readonly]'));
assert.equal($('#iphone-store').attr('href'), 'https://apps.apple.com/app/id6758958213');
assert.equal($('#android-store').attr('href'), 'https://play.google.com/store/apps/details?id=com.stefanataalla.freefinderwien');
assert.match($('.instructions').text(), /Menü → Business-Anzeigen/);
assert.match($('.instructions').text(), /Ohne Abo weiter/);
assert.match($('.instructions').text(), /0 €/);
assert.match($('.conditions').text(), /in der App/);
assert.equal($('form').length, 0, 'The guide must not accept or activate an advertisement');
assert.equal($('a[href*="business-promo.html"]').length, 0, 'Do not route the card back to web redemption');
assert.equal($('script[src]').length, 1, 'No additional analytics, API clients or trackers');
assert.doesNotMatch(script, /fetch\s*\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|\.redeem|\/api\//);
for (const [mode, expected] of [['success', /Code kopiert/], ['denied', /Kopieren nicht erlaubt/], ['unsupported', /manuell kopieren/]]) {
  const handlers = new Map();
  const copies = [];
  const input = { value: 'SPOTLIGHTGRATIS' };
  const status = { textContent: '' };
  const button = { addEventListener: (event, handler) => handlers.set(event, handler) };
  const elements = { 'copy-code': button, 'promo-code': input, 'copy-status': status };
  const navigator = mode === 'unsupported' ? {} : { clipboard: { writeText: async value => {
    if (mode === 'denied') throw new Error('Clipboard blocked');
    copies.push(value);
  } } };
  vm.runInNewContext(script, { navigator, document: { getElementById: id => elements[id] } });
  assert.equal(copies.length, 0, 'Do not modify the clipboard without a user click');
  await handlers.get('click')();
  assert.match(status.textContent, expected);
  assert.deepEqual(copies, mode === 'success' ? ['SPOTLIGHTGRATIS'] : []);
}
console.log('Business app guide: app-only routing, offer wording, no web submission and 3 clipboard cases PASS.');

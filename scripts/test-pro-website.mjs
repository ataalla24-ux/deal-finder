import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const home = read('docs/index.html');
const promo = read('docs/plus-gratis.html');
const support = read('docs/support.html');
const manifest = JSON.parse(read('docs/manifest.json'));
const sw = read('docs/sw.js');
const proSection = home.match(/<section class="pro-section"[\s\S]*?<\/section>/)[0];

assert.match(proSection, /Pro monatlich/);
assert.match(proSection, /4,99 € <span>\/ Monat/);
assert.match(proSection, /Pro jährlich/);
assert.match(proSection, /34,99 € <span>\/ Jahr/);
assert.match(proSection, /denselben Pro-Funktionen/);
assert.match(proSection, /Berechtigte Neukunden in Österreich und Deutschland/);
assert.match(proSection, /verlängert sich das gewählte Abo automatisch/);
assert.match(proSection, /24,89 €[\s\S]*59,88 €/);
assert.equal(499 * 12 - 3499, 2489);
assert.match(proSection, /keine Gratisphase/);
assert.match(proSection, /kein früherer Jahrespreis/);
assert.match(proSection, /Store-Bestätigung ist maßgeblich/);
assert.match(proSection, /apps\.apple\.com\/app\/id6758958213/);
assert.match(proSection, /play\.google\.com\/store\/apps\/details\?id=com\.stefanataalla\.freefinderwien/);
assert.doesNotMatch(home, /data-checkout-plan|PRO\/PLUS|PRO und PLUS|3,99 €|12,99 €/);
assert.doesNotMatch(home, /(?:src|srcset)="[^"]*(?:stats-plus|pro-sheet)/);
assert.match(home, /id="shareAppButton"/);
assert.match(home, /data-business-plan="businessStarter"/);
assert.match(home, /await startStripeCheckout\(selectedBusinessPlan, submit, campaign\)/);

assert.match(promo, /<title>FreeFinder Pro 30 Tage gratis/);
assert.match(promo, /href="freefinder:\/\/promotion\?promo=PLUS30WIEN"/);
assert.match(promo, /const promoCode = 'PLUS30WIEN'/);
assert.match(promo, /'FREEFINDER_PROMO:' \+ promoCode/);
assert.match(promo, /https:\/\/freefinder\.at\/plus-gratis\.html/);
assert.match(promo, /endet automatisch nach 30 Tagen und wird nicht kostenpflichtig verlängert/);
assert.match(promo, /Keine Zahlungsmethode erforderlich/);
assert.doesNotMatch(promo, /FreeFinder PLUS|30 Tage PLUS|allen PLUS-Funktionen/);
assert.doesNotMatch(promo, /assets\/campaigns\/plus30-preview\.png/);
assert.doesNotMatch(support, /Pro (?:oder|or) Plus|PRO oder PLUS/);
assert.equal(manifest.shortcuts.find(s => s.url === '/#pro' || s.url === './#pro' || s.url === '#pro')?.description,
  'FreeFinder Pro öffnen');
assert.match(sw, /freefinder-website-v7/);
assert.doesNotMatch(sw, /stats-plus\.jpg|pro-sheet\.jpg|\.\/og-preview\.png/);

let scripts = 0;
for (const [file, html] of [['index.html', home], ['plus-gratis.html', promo], ['support.html', support]]) {
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (/application\/ld\+json/.test(match[1])) JSON.parse(match[2]);
    else if (match[2].trim()) { new vm.Script(match[2], { filename: file }); scripts++; }
  }
  assert.equal([...html.matchAll(/<h1\b/g)].length, 1, `${file} needs one H1`);
  assert.match(html, /rel="canonical"/);
}
new vm.Script(sw, { filename: 'sw.js' });
assert.ok(fs.existsSync(path.join(root, 'docs/assets/pro/freefinder-pro-preview.png')));
console.log(`Pro website regression passed: prices, trial/promotion separation, legacy purchase removal, business/referral preservation, schema and ${scripts} inline scripts.`);

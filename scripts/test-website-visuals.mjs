import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'cheerio';
import { polishHtml } from './polish-website.mjs';
import { dealPhoto } from './deal-photos.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, 'docs', file), 'utf8');
// Presentation idempotence must not change when a retained deal expires later.
// Expiry transitions are covered separately by the blog catch-up/status checks.
const presentationNow = Date.parse('2026-10-07T12:00:00+02:00');
const home = load(read('index.html'));
assert.equal(home('link[href="/home-showcase.css?v=20261030"]').length, 1);
assert.equal(home('.hero-showcase img').length, 3);
assert.equal(home('.hero-showcase .phone-frame').length, 0, 'Artwork already includes a phone frame');
assert.match(home('#heroPreviewNote').text(), /Designvorschau mit Beispieldaten/);
assert.match(home('#appDesignNote').text(), /Designvorschauen mit Beispieldaten/);
assert.equal(home('.app-gallery[tabindex="0"]').length, 1, 'Scrollable previews support keyboard focus');
const previewSources = JSON.parse(read('assets/klar-urban-20261030/sources.json'));
assert.equal(previewSources.actualNativeCaptures, false);
assert.equal(previewSources.newlyGenerated, false);
assert.equal(previewSources.images.length, 6);
const previewNames = home('.app-gallery img').toArray().map(image => {
  assert.match(home(image).attr('alt'), /^Designvorschau:/);
  assert.equal(home(image).attr('loading'), 'lazy');
  assert.ok(home(image).attr('srcset').includes('360w'));
  return path.basename(home(image).attr('src')).replace('-720.webp', '');
});
assert.deepEqual(previewNames, previewSources.images.map(image => image.name));
for (const image of previewSources.images) {
  for (const variant of image.variants) {
    const bytes = fs.readFileSync(path.join(root, 'docs/assets/klar-urban-20261030', variant.file));
    assert.equal(bytes.subarray(0, 4).toString(), 'RIFF');
    assert.equal(bytes.subarray(8, 12).toString(), 'WEBP');
    assert.equal(bytes.length, variant.bytes);
    assert.ok(bytes.length < 220000, 'Responsive design preview image budget');
  }
}
assert.match(read('home-showcase.css'), /#pro\s*\{[^}]*background:\s*#1c1c20/);
assert.match(read('home-showcase.css'), /#pro \.plan\.featured\s*\{[^}]*#ff964a/);
for (const file of ['index.html', 'blog/index.html', 'angebote-wien-heute.html']) {
  const html = read(file), $ = load(html);
  assert.equal($('link[href="/visual-refresh.css?v=20261030"]').length, 1, `${file}: one presentation stylesheet`);
  assert.equal(polishHtml(html, file, presentationNow), html, `${file}: presentation is idempotent`);
  if (file !== 'angebote-wien-heute.html') {
    assert.equal($('.visual-topics a').length, 6);
    assert.equal($('.visual-topics picture').length, 6);
    assert.equal($('.visual-topics img[loading="lazy"]').length, 6);
    for (const image of $('.visual-topics img').toArray()) {
      assert.match($(image).attr('alt'), /^Symbolfoto:/);
      assert.equal($(image).attr('width'), '1200');
      assert.equal($(image).attr('height'), '630');
    }
    for (const link of $('.visual-topics a').toArray()) {
      const url = new URL($(link).attr('href'), `https://freefinder.at/${file}`);
      assert.ok(fs.existsSync(path.join(root, 'docs', url.pathname)));
    }
  }
}
let articles = 0;
for (const file of fs.readdirSync(path.join(root, 'docs/blog')).filter(f => f.endsWith('.html') && f !== 'index.html')) {
  const html = read(`blog/${file}`), $ = load(html);
  if (!$('.article-layout .article-body').length || /noindex/.test($('meta[name="robots"]').attr('content') || '')) continue;
  articles++;
  assert.equal($('.article-discovery').length, 1, file);
  assert.equal($('#moreViennaTitle').length, 1);
  assert.equal($('.discovery-guide').length, 3);
  assert.equal($('.discovery-guide img[loading="lazy"]').length, 3);
  assert.equal($('.article-body .article-discovery').length, 0, 'No nested article/card layout');
  assert.equal(polishHtml(html, `blog/${file}`, presentationNow), html);
}
assert.ok(articles >= 70);
for (const [title, brand, key] of [
  ['Biang-Biang-Nudeln 1+1', 'Only Noodle', 'biang-noodles'],
  ['Ciğköfte-Wrap für 1 Euro', 'Rhulo', 'cigkofte-wrap'],
  ['6er Chicken McNuggets', 'McDonalds', 'nuggets'],
  ['Bubble Tea gratis', 'DimsumBabe', 'bubble-tea'],
  ['Kindermenü zum Hauptgericht', 'IKEA', 'family-lunch'],
  ['10 Euro ab 50 Euro', 'Ganesha', 'indian-meal'],
  ['1+1 Hotdog', 'Loving Hut', 'vegan-hotdog'],
  ['1+1 Thunfisch-Wrap', 'NORDSEE', 'tuna-wrap'],
]) {
  const photo = dealPhoto({ title, brand, category: 'essen' });
  assert.equal(photo.key, key);
  assert.match(photo.src, /\/assets\/blog\/photos\//);
  assert.ok(photo.width >= 600 && photo.height >= 400);
  assert.match(photo.alt, /^Symbolfoto:/);
}
const sources = JSON.parse(read('assets/blog/photos/sources.json')).photos;
for (const key of ['indian-meal', 'restaurant-buffet', 'family-lunch', 'balkan-brunch']) {
  assert.ok(sources[key].inputWidth >= 600 && sources[key].inputHeight >= 400);
  assert.ok(sources[key].bytes < 160000 && sources[key].webpBytes < 160000 && sources[key].thumbnailBytes < 35000);
  for (const suffix of ['.jpg', '.webp', '-480.webp']) assert.ok(fs.existsSync(path.join(root, 'docs/assets/blog/photos', key + suffix)));
}
const privateFixture = '<html><head><meta name="robots" content="noindex"></head><body><main><p>Private fixture</p></main></body></html>';
const privatePage = load(polishHtml(privateFixture, 'blog/private.html', presentationNow));
assert.equal(privatePage('main').text(), 'Private fixture');
assert.equal(privatePage('.article-discovery, .visual-topics, link[href^="/visual-refresh.css"]').length, 0);
console.log(`Visual website checks passed: six approved design previews, branded Pro palette, six linked photo topics, ${articles} article discovery strips, eight precise deal motifs, image budgets, noindex isolation and idempotence.`);

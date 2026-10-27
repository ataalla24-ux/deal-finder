import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { load } from 'cheerio';
import { polishHtml, polishSiteIcons, polishSharingMetadata } from './polish-website.mjs';
import { blogVisual, covers } from './blog-visuals.mjs';
import { articlePhotos, photoRecipes } from './blog-photo-catalog.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const now = Date.parse('2026-10-07T12:00:00+02:00');
let pages = 0;
for (const file of fs.readdirSync(path.join(root, 'docs'), { recursive: true }).filter(file => file.endsWith('.html'))) {
  const html = read(`docs/${file}`);
  assert.equal(polishHtml(html, file, now), html, `${file}: normalization must be idempotent`);
  const $ = load(html);
  assert.equal($('link[rel="icon"][href="/favicon.ico"]').length, 1, `${file}: legacy icon fallback`);
  assert.equal($('link[rel="icon"][type="image/png"]').attr('href'), '/favicon-96x96.png');
  assert.equal($('link[rel="apple-touch-icon"]').attr('href'), '/apple-touch-icon.png');
  if (/noindex/i.test($('meta[name="robots"]').attr('content') || '')) continue;
  pages++;
  for (const key of ['og:site_name', 'og:locale', 'og:image:width', 'og:image:height', 'og:image:alt']) {
    assert.ok($(`meta[property="${key}"]`).attr('content'), `${file}: ${key}`);
  }
  for (const key of ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image', 'twitter:image:alt', 'apple-mobile-web-app-title']) {
    assert.ok($(`meta[name="${key}"]`).attr('content'), `${file}: ${key}`);
  }
  assert.equal($('.skip-link').length, 1, `${file}: keyboard skip link`);
  assert.equal($('main').attr('tabindex'), '-1');
  const expiry = $('main').attr('data-deal-expires');
  if (expiry && Date.parse(expiry) < now) {
    assert.match($('title').text(), /Archiv/);
    assert.match($('meta[name="description"]').attr('content'), /Aktion beendet/);
    assert.equal($('[data-deal-status-banner][hidden]').length, 0);
  }
}
const index = load(read('docs/blog/index.html'));
const privacyHtml = read('docs/privacy.html');
const privacy = load(privacyHtml);
assert.match(privacy('#pushWelcome').text(), /beiden Kanälen zustimmen oder ablehnen/);
assert.match(privacy('#pushWelcome').text(), /Einzelne Arten.*Einstellungen und Mein Konto wählen/);
assert.match(privacy('#pushWelcome').text(), /Systemfreigabe allein aktiviert keine E-Mails/);
assert.match(privacy('#pushWelcome').text(), /Bestehende E-Mail-Auswahlen und Abmeldungen werden nicht überschrieben/);
assert.match(privacyHtml, /Existing email choices and opt-outs are not overwritten/);
assert.match(privacy('#accountEmails').text(), /standardmäßig AUS/);
assert.match(privacy('#accountEmails').text(), /für ausdrücklich aktivierte Kategorien freigeschaltet/);
assert.match(privacy('#accountEmails').text(), /ändern keine Push-Zustimmung/);
assert.match(privacy('#emailProvider').text(), /Abmeldelink ohne Anmeldepflicht/);
assert.match(privacyHtml, /Delivery is enabled for categories you explicitly opt into/);
assert.match(privacyHtml, /OFF by default/);
assert.doesNotMatch(privacyHtml, /Der Versand dieser optionalen E-Mails ist derzeit nicht freigeschaltet/);
assert.doesNotMatch(privacyHtml, /Delivery of these optional emails is currently disabled/);
assert.equal(index('#blogSearch').length, 1);
assert.equal(index('#blogTopic').length, 1);
assert.equal(index('#blogArchive').length, 1);
assert.equal(index('.post-card img[loading="eager"]').length, 1);
assert.ok(index('.post-card[data-archive="true"]').length >= 12);
for (const card of index('.post-card').toArray()) assert.equal(index(card).find('h2 a').length, 1);
for (const card of index('.post-card').toArray()) {
  const slug = index(card).find('h2 a').attr('href').split('/').pop().replace(/\.html$/, '');
  const article = load(read(`docs/blog/${slug}.html`));
  const image = index(card).find('img');
  assert.doesNotMatch(image.attr('src'), /current-ios|og-preview|og-home/);
  assert.equal(`https://freefinder.at${image.attr('src')}`, article('meta[property="og:image"]').attr('content'), `${slug}: listing and shared preview agree`);
  const visual = blogVisual(slug);
  if (!visual) continue;
  assert.equal(image.attr('src'), visual.src, `${slug}: explicit subject cover`);
  assert.equal(article('meta[name="twitter:image"]').attr('content'), `https://freefinder.at${visual.src}`);
  assert.equal(article('meta[property="og:image:width"]').attr('content'), '1200');
  for (const node of article('.article-image, .article-cover img').toArray()) {
    assert.equal(article(node).attr('src'), visual.src, `${slug}: visible article cover`);
    assert.equal(article(node).attr('alt'), visual.alt);
    const sources = article(node).parent('picture').find('source');
    assert.equal(sources.attr('srcset'), `${visual.thumbnail} 480w, ${visual.webp} 1200w`, `${slug}: responsive photos without stale AVIF sources`);
    assert.ok(sources.attr('sizes'), `${slug}: responsive selection includes high-density displays`);
  }
  assert.doesNotMatch(article('script[type="application/ld+json"]').text(), /current-ios|og-preview|og-home/, `${slug}: schema has no unrelated screenshot`);
}
for (const slug of Object.keys(covers)) {
  const visual = blogVisual(slug);
  const jpeg = fs.readFileSync(path.join(root, 'docs', visual.src));
  assert.equal(jpeg.readUInt16BE(0), 0xffd8);
  assert.match(visual.src, /^\/assets\/blog\/photos\/[a-z-]+\.jpg$/);
  assert.match(visual.alt, /^Symbolfoto: /);
  assert.ok(jpeg.length < 160000, `${slug}: compact photographic cover`);
  const webp = fs.readFileSync(path.join(root, 'docs', visual.webp));
  assert.equal(webp.toString('ascii', 8, 12), 'WEBP');
  assert.ok(webp.length < 160000, `${slug}: compact full-width WebP`);
  const thumbnail = fs.readFileSync(path.join(root, 'docs', visual.thumbnail));
  assert.equal(thumbnail.toString('ascii', 8, 12), 'WEBP');
  assert.ok(thumbnail.length < 35000);
}
assert.deepEqual(Object.keys(articlePhotos).sort(), Object.keys(covers).sort(), 'Every existing editorial subject has an explicit photo assignment');
assert.equal(articlePhotos['pizza-rando-3-doener-zum-preis-von-2-wien'], 'kebab');
assert.equal(articlePhotos['nordsee-wrap-1plus1-wien'], 'tuna-wrap');
assert.equal(articlePhotos['loving-hut-dog-1plus1-wien'], 'vegan-hotdog');
assert.equal(articlePhotos['bipa-therme-wien-wohlfuehlpaket'], 'thermal');
const photoSources = JSON.parse(read('docs/assets/blog/photos/sources.json')).photos;
for (const subject of Object.values(articlePhotos)) {
  assert.ok(Object.hasOwn(photoRecipes, subject));
  assert.ok(photoSources[subject].inputWidth >= 600 && photoSources[subject].inputHeight >= 400, `${subject}: no tiny app tile enlarged into a blog cover`);
}
assert.equal(blogVisual('new-old-cover', '/assets/blog/covers/new-old-cover.jpg').src, blogVisual('wien-guides').src);
// New articles can keep genuine subject photos, but cannot resurrect shared mockups.
assert.equal(blogVisual('new-cafe', '/assets/blog/new-cafe.jpg'), null);
assert.equal(blogVisual('new-cafe', '/assets/current-ios/deals-home.jpg').src, blogVisual('wien-guides').src);
const fallbackFixture = '<html><head><meta property="og:image" content="https://freefinder.at/og-preview-stores.png"></head><body><main><picture><source type="image/avif" srcset="/og-preview-stores-600.avif"><img class="article-image" src="/og-preview-stores.png" alt="old"></picture></main></body></html>';
const fallback = polishHtml(fallbackFixture, 'blog/new-cafe.html', now);
assert.doesNotMatch(fallback, /og-preview|og-home|current-ios/);
assert.equal(polishHtml(fallback, 'blog/new-cafe.html', now), fallback);
assert.match(read('docs/blog/blog.css'), /prefers-reduced-motion/);
assert.doesNotMatch(read('docs/blog/blog.css'), /a:not\(\.nav-download\)\s*\{\s*display:\s*none/);
const manifest = JSON.parse(read('docs/manifest.json'));
for (const icon of manifest.icons) {
  assert.equal(icon.type, 'image/png');
  const bytes = fs.readFileSync(path.join(root, 'docs', icon.src));
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`, icon.sizes);
}
const touch = fs.readFileSync(path.join(root, 'docs/apple-touch-icon.png'));
assert.equal(touch.readUInt32BE(16), 180);
assert.equal(touch.readUInt32BE(20), 180);
const ico = fs.readFileSync(path.join(root, 'docs/favicon.ico'));
assert.equal(ico.readUInt16LE(2), 1);
assert.equal(ico.readUInt16LE(4), 3);
for (let i = 0; i < 3; i++) {
  const offset = ico.readUInt32LE(6 + 16 * i + 12);
  assert.equal(ico.subarray(offset + 1, offset + 4).toString(), 'PNG');
}
const iconFixture = '<!doctype html><html><head><meta name="robots" content="noindex"><link rel="shortcut icon" href="old.svg"><link rel="apple-touch-icon" href="old.svg"></head><body><script>keepOriginal()</script><p>Unchanged</p></body></html>';
const normalizedIcons = polishSiteIcons(iconFixture);
assert.equal(normalizedIcons.slice(normalizedIcons.indexOf('<body>')), iconFixture.slice(iconFixture.indexOf('<body>')));
assert.equal(polishSiteIcons(normalizedIcons), normalizedIcons);
assert.doesNotMatch(normalizedIcons, /old\.svg/);
const invitationSource = read('docs/invite.html');
assert.equal(load(invitationSource)('meta[property="og:url"]').length, 0, 'Keep invitation-link parameters intact');
assert.equal(polishSharingMetadata(invitationSource), invitationSource);
assert.equal(polishSharingMetadata(iconFixture), iconFixture, 'Do not add share previews to private tools');
const shortcuts = manifest.shortcuts;
assert.deepEqual(shortcuts.map(item => item.url), ['/angebote-wien-heute.html', '/blog/', '/#pro']);
assert.equal(manifest.screenshots[0].src, 'og-home-20261007.jpg');
assert.equal(manifest.screenshots[0].type, 'image/jpeg');
const socialPreview = fs.readFileSync(path.join(root, 'docs', manifest.screenshots[0].src));
assert.equal(socialPreview.readUInt16BE(0), 0xffd8, 'Manifest preview must contain actual JPEG bytes');
const home = load(read('docs/index.html'));
assert.equal(home('#dealList a[href]').length, 3);
assert.doesNotMatch(home('#dealList').text(), /Cafe Central|Pizza Pronto|Iced Matcha Latte/);
assert.match(home('#dealList').text(), /Café Hummel/);
assert.match(home('#dealList').text(), /vollzahlender Begleitung/);
assert.equal(home('.phone-stage img[src^="assets/native-preview-20260923/"]').length, 3);
assert.equal(home('meta[property="og:image"]').attr('content'), 'https://freefinder.at/og-home-20261007.jpg');
assert.equal(home('meta[property="og:image:secure_url"]').attr('content'), home('meta[property="og:image"]').attr('content'));
assert.equal(home('meta[property="og:image:type"]').attr('content'), 'image/jpeg');

// Exercise consent without real trackers, including a browser that blocks storage.
for (const blocked of [false, true]) {
  const loads = [];
  const storage = new Map();
  const parent = { insertBefore: script => loads.push(script.src) };
  const document = {
    readyState: 'loading', cookie: '_ga=test; _clck=test',
    head: { appendChild: script => loads.push(script.src) },
    addEventListener() {}, getElementById: () => null,
    createElement: () => ({}), getElementsByTagName: () => [{ parentNode: parent }],
  };
  const window = {
    location: { hostname: 'freefinder.at', pathname: '/blog/' },
    FreeFinderTrackingConfig: { gtmId: 'GTM-TEST123', clarityId: 'test123' },
    localStorage: {
      getItem(key) { if (blocked) throw new Error('Blocked'); return storage.get(key); },
      setItem(key, value) { if (blocked) throw new Error('Blocked'); storage.set(key, value); },
    },
  };
  const code = read('docs/consent.js').replace(/\}\)\(\);\s*$/, 'window.testConsent = { applyConsent, readConsent, trackEvent };})();');
  vm.runInNewContext(code, { window, document, URL });
  window.testConsent.trackEvent('before_consent');
  assert.equal(loads.length, 0);
  assert.equal(window.dataLayer.filter(item => item[0] === 'event').length, 0);
  window.testConsent.applyConsent('granted');
  assert.equal(window.testConsent.readConsent(), 'granted');
  window.testConsent.trackEvent('after_consent');
  assert.equal(loads.length, 2);
  assert.equal(window.dataLayer.filter(item => item[0] === 'event').length, 1);
  window.testConsent.applyConsent('denied');
  window.testConsent.trackEvent('after_revoke');
  assert.equal(window.dataLayer.filter(item => item[0] === 'event').length, 1);
  assert.equal(window.testConsent.readConsent(), 'denied');
  window.testConsent.applyConsent('granted');
  assert.equal(loads.length, 2, 'Do not inject trackers twice');
}

const handlers = {};
const cached = new Map();
const cacheWrites = [];
const precached = [];
const notifications = [];
let networkResponse = new Response('fresh');
let offline = false;
let quotaFull = false;
const key = request => typeof request === 'string' ? request : request.url;
const cache = {
  async addAll(urls) { precached.push(...urls); },
  async match(request) { return cached.get(key(request)); },
  async put(request, response) { if (quotaFull) throw new Error('Full'); cacheWrites.push(key(request)); cached.set(key(request), response); },
};
vm.runInNewContext(read('docs/sw.js'), {
  self: { location: { origin: 'https://freefinder.at' }, registration: { scope: 'https://freefinder.at/', showNotification: async (title, options) => notifications.push({ title, options }) }, skipWaiting() {}, addEventListener: (name, fn) => handlers[name] = fn },
  caches: { open: async () => cache }, URL, Response,
  fetch: async () => { if (offline) throw new Error('Offline'); return networkResponse; },
});
let lifecycle;
handlers.install({ waitUntil: promise => lifecycle = promise });
await lifecycle;
for (const file of ['favicon.ico', 'favicon-96x96.png', 'apple-touch-icon.png', ...manifest.icons.map(icon => icon.src)]) {
  assert.ok(precached.includes(`./${file}`), `${file}: available after installation without a network`);
}
handlers.push({ data: { json: () => ({ title: 'Fixture only' }) }, waitUntil: promise => lifecycle = promise });
await lifecycle;
assert.equal(notifications[0].options.icon, './icon-192.png');
handlers.push({ data: { json: () => ({ title: 'Custom fixture', icon: '/custom.png', badge: '/badge.png' }) }, waitUntil: promise => lifecycle = promise });
await lifecycle;
assert.equal(notifications[1].options.icon, '/custom.png');
assert.equal(notifications[1].options.badge, '/badge.png');
async function request(pathname, fields = {}) {
  let response;
  const request = { url: `https://freefinder.at${pathname}`, method: 'GET', mode: 'navigate', ...fields };
  handlers.fetch({ request, respondWith: promise => response = promise });
  return response ? await response : null;
}
assert.equal(await request('/api/merchant/campaigns', { method: 'POST' }), null);
assert.equal(await request('/?session_id=secret'), null);
assert.equal(await request('/checkout-config.json'), null);
assert.equal(await request('/admin.html'), null);
assert.equal(await request('/', { url: 'https://analytics.google.com/test' }), null);
cached.set('https://freefinder.at/blog/blog.css', new Response('stale'));
assert.equal(await (await request('/blog/blog.css?v=8', { mode: 'cors' })).text(), 'fresh');
assert.ok(cacheWrites.includes('https://freefinder.at/blog/blog.css'));
networkResponse = new Response('missing', { status: 404 });
const writes = cacheWrites.length;
assert.equal((await request('/missing.html')).status, 404);
assert.equal(cacheWrites.length, writes, 'Do not cache errors');
networkResponse = new Response('fresh even with full cache');
quotaFull = true;
assert.equal(await (await request('/')).text(), 'fresh even with full cache');
quotaFull = false;
offline = true;
cached.set('https://freefinder.at/offline.html', new Response('offline page'));
assert.equal(await (await request('/unvisited.html')).text(), 'offline page');
assert.equal((await request('/unknown.json', { mode: 'cors' })).status, 503);
assert.equal(await (await request('/blog/blog.css?v=8', { mode: 'cors' })).text(), 'fresh');

console.log(`Website quality checks passed: ${pages} public pages, archive/search markup, shortcuts, blocked-storage consent, tracker revocation and 11 cache scenarios.`);

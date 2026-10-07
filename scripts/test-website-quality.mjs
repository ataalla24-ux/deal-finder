import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { load } from 'cheerio';
import { polishHtml } from './polish-website.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const now = Date.parse('2026-10-07T12:00:00+02:00');
let pages = 0;
for (const file of fs.readdirSync(path.join(root, 'docs'), { recursive: true }).filter(file => file.endsWith('.html'))) {
  const html = read(`docs/${file}`);
  assert.equal(polishHtml(html, file, now), html, `${file}: normalization must be idempotent`);
  const $ = load(html);
  if (/noindex/i.test($('meta[name="robots"]').attr('content') || '')) continue;
  pages++;
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
assert.equal(index('#blogSearch').length, 1);
assert.equal(index('#blogTopic').length, 1);
assert.equal(index('#blogArchive').length, 1);
assert.equal(index('.post-card img[loading="eager"]').length, 1);
assert.ok(index('.post-card[data-archive="true"]').length >= 12);
for (const card of index('.post-card').toArray()) assert.equal(index(card).find('h2 a').length, 1);
assert.match(read('docs/blog/blog.css'), /prefers-reduced-motion/);
assert.doesNotMatch(read('docs/blog/blog.css'), /a:not\(\.nav-download\)\s*\{\s*display:\s*none/);
const manifest = JSON.parse(read('docs/manifest.json'));
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
let networkResponse = new Response('fresh');
let offline = false;
let quotaFull = false;
const key = request => typeof request === 'string' ? request : request.url;
const cache = {
  async match(request) { return cached.get(key(request)); },
  async put(request, response) { if (quotaFull) throw new Error('Full'); cacheWrites.push(key(request)); cached.set(key(request), response); },
};
vm.runInNewContext(read('docs/sw.js'), {
  self: { location: { origin: 'https://freefinder.at' }, registration: { scope: 'https://freefinder.at/' }, addEventListener: (name, fn) => handlers[name] = fn },
  caches: { open: async () => cache }, URL, Response,
  fetch: async () => { if (offline) throw new Error('Offline'); return networkResponse; },
});
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

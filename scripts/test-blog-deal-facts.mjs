import assert from 'node:assert/strict';
import fs from 'node:fs';
import { load } from 'cheerio';
import { polishHtml } from './polish-website.mjs';
import { inspectBlogRevision } from './server-blog-content.mjs';

const read = file => fs.readFileSync(new URL(`../docs/${file}`, import.meta.url), 'utf8');
const cases = [
  ['dahab-doener-1plus1-wien', '2026-09-23', '2026-11-05', /drei Döner zum Preis von zwei/i,
    ['Rußbergstraße 9, 1210 Wien', 'Wagramer Straße 126, 1220 Wien'], /alle Dönersorten.*30\. November 2026/],
  ['nordsee-coupons-wien', '2026-10-18', '2026-11-10', /7,49 €.*10,49 €/,
    ['Wagramer Straße 94, 1220 Wien'], /teilnehmenden Restaurants.*nicht an Autobahnraststätten/],
  ['hitomi-francis-10-euro-gutschein-wien', '2026-10-18', '2026-11-10', /10 € Rabatt ab 40 €/,
    ['Julius-Tandler-Platz 3, 1090 Wien'], /Smartphone authentifizieren.*Code vom Personal/],
  ['therme-wien-drei-plus-mittwoch', '2026-10-18', '2026-11-10', /50 % Rabatt.*Begleitperson/,
    ['Kurbadstraße 14, 1100 Wien'], /mittwochs ab 18 Uhr.*Feiertagen.*selben Tag/],
];
const sitemap = load(read('sitemap.xml'), { xml: true });
for (const [slug, published, checked, price, addresses, conditions] of cases) {
  const file = `blog/${slug}.html`;
  const html = read(file);
  const $ = load(html);
  const block = $('.article-body > .deal-facts');
  assert.equal(block.length, 1, slug);
  assert.equal(block.attr('aria-labelledby'), block.find('h2').attr('id'));
  assert.equal(block.find('time').attr('datetime'), checked);
  assert.match(block.text().replace(/\s+/g, ' '), price);
  assert.match(block.text().replace(/\s+/g, ' '), conditions);
  const maps = block.find('li a').map((_, link) => new URL($(link).attr('href'))).get();
  assert.equal(maps.length, addresses.length);
  for (const [index, url] of maps.entries()) {
    assert.equal(url.origin, 'https://www.google.com');
    assert.equal(url.pathname, '/maps/search/');
    assert.equal(url.searchParams.get('api'), '1');
    assert.ok(url.searchParams.get('query').endsWith(addresses[index]));
  }
  assert.equal(block.find('iframe, script').length, 0);
  assert.doesNotMatch(html, /"@type"\s*:\s*"(?:AggregateRating|Review)"/);
  const canonical = `https://freefinder.at/${file}`;
  assert.equal($('link[rel="canonical"]').attr('href'), canonical);
  const article = JSON.parse($('script[type="application/ld+json"]').text())['@graph'].find(item => item['@type'] === 'Article');
  assert.equal(article.datePublished, published);
  assert.equal(article.dateModified, '2026-11-10');
  const entry = sitemap('loc').filter((_, loc) => sitemap(loc).text() === canonical).parent();
  assert.equal(entry.length, 1);
  assert.equal(entry.find('lastmod').text(), article.dateModified);
  const expiry = $('main').attr('data-deal-expires');
  assert.equal(inspectBlogRevision(html, slug, expiry?.slice(0, 10)), 'curated-deal-summary-needs-review');
  if (expiry) {
    const archived = load(polishHtml(html, file, Date.parse(expiry) + 1000));
    assert.ok(archived('body').hasClass('deal-is-expired'));
    assert.equal(archived('[data-deal-status-banner][hidden]').length, 0);
  }
}
assert.match(read('blog/blog.css'), /\.deal-is-expired \.deal-facts\s*\{\s*display:\s*none/);
console.log('Four deal summaries: sourced dates, prices, conditions, exact-address Maps links, sitemap and archive handling.');

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { load } from 'cheerio';
import { catchupGuides } from './blog-backfill-20261030.mjs';
import { blogVisual } from './blog-visuals.mjs';
import { polishHtml } from './polish-website.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const index = load(read('docs/blog/index.html'));
const sitemap = load(read('docs/sitemap.xml'), { xml: true });
const review = JSON.parse(read('reviews/blog-coverage-2026-10-30.json'));
assert.equal(new Set(review.entries.map(e => e.id)).size, review.entries.length);
assert.ok(review.entries.every(e => e.status === 'covered' ? e.slug : e.reason));
assert.ok(review.entries.filter(e => e.id.startsWith('flight-')).every(e => e.status === 'held'));
assert.equal(review.entries.filter(e => e.status === 'informational-not-promotion').length, 4);
assert.equal(review.entries.find(e => e.id === 'g2-3dn8v3').status, 'held');
assert.equal(new Set(catchupGuides.map(g => g.slug)).size, catchupGuides.length);
for (const guide of catchupGuides) {
  const file = `blog/${guide.slug}.html`;
  const html = read(`docs/${file}`);
  const $ = load(html);
  assert.equal($('h1').text(), guide.title);
  assert.ok($('title').text().length <= 75);
  assert.ok($('meta[name="description"]').attr('content').length <= 165);
  assert.equal($('link[rel="canonical"]').attr('href'), `https://freefinder.at/${file}`);
  assert.equal(index(`.post-card h2 a[href="${guide.slug}.html"]`).length, 1);
  assert.equal(sitemap('loc').filter((_, e) => sitemap(e).text() === `https://freefinder.at/${file}`).length, 1);
  assert.equal($('img.article-image').attr('src'), blogVisual(guide.slug).src);
  assert.match($('img.article-image').attr('alt'), /^Symbolfoto:/);
  assert.equal($('.article-body > picture source[type="image/webp"]').length, 1);
  assert.equal($('main').attr('data-deal-expires'), guide.expires || '');
  assert.ok($('#quelle').next('p').find('a[data-track="deal_outbound"]').length === 1);
  const graph = JSON.parse($('script[type="application/ld+json"]').text())['@graph'];
  const article = graph.find(e => e['@type'] === 'Article');
  assert.equal(article.datePublished, '2026-10-30', 'Do not backdate catch-up posts');
  assert.equal(article.dateModified, guide.modified);
  for (const q of graph.find(e => e['@type'] === 'FAQPage').mainEntity) {
    assert.ok($('.article-body').text().includes(q.name));
    assert.ok($('.article-body').text().includes(q.acceptedAnswer.text));
  }
  if (guide.expires) {
    const expired = load(polishHtml(html, file, Date.parse(guide.expires) + 1000));
    assert.match(expired('title').text(), /Archiv/);
    assert.equal(expired('[data-deal-status-banner][hidden]').length, 0);
  }
  for (const id of guide.ids) assert.equal(review.entries.find(e => e.id === id)?.slug, guide.slug);
}
const body = slug => load(read(`docs/blog/${slug}.html`))('.article-body').text();
assert.match(body('ikea-kindermenue-gratis-family-wien'), /maximal zwei Kinder bis 12/);
assert.match(body('food-up-pizza-790-wien-1030'), /Bei ihr sind Pommes und Getränk.*nicht als inklusive/);
assert.match(body('haikky-eroeffnung-gratis-essen-wien-1-november'), /keine Mittagsöffnung/);
assert.match(body('papa-duck-pizza-donnerstag-1plus1-wien'), /Follow-Voraussetzung.*nicht ungeprüft/);
assert.match(body('about-you-outlet-rabatt-oesterreich'), /nicht aus unabhängig gelesenen Händlerbedingungen/);
const nordsee = body('nordsee-coupons-wien');
assert.match(nordsee, /30\. November 2026/);
assert.match(nordsee, /Autobahnraststätten.*ausgeschlossen/);
for (const id of ['power-food-eca409ce31f3', 'power-food-fea2efd7d1c2']) assert.equal(review.entries.find(e => e.id === id)?.slug, 'nordsee-coupons-wien');

const fixture = fs.mkdtempSync(path.join(root, 'tmp', 'blog-catchup-'));
try {
  for (const file of ['scripts/generate-topic-guides.mjs', 'scripts/polish-website.mjs', 'scripts/blog-visuals.mjs', 'scripts/blog-photo-catalog.mjs', 'scripts/deal-photos.mjs', 'scripts/blog-backfill-20261018.mjs', 'scripts/blog-backfill-20261030.mjs', 'reviews/deal-guides.json', 'docs/blog/index.html', 'docs/sitemap.xml']) {
    fs.mkdirSync(path.dirname(path.join(fixture, file)), { recursive: true });
    fs.copyFileSync(path.join(root, file), path.join(fixture, file));
  }
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), 'dir');
  fs.writeFileSync(path.join(fixture, 'docs/deals.json'), 'unchanged-feed-sentinel');
  const args = [path.join(fixture, 'scripts/generate-topic-guides.mjs'), ...catchupGuides.map(g => g.slug)];
  const env = { ...process.env, SEO_NOW: '2026-10-30T12:00:00+01:00' };
  for (let pass = 0; pass < 2; pass++) {
    execFileSync(process.execPath, args, { env });
    for (const guide of catchupGuides) assert.equal(fs.readFileSync(path.join(fixture, 'docs/blog', `${guide.slug}.html`), 'utf8'), read(`docs/blog/${guide.slug}.html`));
    assert.equal(fs.readFileSync(path.join(fixture, 'docs/deals.json'), 'utf8'), 'unchanged-feed-sentinel');
  }
} finally { fs.rmSync(fixture, { recursive: true, force: true }); }
console.log(`Catch-up checks passed: ${catchupGuides.length} articles, source caveats, exact IDs, publication dates, photos, expiry and isolated regeneration.`);

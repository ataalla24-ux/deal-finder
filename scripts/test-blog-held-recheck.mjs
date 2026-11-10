import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { load } from 'cheerio';
import { heldRecheckGuides } from './blog-backfill-20261105.mjs';
import { blogVisual } from './blog-visuals.mjs';
import { polishHtml } from './polish-website.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const review = JSON.parse(read('reviews/blog-held-recheck-2026-11-05.json'));
const coverage = JSON.parse(read('reviews/blog-coverage-2026-10-30.json'));
const index = load(read('docs/blog/index.html'));
const sitemap = load(read('docs/sitemap.xml'), { xml: true });
assert.equal(review.decisions.length, 19);
assert.equal(new Set(review.decisions.map(e => e.id)).size, 19);
assert.equal(review.decisions.filter(e => e.status === 'covered').length, 5);
assert.equal(review.decisions.filter(e => e.status === 'held').length, 14);
assert.equal(review.decisions.filter(e => e.id.startsWith('flight-')).length, 10);
assert.equal(heldRecheckGuides.length, 5);
assert.equal(heldRecheckGuides.flatMap(g => g.ids).length, 4);
for (const guide of heldRecheckGuides) {
  const file = `blog/${guide.slug}.html`;
  const html = read(`docs/${file}`);
  const q = load(html);
  assert.equal(q('h1').text(), guide.title);
  assert.ok(q('title').text().length <= 75);
  assert.ok(q('meta[name="description"]').attr('content').length <= 165);
  assert.equal(q('link[rel="canonical"]').attr('href'), `https://freefinder.at/${file}`);
  assert.equal(index(`.post-card h2 a[href="${guide.slug}.html"]`).length, 1);
  assert.equal(sitemap('loc').filter((_, e) => sitemap(e).text() === `https://freefinder.at/${file}`).length, 1);
  assert.equal(q('img.article-image').attr('src'), blogVisual(guide.slug).src);
  assert.match(q('img.article-image').attr('alt'), /^Symbolfoto:/);
  assert.equal(q('main').attr('data-deal-expires'), guide.expires || '');
  const graph = JSON.parse(q('script[type="application/ld+json"]').text())['@graph'];
  const article = graph.find(e => e['@type'] === 'Article');
  assert.equal(article.datePublished, '2026-11-05');
  assert.equal(article.dateModified, '2026-11-05');
  assert.ok(q('.article-body').text().split(/\s+/).length >= 300);
  for (const question of graph.find(e => e['@type'] === 'FAQPage').mainEntity) {
    assert.ok(q('.article-body').text().includes(question.name));
    assert.ok(q('.article-body').text().includes(question.acceptedAnswer.text));
  }
  for (const id of guide.ids) assert.equal(coverage.entries.find(e => e.id === id)?.slug, guide.slug);
  if (guide.expires) {
    const expired = load(polishHtml(html, file, Date.parse(guide.expires) + 1000));
    assert.match(expired('title').text(), /Archiv/);
    assert.equal(expired('[data-deal-status-banner][hidden]').length, 0);
  }
}
const text = slug => load(read(`docs/blog/${slug}.html`))('.article-body').text();
assert.match(text('fat-monk-dc-tower-wien-lieferando-rabatt'), /8,94 statt 14,90/);
assert.match(text('fat-monk-dc-tower-wien-lieferando-rabatt'), /Lieferando\+-Stufe/);
assert.match(text('marden-wien-1120-lieferando-super-deals'), /7,77 statt 11,10/);
assert.match(text('brille24-novlens-50-prozent-glaeser-oesterreich'), /bereits reduzierte Brillen/);
assert.match(text('urfa-wien-huhn-steak-sandwich-350'), /bestätigt Aktionen allgemein, nicht erneut jeden Einzelpreis/);
const wolt = text('wolt-7-euro-neukunden-wien-aida-honu');
assert.match(load(read('docs/blog/wolt-7-euro-neukunden-wien-aida-honu.html'))('.hero-copy').text(), /nur für neue Nutzer mit lokaler Telefonnummer/);
assert.match(wolt, /nicht mit anderen Aktionen kombiniert/);
assert.match(wolt, /früher notierte Honu-Angebot mit fünf Euro.*nicht als weiterhin gültig/);
for (const id of ['g2-awsiz4', 'g2-ezkkws']) {
  const entry = review.decisions.find(e => e.id === id);
  assert.equal(entry.status, 'held', 'A related current offer does not verify the old exact claim');
  assert.equal(entry.relatedSlug, 'wolt-7-euro-neukunden-wien-aida-honu');
}
const mcdSlug = 'mcdonalds-chicken-mcnuggets-1plus1-oesterreich';
const mcd = load(read(`docs/blog/${mcdSlug}.html`));
const article = JSON.parse(mcd('script[type="application/ld+json"]').text())['@graph'].find(e => e['@type'] === 'Article');
assert.equal(article.datePublished, '2026-10-30');
assert.equal(article.dateModified, '2026-11-10');
assert.equal(sitemap('loc').filter((_, node) => sitemap(node).text() === `https://freefinder.at/blog/${mcdSlug}.html`).next('lastmod').text(), '2026-11-10');
assert.match(mcd('.hero-copy').text(), /Papiergutscheine.*endeten am 8\. November 2026/);
assert.match(mcd('.article-body').text(), /aktuelle Verfügbarkeit lässt sich nur im eigenen App-Konto prüfen/);
for (const term of ['Donaustadtstraße 49', 'Rautenweg 2', 'Ausstellungsstraße 44a', '8. November 2026', '9. November 2026', '30. November 2026']) assert.ok(mcd('.article-body').text().includes(term));
const offerRows = mcd('#angebot').next().find('tbody tr').toArray().map(row => mcd(row).text());
assert.equal(offerRows.length, 3);
assert.match(offerRows[0], /Hashbrowns.*Nougatburger.*McMuffin Fresh Chicken.*30\. November 2026.*10:30 Uhr/);
assert.match(offerRows[1], /Filet-o-Fish.*Big Mac.*Crispy Veggie Burger.*McChicken.*McPops.*30\. November 2026/);
assert.doesNotMatch(offerRows[1], /10:30|Nuggets|Royal TS/);
assert.match(offerRows[2], /6er-Chicken-McNuggets.*15\. November 2026.*Couponfrist/);
assert.equal(mcd('main[data-deal-page]').attr('data-deal-expires'), '2026-11-30T23:59:59+01:00');
assert.equal(mcd('script[src="deal-status.js"]').length, 1);
assert.equal(mcd('[data-deal-status-banner][hidden]').length, 1);
assert.equal(index(`.post-card h2 a[href="${mcdSlug}.html"]`).length, 1);
assert.equal(review.decisions.find(e => e.id === 'fc4g-rw3rck').slug, mcdSlug);

const fixture = fs.mkdtempSync(path.join(root, 'tmp', 'blog-held-recheck-'));
try {
  for (const file of ['scripts/original-deal-photo.mjs', 'scripts/deal-photo-contract.mjs', 'scripts/server-blog-content.mjs', 'scripts/generate-topic-guides.mjs', 'scripts/polish-website.mjs', 'scripts/blog-visuals.mjs', 'scripts/blog-photo-catalog.mjs', 'scripts/deal-photos.mjs', 'scripts/blog-backfill-20261018.mjs', 'scripts/blog-backfill-20261030.mjs', 'scripts/blog-backfill-20261105.mjs', 'reviews/deal-guides.json', 'docs/blog/index.html', 'docs/sitemap.xml']) {
    fs.mkdirSync(path.dirname(path.join(fixture, file)), { recursive: true });
    fs.copyFileSync(path.join(root, file), path.join(fixture, file));
  }
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), 'dir');
  fs.writeFileSync(path.join(fixture, 'docs/deals.json'), 'unchanged-feed-sentinel');
  const slugs = [...heldRecheckGuides.map(g => g.slug), mcdSlug];
  for (let pass = 0; pass < 2; pass++) {
    execFileSync(process.execPath, [path.join(fixture, 'scripts/generate-topic-guides.mjs'), ...slugs], { env: { ...process.env, SEO_NOW: '2026-11-10T13:00:00+01:00' } });
    for (const slug of slugs) assert.equal(fs.readFileSync(path.join(fixture, 'docs/blog', `${slug}.html`), 'utf8'), read(`docs/blog/${slug}.html`));
    assert.equal(fs.readFileSync(path.join(fixture, 'docs/deals.json'), 'utf8'), 'unchanged-feed-sentinel');
    assert.equal(fs.readFileSync(path.join(fixture, 'reviews/deal-guides.json'), 'utf8'), read('reviews/deal-guides.json'));
  }
} finally { fs.rmSync(fixture, { recursive: true, force: true }); }
console.log('Held-deal recheck PASS: 19 decisions, 5 guides, McDonalds update, honest partial coverage, dates, photos, sources and isolated regeneration.');

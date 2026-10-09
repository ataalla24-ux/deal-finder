import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { load } from 'cheerio';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docs = path.join(root, 'docs');
const sitemap = load(fs.readFileSync(path.join(docs, 'sitemap.xml'), 'utf8'), { xmlMode: true });
const slugs = ['guenstig-essen-wien', 'geburtstag-gratis-wien', 'kinodonnerstag-wien-drei'];
const normalize = text => text.replace(/\s+/g, ' ').trim();

for (const slug of slugs) {
  const canonical = `https://freefinder.at/blog/${slug}.html`;
  const $ = load(fs.readFileSync(path.join(docs, 'blog', `${slug}.html`), 'utf8'));
  assert.equal($('h1').length, 1, slug);
  assert.equal($('link[rel="canonical"]').attr('href'), canonical);
  assert.ok($('title').text().length <= 75, `${slug}: concise title`);
  assert.ok($('meta[name="description"]').attr('content').length <= 160, `${slug}: concise description`);
  assert.equal($('meta[property="og:url"]').attr('content'), canonical);
  const entry = sitemap('url').filter((_, element) => sitemap(element).find('loc').text() === canonical);
  assert.equal(entry.length, 1, `${slug}: one sitemap entry`);
  const modified = slug === 'geburtstag-gratis-wien' ? '2026-10-09' : slug === 'guenstig-essen-wien' ? '2026-10-07' : '2026-10-08';
  assert.equal(entry.find('lastmod').text(), modified);
  const graph = JSON.parse($('script[type="application/ld+json"]').text())['@graph'];
  const article = graph.find(item => item['@type'] === 'Article');
  assert.equal(article.mainEntityOfPage, canonical);
  assert.equal(article.dateModified, modified);
  const body = normalize($('.article-body').text());
  for (const question of graph.find(item => item['@type'] === 'FAQPage').mainEntity) {
    assert.ok(body.includes(normalize(question.name)), `${slug}: visible FAQ question`);
    assert.ok(body.includes(normalize(question.acceptedAnswer.text)), `${slug}: visible FAQ answer`);
  }
  for (const element of $('a[href]').toArray()) {
    const url = new URL($(element).attr('href'), canonical);
    if (url.origin !== 'https://freefinder.at') continue;
    const target = path.join(docs, decodeURIComponent(url.pathname), url.pathname.endsWith('/') ? 'index.html' : '');
    assert.ok(fs.existsSync(target), `${slug}: missing internal link ${url.pathname}`);
    if (url.hash) {
      const destination = load(fs.readFileSync(target, 'utf8'));
      assert.equal(destination(`[id="${decodeURIComponent(url.hash.slice(1))}"]`).length, 1, `${slug}: missing anchor ${url.hash}`);
    }
  }
  for (const element of $('img[src]').toArray()) {
    assert.ok(fs.existsSync(path.join(docs, $(element).attr('src'))), `${slug}: image exists`);
    assert.ok(Number($(element).attr('width')) > 0 && Number($(element).attr('height')) > 0);
  }
}

const kino = load(fs.readFileSync(path.join(docs, 'blog', `${slugs[2]}.html`), 'utf8'));
assert.equal(kino('#wien').nextUntil('h2').find('li').length, 9);
const birthday = load(fs.readFileSync(path.join(docs, 'blog', `${slugs[1]}.html`), 'utf8'));
assert.equal(birthday('.table-scroll tbody tr').length, 4);
for (const postcode of ['1010', '1020', '1110', '1220']) assert.ok(birthday('.table-scroll').text().includes(postcode));
const index = load(fs.readFileSync(path.join(docs, 'blog', 'index.html'), 'utf8'));
for (const slug of slugs) {
  assert.equal(index(`.topic-nav a[href="${slug}.html"]`).length, 1);
  for (const filename of ['index.html', 'angebote-wien-heute.html']) {
    const page = load(fs.readFileSync(path.join(docs, filename), 'utf8'));
    assert.ok(page(`a[href$="blog/${slug}.html"]`).length > 0, `${filename}: links to ${slug}`);
  }
}
for (const href of ['lugner-city-50-prozent-gastronomie-5-oktober-2026.html', 'interpolburger-2-euro-wien.html', 'duru-doener-350-wien-2026.html']) {
  const card = index(`a[href="${href}"]`).closest('.post-card');
  assert.match(card.find('.topic-label').text(), /Aktion beendet/);
  assert.doesNotMatch(card.find('h2').text(), /Heute|Nur heute/i);
}

// Targeted regeneration must not touch unrelated articles or the shared feed.
fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
const fixture = fs.mkdtempSync(path.join(root, 'tmp', 'freefinder-vienna-seo-test-'));
try {
  for (const filename of ['scripts/generate-topic-guides.mjs', 'scripts/polish-website.mjs', 'reviews/deal-guides.json', 'docs/sitemap.xml']) {
    const destination = path.join(fixture, filename);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(root, filename), destination);
  }
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), 'dir');
  fs.mkdirSync(path.join(fixture, 'docs/blog'));
  execFileSync(process.execPath, [path.join(fixture, 'scripts/generate-topic-guides.mjs'), ...slugs.slice(0, 2)], {
    env: { ...process.env, SEO_NOW: '2026-10-09T10:00:00+02:00' },
  });
  assert.deepEqual(fs.readdirSync(path.join(fixture, 'docs/blog')).sort(), slugs.slice(0, 2).map(slug => `${slug}.html`).sort());
  for (const slug of slugs.slice(0, 2)) {
    assert.equal(fs.readFileSync(path.join(fixture, 'docs/blog', `${slug}.html`), 'utf8'), fs.readFileSync(path.join(docs, 'blog', `${slug}.html`), 'utf8'));
  }
  assert.equal(fs.existsSync(path.join(fixture, 'docs/deals.json')), false);
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
console.log('Vienna SEO checks passed: metadata, sitemap, visible FAQs, addresses, links, images, archives and targeted regeneration.');

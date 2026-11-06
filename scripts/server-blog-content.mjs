import { createHash } from 'node:crypto';
import { load } from 'cheerio';

export const blogDigest = value => createHash('sha256').update(value).digest('hex');
export const blogDay = date => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna' }).format(date);
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const marker = '[data-server-blog-update]';

export function inspectBlogArticle(html, slug) {
  const $ = load(html);
  if ($('article.article-body').length !== 1 || $('article.article-body #quelle').length !== 1
    || $('.article-meta span').length < 2 || $(marker).length > 1
    || $('link[rel="canonical"]').attr('href') !== `https://freefinder.at/blog/${slug}.html`) return 'unsupported-guide-layout';
  try {
    const schemas = $('script[type="application/ld+json"]').toArray().flatMap(node => {
      const schema = JSON.parse($(node).text()); return schema['@graph'] || [schema];
    });
    if (schemas.filter(item => item['@type'] === 'Article').length !== 1) return 'unsupported-article-schema';
  } catch { return 'invalid-article-schema'; }
  $('script,style,nav,footer').remove();
  if (clean($('main').text() || $('article').text()).length > 16000) return 'article-too-long-for-complete-review';
  return null;
}

export function validateBlogDraft(draft, candidate) {
  if (draft?.useful !== true || typeof draft.title !== 'string' || draft.title.length < 10
    || draft.title.length > 100 || /[<>]|https?:/i.test(draft.title)) return false;
  if (!Array.isArray(draft.sections) || draft.sections.length < 3 || draft.sections.length > 6) return false;
  const source = clean(candidate.source.officialText);
  for (const section of draft.sections) {
    if (typeof section.heading !== 'string' || section.heading.length < 4 || section.heading.length > 120
      || typeof section.text !== 'string' || section.text.length > 2500
      || /[<>]|https?:/i.test(section.text + ' ' + section.heading)
      || typeof section.quote !== 'string' || clean(section.quote).length < 12
      || !source.includes(clean(section.quote))) return false;
    // Source passages are audit evidence, not licensed reader-facing copy.
    const words = clean(section.text).toLowerCase().split(' ');
    for (let i = 0; i + 25 <= words.length; i++) {
      if (source.toLowerCase().includes(words.slice(i, i + 25).join(' '))) return false;
    }
  }
  const words = draft.sections.map(row => row.text).join(' ').split(/\s+/).filter(Boolean).length;
  return words >= 250 && words <= 700;
}

export function articleBaseFingerprint(html) {
  const $ = load(html);
  $(marker).remove();
  if ($('article.article-body').length !== 1) throw Error('unsupported-blog-article-layout');
  const article = $('article.article-body');
  article.find('h1,h2,h3,h4,p,li,dt,dd,td,br').after(' ');
  const schemas = $('script[type="application/ld+json"]').toArray().map(node => JSON.parse($(node).text()));
  // Whitespace, generated modification dates and reading times are not copy.
  // Offer text, images, URLs, FAQs and eligibility stay part of the guard.
  for (const schema of schemas) {
    for (const item of schema['@graph'] || [schema]) if (item['@type'] === 'Article') delete item.dateModified;
  }
  return blogDigest(JSON.stringify({
    text: clean(article.text()), headline: clean($('.article-hero h1').text()), intro: clean($('.hero-copy').text()),
    media: article.find('img,source').toArray().map(node => ({ src: $(node).attr('src'), srcset: $(node).attr('srcset'), alt: $(node).attr('alt') })),
    links: article.find('a').toArray().map(node => [$(node).attr('href'), clean($(node).text())]),
    canonical: $('link[rel="canonical"]').attr('href'), title: $('title').text(),
    description: $('meta[name="description"]').attr('content'), schemas,
  }));
}

export function applyBlogPublication(html, publication, slug) {
  if (!publication) return html;
  const drafts = [...(publication.history || []), publication.draft];
  if (publication.slug !== slug || !/^[a-z0-9-]+$/.test(slug)
    || !/^20\d{2}-\d{2}-\d{2}$/.test(publication.day)
    || drafts.length > 3 || drafts.some(draft => !validateBlogDraft(draft, { source: { officialText: publication.sourceText } }))) throw Error('invalid-blog-publication');
  if (articleBaseFingerprint(html) !== publication.baseFingerprint) throw Error(`blog-base-changed:${slug}`);
  const $ = load(html);
  const url = `https://freefinder.at/blog/${slug}.html`;
  if ($('link[rel="canonical"]').attr('href') !== url || $(marker).length > 1) throw Error('blog-canonical-or-marker-mismatch');
  const article = $('article.article-body');
  if (article.find('#quelle').length !== 1 || $('.article-meta span').length < 2) throw Error('unsupported-blog-update-anchor');
  $(marker).remove();
  const sections = drafts.map((draft, index) => `<h2${index === 0 ? ' id="server-blog-heading"' : ''}>${escape(draft.title)}</h2>`
    + draft.sections.map(section => `<h3>${escape(section.heading)}</h3><p>${escape(section.text)}</p>`).join('\n')).join('\n');
  article.find('#quelle').before(`<section data-server-blog-update="${escape(publication.fingerprint)}" aria-labelledby="server-blog-heading">${sections}</section>`);
  const date = new Date(`${publication.day}T12:00:00Z`);
  $('.article-meta span').first().text(`Aktualisiert am ${new Intl.DateTimeFormat('de-AT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Vienna' }).format(date)}`);
  const minutes = Math.max(1, Math.ceil(clean(article.text()).split(' ').length / 170));
  $('.article-meta span').eq(1).text(`${minutes} Minuten Lesezeit`);
  let modified = 0;
  $('script[type="application/ld+json"]').each((_, node) => {
    const schema = JSON.parse($(node).text());
    for (const item of schema['@graph'] || [schema]) {
      if (item['@type'] === 'Article') { item.dateModified = publication.day; modified++; }
    }
    $(node).text(JSON.stringify(schema));
  });
  if (modified !== 1) throw Error('unsupported-blog-article-schema');
  const result = $.html();
  if (articleBaseFingerprint(result) !== publication.baseFingerprint) throw Error('blog-base-preservation-failed');
  return result;
}

export function updateBlogSitemap(sitemap, slug, day) {
  const $ = load(sitemap, { xml: true });
  const url = `https://freefinder.at/blog/${slug}.html`;
  const entry = $('url').filter((_, node) => $(node).find('loc').text() === url);
  if (entry.length !== 1 || entry.find('lastmod').length !== 1) throw Error('blog-sitemap-entry-missing-or-duplicate');
  entry.find('lastmod').text(day);
  return $.xml();
}

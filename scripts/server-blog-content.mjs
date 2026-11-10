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
  if (draft?.mode === 'revision') return validateBlogRevision(draft, candidate);
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

export function inspectBlogRevision(html, slug, validUntil = '') {
  const reason = inspectBlogArticle(html, slug);
  if (reason) return reason;
  const $ = load(html);
  // A full rewrite must not erase or contradict a manually sourced summary.
  if ($('article.article-body > .deal-facts').length) return 'curated-deal-summary-needs-review';
  const single = ['main', '.article-hero h1', '.hero-copy', '.article-hero .eyebrow',
    'article.article-body > picture', 'article.article-body > .related-links', '.article-aside',
    'title', 'meta[name="description"]', 'meta[property="og:title"]', 'meta[property="og:description"]'];
  if (single.some(selector => $(selector).length !== 1)) return 'unsupported-full-revision-layout';
  const schemas = $('script[type="application/ld+json"]').toArray().flatMap(node => {
    const schema = JSON.parse($(node).text()); return schema['@graph'] || [schema];
  });
  if (schemas.filter(item => item['@type'] === 'FAQPage').length !== 1) return 'unsupported-full-revision-faq';
  // Editing prose must not silently extend, drop or contradict the campaign clock.
  const expiry = $('main').attr('data-deal-expires') || '';
  if (expiry !== (validUntil || '') && expiry !== `${validUntil}T23:59:59+01:00`
    && expiry !== `${validUntil}T23:59:59+02:00`) return 'article-campaign-expiry-needs-review';
  return null;
}

export function validateBlogRevision(draft, candidate) {
  const source = clean(candidate.source.officialText);
  if (!validateBlogDraft({ ...draft, mode: 'addition' }, candidate)
    || typeof draft.meta !== 'string' || draft.meta.length < 50 || draft.meta.length > 180
    || typeof draft.intro !== 'string' || draft.intro.length < 50 || draft.intro.length > 500
    || !Array.isArray(draft.faqs) || draft.faqs.length < 2 || draft.faqs.length > 5) return false;
  for (const row of draft.faqs) {
    if (typeof row.question !== 'string' || row.question.length < 10 || row.question.length > 160
      || typeof row.answer !== 'string' || row.answer.length < 20 || row.answer.length > 800
      || typeof row.quote !== 'string' || clean(row.quote).length < 12 || !source.includes(clean(row.quote))) return false;
  }
  if (new Set(draft.sections.map(row => clean(row.heading).toLowerCase())).size !== draft.sections.length
    || new Set(draft.faqs.map(row => clean(row.question).toLowerCase())).size !== draft.faqs.length) return false;
  const text = [draft.title, draft.meta, draft.intro, ...draft.sections.flatMap(row => [row.heading, row.text]),
    ...draft.faqs.flatMap(row => [row.question, row.answer])].join(' ');
  if (/[<>]|https?:|www\./i.test(text)) return false;
  const words = clean(text).toLowerCase().split(' ');
  for (let i = 0; i + 25 <= words.length; i++) {
    if (source.toLowerCase().includes(words.slice(i, i + 25).join(' '))) return false;
  }
  const numbers = value => (value.match(/\d+(?:[.,]\d+)?/g) || []).map(number => number.replace(',', '.'));
  const sourceNumbers = new Set(numbers(source));
  return numbers(text).every(number => sourceNumbers.has(number));
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
  if (publication.kind === 'revision') return applyBlogRevision(html, publication, slug);
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

function applyBlogRevision(html, publication, slug) {
  const draft = publication.draft;
  if (publication.slug !== slug || !/^[a-z0-9-]+$/.test(slug)
    || !/^20\d{2}-\d{2}-\d{2}$/.test(publication.day) || draft?.mode !== 'revision'
    || !validateBlogRevision(draft, { source: { officialText: publication.sourceText } })
    || inspectBlogRevision(html, slug, publication.validUntil)) throw Error('invalid-blog-revision');
  const inputHash = articleBaseFingerprint(html);
  if (![publication.baseFingerprint, publication.inputFingerprint, publication.resultFingerprint, publication.archiveFingerprint].filter(Boolean).includes(inputHash)) {
    throw Error(`blog-base-changed:${slug}`);
  }
  const $ = load(html), article = $('article.article-body');
  const picture = article.children('picture').toString(), related = article.children('.related-links').toString();
  const url = `https://freefinder.at/blog/${slug}.html`;
  const sourceUrl = new URL(publication.sourceUrl);
  if (sourceUrl.protocol !== 'https:' || sourceUrl.username || sourceUrl.password) throw Error('invalid-blog-source-url');
  article.attr('data-server-blog-revision', publication.fingerprint).attr('data-guide-reviewed', publication.day);
  article.html(picture + draft.sections.map((row, index) => `<h2 id="abschnitt-${index + 1}">${escape(row.heading)}</h2><p>${escape(row.text)}</p>`).join('\n')
    + `<h2 id="quelle">Quelle und Stand</h2><p>Stand: ${escape(publication.day)}. <a href="${escape(sourceUrl.href)}">Offizielle Angebotsbedingungen</a>.</p>`
    + '<h2 id="faq">Häufige Fragen</h2>' + draft.faqs.map(row => `<h3>${escape(row.question)}</h3><p>${escape(row.answer)}</p>`).join('\n')
    + '<h2 id="weiterlesen">Passende FreeFinder-Seiten</h2>' + related);
  $('.article-hero h1').text(draft.title);
  $('.article-hero .eyebrow').text('FreeFinder Guide');
  $('.hero-copy').text(draft.intro);
  $('title').text(`${draft.title} | FreeFinder`);
  $('meta[name="description"],meta[property="og:description"]').attr('content', draft.meta);
  $('meta[property="og:title"]').attr('content', draft.title);
  $('meta[name="twitter:title"]').attr('content', draft.title);
  $('meta[name="twitter:description"]').attr('content', draft.meta);
  $('.article-meta span').first().text(`Aktualisiert am ${new Intl.DateTimeFormat('de-AT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Vienna' }).format(new Date(`${publication.day}T12:00:00Z`))}`);
  $('.article-meta span').eq(1).text(`${Math.max(1, Math.ceil(clean(article.text()).split(' ').length / 170))} Minuten Lesezeit`);
  $('.article-aside').html('<details class="article-contents"><summary>In diesem Guide</summary>' + draft.sections.map((row, index) => `<a href="#abschnitt-${index + 1}">${escape(row.heading)}</a>`).join('')
    + '<a href="#quelle">Quelle und Stand</a><a href="#faq">Häufige Fragen</a><a href="#weiterlesen">Weiterlesen</a></details>');
  $('script[type="application/ld+json"]').each((_, node) => {
    const schema = JSON.parse($(node).text());
    for (const item of schema['@graph'] || [schema]) {
      if (item['@type'] === 'Article') Object.assign(item, { headline: draft.title, description: draft.meta, dateModified: publication.day });
      if (item['@type'] === 'FAQPage') item.mainEntity = draft.faqs.map(row => ({ '@type': 'Question', name: row.question, acceptedAnswer: { '@type': 'Answer', text: row.answer } }));
      if (item['@type'] === 'BreadcrumbList') for (const crumb of item.itemListElement || []) if (crumb.item === url) crumb.name = draft.title;
    }
    $(node).text(JSON.stringify(schema));
  });
  const result = $.html();
  if (publication.resultFingerprint && articleBaseFingerprint(result) !== publication.resultFingerprint) throw Error('blog-revision-replay-mismatch');
  return result;
}

export function blogIndexCardFingerprint(html, slug) {
  const $ = load(html), card = $('article.post-card').filter((_, node) => $(node).find('h2 a').attr('href') === `${slug}.html`);
  if (card.length !== 1 || card.find('h2 a').length !== 1 || card.find('.post-card-body > p').length !== 1) throw Error('blog-index-card-missing-or-duplicate');
  return blogDigest(JSON.stringify({ title: clean(card.find('h2 a').text()), meta: clean(card.find('.post-card-body > p').text()),
    image: card.find('img').attr('src'), alt: card.find('img').attr('alt'), expiry: card.attr('data-deal-expires') || '' }));
}

export function applyBlogIndexPublication(html, publication, slug) {
  if (publication?.kind !== 'revision') return html;
  const before = blogIndexCardFingerprint(html, slug);
  if (![publication.indexBaseFingerprint, publication.indexInputFingerprint, publication.indexResultFingerprint].filter(Boolean).includes(before)) throw Error(`blog-index-base-changed:${slug}`);
  const $ = load(html), card = $('article.post-card').filter((_, node) => $(node).find('h2 a').attr('href') === `${slug}.html`);
  card.find('h2 a').text(publication.draft.title);
  card.find('.post-card-body > p').text(publication.draft.meta);
  const result = $.html();
  if (publication.indexResultFingerprint && blogIndexCardFingerprint(result, slug) !== publication.indexResultFingerprint) throw Error('blog-index-replay-mismatch');
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

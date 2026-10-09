import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'cheerio';
import { blogVisual, visualPicture, polishBlogVisuals } from './blog-visuals.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compact = value => String(value).replace(/\s+/g, ' ').trim();
const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Keep hand-written HTML formatting; only replace the audited elements.
export function polishHtml(source, filename, now = Date.now()) {
  let html = source;
  let $ = load(html);
  const publicPage = !/noindex/i.test($('meta[name="robots"]').attr('content') || '') || ['404.html', 'offline.html'].includes(filename);
  if (!publicPage) return html;
  html = html.replace(/https:\/\/freefinder\.at\/og-preview-stores\.png/g, 'https://freefinder.at/og-home-20261007.jpg');
  html = polishBlogVisuals(html, filename);
  if (filename === 'blog/index.html') {
    const cards = [...html.matchAll(/<article\b[^>]*class="[^\"]*\bpost-card\b[^\"]*"[\s\S]*?<\/article>/g)];
    const updated = cards.map(match => {
      const card = load(match[0]);
      const href = card('a[href]').first().attr('href');
      const visual = blogVisual((href || '').split('/').pop().replace(/\.html$/, ''), card('img').first().attr('src'));
      if (visual) {
        const image = card('img').first();
        (image.parent().is('picture') ? image.parent() : image).replaceWith(visualPicture(visual));
      }
      const expires = card('article').attr('data-deal-expires');
      const archived = card('article').attr('data-archive') === 'true' || Boolean(expires && Date.parse(expires) < now);
      const topics = [
        ['geburtstag', /geburtstag/], ['kaffee', /kaffee|heissgetraenk|winterheiss|starbucks/],
        ['freizeit', /kino|worship|feuerwehr|fitness|evo-|freizeit|filmsommer|open-house|geschichte/],
        ['shopping', /shopping|guess|moebelix|autodoc|produktproben/],
        ['essen', /essen|restaurant|food|pizza|kebab|doener|duru|burger|dahab|duck|ganesha|nordsee|hut|lugner|fruehstueck/],
      ];
      card('article').attr('data-topic', topics.find(([, pattern]) => pattern.test(href || ''))?.[0] || 'ratgeber');
      card('article').attr('data-archive', String(archived));
      if (!card('h2 a').length && href) card('h2').html(`<a href="${escape(href)}">${escape(card('h2').text())}</a>`);
      if (archived) {
        card('article').addClass('is-expired');
        card('.topic-label').text('Aktion beendet · Archiv');
      }
      card('img').attr('loading', 'lazy');
      const priorities = ['guenstig-essen-wien.html', 'geburtstag-gratis-wien.html', 'kinodonnerstag-wien-drei.html'];
      const priority = priorities.indexOf(href);
      return { html: card('article').toString(), archived, priority: priority < 0 ? priorities.length : priority };
    }).sort((a, b) => Number(a.archived) - Number(b.archived) || a.priority - b.priority);
    if (cards.length) {
      updated[0].html = updated[0].html.replace('loading="lazy"', 'loading="eager"');
      html = html.slice(0, cards[0].index) + updated.map(item => item.html).join('\n        ') + html.slice(cards.at(-1).index + cards.at(-1)[0].length);
    }
    if (!html.includes('id="blogFilters"')) html = html.replace('<div class="post-grid">', `<form class="blog-filters" id="blogFilters" role="search" aria-label="Blog durchsuchen" hidden>
        <label class="blog-search" for="blogSearch">Beiträge suchen<input id="blogSearch" type="search" placeholder="z. B. Geburtstag, Döner, 1080" autocomplete="off"></label>
        <label for="blogTopic">Thema<select id="blogTopic"><option value="">Alle Themen</option><option value="essen">Essen &amp; Restaurants</option><option value="kaffee">Kaffee &amp; Getränke</option><option value="geburtstag">Geburtstag</option><option value="freizeit">Freizeit &amp; Kino</option><option value="shopping">Shopping &amp; Online</option><option value="ratgeber">Gutscheine &amp; Ratgeber</option></select></label>
        <label class="blog-archive" for="blogArchive"><input id="blogArchive" type="checkbox">Archiv anzeigen</label>
        <p class="blog-results" id="blogResults" role="status" aria-live="polite" aria-atomic="true"></p>
      </form>
      <div class="post-grid">`);
  }
  html = html.replace(/consent\.js\?v=\d+/g, 'consent.js?v=8').replace(/consent\.css\?v=\d+/g, 'consent.css?v=7');
  if (!html.includes('consent.css')) html = html.replace('</head>', '  <link rel="stylesheet" href="/consent.css?v=7">\n</head>');
  const main = $('main').first();
  if (main.length && !$('.skip-link').length) {
    const target = main.attr('id') || 'main-content';
    html = html.replace(/<main\b([^>]*)>/, (_, attrs) => `<main${attrs}${main.attr('id') ? '' : ` id="${target}"`}${main.attr('tabindex') ? '' : ' tabindex="-1"'}>`);
    html = html.replace(/<body\b[^>]*>/, opening => `${opening}\n  <a class="skip-link" href="#${target}">Zum Inhalt</a>`);
  }
  html = html.replace(/<aside\b([^>]*)class="article-aside"([^>]*)>([\s\S]*?)<\/aside>/g, (whole, before, after, inner) => {
    if (inner.includes('article-contents')) return whole;
    return `<aside${before}class="article-aside"${after}><details class="article-contents"><summary>In diesem Guide</summary>${inner.replace(/<h2\b[^>]*>[\s\S]*?<\/h2>/, '')}</details></aside>`;
  });
  const expiry = main.attr('data-deal-expires');
  if (expiry && Number.isFinite(Date.parse(expiry)) && Date.parse(expiry) < now) {
    let base = compact($('title').text()).replace(/\s*\|\s*FreeFinder\s*$/, '').replace(/\s*\(Archiv\)$/, '');
    if (base.length > 51) base = base.slice(0, 52).replace(/\s+\S*$/, '');
    const title = `${base} (Archiv) | FreeFinder`;
    const date = new Intl.DateTimeFormat('de-AT', { dateStyle: 'medium', timeZone: 'Europe/Vienna' }).format(new Date(expiry));
    const description = `${base}: Aktion beendet am ${date}. Bedingungen im Archiv; aktuelle Wiener Deals in unserer Übersicht.`;
    html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${escape(title)}</title>`);
    html = html.replace(/(<meta\s+(?:name|property)="(?:description|og:description|twitter:description)"\s+content=")[^"]*/g, `$1${escape(description)}`);
    html = html.replace(/(<meta\s+(?:name|property)="(?:og:title|twitter:title)"\s+content=")[^"]*/g, `$1${escape(title.replace(' | FreeFinder', ''))}`);
    html = html.replace(/<body\b([^>]*)>/, (whole, attrs) => {
      if (/deal-is-expired/.test(attrs)) return whole;
      return attrs.includes('class="') ? whole.replace('class="', 'class="deal-is-expired ') : `<body${attrs} class="deal-is-expired">`;
    });
    html = html.replace(/(<[^>]*data-deal-status-banner)\s+hidden/g, '$1');
    html = html.replace(/<p class="eyebrow">[\s\S]*?<\/p>/, '<p class="eyebrow">Aktion beendet · Archiv</p>');
  }
  $ = load(html);
  const visibleFaqs = [];
  $('.faq-item').each((_, node) => {
    visibleFaqs.push([compact($(node).find('summary').text()), compact($(node).find('p').text())]);
  });
  if (!visibleFaqs.length) $('h3').each((_, node) => {
    const heading = $(node).prevAll('h2').first();
    if (/faq|fragen/i.test(heading.attr('id') || '') || /FAQ|Häufige Fragen/i.test(heading.text())) {
      const answer = compact($(node).nextUntil('h2, h3').filter('p').text());
      if (answer) visibleFaqs.push([compact($(node).text()), answer]);
    }
  });
  html = html.replace(/(<script\b[^>]*type="application\/ld\+json"[^>]*>)([\s\S]*?)(<\/script>)/g, (whole, start, text, end) => {
    const data = JSON.parse(text);
    const original = JSON.stringify(data);
    const graph = data['@graph'] || [data];
    for (const item of graph) {
      if (filename === 'index.html' && item['@type'] === 'MobileApplication') item.image = 'https://freefinder.at/og-home-20261007.jpg';
      if (item['@type'] === 'FAQPage') item.mainEntity = visibleFaqs.map(([question, answer]) => ({ '@type': 'Question', name: question, acceptedAnswer: { '@type': 'Answer', text: answer } }));
      if (item['@type'] === 'Article' && expiry && Date.parse(expiry) < now) {
        item.headline = $('title').text().replace(' | FreeFinder', '');
        item.description = $('meta[name="description"]').attr('content');
      }
    }
    if (data['@graph']) data['@graph'] = graph.filter(item => item['@type'] !== 'FAQPage' || item.mainEntity.length);
    else if (data['@type'] === 'FAQPage' && !data.mainEntity.length) return '';
    return JSON.stringify(data) === original ? whole : `${start}${JSON.stringify(data).replace(/</g, '\\u003c')}${end}`;
  });
  if (!/noindex/i.test($('meta[name="robots"]').attr('content') || '')) {
    const metadata = {
      'og:title': $('title').text(), 'og:description': $('meta[name="description"]').attr('content'),
      'og:url': $('link[rel="canonical"]').attr('href'), 'og:image': 'https://freefinder.at/og-home-20261007.jpg', 'og:type': 'website',
    };
    const additions = Object.entries(metadata).filter(([name, value]) => value && !$(`meta[property="${name}"]`).length).map(([name, value]) => `  <meta property="${name}" content="${escape(value)}">`);
    if (additions.length) html = html.replace('</head>', additions.join('\n') + '\n</head>');
  }
  return html.replace(/^[ \t]+$/gm, '');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const docs = path.join(root, 'docs');
  let changed = 0;
  for (const file of fs.readdirSync(docs, { recursive: true }).filter(file => file.endsWith('.html'))) {
    const location = path.join(docs, file);
    const source = fs.readFileSync(location, 'utf8');
    const result = polishHtml(source, file);
    if (result === source) continue;
    changed++;
    if (!process.argv.includes('--check')) fs.writeFileSync(location, result);
  }
  console.log(`${changed} page(s) ${process.argv.includes('--check') ? 'need normalization' : 'normalized'}.`);
  if (changed && process.argv.includes('--check')) process.exitCode = 1;
}

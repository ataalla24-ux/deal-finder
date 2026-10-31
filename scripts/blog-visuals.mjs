import { load } from 'cheerio';
import { backfillCovers } from './blog-backfill-20261018.mjs';
import { catchupCovers } from './blog-backfill-20261030.mjs';
import { photoVisual } from './blog-photo-catalog.mjs';

// Editorial subject metadata is retained for generators; images are photographs.
export const covers = {
  ...backfillCovers,
  ...catchupCovers,
  'blumencafe-kaffee-kuchen-6-euro-wien': { lines: ['Blumencafé', 'Kaffee & Kuchen.'], topic: 'Kaffeepause in Währing', tone: 'green' },
  'wien-guides': { lines: ['Deals & Gutscheine', 'in Wien.'], topic: 'FreeFinder Blog', tone: 'green' },
  'guenstig-essen-wien': { lines: ['Günstig essen', 'in Wien.'], topic: 'Essen nach Bezirk', tone: 'green' },
  'geburtstag-gratis-wien': { lines: ['Geburtstag', 'in Wien.'], topic: 'Essen, Eintritt & Erlebnisse', tone: 'rose' },
  'kinodonnerstag-wien-drei': { lines: ['KinoDonnerstag', 'mit Drei.'], topic: 'Kino in Wien', brand: 'drei', tone: 'blue' },
  'anker-winterheissgetraenk-20-prozent-wien': { lines: ['ANKER', 'Heißgetränke.'], topic: 'Kaffee & Getränke', brand: 'anker', tone: 'yellow' },
  'autodoc-30-euro-gutschein': { lines: ['AUTODOC', 'Gutscheine.'], topic: 'Online sparen', brand: 'autodoc', tone: 'blue' },
  'dahab-doener-1plus1-wien': { lines: ['Dahab Döner', 'in Wien.'], topic: 'Döner & Aktionen', tone: 'green' },
  'duru-doener-350-wien-2026': { lines: ['Duru Döner', 'Thaliastraße.'], topic: 'Döner in Wien', brand: 'duru', tone: 'green' },
  'duru-kebab-wien-wolt-rabatt': { lines: ['Duru Kebab', 'in Wien.'], topic: 'Bestellen & sparen', brand: 'duru', tone: 'green' },
  'foodora-60-prozent-rabatt-genuss-wien': { lines: ['Foodora', 'Gutschein GENUSS.'], topic: 'Code & Bedingungen', brand: 'foodora', tone: 'rose' },
  'ganesha-10-euro-gutschein-50-euro-wien': { lines: ['Ganesha', 'Restaurant.'], topic: 'Restaurant-Gutschein in Wien', brand: 'ganesha', tone: 'yellow' },
  'gratis-gemuese-kebab-h11-wien': { lines: ['H11', 'Gemüse-Kebab.'], topic: 'Kebab in Wien', tone: 'green' },
  'gratis-heissgetraenk-ikea-wien': { lines: ['IKEA', 'Kaffee & Tee.'], topic: 'IKEA Family in Wien', brand: 'ikea', tone: 'blue' },
  'gratis-pizza-wien-laziz-food': { lines: ['Wiener Laziz Food', 'Pizza-Angebote.'], topic: 'Bestellen in Wien', brand: 'laziz', tone: 'green' },
  'guess-shopping-week-20-prozent-wien': { lines: ['GUESS', 'Shopping Week.'], topic: 'Mode & Rabatte', brand: 'guess', tone: 'rose' },
  'ikea-1-euro-fruehstueck-wien': { lines: ['Frühstück', 'bei IKEA.'], topic: 'Essen in Wien', brand: 'ikea', tone: 'yellow' },
  'interpolburger-2-euro-wien': { lines: ['Interpolburger', 'in Wien.'], topic: 'Burger & Aktionen', tone: 'yellow' },
  'kebab-1-euro-wien-yusis-1030': { lines: ['Yusis x 1030', 'Kebab in Wien.'], topic: 'Wien Landstraße', tone: 'green' },
  'lieferando-plus-drei-wien': { lines: ['Lieferando+', 'mit Drei.'], topic: 'Lieferbedingungen & Vorteile', brand: 'lieferando', tone: 'yellow' },
  'loving-hut-dog-1plus1-wien': { lines: ['Loving Hut', 'Neubau.'], topic: 'Vegan essen in Wien', brand: 'lovinghut', tone: 'green' },
  'lugner-city-50-prozent-gastronomie-5-oktober-2026': { lines: ['Lugner City', 'Gastronomie.'], topic: 'Wien Rudolfsheim-Fünfhaus', tone: 'rose' },
  'magenta-moments-kino-1plus1-wien': { lines: ['Magenta Moments', 'Kino in Wien.'], topic: 'Kinotickets & Vorteile', brand: 'magenta', tone: 'rose' },
  'moebelix-20-prozent-teppiche-wien': { lines: ['Möbelix', 'Teppich-Angebote.'], topic: 'Wohnen & sparen', brand: 'moebelix', tone: 'blue' },
  'papa-duck-bowl-wien-1plus1-gratis': { lines: ['Papa Duck', 'Bowls in Wien.'], topic: 'Essen in Mariahilf', brand: 'papaduck', tone: 'green' },
  'pizza-rando-3-doener-zum-preis-von-2-wien': { lines: ['Pizza Rando', 'Döner in Wien.'], topic: 'Wien Brigittenau', tone: 'yellow' },
  'pizzamann-drei-plus-wien': { lines: ['PizzaMann', 'mit Drei Plus.'], topic: 'Pizza & Bedingungen', brand: 'pizzamann', tone: 'blue' },
  'ryanair-ibiza-ab-5598-wien-oktober-2026': { lines: ['Ryanair', 'Wien – Ibiza.'], topic: 'Flüge ab Wien', brand: 'ryanair', tone: 'blue' },
  'starbucks-5-euro-rabatt-kaffee5-wien': { lines: ['Starbucks', 'Gutschein KAFFEE5.'], topic: 'Kaffee in Wien', brand: 'starbucks', tone: 'green' },
  'filmsommer-moebelmuseum-wien-gratis': { lines: ['Filmsommer', 'Möbelmuseum Wien.'], topic: 'Kino & Kultur', tone: 'blue' },
  'open-house-wien-2026-gratis': { lines: ['Open House', 'Wien.'], topic: 'Architektur entdecken', tone: 'blue' },
  'wien-meine-geschichte-gratis-eintritt': { lines: ['Wien Museum', 'Meine Geschichte.'], topic: 'Kultur & Eintritt', tone: 'yellow' },
  'app-gutscheine-wien': { lines: ['App-Gutscheine', 'in Wien.'], topic: 'Aktivieren & einlösen', tone: 'blue' },
  'eins-plus-eins-wien': { lines: ['1+1-Aktionen', 'in Wien.'], topic: 'Vergleichen & sparen', tone: 'rose' },
  'gratis-essen-wien': { lines: ['Gratis essen', 'in Wien.'], topic: 'Angebote & Voraussetzungen', tone: 'green' },
  'gratis-kaffee-wien': { lines: ['Gratis Kaffee', 'in Wien.'], topic: 'Kaffee & Getränke', tone: 'yellow' },
  'gutscheine-wien': { lines: ['Gutscheine', 'in Wien.'], topic: 'Codes & Bedingungen', tone: 'rose' },
  'kostenlose-angebote-wien': { lines: ['Kostenlose Angebote', 'in Wien.'], topic: 'Entdecken & einlösen', tone: 'green' },
  'kostenlose-freizeitangebote-wien': { lines: ['Kostenlose Freizeit', 'in Wien.'], topic: 'Kultur, Sport & Erlebnisse', tone: 'blue' },
  'produktproben-wien': { lines: ['Produktproben', 'in Wien.'], topic: 'Samples & Verkostungen', tone: 'yellow' },
  'rabatte-wien': { lines: ['Rabatte', 'in Wien.'], topic: 'Preise vergleichen', tone: 'rose' },
  'restaurant-gutscheine-wien': { lines: ['Restaurant-', 'Gutscheine in Wien.'], topic: 'Essen & sparen', tone: 'green' },
  'studentenrabatte-wien': { lines: ['Studentenrabatte', 'in Wien.'], topic: 'Vorteile fürs Studium', tone: 'blue' },
};

const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const legacy = /(?:current-ios\/|og-preview|og-home-|\/blog\/covers\/)/;
export function blogVisual(slug, currentImage = '') {
  const key = Object.hasOwn(covers, slug) ? slug : legacy.test(currentImage) ? 'wien-guides' : null;
  if (!key) return null;
  return photoVisual(key, covers[key]);
}

export function polishBlogCardVisuals(html, filename) {
  if (!['index.html', 'blog/index.html'].includes(filename)) return html;
  return html.replace(/<article\b[^>]*class="[^"]*\b(?:post-card|blog-card)\b[^"]*"[\s\S]*?<\/article>/g, fragment => {
    const $ = load(fragment);
    const href = $('a[href]').first().attr('href');
    const image = $('img').first();
    if (!href || !image.length) return fragment;
    const visual = blogVisual(href.split('/').pop().replace(/\.html$/, ''), image.attr('src'));
    if (!visual) return fragment;
    const element = image.parent().is('picture') ? image.parent() : image;
    return fragment.replace($.html(element), visualPicture(visual, { eager: image.attr('loading') === 'eager' }));
  });
}

export function visualPicture(visual, { article = false, eager = false, sizes: customSizes } = {}) {
  const sizes = customSizes || (article ? '(max-width: 760px) calc(100vw - 40px), 760px' : '(max-width: 620px) calc(100vw - 40px), (max-width: 950px) calc((100vw - 60px) / 2), 354px');
  return `<picture><source type="image/webp" srcset="${visual.thumbnail} 480w, ${visual.webp} 1200w" sizes="${sizes}"><img${article ? ' class="article-image"' : ''} src="${visual.src}" alt="${escape(visual.alt)}" width="1200" height="630" loading="${eager ? 'eager' : 'lazy'}" decoding="async"></picture>`;
}

const discoveryTopics = [
  ['guenstig-essen-wien', 'Essen in Wien', 'only-noodle-biang-biang-1plus1-wien'],
  ['gratis-kaffee-wien', 'Kaffee', 'gratis-kaffee-wien'],
  ['eins-plus-eins-wien', '1+1-Aktionen', 'papa-duck-pizza-donnerstag-1plus1-wien'],
  ['geburtstag-gratis-wien', 'Geburtstag', 'geburtstag-gratis-wien'],
  ['kinodonnerstag-wien-drei', 'Kino in Wien', 'kinodonnerstag-wien-drei'],
  [null, 'Alle Angebote', 'wiener-riesenrad-1plus1-gutschein'],
];
const discoveryGuides = {
  'guenstig-essen-wien': 'Günstig essen nach Bezirk',
  'geburtstag-gratis-wien': 'Geburtstag: Essen & Eintritt',
  'kinodonnerstag-wien-drei': 'KinoDonnerstag in Wien',
  'gratis-kaffee-wien': 'Gratis Kaffee in Wien',
  'eins-plus-eins-wien': '1+1-Angebote vergleichen',
  'restaurant-gutscheine-wien': 'Restaurant-Gutscheine',
  'gutscheine-wien': 'Gutscheine in Wien',
  'rabatte-wien': 'Rabatte richtig vergleichen',
  'kostenlose-freizeitangebote-wien': 'Freizeit in Wien',
  'studentenrabatte-wien': 'Vorteile für Studierende',
};

function photoTopics(relative = false) {
  return `<nav class="topic-nav visual-topics" aria-label="Wiener Ratgeber">${discoveryTopics.map(([slug, label, image]) => `<a href="${slug ? `${relative ? '' : '/blog/'}${slug}.html` : '/angebote-wien-heute.html'}">${visualPicture(blogVisual(image), { sizes: '(max-width: 620px) 120px, 180px' })}<span>${escape(label)}</span></a>`).join('')}</nav>`;
}

// Keep the same presentation after future targeted article/feed regeneration.
export function polishVisualDiscovery(html, filename) {
  const home = filename === 'index.html';
  const blog = /^blog\/[^/]+\.html$/.test(filename);
  if (!home && !blog && filename !== 'angebote-wien-heute.html') return html;
  html = html.replace(/\s*<link\b[^>]*href="\/visual-refresh\.css(?:\?[^"]*)?"[^>]*>/g, '');
  html = html.replace('</head>', '  <link rel="stylesheet" href="/visual-refresh.css?v=20261030">\n</head>');
  if (home) {
    const band = `<section class="discovery-band" aria-labelledby="discoveryTitle"><div class="discovery-inner"><div class="discovery-heading"><h2 id="discoveryTitle">Dein Wien. Deine Entdeckungen.</h2><a href="/blog/">Alle Guides</a></div>${photoTopics()}</div></section>`;
    const existing = /<section class="discovery-band"[\s\S]*?<\/section>/;
    if (existing.test(html)) html = html.replace(existing, band);
    else html = html.replace(/<section class="section app-section"/, `${band}\n      <section class="section app-section"`);
    html = html.replace(/<a\b[^>]*class="deal-card has-photo"[\s\S]*?<\/a>/g, fragment => {
      const $ = load(fragment);
      const href = $('a').attr('href') || '';
      const slug = href.includes('ganesha') ? 'ganesha-10-euro-gutschein-50-euro-wien'
        : href.includes('#1080') ? 'cafe-hummel-kaffee-250-wien'
        : href.includes('geburtstag') ? 'haikky-eroeffnung-gratis-essen-wien-1-november' : '';
      const picture = $('picture.deal-thumb');
      if (!slug || !picture.length) return fragment;
      return fragment.replace($.html(picture), visualPicture(blogVisual(slug), { sizes: '(max-width: 620px) 110px, 130px' }).replace('<picture>', '<picture class="deal-thumb">'));
    });
  } else if (filename === 'blog/index.html') {
    html = html.replace(/<nav class="topic-nav(?: visual-topics)?" aria-label="Wiener Ratgeber">[\s\S]*?<\/nav>/, photoTopics(true));
  } else if (blog) {
    const $ = load(html);
    if (!$('.article-body').length || !$('.article-layout').length) return html;
    const own = filename.slice(5, -5);
    const linked = $('.related-links a[href]').toArray().map(a => ($(a).attr('href') || '').split('/').pop().replace(/\.html$/, ''));
    const slugs = [...new Set([...linked, 'guenstig-essen-wien', 'geburtstag-gratis-wien', 'kinodonnerstag-wien-drei', 'gratis-kaffee-wien'])]
      .filter(slug => slug !== own && Object.hasOwn(discoveryGuides, slug)).slice(0, 3);
    const section = `<section class="article-discovery" aria-labelledby="moreViennaTitle"><h2 id="moreViennaTitle">Mehr für deinen Wien-Tag.</h2><div class="discovery-guides">${slugs.map(slug => `<a class="discovery-guide" href="/blog/${slug}.html">${visualPicture(blogVisual(slug))}<span>${escape(discoveryGuides[slug])}</span></a>`).join('')}</div></section>`;
    const existing = /<section class="article-discovery"[\s\S]*?<\/section>/;
    html = existing.test(html) ? html.replace(existing, section) : html.replace('</main>', `${section}\n  </main>`);
  }
  return html;
}

export function polishBlogVisuals(html, filename) {
  if (!/^blog\/[^/]+\.html$/.test(filename)) return html;
  html = html.replace(/(<link\b[^>]*href="(?:\/blog\/)?blog\.css)(?:\?[^"]*)?"/g, '$1?v=20261027-photos"');
  const $ = load(html);
  const slug = filename.slice(5, -5);
  const hero = $('.article-image, .article-cover img').first();
  const visual = blogVisual(slug === 'index' ? 'wien-guides' : slug, $('meta[property="og:image"]').attr('content') || hero.attr('src'));
  if (!visual) return html;
  const social = `https://freefinder.at${visual.src}`;
  // Replace the complete picture, including AVIF sources, not just its fallback img.
  if (hero.length) {
    const element = hero.parent().is('picture') ? hero.parent() : hero;
    html = html.replace($.html(element), visualPicture(visual, { article: hero.hasClass('article-image'), eager: true }));
  }
  const metadata = { 'og:image': social, 'og:image:secure_url': social, 'og:image:type': 'image/jpeg',
    'og:image:width': '1200', 'og:image:height': '630', 'og:image:alt': visual.alt, 'twitter:image': social, 'twitter:image:alt': visual.alt };
  const seen = new Set();
  html = html.replace(/<meta\b[^>]*>/g, tag => {
    const meta = load(tag)('meta');
    const name = meta.attr('property') || meta.attr('name');
    if (!Object.hasOwn(metadata, name)) return tag;
    seen.add(name);
    return `<meta ${name.startsWith('twitter:') ? 'name' : 'property'}="${name}" content="${escape(metadata[name])}">`;
  });
  const additions = Object.entries(metadata).filter(([name]) => !seen.has(name)).map(([name, value]) =>
    `  <meta ${name.startsWith('twitter:') ? 'name' : 'property'}="${name}" content="${escape(value)}">`).join('\n');
  if (additions) html = html.replace('</head>', `${additions}\n</head>`);
  html = html.replace(/(<script\b[^>]*type="application\/ld\+json"[^>]*>)([\s\S]*?)(<\/script>)/g, (whole, start, text, end) => {
    const data = JSON.parse(text);
    let changed = false;
    const visit = item => {
      if (!item || typeof item !== 'object') return;
      if (['Article', 'BlogPosting'].some(type => [].concat(item['@type'] || []).includes(type)) && item.image !== social) {
        item.image = social; changed = true;
      }
      Object.values(item).forEach(value => { if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') visit(value); });
    };
    visit(data);
    return changed ? `${start}${JSON.stringify(data).replace(/</g, '\\u003c')}${end}` : whole;
  });
  return html;
}

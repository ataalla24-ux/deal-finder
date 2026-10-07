import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { load } from 'cheerio';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docs = path.join(root, 'docs');
const origin = 'https://freefinder.at';
const files = fs.readdirSync(docs, { recursive: true }).filter(file => file.endsWith('.html')).sort();
const pages = new Map(files.map(file => [file, load(fs.readFileSync(path.join(docs, file), 'utf8'))]));
const errors = [];
const warnings = [];
const indexed = [];
const titles = new Map();
const descriptions = new Map();
const externals = new Set();
const internalInbound = new Map();
const sitemap = load(fs.readFileSync(path.join(docs, 'sitemap.xml'), 'utf8'), { xmlMode: true });
const sitemapUrls = new Set(sitemap('loc').map((_, element) => sitemap(element).text()).get());
const report = (list, file, kind, detail) => list.push({ file, kind, detail });
const canonicalFor = file => origin + '/' + file.replace(/(^|\/)index\.html$/, '$1');
const text = value => String(value).replace(/\s+/g, ' ').trim();

for (const [file, $] of pages) {
  const url = canonicalFor(file);
  const robots = $('meta[name="robots"]').attr('content') || '';
  const indexable = !/noindex/i.test(robots);
  if (indexable) {
    indexed.push(file);
    const title = text($('title').text());
    const description = $('meta[name="description"]').attr('content') || '';
    if (!title) report(errors, file, 'missing-title', 'No title');
    if (!description) report(errors, file, 'missing-description', 'No description');
    if ($('h1').length !== 1) report(errors, file, 'h1', $('h1').length);
    if ($('link[rel="canonical"]').attr('href') !== url) report(errors, file, 'canonical', $('link[rel="canonical"]').attr('href'));
    if (!sitemapUrls.has(url)) report(errors, file, 'missing-sitemap', url);
    if (title.length > 75) report(warnings, file, 'long-title', title);
    if (description.length > 165) report(warnings, file, 'long-description', description);
    if (!/^de(?:-AT)?$/i.test($('html').attr('lang') || '')) report(errors, file, 'language', $('html').attr('lang'));
    for (const [map, value, kind] of [[titles, title, 'duplicate-title'], [descriptions, description, 'duplicate-description']]) {
      if (map.has(value)) report(errors, file, kind, map.get(value));
      else map.set(value, file);
    }
    for (const name of ['og:title', 'og:description', 'og:image', 'og:url']) {
      if (!$(`meta[property="${name}"]`).attr('content')) report(warnings, file, 'social-metadata', name);
    }
  } else if (sitemapUrls.has(url)) report(errors, file, 'noindex-in-sitemap', url);

  const ids = new Set();
  $('[id]').each((_, element) => {
    const id = $(element).attr('id');
    if (ids.has(id)) report(errors, file, 'duplicate-id', id);
    ids.add(id);
  });
  $('script:not([src])').each((_, element) => {
    const script = $(element).text();
    if (!script.trim()) return;
    try {
      if ($(element).attr('type') === 'application/ld+json') {
        const data = JSON.parse(script);
        const graph = data['@graph'] || [data];
        const body = text($('body').text());
        for (const item of graph.filter(item => item['@type'] === 'FAQPage')) {
          for (const faq of item.mainEntity || []) {
            if (!body.includes(text(faq.name)) || !body.includes(text(faq.acceptedAnswer?.text))) report(warnings, file, 'faq-not-visible', faq.name);
          }
        }
      } else if (!$(element).attr('type') || /^(?:application|text)\/javascript$/.test($(element).attr('type'))) new vm.Script(script, { filename: file });
    } catch (error) { report(errors, file, 'script-syntax', error.message); }
  });

  $('a[href], link[href], img[src], script[src], source[srcset]').each((_, element) => {
    const attribute = $(element).attr('href') ?? $(element).attr('src') ?? $(element).attr('srcset');
    const values = $(element).attr('srcset') ? attribute.split(',').map(candidate => candidate.trim().split(/\s+/)[0]) : [attribute];
    for (const value of values) {
      if (/^(?:mailto:|tel:|data:|freefinder:|javascript:)/i.test(value)) continue;
      let target;
      try { target = new URL(value, url); } catch { report(errors, file, 'invalid-url', value); continue; }
      if (target.origin !== origin) {
        if (element.name === 'a' && /^https?:$/.test(target.protocol)) externals.add(target.href);
        if (target.protocol === 'http:') report(warnings, file, 'insecure-url', value);
        continue;
      }
      const filename = decodeURIComponent(target.pathname).replace(/^\//, '') + (target.pathname.endsWith('/') ? 'index.html' : '');
      if (!fs.existsSync(path.join(docs, filename))) report(errors, file, 'missing-local-target', value);
      else if (target.hash && pages.has(filename) && !pages.get(filename)(`[id="${decodeURIComponent(target.hash.slice(1))}"]`).length) report(errors, file, 'missing-anchor', value);
      if (element.name === 'a' && filename !== file && indexable) internalInbound.set(filename, (internalInbound.get(filename) || 0) + 1);
    }
  });
  $('img').each((_, element) => {
    if ($(element).attr('alt') === undefined) report(errors, file, 'image-alt', $(element).attr('src'));
    if (!$(element).attr('width') || !$(element).attr('height')) report(warnings, file, 'image-dimensions', $(element).attr('src'));
  });
}
for (const url of sitemapUrls) {
  const file = new URL(url).pathname.replace(/^\//, '') + (url.endsWith('/') ? 'index.html' : '');
  if (!pages.has(file)) report(errors, 'sitemap.xml', 'missing-page', url);
}
for (const file of indexed) if (file !== 'index.html' && !internalInbound.get(file)) report(warnings, file, 'orphan-page', 'No inbound link from an indexable page');
const result = { htmlPages: files.length, indexablePages: indexed.length, errors, warnings, externalUrls: [...externals].sort() };
if (process.argv.includes('--external')) {
  result.externalChecks = [];
  const queue = [...externals];
  // Bounded read-only requests: a restricted provider is not proof of an expired deal.
  async function checkNext() {
    while (queue.length) {
      const url = queue.shift();
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'FreeFinderWebsiteLinkAudit/1.0' } });
        result.externalChecks.push({ url, status: response.status, finalUrl: response.url });
        await response.body?.cancel();
      } catch (error) { result.externalChecks.push({ url, error: error.message }); }
    }
  }
  await Promise.all(Array.from({ length: 4 }, checkNext));
  result.externalChecks.sort((a, b) => a.url.localeCompare(b.url));
}
const outputIndex = process.argv.indexOf('--output');
if (outputIndex >= 0) {
  const output = path.resolve(process.argv[outputIndex + 1]);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
}
if (process.argv.includes('--summary')) {
  delete result.externalUrls;
  if (result.externalChecks) result.externalChecks = result.externalChecks.filter(item => item.error || item.status >= 400);
}
console.log(JSON.stringify(result, null, 2));
if (errors.length) process.exitCode = 1;

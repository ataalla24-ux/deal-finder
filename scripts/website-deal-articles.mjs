import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { load } from 'cheerio';

// Exact editorial matches. A changed offer, venue or period needs a fresh review.
const reviewed = new Map([
  ['meta-ig-18144789436596678', ['papa-duck-pizza-donnerstag-1plus1-wien', '02111c1dc15cbd5cc878855739e00f3b921fb2259627b102f14e6a212e2aadc9']],
  ['joe-omv-current-5044fa7c7e98-299871f8c80c', ['gratis-omv-kaffee', '485c8b9f23fc319ab0d5d81de989cd6c8c4d09e3d3d48e098a9850d8f62dc96d']],
  ['joe-omv-current-5044fa7c7e98-60064851e04f', ['gratis-omv-kaffee', 'd89a0cee834d2cde6f13b46dc9f4ffe911b19635374917e18bbcdfcc267bd727']],
  ['joe-omv-current-5044fa7c7e98-e11d8dffaa96', ['gratis-omv-kaffee', 'ff7fe482de43eba07ff8287c49e550c13a71d1583c31ef5f3c91611225c7fd3b']],
  ['g2-1gkjf0g', ['ikea-westbahnhof-10-euro-gutschein-restaurant-wien', '69300b6b37be9f991623ada287796fc5f4edc7692175ffc3a7d556d39e458519']],
  ['meta-ig-17957451630296459', ['cios-grill-wien-lieferando-super-deals', 'a27567ea53d343ae2fc7fa8775ff61fe8523294ba8b10bee06d2d907f4931c0c']],
  ['community:06d5f18b-d95f-41f3-9768-86d3c37f5bc8', ['dahab-doener-1plus1-wien', '59dad7e5cfa2459cae88cd5b9a0a3b8e4bbd57de505aa5474ddd3ab04e8a6fd1']],
  ['g2-15kbyb4', ['vapiano-pastalover-1plus1-wien', 'eceeda2fc7a3484348258f9e7f1757d8f5a5186257b854b9973a0d20255d083d']],
  ['meta-ig-18358319731269651', ['hong-kong-cafe-wien-1-euro-lunch', '618d9e3e9465eb4b97d0fa5ff9a6692d85cc3ad0d902454b40bba4f50e99284b']],
  ['fc4g-1r04rhe', ['moemax-restaurant-burger-donut-wien', 'e145c18a8811625fc8f9dd1daf543a48385f8a346d94053871f94f6e88ad262b']],
  ['fc4g-vqsqje', ['ikea-1-euro-fruehstueck-wien', '08d2518894483edd081fe770c9fede1e2b8b325282e427ae0dae85592602d17b']],
  ['g2-1lfynn6', ['lieferando-neu12-12-euro-gutschein-wien', '6cdd7dd9af0a4bd8db387200738b2d31cb8de5dd002a8d09b57bf4c413be98ff']],
  ['meta-ig-18190492012418024', ['abby-smashburger-990-wien-rochusmarkt', '5d8d7ddc548bb146ac31c03c6889a7f53d1e1b8bc3d8cc6d7e04b7b12a758615']],
]);
const fields = ['brand', 'title', 'description', 'url', 'address', 'location', 'distance', 'validOn', 'validFrom', 'validUntil', 'expires', 'expiryKind'];

export function websiteDealArticle(deal, blogDir, now) {
  const match = reviewed.get(deal.id);
  if (!match) return '';
  const [slug, expected] = match;
  const fingerprint = createHash('sha256').update(JSON.stringify(fields.map(key => deal[key] ?? ''))).digest('hex');
  if (fingerprint !== expected) return '';

  const file = path.join(blogDir, `${slug}.html`);
  if (!fs.existsSync(file)) return '';
  const $ = load(fs.readFileSync(file, 'utf8'));
  const href = `/blog/${slug}.html`;
  if ($('link[rel="canonical"]').attr('href') !== `https://freefinder.at${href}`
    || !$('main .article-body').length || $('.deal-is-expired').length
    || /noindex/i.test($('meta[name="robots"]').attr('content') || '')) return '';
  const expiry = $('main').attr('data-deal-expires');
  if (expiry && !(Date.parse(expiry) > now)) return '';
  return href;
}

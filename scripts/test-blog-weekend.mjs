import assert from 'node:assert/strict';
import fs from 'node:fs';
import { load } from 'cheerio';
import { polishHtml } from './polish-website.mjs';

const read = file => fs.readFileSync(new URL(`../docs/${file}`, import.meta.url), 'utf8');
const file = 'blog/gratis-wien-wochenende.html';
const html = read(file);
const $ = load(html);
const canonical = `https://freefinder.at/${file}`;
assert.equal($('link[rel="canonical"]').attr('href'), canonical);
const expiryValue = $('main').attr('data-deal-expires');
assert.match(expiryValue, /^\d{4}-\d{2}-\d{2}T23:59:59\+0[12]:00$/);
const lastDay = new Date(expiryValue);
const viennaClock = new Intl.DateTimeFormat('de-AT', {
  timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
assert.equal(viennaClock.format(lastDay), '23:59:59');
const sunday = new Date(`${expiryValue.slice(0, 10)}T12:00:00Z`);
assert.equal(sunday.getUTCDay(), 0);
const weekendDate = offset => new Date(sunday.getTime() + offset * 86_400_000);
const dateLabel = new Intl.DateTimeFormat('de-AT', { timeZone: 'UTC', day: 'numeric', month: 'long' });
const checked = $('#quelle').next('p').find('time').attr('datetime');
assert.match(checked, /^\d{4}-\d{2}-\d{2}$/);
assert.ok(checked >= weekendDate(-3).toISOString().slice(0, 10) && checked <= expiryValue.slice(0, 10));
const article = JSON.parse($('script[type="application/ld+json"]').first().text())['@graph'].find(node => node['@type'] === 'Article');
assert.equal(article.datePublished, '2026-11-13');
assert.equal(article.dateModified, checked);
for (const [offset, day] of ['freitag', 'samstag', 'sonntag'].entries()) {
  assert.ok($(`#${day}`).text().includes(dateLabel.format(weekendDate(offset - 2))));
  const section = $(`#${day}`).nextUntil('h2');
  assert.match(section.text(), /0 €/);
  assert.match(section.text(), /\b\d{1,2}:\d{2}\b/);
  assert.match(section.text(), /\b1\d{3} Wien\b/);
  assert.ok(section.find('a[href^="https://"]').length);
}
const index = load(read('blog/index.html'));
const card = index('h2 a[href="gratis-wien-wochenende.html"]').closest('.post-card');
assert.equal(card.length, 1);
assert.equal(card.attr('data-topic'), 'freizeit');
assert.equal(card.attr('data-deal-expires'), expiryValue);
const expiry = lastDay.getTime() + 1000;
const archived = load(polishHtml(html, file, expiry));
assert.match(archived('title').text(), /Archiv/);
assert.equal(archived('[data-deal-status-banner][hidden]').length, 0);
const archiveIndex = load(polishHtml(read('blog/index.html'), 'blog/index.html', expiry));
assert.equal(archiveIndex('h2 a[href="gratis-wien-wochenende.html"]').closest('.post-card').attr('data-archive'), 'true');
const sitemap = load(read('sitemap.xml'), { xml: true });
const entry = sitemap('loc').filter((_, loc) => sitemap(loc).text() === canonical).parent();
assert.equal(entry.length, 1);
assert.equal(entry.find('lastmod').text(), checked);

const birthday = load(read('blog/geburtstag-gratis-wien.html'));
assert.equal(birthday('.article-body > h2').first().attr('id'), 'ohne-begleitung');
const solo = birthday('#ohne-begleitung').nextUntil('h2');
assert.equal(solo.find('a[href="#donauturm-ticketkauf"],a[href="#madame-tussauds"]').length, 2);
assert.doesNotMatch(solo.text(), /Watertuin|Starbucks/);
assert.match(birthday('#geburtstag-mit-bedingungen').nextUntil('h2').text(), /Vollpreis.*20 € Rabatt ab 40 €.*Gold-Reward.*13\. November 2026/s);
assert.equal(birthday('[data-birthday-window]').length, 6);
assert.match(birthday('#zu-zweit').next('p').text(), /28\. Oktober 2026/);
console.log('Weekend and birthday guides: dated tips, source links, archive, sitemap and preserved date planner.');

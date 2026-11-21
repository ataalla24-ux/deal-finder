import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { readInstagramProfileTimeline } from '../scraper/instagram-page-access.js';

const url = 'https://www.instagram.com/fixture_merchant/';

test('profile grid waits for rendered merchant links outside main', async t => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  let navigations = 0;
  await page.route('**/*', route => {
    navigations++;
    return route.fulfill({ contentType: 'text/html', body: [
      '<div id="grid"></div><script>setTimeout(() => document.querySelector("#grid").innerHTML = ',
      JSON.stringify('<div role="main"><a href="/fixture_merchant/p/FreshStory01/?igsh=123">Foto</a>'
        + '<a href="/reel/FreshStory02/">Reel</a><a href="/reel/FreshStory02/?igsh=x">Duplikat</a>'
        + '<a hidden href="/p/HiddenPost01/">Versteckt</a>'
        + '<a href="/other_merchant/p/OtherPost01/">Fremd</a>'
        + '<a href="https://instagram.com.example/p/ForeignHost01/">Extern</a></div>'),
      ', 50)</script>',
    ].join('') });
  });
  await page.goto(url);
  assert.deepEqual(await readInstagramProfileTimeline(page, url, 4), {
    status: 'readable',
    urls: ['https://www.instagram.com/p/FreshStory01/', 'https://www.instagram.com/reel/FreshStory02/'],
  });
  assert.equal(navigations, 1);
});

test('a rendered login dialog wins over simultaneously rendered post links', async t => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body:
    '<div role="dialog">Melde dich an, um diesen Beitrag zu sehen.</div><a href="/p/FreshStory01/">Foto</a>' }));
  await page.goto(url);
  assert.deepEqual(await readInstagramProfileTimeline(page, url, 4), { status: 'blocked', urls: [] });
});

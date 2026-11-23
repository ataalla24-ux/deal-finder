import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { readInstagramProfileTimeline, readInstagramPostLinkedDate } from '../scraper/instagram-page-access.js';

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

for (const route of ['/p/FreshStory01/', '/reel/FreshStory01/', '/fixture_merchant/reel/FreshStory01/']) {
  test(`post date follows its own visible permalink inside role=main: ${route}`, async t => {
    const browser = await chromium.launch({ headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    let requests = 0;
    await page.route('**/*', request => {
      requests++;
      return request.fulfill({ contentType: 'text/html', body:
        `<div role="main"><a href="${route}"><time datetime="2026-11-23T09:00:00Z">23. November</time></a></div>` });
    });
    const post = 'https://www.instagram.com' + route;
    await page.goto(post);
    assert.equal(await page.locator('main article time[datetime]').count(), 0, 'old selector cannot read this valid DOM');
    assert.equal(await readInstagramPostLinkedDate(page, post), '2026-11-23T09:00:00Z');
    assert.equal(requests, 1, 'extraction must not navigate or fetch again');
  });
}

test('comment, recommendation, hidden and unbound timestamps cannot become the post date', async t => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const post = 'https://www.instagram.com/reel/FreshStory01/';
  await page.route('**/*', request => request.fulfill({ contentType: 'text/html', body:
    '<div role="main">' +
    '<time datetime="2026-11-23T09:00:00Z">Unbound</time>' +
    '<a href="/reel/OtherStory02/"><time datetime="2026-11-23T09:00:00Z">Recommendation</time></a>' +
    '<a href="/reel/FreshStory01/c/Comment01/"><time datetime="2026-11-23T09:00:00Z">Comment</time></a>' +
    '<a hidden href="/reel/FreshStory01/"><time datetime="2026-11-23T09:00:00Z">Hidden</time></a>' +
    '<a style="display:none" href="/reel/FreshStory01/"><time datetime="2026-11-23T09:00:00Z">Hidden CSS</time></a>' +
    '<a href="https://instagram.com.example/reel/FreshStory01/"><time datetime="2026-11-23T09:00:00Z">Foreign origin</time></a>' +
    '</div>' }));
  await page.goto(post);
  assert.equal(await readInstagramPostLinkedDate(page, post), '');
});

test('contradictory own-link dates and another final post stay unconfirmed', async t => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const post = 'https://www.instagram.com/p/FreshStory01/';
  await page.route('**/*', request => request.fulfill({ contentType: 'text/html', body:
    '<main><a href="/p/FreshStory01/"><time datetime="2026-11-22T09:00:00Z">First</time>' +
    '<time datetime="2026-11-23T09:00:00Z">Conflicting</time></a></main>' }));
  await page.goto(post);
  assert.equal(await readInstagramPostLinkedDate(page, post), '');
  assert.equal(await readInstagramPostLinkedDate(page, 'https://www.instagram.com/p/OtherStory02/'), '');
});

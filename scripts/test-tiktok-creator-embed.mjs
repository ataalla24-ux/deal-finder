import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { discoverPublicTikTokCreatorLinks } from '../scraper/tiktok-creator-embed.js';

const showProfile = '<a href="/@eatinvienna?refer=embed">Creator</a>';
const realCard = '<a href="/@eatinvienna/video/12345678901?tracking=x">Video</a>';
const framePath = '/embed/@eatinvienna';
async function fixture(html, { status = 200, headers = {}, pause = '' } = {}) {
  const browser = await chromium.launch();
  const calls = [];
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      calls.push(url.pathname);
      if (url.origin !== 'https://www.tiktok.com') return route.abort();
      if (url.pathname === '/embed.js') return route.fulfill({ contentType: 'application/javascript',
        body: 'document.querySelector("blockquote").innerHTML=' + JSON.stringify('<iframe src="https://www.tiktok.com' + framePath + '"></iframe>') });
      if (url.pathname === framePath) return route.fulfill({ status, headers, contentType: 'text/html', body: html });
      return route.abort();
    });
    const page = await context.newPage();
    const result = await discoverPublicTikTokCreatorLinks(page, 'eatinvienna', { timeoutMs: 1050, nextRetryAt: pause });
    return { result, calls };
  } finally { await browser.close(); }
}

test('the genuine widget yields only exact visible creator video cards and deduplicates tracking parameters', async () => {
  const { result, calls } = await fixture(showProfile + realCard + realCard
    + '<a hidden href="/@eatinvienna/video/555555555">hidden</a><a href="/@someone.else/video/666666666">other</a>'
    + '<a href="https://evil.invalid/@eatinvienna/video/777777777">external</a>'
    + '<a href="/@eatinvienna/video/999999999/edit">wrong path</a>');
  assert.deepEqual(calls, ['/embed.js', framePath]);
  assert.equal(result.frameSeen, true);
  assert.equal(result.frameRoute, '/embed/@creator');
  assert.equal(result.profileLinkSeen, true);
  assert.deepEqual(result.links, ['https://www.tiktok.com/@eatinvienna/video/12345678901']);
  assert.equal(result.stop, null);
});

test('a mismatched profile, access wall, provider delay or prior cooldown never supplies a post', async () => {
  const nextRetryAt = new Date(Date.now() + 3600000).toISOString();
  for (const [html, options, reason] of [
    ['<a href="/@different">profile</a>' + realCard, {}, null],
    ['<div role="dialog">Log in to TikTok</div>' + showProfile + realCard, {}, 'login-dialog'],
    ['<main>This account is private</main>' + showProfile + realCard, {}, 'private'],
    [showProfile + realCard, { status: 429, headers: { 'Retry-After': '3600' } }, 'provider-refusal'],
    [showProfile + realCard, { pause: nextRetryAt }, 'cooldown'],
  ]) {
    const { result, calls } = await fixture(html, options);
    assert.deepEqual(result.links, []);
    assert.equal(result.stop?.reason || null, reason);
    if (reason === 'provider-refusal') assert.ok(Date.parse(result.stop.nextRetryAt) > Date.now());
    if (reason === 'cooldown') assert.deepEqual(calls, []);
  }
});

test('card metadata belongs to the linked original, while off-card times and other VideoObjects are ignored', async () => {
  const url = 'https://www.tiktok.com/@eatinvienna/video/12345678901';
  const structured = { '@graph': [
    { '@type': 'VideoObject', url, description: 'Ein Café in Wien', uploadDate: '2026-11-21T12:00:00Z' },
    { '@type': 'VideoObject', url: url.replace('12345678901', '33333333333'), uploadDate: '2026-11-23T01:00:00Z' },
  ] };
  const { result } = await fixture(showProfile + '<time datetime="2022-01-01">Outside card</time><figure>' + realCard
    + '<figcaption>Wiener Kaffee mit Kuchen</figcaption><time datetime="2026-11-21">21 November</time></figure>'
    + '<script type="application/ld+json">' + JSON.stringify(structured) + '</script>');
  assert.deepEqual(result.cards, [{ url, accessibleCaptionFields: ['figcaption'], timeDatetime: '2026-11-21',
    videoObjectCaption: true, videoObjectDate: '2026-11-21T12:00:00Z' }]);
});

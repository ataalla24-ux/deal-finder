import assert from 'node:assert/strict';
import test from 'node:test';
import { ORIGINAL, ORIGINAL_DATE, captureOriginalVideo, inspectOriginalVideo, validateOriginalReceipt } from './check-instagram-filter-original-video.mjs';

const now = new Date('2026-11-28T09:00:00Z');
const cookies = [{ name: 'sessionid', value: 'offline-test-session', domain: '.instagram.com' }];
const row = { url: ORIGINAL, status: 'captured', httpStatus: 200, sourcePublishedAt: ORIGINAL_DATE,
  sourcePublishedAtSource: 'instagram-rendered-time-datetime',
  caption: '314 likes, 10 comments - satansbratan am November 25, 2026' };
const receipt = { browserNavigations: 3, tavilySearches: 0, modelCalls: 0, publishedDeals: 0, rows: [row] };
const defaultProof = { wall: {}, caption: 'Original caption', video: true, duration: 24 };

function fixture(options = {}) {
  const reads = [], frames = [], writes = [];
  let closed = 0;
  const page = { location: ORIGINAL, url() { return this.location; } };
  const browserType = { async launch() {
    return {
      async newContext() { return { async addCookies() {}, async newPage() { return page; } }; },
      async close() { closed++; },
    };
  } };
  const result = captureOriginalVideo({
    cookies, clock: () => now, browserType,
    fetchRendered: async (_page, url) => {
      reads.push(url);
      return { status: 200, finalUrl: url, captionEvidence: 'open-graph-header-only', bodyText: 'Gratis Burgermenü in Wien, 1080 unrelated account UI' };
    },
    readLinkedDate: async () => ORIGINAL_DATE,
    inspect: async () => defaultProof,
    frame: async (_page, seconds, seek) => {
      frames.push({ seconds, seek });
      return { image: Buffer.from('offline image stub'), actual: seconds };
    },
    saveFrame: async file => writes.push(file),
    ...options,
  });
  return { result, reads, frames, writes, page, get closed() { return closed; } };
}

test('only the exact completed metadata-only public receipt can claim the follow-up', () => {
  assert.doesNotThrow(() => validateOriginalReceipt(receipt));
  for (const replacement of [{ ...row, httpStatus: 403 }, { ...row, caption: 'An actual caption' },
    { ...row, sourcePublishedAt: '2026-11-26T13:51:32.000Z' }]) {
    assert.throws(() => validateOriginalReceipt({ ...receipt, rows: [replacement] }), /Exact audited metadata-only/);
  }
});

test('one original with exact original date and visible caption yields at most three cropped positions', async () => {
  const check = fixture();
  const { report } = await check.result;
  assert.deepEqual(check.reads, [ORIGINAL]);
  assert.deepEqual(check.frames, [{ seconds: 0, seek: false }, { seconds: 12, seek: true }, { seconds: 21.6, seek: true }]);
  assert.deepEqual(check.writes, ['frame-1.jpg', 'frame-2.jpg', 'frame-3.jpg']);
  assert.equal(report.status, 'captured');
  assert.equal(report.browserNavigations, 1);
  assert.equal(report.sourcePublishedAt, ORIGINAL_DATE);
  assert.equal(report.videoDurationSeconds, 24);
  assert.equal(report.caption, 'Original caption');
  assert.deepEqual(report.productionTextCheck, { captionEvidence: 'open-graph-header-only', accepted: false,
    reason: 'Originalbeschreibung des Instagram-Posts nicht lesbar', score: report.productionTextCheck.score, sourcePublishedAt: ORIGINAL_DATE });
  assert.equal(Number.isFinite(report.productionTextCheck.score), true);
  assert.equal(report.modelCalls + report.tavilySearches + report.publishedDeals, 0);
  assert.doesNotMatch(JSON.stringify(report), /unrelated account UI|offline-test-session/);
  assert.equal(check.closed, 1);
});

test('only an exact production caption can supplement unavailable visible caption evidence', async () => {
  const description = 'Comedy von satansbratan';
  const checkPreview = captionEvidence => fixture({
    fetchRendered: async () => ({ status: 200, finalUrl: ORIGINAL, description, captionEvidence }),
    inspect: async () => ({ wall: {}, caption: '', captionReason: 'unavailable', video: false }),
  }).result;
  const exact = (await checkPreview('exact-original-caption')).report;
  assert.equal(exact.status, 'captured');
  assert.equal(exact.caption, description);
  assert.equal(exact.captionEvidence, 'exact-original-caption');
  assert.equal((await checkPreview('preview-caption')).report.caption, undefined);
});

test('existing hold or unavailable session prevents all browser navigation', async () => {
  const nextRetryAt = new Date(+now + 3600_000).toISOString();
  const check = fixture({ previousReport: { webAccess: { all: { reason: 'http-429', nextRetryAt } } } });
  const { report } = await check.result;
  assert.deepEqual(check.reads, []);
  assert.equal(report.reason, 'web-access-cooldown');
  assert.equal(report.nextRetryAt, nextRetryAt);
  assert.equal((await fixture({ cookies: [] }).result).report.browserNavigations, 0);
});

test('provider wait is preserved and frames never start after refusal', async () => {
  const check = fixture({ fetchRendered: async () => ({ status: 429, retryAfter: '36000' }) });
  const { report, accessChanges } = await check.result;
  assert.equal(report.browserNavigations, 1);
  assert.equal(report.status, 'blocked');
  assert.equal(accessChanges.all.nextRetryAt, new Date(+now + 36000_000).toISOString());
  assert.deepEqual(check.writes, []);
});

test('unbound clock or changed page fails closed before saving visual evidence', async () => {
  const inconsistent = fixture({ readLinkedDate: async () => '2026-11-26T13:51:32Z' });
  assert.equal((await inconsistent.result).report.reason, 'original-linked-clock-unproven');
  assert.deepEqual(inconsistent.writes, []);
  const moved = fixture({ frame: async page => {
    page.location = 'https://www.instagram.com/reel/foreign/';
    return { actual: 0, image: Buffer.from('foreign') };
  } });
  assert.equal((await moved.result).report.reason, 'rendered-original-changed');
  assert.deepEqual(moved.writes, []);
});

test('DOM proof excludes comment headings and adjacent videos even with normal player controls', async () => {
  const fake = (props = {}) => ({ checkVisibility: () => true, closest: () => null, ...props });
  const attributes = new Set();
  const video = fake({ currentTime: 0, duration: 22, getBoundingClientRect: () => ({
    width: 400, height: 600, top: 30, right: 500, bottom: 630, left: 100,
  }), setAttribute: name => attributes.add(name), removeAttribute: name => attributes.delete(name) });
  const goodAuthor = fake({ href: 'https://www.instagram.com/satansbratan/' });
  const caption = fake({ innerText: 'User-facing original caption', matches: () => false, closest(selector) {
    if (selector === 'article, [role="article"]') return article;
    if (selector === 'li, [role="listitem"]') return { querySelectorAll: () => [goodAuthor] };
    return null;
  } });
  const comment = fake({ ...caption, innerText: 'Comment promoted as a false deal', closest(selector) {
    return selector.startsWith('nav,') ? {} : caption.closest(selector);
  } });
  let insideArticle = true;
  const article = { querySelectorAll: () => [comment, caption], contains: node => insideArticle && node === video };
  const main = { innerText: 'Main unrelated content', contains: node => node === video };
  const time = fake({ dateTime: ORIGINAL_DATE, closest(selector) {
    if (selector === 'a[href]') return { href: ORIGINAL };
    if (selector === 'main, [role="main"]') return main;
    if (selector === 'article, [role="article"]') return article;
    return null;
  } });
  const globals = Object.fromEntries(['document', 'location', 'innerWidth', 'innerHeight'].map(key => [key, globalThis[key]]));
  let videos = [video];
  Object.assign(globalThis, {
    location: { href: ORIGINAL }, innerWidth: 1366, innerHeight: 900,
    document: { querySelector(selector) { return selector.includes('canonical') ? { href: ORIGINAL } : null; },
      querySelectorAll(selector) {
        if (selector.startsWith('main time')) return [time];
        if (selector === 'video') return videos;
        if (selector === '[data-freefinder-original-proof]' && attributes.size) return [video];
        return [];
      },
      elementFromPoint: () => fake({ tagName: "BUTTON" }),
    },
  });
  try {
    const page = { async evaluate(fn, args) { return fn(args); } };
    const proof = await inspectOriginalVideo(page);
    assert.equal(proof.caption, 'User-facing original caption');
    assert.equal(proof.video, true);
    assert.equal(attributes.size, 1);
    videos = [video, fake({ ...video })];
    const ambiguous = await inspectOriginalVideo(page);
    assert.equal(ambiguous.video, false);
    assert.equal(attributes.size, 0);
    videos = [video];
    insideArticle = false;
    assert.equal((await inspectOriginalVideo(page)).video, false);
  } finally { Object.assign(globalThis, globals); }
});

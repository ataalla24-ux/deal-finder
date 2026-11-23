import { tikTokAccessRefusal } from './tiktok-browser-search.js';
import { tikTokRetryAt } from './tiktok-search-discovery.js';
import { retryAfterAt } from './source-http-policy.js';

const ORIGIN = 'https://www.tiktok.com';
const VIDEO_PATH = /^\/@([a-z0-9._-]{2,40})\/video\/(\d{8,30})\/?$/i;
const SEARCH_PATH = /^\/search\/?$/;
const SEARCH_RESULT_PATH = /^\/api\/search\/(?:general|item)\/full\/?$/;
const MAX_QUERIES = 8;
const MAX_POSTS = 20;
const REQUEST_SPACING_MS = 1500;

function tiktokUrl(value) {
  try {
    const url = new URL(value);
    if (url.origin === ORIGIN && !url.username && !url.password) return url;
  } catch { /* An unrecognized page URL is not evidence. */ }
  return null;
}

function visibleAccountNavigation() {
  const visible = element => element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  const textOf = element => (element.getAttribute('aria-label') || element.textContent || '').trim();
  const loginText = /^(?:anmelden|bei tiktok anmelden|log in|log in to tiktok)$/i;
  const navigation = 'nav, aside, header, [role="navigation"], [role="banner"]';
  const profileNavigation = 'a[data-e2e="nav-profile"]';
  const controls = [...document.querySelectorAll('a, button, [role="button"], [role="link"]')]
    .filter(element => visible(element) && (element.closest(navigation) || element.matches(profileNavigation)));
  if (controls.some(element => loginText.test(textOf(element)))
      || [...document.querySelectorAll('h1,h2,[role="heading"],[role="dialog"]')]
        .some(element => visible(element) && loginText.test(textOf(element)))
      || [...document.querySelectorAll('[data-e2e="top-login-button"]')].some(visible)) return false;

  const ownProfileLink = controls.some(element => {
    if (!/^(?:profil|mein profil|profile|my profile|your profile)$/i.test(textOf(element))) return false;
    try {
      const url = new URL(element.getAttribute('href'), location.href);
      return url.origin === location.origin && /^\/@[a-z0-9._-]{2,40}\/?$/i.test(url.pathname);
    } catch { return false; }
  });
  const accountAvatar = [...document.querySelectorAll('[data-e2e="profile-icon"], [data-e2e="top-avatar"]')]
    .some(element => visible(element) && element.closest(navigation));
  return ownProfileLink || accountAvatar;
}

export async function detectSignedInTikTok(page) {
  try {
    if (!tiktokUrl(page.url()) || await tikTokAccessRefusal(page)) return false;
    return await page.evaluate(visibleAccountNavigation);
  } catch { return false; }
}

async function visibleVideoLinks(page, keyword, limit, timeoutMs) {
  // Poll the existing document for hydrated cards before reading it. No scroll,
  // private endpoint request or subsequent page navigation is needed here.
  await page.waitForFunction(({ keyword, videoSource }) => {
    const url = new URL(location.href);
    if (url.searchParams.get('q') !== keyword) return false;
    const videoPath = new RegExp(videoSource, 'i');
    return [...document.querySelectorAll('main a[href], [role="main"] a[href]')].some(link => {
      try {
        const target = new URL(link.href);
        return target.origin === location.origin && videoPath.test(target.pathname)
          && link.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
      } catch { return false; }
    });
  }, { keyword, videoSource: VIDEO_PATH.source }, { timeout: timeoutMs }).catch(() => {});
  return page.evaluate(({ origin, keyword, limit, videoSource }) => {
    const pageUrl = new URL(location.href);
    const queries = pageUrl.searchParams.getAll('q');
    if (pageUrl.origin !== origin || !/^\/search\/?$/.test(pageUrl.pathname)
        || queries.length !== 1 || queries[0] !== keyword) return [];
    const byId = new Map();
    const videoPath = new RegExp(videoSource, 'i');
    for (const link of document.querySelectorAll('main a[href], [role="main"] a[href]')) {
      if (!link.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      let url;
      try { url = new URL(link.href); } catch { continue; }
      if (url.origin !== origin || url.username || url.password) continue;
      const match = url.pathname.match(videoPath);
      if (match && !byId.has(match[2])) byId.set(match[2], origin + '/@' + match[1] + '/video/' + match[2]);
      if (byId.size === limit) break;
    }
    return [...byId.values()];
  }, { origin: ORIGIN, keyword, limit, videoSource: VIDEO_PATH.source });
}

async function readOriginal(page, url) {
  const expected = tiktokUrl(url);
  const identity = expected?.pathname.match(VIDEO_PATH);
  const actual = tiktokUrl(page.url());
  if (!identity || actual?.pathname.replace(/\/$/, '') !== expected.pathname) return null;
  const item = await page.evaluate(({ origin, path, handle, id }) => {
    if (location.origin !== origin || location.pathname.replace(/\/$/, '') !== path) return null;
    const read = name => {
      const text = document.getElementById(name)?.textContent;
      if (!text || text.length > 2_500_000) return null;
      try { return JSON.parse(text); } catch { return null; }
    };
    const details = read('__UNIVERSAL_DATA_FOR_REHYDRATION__')?.__DEFAULT_SCOPE__?.['webapp.video-detail'];
    if (details?.statusCode != null && Number(details.statusCode) !== 0) return null;
    const select = item => {
      const owner = typeof item?.author === 'string' ? item.author : item?.author?.uniqueId;
      return typeof item?.id === 'string' && item.id === id && typeof owner === 'string'
        && owner.toLowerCase() === handle.toLowerCase();
    };
    const records = [details?.itemInfo?.itemStruct, read('SIGI_STATE')?.ItemModule?.[id]].filter(select);
    const restricted = item => {
      const flag = value => value === true || value === 'true' || value === 1;
      const itemFlags = ['privateItem', 'isPrivate', 'secret', 'friendOnly', 'friendsOnly',
        'isFriendsOnly', 'followersOnly', 'followerOnly', 'isFollowersOnly', 'onlyFriends'];
      const authorFlags = ['privateAccount', 'isPrivate', 'secret'];
      return itemFlags.some(key => flag(item[key])) || authorFlags.some(key => flag(item.author?.[key]))
        || (item.privacyLevel != null && item.privacyLevel !== 'PUBLIC_TO_EVERYONE');
    };
    if (records.some(restricted)) return null;
    const post = records.find(item => item.privateItem === false || item.privacyLevel === 'PUBLIC_TO_EVERYONE');
    if (!post || typeof post.desc !== 'string' || !post.desc.trim() || post.desc.length > 12_000) return null;
    return { caption: post.desc, createTime: post.createTime };
  }, { origin: ORIGIN, path: expected.pathname, handle: identity[1], id: identity[2] });
  if (!item) return null;
  const raw = String(item.createTime ?? '');
  const milliseconds = /^\d{10}$/.test(raw) ? Number(raw) * 1000 : /^\d{13}$/.test(raw) ? Number(raw) : NaN;
  const createTime = Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
  return { url, caption: item.caption, createTime };
}

function boundedCount(value, fallback, cap) {
  return Number.isSafeInteger(value) ? Math.min(cap, Math.max(0, value)) : fallback;
}

function interleaveOriginals(searchResults, limit) {
  const selected = [];
  const seen = new Set();
  const maxRank = Math.max(0, ...searchResults.map(urls => urls.length));
  for (let rank = 0; rank < maxRank; rank++) {
    for (const urls of searchResults) {
      const url = urls[rank];
      if (!url) continue;
      const id = url.split('/').at(-1);
      if (seen.has(id)) continue;
      seen.add(id);
      selected.push(url);
      if (selected.length === limit) return selected;
    }
  }
  return selected;
}

function accessStop(stage, reason, status, rawRetryAfter, now) {
  const retryAfter = retryAfterAt(rawRetryAfter, now);
  return {
    stage, reason, status,
    ...(retryAfter && { retryAfter }),
    nextRetryAt: tikTokRetryAt(rawRetryAfter, now),
  };
}

function watchBrowserRefusals(page, clock) {
  let refusal = null;
  const pending = new Set();
  const observe = response => {
    const url = tiktokUrl(response.url());
    if (!url || !(SEARCH_RESULT_PATH.test(url.pathname) || SEARCH_PATH.test(url.pathname))) return;
    const status = response.status();
    const noticed = clock();
    const check = Promise.resolve().then(async () => {
      const retryAfter = await response.headerValue('retry-after');
      if (retryAfter === null && ![401, 403, 429, 451].includes(status)) return;
      const reason = SEARCH_PATH.test(url.pathname) ? 'document-http-error' : 'search-response-refused';
      const failure = accessStop('search', reason, status, retryAfter, noticed);
      if (!refusal || failure.nextRetryAt > refusal.nextRetryAt) refusal = failure;
    }).catch(() => {
      if ([401, 403, 429, 451].includes(status)) {
        refusal ||= accessStop('search', 'search-response-refused', status, null, noticed);
      }
    });
    pending.add(check);
    void check.finally(() => pending.delete(check));
  };
  page.on('response', observe);
  return {
    async current() {
      await Promise.all(pending);
      return refusal;
    },
    close() { page.off('response', observe); },
  };
}

export async function collectTikTokBrowserEvidence(page, {
  keywords = [], maxQueries = 1, maxPosts = 3, nextRetryAt = '', timeoutMs = 12000, settleMs = 700,
  now, clock = () => now || new Date(),
} = {}) {
  const result = { posts: [], queryCount: 0, videoCount: 0, errors: [], stop: null };
  const stop = failure => {
    result.errors.push(failure);
    result.stop = failure;
    return result;
  };
  if (Date.parse(nextRetryAt) > +clock()) return stop({
    stage: 'before-navigation', reason: 'cooldown', nextRetryAt,
  });
  const selected = [...new Set(keywords.filter(term => typeof term === 'string').map(term => term.trim())
    .filter(term => term && term.length <= 160))].slice(0, boundedCount(maxQueries, 1, MAX_QUERIES));
  const limit = boundedCount(maxPosts, 3, MAX_POSTS);
  if (!selected.length || !limit) return result;
  const timeout = boundedCount(timeoutMs, 12000, 15000) || 1;
  const pause = boundedCount(settleMs, 700, 2000);
  const searchResults = [];
  const monitor = watchBrowserRefusals(page, clock);
  let stage = 'session';

  async function navigate(url) {
    if (result.queryCount + result.videoCount) await page.waitForTimeout(REQUEST_SPACING_MS);
    const before = await monitor.current();
    if (before) return before;
    if (stage === 'video') result.videoCount++;
    const document = await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    const retryAfter = document ? await document.headerValue('retry-after') : null;
    if (document && (!document.ok() || retryAfter !== null)) {
      return accessStop(stage, 'document-http-error', document.status(), retryAfter, clock());
    }
    if (pause) await page.waitForTimeout(pause);
    return pageRefusal(document);
  }

  async function pageRefusal(document) {
    const response = await monitor.current();
    if (response) return response;
    if (!tiktokUrl(page.url())) return { stage, reason: 'unexpected-origin' };
    const refusal = await tikTokAccessRefusal(page, document);
    if (!refusal) return null;
    if (refusal.transportReason === 'login-wall') return { stage, reason: 'login-wall', status: refusal.status };
    return accessStop(stage, refusal.transportReason, refusal.status, refusal.retryAfter, clock());
  }

  async function waitForAccount() {
    await page.waitForFunction(visibleAccountNavigation, undefined, { timeout: Math.min(timeout, 5000) }).catch(() => {});
    return await page.evaluate(visibleAccountNavigation);
  }

  async function searchFromPage(keyword) {
    await page.waitForTimeout(REQUEST_SPACING_MS);
    const before = await pageRefusal();
    if (before) return before;
    const ready = await waitForAccount();
    const after = await pageRefusal();
    if (after) return after;
    if (!ready) return { stage, reason: 'session-unverified' };
    const searchbox = page.getByRole('searchbox', { name: /^(?:suchen|search)$/i }).filter({ visible: true });
    const combobox = page.getByRole('combobox').filter({ visible: true });
    try {
      await searchbox.click({ timeout });
      await combobox.fill(keyword, { timeout });
    } catch {
      return await pageRefusal() || { stage, reason: 'normal-search-controls-unavailable' };
    }
    const beforeSubmit = await pageRefusal();
    if (beforeSubmit) return beforeSubmit;
    result.queryCount++;
    try {
      await Promise.all([
        page.waitForURL(url => hasExactSearch(url.href, keyword), { waitUntil: 'domcontentloaded', timeout }),
        combobox.press('Enter', { timeout }),
      ]);
    } catch {
      return await pageRefusal() || { stage, reason: 'search-page-mismatch' };
    }
    return pageRefusal();
  }

  try {
    const initial = await navigate(ORIGIN + '/foryou?lang=de-DE');
    if (initial) return stop(initial);
    for (const keyword of selected) {
      stage = 'search';
      const refused = await searchFromPage(keyword);
      if (refused && refused.reason !== 'search-page-mismatch') return stop(refused);
      if (refused || !hasExactSearch(page.url(), keyword)) {
        const failure = { stage, reason: 'search-page-mismatch' };
        if (!searchResults.length) return stop(failure);
        result.errors.push(failure);
        break;
      }
      const urls = await visibleVideoLinks(page, keyword, MAX_POSTS, timeout);
      const ready = await waitForAccount();
      const late = await pageRefusal();
      if (late) return stop(late);
      if (!hasExactSearch(page.url(), keyword)) {
        const failure = { stage, reason: 'search-page-mismatch' };
        if (!searchResults.length) return stop(failure);
        result.errors.push(failure);
        break;
      }
      if (!ready) return stop({ stage, reason: 'session-unverified' });
      if (!urls.length && !await page.getByText(/^(?:keine ergebnisse(?: gefunden)?|no results found)[.!]?$/i)
        .filter({ visible: true }).first().isVisible()) {
        return stop({ stage, reason: 'rendered-results-unverified' });
      }
      searchResults.push(urls);
    }
    stage = 'video';
    for (const candidate of interleaveOriginals(searchResults, limit)) {
      const blocked = await navigate(candidate);
      if (blocked) return stop(blocked);
      const post = await readOriginal(page, candidate);
      const late = await pageRefusal();
      if (late) return stop(late);
      if (post) result.posts.push(post);
      else result.errors.push({ stage, reason: 'public-original-unverified' });
    }
  } catch {
    return stop(await monitor.current() || { stage, reason: 'browser-read-unavailable' });
  } finally {
    monitor.close();
  }
  return result;
}

function hasExactSearch(value, keyword) {
  const url = tiktokUrl(value);
  return Boolean(url && SEARCH_PATH.test(url.pathname) && url.searchParams.getAll('q').length === 1
    && url.searchParams.get('q') === keyword);
}

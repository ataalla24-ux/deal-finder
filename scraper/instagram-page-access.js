import { load } from 'cheerio';

const wallPrompt = /log\s*in\s+to\s+(?:instagram|(?:see|view|continue))|sign\s*in\s+to\s+(?:see|view|continue)|melde\s+dich\s+an[,\s]+um|anmelden[,\s]+um\s+(?:diesen|den|mehr|fortzufahren)|verify\s+(?:to continue|you are human)|security\s+check|sicherheits(?:pruefung|pr\u00fcfung)|best\u00e4tige,?\s+dass\s+du/i;
const wallTitle = /^(?:(?:log\s*in|sign\s*in|anmelden)\s*[|\u2022-]\s*instagram|instagram\s*[|\u2022-]\s*(?:log\s*in|sign\s*in|anmelden))$/i;

// A navigation link to login is not a refusal. Redirects, actual login forms
// and visible blocking prompts remain refusals even with cached post metadata.
export function instagramPageHasAccessWall(data = {}) {
  try {
    if (/^\/(?:accounts\/(?:login|onetap)|challenge|checkpoint)(?:\/|$)/i.test(new URL(data.finalUrl).pathname)) return true;
  } catch {}
  if (data.hasLoginForm || wallPrompt.test(data.blockingDialogText || '')) return true;
  let title = data.title || '', bodyText = data.bodyText || '';
  if (typeof data.html === 'string') {
    const $ = load(data.html);
    if ($('form input[type="password"]').toArray().some(node => !$(node).closest('[hidden], [aria-hidden="true"]').length)) return true;
    title ||= $('title').text();
    $('script, style, template, noscript, [hidden], [aria-hidden="true"]').remove();
    if (wallPrompt.test($('[role="dialog"], [aria-modal="true"]').text())) return true;
    bodyText ||= $('body').text();
  }
  return wallTitle.test(title.trim()) || wallPrompt.test(bodyText.replace(/\s+/g, ' ').trim().slice(0, 700));
}

// A soft redirect may replace the document while Chromium serializes it.
// Check the resulting document pair without initiating another navigation.
export async function instagramDocumentSnapshot(page) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const finalUrl = page.url();
    if (instagramPageHasAccessWall({ finalUrl })) return { finalUrl, html: '' };
    try {
      const html = await page.content();
      if (finalUrl === page.url()) return { finalUrl, html };
    } catch (error) {
      if (!/page is navigating|execution context was destroyed|cannot find context with specified id/i.test(error.message || '')) throw error;
    }
    if (attempt === 0) await page.waitForTimeout(200);
  }
  return null;
}

const publicPostPath = /^\/(?:([a-z0-9._]{2,40})\/)?(p|reels?|tv)\/([a-z0-9_-]{5,20})\/?$/i;
const instagramHost = /^(?:(?:www|m)\.)?instagram\.com$/i;
const instagramEngagementHeader = /^[\d.,\s]+\s+(?:likes?|gefällt-mir-angaben|gefällt mir)(?:,\s*[\d.,\s]+\s+(?:comments?|kommentare?))?\s*[-–—]\s*@?[a-z0-9._]{2,40}\s+(?:am|on)\s+[^:"“]+\b\d{4}\s*[.:]?$/i;

export function isInstagramOpenGraphHeaderOnly(value) {
  return typeof value === 'string' && instagramEngagementHeader.test(value.replace(/\s+/g, ' ').trim());
}

export function normalizeInstagramPublicPostUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !instagramHost.test(url.hostname) ||
      url.username || url.password || url.port) return '';
    const match = publicPostPath.exec(url.pathname);
    if (!match) return '';
    const type = /^reels?$/i.test(match[2]) ? 'reel' : match[2].toLowerCase();
    return 'https://www.instagram.com/' + type + '/' + match[3] + '/';
  } catch {
    return '';
  }
}

export function readInstagramBoundStructuredCaption(html, postUrl) {
  const expected = normalizeInstagramPublicPostUrl(postUrl);
  if (!expected || !html) return null;
  const $ = load(html);
  const target = value => {
    try { return typeof value === 'string' && value ? normalizeInstagramPublicPostUrl(new URL(value, expected).href) : ''; }
    catch { return ''; }
  };
  const identities = [$('meta[property="og:url"]').attr('content'), $('link[rel="canonical"]').attr('href')].filter(Boolean);
  if (!identities.every(value => target(value) === expected)) return null;
  const proofs = new Map();
  $('script[type="application/ld+json"]').slice(0, 12).each((_, script) => {
    let value;
    try { value = JSON.parse($(script).html()); } catch { return; }
    const entries = Array.isArray(value) ? value : [value, ...(Array.isArray(value?.['@graph']) ? value['@graph'] : [])];
    for (const entry of entries.slice(0, 30)) {
      const type = Array.isArray(entry?.['@type']) ? entry['@type'] : [entry?.['@type']];
      if (!type.some(value => ['SocialMediaPosting', 'VideoObject', 'ImageObject'].includes(value))) continue;
      const references = [entry.url, entry['@id'], typeof entry.mainEntityOfPage === 'string'
        ? entry.mainEntityOfPage : entry.mainEntityOfPage?.['@id']];
      const postReferences = references.map(target).filter(Boolean);
      if (!postReferences.length || postReferences.some(value => value !== expected)) continue;
      const value = entry.caption || entry.articleBody || entry.description;
      const caption = typeof value === 'string' ? value.trim() : '';
      if (!caption || caption.length > 2200 || isInstagramOpenGraphHeaderOnly(caption)) continue;
      const dates = new Map(['datePublished', 'uploadDate'].map(key => [instagramAbsoluteDate(entry[key]), key])
        .filter(([date]) => date));
      if (dates.size > 1) continue;
      const [[date, dateField] = ['', '']] = [...dates];
      proofs.set(JSON.stringify([caption, date]), { caption, date, dateField });
    }
  });
  return proofs.size === 1 ? [...proofs.values()][0] : null;
}

export function instagramAbsoluteDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return '';
  const day = value.slice(0, 10);
  const midnight = new Date(day + 'T00:00:00Z');
  if (!Number.isFinite(+midnight) || midnight.toISOString().slice(0, 10) !== day || Number(value.slice(11, 13)) >= 24) return '';
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

export async function readInstagramBoundVisibleCaption(page, postUrl) {
  const expected = normalizeInstagramPublicPostUrl(postUrl);
  if (!expected || normalizeInstagramPublicPostUrl(page.url()) !== expected) return '';
  const caption = await page.evaluate(({ expected, pathSource, hostSource }) => {
    const path = new RegExp(pathSource, 'i');
    const host = new RegExp(hostSource, 'i');
    const visible = node => !node.closest('[hidden], [aria-hidden="true"]')
      && node.checkVisibility({ visibilityProperty: true, opacityProperty: true });
    const isOriginal = href => {
      try {
        const url = new URL(href);
        const match = path.exec(url.pathname);
        if (url.protocol !== 'https:' || !host.test(url.hostname) || url.username || url.password || url.port
            || url.search || url.hash || !match) return false;
        const type = /^reels?$/i.test(match[2]) ? 'reel' : match[2].toLowerCase();
        return 'https://www.instagram.com/' + type + '/' + match[3] + '/' === expected;
      } catch { return false; }
    };
    const originals = new Set();
    for (const time of document.querySelectorAll('main time[datetime], [role="main"] time[datetime]')) {
      const article = time.closest('article, [role="article"]');
      if (article && visible(time) && isOriginal(time.closest('a[href]')?.href)) originals.add(article);
    }
    if (originals.size !== 1) return '';
    const [article] = originals;
    const captions = new Set([...article.querySelectorAll('[data-testid="post-caption"], h1[dir="auto"]')]
      .filter(node => visible(node) && node.closest('article, [role="article"]') === article
        && !node.closest('header, nav, aside, [role="comment"]'))
      .map(node => node.innerText.trim()).filter(text => text && text.length <= 2200));
    return captions.size === 1 ? [...captions][0] : '';
  }, { expected, pathSource: publicPostPath.source, hostSource: instagramHost.source });
  return normalizeInstagramPublicPostUrl(page.url()) === expected && !isInstagramOpenGraphHeaderOnly(caption) ? caption : '';
}

// Modern post/reel pages may use role="main" instead of a main/article tree.
// Accept only a visible, absolute timestamp linked to this exact open post;
// a comment, recommendation, hidden template or capture time is not evidence.
export async function readInstagramPostLinkedDate(page, postUrl) {
  const expected = normalizeInstagramPublicPostUrl(postUrl);
  if (!expected || normalizeInstagramPublicPostUrl(page.url()) !== expected) return '';
  const dates = await page.evaluate(({ expected, postPathSource, hostSource }) => {
    const postPath = new RegExp(postPathSource, 'i');
    const host = new RegExp(hostSource, 'i');
    const dates = new Set();
    for (const node of document.querySelectorAll('main time[datetime], [role="main"] time[datetime]')) {
      if (node.closest('[hidden], [aria-hidden="true"]') ||
        !node.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
      const anchor = node.closest('a[href]');
      if (!anchor) continue;
      let url;
      try { url = new URL(anchor.href); } catch { continue; }
      if (url.protocol !== 'https:' || !host.test(url.hostname) || url.username || url.password || url.port) continue;
      const match = postPath.exec(url.pathname);
      if (!match) continue;
      const type = /^reels?$/i.test(match[2]) ? 'reel' : match[2].toLowerCase();
      if ('https://www.instagram.com/' + type + '/' + match[3] + '/' !== expected) continue;
      const date = node.getAttribute('datetime') || '';
      if (/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(date) && Number.isFinite(Date.parse(date))) dates.add(date);
    }
    return [...dates];
  }, { expected, postPathSource: publicPostPath.source, hostSource: instagramHost.source });
  if (normalizeInstagramPublicPostUrl(page.url()) !== expected || dates.length !== 1) return '';
  return dates[0];
}

// The profile grid can hydrate after navigation and use a div with role="main".
export async function readInstagramProfileTimeline(page, profileUrl, limit, timeout = 1800) {
  const expected = new URL(profileUrl);
  const profile = expected.pathname.toLowerCase().split('/')[1];
  let urls = [];
  try {
    const links = await page.waitForFunction(({ postPathSource, hostSource, profile, limit }) => {
      const postPath = new RegExp(postPathSource, 'i');
      const host = new RegExp(hostSource, 'i');
      const found = new Set();
      for (const anchor of document.querySelectorAll('a[href]')) {
        if (anchor.closest('[hidden], [aria-hidden="true"]') ||
          !anchor.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
        let url;
        try { url = new URL(anchor.href); } catch { continue; }
        if (url.protocol !== 'https:' || !host.test(url.hostname) ||
          url.username || url.password || url.port) continue;
        const match = postPath.exec(url.pathname);
        if (!match || (match[1] && match[1].toLowerCase() !== profile)) continue;
        const type = /^reels?$/i.test(match[2]) ? 'reel' : match[2].toLowerCase();
        found.add('https://www.instagram.com/' + type + '/' + match[3] + '/');
        if (found.size >= limit) break;
      }
      return found.size ? [...found] : null;
    }, { postPathSource: publicPostPath.source, hostSource: instagramHost.source, profile, limit }, { timeout, polling: 150 });
    try { urls = await links.jsonValue(); } finally { await links.dispose(); }
  } catch (error) {
    if (error.name !== 'TimeoutError') throw error;
  }
  const document = await instagramDocumentSnapshot(page);
  if (!document) return { status: 'unavailable', urls: [] };
  if (instagramPageHasAccessWall(document)) return { status: 'blocked', urls: [] };
  const finalUrl = new URL(document.finalUrl);
  if (finalUrl.origin !== expected.origin ||
    finalUrl.pathname.toLowerCase().replace(/\/$/, '') !== expected.pathname.toLowerCase().replace(/\/$/, '')) {
    return { status: 'unavailable', urls: [] };
  }
  return { status: urls.length ? 'readable' : 'no-timeline', urls };
}

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

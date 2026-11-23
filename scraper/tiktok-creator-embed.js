import { retryAfterAt } from './source-http-policy.js';

const origin = 'https://www.tiktok.com';
const preview = 'http://127.0.0.1/tiktok-creator-embed';
const denied = [401, 403, 429, 451];

// Observe only HTTP status and Retry-After. Never read response bodies,
// generate app API requests or alter the browser's first-party requests.
export function watchPublicTikTokRefusals(page) {
  let stop = null;
  const observe = response => {
    if (new URL(response.url()).origin !== origin) return;
    const status = response.status();
    const headers = response.headers();
    if (!denied.includes(status) && !Object.hasOwn(headers, 'retry-after')) return;
    const nextRetryAt = retryAfterAt(headers['retry-after']);
    if (!stop || nextRetryAt > stop.nextRetryAt) {
      stop = { reason: 'provider-refusal', status, nextRetryAt };
    }
  };
  page.on('response', observe);
  return { current: () => stop, close: () => page.off('response', observe) };
}

export async function visibleTikTokAccessStop(frame) {
  const reason = await frame.evaluate(() => {
    const visible = node => node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    const text = (document.body?.innerText || '').slice(0, 5000);
    const shown = selectors => [...document.querySelectorAll(selectors)].some(visible);
    if (/^\/(?:login|signup)(?:\/|$)/i.test(location.pathname) || shown('input[type="password"]')
      || /\b(?:log in to (?:see|view|watch|search)|(?:melde dich an|anmelden),? um)\b/i.test(text)) return 'login-wall';
    if (/^\/(?:challenge|checkpoint)(?:\/|$)/i.test(location.pathname)
      || /verify (?:to continue|you are human)|security (?:check|verification)|unusual traffic|too many requests|captcha|sicherheits(?:über)?prüfung/i.test(document.title + '\n' + text)) return 'access-challenge';
    if (/this (?:account|video|profile) is private|private account|dieses (?:konto|video|profil) ist privat/i.test(text)) return 'private';
    const dialogs = [...document.querySelectorAll('dialog[open],[role="dialog"],[role="alertdialog"],[aria-modal="true"]')].filter(visible);
    if (dialogs.some(el => /cookie|consent|einwillig|zustimm/i.test(el.innerText))) return 'consent-dialog';
    if (dialogs.some(el => /log in|sign up|anmelden|registrieren/i.test(el.innerText))) return 'login-dialog';
    return null;
  });
  return reason ? { reason } : null;
}

function creatorMarkup(handle) {
  return '<!doctype html><meta charset="utf-8"><title>Public creator embed</title>'
    + '<blockquote class="tiktok-embed" cite="' + origin + '/@' + handle + '" data-unique-id="' + handle
    + '" data-embed-type="creator" style="max-width:720px;min-width:288px"><section>'
    + '<a href="' + origin + '/@' + handle + '">@' + handle + '</a></section></blockquote>'
    + '<script async src="' + origin + '/embed.js"></script>';
}

async function readCreatorFrame(frame, handle) {
  return frame.evaluate(({ origin, handle }) => {
    if (location.origin !== origin) return null;
    const visible = node => node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
      && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0;
    const cards = new Map();
    const associated = [];
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      if (!script.textContent || script.textContent.length > 200000) continue;
      try {
        const roots = [].concat(JSON.parse(script.textContent));
        for (const node of roots.flatMap(root => [root, ...[].concat(root?.['@graph'] || []), ...[].concat(root?.mainEntity || [])])) {
          if ([].concat(node?.['@type'] || []).includes('VideoObject')) associated.push(node);
        }
      } catch { /* Invalid structured markup is not evidence. */ }
    }
    const captionLike = text => typeof text === 'string' && /[\p{L}]{2}/u.test(text)
      && text.trim().length >= 12 && !/^(?:video(?: thumbnail| cover)?|thumbnail|play video|watch video|video abspielen|video ansehen|[\d.,mk]+ (?:views|aufrufe))[.!]?$/i.test(text.trim());
    const calendar = text => typeof text === 'string' && /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+(?:Z|[+-]\d{2}:\d{2}))?$/i.test(text)
      && Number.isFinite(Date.parse(text));
    let profileLinkSeen = false;
    for (const anchor of document.querySelectorAll('a[href]')) {
      if (!visible(anchor) || anchor.closest('[inert],[aria-disabled="true"]')) continue;
      let target;
      try { target = new URL(anchor.href); } catch { continue; }
      if (target.origin !== origin || target.username || target.password) continue;
      const path = target.pathname.replace(/\/$/, '');
      if (path.toLowerCase() === '/@' + handle) profileLinkSeen = true;
      const match = path.match(/^\/@([a-z0-9._-]{2,40})\/video\/(\d{8,30})$/i);
      if (match?.[1].toLowerCase() !== handle) continue;
      const url = origin + '/@' + handle + '/video/' + match[2];
      if (!cards.has(url) && cards.size >= 10) continue;
      const card = cards.get(url) || { url, accessibleCaptionFields: [], timeDatetime: null, videoObjectCaption: false, videoObjectDate: null };
      // Read labels only from this anchor, or a figure with no competing link.
      const figure = anchor.closest('figure');
      const scope = figure?.querySelectorAll('a[href]').length === 1 ? figure : anchor;
      const labels = {
        ariaLabel: anchor.getAttribute('aria-label'),
        imageAlt: [...anchor.querySelectorAll('img[alt]')].find(img => visible(img) && captionLike(img.alt))?.alt,
        figcaption: [...scope.querySelectorAll('figcaption')].find(el => visible(el))?.innerText,
      };
      for (const [key, text] of Object.entries(labels)) {
        if (captionLike(text) && !card.accessibleCaptionFields.includes(key)) card.accessibleCaptionFields.push(key);
      }
      const time = [...scope.querySelectorAll('time[datetime]')].find(el => visible(el) && calendar(el.dateTime));
      if (time) card.timeDatetime = time.dateTime;
      for (const node of associated) {
        const matches = [node.url, node['@id'], node.mainEntityOfPage?.['@id']].some(value => {
          if (typeof value !== 'string') return false;
          try {
            const target = new URL(value, location.href);
            return !target.username && !target.password && target.origin === origin && target.pathname.replace(/\/$/, '').toLowerCase() === path.toLowerCase();
          } catch { return false; }
        });
        if (!matches) continue;
        card.videoObjectCaption ||= captionLike(node.description);
        if (calendar(node.uploadDate)) card.videoObjectDate = node.uploadDate;
      }
      cards.set(url, card);
    }
    // Only expose a sanitized route shape from the actual provider-created iframe.
    const frameRoute = location.pathname.split('/').map(part => {
      if (!part || /^(?:embed|creator|profile|v\d)$/i.test(part)) return part;
      return part.toLowerCase() === '@' + handle ? '@creator' : '*';
    }).join('/');
    return { frameRoute, profileLinkSeen, links: profileLinkSeen ? [...cards.keys()] : [],
      cards: profileLinkSeen ? [...cards.values()] : [] };
  }, { origin, handle });
}

export async function discoverPublicTikTokCreatorLinks(page, handle, { timeoutMs = 15000, nextRetryAt = '' } = {}) {
  if (typeof handle !== 'string' || !/^[a-z0-9._-]{2,40}$/i.test(handle)) throw new TypeError('Invalid TikTok creator handle');
  handle = handle.toLowerCase();
  const result = { handle, frameSeen: false, frameRoute: null, profileLinkSeen: false, links: [], cards: [], stop: null };
  if (Date.parse(nextRetryAt) > Date.now()) return { ...result, stop: { reason: 'cooldown', nextRetryAt } };
  const monitor = watchPublicTikTokRefusals(page);
  const serve = route => route.fulfill({ contentType: 'text/html', body: creatorMarkup(handle) });
  // This is our own local HTML document. TikTok's documented script renders
  // its widget and chooses the iframe URL. Do not construct an iframe URL.
  await page.route(preview, serve);
  try {
    await page.goto(preview, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const deadline = Date.now() + Math.min(timeoutMs, 20000);
    let observedAt = 0;
    do {
      if (monitor.current()) return { ...result, links: [], cards: [], stop: monitor.current() };
      for (const frame of page.mainFrame().childFrames()) {
        if (!frame.url().startsWith(origin + '/') || new URL(frame.url()).origin !== origin) continue;
        const element = await frame.frameElement();
        if (!await element.isVisible()) continue;
        result.frameSeen = true;
        const wall = await visibleTikTokAccessStop(frame);
        if (wall) return { ...result, links: [], cards: [], stop: wall };
        const evidence = await readCreatorFrame(frame, handle);
        if (!evidence) continue;
        Object.assign(result, evidence);
        if (result.links.length) {
          if (observedAt && Date.now() - observedAt >= 350) {
            const stop = monitor.current();
            return stop ? { ...result, links: [], cards: [], stop } : result;
          }
          observedAt ||= Date.now();
        } else observedAt = 0;
      }
      await page.waitForTimeout(200);
    } while (Date.now() < deadline);
    result.stop = monitor.current();
    if (result.stop) { result.links = []; result.cards = []; }
    return result;
  } catch {
    return { ...result, links: [], cards: [], stop: monitor.current() || { reason: 'widget-read-unavailable' } };
  } finally {
    monitor.close();
    await page.unroute(preview, serve);
  }
}

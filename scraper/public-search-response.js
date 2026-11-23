import { load } from 'cheerio';
import { sourceHttpError } from './source-http-policy.js';

function publicSearchError(response, status, now) {
  const retryAfter = response.headers.get('retry-after');
  return Object.assign(sourceHttpError(status, retryAfter, now), { retryAfterProvided: retryAfter !== null });
}

// A successful HTTP response can still be a challenge, not an empty search.
export async function readPublicSearchResponse(response, now = new Date()) {
  if (!response.ok) {
    await response.body?.cancel();
    throw publicSearchError(response, response.status, now);
  }
  const html = await response.text();
  if (response.status === 202 || /anomaly\.js|anomaly-modal|challenge-form|g-recaptcha|h-captcha|verify (?:that )?you are human/i.test(html)) {
    throw Object.assign(publicSearchError(response, 403, now), { message: 'Search challenge; no bypass attempted' });
  }
  if (!html.trim() || !/result__a|result-link|no-results|No results found/i.test(html)) {
    throw Object.assign(new Error('Unrecognized search response'), { retryAt: new Date(+now + 86400000).toISOString() });
  }
  return html;
}

export function parsePublicSearchResults(html, normalizeUrl) {
  const $ = load(html);
  return $('a.result__a[href], a.result-link[href]').toArray().flatMap(node => {
    const link = $(node);
    let href;
    try { href = new URL(link.attr('href'), 'https://html.duckduckgo.com'); } catch { return []; }
    if (href.username || href.password || !['https:', 'http:'].includes(href.protocol)) return [];
    const redirect = /^(?:html\.)?duckduckgo\.com$/i.test(href.hostname) && href.pathname === '/l/'
      ? href.searchParams.get('uddg') : '';
    const url = normalizeUrl(redirect || href.href);
    if (!url) return [];
    const result = link.closest('.result, .result__body, .result-wrapper');
    const text = value => value.replace(/\s+/g, ' ').trim();
    return [{ url, title: text(link.text()), snippet: text(result.find('.result__snippet, .result-snippet').first().text()) }];
  });
}

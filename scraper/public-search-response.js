import { sourceHttpError } from './source-http-policy.js';

// A successful HTTP response can still be a challenge, not an empty search.
export async function readPublicSearchResponse(response, now = new Date()) {
  if (!response.ok) {
    await response.body?.cancel();
    throw sourceHttpError(response.status, response.headers.get('retry-after'), now);
  }
  const html = await response.text();
  if (response.status === 202 || /anomaly\.js|anomaly-modal|challenge-form|g-recaptcha|h-captcha|verify (?:that )?you are human/i.test(html)) {
    throw Object.assign(sourceHttpError(403, response.headers.get('retry-after'), now), { message: 'Search challenge; no bypass attempted' });
  }
  if (!html.trim() || !/result__a|result-link|no-results|No results found/i.test(html)) {
    throw Object.assign(new Error('Unrecognized search response'), { retryAt: new Date(+now + 86400000).toISOString() });
  }
  return html;
}

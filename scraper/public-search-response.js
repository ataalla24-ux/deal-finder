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

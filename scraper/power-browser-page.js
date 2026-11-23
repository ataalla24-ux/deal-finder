import { sourceHttpError } from './source-http-policy.js';

// Reads the existing browser navigation; never clicks consent or follows another
// offer URL. A configured client-rendered landing page must become readable.
export async function readPowerBrowserPage(page, url, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 12000);
  const deadline = Date.now() + timeoutMs;
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  const status = response?.status() || 0;
  if (status >= 400) throw sourceHttpError(status, response.headers()['retry-after']);
  if (options.renderReadySelector) {
    try {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('render deadline exhausted');
      await page.waitForFunction(({ selector, headingText, sectionText }) => {
        const root = document.querySelector(selector);
        const visible = element => element && element.getClientRects().length > 0 &&
          getComputedStyle(element).visibility !== 'hidden';
        if (!visible(root)) return false;
        if ([...document.querySelectorAll('input[type="password"]')].some(visible)) return false;
        const normalize = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const heading = root.querySelector('h1');
        if (headingText && !normalize(heading?.innerText).includes(normalize(headingText))) return false;
        if (sectionText && ![...root.querySelectorAll('h2,h3')].some(element =>
          visible(element) && normalize(element.innerText) === normalize(sectionText))) return false;
        const paragraphs = [...root.querySelectorAll('p')].filter(visible);
        return visible(heading) && heading.innerText.trim().length >= 3 &&
          paragraphs.some(element => element.innerText.trim().length >= 80);
      }, {
        selector: options.renderReadySelector,
        headingText: options.renderReadyHeading,
        sectionText: options.renderReadySection,
      }, { timeout: remaining });
    } catch {
      throw new Error('browser-render-incomplete: expected visible landing-page content did not load');
    }
  }
  const html = await page.content();
  const maxBytes = Number(options.maxBytes || 2500000);
  const buffer = Buffer.from(html);
  const limited = buffer.length > maxBytes ? buffer.subarray(0, maxBytes).toString('utf8') : html;
  return { html: limited, finalUrl: page.url() || url, bytes: Buffer.byteLength(limited), browserFallback: true };
}

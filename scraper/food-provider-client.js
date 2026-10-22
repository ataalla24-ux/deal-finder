import { isAllowedFoodUrl } from './power-food-sources.js';
import { retryAfterAt } from './source-http-policy.js';
const PROVIDERS = ['scraperapi', 'scrapingbee', 'zyte'];
const KEYS = { scraperapi: 'SCRAPINGAPI', scrapingbee: 'SCRAPINGBEE', zyte: 'ZYSTE' };

export class ProviderError extends Error {
  constructor(reason, status = 0) { super(reason); this.httpStatus = status; }
}

async function boundedText(response, max = 3_000_000) {
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) { await reader.cancel(); throw new ProviderError('response-too-large'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// Never propagate provider response bodies, URLs or fetch exceptions: they can
// contain credentials. Credentials go only to the fixed official API endpoints.
export class FoodProviderClient {
  constructor(provider, { env = process.env, fetchImpl = fetch } = {}) {
    if (!PROVIDERS.includes(provider)) throw new ProviderError('unknown-provider');
    this.provider = provider;
    this.key = env[KEYS[provider]];
    this.fetchImpl = fetchImpl;
  }
  async request(url, options = {}) {
    if (!this.key) throw new ProviderError('missing-credential');
    let response;
    try { response = await this.fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(95_000) }); }
    catch { throw new ProviderError('provider-network-error'); }
    if (!response.ok) {
      await response.body?.cancel();
      throw Object.assign(new ProviderError(`provider-http-${response.status}`, response.status),
        { retryAt: retryAfterAt(response.headers.get('retry-after'), new Date()) });
    }
    const text = await boundedText(response);
    return { text, headers: response.headers };
  }
  async usage() {
    if (this.provider === 'zyte') return { provider: 'zyte', credentialPresent: Boolean(this.key), status: 'dashboard-trial-check-required' };
    const url = this.provider === 'scraperapi'
      ? new URL('https://api.scraperapi.com/account') : new URL('https://app.scrapingbee.com/api/v1/usage');
    const headers = {};
    if (this.provider === 'scraperapi') url.searchParams.set('api_key', this.key || '');
    else headers.Authorization = `Bearer ${this.key || ''}`;
    const { text } = await this.request(url, { headers });
    let body;
    try { body = JSON.parse(text); } catch { throw new ProviderError('invalid-usage-response'); }
    return usageSummary(this.provider, body);
  }
  async scrape(source, target = source.url) {
    if (!isAllowedFoodUrl(target, source)) throw new ProviderError('untrusted-target');
    let result, html, finalUrl, cost, status = 200;
    if (this.provider === 'scraperapi') {
      const url = new URL('https://api.scraperapi.com/');
      url.search = new URLSearchParams({ api_key: this.key || '', url: target, render: 'true', max_cost: '10' });
      result = await this.request(url);
      html = result.text;
      finalUrl = result.headers.get('sa-final-url');
      cost = Number(result.headers.get('sa-credit-cost'));
    } else if (this.provider === 'scrapingbee') {
      const url = new URL('https://app.scrapingbee.com/api/v1/');
      url.search = new URLSearchParams({ url: target, render_js: 'true', premium_proxy: 'false',
        stealth_proxy: 'false', block_resources: 'true', transparent_status_code: 'true' });
      result = await this.request(url, { headers: { Authorization: `Bearer ${this.key || ''}` } });
      html = result.text;
      finalUrl = result.headers.get('spb-resolved-url');
      cost = Number(result.headers.get('spb-cost'));
    } else {
      result = await this.request('https://api.zyte.com/v1/extract', {
        method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${this.key || ''}:`).toString('base64')}`, 'content-type': 'application/json' },
        body: JSON.stringify({ url: target, browserHtml: true }),
      });
      let data;
      try { data = JSON.parse(result.text); } catch { throw new ProviderError('invalid-page-response'); }
      html = data.browserHtml;
      finalUrl = data.url;
      status = data.statusCode;
      cost = null;
    }
    if (status !== 200) throw new ProviderError(`target-http-${Number(status) || 0}`, Number(status) || 0);
    if (!isAllowedFoodUrl(finalUrl, source)) throw new ProviderError('untrusted-or-missing-final-url');
    if (typeof html !== 'string' || !/<(?:html|body|main)[\s>]/i.test(html)) throw new ProviderError('invalid-page-html');
    if (this.provider !== 'zyte' && (!Number.isFinite(cost) || cost <= 0 || cost > (this.provider === 'scraperapi' ? 10 : 5)))
      throw new ProviderError('unexpected-provider-cost');
    return { html, finalUrl, cost };
  }
}

export function usageSummary(provider, body) {
  const numeric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  if (provider === 'scrapingbee') return {
    provider, status: 'authenticated', maximum: numeric(body.max_api_credit), used: numeric(body.used_api_credit),
    concurrency: numeric(body.current_concurrency),
  };
  return {
    provider, status: 'authenticated',
    maximum: numeric(body.requestLimit ?? body.plan?.credits), used: numeric(body.requestCount),
    concurrency: numeric(body.concurrentRequests),
    payAsYouGoEnabled: typeof body.payAsYouGoEnabled === 'boolean' ? body.payAsYouGoEnabled : null,
    autoUpgradeEnabled: typeof body.autoUpgradeEnabled === 'boolean' ? body.autoUpgradeEnabled : null,
    plan: /^[a-zA-Z0-9 _-]{1,40}$/.test(body.plan?.name || '') ? body.plan.name : null,
    // Field names only aid schema validation without publishing unrecognized data.
    fields: Object.keys(body).filter(k => !/key|token|secret|email|id/i.test(k)),
    planFields: body.plan && typeof body.plan === 'object' ? Object.keys(body.plan).filter(k => !/key|token|secret|email|id/i.test(k)) : [],
  };
}

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
      throw new ProviderError(`provider-http-${response.status}`, response.status);
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
    plan: /^[a-zA-Z0-9 _-]{1,40}$/.test(body.plan?.name || '') ? body.plan.name : null,
    // Field names only aid schema validation without publishing unrecognized data.
    fields: Object.keys(body).filter(k => !/key|token|secret|email|id/i.test(k)),
    planFields: body.plan && typeof body.plan === 'object' ? Object.keys(body.plan).filter(k => !/key|token|secret|email|id/i.test(k)) : [],
  };
}

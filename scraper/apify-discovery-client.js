const BASE = 'https://api.apify.com/v2';
export const DISCOVERY_ACTOR = 'apify~instagram-scraper';
export const HASHTAG_ACTOR = 'apify~instagram-hashtag-scraper';
export const RUN_CAP_USD = 0.04;

export class ApifyDiscoveryClient {
  constructor(token, fetchImpl = fetch) {
    if (!String(token || '').trim()) throw new Error('missing-apify-2-secret');
    this.token = token.trim();
    this.fetch = fetchImpl;
  }

  async request(route, { method = 'GET', body } = {}) {
    if (!route.startsWith('/') || route.includes('://')) throw new Error('invalid-api-route');
    let response;
    try {
      response = await this.fetch(`${BASE}${route}`, {
        method,
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(35_000),
      });
    } catch {
      // Never retry a possibly accepted start request or print provider bodies/secrets.
      throw Object.assign(new Error('apify-network-error'), { uncertainStart: method === 'POST' && route.includes('/runs?') });
    }
    if (!response.ok) {
      const retry = response.headers.get('retry-after');
      const retryAt = /^\d+$/.test(retry || '') ? Date.now() + Number(retry) * 1000 : Date.parse(retry || '');
      throw Object.assign(new Error(`apify-http-${response.status}`), {
        httpStatus: response.status,
        retryAt: Number.isFinite(retryAt) ? new Date(retryAt).toISOString() : null,
      });
    }
    let json;
    try { json = await response.json(); } catch {
      throw Object.assign(new Error('apify-invalid-json'), { uncertainStart: method === 'POST' && route.includes('/runs?') });
    }
    return json.data ?? json;
  }

  async preflight(actorId = DISCOVERY_ACTOR) {
    if (![DISCOVERY_ACTOR, HASHTAG_ACTOR].includes(actorId)) throw new Error('invalid-actor');
    const user = await this.request('/users/me');
    const limits = await this.request('/users/me/limits');
    const actor = await this.request(`/acts/${actorId}`);
    return { user, limits, actor };
  }
}

export function budgetCheck({ user, limits, actor }, now = new Date(), runCap = RUN_CAP_USD) {
  const credits = user?.plan?.monthlyUsageCreditsUsd;
  const used = limits?.current?.monthlyUsageUsd;
  const ceiling = limits?.limits?.maxMonthlyUsageUsd;
  const pricing = (actor?.pricingInfos || [])
    .filter(p => Date.parse(p.startedAt) <= +now)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0];
  let reason = '';
  if (![credits, used, ceiling].every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0)
      || !Number.isFinite(Date.parse(limits?.monthlyUsageCycle?.startAt))
      || !Number.isFinite(Date.parse(limits?.monthlyUsageCycle?.endAt))) reason = 'unknown-account-budget';
  else if (+now < Date.parse(limits.monthlyUsageCycle.startAt) || +now > Date.parse(limits.monthlyUsageCycle.endAt)) reason = 'stale-budget-cycle';
  else if (ceiling > credits) reason = 'account-limit-exceeds-included-credit';
  else if (Math.min(credits, ceiling) - used < runCap + 0.25) reason = 'included-credit-reserve';
  else if (pricing?.pricingModel !== 'PAY_PER_EVENT'
      || !Number.isFinite(pricing?.minimalMaxTotalChargeUsd)
      || pricing.minimalMaxTotalChargeUsd > runCap) reason = 'unsupported-cost-cap';
  return {
    allowed: !reason,
    reason,
    plan: String(user?.plan?.tier || user?.plan?.id || 'unknown'),
    includedCreditUsd: Number.isFinite(credits) ? credits : null,
    accountUsageUsd: Number.isFinite(used) ? used : null,
    accountLimitUsd: Number.isFinite(ceiling) ? ceiling : null,
    cycle: limits?.monthlyUsageCycle || null,
    runCapUsd: runCap,
    pricingModel: pricing?.pricingModel || null,
  };
}

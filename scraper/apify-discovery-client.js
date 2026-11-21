const BASE = 'https://api.apify.com/v2';
export const DISCOVERY_ACTOR = 'apify~instagram-scraper';
export const HASHTAG_ACTOR = 'apify~instagram-hashtag-scraper';
export const PROFILE_CAP_USD = 0.0625;
export const HASHTAG_CAP_USD = 0.0125;
export const RUN_CAP_USD = 0.075;
export const CREDIT_RESERVE_USD = 0.35;

const PROVIDER_ERROR_TYPES = new Set([
  'invalid-token', 'missing-api-token', 'user-or-token-not-found',
  'insufficient-permissions', 'missing-actor-rights', 'actor-not-public',
  'elevated-permissions-needed', 'unsupported-permission',
  'actor-disabled', 'public-actor-disabled', 'actor-not-found',
  'build-not-found', 'build-outdated', 'unknown-build-tag', 'tagged-build-required',
  'apify-plan-required-to-use-paid-actor', 'not-enough-usage-to-run-paid-actor',
  'max-total-charge-usd-below-minimum', 'monthly-usage-limit-too-low',
  'store-terms-not-accepted', 'user-email-not-verified',
  'limit-reached', 'rate-limit-exceeded', 'too-many-requests',
]);
const OPERATIONS = new Set([
  'account-read', 'account-limits', 'actor-metadata', 'actor-start',
  'run-status', 'run-abort', 'dataset-read',
]);
const MAXIMUM_DATE_MS = 8_640_000_000_000_000;

function readRetryAfter(headers) {
  if (!headers.has('retry-after')) return { retryAfterStatus: 'absent', retryAt: null };
  const value = headers.get('retry-after')?.trim() || '';
  const time = /^\d+$/.test(value)
    ? Math.min(MAXIMUM_DATE_MS, Date.now() + Number(value) * 1000)
    : Date.parse(value);
  const date = new Date(time);
  return Number.isFinite(+date)
    ? { retryAfterStatus: 'valid', retryAt: date.toISOString() }
    : { retryAfterStatus: 'invalid', retryAt: null };
}

function requestOperation(route, method) {
  const pathname = route.split('?')[0];
  if (pathname === '/users/me') return 'account-read';
  if (pathname === '/users/me/limits') return 'account-limits';
  if (/^\/acts\/[^/]+$/.test(pathname)) return 'actor-metadata';
  if (method === 'POST' && /^\/acts\/[^/]+\/runs$/.test(pathname)) return 'actor-start';
  if (/^\/actor-runs\/[^/]+$/.test(pathname)) return 'run-status';
  if (/^\/actor-runs\/[^/]+\/abort$/.test(pathname)) return 'run-abort';
  if (/^\/datasets\/[^/]+\/items$/.test(pathname)) return 'dataset-read';
}

export function apifyErrorDetails(error) {
  const retryAt = Date.parse(error.retryAt);
  return {
    reason: /^(?:apify-|actor-|missing-|invalid-)[a-z0-9-]{1,90}$/.test(error.message)
      ? error.message : 'collector-processing-failed',
    ...(Number.isInteger(error.httpStatus) && { httpStatus: error.httpStatus }),
    ...(OPERATIONS.has(error.operation) && { operation: error.operation }),
    ...(PROVIDER_ERROR_TYPES.has(error.providerType) && { providerType: error.providerType }),
    ...(['absent', 'valid', 'invalid'].includes(error.retryAfterStatus) && { retryAfterStatus: error.retryAfterStatus }),
    ...(error.retryAfterStatus === 'valid' && Number.isFinite(retryAt)
      && { providerRetryAt: new Date(retryAt).toISOString() }),
  };
}

export class ApifyDiscoveryClient {
  constructor(token, fetchImpl = fetch) {
    if (!String(token || '').trim()) throw new Error('missing-apify-2-secret');
    this.token = token.trim();
    this.fetch = fetchImpl;
  }

  async request(route, { method = 'GET', body } = {}) {
    if (!route.startsWith('/') || route.includes('://')) throw new Error('invalid-api-route');
    const operation = requestOperation(route, method);
    const isStart = operation === 'actor-start';
    let response;
    try {
      response = await this.fetch(`${BASE}${route}`, {
        method,
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error',
        signal: AbortSignal.timeout(35_000),
      });
    } catch {
      // Never retry a possibly accepted start request or print provider bodies/secrets.
      throw Object.assign(new Error('apify-network-error'), { operation, uncertainStart: isStart });
    }
    if (!response.ok) {
      const retryAfter = readRetryAfter(response.headers);
      let providerType;
      if (/^application\/json(?:;|$)/i.test(response.headers.get('content-type') || '')) {
        try {
          const type = (await response.json())?.error?.type;
          if (PROVIDER_ERROR_TYPES.has(type)) providerType = type;
        } catch { /* Keep the status and operation even if the error body is unreadable. */ }
      }
      throw Object.assign(new Error(`apify-http-${response.status}`), {
        httpStatus: response.status,
        operation,
        providerType,
        uncertainStart: isStart && response.status >= 500,
        ...retryAfter,
      });
    }
    let json;
    try { json = await response.json(); } catch {
      throw Object.assign(new Error('apify-invalid-json'), { operation, uncertainStart: isStart });
    }
    return json?.data ?? json;
  }

  async preflight(actorId = DISCOVERY_ACTOR) {
    if (![DISCOVERY_ACTOR, HASHTAG_ACTOR].includes(actorId)) throw new Error('invalid-actor');
    const user = await this.request('/users/me');
    const limits = await this.request('/users/me/limits');
    const actor = await this.request(`/acts/${actorId}`);
    return { user, limits, actor };
  }
}

export async function compareApifyAccounts(primary, discoveryUser) {
  if (!primary) return { sameAccountAsPrimary: null, primaryAccountComparison: 'not-configured' };
  try {
    const user = await primary.request('/users/me');
    if (user?.id && discoveryUser?.id) {
      return { sameAccountAsPrimary: user.id === discoveryUser.id, primaryAccountComparison: 'checked' };
    }
  } catch { /* The legacy token may be restricted to its own actor. */ }
  return { sameAccountAsPrimary: null, primaryAccountComparison: 'unavailable' };
}

export function budgetCheck({ user, limits, actor }, now = new Date(), runCap = RUN_CAP_USD) {
  const credits = user?.plan?.monthlyUsageCreditsUsd;
  const used = limits?.current?.monthlyUsageUsd;
  const ceiling = limits?.limits?.maxMonthlyUsageUsd;
  const pricing = (actor?.pricingInfos || [])
    .filter(p => Date.parse(p.startedAt) <= +now)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0];
  let reason = '';
  if (!Number.isFinite(runCap) || runCap <= 0 || runCap > RUN_CAP_USD) reason = 'invalid-run-cap';
  else if (![credits, used, ceiling].every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0)
      || !Number.isFinite(Date.parse(limits?.monthlyUsageCycle?.startAt))
      || !Number.isFinite(Date.parse(limits?.monthlyUsageCycle?.endAt))) reason = 'unknown-account-budget';
  else if (+now < Date.parse(limits.monthlyUsageCycle.startAt) || +now > Date.parse(limits.monthlyUsageCycle.endAt)) reason = 'stale-budget-cycle';
  else if (ceiling > credits) reason = 'account-limit-exceeds-included-credit';
  else if (Math.min(credits, ceiling) - used < runCap + CREDIT_RESERVE_USD) reason = 'included-credit-reserve';
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
    creditReserveUsd: CREDIT_RESERVE_USD,
    pricingModel: pricing?.pricingModel || null,
  };
}

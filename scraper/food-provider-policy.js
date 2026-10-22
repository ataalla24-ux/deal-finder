import { POWER_FOOD_SOURCES } from './power-food-sources.js';

export const DAY = 86_400_000;
export const CAPS = Object.freeze({ scraperapi: 10, scrapingbee: 5, zyte: 0.05 });
export const BENCHMARK_SOURCES = ['Burger King', 'KFC'];
export const SCAN_SOURCES = POWER_FOOD_SOURCES.filter(s => ['essen', 'kaffee'].includes(s.category)).map(s => s.name);
// Dashboard-verified organization-wide BLOCKING limit, not a paid plan limit.
// Pin the existing extraction key; no renewal or new-account credit assumptions.
// Stats cannot be queried with this key, so do not present this as live usage.
export const ZYTE_TRIAL_CHECK = Object.freeze({ checkedAt: '2026-10-22T20:41:00Z',
  validUntil: '2026-11-21T00:00:00Z', includedUsd: 5, blockingLimitUsd: 4 });
export const BEE_TRIAL_END = '2026-11-05T00:00:00Z';
export const SCAN_PROVIDERS = ['scrapingbee', 'zyte', 'scraperapi'];

export function validateLedger(state) {
  if (state?.version !== 1 || !Array.isArray(state.reservations) || !state.sources || !state.providerPauses)
    throw new Error('invalid-food-provider-ledger');
  for (const r of state.reservations) {
    if (!/^\d+$/.test(r.runId) || !Number.isFinite(Date.parse(r.at)) || !['benchmark', 'scan'].includes(r.mode) || !Array.isArray(r.tasks))
      throw new Error('invalid-food-provider-reservation');
    for (const t of r.tasks) {
      if (!(t.provider in CAPS) || t.cap !== CAPS[t.provider] || !POWER_FOOD_SOURCES.some(s => s.name === t.source))
        throw new Error('invalid-food-provider-task');
    }
  }
}

export function freeBudget(provider, usage, state, amount, now = new Date(), mode = 'scan') {
  validateLedger(state);
  if (!Object.hasOwn(CAPS, provider) || !Number.isFinite(amount) || amount < 0 || !Number.isFinite(+now)) return 'invalid-budget-request';
  if (Date.parse(state.providerPauses[provider] || '') > +now) return 'provider-paused';
  const all = state.reservations.flatMap(r => r.tasks.filter(t => t.provider === provider).map(t => ({ at: r.at, cap: t.cap })));
  const spent = since => all.filter(t => Date.parse(t.at) > since).reduce((sum, t) => sum + t.cap, 0);
  const dayStart = Math.floor(+now / DAY) * DAY;
  if (provider === 'zyte') {
    if (!usage?.credentialPresent || usage.trialKeyBound !== true
      || usage.status !== 'provider-blocking-limit-not-live-usage'
      || +now < Date.parse(ZYTE_TRIAL_CHECK.checkedAt) || +now >= Date.parse(ZYTE_TRIAL_CHECK.validUntil)) return 'zyte-trial-guard-unverified-or-expired';
    if (spent(dayStart - 1) + amount > .1 + 1e-9 || spent(0) + amount > 3 + 1e-9) return 'zyte-local-trial-cap';
    return '';
  }
  if (usage?.status !== 'authenticated' || !Number.isFinite(usage.used) || !Number.isFinite(usage.maximum)
      || usage.used < 0 || usage.maximum - usage.used < amount + 100 || usage.concurrency !== 0) return 'free-credit-unverified-or-low';
  if (provider === 'scraperapi') {
    if (![1000, 5000].includes(usage.maximum) || usage.payAsYouGoEnabled !== false || usage.autoUpgradeEnabled !== false) return 'not-confirmed-free-plan';
    if (spent(dayStart - 1) + amount > 25 || spent(+now - 31 * DAY) + amount > 900) return 'scraperapi-local-credit-cap';
  } else {
    if (usage.maximum !== 1000 || +now >= Date.parse(BEE_TRIAL_END)) return 'scrapingbee-trial-unverified-or-expired';
    if (spent(dayStart - 1) + amount > 10 || spent(0) + amount > 900) return 'scrapingbee-local-trial-cap';
  }
  return '';
}

export function sourceAvailable(source, powerReport, state, now) {
  if (!powerReport || !Number.isFinite(Date.parse(powerReport.finishedAt))
      || Date.parse(powerReport.finishedAt) > +now || +now - Date.parse(powerReport.finishedAt) > 2 * DAY) return false;
  const previous = powerReport.sources?.find(row => row.source === source.name && row.url === source.url);
  // A fresh failed/deferred report is not permission to rotate scraping services.
  if (!previous || ['error', 'deferred'].includes(previous.status)) return false;
  return !(Date.parse(previous.cooldown?.nextRetryAt || '') > +now)
    && !(Date.parse(state.sources[source.name]?.retryAt || '') > +now);
}

export function planRequests(state, powerReport, usages, mode, now, runId) {
  validateLedger(state);
  if (!['scan', 'benchmark'].includes(mode) || !/^\d+$/.test(runId)) throw new Error('invalid-run');
  if (state.reservations.some(r => r.runId === runId || mode === 'benchmark' && r.mode === 'benchmark'))
    return { tasks: [], skipped: [{ reason: 'already-reserved-no-replay' }] };
  const names = mode === 'benchmark' ? BENCHMARK_SOURCES : SCAN_SOURCES;
  const sources = POWER_FOOD_SOURCES.filter(s => names.includes(s.name) && sourceAvailable(s, powerReport, state, now))
    .sort((a, b) => (Date.parse(state.sources[a.name]?.attemptedAt || '') || 0) - (Date.parse(state.sources[b.name]?.attemptedAt || '') || 0));
  const tasks = [], skipped = [];
  for (const provider of mode === 'benchmark' ? ['scraperapi', 'scrapingbee', 'zyte'] : SCAN_PROVIDERS) {
    // Expiring trial credits get first choice, but never duplicate a page across
    // services in a scan or rotate providers to work around a source cooldown.
    const selected = sources.filter(s => mode === 'benchmark' || !tasks.some(t => t.source === s.name)).slice(0, 2);
    if (!selected.length) { skipped.push({ provider, reason: 'no-eligible-distinct-source' }); continue; }
    const reason = freeBudget(provider, usages[provider], state, CAPS[provider] * selected.length, now, mode);
    if (reason) skipped.push({ provider, reason });
    else for (const source of selected) tasks.push({ provider, source: source.name, cap: CAPS[provider] });
  }
  return { tasks, skipped };
}

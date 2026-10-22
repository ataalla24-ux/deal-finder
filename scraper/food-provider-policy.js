import { POWER_FOOD_SOURCES } from './power-food-sources.js';

export const DAY = 86_400_000;
export const CAPS = Object.freeze({ scraperapi: 10, scrapingbee: 5, zyte: 0.05 });
export const BENCHMARK_SOURCES = ['Burger King', 'KFC'];
export const SCAN_SOURCES = ['Burger King', 'NORDSEE', "McDonald's", 'Der Mann', 'BackWerk'];
// Zyte has no usage endpoint for its extraction key. Only this one-shot trial
// benchmark is permitted after the owner dashboard check, never unattended use.
export const ZYTE_TRIAL_CHECK = { checkedAt: '2026-10-22T20:15:00Z', validUntil: '2026-10-23T20:15:00Z', remainingUsd: 5 };
export const BEE_TRIAL_END = '2026-11-05T00:00:00Z';

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
  if (Date.parse(state.providerPauses[provider] || '') > +now) return 'provider-paused';
  const all = state.reservations.flatMap(r => r.tasks.filter(t => t.provider === provider).map(t => ({ at: r.at, cap: t.cap })));
  const spent = since => all.filter(t => Date.parse(t.at) > since).reduce((sum, t) => sum + t.cap, 0);
  if (provider === 'zyte') {
    if (mode !== 'benchmark' || !usage?.credentialPresent || +now < Date.parse(ZYTE_TRIAL_CHECK.checkedAt)
      || +now >= Date.parse(ZYTE_TRIAL_CHECK.validUntil) || spent(0) + amount > .1 + 1e-9) return 'zyte-one-shot-trial-only';
    return '';
  }
  if (usage?.status !== 'authenticated' || !Number.isFinite(usage.used) || !Number.isFinite(usage.maximum)
      || usage.used < 0 || usage.maximum - usage.used < amount + 100 || usage.concurrency !== 0) return 'free-credit-unverified-or-low';
  if (provider === 'scraperapi') {
    if (![1000, 5000].includes(usage.maximum) || usage.payAsYouGoEnabled !== false || usage.autoUpgradeEnabled !== false) return 'not-confirmed-free-plan';
    if (spent(+now - DAY) + amount > 25 || spent(+now - 31 * DAY) + amount > 900) return 'scraperapi-local-credit-cap';
  } else {
    if (mode !== 'benchmark' || usage.maximum !== 1000 || +now >= Date.parse(BEE_TRIAL_END) || spent(0) + amount > 100) return 'scrapingbee-trial-only';
  }
  return '';
}

export function sourceAvailable(source, powerReport, state, now) {
  if (!powerReport || !Number.isFinite(Date.parse(powerReport.finishedAt))
      || +now - Date.parse(powerReport.finishedAt) > 2 * DAY) return false;
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
    .sort((a, b) => (Date.parse(state.sources[a.name]?.attemptedAt || '') || 0) - (Date.parse(state.sources[b.name]?.attemptedAt || '') || 0))
    .slice(0, 2);
  const tasks = [], skipped = [];
  for (const provider of mode === 'benchmark' ? ['scraperapi', 'scrapingbee', 'zyte'] : ['scraperapi']) {
    const reason = freeBudget(provider, usages[provider], state, CAPS[provider] * sources.length, now, mode);
    if (reason) skipped.push({ provider, reason });
    else for (const source of sources) tasks.push({ provider, source: source.name, cap: CAPS[provider] });
  }
  return { tasks, skipped };
}

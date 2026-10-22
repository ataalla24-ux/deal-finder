import { POWER_FOOD_SOURCES, isAllowedFoodUrl } from './power-food-sources.js';

export const DAY = 86_400_000;
// Plain browser HTML only; Zyte's highest published tier is USD .01608.
// Old .05 allocations remain valid and fully charged in the ledger.
export const CAPS = Object.freeze({ scraperapi: 10, scrapingbee: 5, zyte: 0.02 });
export const MAX_SCAN_TASKS = 32;
export const MAX_PAGES_PER_SOURCE = 4;
export const SCRAPER_TRIAL_END = '2026-10-29T00:00:00Z';
export const BENCHMARK_SOURCES = ['Burger King', 'KFC'];
export const SCAN_SOURCES = POWER_FOOD_SOURCES.filter(s => ['essen', 'kaffee'].includes(s.category)).map(s => s.name);
// Dashboard-verified organization-wide BLOCKING limit, not a paid plan limit.
// Pin the existing extraction key; no renewal or new-account credit assumptions.
// Stats cannot be queried with this key, so do not present this as live usage.
export const ZYTE_TRIAL_CHECK = Object.freeze({ checkedAt: '2026-10-22T20:41:00Z',
  validUntil: '2026-11-21T00:00:00Z', includedUsd: 5, blockingLimitUsd: 4 });
export const BEE_TRIAL_END = '2026-11-05T00:00:00Z';
export const SCAN_PROVIDERS = ['scrapingbee', 'zyte', 'scraperapi'];

export function canonicalPage(value, source) {
  if (!isAllowedFoodUrl(value, source)) return null;
  const url = new URL(value);
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  return url.href;
}
export const taskKey = task => `${task.source}|${task.url || POWER_FOOD_SOURCES.find(s => s.name === task.source)?.url}`;

export function validateLedger(state) {
  if (state?.version !== 1 || !Array.isArray(state.reservations) || !state.sources || !state.providerPauses)
    throw new Error('invalid-food-provider-ledger');
  for (const r of state.reservations) {
    if (!/^\d+$/.test(r.runId) || !Number.isFinite(Date.parse(r.at)) || !['benchmark', 'scan'].includes(r.mode) || !Array.isArray(r.tasks))
      throw new Error('invalid-food-provider-reservation');
    for (const t of r.tasks) {
      const source = POWER_FOOD_SOURCES.find(s => s.name === t.source);
      if (!Object.hasOwn(CAPS, t.provider) || !(t.cap === CAPS[t.provider] || t.provider === 'zyte' && t.cap === .05)
          || !source || !SCAN_SOURCES.includes(t.source) || t.url !== undefined && canonicalPage(t.url, source) !== t.url)
        throw new Error('invalid-food-provider-task');
    }
    if (r.unspent !== undefined && (!Array.isArray(r.unspent) || new Set(r.unspent).size !== r.unspent.length
        || r.unspent.some(i => !Number.isInteger(i) || i < 0 || i >= r.tasks.length))) throw new Error('invalid-unspent-allocation');
  }
}

export function freeBudget(provider, usage, state, amount, now = new Date(), mode = 'scan') {
  validateLedger(state);
  if (!Object.hasOwn(CAPS, provider) || !Number.isFinite(amount) || amount < 0 || !Number.isFinite(+now)) return 'invalid-budget-request';
  if (Date.parse(state.providerPauses[provider] || '') > +now) return 'provider-paused';
  const all = state.reservations.flatMap(r => r.tasks.filter((t, i) => t.provider === provider && !r.unspent?.includes(i)).map(t => ({ at: r.at, cap: t.cap })));
  const spent = since => all.filter(t => Date.parse(t.at) > since).reduce((sum, t) => sum + t.cap, 0);
  if (provider === 'zyte') {
    if (!usage?.credentialPresent || usage.trialKeyBound !== true
      || usage.status !== 'provider-blocking-limit-not-live-usage'
      || +now < Date.parse(ZYTE_TRIAL_CHECK.checkedAt) || +now >= Date.parse(ZYTE_TRIAL_CHECK.validUntil)) return 'zyte-trial-guard-unverified-or-expired';
    if (spent(0) + amount > 3.9 + 1e-9) return 'zyte-local-trial-cap';
    return '';
  }
  if (usage?.status !== 'authenticated' || !Number.isFinite(usage.used) || !Number.isFinite(usage.maximum)
      || usage.used < 0 || usage.maximum - usage.used < amount + 100 || usage.concurrency !== 0) return 'free-credit-unverified-or-low';
  if (provider === 'scraperapi') {
    if (![1000, 5000].includes(usage.maximum) || usage.payAsYouGoEnabled !== false || usage.autoUpgradeEnabled !== false) return 'not-confirmed-free-plan';
    if (usage.maximum === 5000) {
      if (+now >= Date.parse(SCRAPER_TRIAL_END)) return 'scraperapi-trial-expired';
      if (spent(0) + amount > 4900) return 'scraperapi-local-credit-cap';
    } else {
      // Do not assume a monthly reset. Live account usage and a rolling local
      // ceiling must both fit; the separately dated signup trial is not recurring.
      const since = +now >= Date.parse(SCRAPER_TRIAL_END) ? Math.max(+now - 31 * DAY, Date.parse(SCRAPER_TRIAL_END) - 1) : +now - 31 * DAY;
      if (spent(since) + amount > 900) return 'scraperapi-local-credit-cap';
    }
  } else {
    if (usage.maximum !== 1000 || +now >= Date.parse(BEE_TRIAL_END)) return 'scrapingbee-trial-unverified-or-expired';
    if (spent(0) + amount > 900) return 'scrapingbee-local-trial-cap';
  }
  return '';
}

export function scanTargets(state, powerReport, now) {
  const targets = new Map();
  for (const source of POWER_FOOD_SOURCES.filter(s => SCAN_SOURCES.includes(s.name) && sourceAvailable(s, powerReport, state, now))) {
    const report = powerReport.sources.find(r => r.source === source.name);
    // A failed child page is not permission to try it through another service.
    const denied = new Set((report.pages || []).filter(p => p.status !== 'ok')
      .flatMap(p => [canonicalPage(p.url, source), canonicalPage(p.finalUrl, source)]));
    const saved = (state.discoveredPages?.[source.name] || []).filter(p => Date.parse(p.seenAt) <= +now && Date.parse(p.seenAt) >= +now - 14 * DAY);
    const urls = [source.url, ...(source.seeds || []), ...(report.pages || []).filter(p => p.status === 'ok').map(p => p.finalUrl || p.url), ...saved.map(p => p.url)];
    for (const value of urls) {
      const url = canonicalPage(value, source);
      if (!url || denied.has(url)) continue;
      if (url !== source.url && !(source.seeds || []).includes(url)
          && source.providerPagePattern && !source.providerPagePattern.test(url)) continue;
      const target = { source: source.name, url };
      if (Date.parse(state.pages?.[taskKey(target)]?.retryAt || '') > +now) continue;
      targets.set(taskKey(target), target);
    }
  }
  const ordered = [...targets.values()].sort((a, b) => (Date.parse(state.pages?.[taskKey(a)]?.attemptedAt || '') || 0)
    - (Date.parse(state.pages?.[taskKey(b)]?.attemptedAt || '') || 0));
  const groups = new Map();
  for (const target of ordered) {
    if (!groups.has(target.source)) groups.set(target.source, []);
    groups.get(target.source).push(target);
  }
  // Give every merchant a first slot before a second page, and never let a
  // large news archive exhaust a run's included credit.
  return Array.from({ length: MAX_PAGES_PER_SOURCE }, (_, i) =>
    [...groups.values()].flatMap(group => group[i] ? [group[i]] : [])).flat();
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
  if (mode === 'scan') {
    const targets = scanTargets(state, powerReport, now);
    const allocated = Object.fromEntries(SCAN_PROVIDERS.map(p => [p, 0]));
    const blocked = new Set();
    while (targets.length && tasks.length < MAX_SCAN_TASKS) {
      let added = false;
      for (const provider of SCAN_PROVIDERS) {
        if (blocked.has(provider) || !targets.length || tasks.length >= MAX_SCAN_TASKS) continue;
        const amount = allocated[provider] + CAPS[provider];
        const reason = freeBudget(provider, usages[provider], state, amount, now, mode);
        if (reason) { blocked.add(provider); skipped.push({ provider, reason }); continue; }
        tasks.push({ ...targets.shift(), provider, cap: CAPS[provider] });
        allocated[provider] = amount;
        added = true;
      }
      if (!added) break;
    }
    return { tasks, skipped, eligiblePages: scanTargets(state, powerReport, now).length };
  }
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
